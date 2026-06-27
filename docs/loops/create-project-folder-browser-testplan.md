# Create Project: folder browser + create-if-missing — TEST PLAN (handoff for /qa)

> Companion to [`create-project-folder-browser-STATE.md`](./create-project-folder-browser-STATE.md) (PLAN). Modeled on [`symbion-testplan.md`](./symbion-testplan.md)'s style. Stack: `apps/daemon` (Vitest integration against temp dirs) · `apps/web` (Playwright e2e + manual /qa checklist).
> `/qa` executes §3 step-by-step. `/review` uses STATE §1–§5 + this plan as the acceptance bar.

Fixtures: no new fixture files needed beyond Node `mkdtempSync`/`mkdirSync`/`symlinkSync`/`chmodSync` against OS temp dirs (same pattern as `apps/daemon/test/rpc.integration.test.ts`).

---

## 1. Unit tests — `apps/daemon` (Vitest, new file `apps/daemon/test/listDir.test.ts` or appended to `rpc.integration.test.ts`)

### 1.1 `listDir` — happy path
- **TC-LD1**: `listDir({path: tmpRoot})` where `tmpRoot` contains subdirs `a/`, `b/` and a file `c.txt` → `entries` contains exactly `a`, `b` (no `c.txt`); `denied: false`.
- **TC-LD2**: entries sorted alphabetically case-insensitively (`Banana/`, `apple/`, `Cherry/` → order `apple, Banana, Cherry`).
- **TC-LD3**: `parentPath` equals `dirname(tmpRoot)` for a normal subdirectory; calling `listDir({path: "/"})` (filesystem root) returns `parentPath: undefined`.
- **TC-LD4**: `listDir({path: undefined})` (omitted) resolves to `os.homedir()` and returns that as `result.path`.
- **TC-LD5**: dotdirs included — `tmpRoot/.hidden/` appears in `entries`.

### 1.2 `listDir` — error / edge cases
- **TC-LD6**: `listDir({path: "relative/path"})` (non-absolute) → throws `RpcError("invalid-params", ...)`.
- **TC-LD7**: `listDir({path: join(tmpRoot, "does-not-exist")})` → throws `RpcError("invalid-path", ...)`.
- **TC-LD8**: `listDir({path: join(tmpRoot, "a-file.txt")})` (exists but is a file, not dir) → throws `RpcError("invalid-path", ...)`.
- **TC-LD9** (permission-denied): `mkdirSync(deniedDir)`, `chmodSync(deniedDir, 0o000)`, `listDir({path: deniedDir})` → returns `{denied: true, entries: []}`, does NOT throw. (Skip on platforms/CI users where the test runs as root, since root bypasses permission bits — guard with a `chmodSync` + `accessSync` precheck or skip.)
- **TC-LD10** (per-entry unreadable): create `tmpRoot/ok/` and `tmpRoot/locked/` with `locked` chmod'd `0o000`; `listDir({path: tmpRoot})` still returns both entries, `locked` may have `isDir` from the initial `readdir` dirent type (no secondary stat needed for the parent-level dirent type, so `unreadable` semantics apply specifically to the *symlink-target* secondary-stat path) — confirm the call does not throw and both entries are present.
- **TC-LD11** (symlink to dir): `symlinkSync(tmpRoot/real, tmpRoot/link)` → `link` appears in `entries` with `isSymlink: true, isDir: true`.
- **TC-LD12** (broken symlink): `symlinkSync(nonExistentTarget, tmpRoot/broken)` → `broken` is excluded from `entries` entirely.
- **TC-LD13** (symlink to file, not dir): `symlinkSync(someFile, tmpRoot/linkToFile)` → excluded from `entries`.

### 1.3 `makeDir` — happy path
- **TC-MD1**: `makeDir({path: join(tmpRoot, "new-project")})` on a not-yet-existing path → `{path, created: true}`; directory exists on disk afterward.
- **TC-MD2** (mkdir -p): `makeDir({path: join(tmpRoot, "a/b/c")})` where neither `a` nor `a/b` exist → all three levels created; `created: true`.
- **TC-MD3** (idempotent): call `makeDir` twice with the same path → first call `created: true`, second call `created: false`, no error either time.

### 1.4 `makeDir` — error / edge cases
- **TC-MD4**: `makeDir({path: "relative/path"})` → throws `RpcError("invalid-params", ...)`.
- **TC-MD5**: `makeDir({path: join(tmpRoot, "../escape")})` (contains literal `..` segment) → throws `RpcError("invalid-params", ...)` (rejected before any fs call).
- **TC-MD6** (path-is-file): `writeFileSync(join(tmpRoot, "blocker"))`, then `makeDir({path: join(tmpRoot, "blocker")})` → throws `RpcError("path-is-file", ...)`.
- **TC-MD7** (ancestor is a file — ENOTDIR): `writeFileSync(join(tmpRoot, "blocker"))`, then `makeDir({path: join(tmpRoot, "blocker", "child")})` → throws `RpcError("mkdir-failed", ...)`.
- **TC-MD8** (no write permission on parent): `mkdirSync(readonlyDir)`, `chmodSync(readonlyDir, 0o555)`, `makeDir({path: join(readonlyDir, "child")})` → throws `RpcError("mkdir-failed", ...)`. (Skip when running as root.)

---

## 2. Integration tests — RPC contract + server wiring

- **TC-RPC1**: `"listDir"` is present in `READ_ONLY_METHODS` in `apps/daemon/src/server.ts`; a request without `x-symbion-token` still succeeds for `listDir` is **false** — confirm the comment in `server.ts` ("every other method — including all read-only ones — requires the token") still applies: send `listDir` without a token → expect 401, NOT a free pass.
- **TC-RPC2**: `"makeDir"` is present in the `RpcMethod` union but absent from `READ_ONLY_METHODS`.
- **TC-RPC3**: end-to-end through `startServer` (supertest-style raw HTTP POST to `/rpc`) with a valid token: `{method: "listDir", params: {path: tmpRoot}}` → 200 with the expected `ListDirResult` shape.
- **TC-RPC4**: same for `{method: "makeDir", params: {path: join(tmpRoot, "x")}}` → 200, dir created on disk.
- **TC-RPC5**: malformed `makeDir` params (`path` missing/non-string) → 400 with `invalid-params` (defense-in-depth against an untyped JSON body, same pattern as `assertValidKind`/`assertValidProviderId` for `generateBody`).
- **TC-RPC6** (post-create flow): `makeDir` a new dir → immediately call `validatePath` on the same path → `{exists: true, isDir: true, hasClaudeDir: false, isGitRepo: false}`.
- **TC-RPC7** (createProject still re-validates): call `makeDir` then `createProject` on the same path → succeeds (confirms `createProject`'s own `existsSync`/`isDirectory` check still passes after `makeDir`, i.e. no regression to the existing defense-in-depth check).

---

## 3. e2e / manual — `apps/web` (Playwright + manual /qa checklist)

Run against a built web + a test daemon pointed at a fresh temp directory tree (e.g. `mkdtempSync` with a few nested subfolders pre-created for browsing).

### 3.1 Happy path — folder browser (automate in Playwright; /qa executes step-by-step)
1. **TC-E1 Open dialog**: open Create Project dialog (S3 entry point) → confirm a `[Chọn…]` button is now rendered next to the `Đường dẫn repo` input (previously absent/dead).
2. **TC-E2 Open browser**: click `[Chọn…]` → a folder browser modal opens on top of the Create Project dialog, showing either the typed path (if already valid) or the daemon's home-dir default, with a list of subdirectory rows.
3. **TC-E3 Navigate down**: click a subdirectory row → modal re-lists that subdirectory's children; an "Up"/"Lên một cấp" row is present (since we navigated below the listing root).
4. **TC-E4 Navigate up**: click "Lên một cấp" → returns to the parent listing; the previously-visited subdirectory is shown again as a row, not auto-entered.
5. **TC-E5 Pick directory**: navigate into a target test directory, click `[Chọn thư mục này]` → browser modal closes, `Đường dẫn repo` input is populated with that absolute path, and the existing live-validation hint updates to `✓ Thư mục tồn tại · ...` within ~200ms (matches the existing debounce).
6. **TC-E6 Cancel browse**: re-open `[Chọn…]`, navigate a level or two, click `[Hủy]` → modal closes, `Đường dẫn repo` input is **unchanged** from before the browse session started.

### 3.2 Happy path — create-folder-if-missing
7. **TC-E7 Type non-existing path**: type a path that doesn't exist on disk into `Đường dẫn repo` → existing `✗ Thư mục không tồn tại` hint appears, AND a new `[Tạo thư mục này]` button is now rendered alongside it (previously this was a dead end). `[Tạo dự án]` remains disabled.
8. **TC-E8 Create folder**: click `[Tạo thư mục này]` → button shows a brief loading/disabled state, then the hint flips to `✓ Thư mục tồn tại · .claude/ chưa có`, and `[Tạo dự án]` becomes enabled.
9. **TC-E9 Full happy path**: after TC-E8, click `[Tạo dự án]` → project is created exactly as in the pre-existing S3 happy path (sidebar shows the new project, main shows `[+ Thêm agent] [+ Thêm workflow]`). **Assert on disk**: the typed directory now exists; no `.claude/`/`.symbion/store.json` write happened before this click (no premature writes from `listDir`/`makeDir` alone — only `makeDir` created the empty dir, `createProject` created `.symbion/store.json`).
10. **TC-E10 mkdir -p nested**: type a path with 2+ missing nested segments (e.g. `<tmp>/newroot/sub/leaf`) → click `[Tạo thư mục này]` → all intermediate dirs created, hint flips to `✓`, project creation proceeds normally.

### 3.3 Power/safety paths (manual + targeted Playwright)
- **TC-E11 (browse then .claude/ already present, §3.8)**: browse to and pick a directory that already has a `.claude/` folder on disk → hint shows `✓ Thư mục tồn tại · .claude/ đã có (xem xét Import)` exactly as the pre-existing manual-typed-path behavior (confirms no regression/divergence between the browse-set path and the typed path).
- **TC-E12 (browse then git repo)**: same as TC-E11 but for a directory with `.git/` → confirm `isGitRepo` consuming UI (if any) behaves identically whether the path arrived via typing or via `onPick`.
- **TC-E13 (re-click create-folder, idempotent)**: click `[Tạo thư mục này]` twice in quick succession (double-click) on the same not-yet-existing path → no error toast, ends in the same `✓` success state (covers TC-MD3 from the UI level).
- **TC-E14 (mkdir failure surfaced)**: type a path where an ancestor segment is an existing **file** (e.g. `<tmp existing-file>/child`) → click `[Tạo thư mục này]` → inline error message shown (reusing the existing error-text slot), dialog stays open, `[Tạo dự án]` stays disabled.
- **TC-E15 (permission-denied browse)**: browse into a directory the OS user can't read (chmod 000 test fixture, or `/root` if running unprivileged) → modal shows "Không có quyền đọc thư mục này" with only Up/Cancel available, no crash, no empty silent list mistaken for "no subdirectories."
- **TC-E16 (browser seeded from typed path)**: type a valid existing directory path manually first, then click `[Chọn…]` → browser modal opens already showing that directory's listing (not the home-dir default) — confirms the `initialPath` seed logic.
- **TC-E17 (daemon disconnect mid-browse)**: with the browser modal open, stop the daemon process → next navigation click shows an inline error, `[Hủy]` still closes the modal cleanly (no hang/crash).
- **TC-E18 (canCreate gate unaffected)**: confirm that simply opening (without picking/creating anything) and closing the folder browser, or canceling the create-folder action, leaves `[Tạo dự án]`'s enabled/disabled state exactly as it was before — no side effect from opening modals alone.

### 3.4 Negative / guard checks (/qa manual)
- Typing `..`-containing or non-absolute text directly into `Đường dẫn repo` is unaffected by this feature — the existing `validatePath` debounce still runs and still reports `exists:false` for nonsense input (no new code path bypasses existing validation).
- Confirm `apps/daemon/src/fs/folderPick.ts` (`browseFolder` stub) is untouched/still present and still returns `{cancelled:true}` if anything calls it — out of scope to remove, per locked scope.
- Confirm no `.symbion/backups/` directory is created as a side effect of `makeDir` alone (backup-before-write only applies to the existing managed-file write pipeline, not to creating an empty project-root directory).

---

## 4. Coverage gates (for /ship)
- `apps/daemon` integration test coverage: every new RPC handler (`listDir`, `makeDir`) has ≥1 happy-path test + ≥1 error-path test (TC-LD/TC-MD/TC-RPC sections above).
- All edge cases enumerated in STATE §3 (3.1–3.10) have at least one corresponding TC- id above.
- Playwright happy path (§3.1, §3.2) green in CI; power/safety paths (§3.3) at minimum manually signed off by /qa with the step-by-step checklist above.

## 5. Exit criteria
QA passes when: TC-E1–E10 fully green (folder browser + create-folder-if-missing both functional end-to-end); TC-LD/TC-MD/TC-RPC unit+integration suites green; no silent disk write observed from `listDir` (pure read) at any point; `makeDir` only ever creates the directory the user explicitly confirmed (no surprise writes to `.claude/`/`.symbion/`); existing S3 happy path (symbion-testplan.md §3.1 step 2) still passes unmodified for the already-existing-directory case (no regression).
