# Symbion dark redesign — Progressive Disclosure design pass

> Angle: progressive disclosure / rollout sequencing. The visual system itself is **locked**
> (verbatim from `DESIGN.md` + `README.md` handoff + the `.dc.html` prototype, all pasted into
> `docs/loops/symbion-dark-redesign-STATE.md`'s originating conversation). This document does not
> re-litigate colors/spacing/motion — it maps the locked system onto the **real** `apps/web/src`
> component tree, and proposes the safest order to land it without a big-bang rewrite or an
> inconsistent halfway state shipping to a real user.
>
> Baseline read: `docs/loops/symbion-ui-wireframe-context.md` (as-built v1, Vietnamese, verified
> against real source). Scope read: `docs/loops/symbion-dark-redesign-STATE.md` (locked, 3 routes,
> full left-rail adopt, next/font/google self-host).
>
> No `DESIGN.md` exists yet at repo root — confirmed via direct read (`ENOENT`). Section 7 below is
> therefore an **initial proposal**, not a diff against an existing file.

---

## 1. User Journey

### 1a. First-time user (empty state → first workflow)

1. **Landing.** User opens `http://localhost:12802/?t=<token>` (daemon-launched browser tab). Sees
   the new left rail immediately: brand mark (26×26 accent square "S" + "Symbion" + mono
   "v0.3.0 · daemon" caption), then Builder/Templates/Settings nav (Builder pre-selected, tick lit),
   then a **PROJECTS** section showing only the empty hint `∅ chưa có dự án` and a `+` button — no
   project rows yet. Main area (dark `bg-app`, centered max-width 1000px) shows the existing
   `EmptyState` card: "Chưa có dự án nào" + two CTAs, now restyled on the dark surface.
2. User clicks **"+ Tạo dự án"** (or the rail's `+` next to PROJECTS — both open the same
   `CreateProjectDialog`, now in dialog dark chrome, 480px, popIn motion). Fills name + repo path
   (Browse → `FolderBrowserDialog`), sees the green "folder exists / .claude/ found" hint inline.
   Confirms → `WorkflowDetectionPanel` or `ImportReviewStep` if a scan finds existing artifacts.
3. On create, dialog closes (toast bottom-center "Đã tạo dự án" — new `#1b1e25` toast style,
   auto-dismiss ~2.2s). Rail's PROJECTS section now shows one row (name + mono path caption,
   spine tick lit for the active project when selected). Main area switches to Builder **List**
   tab automatically (locked default — Graph is opt-in, see §5 "first-time vs power-user").
4. User sees the List tab empty-artifact state: two centered buttons `[+ Thêm agent] [+ Thêm
   workflow]`. Clicking either opens `BuilderDrawer` (slideIn from right, 880px, 50/50 split) with
   an empty form on the left and a live markdown preview already deriving a default `target path`
   header on the right.
5. User types a name + description; every keystroke updates the right-pane preview live. Clicks
   **Generate** (AI body helper) or types the body manually. Clicks **Save** — footer validation
   passes (green "frontmatter valid"), drawer closes, toast confirms, row appears in the List tab
   with `○` draft glyph + `·draft` badge.
6. User is not yet shown Graph tab content or Publish flow in depth — those are one click away
   (`[Sơ đồ]` toggle, `[Xuất bản ▸]` button) but nothing forces exploration. This is the natural
   "unlock" point: Graph and Publish are power features gated by "you have ≥1 artifact", not by
   any explicit tutorial gate — same behavior as today, just restyled.

### 1b. Power user (multi-project, repeat publish, conflict resolution)

1. User already has 3+ projects in the rail's PROJECTS list (scrollable once it overflows the
   rail's flexible middle section — rail brand/nav/footer stay fixed, only the project list
   scrolls, per README's "(4) Spacer (flex:1 overflow:auto)" — actually the project list itself is
   the scrollable region, bounded above by the nav block and below by the footer).
2. Switches projects by clicking a different rail row — spine tick moves, main area swaps to that
   project's List tab (forced back to List even if they'd left the previous project on Graph — this
   matches current `ProjectView` local `useState<"list"|"graph">` being freshly mounted per
   project, not persisted across project switches; confirmed unchanged behavior, not a new rule).
3. Switches to **Sơ đồ (Graph)** tab to sanity-check dependency wiring before publishing — sees
   status chips (Claude · clean, Codex · lossy/amber, missing-agent red banner if any dangling
   `@agent` mention), canvas with indigo command nodes / violet agent nodes / dashed red missing
   nodes. Clicks a node → opens that artifact's `BuilderDrawer` directly (skips the List tab).
4. Clicks **Xuất bản ▸** → `PublishDialog` step 1 (Config: Claude/Codex toggle cards, Codex
   ack-checkbox only appears if Codex is ticked) → step 2 (Diff: bordered file rows with
   `+ ~ = !` glyphs). Sees one `!` conflict row (hand-edited file since last publish) — must
   resolve inline (`[Giữ bản trên đĩa]` / `[Ghi đè]`) before `[Ghi xuống đĩa]` un-disables.
5. Confirms write → step 3 (Result: green check, "4 file tạo mới · 2 cập nhật", backup path shown).
   Toast + dialog close. Power user repeats this same publish loop across projects without
   re-learning anything — the flow is identical to first-run, just faster because they already
   know where things are.
6. If mid-session the daemon drops (dev restarted it, laptop slept): rail footer status dot flips
   from `daemon · connected` to a warning state, main area's top gets the red disconnected banner,
   and every Save/Publish/Write control across every open surface (drawer footer, publish dialog
   footer, list-tab Publish button) goes `opacity-50` + guarded — no silent failed writes.

---

## 2. Screen Inventory — prototype screen → real component

| # | Prototype screen (README.md) | Real component (baseline doc) | Restyle-only vs Structural |
|---|---|---|---|
| 0 | Global left rail (brand + nav + projects + daemon footer) | **NEW** `AppRail` replacing `AppNav` (top bar) + folding `ProjectSidebar` in | **Structural** — biggest change. `AppNav` (top, horizontal) is retired; its 3 links move into `AppRail`'s vertical nav block. `ProjectSidebar`'s project-list JSX is absorbed into `AppRail`'s PROJECTS section (not deleted — logic ports, only the shell/position changes) |
| 1 | Builder · List tab | `ProjectView` (list branch) + `EmptyState` | Restyle-only — same JSX structure (header, WORKFLOWS section, AGENTS section, row list), new classes/tokens, `⋯`-menu is **new** (currently a bare `⋯` button that only opens Copy-run-command — README's menu with Edit/Copy run command/divider/Delete is a **structural addition**, see §6 open question) |
| 2 | Builder · Graph tab | `DependencyGraph` (React Flow) | Restyle-only for node/edge colors (already indigo/violet close to target); status-chips row above canvas is **new** (not present in current `DependencyGraph.tsx` read — currently graph renders with no chip row; must confirm — see §6) |
| 3 | Builder Drawer (Agent/Workflow) | `BuilderDrawer` + `AgentForm` + `WorkflowForm` + `MarkdownTab` + `LivePreviewPane` + `ModelPicker` + `GenerateBodyButton`/`GenerateBodyDisclosure` | Restyle-only — width changes 860px → 880px (locked token), same 50/50 split, same tab structure (Theo mô tả/Theo markdown → prototype's Form/Markdown labels, copy stays Vietnamese per baseline convention) |
| 4 | Publish flow (Config → Diff → Result) | `publish/PublishDialog` + `publish/PublishDiffView` + `publish/ConflictResolver` + `publish/PublishResultView` | Restyle-only — dialog width 520/720 → locked 480-500/640, same 3-step state machine |
| 5 | Copy run command dialog | `CopyRunCommandDialog` | Restyle-only — 480px unchanged |
| 6 | Create project dialog | `CreateProjectDialog` + `FolderBrowserDialog` + `WorkflowDetectionPanel` + `ImportScanningState` + `ImportReviewStep` | Restyle-only — same multi-step shape |
| 7 | Templates marketplace | `TemplatesView` + `AuthorTabs` + `TemplateSection` + `TemplateCard` + `TemplatePreviewModal` + `TemplateMarkdownViewer` + `LicenseAcknowledgmentStep` + `ProjectPickerStep` + `ApplyResultPanel` + `AuthorSkippedSummary` + `AuthorFetchLoadingState`/`ErrorPanel` | Restyle-only — card grid, tabs, preview modal (560px) all structurally match |
| 8 | Settings / AI Providers | `SettingsShell` + `ProvidersPanel` + `OllamaCard` (as `ApiKeyProviderCard`'s sibling per baseline) | Restyle-only — 2-col grid unchanged |

**Also structurally touched but not its own "screen":** `apps/web/src/app/globals.css` (new CSS
variables replacing the current light/dark HSL pair — see §6, this app currently has **no** `.dark`
class ever applied anywhere, meaning today it renders light-only even though `tailwind.config.ts`
declares `darkMode: "class"`; the redesign effectively makes dark the *only* mode, not a toggle),
`apps/web/tailwind.config.ts` (new token colors), `apps/web/src/app/layout.tsx` (font self-host via
`next/font/google`, `lang="vi"` unchanged), and every route's page-level wrapper that currently
renders `<AppNav />` at the top (`app/page.tsx` → via `AppShell`, `app/templates/page.tsx`,
`app/settings/page.tsx` / `SettingsShell`) since all three must now render inside the rail's `main`
slot instead of stacking below a top bar.

---

## 3. ASCII Wireframes

### 3.0 AppRail (new, shared shell — replaces AppNav, absorbs ProjectSidebar)

```
┌────────────────────────┐
│ ■  Symbion             │  ← brand row, padding 18px 16px 14px
│    v0.3.0 · daemon     │  ← 10.5px mono, text-faint (#565c68)
├────────────────────────┤
│ ▐ ⬚ Builder            │  ← active: tick=accent bg, text-strong, weight 600, row-bg rgba(255,255,255,.055)
│   ▦ Templates          │  ← inactive: tick=transparent, text-dim, weight 500
│   ▤ Settings           │
├────────────────────────┤
│ PROJECTS           [+] │  ← 10.5px uppercase faint label + 20x20 hairline-border "+" button
│ ▐ my-api-service       │  ← active project row: tick 14px accent, name 13px/600
│   /home/me/code/api    │  ← mono path, 10.5px faint, ellipsis
│   project-b            │  ← inactive: tick transparent, text-dim weight 500
│   /home/me/code/pb     │
│   ...                  │  ← scrollable region, overflow-y auto when list > rail height
├────────────────────────┤  ← flex:1 spacer lives ABOVE this footer (pushes footer down)
│ ● daemon · connected   │  ← footer, border-top hairline, 11.5px mono, clickable (demo toggle)
└────────────────────────┘
   w = 236px fixed, bg #0e1014, border-right hairline rgba(255,255,255,.06)
```

Full-page composition (Builder route, List tab active) — this replaces `AppNav` sitting above
`ProjectSidebar` + `main`:

```
┌────────────────────────┬──────────────────────────────────────────────────────┐
│ ■  Symbion             │  my-api-service                    [Sơ đồ][Xuất bản ▸]│ ← h1 23px/700, mono path 12.5px
│    v0.3.0 · daemon     │  /home/me/code/api                                    │
├────────────────────────┼──────────────────────────────────────────────────────┤
│ ▐ ⬚ Builder            │  WORKFLOWS / COMMANDS (3)              [+ Thêm workflow]│
│   ▦ Templates          │   ○ /analyze    3 BA agents...                    ⋯  │
│   ▤ Settings           │   ● /build      Maker codes feature...            ⋯  │
├────────────────────────┤   ○ /ship ·draft  close out feature...            ⋯  │
│ PROJECTS           [+] │                                                       │
│ ▐ my-api-service       │  AGENTS (2)                             [+ Thêm agent]│
│   /home/me/code/api    │   code-reviewer   Independent reviewer...            │
│   project-b            │   architect       design architecture...             │
│   /home/me/code/pb     │                                                       │
├────────────────────────┤  ← content max-width 1000px centered, padding 30px 40px 70px
│ ● daemon · connected   │                                                       │
└────────────────────────┴──────────────────────────────────────────────────────┘
  236px fixed rail              main flex:1 overflow:auto, bg #0a0b0e (bg-app)
```

Disconnected-banner variant (main area, above content, full width of main column):

```
┌──────────────────────────────────────────────────────────┐
│ ⚠ daemon mất kết nối — Lưu/Xuất bản đang tạm khoá.        │  ← red banner, danger tokens
│   Đang thử kết nối lại…                                   │
├──────────────────────────────────────────────────────────┤
│  my-api-service                [Sơ đồ] [Xuất bản ▸ 50%]  │  ← Publish btn opacity .5, guarded
│  ...                                                       │
```

**Migration/rollout note:** `AppRail` is the highest-leverage, most independent unit. It reads only
`useArtifactStore`'s `projects`/`currentProject` (unchanged Zustand shape) and `usePathname()` (for
nav active-state, same as `AppNav` today) — it has **zero** coupling to Builder List/Graph internals.
It can ship as PR #1, wrapping the *unstyled* existing `ProjectView`/`EmptyState`/`TemplatesView`/
`SettingsShell` bodies inside the new rail immediately, before any of those inner screens are
restyled. This de-risks the biggest structural change (top-nav → left-rail) from the token/color
restyle, which can then land screen-by-screen.

### 3.1 Builder — List tab (inside AppRail's main slot)

```
┌──────────────────────────────────────────────────────────┐
│ my-api-service                    [ Sơ đồ ] [Xuất bản ▸] │  ← h1 text-strong, segmented toggle (2 shadcn ToggleGroup-like buttons), primary Button (accent bg)
│ /home/me/code/api                                         │  ← mono, text-faint, 12.5px
├──────────────────────────────────────────────────────────┤
│ WORKFLOWS / COMMANDS (3)                [+ Thêm workflow]│  ← section-label 10.5px/700 uppercase tracking-wide text-faint; Button variant=outline size=sm
│ ┌────────────────────────────────────────────────────┐   │
│ │ ○ /analyze     3 BA agents (requirements+...)   ⋯  │   │  ← row card: bg-surface, hairline border, radius 12px, padding 12px 16px
│ │ ● /build       Maker codes feature end-to-end   ⋯  │   │
│ │ ○ /ship [draft] close out feature, ship PR      ⋯  │   │  ← badge pill 9.5px uppercase amber-ish "draft"
│ └────────────────────────────────────────────────────┘   │
│                                                            │
│ AGENTS (2)                                [+ Thêm agent] │
│ ┌────────────────────────────────────────────────────┐   │
│ │ ● code-reviewer   Independent reviewer  [Read][Edit]│   │ ← violet dot, mono name, tool-chips pills
│ │ ● architect        design architecture  [Write]    │   │
│ └────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

`⋯`-menu expanded (dropdown, one open at a time, closes on outside click):

```
        ┌──────────────────────┐
        │ Edit                 │
        │ Copy run command     │
        ├──────────────────────┤  ← divider hairline
        │ Delete                │  ← danger text color
        └──────────────────────┘
        shadow: 0 14px 40px rgba(0,0,0,.5), bg-menu #1b1e25, popIn .14-.18s
```

### 3.2 Builder — Graph tab

```
┌──────────────────────────────────────────────────────────┐
│ my-api-service                  [ Danh sách ] [Xuất bản ▸]│
├──────────────────────────────────────────────────────────┤
│ ● Claude · clean     ▲ Codex · 3 cmds → AGENTS.md (lossy)│  ← status chips row, pill bg-surface hairline
│ ⚠ /review → agent "ship" (không tồn tại)                  │  ← red banner-lite, only if dangling mention
│ ┌────────────────────────────────────────────────────┐   │
│ │ ░░░░░░░░░░ dotted-grid bg ░░░░░░░░░░░░░░░░░░░░░░░░░ │   │  ← React Flow canvas, computed height
│ │  [/analyze]────────────▶[ba]                        │   │  ← command node indigo #818cf8/#a5b4fc left col
│ │  [/build]  ────────────▶[feature-builder]           │   │  ← agent node violet #a78bfa/#c4b5fd right col
│ │  [/review] ┄┄┄┄┄┄┄┄┄┄┄▶[⚠ ship (không tồn tại)]     │   │  ← dashed red missing-agent node
│ └────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

Node/edge click → opens `BuilderDrawer` for that node's real artifact (missing-agent placeholder
nodes are NOT clickable — no artifact backs them). Read-only canvas: no drag persisted, no new
edges creatable (locked architecture rule, unchanged).

### 3.3 Builder Drawer (Agent example)

```
                                    ┌───────────────────────────┬────────────────────────────┐
                                    │ Agent builder          ✕ │ .claude/agents/code-reviewer.md│ ← LivePreviewPane header, mono path
                                    │ [Theo mô tả][Theo markdown]│                             │
                                    │                            │  ```markdown rendered```    │
                                    │ name *      (code-reviewer)│  ---                         │
                                    │ description *              │  name: code-reviewer         │
                                    │ (Independent reviewer...)  │  description: ...            │
                                    │                            │  ---                          │
                                    │ tools  [Read][Write][Edit] │  # code-reviewer              │
                                    │        (active: accent bg) │  ...body...                   │
                                    │                            │                               │
                                    │ Nội dung   [Model▾][Generate]│                             │
                                    │ ┌────────────────────────┐│                               │
                                    │ │ textarea, h-40          ││                               │
                                    │ └────────────────────────┘│                               │
                                    │ ▸ Nâng cao                │  ✓ frontmatter hợp lệ ·        │
                                    │                            │    filename khớp name          │
                                    ├────────────────────────────┤                               │
                                    │ (✗ blocking errors if any) │                               │
                                    │ (⚠ daemon disconnected)    │                               │
                                    │               [Hủy] [Lưu] │                               │
                                    └───────────────────────────┴────────────────────────────────┘
     backdrop fadeIn .16s over whole viewport   panel slideIn .2s cubic-bezier, translateX 24→0
     total width 880px (max 96vw), fixed right, split exactly 50/50, shadow -20px 0 60px rgba(0,0,0,.5)
```

### 3.4 Publish flow (3 steps, same dialog remounted per step)

```
Step "config" (480-500px):
┌ Xuất bản ──────────────────────── ✕ ┐
│ Phiên bản        ( 0.3.0           )│
│ ☑ Claude                            │
│ ☐ Codex   (gộp vào AGENTS.md·lossy)│
│    ☐ Tôi hiểu — commands sẽ gộp…   │  ← only if Codex ticked
├──────────────────────────────────────┤
│               [Hủy]  [Xem trước ▸]  │
└──────────────────────────────────────┘

Step "diff" (640px):
┌ Xem trước thay đổi · 0.3.0 ──────── ✕ ┐
│ ℹ AGENTS.md đã tồn tại, sẽ chỉnh lần đầu│
│ ┌──────────────────────────────────┐│
│ │ + .claude/agents/code-reviewer.md ││  ← + green
│ │ ~ .claude/commands/build.md       ││  ← ~ amber
│ │ = .claude/settings.json           ││  ← = dim, unchanged
│ │ ! .claude/agents/ship.md  XUNG ĐỘT││  ← ! red bg-danger/10, border-danger
│ │   [Giữ bản trên đĩa] [Ghi đè]     ││  ← inline resolver, Ghi đè = overwrite-btn #dc2626
│ └──────────────────────────────────┘│
├────────────────────────────────────────┤
│      [Quay lại] [Hủy]  [Ghi xuống đĩa]│  ← disabled until all ! rows resolved
└────────────────────────────────────────┘

Step "result" (480-500px):
┌ Kết quả xuất bản 0.3.0 ──────────── ✕ ┐
│ ✓ 4 file tạo mới · 2 cập nhật · 0 lỗi │  ← success green check
│ Sao lưu: .symbion/backups/0.3.0/      │  ← mono path
├────────────────────────────────────────┤
│                              [Xong]   │
└────────────────────────────────────────┘
```

### 3.5 Copy run command dialog (480px)

```
┌ Copy run command — /build ────────── ✕ ┐
│ Requirements   ( ...                  )│
│ Model          ( optional              )│
│ Option         ( --gate                )│
│ ┌──────────────────────────────────┐   │
│ │ /build "..." --model=... --gate   │   │  ← bg-code #08090c, mono, select-all on click
│ └──────────────────────────────────┘   │
│ Đã copy vào clipboard.                  │  ← success text, or fallback warning
├──────────────────────────────────────────┤
│                          [Đóng] [Copy]  │
└──────────────────────────────────────────┘
```

### 3.6 Create project dialog (480px)

```
┌ Tạo dự án mới ─────────────────────── ✕ ┐
│ Tên dự án        ( My API Service      )│
│ Đường dẫn repo   ( …/code/api  )[Chọn…] │
│ ✓ Thư mục tồn tại · .claude/ đã có      │  ← success text, green
├────────────────────────────────────────────┤
│                        [Hủy]   [Tạo dự án]│
└────────────────────────────────────────────┘
```

### 3.7 Templates marketplace

```
┌────────────────────────┬──────────────────────────────────────────────────────┐
│ (rail, Templates active)│  Templates                                          │
│                         │  Thư viện mẫu agent/command/skill...                │
│                         │  [Symbion] [author-x] [author-y]     ← tabs, underline active│
│                         │                                                       │
│                         │  SKILLS ─────────────────────────                    │
│                         │  ┌────────┐┌────────┐┌────────┐┌────────┐          │
│                         │  │ card   ││ card   ││ card   ││ card   │  grid-cols-2 (sm+)│
│                         │  └────────┘└────────┘└────────┘└────────┘          │
│                         │  AGENTS ─────────────────────────                   │
│                         │  ┌────────┐┌────────┐                              │
│                         │  COMMANDS ───────────────────────                   │
│                         │  ⚠ 2 mẫu không tải được [Xem chi tiết]              │
└────────────────────────┴──────────────────────────────────────────────────────┘
```

Preview modal (560px): unchanged structure from baseline S T2-T4, restyled with `bg-menu`/dialog
tokens, license step amber warning banner, `ProjectPickerStep` radio list, `ApplyResultPanel`
green check.

### 3.8 Settings / AI Providers

```
┌────────────────────────┬──────────────────────────────────────────────────────┐
│ (rail, Settings active)│  Nhà cung cấp AI                                     │
│                         │  ┌───────────────────┐┌───────────────────┐        │
│                         │  │ Ollama (cục bộ)    ││ OpenAI  [default] │  grid-cols-2 (md+)│
│                         │  │ ● connected         ││ ● amber, no key    │        │
│                         │  │ Cài & chạy trên máy…││ API key (••••)[Lưu]│        │
│                         │  │ [pre: curl...][Copy]││                    │        │
│                         │  │ [Kiểm tra][Đặt mặc định]│[Kiểm tra][Đặt mặc định][Xoá]│
│                         │  └───────────────────┘└───────────────────┘        │
└────────────────────────┴──────────────────────────────────────────────────────┘
```

---

## 4. Component Breakdown

### 4.0 `AppRail` — NEW component (replaces `AppNav`; absorbs `ProjectSidebar`'s JSX)

- File: `apps/web/src/components/AppRail.tsx`
- Props: none (reads `usePathname()` for active nav item, `useArtifactStore` for
  `projects`/`currentProject`, same as today's `AppNav` + `ProjectSidebar` combined).
- New sub-parts to extract for reuse/testability (all inside `AppRail.tsx` or split out):
  - `RailBrand` — static brand block.
  - `RailNavItem` — the accent-spine row pattern (`active: boolean`, `icon: ReactNode`,
    `label: string`, `href: string`). Used for both primary nav (Builder/Templates/Settings) AND
    project rows (with a `variant: "nav" | "project"` prop controlling tick height 16px vs 14px
    and the two-line name+path layout for projects).
  - `DaemonStatusBadge` — **existing component, reused as-is**, just relocated into the rail
    footer slot (currently rendered inside `ProjectSidebar`; only its container moves).
- shadcn reused: none directly (this is a bespoke shell, not a shadcn primitive) — but the `+`
  button and nav rows should use `Button`'s `variant="ghost"`/`size="icon"` sizing conventions for
  consistency even though the visual chrome (spine tick) is custom.
- `ProjectSidebar.tsx` — **retire** after `AppRail` absorbs its content (don't delete until
  `AppRail` is confirmed working; keep as dead code removal in a follow-up commit, not the same
  commit, so a revert is a one-line rail swap not a resurrection of a deleted file).
- `AppNav.tsx` — **retire** same way.

### 4.1 Builder List tab — `ProjectView.tsx` (list branch)

- Existing props unchanged: `{ project: ProjectStore }`.
- New: row `⋯`-menu needs an actual dropdown (currently the `⋯` button directly opens
  `CopyRunCommandDialog` with no menu at all — see open question 6.1). Use shadcn
  `DropdownMenu`/`DropdownMenuContent`/`DropdownMenuItem` (not yet in `apps/web/src/components/ui/`
  — **new shadcn primitive to add**, only `dialog.tsx`/`button.tsx`/`input.tsx`/`checkbox.tsx`
  exist today).
- New: draft badge → could use a `Badge` primitive (also not present yet — **new shadcn
  primitive**) instead of the current raw `<span className="text-amber-600">`.
- Tool-chips on agent rows: reuse whatever chip pattern `AgentForm`'s tools selector already uses
  (need to confirm at PLAN time — likely a `Toggle`/plain button group, no new component needed).

### 4.2 Builder Graph tab — `DependencyGraph.tsx`

- Existing props unchanged: `{ artifacts: CanonicalArtifact[] }`.
- New: status-chips row (Claude·clean / Codex·lossy / missing-agent warning) is **not currently
  rendered by `DependencyGraph.tsx`** per the code read — this needs to be added, likely as a new
  small presentational component `GraphStatusChips` living alongside, fed by data already computed
  for the Publish diff step (adapter "lossy" flags) — **needs architect confirmation of where that
  computation currently lives** (core `render`/`diff`? or newly derived client-side?). Flagged in
  §6.
- Node/edge styling: update inline `style` objects' hex values to the exact locked tokens
  (`command` indigo `#818cf8`/`#a5b4fc`, `agent` violet `#a78bfa`/`#c4b5fd`, missing-agent dashed
  red) — currently uses close-but-not-exact `#6366f1`/`#8b5cf6`/`#fee2e2`/`#ef4444`.
- Canvas background: add the dotted-grid `Background` variant from `reactflow` (React Flow ships
  `BackgroundVariant.Dots` — check current import only brings in default `Background`).

### 4.3 `BuilderDrawer.tsx` + children — restyle only

- No prop/state contract changes. Width token 860px → 880px is a pure Tailwind class edit
  (`w-[860px]` → `w-[880px]`).
- `AgentForm`, `WorkflowForm`, `MarkdownTab`, `LivePreviewPane`, `ModelPicker`,
  `GenerateBodyButton`/`GenerateBodyDisclosure`, `GenerateDescriptionButton` — all restyle-only,
  same props.

### 4.4 Publish — `publish/*.tsx` — restyle only

- `PublishDialog`, `PublishDiffView`, `ConflictResolver`, `PublishResultView` — no prop changes.
  Dialog width tokens updated per locked spacing (480-500 / 640).
- Diff row glyphs (`+ ~ = !`) — confirm current `ConflictResolver`/`PublishDiffView` already emits
  these exact glyphs (baseline doc confirms yes) — just recolor.

### 4.5 `CopyRunCommandDialog.tsx`, `CreateProjectDialog.tsx` + import/scan steps — restyle only

### 4.6 Templates — `TemplatesView.tsx` + children — restyle only

- Card grid components (`TemplateCard`, `TemplateSection`) get new `bg-surface`/hairline treatment.
- `AuthorTabs` gets the underline-active tab treatment per locked spec ("Symbion active
  underlined").

### 4.7 Settings — `SettingsShell.tsx`, `ProvidersPanel.tsx`, `OllamaCard`/`ApiKeyProviderCard` — restyle only

### 4.8 Global infra changes (span all screens)

- `apps/web/src/app/globals.css` — replace the light/dark HSL variable pair with the locked dark
  token set as CSS variables (`--bg-app`, `--bg-rail`, `--bg-panel`, `--bg-surface`, `--bg-menu`,
  `--bg-input`, `--bg-code`, `--border-hairline`, `--text-strong` … per DESIGN.md token list).
  Since dark becomes the **only** mode (no toggle exists in the prototype or spec), the simplest
  safe change is to fold these into `:root` directly rather than keeping a `.dark` class gate that
  is never applied — **flagged as open question 6.4**, this decision affects whether existing
  `dark:` Tailwind utility classes elsewhere in the codebase (if any) silently stop working.
- `apps/web/tailwind.config.ts` — add every named color token from DESIGN.md's `colors` (and the
  semantic command/agent/skill/status set) as Tailwind theme colors, plus `spacing`, `borderRadius`
  scale (`sm:4, md:8, lg:16` etc. — note current config only defines `borderRadius.lg`), and
  `boxShadow` entries for dropdown/dialog/drawer/toast.
- `apps/web/src/app/layout.tsx` — swap to `next/font/google` `IBM_Plex_Sans`/`IBM_Plex_Mono`,
  apply as CSS variables on `<html>`/`<body>`, `lang="vi"` stays.
- New shadcn primitives to add (per §4.1): `dropdown-menu.tsx`, `badge.tsx`. Possibly `tabs.tsx` if
  the List/Graph segmented toggle and Templates author-tabs are unified onto shadcn `Tabs` instead
  of the current bespoke button-pair pattern (architect's call at PLAN time — not required by this
  redesign's locked scope, which only mandates visual fidelity, not internal refactor).

### Suggested build order (safe-first, given no data-model changes allowed)

1. **Infra first, invisible if done right:** `globals.css` tokens + `tailwind.config.ts` additions
   + font swap in `layout.tsx`. Additive — old classes (`bg-background`, `text-muted-foreground`
   etc.) keep resolving to *some* color even before every component is repainted, so the app
   doesn't break mid-migration; it just looks like an ugly intermediate dark/light mix for the
   duration of the PR stack. This is expected and fine as long as it's one connected PR sequence,
   not left half-done on `master` for a long window.
2. **`AppRail` (structural shell swap).** Ships independently of any inner-screen restyle per the
   §3.0 migration note — wraps existing (still old-styled) `ProjectView`/`EmptyState`/
   `TemplatesView`/`SettingsShell` in the new rail immediately. This is the riskiest single PR
   (route-level layout change across all 3 routes) so it should land right after infra, alone, with
   nothing else changed, so a regression is easy to bisect.
3. **Builder List tab restyle** (`ProjectView` list branch + row cards + new dropdown-menu/badge
   primitives). Most-used screen, good next target once shell is stable.
4. **BuilderDrawer + Publish flow restyle.** These are the deepest interaction surfaces — do them
   once List tab's visual language (cards, buttons, inputs) is proven, so drawer/dialog inherit
   settled patterns rather than inventing new ones in parallel.
5. **Graph tab restyle + status-chips.** Deliberately last among Builder pieces because it has the
   one **open** structural question (§6.2 — status chips data source) that may need an architect
   answer before it can be built at all; List/Drawer/Publish have none.
6. **Templates + Settings restyle.** Lowest-traffic routes, least state complexity, safe to do last
   without blocking anything else — also the most mechanical (grid of cards, no new interaction
   patterns).

This order means: if the project needs to ship incrementally to a real user rather than atomically,
the cut points are clean after steps 2, 3, and 5 — each leaves the app in a fully working (if
visually inconsistent between "done" and "not yet done" screens) state, never a broken one.

---

## 5. Interaction Notes

- **Loading:** unchanged from baseline — `AuthorFetchLoadingState` (Templates GitHub tab spinner),
  `ImportScanningState` (create-project scan spinner). Restyle spinner color to accent, no new
  states introduced by this redesign.
- **Empty states:** `EmptyState` (0 projects), List tab's 0-artifact centered CTAs, rail's
  `∅ chưa có dự án` — all restyle-only, same trigger conditions.
- **Error states:** `AuthorFetchErrorPanel`, create-project scan failure banner, drawer save error,
  publish per-file error list — all restyle-only (danger token swap).
- **Daemon-down:** rail footer dot + label change, main-area red banner (already exists per
  baseline S1 note), every Save/Publish/Write control gets `opacity-.5` + guarded onClick — this is
  an **existing** cross-cutting behavior (`daemonConnected` from `useArtifactStore`), not new. The
  redesign must not weaken this guard while restyling — a review checklist item, not a design
  decision.
- **Row `⋯`-menu:** "one open at a time, close on outside click" per README — this is *new*
  behavior relative to the current bare `⋯` button (see 6.1). Needs a small piece of local/lifted
  state (`openMenuId`, already named in the locked state-shape list in the prompt) — likely lives
  in `ProjectView` or a new hook, not global Zustand (ties to a specific list render, not global
  app state) — confirm at PLAN.
- **Drawer live preview:** unchanged — already derives filename/markdown from `artifact` state on
  every change (`AgentForm`/`WorkflowForm` `onChange` → `LivePreviewPane` re-renders). No new logic,
  just new visual chrome around the same data flow.
- **Toast:** README specifies `#1b1e25` + hairline, auto-dismiss ~2.2s, bottom-center-ish. Baseline
  doc's current app has **no toast system observed** (creates/saves currently just close
  dialogs/drawers silently on success, per the read of `BuilderDrawer.handleSave`). This is a **new
  UI primitive**, not a restyle — flagged in §6.3.
- **Progressive disclosure — first-time vs power-user, present in the prototype:**
  - List tab is the forced default after project creation/selection (Graph is opt-in) — this is
    already the existing behavior (`useState<"list"|"graph">("list")` in `ProjectView`), and the
    locked redesign doesn't change it. Good — no regression risk here.
  - The Builder Drawer's "▸ Nâng cao" (Advanced fields) section is collapsed by default — an
    existing progressive-disclosure pattern (custom YAML frontmatter fields hidden until expanded)
    that the redesign preserves as-is (just restyles the disclosure chevron/row).
  - **Nothing in the locked spec introduces a NEW progressive-disclosure gate** (e.g. no "advanced
    provider settings" hidden tier appears in the Settings screen spec — every provider card shows
    all its controls at once, same as baseline). Worth flagging as a **gap**, not a requirement: if
    the user wants Settings to grow a basic/advanced split as more providers are added later, that
    is explicitly **out of scope** for this port (see Future ideas below) and should not be
    invented here.

### Future ideas (explicitly out of scope for this port)

- Basic/Advanced tiering inside Settings provider cards (only relevant once more providers or more
  per-provider knobs exist than today's key+test+default).
- A first-run product tour/tooltip layer highlighting the rail's new location (not in any of the 3
  source docs — pure speculation, do not build without an explicit ask).
- Persisting List/Graph tab choice per-project across sessions (currently resets to List every
  project switch — could be considered a UX nicety, but changing it would be a **behavior change**,
  explicitly forbidden by this redesign's "behavior and data model stay identical" constraint).

---

## 6. Open Design Questions

**6.1 — Row `⋯`-menu content mismatch.** Baseline doc (as-built) says the current `⋯` button on
each command row *only* opens `CopyRunCommandDialog` directly — there is no dropdown, no
Edit/Delete options exposed there today (Edit is triggered by clicking the row itself, Delete
doesn't appear to exist as a wired action in `ProjectView.tsx` at all — no delete handler was
observed in the read). But README.md's screen spec explicitly describes the menu as
`[Edit, Copy run command, divider, Delete]`. **This is either (a) a new feature being smuggled into
a "presentation-only" redesign (a Delete action that doesn't exist in the real app today), or (b)
the prototype's spec describes a target the current app already half-implements differently than
documented.** Do not guess which — needs the user to confirm: is wiring an actual Delete action
in scope for this redesign ticket, or should the ported menu only show the options that already
have real handlers (Edit, Copy run command) and drop Delete/divider until a separate feature adds
delete support?

**6.2 — Graph tab status-chips data source.** The locked spec's Graph tab shows a status-chips row
(`● Claude · clean`, `▲ Codex · N cmds → AGENTS.md (lossy)`, missing-agent warning) above the
canvas. The current `DependencyGraph.tsx` render (read directly) does not compute or render this
row at all today — it only builds nodes/edges. Is the "lossy Codex" / "clean Claude" computation
already available from `packages/core`'s adapter/diff logic (and just not wired into this
component yet), or does it require new client-side derivation? This determines whether the Graph
tab restyle is pure-CSS or needs new data plumbing — architect should confirm at `/plan`, but the
user should confirm scope: is adding this previously-absent status row **in scope** for a
"presentation-only" port, given CLAUDE.md's non-negotiable constraint says "no data model or flow
changes"? Reading an already-computed value into a new UI element is presentation; computing a new
value that didn't exist before is not purely presentation.

**6.3 — Toast system does not exist yet.** As noted in §5, no toast/snackbar primitive was found in
`apps/web/src/components/ui/` or elsewhere in the read components. The locked spec assumes toasts
exist for create/save/publish confirmations. Building a new `Toast`/`Toaster` primitive (even
following shadcn's own toast pattern) is a **new component**, which is fine, but the user should
confirm this is acceptable scope-creep (a genuinely new, small piece of UI infra) rather than
something to defer to a follow-up ticket — since strictly speaking "add a toast system" is neither
pure CSS restyle nor exactly "chrome and layout position of nav" per the STATE file's stated
boundary ("changing only chrome, layout position of nav, and color/type").

**6.4 — Dark becomes the only mode, not a toggle.** `tailwind.config.ts` currently declares
`darkMode: "class"` but no code anywhere applies a `.dark` class — the app renders in light mode
today by default, and `.dark`'s CSS variables are dead code. The locked redesign is dark-only (no
light/dark toggle appears anywhere in DESIGN.md, README.md, or the prototype). Confirm: should the
port (a) delete the light `:root` variables entirely and put the dark tokens directly in `:root`
(simplest, matches "dark is now the only supported mode"), or (b) keep both variable sets and
force-apply `.dark` on `<html>` unconditionally (slightly more future-proof if a light mode is ever
requested back, at the cost of dead code sitting in the codebase)? This is a genuine taste/future-
proofing call, not inferable from the 3 source docs.

**6.5 — Rail's "CẤU HÌNH ⚙ Cài đặt chung" row.** The as-built `ProjectSidebar` has a second static
section below PROJECTS labeled "CẤU HÌNH" with one row "⚙ Cài đặt chung" (General settings) that
appears to duplicate the primary nav's "Settings" — clicking it currently does nothing wired (no
`onClick` observed). README.md's Global Layout section for the new rail describes only
Brand → Primary nav (Builder/Templates/Settings) → Projects → Spacer → Daemon footer — **no
second "CẤU HÌNH" block is mentioned**. Confirm: is this dead/vestigial UI meant to be dropped in
the port (since Settings already covers it via primary nav), or does it need to survive somewhere
in the new rail? Do not silently drop app surface the user may still want.

---

## 7. Design System — initial proposal

No `DESIGN.md` exists at the repo root yet. Since this feature's entire purpose is porting a
pre-locked design system, propose seeding `DESIGN.md` directly from the tokens actually used across
all 8 ported screens above (this is the natural moment to formalize it — deferring would mean the
same tokens get re-derived ad hoc by the next feature). This is **only a proposal** — a human (or an
explicit "apply design system update" step) applies it; this document does not write `DESIGN.md`
itself.

```yaml
---
version: "1.0.0"
name: "symbion-design-system"
description: "Design tokens for Symbion's desktop dark UI (left-rail + main content)."
colors:
  bg-app: "#0a0b0e"
  bg-rail: "#0e1014"
  bg-panel: "#13151a"
  bg-surface: "#15171d"
  bg-menu: "#1b1e25"
  bg-input: "#0d0f13"
  bg-code: "#08090c"
  border-hairline: "rgba(255,255,255,.06)"
  border-subtle: "rgba(255,255,255,.05)"
  border-input: "rgba(255,255,255,.10)"
  border-menu: "rgba(255,255,255,.09)"
  text-strong: "#f3f4f6"
  text-body: "#e5e7eb"
  text-secondary: "#c5cad3"
  text-muted: "#9aa0ab"
  text-dim: "#8a909b"
  text-faint: "#565c68"
  accent: "#6366f1"
  accent-soft: "rgba(99,102,241,.16)"
  accent-text: "#a5b4fc"
  accent-text-hi: "#c7d2fe"
  command: "#818cf8"
  command-hi: "#a5b4fc"
  agent: "#a78bfa"
  agent-hi: "#c4b5fd"
  skill: "#22d3ee"
  success: "#4ade80"
  warning: "#fbbf24"
  danger: "#f87171"
  danger-hi: "#fca5a5"
  overwrite-btn: "#dc2626"
typography:
  ui-font: "IBM Plex Sans"
  mono-font: "IBM Plex Mono"
  h1: "23-24px/700/-.02em"
  panel-title: "15-16px/700"
  body: "14px/400/1.5"
  row-label: "13-13.5px/600"
  meta-path: "12.5px mono, text-faint"
  section-label: "10-10.5px/700 uppercase, .09-.11em tracking, text-faint"
  badge: "9.5-10px/700 uppercase, .05em tracking"
rounded:
  sm: 8
  md: 12
  lg: 16
  pill: 20
  brand-mark: 8
spacing:
  rail-width: 236
  content-max-width: 1000
  content-padding: "30-32px 40px 70-80px"
  row-padding-comfortable: "12px 16px"
  row-padding-compact: "8px 15px"
  nav-item-gap: 2
  card-grid-gap: "13-15px"
  form-field-gap: 16
components:
  Button:
    radius: "rounded.sm"
    color: "colors.accent"
  Dialog:
    radius: "rounded.lg"
    widths: "480-500 (create/publish-config/copy-run) · 640 (publish-diff) · 560 (template-preview)"
    shadow: "0 30px 80px rgba(0,0,0,.6)"
    motion: "popIn .14-.18s ease, scale .97->1 + translateY 6->0"
  Drawer:
    width: 880
    max-width: "96vw"
    split: "50/50"
    shadow: "-20px 0 60px rgba(0,0,0,.5)"
    motion: "slideIn .2s cubic-bezier(.2,.8,.2,1), translateX 24->0"
  Dropdown:
    shadow: "0 14px 40px rgba(0,0,0,.5)"
    bg: "colors.bg-menu"
  Toast:
    bg: "colors.bg-menu"
    shadow: "0 14px 40px rgba(0,0,0,.5)"
    auto-dismiss-ms: 2200
  NavItem:
    pattern: "accent-spine — absolutely-positioned left tick, 3px wide, 16px tall (14px for project rows), radius 3px"
    active: "tick=accent, text=text-strong, weight 600, row-bg rgba(255,255,255,.055)"
    inactive: "tick=transparent, text=text-dim, weight 500, bg transparent"
---
```

### Overview
Dark-only desktop design system for Symbion's left-rail + main-content shell. Optimized for dense,
keyboard-friendly developer workflows (Linear/Raycast/Dify reference feel), not mobile.

### Colors
See frontmatter `colors`. Accent is themeable (default indigo `#6366f1`) — components must
reference the `accent`/`accent-soft`/`accent-text` tokens, never hardcode indigo, so a future
per-user accent theme doesn't require a repaint.

### Typography
IBM Plex Sans for UI text, IBM Plex Mono for anything technical (paths, commands, code, versions,
tool-chip labels, agent names). Self-hosted via `next/font/google`, not a CDN `<link>`.

### Layout
Fixed 236px left rail + fluid main content, content capped at 1000px max-width and centered inside
the main scroll region. No responsive breakpoint below "desktop" is in scope — this is a
localhost dev tool, not a public marketing site.

### Elevation & Depth
Flat cards use hairline borders only, never shadows. Shadows are reserved for things that float
above the base layer: dropdowns, dialogs, drawers, toasts (see `components` shadow values above).

### Shapes
Radius scale: 8 (buttons/inputs/brand-mark), 12 (panels/cards), 16 (dialogs), 20 (pills/chips/
badges). Nav-item radius 9px is a slight outlier — intentional per the locked spec, not a
typo — keep it distinct from the general 8/12 scale.

### Components
See frontmatter `components` block for the initial durable set (Button, Dialog, Drawer, Dropdown,
Toast, NavItem). Badge and DropdownMenu are new shadcn primitives this feature introduces (per §4.1)
and should be added to this list once built.

### Do's and Don'ts
- Do reference semantic color tokens (`command`, `agent`, `skill`, `success`, `warning`, `danger`)
  for status/kind indicators — never ad hoc hex in component code.
- Do keep the accent-spine nav pattern consistent between primary nav rows and project rows (only
  tick height and line count differ).
- Don't add shadows to flat list-row cards — hairline border only.
- Don't introduce a light mode variant without an explicit product decision (see open question
  6.4) — this system is dark-only by design intent, not by oversight.
- Don't hardcode the 236px rail width or 1000px content max-width as magic numbers in more than one
  place — pull from the spacing tokens once Tailwind config carries them.
```

---

**Suggested next step:** run `/plan` (architect) against this document alongside
`docs/loops/symbion-dark-redesign-STATE.md`'s locked scope. The architect pass should specifically
resolve open questions 6.1-6.5 before `/build` starts, since 6.1/6.2/6.3 each have a real chance of
turning a "presentation-only" ticket into one with small-but-real new logic (a Delete action, a
status computation, a toast system) — worth a deliberate scope call, not a build-time surprise.
