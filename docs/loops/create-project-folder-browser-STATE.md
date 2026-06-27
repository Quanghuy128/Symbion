# STATE — Create Project: folder browser + create-if-missing

## Phase: PLAN (input for architect)

## Origin

Bug report (`/investigate`, 2026-06-27): "lỗi không tạo được dự án với đường dẫn" — user types a repo path that doesn't exist yet in the Create Project dialog and the `[Tạo dự án]` button stays permanently disabled with no actionable next step. Investigation root-caused this (see `docs/learnings.md` § "Investigate: Create Project") and the user picked the fix direction. This doc locks that scope for the architect.

## Root cause (confirmed, not to be re-derived)

- `apps/web/src/components/CreateProjectDialog.tsx`'s `canCreate` gate requires `validation.exists && validation.isDir` — v1 only *registers* an existing repo path, by original design (`symbion-STATE.md` §453). Typing a not-yet-existing path permanently disables `[Tạo]` with only a small `✗ Thư mục không tồn tại` hint — no escape hatch.
- The `[Chọn…]` browse-folder button was specced in `symbion-design.md:352` / `symbion-testplan.md:97` but **never implemented** in `CreateProjectDialog.tsx` — no button wired to any RPC today.
- The existing `browseFolder` RPC (`apps/daemon/src/fs/folderPick.ts`) is an intentional permanent stub — always returns `{cancelled:true}` — because no native Electron/Tauri dialog dependency is wired into the daemon. This stub is **not the fix target**; it's expected to remain a stub or be deprecated, not "fixed" to use a native dialog.

## Locked scope (user-approved fix direction)

Two fixes, both in scope:

1. **Daemon-backed in-app folder browser** — replace the dead native-dialog approach with a new daemon RPC that lists directory contents (subdirectories only, read-only, no native dialog lib) + a new in-app modal/component in the web UI that lets the user navigate the server's filesystem and pick a directory. This becomes the real implementation behind a `[Chọn…]`-style button in `CreateProjectDialog`.
2. **Create-folder-if-missing** — when `validatePath` reports `exists:false` for the typed/selected path, surface a "Tạo thư mục này?" affordance in the dialog that, on confirm, creates the directory (mkdir -p semantics) via a new or extended daemon RPC, subject to the same path-confinement / safety discipline as all other daemon fs writes (CLAUDE.md "Filesystem safety" section — though note: this is creating a *new project root*, not writing inside an already-registered project, so the existing backup-before-write / managed-marker rules for `.claude/` files don't directly apply; the architect should decide what confinement means for this specific operation, e.g. reject `..`-escapes, reject creating outside any sane root, require explicit user confirmation before mkdir).

## Out of scope

- Restoring/fixing the native OS dialog stub (`browseFolder`) — explicitly superseded by the in-app browser.
- Any change to the *existing* `.claude/` write/publish pipeline, managed-marker, or backup logic — this feature only touches the pre-project-exists Create Project flow.
- Multi-root / drive-letter / Windows path handling beyond what already exists elsewhere in the codebase (this is a Linux-first local daemon; don't scope-creep into cross-platform path handling unless the architect finds it's trivial).

## Phase: PLAN (complete)

> Architect output. Locked scope above is unchanged. This section is the design handoff for `dev`/`feature-builder`. After this, run `/build`.

### 1. Architecture

Two new daemon RPC methods, zero new persisted schema, two new web components wired into `CreateProjectDialog.tsx`.

#### 1.1 New RPC: `listDir` (directory browser, read-only)

**Where it lives**: `packages/rpc-types/src/index.ts` (contract types) → re-exported by `apps/daemon/src/rpc/contract.ts` → implemented in `apps/daemon/src/rpc/handlers.ts`. New pure-ish listing logic in a new file `apps/daemon/src/fs/listDir.ts` (Node `fs`, so it must live in `apps/daemon`, NOT `packages/core` — `packages/core` stays pure/no-Node-imports per CLAUDE.md). No `packages/core` change needed for this RPC.

Request/response shape (add to `packages/rpc-types/src/index.ts`):

```ts
export interface ListDirParams {
  /** absolute path to list; if omitted, daemon defaults to os.homedir(). */
  path?: string;
}
export interface ListDirEntry {
  name: string;
  /** absolute path of this entry — what the UI sends back as the next listDir/createProject path. */
  path: string;
  /** true only for entries the daemon classifies as navigable (real dir or dir-like symlink target). */
  isDir: boolean;
  /** true if this entry is a symlink (dir or not) — UI may show a distinct icon; still navigable if isDir. */
  isSymlink: boolean;
  /** true if a permission/stat error means we know nothing more than the readdir name (not navigable). */
  unreadable: boolean;
}
export interface ListDirResult {
  /** resolved absolute path that was actually listed (after symlink/realpath resolution of `path` itself). */
  path: string;
  /** absolute path of the parent dir, or undefined if `path` is filesystem root ("/"). Lets UI render "Up". */
  parentPath?: string;
  /** subdirectories only (files are never returned — this RPC is a directory PICKER, not a file browser). */
  entries: ListDirEntry[];
  /** true if `path` itself could be stat'd but readdir failed (e.g. permission denied) — entries is []. */
  denied: boolean;
}
```

Add `"listDir"` to the `RpcMethod` union and to `READ_ONLY_METHODS` in `apps/daemon/src/server.ts` (it never mutates disk — pure `readdirSync`/`statSync`).

Handler (`apps/daemon/src/rpc/handlers.ts`):
```ts
listDir(params: contract.ListDirParams): contract.ListDirResult {
  return listDirImpl(params.path);
}
```
delegates to `apps/daemon/src/fs/listDir.ts`'s exported `listDir(path?: string): ListDirResult`, which:
1. Resolves the target path: `params.path ?? homedir()`.
2. Rejects non-absolute input paths outright (`RpcError("invalid-params", ...)`) — the browser only ever deals in absolute paths it was itself handed by a previous `listDir` response or the daemon's home-dir default; the web text input's raw typed string is validated/normalized by `validatePath` already, not by `listDir`.
3. `realpathSync` the target to resolve symlinks, then `statSync` — if it doesn't exist or isn't a directory, throw `RpcError("invalid-path", "Đường dẫn không tồn tại hoặc không phải thư mục.")` (same message/code style as `createProject`'s existing check).
4. If `accessSync(target, R_OK)` fails → return `{ path: target, parentPath, entries: [], denied: true }` rather than throwing — this is a normal, expected outcome (browsing into a directory you can list-stat but not read), not a hard error; the UI shows an inline "Không thể đọc thư mục này" row instead of an error toast.
5. Otherwise `readdirSync(target, { withFileTypes: true })`, filter to entries where `dirent.isDirectory() || dirent.isSymbolicLink()`, then for symlinks `statSync` (following) to confirm the link target is itself a directory — if that secondary stat throws (broken symlink) or resolves to a non-directory, exclude the entry entirely (files are never shown, broken links are not directories). Each surviving entry is stat'd individually inside a `try/catch`; per-entry stat failure (e.g. an ACL-denied subdirectory whose name we got from readdir but can't stat) sets `unreadable: true, isDir: false` for that single row instead of failing the whole call.
6. Sort entries alphabetically (case-insensitive), dotfiles/dot-dirs (e.g. `.config`) included — the user may legitimately want to navigate into a hidden dir to create a project there (matches the rest of the codebase's `.claude`/`.symbion`/`.git` dot-prefix conventions, no special-casing needed).
7. `parentPath` = `dirname(target)` unless `target === dirname(target)` (root), in which case omit.

No path-confinement check here in the `resolveConfinedPath` sense — **by design**, see Edge Cases §3.4 below: this RPC is read-only directory *listing* of the host filesystem, not a write inside a project root, so there is no project root to confine to. The only guard is "must be an absolute, real, existing directory" plus the read-only-method auth/origin checks already enforced by `server.ts` for every non-`ping` method.

#### 1.2 New RPC: `makeDir` (create-folder-if-missing)

Contract types:
```ts
export interface MakeDirParams {
  path: string;
}
export interface MakeDirResult {
  path: string;
  created: boolean; // false if it already existed as a dir (idempotent no-op), true if newly created
}
```

Add `"makeDir"` to `RpcMethod`. **NOT** added to `READ_ONLY_METHODS` (it mutates disk — same bucket as `createProject`/`saveArtifact`/`write`).

Handler (`apps/daemon/src/rpc/handlers.ts`):
```ts
makeDir(params: contract.MakeDirParams): contract.MakeDirResult {
  return makeDirImpl(params.path);
}
```
delegates to a new exported function in `apps/daemon/src/fs/listDir.ts` (co-located with `listDir` since both are the "browse/prepare a not-yet-a-project directory" pair; not in `writeFiles.ts`, which is specifically the render→diff→write pipeline for *managed* `.claude`/`AGENTS.md` files inside an *existing* registered project — `makeDir` is conceptually upstream of all of that). Logic:
1. Reject non-absolute `path` (`RpcError("invalid-params", ...)`).
2. Reject any path containing a literal `..` segment, computed by splitting on `/` (mirrors `rejectTraversalSegments` style, reused as a free function — see Edge Cases §3.4 for why this is the right boundary here instead of `resolveConfinedPath`).
3. If `existsSync(path)`:
   - If `statSync(path).isDirectory()` → return `{ path, created: false }` (idempotent — re-clicking "Tạo thư mục" on a dir that now exists, e.g. created by a concurrent process, is a success no-op, not an error).
   - Else (exists as a file, or other non-dir entry e.g. a FIFO) → `RpcError("path-is-file", "Đường dẫn đã tồn tại nhưng không phải là thư mục.")`.
4. Else: `mkdirSync(path, { recursive: true })` (mkdir -p semantics, per locked scope), wrapped in try/catch — on `EACCES`/`EPERM`/`ENOTDIR` (e.g. an ancestor segment is itself a file) re-throw as `RpcError("mkdir-failed", "Không thể tạo thư mục: " + err.message)`.
5. Return `{ path, created: true }`.

No backup-before-write here — there is nothing to back up (creating a brand-new empty directory, not overwriting file content); the CLAUDE.md backup-before-write rule is specifically about reversible *overwrites* of managed file content, which doesn't apply to mkdir of an empty dir.

#### 1.3 New web components

**`apps/web/src/components/FolderBrowserDialog.tsx`** (new file) — a second, nested modal (or could be the same `Dialog` primitive raised with a higher effective z-index since they already stack via `fixed inset-0 z-50`; simplest: reuse the same `Dialog` component, opened on top of `CreateProjectDialog`, since the existing primitive has no portal/stacking-context conflict — both render at document body level via fixed positioning).

Props:
```ts
interface FolderBrowserDialogProps {
  open: boolean;
  initialPath?: string; // seed = current `path` input value if non-empty & validated isDir, else daemon home default
  onPick: (path: string) => void; // user clicked "Chọn thư mục này" on the currently-listed path
  onClose: () => void;
}
```
Internal state: `currentPath: string | null`, `listing: ListDirResult | null`, `loading`, `error`. On open/path-change, calls `callRpc<ListDirParams, ListDirResult>("listDir", { path: currentPath ?? undefined })`. Renders:
- Header showing `currentPath` (or "Trang chủ" placeholder while loading the default).
- "Lên một cấp" row if `listing.parentPath` is defined → clicking sets `currentPath = listing.parentPath`.
- If `listing.denied` → inline message "Không có quyền đọc thư mục này." with only the "Lên một cấp" / Hủy actions available (no entries to click).
- One row per `entries[]`: clicking a row with `isDir: true` navigates into it (re-fetches `listDir` with that entry's `path`); rows with `unreadable: true` are rendered disabled/greyed with a small lock icon and are not clickable.
- Footer: `[Hủy]` (calls `onClose`) and `[Chọn thư mục này]` (calls `onPick(currentPath)` then closes) — the "Chọn" button picks the *currently listed* directory itself, not a child row (standard folder-picker UX: navigate INTO a dir by clicking it, but the Choose button always confirms "the directory I'm currently looking at").

**Create-folder-if-missing affordance** — added inline inside `CreateProjectDialog.tsx`, not a separate component (it's a 2-line conditional + one button, doesn't warrant its own file): when `validation?.exists === false` (and `path` is non-empty/non-whitespace), render a small confirm row under the existing `✗ Thư mục không tồn tại` hint:
```
✗ Thư mục không tồn tại   [Tạo thư mục này]
```
Clicking `[Tạo thư mục này]` calls `callRpc<MakeDirParams, MakeDirResult>("makeDir", { path: path.trim() })`; on success, re-runs the existing `validatePath` effect (or directly merges the optimistic `{exists:true, isDir:true, isGitRepo:false, hasClaudeDir:false, hasAgentsMd:false, writable:true}` into `validation` state, then re-validates via the debounce effect to get the authoritative answer) so the dialog immediately re-renders the `✓ Thư mục tồn tại · .claude/ chưa có` state and `[Tạo dự án]` becomes enabled. On `RpcError` (e.g. `mkdir-failed`), show the error text inline (reuse the existing `error` state slot) without closing the dialog.

#### 1.4 `CreateProjectDialog.tsx` wiring changes

- Add `[Chọn…]` `<Button variant="outline">` next to the path `<Input>` (flex row); clicking sets `browserOpen = true`.
- Render `<FolderBrowserDialog open={browserOpen} initialPath={...} onPick={(p) => { setPath(p); setBrowserOpen(false); }} onClose={() => setBrowserOpen(false)} />` inside the existing dialog tree (after `DialogFooter` is fine, visibility is independent).
- `initialPath` seed logic: if current `path.trim()` is non-empty AND last known `validation?.isDir`, pass it as the seed (resume browsing from where the user already typed); otherwise pass `undefined` (daemon defaults to home dir).
- Add the create-folder-if-missing row described in §1.3, with new local state `creatingDir: boolean` (disable the button + show inline "Đang tạo…" while the `makeDir` call is in flight) and reuse existing `error` state for failure display.
- `canCreate` gate is **unchanged** — `validation.exists && validation.isDir` still required; the create-folder action's job is to flip `validation.exists` to `true` via the normal validate effect, not to bypass the gate.

### 2. Data flow

**Browse flow:**
```
User clicks [Chọn…]
  → FolderBrowserDialog opens, calls listDir({path: seed})
  → daemon: realpath+stat target, readdirSync, filter dirs, per-entry stat (best-effort)
  → ListDirResult { path, parentPath, entries, denied } returned
  → UI renders rows; user clicks a directory row
  → re-call listDir({path: thatEntry.path}) → re-render (pure navigation, no write, repeatable)
  → user clicks [Chọn thư mục này]
  → onPick(currentPath) → CreateProjectDialog.setPath(currentPath) → dialog closes
  → existing path-input useEffect debounce fires → validatePath({path: currentPath}) → validation state updates
  → UI shows ✓/✗ hint, [Tạo dự án] gate re-evaluated
```
No filesystem mutation anywhere in this flow — `listDir` is pure read.

**Create-folder flow:**
```
User types a not-yet-existing path (or picks one via browse — browse can also "preview" a
non-existent path is impossible since listDir only lists real existing dirs; create-folder
is reached purely via the typed-path route, OR by browsing to a PARENT and then appending
a new subfolder name by typing — both end up going through the same typed `path` input)
  → validatePath effect fires → validation.exists === false
  → UI shows "✗ Thư mục không tồn tại  [Tạo thư mục này]"
  → user clicks [Tạo thư mục này]
  → makeDir({path}) → daemon: existsSync check → mkdirSync(path, {recursive:true})
  → MakeDirResult { path, created: true } returned
  → UI re-triggers validatePath({path}) (authoritative re-check, not just optimistic merge)
  → validation.exists === true, isDir === true, hasClaudeDir === false (brand new dir)
  → UI shows "✓ Thư mục tồn tại · .claude/ chưa có"
  → [Tạo dự án] becomes enabled → user clicks → existing createProject RPC flow (unchanged)
     → createProject still independently checks existsSync+isDirectory server-side (defense
       in depth — handlers.createProject is unchanged, still re-validates, doesn't trust
       the client's "I just made this" claim)
```

### 3. Edge cases

**3.1 Permission-denied directory during listing** — `listDir` returns `{denied: true, entries: []}` instead of throwing. UI shows "Không có quyền đọc thư mục này" with Up/Cancel only. Does not break browsing (user can go Up and pick a sibling).

**3.2 Per-entry unreadable (e.g. ACL'd subdirectory)** — caught individually in the loop; that one row gets `unreadable: true`, rendered disabled, rest of the listing still works. The whole `listDir` call never fails because one child entry's stat throws.

**3.3 Symlinks** — a symlinked directory is included as a navigable entry (`isSymlink: true, isDir: true`) IF its realpath target is itself a directory; a broken symlink or a symlink to a file is excluded from `entries` entirely (this RPC only ever shows directories, broken links are not directories). Clicking into a symlinked dir and choosing it sets `path` to the symlink's own path (not its resolved realpath) — `validatePath`/`createProject` downstream already `existsSync`/`statSync` (which follow symlinks) so this works transparently; `makeDir` would never be invoked on an already-existing symlinked dir since `validation.exists` is already true.

**3.4 Confinement boundary for `makeDir`** — explicitly decided: **no `resolveConfinedPath`/project-root confinement applies here**, because by definition this RPC runs *before* any project root is registered — there is no `projectId` to look up a root from (compare every other write RPC: `saveArtifact`/`write`/`importArtifacts` all start with `findProjectPath(params.projectId)`; `makeDir` deliberately has no such parameter). The actual safety boundary for `makeDir` is narrower and different in kind:
  - Reject non-absolute paths (no relative-path ambiguity against an unstated cwd).
  - Reject literal `..` path segments (defense-in-depth against a malformed/crafted path even though the only caller is the trusted same-origin web UI sending a path it either typed or got from `listDir`).
  - Require explicit user click (`[Tạo thư mục này]`) — no auto-create on blur/debounce.
  - `mkdirSync(..., {recursive: true})` can create multiple missing ancestor segments (mkdir -p) — this is accepted as in-scope per the locked spec's "mkdir -p semantics" wording, but the UI must show the full absolute path being created in the button/confirm copy (e.g. tooltip or the path itself is already visible in the Input above the button) so the user isn't surprised that intermediate dirs get created too.
  - This RPC is **not** added to any allowlist of "safe roots" (e.g. restricting to homedir subtree) — the locked scope explicitly says "this is creating a new project root, not a write inside an already-registered project," and the user is a local developer running their own daemon; over-restricting where a project can be created would contradict v1's existing `createProject`/`validatePath` behavior, which already accepts any absolute path with no root restriction. Consistency with `createProject`'s existing (unrestricted) behavior is the design's stated assumption — see Trade-offs §5.

**3.5 mkdir failures**
  - Already exists as a file (not a dir) → `RpcError("path-is-file", ...)`, dialog shows inline error, button stays clickable for retry after the user fixes the path.
  - Parent missing → not a failure case at all: `mkdirSync(..., {recursive:true})` creates missing parents transparently (mkdir -p). Only fails if an ancestor segment exists AND is a file (`ENOTDIR`) or permissions block creation (`EACCES`/`EPERM`) — both surface as `RpcError("mkdir-failed", ...)` with the raw Node error message appended for diagnosability.
  - No write permission on the parent → `EACCES` → same `mkdir-failed` path.

**3.6 Race between listing and mkdir** — `listDir` is a snapshot; if the directory tree changes between a `listDir` call and the user later clicking `[Chọn thư mục này]` or `[Tạo thư mục này]`, the *next* RPC (`validatePath`, `makeDir`, or `createProject`) always re-stats the live filesystem — there is no cached/stale state trusted across RPC calls. Worst case: user picks a dir via browser, it gets deleted by another process before clicking `[Tạo dự án]`, `validatePath`'s live re-check (already wired, unchanged) reports `exists:false` again and the gate disables — no corruption, just a refreshed truthful state.

**3.7 Re-clicking `[Tạo thư mục này]` after the directory now exists** (e.g. double-click, or created out-of-band between click and response) — `makeDir` is idempotent by design (`created:false` branch in step 3 of §1.2), returns success either way; never errors on "already exists as a dir."

**3.8 `.git`/`.claude` already present after create/select** — only reachable via the *browse* flow (you can't `listDir` into a dir that doesn't exist, and `makeDir` only ever produces a brand-new empty dir, so a freshly-made dir can never have `.claude`/`.git`). When the user *browses* to and picks an existing directory that happens to already have `.claude`/`.git`, the existing `validatePath` effect (unchanged, already fires on every `path` change including ones set via `onPick`) correctly reports `hasClaudeDir:true`/`isGitRepo:true`, and the existing hint text `✓ Thư mục tồn tại · .claude/ đã có (xem xét Import)` already fires unchanged — no new code needed, this is a direct consequence of `onPick` going through `setPath` → the same debounced `validatePath` effect as manual typing.

**3.9 Invalid/empty `path` sent to `listDir`** (e.g. a stale `initialPath` pointing at a dir that was deleted between dialog-open and the RPC firing) — handler throws `RpcError("invalid-path", ...)`; `FolderBrowserDialog` catches it and falls back to re-requesting with `path: undefined` (daemon home default) plus a small inline "Không tìm thấy đường dẫn trước đó, về Trang chủ" notice, rather than leaving the modal stuck on an error with no escape.

**3.10 Daemon disconnects mid-browse** — `callRpc` throws a generic fetch failure; `FolderBrowserDialog` shows the existing-pattern inline error text and the user can `[Hủy]`; no special new handling needed beyond what every other RPC call site already does (no daemon-specific reconnect logic exists anywhere else in the codebase to match, so none is added here — consistent with the rest of v1).

### 4. Local-store impact

**None.** No new fields in `ProjectStore` (`apps/daemon/src/store/store.ts` schema unchanged, `schemaVersion` stays at its current value) and no new global-config fields. `listDir` and `makeDir` are both stateless with respect to `.symbion/store.json` / the global config file — they only touch the raw filesystem outside any project's `.symbion/` directory. This confirms STATE.md's "Local-store impact: none expected" was correct; flagging explicitly here so `code-reviewer` can verify no schema/migration code was added unnecessarily.

### 5. Trade-off decisions + assumptions (for dev/Checker to track)

1. **No root-of-browsing restriction.** `listDir` lets the user navigate anywhere the daemon process can read (e.g. `/etc`, `/`), consistent with `createProject` already accepting any absolute path today. This is a deliberate continuation of existing v1 behavior, not a new exposure — the daemon already runs as the user's own OS user with the user's own filesystem permissions, and binds to `127.0.0.1` only with token+origin auth per CLAUDE.md. If a future spec wants to restrict browsing to e.g. `$HOME`, that's a separate, explicit feature, not implied by this one.
2. **Files are never listed**, only directories — `listDir` is a directory PICKER, not a general file browser, matching the single purpose (picking/creating a project root).
3. **`makeDir` has no separate "confirm path" round-trip beyond the single button click** — the spec says "require explicit user confirmation before mkdir" (satisfied by the button being a distinct, deliberate click rather than auto-create-on-blur); a secondary "are you sure?" dialog was considered and rejected as overkill for creating an empty directory (reversible by simply deleting it — unlike overwriting file content, there's no data-loss risk that would justify a second confirmation step).
4. **`FolderBrowserDialog` reuses the existing bare `Dialog` primitive** rather than introducing a new modal system, to stay consistent with the rest of `apps/web/src/components/ui/dialog.tsx`'s stated v1 minimalism ("swap for the real shadcn Dialog component when wiring the CLI" — not blocking on that swap now).
5. **Dotfiles/dot-directories are shown** in the browser (not filtered) — assumption: a developer creating a project under e.g. `~/.local/share/projects` should be able to navigate there; if this surfaces noise (e.g. `.cache`, `.npm`) in practice, a follow-up could add a "hide dotdirs" toggle, but it's out of scope for this pass per the locked spec's "don't scope-creep" guidance.
6. **No caching of `listDir` results** across navigation — every click re-fetches; simplicity over speed since local-disk `readdirSync` is fast and there's no realistic perf concern for a directory picker.
7. **`createProject`'s existing server-side `existsSync`/`isDirectory` re-check is left untouched** — `makeDir` succeeding doesn't let the client skip that defense-in-depth re-validation; this is intentional belt-and-suspenders, not redundant code to remove.


## Phase: BUILD (complete)

> Maker output (`feature-builder`). Implements PLAN §1–§5 above. Next: `/review` (code-reviewer), `/cso` if RPC/fs-write surface needs a security pass, then `/qa` against `create-project-folder-browser-testplan.md`.

### Files created

- `apps/daemon/src/fs/listDir.ts` — `listDir(inputPath?: unknown): ListDirResult` and `makeDir(path: unknown): MakeDirResult`, co-located per the design.
- `apps/daemon/src/rpc/rpcError.ts` — **new, not in the original design**: extracted the `RpcError` class out of `apps/daemon/src/rpc/handlers.ts` into its own module. Reason: `fs/listDir.ts` needs to throw `RpcError`, and `handlers.ts` needs to import `listDir`/`makeDir` from `fs/listDir.ts` — defining `RpcError` in `handlers.ts` (as it was before this feature) would have created a circular ESM import (`fs/listDir.ts` → `rpc/handlers.ts` → `fs/listDir.ts`). `handlers.ts` now does `import { RpcError } from "./rpcError.js"` and re-exports it (`export { RpcError }`) so every existing external import site (`apps/daemon/src/server.ts`, `apps/daemon/test/*.ts` via `import { handlers, RpcError } from "../src/rpc/handlers.js"`) is unaffected — no call site changes needed anywhere else.
- `apps/web/src/components/FolderBrowserDialog.tsx` — the in-app directory browser modal.
- `apps/daemon/test/listDir.test.ts` — unit tests for `listDir`/`makeDir` (TC-LD1–13, TC-MD1–8, plus TC-RPC6/TC-RPC7 at the handler level).

### Files changed

- `packages/rpc-types/src/index.ts` — added `ListDirParams`/`ListDirEntry`/`ListDirResult`, `MakeDirParams`/`MakeDirResult`; added `"listDir"` and `"makeDir"` to the `RpcMethod` union.
- `apps/daemon/src/rpc/contract.ts` — re-exports the 6 new types from `@symbion/rpc-types`.
- `apps/web/src/lib/rpc/types.ts` — re-exports the same 6 new types for the web side.
- `apps/daemon/src/rpc/handlers.ts` — added `handlers.listDir`/`handlers.makeDir` (thin delegation to `fs/listDir.ts`); moved `RpcError` to `rpc/rpcError.ts` (see above) and re-exports it.
- `apps/daemon/src/server.ts` — added `"listDir"` to `READ_ONLY_METHODS`. `"makeDir"` deliberately NOT added (mutating, same bucket as `createProject`/`write`).
- `apps/daemon/test/server.integration.test.ts` — added transport-level tests: `listDir`/`makeDir` without token → 401; `listDir` with token → 200 + expected shape; `makeDir` with token → 200 + dir created on disk; malformed `makeDir` (missing `path`) → 400 `invalid-params`.
- `apps/web/src/components/CreateProjectDialog.tsx` — added `[Chọn…]` button (opens `FolderBrowserDialog`), the inline "Tạo thư mục này" / "Đang tạo…" affordance next to the `✗ Thư mục không tồn tại` hint, and renders `<FolderBrowserDialog>` inside the existing dialog tree. `canCreate` gate logic untouched.

### Files explicitly NOT touched (out of scope, confirmed)

- `apps/daemon/src/fs/folderPick.ts` (the `browseFolder` stub) — left exactly as-is.
- `packages/core` — no changes; stays pure/fs-free.
- `apps/daemon/src/store/store.ts` schema / `schemaVersion` — unchanged.
- `apps/daemon/src/rpc/guard.ts` (`resolveConfinedPath`/`rejectTraversalSegments`) — read but not modified; `makeDir`'s own inline `..`-segment check is a freestanding equivalent (see assumptions below), not a call into `rejectTraversalSegments`.

### Bugs found and fixed during implementation (beyond the design's literal text)

1. **`makeDir`/`listDir` crashed with an uncaught `TypeError` (→ HTTP 500, not a clean `RpcError`) when `path` was missing/non-string in the raw JSON body** — e.g. `POST /rpc {"method":"makeDir","params":{}}`. Root cause: `node:path`'s `isAbsolute(undefined)` throws a `TypeError` synchronously, which is not an `RpcError`, so `server.ts`'s catch block fell through to the generic 500 `internal-error` path instead of 400 `invalid-params`. Fixed by adding an explicit `typeof path !== "string"` runtime guard *before* calling `isAbsolute` in both `listDir()` and `makeDir()` in `apps/daemon/src/fs/listDir.ts`. Caught by test TC-RPC5 (malformed `makeDir` params) in `apps/daemon/test/server.integration.test.ts`, which now asserts 400/`invalid-params` instead of 500.
2. **The design's mkdir `..`-segment example (`join(tmpRoot, "../escape")`) does not actually exercise the rejected code path** — Node's `path.join()` normalizes `..` segments away during string construction, so `join(tmpRoot, "../escape")` never contains a literal `".."` path segment by the time it reaches `makeDir`; it resolves to `dirname(tmpRoot) + "/escape"`, a perfectly valid sibling path with no `..` in it. The test (`TC-MD5` in `apps/daemon/test/listDir.test.ts`) was written instead with a hand-built string (`` `${tmpRoot}/../escape` ``) to actually exercise the raw-string `..`-segment check. The `makeDir` implementation itself does what the design specifies (reject any literal `..` path segment via string-split, checked before any fs call) — this was a test-construction issue caught while running the suite, not an implementation bug.

### Assumptions made (for Checker to verify — not a self-assessment)

- **`isReadOnly` membership for `listDir`**: added to `READ_ONLY_METHODS` per the design's explicit instruction. Per the existing `server.ts` comment, this set does NOT exempt `listDir` from the token-auth requirement — every non-`ping` method still requires `x-symbion-token` regardless of this set's membership. Confirmed via a test (`listDir` without token → 401).
- **`makeDir`/`listDir` parameter validation**: changed the function signatures in `fs/listDir.ts` to accept `unknown` rather than the contract's typed `string`/`string|undefined`, specifically so a non-string runtime value from a malformed JSON body fails as a clean `RpcError("invalid-params", ...)` inside the function itself rather than relying on the TS type (which gives zero runtime enforcement once JSON is parsed off the wire) — this mirrors the existing `assertValidKind`/`assertValidProviderId` pattern already used elsewhere in `handlers.ts` for the same reason.
- **`..`-segment rejection in `makeDir` is a freestanding `path.split("/").includes("..")` check**, not a call into the existing `apps/daemon/src/rpc/guard.ts`'s `rejectTraversalSegments` (which does the same `split(/[\\/]/)` + `includes("..")` check) — chose not to import/reuse it because `guard.ts`'s exports are conceptually scoped to the *confined-write-inside-a-project-root* pipeline (`resolveConfinedPath` is the file's primary export and `rejectTraversalSegments` is its sibling helper), and the design (STATE §1.2 step 2) describes `makeDir`'s check as "mirrors `rejectTraversalSegments` style, reused as a free function" — read here as "written in the same style," not "literally call the existing function." This is a judgment call; the Checker may want to confirm whether actually importing/calling `rejectTraversalSegments` from `guard.ts` would have been preferred over duplicating the logic.
- **`listDir`'s entry path construction** uses string concatenation (`` `${resolved === "/" ? "" : resolved}/${dirent.name}` ``) rather than `node:path`'s `join()`, to avoid pulling in another import for a single line; behaviorally equivalent for POSIX absolute paths (no `..`/`.` in `dirent.name` from `readdirSync`).
- **Per-entry "unreadable" semantics**: per the design and TC-LD10's own caveat ("unreadable semantics apply specifically to the symlink-target secondary-stat path... no secondary stat needed for the parent-level dirent type"), the implementation still performs a `statSync` on every plain (non-symlink) directory entry inside a try/catch and sets `unreadable:true` if that throws — slightly more defensive than "trust the dirent type from readdir alone," on the theory that a permission-denied child directory can still throw on `statSync` even though `readdir`'s dirent type bit is already known. The corresponding test confirms the call doesn't throw and both entries (`ok`, `locked`) are present, but does not assert a specific `unreadable` value on `locked`, matching the test plan's own hedged language for this case.
- **`FolderBrowserDialog`'s `initialPath` seed in `CreateProjectDialog`**: passes `path.trim()` only when `validation?.isDir` is true (uses the existing `validation` state already in memory, not a fresh RPC call) — per design §1.4 ("if current `path.trim()` is non-empty AND last known `validation?.isDir`"). Did not also check `validation?.exists` explicitly since `isDir` can only be true when the path exists per `validatePath`'s own implementation — Checker may want to confirm this invariant holds.
- **`FolderBrowserDialog` re-fetches `listDir` on every `currentPath` change** (including the very first mount when `currentPath` is still `null` against the seed), via a `useEffect` keyed on `[open, currentPath]`; a separate `useEffect` keyed on `[open]` resets `currentPath`/`listing`/`error` to the seed whenever the dialog transitions to open. This two-effect split was needed so that re-opening the dialog with a different `initialPath` (e.g. user closed it, edited the path input, reopened) actually resets state rather than reusing a stale `currentPath` from the previous session — not explicitly specified in the design, which only describes "on open/path-change, calls listDir."
- **Icons used in `FolderBrowserDialog`** (`Folder`, `Lock`, `ArrowUp` from `lucide-react`) are a styling choice not specified in the design beyond "small lock icon" for unreadable rows; `lucide-react` was already a project dependency (used in `GenerateBodyButton.tsx`/`GenerateDescriptionButton.tsx`), so no new dependency was added.
- **Daemon-disconnect-mid-browse (STATE §3.10) handling**: `FolderBrowserDialog`'s catch-all error branch sets a generic error message string from the thrown error (or a fallback string), matching the design's "no special new handling needed beyond what every other RPC call site already does" — no reconnect/retry logic added.
- **`MakeDirResult`/`ListDirResult` are not re-validated against the contract types at the daemon→web JSON boundary** beyond TypeScript's compile-time check (no runtime schema validator like zod is used anywhere else in the codebase for RPC results either, so none was added here for consistency).
- Did not add a Playwright e2e spec file for the TC-E1–E18 manual/e2e test plan — the task instructions only asked for daemon-side unit/integration tests ("Add unit/integration tests for the new RPC handlers"); the existing repo has no Playwright spec files under `apps/web` to extend/follow a pattern from, so e2e automation is left for `/qa` to execute manually per the test plan's own framing ("/qa executes step-by-step").

## Phase: BUILD (fix round 2)

> Independent review verdicts: architect PASS, code-reviewer NEEDS-WORK with one 🟡 should-fix item. This section fixes that one item only; all other review notes (nits about `..`-split divergence from `guard.ts`'s `rejectTraversalSegments`, and `FolderBrowserDialog`'s double-fetch-on-open) were explicitly accepted as non-blocking and left untouched.

### Bug fixed

`POST /rpc {"method":"makeDir"}` (no `params` key at all in the JSON body) returned HTTP 500 `internal-error` instead of HTTP 400 `invalid-params`. Same for `listDir`. Root cause: `handlers.makeDir(params)` / `handlers.listDir(params)` (`apps/daemon/src/rpc/handlers.ts:119-124`) immediately destructure/pass `params.path`; when `params` itself is `undefined` (not just `params.path` missing — round 1 already fixed that case via the `typeof path !== "string"` guard inside `fs/listDir.ts`), this throws a bare `TypeError` in the dispatch layer before any handler-level `RpcError` validation runs, which `server.ts`'s catch block (correctly) can't distinguish from a real internal error, so it falls through to the generic 500 path.

Per the reviewer's note, this was a **systemic dispatch-layer gap affecting every RPC method**, not specific to `makeDir`/`listDir` — any handler that destructures fields off `params` without first null-checking `params` itself would have the same bug if called with no `params` key. Fixed once at the dispatch layer rather than patching each handler.

### Files changed

- `apps/daemon/src/server.ts` — in the RPC dispatch handler, changed `const result = await handlerFn(body.params, ...)` to first compute `const params = body.params ?? {};` and pass that instead of `body.params` directly. One-line root-cause fix; every handler (old and new) now receives `{}` instead of `undefined` when the client's JSON body omits the `params` key entirely.
- `apps/daemon/test/server.integration.test.ts` — added two new cases inside the `listDir / makeDir transport` describe block (renamed `TC-RPC1..TC-RPC5` → `TC-RPC1..TC-RPC9` to reflect the additions):
  - **TC-RPC8**: `makeDir` called via `rpc("makeDir", undefined, {token})` (relies on `JSON.stringify` dropping an `undefined` property, so the wire body has no `params` key at all — distinct from TC-RPC5's `params: {}`, which still sends an empty-but-present object) → asserts 400 `invalid-params` (previously 500).
  - **TC-RPC9**: same no-`params`-key body for `listDir` → asserts the response is never 500, and specifically is 200 with an `entries` array (since `listDir`'s contract treats an absent `path` as "default to homedir()", an absent `params` object is a legitimate no-op call once it normalizes to `{}`, not an error case).

### Verification

- Confirmed `ping(_params, ctx)` in `handlers.ts:87` ignores its first argument entirely (`_params` unused) — passing `{}` instead of `undefined` to it is behaviorally identical (no regression for the one handler that previously may have relied on receiving exactly `undefined`).
- Scanned every other handler in `handlers.ts`; all of them destructure/read fields off `params` (e.g. `params.path`, `const { path } = params`), so receiving `{}` instead of `undefined` only changes their behavior from "crash with an unhandled TypeError" to "their own existing `invalid-params`/runtime-guard logic now runs as designed" — strictly a fix, not a behavior change for any legitimate caller.
- `npm test` at repo root: **178/178 tests passed** (20 test files), including the 2 new cases in `server.integration.test.ts` (now 20 tests in that file, up from 18) and the pre-existing 23 tests in `listDir.test.ts` (untouched, still green).

### Out of scope (explicitly not touched in this pass)

- `apps/daemon/src/rpc/guard.ts`'s `rejectTraversalSegments` vs. `makeDir`'s freestanding `..`-split check — left as a duplicate-but-equivalent implementation per round 1's documented judgment call; reviewer flagged as a nit, not blocking.
- `FolderBrowserDialog`'s double-fetch-on-open (the two-`useEffect` split described in round 1's assumptions) — reviewer flagged as a nit, not blocking.
- No other handler's individual `invalid-params` validation logic was changed — this fix is purely the dispatch-layer default, not a per-handler patch.

## Phase: REVIEW (complete)

**Final verdict: PASS** (both tracks).

- **architect** (design conformance): **PASS**. Clean workspace build in correct order (`@symbion/core` → `@symbion/rpc-types` → `@symbion/daemon` → `@symbion/web`); RPC contracts match the design exactly; package boundaries respected (`packages/core` stays pure, `apps/daemon` is the sole fs-touching process); all 10 edge cases (§3.1–§3.10) implemented and tested; the deliberate "no confinement for `makeDir`" call holds up under the real implementation. The undesigned `RpcError` extraction to `rpc/rpcError.ts` was assessed as architecturally sound (fixes a real circular-import risk, fully backward-compatible via re-export).
- **code-reviewer** (round 1): **NEEDS-WORK** — one 🟡 should-fix (missing-`params`-body on `listDir`/`makeDir` returned 500 instead of 400; systemic dispatch-layer gap, not feature-specific) + a test gap; rest were 🟢 nits accepted as-is (the `..`-split duplication vs. `guard.ts`, `FolderBrowserDialog`'s double-fetch-on-open).
- **Fix round 2**: dispatch-layer one-line fix (`body.params ?? {}` in `server.ts`) applied once, closing the gap for every handler, not just the two new ones. Two new tests added (TC-RPC8/9).
- **code-reviewer** (narrow re-review of fix round 2): **PASS**. Confirmed the fix is exactly as described, `ping` unaffected, live HTTP verification (400 not 500), full suite green (178/178).

No `/cso` security-reviewer pass has been run yet — the architect's PASS note recommends one given the new mutating `makeDir` endpoint with no project-root confinement (a deliberate, documented design choice, but still a new fs-mutating RPC worth an independent security pass before shipping).

Next: `/qa` against `create-project-folder-browser-testplan.md` (and consider `/cso` first, since this introduces the first fs-mutating RPC with no confinement boundary).
