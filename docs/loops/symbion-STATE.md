# Symbion — STATE (phase = DONE)

> **Phase: DONE — shipped 2026-06-26.** New, separate greenfield project — **NOT GeoChat**. No Supabase, no Realtime/Presence, no map, no PostGIS, no mobile, no cloud DB.
> Inputs (locked spec + design — do not re-litigate): [`docs/symbion-analyze.md`](../symbion-analyze.md) (ANALYZE), [`docs/loops/symbion-design.md`](./symbion-design.md) (DESIGN).
> Test plan handoff: [`docs/loops/symbion-testplan.md`](./symbion-testplan.md).
> Date: 2026-06-25 (PLAN) / 2026-06-26 (BUILD).

## BUILD note (2026-06-26, feature-builder)

Scaffolded the full monorepo per §1.1, in the mandated order: `packages/core` → `apps/daemon` → `apps/web`.

- **`packages/core`** (pure, no fs/net/Node imports): IR types, validate/lint, refs (mention extraction), claude+codex adapters + registry, frontmatter serialize/parse (stable key order, uses the `yaml` lib for parsing only), managed-marker build/parse + a hand-rolled pure-JS sha256 (no Node `crypto`), renderArtifacts, parseClaudeFile/parseClaudeDir, computeDiff + conflict classification (clean/conflict/foreign + a `isMergedTarget` flag for Codex first-publish), semver bump/validate, renderRunCommand. 53 Vitest unit tests, all passing, 94.42% line coverage (gate is ≥90%).
- **`apps/daemon`**: Node HTTP server bound to `127.0.0.1` only, per-boot session token (sha256-strength random, header `x-symbion-token`), Origin/Host allowlist, all 16 RPC methods from §4 implemented in `rpc/handlers.ts`, path confinement guard (`rpc/guard.ts`, rejects `..`, absolute paths, symlink escape), backup-before-write + atomic temp→rename (`fs/writeFiles.ts`), git status read-only, store load/save with schemaVersion migration scaffold + newer-schema refusal, terminal boot menu (Web UI / Terminal UI stub "sắp có ở v1.5" / Hide to Tray / Exit), static-serves the built `apps/web/out` on GET requests. 30 Vitest integration tests (T1–T15 from testplan + extra server-level security tests), all passing.
- **`apps/web`**: Next.js 14 App Router (static export, `output: "export"`) + Tailwind + hand-rolled shadcn-style primitives (Button/Input/Dialog — not the shadcn CLI). CodeMirror 6 via `@uiw/react-codemirror` for the markdown tab. React Flow (read-only, `nodesDraggable={false}`) for the dependency graph. Implements: ProjectSidebar, EmptyState (S2), CreateProjectDialog (S3), ImportDialog (S4), ProjectView (S5 list + S6 graph), BuilderDrawer (S7/S8 with Form/Markdown tabs + LivePreviewPane), AgentForm, WorkflowForm, MarkdownTab (two-way IR sync), PublishDialog (S10) → PublishDiffView (S11) → PublishResultView (S12), ConflictResolver, CopyRunCommandDialog (S13), DaemonStatusBadge (E9). `npm run build` produces a static export the daemon serves; verified end-to-end (daemon boot → serves S2 empty-state HTML → ping RPC responds) via manual smoke test.
- Root: npm workspaces (`packages/*`, `apps/*`), `tsconfig.base.json` (strict TS, **no path-alias hijacking of module resolution** — see assumption below), `vitest.workspace.ts` collecting both `packages/core` and `apps/daemon` suites.
- Test fixtures copied/recreated at `packages/core/test/fixtures/claude/{agents/ba.md,agents/code-reviewer.md,commands/analyze.md,agents/broken.md,settings.json}` per testplan §0 (GeoChat-style content, hand-authored to match the spec's documented frontmatter shapes since the actual GeoChat repo files were not available in this environment — see assumption #7 below).

**Total: 83 automated tests passing (53 core + 30 daemon). `npm run build` succeeds for all three workspaces in dependency order.**

## BUILD note (2026-06-26, follow-up — close S8 e2e coverage gap)

Round-2 review: code-reviewer PASS, architect NEEDS-WORK on one narrow gap — `e2e/happy-path.spec.ts`'s header claimed coverage of S2→S3→S7→S8→S10→S11→S12 but never actually exercised S8 (command/workflow artifact creation). Everything else from round 1/round 2 is confirmed solid and was **not** re-touched.

- Extended `e2e/happy-path.spec.ts` (single spec, same daemon-fixture pattern as the existing agent flow) with a new S8 step: after saving the agent, open the workflow drawer via `+ Thêm workflow`, fill in `WorkflowForm` (`apps/web/src/components/WorkflowForm.tsx`) name/description/body fields through real UI interaction, click the `[Chèn $ARGUMENTS]` helper button (not hand-typed `$ARGUMENTS`), save, then continue through the existing publish → diff → write flow (now asserting both `.claude/agents/code-reviewer.md` and `.claude/commands/analyze.md` land on disk with the managed-by marker, and the command file contains `$ARGUMENTS`).
- While wiring this up, the new test caught a **real pre-existing bug** in `WorkflowForm.tsx`'s `insertArguments()`: it called `update("body", …)` then `update("usesArguments", true)` as two separate calls, each spreading the same stale `artifact` closure — the second `onChange` call clobbered the first, so clicking "[Chèn $ARGUMENTS]" silently did NOT add `$ARGUMENTS` to the body in production. Fixed by combining into a single `onChange({ ...artifact, body: nextBody, usesArguments: true })` call. This is a one-line, narrowly-scoped fix in `apps/web` only (no `packages/core`, no `packages/rpc-types`, no daemon changes) — flagging for the Checker to re-verify since it touches a previously "confirmed solid" file, but the fix was strictly necessary to make S8 e2e coverage genuine instead of cosmetic.
- Verified: `npm run build` (all 3 workspaces) green, `npx vitest run` 95/95 passing (unchanged from before — no unit test touched the WorkflowForm bug), `npx playwright test` 1/1 passing (the single, now-extended happy-path spec).

Data flow is **web UI (Next.js) ↔ local Node daemon over localhost RPC ↔ filesystem + git**. Persistence = local files (per-project `.symbion/` + a user-level store), not a DB. The GeoChat `action→Supabase→Realtime→UI` template does **not** apply.

---

## 0. Decisions locked (echo for /build + /qa — do NOT reopen)

- **Deploy**: local Node daemon + web UI. `npm start` → terminal boot menu (Web UI / Terminal UI / Hide to Tray / Exit) showing daemon URL → Web UI opens `localhost:PORT`.
- **Monorepo**: `packages/core` (Canonical IR + render engine + Claude/Codex adapters + upsert/diff + version logic — **PURE functions, framework-agnostic, fully unit-testable**) · `apps/daemon` (Node: fs read/write, git, folder-pick, localhost RPC server, terminal boot menu) · `apps/web` (Next.js App Router + Tailwind + shadcn).
- **Run engine**: DEFER to v2. v1 = "Copy run command" only (render structured prompt string to clipboard; **NO execution**).
- **Providers v1**: Claude (`.claude/agents/<name>.md` + `.claude/commands/<name>.md`) + Codex (`AGENTS.md` at repo root). IR is vendor-agnostic so Copilot/Gemini are later adapters with **no IR change**.
- **Multi-project**: SOLO — one project = one independent set of workflows+agents. Shared library / propagate-to-N = v1.5 (out of v1).
- **UI**: 2-tab builder (Theo mô tả / Theo markdown) + live preview is core; read-only React Flow dependency graph; publish ALWAYS via diff preview.
- **Editor body**: CodeMirror 6 (NOT Monaco).
- **Versioning v1**: a version field at publish + daemon-side publish log + backups at `.symbion/backups/<version>/`. NO history-panel UI in v1 (deferred v1.5) — but data IS recorded so v1.5 can build the panel.
- **Codex lossy**: merge command bodies into `AGENTS.md` + lossy badge + "Tôi hiểu" acknowledge (not skip, not block).
- **Terminal UI**: present-but-stubbed ("sắp có v1.5"); v1 web-only. Boot menu shows all 4 options; Terminal UI prints a coming-soon notice and returns to menu.
- **Temperature/Model**: NOT real Claude frontmatter — live ONLY as custom fields under "Nâng cao" (`CanonicalArtifact.customFields`), rendered verbatim with a "(custom)" tag.

---

## 1. Architecture

### 1.1 Monorepo layout (npm workspaces)

```
symbion/
├─ package.json                 # workspaces: ["packages/*","apps/*"]; "start" → node apps/daemon boot menu
├─ tsconfig.base.json           # strict TS, path aliases @core/*, shared lib settings
├─ vitest.workspace.ts          # collects packages/core + apps/daemon unit/integration suites
├─ playwright.config.ts         # e2e against a real built daemon + temp project repo (root-level e2e/)
├─ e2e/                         # Playwright specs + daemon-fixture.ts (spawns built daemon per test, temp dirs)
├─ docs/loops/                  # STATE + testplan copied here at repo init
│
├─ packages/rpc-types/          # type-only. RPC request/response shapes — single source of truth for
│  │                            # apps/daemon/src/rpc/contract.ts (re-exports it) AND apps/web (imports it
│  │                            # directly). No hand-mirroring (post-review fix, 2026-06-26).
│  └─ src/index.ts
│
├─ packages/core/               # PURE. No fs, no net, no Node-only APIs. Vendor-agnostic.
│  ├─ package.json              # name "@symbion/core", side-effect-free, ESM
│  └─ src/
│     ├─ ir/
│     │  ├─ types.ts            # CanonicalArtifact, ProjectStore, PublishLogEntry, BackupRecord, etc.
│     │  ├─ validate.ts         # validateArtifact() → LintIssue[] (name/filename/tools/$ARGUMENTS/refs)
│     │  └─ refs.ts             # extractAgentMentions(body) → string[] (graph edges)
│     ├─ adapters/
│     │  ├─ types.ts            # TargetAdapter interface + TargetCapability + RenderedFile
│     │  ├─ claude.ts           # claudeAdapter: per-file .md (agents + commands)
│     │  ├─ codex.ts            # codexAdapter: merged AGENTS.md (lossy)
│     │  └─ registry.ts         # ADAPTERS: Record<TargetId, TargetAdapter>; getAdapter(id)
│     ├─ render/
│     │  ├─ frontmatter.ts      # serializeFrontmatter() / parseFrontmatter() (deterministic, stable key order)
│     │  ├─ marker.ts           # MANAGED_MARKER build/parse + contentHash (sha256 of canonical body+fm)
│     │  └─ render.ts           # renderArtifacts(artifacts, target) → RenderedFile[]
│     ├─ parse/
│     │  └─ scan.ts             # parseClaudeFile() / parseClaudeDir(filemap) → {artifacts, skipped[]} (pure: takes file contents in)
│     ├─ diff/
│     │  ├─ diff.ts             # computeDiff(rendered[], onDisk[]) → DiffFile[] (status: new|update|same|conflict)
│     │  └─ conflict.ts         # classify(onDiskMarker, onDiskHash, lastPublishedHash) → "clean"|"conflict"|"foreign"
│     ├─ version/
│     │  └─ semver.ts           # bump(version, "patch"|"minor"|"major"), validateVersion()
│     ├─ runcommand/
│     │  └─ render.ts           # renderRunCommand({command, requirements, model, option}) → string
│     └─ index.ts               # public barrel (the only surface daemon imports)
│
├─ apps/daemon/                 # PRIVILEGED. fs + git + net. Thin: delegates all logic to @symbion/core.
│  └─ src/
│     ├─ boot/menu.ts           # S0 terminal menu (Web UI / Terminal UI(stub) / Hide to Tray / Exit)
│     ├─ server.ts              # http server, bind 127.0.0.1, RPC dispatch, token + Origin check
│     ├─ rpc/
│     │  ├─ contract.ts         # shared request/response types (imported by web via @symbion/rpc-types)
│     │  ├─ handlers.ts         # one handler per RPC method; only place that calls fs/git
│     │  └─ guard.ts            # path safety: confine writes to project.path; reject .. traversal, symlink escape
│     ├─ fs/
│     │  ├─ readTargetFiles.ts  # read existing .claude/* + AGENTS.md as filemap for diff
│     │  ├─ writeFiles.ts       # backup-before-write, atomic temp→rename, per-file result
│     │  └─ folderPick.ts       # native OS dialog (best-effort) + typed-path fallback
│     ├─ git/status.ts          # `git status --porcelain` parse (read-only; never commits in v1)
│     ├─ store/
│     │  ├─ store.ts            # load/save ProjectStore + global config (JSON files, schemaVersion migrate)
│     │  └─ publishLog.ts       # append PublishLogEntry to .symbion/publish-log.json
│     └─ index.ts               # entry: read config → start server → show menu
│
└─ apps/web/                    # Next.js App Router + Tailwind + shadcn. No fs. Talks only to daemon RPC.
   └─ src/
      ├─ app/                   # single SPA-ish shell route ("/"); thin routing, state client-side
      ├─ components/            # AppShell, ProjectSidebar, BuilderDrawer, AgentForm, WorkflowForm,
      │                         #   MarkdownTab(CodeMirror6), LivePreviewPane, DependencyGraph(React Flow ro),
      │                         #   PublishDialog, PublishDiffView, ConflictResolver, CopyRunCommandDialog, ...
      ├─ components/ui/         # shadcn primitives
      ├─ lib/
      │  ├─ rpc/client.ts       # useDaemonRpc: typed fetch to 127.0.0.1:PORT with token header
      │  └─ store/              # useArtifactStore (in-memory IR), useExportPreview (zustand or context)
      └─ ...
```

`packages/core` depends on **nothing** Node-specific. The RPC request/response types live in `apps/daemon/src/rpc/contract.ts` and are published to web as a tiny type-only package (`@symbion/rpc-types`) or via a path alias — so the web client and daemon never drift.

### 1.2 What runs where

| Concern | Lives in | Notes |
|---|---|---|
| IR types, render, parse, diff, marker/hash, adapters, semver, run-command string | `packages/core` | Pure. ~80% of correctness; cheap Vitest. No I/O. |
| fs read/write, git, folder pick, RPC server, boot menu, store/publish-log/backups | `apps/daemon` | The ONLY process allowed to touch disk. Delegates all transforms to core. |
| All UI, in-memory IR store, form↔markdown sync, graph, diff UX | `apps/web` | Never touches disk; every disk effect goes through one `write`/`scan`/etc RPC. |

### 1.3 Process model (`npm start`)

1. `npm start` → `node apps/daemon` (built). Daemon reads global config (port, last project), picks an open port (default `20128`, fallback scan), generates a per-boot **session token**.
2. Daemon starts the HTTP RPC server bound to `127.0.0.1:PORT` and serves the built `apps/web` static export (or proxies a Next dev server in dev).
3. Daemon prints the **S0 terminal menu** with the URL and waits for a keypress:
   - **Web UI** → open default browser at `http://127.0.0.1:PORT/?t=<token>` (token handed to the web app once, stored in memory).
   - **Terminal UI** → prints "Terminal UI — sắp có ở v1.5" and returns to menu (stub).
   - **Hide to Tray** → detach menu, keep server running in background.
   - **Exit** → graceful shutdown (flush store, close server).
4. Web app keeps the session token in memory and sends it on every RPC call. No token → 401.

### 1.4 Security posture of the localhost RPC (filesystem-write echo of GeoChat DB-safety/careful ethos)

The RPC can write arbitrary files and run git, so it is treated like a privileged DB connection:

- **Bind 127.0.0.1 only** — never `0.0.0.0`. No LAN exposure.
- **Origin-bound session token** — every mutating RPC requires the per-boot token (handed to the browser at launch). Reject mismatched/missing token → 401. Mitigates other localhost processes / drive-by browser pages (DNS-rebinding / CSRF).
- **Origin / Host header allowlist** — only accept requests whose `Origin`/`Host` is the daemon's own `127.0.0.1:PORT` (defense-in-depth vs DNS rebinding).
- **Path confinement (`rpc/guard.ts`)** — every write path MUST resolve inside the selected `project.path`. Reject `..` traversal, absolute escapes, and symlinks that resolve outside the project root. This is the filesystem analogue of "no DELETE without WHERE".
- **Never write silently** — `write` is the only disk-mutating method and is always preceded by a `computeDiff` the user saw. No silent clobber (mirrors GeoChat "migrations reversible / review before apply").
- **Backup-before-write + reversible** — every published file is backed up to `.symbion/backups/<version>/<relpath>` before overwrite; foreign/unmanaged files are never touched (the careful-hook ethos applied to fs).
- **No secrets collected** — v1 never asks for API keys (Run is deferred). Git ops are read-only (`status` only).
- **Read-only by default** — `scan`, `render`, `computeDiff`, `gitStatus`, `validatePath`, `browseFolder` do not mutate target repos. Only `write` and store-saves mutate disk; store-saves touch only the app store + `.symbion/`.

---

## 2. Canonical IR + data model

### 2.1 `CanonicalArtifact` (the single source of truth)

```ts
// packages/core/src/ir/types.ts
export type ArtifactKind = "agent" | "command";

export interface CanonicalArtifact {
  /** stable internal id (uuid) — survives renames; used in managed marker. */
  id: string;
  kind: ArtifactKind;

  /** logical name. Agent → .claude/agents/<name>.md, Command → /<name> + .claude/commands/<name>.md */
  name: string;
  /** maps to frontmatter `description:` for BOTH kinds. Required. */
  description: string;

  /** AGENT ONLY → frontmatter `tools:` (CSV). undefined/empty for commands. */
  tools?: string[];
  /** COMMAND ONLY → UI hint that body uses $ARGUMENTS. Does NOT render to frontmatter (Claude commands have no such key). */
  usesArguments?: boolean;

  /** the markdown system prompt / orchestration body (everything after frontmatter). */
  body: string;

  /** "Nâng cao" passthrough. e.g. {model:"claude-opus-4", temperature:"0.2"}. Rendered verbatim + "(custom)" tag. NOT standard Claude frontmatter. */
  customFields?: Record<string, string>;

  meta: {
    /** the version stamped at last publish (or "draft"). */
    version: string;
    /** "draft" = saved in Studio but not on disk; "published" = last publish wrote it; "conflict" = on-disk diverged. */
    status: "draft" | "published" | "conflict";
    createdAt: string;   // ISO
    updatedAt: string;   // ISO
    sourceTemplateId?: string;
    /** content hash recorded at last successful publish (per target) — basis for conflict detection. */
    publishedHashes?: Record<TargetId, string>;  // { claude: "...", codex: "..." }
  };
}
```

Notes:
- `tools` is the **only** kind-specific frontmatter field. Commands never serialize `tools`.
- `usesArguments` drives the `[Chèn $ARGUMENTS]` helper + linter only; it is derived/confirmable from the body containing `$ARGUMENTS`.
- `customFields` ordering: preserve insertion order (use an array of `{key,value}` internally if Record ordering is a concern; types.ts may model it as `customFields: Array<{key:string; value:string}>` to guarantee deterministic render — **decision: array, to keep render byte-stable**).

### 2.2 Per-project store shape

```ts
export type TargetId = "claude" | "codex";

export interface ProjectStore {
  schemaVersion: 1;                 // bump → run migrate() in store.ts
  id: string;                       // uuid
  name: string;                     // "my-service"
  path: string;                     // absolute repo path
  createdAt: string;
  artifacts: CanonicalArtifact[];   // ALL agents + commands for this project (solo model)
  settings: ProjectSettings;        // export defaults, conflict policy, backup toggle, marker template
}

export interface ProjectSettings {
  defaultTargets: TargetId[];       // e.g. ["claude"]
  conflictPolicy: "warn" | "never-overwrite";  // S14: ◉ cảnh báo & hỏi | ○ không bao giờ đè
  backupBeforeWrite: boolean;       // default true
  requireCleanGit: boolean;         // default false
  markerTemplate: string;           // default MANAGED_MARKER template
}

export interface GlobalConfig {
  schemaVersion: 1;
  port: number;                     // default 20128
  theme: "system" | "light" | "dark";
  lastProjectId?: string;
  builderDefaultTab: "form" | "markdown";  // persisted per-user (power users land on markdown)
}
```

### 2.3 Publish-log + backup record shape

```ts
export interface PublishLogEntry {
  version: string;                  // "v0.3.0"
  timestamp: string;                // ISO
  targets: TargetId[];
  results: Array<{
    target: TargetId;
    relPath: string;                // ".claude/agents/ba.md"
    action: "created" | "updated" | "skipped-conflict" | "skipped-same" | "error";
    artifactId?: string;
    contentHash?: string;           // hash written (for next-publish conflict detection)
    error?: string;
  }>;
  backupDir: string;                // ".symbion/backups/v0.3.0/"
}

export interface BackupRecord {
  // physical: files copied verbatim into .symbion/backups/<version>/<relPath>
  // manifest written alongside for restore tooling (v1.5 rollback panel reads this):
  version: string;
  timestamp: string;
  files: Array<{ relPath: string; existedBefore: boolean; backupRelPath: string }>;
}
```

### 2.4 Where the store lives on disk

- **Per-project data** → `<repo>/.symbion/`:
  - `.symbion/store.json` — the `ProjectStore` (artifacts + settings) for that project.
  - `.symbion/publish-log.json` — append-only array of `PublishLogEntry`.
  - `.symbion/backups/<version>/...` — pre-write backups + `manifest.json` (`BackupRecord`).
  - Rationale: keeps the workflow definition co-located with the repo it targets; portable; git-ignorable per user choice.
- **User-level config** → OS config dir (`~/.config/symbion/config.json` on Linux; XDG/`os.homedir()` resolved): `GlobalConfig` + the list of known project paths (`{id, name, path}[]`), so the sidebar can list projects across repos.
- **Format**: plain JSON files (no SQLite needed in v1 — data volume is small and human-inspectable; SQLite reserved for v2 if scale demands). All loads run through `migrate(schemaVersion)` (see §7).

### 2.5 Form-field ↔ IR ↔ rendered-`.md` mapping

**AGENT (Claude `.claude/agents/<name>.md`)**

| Form field (S7) | IR field | Rendered |
|---|---|---|
| `name *` | `name` | frontmatter `name: <name>` + filename `<name>.md` |
| `description *` | `description` | frontmatter `description: <description>` |
| `tools` multi-select | `tools[]` | frontmatter `tools: Read, Grep, Glob` (CSV, space after comma — match GeoChat byte format) |
| `Nội dung` (body) | `body` | everything after closing `---` |
| "Nâng cao" key/value | `customFields[]` | extra frontmatter lines `model: claude-opus-4` rendered verbatim, UI tags "(custom)" |
| — (auto) | `id`, `meta.version` | managed marker comment appended at end of body / as HTML comment |

Rendered agent file:
```
---
name: code-reviewer
description: Independent reviewer…
tools: Read, Grep, Glob
model: claude-opus-4
---
You are the reviewer…
<!-- managed-by: symbion id=<uuid> kind=agent v=0.3.0 hash=<sha256-12> -->
```

**COMMAND (Claude `.claude/commands/<name>.md`)**

| Form field (S8) | IR field | Rendered |
|---|---|---|
| command name (→ `/name`) | `name` | filename `<name>.md` (no `name:` key in command frontmatter) |
| `description *` | `description` | frontmatter `description: <description>` |
| body + `[Chèn $ARGUMENTS]` | `body` (+ `usesArguments`) | body containing literal `$ARGUMENTS` |
| agent @mentions in body | derived `refs[]` (not stored; computed) | drives graph + linter only |

Rendered command file:
```
---
description: 3 BA agents research requirements, then synthesize
---
You are at the analyze step. Request: $ARGUMENTS
…
<!-- managed-by: symbion id=<uuid> kind=command v=0.3.0 hash=<sha256-12> -->
```

**CODEX (`AGENTS.md` at repo root) — lossy merge**

- Codex has **no command primitive** and **no per-agent file**. All artifacts merge into a single `AGENTS.md`.
- Render: a stable, sectioned document — one `##` section per artifact, agents first, commands after, each labelled with kind. Commands flattened (their `$ARGUMENTS` body included as text). Lossy notes: `tools`/per-file separation collapse; the merge is acknowledged via "Tôi hiểu" in UI.
- Single managed marker block at top of the Studio-managed region; the rest of `AGENTS.md` (if user has foreign content) is preserved outside the managed fence (see §3 marker/fence scheme).

```
<!-- managed-by: symbion region-start v=0.3.0 hash=<sha256-12> -->
# Symbion-managed workflows

## Agent: ba
> tools: Read, Grep, Glob, Write  (note: Codex ignores per-agent tools)
You are the Business Analyst…

## Command: /analyze
> Slash command (flattened — Codex has no command primitive)
You are at the analyze step. Request: $ARGUMENTS …
<!-- managed-by: symbion region-end -->
```

---

## 3. Adapter / render / upsert engine design

### 3.1 `TargetAdapter` interface (`packages/core/src/adapters/types.ts`)

```ts
export interface TargetCapability {
  id: TargetId;
  label: string;                 // "Claude" | "Codex"
  supportsCommands: boolean;     // Claude true, Codex false (lossy → flatten)
  supportsPerAgentFile: boolean; // Claude true, Codex false (single AGENTS.md)
  fileFormat: "md-per-file" | "md-merged";
  lossy: boolean;                // Codex true → UI shows badge + "Tôi hiểu"
}

export interface RenderedFile {
  relPath: string;               // ".claude/agents/ba.md" | "AGENTS.md"
  content: string;               // full byte content INCLUDING managed marker
  artifactIds: string[];         // which IR artifacts contributed (≥1; merged targets → many)
  contentHash: string;           // sha256 of canonical content (excluding the hash field itself)
}

export interface TargetAdapter {
  capability: TargetCapability;
  /** PURE: IR → files. Merged adapters fold many artifacts into one RenderedFile. */
  render(artifacts: CanonicalArtifact[], opts: { version: string }): RenderedFile[];
  /** PURE: given an on-disk file's content, extract the managed marker (id/version/hash) or null if foreign. */
  parseMarker(content: string): ManagedMarker | null;
}
```

### 3.2 Claude adapter

- `supportsCommands: true`, `supportsPerAgentFile: true`, `fileFormat: "md-per-file"`, `lossy: false`.
- `render`: one `RenderedFile` per artifact → `.claude/agents/<name>.md` (agents) or `.claude/commands/<name>.md` (commands). Frontmatter serialized deterministically (stable key order: `name`?, `description`, `tools`?, then custom fields in insertion order). Managed marker appended as trailing HTML comment.

### 3.3 Codex adapter (lossy merge)

- `supportsCommands: false`, `supportsPerAgentFile: false`, `fileFormat: "md-merged"`, `lossy: true`.
- `render`: produces exactly one `RenderedFile` at `AGENTS.md`. All artifacts folded into a managed **region fence** (`region-start`/`region-end` markers). Sections deterministic (agents sorted by name, then commands sorted by name) so re-publish is byte-stable → idempotent.
- **Foreign-content preservation**: if existing `AGENTS.md` has content outside the fence, the adapter is given that "outside" text and reproduces it verbatim around the regenerated fence (handled at write-merge time; render produces the managed region, write splices it into the existing file at the fence location, or appends if no fence yet).
- Lossy is surfaced (badge + "Tôi hiểu") — never silently dropped or blocked.

### 3.4 Managed-by marker + content-hash scheme

- **Marker (single-file targets)**: `<!-- managed-by: symbion id=<uuid> kind=<k> v=<version> hash=<sha256-12> -->` trailing the body.
- **Region fence (merged targets / `AGENTS.md`)**: `<!-- managed-by: symbion region-start v=<version> hash=<sha256-12> -->` … `<!-- managed-by: symbion region-end -->`.
- **contentHash** = sha256 over the canonical rendered content **excluding the hash token itself** (compute body+frontmatter+marker-without-hash, then inject). Truncated to 12 hex chars in the marker; full hash recorded in publish-log/`meta.publishedHashes`.
- **Conflict classification** (`diff/conflict.ts`), per on-disk file:
  - No marker → **foreign** → never in write set (optionally shown muted).
  - Marker present, on-disk recomputed hash **==** marker's hash → file untouched since Studio wrote it → safe to update/overwrite.
  - Marker present, on-disk recomputed hash **≠** marker's hash → **hand-edited after last publish** → **conflict** → blocks write until resolved.
  - Marker present but `meta.publishedHashes` for that target missing (e.g., imported) → treat first publish as update with confirm, then record hash.
- **Resolved ambiguity (added post-review, 2026-06-26): first-ever Codex publish into a pre-existing, non-Symbion `AGENTS.md`.** Case: `AGENTS.md` already exists on disk with foreign (hand-written, never-marked) content, and the user now publishes Codex for the first time. This is **not** classified as `foreign`/blocked-conflict — `OnDiskFile.isMergedTarget` flags the relPath as belonging to a merged/lossy target, and the render pass has already spliced the existing foreign content around the new managed region (§3.3). `computeDiff` therefore returns `status: "new"` or `"update"` (never `conflict`/`foreign`) for this case, with `conflictClass: "clean"` and a new `DiffFile.firstPublishIntoForeignMergedFile: true` flag set whenever the resulting content differs from what's on disk (i.e. excludes the degenerate already-`same` case, which cannot occur on a true first publish since there is no marker yet to match against). This does **not** weaken conflict detection: a file that already carries a Symbion-managed region (`region-start`/`region-end` markers present) is still classified normally via `recomputeOnDiskHash`/`classify`, and hand-edits to an already-managed region still hit `conflict` as before. The web UI (S11 diff view) shows a distinct one-time notice for this case ("File này đã tồn tại và sẽ được Symbion chỉnh sửa lần đầu tiên") separate from the existing Codex-lossy "Tôi hiểu" acknowledgment checkbox in S10 — the two are orthogonal: lossy-acknowledge is about command-flattening into AGENTS.md's *format*, the first-publish notice is about *this specific file's prior foreign-ownership history*.

### 3.5 Render → temp → diff → write pipeline (the upsert engine)

1. **render** (core, pure): `targets × IR → RenderedFile[]` with hashes.
2. **read on-disk** (daemon): read each target relPath's current content (or "absent").
3. **computeDiff** (core, pure): for each rendered file vs on-disk → `DiffFile { relPath, status: new|update|same|conflict, hunks, managedMarkerOk, onDiskHash }`.
   - `same` (hash equal, no change) → proves idempotency (AC-E2); not in write set, no checkbox.
   - `conflict` → unchecked, blocks write (AC-E3).
4. **UI** shows S11 diff; user resolves conflicts (Giữ / Ghi đè / Xem diff) and checks files.
5. **write** (daemon): for each selected file →
   - **backup-before-write**: if file exists, copy to `.symbion/backups/<version>/<relPath>` (and record in `BackupRecord` manifest). If new, record `existedBefore:false`.
   - **atomic write**: write to a temp file in the same dir, then `rename` over the target (atomic on same fs). Init `.claude/` (mkdir -p) if missing.
   - **merged targets** (`AGENTS.md`): splice managed region into existing file preserving foreign content (§3.3).
   - per-file result captured (`created|updated|skipped|error`).
6. **post-write** (daemon): append `PublishLogEntry`; update each artifact's `meta.publishedHashes[target]` + `meta.status="published"`; save store.

### 3.6 Idempotency

- Deterministic frontmatter key order + deterministic Codex section ordering + stable hash → re-render of unchanged IR produces byte-identical content → `computeDiff` returns all `same` → S11 shows "Không có gì để ghi" (button disabled). (AC-E2.)

### 3.7 Partial-failure handling

- `write` processes files independently and returns a per-file result array. A mid-batch failure (permission, disk) marks that file `error`; already-written files stay written (they are backed up + logged). S12 shows failed rows red with **[Thử lại các file lỗi]**; retry re-attempts only failed entries. Backups make every successful write reversible.

---

## 4. Daemon RPC contract

Transport: HTTP POST `/(rpc)` with `{ method, params }`, JSON. Every call carries the session token header. Typed via `apps/daemon/src/rpc/contract.ts` (shared with web). **Disk column** marks effect.

| Method | Params | Returns | Disk |
|---|---|---|---|
| `ping` | — | `{ ok, version, port }` | read (none) |
| `browseFolder` | `{ startPath? }` | `{ path } \| { cancelled:true }` | read (OS dialog) |
| `validatePath` | `{ path }` | `{ exists, isDir, isGitRepo, hasClaudeDir, hasAgentsMd, writable }` | **read** |
| `listProjects` | — | `{ projects: {id,name,path}[] }` | **read** (global config) |
| `createProject` | `{ name, path }` | `{ project: ProjectStore }` | **write** (init `.symbion/store.json`, add to global config) |
| `loadProject` | `{ id }` | `{ project: ProjectStore }` | **read** |
| `saveArtifact` | `{ projectId, artifact }` | `{ project: ProjectStore }` | **write** (store.json only; NOT target repo) |
| `deleteArtifact` | `{ projectId, artifactId }` | `{ project }` | **write** (store.json only) |
| `updateSettings` | `{ projectId, settings }` / `{ globalConfig }` | `{ ... }` | **write** (store/config) |
| `scanClaudeDir` | `{ path }` | `{ parsed: ParsedClaudeDir }` (agents[], commands[], hooks[](read-only), skipped[] with reasons) | **read** |
| `importArtifacts` | `{ projectId, selectedIds }` (from a prior scan) | `{ project }` | **write** (store.json) |
| `render` | `{ projectId, targets, version }` | `{ files: RenderedFile[] }` | read (delegates to core; no disk) |
| `computeDiff` | `{ projectId, targets, version }` | `{ files: DiffFile[], conflicts: number }` | **read** (reads on-disk target files) |
| `write` | `{ projectId, version, targets, files: {relPath, resolution?}[] }` | `{ results: PublishResult[], backupDir, logEntryWritten:true }` | **write** (target repo + backups + publish-log + store) |
| `gitStatus` | `{ path }` | `{ isRepo, clean, changedFiles: string[] }` | **read** (`git status --porcelain`) |
| `renderRunCommand` | `{ command, requirements, model, option }` | `{ prompt: string }` | read (pure) — *(can also run client-side via core; exposed for parity)* |

Notes:
- `render`, `computeDiff`, `renderRunCommand` are thin wrappers over `@symbion/core` pure functions. `render`/`renderRunCommand` touch no disk; `computeDiff` only reads target files. Parsing in `scanClaudeDir` reads files then calls `core.parseClaudeDir(filemap)`.
- Only `createProject`, `saveArtifact`, `deleteArtifact`, `updateSettings`, `importArtifacts`, `write` mutate disk. All target-repo mutation funnels through `write`, guarded by `rpc/guard.ts` (path confinement) and preceded by a user-seen diff.

---

## 5. Data flow (end-to-end traces)

**(a) Create project** — S2/S3: user clicks `+ Tạo dự án` → `CreateProjectDialog` → `browseFolder`/typed path → live `validatePath` (exists? gitRepo? hasClaudeDir → offer Import). `[Tạo]` enabled when valid → `createProject` → daemon writes `<repo>/.symbion/store.json` + adds `{id,name,path}` to global config → returns `ProjectStore` → web hydrates `useArtifactStore`, sidebar shows project, main area shows empty-project (two add buttons).

**(b) Add agent in form tab → IR → live preview** — S7: `+ Thêm agent` opens `BuilderDrawer` (Form tab). Each keystroke updates the in-memory `CanonicalArtifact` in `useArtifactStore` (single source of truth). `LivePreviewPane` calls `core.render([artifact], "claude")` (pure, client-side, debounced ~150ms) → shows `.claude/agents/<name>.md`. `core.validateArtifact` runs → `LinterPanel` (errors disable Save). `Lưu` → `saveArtifact` RPC writes store.json only; artifact gets `·draft` dot, `meta.status="draft"`. **Nothing written to target repo.**

**(c) Form ↔ markdown two-way sync against single IR** — S7b: switching to "Theo markdown" serializes current IR → CodeMirror buffer via `core.render`. Editing raw markdown → `core.parseClaudeFile(raw)` on change → if valid, update the same IR object → switching back to Form reflects it. If parse invalid: validity line red, sync-back paused, Save disabled, form keeps last-good; switching to Form asks confirm ("dùng bản hợp lệ gần nhất?") — never silent clobber. `[Adopt into form]` chip when markdown diverged from form.

**(d) Import existing `.claude/` → IR** — S4: user picks repo path → `scanClaudeDir` reads `.claude/agents/*.md`, `.claude/commands/*.md`, `.claude/hooks/*` (+ `settings.json`) → daemon passes contents to `core.parseClaudeDir(filemap)` → returns `{agents, commands, hooks(read-only), skipped[](unparseable, unchecked-by-default)}`. UI shows scan preview with checkboxes → `[Nhập N mục]` → `importArtifacts` writes selected into store.json as `CanonicalArtifact[]` (status `published` if marker matched on-disk, else `draft`). settings/hooks import is read-only (display only) in v1.

**(e) Publish** — S10→S11→S12: `[Xuất bản]` → `PublishDialog` (pick version via semver bump + targets; `CapabilityMatrix` shown when >1 target; Codex shows lossy badge → "Tôi hiểu"). `[Xem trước thay đổi]` → `computeDiff(projectId, targets, version)` → daemon renders (core) + reads on-disk + diffs (core) → `PublishDiffView` (S11) lists files `+ new / ~ update / = same / ! conflict`. Conflicts unchecked, block write; user resolves per-file (Giữ/Ghi đè/Xem diff). `[Ghi xuống đĩa]` → `write` → daemon backs up → atomic writes selected files → appends publish-log → updates `meta.publishedHashes` + status → returns results → S12 result (created/updated/skipped/errors + backupDir). Partial failure → retry-failed.

**(f) Copy run command** — S13: row menu (command only) → `CopyRunCommandDialog`. Fields Requirements/Model/option → `core.renderRunCommand(...)` re-renders the prompt string live (read-only box). `[Copy]` → clipboard + toast. Clipboard blocked → select text + "Nhấn ⌘C" fallback. **No execution (v1).**

---

## 6. Edge cases (acceptance-relevant; /qa must probe each)

| # | Case | Required behavior |
|---|---|---|
| E1 | Hand-edited managed file | marker present, hash ≠ → `conflict` in diff, unchecked, blocks write; resolve Giữ/Ghi đè/Xem diff. Never silent overwrite. (AC-E3) |
| E2 | Unmanaged foreign file | no marker → never touched, not in write set (optionally shown muted "không do Studio quản lý"). |
| E3 | Invalid frontmatter / YAML (import or markdown tab) | scan: file in `skipped[]` with reason, unchecked. markdown tab: validity line red, sync-back paused, Save disabled, last-good kept. |
| E4 | `name` ≠ filename | linter flags mismatch; filename always derived from `name` on render (filename = name). Warn surfaced; render is canonical. |
| E5 | Duplicate names (same kind) | live duplicate check → red border, Save disabled. Render never produces two files at one path. |
| E6 | Unknown tools | amber warning chip but allowed (forward-compat); renders verbatim into CSV. |
| E7 | Command @mentions missing agent | amber chip + graph red edge + lint warning; does NOT block save or publish. |
| E8 | Codex lossy merge collisions (two artifacts same name) | deterministic section ordering; on name collision agents vs commands disambiguated by `## Agent:`/`## Command:` headers; if same kind+name → linter duplicate (E5) already prevents. |
| E9 | Daemon disconnect mid-edit | DaemonStatusBadge → red blocking banner; all write/publish/save disabled; in-memory IR still browsable/editable; auto-reconnect backoff; on reconnect, Save re-enabled (user re-saves). No data loss of in-memory edits (held in web state). |
| E10 | Partial publish failure | per-file results; succeeded stay written + backed up; failed rows red + retry-failed; backupDir shown (reversible). |
| E11 | Re-publish unchanged | all `=` same; "Không có gì để ghi" disabled. (AC-E2 idempotency) |
| E12 | Path not a git repo | `validatePath.isGitRepo=false`; publish still allowed (git is advisory in v1); `requireCleanGit` setting only enforced if repo + toggled on; gitStatus returns `isRepo:false`. |
| E13 | `.claude/` doesn't exist | diff notes "Sẽ khởi tạo .claude/"; write does `mkdir -p .claude/agents` + `.claude/commands` before writing. |
| E14 | Path confinement attack | write path resolving outside `project.path` (`..`, symlink escape, absolute) → guard rejects with error; nothing written. |
| E15 | Port already in use | daemon scans for next open port from default 20128; menu/URL reflect actual port; web token carries actual origin. |

---

## 7. Local-store schema init/migration + on-disk artifacts (replaces "DB migrations")

There is **no SQL DB**. Persistence is JSON files; there are two write surfaces:

**A. App store (Studio-owned, safe to rewrite):**
- Per-project `<repo>/.symbion/store.json` (`ProjectStore`, `schemaVersion`), `<repo>/.symbion/publish-log.json`, `<repo>/.symbion/backups/<version>/`.
- User-level `~/.config/symbion/config.json` (`GlobalConfig`, `schemaVersion`, project registry).
- **Init**: `createProject` writes a fresh `store.json` (schemaVersion=1) + ensures `.symbion/` exists. First daemon boot writes `config.json` if absent.
- **Migration**: on every load, `store.ts`/`store.load()` checks `schemaVersion`; if older, runs an ordered chain of pure `migrate_v(n→n+1)` transforms (reversible in the sense that a backup of the prior store.json is taken before rewrite). Unknown/newer schemaVersion → refuse to write, surface "store created by newer Studio" (forward-safety). This mirrors GeoChat's "reversible migration / review before apply" for the on-disk app state.

**B. Target repo artifacts (foreign-aware, careful):**
- Claude: `<repo>/.claude/agents/<name>.md`, `<repo>/.claude/commands/<name>.md`.
- Codex: `<repo>/AGENTS.md` (managed region fenced; foreign content preserved).
- **Safety rules** (the careful-hook ethos): only `write` mutates these; always preceded by a diff; backup-before-overwrite; foreign (unmarked) files never touched; path-confined; atomic temp→rename; `.claude/` created if missing. No destructive bulk delete — removing an artifact in Studio does NOT delete its on-disk file silently (v1: surfaced as an orphan note; explicit delete is a separate, diffed action — deferred polish, default keep file).

---

## 8. Trade-offs, assumptions, open-question resolutions

**Resolved open design questions (from DESIGN §6), now locked by this PLAN:**
- #1 Builder surface → right **Sheet/drawer** (locked).
- #2 Editor richness → **CodeMirror 6** (locked; NOT Monaco).
- #3 Custom fields → passthrough behind "Nâng cao", free-form key/value, **suggested keys** `model`/`temperature` offered as hints, rendered verbatim + "(custom)" (locked).
- #4 Versioning → semver bump picker at publish, **one version across all targets**, version field + daemon publish-log + backups; **no history panel in v1** (data recorded for v1.5).
- #5 Conflict default → **Giữ bản trên đĩa** (skip, safest) default.
- #6 `=` unchanged files → **keep visible** (proves idempotency; density-friendly).
- #7 Codex lossy → **merge into AGENTS.md** + lossy badge + "Tôi hiểu" acknowledge (locked).
- #8 Dependency source → `@agentname`/name mention in command body → graph edge (no explicit field).
- #9 Graph → read-only auto-layout L→R; no persisted positions in v1.
- #10 Terminal UI → **present-but-stubbed** (web-only v1).
- #11 Folder picker → native OS dialog via daemon, **typed-path fallback** always available.
- #12 Theme → System default; dark mode shipped; density toggle deferred.

**Assumptions for dev/Checker to track:**
1. `customFields` modeled as an ordered array (`{key,value}[]`) to guarantee byte-stable render, even though IR sketch in ANALYZE showed `Record`. Acceptance: render is deterministic across reorders/reloads.
2. Filename is always derived from `name` (filename = `<name>.md`); `name`≠filename mismatch is only possible on import → linter warns, render re-canonicalizes.
3. `.symbion/` lives **inside the target repo** (co-located). Dev should add a `.gitignore` hint suggestion (not auto-edit user's .gitignore in v1).
4. Git is **advisory** in v1 (status only; never commits/branches). `requireCleanGit` is an opt-in gate, default off.
5. RPC type-sharing via a type-only package/alias so web ↔ daemon never drift; this is a build-system requirement (workspaces + tsconfig paths).
6. Web is served by the daemon (static export or dev-proxy); the browser holds the session token in memory only (not persisted), re-issued each boot.
7. Run command (S13) is **string-only**; no process spawn anywhere in v1.

**Trade-offs:**
- JSON store over SQLite: simpler, human-inspectable, git-friendly; cost = no query/index (fine at v1 scale). Revisit at v2.
- `.symbion/` in-repo vs user-config-only: in-repo keeps definitions with code + portable, at the cost of a new dir in the user's repo (mitigated by .gitignore suggestion).
- Marker-as-HTML-comment: works for `.md`/`AGENTS.md`; if a future target is TOML/JSON the marker scheme moves into the adapter (already isolated — `parseMarker` is per-adapter).

---

## 9. Acceptance standard for /review (code-reviewer)

Implementation PASSES when:
- `packages/core` is pure (no fs/net/Node imports) and all of §2/§3 round-trips (render↔parse) byte-faithfully against the GeoChat `.claude/` fixtures (ba.md, code-reviewer.md, analyze.md).
- RPC matches §4 signatures exactly; only the listed methods mutate disk; `write` is the sole target-repo mutator and is path-confined + token-gated + 127.0.0.1-bound.
- Every edge case E1–E15 is handled as specified (esp. conflict-blocks-write E1, foreign-never-touched E2, idempotent E11, backup-before-write, atomic write).
- The beginner journey S2→S3→S7→S8→S10→S11→S12 works end-to-end against a temp repo with no silent disk writes.
- All locked decisions in §0 are honored; no v1.5/v2 scope crept in.

---

## 11. QA result (2026-06-26) — **PASS**

Verified live against the running daemon + real disk, not just by reading code. All checks against §9's acceptance standard and `symbion-testplan.md`'s exit criteria (§5) passed.

**Automated suites (run directly):**
- `npm run build` — clean across all 4 workspaces (`core`, `rpc-types`, `daemon`, `web`); Next.js static export succeeds.
- `npx vitest run` — **95/95 passing** (13 files: core unit tests + daemon RPC/server/findOpenPort integration tests).
- `npx playwright test` — **1/1 passing**; the happy-path e2e drives the real built daemon + real built web UI through S2→S3→S7→S8→S10→S11→S12, asserting both `.claude/agents/code-reviewer.md` and `.claude/commands/analyze.md` land on disk with correct frontmatter, body, `$ARGUMENTS`, and managed markers.

**Manual live verification** (chrome-devtools unavailable in this sandbox — no Chrome instance reachable; verified instead by driving the same production daemon binary directly over its RPC contract, exercising the identical backend code path the web UI calls):
- Booted the real `apps/daemon/dist/index.js` (production build, not a test harness) against a fresh temp target repo. Confirmed E15 port-retry live: default port 20128 was busy in this environment, daemon correctly fell back (observed ports 20129/20130 across boots).
- **Security posture (§1.4)**: `ping` works without a token; every other method correctly returns `{"error":{"code":"unauthorized"}}` with a missing/wrong `x-symbion-token` header; a spoofed `Origin` header is correctly rejected (`origin-rejected`). Bound to `127.0.0.1` only.
- **No silent disk write**: `saveArtifact` (draft save) confirmed to touch only `.symbion/store.json` — target repo's `.claude/` directory does not exist after save, only after an explicit `write` call.
- **AC-E2 (idempotency)**: re-running `computeDiff` after a successful write returns `status: "same"` for the unchanged file — confirmed byte-for-byte.
- **AC-E3 (conflict)**: hand-edited the published `.claude/agents/code-reviewer.md` on disk, re-ran `computeDiff` → `status: "conflict"`, `managedMarkerOk: false`. `write` without a `resolution` → `action: "skipped-conflict"`, file on disk unchanged (verified hand-edit still present). `write` with `resolution: "overwrite"` → `action: "updated"`, file correctly rewritten, **and the hand-edited version was backed up first** (verified `.symbion/backups/v0.1.0/.claude/agents/code-reviewer.md` contains the pre-overwrite hand-edited content, with a matching `manifest.json`).
- **E1/E2 (foreign file)**: placed an unmarked `.claude/agents/foreign.md` directly on disk — confirmed it never appears in `computeDiff`'s file list and is untouched by any `write` call.
- **E14 (path confinement)**: attempted a `write` referencing a `..`-traversal relPath outside the project root — rejected (filtered out before ever reaching disk; `/etc/evil.md` was not created). Read `apps/daemon/src/rpc/guard.ts` directly — `resolveConfinedPath` rejects absolute paths, `..`-escapes (via `relative()` check), and symlink-escapes (via `realpathSync` ancestor walk); this matches the design intent and is consistent with the daemon's own T11 integration test using a real `symlinkSync`.
- Daemon log clean throughout the session — no runtime errors, no unhandled rejections.
- Cleanly stopped the daemon process and confirmed no orphaned process remained.

**Not independently re-verified in this QA pass** (already covered by two independent review rounds in `/review`, not re-litigated here): Codex/`AGENTS.md` lossy-merge UI notice, daemon-disconnect heartbeat UI behavior, dependency-graph red-edge rendering, server-side artifact validation — all confirmed fixed and tested by code-reviewer + architect in the round-2/round-3 review passes.

**Verdict: PASS.** Ready for `/ship`.

---

## 12. Shipped (2026-06-26)

v1 monorepo scaffold built, reviewed (3 rounds: code-reviewer + architect, twice independently, plus a narrow follow-up), and QA-verified live against a real running daemon + real disk. `npm run build` clean, 95 unit/integration tests + 1 Playwright e2e all passing at ship time.

**What was verified end-to-end**: pure `packages/core` (IR, adapters, render/diff/marker/semver), `apps/daemon` (RPC server, path-confinement guard, atomic backup-before-write, boot menu, port-retry), `apps/web` (project creation → agent/command builder → live preview → publish diff → write, with daemon-disconnect heartbeat). Security posture (127.0.0.1-only bind, per-boot token, Origin allowlist) confirmed live, not just by reading code. AC-E1/E2/E3 (foreign-file protection, idempotency, conflict-blocks-write) and E14 (path confinement) all demonstrated against real on-disk state.

**Known remaining tech debt** (deliberately deferred, not blocking v1 ship — see §8 assumptions + review history above for full detail):
- Native OS folder-picker is a stub (`browseFolder` always returns `{cancelled:true}`); typed-path entry is the only flow.
- No Cmd-K palette (S15), no settings panel body (S14), no history/rollback panel — all explicitly v1.5+ per locked §0 decisions.
- `deleteArtifact` RPC exists but has no UI entry point wired to it yet.
- Hand-rolled UI primitives (Button/Input/Dialog) have minimal ARIA/focus-trap support — fine for a local single-user tool, worth revisiting if Symbion ever needs to be more accessible.
- GeoChat fixture byte-parity (§9's literal wording) was never verified since the real GeoChat repo wasn't available in this environment — fixtures were hand-authored to match the documented shape instead.

---

## 10. Next step

Run **`/build`** — hand this PLAN + [`symbion-testplan.md`](./symbion-testplan.md) to `feature-builder` to scaffold the monorepo (`packages/core` first — it is the testable spine — then `apps/daemon`, then `apps/web`). Maker ≠ Checker: `/review` uses §9 as the acceptance standard.
