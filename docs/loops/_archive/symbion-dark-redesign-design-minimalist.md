# Symbion dark redesign — Minimalist/Functional pass

> Angle: fewest moving parts, most direct mapping from prototype token → existing Tailwind/shadcn
> primitive. Resist adding decoration or new abstractions beyond what README.md/DESIGN.md actually
> specify. Where the prototype implies a nuance the current code doesn't have (e.g. per-row hover
> menus, accent-spine ticks), add the *minimum* new component/prop needed and nothing more —
> prefer extending an existing file's className logic over introducing a new wrapper component.
>
> No local `DESIGN.md` exists yet at the repo root (confirmed via glob) — so the token set quoted
> in the prompt is **not yet binding** in the strict sense (there is nothing to conflict with), but
> it *is* the only source of truth supplied for this port and is treated as binding for this
> feature's scope per the STATE file's own framing ("high fidelity, not reinterpretation"). Section
> 7 below proposes it as the actual `DESIGN.md` seed — a human/later step applies it for real.

---

## 1. User Journey

1. **Boot.** User opens `http://127.0.0.1:<port>/?t=<token>`. Dark shell renders immediately
   (no flash-of-light-theme — CSS variables are dark-only now, no `.dark` class toggle needed).
   Left rail (236px, `bg-rail` `#0e1014`) shows brand mark, 3 primary nav rows (Builder active by
   default, accent tick lit), a **Projects** section with a scrollable row list, and a footer
   daemon pill ("daemon · connected").
2. **Pick a project.** User clicks a project row in the rail. Row gets the accent-spine tick +
   bold text; main area swaps to `ProjectView` in `list` tab (unchanged Zustand `loadProject` call
   — same as today, just re-homed visually into the rail instead of `ProjectSidebar`).
3. **Browse.** `ProjectView` header shows project name (h1, 23px/700) + mono path (12.5px, faint),
   a List/Graph segmented toggle, and a primary "Xuất bản ▸" button (disabled + 50% opacity when
   daemon is down). Below: Workflows/Commands section (row-cards, status glyph, ⋯-menu) and Agents
   section (violet dot, tool chips, ⋯-menu). Everything below the rail is unchanged behavior —
   only chrome (bg-panel cards, hairline borders, new type scale).
4. **Switch to Graph.** Click "Sơ đồ" → `DependencyGraph` renders on a dotted-grid dark canvas,
   command-nodes indigo (left), agent-nodes violet (right), missing-agent nodes dashed red. Click
   any real node → opens `BuilderDrawer` for that artifact (same handler as clicking a list row
   today — DependencyGraph doesn't currently wire node-click-to-drawer; this redesign is
   presentation-only per STATE §2, so **not adding that wiring** is explicitly out of scope here,
   flagged in §6).
5. **Edit.** Click a row (or graph node) → `BuilderDrawer` slides in from the right (880px, 50/50
   split, backdrop fadeIn + panel slideIn per DESIGN.md motion tokens). Left = form
   (name/description/tools/body + Form/Markdown tab + Generate button), footer validation +
   Cancel/Save. Right = live preview pane (target path + rendered markdown). Every keystroke
   updates the preview — unchanged `useState` local draft mechanism.
6. **Publish.** Click "Xuất bản ▸" → `PublishDialog` step 1 (Config: version input, Claude/Codex
   toggle cards, Codex ack checkbox) → step 2 (Diff: bordered file rows with `+ ~ = !` glyphs,
   conflict rows get inline Keep-on-disk/Overwrite) → step 3 (Result: green check, summary, backup
   path). Same 3-step state machine as today (`PublishDialog` → `PublishDiffView` →
   `PublishResultView`), restyled only.
7. **Daemon drops mid-session.** Rail footer pill flips to red/warning state; a disconnected
   banner appears above the active view (per README's "optional disconnected banner at top" — this
   is new; today it's a footer-only badge, see §5 "flag"); all Save/Publish/Write controls go to
   50% opacity + guarded `disabled`.

---

## 2. Screen Inventory

| # | Screen | Entry trigger | Exit path | Real component (existing) |
|---|--------|---------------|-----------|----------------------------|
| 1 | Builder List tab | Default view after selecting a project; List/Graph toggle | Toggle to Graph, or navigate away via rail | `ProjectView` (list branch) |
| 2 | Builder Graph tab | Click "Sơ đồ" toggle | Toggle back to List | `ProjectView` (graph branch) → `DependencyGraph` |
| 3 | Builder Drawer (Agent/Workflow) | Click a row / "+ Thêm" / graph node | Cancel, Save (success), Escape, backdrop click | `BuilderDrawer` (+ `AgentForm`/`WorkflowForm`/`MarkdownTab`/`LivePreviewPane`) |
| 4 | Publish flow (Config→Diff→Result) | Click "Xuất bản ▸" | Cancel (any step), Done (result) | `publish/PublishDialog` → `publish/PublishDiffView` (+`ConflictResolver`) → `publish/PublishResultView` |
| 5 | Copy run command dialog | Row ⋯-menu → "Copy run command" | Đóng, Copy (stays open) | `CopyRunCommandDialog` |
| 6 | Create project dialog | Rail "+" button next to PROJECTS label | Hủy, Tạo dự án / Nhập N mục | `CreateProjectDialog` (+ `WorkflowDetectionPanel`, `ImportScanningState`, `ImportReviewStep`, `FolderBrowserDialog`) |
| 7 | Templates marketplace | Rail nav "Templates" | Rail nav away | `TemplatesView` (+ `AuthorTabs`, `TemplateSection`, `TemplateCard`, `TemplatePreviewModal`) |
| 8 | Settings / AI Providers | Rail nav "Settings" | Rail nav away | `SettingsShell` → `ProvidersPanel` (+ `OllamaCard`, `ApiKeyProviderCard`) |

Not in the 8 above but touched structurally: **Import dialog** (`ImportDialog`, 560px, opened from
today's `EmptyState`) and **EmptyState** itself — both keep current behavior, restyle only (dark
tokens, no new screens).

---

## 3. ASCII Wireframes

### 3.1 Global shell (applies to all 8 screens — the rail)

```
┌────────────────────┬──────────────────────────────────────────────────┐
│ ┌──┐ Symbion        │  (active view fills this region)                │
│ │ S│ v0.3.0 · daemon │                                                 │
│ └──┘                │                                                 │
│──────────────────── │                                                 │
│ ┃ ⛃  Builder        │  ← active: tick=accent(3px), bg rgba(255,255,   │
│   ▢▢ Templates      │    255,.055), text-strong, font-600             │
│   ☰☰ Settings       │  ← inactive: tick=transparent, text-dim, 500    │
│──────────────────── │                                                 │
│ PROJECTS       [+]  │  ← 10px/700/uppercase, faint; + = 20x20 hairline│
│ ┃ my-project        │
│   /home/me/code/... │  ← 13px/600 name + 10.5px mono faint path      │
│   another-project   │
│   /home/me/code/... │
│──────────────────── │
│  (flex:1 spacer)    │
│──────────────────── │
│ ● daemon · connected│  ← 11.5px mono, clickable (demo toggle)
└────────────────────┴──────────────────────────────────────────────────┘
  236px fixed              flex:1, overflow:auto, content max-w:1000px
                            centered, padding 30-32px 40px 70-80px
```

### 3.2 Screen 1 — Builder List tab

```
┌────────────────────┬──────────────────────────────────────────────────┐
│  [rail, see 3.1]   │  my-project                    [ List ][ Graph ]│  ← h1 23px/700 -.02em
│                     │  /home/me/code/my-project      [ Xuất bản ▸ ]  │  ← mono 12.5px faint
│                     │  ────────────────────────────────────────────  │
│                     │  WORKFLOWS / COMMANDS (3)        [+ Workflow]  │  ← section-label 10.5px/700 upper
│                     │  ┌──────────────────────────────────────────┐  │
│                     │  │ ○ /analyze   3 BA agents...          [⋯]│  │  ← row card, 12px 16px padding
│                     │  │ ● /build     Maker codes feature...  [⋯]│  │     radius 12px, hairline border
│                     │  │ ○ /ship ·draft  close out feature... [⋯]│  │
│                     │  └──────────────────────────────────────────┘  │
│                     │                                                 │
│                     │  AGENTS (2)                        [+ Agent]  │
│                     │  ┌──────────────────────────────────────────┐  │
│                     │  │ ● code-reviewer  Independent reviewer... │  │
│                     │  │   [Read][Grep][Glob]                 [⋯]│  │  ← violet dot, mono tool-chips
│                     │  │ ● architect      design architecture...  │  │
│                     │  │   [Read][Write]                      [⋯]│  │
│                     │  └──────────────────────────────────────────┘  │
└────────────────────┴──────────────────────────────────────────────────┘
```

⋯-menu (open state, anchored under the clicked row's button):

```
                                              ┌───────────────────┐
                                              │ Edit               │
                                              │ Copy run command    │  ← command rows only
                                              ├─────────────────────┤
                                              │ Delete              │  ← danger color
                                              └───────────────────┘
                                              bg-menu #1b1e25, hairline .09,
                                              shadow: dropdown token, popIn .14-.18s
```

### 3.3 Screen 2 — Builder Graph tab

```
┌────────────────────┬──────────────────────────────────────────────────┐
│  [rail]             │  my-project                    [ List ][ Graph ]│
│                     │  ● Claude · clean   ▲ Codex · lossy (3→AGENTS.md)│ ← status chips row
│                     │  ⚠ /review → agent "ship" (không tồn tại)        │
│                     │  ┌──────────────────────────────────────────┐   │
│                     │  │ · · · · · · · · · · · · · · · · · · · ·  │   │ ← dotted-grid bg
│                     │  │ ┌──────────┐         ┌──────────────┐    │   │
│                     │  │ │/analyze  │────────▶│ ba           │    │   │
│                     │  │ └──────────┘         └──────────────┘    │   │
│                     │  │ ┌──────────┐         ┌──────────────┐    │   │
│                     │  │ │/build    │────────▶│feature-builder│   │   │
│                     │  │ └──────────┘         └──────────────┘    │   │
│                     │  │ ┌──────────┐         ┌ ─ ─ ─ ─ ─ ─ ─ ┐   │   │
│                     │  │ │/review   │┄┄┄┄┄┄┄┄▶┆ ⚠ ship (missing)┆   │   │ ← dashed red border
│                     │  │ └──────────┘         └ ─ ─ ─ ─ ─ ─ ─ ┘   │   │
│                     │  │ · · · · · · · · · · · · · · · · · · · ·  │   │
│                     │  └──────────────────────────────────────────┘   │
└────────────────────┴──────────────────────────────────────────────────┘
   command-nodes indigo #818cf8, agent-nodes violet #a78bfa, both left/right
   columns as today; canvas computed-height (unchanged React Flow config)
```

### 3.4 Screen 3 — Builder Drawer (Agent/Workflow)

```
                                    ┌──────────────────┬──────────────────┐
  (backdrop: fadeIn .16s,           │ Agent builder  ✕ │ .claude/agents/   │
   rgba(0,0,0,.5)-ish over          │ [Form][Markdown]  │  code-reviewer.md │
   entire viewport)                 │───────────────────│───────────────────│
                                    │ name *            │  # code-reviewer  │
                                    │ [ code-reviewer ] │  ...rendered md   │
                                    │ description *     │  in <pre>, mono,  │
                                    │ [.....textarea..] │  bg-code #08090c  │
                                    │ tools              │                   │
                                    │ [Read][Write][Edit]│                   │
                                    │  (active=accent bg)│                   │
                                    │ Nội dung [Model▾][Generate]│           │
                                    │ ┌────────────────┐│                   │
                                    │ │ textarea h-40   ││                   │
                                    │ └────────────────┘│                   │
                                    │ ▸ Nâng cao         │  ✓ frontmatter    │
                                    │───────────────────│  hợp lệ · filename │
                                    │ ✗ {blocking err}   │  khớp name        │
                                    │ ⚠ Mất kết nối...   │                   │
                                    │        [Hủy][Lưu] │                   │
                                    └──────────────────┴──────────────────┘
                                      880px total, split 50/50, fixed right,
                                      slideIn .2s cubic-bezier(.2,.8,.2,1),
                                      shadow: drawer token -20px 0 60px rgba(0,0,0,.5)
```

### 3.5 Screen 4a — Publish Dialog: Config step

```
              ┌ Xuất bản ──────────────────────────── ✕ ┐
              │ Phiên bản     [ 0.3.0                  ]│
              │ ┌───────────────────┐ ┌────────────────┐│  ← toggle "cards" not checkboxes
              │ │ ☑ Claude           │ │ ☐ Codex        ││    per README (Config[Claude/Codex
              │ │   .claude/agents,  │ │   AGENTS.md,   ││    toggle cards]); currently plain
              │ │   .claude/commands │ │   lossy-merge  ││    checkbox+label — restyle to card
              │ └───────────────────┘ └────────────────┘│
              │ ☐ Tôi hiểu — commands sẽ gộp/flatten...  │  ← only rendered if Codex checked
              ├────────────────────────────────────────────┤
              │                [Hủy]   [Xem trước thay đổi]│
              └────────────────────────────────────────────┘
                480-500px, popIn .14-.18s, shadow: dialog token
```

### 3.6 Screen 4b — Publish Diff step

```
      ┌ Xem trước thay đổi · 0.3.0 ──────────────────────── ✕ ┐
      │ Sẽ khởi tạo .claude/                                   │
      │ ℹ AGENTS.md đã tồn tại và sẽ được Symbion chỉnh sửa... │
      │ ┌─────────────────────────────────────────────────┐   │
      │ │ ☑ + .claude/agents/code-reviewer.md               │   │  ← + = new (success-tinted)
      │ │ ☑ ~ .claude/commands/build.md                     │   │  ← ~ = update (warning-tinted)
      │ │ = .claude/settings.json (không đổi)                │   │  ← = = same (dim, no checkbox)
      │ │ ┌ ! XUNG ĐỘT — .claude/agents/ship.md ──────────┐ │   │  ← conflict card, danger border
      │ │ │ File đã bị sửa tay sau lần xuất bản trước.      │ │   │
      │ │ │      [ Giữ bản trên đĩa ]  [ Ghi đè ]           │ │   │  ← Ghi đè = overwrite-btn #dc2626
      │ │ └──────────────────────────────────────────────┘ │   │
      │ └─────────────────────────────────────────────────┘   │
      │ ⚠ Mất kết nối daemon...                                │
      ├─────────────────────────────────────────────────────────┤
      │              [Quay lại] [Hủy]        [ Ghi xuống đĩa ] │
      └─────────────────────────────────────────────────────────┘
        640px per DESIGN.md (current code uses 720px — flag in §6)
```

### 3.7 Screen 4c — Publish Result step

```
              ┌ Kết quả xuất bản 0.3.0 ────────────── ✕ ┐
              │  ✓  4 file tạo mới · 2 file cập nhật ·   │  ← success glyph, large
              │     0 lỗi                                 │
              │  Sao lưu: .symbion/backups/0.3.0/         │  ← mono path, faint
              ├────────────────────────────────────────────┤
              │          [Thử lại các file lỗi]   [Xong]  │
              └────────────────────────────────────────────┘
                480-500px
```

### 3.8 Screen 5 — Copy run command dialog

```
              ┌ Copy run command — /build ──────────── ✕ ┐
              │ [ Requirements                          ]│
              │ [ Model (tùy chọn)                      ]│
              │ [ Option (tùy chọn, ví dụ --gate)        ]│
              │ ┌──────────────────────────────────────┐ │
              │ │ /build "..." --model=... --gate       │ │  ← bg-code, mono, select-all
              │ └──────────────────────────────────────┘ │
              │ Đã copy vào clipboard. / Clipboard bị chặn│
              ├────────────────────────────────────────────┤
              │                          [Đóng]   [Copy]  │
              └────────────────────────────────────────────┘
                480px
```

### 3.9 Screen 6 — Create project dialog

```
              ┌ Tạo dự án mới ─────────────────────── ✕ ┐
              │ Tên dự án     [ My API Service         ]│
              │ Đường dẫn repo[ …/code/my-service ][Chọn…]│
              │ ✓ Thư mục tồn tại · .claude/ đã có       │  ← success-tinted hint
              │  (or ✗ Thư mục không tồn tại [Tạo thư mục])│  ← danger-tinted
              │ [WorkflowDetectionPanel / scanning / review — unchanged sub-steps] │
              ├────────────────────────────────────────────┤
              │                    [Hủy]      [Tạo dự án] │
              └────────────────────────────────────────────┘
                480px
```

### 3.10 Screen 7 — Templates marketplace

```
┌────────────────────┬──────────────────────────────────────────────────┐
│  [rail, Templates   │  Templates                                       │
│   nav-row active]   │  Thư viện mẫu agent / command / skill...         │
│                     │  [ Symbion ]  author-x  author-y      ← tabs,   │
│                     │   underline on active, per README "Symbion active│
│                     │   underlined"                                    │
│                     │                                                   │
│                     │  SKILLS ─────────────────────────────────────    │
│                     │  ┌────────────┐ ┌────────────┐                  │
│                     │  │ skill card │ │ skill card │   grid-cols-2    │
│                     │  └────────────┘ └────────────┘                  │
│                     │  AGENTS ─────────────────────────────────────   │
│                     │  ┌────────────┐ ┌────────────┐                  │
│                     │  │ agent card │ │ agent card │                  │
│                     │  └────────────┘ └────────────┘                  │
│                     │  COMMANDS ───────────────────────────────────   │
│                     │  ┌────────────┐ ┌────────────┐ ┌────────────┐  │
│                     │  │ cmd card   │ │ cmd card   │ │ cmd card   │  │
│                     │  └────────────┘ └────────────┘ └────────────┘  │
│                     │  ⚠ 2 mẫu không tải được → đã bỏ qua [Xem CT]   │
│                     │  ─────────────────────────────────────────────  │
│                     │  Lấy cảm hứng từ ECC ↗                          │
└────────────────────┴──────────────────────────────────────────────────┘
```

Template preview modal (560px, 4-step: Preview → License(if 3rd-party) → ProjectPicker → Result) —
same structure as today's `TemplatePreviewModal`, restyle only; not re-drawn here since it's
identical in shape to the as-built wireframes T2–T4 in the baseline doc, just recolored.

### 3.11 Screen 8 — Settings / AI Providers

```
┌────────────────────┬──────────────────────────────────────────────────┐
│  [rail, Settings    │  Nhà cung cấp AI                                 │
│   nav-row active]   │  ┌───────────────────────┐ ┌───────────────────┐│
│                     │  │ Ollama (cục bộ)  ● conn│ │ OpenAI    ● amber ││  ← grid-cols-2 md+
│                     │  │ Cài & chạy trên máy...  │ │ API key: sk-***  ││
│                     │  │ [pre: curl ...] [Copy]  │ │ [ password ][Lưu]││
│                     │  │ [Kiểm tra][Đặt mặc định]│ │ [Kiểm tra][Đặt mặc định][Xoá key]││
│                     │  └───────────────────────┘ └───────────────────┘│
│                     │  ┌───────────────────────┐ ┌───────────────────┐│
│                     │  │ Anthropic — chưa cấu hình│ Gemini — chưa cấu hình││
│                     │  └───────────────────────┘ └───────────────────┘│
└────────────────────┴──────────────────────────────────────────────────┘
   card = bg-panel #13151a, hairline border, active provider border=accent
```

---

## 4. Component Breakdown

### 4.1 Files that change (restyle only — logic/state untouched)

| File | Change |
|------|--------|
| `apps/web/src/app/globals.css` | Replace `:root`/`.dark` HSL var block with the new dark token set (see §7). App becomes dark-only — `darkMode: "class"` toggle mechanism can stay wired but there's no light theme to switch to (flag in §6). |
| `apps/web/tailwind.config.ts` | Extend `theme.colors` with the new semantic tokens (`bg-app`, `bg-rail`, `bg-panel`, `bg-surface`, `bg-menu`, `bg-input`, `bg-code`, `text-strong`, `text-body`, `text-secondary`, `text-muted`, `text-dim`, `text-faint`, `accent`, `accent-soft`, `accent-text`, `accent-text-hi`, `command`, `agent`, `skill`, `success`, `warning`, `danger`, `overwrite`); add `fontFamily.sans`/`mono` for IBM Plex; extend `borderRadius` (sm/md/lg per DESIGN.md's 4/8/16 — note conflict with current single `--radius` var, see §6); add `boxShadow.dropdown/dialog/drawer/toast`; add `keyframes`/`animation` for fadeIn/slideIn/popIn. |
| `apps/web/src/app/layout.tsx` | Add `next/font/google` `IBM_Plex_Sans`/`IBM_Plex_Mono` loaders, apply via `className`/CSS var on `<html>`/`<body>` (per STATE §1.3, locked). |
| `apps/web/src/components/ui/button.tsx` | Restyle variant/size class strings to new radius (8px) + color tokens. No new variants unless a screen needs one not already covered (none identified). |
| `apps/web/src/components/ui/dialog.tsx` | Restyle backdrop (fadeIn), panel (bg-menu-ish surface, radius-lg 16px, shadow.dialog), add popIn animation class. `className` prop already supports per-dialog width override — **no interface change needed**, just each call-site's width string changes (720→640 for diff, see §6). |
| `apps/web/src/components/ui/input.tsx` | Restyle to `bg-input #0d0f13`, border `.10` hairline, radius 8px. |
| `apps/web/src/components/ProjectView.tsx` | Restyle header/section/row classNames only. Add ⋯-menu open/close state if not already present (it currently renders `⋯` only for commands, with `onClick={() => setRunCommandFor(c)}` directly — no dropdown at all today). **This is a real interaction gap, not just a restyle** — flagged in §6 (menu needs Edit/Copy-run-command/Delete, currently only "copy run command" wired, no Edit-via-⋯ or Delete at all, and Agents rows have no ⋯ at all today). |
| `apps/web/src/components/DependencyGraph.tsx` | Restyle node `style` objects (React Flow inline styles) to new token hex values; canvas wrapper gets dotted-grid background (swap `<Background />` variant/props) and dark surface. Status-chips row above the canvas (Claude·clean / Codex·lossy) does not exist in current code — **new**, see §4.2. |
| `apps/web/src/components/BuilderDrawer.tsx` | Restyle fixed-panel classes (880px not 860px — width value changes, see §6), add slideIn/backdrop-fadeIn wrapper (today it's a bare `fixed` div with no backdrop element at all — **structural addition**, not pure restyle: needs a backdrop `<div>` for click-outside-to-close + the fadeIn treatment). Tab-switcher restyle only. |
| `apps/web/src/components/AgentForm.tsx`, `WorkflowForm.tsx`, `MarkdownTab.tsx`, `LivePreviewPane.tsx` | Restyle only — chip/input/textarea colors, mono for path/frontmatter footer. |
| `apps/web/src/components/publish/PublishDialog.tsx` | Restyle checkboxes-as-cards per README ("toggle cards") — this is a structural change from `<input type=checkbox><label>` to a clickable bordered card component; see §6 open question on whether shadcn has a ready primitive or this is a bespoke button-styled-as-card. |
| `apps/web/src/components/publish/PublishDiffView.tsx` | Restyle row list + glyph coloring; width 720→640 (flag). `ConflictResolver` restyle only. |
| `apps/web/src/components/publish/PublishResultView.tsx` | Restyle only. |
| `apps/web/src/components/CopyRunCommandDialog.tsx` | Restyle only. |
| `apps/web/src/components/CreateProjectDialog.tsx` | Restyle only (hints/validation coloring → success/danger tokens). |
| `apps/web/src/components/EmptyState.tsx` | Restyle only. |
| `apps/web/src/components/DaemonStatusBadge.tsx` | Restyle footer pill (dot + mono text); README also specifies "optional disconnected banner at top" of main area distinct from the rail footer pill — **new**, see §4.2 (`DisconnectedBanner`). |
| `apps/web/src/components/TemplatesView.tsx`, `AuthorTabs.tsx`, `TemplateSection.tsx`, `TemplateCard.tsx`, `TemplatePreviewModal.tsx`, and its sub-steps | Restyle only — remove the page's own `<AppNav />` render (nav now lives in the rail, rendered once by the shared shell — see §4.2 `AppRail` placement), grid/card token colors, tab underline treatment. |
| `apps/web/src/components/SettingsShell.tsx`, `ProvidersPanel.tsx` | Restyle only — same `<AppNav />` removal as Templates. Card shell → `bg-panel`, active border → accent. |

### 4.2 Files to create

| New file | Purpose | Props/state contract |
|----------|---------|----------------------|
| `apps/web/src/components/AppRail.tsx` | Replaces `AppNav` (top bar) as the ONE persistent nav element for **all three routes** (`/`, `/templates`, `/settings`) — folds in `ProjectSidebar`'s project-list responsibility. Rendered once by a shared root layout wrapper (see below), not per-page. | `interface AppRailProps { onCreateProject: () => void; onSelectProject: (id: string) => void }` — mirrors `ProjectSidebarProps` exactly (minimalist: reuse the same prop shape, don't invent a new one). Reads `pathname` (via `usePathname`, same as `AppNav` today) for nav-row active state, and `useArtifactStore` for `projects`/`currentProject` (same as `ProjectSidebar` today). Internally composes: brand block, `<NavItem>` ×3, projects section, spacer, `<DaemonStatusBadge/>` footer. |
| `apps/web/src/components/rail/NavItem.tsx` | The accent-spine row primitive — reused for both primary-nav rows AND project rows (same visual pattern, different tick height per DESIGN.md: 16px nav / 14px project). Minimalist: **one component, one boolean+size prop**, not two near-duplicate components. | `interface NavItemProps { active: boolean; icon?: React.ReactNode; label: string; sublabel?: string; tickSize?: "nav" | "project"; onClick?: () => void; href?: string }` — renders as `<Link>` if `href` given (primary nav), else `<button>` (project rows, since project selection is client-state not a route per baseline doc). |
| `apps/web/src/components/AppRootShell.tsx` (or fold into each route's existing shell) | **Open question, not decided here** (see §6): something has to own "render `AppRail` once, then render the route's content to its right" for all 3 routes, since today each route (`AppShell`, `TemplatesView`, `SettingsShell`) independently renders its own `<AppNav/>` + daemon-session-bootstrap `useEffect`. Minimalist option A: keep 3 independent shells, each renders `<AppRail/>` instead of `<AppNov/>` (smallest diff, some duplication remains — acceptable, matches current pattern). Option B: hoist `AppRail` + session-bootstrap into `app/layout.tsx` as a client wrapper, delete the duplicated `useEffect` boilerplate from all 3 shells (bigger diff, removes duplication). **Recommend Option A for this minimalist pass** — it's a pure swap (`AppNav`→`AppRail`) with zero risk to the "behavior unchanged" constraint; Option B is a legitimate follow-up refactor but touches session-bootstrap code this feature's scope says not to touch. |
| `apps/web/src/components/RowMenu.tsx` | The ⋯ dropdown primitive for list rows (workflows AND agents — currently agents have no ⋯ at all). Small, generic. | `interface RowMenuAction { label: string; onClick: () => void; variant?: "default" | "danger" }`<br>`interface RowMenuProps { actions: RowMenuAction[]; open: boolean; onOpenChange: (open: boolean) => void }` — parent (`ProjectView`) owns the single `openMenuId` state (per README's documented state shape) and passes `open={openMenuId === row.id}`. Closes on outside click (one global listener, or a shared `useClickOutside` hook if one doesn't already exist — check before adding a new hook file). |
| `apps/web/src/components/DisconnectedBanner.tsx` | The top-of-main-area red banner distinct from the rail-footer pill, per README's "optional disconnected banner at top" of the main content area. | `interface DisconnectedBannerProps {}` (reads `daemonConnected` from the store directly — same pattern as `DaemonStatusBadge`, no props needed). Rendered once per route's main-content wrapper, above the active view. |
| `apps/web/src/components/graph/StatusChipsRow.tsx` | The "● Claude · clean / ▲ Codex · lossy / ⚠ missing-agent" row above the graph canvas — does not exist today (`DependencyGraph` renders only the canvas). | `interface StatusChipsRowProps { claudeClean: boolean; codexLossyCount: number; missingAgentMentions: string[] }` — computed by `ProjectView` or `DependencyGraph` itself from `project.artifacts` (same data already available, e.g. via `extractAgentMentions`). |

### 4.3 Files to consider deleting / merging

- **`AppNav.tsx`** — superseded by `AppRail.tsx`. Delete once all 3 route shells are migrated (do
  not delete mid-migration or one route renders no nav at all).
- **`ProjectSidebar.tsx`** — its project-list responsibility is absorbed into `AppRail.tsx` (via
  `NavItem` with `tickSize="project"`). Delete once `AppShell.tsx` stops importing it. Its brand
  block + "⌘K" + "CẤU HÌNH / ⚙ Cài đặt chung" row do NOT map 1:1 to the prototype (prototype's rail
  has no "⌘K" hint and no "CẤU HÌNH" sub-section — Settings is just the 3rd primary nav row) — see
  §6 open question on whether to drop `⌘K` and the redundant "Cài đặt chung" row entirely or keep
  them as extra rail content beyond the locked prototype.

### 4.4 shadcn components reused (no new shadcn deps)

`Button`, `Input`, `Checkbox` (already in `apps/web/src/components/ui/`), the bespoke `Dialog`
primitive (already shadcn-*style*, not actual Radix — noted in its own doc-comment as intentional
for v1). **No new shadcn primitives needed** for this pass: the prototype's "toggle cards" (Publish
Config step) and "segmented tab" (List/Graph, Form/Markdown) are achievable with existing
`Button`/plain-div + className, not a dedicated `ToggleGroup`/`Tabs` import — staying minimalist
means not pulling in shadcn's `Tabs`/`ToggleGroup` components purely for visual parity when a
styled button-group already exists in the codebase and does the job.

---

## 5. Interaction Notes

- **Loading**: `ProvidersPanel`, `PublishDiffView` ("Đang tính diff…"), `AuthorFetchLoadingState`
  keep their exact current text/spinner (`Loader2` from `lucide-react`) — only recolor the spinner
  to `text-dim`/accent. No new loading states introduced.
- **Empty**: `EmptyState` (0 projects), `ProjectView`'s isEmpty branch (0 artifacts), Templates'
  "0 mẫu hợp lệ" message, rail's "∅ chưa có dự án" — all keep current copy, recolor only.
- **Error**: red/danger-tinted text blocks throughout (validation errors, save/write failures,
  provider errors) — map `text-destructive`/`bg-destructive/10` → `danger #f87171`/`bg-danger-soft`
  (needs a soft-danger token, see §7).
- **Daemon-down**: exactly as spec'd — Save/Publish/Write buttons `disabled` + visual `opacity-50`
  (Tailwind's `disabled:pointer-events-none disabled:opacity-50` on `Button` already does this
  generically — no per-screen special-casing needed, it's already wired through the `disabled` prop
  pattern every dialog/drawer uses). The **new** piece is the top-of-main `DisconnectedBanner` in
  addition to the existing footer pill — **flagging this as a deliberate minimalist simplification
  candidate**: today there is ONE disconnected indicator (footer badge, full-width red). The
  prototype's README describes an "optional" second one (top banner). Minimalist angle would keep
  only ONE (the footer pill, promoted to be more visually prominent) rather than showing the same
  fact in two places — but README explicitly designs for both, so this is not silently decided here;
  it's raised in §6.
- **Toasts** (new — not in current baseline at all): 8-second-ish auto-dismiss per README
  ("~2.2s" per README's actual text), bottom-center-ish, `bg-menu #1b1e25` + hairline. **The current
  app has no toast system whatsoever** (errors are shown inline instead, e.g. `saveError` text in
  `BuilderDrawer`). Introducing a global toast requires: (a) a `toast` slice on the store (already
  named in the locked state shape: `toast`), (b) a `<Toaster/>` root-mounted once. This is more than
  a restyle — it's new plumbing. Flagged in §6 since STATE says "behavior... stays identical" but
  the README's interaction notes assume toasts exist; reconcile which wins.
- **Row ⋯-menus**: "toggle, close on outside click, one open at a time" — today only commands have
  an ⋯-equivalent (and it's wired directly to Copy-run-command, not a menu). Building the real
  `RowMenu` per §4.2 is required to match spec; this is the single largest *behavioral* (not just
  visual) gap between baseline and target for Screen 1.
- **Drawer live-derive**: already true today (`AgentForm`/`WorkflowForm` mutate local `artifact`
  state on every keystroke, `LivePreviewPane` re-renders from it) — no change needed beyond
  restyle.
- **Tool chips toggle membership**: already implemented in `AgentForm` presumably (not read in
  full above, but referenced in baseline doc as "active: viền/nền primary") — restyle the active
  state to `accent`/`accent-soft` background, no logic change.

---

## 6. Open Design Questions

1. **Publish diff dialog width: 640px (DESIGN.md) vs 720px (current code, `PublishDiffView`
   className `w-[720px]`).** DESIGN.md says publish-diff = 640px. Do we shrink it to match the
   token exactly, or is 720px an intentional deviation baked into the as-built app for content
   fitting reasons? Do not guess — architect/user should confirm which wins.
2. **Drawer width: 880px (README, DESIGN.md) vs 860px (current code, `BuilderDrawer` `w-[860px]`).**
   Small but real discrepancy (20px). Same question as #1 — snap to prototype exactly, or is there
   a reason the as-built app used 860?
3. **`ProjectSidebar`'s extra content not in the prototype**: "⌘K" hint next to the brand, and the
   "CẤU HÌNH / ⚙ Cài đặt chung" row inside the old sidebar's scroll area. The prototype's rail has
   no ⌘K affordance at all, and "Settings" already exists as the 3rd primary-nav row (Builder/
   Templates/Settings) — so "⚙ Cài đặt chung" would be a literal duplicate nav target. Drop both,
   or is ⌘K a planned-but-unbuilt command-palette hook worth preserving as a visual placeholder?
4. **Second disconnected indicator (top banner) vs single footer pill** — see §5. Keeping both is
   what the README specifies; the minimalist angle would argue for one. Taste call, not guessed
   here.
5. **Toast system: build now or defer?** STATE's non-negotiable constraint says behavior/data model
   stays identical and this is a presentation-only pass; but README's interaction notes assume a
   working toast system with a `toast` slice in the state shape. Building it is new *behavior*
   (new store slice, new global mount point), arguably outside "presentation and nav placement
   only." Recommend confirming with architect whether toast infra is in-scope for this pass or a
   follow-up feature.
6. **shadcn `Dialog` default vs prototype's per-dialog widths**: not actually a conflict — the
   existing `Dialog` primitive already takes a free-form `className` per call site (confirmed by
   reading `ui/dialog.tsx`), so per-dialog width (480/500/560/640/880) is just a Tailwind
   arbitrary-value string, no primitive change needed. Noting this explicitly so the architect
   doesn't think a Dialog-primitive rewrite is required — it is not.
7. **`borderRadius` token conflict**: current `tailwind.config.ts` has ONE global `--radius`
   CSS var (0.5rem = 8px) used as `rounded-lg`. DESIGN.md wants THREE distinct radii (buttons/
   inputs 8px, panels/cards 12px, dialogs 16px) plus nav-item 9px and chips/pills 20px — a 5-value
   scale, not 1. This requires expanding `borderRadius` in the Tailwind theme (not a token
   *conflict* per se since nothing existed to conflict with beyond the single var, but flagging
   since it's a bigger theme-file change than "swap some hex values").
8. **RowMenu's exact action set per row-kind**: README says commands get
   `[Edit, Copy run command, divider, Delete]`; agents get `[Edit, divider, Delete]` (no copy-run,
   agents aren't runnable). Confirm "Edit" in the menu just re-opens `BuilderDrawer` (same as
   clicking the row body today) rather than being a distinct action — assumed yes, but worth an
   explicit nod since it changes the row's click target semantics (row-click-anywhere-to-edit vs.
   row-click-body vs ⋯→Edit specifically).
9. **`AppRootShell` hoisting (Option A vs B in §4.2)** — genuinely a call for the architect, not
   fully a "design" decision, but flagging here since it changes the file list materially. This
   design doc recommends Option A (independent per-route shells) for minimal risk; architect may
   override.

---

## 7. Design System — initial proposal (no DESIGN.md exists at repo root yet)

Since `docs/loops/symbion-dark-redesign-STATE.md`'s supplied token set is the only design-token
source available, and no root `DESIGN.md` exists, this section seeds one from tokens actually used
in the 8 wireframes above only (not the full prototype token list verbatim — trimmed to what this
feature's screens actually consume, per the designer.md convention of not fabricating unused
tokens). A human (or a later "apply design system update" step) should review and commit this as
the real `DESIGN.md`.

```yaml
---
version: "1.0.0"
name: "symbion-design-system"
description: "Design tokens for Symbion's desktop dark UI (left-rail redesign)"
colors:
  bg-app: "#0a0b0e"
  bg-rail: "#0e1014"
  bg-panel: "#13151a"
  bg-surface: "#15171d"
  bg-menu: "#1b1e25"
  bg-input: "#0d0f13"
  bg-code: "#08090c"
  border-hairline: "rgba(255,255,255,0.06)"
  border-subtle: "rgba(255,255,255,0.05)"
  border-input: "rgba(255,255,255,0.10)"
  border-menu: "rgba(255,255,255,0.09)"
  text-strong: "#f3f4f6"
  text-body: "#e5e7eb"
  text-secondary: "#c5cad3"
  text-muted: "#9aa0ab"
  text-dim: "#8a909b"
  text-faint: "#565c68"
  accent: "#6366f1"
  accent-soft: "rgba(99,102,241,0.16)"
  accent-text: "#a5b4fc"
  accent-text-hi: "#c7d2fe"
  command: "#818cf8"
  command-text: "#a5b4fc"
  agent: "#a78bfa"
  agent-text: "#c4b5fd"
  skill: "#22d3ee"
  success: "#4ade80"
  warning: "#fbbf24"
  danger: "#f87171"
  danger-text: "#fca5a5"
  overwrite-btn: "#dc2626"
typography:
  sans: "IBM Plex Sans"
  mono: "IBM Plex Mono"
  h1: "23px/700/-0.02em"
  panel-title: "15px/700"
  body: "14px/400/1.5"
  row-label: "13px/600"
  meta-path: "12.5px mono/400 text-faint"
  section-label: "10.5px/700 uppercase/0.10em text-faint"
  badge: "9.5px/700 uppercase/0.05em"
rounded:
  sm: 4
  input: 8
  nav-item: 9
  panel: 12
  dialog: 16
  pill: 20
spacing:
  rail-width: 236
  content-max-width: 1000
  row-padding-comfortable: "12px 16px"
  row-padding-compact: "8px 15px"
  card-grid-gap: 14
  form-field-gap: 16
components:
  Button:
    radius: "rounded.input"
    color: "colors.accent"
  Dialog:
    radius: "rounded.dialog"
    widths:
      create: 480
      publish-config: 500
      copy-run: 480
      publish-diff: 640
      template-preview: 560
  Drawer:
    width: 880
    split: "50/50"
  NavRow:
    radius: "rounded.nav-item"
    tick-width: 3
    tick-height-nav: 16
    tick-height-project: 14
---
```

### Overview
Symbion's UI is a desktop-class, dark-only developer tool. This token set governs the left-rail
shell, panels/cards, dialogs, and the read-only dependency graph's node coloring.

### Colors
See frontmatter `colors`. Semantic mapping: `command`/`agent`/`skill` are artifact-kind identity
colors (used consistently across list rows, graph nodes, and template-kind badges); `success`/
`warning`/`danger` are status colors; `overwrite-btn` is a single-purpose destructive-confirm color
distinct from generic `danger` (used only on the Publish diff conflict resolver's "Ghi đè" button).

### Typography
IBM Plex Sans for UI text, IBM Plex Mono for anything technical (paths, commands, tool names,
version strings, code). Self-hosted via `next/font/google`.

### Layout
Left rail fixed 236px. Main content area centered, max-width 1000px, padding 30-32px horizontal
40px / vertical 30-80px.

### Elevation & Depth
No shadows on flat cards/panels — hairline borders only. Shadows reserved for floating layers:
dropdown, dialog, drawer, toast (see `boxShadow` additions needed in Tailwind config — not yet
itemized as frontmatter tokens since this trimmed proposal only lists tokens the 8 in-scope screens
consume directly; drawer/dialog/dropdown shadows should be added when this proposal is finalized).

### Shapes
5-step radius scale: sm(4) for tiny glyphs/badges, input(8) for buttons/inputs, nav-item(9) for
rail rows, panel(12) for cards, dialog(16) for modals, pill(20) for chips.

### Components
Button, Dialog, Drawer, NavRow as specified above. `RowMenu` (dropdown), `NavItem` (accent-spine
row) are new components this feature introduces — not yet tokens themselves, but consumers of the
above.

### Do's and Don'ts
- Do use the accent-spine tick pattern for any list of "selectable rows representing a navigable
  identity" (primary nav, projects). Don't invent a second selection-indicator style (e.g. a
  checkmark or filled background alone) for the same semantic role.
- Do keep flat cards shadow-free. Don't add drop shadows to list-row cards or provider cards —
  reserve shadows for elements that float above the page flow (dialogs, dropdowns, drawer, toast).
- Do use mono font for anything a developer would copy-paste or compare byte-for-byte (paths,
  versions, tool names, code). Don't use mono for prose/descriptions.

---

## Suggested next step

Run `/plan` — the architect should read this doc alongside `docs/loops/symbion-dark-redesign-STATE.md`
to produce the component-by-component migration plan (file-by-file diff plan, sequencing to avoid
a broken half-migrated state e.g. `AppNav`/`ProjectSidebar` deletion timing), and to resolve the
open questions in §6 (especially #1/#2 exact-dimension snaps, #5 toast-system scope, and #9
`AppRootShell` hoisting strategy) before `/build`.
