# Symbion — TEST PLAN (handoff for /qa)

> Companion to [`symbion-STATE.md`](./symbion-STATE.md) (PLAN). New separate project (NOT GeoChat). Stack: npm workspaces · `packages/core` (Vitest unit) · `apps/daemon` (Vitest integration against temp repos) · `apps/web` (Playwright e2e). Date: 2026-06-25.
> `/qa` executes §3 step-by-step. `/review` uses §4 of STATE + this plan as the acceptance bar.

Fixtures: copy GeoChat's real files into `packages/core/test/fixtures/claude/`:
- `agents/ba.md`, `agents/code-reviewer.md` (agent shape: `name/description/tools` CSV + body)
- `commands/analyze.md` (command shape: `description` + `$ARGUMENTS` body)
- `settings.json` (import read-only case)
- one deliberately broken file `agents/broken.md` (invalid YAML) for skip-path tests.

---

## 1. Unit tests — `packages/core` (Vitest, pure, no I/O)

### 1.1 Frontmatter serialize/parse
- `serializeFrontmatter` emits stable key order: agent → `name`, `description`, `tools`, then custom fields in insertion order.
- `tools` CSV byte format = `Read, Grep, Glob` (comma+space) — matches fixture `ba.md` exactly.
- `parseFrontmatter` round-trips: `parse(serialize(x)) deepEquals x` for agent and command IR.
- Command frontmatter contains `description` only — no `name`, no `tools`.

### 1.2 Render round-trip — Claude
- `renderArtifacts([agentIR],"claude")` for `code-reviewer` → byte-equal to fixture (modulo trailing managed marker).
- Parse fixture `ba.md` → IR → render → re-parse → IR equal (idempotent round-trip, NFR-3).
- Agent file path = `.claude/agents/<name>.md`; command path = `.claude/commands/<name>.md`.
- Custom fields render verbatim into frontmatter (e.g. `model: claude-opus-4`) and reparse into `customFields`.

### 1.3 Render round-trip — Codex (lossy merge)
- `render(allArtifacts,"codex")` → exactly ONE `RenderedFile` at `AGENTS.md`.
- Contains `## Agent: <name>` for each agent + `## Command: /<name>` for each command (commands flattened).
- Sections deterministically ordered (agents by name, then commands by name) → byte-stable across input reordering.
- Region fence markers present (`region-start`/`region-end`); foreign text passed around the fence is preserved verbatim.
- `capability.lossy === true`, `supportsCommands === false`, `supportsPerAgentFile === false`.

### 1.4 Marker + content-hash
- `buildMarker(id,kind,version,hash)` → `<!-- managed-by: symbion id=… kind=… v=… hash=… -->`; `parseMarker` recovers fields; foreign content → `parseMarker === null`.
- `contentHash` excludes the hash token itself; recomputing hash on the rendered file equals the marker hash.
- Two semantically-equal IRs (same fields, custom fields in same order) → same hash; any body/frontmatter change → different hash.

### 1.5 Diff + conflict classification
- new file (no on-disk) → status `new`.
- on-disk hash == marker hash, IR changed → status `update`.
- on-disk hash == marker hash, IR unchanged → status `same` (idempotency, AC-E2).
- on-disk hash != marker hash → status `conflict` (AC-E3).
- on-disk file with no marker → classified `foreign` → excluded from write set (AC-E1/E2).

### 1.6 Idempotency
- render→diff of unchanged IR against its own last-published output → ALL `same`; write set empty.

### 1.7 Custom-field passthrough
- Unknown custom keys preserved through parse→IR→render unchanged; ordering preserved (array model); never injected into `tools`.

### 1.8 Validation / lint (`validateArtifact`)
- missing `name`/`description` → error (blocks save).
- duplicate name same kind → error.
- filename-unsafe name → error.
- unknown tool → warning (allowed).
- command body without `$ARGUMENTS` while `usesArguments` → warning.
- command body @mentions agent not in set → warning (does not block).

### 1.9 Semver
- `bump("v0.2.0","patch"|"minor"|"major")` → `v0.2.1` / `v0.3.0` / `v1.0.0`; reject malformed.

### 1.10 Run-command render
- `renderRunCommand({command:"autoplan", requirements:"Add emoji reactions", model:"claude-opus-4-8", option:"--gate"})` → exact string `/autoplan Add emoji reactions [claude-opus-4-8] [--gate]`. Empty option/model omitted cleanly. Live re-render is pure (same input → same output).

---

## 2. Integration tests — `apps/daemon` RPC (Vitest, against temp repos)

Setup: each test creates a temp dir (`fs.mkdtemp`), optionally `git init`, runs the daemon's RPC handlers in-process (no network needed) or via a loopback server with a test token.

- **T1 createProject**: → writes `<tmp>/.symbion/store.json` (schemaVersion 1) + registers in a temp global config. Returns `ProjectStore`.
- **T2 validatePath**: existing dir → `{exists:true,isDir:true}`; with `.claude/` → `hasClaudeDir:true`; non-git → `isGitRepo:false`; missing → `exists:false`.
- **T3 scan → IR**: drop fixture `.claude/` into tmp → `scanClaudeDir` returns 2 agents, 1 command, settings(read-only), and `skipped` includes `broken.md` with a reason. `importArtifacts` writes them into store.json.
- **T4 scan→render→diff→write (happy path)**: import → `computeDiff(claude, v0.1.0)` → all `new` → `write` → assert `.claude/agents/*.md` + `.claude/commands/*.md` exist, byte-valid, contain markers; `.symbion/publish-log.json` appended; `meta.publishedHashes.claude` set.
- **T5 idempotent re-publish**: immediately re-run computeDiff → all `same`, write set empty (AC-E2).
- **T6 conflict path (AC-E3)**: hand-edit a written agent file (append text) → computeDiff → that file `conflict`, unchecked. `write` without resolution → file NOT overwritten. With `resolution:"overwrite"` → overwritten + new hash recorded.
- **T7 foreign file (AC-E1/E2)**: place an unmarked `.claude/agents/foreign.md` → never appears in write set, never modified.
- **T8 backup-before-write**: writing an existing managed file copies prior content to `.symbion/backups/<version>/.claude/agents/<name>.md` + manifest `BackupRecord`; new files recorded `existedBefore:false`.
- **T9 init `.claude/`**: tmp with no `.claude/` → write does `mkdir -p` and creates `agents/`+`commands/` (E13).
- **T10 Codex merge**: write `codex` target → single `AGENTS.md` with fenced managed region; pre-existing foreign content above the fence preserved after write.
- **T11 path confinement (E14)**: craft a write with relPath `../escape.md` or a symlink escaping project root → guard rejects, nothing written.
- **T12 partial failure (E10)**: make one target file unwritable (chmod) → `write` returns that file `error`, others `created/updated`; retry-only-failed re-attempts just the failed one.
- **T13 store migration**: write a store.json with older `schemaVersion` → load runs migrate chain → schemaVersion bumped, prior store backed up; newer-than-supported schemaVersion → refuses to write.
- **T14 gitStatus**: clean repo → `clean:true`; dirty → lists changed files; non-repo → `isRepo:false`.
- **T15 security**: RPC call missing/wrong token → 401; request with foreign `Origin`/`Host` → rejected; server bound to 127.0.0.1 (not 0.0.0.0).

---

## 3. e2e / manual — `apps/web` (Playwright + manual /qa checklist)

Run against a built web + a test daemon pointed at a fresh temp repo. The DESIGN beginner journey **S2→S3→S7→S8→S10→S11→S12** is the spine.

### 3.1 Happy path (automate in Playwright; /qa executes step-by-step)
1. **Boot/empty (S2)**: open web with 0 projects → centered card with exactly `[+ Tạo dự án]` + `[↧ Import .claude/ có sẵn]`. No sidebar/tabs/graph.
2. **Create project (S3)**: click Tạo → dialog with `Tên dự án` + `Đường dẫn repo` + `[Chọn…]`. Type temp repo path → live validation `✓ Thư mục tồn tại · .claude/ chưa có`. `[Tạo]` enabled → click → project appears in sidebar, main shows `[+ Thêm agent] [+ Thêm workflow]`.
3. **Add agent (S7)**: `+ Thêm agent` → right drawer, "Theo mô tả" tab, required fields only. Fill `name=code-reviewer`, `description`, tools `Read,Grep,Glob`, body. Live preview renders `.claude/agents/code-reviewer.md`. Linter `✓ frontmatter hợp lệ · filename khớp name`. `Lưu` → sidebar row with `·draft` dot. **Assert: temp repo `.claude/` still does NOT exist (no disk write).**
4. **Add workflow (S8)**: `+ Thêm workflow` → fields command `name` (→`/name`), `description`, body with `[Chèn $ARGUMENTS]`; @-mention the agent → "Agents tham chiếu: • code-reviewer ✓". `Lưu` → `·draft`.
5. **Publish config (S10)**: `[Xuất bản]` → version `v0.1.0`, target Claude checked, Codex unchecked captioned lossy. `[Xem trước thay đổi]`.
6. **Diff preview (S11)**: lists `+ .claude/agents/code-reviewer.md`, `+ .claude/commands/<cmd>.md`, green added lines, note "Sẽ khởi tạo .claude/", no conflicts, write button enabled. `[Ghi xuống đĩa]`.
7. **Result (S12)**: toast "Đã ghi 2 file"; `2 file tạo mới · 0 lỗi · Sao lưu: .symbion/backups/v0.1.0/`. Draft dots clear → "đã xuất bản v0.1.0". **Assert on disk: both files exist, byte-valid, parseable, contain managed markers.**

### 3.2 Power/safety paths (manual + targeted Playwright)
- **Form↔Markdown sync**: flip to "Theo markdown", edit raw frontmatter (valid) → flip back to Form → change reflected. Make YAML invalid → validity line red, Save disabled, "Adopt into form" not offered until valid; switching to Form prompts confirm (no silent clobber).
- **Custom fields (S9)**: expand "Nâng cao", add `model`/`temperature` → warning shown; preview shows them with "(custom)" tag. Re-publish → fields present in frontmatter, round-trip intact.
- **Re-publish unchanged (AC-E2)**: open Publish again, same version → diff all `=`, button "Không có gì để ghi" disabled.
- **Conflict (AC-E3)**: hand-edit `.claude/agents/code-reviewer.md` on disk → Publish → that file shows `! XUNG ĐỘT`, unchecked, blocks write. Resolve `[Ghi đè]` → writes; resolve `[Giữ bản trên đĩa]` → skipped, stays as edited.
- **Codex lossy**: tick Codex → lossy amber badge + CapabilityMatrix (`cmd ✗⚠`) + "Tôi hiểu" acknowledge required → publish writes single fenced `AGENTS.md`, foreign content preserved.
- **Import (S4)**: Import CTA → point at a repo with fixture `.claude/` → scan preview shows counts + `⚠ broken.md không parse được → bỏ qua` (unchecked). Import selected → artifacts populate sidebar.
- **Graph (S6)**: open Sơ đồ → read-only nodes (cmd indigo / agent violet), command→agent edge from @mention; a command referencing a missing agent shows red edge + lint banner `⚠ … (không tồn tại)`. No node creation/edge dragging.
- **Copy run command (S13, AC-R1)**: command row menu → modal; set Requirements/Model/option → live prompt box updates → `[Copy]` → toast. Verify clipboard contents == previewed string. No process spawned.
- **Daemon disconnect (E9)**: kill daemon → red blocking banner, write/publish/save disabled, in-memory edits still browsable; restart → auto-reconnect → actions re-enabled.

### 3.3 Negative / guard checks (/qa manual)
- Duplicate agent name same kind → red border + Save disabled.
- Unknown tool typed → amber chip, still saveable.
- Publish with path-confinement attempt impossible via UI (covered by daemon T11).
- Non-git repo → publish still allowed; gitStatus shows non-repo; `requireCleanGit` off by default.

---

## 4. Coverage gates (for /ship)
- `packages/core` line coverage ≥ 90% (it is pure; this is the correctness spine).
- All RPC methods in STATE §4 have ≥1 integration test; all of E1–E15 covered (unit or integration).
- Playwright happy path (3.1) green in CI; power/safety paths (3.2) at least manually signed off by /qa with the step-by-step checklist.

## 5. Exit criteria
QA passes when: 3.1 fully green; AC-E1/E2/E3, AC-A1/A2, AC-W1, AC-R1 each demonstrably met; no silent disk write observed at any point before S11 `[Ghi xuống đĩa]`; backups present after every write; foreign files untouched.
