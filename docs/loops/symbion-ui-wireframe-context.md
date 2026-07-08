# Symbion — UI Wireframe & Prototype Context (as-built)

> Nguồn: đọc trực tiếp source code `apps/web/src` (không phải screenshot). Tài liệu này chụp lại **hiện trạng UI thật** (v1) để làm baseline context cho việc design UI/UX tiếp theo — không phải spec mong muốn.
>
> Ngày tạo: 2026-07-07 · Nhánh: `feat/designer-agent-design-md`

## 1. Bối cảnh sản phẩm (Product context)

Symbion là **local-daemon + web UI** giúp dev thiết kế "autoworkflow" (slash-command + subagent lưu dạng `.md`) qua form + sơ đồ phụ thuộc chỉ-đọc, rồi **export/upsert** vào `.claude/` của bất kỳ repo đích nào (và `AGENTS.md` cho Codex). Mục tiêu: không phải tay viết `.md` pipeline cho từng project mới — một định nghĩa canonical (IR) compile ra nhiều provider.

- Web UI ↔ local daemon (typed RPC qua `127.0.0.1`) ↔ filesystem + git. Không cloud DB.
- v1 chưa có run-engine — chỉ "Copy run command" (dựng prompt có cấu trúc, copy clipboard).
- Provider v1: **Claude** (`.claude/agents/*.md` + `.claude/commands/*.md`) + **Codex** (`AGENTS.md`, lossy — gộp file).
- Editor: CodeMirror 6 (không dùng Monaco). Graph: React Flow (đọc-only, không phải canvas kéo-thả tự do).

## 2. Bản đồ route

| Route | File | Vai trò |
|---|---|---|
| `/` | `apps/web/src/app/page.tsx` → `AppShell` | Không gian làm việc chính: sidebar dự án + list/graph artifact + các drawer/dialog builder & publish |
| `/templates` | `apps/web/src/app/templates/page.tsx` → `TemplatesView` | Marketplace template (Symbion built-in + GitHub authors) → preview → license → apply vào project |
| `/settings` | `apps/web/src/app/settings/page.tsx` → `SettingsShell` | Cấu hình provider AI (Ollama/OpenAI/Anthropic/Gemini): API key, test connection, set default |

**Layout chung mọi route:** `AppNav` (top bar) — 3 link: **Builder** (`/`) · **Templates** (`/templates`) · **Cài đặt** (`/settings`). Active link: `bg-primary text-primary-foreground`; inactive: `text-muted-foreground`.

**Query param truyền trạng thái xuyên route** (một lần, tự xoá khỏi URL sau khi đọc):
- `?t=<token>` — session token daemon cấp, mọi route đọc lúc mount.
- `?openProject=<id>` — từ Templates "Mở dự án" → auto-chọn project ở `/`.
- `?createProject=1` — từ Templates "Tạo dự án trước" → auto-mở CreateProjectDialog ở `/`.

Không có dynamic route (`[id]`). Lựa chọn project/artifact là client-state (Zustand `useArtifactStore`), không nằm trên URL.

---

## 3. Wireframe từng màn hình

### S1 — AppShell (khung chính `/`)

```
┌─────────────────────────────────────────────────────────────────┐
│ [Builder] [Templates] [Cài đặt]                        AppNav   │
├───────────────┬───────────────────────────────────────────────┤
│ Symbion   ⌘K  │                                                │
│───────────────│                                                │
│ QUY TRÌNH /   │                                                │
│ DỰ ÁN      [+]│              <ProjectView>                     │
│  ▸ project-a  │        hoặc <EmptyState>                       │
│  ▸ project-b  │        hoặc "Chọn một dự án ở thanh bên."      │
│  ∅ chưa có... │                                                │
│───────────────│                                                │
│ CẤU HÌNH      │                                                │
│ ⚙ Cài đặt chung│                                                │
│───────────────│                                                │
│ daemon ● connected  (footer, DaemonStatusBadge)                │
└───────────────┴───────────────────────────────────────────────┘
  w-64 sidebar         main flex-1, overflow-auto
```
Overlay con (không đổi route): `CreateProjectDialog`, `ImportDialog`, và (bên trong ProjectView) `BuilderDrawer`, `PublishDialog`, `CopyRunCommandDialog`.

Khi daemon mất kết nối: badge footer đổi thành dải đỏ full-width `⚠ daemon mất kết nối — Lưu/Xuất bản đang tạm khoá. Đang thử kết nối lại…` — mọi nút Lưu/Xuất bản bị disable toàn cục.

### S2 — EmptyState (0 project)

```
┌───────────────────────────────┐
│                               │
│   Chưa có dự án nào           │
│   Tạo mới hoặc nhập .claude/  │
│                               │
│   [+ Tạo dự án] [↧ Import .claude/ có sẵn] │
│                               │
└───────────────────────────────┘
      card, centered giữa main area
```

### S3 — CreateProjectDialog (multi-step, w-480px)

```
┌ Tạo dự án mới ──────────────────────── ✕ ┐
│ Tên dự án        [ My API Service      ] │
│ Đường dẫn repo   [ …/code/my-service ][Chọn…] │
│                                           │
│  ✓ Thư mục tồn tại · .claude/ đã có      │  ← step="form", validation inline
│  (hoặc ✗ Thư mục không tồn tại [Tạo thư mục này]) │
│                                           │
│  [WorkflowDetectionPanel]                │  ← step="detected"
│  hoặc ⚠ Quét .claude/ thất bại: {err}    │
│     [Tạo dự án trống] [Thử lại]          │
│  hoặc [ImportScanningState] (spinner)    │  ← step="scanning"
│  hoặc [ImportReviewStep] (checklist)     │  ← step="review"
├───────────────────────────────────────────┤
│                    [Hủy]      [Tạo dự án] │  ← step="form"
│         [Quay lại]  [Nhập N mục đã chọn]  │  ← step="review"
└───────────────────────────────────────────┘
```
UNC path → cảnh báo đỏ "⚠ UNC paths... chưa được hỗ trợ". `FolderBrowserDialog` nằm phía sau, mở khi bấm "Chọn…".

### S4 — ImportDialog (w-560px)

```
┌ Import .claude/ từ repo ────────────── ✕ ┐
│ [ /home/me/code/geochat            ][Quét] │
│ [ Tên dự án (tùy chọn)              ]     │
│                                           │
│  [ImportReviewStep — checklist agents/commands/hooks] │
│  ✗ {error nếu quét lỗi}                  │
├───────────────────────────────────────────┤
│                [Hủy]  [Nhập N mục đã chọn]│
└───────────────────────────────────────────┘
```

### S5 — ProjectView · tab "Danh sách"

```
┌──────────────────────────────────────────────────────────┐
│ project-a                          [Sơ đồ] [Xuất bản ▸]  │
│ /home/me/code/project-a                                  │
├──────────────────────────────────────────────────────────┤
│ WORKFLOWS / COMMANDS (3)              [+ Thêm workflow]  │
│  ○ /analyze   3 BA agents...                    ⋯        │
│  ● /build     Maker codes feature...            ⋯        │
│  ○ /ship ·draft  close out feature...           ⋯        │
│                                                            │
│ AGENTS (2)                             [+ Thêm agent]     │
│  code-reviewer   Independent reviewer...                  │
│  architect       design architecture...                   │
└──────────────────────────────────────────────────────────┘
```
`●` = published, `○` = draft (kèm badge `·draft`). Row menu `⋯` → edit / copy run command / duplicate / delete. Empty state (0 artifact): 2 nút `[+ Thêm agent] [+ Thêm workflow]` giữa màn hình.

### S6 — ProjectView · tab "Sơ đồ" (DependencyGraph, read-only)

```
┌──────────────────────────────────────────────────────────┐
│ project-a                       [Danh sách] [Xuất bản ▸] │
├──────────────────────────────────────────────────────────┤
│ ● Claude (clean)   ▲ Codex (3 cmds→AGENTS.md, lossy)      │
│ ⚠ /review → agent "ship" (không tồn tại)                  │
│ ┌────────────────────────────────────────────────────┐   │
│ │ [/analyze]───────▶[ba]                             │   │
│ │ [/build]  ───────▶[feature-builder]                │   │
│ │ [/review] ┄┄┄┄┄┄▶[⚠ ship (không tồn tại)] (dashed)  │   │
│ └────────────────────────────────────────────────────┘   │
│   commands (indigo #6366f1, trái)   agents (violet #8b5cf6, phải) │
│   missing-agent placeholder: bg #fee2e2, border đỏ dashed  │
└──────────────────────────────────────────────────────────┘
```
React Flow height 480px, không kéo-thả tự do — chỉ hover xem chi tiết, click 2 lần để mở builder.

### S7 / S8 — BuilderDrawer (Agent / Workflow), w-860px, fixed right, 2 cột 50/50

```
┌─────────────────────────────┬──────────────────────────┐
│ Agent builder            ✕ │ .claude/agents/name.md    │ ← LivePreviewPane
│ [Theo mô tả] [Theo markdown]│                            │
│                             │ (markdown render trong <pre>)│
│ name *        [code-reviewer]│                            │
│ description * […………………]    │                            │
│ tools  [Read][Write][Edit]…  │                            │
│         (active: viền/nền primary)                        │
│ Nội dung        [ModelPicker][Generate]│                  │
│ ┌─────────────────────────┐│                            │
│ │ textarea h-40            ││                            │
│ └─────────────────────────┘│                            │
│ ▸ Nâng cao                 │ ✓ frontmatter hợp lệ ·      │
│   [model][claude-opus-4][✕]│    filename khớp name        │
│   [+ Thêm field]            │                            │
├─────────────────────────────┤                            │
│ ✗ {blocking errors}         │                            │
│ ⚠ Mất kết nối daemon...      │                            │
│              [Hủy] [Lưu]    │                            │
└─────────────────────────────┴──────────────────────────┘
```
Workflow builder (S8) khác: field đầu là "command name (→ /name)"; nút phụ "[Chèn $ARGUMENTS]" cạnh Nội dung; dưới cùng hiện "Agents tham chiếu: • code-reviewer ✓ / • ship (không tồn tại)" màu xanh/hổ phách.

Tab "Theo markdown" → CodeMirror 6 (height 360px) thay cho form; trạng thái "✓ markdown hợp lệ, đã đồng bộ vào IR" hoặc "✗ {lỗi} (Save tạm khoá...)".

### S9 — Advanced fields (trong S7/S8, collapsible)

```
▾ Nâng cao
  [ model  ][ claude-opus-4        ][✕]
  [ temperature ][ 0.7             ][✕]
  [+ Thêm field]
```
Custom field không map được vào form chuẩn → hiển thị trong LivePreviewPane dưới dạng ghi chú "custom fields — not representable in form".

### S10 — PublishDialog (w-520px, step="config")

```
┌ Xuất bản ─────────────────────────── ✕ ┐
│ Phiên bản     [ 0.3.0                 ]│
│ ☑ Claude                                │
│ ☐ Codex   (gộp vào AGENTS.md · lossy)  │
│    ☐ Tôi hiểu — commands sẽ gộp/flatten…│  ← chỉ hiện nếu Codex tick
├──────────────────────────────────────────┤
│                [Hủy]  [Xem trước thay đổi]│
└──────────────────────────────────────────┘
```

### S11 — PublishDiffView (w-720px, step="diff")

```
┌ Xem trước thay đổi · 0.3.0 ──────────── ✕ ┐
│ Sẽ khởi tạo .claude/                       │
│ ℹ AGENTS.md đã tồn tại và sẽ được Symbion  │
│   chỉnh sửa lần đầu tiên...                │
│ ┌─────────────────────────────────────┐   │
│ │ ☑ + .claude/agents/code-reviewer.md   │   │
│ │ ☑ ~ .claude/commands/build.md         │   │
│ │ = .claude/settings.json (không đổi)   │   │
│ │ ! XUNG ĐỘT — .claude/agents/ship.md   │   │
│ │   File đã bị sửa tay sau lần xuất bản │   │
│ │   [Giữ bản trên đĩa] [Ghi đè]         │   │
│ └─────────────────────────────────────┘   │
│ ⚠ Mất kết nối daemon...                    │
├─────────────────────────────────────────────┤
│         [Quay lại] [Hủy]  [Ghi xuống đĩa]  │
└─────────────────────────────────────────────┘
```
Glyph trạng thái file: `+` mới, `~` cập nhật, `=` không đổi, `!` xung đột (nền đỏ nhạt `bg-destructive/5`, viền đỏ). Xung đột mặc định unchecked → chặn ghi tới khi resolve.

### S12 — PublishResultView (w-520px)

```
┌ Kết quả xuất bản 0.3.0 ─────────────── ✕ ┐
│ 4 file tạo mới · 2 file cập nhật · 0 lỗi │
│ Sao lưu: .symbion/backups/0.3.0/          │
│ (nếu có lỗi từng file: danh sách đỏ)      │
├──────────────────────────────────────────┤
│           [Thử lại các file lỗi]  [Xong] │
└──────────────────────────────────────────┘
```

### S13 — CopyRunCommandDialog (w-480px)

```
┌ Copy run command — /build ──────────── ✕ ┐
│ [ Requirements                         ] │
│ [ Model (tùy chọn)                     ] │
│ [ Option (tùy chọn, ví dụ --gate)       ] │
│ ┌───────────────────────────────────┐   │
│ │ /build "..." --model=... --gate    │   │  ← <code> select-all
│ └───────────────────────────────────┘   │
│ Đã copy vào clipboard.  (hoặc)           │
│ Clipboard bị chặn — nhấn ⌘C/Ctrl+C.      │
├──────────────────────────────────────────┤
│                          [Đóng] [Copy]   │
└──────────────────────────────────────────┘
```

### T — `/templates` (TemplatesView)

```
┌─────────────────────────────────────────────────────────┐
│ [Builder] [Templates] [Cài đặt]                          │
├─────────────────────────────────────────────────────────┤
│ Templates                                                │
│ Thư viện mẫu agent / command / skill...                  │
│ [Symbion] [author-x (GitHub)] [author-y (GitHub)]   ← tabs│
│                                                            │
│ SKILLS ────────────────────────────────                  │
│  [card] [card] [card] [card]      grid-cols-2 (sm+)       │
│ AGENTS ─────────────────────────────────                 │
│  [card] [card]                                            │
│ COMMANDS ───────────────────────────────                 │
│  [card] [card] [card]                                     │
│                                                            │
│ ⚠ 2 mẫu không tải được → đã bỏ qua  [Xem chi tiết]        │
│ ────────────────────────────────────────────────         │
│ Lấy cảm hứng từ các bộ template cộng đồng (vd. ECC)       │
└─────────────────────────────────────────────────────────┘
```
Loading tab GitHub → spinner "Đang tải…"; Error tab → panel lỗi + retry.

### T2–T4 — TemplatePreviewModal (w-560px, 4 step)

```
Preview:
┌ {name}  [command|agent|skill] ✕ ┐
│ {description}                    │
│ Nguồn: {author} · github.com/... │
│ [TemplateMarkdownViewer]          │
│ ℹ Skills chưa hỗ trợ Áp dụng...   │  (nếu kind=skill)
├───────────────────────────────────┤
│      [Đóng] [Copy markdown] [Áp dụng]│
└───────────────────────────────────┘

License (nếu 3rd-party):
┌ Áp dụng "{name}" ──────────── ✕ ┐
│ ⚠ Nội dung của tác giả khác      │
│ Mẫu này thuộc về tác giả {x}...  │
│ ☐ Tôi đã đọc và đồng ý...        │
│ Xem repo gốc: github.com/... ↗   │
├───────────────────────────────────┤
│              [Quay lại] [Tiếp tục]│
└───────────────────────────────────┘

Apply (ProjectPickerStep):
┌ Áp dụng "{name}" vào dự án nào? ─ ✕ ┐
│ [🔍 Tìm dự án…]                     │
│ ◉ project-a  /path/a                │
│ ○ project-b  /path/b                │
│ (nếu 0 project: "Chưa có dự án nào — tạo dự án trước" [+ Tạo dự án mới]) │
├───────────────────────────────────────┤
│                [Quay lại] [Xác nhận áp dụng]│
└───────────────────────────────────────┘

Result (ApplyResultPanel):
┌ Kết quả ───────────────────── ✕ ┐
│ ✓ Đã áp dụng                     │
│ "{name}" đã được thêm vào dự án  │
│ "{project}" ở dạng nháp.          │
│ Trạng thái: nháp — chưa ghi ra repo│
├────────────────────────────────────┤
│                  [Đóng] [Mở dự án →]│
└────────────────────────────────────┘
```

### `/settings` — ProvidersPanel

```
┌─────────────────────────────────────────────────────────┐
│ [Builder] [Templates] [Cài đặt]                          │
├─────────────────────────────────────────────────────────┤
│ Nhà cung cấp AI                                           │
│ ┌───────────────────────┐ ┌───────────────────────┐      │
│ │ Ollama (cục bộ)   ● connected│ OpenAI        ● (amber)│
│ │ Cài & chạy trên máy... │ API key: sk-***abcd     │      │
│ │ [pre: curl -fsSL ...][Copy]│ [ password input ][Lưu] │  │
│ │ [Kiểm tra kết nối][Đặt làm mặc định]│[Kiểm tra][Đặt mặc định][Xoá key]│
│ └───────────────────────┘ └───────────────────────┘      │
│ ┌───────────────────────┐ ┌───────────────────────┐      │
│ │ Anthropic             │ │ Gemini                │      │
│ │ Chưa cấu hình API key. │ │ ...                    │      │
│ └───────────────────────┘ └───────────────────────┘      │
└─────────────────────────────────────────────────────────┘
   grid-cols-2 (md+), mỗi card border-primary nếu active
```

---

## 4. Component inventory (đường dẫn thật)

Tất cả trong `apps/web/src/components/` trừ khi ghi khác:

| Nhóm | Component |
|---|---|
| Shell | `AppShell`, `AppNav`, `ProjectSidebar`, `EmptyState`, `DaemonStatusBadge` |
| Project & artifact | `ProjectView`, `DependencyGraph`, `CreateProjectDialog`, `ImportDialog`, `ImportScanningState`, `ImportReviewStep`, `FolderBrowserDialog`, `WorkflowDetectionPanel` |
| Builder | `BuilderDrawer`, `AgentForm`, `WorkflowForm`, `MarkdownTab`, `LivePreviewPane`, `ModelPicker`, `GenerateBodyButton`, `GenerateBodyDisclosure` |
| Publish | `publish/PublishDialog`, `publish/PublishDiffView`, `publish/ConflictResolver`, `publish/PublishResultView` |
| Run command | `CopyRunCommandDialog` |
| Templates (`/templates`) | `TemplatesView`, `AuthorTabs`, `TemplateSection`, `TemplateCard`, `TemplatePreviewModal`, `TemplateMarkdownViewer`, `LicenseAcknowledgmentStep`, `ProjectPickerStep`, `ApplyResultPanel`, `AuthorSkippedSummary`, `AuthorFetchLoadingState`, `AuthorFetchErrorPanel` |
| Settings (`/settings`) | `SettingsShell` (app/settings), `ProvidersPanel`, `OllamaCard`, `ApiKeyProviderCard` |

## 5. Design tokens / quy ước quan sát được (chưa chính thức hoá thành DESIGN.md)

- **Trạng thái publish**: `●` published/connected/active, `○` draft, `✓` valid, `✗` error/invalid, `⚠` warning, `!` conflict, `▲`/`ℹ` info-lossy.
- **Màu ngữ nghĩa** (qua Tailwind class quan sát trong code, không phải token chính thức): `text-destructive`/`bg-destructive/10` cho lỗi & xung đột; `text-amber-600`/`text-amber-700` cho cảnh báo/lossy/license; `text-green-600` cho thành công/valid/connected.
- **Panel width chuẩn**: dialog nhỏ 480px, dialog vừa 520–560px, dialog rộng (diff) 720px, drawer full-height 860px (chia 50/50 form|preview).
- **Sidebar cố định** 64 (16rem) trên `/`; ẩn trên `/templates`, `/settings` (chỉ còn AppNav).
- Toàn bộ label/nội dung UI là **tiếng Việt**; text kỹ thuật (tên field YAML, path) giữ tiếng Anh/nguyên bản.
- Empty/loading/error luôn có text + hành động rõ (không có "trắng trang" im lặng) — nhất quán với "Never write silently" ở CLAUDE.md.

## 6. Ghi chú cho việc design tiếp theo

- Đây là **hiện trạng implement**, không phải mockup ý tưởng — designer agent nên coi các wireframe trên là "constraint hiện tại", không phải đề xuất.
- Panel/dialog hiện dùng shadcn `Dialog` nhất quán (header/body/footer) — mọi thiết kế mới nên tái dùng bộ khung này trừ khi có lý do đổi.
- Chưa có file `DESIGN.md` chính thức ghi token màu/spacing — nếu muốn design system nhất quán hơn, bước tiếp theo hợp lý là trích các quan sát ở mục 5 thành token chính thức (theo tính năng "designer DESIGN.md-aware" vừa thêm ở agent `designer`, xem `43f5792`).
- Chưa chụp được screenshot ảnh thật (Playwright/chrome-devtools MCP bị chặn bởi giới hạn sandbox — xem phần môi trường). Tài liệu này dựa 100% trên đọc source, đã đối chiếu JSX + class + text literal nên độ chính xác cấu trúc cao, nhưng **không phản ánh màu sắc/spacing đã render thực tế** (chỉ suy ra từ class Tailwind).
