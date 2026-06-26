# Symbion — Design (canonical, unified)

> Phase **DESIGN** (output of `/design`, synthesized from 3 angles: minimalist · rich · progressive).
> Locked spec: [`docs/symbion-analyze.md`](../symbion-analyze.md). Do NOT re-litigate v1 scope.
> Symbion = NEW separate **desktop-class web tool** (local daemon + web UI on `localhost:PORT`) to author AI-coding "autoworkflows" (slash-command + subagent `.md`) and export them into target repos' `.claude/` (+ `AGENTS.md` for Codex). **NOT GeoChat, no map, not mobile-first.** Tailwind + shadcn/ui. Graph via React Flow (read-only).
> Date: 2026-06-25.

---

## 0. Chosen approach (why this blend)

The three designers converged hard; differences were taste, not direction. The canonical design takes:

- **Spine = Progressive disclosure.** A first-timer sees the absolute minimum (Create/Import → form with only required fields → publish to Claude). Power features (raw markdown, dependency graph, multi-target batch publish, custom fields, Cmd-K) reveal on demand. This is the right metaphor for a dev tool and it cleanly resolves the **Temperature/Model tension** (those become hidden "Nâng cao" custom fields, never first-class).
- **Discipline = Minimalist.** Builders open as a right **Sheet/drawer** (keep project context, fast in/out), single persistent shell, **never write to disk without a diff first**, keyboard-friendly, density over decoration.
- **Two earned "rich" moments.** Only two surfaces get expressive treatment because they carry real meaning: the **dependency graph** (node badges, hover detail, per-target lossy ribbon) and the **publish diff viewer** (staggered reveal, conflict resolver). Everything else stays calm.

Design principles (set the precedent for this new repo):
1. **The artifact is the truth.** Form tab and Markdown tab are two views of ONE in-memory `CanonicalArtifact`. Switching tabs never drops content.
2. **Never write silently.** Publish is the one disk-touching action; always gated behind a diff. Conflicts (hand-edited files) block write until resolved.
3. **Honesty over polish.** Lossy compiles + conflicts surfaced with explicit warnings, never hidden ("honesty as product" — spec idea #1).
4. **Save ≠ Publish.** "Lưu" writes to the in-app model only; "Xuất bản" writes files. UI teaches this distinction gently.
5. **Vietnamese UI labels** (Quy trình, Thêm workflow, Xuất bản, Cấu hình); **English for literal tokens** (`name`, `tools`, `$ARGUMENTS`, `.claude/`, frontmatter keys).

---

## 1. User Journey

### 1A. Beginner happy path (first launch → first published Claude workflow)
1. **Boot.** `npm start` → terminal boot menu (Web UI / Terminal UI / Hide to Tray / Exit) showing daemon URL. Pick **Web UI** → browser opens `localhost:PORT`.
2. **Empty state (0 projects).** One centered card, exactly two CTAs: **[+ Tạo dự án]** and **[↧ Import .claude/ có sẵn]**. No sidebar, no tabs, no graph.
3. **Create project.** Dialog with two fields only: **Tên dự án** + **Đường dẫn repo** (with **[Chọn…]** daemon folder picker + live path validation). [Tạo] disabled until valid.
4. **Project shell.** Sidebar shows project under *Quy trình/Dự án* with sub-lists Workflows + Agents + a *Cấu hình* section. Main area empty-state: two buttons **[+ Thêm agent] [+ Thêm workflow]**.
5. **Add agent.** Right **drawer** opens on **"Theo mô tả" (Form)** tab showing ONLY required fields: `name`, `description`, `tools` multi-select, body. Live `.md` preview on the right updates as you type. Advanced/custom fields hidden behind collapsed **"Nâng cao" / [+ Thêm field]**. Save → agent appears in sidebar with a `·draft` dot. **Nothing written to disk yet.**
6. **Add workflow (command).** Same drawer pattern. Form fields: command name (→ `/name`), `description`, body (with `[Chèn $ARGUMENTS]` helper). Body @-mentions / names agents → feeds the graph. Save → `·draft` dot.
7. **Publish.** Click **[Xuất bản]** → publish panel. Beginner pre-selects version `v0.1.0` + target **Claude** only (Codex present, unchecked, captioned "gộp vào AGENTS.md · lossy"). Click **[Xem trước thay đổi]**.
8. **Diff preview.** Lists files to create (`.claude/agents/<name>.md`, `.claude/commands/<name>.md`), green added-lines diff, note "Sẽ khởi tạo .claude/". No conflicts. Click **[Ghi xuống đĩa]** → toast "Đã ghi 2 file". Draft dots clear → "đã xuất bản v0.1.0".
9. **Copy run command (optional).** Row menu → modal renders structured prompt (`/<cmd> [Requirements][Model][option]`) live → **[Copy]** → toast. No execution (v1).

### 1B. Power-user path (returning, 10th time)
1. App opens straight into **last-used project** (no empty state).
2. **Cmd/Ctrl+K** command palette: Thêm agent/workflow, Xuất bản, chuyển dự án, mở graph, jump-to-artifact. Rarely touches the sidebar.
3. Opens an artifact, flips to **"Theo markdown"** tab to hand-edit raw frontmatter+body. Fields the form can't represent show read-only under "Custom fields" (round-trip fidelity, NFR-3).
4. Opens **dependency graph** to audit command→agent wiring; spots a lint warning (command references a missing agent → red edge), jumps to fix.
5. **Batch publish:** ticks **Claude + Codex**, bumps to `v0.3.0`, reviews combined diff incl. a **conflict** (hand-edited file, marker hash mismatch) → resolves [Giữ bản trên đĩa]/[Ghi đè]/[Xem diff], then writes.
6. Consults **capability matrix**: Codex has no command primitive → commands flatten lossily into `AGENTS.md` (amber badge, acknowledge).

---

## 2. Screen Inventory

| # | Screen / surface | Type | Entry trigger | Exit path | Disclosure |
|---|---|---|---|---|---|
| S0 | Terminal boot menu | TUI (pre-web) | `npm start` | Web UI → browser; Terminal/Tray/Exit | always |
| S1 | App shell (sidebar + main) | persistent layout | Web UI opens | always present | all |
| S2 | App empty state (0 projects) | main-area state | fresh boot | Tạo/Import | beginner |
| S3 | Create Project | Dialog | `+` / empty-state CTA | Tạo → S4 / Hủy | beginner |
| S4 | Import `.claude/` (path + scan preview) | Dialog | Import CTA / Cmd-K | Nhập → S4 / Hủy | beginner→power |
| S5 | Project view — Danh sách (agents + workflows) | main-area tab | select project | switch tab / drawer / publish | all |
| S6 | Project view — Sơ đồ phụ thuộc (graph) | main-area tab | "Sơ đồ" tab / Cmd-K | back to list / jump-to-node | power |
| S7 | Agent builder (drawer, 2 tabs + live preview) | right Sheet | + Thêm agent / edit | Lưu / Hủy (Esc) | beginner(form)→power(md) |
| S8 | Workflow builder (drawer, 2 tabs + live preview) | right Sheet | + Thêm workflow / edit | Lưu / Hủy | beginner→power |
| S9 | "Nâng cao" custom-fields region (within S7/S8) | collapsible | expand / + Thêm field | collapse | power |
| S10 | Publish — config (version + targets) | Dialog/Sheet step 1 | Xuất bản | Xem diff / Hủy | all |
| S11 | Publish — diff preview + conflict resolve | step 2 (wide) | Xem trước thay đổi | Ghi xuống / Quay lại / Hủy | all |
| S12 | Publish — result | step 3 | after write | Xong / retry failed | all |
| S13 | Copy run command | Dialog | row menu / Cmd-K | Copy / Đóng | all |
| S14 | Cấu hình (settings: project + export defaults + app) | main-area panel | sidebar Cấu hình | save / leave | all |
| S15 | Command palette (Cmd-K) | overlay | `Cmd/Ctrl+K` | run / Esc | power |

Conflict resolution + version history live **within** S11/S10 in v1 (not separate top-level screens).

---

## 3. ASCII Wireframes (desktop / wide)

### S0 — Terminal boot menu
```
========================================
  Symbion — Choose Interface (v0.1.0)
  Server: http://localhost:20128
========================================
  > Web UI (Open in Browser)
    Terminal UI (Interactive CLI)
    Hide to Tray (Background)
    Exit
----------------------------------------
  ↑/↓ move   Enter select   q quit
```

### S1 + S2 — App shell + empty state (0 projects)
```
┌──────────────────────────┬───────────────────────────────────────────────────────┐
│ Symbion      ⌘K  │  (no project selected)                            ◑    │
├──────────────────────────┤                                                         │
│ QUY TRÌNH / DỰ ÁN     [+]│            ┌───────────────────────────────┐           │
│   ∅ chưa có dự án        │            │   Chưa có dự án nào            │           │
│ ── ── ── ── ── ── ── ──  │            │   Tạo mới hoặc nhập .claude/   │           │
│ CẤU HÌNH                 │            │   [ + Tạo dự án ]             │           │
│   ⚙ Cài đặt chung        │            │   [ ↧ Import .claude/ có sẵn ] │           │
│                          │            └───────────────────────────────┘           │
│ daemon ● connected :20128│              tip: ⌘K mở command palette                 │
└──────────────────────────┴───────────────────────────────────────────────────────┘
```

### S3 — Create Project (Dialog)
```
        ┌──────────────────────────────────────────┐
        │  Tạo dự án mới                        [×] │
        ├──────────────────────────────────────────┤
        │  Tên dự án                                │
        │  ( My API Service................. )      │
        │  Đường dẫn repo                           │
        │  ( /home/me/code/my-service ...) [ Chọn…] │
        │  ✓ Thư mục tồn tại · .claude/ chưa có     │
        │                  [ Hủy ]   [ Tạo dự án ]  │
        └──────────────────────────────────────────┘
```
Path line = live daemon validity check (exists? has `.claude/` already → offer Import).

### S4 — Import `.claude/` (Dialog with scan preview)
```
        ┌────────────────────────────────────────────────────┐
        │  Import .claude/ từ repo                       [×] │
        ├────────────────────────────────────────────────────┤
        │  Repo path ( /home/me/code/geochat ..) [ Chọn… ]  │
        │  ── Scan preview ─────────────────────────────────│
        │   ✓ 6 agents     ba, feature-builder, code-review… │
        │   ✓ 14 commands  analyze, design, plan, build…     │
        │   ✓ 2 hooks      careful.sh, guard.sh (read-only)  │
        │   ⚠ 1 file foo.md không parse được → bỏ qua        │
        │  [x] agents (6)  [x] commands (14)  [ ] settings   │
        │                  [ Hủy ]   [ Nhập 20 mục đã chọn ] │
        └────────────────────────────────────────────────────┘
```
Invalid files unchecked-by-default. settings/hooks import read-only in v1.

### S5 — Project view: Danh sách
```
┌──────────────────────────┬───────────────────────────────────────────────────────┐
│ Symbion      ⌘K  │  my-service   ~/code/my-service                         │
├──────────────────────────┤  [ Danh sách ][ Sơ đồ ]        [↧ Nhập] [ Xuất bản ▸ ] │
│ QUY TRÌNH / DỰ ÁN     [+]│ ───────────────────────────────────────────────────────│
│ (search… )               │  WORKFLOWS / COMMANDS (3)          [ + Thêm workflow ]   │
│ ▾ my-service        ◀ sel│   ● /analyze   3 BA agents song song…            ⋯       │
│    ▾ Workflows (3)       │   ● /build     feature-builder…                  ⋯       │
│    ▾ Agents     (2)      │   ○ /review    code-reviewer…             ·draft  ⋯       │
│   billing-svc            │ ───────────────────────────────────────────────────────│
│ ── ── ── ── ── ── ── ──  │  AGENTS (2)                            [ + Thêm agent ] │
│ CẤU HÌNH                 │   ● ba            Read,Grep,Glob,Write           ⋯       │
│   ⚙ Cài đặt chung        │   ● code-reviewer Read,Grep,Glob                 ⋯       │
│                          │ ───────────────────────────────────────────────────────│
│ daemon ● connected       │  2 mục chưa xuất bản · lần cuối: v0.2.0 (2h trước)      │
└──────────────────────────┴───────────────────────────────────────────────────────┘
```
`●`=published/in-sync, `○ ·draft`=local unpublished. `⋯` row menu: Edit / Copy run command (commands) / Duplicate / Delete.

### S6 — Project view: Sơ đồ phụ thuộc (read-only graph) — earned "rich"
```
┌──────────────────────────┬───────────────────────────────────────────────────────┐
│ … sidebar …              │  my-service                  [ Danh sách ][ Sơ đồ ]    │
│                          │  Targets: ● Claude (clean)  ▲ Codex (3 cmds→AGENTS.md) │ ← lossiness ribbon
│                          │ ───────────────────────────────────────────────────────│
│                          │  ⚠ 1 lint: /review → agent "ship" (không tồn tại)       │
│                          │    ┌───────────┐  spawns  ┌──────────┐                  │
│                          │    │⌘ /analyze │─────────▶│◆ ba  ⚓   │  (cmd=indigo,    │
│                          │    │ ⚓ v0.2 ▲cx│──┐       └──────────┘   agent=violet)  │
│                          │    └───────────┘  └──────▶┌──────────┐                  │
│                          │    ┌───────────┐          │◆ code-rev│                  │
│                          │    │⌘ /review  │──▶ ╳ship  │   ✎      │ ✎=hand-edited    │
│                          │    └───────────┘  (đỏ)     └──────────┘                  │
│                          │   ⓘ legend  [fit⤢][−][+][⟲]   (read-only · 2click→edit)│
└──────────────────────────┴───────────────────────────────────────────────────────┘
```
Hover node → detail card (frontmatter summary, tools, "used by", per-target status, [Open in editor]). Edges derived from agent refs in command bodies. No node creation / edge dragging.

### S7 — Agent builder (right drawer), tab "Theo mô tả" — BEGINNER
```
                  ┌──────────────────────────────────────────────────────────┐
 (project dimmed  │  Thêm agent                              [ Hủy ] [ Lưu ] │
  behind)         │  → sẽ tạo: .claude/agents/code-reviewer.md               │
                  ├──────────────────────────────────────────────────────────┤
                  │ [ Theo mô tả ]  [ Theo markdown ]                         │
                  ├───────────────────────────────┬──────────────────────────┤
                  │ FORM (chỉ field bắt buộc)     │ XEM TRƯỚC (.md)          │
                  │ name *  ( code-reviewer )     │ ---                      │
                  │   ✓ hợp lệ · không trùng      │ name: code-reviewer      │
                  │ description * ( Independent…) │ description: Independent…│
                  │ tools  [Read×][Grep×][Glob×][+]│ tools: Read, Grep, Glob  │
                  │ Nội dung (system prompt)      │ ---                      │
                  │ ┌───────────────────────────┐ │ You are the reviewer…    │
                  │ │ You are the reviewer…     │ │ ── linter ──             │
                  │ └───────────────────────────┘ │ ✓ frontmatter hợp lệ     │
                  │ ▸ Nâng cao        [+ Thêm field]│ ✓ filename khớp name    │
                  └───────────────────────────────┴──────────────────────────┘
```
Workflow builder (S8) mirrors this: fields = command name (→`/name`), `description`, `[Chèn $ARGUMENTS]` body; preview shows `.claude/commands/<name>.md` + "Agent được nhắc tới: • code-reviewer ✓".

### S9 — "Nâng cao" expanded (custom fields — Temperature/Model tension resolved)
```
│ ▾ Nâng cao  (2)          [+ Thêm field]                                     │
│ ┌─────────────────────────────────────────────────────────────────────────┐│
│ │ ⚠ Field tùy chỉnh — KHÔNG phải frontmatter chuẩn của Claude. Claude Code  ││
│ │   sẽ bỏ qua. Chỉ thêm nếu provider khác của bạn cần.                      ││
│ │   key ( model       ) value ( claude-opus-4 )   [×]                       ││
│ │   key ( temperature ) value ( 0.2 )             [×]                       ││
│ └─────────────────────────────────────────────────────────────────────────┘│
```
Preview renders these in frontmatter with a subtle "(custom)" tag. Beginners never see them; power users round-trip them verbatim.

### S7b/S8b — Markdown tab "Theo markdown" — POWER
```
                  │ [ Theo mô tả ]  [▣ Theo markdown ]                        │
                  ├──────────────────────────────────┬───────────────────────┤
                  │ MARKDOWN (paste/edit raw)        │ PREVIEW (parsed→IR)   │
                  │  1 ---                           │ ✓ parsed: agent       │
                  │  2 name: code-reviewer           │ refs: —               │
                  │  3 description: Independent…     │ ⚠ paste khác form →   │
                  │  4 tools: Read, Grep, Glob       │   [ Adopt into form ] │
                  │  5 ---                           │                       │
                  │  6 You are the reviewer…         │                       │
                  │ [ Chèn scaffold ▾ ]              │                       │
                  │ ✓ frontmatter hợp lệ · 3 tools · round-trip OK            │
```

### S10 — Publish config (step 1) — beginner Claude-only; power multi-target
```
        ┌────────────────────────────────────────────────────┐
        │  Xuất bản — my-service                         [×] │
        ├────────────────────────────────────────────────────┤
        │  Version ( v0.3.0 )  ○patch ◉minor ○major ○tùy ý   │
        │  Target                                             │
        │   [x] Claude  → .claude/agents + .claude/commands  │
        │   [ ] Codex   → AGENTS.md (gộp) ⚠ lossy: no command│
        │  ── Ma trận khả năng (hiện khi >1 target) ──        │
        │   Claude: cmd ✓ · per-agent ✓ · .md                │
        │   Codex : cmd ✗⚠ · per-agent ✗ · AGENTS.md gộp     │
        │  Phạm vi: 2 agents, 3 commands · 5 file sẽ xét      │
        │                  [ Hủy ]   [ Xem trước thay đổi → ] │
        └────────────────────────────────────────────────────┘
```

### S11 — Publish diff preview + conflict (step 2, wide) — earned "rich"
```
┌───────────────────────────────────────────────────────────────────────────────────┐
│  Xuất bản v0.3.0 → Claude · my-service                                        [×]  │
├──────────────────────────┬────────────────────────────────────────────────────────┤
│ FILES (5)                │  .claude/agents/ba.md                     ⚠ XUNG ĐỘT    │
│ [x] + commands/build.md  │  managed-by marker hash ≠ on-disk (đã sửa tay sau v0.2) │
│ [x] ~ commands/analyze   │ ───────────────────────────────────────────────────────│
│ [ ] ! agents/ba.md  ⚠    │   - tools: Read, Grep                                   │
│ [x] = agents/code-rev =  │   + tools: Read, Grep, Glob          ← bản Studio       │
│ ───────────────────────  │     <!-- managed-by: symbion id=ba v=0.3.0 -->         │
│ +1 new ~1 upd            │  ⚠ Studio sẽ KHÔNG đè im lặng. Chọn:                    │
│ !1 conflict =1 same      │  ( ) Giữ bản trên đĩa  ( ) Ghi đè  ( ) Xem diff 3 bên   │
├──────────────────────────┴────────────────────────────────────────────────────────┤
│ ⚠ 1 xung đột cần giải quyết.   [ ‹ Quay lại ]  [ Hủy ]  [ Ghi 3 file đã chọn → ]   │
└───────────────────────────────────────────────────────────────────────────────────┘
```
Glyphs: `+` new (checked), `~` update (checked), `=` unchanged (no checkbox, proves idempotency AC-E2), `!` conflict (UNCHECKED, blocks write until resolved). Diff slides in with staggered line reveal. Re-publish unchanged → all `=`, button "Không có gì để ghi" disabled.

### S12 — Publish result
```
        ┌────────────────────────────────────────────────────┐
        │  ✓ Đã xuất bản v0.3.0 → Claude                 [×] │
        ├────────────────────────────────────────────────────┤
        │   2 file tạo mới · 1 cập nhật · 1 bỏ qua (conflict) │
        │   0 lỗi   ·   Sao lưu: .symbion/backups/v0.3.0/   │
        │                                  [ Xong ]           │
        └────────────────────────────────────────────────────┘
```
Partial failure → failed rows red + [Thử lại các file lỗi]; succeeded not re-attempted.

### S13 — Copy run command
```
        ┌────────────────────────────────────────────────────┐
        │  Copy run command — /autoplan                  [×] │
        ├────────────────────────────────────────────────────┤
        │  [Requirements] ( Add emoji reactions to chat   )   │
        │  [Model] ( claude-opus-4-8 ▾ )  [option] ( --gate )│
        │  Lệnh sẽ tạo (xem trước, read-only):                │
        │  ┌─────────────────────────────────────────────┐   │
        │  │ /autoplan Add emoji reactions to chat        │   │
        │  │ [claude-opus-4-8] [--gate]                   │   │
        │  └─────────────────────────────────────────────┘   │
        │                         [ Đóng ]   [ ⧉ Copy ]      │
        └────────────────────────────────────────────────────┘
```
Live re-render on field change. Copy → toast. No execution (v1).

### S14 — Cấu hình
```
┌──────────────────────────┬───────────────────────────────────────────────────────┐
│ … (Cấu hình selected)    │  Cài đặt                                    [ Lưu ]    │
├──────────────────────────┤  Project: Name ( my-service )  Path ( ~/… ) [Chọn]    │
│                          │  Export mặc định: [x] Claude [ ] Codex                 │
│                          │  Managed marker: <!-- managed-by: symbion … -->       │
│                          │  Khi xung đột: ◉ cảnh báo & hỏi  ○ không bao giờ đè    │
│                          │  [x] Sao lưu trước mỗi lần ghi  [ ] yêu cầu git sạch   │
│                          │  App: Theme ( System ▾ )  Daemon port ( 20128 )        │
│ daemon ● connected       │                                                        │
└──────────────────────────┴───────────────────────────────────────────────────────┘
```

### S15 — Command palette (Cmd-K)
```
        ┌─────────────────────────────────────────────────┐
        │ ⌘K  ( Gõ lệnh hoặc tìm artifact…             )  │
        ├─────────────────────────────────────────────────┤
        │  Hành động: + Thêm agent ⌘⇧A · + Thêm workflow  │
        │             ↥ Xuất bản ⌘⇧P · Copy run command   │
        │             ↧ Import · ⌗ Mở graph               │
        │  Đi tới:   ◆ ba (agent) · ⌘ /analyze (command)  │
        │  Dự án:    my-service ⌘1 · billing-svc ⌘2       │
        └─────────────────────────────────────────────────┘
```

---

## 4. Component Breakdown

> shadcn primitives by registry name; "new" = Symbion-specific. Contracts are interface sketches for `/plan`. `packages/core` owns the IR; `apps/web` components consume it via typed daemon RPC. No implementation here.

### Shell & nav
- **`AppShell`** (new) — persistent layout (shadcn `ResizablePanelGroup`). State: `activeProjectId`, `view: "list"|"graph"|"settings"`, `daemonStatus`.
- **`ProjectSidebar`** (new) — shadcn `Sidebar` + `Collapsible` + `ScrollArea`. Props: `{ projects, activeProjectId, onSelectProject, onCreateProject, onOpenSettings, daemonStatus }`. Sections *Quy trình/Dự án* (collapsible per-project Workflows/Agents) + *Cấu hình*.
- **`ArtifactRow`** (new) — `{ kind:"agent"|"command", name, summary, status:"synced"|"draft", hasLintWarning }`, callbacks `onEdit/onCopyRunCommand(cmd only)/onDuplicate/onDelete`. shadcn `DropdownMenu` for `⋯`.
- **`DaemonStatusBadge`** (new) — `{ status, port }`. shadcn `Badge`.
- **`CommandPalette`** (new) — shadcn `CommandDialog` (cmdk). `{ actions, artifacts, projects, onRun }`, global `Cmd/Ctrl+K`.
- **`Toaster`** — shadcn `Sonner` (imported/published/copied/errors).

### Project view + graph
- **`ProjectView`** (new) — shadcn `Tabs` (Danh sách / Sơ đồ). Header `{ name, path, pendingCount, lastPublishedVersion }` + `onImport/onPublish`.
- **`ArtifactGroup`** (new) — `{ title, kind, items, onAdd }`. shadcn `Collapsible`.
- **`DependencyGraph`** (new, wraps **React Flow** read-only: `nodesDraggable=false`, `nodesConnectable=false`). `{ nodes:GraphNode[], edges:GraphEdge[], targets:TargetCapability[], onNodeOpen }`. Sub: `CommandNode`/`AgentNode` (kind color + status badges), `NodeDetailCard` (shadcn `HoverCard`), `GraphControls`, `GraphLegend`, `LossinessRibbon` (shadcn `Alert`), `LintBanner`.

### Builders (progressive-disclosure core)
- **`BuilderDrawer`** (new) — shadcn `Sheet` (right) + `Tabs` (Theo mô tả / Theo markdown). `{ mode:"create"|"edit", kind:"agent"|"command", initial?:CanonicalArtifact, onSave, onCancel }`. **Owns form↔markdown sync against one IR.** Shows "→ sẽ tạo: <path>" hint. Default tab = Form for new users, persists last-used per user.
- **`AgentForm`** (new) — required `name`/`description`/`tools[]`/`body`. `ToolsMultiSelect` (new; shadcn `Command`+`Badge` chips, CSV render), `CustomFieldsEditor` inside `AdvancedFieldsSection`.
- **`WorkflowForm`** (new) — command `name` (→`/name`), `description`, body with `[Chèn $ARGUMENTS]`; `BodyEditorWithMentions` (new) detects agent refs → graph edges + "Agents tham chiếu" chips.
- **`AdvancedFieldsSection`** (new) — shadcn `Collapsible` "Nâng cao". `{ customFields:Record<string,string>, onChange }` + standing non-standard warning. **Home of Temperature/Model.**
- **`MarkdownTab`** (new) — raw `.md` editor + `[Chèn scaffold ▾]`. `{ value, onChange, parse:(raw)=>{artifact,errors} }`. Valid parse → sync back to form; `AdoptIntoForm` chip when diverged. v1: mono `Textarea` ok; code editor = open Q #2.
- **`LivePreviewPane`** (new) — `{ renderedFile, target }` read-only, debounced ~150ms, frontmatter highlighted, custom fields tagged "(custom)".
- **`LinterPanel`** (new) — `{ issues:LintIssue[] }`; errors disable Save, warnings don't.

### Publish & diff
- **`PublishDialog`** (new, S10) — `{ project, suggestedVersion, targets:TargetCapability[], onComputeDiff }`. Sub: `VersionPicker` (semver toggle), `TargetToggle` (lossy chip), `CapabilityMatrix` (shadcn `Table`, shown when >1 target).
- **`PublishDiffView`** (new, S11) — `{ files:DiffFile[] (path,status,hunks,managedMarkerOk), selected, onToggle, onResolveConflict(path,choice), onWrite }`. Sub: `DiffFileList`, `DiffHunkViewer` (staggered reveal), `ConflictResolver` (Giữ/Ghi đè/Xem diff — blocks write).
- **`PublishResult`** (new, S12) — `{ summary:{created,updated,skipped,errors,backupPath} }` + retry-failed.

### Modals / settings / import
- **`CreateProjectDialog`** (new) — `{ onCreate({name,path}), onPickFolder():Promise<string>, validatePath:(p)=>{exists,hasClaudeDir} }`.
- **`ImportDialog`** (new) — `{ onScan(path):Promise<ParsedClaudeDir>, onImport(selected) }`; invalid files unchecked-by-default.
- **`CopyRunCommandDialog`** (new) — `{ command, models, options, renderPrompt(input)=>string, onCopy }`; live read-only prompt box.
- **`SettingsPanel`** (new) — `{ settings:GlobalSettings, daemonStatus, onSave }`.
- **`EmptyState`** (new, shared) — no-projects / empty-project / empty-graph / no-results.

### Cross-cutting state contracts (for `/plan`)
- **`useDaemonRpc`** — typed localhost client: `browseFolder`, `validatePath`, `scanClaudeDir`, `render`, `computeDiff`, `write`, `gitStatus`. All disk effects go through it; nothing writes without explicit `write`.
- **`useArtifactStore`** — in-memory IR per project (`CanonicalArtifact[]`), dirty tracking, derived graph nodes/edges + lint. **Single source of truth → form/markdown tab sync.**
- **`useExportPreview`** — `targets + IR` → `FileChange[]` + conflicts (daemon render+diff). Drives PublishDialog.

---

## 5. Interaction Notes

### Disclosure & mode
- First-run: `projects.length===0` → `EmptyState` only (no sidebar). ≥1 project → full shell, open last-used project.
- Builder default tab = Form for new users; persist last-used per user (power users land on Markdown). Toggle always one click.
- "Nâng cao" + `[+ Thêm field]` start collapsed; show count on header if custom fields exist ("Nâng cao (2)").
- Keyboard shortcuts not advertised to beginners; discoverable via palette + tooltips.

### Loading
- Daemon connecting: badge amber "đang kết nối…" → green "ok". Down → blocking banner "Mất kết nối daemon — thao tác ghi tạm khoá [Thử lại]"; all write/publish/save disabled (reads from cached model still browsable); auto-reconnect backoff.
- Path validation / folder pick: inline spinner → ✓/✗.
- Import scan / diff compute / write: skeletons + spinners; "Đang tính diff…"; per-file `pending→written` ticks.
- Live preview debounced ~150ms.

### Empty states
- App: two CTAs. Project: two add buttons. Graph: "Chưa có phụ thuộc nào — edge xuất hiện khi command body nhắc tên agent." No empty canvas frame.

### Validation (NFR-4 — catch before write)
- `name`: required, filename-safe, live duplicate check (same kind) → bad = red border, Save disabled. Filename derived from `name`; mismatch flagged.
- `tools`: chips from known list; unknown typed tool → amber warning chip but allowed (forward-compat).
- Markdown tab: invalid YAML/frontmatter → validity line red, sync-back paused, Save disabled; form keeps last-good (switching back asks confirm, never silent clobber).
- Command @mention to non-existent agent → amber chip + graph lint; does NOT block save.

### Form ↔ Markdown sync
- Single source of truth = in-memory `CanonicalArtifact`. Form edits update directly; markdown edits parse→update when valid. Markdown unparseable on switch-to-Form → confirm "dùng bản hợp lệ gần nhất?".

### Publish / conflict (the safety flow — AC-E1/2/3)
- Never write without S11. Write button disabled if 0 files checked.
- `!` conflict = on-disk marker missing or hash ≠ last publish → hand-edited. Per-file choice: **Giữ bản trên đĩa** (default skip) / **Ghi đè** / **Xem diff 3 bên**. Write blocked until all conflicts resolved.
- Files with no managed marker (foreign) → never touched, not in write set (optionally shown muted "không do Studio quản lý").
- Codex target → lossy badge; commands rendered as merged into `AGENTS.md`, acknowledge "Tôi hiểu".
- Re-publish unchanged → all `=`, "Không có gì để ghi" disabled (proves idempotency).
- Partial failure → per-file retry; backup path shown (reversible, NFR-2).

### Save ≠ Publish (teach gently)
- After Save: subtle caption "Đã lưu vào Studio (chưa ghi xuống đĩa)" + `·draft` dot + pending count++. Publish clears it.

### Copy run command (AC-R1)
- Prompt re-renders live; Copy → "Đã copy" check + toast; clipboard-blocked fallback = select text + "Nhấn ⌘C". Never executes.

### Micro-interactions (kept minimal; rich only on graph + diff)
- Graph node hover: lift + highlight connected edges, dim unrelated. 2click node → open builder.
- Diff: staggered line reveal on file select. Lossy chip amber pulse when toggling Codex.
- Save: row slides into sidebar with brief highlight; counts increment.
- All transitions respect `prefers-reduced-motion`.

---

## 6. Open Design Questions (taste calls — NOT guessed)

1. **Builder surface.** Proposed: right **Sheet/drawer** (keeps project context, fast for adding several in a row). Alternative: full-page route (more room for long prompts / live preview). Which?
2. **Body/markdown editor richness.** v1 default = mono `Textarea` (minimal). Upgrade to a real code editor (CodeMirror/Monaco: YAML highlight, @-mention autocomplete, line refs for linter) — yes/no? Biggest minimal-vs-rich call.
3. **Custom fields (Temperature/Model).** Proposed: passthrough custom frontmatter behind "Nâng cao" with "Claude bỏ qua" warning. Confirm — and do we offer *suggested* keys (`model`, `temperature`) or pure free-form?
4. **Version on Publish.** semver bump picker (proposed) vs free text vs auto-increment-no-prompt. One version across all targets, or per-target? And: show a version-history panel in v1, or only the version field at publish?
5. **Conflict default.** Proposed default = **Giữ bản trên đĩa** (skip, safest). Or default **Ghi đè** so publish is "complete by default"?
6. **`=` unchanged files in diff.** Keep visible (proves idempotency, density-friendly) or hide behind "Hiện cả file không đổi" toggle?
7. **Codex lossy handling.** Proposed: merge command bodies into `AGENTS.md` with a header + lossy badge. Or skip commands silently / block+warn?
8. **Dependency source.** Proposed: `@agentname` mention in command body → graph edge. Or an explicit "agents used" field on the command form (less magic, more typing)?
9. **Graph layout & scale.** Auto-layout L→R (proposed). For 20+ artifacts do we need grouping/filtering in v1, or is read-only auto-layout enough? Allow user-arranged node positions persisted per project?
10. **Terminal UI scope.** S0 boot menu in scope. Is the **Terminal UI (Interactive CLI)** branch a v1 deliverable, or present-but-stubbed (web-only v1)? (Treated as out of this web-design pass.)
11. **Folder picker.** Native OS dialog via daemon (proposed) vs typed-path-only vs in-web file-tree served by daemon?
12. **Theme/density.** Ship dark mode + System default + density toggle in v1, or defer? (Assumed System default here.)

---

## 7. Future ideas (OUT of v1 — do not let creep in)
- Shared library + inheritance/override + propagate-to-N projects (pain #2 — v1.5).
- Git PR export instead of direct write (v1.5).
- Drift detection (on-disk vs model watcher) — v1.5/v2.
- Real Run engine (`claude -p` headless, streaming, kill switch) replacing Copy-run — v2.
- Copilot (`.github/`) + Gemini (TOML `.gemini/commands/`) adapter targets — added later as pure adapters, no IR change (UI already greys-out/warns unsupported targets).
- Editable graph / drag step-ordering within a command — deferred; v1 graph read-only.
- Full settings.json/hooks editing — v1 import read-only.
- Mobile/responsive — desktop-class only for v1.

---

## 8. Next step
Run **`/plan`** — the architect reads this alongside [`docs/symbion-analyze.md`](../symbion-analyze.md) to lock: the Canonical IR ↔ form-field mapping, the daemon RPC contract (browse/validate/scan/render/diff/write/git-status), the conflict-marker + hash scheme, versioning depth, and the test plan. Resolve open questions #2, #4, #7, #10 with the user first (they affect build scope).
