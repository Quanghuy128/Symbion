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

**Once unblocked**: run `/design` (UI/interaction reference: the prototype's visual language, scoped to preserve all of AC-1..AC-9 per §6.2's FR-1..FR-4 — no feature silently dropped, all 4 currently-prototype-missing authoring features must be rebuilt), then `/plan` (architect sizes the actual self-coded rendering approach — hand-drawn SVG edges + absolute-positioned div nodes, dagre-computed positions retained, E10 architecture invariant preserved, big-bang cutover of `DependencyGraph.tsx` + `graph/*.tsx` — against the ~3-5 sprint bracket from `graph-rendering-library-evaluation-STATE.md` §11.3 Candidate C).
