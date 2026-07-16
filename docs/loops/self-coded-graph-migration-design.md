# self-coded-graph-migration — Design

> Synthesized from 3 parallel designer passes (minimalist, rich/immersive, progressive disclosure).
> Scope source of truth: `docs/loops/self-coded-graph-migration-STATE.md` §6-§8 (locked 2026-07-15).
>
> **HARD BLOCKING PRECONDITION (restated, do not lose this):** this feature does not proceed to
> `/plan` or `/build` until `graph-execution-realtime` P2 (token roll-up UI) and P3
> (history/reattach/settings) have shipped and stabilized. Confirmed **not started** as of this
> writing (only P1 shipped, `f65b34b`). This design doc exists so the target is ready the moment
> that gate clears — it does not itself clear the gate.
>
> **Chosen synthesis approach**: the minimalist angle's discipline ("every wireframe should be
> pixel-identical to today, any visual departure is a bug in the doc, not an intentional
> improvement") is adopted as the **default posture**, because it best matches the STATE file's
> own explicit framing ("this is a rendering-primitive swap, NOT a redesign") and the user's own
> confirmed answer (§7 Q2: this is a full replacement of the *engine*, not an invitation to also
> change the *look*). The progressive-disclosure pass's state-machine rigor (which disclosure
> states can coexist, what must never visually fight what) is folded in as the authoritative
> interaction model, since it's the most precise description of behavior that must not regress.
> The rich pass's ideas are preserved as an **explicit, separately-gated "Future Ideas" list** —
> genuinely good ideas, but every one of them is a visual/behavioral departure from today's
> shipped output, which the locked scope (FR-1..FR-4, "preserve bit-for-bit") does not authorize
> without a taste call the user has not yet made. None are silently folded into the baseline.

---

## 1. User Journey

### 1A. First-time viewer (calm, at-rest canvas)

A user opens a project; the Graph tab renders. Dagre-computed layout, indigo command nodes on
the left rank, violet agent nodes on the right rank(s), thin gray bezier edges connecting them.
Everything fully opaque, no glow, no toolbar visible — **the canvas reads as a calm, static map**,
pixel-identical to today's at-rest React Flow output. A first-run hint bar appears above the
canvas exactly as today (unchanged component). Always-visible metadata (×N count badges, goal
dots, the dashed-red missing-agent treatment) render regardless of hover — these are data, not
authoring affordances.

### 1B. Power user — active authoring (linking many nodes, ~10-30 node scale)

1. User hovers a node: its `⋯` menu button and connect handle fade in; the whole graph dims to
   35% opacity except the hovered node and its direct neighbors (self-coded hit-testing on
   `mousemove` replaces React Flow's `onNodeMouseEnter`/`onNodeMouseLeave`).
2. User drags from a command's source handle toward an agent: a dashed ghost line (self-coded
   SVG `<path>`) follows the cursor in real time. Dropping on a valid agent target fires the
   existing `onConnect` → `upsertAgentRef` → `saveArtifact` flow (non-optimistic — a
   `pendingConnection` ghost edge renders locally while the RPC is in flight, exactly as today,
   never mirrored into the derived node/edge store — E10 preserved). Dropping on an invalid
   target or empty canvas snaps the ghost back with no write.
3. User hovers/clicks an edge: the same `+`/`×` toolbar appears at the midpoint (wide 20px
   invisible hit-area carried over unchanged, per today's own `AnimatedEdge.tsx` comment
   explaining why an undecorated edge needs one). `+` opens `EdgeRelationModal` (unchanged
   sibling component). `×` shows the inline "Delete? ✓ ✗" confirm.
4. User right-clicks empty canvas: `GraphCanvasMenu` opens at the cursor (Add workflow / Add
   agent / Fit to view) — unchanged component, only its trigger now comes from the self-coded
   canvas's own `onContextMenu` instead of xyflow's `onPaneContextMenu`.
5. Multiple disclosure states can be open simultaneously and must not fight each other: e.g., an
   in-progress connect-drag from one node, a pinned edge delete-confirm on a different edge, and
   a hover-revealed "Create this agent" affordance on a missing-agent node, all at once. Only one
   *graph-wide dim* mode is ever active (see §5's mutual-exclusion notes).

### 1C. Power user — watching a live run (mission mode)

1. User clicks Execute on a command → `RunDialog` (preflight checks, permission-mode ack,
   unchanged sibling) → run starts.
2. **All authoring affordances hard-hide** (not just dim): hover-dim, connect-drag handles, the
   edge toolbar, and the pane context menu stop responding entirely — this is the existing
   `authoringSuspended` gate, now enforced via early-returns in the self-coded event handlers
   instead of xyflow prop toggles.
3. Mission-mode overlay activates: the executing node gets its glow ring (`animate-glowPulse`,
   cyan, unchanged), its reachable agents (by `@mention`) stay full-opacity, everything else
   dims to 35%. Participant edges show the `runFlow: "flowing"` state (today ships the data
   field; the actual dash-flow animation is P2-deferred per the sibling feature and is **not**
   pulled forward by this migration — see Open Design Question 3).
4. `MissionStatusStrip` (unchanged) shows status/elapsed/cancel; `RunLogTail` (unchanged, P1
   raw-tail; richer `RunTimelinePanel` is separately-scoped P2 work this migration does not
   touch) docks to the right.
5. Run reaches a terminal status → overlay clears, authoring resumes automatically, no explicit
   user action needed — existing, locked behavior (FR-3).

At no point should a user perceive "a new graph engine" — that is this design's success
criterion.

---

## 2. Screen Inventory

No new screens or routes — this migration swaps the rendering mechanics of one existing panel
(`DependencyGraph` inside `ProjectView`'s Graph tab) and its interactive overlays.

| # | Screen / state | Entry trigger | Exit path |
|---|---|---|---|
| 1 | **Idle canvas** (at-rest) | Default — Graph tab selected, nothing hovered/dragging/running | Any hover, drag, click, or run start |
| 2 | **Node-hover reveal** (handle + `⋯` menu fade-in + graph-wide dim) | Mouse enters a node's bounding box | Mouse leaves node (and no other trigger keeps dim/reveal active) |
| 3 | **Edge-hover / pinned reveal** (`+`/`×` toolbar) | Mouse enters an edge's hit-path, or edge clicked (pinned via `selectedEdgeId`) | Mouse leaves (unpinned case) / pane click clears selection |
| 4 | **Connect-drag (ghost edge)** | Mousedown+drag from a command's source handle | Mouseup over valid/invalid target, or Esc/drop-on-empty-pane cancels |
| 5 | **Edge relationship modal** (`EdgeRelationModal`, unchanged) | Click `+` on the toolbar | Save / Cancel / Esc |
| 6 | **Edge unlink inline confirm** | Click `×` on the toolbar | Confirm (✓) / Cancel (✗) |
| 7 | **Pane right-click context menu** (`GraphCanvasMenu`, unchanged) | Right-click empty canvas | Outside click / Esc / item selected |
| 8 | **Node `⋯` menu** (`NodeMenu`, unchanged) | Click `⋯` on a hovered node | Outside click / Esc / item selected |
| 9 | **Node delete-confirm** (`NodeDeleteConfirm`, unchanged) | "Delete" from the `⋯` menu | Confirm / Cancel |
| 10 | **Missing-agent "create" affordance** | Mouse enters a `missingAgent` node | Mouse leaves / click "Create" opens the drawer |
| 11 | **"Just added" ring** | A node newly appears in `artifacts` | Auto-fades after ~1.6s, no user action |
| 12 | **Mission-mode overlay** (dense — authoring hard-hidden) | A run starts (non-terminal status reported) | Run reaches a terminal status |
| 13 | **Chrome** — `GraphToolbar`, `GraphLegend`, `GraphHintBar`, `GraphStatusChips`, `DaemonRibbon` | Always visible / conditional per existing rules | Unchanged |

States 2-11 can, in the current implementation, be independently "open" at the same time (e.g.,
hovering one node while another edge has a pinned toolbar) — the self-coded version must
preserve this independence, not collapse it into one global hover flag.

---

## 3. ASCII Wireframes

### 3.1 Idle canvas (first-time viewer, nothing revealed)

```
┌ Graph ──────────────────────────────────────────────────────────────────┐
│ ● Claude · clean      ● Codex · clean                                   │
│ ┌ ＋ Add ▾  ⤢ Fit to view  ? ┐                                          │
│                                                                          │
│   ┌──────────┐                    ┌──────────┐                         │
│   │ /analyze │───────────────────▶│    ba    │                         │
│   └──────────┘                    └──────────┘                         │
│                                                                          │
│   ┌──────────┐        ×3          ┌──────────┐                         │
│   │ /build   │───────────────────▶│architect │                         │
│   └──────────┘                    └──────────┘                         │
│                                                                          │
│   ┌──────────┐                    ┌───────────────────────┐            │
│   │ /review  │╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌▶│⚠ security (does not   │            │
│   └──────────┘                    │  exist)               │            │
│                                    └───────────────────────┘            │
└──────────────────────────────────────────────────────────────────────────┘
  ^ no handles, no ⋯ buttons, no edge toolbars visible — only structure +
    always-on data (×N badge, dashed-red missing-edge treatment).
```

### 3.2 Node-hover reveal (handle + menu fade-in + graph-wide dim)

```
┌ Graph ──────────────────────────────────────────────────────────────────┐
│   ┌──────────┐●   ⋯              ┌──────────┐   ← full opacity          │
│   │ /analyze │◄─ hovered ────────▶│    ba    │      (connected)         │
│   └──────────┘                    └──────────┘                         │
│                                                                          │
│   ┌╌╌╌╌╌╌╌╌╌╌┐        ×3          ┌╌╌╌╌╌╌╌╌╌╌┐   ← dimmed to 35%        │
│   ╎ /build   ╎╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌▷╎architect ╎      (unconnected)       │
│   └╌╌╌╌╌╌╌╌╌╌┘                    └╌╌╌╌╌╌╌╌╌╌┘                         │
└──────────────────────────────────────────────────────────────────────────┘
  ● = source handle (fades in only on node hover), ⋯ = node menu button.
  Connected edge to `ba` gets highlight color/width; everything else → 35%.
```

### 3.3 Edge hover / pinned toolbar

```
   ┌──────────┐    ×3  [ + ][ × ]   ┌──────────┐   ← 20px invisible hit-area
   │ /build   │───────●───────────▶│architect │     around the visible line
   └──────────┘     edge hit-path   └──────────┘     (ported as-is)

   Click ×:
   ┌──────────┐   Delete? [✓][✗]   ┌──────────┐
   │ /build   │──────────●────────▶│architect │
   └──────────┘                    └──────────┘
```

### 3.4 Connect-drag in progress (simultaneous with a pinned edge toolbar + missing-agent hover)

```
┌ Graph ──────────────────────────────────────────────────────────────────┐
│   ┌──────────┐●╲                  ┌──────────┐                         │
│   │ /analyze │  ╲╌╌╌ ghost edge   │    ba    │  ← full opacity          │
│   └──────────┘   ╲   (dashed,     └──────────┘     (candidate target)  │
│                    ╲   follows                                         │
│                     ╲  cursor)                                         │
│                      ●  ← live cursor position                         │
│                                                                          │
│   ┌──────────┐   Delete? [✓][✗]   ┌──────────┐  ← stays PINNED,        │
│   │ /build   │──────────●────────▶│architect │     independent of      │
│   └──────────┘   (selectedEdgeId)  └──────────┘     the drag above     │
│                                                                          │
│   ┌──────────┐                    ┌───────────────────────┐            │
│   │ /review  │╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌▶│⚠ security             │            │
│   └──────────┘                    │  ＋ Create this agent │ ← hovered  │
│                                    └───────────────────────┘            │
└──────────────────────────────────────────────────────────────────────────┘
  Three independent disclosure states open at once, none suppressing the
  others. Whether graph-wide hover-dim stays active DURING an in-progress
  drag is Open Design Question 2 below — confirm, do not assume.
```

### 3.5 Pane right-click context menu

```
┌ Graph ──────────────────────────────────────────────────────────────────┐
│   ┌──────────┐        ┌──────────────────────┐                        │
│   │ /analyze │        │ ● Add workflow        │                        │
│   └──────────┘  ┌──────┤ ● Add agent           │                        │
│              click x,y ├──────────────────────┤                        │
│                  └──────┤ ⤢ Fit to view         │                        │
│                          └──────────────────────┘                        │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.6 Mission-mode (dense — authoring hard-hidden)

```
┌ Graph ────────────────────────────────────────────────┬───────────────────┐
│ ◉ RUNNING  /build — "add auth to login"   ⏱ 02:14 [Cancel] │ Timeline    │
├──────────────────────────────────────────────────────┤ (RunLogTail,      │
│ ● Claude · clean      ● Codex · clean                 │  raw-tail, P1)    │
│ ┌ ＋ Add ▾(disabled) ⤢ Fit to view  ? ┐               │ 12:04 tool_use    │
│                                                         │  Read file.ts    │
│   ┌──────────┐                    ┌──────────┐        │ 12:05 tool_use    │
│   │ /analyze │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄▶│    ba    │        │  Edit file.ts    │
│   └──────────┘  (35% dim, no ⋯)  └──────────┘  35%    │                   │
│                                                         │                   │
│   ╔══════════╗   runFlow:flowing ╔══════════╗         │                   │
│   ║ /build   ║   (cyan glow ring) ║architect ║         │                   │
│   ╚══════════╝    full opacity   ╚══════════╝ full    │                   │
│                                                         │                   │
│   ┌──────────┐                    ┌───────────────┐    │                   │
│   │ /review  │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄▶│⚠ security     │    │                   │
│   └──────────┘  (35% dim)         │ (35%, no create)│    │                   │
│                                    └───────────────┘    │                   │
└──────────────────────────────────────────────────────┴───────────────────┘
  No handles, no ⋯ menus, no edge toolbars, no context menu, no hover-dim —
  ALL authoring affordances hard-hidden while missionActive=true.
```

### 3.7 Empty graph

```
┌ Graph ──────────────────────────────────────────────────────────────────┐
│ ┌ ＋ Add ▾  ⤢ Fit to view*  ? ┐   * disabled — fitDisabled at 0 nodes   │
│                                                                          │
│              (empty canvas — dot-grid background only, no               │
│               nodes/edges to derive — unchanged from today)             │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.8 Daemon disconnected

```
┌ Graph ──────────────────────────────────────────────────────────────────┐
│ ⦿ Daemon disconnected — the graph is read-only.            [ Retry ]   │
├──────────────────────────────────────────────────────────────────────────┤
│   ┌──────────┐                    ┌──────────┐                         │
│   │ /analyze  ○  (hollow handle,  │    ba    │                         │
│   └──────────┘   not connectable) └──────────┘                         │
│  hover-dim still works (read-only affordance); drag-connect, ⋯ menu    │
│  destructive actions, context-menu Add all disabled — same gating      │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Component Breakdown

**Guiding rule**: reuse every leaf component verbatim — they already only read a plain `data`
bag, not xyflow APIs. Only the xyflow-specific shell (canvas root, node positioning wrapper,
connect handles, edge geometry/portal) needs replacing.

### 4.1 What gets replaced

| Today (xyflow) | Self-coded replacement | Notes |
|---|---|---|
| `<ReactFlow>` + `<ReactFlowProvider>` + `<Background variant={Dots}>` | **`GraphCanvas`** (new) | Owns pan/zoom transform state (pending Open Question 1), a dotted-background layer, an absolute-positioned node layer + an `<svg>` edge layer, hit-testing dispatch, and an imperative `fitView()`. |
| `Handle` | **`NodeHandle`** (new, tiny) | Absolute-positioned dot; `onMouseDown` starts a drag (source); a plain bounding-rect check on mouseup identifies drop targets (target). Same `!bg-command`/hollow-when-disabled classes ported verbatim. |
| `useReactFlow().fitView` | **`GraphCanvas`'s imperative `fitView(padding?)`** | Computes a bounding box over all node positions/dimensions (already known from `computeLayout`), animates pan/zoom to fit — same `duration: 250` easing as today. |
| `Node`/`Edge` (xyflow types) | **`GraphNode`/`GraphEdge`** (plain interfaces) | Structurally near-identical minus xyflow-specific fields (`sourcePosition`/`targetPosition` become computed from node rects at render time). |
| `Connection`/`onConnect`/`isValidConnection` | **`useConnectDrag`** (new hook) | State machine: `idle → dragging(sourceId, cursorPos) → commit-or-cancel`. Exposes `pendingConnection` in the same shape as today's already-component-local, E10-safe state. |
| `<BaseEdge>` + `getBezierPath()` + `<EdgeLabelRenderer>` | **`GraphEdgePath`** (renamed from `AnimatedEdge`) + a pure `bezierPath()` helper | `bezierPath()` mirrors xyflow's default curvature formula so edges look unchanged. The badge/toolbar becomes a plain absolutely-positioned `<div>` at the path midpoint — no portal needed, since there's no xyflow root to portal out of. All of `AnimatedEdge.tsx`'s existing JSX (badge, toolbar, delete-confirm, stagger-draw, the 20px hit-area trick) carries over near-verbatim; only the top-of-function prop destructuring changes. |
| `onNodeMouseEnter`/`onNodeMouseLeave` | Plain `onMouseEnter`/`onMouseLeave` passed into `GraphNode` | `hoveredId` stays lifted state in `DependencyGraph`, unchanged ownership. |
| `onPaneClick`/`onPaneContextMenu` | `GraphCanvas`'s own root-div `onClick`/`onContextMenu`, target-checked against node/edge hit-areas (`stopPropagation()` on node/edge handlers) | xyflow does pane-vs-node/edge distinction internally; must be explicitly replicated. |
| `nodesDraggable={false}` | N/A — nodes are simply never given a drag handler | Simpler than today: no prop to accidentally flip. |
| `<Background variant={Dots}>` | **`DotGridBackground`** (new, ~10 lines) | Purely decorative CSS/SVG pattern tile. |

**Net new components**: `GraphCanvas`, `GraphNode` (thin positioning wrapper), `GraphEdgePath`,
`NodeHandle`, `DotGridBackground`, plus `useConnectDrag` and a pure `bezierPath()` helper (and,
if Open Question 1 keeps pan/zoom, a `useGraphPanZoom` hook). **Unchanged, zero rewrite**:
`CommandNode`, `AgentNode`, `MissingAgentNode` (data contract unchanged, only their xyflow type
imports swap), `GraphToolbar`, `GraphCanvasMenu`, `GraphLegend`, `EdgeRelationModal`,
`NodeDeleteConfirm`, `NodeMenu`, `GraphHintBar`, `GraphStatusChips`, `DaemonRibbon`,
`MissionStatusStrip`, `RunLogTail`, `RunDialog`, `computeLayout.ts` (dagre, already
React/xyflow-agnostic).

### 4.2 Interface contracts (shape only, no implementation)

```
GraphCanvas props:
  nodes: Array<{ id, type, position: {x,y}, width, height, data }>
  edges: Array<{ id, source, target, data }>
  onConnectAttempt(sourceId, targetId): void
  isValidConnection(sourceId, targetId): boolean
  onNodeHover(id | null): void
  onEdgeClick(id): void
  onPaneClick(): void
  onPaneContextMenu(x, y): void
  disabled: boolean   // authoringSuspended passthrough
GraphCanvas internal state (ephemeral only, E10-safe — never derived data):
  dragConnect: { sourceId, cursor: {x,y} } | null
  viewportTransform: { x, y, scale } | null   // only if Open Question 1 keeps pan/zoom

GraphNode props:
  id, position: {x,y}, width, height
  onMouseEnter / onMouseLeave: () => void
  children: ReactNode   // CommandNode / AgentNode / MissingAgentNode, unchanged

GraphEdgePath props:
  id, sourcePoint: {x,y}, targetPoint: {x,y}
  data: AnimatedEdgeData   // UNCHANGED shape (drawIndex, missing, highlighted, dimmed,
                           // count, goal, interactive, selected, pending, runFlow,
                           // onOpenModal, onDelete)

NodeHandle props:
  role: "source" | "target", connectable: boolean, onDragStart?: () => void
```

---

## 5. Interaction Notes

**Loading / empty / error states**: no changes from today. `DependencyGraph` already renders
synchronously from `artifacts` (no async fetch inside this component) — the empty-graph state
(§3.7) IS the "nothing loaded" state. Daemon-disconnected gates connect/interact affordances via
the existing `daemonConnected` flag, unchanged. Save failures surface via the existing toast
system; no new error UI.

**What has to be hand-rolled that xyflow gave "for free" (the crux of this migration)**:
1. **Pan/zoom** — the single largest net-new mechanic (own transform state, wheel-to-zoom,
   drag-to-pan, `fitView` bounding-box math + eased transition). Pending Open Question 1 on
   whether it's even needed at Symbion's ~10-30 node scale.
2. **Hit-testing / pointer-events layering** — the edge hit-area trick (20px invisible stroke)
   was *already* hand-rolled today (not an xyflow feature) and carries over unchanged. What IS
   new: `GraphCanvas` must explicitly manage `pointer-events: none` on the SVG root and
   `pointer-events: auto` only on individual edge paths, or edges will silently block node
   clicks underneath them — xyflow handled this internally.
3. **Connect-drag gesture + live ghost edge** (`useConnectDrag`) — mousedown on a source handle
   → rAF-throttled `mousemove` updates the ghost endpoint → mouseup checks the cursor against a
   maintained registry of node bounding rects → commit or cancel.
4. **Accessibility / keyboard** — xyflow ships baseline ARIA roles and tab-focus for free (even
   if barely exercised today, since `nodesDraggable=false` already turns off most of it). No
   target keyboard model is specified — Open Question 4.

**Micro-interactions to preserve exactly (regression checklist for the builder)**:
- Edge stagger draw-in: `40ms` per edge index, capped at 15 (`STAGGER_CAP`/`STAGGER_MS` in
  today's `AnimatedEdge.tsx`) — do not change under cover of "porting."
- "Just added" ring: `1.6s` auto-fade, takes precedence over hover-highlight, never co-occurs
  with mission-mode glow.
- Handle hover "pulse": a one-shot `.9s` replay on each new hover — today achieved by re-keying
  the `<Handle>` element to force remount; the self-coded `NodeHandle` needs an equivalent
  remount-to-replay trick, since CSS animations don't replay on a prop change alone.
- Edge opacity/stroke transition easing (`0.2s cubic-bezier(.2,.8,.2,1)` / `0.12s ease`) — carry
  over the exact curve, not a re-tuned one.
- `prefers-reduced-motion`: today's Tailwind `animate-*` keyframes (`glowPulse`, `pulse`,
  `popIn`) already collapse under a global reduced-motion block in `globals.css`. Any new
  hand-rolled CSS/SVG animation this migration introduces must register in that same collapse
  block — hand-rolled animations do not automatically inherit it the way `animate-*` utility
  classes did.

**Mutual-exclusion state machine (must not regress)**: hover-dim, in-progress connect-drag, and
mission-mode are three distinct "graph-wide emphasis" modes. Today, mission-mode suppresses
hover-dim entirely (`authoringSuspended`). Whether hover-dim should also suppress *during* an
in-progress drag (as opposed to the already-resolved `pendingConnection` ghost state) was not
confirmed against the current shipped behavior — flagged as Open Question 2, not assumed.

---

## 6. Open Design Questions

These are taste calls that must be answered before `/plan` sizes the implementation — not
guessed here, per the STATE file's explicit framing that this is a rendering-primitive swap.

1. **Is pan/zoom needed at all, given Symbion's ~10-30 node graphs?** Minimalist recommendation:
   no free panning/zooming — a plain scrollable container, with "Fit to view" reduced to
   "scroll to origin/center content." Dramatically cheaper than reimplementing a viewport
   transform + inverse-matrix hit-testing. If real projects sometimes produce wide/tall graphs
   where scroll-only feels cramped, a minimal zoom-to-fit-on-mount (single scale factor computed
   once, no interactive zoom) is a middle ground. **Highest-leverage open question — resolve
   first, since it determines whether this is a small migration or one that also builds a full
   viewport transform system.**
2. **Hover-dim during an in-progress connect-drag** — should the rest of the graph dim (to
   emphasize the pending link) or stay fully lit (so all candidate targets are visible)? Not
   confirmed against today's actual behavior; needs an explicit decision, not a carry-over guess.
3. **Live "valid drop target" ring during connect-drag, before mouseup** — does today's React
   Flow implementation show any highlight on candidate targets mid-drag, or is validity feedback
   drop-only (toast error after an invalid attempt)? If the latter, adding a live ring is a
   **new affordance** requiring an explicit user decision (better UX, added build cost) — not
   something to silently add or silently omit.
4. **Accessibility/keyboard model** — STATE §6.2/§7 explicitly accepts rebuilding "built-in
   accessibility/hit-testing" as a cost, but no target keyboard pattern is specified (tab-order?
   arrow-key pan? Enter-to-open-node-menu?). Needs either an explicit target model or an
   accepted "keyboard support out of scope for v1" call.
5. **Edge bezier curve shape** — the self-coded `bezierPath()` helper needs to visually match
   xyflow's default curvature closely enough that edges look unchanged. A math/tuning detail
   for the architect/dev, noted here only so it isn't silently "improved" into a different curve
   style during build.
6. **Dash-flow animation on participant edges during mission mode** — today's codebase's own
   comment marks this as deferred/P2 under the sibling `graph-execution-realtime` feature. This
   migration ships the `runFlow: "flowing"` *data* field (already exists) but must **not**
   pull forward the actual dash-animation implementation as a side effect of "we now own the raw
   SVG path" — that would be scope creep across two different STATE files. Confirm this is
   understood before `/plan`.
7. **Trackpad/pinch gestures** — moot if Question 1 resolves to "no pan/zoom." If some zoom is
   kept, trackpad gesture support is a separate, non-trivial cost to explicitly scope in/out.

---

## 7. Future Ideas (explicitly out of scope for this migration — not folded into baseline)

Every item below came from the rich/immersive design pass and is a genuine visual or behavioral
departure from today's shipped output. None are authorized by the locked scope (which requires
bit-for-bit preservation, FR-3) without an explicit, separate taste call. Recording them here so
they aren't lost, not silently shipping any of them:

- **Richer connect-drag feedback**: ghost line as an animated dashed bezier that curves toward
  the nearest valid target within a snap radius, plus a green "snap" flash on valid drop and an
  ease-out shrink on invalid/empty drop. Departs from a straight 1:1 cursor-tracking line.
- **"Ink flowing along the path" edge draw-in** (stroke-dashoffset reveal) instead of the
  current opacity fade — now cheap to build since the raw `<path>` is owned directly, but a
  visible departure from today's shipped stagger-fade.
- **Rich edge-toolbar hover-preview**: hovering "+" shows an inline goal/count preview before
  the modal opens, plus a springy scale-in-from-midpoint pop for the toolbar itself. Adds a
  third floating layer (badge/toolbar/preview) needing careful z-index/dismiss sequencing.
- **Layered/breathing glow-pulse** (2-3 phase-offset box-shadow rings) for mission-mode's active
  node, instead of today's single-ring `glowPulse` keyframe — directly tests whether "preserve
  the mission-mode overlay contract bit-for-bit" (FR-3) means pixel-identical output or only an
  identical *behavioral* contract with cosmetic embellishment allowed. Not resolved; flagged,
  not assumed either way.
- **Obstacle-avoiding edge routing**: nudging bezier control points to route around a node that
  would otherwise sit directly on the straight line between source and target — a genuine new
  capability xyflow's default `getBezierPath` never had. Only relevant in rare occlusion cases
  given dagre already minimizes crossings.
- **Visible pan/zoom controls** (`GraphViewportControls`) — today's canvas has zero visible zoom
  affordance (scroll/gesture-only); a self-coded version could add one. Moot if Open Question 1
  drops pan/zoom entirely.
- A dedicated, simplified "mission control" secondary view, distinct from the general N-node
  authoring canvas (first raised in the analyze phase, STATE §3 idea 3) — a different product
  question, not part of this rendering-engine swap.
- Minimap/overview thumbnail — not requested anywhere in the locked scope; do not add.
- Structured Feed/Raw/Summary timeline tabs, per-agent filter chips, token-delta rows — already
  the separately-scoped P2 `RunTimelinePanel` (sibling feature); `RunLogTail` stays untouched by
  this migration.

---

## 8. Design System — initial proposal

No `DESIGN.md` exists at the repo root. This migration's own success criterion is pixel-parity,
so it introduces **no new visual tokens** by default — the values below are a transcription of
what's already hardcoded in `CommandNode.tsx`/`AgentNode.tsx`/`MissingAgentNode.tsx`/
`AnimatedEdge.tsx` today, proposed here only so they're captured as durable tokens if/when a
`DESIGN.md` is formally seeded, not invented for this feature.

```yaml
---
version: "0.1.0"
name: "symbion-design-system"
description: "Design tokens for Symbion's desktop UI — seeded from the dependency graph's existing implementation"
colors:
  command: "#818cf8"        # command node fill (indigo)
  agent: "#a78bfa"          # agent node fill (violet)
  danger: "#f87171"         # missing-agent / error state
  runActive: "#22d3ee"      # mission-mode active glow ring (cyan) — reserved exclusively for run-engine state
  runDone: "#4ade80"        # mission-mode success ring (green)
  edgeDefault: "#565c68"    # default edge stroke (gray)
  edgeHighlight: "#c7d2fe"  # hovered/connected edge + node highlight ring
typography:
  nodeLabel: "12.5px, 500 (font-medium)"
rounded:
  navItem: 9      # node corner radius
  panel: 12       # menus/toolbars
  pill: 20        # badges
spacing:
  nodePaddingX: 12
  nodePaddingY: 8
components:
  GraphNode:
    radius: "rounded.navItem"
    color: "colors.command | colors.agent"
  GraphEdgePath:
    strokeDefault: 1.5
    strokeHighlighted: 2.5
    hitAreaWidth: 20
    staggerMs: 40
    staggerCap: 15
---
```

**Do's and Don'ts** (graph-specific, carried into any future `DESIGN.md`):
- **Do** keep node fill colors flat and keyed strictly by artifact kind — never gradient, never
  per-instance custom color (would break the legend contract).
- **Do** reserve glow rings (colored `box-shadow`) exclusively for transient/stateful signals
  (just-added, mission-mode run status, hover-highlight) — never a static resting decoration.
- **Do** register every new hand-rolled animation in the existing `prefers-reduced-motion`
  collapse block in `globals.css`.
- **Don't** introduce a second "dimmed" opacity value other than `0.35` — used identically for
  hover-dim and mission-mode non-participant dim today; a second value fragments the visual
  language for no reason.
- **Don't** let `runActive` (cyan) leak into non-run-state UI.
- **Don't** let the edge hit-area (20px invisible stroke) block node click targets — tune
  `pointer-events`/z-order so nodes always win when overlapping an edge's hit corridor.

---

## Summary for the architect

- 5 new components (`GraphCanvas`, `GraphNode`, `GraphEdgePath`, `NodeHandle`,
  `DotGridBackground`) + 2 new hooks (`useConnectDrag`, and `useGraphPanZoom` if Question 1
  keeps pan/zoom) + 1 pure helper (`bezierPath()`).
- Every existing leaf component (`CommandNode`, `AgentNode`, `MissingAgentNode`,
  `GraphToolbar`, `GraphCanvasMenu`, `GraphLegend`, `EdgeRelationModal`, `NodeDeleteConfirm`,
  `NodeMenu`, `GraphHintBar`, `GraphStatusChips`, `DaemonRibbon`, mission-mode run components)
  is preserved as-is or with only a signature-level touch-up. `computeLayout.ts` (dagre) is
  untouched.
- E10 (derive-don't-mirror) is preserved by construction — `GraphCanvas` receives `nodes`/
  `edges` as props from `DependencyGraph`'s existing `useMemo` chain; it holds only ephemeral
  local UI state (drag cursor, hover id, viewport transform), never a second copy of node/edge
  data.
- **Open Question 1 (pan/zoom vs. scroll-only) is the single highest-leverage decision** — it
  determines whether this is a contained migration or one that also builds a full viewport
  transform + inverse-matrix hit-testing system. Resolve before `/plan` sizes the work.
- Questions 2, 3, and 6 all gate exactly how literally "preserve bit-for-bit" (FR-3) is
  interpreted — resolve before implementation starts, not during code review.

**Next step**: run `/plan` — but only once `graph-execution-realtime` P2 and P3 have shipped and
stabilized (STATE §8's hard precondition). Check `docs/loops/graph-execution-realtime-STATE.md`'s
status before treating this design as buildable.
