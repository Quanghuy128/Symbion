# Symbion Dark Redesign — Design Pass: RICH / IMMERSIVE

> Angle: lean into DESIGN.md's motion/shadow/token budget fully. The read-only dependency graph
> and the publish diff viewer are the two screens with the most latent expressiveness in the
> prototype — this pass pushes them as far as DESIGN.md's actual tokens allow, without inventing
> new colors, easing curves, or shadows. Everything else ports at high fidelity, restyle-first.
>
> Source of truth: `DESIGN.md` (tokens, binding), `README.md` handoff (behavior, binding),
> `docs/loops/symbion-dark-redesign-STATE.md` (locked scope), `docs/loops/symbion-ui-wireframe-context.md`
> (as-built baseline — real component inventory, confirmed by reading `apps/web/src` directly).
>
> Confirmed: no `DESIGN.md` exists yet at the Symbion repo root. Section 7 below is therefore an
> **initial proposal**, not a diff against an existing file.
>
> Confirmed by reading source: `apps/web/src/components/ui/dialog.tsx` is a **hand-rolled modal**
> (no Radix, no animation, no CSS custom properties beyond shadcn's default `hsl(var(--border))`
> etc.) and `tailwind.config.ts` only defines `border/background/foreground/muted/primary/
> destructive/accent` as HSL CSS vars. This means the entire token set (bg-app/bg-rail/bg-panel/…,
> accent-spine pattern, fadeIn/slideIn/popIn motion) is **net-new infrastructure**, not a restyle
> of existing variables. That materially raises the size of this "redesign" beyond what its name
> suggests — flagged explicitly in Open Design Questions.

---

## 1. User Journey (happy path, with richness call-outs)

1. **Land on `/`.** Left rail (236px, `bg-rail #0e1014`) renders: brand mark (26×26 accent
   rounded-square "S" + "Symbion" + version/daemon mono caption), primary nav (Builder active,
   accent-spine tick lit), Projects section with scrollable rows, daemon footer pill at the
   bottom (`● daemon · connected`, mono 11.5px). *Richness: none needed here — this is chrome,
   should feel instantaneous, zero motion on initial paint beyond the app's own hydration.*
2. **Pick a project** in the rail. The clicked row's spine-tick animates from transparent to
   accent — this is a **color/weight transition**, not a translate/scale animation (DESIGN.md
   doesn't define a spine-specific motion token, so this stays a plain CSS `transition-colors
   150ms` at most, inside the existing "no invented tokens" budget, not attributed to `popIn`/
   `slideIn`/`fadeIn`). Main area swaps to `ProjectView` for that project, forcing `tab=list` and
   closing any open drawer (per STATE's "behavior stays identical" mandate).
3. **Builder List tab.** Header shows project name (h1, 23-24px/700), mono path, the List/Graph
   segmented toggle, and `Publish ▸` (disabled + `opacity-.5` when daemon down). Workflows and
   Agents sections render as row-cards with status glyphs (`●`/`○`), draft badges, tool chips
   (agents), and a `⋯` menu. *Richness: row hover gets a `bg-surface`→`bg-menu`-adjacent subtle
   lift (background-color transition only, no shadow — DESIGN.md is explicit that flat cards use
   hairline borders, never shadows) plus the `⋯` menu icon fading from `text-faint` to
   `text-dim` on row hover, not on menu-open alone. This is the right amount of richness for a
   dense list — anything more (e.g. row scale/lift) would read as "webapp cute," wrong for a
   dev tool.*
4. **Switch to Graph tab.** This is the **first high-value richness target**. Status chips row
   (Claude·clean, Codex·lossy, missing-agent warning) fades in (`fadeIn .16s`), then the canvas
   mounts with a dotted-grid background. Command nodes (indigo) and agent nodes (violet)
   populate; edges **draw in with a staggered reveal** (each edge's stroke-dashoffset animates
   from full to 0 over ~200-260ms, staggered ~40ms per edge, using the *same* `.2,.8,.2,1` cubic
   bezier README.md already licenses for `slideIn` — no new easing invented, reused across a new
   property). Hovering a node lifts its adjacent edges to full accent-text opacity and dims
   unrelated edges to ~35% — this is a **real read affordability win** for a dependency map (the
   whole point of the screen is "what points at what"), not just decoration.
5. **Click a node** → its Builder Drawer slides in from the right (`slideIn .2s`, backdrop
   `fadeIn .16s`). Left form / right live preview, 50/50 split. Editing any field live-updates
   the right-side markdown preview and the derived filename on every keystroke (existing
   behavior, unchanged). Save validates name+description; footer shows blocking errors or the
   daemon-down warning.
6. **Publish.** `Publish ▸` opens the 3-step dialog (`popIn`). Step 1 (Config): Claude/Codex
   toggle cards, Codex ack checkbox appears conditionally. Step 2 (Diff) — **second high-value
   richness target**: file rows reveal with a staggered `popIn` (each row: opacity 0→1 +
   translateY 6→0, staggered ~25ms, capped so a 40-file diff doesn't take visibly long — stagger
   only applies to the first ~12 rows, rest render immediately). Conflict rows get an inline
   resolver (Keep-on-disk / Overwrite) that **expands** using the same `popIn` scale/opacity
   curve, not a new accordion easing. Step 3 (Result): green check pops in, backup path shown in
   mono.
7. **Toast** confirms ("Đã xuất bản 0.3.0"), bottom-center-ish, `bg-menu` + hairline, auto-dismiss
   ~2.2s, entrance via `popIn`.

Where richness is **excess** for this tool (flagged so build doesn't over-invest): the List tab
row list, the rail itself, Settings provider cards, and the Templates grid should stay
functionally restrained — hairline borders, color-only hover states, no entrance stagger. A
developer scanning a list of 30 commands does not want each row popping in with a delay.

---

## 2. Screen Inventory (prototype screen → real component)

| # | Screen (prototype) | Real component(s) | Change type |
|---|---|---|---|
| 1 | Builder List tab | `ProjectView.tsx` (list branch) | Restyle + minor structural (row-card markup, chip row for agent tools, `⋯` dropdown menu — currently just a bare button with no menu at all) |
| 2 | Builder Graph tab | `DependencyGraph.tsx` | Structural — needs custom React Flow node components (`CommandNode`, `AgentNode`, `MissingAgentNode`), custom edge component for animated draw-in + hover highlight, status-chip row (new), dotted-grid background swap |
| 3 | Builder Drawer (Agent/Workflow) | `BuilderDrawer.tsx`, `AgentForm.tsx`, `WorkflowForm.tsx`, `MarkdownTab.tsx`, `LivePreviewPane.tsx`, `ModelPicker.tsx`, `GenerateBodyButton.tsx`/`GenerateBodyDisclosure.tsx`, `GenerateDescriptionButton.tsx` | Restyle (fixed-right layout, 50/50 split, slideIn already conceptually a drawer — needs actual motion added), width 880px vs current 860px (see Open Q) |
| 4 | Publish flow (Config → Diff → Result) | `publish/PublishDialog.tsx`, `publish/PublishDiffView.tsx`, `publish/ConflictResolver.tsx`, `publish/PublishResultView.tsx` | Restyle + structural (staggered row reveal, animated conflict expand, popIn on dialog — `ui/dialog.tsx` currently has zero animation) |
| 5 | Copy run command dialog | `CopyRunCommandDialog.tsx` | Restyle only |
| 6 | Create project dialog | `CreateProjectDialog.tsx`, `FolderBrowserDialog.tsx`, `WorkflowDetectionPanel.tsx`, `ImportScanningState.tsx`, `ImportReviewStep.tsx` | Restyle only |
| 7 | Templates marketplace | `TemplatesView.tsx`, `AuthorTabs.tsx`, `TemplateSection.tsx`, `TemplateCard.tsx`, `TemplatePreviewModal.tsx`, `TemplateMarkdownViewer.tsx`, `LicenseAcknowledgmentStep.tsx`, `ProjectPickerStep.tsx`, `ApplyResultPanel.tsx`, `AuthorSkippedSummary.tsx`, `AuthorFetchLoadingState.tsx`, `AuthorFetchErrorPanel.tsx` | Restyle only (semantic colors: command=indigo, agent=violet, skill=cyan now formalized) |
| 8 | Settings / AI Providers | `SettingsShell.tsx`, `ProvidersPanel.tsx`, `OllamaCard.tsx`, `ApiKeyProviderCard.tsx`, `ProviderStatusPill.tsx` | Restyle only |
| — | **Global shell** (not a "screen" but the biggest change) | `AppNav.tsx` → **replaced** by new `AppRail.tsx`; `ProjectSidebar.tsx`'s project-list logic **merges into** `AppRail.tsx`; `AppShell.tsx` layout restructured from top-nav+sidebar to rail-only | Structural — largest single change in this feature per STATE §1.2 |
| — | EmptyState (0 projects) | `EmptyState.tsx` | Restyle only |

---

## 3. ASCII Wireframes

### 3.1 Global Shell + Builder List tab (Screen 1)

```
┌────────────────────┬──────────────────────────────────────────────────────────┐
│ ╔══╗ Symbion        │  project-a                              [Danh sách|Sơ đồ]│ h1 23px/700
│ ║ S ║ v0.3.0·daemon │  /home/me/code/project-a          [ Xuất bản ▸ ]        │ segmented toggle
│ ╚══╝                │──────────────────────────────────────────────────────────│ hairline .06
│▐Builder      (spine)│  WORKFLOWS / COMMANDS (3)                [+ Workflow]   │ section-label 10.5px upper .09em
│ Templates           │  ┌────────────────────────────────────────────────┐ ⋯   │ row card, radius 12, hairline .05
│ Settings            │  │ ● /analyze   3 BA agents...                    │     │ command=indigo dot on hover text
│──────────────────── │  └────────────────────────────────────────────────┘     │
│ PROJECTS        [+] │  ┌────────────────────────────────────────────────┐ ⋯   │  ⋯ opens dropdown:
│▐project-a    (spine)│  │ ○ /build ·draft  Maker codes feature...        │     │   [Edit]
│  /home/me/code/pr..│  └────────────────────────────────────────────────┘     │   [Copy run command]
│ project-b            │                                                        │   ────────────
│  /home/me/code/pr..│  AGENTS (2)                                [+ Agent]    │   [Delete]  (danger red text)
│                      │  ┌────────────────────────────────────────────────┐ ⋯   │  bg-menu #1b1e25, popIn, shadow
│  (scroll, flex:1)    │  │ ● code-reviewer  Independent reviewer...       │     │  dropdown 0 14px 40px rgba(0,0,0,.5)
│                      │  │   [Read][Write][Edit]  ← tool chips, mono 11px │     │  chips: bg-input, hairline .10
│                      │  └────────────────────────────────────────────────┘     │
│──────────────────── │                                                        │
│ ● daemon · connected │                                                        │
└────────────────────┴──────────────────────────────────────────────────────────┘
  rail 236px fixed        main flex:1, content max-w:1000px centered, pad 30px 40px 70px
  bg #0e1014, border-r    bg #0a0b0e
  .06
```
Interactive zones: `[ Xuất bản ▸ ]` = primary button, disabled `opacity-.5` + cursor-not-allowed
when `!daemonConnected`. `[Danh sách|Sơ đồ]` = 2-segment toggle, active segment `bg-surface`
text-strong, inactive text-dim. `⋯` = icon-button, `hover:bg-surface`, opens dropdown positioned
below-right, closes on outside click or Escape, only one open at a time (existing `openMenuId`
state per README's state shape — new for List tab since current `ProjectView.tsx` has no menu at
all, just a bare `⋯` wired to `setRunCommandFor`. **This is a scope note**: current code's `⋯`
button on command rows does ONE thing (open Copy Run Command dialog) — README's spec wants a full
dropdown with Edit/Copy/Delete. See Open Design Questions §6.1.

### 3.2 Builder Graph tab (Screen 2 — MOST EXPRESSIVE)

```
┌────────────────────┬──────────────────────────────────────────────────────────┐
│ (rail, unchanged)   │  project-a                              [Danh sách|Sơ đồ]│
│                      │──────────────────────────────────────────────────────────│
│                      │  ● Claude · clean    ▲ Codex · 3 cmds→AGENTS.md · lossy │ status chips,
│                      │  ⚠ /review → agent "ship" (không tồn tại)               │ pill bg-surface,
│                      │  ┌────────────────────────────────────────────────────┐ │ hairline border
│                      │  │ · · · · · · · · · · · · · · · · · · · · · · · · ·│ │ dotted-grid bg
│                      │  │ · ┌──────────┐            ┌──────────────┐ ·      │ │ (React Flow
│                      │  │ · │/analyze  │═══════════▶│ ba           │ ·      │ │  <Background
│                      │  │ · │ indigo   │  bezier,   │ violet       │ ·      │ │  variant=dots>)
│                      │  │ · │ node     │  animated  │ node         │ ·      │ │
│                      │  │ · └──────────┘  draw-in   └──────────────┘ ·      │ │ nodes: radius 12,
│                      │  │ · ┌──────────┐            ┌──────────────┐ ·      │ │ hairline .06,
│                      │  │ · │/build    │═══════════▶│feature-builder│ ·     │ │ bg-panel, mono
│                      │  │ · └──────────┘            └──────────────┘ ·      │ │ name 13px/600
│                      │  │ · ┌──────────┐   ┄┄┄┄┄┄┄▶┌ ─ ─ ─ ─ ─ ─ ─┐ ·      │ │
│                      │  │ · │/review   │  dashed,   ¦ ⚠ ship        ¦ ·      │ │ missing: dashed
│                      │  │ · └──────────┘  animated  ¦ (không tồn tại)¦ ·     │ │ danger border,
│                      │  │ · · · · · · · · ·└ ─ ─ ─ ─ ─ ─ ─┘· · · · ·│ │ bg transparent,
│                      │  └────────────────────────────────────────────────────┘ │ text-danger
│                      │  hover /build node → edge to feature-builder glows      │
│                      │  accent-text-hi, unrelated edges dim to ~35% opacity     │
└────────────────────┴──────────────────────────────────────────────────────────┘
```
Interactive zones: any real node = clickable → opens Builder Drawer for that artifact (existing
behavior). Missing-agent node = NOT clickable (no artifact backs it), cursor stays default,
tooltip on hover explains "chưa tồn tại — tạo agent này trong danh sách." Edge hover states are
mouse-driven only, no click needed. Status chips are informational, not interactive (no href/
button semantics — this is a read-only screen per architecture rules).

### 3.3 Builder Drawer — Agent (Screen 3)

```
                              backdrop: fadeIn .16s, bg rgba(0,0,0,.5)
┌──────────────────────────────────────────────────────┬─────────────────────────┐
│ Agent builder                                    ✕  │ .claude/agents/code-    │ ← LivePreviewPane
│ [ Theo mô tả ][ Theo markdown ]  ← segmented tab      │ reviewer.md   (mono,    │   header, mono path
│──────────────────────────────────────────────────────│  faint, 12.5px)         │
│ name *          ( code-reviewer                    ) │──────────────────────── │
│ description *   ( Independent code reviewer...     ) │ ```md rendered in <pre> │
│ tools           [Read●][Write●][Edit○][Bash○]...      │ ---                     │ code block:
│                 active: bg-accent-soft border-accent  │ name: code-reviewer     │ bg-code #08090c
│ Nội dung        [ ModelPicker ▾ ][ Generate ]         │ description: ...        │ mono 12.5-13px
│ ┌────────────────────────────────────────────────┐   │ ---                     │
│ │ (textarea, h-40, bg-input, mono)                │   │ You are an independent │
│ └────────────────────────────────────────────────┘   │ reviewer...             │
│ ▸ Nâng cao (collapsible)                              │──────────────────────── │
│──────────────────────────────────────────────────────│ ✓ frontmatter hợp lệ ·  │ success text,
│ ✗ description is required   (if invalid, danger text)│   filename khớp name    │ mono/faint meta
│ ⚠ Mất kết nối daemon — Lưu đang tạm khoá.  (if down)  │                         │
│                                    [ Hủy ] [ Lưu ]    │                         │
└──────────────────────────────────────────────────────┴─────────────────────────┘
  panel slideIn .2s cubic-bezier(.2,.8,.2,1), translateX 24→0        width 880px, split 50/50
  bg-panel #13151a, shadow -20px 0 60px rgba(0,0,0,.5)
```
Tool chips: pill radius 20px, mono 11px, active state = `bg-accent-soft` + `border-accent` +
`text-accent-text-hi`; inactive = `bg-input` + hairline `.10` + `text-dim`. Toggling is a click,
no drag. Markdown tab swaps the textarea region for CodeMirror 6 (height 360px) — segmented tab
itself uses the same List/Graph toggle visual language for consistency (one segmented-control
component, reused).

### 3.4 Publish — Diff step (Screen 4, step 2 — SECOND MOST EXPRESSIVE)

```
┌ Xem trước thay đổi · 0.3.0 ──────────────────────────────── ✕ ┐  popIn .14-.18s,
│ Sẽ khởi tạo .claude/                                            │  scale .97→1 + translateY 6→0
│ ℹ AGENTS.md đã tồn tại và sẽ được Symbion chỉnh sửa lần đầu...  │  info banner: bg-accent-soft
│ ┌──────────────────────────────────────────────────────────┐   │  border-hairline
│ │ ☑ + .claude/agents/code-reviewer.md                       │ ← row 1, reveals first
│ │ ☑ ~ .claude/commands/build.md                             │ ← row 2, +25ms stagger
│ │ = .claude/settings.json (không đổi)                       │ ← row 3, +50ms stagger
│ │ ┌────────────────────────────────────────────────────┐    │ ← row 4: conflict,
│ │ │ ! XUNG ĐỘT — .claude/agents/ship.md                 │    │   bg-danger/8-ish tint,
│ │ │   File đã bị sửa tay sau lần xuất bản trước.        │    │   border-danger hairline,
│ │ │   [ Giữ bản trên đĩa ]  [ Ghi đè (danger-red btn) ] │    │   resolver expands via
│ │ └────────────────────────────────────────────────────┘    │   popIn on first render
│ └──────────────────────────────────────────────────────────┘   │
│ ⚠ Mất kết nối daemon — không thể ghi xuống đĩa.  (if down)      │
│                          [ Quay lại ]  [ Hủy ]  [ Ghi xuống đĩa ]│
└──────────────────────────────────────────────────────────────┘
  width 640px per DESIGN.md (current code uses 720px — see Open Q §6.2)
```
Glyphs: `+` new = accent-text or success-tinted mono, `~` update = warning-tinted mono, `=` same =
text-faint mono, `!` conflict = danger mono, bold. Stagger caps at first ~12 rows (see journey
note above) — files 13+ render with zero delay so a 60-file publish doesn't feel sluggish. The
`Ghi đè` (Overwrite) button uses the dedicated `overwrite-btn #dc2626` token — the only place in
the whole app this specific red (distinct from general `danger #f87171`) is used, per DESIGN.md.

### 3.5 Copy Run Command Dialog (Screen 5)

```
┌ Copy run command — /build ────────────────────── ✕ ┐  popIn, width 480px
│ Yêu cầu       ( Add auth middleware...            ) │
│ Model (tùy chọn) ( claude-opus-4                   ) │
│ Option (tùy chọn) ( --gate                         ) │
│ ┌──────────────────────────────────────────────────┐│  bg-code, mono 12.5-13px,
│ │ /build "Add auth middleware..." --model=claude-...││  select-all on click
│ └──────────────────────────────────────────────────┘│
│ Đã copy vào clipboard.  (toast-adjacent inline text) │
│                                    [ Đóng ] [ Copy ] │
└──────────────────────────────────────────────────────┘
```

### 3.6 Create Project Dialog (Screen 6)

```
┌ Tạo dự án mới ──────────────────────────────────── ✕ ┐  popIn, width 480px
│ Tên dự án        ( My API Service                   )│
│ Đường dẫn repo   ( /home/me/code/my-service ) [Chọn…]│
│ ✓ Thư mục tồn tại · .claude/ đã có                    │  success text, mono path faint
│ (or ✗ Thư mục không tồn tại  [ Tạo thư mục này ])     │
│ [WorkflowDetectionPanel / ImportReviewStep / spinner] │
│                              [ Hủy ]  [ Tạo dự án ]  │
└────────────────────────────────────────────────────────┘
```

### 3.7 Templates Marketplace (Screen 7)

```
┌────────────────────┬──────────────────────────────────────────────────────────┐
│ (rail, unchanged,   │  Templates                                              │ h1
│  Templates tick lit)│  Thư viện mẫu agent / command / skill...                │ body, text-secondary
│                      │  [ Symbion ] [ author-x ] [ author-y ]  ← tabs           │ active=underline accent
│                      │──────────────────────────────────────────────────────────│
│                      │  SKILLS                                                 │ section-label, cyan
│                      │  ┌───────────┐ ┌───────────┐                            │ skill=cyan #22d3ee
│                      │  │ card       │ │ card       │  grid-cols-2, gap 13-15px│ accent per DESIGN.md
│                      │  └───────────┘ └───────────┘                            │ semantic colors
│                      │  AGENTS                                                 │ agent=violet
│                      │  ┌───────────┐ ┌───────────┐                            │
│                      │  COMMANDS                                              │ command=indigo
│                      │  ┌───────────┐ ┌───────────┐ ┌───────────┐             │
│                      │  ⚠ 2 mẫu không tải được → đã bỏ qua  [ Xem chi tiết ]  │ warning #fbbf24
└────────────────────┴──────────────────────────────────────────────────────────┘
```

### 3.8 Settings / AI Providers (Screen 8)

```
┌────────────────────┬──────────────────────────────────────────────────────────┐
│ (rail, unchanged)   │  Nhà cung cấp AI                                        │
│                      │  ┌──────────────────────┐ ┌──────────────────────┐    │
│                      │  │ Ollama (cục bộ)  ●conn│ │ OpenAI      [mặc định]│    │ default-badge:
│                      │  │ Cài & chạy trên máy...│ │ API key ( ●●●●abcd )  │    │ accent pill
│                      │  │ [pre: curl...] [Copy] │ │  [ Lưu ]              │    │ status dot:
│                      │  │ [Kiểm tra][Đặt mặc định]│ │ [Kiểm tra][Đặt mặc định]│  │ success/warning/
│                      │  └──────────────────────┘ └──────────────────────┘    │ danger per state
│                      │  grid-cols-2, card radius 12, hairline .05, no shadow  │
└────────────────────┴──────────────────────────────────────────────────────────┘
```

---

## 4. Component Breakdown

### 4.1 New components

| Component | Path | Props/state contract |
|---|---|---|
| `AppRail` | `apps/web/src/components/AppRail.tsx` | Replaces `AppNav` + folds `ProjectSidebar`'s project-list logic. Props: `onCreateProject: () => void`, `onSelectProject: (id: string) => void`. Reads `pathname` (nav active state), `useArtifactStore` for `projects`/`currentProject`/`daemonConnected`. Renders: brand block, primary-nav rows (Builder/Templates/Settings, accent-spine), Projects section (label + `+` button + scrollable row list), spacer, daemon footer (reuses `DaemonStatusBadge` internally, or `DaemonStatusBadge` gets restyled to fit the footer slot). |
| `NavRow` | `apps/web/src/components/AppRail.tsx` (co-located, not exported) or `apps/web/src/components/ui/nav-row.tsx` if reused elsewhere | Props: `active: boolean`, `icon: ReactNode`, `label: string`, `onClick?`. Implements the accent-spine tick pattern (absolutely-positioned left tick, `height:16px` for nav rows / `14px` for project rows — pass a `variant: "nav" | "project"` prop to control tick height + 2-line vs 1-line layout). |
| `SegmentedToggle` | `apps/web/src/components/ui/segmented-toggle.tsx` | Generic 2+-option toggle. Props: `options: {value: string; label: string}[]`, `value: string`, `onChange: (v: string) => void`. Used by List/Graph tab AND the Form/Markdown tab inside `BuilderDrawer` — one component, two call sites, per DESIGN.md's implicit "reuse visual language" principle. |
| `RowMenu` (dropdown) | `apps/web/src/components/ui/row-menu.tsx` | Props: `items: {label: string; onSelect: () => void; danger?: boolean; disabled?: boolean}[]` (with a `divider: true` sentinel item type), `open: boolean`, `onOpenChange`. Wraps existing `openMenuId`-style single-open-at-a-time state (owned by parent, e.g. `ProjectView`). Uses `popIn`, `bg-menu`, dropdown shadow token. |
| `CommandNode`, `AgentNode`, `MissingAgentNode` | `apps/web/src/components/graph/*.tsx` | React Flow custom node components. Props per React Flow's `NodeProps<{label: string; slug?: string; toolCount?: number}>` contract. Must register via `nodeTypes` prop on `<ReactFlow>`. Each renders the label + a `data-hover` driven className toggle (edge-highlight is computed in the parent via connected-edge-id lookup, not inside the node itself — keep node components dumb/presentational). |
| `AnimatedEdge` | `apps/web/src/components/graph/AnimatedEdge.tsx` | React Flow custom edge component (registered via `edgeTypes`). Props per `EdgeProps`. Implements stroke-dashoffset draw-in via a CSS animation class applied on mount (respecting `prefers-reduced-motion` — see Interaction Notes). Missing-edge variant renders dashed + `animated` (React Flow's built-in marching-ants) as today, but color driven by `--color-danger` token. |
| `GraphStatusChips` | `apps/web/src/components/graph/GraphStatusChips.tsx` | Props: `claudeStatus: "clean"`, `codexStatus: {lossy: boolean; commandCount: number}`, `missingAgentWarnings: string[]`. Pure presentational row above the canvas. |
| `ProviderStatusDot` | may already be covered by existing `ProviderStatusPill.tsx` — restyle, not new | — |
| `StaggeredReveal` (utility wrapper) | `apps/web/src/components/ui/staggered-reveal.tsx` | Props: `children: ReactNode[]`, `staggerMs?: number` (default 25), `cap?: number` (default 12). Wraps each child in a `popIn`-animated span with `animation-delay: index * staggerMs` for `index < cap`. Used by `PublishDiffView`'s file-row list AND nowhere else (list-tab explicitly should NOT use this — see journey notes). |
| `ConflictResolver` enhancement | existing `publish/ConflictResolver.tsx` | Add `popIn`-on-mount expand (the component already exists and takes `file`/`resolution`/`onResolve` — no prop contract change, just internal animation class). |

### 4.2 Existing components — restyle only (no structural change)

`CopyRunCommandDialog`, `CreateProjectDialog`, `FolderBrowserDialog`, `WorkflowDetectionPanel`,
`ImportScanningState`, `ImportReviewStep`, `ImportDialog`, `EmptyState`, `TemplatesView`,
`AuthorTabs`, `TemplateSection`, `TemplateCard`, `TemplatePreviewModal`, `TemplateMarkdownViewer`,
`LicenseAcknowledgmentStep`, `ProjectPickerStep`, `ApplyResultPanel`, `AuthorSkippedSummary`,
`AuthorFetchLoadingState`, `AuthorFetchErrorPanel`, `SettingsShell`, `ProvidersPanel`,
`OllamaCard`, `ApiKeyProviderCard`, `ProviderStatusPill`, `ModelPicker`, `GenerateBodyButton`,
`GenerateBodyDisclosure`, `GenerateDescriptionButton`, `LivePreviewPane`, `MarkdownTab`.

### 4.3 Existing components — restyle + motion addition

- **`ui/dialog.tsx`** — needs real animation added: backdrop `fadeIn .16s ease`, panel `popIn
  .14-.18s ease` (scale .97→1, translateY 6→0). Currently zero animation and zero CSS-variable
  theming beyond shadcn defaults — this is the single highest-leverage file since every dialog
  in the app depends on it. Props unchanged (`open`, `onClose`, `children`, `className`).
- **`publish/PublishDiffView.tsx`** — wrap the file-row `.map()` in `StaggeredReveal`; width prop
  480/640/etc encoded via `className` — confirm 640px vs current 720px (Open Q §6.2).
- **`DependencyGraph.tsx`** — biggest structural rewrite: register `nodeTypes`/`edgeTypes`,
  compute per-node/edge hover-highlight state (`hoveredNodeId` local state, derive connected edge
  ids), swap `<Background>` to `variant={BackgroundVariant.Dots}`, add `<GraphStatusChips>` above
  canvas reading from a new prop (`claudeStatus`/`codexStatus`/`missingAgentWarnings` — currently
  **not computed anywhere** in the real component; this is new derived data, likely sourced from
  `packages/core`'s existing adapter/lint output — flag to architect).
- **`AppShell.tsx`** — replace `<AppNav />` + `<ProjectSidebar .../>` pair with a single
  `<AppRail .../>`; main content padding changes from `p-4`-style to the 30px/40px/70-80px
  spec + `max-w-[1000px] mx-auto`.
- **`ProjectView.tsz`** — header restyle to h1/mono-path spec, List/Graph swap to
  `SegmentedToggle`, row-list restyle to card pattern, `⋯` button becomes `RowMenu` trigger
  (structural — see Open Q §6.1).
- **`BuilderDrawer.tsx`** — restyle to fixed-right 880px panel with `slideIn`; Form/Markdown tab
  swap to `SegmentedToggle`.

### 4.4 shadcn components reused/extended

- `Button` (`ui/button.tsx`) — needs a `variant="danger"` (for the `overwrite-btn #dc2626` case)
  and confirm existing `variant="outline"` maps cleanly to the new `bg-transparent + hairline`
  look.
- `Input` (`ui/input.tsx`) — restyle to `bg-input #0d0f13` + hairline `.10` border, no structural
  change.
- `Checkbox` (`ui/checkbox.tsx`) — restyle only (Codex-ack checkbox, diff-row checkboxes).
- `Dialog` family (`ui/dialog.tsx`) — see 4.3, motion + token addition, contract unchanged.

---

## 5. Interaction Notes

**Loading states**
- Graph tab: while `computeDiff`/artifact data isn't yet available, show a skeleton grid (dotted
  bg + 2-3 ghost node outlines, `bg-panel` at 40% opacity, no shimmer animation — shimmer isn't a
  DESIGN.md-licensed motion token) rather than a spinner, since the canvas itself is the content.
- Publish Diff step: existing "Đang tính diff…" text state — restyle only, no motion needed for a
  transient loading string.
- Templates author tabs: existing `AuthorFetchLoadingState` spinner — restyle only.

**Empty states**
- 0 projects: `EmptyState` restyled, centered card, no motion (first-paint content shouldn't be
  animated — avoid it feeling like the app is "loading in" when it's actually just empty).
- 0 artifacts in a project: existing dual-button centered state — restyle only.
- 0 templates for an author tab / author fetch returned nothing: existing text, restyle only.

**Error states**
- Daemon down: red/danger banner at top of main area (per as-built S1) — must stay a
  **persistent, non-dismissible, full-width** element per CLAUDE.md's "never write silently"
  ethos; this is a case where richness should NOT apply motion beyond a single `fadeIn` on
  appearance — a pulsing/attention-grabbing animation would be wrong here since it needs to read
  as calm-but-serious, not alarmist.
- Publish write failure: existing inline `✗ Ghi thất bại: {message}` text — no motion.
- Drawer validation errors: existing inline `✗ {error}` footer text — no motion (errors appearing
  with a bounce/pop would undercut their seriousness).

**Graph-specific micro-interactions (richness budget)**
1. On tab-switch to Graph: canvas container `fadeIn .16s`, then edges draw in staggered (~40ms/
   edge, capped at first 15 edges — beyond that, render immediately, same rationale as diff-row
   cap).
2. Node hover: connected edges transition `stroke` to `--color-accent-text-hi` and `stroke-width`
   +0.5px over 120ms (plain CSS transition, not a DESIGN.md-named token — acceptable as a "closest
   Tailwind-token equivalent" per STATE §2's binding-constraint clause, since DESIGN.md doesn't
   enumerate a hover-specific duration and 120ms is inside its documented 140-260ms motion
   family). Unrelated edges dim to opacity 0.35 over the same duration.
3. Node hover (real nodes only): subtle border-color shift from hairline `.06` to `.10`, no scale/
   lift (flat-card-no-shadow rule extends to graph nodes since they're conceptually cards).
4. Missing-agent node: no hover-interactivity beyond a tooltip (not clickable — no artifact to
   open). Its dashed border may very subtly animate (border-dash marching, matching the existing
   `animated: true` React Flow edge prop already used for missing edges) — reuse, don't invent.
5. Click a real node → same drawer-open flow as List tab row click (existing behavior,
   unchanged) — `slideIn` on the drawer, not on the node itself.

**Publish-diff micro-interactions (richness budget)**
1. Dialog step transition (Config→Diff→Result): each step is a full remount, not a slide-between
   — `popIn` on the new step's mount is sufficient; do NOT add a horizontal slide between steps
   (not licensed by DESIGN.md's motion set, which only names fadeIn/slideIn(drawer)/popIn, and a
   left-right step transition would imply a new "slide sideways" motion variant).
2. File rows: `StaggeredReveal` per §4.1, capped at 12, `popIn` per row (opacity+translateY, not
   scale — scale-per-row-in-a-list reads as noisy at this density).
3. Conflict row resolver: expands via `popIn` on first mount only (not on every re-render if user
   toggles between Keep/Overwrite — track a `hasRevealed` ref/state per conflict row so re-clicks
   don't re-trigger the pop).
4. Result step: success check icon `popIn`, backup path text plain fade with no delay (it's
   secondary info, doesn't need its own beat).

**Toasts**: `popIn` entrance, plain opacity fade-out on auto-dismiss (~2.2s hold, per README),
`bg-menu #1b1e25` + hairline `.09`, positioned bottom-center-ish per README (exact offset TBD by
architect/build — not a taste call, just a pixel value).

**Reduced motion**: none of the three source docs mention `prefers-reduced-motion` handling. This
pass recommends respecting it (disable stagger delays, edge draw-in, and drawer slide → instant
opacity swap) as a baseline accessibility practice, but this is **new scope beyond the locked
spec** — flagged in Open Design Questions rather than assumed.

---

## 6. Open Design Questions

**6.1 — List-tab row menu: scope mismatch between as-built and README.**
Current `ProjectView.tsx`'s `⋯` button on command rows does exactly one thing today: opens
`CopyRunCommandDialog`. It has no dropdown, no Edit/Delete. README's spec describes a full
dropdown (`Edit, Copy run command, divider, Delete` for commands; `Edit, divider, Delete` for
agents). Agent rows currently have **no `⋯` at all**. Is building the `RowMenu` dropdown (with
Edit navigating into `BuilderDrawer`, and a real Delete action wired to project state) in scope
for this presentation-only redesign, or is it a **separate, pre-existing functional gap** that
should be ticketed independently and the redesign should keep today's single-action `⋯` for now
(just restyled)? This is a taste/scope call, not decidable from the design docs alone — flagging
rather than guessing, since STATE explicitly says "behavior stays identical," but the current
behavior *has no delete-from-list-row at all*, so "identical" and "matches README" are in tension
here.

**6.2 — Publish diff dialog width: 640px (DESIGN.md) vs 720px (current code, "publish-diff" in
DESIGN.md's own dialog-width table) vs w-720px className in `PublishDiffView.tsx` today.**
DESIGN.md's spacing/geometry section states "Dialog widths: ... publish-diff 640px..." but the
existing prototype baseline (S11 in the as-built doc) and the current real component both use
720px. Which wins? Given STATE's rule that "colors, type, spacing... come from DESIGN.md verbatim,"
640px should probably win, but flagging since the as-built doc explicitly measured 720px from the
prototype context — possible transcription drift between the three source docs. Needs a
confirm-and-lock before `/plan`.

**6.3 — Builder Drawer width: 880px (DESIGN.md/README) vs 860px (as-built baseline).**
Same category of drift as 6.2, smaller delta (20px). Likely just an as-built rounding/
approximation from reading Tailwind classes rather than a real discrepancy — but flagging
alongside 6.2 so both get resolved in the same pass rather than trickling into `/build` as two
separate off-by-a-bit bugs.

**6.4 — How much graph richness is "too much" for a dev tool?**
This pass recommends: staggered edge draw-in (capped), hover-driven edge highlight/dim, dashed
marching-ants reused for missing edges. It explicitly recommends AGAINST: node scale/lift on
hover, click-to-expand node detail popovers, animated background grid (e.g. parallax/shimmer). Is
the capped-stagger + hover-highlight level the right ceiling, or does the user want even less
(e.g. static edges, hover-highlight only, no draw-in at all) — this is a genuine taste call since
"immersive" is explicitly this pass's mandate but Symbion's own principles call the graph "a
READ-ONLY map, not a free drag-drop executor," which argues for restraint. **Needs the user's
taste call before `/plan` locks the graph's final interaction budget** — the minimalist/functional
pass (if run separately) will likely recommend the "less" end of this spectrum, and synthesis
needs a decision-maker to pick a point on that spectrum, not an average.

**6.5 — `ui/dialog.tsx` is currently a hand-rolled primitive, not real shadcn/Radix Dialog.**
CLAUDE.md's conventions doc says "shadcn UI in `apps/web/components/ui/`," and the component's own
comment says "swap for the real shadcn Dialog component when wiring the CLI" — implying this was
always meant to be a placeholder. Should this redesign finally swap in real Radix-backed shadcn
`Dialog` (gaining built-in focus-trap, portal, `data-state` attributes for animation hooks) as
part of adding the fadeIn/popIn motion, or should motion be bolted onto the existing hand-rolled
primitive to keep this pass's diff smaller? This changes the size/risk of the `/build` phase
materially (new dependency: `@radix-ui/react-dialog`) — a call for the architect/user, not this
designer pass.

**6.6 — Accent theming: "themeable, default indigo."**
DESIGN.md calls the accent color out as themeable. Is a user-facing theme picker (swap accent from
indigo to something else) in scope for THIS feature, or is "themeable" purely an implementation
note for `/build` (CSS custom property, no UI to change it yet)? README's screen list has no
"theme picker" screen, so this pass assumes **no UI surface for it in v1**, but flags it since
"themeable" language in a binding token doc could be read as a requirement.

**6.7 — Reduced-motion support** — see Interaction Notes closing paragraph. Recommend adding it
as a baseline a11y practice; flagging since it's new scope not explicitly requested by any of the
three source docs.

**Future ideas (explicitly out of scope, not to creep into this iteration):**
- Theme picker UI for the accent color (see 6.6).
- Graph minimap / zoom-to-fit controls beyond React Flow's defaults.
- Command-palette (`⌘K` is shown in the brand block per README but its behavior isn't specified
  anywhere — as-built S1's sidebar already shows a static, non-functional `⌘K` hint; this redesign
  should carry that same static hint forward, not build a real palette).
- Any run-engine visual (progress bars, live execution state) — v1 is copy-run-command only, per
  CLAUDE.md.

---

## 7. Design System — Initial Proposal (no `DESIGN.md` exists yet at repo root)

Since no `DESIGN.md` currently exists at the Symbion repo root, and this feature is the first to
introduce a durable, cross-feature token set, here is a proposed seed — sourced only from tokens
actually used across this feature's 8 screens (i.e., the token set already handed to this pass as
binding, reorganized into the canonical section order for when a human applies it as the real
file). This is a proposal only — no file has been written or overwritten.

```yaml
---
version: "1.0.0"
name: "symbion-design-system"
description: "Design tokens for Symbion's desktop UI (dark left-rail redesign)"
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
  ui-font: "IBM Plex Sans"
  mono-font: "IBM Plex Mono"
  h1: "23-24px, 700, -.02em"
  panel-title: "15-16px, 700"
  body: "14px, 400, 1.5"
  row-label: "13-13.5px, 600"
  meta-path: "12.5px, mono, faint"
  section-label: "10-10.5px, 700, uppercase, .09-.11em, faint"
  badge: "9.5-10px, 700, uppercase, .05em"
rounded:
  sm: 8
  md: 9
  lg: 12
  dialog: 16
  pill: 20
  brand-mark: 8
spacing:
  rail-width: 236
  content-max-width: 1000
  content-padding: "30-32px 40px 70-80px"
  row-comfortable: "12px 16px"
  row-compact: "8px 15px"
  gap-nav-items: 2
  gap-card-grid: "13-15px"
  gap-form-fields: 16
components:
  Dialog:
    widths:
      create: "480-500px"
      publish-config: "480-500px"
      copy-run: "480-500px"
      publish-diff: "640px"
      template-preview: "560px"
    radius: "rounded.dialog"
    motion: "popIn"
  Drawer:
    width: "880px (max 96vw)"
    split: "50/50"
    motion: "slideIn"
  Button:
    radius: "rounded.sm"
    color: "colors.accent"
  NavRow:
    pattern: "accent-spine (absolute left tick, 3px width, 16px/14px height, rounded 3px)"
---
```

Body sections (Overview / Colors / Typography / Layout / Elevation & Depth / Shapes / Components /
Do's and Don'ts) are intentionally not drafted in full prose here — this pass only seeds the
frontmatter token table since a full narrative `DESIGN.md` body is a bigger authoring effort than
this single feature's scope, and duplicating README.md's prose into a second document risks drift
between the two. Recommend the human who applies this proposal write the body sections by hand,
using README.md's "Global layout"/screen sections as source material for Layout, and this
document's §3 wireframes + §5 interaction notes as source material for Elevation & Depth / Shapes
/ Components / Do's and Don'ts.

**Elevation & Depth (values to carry into the body, not yet prose)**: dropdown shadow
`0 14px 40px rgba(0,0,0,.5)`, dialog `0 30px 80px rgba(0,0,0,.6)`, drawer
`-20px 0 60px rgba(0,0,0,.5)`, toast `0 14px 40px rgba(0,0,0,.5)`. Flat cards get NO shadow —
hairline borders only. This is a "Don't" worth stating explicitly in the body: **don't add
shadows to list rows, nav rows, or graph nodes** — shadow is reserved for floating/overlaid
surfaces (dropdown, dialog, drawer, toast) only.

**Motion (values to carry into body)**: `fadeIn .16s ease` (backdrops), `slideIn .2s
cubic-bezier(.2,.8,.2,1)` (drawer, translateX 24→0), `popIn .14-.18s ease` (dialogs/dropdowns/
toast, scale .97→1 + translateY 6→0). Do NOT invent a 4th named motion (e.g. no "slide sideways"
for step transitions, no "shimmer" for skeletons) — reuse these three for every new richness
affordance, including the graph edge draw-in and diff-row stagger proposed in this pass (both
reuse `popIn`'s curve/duration family, not a new one).

---

## Suggested next step

Run `/plan` — the architect should read this document alongside `docs/loops/
symbion-dark-redesign-STATE.md` and resolve Open Design Questions §6.1–6.6 (especially the
Radix/shadcn Dialog swap decision in §6.5, since it changes dependency surface, and the graph
richness ceiling in §6.4, since it's explicitly a taste call this pass could not make) before
committing to a component-by-component migration plan.
