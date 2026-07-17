# self-coded-graph-migration — TEST PLAN

> Companion to `self-coded-graph-migration-STATE.md` §9 (PLAN). Runner: **Vitest** for unit tests
> (`packages/core` has no involvement — this migration is 100% `apps/web`, so all unit tests live
> under `apps/web`) + manual **chrome-devtools** journey for e2e (no Playwright in this repo per
> CLAUDE.md, despite `@playwright/test` being present in `package.json` — confirmed unused; the
> actual e2e mechanism for web journeys in this codebase is manual chrome-devtools walkthroughs,
> per `graph-execution-realtime-testplan.md`'s own header).
>
> **Mandatory precondition on this test plan, per the task brief's residual-risk flag (STATE §8):**
> P2/P3's own live browser QA never ran. This migration is porting a UI contract (mission-mode,
> timeline, history overlay) that has ONLY been verified by code review + automated tests, never by
> live behavior. Therefore **§0 (baseline capture) is not optional and not skippable** — it is the
> only source of "ground truth" this migration can diff against, since the written spec (design
> doc + STATE) describes intent, not confirmed-correct pixels/behavior.

---

## 0. Pixel-parity / behavior baseline (capture BEFORE any migration code changes)

This is the single most important gate this test plan adds beyond a normal migration: since the
CURRENT (P1+P2+P3) UI was never itself live-QA'd, this migration has no independently-verified
"correct" reference to diff against unless one is captured now, from the shipped xyflow
implementation, before it's touched.

### 0.1 Screenshot baseline (chrome-devtools, capture and save alongside this file or in the
scratchpad, referenced by filename in §0.3's checklist)

Capture against a real project with ≥8 artifacts (mix of command/agent/at least one dangling
`@mention` to exercise the missing-agent node) so all three node types + both edge states
(present/missing) are visible in one screenshot set:

| # | State | How to reach it | Capture |
|---|---|---|---|
| B1 | Idle canvas, at-rest | Open Graph tab, no interaction | full-panel screenshot |
| B2 | Node-hover reveal | Hover a command node with ≥1 edge | screenshot showing dim + handle + `⋯` |
| B3 | Node `⋯` menu open | Click `⋯` on a hovered command node | screenshot showing `NodeMenu` contents/position |
| B4 | Edge hover toolbar | Hover an interactive (non-missing) edge | screenshot showing `+`/`×` toolbar position |
| B5 | Edge pinned (clicked) | Click an edge, then move mouse away | screenshot confirming toolbar STAYS (pinned) |
| B6 | Edge delete-confirm | Click `×` on a toolbar | screenshot of inline "Delete? ✓ ✗" |
| B7 | Connect-drag in progress | Mousedown on a command's handle, drag partway, DO NOT drop | screenshot of ghost edge + cursor line |
| B8 | Connect-drag invalid drop | Drag onto empty canvas, release | screenshot/note: snaps back, no write, no toast-error persisted incorrectly |
| B9 | Pane right-click menu | Right-click empty canvas | screenshot of `GraphCanvasMenu` at click point |
| B10 | Missing-agent hover | Hover a `⚠ ... (does not exist)` node | screenshot of "＋ Create this agent" affordance |
| B11 | Just-added ring | Add a new agent/command via the toolbar | screenshot within 1.6s showing the accent ring |
| B12 | Mission-mode overlay, active | Execute a command, capture while RUNNING | screenshot: glow ring, 35% dim on non-participants, hard-hidden authoring affordances (no `⋯`, no handles, no toolbar even on hover-attempt) |
| B13 | Mission-mode, node token badge hover | Hover a participant node mid-run | screenshot of `NodeTokenBadge` hover card (`TokenBreakdownCard`) |
| B14 | Mission terminal → Summary auto-morph | Let a run finish | screenshot of the panel auto-switching to Summary tab |
| B15 | History popover + past-run overlay | Click 🕘, select a past run | screenshot of `PastRunBanner` + frozen ring states (no pulse) |
| B16 | Daemon disconnected | Stop/disconnect daemon | screenshot of `DaemonRibbon` + hollow handles |
| B17 | Empty graph | New project, 0 artifacts | screenshot of dot-grid-only canvas |
| B18 | Fit-to-view animation | Click "⤢ Fit to view" on an off-center graph | before/after screenshot pair, note the ~250ms easing felt right |

### 0.2 Behavior notes to record (not screenshottable, but must be written down before migrating)

- Exact dot-grid spacing/dot color/dot size (inspect computed style, since `DotGridBackground` must
  visually match it, not xyflow's own `<Background variant={Dots}>` internals).
- Exact bezier curve shape at 2-3 different node-distance/angle pairs (for `bezierPath()` tuning,
  PLAN §9.3 Q5) — screenshot with a ruler overlay or note approximate control-point offsets.
- Whether hover-dim currently dims DURING an in-progress connect-drag or not (PLAN §9.3 Q2 assumed
  "dims" — **this is exactly the kind of fact the baseline should settle** if reachable; if the
  live behavior turns out to be "stays fully lit," update PLAN §9.3 Q2's resolution before `/build`
  proceeds, don't silently keep the wrong assumption).
- Exact `fitView` easing feel (250ms duration is documented in code; confirm it doesn't feel like a
  hard cut or an over-long animation in practice — sets the bar for the scroll-based replacement).

### 0.3 Baseline capture is DONE when

All 18 states in §0.1 have a saved screenshot, §0.2's notes are written down, and both are
committed/attached to this feature's PR description or linked from STATE before `/build` starts
modifying `DependencyGraph.tsx`/`graph/*.tsx`. **`/qa` for this feature must re-run the SAME 18
states against the self-coded output and do a side-by-side diff against these baseline images** —
this is the acceptance mechanism for FR-3's "bit-for-bit" mandate, not a vague "looks about right."

---

## 1. Unit tests (Vitest, `apps/web/src/components/graph/*.test.ts(x)` and `test/graph/`)

### 1.1 `bezierPath.test.ts` (pure function, no DOM)

| # | Case | Expected |
|---|---|---|
| 1 | horizontal pair, source right of target by 200px, same y | control points produce a path string; `labelX`/`labelY` equal the midpoint of source/target x/y (±1px) |
| 2 | source above target (positive dy) | curve bows in the direction matching xyflow's default (down-then-right visually, i.e. control point offset scales with `abs(dx)`) |
| 3 | source and target very close (< 40px apart) | path does not degenerate/self-intersect; still produces a valid SVG path `d` string parseable by a basic path-command regex |
| 4 | zero-distance (same point, defensive) | does not throw, returns a degenerate but valid path |
| 5 | snapshot against 3 (dx,dy) pairs recorded from the §0.2 baseline notes | path control-point offsets within an agreed tolerance (document the tolerance chosen, e.g. ±5px) of the recorded xyflow reference values |

### 1.2 `graphGeometry.test.ts`

| # | Case | Expected |
|---|---|---|
| 1 | source-anchor point for a `command` node at `{x:0,y:0}` w/ `NODE_WIDTH=160,NODE_HEIGHT=40` | returns right-mid `{x:160, y:20}` (matching `Position.Right`) |
| 2 | target-anchor point for an `agent` node | returns left-mid `{x, y+20}` (matching `Position.Left`) |
| 3 | fitView bounding box over 3 nodes at varying positions/widths | returns the correct min/max x/y envelope |
| 4 | fitView bounding box over 0 nodes (empty graph) | returns a sane default (no NaN/Infinity), matches today's `fitDisabled` gating at 0 artifacts |
| 5 | missing-agent node uses `MISSING_AGENT_NODE_WIDTH` not `NODE_WIDTH` for its anchor calc | anchor x offset reflects the wider estimate |

### 1.3 `useConnectDrag.test.ts` (React Testing Library, `renderHook`)

| # | Case | Expected |
|---|---|---|
| 1 | mousedown on a source handle → state transitions to `dragging` | `dragConnect` state populated with `{sourceId, cursor}` |
| 2 | mousemove while dragging | cursor updates; throttled (assert it doesn't fire a state update on every single raw event if a fake-timer/rAF mock is used — or at minimum assert final cursor position is correct after a burst) |
| 3 | mouseup over a valid target rect (per the node-rect registry) | `onConnectAttempt(sourceId, targetId)` called exactly once; state resets to `idle` |
| 4 | mouseup over an invalid target (kind mismatch, checked via `isValidConnection`) | `onConnectAttempt` NOT called; state resets to `idle` (ghost "snaps back") |
| 5 | mouseup over empty canvas (no matching rect) | same as #4 — no call, clean reset |
| 6 | Escape key pressed mid-drag | drag cancels, no `onConnectAttempt` call (design §2 state 4's "Esc... cancels") |
| 7 | `disabled=true` (authoringSuspended) passed in | mousedown on a handle does NOT start a drag at all |
| 8 | daemon disconnects (prop flips) mid-drag | drag cancels on the next mouseup/mousemove tick rather than firing `onConnectAttempt` (PLAN §9.3's daemon-disconnect-mid-drag edge case) |

### 1.4 `NodeHandle.test.tsx`

| # | Case | Expected |
|---|---|---|
| 1 | `connectable=true` | renders with `!bg-command`/`!bg-agent` class (source/target variant), `onMouseDown` wired |
| 2 | `connectable=false` | renders hollow (`!bg-transparent !border !border-white/40`), no drag-start on mousedown |
| 3 | hover triggers the one-shot pulse remount | a re-key (changed `key` prop or forced remount) occurs on each new hover, matching today's `pulseKey` mechanism ported from `CommandNode.tsx` |

### 1.5 `GraphCanvas.test.tsx` (integration-ish, RTL, jsdom)

| # | Case | Expected |
|---|---|---|
| 1 | renders N nodes at their given positions | each node's wrapper div has the correct `style.left`/`style.top` matching the input `position` |
| 2 | renders edges as `<path>` elements | one path per edge (plus each interactive edge's 20px hit-area path) |
| 3 | clicking empty canvas area fires `onPaneClick` | called once, not fired when clicking on a node (event doesn't bubble past `stopPropagation`) |
| 4 | right-clicking empty canvas fires `onPaneContextMenu(x,y)` with coordinates relative to the canvas root | matches today's `getBoundingClientRect()`-relative math in `DependencyGraph.tsx` |
| 5 | right-clicking a node does NOT fire `onPaneContextMenu` | node's own handlers take precedence (stopPropagation) |
| 6 | `disabled=true` | no hover/connect/context-menu handlers fire (authoringSuspended hard-hide, design §1C step 2) |
| 7 | edge `pointer-events` layering | an edge's 20px hit-area does not intercept clicks on a node visually overlapping its path (regression test for PLAN §9's "pointer-events: none on svg root, auto on individual paths" requirement) |
| 8 | `fitView()` imperative call (via ref) | triggers the expected scroll/centering behavior (or, if pan/zoom is confirmed dropped per PLAN §9.3 Q1, asserts a `scrollTo`/`scrollIntoView` call with the correct target, not a matrix-transform state change) |

### 1.6 Regression tests for ported leaf components (`CommandNode`/`AgentNode`/`MissingAgentNode`)

Existing behavior (menu open/close, pulse-on-run-transition, badge rendering, unlinked chip,
justAdded ring, hollow-vs-connectable handle) should already have coverage from when these
shipped — **re-run existing test suites unchanged** after the `Handle`/`NodeProps` import swap and
confirm zero new failures. If no test files currently exist for these three components, that's a
pre-existing gap this migration should NOT be required to backfill (out of scope), but flag it to
`code-reviewer` as a residual risk given these files ARE being touched (even if minimally).

```bash
find apps/web/src/components/graph -name "*.test.tsx"
```
(Run this before `/build` to confirm which of `CommandNode`/`AgentNode`/`MissingAgentNode` already
have unit coverage — establishes the actual regression-test floor for this migration.)

### 1.7 E10 invariant test (critical — the one architectural rule this migration must not break)

| # | Case | Expected |
|---|---|---|
| 1 | Render `DependencyGraph` with a fixed `artifacts` array, call `saveArtifact` externally to mutate the underlying store, re-render | node positions/data are ENTIRELY re-derived from the new `artifacts` prop — no stale local node/edge state survives from before the mutation (assert by checking a node whose `data.label` changed reflects the NEW label immediately, not the old one cached in some local `useState`) |
| 2 | Grep-based static check (can be a simple Vitest test that reads the built file text, or a `code-reviewer` manual check) | `GraphCanvas`/`GraphNode`/`GraphEdgePath` contain NO `useState`/`useReducer` holding a copy of `nodes`/`edges` shaped data — only ephemeral UI state (`hoveredId` lifted, `dragConnect`, menu-open booleans) |

---

## 2. Manual chrome-devtools journeys (e2e — mirrors `graph-execution-realtime-testplan.md`'s
convention of numbered J-cases)

> Precondition: §0's baseline screenshots/notes must already be captured from the PRE-migration
> build. Every J-case below is re-run against the POST-migration build and diffed against the
> corresponding B-number baseline.

| # | Journey | Steps | Expected (diff against baseline) |
|---|---|---|---|
| J1 | Idle canvas parity | Open Graph tab on the same fixture project used for B1 | Visually matches B1: same node positions (dagre determinism), same colors, same dot-grid |
| J2 | Node hover parity | Hover the same node as B2 | Same dim ratio (35%), same handle/⋯ fade-in, no flicker |
| J3 | Node menu parity | Open `⋯` menu | Same items, same position (top-right of node), Execute/Edit/Copy run command/Delete all present and functional |
| J4 | Edge hover + pinned toolbar parity | Repeat B4/B5 | Toolbar appears at the same midpoint, pin-via-click behavior identical |
| J5 | Edge delete-confirm + actual unlink | Click `×`, confirm | Edge disappears, `saveArtifact` RPC actually fires (check Network/daemon log), re-derivation removes the edge from the canvas |
| J6 | Connect-drag success | Drag from a command handle onto a VALID agent target, drop | Ghost line follows cursor in real time (no visible lag/jank), edge is created on drop, `saveArtifact` fires, non-optimistic ghost never gets mirrored into permanent state before the RPC resolves |
| J7 | Connect-drag invalid | Drag onto an invalid target (e.g. another command) | Toast error fires, no write, ghost snaps back cleanly |
| J8 | Connect-drag empty-canvas cancel | Drag, release over empty canvas | Same as J7, ghost clears with no error toast (this is the "drop on empty pane" case, distinct from "drop on invalid node") |
| J9 | Connect-drag + Esc | Start a drag, press Esc | Drag cancels immediately |
| J10 | Pane context menu parity | Right-click empty canvas | `GraphCanvasMenu` appears at cursor, Add workflow / Add agent / Fit to view all work |
| J11 | Missing-agent create parity | Hover a missing-agent node, click "＋ Create this agent" | Drawer opens pre-named with the mention |
| J12 | Just-added ring parity | Add a new node via toolbar | Ring appears immediately, fades at ~1.6s (time it) |
| J13 | Simultaneous disclosure states (design §1B step 5 / §3.4) | While dragging from node A, click-pin an edge toolbar on a DIFFERENT edge, and hover a missing-agent node — all at once | All three states render independently, none suppresses another (this is the design doc's own hardest interaction case — must be exercised explicitly, not assumed to "just work" because unit tests pass) |
| J14 | Execute → mission-mode overlay | Click Execute on a command, confirm preflight, start | `MissionStatusStrip` appears, glow ring on the executing node, 35% dim on non-participants, ALL authoring affordances hard-hidden (attempt to hover a node during the run — confirm ⋯/handle do NOT appear) |
| J15 | Mission-mode token badge | While running, hover a participant node with token data | `NodeTokenBadge` hover card appears with correct fresh/cost/breakdown |
| J16 | Mission terminal → auto Summary | Let the run finish | Panel auto-switches to Summary tab, ring settles to done/error color, authoring resumes automatically (hover a node post-run — ⋯/handle reappear) |
| J17 | Cancel mid-run | Start a run, click Cancel | Run transitions to cancelled, node ring shows cancelled state, authoring resumes |
| J18 | History popover + past-run overlay | Click 🕘, select a past run | `PastRunBanner` shows, nodes show frozen ring states (no pulse/flow animation — confirm NO glow-pulse CSS class active on any node while browsing history), Timeline panel shows historical rows |
| J19 | History exit | Click the banner's exit/close | Returns to live authoring canvas, all affordances re-enabled |
| J20 | Live-run-wins-over-history (EDGE-2/A21) | While browsing history, trigger a run from ANOTHER tab/window on the same project | Toast fires ("A new run started — exited run history"), overlay switches to the live mission automatically |
| J21 | Daemon disconnect mid-authoring | Stop the daemon while the Graph tab is open and idle | `DaemonRibbon` appears, handles go hollow, Add/Fit/context-menu-Add disable; hover-dim STILL works (per design §3.8's explicit note it's a read-only-but-live affordance) |
| J22 | Daemon disconnect mid-drag | Start a connect-drag, then kill the daemon before mouseup | Drag cancels cleanly on release, no crash, no orphaned ghost edge, no uncaught RPC error surfaced ungracefully |
| J23 | Empty graph | New project, 0 artifacts | Dot-grid only, "Fit to view" disabled, no console errors |
| J24 | Fit-to-view | Click "⤢ Fit to view" on a wide/off-center graph | Content becomes visible/centered; note whether the scroll-based replacement (if pan/zoom dropped per PLAN §9.3 Q1) feels acceptably smooth vs. the baseline's transform-animation — this is the ONE journey where a UX judgment call is expected and should be explicitly signed off, not just diffed pixel-for-pixel |
| J25 | Perf spot-check (NFR-3) | With a run active and streaming events (10-30 node graph), observe time from an SSE event arriving to the corresponding node's badge/glow updating | Subjectively ≤500ms, no visible jank/frame drops during rapid updates — note if a proper performance-trace measurement is warranted before sign-off (NFR-2/NFR-3 explicitly call out "no perf claim without a real benchmark") |
| J26 | `prefers-reduced-motion` | Enable OS/browser reduced-motion, repeat J12 (just-added ring) and J14 (mission glow) | Animations collapse to a static/instant state, matching today's behavior — confirms any NEW hand-rolled animation this migration adds was correctly registered in the `globals.css` collapse block (PLAN §9.1's `globals.css` row) |

---

## 3. Sign-off checklist (maps to STATE §6.5's provisional acceptance criteria)

- [ ] §0 baseline (18 screenshots + behavior notes) captured and committed BEFORE `/build` started
      modifying `DependencyGraph.tsx`/`graph/*.tsx`.
- [ ] Every AC-1..AC-9 (STATE §6.2 table) has an equivalent self-coded implementation, verified
      against the SAME concrete behavior it replaces — no AC silently dropped.
- [ ] AC-10 (derive-don't-mirror / E10) verified by §1.7's explicit test, not assumed from code
      review alone.
- [ ] Mission-mode overlay contract (FR-3) verified bit-for-bit via J14-J20 against B12-B15 —
      this is the ONE contract this test plan treats as higher-risk than normal, per the residual
      risk flagged in STATE §8 (P2/P3's own UI was never live-QA'd before this migration ports it).
- [ ] Auto-layout stays dagre-computed (FR-4/NFR-1) — confirmed by inspection that `computeLayout.ts`
      is untouched and still the sole position source.
- [ ] `@xyflow/react` fully removed from `apps/web/package.json` in the same PR as the cutover
      (big-bang, STATE §7 Q6) — `grep -r "@xyflow" apps/web/src` returns zero results post-merge.
- [ ] Open Design Questions 1-7 (design doc §6) each have a recorded resolution (PLAN §9.3) —
      confirm Q1 (pan/zoom) and Q2 (hover-dim during drag) specifically got an explicit go/no-go
      from whoever owns the taste call, not just the architect's recommendation, before `/ship`.
- [ ] No `packages/core` or `apps/daemon` changes in the diff (this migration's own architectural
      boundary per PLAN §9.4) — if the diff touches either, that's architectural drift to flag at
      `/review`.

---

## 4. Addendum — connect-drag SVG clipping fix (STATE §19, 2026-07-17)

Scoped regression-test addition for the bug fixed in STATE §19 (root cause: STATE §18). These tests
would have caught the original bug (SVG `width`/`height` never grew to include a live drag cursor
outside the node bounding box).

### Unit (Vitest)

**`apps/web/src/components/graph/graphGeometry.test.ts`** — new cases for `boundingBox`'s extra-points
parameter:

| ID | Case | Assertion |
|----|------|-----------|
| T-2.6 | `boundingBox(nodes, [{x: 900, y: 500}])` where all nodes are within `x:0-460, y:0-140` | `maxX === 900`, `maxY === 500` — box expands to include the extra point past the node bounds |
| T-2.7 | `boundingBox(nodes, [{x: -200, y: -100}])` — extra point in the negative direction relative to node bounds (`minX`/`minY` currently 0) | `minX === -200`, `minY === -100` — box expands in the negative direction too, not just positive |
| T-2.8 | `boundingBox(nodes, [])` (default/omitted second arg) | identical output to the pre-fix `boundingBox(nodes)` single-arg call, for the same `nodes` input — confirms zero behavior change on the default path (backward compatibility) |
| T-2.9 | `boundingBox([], [{x: 50, y: 50}])` — zero nodes, one extra point (defensive/edge case) | returns a box containing that point, not the hardcoded zero-default (`minX/maxX === 50`, not `0`) |

### Component (Vitest + Testing Library, `GraphCanvas.test.tsx`)

| ID | Case | Assertion |
|----|------|-----------|
| T-5.9 | **Regression test for the exact bug**: render `GraphCanvas` with 2 nodes whose bounding box is small (e.g. `x:0-160, y:0-40`), start a connect-drag from node `cmd-1`'s source handle (`fireEvent.mouseDown` on `[data-handle-role="source"]` inside `NodeConnectBoundary`), then simulate `mousemove` to a `clientX`/`clientY` FAR outside that bounding box (e.g. equivalent local point `{x: 900, y: 700}`, mocking `containerRef`'s `getBoundingClientRect` as needed to control the local-coordinate translation) | after the rAF-throttled update flushes, query the rendered `<svg>` element and assert its `style.width`/`style.height` (or computed `width`/`height` attrs) are `>= 900`/`>= 700` respectively — i.e., large enough to contain the drag cursor, not clipped to the pre-drag node bounding box (`160+40=200` / `40+40=80`) |
| T-5.10 | Same setup as T-5.9, then fire `mouseup` (or `Escape`) to end the drag | SVG `width`/`height` shrink back down to the plain node-bounding-box values (no permanent bloat) — assert against the same values `GraphCanvas` would render with `dragConnect` never having been set |
| T-5.11 | Drag toward negative-x/negative-y local coordinates (cursor moves left/above the existing node bounding box, not just right/below) | ghost `<path>` element's `d` attribute is present and its endpoint matches the negative cursor coordinates (smoke-level: confirms the code path doesn't throw/silently clamp negative extra-points to 0 in `boundingBox`) — full clipping-visual confirmation is a live-browser QA concern (J27 below), since jsdom does not enforce real SVG clip-to-viewport rendering the way a browser does |

### E2E / live-browser QA journey (chrome-devtools, added to §2's journey table)

| ID | Journey | Confirm |
|----|---------|---------|
| J27 | Connect-drag ghost line stays visible during a long drag, in all 4 directions | Start a connect-drag from a node near the edge of the canvas, drag the cursor far right, far left, far down, and far up (past the current node bounding box in each direction) — the dashed ghost line must remain fully visible (not clipped/truncated) throughout each drag, and the container must not show an unexpected permanent scrollbar/size increase after the drag ends (mouseup) and a fresh interaction begins. This journey is the live-browser confirmation for the negative-direction SVG-origin caveat noted in STATE §19 edge case #2, which cannot be fully verified by jsdom-based unit tests alone (this is the SAME category of defect — SVG/DOM-content-model-specific, invisible to jsdom — that caused this bug and the round-1 namespace bug to both escape unit/typecheck coverage per STATE §18). |
