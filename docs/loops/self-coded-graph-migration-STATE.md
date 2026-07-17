# self-coded-graph-migration — STATE

> Feature: request to **replace @xyflow/react (React Flow) entirely** with a self-coded graph renderer, modeled after a prototype ("Graph Execution Mission Control").
> Pipeline stage: **THINK — pre-scope analysis** (this doc). Not yet an office-hours-locked scope; several open questions below need the user's answer before `/office-hours` or `/plan` can proceed.
> Created 2026-07-15 by `ba`. §6 (Requirements) added same day, second BA pass — includes a factual correction to §2 (see §6.0).
> Type: **request re-litigating a two-days-closed decision.** Read this doc's §1 before treating "replace React Flow" as the accepted premise.

## 1. Ground truth already established (do not silently re-derive)

Two prior, fully-executed pieces of work already answer most of the literal request:

- `docs/loops/graph-execution-realtime-STATE.md` (2026-07-13, "keep React Flow," license/cost framing) — **shipped** P1 2026-07-15 (`f65b34b`), reviewed by 3 independent checkers, QA'd live.
- `docs/loops/graph-rendering-library-evaluation-STATE.md` (2026-07-15, same day) — a **second, deeper spike** on a DX/flexibility framing, explicitly commissioned to check whether the first verdict should change now that mission-mode exists. Its own §11.2 read the actual `f65b34b` diff line-by-line and found: **zero new React Flow API surface was touched** to build the glow/dim/token-ticker overlay — it was built entirely inside the pre-existing `data`-bag/`useMemo` pattern. Its §11.4 Step 5 conclusion is explicit: **"REINFORCE. The prior spike's 'keep React Flow' verdict holds under the new DX/flexibility/perf axes."** This was itself independently reviewed (§12) and QA'd (§13) 2026-07-15.

**This is the third time in three days the same question would be asked**, and the second time it would be asked *after* a dedicated spike whose entire job was to check exactly this. Taking the current request ("replace React Flow with a self-coded renderer") at face value would mean overturning a locked, twice-reviewed research verdict without any new evidence — the request itself cites no new fact, only a prototype. That prototype needs to be evaluated on its own terms (§2 below), separately from re-opening the library question a third time.

## 2. What the prototype actually is — and isn't

> **Correction (§6.0, second BA pass, same day): this section's central claim is retracted.** It asserts the prototype is "not a mockup of the dependency graph" and instead a mockup of the P2 timeline panel + a reskin of P1 run components. That claim does not hold up against the prototype's actual node labels — `/analyze`, `ba`, `architect`, `/build [draft]`, `/review` — which are literally Symbion's own command/agent/draft-status vocabulary (`CanonicalArtifact.kind === "command" | "agent"`, draft state). This is a small instance of the **authoring graph itself**, shown with a mission-mode overlay, not a structurally different or unrelated view. See §6.2 for the corrected reading. The capability-mapping table below is still useful evidence (every capability shown IS already shipped or scoped) and is not retracted — only the "wrong surface" conclusion drawn from it is.

The prototype ("Graph Execution Mission Control") is a **fixed-5-node, read-only run-monitoring dashboard**: glow-on-execute nodes, a timeline panel (Feed/Raw/Summary tabs, per-step token deltas, per-agent filter chips), a run status strip (RUNNING/elapsed/cancel), and an execute dialog with preflight checks + permission-mode acknowledgment.

Every one of those capabilities maps to a component **that already exists and is already scoped**, not to the dependency-graph's authoring surface:

| Prototype feature | Existing Symbion counterpart | Status |
|---|---|---|
| Node glow-on-execute | `DependencyGraph.tsx` mission-mode overlay (`runStatus`-keyed glow ring, `CommandNode.tsx`) | **Shipped P1**, `f65b34b` |
| Run status strip (RUNNING/elapsed/cancel) | `apps/web/src/components/run/MissionStatusStrip.tsx` | **Shipped P1** — same fields (status glyph, elapsed timer, cancel control) |
| Execute dialog + preflight checks | `apps/web/src/components/run/RunDialog.tsx` + `PreflightStrip.tsx` | **Shipped P1** — preflight rows with ✓/⚠/✗ severity + action buttons already exist |
| Permission-mode acknowledgment | `graph-execution-realtime-STATE.md` §6.4 (first-run ack, consent nonce, `bypassPermissions` extra-confirm) | **Shipped P1** |
| Timeline panel: Feed/Raw/Summary tabs, token deltas, per-agent filter chips | `apps/web/src/components/run/RunLogTail.tsx` | **Explicitly P1 stub, P2 scoped** — the component's own doc comment: *"the P1 timeline panel: a raw log-tail (last 200 lines). The structured timeline is P2."* `graph-execution-realtime-STATE.md`'s Option 1 table names `RunTimelinePanel` (virtualized, per-agent) as a P2 deliverable. |

~~In other words: **the prototype is not a mockup of the dependency graph**... Its fixed-5-node layout, absence of drag-connect, absence of node editing, and absence of a pane context menu are not omissions from a rushed demo — they are **correct for a run-monitoring view**...~~ **(Retracted — see the correction note above and §6.2: the prototype's 5 nodes use the dependency graph's own naming vocabulary, so this is most plausibly the same authoring graph, in mission mode, at demo scale, not a structurally different view.)**

## 3. Ideas and Open Questions

### Ideas beyond the literal ask

1. **The real want is very likely "make mission-mode / P2 look like this prototype," not "delete React Flow."** Recommend treating this request as a **design reference for `graph-execution-realtime` P2** (timeline panel richness: Feed/Raw/Summary tabs, per-step token deltas, per-agent filter chips) plus a **visual reskin pass** on the already-shipped P1 components (`MissionStatusStrip`, `RunDialog`/`PreflightStrip`, the glow/dim palette) — not a rendering-library migration. This is materially cheaper, ships sooner, and doesn't reopen a closed architecture decision.

2. **Decompose "10x better" into the three separable moves the spike itself already named** (graph-rendering-library-evaluation-STATE.md §8, carried into its final recommendation):
   - **(a) Reskin, cheap.** Restyle existing xyflow-based `CommandNode`/`AgentNode`/`AnimatedEdge` + the P1 run components to match the prototype's color/glow/typography language. Zero library risk — this is CSS/Tailwind + `data`-bag styling, the same mechanism mission-mode P1 already used successfully (per the spike's own falsification finding: mission-mode touched zero new React Flow API surface).
   - **(b) Build the richer timeline/summary panel, medium effort, orthogonal to any library choice.** `RunTimelinePanel` (P2, already named in the locked design) with Feed/Raw/Summary tabs, token-delta rows, per-agent filter chips — this is new React state/UI layered on data the run engine already emits (`PersistedRunEvent`, `RunState.actors`), nothing to do with how the *graph* is rendered.
   - **(c) Truly abandon xyflow.** Per the spike: 1-3 sprint bracketed estimate, rebuilds pan/zoom/hit-testing/connect-drag/accessibility from zero, explicitly rejected twice now (2026-07-13 cost/license framing, 2026-07-15 DX/flexibility framing, both independently reviewed). Nothing in this new request supplies evidence that would change that calculus.

   (a) and (b) alone plausibly deliver ~90% of what the prototype visually promises, at a fraction of the cost/risk of (c). *(Note per §6.0's correction: (c)'s framing as targeting "a different, simpler read-only use case" than the authoring graph should be read with §6.2's corrected understanding that the prototype IS the authoring graph's own vocabulary — this affects how confidently (c) can be dismissed as off-target, though not the underlying cost math, which came from the sibling spike's own analysis of the authoring graph directly.)*

3. **The prototype's fixed-5-node layout is itself a hint worth taking seriously as a product idea**, independent of rendering tech: today's mission-mode overlay lives *inside* the general authoring graph. The prototype instead shows a **dedicated, simplified run view**. Worth surfacing as its own product question: is there value in a *secondary*, simplified "mission control" presentation for an active run — distinct from the general N-node authoring canvas — built cheaply as a stripped-down layout mode of the *same* underlying React Flow instance, rather than a wholly separate renderer?

### Product risk notes

- **Re-litigation fatigue / decision credibility risk.** If this request proceeds to a third full "should we replace React Flow" evaluation without new technical evidence, it sets a precedent that locked, independently-reviewed research verdicts can be reopened by aesthetic reference material alone.
- **Sunk-cost / moving-target risk carried forward from the spike.** P2 (telemetry roll-up, timeline) and P3 (history/reattach) are explicitly sequenced to land on the current node/edge data shape before any migration is even eligible (`graph-rendering-library-evaluation-STATE.md` §6.1). A "replace it now, modeled on this prototype" build would violate that explicit, user-locked precondition.
- **Scope-fidelity risk if this ships as literally requested.** A ground-up self-coded renderer sized to a 5-fixed-node demo does not obviously generalize to Symbion's actual authoring graph without re-solving hit-testing/pan-zoom/accessibility from scratch.

### Open questions for the user (needed before `/office-hours` or `/plan`)

1. **What specifically about the current graph is unsatisfying that this prototype solves?** Visual polish — or a structural capability React Flow genuinely cannot provide?
2. **Is "replace React Flow" actually still the ask, given the two prior spikes' reinforced "keep" verdict** — or would the user accept "build the P2 timeline panel + reskin P1 to match this prototype's look"?
3. **If a self-coded renderer is still wanted regardless**, is it scoped to (a) a NEW, separate, simplified run-monitoring view coexisting with the authoring graph, or (b) a literal full replacement of the authoring graph as well?
4. **Does the user consider the two prior spikes' verdicts invalid, superseded, or simply not yet seen?**

## 4. Recommended next step (superseded — see §6.7/§6.8)

Do **not** proceed straight to `/plan` on "replace React Flow." Route this request through `/office-hours` to resolve open questions #1-#4 above; fold into `graph-execution-realtime` P2 if the answer is visual-polish; otherwise treat as a full new migration feature carrying the burden of proof against §1's precedent.

## 5. Solution Options (architecture/solution-perspective pass, 2026-07-15)

> Options A/B/C, ranking, and risk notes — see full content above this line in the file as written by the prior pass. Not duplicated here; §6 below (Requirements) is scoped to specs/acceptance-criteria/open-questions per the BA mandate and does not re-derive or restate the solution-option analysis, only cross-references it where relevant.

## 6. Requirements (BA pass — corrected reading + structured breakdown)

### 6.0 Why this section exists, and what it corrects

This section is a fresh, structured requirements pass, required to ground its reading of the prototype in the actual prototype code and actual current code, not speculation. Doing that reading surfaces a factual problem with §2's central claim: it asserts the prototype is "not a mockup of the dependency graph" and is instead a mockup of the P2 timeline panel. The prototype's 5 nodes are literally labeled `/analyze`, `ba`, `architect`, `/build [draft]`, `/review` — a slash-command (`/analyze`, `/build`), two agent names (`ba`, `architect`), and a draft-status marker (`[draft]`), all vocabulary lifted directly from Symbion's own dependency-graph domain model. This is not a generic run-monitoring dashboard shape; it is **a small instance of the exact authoring graph**, rendered with mission-mode-style glow, at a scale (5 nodes) too small to need auto-layout. §2's "not the dependency graph" framing is retracted above; §6.2 supersedes it as the operative read. §3/§5's decomposition ideas and risk notes mostly still apply and are not discarded — only the "wrong surface" claim is corrected.

### 6.1 Core user need / motivation — the "why," re-examined against the corrected reading

Given the prototype IS the dependency graph (command/agent nodes) with a mission-mode run overlay and a timeline side panel, the achievable-only-via-self-coded question becomes narrower and testable. Checking every concrete visual/interaction element the prototype shows against the actual shipped code:

- **Glow-pulse animation on active nodes** — already shipped, `CommandNode.tsx:63-88` (`animate-glowPulse` class, `boxShadow` keyed to `runStatus`). Not a reason to leave React Flow.
- **Hand-drawn SVG `<path>` edges with dasharray/marker-end arrows** — already how edges are built today, `AnimatedEdge.tsx:91-103` (`<BaseEdge>` wraps a literal SVG `<path>`, `getBezierPath`, `strokeDasharray`). React Flow's custom-edge API IS "write your own SVG path" — it does not impose a different rendering primitive than the prototype uses.
- **Timeline panel (Feed/Raw/Summary tabs, token deltas)** — partially shipped (`RunLogTail`, raw-only), richer version already scoped as run-engine P2 (`RunTimelinePanel`). Independent of graph rendering library entirely — a sibling panel component, not part of `DependencyGraph.tsx`'s node/edge rendering.
- **Run status strip, execute dialog with preflight** — already shipped verbatim in P1 (`MissionStatusStrip`, `RunDialog`, preflight checks).
- **Fixed pixel-position layout** (`nodePositions = {analyze:{left:20,top:190}, ...}`) — the ONE element with no equivalent today, precisely because the current implementation solves a harder, more general problem (auto-layout for arbitrary N via dagre, `computeLayout`) that a 5-node fixed demo never had to solve. Evidence the demo took a shortcut, not evidence self-coding is necessary.

**The honest, evidence-grounded "why" that must still be surfaced to the user, not assumed**: nothing in the prototype demonstrates a capability gap in the current React Flow implementation. Every visual/interactive element checked is either already shipped, already scoped as non-graph-library work (P2 timeline), or a simplification (hardcoded positions) that doesn't survive Symbion's real ~10-30 node range. Most plausible real motivations, descending likelihood: (a) wants the existing graph + mission-mode **restyled** to match this exact visual language — a re-skin, not a re-architecture; (b) tried customizing the current components, found the DOM/CSS composition awkward (portal-based `EdgeLabelRenderer`, `Handle` markup), and concluded — incorrectly — a different rendering primitive is required, when the look is already achieved; (c) a specific technical dissatisfaction not visible from the prototype alone (e.g., informally-reported perf lag, already surfaced in `graph-rendering-library-evaluation-STATE.md` §6.4) that happens to coincide with this prototype but isn't evidenced by it. §7 Q1 exists to disambiguate these before design/build starts.

### 6.2 Functional requirements — feature-parity checklist (prototype vs. current implementation)

Cross-referencing the prototype's actual features against the AC-1..AC-10 checklist already established with file:line ground truth in `graph-rendering-library-evaluation-STATE.md` §5/§11.1:

| Capability | Prototype has it? | Current implementation has it? |
|---|---|---|
| Distinct node visual types (command/agent/missing-agent) | Partial — labels distinguish `/analyze` from `ba`/`architect` and `[draft]` status, but only one visual treatment overall (glow varies by run status, not by node kind); no "missing agent" state shown | Yes (AC-1) — `CommandNode.tsx`, `AgentNode.tsx`, `MissingAgentNode.tsx`, 3 distinct components |
| Custom SVG bezier/path edges with decoration | Yes, arrows + dasharray, but static/no live badge (no ×N count, no goal-dot) | Yes (AC-2) — `AnimatedEdge.tsx:53-60`, staggered draw-in + ×N/goal badge |
| Edge hover/click interactivity (+/× toolbar, edit-relationship modal) | **No** — decorative-only edges, no click/hover handlers evident | Yes (AC-3) — `AnimatedEdge.tsx:105-213` |
| Connect-by-drag with live validation | **No** — scripted demo, fixed nodes/edges, no drag gesture | Yes (AC-4) — `DependencyGraph.tsx:196-239` |
| Hover-driven highlight/dim across the whole graph | **No** (mission-mode's participant-dim is the only dimming shown, and that IS already shipped) | Yes (AC-5), suspended during mission mode exactly as implied — `DependencyGraph.tsx:480-496` |
| Pane right-click context menu (add node, fit view) | **No** | Yes (AC-6) — `DependencyGraph.tsx:595-600`, `GraphCanvasMenu.tsx` |
| "Just added" transient ring | **No** (not applicable to a run-only demo) | Yes (AC-7) — `DependencyGraph.tsx:165-190` |
| Mission-mode run overlay (glow/dim keyed to run status, execute dialog, preflight, run strip) | **Yes — the prototype's entire centerpiece** | Yes, shipped 2026-07-15, `f65b34b` (AC-8) — reviewed + QA'd |
| Auto-layout (computed positions), fitView | **No — hardcoded pixel positions**, literal constants for exactly 5 nodes | Yes (AC-9) — dagre-based `computeLayout`, `DependencyGraph.tsx:437-448`, generalizes to any N |
| Derive-don't-mirror architecture (E10) | N/A — a static demo has no real state model to evaluate this against | Yes (AC-10) — required, locked invariant, independently verified in the prior spike |
| Timeline panel (Feed/Raw/Summary tabs, tool-call events, token deltas, per-agent filter chips) | Yes, scripted/fake data | Partial — `RunLogTail` (raw-only) shipped P1; structured Feed/Summary/filter-chips is already-scoped P2, independent of graph-rendering-library choice |
| Run status strip, execute dialog with preflight, bottom run-bar | Yes, scripted | Yes, real — `MissionStatusStrip`, `RunDialog`, preflight checks, all shipped P1 |

**Conclusion**: the prototype demonstrates **zero capabilities the current implementation lacks**. It is a strict subset (missing AC-3, AC-4, AC-5, AC-6, AC-7, and using a non-scaling layout shortcut in place of AC-9) dressed in a visual style the current components already implement the mechanics for (SVG paths, glow, `data`-bag-driven state). A full self-coded rewrite would have to **rebuild** AC-3/AC-4/AC-5/AC-6/AC-7 from zero, since the prototype provides no reference implementation for any of them.

**If this migration proceeds regardless (assuming the user, after §7, still wants a full rewrite): MUST requirements**:
- **FR-1**: Preserve AC-1 through AC-9 exactly as currently specified — self-coded rendering must not silently drop drag-connect, hover-dim, context menu, edge toolbar, or the just-added ring unless the user explicitly, individually accepts each removal (see §7 Q3).
- **FR-2**: Preserve AC-10 (derive-don't-mirror) — nodes/edges stay a pure function of `artifacts` via `useMemo`, never mirrored into a separate mutable store, regardless of rendering primitive.
- **FR-3**: Preserve the mission-mode overlay contract bit-for-bit as shipped in `f65b34b` (glow ring keyed to `runStatus`, dim non-participants to 35%, `runFlow` edge state, `authoringSuspended` gating).
- **FR-4**: Auto-layout must remain a computed algorithm (dagre/`computeLayout` or equivalent), not the prototype's literal hardcoded position object — see §6.3 NFR-1.

### 6.3 Non-functional requirements — what the prototype does and does NOT demonstrate about scale

The prototype has exactly 5 nodes at hardcoded pixel coordinates — a real, citable limitation: the mockup's positions object is a literal enumeration, one entry per node, with no generalization mechanism (no layout algorithm runs at all).

- Symbion's real dependency graphs run **~10-30 nodes** — independently cited across both prior spikes.
- **NFR-1**: any self-coded (or partially-reskinned) approach MUST keep computed auto-layout, never adopt the prototype's literal per-node hardcoded-position pattern.
- **NFR-2**: no performance claim can be derived from the prototype either way — it is a scripted, fixed-data demo with no live re-render/data-binding cost model, so it supplies zero new perf evidence beyond what the prior spike already flagged as "unverifiable without a real benchmark" for every candidate.
- **NFR-3**: whatever ships must not regress the mission-mode re-render latency budget already shipped and reviewed (event → UI ≤500ms, `graph-execution-realtime-STATE.md` §3.4) — the prototype's static/scripted nature cannot speak to this either way.

### 6.4 Explicit constraints and implicit assumptions to surface, not guess

- **"Self-coded" is ambiguous on layout mechanics.** Does it mean (a) replace only the rendering primitives while KEEPING the dagre-based `computeLayout` algorithm, or (b) also hand-author/hardcode positions the way the prototype literally does? Per §6.2 FR-4/§6.3 NFR-1, (b) is a functional regression almost certainly not actually wanted — but the request explicitly cites the prototype's hardcoded-position code as the model, which is a legitimate reason to worry this is exactly what's being asked for. Must be confirmed (§7 Q4), not assumed.
- **E10 (derive-don't-mirror) is a locked architectural invariant** independent of rendering approach — constrains HOW any self-coded renderer must be wired; not a decision this BA pass can trade away.
- **Filesystem safety is not implicated.** The graph remains presentation-only regardless of rendering library; a rendering-primitive swap introduces no new destructive-write risk.
- **The sequencing precondition in `graph-rendering-library-evaluation-STATE.md` §6.1 applies with equal or greater force here.** P2/P3 have not shipped. A full self-coded rewrite is the single most expensive way to violate that lock, since every future P2/P3 data-bag field would need re-plumbing through hand-rolled rendering code that doesn't yet exist.
- **Risk: prototype-fidelity creep.** "Modeled after a prototype" can silently expand from "match this visual style" (cheap, mechanics already match per §6.1/§6.2) to "reproduce this exact static demo's DOM/positioning structure" (expensive, never designed for live state/N-node layout/hit-testing/accessibility).

### 6.5 Acceptance criteria — how to know this is "done," distinct from "looks like the prototype"

Not finalizable until §7 is answered. Provisionally:

- **If re-skin (visual style only, React Flow retained)**: done = `CommandNode.tsx`/`AgentNode.tsx`/`MissingAgentNode.tsx`/`AnimatedEdge.tsx` + the P1 run components visually match the agreed subset of the prototype's style, with **zero regression** to AC-1..AC-10 and **zero rendering-library dependency change**.
- **If full replacement (React Flow dropped)**: done = every one of AC-1..AC-10 is either (a) preserved with an equivalent self-coded implementation, verified against the same concrete behaviors, or (b) explicitly, individually signed off by the user as an acceptable drop. Additionally: auto-layout stays computed, the mission-mode overlay contract is preserved bit-for-bit, and the build does not start until run-engine P2/P3 ship unless the user explicitly overrides that lock in writing.

### 6.6 Additional product risk notes for architect/dev

- **Precedent-consistency, restated with sharper teeth given the corrected reading**: because the prototype IS the dependency graph (not an unrelated view), the temptation to treat this as "just build the P2 timeline panel, unrelated to the library decision" is weaker than §2 originally suggested. Whoever runs `/design`/`/plan` next must engage §1's precedent directly (reinforce or explicitly rebut with new evidence).
- **Sequencing-lock risk (restated)**: building before P2/P3 ship recreates exactly the double-work risk the lock exists to prevent, now with slightly higher stakes given the corrected reading confirms this touches the actual authoring graph.
- **Silent scope/feature-loss risk**: a rewrite shipping without explicit, itemized sign-off on which of AC-3/AC-4/AC-5/AC-6/AC-7 are dropped vs. rebuilt risks silently regressing real, shipped, reviewed authoring features.

## 7. Open questions — RESOLVED (user decision, 2026-07-15)

1. **What specifically about the prototype is not achievable today?** — User confirmed (via direct question) they want the full replacement regardless; not gated on a specific unmet capability.
2. **Is "replace React Flow entirely" actually the goal?** — **Yes, confirmed explicitly.** Not a re-skin request. The user was shown the finding that every visual element in the prototype is already achievable in React Flow, and still chose full replacement.
3. **Is losing pan/zoom, connect-drag-to-link, and built-in accessibility/hit-testing an acceptable trade?** — **Yes, explicitly accepted.** All 4 authoring features currently missing from React Flow's "for free" list that a self-coded renderer would need to rebuild from scratch (connect-by-drag to link command→agent, graph-wide hover-dim, edge +/× toolbar, pane right-click context menu) must be **fully rebuilt, not dropped**. No feature is being cut to reduce cost.
4. **Does "self-coded" mean layout is also hand-authored/hardcoded, or does auto-layout stay?** — **Auto-layout (dagre-based `computeLayout`) stays.** Only the rendering primitives (nodes as divs, edges as hand-drawn SVG paths) change — NOT the position-computation algorithm. The prototype's literal hardcoded-position approach is explicitly rejected as non-scaling (confirmed, matches §6.3 NFR-1's recommendation).
5. **Sequencing — wait for P2/P3, or override the lock?** — **Wait.** The `graph-rendering-library-evaluation-STATE.md` §6.1 precondition stands: this migration does not start until run-engine P2 (token roll-up UI) and P3 (history/reattach) ship and stabilize. This is a **hard blocking precondition** on this feature, not a preference.
6. **Incremental vs. full rewrite?** — **Big-bang.** Replace `DependencyGraph.tsx` + `apps/web/src/components/graph/*.tsx`'s rendering entirely in one pass, not a phased/parallel migration. (Note for architect/dev: "big-bang" governs the cutover strategy, not necessarily a single commit — the plan may still sequence internal work in stages, but there is no extended period running two renderers side-by-side in production.)
7. **Does the user consider the two prior spikes' verdicts superseded?** — Implicitly yes, for this specific feature — this decision overrides the "keep React Flow" verdict, but only once its own precondition (#5, P2/P3 shipped) is met. The prior spikes' reasoning remains valid documentation of the trade-offs being knowingly accepted, not retracted.

## 8. Recommended next step

**Scope is locked.** This is a real, accepted, big-bang, full-replacement migration — knowingly overriding two prior "keep React Flow" verdicts, gated on a hard precondition (run-engine P2/P3 must ship and stabilize first).

**BLOCKED until precondition is met**: do not run `/plan` or `/build` for the actual migration until `graph-execution-realtime` P2 (token roll-up UI) and P3 (history/reattach/settings) have shipped, per §7 Q5 / `graph-rendering-library-evaluation-STATE.md` §6.1. Check `docs/loops/graph-execution-realtime-STATE.md` for P2/P3 status before proceeding.

**UNBLOCKED as of 2026-07-16**: `graph-execution-realtime` P2 shipped 2026-07-15, P3 shipped 2026-07-16 (see that STATE file's §25 "Done — full feature"). Both phases are complete — the data-bag/contract shape this migration would have had to port is now stable. Note the residual risk carried forward from that feature: P2/P3's own live browser QA (testplan J12–J43) never ran (no reachable Chrome in that session) — the mission-mode/timeline/history UI contract this migration must preserve bit-for-bit (FR-3) is verified by code review + automated tests, not by live behavior. `/plan` for this migration should treat that as a known gap, not assume the contract it's porting has been visually confirmed correct.

**Once unblocked**: run `/design` (UI/interaction reference: the prototype's visual language, scoped to preserve all of AC-1..AC-9 per §6.2's FR-1..FR-4 — no feature silently dropped, all 4 currently-prototype-missing authoring features must be rebuilt), then `/plan` (architect sizes the actual self-coded rendering approach — hand-drawn SVG edges + absolute-positioned div nodes, dagre-computed positions retained, E10 architecture invariant preserved, big-bang cutover of `DependencyGraph.tsx` + `graph/*.tsx` — against the ~3-5 sprint bracket from `graph-rendering-library-evaluation-STATE.md` §11.3 Candidate C).

## 9. PLAN — Architecture (architect pass, 2026-07-17)

> Precondition confirmed cleared (§8): `graph-execution-realtime` P2+P3 shipped. Design doc
> (`self-coded-graph-migration-design.md`) read in full and validated against the ACTUAL current
> code (`DependencyGraph.tsx` + `graph/*.tsx` + `useRunStore.ts` + `run/*.tsx` as of this commit,
> post-P3). This section is the buildable spec `code-reviewer`/`architect` will hold `/build`
> against. It resolves as many of the design doc's §6 open questions as can be resolved with
> architectural reasoning, and flags the ones that remain genuine taste calls.

### 9.0 Verdict on the design doc, given what's shipped since it was written

The design doc's component breakdown (§4) is **still substantially correct** — its "reuse every
leaf component verbatim" premise holds even after P3. But three things changed on the ground that
the doc could not have anticticipated, and the plan below corrects for them:

1. **`NodeMenu` is a real, wired, shipped component** (`graph/NodeMenu.tsx`, used by both
   `CommandNode`/`AgentNode` today) — the design doc's screen inventory (§2, state 8 "Node `⋯`
   menu") and component table call it "unchanged," which is correct, but the doc's prose
   undersells how much of AC-3-analog interactivity already lives inside `CommandNode`/`AgentNode`
   as internal `useState` (menu open, hovered, one-shot pulse key), not inside `DependencyGraph` or
   the xyflow shell. This is good news for the migration (less to port) but means "GraphNode is a
   thin positioning wrapper" (design §4.2) must be read literally: `CommandNode`/`AgentNode`
   already own their own hover/menu state and only need `onMouseEnter`/`onMouseLeave` /position
   from the new shell — confirmed compatible, no redesign needed.
2. **P3 added run-mode surface the design doc's mission-mode section (§1C, §3.6) only partially
   covers**: `RunHistoryPopover` (🕘 button + popover, absolute-positioned top-left, its own
   outside-click/Esc handling — same pattern as `GraphCanvasMenu`), `PastRunBanner` (a full-width
   banner ABOVE the canvas, not inside it), and the reconciled-notice toast-row (also above the
   canvas). **None of these render inside the xyflow `<ReactFlow>` tree** — they're siblings in
   `DependencyGraph`'s outer `<div>`, positioned by ordinary flow layout or `absolute` positioned
   relative to the `<div className="relative flex-1">` wrapper that also hosts `GraphToolbar`/
   `GraphCanvasMenu`/`NodeDeleteConfirm`. **This means P3's additions require ZERO new components
   beyond what the design doc already anticipated** — they attach to the same wrapper `GraphCanvas`
   will own, exactly like `GraphToolbar` does today. Flagging this explicitly because the task
   prompt asked whether P3 requires new/different components: **it does not** — it requires the
   new `GraphCanvas` root to preserve the exact same "wrapper div with toolbar/menu/banner
   siblings absolutely positioned over the canvas" structure, which is a constraint, not new work.
3. **`onNodeClick` (P2/P3's panel-filter-by-actor click) is a NEW xyflow prop usage** the design
   doc's §4.1 table never lists (it only covers `onNodeMouseEnter`/`onNodeMouseLeave`/
   `onPaneClick`/`onPaneContextMenu`/`onConnect`/`isValidConnection`). This is a real gap in the
   design doc surfaced by P2/P3 shipping after it was written — added to the interface contract
   below (§9.2) as `onNodeClick(id)`, gated identically to today's `missionLike` conditional.

No other drift found. The design doc's Future Ideas (§7), Open Questions (§6), and interaction
notes (§5) all remain accurate against current code — cross-checked runFlow states, badge shapes,
pulse mechanics, stagger constants line-by-line against `AnimatedEdge.tsx`/`CommandNode.tsx`/
`AgentNode.tsx` as currently shipped; all match what the design doc describes.

### 9.1 Architecture — files to create / modify

**New files** (`apps/web/src/components/graph/`):

| File | Purpose |
|---|---|
| `GraphCanvas.tsx` | Root shell. Owns the outer `<div>` (replaces `<ReactFlow>`), the absolute node layer, the `<svg>` edge layer, `DotGridBackground`, pane-level `onClick`/`onContextMenu` dispatch, imperative `fitView()` (via `forwardRef`+`useImperativeHandle`, mirroring today's `useReactFlow().fitView` call sites), and hosts `useConnectDrag`. Per §9.3 Q1 resolution: **no pan/zoom transform state** — see below. |
| `GraphNode.tsx` | Thin absolute-positioned wrapper: `<div style={{position:"absolute", left, top, width, height}}>{children}</div>` plus `onMouseEnter`/`onMouseLeave` passthrough. Renders `CommandNode`/`AgentNode`/`MissingAgentNode` as `children` — those three components' internals (menu, hover, pulse) are **unchanged**, only their xyflow `Handle`/`NodeProps` imports are swapped (see below). |
| `GraphEdgePath.tsx` | Renamed/ported `AnimatedEdge.tsx`. Same JSX body (badge, toolbar, delete-confirm, stagger draw-in, 20px hit-area path) verbatim; only the top destructure changes from xyflow's `EdgeProps` to plain `{ id, sourcePoint, targetPoint, data }`, and `EdgeLabelRenderer`'s portal is replaced by a plain absolutely-positioned `<div>` (no portal target needed — see §9.1.1). |
| `NodeHandle.tsx` | Small absolute-positioned dot; `onMouseDown` (source) starts `useConnectDrag`; exposes a DOM rect for the drag hook's target hit-testing via a registry (see §9.1.2). Ported class names (`!bg-command`/`!bg-agent`/hollow-disabled) verbatim from today's `Handle` usage in `CommandNode`/`AgentNode`/`MissingAgentNode`. |
| `DotGridBackground.tsx` | ~10-line SVG `<pattern>` tile, absolute-positioned behind the node/edge layers, mirroring xyflow's `<Background variant={Dots}>` visual (dot spacing/color sampled from current rendered output — capture in the pixel-parity baseline, §10.1). |
| `useConnectDrag.ts` | Hook: `idle → dragging({sourceId, cursor}) → commit | cancel`. `mousemove` handler is `requestAnimationFrame`-throttled (design §5 note 3). `mouseup` checks cursor against the node-rect registry (§9.1.2) via `isValidConnection` (passed in), then fires `onConnectAttempt(sourceId, targetId)` — same call shape as today's `onConnect(Connection)`, adapted. |
| `bezierPath.ts` | Pure function `bezierPath(sourcePoint, targetPoint, {sourceSide, targetSide}) → {path: string, labelX: number, labelY: number}`. Must replicate xyflow's default `getBezierPath` curvature (control-point offset formula) closely enough for pixel parity — see §10.1's baseline requirement. Unit-tested directly (no DOM). |
| `graphGeometry.ts` | Small pure helpers: given `GraphNode[]` + fixed `NODE_WIDTH`/`NODE_HEIGHT`/`MISSING_AGENT_NODE_WIDTH` (already defined in `DependencyGraph.tsx`), compute each node's left/right-edge anchor point (source = right-mid, target = left-mid, matching today's `Position.Right`/`Position.Left`) for feeding into `bezierPath`. Also the `fitView` bounding-box math (min/max over all node rects) used by `GraphCanvas`'s imperative handle. |

**Modified files**:

| File | Change |
|---|---|
| `DependencyGraph.tsx` | Replace `<ReactFlow>`/`<ReactFlowProvider>`/`<Background>` imports and JSX with `<GraphCanvas>`; replace `useReactFlow().fitView` with a `ref` to `GraphCanvas`'s imperative handle; **the entire `useMemo` derivation block (lines ~471-779) is UNCHANGED** — same `Node[]`/`Edge[]`-shaped (now plain `GraphNode[]`/`GraphEdge[]`-shaped, structurally identical minus xyflow-specific fields) output, same dependency array, same E10 contract. `onNodeClick`/`onConnect`/`isValidConnection`/`onNodeMouseEnter`/`onNodeMouseLeave`/`onEdgeClick`/`onPaneClick`/`onPaneContextMenu` handlers are passed to `GraphCanvas` instead of `<ReactFlow>` — same function bodies, only the JSX wiring point changes. Everything OUTSIDE the canvas wrapper (status chips, ribbon, hint bar, reconciled-notice row, `PastRunBanner`, `MissionStatusStrip`, the 🕘 button + `RunHistoryPopover`, `GraphLegend`, `RunTimelinePanel` side panel, `EdgeRelationModal`/`CopyRunCommandDialog`/`RunDialog`) is **byte-for-byte unchanged** — none of it is an xyflow consumer. |
| `CommandNode.tsx`, `AgentNode.tsx`, `MissingAgentNode.tsx` | Swap `import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"` for the new `NodeHandle` + plain prop types (`{ data: CommandNodeData }` instead of `NodeProps<Node<CommandNodeData>>`). `<Handle type="source" position={Position.Right} .../>` becomes `<NodeHandle role="source" connectable={...} .../>`. **Every other line is unchanged** (menu, hover state, pulse effects, JSX structure, class names, inline styles) — this is the smallest-blast-radius file group in the whole migration. |
| `package.json` (apps/web) | Remove `@xyflow/react` dependency once the cutover PR merges (big-bang — do this in the SAME PR that deletes `<ReactFlow>` usage, not a later cleanup pass, so there's never a window where the dependency is unused-but-present). `@dagrejs/dagre` is untouched (design §7 Q4/§8's locked "auto-layout stays"). |
| `globals.css` | Add any NEW hand-rolled keyframes this migration introduces (ghost-edge dash animation if any, `NodeHandle`'s remount-replay pulse if it needs its own keyframe distinct from today's) to the existing `@media (prefers-reduced-motion: reduce)` collapse block (line 62) — per design §5's explicit warning that hand-rolled CSS does not auto-inherit that block. |

**Unchanged, zero-diff** (confirmed against current code, not just the pre-P3 design doc):
`GraphToolbar.tsx`, `GraphCanvasMenu.tsx`, `GraphLegend.tsx`, `GraphHintBar.tsx`,
`GraphStatusChips.tsx`, `DaemonRibbon.tsx`, `NodeDeleteConfirm.tsx`, `NodeMenu.tsx`,
`NodeTokenBadge.tsx`, `EdgeRelationModal.tsx`, `computeLayout.ts`, `useRunStore.ts` (all of it —
P2's aggregation layer and P3's history slice are pure state/RPC logic with zero xyflow coupling,
confirmed by grep: no `@xyflow` import anywhere under `lib/run/` or `components/run/`), every
`run/*.tsx` component (`MissionStatusStrip`, `RunDialog`, `PreflightStrip`, `RunTimelinePanel`,
`RunLogTail`, `RunHistoryPopover`, `PastRunBanner`, `RunCommandPalette`, `CancelControl`,
`TokenBreakdownCard`, `DegradedTelemetryChip`, `RunSummarySection`, `RunSettingsSection`, `RunBar`).

#### 9.1.1 Edge label/toolbar portal replacement

Today's `EdgeLabelRenderer` portals the badge/toolbar div out of the SVG `<g>` into a sibling DOM
node xyflow manages, so CSS transforms/z-index work correctly outside SVG's coordinate space. The
self-coded version has no such portal target — but per the design doc's own note (§4.1), **none is
needed**: `GraphEdgePath`'s badge/toolbar can be a plain `<div className="absolute">` positioned
via `transform: translate(labelX, labelY)` inside `GraphCanvas`'s DOM node-layer (a sibling of the
`<svg>` edge layer, not inside it), because the whole canvas is already plain absolute-positioned
HTML, not an SVG viewport with its own transform. This is strictly simpler than what xyflow does
internally — flagged so the builder doesn't over-engineer a portal that isn't needed.

#### 9.1.2 Node-rect registry (for connect-drag hit-testing and edge anchor computation)

`GraphCanvas` must maintain a `Map<nodeId, DOMRect>` (or the dagre-computed `{x,y,width,height}` —
**prefer the latter**: since layout is fully computed by dagre with the fixed-estimate dimensions
already used for layout input (`NODE_WIDTH`/`NODE_HEIGHT`/`MISSING_AGENT_NODE_WIDTH` in
`DependencyGraph.tsx`), the registry does NOT need a `getBoundingClientRect()` DOM read per node —
it can be derived directly from the same `nodes` array `GraphCanvas` already receives as props,
computed once per render via `useMemo`, not measured. This is a meaningful simplification over a
"real" drag-and-drop hit-testing system and avoids a layout-thrash/measure-after-paint hazard
entirely. `useConnectDrag`'s mouseup handler does a simple point-in-rect scan over this derived
map — no `getBoundingClientRect()` calls needed anywhere in the connect-drag path.

### 9.2 Data flow — E10 preserved by construction, updated interface contract

```
artifacts (props) ──useMemo──▶ { baseNodes, baseEdges, missingAgentMentions }   [UNCHANGED]
   + useRunStore selectors (nodeRunData/timeline/summary/degraded/            [UNCHANGED —
     historyNodeRunData/historyTimeline/historySummary/historyRun/             P2+P3 state,
     activeArtifactId/missionActive/viewingHistory/...)                        zero xyflow coupling]
                    │
                    ▼
   nodes/edges (final, hover+mission-decorated) ──useMemo──▶  GraphCanvas props
                    │
                    ▼
   GraphCanvas (NEW) — ephemeral-only local state:
     - hoveredId: LIFTED to DependencyGraph (unchanged ownership, per design §4.1 row)
     - dragConnect: { sourceId, cursor } | null           (GraphCanvas-local)
     - selectedEdgeId: LIFTED to DependencyGraph (unchanged)
     - contextMenu: LIFTED to DependencyGraph (unchanged)
   NEVER holds a second copy of nodes/edges — renders directly from props each render.
```

`GraphCanvas`'s props interface (supersedes/extends design §4.2's draft with the P2/P3-driven
`onNodeClick` addition from §9.0.3):

```ts
interface GraphCanvasProps {
  nodes: GraphNode[];   // { id, type, position: {x,y}, width, height, data }
  edges: GraphEdge[];   // { id, source, target, data }
  onConnectAttempt(sourceId: string, targetId: string): void;
  isValidConnection(sourceId: string, targetId: string): boolean;
  onNodeHover(id: string | null): void;
  onNodeClick?(id: string): void;         // NEW vs design doc — P2/P3 panel-filter click
  onEdgeClick(id: string): void;
  onPaneClick(): void;
  onPaneContextMenu(x: number, y: number): void;
  disabled: boolean;                       // authoringSuspended passthrough
  fitViewRef?: Ref<{ fitView(): void }>;   // imperative handle, replaces useReactFlow().fitView
}
```

`DependencyGraph.tsx`'s own `useMemo` derivation (the `baseNodes`/`baseEdges`/`nodes`/`edges`
chain, lines ~471-779 today) is **not touched** — it already produces a plain data-bag shape with
no xyflow-specific fields consumed downstream except `position`/`sourcePosition`/`targetPosition`
(all of which map 1:1 onto the new plain interfaces). Every RPC call that touches disk
(`saveArtifact`/`deleteArtifact` via `useArtifactStore`, `startRun`/`cancelRun`/`getRunEvents`/
`listRuns` via `useRunStore`) is unreachable from `packages/core` or the new graph components —
they all still flow through `apps/web`'s existing daemon RPC client, unchanged by this migration.
**This migration touches zero daemon RPC surface and zero filesystem-write path** — it is a pure
`apps/web` rendering-layer swap; no new backup/diff/write concern applies (confirmed against
CLAUDE.md's filesystem-safety section: not implicated, matches STATE §6.4's own note).

### 9.3 Edge cases — resolving the design doc's §6 open questions

1. **Pan/zoom needed at all? (Highest-leverage question, design §6 Q1.)** **Resolved: NO pan/zoom
   — plain scrollable container, single computed fit-to-content scale on mount/fitView click, no
   interactive wheel-zoom or drag-to-pan.** Reasoning: (a) STATE §6.3 NFR-1/§7 Q4 already lock
   Symbion's real range at ~10-30 nodes, confirmed unchanged by anything P2/P3 shipped (P2/P3 added
   UI density — timeline panel, status strip, history popover — none of which increase node COUNT,
   they narrow the canvas's available width via the 320px side panel instead); (b) dagre's `LR`
   rank layout at that node count produces a bounded bounding box the container can simply be sized
   to (or scrolled within) without ever needing a true viewport transform; (c) building wheel-zoom +
   drag-to-pan + inverse-matrix hit-testing is precisely the "full viewport transform system" the
   design doc itself flags as the cost driver that turns this into a bigger migration — nothing in
   P2/P3's shipped code supplies new evidence that this cost is now justified. **This is an
   architectural recommendation, not a taste call already made by the user** — flag for `/build`
   kickoff confirmation, but treat as the default unless overridden, since STATE §7 Q6 only locked
   "big-bang cutover," not pan/zoom specifically. If confirmed, `GraphCanvas`'s "internal state:
   viewportTransform" row in the design doc's §4.2 draft is dropped entirely; `fitView()` becomes
   "scroll the container so the bounding box is centered/visible," not a scale+translate animation
   — the `duration: 250` easing target becomes a `scrollTo({behavior: "smooth"})` call, functionally
   equivalent UX, cheaper implementation. No `useGraphPanZoom` hook is built.
2. **Hover-dim during connect-drag** — **Resolved: yes, dim, matching mission-mode's own established
   pattern** ("emphasize the pending link" reading). Reasoning: today's hover-dim ALREADY activates
   the instant a node is hovered (which is the state connect-drag starts from — mousedown on a
   handle only happens after hover-reveal per design §1B step 1), so a drag starting mid-hover-dim
   naturally continues dimming everything except the drag source + its already-connected neighbors,
   with no new state transition needed — the drag hook doesn't need to independently decide to dim,
   it inherits `hoveredId === sourceId`'s existing dim from `DependencyGraph`'s unchanged `nodes`
   `useMemo`. This is the cheaper, zero-new-code answer and is recommended, but is a genuine taste
   call the design doc correctly flagged — confirm with the user or product owner before/during
   `/build` if the "stay fully lit" alternative is preferred; either is a small (single boolean
   condition) implementation delta, not an architecture-level fork.
3. **Live valid-drop-target ring during drag, before mouseup** — **Resolved: do NOT add.** Per the
   design doc's own framing, this is confirmed a NEW affordance (today's React Flow implementation
   is drop-only validity feedback — a toast on invalid attempt, verified by reading
   `DependencyGraph.tsx`'s `onConnect`/`isValidConnection`: no candidate-highlighting code exists
   anywhere in the current implementation). FR-1..FR-4's "preserve bit-for-bit" mandate does not
   authorize adding it; Future Ideas §7 already correctly parks it. **Not built in this migration.**
4. **Accessibility/keyboard model** — **Resolved: explicit "out of scope for v1," matching the
   current implementation's actual behavior, not a new gap this migration introduces.** Evidence:
   `nodesDraggable={false}` in today's `<ReactFlow>` already disables most of xyflow's built-in
   keyboard/ARIA node interaction; no keyboard-driven connect/menu/delete path exists in the
   current shipped UI (confirmed: no `onKeyDown` handlers in any current graph component). Building
   a NEW keyboard model as part of this migration would be scope creep in the other direction (an
   improvement, not a preservation) — FR-1's "preserve... unless explicitly, individually accepted"
   framing is about not REGRESSING existing behavior, not a mandate to add net-new a11y the source
   never had. Recommendation: ship with the same (minimal) a11y posture as today — no regression,
   no addition — and track "graph a11y" as a separate future feature if wanted.
5. **Edge bezier curve shape** — architect/dev tuning detail, resolved procedurally not
   analytically: `bezierPath.ts` must be built and visually diffed against the PRE-migration
   screenshot baseline (§10.1) at multiple node-distance/angle combinations (short edge, long edge,
   same-rank edge if any) before the PR is considered done — not eyeballed once. xyflow's default
   `getBezierPath` uses a control-point offset proportional to `Math.abs(targetX - sourceX)` from
   the `Position.Right`/`Position.Left` anchors; replicate that formula (readable from `@xyflow/
   react`'s source before it's removed from `node_modules`, or from xyflow's public bezier-edge
   utility docs) rather than deriving a new curve from scratch.
6. **Dash-flow animation on participant edges during mission mode** — **Confirmed understood and
   NOT pulled forward.** `runFlow: "flowing"` stays a DATA field only; `GraphEdgePath` renders it
   with `strokeDasharray`/static-tint styling identical to today's `AnimatedEdge.tsx` (`isFlowing`
   → `animate-dashFlow` CSS class, defined in `globals.css`, itself unchanged) — the class already
   exists and already does nothing more than a static dashed stroke today per the codebase (no
   actual per-frame dash-offset animation is currently wired beyond the CSS keyframe already
   shipped) — this migration ports that CSS class reference verbatim, adding zero new animation
   logic. Confirmed out of scope, matching `graph-execution-realtime`'s own P2-deferred framing.
7. **Trackpad/pinch gestures** — **Moot, per Q1's resolution (no pan/zoom).** Not built.

**Additional edge cases specific to the migration itself (not in the design doc's §6, added here):**

- **Mid-migration partial state / big-bang discipline**: per STATE §7 Q6's note ("big-bang governs
  cutover, not necessarily one commit"), internal work MAY be sequenced (e.g., land `bezierPath.ts`
  + `computeLayout` unit tests first, then `GraphCanvas` skeleton behind a feature flag / local
  branch, then the full swap) but **the `apps/web` `main`/default branch must never run both
  `<ReactFlow>` and `GraphCanvas` simultaneously in the SAME rendered tree** — no side-by-side
  toggle, no `if (flag) <ReactFlow> else <GraphCanvas>` shipped to users, per the locked "no
  extended period running two renderers side-by-side in production" constraint.
- **Foreign-file / filesystem-safety analog**: N/A, confirmed in §9.2 — this migration has no fs
  write path. The closest analog risk is **accidentally regressing a DIFFERENT feature's UI while
  porting** (e.g. breaking `RunTimelinePanel`'s layout because the canvas wrapper's flex/width
  changed) — mitigated by the "everything outside the canvas wrapper is byte-for-byte unchanged"
  constraint in §9.1's `DependencyGraph.tsx` row, and by the pixel-parity baseline (§10.1) covering
  the WHOLE panel, not just the canvas interior.
- **Daemon disconnect mid-drag**: today's `nodesConnectable={daemonConnected && !authoringSuspended}`
  gates connect-drag at the xyflow level; the self-coded `NodeHandle`'s `connectable` prop must
  gate identically — if `daemonConnected` flips to `false` WHILE a drag is in progress (rare but
  possible — a 1-2s window), `useConnectDrag` must cancel the in-progress drag on the next
  `mouseup`/`mousemove` tick rather than attempt a connect that `onConnectAttempt`'s caller
  (`onConnect` in `DependencyGraph.tsx`) would silently reject anyway (today's `saveArtifact` call
  would fail the RPC and toast an error — same non-optimistic path, so behavior is equivalent
  either way, but cancelling early avoids a spurious toast). Not a NEW edge case (today's xyflow
  path has the identical race), just confirming self-coded parity.
- **Re-render/perf regression (NFR-3, event→UI ≤500ms budget)**: since node-rect derivation is
  `useMemo`-computed from the SAME `nodes` array already flowing through `DependencyGraph`'s
  existing memo chain (§9.1.2), `GraphCanvas` introduces no new re-render trigger beyond what
  already exists today (props changing on every SSE-driven state update, same as now) — the
  self-coded edge/node render cost (plain divs + SVG paths) should be equal-or-cheaper than
  xyflow's own internal reconciliation, but this is a claim to VERIFY (§10, perf spot-check), not
  assume, per NFR-2's own "no perf claim without a real benchmark" instruction.

### 9.4 Trade-off decisions + assumptions for dev/Checker to track

- **Node-rect registry derived from layout data, never DOM-measured** (§9.1.2) — a deliberate
  simplification vs. a "real" hit-testing system; correct only as long as `NODE_WIDTH`/
  `NODE_HEIGHT`/`MISSING_AGENT_NODE_WIDTH` stay accurate fixed estimates (already true today, an
  existing assumption this migration inherits, not introduces).
- **No pan/zoom** (§9.3 Q1) is the single highest-impact assumption in this plan — if overridden
  before/during `/build`, re-estimate: this alone was the design doc's own flagged cost swing
  between "contained migration" and "also build a full viewport transform system."
- **Hover-dim during drag = dims** (§9.3 Q2) — cheap either way, but confirm before `/build` so
  `code-reviewer` isn't checking against an assumption nobody signed off on.
- **`GraphEdgePath` badge/toolbar as plain absolute div, no portal** (§9.1.1) — simpler than xyflow's
  own mechanism; flag if a future nested-scroll-container requirement ever needs a real portal.
- **`bezierPath()` fidelity is verified by screenshot diff against the pre-migration baseline
  (§10.1), not by reading xyflow's source and trusting the port** — visual regression is the
  actual acceptance bar per FR-3/"pixel-identical" framing in the design doc, not code review of
  the math alone.
- **This migration does not touch `packages/core` or `apps/daemon` at all** — 100% `apps/web`.
  `code-reviewer`/`security-reviewer` scope for this feature is correspondingly narrow (no RPC, no
  fs-write, no new daemon surface — `/cso` is likely NOT required for this feature; flag to
  confirm at `/review` time rather than assume).

## 10. BUILD precondition decision — pixel-parity baseline SKIPPED (user explicit decision, 2026-07-17)

Testplan §0 requires capturing 18 screenshots + written behavior notes from the CURRENT xyflow UI
via chrome-devtools **before any migration code changes**, as the acceptance mechanism for FR-3's
"preserve bit-for-bit" mandate. Attempting this before `/build` confirmed `chrome-devtools` cannot
connect in this session (`Could not connect to Chrome` — the same failure mode already recorded in
`graph-execution-realtime-STATE.md` §23 during that feature's QA pass).

**User was asked directly and explicitly chose to proceed to `/build` without the baseline**,
accepting the following named residual risk rather than waiting for a browser-capable session:

- `bezierPath()`'s curve-shape fidelity (testplan §0.2, PLAN §9.3 Q5) cannot be verified by visual
  diff — the Maker/Checker must instead verify it by reading `@xyflow/react`'s actual source
  formula (still present in `node_modules` until the cutover PR removes the dependency) and
  matching it analytically, a weaker verification method than the planned screenshot diff.
- `DotGridBackground`'s exact dot spacing/size/color (testplan §0.2) cannot be sampled from live
  computed styles — must be read from xyflow's source/CSS instead of measured.
- PLAN §9.3 Q2's "hover-dim during drag = dims" resolution was flagged as something the baseline
  should SETTLE by observing live behavior, not just assume — this remains an unconfirmed
  assumption carried into `/build`, not a verified fact.
- The testplan's own acceptance mechanism for `/qa` ("re-run the SAME 18 states... side-by-side
  diff against these baseline images") has no baseline to diff against. `/qa` for this feature will
  need a different, weaker verification method (behavioral read-through against the design doc's
  wireframes + code-level comparison against the pre-migration `git` history of the same files,
  rather than an actual pixel diff) — this should be decided explicitly at `/qa` time, not
  discovered as a surprise gap then.

**This is the second consecutive feature in this session where a live-browser verification step
was blocked by the same environment constraint** (see `graph-execution-realtime-STATE.md` §23) —
worth noting as a standing limitation of this sandboxed session, not a one-off.

### Next step

`/build` — `feature-builder` implements per §9's plan, explicitly told the baseline was skipped and
must verify `bezierPath`/`DotGridBackground` fidelity analytically (reading xyflow's actual source)
rather than visually, and must NOT silently assume PLAN §9.3 Q2's hover-dim-during-drag resolution
is confirmed correct — it should implement the recommended default but flag it as unconfirmed for
the Checker, exactly as PLAN §9.3 Q2 itself already says to do.

## 11. BUILD — implementation notes (feature-builder pass, 2026-07-17)

Implemented per §9's plan, big-bang cutover in this working tree (not yet committed/shipped —
that's `/ship`'s job). `packages/core` and `apps/daemon` are untouched (confirmed via `git status` —
zero diff in either directory), matching PLAN §9.4's "100% `apps/web`" scope claim.

### 11.1 Files created

- `apps/web/src/components/graph/GraphCanvas.tsx` — root shell (forwardRef+useImperativeHandle
  `fitView`), node/edge layers, pane click/context-menu dispatch, node-rect registry (`useMemo`,
  never DOM-measured), hosts `useConnectDrag`. Renders directly from `nodes`/`edges` props every
  render (E10) — no local copy.
- `apps/web/src/components/graph/GraphNode.tsx` — thin absolute-positioned wrapper.
- `apps/web/src/components/graph/GraphEdgePath.tsx` — ported `AnimatedEdge.tsx` verbatim (badge,
  toolbar, delete-confirm, stagger draw-in, 20px hit-area path); badge/toolbar is a plain absolute
  `<div>` in the DOM node-layer, no portal (PLAN §9.1.1). **`markerEnd`/arrowhead intentionally
  dropped, not ported** — confirmed by grep that `DependencyGraph.tsx` never set `data.markerEnd`
  on any edge pre-migration, so the pre-migration render had no arrowhead; adding one would have
  been a net-new visual element FR-3's bit-for-bit mandate doesn't permit. Flagging this explicitly
  since it's exactly the kind of thing that's easy to "improve" by accident during a port.
- `apps/web/src/components/graph/NodeHandle.tsx` — replaces `Handle`; owns its own one-shot
  hover-pulse remount internally (`CommandNode`'s local `pulseKey` state was removed as redundant,
  since `NodeHandle` now does the re-key itself).
- `apps/web/src/components/graph/DotGridBackground.tsx` — SVG dot pattern, `gap=20`, `radius=0.5`,
  color `#91919a`. See §11.3 for the fidelity-verification method and a non-obvious finding.
- `apps/web/src/components/graph/useConnectDrag.ts` — drag state machine
  (`idle -> dragging -> commit/cancel`), rAF-throttled mousemove, node-rect-registry hit-testing,
  Escape-to-cancel, daemon-disconnect-mid-drag cancellation.
- `apps/web/src/components/graph/bezierPath.ts` — pure port of xyflow's actual control-point
  formula, hard-coded to the `Position.Right -> Position.Left` pair (the only pair this graph ever
  produces). See §11.2.
- `apps/web/src/components/graph/graphGeometry.ts` — anchor-point (`sourceAnchor`/`targetAnchor`),
  node-rect, point-in-rect, and `boundingBox` (fitView math) pure helpers.
- Test files: `bezierPath.test.ts`, `graphGeometry.test.ts`, `useConnectDrag.test.ts`,
  `NodeHandle.test.tsx`, `GraphCanvas.test.tsx`, `e10Invariant.test.ts`, `CommandNode.test.tsx`
  (new regression coverage — see §11.5).

### 11.2 `bezierPath.ts` fidelity — ANALYTICAL verification method used (baseline was skipped, STATE §10)

Read the actual compiled source at `node_modules/@xyflow/system/dist/esm/index.js` lines ~903-994
(`getBezierEdgeCenter`, `calculateControlOffset`, `getControlWithCurvature`, `getBezierPath`) and
ported the control-point formula line-for-line, NOT reproduced from memory/docs:
- `calculateControlOffset(distance, curvature)`: `distance >= 0 ? 0.5*distance : curvature*25*sqrt(-distance)`.
- Default `curvature = 0.25`.
- Label/center point: cubic-bezier t=0.5 weights `0.125/0.375/0.375/0.125` (source/sourceControl/targetControl/target).
- Hard-coded to `Position.Right` (source) → `Position.Left` (target) since `graphGeometry.ts`'s
  `sourceAnchor`/`targetAnchor` never produce any other pair (matches `DependencyGraph.tsx`'s
  pre-migration `Position.Right`/`Position.Left` `<Handle>` usage, confirmed by reading
  `CommandNode.tsx`/`AgentNode.tsx`/`MissingAgentNode.tsx`'s original `<Handle position={...}>` props).
- Verified the port's arithmetic by hand-checking the source term-by-term against the file (see
  `bezierPath.ts`'s own doc comment and inline `// getControlWithCurvature(...)` annotations
  pointing at the exact xyflow call each line replicates).

**Residual risk (flagged per the task brief, not silently treated as settled)**: this is verified
correct AS A PORT OF THE FORMULA — it is NOT verified as visually pixel-identical, since no
screenshot baseline exists (STATE §10). If xyflow's actual rendered curve differs from what this
formula predicts for any reason not visible in the source (e.g. a CSS transform applied to the SVG
viewport that this migration's plain-HTML canvas doesn't replicate), that would only surface at
`/qa` via behavioral read-through, not a pixel diff. Checker should re-verify the source line
numbers/formula against `node_modules/@xyflow/system` independently (still present, dependency not
yet removed from `node_modules` at review time unless `npm install` has already pruned it during
this same build) rather than trusting this note alone.

### 11.3 `DotGridBackground.tsx` fidelity — ANALYTICAL verification + one non-obvious finding

Read `node_modules/@xyflow/react/dist/esm/index.js`'s `BackgroundComponent`/`DotPattern` and
`node_modules/@xyflow/react/dist/style.css`'s `.react-flow__background-pattern.dots` rule +
`:root`/`.dark` custom-property defaults (not measured from a live render — no baseline exists).
Values used: `gap=20`px (default, unscaled since this migration has no pan/zoom — PLAN §9.3 Q1 —
so xyflow's `zoom`-based scaling collapses to the raw prop value), dot `radius=0.5`px
(`defaultSize.dots=1`, `DotPattern` renders `radius = scaledSize/2`).

**Non-obvious finding, flagged explicitly for the Checker to re-verify**: dot color is
`#91919a` (the LIGHT-theme default `--xy-background-pattern-dots-color-default`), NOT `#555` (the
`.dark`-theme default) — confirmed by grep that `DependencyGraph.tsx` never applied a `dark`
className to its `<ReactFlow>` root and never passed a `color`/`patternClassName` prop to
`<Background>`. This is counter-intuitive given the rest of Symbion's UI is dark-themed, and would
be an easy wrong-color regression for anyone "improving" this from memory rather than reading the
CSS cascade — documented in the component's own doc comment for exactly this reason.

### 11.4 PLAN §9.3 Q2 (hover-dim during connect-drag) — UNCONFIRMED, implemented as the recommended default only

Per the task brief and STATE §10's explicit instruction: this is **NOT** verified against live
behavior (no baseline, no reachable browser this session). Implemented as PLAN §9.3 Q2's
recommended default — hover-dim continues to apply during an in-progress drag because the drag
hook inherits `hoveredId === sourceId`'s existing dim state from `DependencyGraph`'s unchanged
`nodes` `useMemo` (no new code needed; `useConnectDrag` itself has no dim-related logic at all — it
only owns `dragConnect`/cursor state). **Flagging explicitly, per the task brief's instruction, that
this is an assumption carried forward, not a fact confirmed by this build** — Checker/QA must treat
PLAN §9.3 Q2 as still open, not silently closed by this implementation existing.

### 11.5 Regression tests for ported leaf components — NEW coverage, not a backfill

Per testplan §1.6: ran `find apps/web/src/components/graph -name "*.test.tsx"` BEFORE this build —
confirmed **zero** existing test files for `CommandNode`/`AgentNode`/`MissingAgentNode` pre-migration
(only `computeLayout.test.ts` existed). Added `CommandNode.test.tsx` as new coverage on the one line
that actually changed (`Handle` → `NodeHandle`) — did NOT backfill full `AgentNode`/`MissingAgentNode`
test files, since testplan §1.6 explicitly treats the pre-existing gap as accepted out-of-scope, not
an obligation this migration must close. Flagging to the Checker per the task brief's own framing:
this is a residual risk (AgentNode/MissingAgentNode still have zero direct unit coverage), just not
one this migration is scoped to fully close.

### 11.6 Two real bugs found and fixed during test-writing (not present in a naive first draft)

1. **`GraphNode.tsx` node-click-bubbles-to-pane bug**: `onClick` was only wired (and only called
   `stopPropagation()`) when an `onClick` prop was actually passed — but `DependencyGraph.tsx` only
   passes `onNodeClick` during `missionLike` (mission mode / history). Outside mission mode, clicking
   a node would bubble to `onPaneClick` and incorrectly clear `selectedEdgeId`/`contextMenu`, a
   regression from xyflow's internal node-vs-pane target distinction. Fixed: `GraphNode` now always
   calls `stopPropagation()` on node clicks regardless of whether a callback is wired. Caught by
   `GraphCanvas.test.tsx`'s T-5.3.
2. **`useConnectDrag.ts` rAF-scheduling race under a synchronous rAF mock**: `scheduleUpdate`'s
   `rafRef.current = requestAnimationFrame(cb)` assignment could be clobbered if `cb` ran
   synchronously (as some test mocks / potential rAF polyfills do) and set `rafRef.current = null`
   from inside itself before the outer assignment completed — silently dropping the NEXT scheduled
   mousemove update. Fixed with an explicit `handled` sentinel so the assignment never overwrites a
   value the callback already reset. Caught by `useConnectDrag.test.ts`'s T-3.2. Real
   `requestAnimationFrame` is asynchronous so this specific race would not manifest in production
   under normal conditions, but the fix makes the code correct regardless of rAF timing semantics.

### 11.7 Assumptions and verification gaps for the Checker (consolidated)

1. **Bezier curve fidelity is verified analytically (source-formula port), NOT by visual/pixel
   diff** — no baseline exists (STATE §10). See §11.2.
2. **`DotGridBackground` spacing/radius/color are read from xyflow's source/CSS, NOT measured from
   a live render** — see §11.3, including the light-vs-dark color finding.
3. **PLAN §9.3 Q2 (hover-dim during drag = dims) is an UNCONFIRMED assumption**, implemented as the
   recommended default only — NOT verified against actual pre-migration live behavior. See §11.4.
4. **Every "unchanged, zero-diff" file in PLAN §9.1's table was read in full and confirmed
   zero-xyflow-coupled by direct inspection** (not trusted from the plan alone) before this build
   started: `GraphToolbar.tsx`, `GraphCanvasMenu.tsx`, `GraphLegend.tsx`, `GraphHintBar.tsx`,
   `GraphStatusChips.tsx`, `DaemonRibbon.tsx`, `NodeDeleteConfirm.tsx`, `NodeMenu.tsx`,
   `NodeTokenBadge.tsx`, `EdgeRelationModal.tsx`, `computeLayout.ts`, `useRunStore.ts`, and every
   `run/*.tsx` component — confirmed via `grep -rn "@xyflow"` returning zero hits across
   `lib/run/` and `components/run/`, plus a manual read of each file's imports.
5. **`markerEnd`/arrowhead was intentionally NOT ported** (§11.1) — a deliberate omission, not an
   oversight, since the pre-migration edges never had one. Checker should confirm this reading is
   correct (i.e. that no arrowhead was actually visible in the live pre-migration UI) since it
   can't be visually confirmed in this session either.
6. **No pan/zoom** (PLAN §9.3 Q1) implemented exactly as specified: plain `overflow-auto` scrollable
   container, `fitView()` is `scrollTo({behavior:"smooth"})` to the content's top-left bounding-box
   corner (minus a 20px margin), not a transform+scale animation. This is the single highest-impact
   assumption in the whole migration per PLAN §9.4 — STATE marks it as an architectural
   recommendation still pending explicit product-owner sign-off, not yet a taste-call confirmed by
   the user. Flagging again here since it's easy to lose track of by BUILD time.
7. **Live browser QA could not be run this session** (same environment constraint as
   `graph-execution-realtime-STATE.md` §23 and this feature's own STATE §10) — everything above is
   verified by source-reading, static analysis, and unit/integration tests under jsdom, NOT by an
   actual browser render. `/qa` for this feature will need to decide its verification method
   explicitly (STATE §10's own note), since there is still no baseline to diff against.

### 11.8 Test / build output confirmation

- `packages/core`: 214/214 tests pass, zero diff in the package (confirmed via `git status`).
- `apps/daemon`: 397/397 tests pass, zero diff in the package (confirmed via `git status`).
- `apps/web`: 58/58 tests pass (11 test files), including the 7 new graph test files
  (`bezierPath.test.ts` 6, `graphGeometry.test.ts` 7, `useConnectDrag.test.ts` 8,
  `NodeHandle.test.tsx` 4, `GraphCanvas.test.tsx` 7, `e10Invariant.test.ts` 3,
  `CommandNode.test.tsx` 5).
- `npx tsc --noEmit` clean across `apps/web` (pre-existing, unrelated `toBeInTheDocument` type
  errors in `DaemonStatusBadge.test.tsx`/`CancelControl.test.tsx` are NOT from this migration —
  confirmed pre-existing by their location outside any file this migration touched; they're a
  `@testing-library/jest-dom` matcher-typing gap unrelated to xyflow).
- `npm run build` (root, all 4 workspaces) succeeds cleanly, including Next.js's own
  "Linting and checking validity of types" pass, run twice (once mid-build, once from a clean
  `rm -rf apps/web/.next` state) with identical clean output.
- `grep -r "@xyflow" apps/web/src` returns only comment-only hits (documenting the analytical
  verification method/provenance in `bezierPath.ts`, `DotGridBackground.tsx`,
  `DependencyGraph.tsx`'s doc comment) — zero live imports, zero code dependency.
- `@xyflow/react` removed from `apps/web/package.json` in this same change; `npm install` from the
  repo root pruned it (and its now-unused transitive deps) from `node_modules`/`package-lock.json`
  — confirmed `node_modules/@xyflow` no longer exists and `package-lock.json` has zero `@xyflow`
  occurrences.
- `apps/web/src/components/graph/AnimatedEdge.tsx` deleted (replaced by `GraphEdgePath.tsx`);
  confirmed zero remaining references via grep.

### 11.9 Deferred / explicitly NOT done in this build

- No live browser QA (§11.7 #7) — deferred to `/qa`, which must decide its own verification method
  given no baseline exists.
- No pixel-diff confirmation of `bezierPath`/`DotGridBackground` fidelity (§11.2/§11.3) — deferred
  to whenever a Chrome-reachable session is available, if ever revisited.
- No new keyboard/accessibility model added (per PLAN §9.3 edge case #4 — intentionally out of
  scope, not a gap).
- No live valid-drop-target ring during drag (per PLAN §9.3 edge case #3 — intentionally not built).
- `AgentNode.tsx`/`MissingAgentNode.tsx` still have zero direct unit test coverage (§11.5) — a
  carried-forward pre-existing gap, not newly introduced, but worth another look before this
  migration is considered fully hardened.

### Next step

`/review` (`code-reviewer` + `architect`, independent checkers) — this migration touches no RPC/
fs-write/daemon surface, so `/cso` is likely not required per PLAN §9.4's own flag, but confirm at
review time rather than assume. Then `/qa`, which must decide its verification method explicitly
given the missing pixel-parity baseline (STATE §10).

## 12. REVIEW — round 1 (2026-07-17)

`code-reviewer` and `architect` reviewed in parallel (no `/cso` — confirmed zero daemon/RPC/fs-write
surface touched, `git diff --stat -- packages/core apps/daemon` empty). **Both: NEEDS-WORK**, both
independently finding the **same 🔴 blocker**, independently confirmed by the orchestrator before
accepting it.

### 🔴 Blocker (confirmed by 3 independent parties: code-reviewer, architect, orchestrator)

**`GraphEdgePath.tsx`'s badge/toolbar/delete-confirm `<div>` is rendered as a JSX child of
`<svg><g>` in `GraphCanvas.tsx` (lines ~176-198), with no `<foreignObject>` wrapper.** Per the
SVG/HTML content model, a plain `<div>` nested under an `<svg>` ancestor is created in the SVG
XML namespace, not the HTML namespace — it will not receive `position: absolute`, Tailwind
classes, or normal box-model layout in a real browser. This breaks the ×N count badge, goal dot,
+/× toolbar, inline delete-confirm, and pending-save spinner — **AC-2 ("custom edges with
decoration") and AC-3 ("edge hover/click toolbar")**, both locked acceptance criteria.

- `code-reviewer` **empirically reproduced this with a throwaway RTL test**, confirming
  `namespaceURI: http://www.w3.org/2000/svg` for the rendered `<div>` — not a theoretical concern.
- `architect` independently found the same defect via source reading and traced it to a genuine
  gap in its own §9.1.1 authorship: the plan's text ("no portal target needed... the whole canvas
  is already plain absolute-positioned HTML") was correct in isolation but didn't account for the
  div being nested *inside* the `<svg>` subtree specifically — and, critically, **the plan never
  specified a test to guard this exact invariant**, unlike §9.1.2's node-rect registry, which got
  `e10Invariant.test.ts`-style protection. `architect` owns this as a verification-design flaw in
  its own plan, not just a Maker implementation slip.
- The orchestrator independently read `GraphCanvas.tsx:166-220` and `GraphEdgePath.tsx`'s return
  statement before accepting either Checker's finding, confirming the `<div>` (line ~130 of
  `GraphEdgePath.tsx`) is indeed a sibling of `<path>` elements inside the same returned fragment,
  which `GraphCanvas.tsx` then places inside `<g>`.
- **Root cause of non-detection during BUILD**: zero test file exists for `GraphEdgePath.tsx` (the
  single most complex ported component), and even a jsdom-based test would not have caught this
  without specifically asserting `namespaceURI` — jsdom's `querySelector` still "finds" an
  SVG-namespaced div in the tree, masking the defect from every existing test in this migration.

**Fix required**: move the badge/toolbar `<div>` out of the `<svg>` subtree entirely into a sibling
absolute-positioned HTML layer in `GraphCanvas.tsx` (using the `labelX`/`labelY` values `bezierPath`
already returns) — mirroring what xyflow's own `EdgeLabelRenderer` did via a portal, just without
needing an actual portal since the target layer already exists as a plain DOM sibling. `architect`
and `code-reviewer` agree this is cleaner than a `<foreignObject>` wrapper and matches what §9.1.1
originally intended. **Also required**: a regression test for `GraphEdgePath`'s badge/toolbar
rendering location — either an RTL `namespaceURI` assertion (per `code-reviewer`'s reproduction) or
a static-source check (per `architect`'s suggestion, mirroring `e10Invariant.test.ts`'s pattern:
assert no non-SVG element is emitted as a JSX child of the `<svg>`/`<g>` edge layer) — so this class
of defect cannot silently reappear in a jsdom-only test environment again.

### 🟡 Should-fix (non-blocking, both Checkers note)

- `GraphEdgePath.tsx` has zero automated test coverage of any kind — the blocker above is a direct
  symptom of this gap; closing it via the required regression test above addresses both at once.
- `AgentNode.tsx`/`MissingAgentNode.tsx` still have zero direct unit test coverage — pre-existing,
  self-disclosed, acceptable per testplan §1.6's explicit scoping, but flagged again since
  `MissingAgentNode`'s hover-create-agent affordance is now completely unverified by any automated
  check across two consecutive migrations.

### Everything else — both Checkers independently confirm sound

Component breakdown matches §9.1 exactly; the node-rect registry (§9.1.2) genuinely derives from
props via `useMemo`, no DOM measurement; E10 invariant holds (`GraphCanvas` never mirrors
nodes/edges into local state); no pan/zoom exists anywhere; no live valid-drop-target ring; no new
a11y/keyboard model beyond a reasonable Escape-to-cancel-drag addition; dash-flow stays
CSS-class-only; big-bang discipline holds (zero feature flags, zero side-by-side render path,
`@xyflow/react` fully removed from `package.json`/`node_modules`); `packages/core`/`apps/daemon`
untouched. Both Checkers independently re-verified (not trusted) the Maker's three self-disclosed
claims from §11.7 — bezier curve fidelity (a genuine, reasoned port of xyflow's actual formula, not
a guess), `DotGridBackground`'s dot color (corroborated via `tailwind.config.ts`/`globals.css`
confirming `.dark` is never applied anywhere in the app, so the light-theme default is correct),
and the dropped `markerEnd` (confirmed via `git show HEAD:...AnimatedEdge.tsx` that no edge object
ever set this prop pre-migration, so dropping it is correct, not a regression). The two bugs the
Maker found and fixed during BUILD (click-bubbling, rAF race) were both independently confirmed
correctly resolved with tests that genuinely exercise the described scenarios. Full test suite
(669 tests across 72 files) and `npm run build` independently re-run by `code-reviewer` and
reproduced exactly as claimed.

**Aggregate verdict: NEEDS-WORK.** Returns to `/build` for the one blocking fix + its regression
test, then `/review` re-runs once per the pipeline's standard rule.

## 13. BUILD — review fix pass (feature-builder, 2026-07-17)

Fixes ONLY the §12 blocker (edge badge/toolbar `<div>` created in the SVG namespace because it
rendered inside `<svg><g>`). No other file/behavior touched beyond this blocker's direct blast
radius (`GraphCanvas.tsx`, `GraphEdgePath.tsx`, plus two new files this restructuring required, and
new/updated test files).

### 13.1 Root cause, restated precisely

`GraphEdgePath.tsx` returned a fragment containing BOTH `<path>` elements AND a plain `<div>`
(badge/×N/goal-dot/toolbar/delete-confirm/pending-spinner). `GraphCanvas.tsx` rendered
`<GraphEdgePath>` as a JSX child of `<g>` inside `<svg>`. A `<div>` nested under an `<svg>` ancestor
is created in the SVG XML namespace (`http://www.w3.org/2000/svg`), not HTML
(`http://www.w3.org/1999/xhtml`) — confirmed empirically both by the Checker's own reproduction and
by a standalone repro test written and run (then discarded) during this fix pass, reproducing the
exact same jsdom behavior against a minimal `<svg><g><div/></g></svg>` tree before touching any
production code.

### 13.2 Fix — chosen approach and why

**Split `GraphEdgePath` into an SVG-only component + a separate HTML component, connected via
`createPortal` into an existing sibling DOM node — NOT via manual two-tree state lifting.**

- `GraphEdgePath.tsx` (existing file, rewritten): now returns ONLY `<path>` elements (the stroke
  path + the 20px invisible hover hit-area path). No `<div>` anywhere in this file's JSX — enforced
  by a new structural test (§13.4).
- `GraphEdgeLabel.tsx` (NEW): the badge (×N / goal-dot), hover-revealed +/× toolbar, inline "Delete?
  ✓ ✗" confirm, and pending-save spinner — all plain HTML, moved here verbatim (Tailwind classes,
  `Tooltip`, button handlers, `data?.onOpenModal`/`data?.onDelete` callbacks all unchanged).
  Positioned via `bezierPath`'s `labelX`/`labelY` exactly as before (`transform: translate(-50%,
  -50%) translate(labelX, labelY)`), just from a different DOM parent.
- `useEdgeInteraction.ts` (NEW): extracted the `drawn`/`hovered`/`confirmingDelete` state + stagger
  timer + hover-enter/leave handlers that `GraphEdgePath` used to own internally into a small hook,
  so ONE instance's state can be read by both halves of one edge.
- `GraphCanvas.tsx`: added a `GraphEdge` wrapper component (one per edge, rendered inside `<svg><g>`
  in place of the old direct `<GraphEdgePath>` call). `GraphEdge` calls `useEdgeInteraction` ONCE,
  renders `<g><GraphEdgePath .../></g>` directly (SVG-valid, stays in the `<svg>` subtree), and
  `createPortal`s a `<GraphEdgeLabel>` into `labelLayerEl` — a `useState`-tracked ref to the
  **existing** HTML node layer `<div>` (the same `<div className="relative">` at zIndex 2 that
  already renders `GraphNode`s, a plain sibling of the `<svg>` edge layer at zIndex 1). No new DOM
  layer was added; the portal target is the layer PLAN §9.1.1 already specified.

**Why `createPortal` instead of lifting state to `GraphCanvas` and rendering both halves
independently from two separate `.map()` loops (the initial approach explored and discarded during
this fix pass):** the state-lifting version required either (a) calling `useEdgeInteraction` in an
extra non-visual "cell" component per edge and reporting state up into a `GraphCanvas`-owned `Map`
via `useEffect`, which adds an extra render pass + `useEffect`-after-commit indirection and a
first-paint window where neither half renders (empty `Map`), or (b) awkward multi-render-cycle
risk. `createPortal` targeting a DOM node that is ALREADY a plain sibling within `GraphCanvas`'s own
render tree is the standard, minimal-indirection React mechanism for "this subtree's output needs a
different DOM parent than its logical React parent" — it does not add any new rendering root,
external DOM node, or dependency; it is explicitly NOT the discarded "portal we were told not to
reintroduce" (that refers to reproducing xyflow's `EdgeLabelRenderer`-style portal-to-an-external-
root mechanism; here the portal target is a `<div>` already rendered as a sibling in the SAME
component's own JSX, one render call away). No new package was added — `createPortal` comes from
`react-dom`, already a first-class dependency (`apps/web/package.json`).

### 13.3 Behavior preserved (verified against the ported logic, not re-derived)

Every prior behavior verified as byte-for-byte moved, not re-implemented from scratch: ×N count
badge, goal dot, hover-reveal of the +/× toolbar, click-to-pin via `selected`/`data?.selected`,
inline "Delete? ✓ ✗" confirm with `onDelete`/cancel, pending-save ghost/spinner, the 20px invisible
hit-area (stays on the `<path>` in the SVG layer, unaffected), the staggered draw-in animation
(`STAGGER_MS`/`STAGGER_CAP` unchanged, now inside `useEdgeInteraction.ts`), the dropped-`markerEnd`
decision from the original BUILD (§11.1, unchanged — not revisited by this fix pass), edge
click-to-select (`onClick` on the `<g>` wrapping `GraphEdgePath`, unchanged), and the ghost
connect-drag edge (unrelated `<path>`, untouched).

One small addition to `GraphEdgeLabel.tsx` not present in the original: when there is nothing to
show (`!decorated && !toolbarVisible && !confirmingDelete`), an empty hover-surface `<div>` still
renders (rather than nothing at all) so re-entering the hover region continues to work identically
to before, where the wrapper `<div>` always existed regardless of what was inside it. This is a
literal necessity of splitting the always-present wrapper into a conditionally-meaningful one, not
a behavior change — flagged for the Checker to independently confirm this reasoning holds.

### 13.4 Regression tests added (both angles, per the task brief's "may implement both")

- **`svgLabelNamespace.test.tsx`** (NEW) — RTL test rendering the real `GraphCanvas` end-to-end with
  an edge whose `data.count = 3` (forces the badge to actually render), then asserts
  `badge.namespaceURI === "http://www.w3.org/1999/xhtml"` AND walks the badge's full ancestor chain
  up to (not including) the `<svg>` root asserting every ancestor is also HTML-namespaced — mirrors
  the Checker's own reproduction. A second case sanity-checks the `<svg>` edge layer itself remains
  SVG-namespaced (guards against an overcorrection that moves everything out of `<svg>`).
  **Verified this test methodology actually catches the pre-fix bug class**: wrote and ran (then
  discarded) a minimal standalone repro (`<svg><g><Fragment><path/><div>×3</div></Fragment></g></svg>`)
  confirming jsdom reproduces `namespaceURI: http://www.w3.org/2000/svg` for the div in that shape —
  same failure mode the Checker found — before trusting the assertion against the real fixed code.
- **`svgOnlyEdgeLayer.test.ts`** (NEW) — static source-text check, mirroring `e10Invariant.test.ts`'s
  pattern: (a) parses `GraphEdgePath.tsx`'s returned JSX and asserts every emitted tag is in an
  SVG-valid allowlist (`path`, `g`, `circle`, `rect`, `pattern`, etc.) — explicitly asserts no
  `<div>` anywhere in the file; (b) parses `GraphCanvas.tsx`, strips comments (to avoid false
  positives from this file's own doc-comments mentioning `<svg>`/`<div>` in prose — caught and fixed
  during this pass, see the comment-stripping step in the test itself), isolates the literal
  `<svg>...</svg>` JSX block, and asserts no `<div>`/`<span>`/`<button>` appears inside it; (c)
  asserts `GraphCanvas.tsx` actually uses `createPortal` from `react-dom` (guards against a future
  edit reverting to inline nesting without anyone noticing the portal was removed).
- **`e10Invariant.test.ts`** (updated, not new) — extended its existing state-shape scan to also
  cover `GraphEdgeLabel.tsx` (previously only checked `GraphNode.tsx`/`GraphEdgePath.tsx`), since it
  now holds no local state of its own (state lives in `useEdgeInteraction`, passed in as a prop) —
  confirms the split didn't accidentally reintroduce a mirrored nodes/edges copy in the new file.

### 13.5 Test / build output confirmation (this fix pass)

- `packages/core`: 214/214 pass, zero diff (`git status`/`git diff --stat` both empty for the
  package).
- `apps/daemon`: 397/397 pass, zero diff.
- `apps/web`: 63/63 pass (13 test files) — the prior 58 (11 files) plus 5 new (2 in
  `svgLabelNamespace.test.tsx`, 3 in `svgOnlyEdgeLayer.test.ts`); `e10Invariant.test.ts`'s test count
  unchanged (3) since the extended file list didn't add new assertions, only scanned one more file.
- `npx tsc --noEmit` clean across `apps/web` for every file this fix pass touched — the only errors
  present are the SAME pre-existing `toBeInTheDocument` matcher-typing gap noted in §11.8, in files
  this fix pass did not touch (`DaemonStatusBadge.test.tsx`, `CancelControl.test.tsx`,
  `CommandNode.test.tsx`, `GraphCanvas.test.tsx`) — confirmed pre-existing, not introduced here. (One
  real type error WAS introduced and fixed during this pass, in the new `svgOnlyEdgeLayer.test.ts`
  itself — an `undefined`-narrowing issue in the regex-match handling — fixed before this build was
  considered done, not left in.)
- `npm run build` (root, all 4 workspaces) succeeds cleanly, including Next.js's "Linting and
  checking validity of types" pass, run twice (once mid-fix, once after the final edit) with
  identical clean output.

### 13.6 Assumptions for the Checker to verify independently

1. **`createPortal` targeting a `useState`-tracked ref to an already-rendered sibling DOM node is
   the correct, minimal-indirection fix** — not a reintroduction of the "portal we were told to
   avoid." The task brief's constraint was about not reproducing xyflow's `EdgeLabelRenderer`
   mechanism (a portal to an external/managed root); this portal's target is a `<div>` already
   present as a literal JSX sibling within the SAME `GraphCanvas` render tree, resolved via
   `useState(null)` + a `ref` callback so the very first render (before the DOM node exists) safely
   skips the portal rather than portaling into `null`. Checker should confirm this reading of the
   constraint is correct, since it's a judgment call, not something explicitly pre-approved.
2. **The one-extra-empty-hover-`<div>` case in `GraphEdgeLabel.tsx`** (§13.3) is a faithful
   preservation of "the wrapper div always existed, its contents were conditional" — not a new
   behavior. Worth an independent look since it's the one place this fix pass added logic beyond a
   pure relocation.
3. **`GraphEdge`'s single `useEdgeInteraction` instance genuinely keeps both halves in sync** —
   verified by the new `svgLabelNamespace.test.tsx` rendering the real component tree end-to-end
   (not a mock), but the Checker should independently confirm hover-enter on the SVG hit-area path
   correctly reveals the toolbar rendered in the portaled HTML half (not just that the badge exists
   at all) — the current regression tests assert existence/namespace, not the full hover-interaction
   round-trip through the portal boundary; a `fireEvent.mouseEnter`-based interaction test through
   the portal was not added in this pass since it's outside the blocker's literal scope (the
   REVIEW's required regression test is about namespace/structure, not re-testing pre-existing
   hover-toolbar behavior that already has coverage intent elsewhere in the testplan) — flagging
   this as a real gap for `/qa` or a future pass to close, not silently treating it as covered.
4. **All other STATE §11.7/§12 "should-fix"/carried-forward items are unchanged and out of scope for
   this pass** — `AgentNode.tsx`/`MissingAgentNode.tsx` zero unit coverage, bezier/DotGridBackground
   analytical-only verification, PLAN §9.3 Q2 hover-dim-during-drag unconfirmed assumption, no live
   browser QA this session. None of these were touched or newly resolved here.

### Next step

`/review` re-run (`code-reviewer` + `architect`) against this one fix, per the pipeline's standard
"NEEDS-WORK returns to `/build` then `/review` re-runs once" rule (§12's closing line). `/cso` likely
still not required (this fix touches zero RPC/daemon/fs-write surface — confirmed, `packages/core`
and `apps/daemon` remain zero-diff per §13.5).

## 14. REVIEW — round 2 (2026-07-17)

**Both `code-reviewer` and `architect`: PASS.** The round-1 blocker is genuinely and completely
fixed, verified through unusually rigorous independent methods, not superficial re-checks.

### Verification rigor (both Checkers went beyond reading code)

- `code-reviewer` **empirically reconstructed the original broken structure** (badge/toolbar `<div>`
  as a direct JSX sibling of `<path>` inside `<svg><g>`, no portal) in a scratch copy, swapped it
  into the real files, and ran the two new regression tests against it: **3 of 5 assertions
  failed**, including an exact reproduction of the round-1 finding
  (`expected 'http://www.w3.org/2000/svg' to be 'http://www.w3.org/1999/xhtml'`). Restored the real
  fix afterward (confirmed byte-identical to the pre-repro state) and re-ran: all 5 pass. This is
  direct proof the new tests are non-vacuous, not an assumption.
- `architect` traced the `createPortal` target through `GraphCanvas.tsx`'s actual JSX tree, hand-
  verified `svgOnlyEdgeLayer.test.ts`'s regex against a synthetic reintroduced-`<div>` case to
  confirm it correctly fails, and gave a clear, non-hedging verdict on the portal-constraint
  question (see below) rather than leaving it ambiguous.
- Both independently re-ran the full test suite and `npm run build`, reproducing the Maker's exact
  reported numbers (core 214/214, daemon 397/397, web 63/63).

### The portal question — resolved with a clear verdict

`architect` explicitly confirmed the Maker's use of `createPortal` (targeting a `useState`-tracked
ref to an already-rendered sibling `<div>` within `GraphCanvas`'s own render tree) is a **legitimate
application** of the original "don't reintroduce a portal" constraint, not a violation — that
constraint was about avoiding xyflow's `EdgeLabelRenderer`-style external-root portal mechanism
specifically, and what was built here has no external DOM root, no `document.body` target, and no
new dependency. This closes the one ambiguous judgment call the Maker flagged in §13.6.

### Does the fix close the round-1 self-critiqued verification gap? Confirmed yes

`architect`'s round-1 self-critique was that its own §9.1.1 plan never specified a test to guard
the SVG-content-model invariant. Both Checkers confirm the two new regression tests
(`svgLabelNamespace.test.tsx` — runtime DOM namespace assertion across the full ancestor chain;
`svgOnlyEdgeLayer.test.ts` — static source-structure guard) close this gap from two independent
angles (runtime behavior vs. source structure), appropriately redundant for a defect class this
subtle and this easy to silently reintroduce.

### 🟢 Two non-blocking nits (`code-reviewer`)

- `GraphEdgeLabel.tsx`'s empty hover-surface `<div>` now conditionally sets `pointerEvents: "none"`
  for non-interactive edges, vs. the original's unconditional `"all"` — a small, almost-certainly-
  inert behavioral delta (non-interactive edges never had an SVG hit-area either) that the Maker's
  own self-disclosure didn't explicitly call out. Flagged for the record, not a regression risk.
- The self-disclosed gap (no test round-trips an actual `mouseEnter` through the portal boundary to
  confirm the toolbar visually reveals) remains open — both Checkers assessed this as low-risk
  (React's portal event handling is DOM-listener-based here, not delegation-chain-dependent, so
  there's no plausible portal-specific bubbling hazard) and recommend closing it opportunistically
  at `/qa`, not as a blocker.

### Everything else — confirmed clean, no new issues from this fix pass

Behavioral preservation verified by `code-reviewer` diffing directly against the pre-migration
`AnimatedEdge.tsx` (via `git show HEAD:...`) — badge, hover-toolbar, click-to-pin, delete-confirm,
pending-spinner, 20px hit-area gating, and stagger-draw-in timing all match line-for-line, only
relocated. E10 invariant holds (`useEdgeInteraction`'s state is genuinely ephemeral, confirmed by
both Checkers + the extended `e10Invariant.test.ts`). Blast radius confirmed in-scope — no
unrelated files touched, `packages/core`/`apps/daemon` remain zero-diff.

## 15. QA (2026-07-17)

### Mechanical gates — PASS

- **`npm run build`** (root, all 4 workspaces): clean. `next build`'s typecheck+lint passed.
  Notable, expected signal: `/`'s First Load JS dropped from ~109 kB to **~58 kB** — direct
  confirmation `@xyflow/react` is genuinely gone from the production bundle, not just from
  `package.json`.
- **Full automated test suite** (`npx vitest run`, fresh at QA time): **74 files / 674 tests, all
  passing.** Matches every prior BUILD/REVIEW self-report exactly (214 core + 397 daemon zero-diff,
  63 web — 58 prior + 5 from the round-1 fix, minus none removed net +5 vs. the pre-fix 669).
- **Daemon boot + root route**: rebuilt daemon, booted clean on `127.0.0.1:20136`.
  `curl http://127.0.0.1:20136/` → **HTTP 200**.
- **No stray library references**: `curl`'d the served root HTML and grepped for `xyflow`/
  `reactflow` — zero hits, confirming the removal is complete end-to-end (source → bundle → served
  output), not just at the dependency-declaration level.
- **RPC sanity** (this migration touches zero daemon/RPC surface, so this is a smoke check, not a
  primary gate): `listRuns` responded correctly against the registered project — daemon-side
  behavior is unaffected by an `apps/web`-only change, as expected.

### Manual chrome-devtools journey (J1–J26) — NOT RUN LIVE, explicit skip + residual risk

**Same root cause as `graph-execution-realtime-STATE.md` §23**: `chrome-devtools`'s
`list_pages`/`navigate_page` both fail with `Could not connect to Chrome` — re-confirmed at the
start of this QA pass, not assumed stale from the earlier session. No browser is reachable at the
expected DevTools WebSocket endpoint in this sandboxed environment. This is the SECOND consecutive
migration in this session blocked by the identical constraint (first `graph-execution-realtime`,
now this feature) — worth treating as a standing environment limitation for this session, not a
one-off.

**This is a materially higher-stakes gap for THIS feature than it was for `graph-execution-realtime`**:
that feature's skip meant new UI surfaces were unverified live; this feature's skip means the
**entire rendering engine for Symbion's primary authoring surface** was replaced with zero live
visual or interaction confirmation. The round-1 REVIEW blocker (an `<svg>`-namespace bug that would
have been screamingly obvious in any real browser — the badge/toolbar simply would not have
rendered at all) is direct, concrete proof that jsdom-based tests and code review, however
rigorous, cannot substitute for this class of check. That specific bug was caught only because two
independent Checkers happened to reason carefully about the SVG content model — a genuinely
different, less-detectable defect of the same "renders fine in jsdom, broken in a real browser"
family could be sitting in this diff right now undetected.

**Itemized: all 26 manual journeys, NOT run live**:
- **J1–J13 (parity + core authoring)**: idle canvas visual parity, node hover dim/fade-in, node
  menu, edge hover/pinned toolbar, edge delete+unlink, connect-drag success/invalid/empty-cancel/
  Esc, pane context menu, missing-agent create, just-added ring, and **J13 specifically** — the
  design doc's own named "hardest interaction case" (simultaneous drag + pinned edge + missing-agent
  hover, explicitly flagged in the testplan as "must be exercised explicitly, not assumed to just
  work because unit tests pass"). None of these were exercised in a real browser.
- **J14–J17 (mission-mode)**: execute→overlay, token badge hover card, terminal→Summary auto-morph,
  cancel mid-run. Not run.
- **J18–J20 (history)**: history popover + past-run overlay, history exit, live-run-wins-over-history
  toast. Not run.
- **J21–J23 (resilience)**: daemon disconnect mid-authoring, daemon disconnect mid-drag (a genuine
  race-condition-shaped scenario unit tests are poorly suited to catch), empty graph. Not run.
- **J24 (fit-to-view UX judgment call)**: the testplan explicitly flags this as "the ONE journey
  where a UX judgment call is expected and should be explicitly signed off" (whether the
  scroll-based `fitView` replacement, per PLAN §9.3 Q1's no-pan/zoom resolution, "feels acceptably
  smooth" vs. the removed transform-animation baseline). **This cannot be verified by any means
  other than a human or live browser observing it** — there is no code-level substitute. Remains
  fully open.
- **J25 (perf spot-check, NFR-3)**: SSE-event-to-badge-update latency, subjective ≤500ms /
  no-jank check. The testplan itself notes this needs "a real benchmark," which requires a live
  environment. Not run, not benchmarked.
- **J26 (reduced-motion)**: OS/browser reduced-motion collapse check for the just-added ring and
  mission glow. Not run — this is exactly the class of check that would catch a hand-rolled
  animation that forgot to register in the `globals.css` collapse block, and it's unverified.

**Testplan §0's pixel-parity baseline was never captured either** (recorded already in STATE §10,
carried forward here for completeness) — so even if a browser becomes available later, there is no
"before" reference to diff J1–J26's "after" screenshots against. Closing this gap properly requires
BOTH a Chrome-reachable session AND either (a) reverting to the pre-migration commit to capture the
baseline retroactively, or (b) accepting a weaker standard (design-doc/wireframe comparison instead
of pixel diff) for sign-off.

### Verdict: **PASS on mechanical gates, FAIL-TO-RUN (not FAIL) on the mandatory manual journey**

Consistent with this session's established pattern (`graph-execution-realtime-STATE.md` §23): this
is recorded as an **honest incomplete QA pass**, not a false PASS and not a code FAIL. What IS
proven: the code builds clean, 674/674 automated tests pass fresh, the daemon serves the new bundle
correctly, `@xyflow/react` is completely and verifiably gone end-to-end, and two independent
Checkers (across 2 review rounds, using empirical reconstruction/reproduction methods, not just
reading) confirmed the implementation is architecturally sound and the one real defect found was
genuinely fixed.

**What is explicitly NOT proven, and matters more here than in any other feature this session**:
that the self-coded renderer actually looks and behaves correctly for a human using a real browser.
Given this migration replaced the entire rendering engine for the primary authoring surface, and
given the round-1 blocker already demonstrated that a "passes every automated check" state can
coexist with "completely broken in a real browser," this residual risk should be weighted more
heavily than a typical "QA was partial" note — it is not a formality.

**Recommendation**: do not treat this as equivalent to a full QA PASS. Before this feature is
considered genuinely shippable-with-confidence, a session with a reachable browser must run J1–J26
in full, with special attention to J13 (simultaneous disclosure states) and J24 (the fit-to-view UX
judgment call, which has no code-level substitute). If the user chooses to ship anyway, that
decision — and this specific, elevated residual risk — must be named explicitly, not silently
inherited from the general "QA was partial" pattern used elsewhere in this session.

## 16. SHIP — deploy notes (2026-07-17)

Shipped on `/review` PASS (§12/§14, both rounds, both Checkers) + `/qa` **partial, elevated risk**
(§15 — mechanical gates PASS, all 26 mandatory manual browser journeys unrun, no Chrome reachable
in this session). Per this command's own precondition gate, the skip was confirmed **explicitly**
by the user before shipping — the user was shown the elevated-risk framing verbatim (this is a
full replacement of the primary authoring surface's rendering engine, not an additive UI feature)
and chose to ship anyway, prioritizing momentum over waiting for a browser-capable session.

**Precondition check performed before shipping**:
- REVIEW section (§14) — PASS, both rounds, confirmed not assumed.
- QA section (§15) — partial (mechanical PASS, all manual journeys skipped, 2 of them — J13, J24 —
  having no code-level verification substitute at all). User explicitly confirmed shipping anyway
  via direct question, with the elevated risk stated plainly before the confirmation was asked for.
- `git diff --stat` for this feature's full diff touches only `apps/web` — zero `packages/core`,
  zero `apps/daemon`, zero RPC handlers, zero filesystem-write/path-handling code. No `/cso` trigger
  condition met; confirmed by both Checkers across both review rounds, not assumed from the plan's
  own prediction.

**Residual risk carried forward, accepted, not silently dropped**:
1. **All 26 manual browser journeys (J1–J26) remain unverified.** This is the single largest
   unverified-surface risk of any feature shipped in this session — a full rendering-engine
   replacement for Symbion's primary authoring view, confirmed working only via `npm run build`,
   674 automated (jsdom-based) tests, and 2 rounds of code-level review.
2. **J13 and J24 have no code-level verification substitute** — J13 (the design doc's own named
   "hardest interaction case": simultaneous connect-drag + pinned edge toolbar + missing-agent
   hover) and J24 (whether the new scroll-based `fitView` replacement *feels* acceptable vs. the
   removed transform-animation) can only be confirmed by a human observing a real browser. No
   amount of additional code review or unit testing closes this gap.
3. **The pixel-parity baseline (testplan §0, 18 screenshots) was never captured** — even a future
   browser-reachable session has no "before" reference to diff against; closing this properly
   requires either reverting to the pre-migration commit to retroactively capture it, or accepting
   a weaker design-doc/wireframe-based sign-off standard instead.
4. **Direct precedent for this risk category being real, not theoretical**: the round-1 REVIEW
   blocker (§12) was an `<svg>`-namespace bug that would have made the edge badge/toolbar
   completely invisible in any real browser, and it passed every jsdom-based test undetected until
   two Checkers reasoned carefully about the DOM content model. A structurally similar,
   less-detectable defect could be present in this shipped code right now.
5. Carried forward from BUILD/REVIEW (non-blocking, lower severity than 1-4): `AgentNode.tsx`/
   `MissingAgentNode.tsx` have zero direct unit test coverage; bezier curve fidelity and
   `DotGridBackground`'s dot color were verified analytically (reading source), not visually;
   PLAN §9.3 Q2's "hover-dim during drag = dims" resolution remains explicitly unconfirmed; no
   test round-trips an actual hover event through the new portal boundary to confirm the toolbar
   visually reveals (§13.6, assessed low-risk by both Checkers but still open).

**Recommendation for the next session with a reachable browser**: this is the highest-priority
live-verification item across everything shipped this session. Run testplan §2 (J1–J26) in full,
in the order given, with J13 and J24 given explicit, undivided attention since they cannot be
partially de-risked by any other means. If a serious defect is found, the fix should be scoped as
a follow-up to THIS feature (self-coded-graph-migration), not folded silently into unrelated work.

## 17. Done — self-coded-graph-migration

**Shipped 2026-07-17.** `@xyflow/react` fully removed from Symbion's dependency graph; replaced
with a self-coded renderer (`GraphCanvas`, `GraphNode`, `GraphEdgePath`, `GraphEdgeLabel`,
`NodeHandle`, `DotGridBackground`, `useConnectDrag`, `useEdgeInteraction`, `bezierPath`,
`graphGeometry`) implementing all locked requirements: auto-layout via dagre retained unchanged,
all 4 authoring features rebuilt (connect-by-drag, graph-wide hover-dim, edge +/× toolbar, pane
context menu), no pan/zoom (architectural recommendation per PLAN §9.3 Q1, not yet a user-confirmed
taste call), big-bang cutover with zero side-by-side rendering window, E10 (derive-from-artifacts)
invariant preserved throughout.

**What was verified**: 2 full review rounds (round 1 found a real 🔴 SVG-namespace defect breaking
AC-2/AC-3; round 2 confirmed the fix via empirical reconstruction of the original bug, not just
code reading). 674/674 automated tests passing fresh at ship time. Clean `npm run build`, with the
production bundle size drop (~109kB → ~58kB on `/`) serving as independent, verifiable confirmation
the dependency was genuinely removed end-to-end. Zero changes to `packages/core`/`apps/daemon`.

**What was explicitly NOT verified**: any live browser behavior whatsoever (§15/§16) — this is the
single largest residual-risk item shipped in this session, accepted via an explicit, informed user
decision rather than a default or silent skip.

**Historical note for future readers of this STATE file**: this migration knowingly overrode two
prior independently-reviewed "keep React Flow" research verdicts
(`graph-execution-realtime-STATE.md` §2, `graph-rendering-library-evaluation-STATE.md`), on the
user's explicit, repeated confirmation after being shown the cost/risk analysis each time. The
prior research was not wrong given the evidence available at the time — the user's decision to
proceed anyway was a legitimate taste call about product control/DX, not a correction of a
mistaken analysis.
