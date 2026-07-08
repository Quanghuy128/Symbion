# Symbion dark redesign — Design Doc (synthesized)

> **This is a high-fidelity port, not a new design.** The visual system (colors, type, spacing,
> radii, shadows, motion) is locked pixel-accurately in three source artifacts supplied by the
> user: `DESIGN.md` (tokens), `README.md` (screen/behavior handoff), `Symbion v2 - Dark.dc.html`
> (interactive prototype). This document's job is translating that locked system into Symbion's
> real `apps/web/src` codebase — mapping every prototype screen to its real component, flagging
> where the port is pure restyle vs. structural, and surfacing every place the 3 source docs
> disagree with each other or with the as-built app, rather than silently resolving those
> disagreements. Scope was locked via Q&A before this pass (see
> `docs/loops/symbion-dark-redesign-STATE.md` §1): all 3 routes in scope, adopt the left-rail
> layout, self-host fonts via `next/font/google`.
>
> **Synthesis method**: 3 independent designer passes ran in parallel (minimalist/functional,
> rich/immersive, progressive-disclosure). All 3 independently read the real source in
> `apps/web/src` and — without coordinating — converged on the **same real code findings**: the
> row `⋯`-menu is currently single-action with no Edit/Delete dropdown, agent rows have no `⋯` at
> all, `BuilderDrawer` has no backdrop element, `ui/dialog.tsx` has zero animation and isn't a real
> Radix-backed shadcn Dialog, no toast system exists anywhere in the app, `DependencyGraph.tsx`
> renders no status-chips row, and there's a dimension drift between DESIGN.md and the as-built
> code (publish-diff 640px vs 720px; drawer 880px vs 860px). Independent convergence on these across
> 3 separately-run agents is strong evidence they're real gaps, not hallucination — they are kept as
> **Open Design Questions** below rather than silently resolved. Where the 3 passes differed in
> approach (mainly: how much motion/richness to add to the Graph tab and Publish-diff step, and
> what build order to use), this doc picks and blends as follows:
> - **Structure & scope discipline**: minimalist pass — smallest necessary component surface,
>   resists inventing UI beyond what's specified.
>   - **Graph tab & Publish-diff richness**: rich pass's specific proposals (staggered edge draw-in,
> capped row reveal, hover-highlight/dim), but capped and explicitly bounded — Symbion's own
> architecture rule that the graph is "read-only, never a free drag-drop executor" argues for
> restraint, so the richness is scoped narrowly to these 2 screens only, everything else stays flat
> and immediate per the minimalist pass.
> - **Rollout/build sequencing**: progressive-disclosure pass's 6-step build order — it correctly
>   identifies that `AppRail` can ship as an independent, low-risk structural PR before any inner
>   screen is restyled, de-risking the biggest single change in this feature.

---

## 1. User Journey

### 1a. First-time user

1. **Landing.** User opens `http://127.0.0.1:<port>/?t=<token>`. Dark shell renders immediately —
   no flash of a light theme. Left rail (236px, `bg-rail #0e1014`) shows: brand mark (26×26 accent
   rounded-square "S" + "Symbion" + mono "v0.3.0 · daemon" caption), primary nav (Builder active by
   default, accent-spine tick lit, Templates/Settings inactive), a **PROJECTS** section with the
   empty hint "∅ chưa có dự án" + a `+` button, and a daemon-footer pill ("● daemon · connected").
   Main area shows the existing `EmptyState` card, restyled dark.
2. User clicks "+ Tạo dự án" → `CreateProjectDialog` (480px, popIn). Fills name + repo path
   (Browse → `FolderBrowserDialog`), sees the green "folder exists / .claude/ found" hint.
   Confirms → optional `WorkflowDetectionPanel`/`ImportReviewStep` if a scan finds existing
   artifacts.
3. Dialog closes, toast confirms ("Đã tạo dự án"). Rail's PROJECTS section now shows the new
   project row (spine tick lights on select). Main area forces `tab=list` (existing behavior,
   unchanged).
4. Empty-artifact List tab shows two centered CTAs (`+ Thêm agent` / `+ Thêm workflow`). Clicking
   either opens `BuilderDrawer` (slideIn from right, 880px, 50/50 split) with an empty form on the
   left and a live-deriving preview pane on the right.
5. User types name + description; every keystroke updates the right-pane preview and target-path
   header live (existing behavior). Save validates name+description; on success the drawer closes,
   a toast confirms, and the row appears in the List tab with a `○` draft glyph + `draft` badge.
6. Graph tab and Publish flow are one click away (`[Sơ đồ]` toggle, `[Xuất bản ▸]` button) but
   nothing forces exploring them — this matches the existing app's behavior exactly, not a new
   gate.

### 1b. Power user (multi-project, repeat publish, conflict resolution)

1. User has 3+ projects in the rail; the PROJECTS section becomes its own scrollable region once
   it overflows (brand/nav block above and daemon footer below stay fixed).
2. Switching projects moves the spine tick and swaps the main area to that project's List tab —
   **always List first**, even if the user left the previous project on Graph (existing
   `useState<"list"|"graph">` is freshly mounted per project; this redesign does not persist tab
   choice across project switches — that would be a behavior change, out of scope).
3. Switches to **Sơ đồ (Graph)** to sanity-check dependency wiring before publishing: status chips
   row (Claude·clean, Codex·lossy/amber, missing-agent red if any dangling mention), dotted-grid
   canvas, indigo command nodes (left) / violet agent nodes (right) / dashed-red missing-agent
   nodes. Hovering a node highlights its connected edges and dims the rest — a real legibility win
   for a dependency map, not just decoration. Clicking any real node opens its `BuilderDrawer`
   directly, skipping List.
4. Clicks **Xuất bản ▸** → 3-step `PublishDialog`: Config (Claude/Codex toggle cards, conditional
   Codex ack checkbox) → Diff (bordered file-row list, `+ ~ = !` glyphs, one `!` conflict row that
   must be resolved inline via Keep-on-disk/Overwrite before the write button un-disables) →
   Result (green check, summary counts, backup path).
5. If the daemon drops mid-session: rail footer dot flips to a warning state, a red disconnected
   banner appears at the top of the main area, and every Save/Publish/Write control across every
   open surface goes `opacity-50` + guarded (existing cross-cutting behavior via
   `daemonConnected` — this redesign must not weaken that guard while restyling it).

---

## 2. Screen Inventory

| # | Screen | Entry trigger | Exit path | Real component | Change type |
|---|--------|----------------|-----------|-----------------|-------------|
| 0 | **Global shell — left rail** | Always visible | — | `AppNav` **retired**, replaced by new `AppRail`; `ProjectSidebar`'s project-list JSX absorbed into it | **Structural — largest single change** |
| 1 | Builder List tab | Default after project select; List/Graph toggle | Toggle to Graph, navigate via rail | `ProjectView` (list branch) + `EmptyState` | Restyle + one real interaction gap (row `⋯`-menu, see Open Q 6.1) |
| 2 | Builder Graph tab | Click "Sơ đồ" | Toggle back to List | `ProjectView` (graph branch) → `DependencyGraph` | Restyle + status-chips row is net-new (Open Q 6.2) |
| 3 | Builder Drawer (Agent/Workflow) | Click a row / "+ Thêm" / graph node | Cancel, Save, Escape, backdrop click | `BuilderDrawer` + `AgentForm`/`WorkflowForm`/`MarkdownTab`/`LivePreviewPane`/`ModelPicker`/Generate-* buttons | Restyle + backdrop element is net-new (currently a bare `fixed` div, no backdrop at all) |
| 4 | Publish flow (Config→Diff→Result) | Click "Xuất bản ▸" | Cancel (any step), Done | `publish/PublishDialog` → `publish/PublishDiffView` (+`ConflictResolver`) → `publish/PublishResultView` | Restyle + motion (dialog primitive currently has zero animation) |
| 5 | Copy run command dialog | Row ⋯-menu → "Copy run command" | Đóng, Copy | `CopyRunCommandDialog` | Restyle only |
| 6 | Create project dialog | Rail "+" | Hủy, Tạo dự án / Nhập N mục | `CreateProjectDialog` (+`WorkflowDetectionPanel`, `ImportScanningState`, `ImportReviewStep`, `FolderBrowserDialog`) | Restyle only |
| 7 | Templates marketplace | Rail nav "Templates" | Rail nav away | `TemplatesView` (+`AuthorTabs`, `TemplateSection`, `TemplateCard`, `TemplatePreviewModal`, license/apply/result sub-steps) | Restyle only |
| 8 | Settings / AI Providers | Rail nav "Settings" | Rail nav away | `SettingsShell` → `ProvidersPanel` (+`OllamaCard`, `ApiKeyProviderCard`, `ProviderStatusPill`) | Restyle only |

Also touched, not its own "screen": `ImportDialog` (560px) and `EmptyState` — restyle only, same
behavior. Global infra: `globals.css`, `tailwind.config.ts`, `app/layout.tsx` (font swap) — see
Component Breakdown §4.4.

---

## 3. ASCII Wireframes

### 3.0 `AppRail` (new — replaces `AppNav`, absorbs `ProjectSidebar`)

```
┌────────────────────────┐
│ ▢  Symbion             │  ← brand: 26×26 accent square "S", padding 18px 16px 14px
│    v0.3.0 · daemon     │  ← 10.5px mono, text-faint
├────────────────────────┤
│ ▐ ⬚ Builder            │  ← active: 3px accent tick, text-strong, weight 600, row-bg rgba(255,255,255,.055)
│   ▦ Templates          │  ← inactive: tick transparent, text-dim, weight 500
│   ▤ Settings           │
├────────────────────────┤
│ PROJECTS           [+] │  ← 10.5px/700 uppercase .11em faint label + 20×20 hairline "+"
│ ▐ my-api-service       │  ← active project: 14px tick, name 13px/600
│   /home/me/code/api    │  ← mono path 10.5px faint, ellipsis
│   project-b            │
│   /home/me/code/pb     │  ← scrollable region (overflow-y auto once list overflows)
├────────────────────────┤  ← flex:1 spacer sits above this footer
│ ● daemon · connected   │  ← border-top hairline, 11.5px mono, clickable (demo toggle)
└────────────────────────┘
  w=236px fixed, bg #0e1014, border-right hairline rgba(255,255,255,.06)
```

**Migration note**: `AppRail` reads only `useArtifactStore`'s `projects`/`currentProject` and
`usePathname()` — zero coupling to Builder List/Graph internals. It can ship as its own PR,
wrapping the still-unstyled `ProjectView`/`EmptyState`/`TemplatesView`/`SettingsShell` bodies
immediately, before any inner screen gets restyled. This isolates the riskiest single change
(top-nav → left-rail, touching all 3 routes) from the token/color restyle work.

### 3.1 Builder — List tab

```
┌────────────────────┬──────────────────────────────────────────────────────┐
│ [rail, see 3.0]     │  my-api-service                    [ List ][ Graph ]│ ← h1 23px/700 -.02em
│                     │  /home/me/code/api                 [ Xuất bản ▸ ]  │ ← mono 12.5px faint
│                     │──────────────────────────────────────────────────────│
│                     │  WORKFLOWS / COMMANDS (3)              [+ Workflow] │ ← section-label 10.5px/700 upper
│                     │  ┌────────────────────────────────────────────┐     │
│                     │  │ ○ /analyze   3 BA agents...            [⋯]│     │ ← row card, 12px 16px padding,
│                     │  │ ● /build     Maker codes feature...    [⋯]│     │   radius 12px, hairline border
│                     │  │ ○ /ship [draft] close out feature...   [⋯]│     │
│                     │  └────────────────────────────────────────────┘     │
│                     │  AGENTS (2)                              [+ Agent] │
│                     │  ┌────────────────────────────────────────────┐     │
│                     │  │ ● code-reviewer  Independent reviewer... [⋯]│     │ ← violet dot, mono
│                     │  │   [Read][Grep][Glob]                       │     │   tool-chips, pill r=20
│                     │  └────────────────────────────────────────────┘     │
└────────────────────┴──────────────────────────────────────────────────────┘
```

`⋯`-menu (opens below-right of the trigger, one open at a time, closes on outside click):

```
        ┌──────────────────────┐
        │ Edit                 │
        │ Copy run command     │  ← commands only, not agents
        ├──────────────────────┤
        │ Delete                │  ← danger text color
        └──────────────────────┘
        bg-menu #1b1e25, hairline .09, shadow-dropdown, popIn .14-.18s
```

### 3.2 Builder — Graph tab

```
┌────────────────────┬──────────────────────────────────────────────────────┐
│ [rail]              │  my-api-service                    [ List ][ Graph ]│
│                     │──────────────────────────────────────────────────────│
│                     │  ● Claude · clean   ▲ Codex · 3 cmds→AGENTS.md·lossy│ ← status chips (Open Q 6.2)
│                     │  ⚠ /review → agent "ship" (không tồn tại)            │
│                     │  ┌────────────────────────────────────────────────┐ │ ← dotted-grid bg
│                     │  │ ┌──────────┐            ┌──────────────┐      │ │
│                     │  │ │/analyze  │═══════════▶│ ba           │      │ │ ← indigo #818cf8 node
│                     │  │ └──────────┘  animated  └──────────────┘      │ │   / violet #a78bfa node
│                     │  │ ┌──────────┐   draw-in   ┌──────────────┐      │ │
│                     │  │ │/build    │═══════════▶│feature-builder│      │ │
│                     │  │ └──────────┘            └──────────────┘      │ │
│                     │  │ ┌──────────┐   ┄┄┄┄┄┄┄▶┌ ─ ─ ─ ─ ─ ─ ─┐      │ │
│                     │  │ │/review   │  dashed     ⚠ ship          ¦      │ │ ← dashed danger border,
│                     │  │ └──────────┘  red        (không tồn tại) ┘      │ │   not clickable
│                     │  └────────────────────────────────────────────────┘ │
│                     │  hover a node → its edges glow accent-text-hi,      │
│                     │  unrelated edges dim to ~35% opacity                │
└────────────────────┴──────────────────────────────────────────────────────┘
```

Richness budget for this screen (the one deliberately-enriched screen, per synthesis note above):
edges draw in staggered on tab-mount (~40ms/edge, capped at the first 15 — beyond that, render
immediately so a large graph doesn't feel sluggish), reusing the *same* cubic-bezier `README.md`
already licenses for `slideIn` (no new easing invented). Node hover highlights connected edges and
dims the rest. **No** node scale/lift, no click-to-expand popovers, no animated/parallax
background — those would be excess for a read-only dependency map (Symbion's architecture rules
call this graph read-only, never a free drag-drop executor, which argues for restraint beyond the
edge/hover treatment above).

### 3.3 Builder Drawer (Agent/Workflow)

```
                                    ┌──────────────────┬───────────────────┐
  backdrop: fadeIn .16s,            │ Agent builder  ✕ │ .claude/agents/   │ ← LivePreviewPane header,
  rgba(0,0,0,.5)-ish, NET-NEW       │ [Form][Markdown]  │  code-reviewer.md │   mono, faint, 12.5px
  (today's drawer has none)         │────────────────────│───────────────────│
                                    │ name *            │ ```md rendered```  │
                                    │ [ code-reviewer ] │ ---                 │ ← bg-code #08090c,
                                    │ description *     │ name: code-reviewer│   mono 12.5-13px
                                    │ [....textarea....]│ description: ...   │
                                    │ tools              │ ---                 │
                                    │ [Read][Write][Edit]│ You are...         │
                                    │  active=accent bg  │                     │
                                    │ Nội dung [Model▾][Generate]│            │
                                    │ ┌──────────────────┐│                    │
                                    │ │ textarea h-40     ││                    │
                                    │ └──────────────────┘│                    │
                                    │ ▸ Nâng cao          │  ✓ frontmatter     │
                                    │────────────────────│  hợp lệ · filename  │
                                    │ ✗ {blocking error}  │  khớp name         │
                                    │ ⚠ Mất kết nối...    │                    │
                                    │          [Hủy][Lưu] │                    │
                                    └──────────────────┴───────────────────┘
     width 880px (see Open Q 6.3), split 50/50, fixed right,
     slideIn .2s cubic-bezier(.2,.8,.2,1) translateX 24→0, shadow-drawer -20px 0 60px rgba(0,0,0,.5)
```

### 3.4 Publish flow — 3 steps (each step a full dialog remount, not a slide-between)

```
Step "config" (480-500px):                     Step "diff" (640px, see Open Q 6.3):
┌ Xuất bản ─────────────── ✕ ┐                 ┌ Xem trước thay đổi · 0.3.0 ────── ✕ ┐
│ Phiên bản  ( 0.3.0        )│                 │ ℹ AGENTS.md sẽ được chỉnh lần đầu    │
│ ┌─────────┐ ┌───────────┐  │                 │ ┌──────────────────────────────────┐│
│ │☑ Claude  │ │☐ Codex    │  │ ← toggle cards  │ │ + .claude/agents/code-reviewer.md ││ ← reveals first,
│ └─────────┘ └───────────┘  │   not checkboxes │ │ ~ .claude/commands/build.md       ││   +25ms/row stagger,
│ ☐ Tôi hiểu — gộp vào...    │ ← only if Codex  │ │ = .claude/settings.json           ││   capped at first 12
├──────────────────────────────┤   checked        │ │ ! XUNG ĐỘT — .claude/agents/ship.md││   rows (popIn each)
│         [Hủy] [Xem trước ▸] │                 │ │   [Giữ bản trên đĩa][Ghi đè]      ││ ← Ghi đè = #dc2626
└──────────────────────────────┘                 │ └──────────────────────────────────┘│   dedicated token
                                                  │ ⚠ Mất kết nối daemon...              │
Step "result" (480-500px):                       ├──────────────────────────────────────┤
┌ Kết quả xuất bản 0.3.0 ── ✕ ┐                 │  [Quay lại][Hủy]     [Ghi xuống đĩa] │
│ ✓ 4 tạo mới · 2 cập nhật ·  │                 └──────────────────────────────────────┘
│   0 lỗi                     │
│ Sao lưu: .symbion/backups/  │
│           0.3.0/            │
├──────────────────────────────┤
│                     [Xong]  │
└──────────────────────────────┘
```

Richness budget for the Diff step (the second deliberately-enriched screen): rows reveal via
`popIn` staggered ~25ms apart, capped at the first 12 rows (rest render immediately — a 60-file
diff shouldn't feel slow). Conflict rows expand their inline resolver via `popIn` on first mount
only (track a `hasRevealed` flag so re-toggling Keep/Overwrite doesn't re-trigger the animation).
**No** slide-between-steps transition — that would imply a 4th motion variant not licensed by
DESIGN.md's named set (fadeIn/slideIn/popIn only).

### 3.5 Copy run command dialog (480px)

```
┌ Copy run command — /build ────────── ✕ ┐
│ Requirements  ( ...                   )│
│ Model (optional)  ( claude-opus-4      )│
│ Option (optional) ( --gate             )│
│ ┌────────────────────────────────────┐ │  ← bg-code, mono, select-all on click
│ │ /build "..." --model=... --gate     │ │
│ └────────────────────────────────────┘ │
│ Đã copy vào clipboard.                  │
├────────────────────────────────────────┤
│                       [Đóng]  [Copy]   │
└────────────────────────────────────────┘
```

### 3.6 Create project dialog (480px)

```
┌ Tạo dự án mới ─────────────────────── ✕ ┐
│ Tên dự án      ( My API Service        )│
│ Đường dẫn repo ( …/code/api  ) [Chọn…] │
│ ✓ Thư mục tồn tại · .claude/ đã có      │  ← success-tinted
│ (or ✗ Thư mục không tồn tại [Tạo thư mục])│ ← danger-tinted
│ [WorkflowDetectionPanel / scanning / review — unchanged sub-steps] │
├────────────────────────────────────────┤
│                    [Hủy]   [Tạo dự án] │
└────────────────────────────────────────┘
```

### 3.7 Templates marketplace

```
┌────────────────────┬──────────────────────────────────────────────────────┐
│ [rail, Templates    │  Templates                                          │
│  nav-row active]    │  Thư viện mẫu agent / command / skill...            │
│                     │  [ Symbion ]  author-x  author-y   ← Symbion active,│
│                     │   underlined (accent border-bottom)                 │
│                     │  SKILLS ───────────────────────────────────────     │
│                     │  ┌────────────┐ ┌────────────┐    ← cyan #22d3ee    │
│                     │  AGENTS ───────────────────────────────────────     │
│                     │  ┌────────────┐ ┌────────────┐    ← violet #a78bfa  │
│                     │  COMMANDS ─────────────────────────────────────     │
│                     │  ┌────────────┐ ┌────────────┐ ┌────────────┐  ← indigo #818cf8│
│                     │  ⚠ 2 mẫu không tải được → đã bỏ qua [Xem CT]       │
└────────────────────┴──────────────────────────────────────────────────────┘
```

Preview modal (560px) and its apply/license/project-picker/result sub-steps: same structure as
today, restyled only.

### 3.8 Settings / AI Providers

```
┌────────────────────┬──────────────────────────────────────────────────────┐
│ [rail, Settings     │  Nhà cung cấp AI                                    │
│  nav-row active]    │  ┌───────────────────────┐ ┌───────────────────────┐│
│                     │  │ Ollama (cục bộ)  ●conn │ │ OpenAI    [mặc định] ││ ← grid-cols-2
│                     │  │ [pre: curl...] [Copy]  │ │ API key (••••)[Lưu]  ││   card=bg-panel,
│                     │  │ [Kiểm tra][Đặt mặc định]│ │[Kiểm tra][Đặt mặc định]││  active border=accent
│                     │  └───────────────────────┘ └───────────────────────┘│
└────────────────────┴──────────────────────────────────────────────────────┘
```

---

## 4. Component Breakdown

### 4.1 New components

| Component | Path | Props / contract |
|---|---|---|
| `AppRail` | `apps/web/src/components/AppRail.tsx` | Replaces `AppNav`, absorbs `ProjectSidebar`'s project-list logic. Props: `onCreateProject: () => void`, `onSelectProject: (id: string) => void` (mirrors `ProjectSidebar`'s existing prop shape — reuse, don't invent new). Reads `usePathname()` for nav active-state, `useArtifactStore` for `projects`/`currentProject`/`daemonConnected`. Composes: brand block, 3× `NavItem` (primary nav), Projects section (label + `+` + scrollable `NavItem` list), spacer, `DaemonStatusBadge` footer (existing component, relocated). |
| `NavItem` | `apps/web/src/components/rail/NavItem.tsx` | One component for both primary-nav rows and project rows (same accent-spine visual pattern, different tick height). `interface NavItemProps { active: boolean; icon?: ReactNode; label: string; sublabel?: string; variant: "nav" | "project"; href?: string; onClick?: () => void }` — renders `<Link>` if `href` given, else `<button>` (project rows are client-state selection, not routes). |
| `RowMenu` | `apps/web/src/components/ui/row-menu.tsx` (new shadcn `DropdownMenu` primitive, not yet in the codebase) | `interface RowMenuAction { label: string; onSelect: () => void; danger?: boolean }` (+ a divider sentinel). `interface RowMenuProps { actions: RowMenuAction[]; open: boolean; onOpenChange: (open: boolean) => void }`. Parent (`ProjectView`) owns the single `openMenuId` state (already named in the locked state-shape) — one open at a time, closes on outside click. |
| `DisconnectedBanner` | `apps/web/src/components/DisconnectedBanner.tsx` | No props — reads `daemonConnected` from the store directly (same pattern as `DaemonStatusBadge`). Rendered once per route's main-content wrapper, above the active view. *(Note: baseline doc's S1 already documents a full-width footer badge; confirm at build time whether this is truly a second, distinct top-of-main element per README, or the same footer pill promoted — see Open Q 6.6.)* |
| `GraphStatusChips` | `apps/web/src/components/graph/GraphStatusChips.tsx` | `interface GraphStatusChipsProps { claudeClean: boolean; codexLossyCount: number; missingAgentMentions: string[] }`. Pure presentational row above the graph canvas. Data source TBD — see Open Q 6.2. |
| `CommandNode`, `AgentNode`, `MissingAgentNode` | `apps/web/src/components/graph/*.tsx` | React Flow custom node components (`NodeProps<{label; slug?; toolCount?}>`), registered via `nodeTypes`. Kept presentational/dumb — hover-highlight state computed in the parent, not inside the node. |
| `AnimatedEdge` | `apps/web/src/components/graph/AnimatedEdge.tsx` | React Flow custom edge (`EdgeProps`), registered via `edgeTypes`. Implements the capped staggered draw-in (§3.2) via a CSS animation class on mount; respects `prefers-reduced-motion` (see Interaction Notes). Missing-edge variant reuses React Flow's existing `animated` (dashed marching-ants) prop, recolored to the danger token — not a new effect. |
| `StaggeredReveal` | `apps/web/src/components/ui/staggered-reveal.tsx` | `interface StaggeredRevealProps { children: ReactNode[]; staggerMs?: number /* default 25 */; cap?: number /* default 12 */ }`. Used **only** by `PublishDiffView`'s file-row list — explicitly not used by the List tab's row list (that should stay flat/immediate per the minimalist discipline). |

### 4.2 Files that change (restyle-only, no structural change)

`apps/web/src/app/globals.css`, `apps/web/tailwind.config.ts`, `apps/web/src/app/layout.tsx`
(font swap — see §4.4), `ui/button.tsx`, `ui/input.tsx`, `ui/checkbox.tsx`, `AgentForm.tsx`,
`WorkflowForm.tsx`, `MarkdownTab.tsx`, `LivePreviewPane.tsx`, `ModelPicker.tsx`,
`GenerateBodyButton.tsx`/`GenerateBodyDisclosure.tsx`, `GenerateDescriptionButton.tsx`,
`publish/PublishResultView.tsx`, `CopyRunCommandDialog.tsx`, `CreateProjectDialog.tsx`,
`FolderBrowserDialog.tsx`, `WorkflowDetectionPanel.tsx`, `ImportScanningState.tsx`,
`ImportReviewStep.tsx`, `ImportDialog.tsx`, `EmptyState.tsx`, `TemplatesView.tsx`, `AuthorTabs.tsx`,
`TemplateSection.tsx`, `TemplateCard.tsx`, `TemplatePreviewModal.tsx`, `TemplateMarkdownViewer.tsx`,
`LicenseAcknowledgmentStep.tsx`, `ProjectPickerStep.tsx`, `ApplyResultPanel.tsx`,
`AuthorSkippedSummary.tsx`, `AuthorFetchLoadingState.tsx`, `AuthorFetchErrorPanel.tsx`,
`SettingsShell.tsx`, `ProvidersPanel.tsx`, `OllamaCard.tsx`, `ApiKeyProviderCard.tsx`,
`ProviderStatusPill.tsx`. All three routes' page wrappers (`app/page.tsx`, `app/templates/page.tsx`,
`app/settings/page.tsx`) drop their `<AppNav />` render in favor of `<AppRail />`.

### 4.3 Files that change (restyle + real structural addition)

| File | What's structural, precisely |
|---|---|
| `ProjectView.tsx` | Wire the real `RowMenu` dropdown (currently a bare `⋯` button hard-wired to open Copy-run-command only — no Edit/Delete, and agent rows have no `⋯` at all). This is a real interaction gap between as-built and spec, not just a restyle. See Open Q 6.1. |
| `DependencyGraph.tsx` | Register `nodeTypes`/`edgeTypes` for the new custom node/edge components; add `GraphStatusChips` fed by data not currently computed in this component (Open Q 6.2); swap `<Background>` to the dotted variant; recolor node/edge inline styles to exact tokens (current values are close-but-not-exact, e.g. `#6366f1`/`#8b5cf6` vs the target `#818cf8`/`#a78bfa`). |
| `BuilderDrawer.tsx` | Add a backdrop `<div>` (today's drawer is a bare `fixed` panel with **no backdrop element at all** — no click-outside-to-close, no `fadeIn` surface). Add the `slideIn` panel animation. Width 860px→880px. |
| `ui/dialog.tsx` | Add `fadeIn` (backdrop) + `popIn` (panel) animation — currently zero animation. `open`/`onClose`/`children`/`className` props unchanged; per-dialog widths are already just `className` overrides at each call site, no primitive redesign needed. See Open Q 6.5 (whether to also swap in real Radix). |
| `publish/PublishDialog.tsx` | Config-step Claude/Codex checkboxes become clickable "toggle cards" per README — a real markup change (`<input type=checkbox><label>` → a bordered clickable card), not just color swap. |
| `publish/PublishDiffView.tsx` | Wrap the file-row list in `StaggeredReveal`. Width 720px→640px (Open Q 6.3). |
| `publish/ConflictResolver.tsx` | Add `popIn`-on-first-mount expand (existing props unchanged). |

### 4.4 Global infra (spans all screens)

- **`globals.css`**: replace the light/dark HSL variable pair with the locked dark token set,
  directly in `:root` (the app currently never applies a `.dark` class anywhere despite
  `tailwind.config.ts` declaring `darkMode: "class"` — see Open Q 6.4 on whether to delete the dead
  light-mode variables or keep them unused).
- **`tailwind.config.ts`**: add every DESIGN.md color token (`bg-app`, `bg-rail`, `bg-panel`,
  `bg-surface`, `bg-menu`, `bg-input`, `bg-code`, `text-strong`…`text-faint`, `accent`/`accent-soft`/
  `accent-text`/`accent-text-hi`, `command`/`agent`/`skill`, `success`/`warning`/`danger`,
  `overwrite-btn`); expand `fontFamily` for IBM Plex; expand `borderRadius` from today's single
  `--radius` var to the 5-step scale (8/9/12/16/20); add `boxShadow.dropdown/dialog/drawer/toast`;
  add `keyframes`/`animation` for `fadeIn`/`slideIn`/`popIn`.
- **`app/layout.tsx`**: swap to `next/font/google` `IBM_Plex_Sans` (400/500/600/700) +
  `IBM_Plex_Mono` (400/500/600), self-hosted, applied via CSS variable on `<html>`/`<body>`;
  `lang="vi"` unchanged.
- **New shadcn primitives to add**: `dropdown-menu.tsx` (for `RowMenu`), `badge.tsx` (for the
  `draft` badge, currently a raw styled `<span>`). Both are net-new — only `dialog.tsx`/
  `button.tsx`/`input.tsx`/`checkbox.tsx` exist in `ui/` today.
- **Toast system**: does not exist anywhere in the current app (creates/saves currently close
  dialogs silently on success). Building one (`toast` store slice — already named in the locked
  state shape — + a root-mounted `<Toaster/>`) is new plumbing, not a restyle. See Open Q 6.7 on
  whether this is in scope for a "presentation-only" pass.

### 4.5 Files to retire

- **`AppNav.tsx`** — superseded by `AppRail.tsx`. Delete only once all 3 route shells have
  migrated (never leave a route with no nav mid-migration).
- **`ProjectSidebar.tsx`** — its project-list responsibility is absorbed into `AppRail`. Delete in
  a separate follow-up commit after `AppRail` is confirmed working (so a revert is a one-line rail
  swap, not a resurrection of a deleted file). Its "⌘K" hint and "CẤU HÌNH / ⚙ Cài đặt chung" row
  have no equivalent in the locked prototype — see Open Q 6.8.

### 4.6 shadcn / library reuse

`Button`, `Input`, `Checkbox` (existing) are restyled in place, no interface change. `Dialog` is
restyled in place (motion added) with an open question on whether to also swap to real Radix (Open
Q 6.5). React Flow stays the graph engine (read-only, per architecture rules — this redesign adds
custom node/edge *rendering*, never adds drag-to-reconnect or any write-capable graph interaction).
CodeMirror 6 stays the markdown/frontmatter editor (`MarkdownTab.tsx`) — restyle only (dark theme
variant), no editor swap.

---

## 5. Interaction Notes

**Loading**: `ProvidersPanel`, `PublishDiffView` ("Đang tính diff…"), `AuthorFetchLoadingState`,
`ImportScanningState` — keep exact current text/spinner, recolor spinner to accent/text-dim only.
No new loading states.

**Empty**: `EmptyState` (0 projects), List tab's 0-artifact CTAs, Templates' "0 mẫu hợp lệ", rail's
"∅ chưa có dự án" — restyle only, same trigger conditions and copy.

**Error**: validation errors, save/write failures, provider errors — map to `danger`/
`danger-text` tokens. No motion on error appearance (a bounce/pop would undercut how serious a
blocking error should read).

**Daemon-down**: exactly as today — `disabled` + `opacity-50` on every Save/Publish/Write control
(Tailwind's `disabled:opacity-50` on `Button` already generalizes this, no per-screen
special-casing needed). The footer pill flips to a warning state; whether a *second*,
distinct top-of-main banner also appears is Open Q 6.6 — do not build a duplicate indicator
without confirming that's the intent.

**Row `⋯`-menus**: toggle, close on outside click, one open at a time (owned by `ProjectView`'s
`openMenuId`, matching the locked state shape). This is the single largest *behavioral* gap between
baseline and target for the List tab — see Open Q 6.1 before building.

**Drawer live-derive**: already true today (`AgentForm`/`WorkflowForm` mutate local state on every
keystroke, `LivePreviewPane` re-renders) — no logic change, only new chrome around the same data
flow.

**Tool chips**: existing toggle-membership logic, restyle active state to `accent`/`accent-soft`.

**Graph micro-interactions** (bounded richness, §3.2): edge draw-in on tab-mount (staggered,
capped at 15), node-hover edge highlight/dim (plain CSS transition, ~120ms — inside DESIGN.md's
140–260ms motion family even though not a literally named token), missing-agent node not
interactive beyond a tooltip. No node scale/lift, no click-to-expand, no animated background.

**Publish-diff micro-interactions** (bounded richness, §3.4): row reveal staggered + capped at 12,
conflict-resolver expand via `popIn` on first mount only (guard against re-triggering on
Keep/Overwrite re-clicks). No slide-between-steps.

**Toasts**: `popIn` entrance, plain fade-out on auto-dismiss (~2.2s hold per README), `bg-menu` +
hairline, bottom-center-ish (exact offset is a build-time pixel value, not a taste call). Contingent
on Open Q 6.7 (build now vs. defer).

**Reduced motion**: none of the 3 source docs mention `prefers-reduced-motion`. Recommend
respecting it (disable stagger/draw-in/slide → instant opacity swap) as baseline accessibility
practice — this is new scope beyond the locked spec, flagged rather than assumed (Open Q 6.9).

**Progressive disclosure already present, preserved as-is**: List tab is the forced default after
project selection (Graph is opt-in) — unchanged. The Drawer's "▸ Nâng cao" (Advanced fields)
section is collapsed by default — unchanged, just restyled disclosure chevron/row. No *new*
progressive-disclosure gate is introduced anywhere (e.g. Settings does not grow a basic/advanced
split) — that's explicitly out of scope, see Future Ideas.

---

## 6. Open Design Questions

*(Do not guess on any of these — surfaced here for the user/architect to resolve before `/plan`
locks the migration plan.)*

1. **Row `⋯`-menu scope** — the current `ProjectView.tsx`'s `⋯` on command rows does exactly one
   thing (opens Copy-run-command); there is no dropdown, no Edit/Delete, and agent rows have no
   `⋯` at all. README's spec wants a full dropdown (`Edit, Copy run command, divider, Delete` for
   commands; `Edit, divider, Delete` for agents). Is wiring a real Delete action (which doesn't
   exist in the app today) in scope for this presentation-only redesign, or should the ported menu
   only surface actions that already have real handlers, with Delete/divider deferred to a separate
   ticket?
2. **Graph status-chips data source** — `DependencyGraph.tsx` currently computes and renders no
   status-chips row at all. Is the Claude-clean/Codex-lossy computation already available from
   `packages/core`'s adapter/diff logic (pure presentation, wire an existing value into new UI), or
   does it require new client-side derivation (which would cross from presentation into new
   behavior, arguably outside this feature's "no data-model/flow changes" constraint)?
3. **Dimension drift** — DESIGN.md says publish-diff dialog = 640px and drawer = 880px; the as-built
   app currently uses 720px and 860px respectively. Snap exactly to the prototype's tokens, or are
   the as-built values an intentional prior deviation (e.g. for content-fitting) that should stand?
4. **Toast system** — does not exist anywhere in the current app. README's interaction notes assume
   one. Building it (new store slice already named `toast` in the locked shape, + a root-mounted
   `<Toaster/>`) is new plumbing, not a restyle. In scope for this pass, or a follow-up feature?
5. **`ui/dialog.tsx` — swap to real Radix-backed shadcn `Dialog`, or bolt motion onto the existing
   hand-rolled primitive?** The component's own comment already flags it as a placeholder meant to
   be swapped later. Swapping now gains focus-trap/portal/`data-state` animation hooks for free but
   adds a new dependency (`@radix-ui/react-dialog`) and enlarges `/build`'s risk surface; bolting on
   motion keeps the diff smaller but leaves known-missing a11y behavior (focus trap) unaddressed.
6. **Second disconnected indicator** — README describes an "optional" top-of-main banner distinct
   from the existing footer pill. Today there is exactly one indicator (the footer pill). Add the
   second, or promote the footer pill to be more prominent and skip the banner?
7. **Dark-only vs. dead light-mode code** — `tailwind.config.ts` declares `darkMode: "class"` but no
   code ever applies `.dark`; the app is light-only today by default and this redesign has no
   light/dark toggle anywhere in its 3 source docs. Delete the light `:root` variables entirely
   (simplest, matches "dark is the only supported mode now"), or keep both sets and force-apply
   `.dark` unconditionally (more future-proof if light mode is ever requested back, at the cost of
   dead code)?
8. **`ProjectSidebar`'s vestigial "CẤU HÌNH / ⚙ Cài đặt chung" row** — duplicates the primary nav's
   "Settings" entry (no `onClick` observed, appears unwired already) and the rail's "⌘K" hint (also
   apparently non-functional today). Neither appears in README's rail spec. Drop both in the port,
   or preserve as placeholders for planned-but-unbuilt features?
9. **Graph richness ceiling** — this doc recommends capped edge draw-in + hover highlight/dim as the
   ceiling, explicitly against node scale/lift, click-to-expand popovers, or animated backgrounds.
   Confirm this is the right point on the minimal↔immersive spectrum, not "even the capped version
   is too much" or "go further."
10. **Reduced-motion support** — not requested by any of the 3 source docs; recommended here as a
    baseline a11y practice. Build now as part of this pass, or track separately?

**Future ideas (explicitly out of scope for this port — do not build without a separate ask):**
- Theme picker UI for swapping the accent color (DESIGN.md calls it "themeable" as an
  implementation note, not a UI requirement — no theme-picker screen exists in README's screen
  list).
- Graph minimap / zoom-to-fit controls beyond React Flow's defaults.
- A real `⌘K` command palette (the hint is currently static/non-functional; carry it forward as-is,
  don't build the palette here).
- Any run-engine visual (progress bars, live execution state) — v1 is copy-run-command only.
- Settings basic/advanced tiering (only relevant once more providers/knobs exist than today).
- A first-run product tour highlighting the rail's new location.
- Persisting List/Graph tab choice per-project across sessions (would be a behavior change).

---

## 7. Design System — initial proposal

No `DESIGN.md` exists yet at the Symbion repo root. Since this feature is the natural first mover
(it's porting a pre-locked token set into the codebase for the first time), this section proposes
seeding one — trimmed to only the tokens actually consumed by the 8 in-scope screens above, per the
`designer.md` convention of not fabricating unused tokens. This is a proposal only; a human (or a
later "apply design system update" step) applies it for real.

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
  nav-item: 9
  panel: 12
  dialog: 16
  pill: 20
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
    radius: "rounded.dialog"
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
Symbion's UI is a desktop-class, dark-only developer tool. This token set governs the left-rail
shell, panels/cards, dialogs, the read-only dependency graph's node coloring, and the publish diff
viewer.

### Colors
See frontmatter `colors`. `command`/`agent`/`skill` are artifact-kind identity colors, used
consistently across list rows, graph nodes, and template-kind badges. `success`/`warning`/`danger`
are status colors. `overwrite-btn` is a dedicated destructive-confirm color, distinct from generic
`danger`, used only on the Publish diff conflict resolver's "Ghi đè" button. Accent is themeable
(default indigo) — components must reference `accent`/`accent-soft`/`accent-text` tokens, never a
hardcoded indigo hex, so a future accent theme doesn't require a repaint.

### Typography
IBM Plex Sans for UI text, IBM Plex Mono for anything technical (paths, commands, tool names,
version strings, code) — self-hosted via `next/font/google`, not a CDN `<link>`.

### Layout
Left rail fixed 236px. Main content centered, max-width 1000px, padding 30-32px horizontal / 40px
/ 30-80px vertical. No responsive breakpoint below desktop is in scope — this is a localhost dev
tool, not a public site.

### Elevation & Depth
No shadows on flat cards/panels — hairline borders only. Shadows reserved for floating layers:
dropdown, dialog, drawer, toast (see `components` shadow values above).

### Shapes
Radius scale: 8 (buttons/inputs), 9 (nav rows — intentionally distinct from the 8/12 scale, not a
typo), 12 (panels/cards), 16 (dialogs), 20 (pills/chips/badges).

### Components
`Button`, `Dialog`, `Drawer`, `Dropdown`, `Toast`, `NavItem` per the frontmatter block above.
`RowMenu` (dropdown), `NavItem` (accent-spine row), `Badge`, and `DropdownMenu` (shadcn primitive)
are new components this feature introduces.

### Do's and Don'ts
- Do use the accent-spine tick pattern for any list of "selectable rows representing a navigable
  identity" (primary nav, projects). Don't invent a second selection-indicator style for the same
  semantic role.
- Do keep flat cards shadow-free — hairline borders only. Don't add shadows to list-row cards,
  provider cards, or graph nodes; shadows are reserved for elements that float above the page flow.
- Do use mono font for anything a developer would copy-paste or byte-compare (paths, versions, tool
  names, code). Don't use mono for prose/descriptions.
- Do reuse the three named motion tokens (`fadeIn`, `slideIn`, `popIn`) for any new richness
  affordance (e.g. graph edge draw-in, diff-row stagger reuse `popIn`'s curve/duration family).
  Don't invent a 4th motion variant (no "slide sideways" for step transitions, no shimmer for
  skeletons).
- Don't introduce a light-mode variant without an explicit product decision (Open Q 6.7) — this
  system is dark-only by design intent.

---

## Suggested build order (for `/plan` to validate/adjust)

Chosen so each cut point leaves the app fully working, never mid-broken, and the riskiest
structural change lands isolated and early:

1. **Infra** — `globals.css` tokens, `tailwind.config.ts` additions, font swap in `layout.tsx`.
   Additive; old utility classes keep resolving to *some* color throughout, so the app doesn't
   break mid-stack even before every component repaints.
2. **`AppRail`** (structural shell swap, all 3 routes) — ships wrapping the still-unstyled inner
   views. Highest-risk single PR (touches every route's layout); land it alone, right after infra,
   so a regression is easy to bisect.
3. **Builder List tab restyle** (`ProjectView` list branch, row cards, new `RowMenu`/`Badge`
   primitives) — most-used screen, good next target once the shell is stable.
4. **BuilderDrawer + Publish flow restyle** — the deepest interaction surfaces; do these once List
   tab's visual language (cards/buttons/inputs) is settled, so they inherit proven patterns.
5. **Graph tab restyle + status-chips** — deliberately last among Builder pieces, since it has the
   one genuinely open structural question (Open Q 6.2, data source) that may block building it at
   all until answered.
6. **Templates + Settings restyle** — lowest-traffic, least state complexity, most mechanical
   (grid of cards, no new interaction patterns); safe to do last without blocking anything else.

---

## Suggested next step

Run `/plan` — the architect should read this doc alongside `docs/loops/symbion-dark-redesign-STATE.md`
and resolve the 10 Open Design Questions in §6 (especially #1/#2/#4/#5, which each risk turning a
"presentation-only" ticket into one with small-but-real new logic) before committing to a final
component-by-component migration plan and sequencing per §"Suggested build order" above.
