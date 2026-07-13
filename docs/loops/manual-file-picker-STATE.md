# Manual File Picker for Import — STATE

> Feature: when importing an existing repo that already has `.claude/` (or prompts elsewhere),
> different repos use different folder structures, so auto-mapping can't cover every case.
> Give the user a manual escape hatch: show the real folder tree and let them pick files and
> assign each a role (Agent / Command / Hook / Ignore).

## Requirements (from user)

- Loading an existing project with `.claude` fails for repos whose layout deviates from the
  hardcoded convention. Screenshot evidence (`vpo` repo):
  - `*.md.tmpl` files (`ba.md.tmpl`, `code-reviewer.md.tmpl`, …) → "Could not recognize the file type."
  - `architect.md` → skipped, "Nested mappings are not allowed in compact mappings at line 2, column 14" (strict YAML frontmatter parse failure).
- The importer is currently **all-or-nothing auto-classification** — deviating files silently drop.
- User wants to **display the project folder structure** and **let the user manually choose** which files are files/commands/agents.

## Root cause

- `readClaudeDirFilemap()` (apps/daemon/src/fs/readTargetFiles.ts) flat-reads only
  `.claude/{agents,commands,hooks}` + `settings.json`. Nothing else is even read.
- `parseClaudeDir()` (packages/core/src/parse/scan.ts) matches 4 hardcoded path regexes
  (`AGENT_PATH_RE` = `^\.claude/agents/([^/]+)\.md$`, etc.). Non-matches → `skipped`.
  Matches with bad frontmatter → `skipped` (thrown by `parseClaudeFile`).

## Scope (LOCKED via /simplify-implementation intake — 2 decisions)

- **Approach: C (Hybrid).** Auto-detect stays the zero-config happy path. Two additions:
  1. **Reclassify skipped files** — each skipped file gets an inline control
     `[ Ignore | Import as Agent | Import as Command ]`, with a "treat body as-is, no frontmatter"
     fallback so a bad-YAML file still imports (name from filename, empty description).
  2. **Manual browse entry point** — "Didn't find what you expected? Browse files manually →"
     opens a full folder-tree picker.
- **File scope: whole repo (with ignores).** The tree picker is NOT limited to `.claude/`.
  User can pick files anywhere (`prompts/`, `.cursor/`, `agents/`, …). Auto-ignore
  `node_modules`, `.git`, `.next`, `dist`, `coverage`, `out`, and other build dirs.
  Each picked file gets a role assignment (Agent / Command / Hook / Ignore).

## ⚠️ Pipeline gate — DO NOT fast-track

This feature adds a **recursive tree RPC that reads arbitrary file content across the whole repo**
— a filesystem trust boundary (path confinement, symlink-escape, depth/size/count caps,
DoS via huge trees). Per CLAUDE.md "Filesystem safety" + "Maker ≠ Checker":

- This is **NOT eligible for `/simplify-implementation`** (which deliberately skips the independent
  /review + /qa + /cso Checker stages).
- Run the **full pipeline**: /plan → /build → /review → **/cso (security-reviewer)** → /qa → /ship.
- The `/cso` stage is mandatory because it touches daemon RPC + filesystem-read path handling.

## Open design questions for /plan

1. **New RPC `listTree`** — recursive, lazy vs eager? Contract shape (depth cap, per-dir entry cap,
   total-node cap, ignore list). Where confinement lives (reuse `resolveConfinedPath`).
2. **File content read** — does the tree return content inline, or a second `readFile(relPath)` RPC
   on demand when the user picks a file? (Lazy read is safer: don't slurp the whole repo into memory.)
3. **Role-assignment model** — extend `ScanClaudeDirResult` / import payload so a picked file carries
   `{ relPath, role: "agent"|"command"|"hook"|"ignore" }`. Reuse `parseClaudeFile(content, {kind})`
   with the user-chosen kind; add the no-frontmatter fallback path in core.
4. **UI** — where the tree picker lives (ImportDialog + CreateProjectDialog both consume
   ImportReviewStep). Tree component, checkbox + role dropdown per node, ignore-folder collapse.
5. **Confinement + safety caps** the security-reviewer will require (name them up front so /build
   implements them, not bolts them on).

## Status: SCOPE LOCKED → next step /plan (full pipeline, not fast-track)

---

## PLAN — Architecture, Data Flow, Edge Cases & Safety Caps (architect, 2026-07-10)

> Source of truth for /build and the acceptance standard for /review + /cso.
> Resolves the 5 open design questions above. READ-ONLY feature: this design
> adds **no new write path** — it only *reads* repo files and stages the
> chosen ones into `.symbion/store.json` via the **existing** `importArtifacts`
> RPC (which already writes only the store, never the target repo's `.claude/`).

### PLAN §0 — Guiding decisions (TL;DR of the answers)

| Q | Decision |
|---|----------|
| 1 `listTree` | **New RPC, EAGER metadata walk** (dirs + files, no content), single call, hard-capped. Lazy per-dir expansion is NOT needed at v1 repo sizes once caps + ignore-list are enforced; eager-with-caps is simpler and avoids N round-trips. Confinement lives in the daemon walker via `resolveConfinedPath` against the repo root. |
| 2 content read | **Separate lazy `readImportFile(root, relPath)` RPC**, called only when the user assigns a non-ignore role to a file. Never slurp repo content into the tree. Guards memory + DoS. |
| 3 role model | New pure `packages/core` fn `classifyPickedFile(content, { kind, name })` that wraps `parseClaudeFile` and **falls back** to a no-frontmatter artifact on parse failure (name from filename, empty description, body as-is, `_importWarning` set). Picked files flow to import as ordinary `CanonicalArtifact[]` — **reuse the existing `importArtifacts` RPC unchanged.** |
| 4 UI | New `<FileTreePicker>` client component + extend `<ImportReviewStep>` with per-skipped-file reclassify controls. Both `ImportDialog` and `CreateProjectDialog` mount them; state (picked-map) stays owned by each dialog, same pattern as today's `selected` set. |
| 5 caps | Named explicitly in §5 below so /build implements, not bolts on: path confinement, symlink-escape rejection, depth cap, per-dir entry cap, total-node cap, max-file-size on read, binary rejection, ignore-list. |

### PLAN §0.5 — SPEC FLAWS I am flagging (do not silently inherit these)

The architect's job is to challenge the spec, not just implement it. Findings:

- **F1 — "whole repo tree" as the *default* is wrong; it must be opt-in.** The
  happy path is still auto-detect of `.claude/`. The whole-repo tree is the
  *escape hatch* reached via "Browse files manually →". /build MUST NOT walk the
  whole repo on every scan — that would turn every import of a large monorepo
  into a multi-thousand-node walk for no reason. `listTree` fires **only** when
  the user clicks "Browse files manually". (Scope §31–36 implies this; making it
  explicit here.)
- **F2 — the no-frontmatter fallback must WARN, not silently succeed.** Scope
  says "a bad-YAML file still imports (name from filename, empty description)".
  Silent success is a data-integrity trap: the user thinks they imported a
  structured agent but got an empty-description body-blob. Decision: the fallback
  **succeeds but is flagged** — `classifyPickedFile` sets `_importWarning:
  "Imported without frontmatter — name derived from filename, description empty."`
  and the UI shows a ⚠ badge on that row before import. The artifact is still
  importable (that is the whole point of the escape hatch), but never silently.
- **F3 — `role = "hook"` is NOT importable in v1.** Confirmed against
  `parseClaudeFile`/`importArtifacts`/`CanonicalArtifact`: the IR + import path
  only handle `kind: "agent" | "command"`. Hooks are read-only pass-through today
  (`ParsedClaudeDir.hooks` is `{relPath, content}[]`, never turned into an
  artifact, never imported). Therefore the role dropdown offers **Agent /
  Command / Ignore only** in v1. "Hook" is deliberately dropped from the picker
  (the STATE §6/§36 "Agent / Command / Hook / Ignore" list overpromises).
  Rationale over alternatives: adding a hook artifact kind is a much larger IR +
  render + adapter change, out of scope for a read-only import escape hatch.
  Recorded as a v2 follow-up.
- **F4 — "file picked as Agent but has command-shaped content" is not
  detectable and we should not pretend to.** The kind is 100% user-asserted on
  import. `classifyPickedFile` honors the user's `kind` verbatim (that is the
  escape hatch's contract). We do NOT second-guess it. The only cross-check is
  the standard `validateAllArtifacts` duplicate-name guard already in
  `importArtifacts`. Called out so /review does not expect content sniffing.
- **F5 — `.md.tmpl` name derivation.** The two vpo failures in Requirements are
  (a) unrecognized extension and (b) strict-YAML parse error. Name derivation for
  a picked file must strip a **trailing `.tmpl`** and a trailing `.md`, in that
  order: `ba.md.tmpl → ba`, `code-reviewer.md.tmpl → code-reviewer`,
  `architect.md → architect`. This is a pure fn in core (`deriveArtifactName`),
  unit-tested. Any other extension (`.txt`, none) → strip only a single trailing
  `.<ext>` if present, else use the basename as-is.

### PLAN §1 — Architecture: package/app boundaries

**`packages/core` (PURE — no fs/net) — NEW pure fns in `packages/core/src/parse/`:**

- `deriveArtifactName(basename: string): string` — the `.md.tmpl`/`.md`
  strip logic (F5). No disk.
- `classifyPickedFile(content: string, opts: { kind: "agent" | "command"; name: string; nowIso?: string }): { artifact: CanonicalArtifact; warning?: string }`
  — wraps `parseClaudeFile`; on throw, builds a fallback artifact
  (`description: ""`, `body: content` trimmed, `meta.status: "draft"`,
  fresh id) and returns `warning` (F2). On success, returns
  `{ artifact }` with no warning. This is the ONE place the no-frontmatter
  fallback lives. `parseClaudeDir`'s skipped-file loop can also route through
  this when the user reclassifies, but /build should keep `parseClaudeDir`'s
  auto pass unchanged (it still lands non-matches in `skipped[]`).
- `isProbablyBinary(sample: string | Uint8Array): boolean` — NUL-byte /
  high-non-printable-ratio heuristic, pure, used by the daemon *after* it reads a
  bounded prefix (see §5). Lives in core so it is unit-testable without fs.

**`apps/daemon` (ONLY disk toucher) — NEW `apps/daemon/src/fs/importTree.ts`:**

- `walkImportTree(root, opts): ImportTreeResult` — the recursive metadata walk
  (dirs + files, NO content). Reuses `listDir.ts`'s symlink/permission patterns
  (`readdirSync({ withFileTypes: true })`, per-entry stat, exclude symlinked
  dirs whose realpath escapes root, tolerate ACL'd children). Enforces every cap
  in §5. Returns a flat or nested node list (see §2 contract).
- `readImportFile(root, relPath): { content: string }` — the lazy single-file
  read. `resolveConfinedPath(root, relPath)` → stat size cap → read bounded
  bytes → `isProbablyBinary` reject. Reuses `readTargetFiles.ts` posture.

**`apps/daemon/src/rpc/handlers.ts`** — two new thin handlers `listTree` and
`readImportFile` delegating to `importTree.ts`. Import unchanged.

**`packages/rpc-types/src/index.ts`** — new param/result interfaces +
`"listTree" | "readImportFile"` added to `RpcMethod`. (No read-only allowlist to
update: `server.ts` dispatch is a plain `method in handlers` check.)

**`apps/web`** — new `src/components/FileTreePicker.tsx`; extend
`ImportReviewStep.tsx`; wire picked-map state into `ImportDialog.tsx` +
`CreateProjectDialog.tsx`. `src/lib/rpc/types` re-exports the new types.

### PLAN §2 — Data flow (web → daemon RPC → fs → UI)

```
Auto happy path (unchanged):
  scanClaudeDir(path) → readClaudeDirFilemap (disk) → parseClaudeDir (core) → review

Escape hatch (NEW), reached via "Browse files manually →":
  1. web: listTree({ root })
        → daemon walkImportTree (disk read, metadata only, capped)
        → ImportTreeResult { nodes, truncated flags }         ── TOUCHES DISK (read)
  2. web: user checks a file + picks role (Agent/Command/Ignore)
  3. web: readImportFile({ root, relPath })  (only for non-ignore picks)
        → daemon: resolveConfinedPath → size cap → read → binary check
        → { content }                                          ── TOUCHES DISK (read)
  4. web: classifyPickedFile(content, {kind, name})  (core, pure) → {artifact, warning?}
  5. web: accumulate picked artifacts into `pickedArtifacts[]` (+ warnings shown in UI)
  6. web: importArtifacts({ projectId, selectedIds, scanned: [...auto, ...picked] })
        → daemon writes ONLY .symbion/store.json                ── EXISTING write path
```

RPC methods that touch disk: `listTree` (read-only walk), `readImportFile`
(read-only single file). **No new write RPC.** `importArtifacts` is the only
mutation and it is unchanged — it writes only the store, never the repo.

Render→diff→write pipeline: **untouched.** Publishing back out to `.claude/`
still goes through the existing `render → computeDiff → write` confirm flow.
This feature never writes to the target repo.

### PLAN §3 — RPC contract shapes (for `packages/rpc-types`)

```ts
// depth/caps are daemon-enforced constants (§5); params carry only root + optional cursor knobs.
export interface ListTreeParams {
  /** absolute repo root (the project path). */
  root: string;
}
export interface ImportTreeNode {
  /** POSIX-style relPath from root, e.g. "prompts/ba.md.tmpl". */
  relPath: string;
  name: string;               // basename
  isDir: boolean;
  isSymlink: boolean;
  /** dirs only: true if this dir was pruned by the ignore-list (shown collapsed, not walked). */
  ignored?: boolean;
  /** files only: byte size (for the UI to grey out oversized ones pre-read). */
  size?: number;
  /** files only: true if the walker flagged it likely-binary by extension (defense-in-depth; real check is on read). */
  likelyBinary?: boolean;
}
export interface ListTreeResult {
  root: string;               // realpath'd root actually walked
  nodes: ImportTreeNode[];    // flat list, parent-before-child order; UI builds the tree
  /** true if ANY cap tripped (depth/per-dir/total-node) — UI shows "results truncated" banner. */
  truncated: boolean;
  /** which cap(s) tripped, for a precise message + /cso assertions. */
  truncatedReasons: Array<"depth" | "per-dir" | "total-node">;
}

export interface ReadImportFileParams {
  root: string;
  /** relative to root; daemon re-confines it — client value is never trusted. */
  relPath: string;
}
export type ReadImportFileResult =
  | { ok: true; content: string }
  | { ok: false; reason: "too-large" | "binary" | "not-found" | "denied"; message: string };
```

Design notes:
- **Flat node list, parent-before-child.** Simpler to serialize than a nested
  tree and the UI reconstructs nesting from `relPath` segments. Also makes the
  total-node cap trivially a `nodes.length` bound.
- `readImportFile` returns a **discriminated result, never throws** for the
  expected-outcome cases (too-large/binary/not-found/denied) — mirrors
  `listModels`/`fetchAuthorTemplates` posture in this codebase (real RpcError is
  reserved for confinement violations / programming errors, which SHOULD throw
  and surface as a hard error).
- **Confinement violation (`..`, absolute, symlink-escape) → THROW RpcError**
  (not a soft `ok:false`). A traversal attempt is not an expected outcome; it is
  an attack/bug and must be loud.

### PLAN §4 — UI design

- **Entry point:** In `ImportReviewStep` (after the auto agents/commands/skipped
  summary) add a link-button: *"Didn't find what you expected? Browse files
  manually →"*. Clicking it calls `listTree` and mounts `<FileTreePicker>`.
- **`<FileTreePicker>`** (`apps/web/src/components/FileTreePicker.tsx`, `"use
  client"`): renders the `nodes` as a collapsible tree. Ignored dirs render
  greyed + collapsed + non-expandable (label "(ignored)"). Each **file** row:
  `[checkbox] name [role dropdown: Ignore | Agent | Command]`. Oversized/binary
  files render disabled with a tooltip reason (size known from the tree; no read
  attempted). A "results truncated" banner shows when `truncated`.
- **Picked-file flow in the dialog** (state owned by `ImportDialog` /
  `CreateProjectDialog`, NOT by the shared components — same ownership rule as
  today's `selected` set, per the existing ImportReviewStep doc comment): a
  `Map<relPath, { role, artifactId?, warning? }>`. When the user sets a role ≠
  ignore, the dialog calls `readImportFile` → `classifyPickedFile` → stashes the
  resulting artifact + any `warning`. Rows with a warning show a ⚠ badge (F2).
- **Skipped-file reclassify (Approach C.1):** extend `ImportReviewStep` so each
  `skipped[]` row gets the same inline `[ Ignore | Agent | Command ]` control.
  Reclassifying a skipped file reuses the SAME dialog handler: it already has the
  content (skipped files were read during `scanClaudeDir`)... **correction:**
  `scanClaudeDir` currently does NOT return skipped-file *content*, only
  `{relPath, reason}`. Two options for /build (pick B):
  - (A) enrich `ScanClaudeDirResult.skipped` with `content` — but that re-slurps
    content the whole point of §2 was to avoid.
  - **(B, chosen)** reclassify calls `readImportFile(root, skipped.relPath)` on
    demand, same lazy path as the tree picker. One code path for both. No
    `ScanClaudeDirResult` shape change. **/build: use (B).**
- **Both dialogs** import the extended `ImportReviewStep` + `FileTreePicker`. The
  final `handleImport` merges `[...scanned.agents, ...scanned.commands,
  ...pickedArtifacts]` into the existing `importArtifacts` call.

### PLAN §5 — Confinement + safety caps (the /cso checklist, named UP FRONT)

/build implements ALL of these in `importTree.ts` / `readImportFile`; /cso
verifies each has a test in the testplan's SECURITY section.

1. **Path confinement** — every file/dir path resolved via `resolveConfinedPath(root, relPath)`. Walker never emits a node outside `root`.
2. **`..` rejection** — `rejectTraversalSegments` (already inside `resolveConfinedPath`); also reject in `readImportFile`'s `relPath` before use.
3. **Absolute-path rejection** — `relPath` must be relative; absolute (POSIX or Windows-style) → RpcError. `root` itself must be absolute (like `listDir`).
4. **Symlink-escape rejection** — reuse `listDir.ts` pattern: a symlinked dir whose realpath resolves outside `root` is **excluded from the walk** (not followed). `resolveConfinedPath`'s ancestor-realpath check backstops `readImportFile`.
5. **Symlink-cycle protection** — do NOT follow directory symlinks during the walk at all (treat symlinked dirs as leaf nodes, non-expandable). This makes cycles impossible by construction. (Simpler + safer than a visited-inode set.)
6. **Depth cap** — `MAX_DEPTH = 8` levels below root. Deeper dirs are not walked; sets `truncated`/`"depth"`.
7. **Per-dir entry cap** — `MAX_ENTRIES_PER_DIR = 500`. Beyond that a dir's remaining entries are dropped; sets `"per-dir"`.
8. **Total-node cap** — `MAX_TOTAL_NODES = 5000`. Walk stops when reached; sets `"total-node"`. Bounds response size + walk time (DoS).
9. **Max file size on read** — `MAX_FILE_BYTES = 512 KiB`. `readImportFile` stats first; over cap → `{ ok:false, reason:"too-large" }`. Never reads an unbounded file into memory.
10. **Binary rejection** — read a bounded prefix, run `isProbablyBinary` (core); binary → `{ ok:false, reason:"binary" }`. Prevents importing a `.png`/`.wasm` as an "agent".
11. **Ignore-list** (dirs pruned, not walked): `node_modules`, `.git`, `.next`, `dist`, `build`, `coverage`, `out`, `.turbo`, `.cache`, `.symbion`, `.venv`, `vendor`, `target`. Matched by exact dir *name* at any depth. Ignored dirs appear in the tree as collapsed `ignored:true` markers (so the user sees why something is missing) but are never descended.
12. **Read-only guarantee** — neither `listTree` nor `readImportFile` writes, creates, renames, or deletes anything. State-changing verbs are absent from `importTree.ts`. Foreign/unmanaged files are only *read*, never touched.
13. **`root` validation** — `root` must exist, be a directory, be readable; else RpcError (mirror `listDir`).

Caps are daemon-side **constants** (not client params) so a crafted client can't
raise them. Exported for unit tests.

### PLAN §6 — Local-store schema (init/migration)

**Nothing new persists.** All picker state (tree, picked-map, role assignments,
warnings) is **transient import-session state** held in web component state and
discarded on dialog close. The only persisted effect is the resulting artifacts
landing in `.symbion/store.json` via the unchanged `importArtifacts` path — which
already handles its own schema. **No `ProjectStore` shape change, no migration,
no ignore-list config file** (the ignore-list is a hardcoded daemon constant, not
user-configurable in v1). If a future loop wants a persisted user ignore-list or
remembered role assignments, THAT loop adds the schema + migration; this one does
not. Explicitly recorded so /review doesn't expect a migration.

### PLAN §7 — Edge cases (build + test must cover)

| # | Case | Expected behavior |
|---|------|-------------------|
| E1 | Empty repo (no files) | `listTree` returns `nodes: []`, `truncated:false`. UI: "No files found." |
| E2 | Huge repo (>5000 nodes) | Walk stops at `MAX_TOTAL_NODES`, `truncated:true`, reason `"total-node"`. UI banner. No OOM/hang. |
| E3 | Deep nesting (>8 levels) | Dirs below cap not walked; `truncated`, reason `"depth"`. |
| E4 | Dir with >500 entries | Remaining entries dropped; `truncated`, reason `"per-dir"`. |
| E5 | Symlink cycle (`a → b → a`) | Symlinked dirs treated as leaves (§5.5); walk terminates. No infinite loop. |
| E6 | Symlink escaping root (`link → /etc`) | Excluded from walk; `readImportFile` on such a path → RpcError (confinement). |
| E7 | Binary file in tree (`logo.png`) | `likelyBinary:true` in tree (greyed); if forced, `readImportFile` → `{ok:false, reason:"binary"}`. |
| E8 | Permission-denied dir | Skipped (tolerated, like `listDir`); node may show unreadable; walk continues. |
| E9 | `.md.tmpl` name derivation | `ba.md.tmpl → ba`, `x.md → x` (F5). Import as Agent/Command works. |
| E10 | Bad-YAML frontmatter file (vpo `architect.md`) | `classifyPickedFile` fallback → artifact with `body`=raw, empty description, `warning` set; ⚠ badge; importable. |
| E11 | No-frontmatter plain `.md` | Same fallback path as E10; warned, importable. |
| E12 | Duplicate name across roles (two `ba` picked, one agent one command) | Different `kind` ⇒ allowed. Two agents named `ba` ⇒ `importArtifacts`' `validateAllArtifacts` blocks (existing behavior); UI surfaces the lint error. |
| E13 | File picked as Agent but body is command-shaped | Honored verbatim (F4). No content sniffing. |
| E14 | Oversized text file (>512 KiB) | `readImportFile` → `{ok:false, reason:"too-large"}`; row disabled with reason. |
| E15 | `relPath` with `..` / absolute from a crafted client | RpcError (throws, loud) — never a soft skip. |
| E16 | Ignored dir contains wanted file (`node_modules/foo/agent.md`) | Not surfaced (dir pruned). Documented limitation; user can't reach inside ignored dirs in v1. |
| E17 | Daemon disconnect mid-pick | Import-session state is transient; on reconnect the user re-scans/re-browses. No half-written store (importArtifacts is a single atomic store write). |
| E18 | Re-import unchanged (idempotent) | `importArtifacts` upserts by artifact id; re-picking the same file re-imports the same artifact id (marker id if present, else a fresh id) — no duplicate rows for marker-carrying files; body-blob fallbacks get fresh ids each time (acceptable; documented). |
| E19 | Non-`.md` text file picked (`prompts/ba.txt`) | Allowed — role is user-asserted; name = basename minus single ext. Escape hatch's whole point. |
| E20 | Path with mixed separators / trailing slash | Normalized by `resolveConfinedPath`/POSIX relPath construction. |

### PLAN §8 — Trade-offs & assumptions (for dev + Checker to track)

- **T1 Eager-vs-lazy tree:** eager metadata walk chosen. Assumption: with the
  ignore-list + 5000-node cap, a realistic repo's non-ignored tree is a few
  hundred nodes. If real repos routinely trip the cap, v2 revisits with lazy
  per-dir expansion (`listTree(root, subPath)`). Contract already carries
  `truncated` so lazy expansion can be added without breaking clients.
- **T2 No hook import (F3):** accepted scope cut. Role picker = Agent/Command/Ignore.
- **T3 Fallback warns, never silently succeeds (F2):** accepted; `_importWarning`
  is a UI-only concern (do not persist a warning field into the IR unless
  `CanonicalArtifact` already tolerates unknown fields — /build: keep the warning
  in the web picked-map, not on the artifact, to avoid an IR shape change).
- **T4 Symlinked dirs never followed (§5.5):** trades completeness (won't show
  files reachable only via an in-repo symlink) for guaranteed cycle-safety +
  simpler confinement. Accepted.
- **T5 Ignore-list is hardcoded, not configurable (§6):** accepted for v1.
- **T6 Confinement violations throw; expected outcomes return soft results
  (§3):** deliberate asymmetry so attacks are loud and normal skips are quiet.

### PLAN §9 — Files to create / modify (handoff manifest)

Create:
- `packages/core/src/parse/pickedFile.ts` — `deriveArtifactName`, `classifyPickedFile`, `isProbablyBinary` (+ export from core index).
- `apps/daemon/src/fs/importTree.ts` — `walkImportTree`, `readImportFile`, cap constants.
- `apps/web/src/components/FileTreePicker.tsx`.

Modify:
- `packages/rpc-types/src/index.ts` — new `ListTree*`/`ReadImportFile*` types + `RpcMethod` union.
- `apps/daemon/src/rpc/handlers.ts` — `listTree`, `readImportFile` handlers.
- `apps/web/src/components/ImportReviewStep.tsx` — skipped-file reclassify controls + "Browse files manually" entry.
- `apps/web/src/components/ImportDialog.tsx` + `CreateProjectDialog.tsx` — picked-map state, merge into `importArtifacts`.
- `apps/web/src/lib/rpc/types` — re-export new types.

**No production code written in this loop — /build implements the above.**

### Status: PLAN COMPLETE → BUILD DONE → next step /review → /cso → /qa → /ship

---

## BUILD — implementation notes (feature-builder, 2026-07-10)

> Maker output. NOT self-reviewed — handed to /review + /cso + /qa. Anything I
> was unsure about is called out under "Assumptions / flags for Checker".

### Files created

- `packages/core/src/parse/pickedFile.ts` (PURE — no fs/net/Node imports):
  - `deriveArtifactName(basename)` — F5: strip trailing `.tmpl`, then `.md`, else
    a single trailing ext, else basename as-is (dotfiles like `.gitignore`
    preserved).
  - `classifyPickedFile(content, {kind, name, nowIso?})` — wraps `parseClaudeFile`;
    on ANY parse throw builds a fallback artifact (description "", body = raw
    trimmed, status "draft", marker id reused if present else fresh id) and
    returns a human `warning` (F2). Success → `{ artifact }` no warning. The ONE
    fallback site.
  - `isProbablyBinary(sample)` — NUL-byte / >30% control-char heuristic; string
    overload uses a local UTF-8 encoder so core stays TextEncoder-free.
  - Exported from `packages/core/src/index.ts`.
- `apps/daemon/src/fs/importTree.ts` (ONLY disk toucher):
  - `walkImportTree(root)` — eager metadata-only recursive walk (dirs+files, NO
    content), flat parent-before-child node list. Enforces every §5 cap. Never
    follows dir symlinks (cycle-proof). Symlink-escape excluded from walk.
  - `readImportFile(root, relPath)` — confine → stat size cap → bounded sniff +
    `isProbablyBinary` → full read. Confinement violations THROW
    `RpcError("path-confinement", …)`; expected outcomes return soft
    `{ok:false, reason}`.
  - Exported cap constants: `MAX_DEPTH=8`, `MAX_ENTRIES_PER_DIR=500`,
    `MAX_TOTAL_NODES=5000`, `MAX_FILE_BYTES=512*1024`, `BINARY_SNIFF_BYTES`,
    `IGNORE_DIR_NAMES` (the §5.11 list).
- `apps/web/src/components/FileTreePicker.tsx` (`"use client"`) — collapsible tree
  reconstructed from flat `relPath` segments; ignored dirs greyed/non-expandable;
  each file row `[checkbox] name [role: Ignore|Agent|Command]`; oversized/binary
  rows disabled with a Tooltip reason; ⚠/✗ inline badges; "results truncated"
  banner.
- `apps/web/src/components/importPickerShared.ts` (NEW, not in manifest — see flag
  A1) — shared `applyPickedRole` (read→classify transition), `basenameOf`,
  `MAX_FILE_KIB`, and re-exports of `PickedRole`/`PickedEntry`. One code path for
  both the tree picker and skipped-file reclassify (PLAN §4 B).
- `packages/core/test/pickedFile.test.ts` — U1–U15 (+ extras).
- `apps/daemon/test/importTree.test.ts` — D1–D17 + S1–S17 confinement/cap/read-only.

### Files modified

- `packages/rpc-types/src/index.ts` — added `ListTreeParams`, `ImportTreeNode`,
  `ListTreeResult`, `ReadImportFileParams`, `ReadImportFileResult`; added
  `"listTree" | "readImportFile"` to `RpcMethod`.
- `apps/daemon/src/rpc/contract.ts` + `apps/web/src/lib/rpc/types.ts` — re-export
  the 5 new types.
- `apps/daemon/src/rpc/handlers.ts` — thin `listTree` / `readImportFile` handlers
  delegating to `importTree.ts` (+ import).
- `apps/web/src/components/ImportReviewStep.tsx` — added `picked` map, per-skipped
  reclassify `[Ignore|Agent|Command]`, and the "Browse files manually →" link.
  (New required props: `picked`, `onReclassify`, `onBrowseManually`.)
- `apps/web/src/components/ImportDialog.tsx` + `CreateProjectDialog.tsx` — own the
  picked-map + pickedArtifacts state; `assignRole` runs the shared read→classify;
  mount `FileTreePicker`; merge `[...agents, ...commands, ...pickedArtifacts]` +
  their ids into the single `importArtifacts` call; footer count = auto + picked.

### Verification done (Maker mechanical, NOT the /qa gate)

- `packages/core`, `packages/rpc-types` build clean; `apps/daemon` `tsc --noEmit`
  clean; `apps/web` `next build` (incl. its own type-check + lint) passes.
- `vitest run --project core --project daemon` → 453 passed (incl. new 21 core +
  27 daemon tests). No regressions.
- Read-only proof: grep for write verbs (`writeFileSync`/`mkdirSync`/`rmSync`/
  `renameSync`/`unlinkSync`/`writeSync`/`chmodSync`/…) in `importTree.ts` → none.
- Pre-existing unrelated failure: `apps/web` vitest-tsconfig flags
  `toBeInTheDocument` in `DaemonStatusBadge.test.tsx` (jest-dom matcher types) —
  present on `master` before this loop, untouched by me, does NOT affect the app
  build. Flagged so /review doesn't attribute it here.

### Assumptions / flags for Checker (/review, /cso, /qa) to VERIFY

- **A1 (extra file).** I added `apps/web/src/components/importPickerShared.ts`,
  not named in the §9 manifest, to hold the shared read→classify handler +
  `MAX_FILE_KIB` so ImportDialog/CreateProjectDialog/FileTreePicker don't
  duplicate it. It imports only TYPES from FileTreePicker (erased at runtime) and
  a runtime value flows the other way → no runtime import cycle. Verify this is
  acceptable vs. inlining.
- **A2 (depth-cap semantics).** MAX_DEPTH=8 is enforced as "deepest emitted
  relPath has exactly 8 segments" (descend blocked when `childDepth >= 8`).
  Confirm that matches the intended "8 levels below root" (test D6 asserts
  `maxSegments <= 8`).
- **A3 (binary heuristic threshold).** `isProbablyBinary` = NUL byte OR >30%
  non-printable control chars (excluding tab/LF/CR/DEL-adjacent). The 30% ratio
  is a judgment call with no spec number — /cso/qa should sanity-check it doesn't
  false-reject legit UTF-8 text (I added a multibyte-UTF-8 test that passes).
- **A4 (`likelyBinary` by extension).** The tree flags a fixed ext list
  (`.png/.wasm/.zip/…`) as `likelyBinary` for pre-read greying. This is
  defense-in-depth ONLY; the authoritative reject is `isProbablyBinary` on read.
  A binary file with a `.md` name is NOT greyed in the tree but IS rejected on
  read (test D12 uses a `.png`; the on-read reject is name-agnostic).
- **A5 (readImportFile denied vs not-found).** EACCES/EPERM → `reason:"denied"`;
  everything else statting/opening → `reason:"not-found"`. A race between stat and
  open is bucketed as not-found. Verify that taxonomy is fine for the UI.
- **A6 (symlink display stat).** For a symlink node the walk does a `statSync`
  (follows link) ONLY to read the target's type/size for display, AFTER a
  realpath-escape check excludes escaping links. It never DESCENDS a symlinked
  dir. Confirm this display-only follow is acceptable (it reads metadata, not
  content; escaping links already excluded).
- **A7 (warning is UI-only, T3).** The fallback `warning` lives ONLY in the web
  picked-map (`PickedEntry.warning`); it is NOT written onto `CanonicalArtifact`
  or persisted. `classifyPickedFile` returns it as a sibling field. Confirm no IR
  shape change.
- **A8 (id reuse / idempotency, E18).** `classifyPickedFile` reuses a marker id
  when the content carries a `<!-- managed-by: symbion … -->` marker (even on the
  fallback path), else a fresh id → marker-carrying files re-import idempotently;
  body-blob fallbacks get a fresh id each pick (documented acceptable per E18).
- **A9 (importArtifacts selectedIds).** Picked artifacts are ALL added to both
  `scanned` and `selectedIds` in the dialogs (a picked file is by definition
  selected). Auto agents/commands keep the existing checkbox-driven `selected`
  set. Duplicate-name blocking (E12/I5) is still the daemon's existing
  `validateAllArtifacts` — unchanged, not re-implemented client-side.
- **A10 (reclassify re-read on every change).** Changing a skipped/tree row's
  role from agent↔command re-calls `readImportFile` + reclassifies (drops the
  prior artifactId, stashes the new one). No content caching in web state — one
  extra read per role change. Acceptable per PLAN §2 "never slurp"; flag if /qa
  wants caching.
- **A11 (FileTreePicker default expansion).** Top-level rows render expanded
  (`depth < 1`), deeper rows collapsed by default. Cosmetic; verify UX is fine.
- **A12 (no hooks in role picker, F3).** Role dropdown offers only
  Ignore/Agent/Command everywhere (tree + skipped reclassify). "Hook" is dropped
  per F3/T2.

### Deferred / not done (by design)

- No lazy per-dir `listTree(root, subPath)` expansion (T1 — eager+caps chosen).
- No hook import (F3/T2 — v2).
- No persisted ignore-list / remembered role assignments (§6 — no store schema
  change, no migration).
- Content sniffing to second-guess user-asserted kind (F4 — not done on purpose).
- Reaching inside ignored dirs (E16 — documented v1 limitation).

### /review round 1 → NEEDS-WORK fixes (feature-builder, 2026-07-11)

Both Checkers (code-reviewer + architect) flagged 1 blocker + 2 non-blocking
notes. All three addressed; re-run stays green (core+daemon 454 passed, `next
build` clean). Handing back to /review — NOT self-reviewed.

- **🔴 BLOCKING — stale-closure artifact leak** (`ImportDialog.tsx`,
  `CreateProjectDialog.tsx`). FIXED by re-keying `pickedArtifacts` from
  `Map<artifactId, artifact>` → **`Map<relPath, artifact>`** in BOTH dialogs. The
  `setPickedArtifacts` functional update now does `next.set(relPath, artifact)` /
  `next.delete(relPath)` — it no longer reads the captured `picked` closure to
  find the old id, so a rapid Agent→Command→Agent on the same row before a
  re-render fully replaces (never orphans) the prior artifact. `handleImport`
  still consumes `pickedArtifacts.values()`, unchanged. Footer count and
  `importArtifacts` payload can no longer over-count.
- **🟢 Note 1 — fallback body retained the managed marker** (`pickedFile.ts`).
  FIXED: the fallback now strips a trailing `<!-- managed-by: symbion … -->`
  marker from `body` FIRST, using the same regex as `parseClaudeFile`/scan.ts:33,
  before trimming. New test `U15b` asserts the stripped body + reused marker id +
  still-draft meta. No duplicated marker on later render/publish.
- **🟢 Note 2 — draft divergence made explicit** (`pickedFile.ts`). Added an
  inline comment on the fallback `meta` block stating it INTENTIONALLY stays
  `status:"draft"`/`version:"draft"` (diverging from scan.ts's marker path which
  sets published/marker.version) because the file failed to parse — even when a
  marker id is reused for E18 idempotency. Behavior unchanged; `U15b` also
  asserts the draft meta.

Files touched this round: `apps/web/src/components/ImportDialog.tsx`,
`apps/web/src/components/CreateProjectDialog.tsx`,
`packages/core/src/parse/pickedFile.ts`,
`packages/core/test/pickedFile.test.ts` (+U15b).

### Status: BUILD (review round 1 fixes applied) → back to /review

---

## REVIEW — independent Checkers (code-reviewer + architect, 2026-07-11)

Two independent Checkers, run in parallel per Maker ≠ Checker.

**Round 1:** code-reviewer → PASS (with one 🟡 flagged for fix); architect →
NEEDS-WORK. Aggregate = NEEDS-WORK. One converged blocker, found independently by
both:

- **🔴 Stale-closure artifact leak** (`ImportDialog.tsx`, `CreateProjectDialog.tsx`)
  — `setPickedArtifacts(prev => …)` read `picked.get(relPath)` from the captured
  render closure; because `applyPickedRole` is async, rapid same-row role toggling
  (Agent→Command→Agent) captured a stale map, orphaning the prior artifactId →
  over-counted footer + unintended artifacts in the `importArtifacts` payload.

Plus two non-blocking notes: fallback body retained the managed marker;
undocumented draft-status divergence in the fallback.

**Round 2 (after Maker fixes):** blocker re-verified resolved — `pickedArtifacts`
re-keyed by `relPath` (both dialogs), updater no longer reads the captured
closure, so same-row role changes overwrite in place with zero orphans;
ignore/uncheck and soft-read-failure both `delete(relPath)` so nothing phantom
reaches import; `.values()` yields one artifact per row (E12/E18 unaffected,
daemon-side). Both notes also fixed. 454 tests pass.

**Verified clean (de-risks /cso):** core purity holds (no fs/net in `pickedFile.ts`);
READ-ONLY guarantee proven (fixture mtime-unchanged test); all 13 safety caps
present + tested; DoS-safe (file size gated by `stat` before read; binary sniff
reads bounded 8 KiB prefix); F1 opt-in honored (`listTree` fires only on "Browse
files manually", never on normal `scanClaudeDir`); all 12 Maker assumptions
A1–A12 verified; `importPickerShared.ts` (A1) warranted DRY, no runtime cycle.

**For /qa to live-verify (UI-only, no automated test):** E12 (duplicate-name lint),
E16 (ignored-dir pruning UX), E17 (daemon disconnect), E19/E20 (non-`.md` /
mixed-separator picks).

### Verdict: BOTH PASS → next step **/cso** (MANDATORY — daemon RPC + fs-read path
handling), then /qa → /ship. Testplan SECURITY section S1–S17 is written for /cso.

---

## QA — SKIPPED + SHIP (user decision, 2026-07-13)

Shipped together with import-lifecycle-fixes in one commit. Live /qa explicitly
skipped by the user at the ship gate; automated verification (full build + 507
core/daemon tests) passed. Residual risk (unverified UI incl. the shared Dialog
primitive change, unresolved reclassify-dropdown bug, unverified live vpo flow) is
documented in import-lifecycle-fixes-STATE.md's QA section. REVIEW ✅ + CSO ✅ both
PASS. Status: DONE (QA skipped, risk accepted).
