# Symbion — STATE (phase = PLAN)

> **Phase: PLAN** (architect output). New, separate greenfield project — **NOT GeoChat**. No Supabase, no Realtime/Presence, no map, no PostGIS, no mobile, no cloud DB.
> Inputs (locked spec + design — do not re-litigate): [`docs/symbion-analyze.md`](../symbion-analyze.md) (ANALYZE), [`docs/loops/symbion-design.md`](./symbion-design.md) (DESIGN).
> Test plan handoff: [`docs/loops/symbion-testplan.md`](./symbion-testplan.md).
> Date: 2026-06-25.

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
├─ playwright.config.ts         # e2e against built web + a test daemon
├─ docs/loops/                  # STATE + testplan copied here at repo init
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

## 10. Next step

Run **`/build`** — hand this PLAN + [`symbion-testplan.md`](./symbion-testplan.md) to `feature-builder` to scaffold the monorepo (`packages/core` first — it is the testable spine — then `apps/daemon`, then `apps/web`). Maker ≠ Checker: `/review` uses §9 as the acceptance standard.
