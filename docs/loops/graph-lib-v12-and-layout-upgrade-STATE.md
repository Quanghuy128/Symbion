# graph-lib-v12-and-layout-upgrade — STATE

> Feature: two independent, low-risk changes to the dependency graph rendering surface, both recommended as unblocked follow-ups in `docs/loops/graph-rendering-library-evaluation-STATE.md` §8 (research spike, 2026-07-15, verdict: keep React Flow).
> Entry point: `/simplify-implementation` (fast-track: plan → build → ship). Scope confirmed directly with the user via AskUserQuestion (no full `/office-hours` — see Scope below for why this qualifies as intentionally trivial).

## Scope

**In scope — two decoupled changes:**
1. **Upgrade `reactflow@^11.11.4` → `@xyflow/react@^12`** in `apps/web/package.json`. Same team/license (MIT), same public API shape for `NodeProps`/`Handle`/`EdgeProps`/`EdgeLabelRenderer`/`getBezierPath`/`isValidConnection`/`onConnect`/`nodesDraggable` (confirmed in the research spike, §11.3 Candidate A — "full parity, near-zero rewrite"). Primary breaking changes per xyflow's own v12 migration guide: package rename (import path `"reactflow"` → `"@xyflow/react"`) and renamed CSS variables/class names. v11 has not published since 2024-06-20 (>2 years stale); v12 is actively maintained.
2. **Replace the naive `{x: 0/320, y: i*80}` two-column layout** in `apps/web/src/components/DependencyGraph.tsx` (lines ~333, ~356, ~387) with a real auto-layout algorithm via `@dagrejs/dagre` (the maintained fork — bare `dagre` is stale since 2022, per the research spike's correction) or `elkjs`. Layout-only change — does not touch node/edge rendering, connect-drag validation, or the mission-mode overlay contract.

**Out of scope (explicit anti-goals, both confirmed by the prior research spike):**
- No node-dragging (`nodesDraggable` stays `false` — this graph remains a fixed-layout dependency map, not a free-form canvas, per CLAUDE.md).
- No change to custom node/edge component logic, connect validation, hover/select behavior, mission-mode run overlay, or any `CommandNodeData`/`AnimatedEdgeData` contract shape.
- No migration to a different rendering library (Cytoscape.js, self-coded SVG/Canvas) — that question is closed (see the research spike).
- Not gated by run-engine P2/P3 — the research spike (§11.3 Candidate A) confirmed the v12 upgrade touches zero data-bag contract shape, so `graph-execution-realtime-STATE.md`'s P2/P3-sequencing precondition (which protects contract shape) does not apply here. The layout-only change is likewise orthogonal to P2/P3 (positions, not data-bag fields).

**Why this qualifies for the `/simplify-implementation` fast-track (no full `/office-hours`):**
- Both changes were already de-risked by a full research spike immediately prior (candidate comparison, maintenance-health gate, architecture-conformance check via AC-10/E10).
- Both are small, mechanical, and reversible (package bump + import-path rename; a layout algorithm swap confined to one derivation function).
- Neither touches daemon RPC handlers, filesystem-write/path-handling, or secret storage (apps/web-only, no new backend surface) — confirmed no `/cso` trigger applies.
- User confirmed scope directly via AskUserQuestion: both items, not just one.

## Acceptance criteria

- `apps/web/package.json` depends on `@xyflow/react@^12` (not `reactflow`); no remaining `from "reactflow"` imports anywhere in `apps/web/src`.
- All existing custom node/edge components (`CommandNode`, `AgentNode`, `MissingAgentNode`, `AnimatedEdge`) continue to render and function identically — connect-drag, validation, hover/select, edge decoration, mission-mode overlay all preserved byte-for-byte in behavior.
- `nodesDraggable` remains `false` (no accidental behavior change).
- Node positions are computed via a real layout algorithm (`@dagrejs/dagre` or `elkjs`) instead of the naive `i*80` stack — visually improved spacing/edge-crossing for graphs with more than a handful of nodes.
- `npm run build` passes clean (typecheck + lint + Next.js build).
- Existing test suites (core/daemon/web) remain green — no regression.

## PLAN — Architecture (2026-07-15, architect)

> Scopes two independent, decoupled changes to `apps/web` only. No daemon RPC, no filesystem-write pipeline, no `packages/core` change — this whole feature lives inside React components and one npm dependency swap. Companion test plan: `docs/loops/graph-lib-v12-and-layout-upgrade-testplan.md`.

### 0. Recommended commit/diff boundary

**Two separate commits, same build pass, sequenced 1-then-2** (not fully independent PRs, not squashed together):
- Commit A = the `@xyflow/react` v12 upgrade (package.json + every import-path rename + CSS variable check). This alone should build, typecheck, and visually match today's graph pixel-for-pixel (mechanical rename, zero behavior change).
- Commit B = the layout algorithm swap (`@dagrejs/dagre`), built on top of Commit A's renamed imports.

Reasoning: doing the layout rewrite on top of `@xyflow/react` v12 (rather than v11) avoids touching `DependencyGraph.tsx`'s node-building code twice under two different import surfaces. But keeping them as **two commits** (not one squashed diff) means if Commit B's layout output looks wrong in QA, it can be reverted alone without re-reverting the (near-zero-risk) library bump — matches STATE's own framing of these as "two decoupled changes." If the dev's tooling makes only a single commit practical, that is acceptable but must preserve this logical separation in the PR description/diff hunks so `code-reviewer` can review each concern independently.

### 1. Architecture

#### 1.1 Files to modify (Commit A — `@xyflow/react` v12 upgrade)

- `apps/web/package.json` — remove `"reactflow": "^11.11.4"`, add `"@xyflow/react": "^12"` (confirmed live on npm as `12.11.2`, actively maintained per the research spike §11.0 gate).
- `apps/web/src/components/DependencyGraph.tsx` — `import ReactFlow, { Background, BackgroundVariant, ReactFlowProvider, useReactFlow, type Connection, type Edge, type Node } from "reactflow"` → same named imports from `"@xyflow/react"`; `import "reactflow/dist/style.css"` → `import "@xyflow/react/dist/style.css"`.
- `apps/web/src/components/graph/CommandNode.tsx` — `import { Handle, Position, type NodeProps } from "reactflow"` → `"@xyflow/react"`.
- `apps/web/src/components/graph/AgentNode.tsx` — same import rename.
- `apps/web/src/components/graph/MissingAgentNode.tsx` — same import rename.
- `apps/web/src/components/graph/AnimatedEdge.tsx` — `import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "reactflow"` → `"@xyflow/react"`.

This is the exhaustive list — confirmed via `grep -rn 'from "reactflow"' apps/web/src`, 6 hits across 5 files, no others exist (`GraphToolbar.tsx`, `GraphCanvasMenu.tsx`, `GraphLegend.tsx`, `NodeMenu.tsx`, `EdgeRelationModal.tsx`, `NodeDeleteConfirm.tsx`, `GraphStatusChips.tsx`, `GraphHintBar.tsx`, `DaemonRibbon.tsx` do not import from the library directly — they only receive plain data/callback props).

**CSS variable check**: `apps/web/src/app/globals.css` was read in full — it contains zero `--rf-*`/`.react-flow__*` overrides or references (only Symbion's own dark-theme token set: `--background`, `--foreground`, etc., plus scrollbar/reduced-motion rules). No component-level `<style>` blocks reference React Flow's CSS classes either (confirmed no `react-flow__` string anywhere under `apps/web/src`, via grep). **Conclusion: the v12 CSS-variable/class rename in xyflow's migration guide has zero impact here** — Symbion never overrode any React Flow CSS custom property; it only imports the stock stylesheet and lets custom node/edge components do 100% of their own styling via inline `style`/Tailwind classes. This is a load-bearing finding: it means Commit A truly is mechanical (import path + package.json only), not a hidden styling-regression risk.

**npm workspaces consideration**: root `package.json` declares `"workspaces": ["packages/*", "apps/*"]` with a single root `package-lock.json` (npm workspaces, not independent lockfiles per-app). The dev must run `npm install` from the repo root (not inside `apps/web/`) after editing `apps/web/package.json`, so the root lockfile is regenerated consistently and the single shared `node_modules` (hoisted) drops `reactflow` and adds `@xyflow/react`. No other workspace package (`packages/core`, `apps/daemon`) references `reactflow`/`@xyflow/react` — confirmed by the CLAUDE.md architecture rule that `packages/core` has zero Node/UI imports; this is purely an `apps/web` dependency change with no cross-workspace ripple.

#### 1.2 Files to modify (Commit B — layout algorithm)

- `apps/web/package.json` — add `"@dagrejs/dagre": "^3"` (see §2 recommendation below).
- `apps/web/src/components/DependencyGraph.tsx` — the `useMemo` at lines ~310-439 (`baseNodes`/`baseEdges`/`missingAgentMentions`) is restructured into a two-phase pipeline (build graph shape → run dagre → merge positions), detailed in Data Flow §2 below. No other file changes needed — `CommandNode.tsx`/`AgentNode.tsx`/`MissingAgentNode.tsx`/`AnimatedEdge.tsx` are untouched (they only ever read `data`, never `position`, which React Flow itself applies to the wrapping node `<div>` via absolute positioning — none of the custom components reference `position` directly).
- New (optional, recommended) helper module: `apps/web/src/components/graph/computeLayout.ts` — pure function `computeLayout(nodes: {id, width, height}[], edges: {source, target}[]) => Map<string, {x, y}>` wrapping the dagre calls. Extracting this keeps `DependencyGraph.tsx`'s giant `useMemo` from growing further and gives the layout algorithm a unit-testable seam independent of React/React Flow types (input/output are plain objects, not `Node`/`Edge`). This is the single new file this feature creates.

### 2. Layout algorithm recommendation: `@dagrejs/dagre`, not `elkjs`

**Recommendation: `@dagrejs/dagre@^3`.** Reasoning, concrete not just "simpler":
- **Shape fit**: Symbion's graph is a strict bipartite-ish DAG (`command → agent`, occasionally `command → missingAgent`), 1-2 layers deep, no cycles, ~10-30 nodes per the research spike's sizing. Dagre's layered/Sugiyama algorithm is purpose-built for exactly this shape (`rankdir: "LR"` gives commands-left/agents-right, matching the *existing* two-column mental model users already see, just with real cross-minimization instead of naive `i*80` stacking).
- **elkjs is strictly heavier for zero marginal benefit here**: it ships as a Web Worker-based WASM/JS hybrid (larger bundle, async-by-default API — `elk.layout()` returns a Promise, which would force the "compute layout" step to become asynchronous inside a `useMemo`, violating the synchronous derive-from-artifacts pattern described in Data Flow §3 below). Dagre's `dagre.layout(g)` is synchronous, matching the existing `useMemo` architecture with zero new async-state-management surface (no loading spinner needed for "is the graph laid out yet").
- elkjs's main advantage (support for more exotic layout algorithms: `mrtree`, `force`, `radial`) is not needed — Symbion's graph is not going to grow orthogonal edge crossings or deep hierarchies; commands and agents are a flat two-tier relationship.
- **Bundle cost**: dagre + its `graphlib` dependency is a well-known, small (~30-50KB min, desk-estimate ±30% per the sibling research spike's own caveat convention) synchronous graph-layout library with no WASM/worker machinery — appropriate for a client-side Next.js bundle that already ships React Flow.
- `@dagrejs/dagre` (not bare `dagre`) is mandatory per the research spike's maintenance-health gate finding (§11.0: bare `dagre` last published 2022-06-14, dead; `@dagrejs/dagre` last published 2026-03-22, actively maintained fork).

### 3. Data flow

```
artifacts (from useArtifactStore, via props)
   │
   ▼
useMemo #1 (existing, UNCHANGED trigger deps: commands, agents, agentByName,
            agentNames, daemonConnected, justAddedId, onEditArtifact,
            handleEdgeDelete, authoringSuspended, missionActive,
            activeArtifactId, runParticipantAgentNames)
   │
   ├─ Phase (a) BUILD SHAPE: iterate commands/agents/missing-mentions exactly as
   │   today (same data-bag construction, same missingAgent synthesic-node logic,
   │   same edge construction with drawIndex/count/goal/onOpenModal/onDelete) —
   │   but each node's `position` field is temporarily omitted/set to a placeholder
   │   {x:0,y:0}; a parallel plain-object list of {id, width, height} (estimated
   │   dimensions, see Edge Cases §4.1) and {source, target} pairs (edges, from the
   │   same edges array being built) is assembled alongside.
   │
   ├─ Phase (b) LAYOUT: computeLayout(dimensionList, edgePairList) → Map<id, {x,y}>
   │   — a synchronous call to `@dagrejs/dagre` (rankdir "LR", nodesep/ranksep tuned
   │   for the node sizes below). Pure function, no React/React Flow types in its
   │   signature (see §1.2's computeLayout.ts).
   │
   ├─ Phase (c) MERGE: map over the Phase (a) node list and replace each node's
   │   placeholder `position` with the Phase (b) map's looked-up {x,y} (fallback to
   │   the placeholder if dagre somehow omits an id — defensive, should never happen
   │   since every node fed into computeLayout came from the same list).
   │   Every other field on `data` (onEdit/onDelete/runStatus/justAdded/etc.) is
   │   untouched — this merge ONLY touches `position`, preserving 100% of the
   │   existing data-bag construction code.
   │
   └─ returns { baseNodes, baseEdges, missingAgentMentions } — SAME shape as today.
   │
   ▼
useMemo #2 (existing, UNCHANGED) — hover-driven highlight/dim decoration on top
  of baseNodes/baseEdges → `nodes`
   │
   ▼
useMemo #3 (existing, UNCHANGED) — mission-mode / selected-edge decoration,
  pending-ghost-edge injection → `edges`
   │
   ▼
<ReactFlow nodes={nodes} edges={edges} .../> — renders; fitView on mount/toolbar
  action UNCHANGED (dagre-computed positions are just numbers, React Flow's
  fitView math doesn't care how position was derived).
```

**E10 conformance**: this entire pipeline still lives inside a single `useMemo` keyed off `artifacts`-derived values — dagre's `dagre.layout(g)` call is a pure, synchronous, side-effect-free computation over the phase-(a) output (dagre's `Graph` object is constructed fresh inside the `useMemo` body every render, never held in a ref/module-level singleton that could leak stale layout across unrelated re-renders). Nothing is mirrored into `useNodesState`/`useEdgesState` or any new `useState` — same invariant as today, just with one more pure-function stage before the `Node[]`/`Edge[]` are returned. **Do NOT reach for `useNodesState`/`useEdgesState`** even though `@xyflow/react` v12 docs sometimes lead with that pattern in examples — that would break AC-10/E10 and is explicitly out of scope.

### 4. Edge cases

**4.1 Node dimensions for dagre.** All three node components (`CommandNode`, `AgentNode`, `MissingAgentNode`) are auto-sizing `<div>`s with Tailwind padding (`px-3 py-2`) and no fixed `width`/`height` — text length varies (`/${command.name}` and agent names are user-authored, unbounded length). Two options:
  - (a) **Fixed-estimate dimensions** (recommended): pick a conservative constant, e.g. `width: 160, height: 40` for command/agent nodes, `width: 200, height: 40` for missingAgent (longer label: `⚠ ${mention} (does not exist)`). Feed these constants into dagre; real rendered width may differ slightly from the estimate for very long names, causing minor visual overlap/whitespace mismatch in extreme cases, but this is a one-line, zero-async, zero-new-effect solution.
  - (b) **Measured dimensions** via a `ResizeObserver`/`getBoundingClientRect` pass after first paint, feeding real widths into a second layout pass. Rejected: this requires either a two-render-pass architecture (layout with estimates → paint → measure → re-layout with real sizes → paint again, causing a visible "jump" on every render) or moving layout out of the synchronous `useMemo` entirely into an effect + `useState` for positions — the latter directly violates E10 (positions would become mirrored local state, not derived).
  - **Decision: (a), fixed-estimate dimensions.** Names in practice are short (`/${command.name}`, agent names) and Symbion already accepts imprecise estimates elsewhere (the research spike's own bundle-size ±30% convention). If QA finds real overlap with long names, the fix is bumping the constant, not switching architectures.

**4.2 Layout stability / no-jump-on-every-edit (explicit design decision, as flagged in the task).** Recommendation: **full re-layout every render, NOT position-pinning for existing nodes.** Reasoning:
  - Pinning previous positions for existing nodes and only laying out new ones is significantly more complex (needs a ref holding a `Map<id, {x,y}>` across renders, which is itself a form of mirrored state the E10 doc-comment warns against — a persistent position cache that must be manually invalidated when nodes are deleted, is a new class of stale-state bug this feature would introduce).
  - Dagre's layered algorithm is close to deterministic for a stable graph shape (same nodes/edges in, same relative layout out) — adding or removing a single command/agent will shift some positions, but this is true of the *current* naive `i*80` layout too (deleting node `i` already reflows every node below it by one slot, per the existing `commands.map((c, i) => ...)` index-based `y: i*80}`). So Commit B does not regress anything that wasn't already true — it does not introduce a NEW "jump" behavior class, it changes the character of an existing one (index-based vertical reflow → dagre-based layout reflow). This is worth stating explicitly to the Checker as "no regression, not a new risk."
  - The `justAddedId` ring animation is unaffected by which layout strategy is chosen — it's driven purely by `data.justAdded` (a boolean on the node's `data` bag, set via id-set diffing against `prevIdsRef`, §DependencyGraph.tsx:167-179), completely orthogonal to `position`. A full re-layout on every artifacts change will still correctly ring the new node; it may just also reposition its siblings, which is expected/acceptable per the reasoning above.
  - **If QA finds the reflow-on-every-edit genuinely jarring in practice** (this is a judgment call, not something desk-reasoning can fully settle — see Test Plan's manual-check item on this), the escape hatch is a follow-up feature (position-pinning with a proper invalidation story), not a blocker for this build.

**4.3 `missingAgent` synthetic nodes.** These are constructed inside the same Phase (a) loop (today: `missingNodes.map(...)`, keyed `missing-${mention}`) — they must be included in the dimension list and edge-pair list fed to dagre exactly like real nodes (dagre needs to know about them to route edges correctly, since edges to a missing agent target the synthetic node's id `missing-${mention}`, not a real artifact id). No special-casing needed beyond using the missingAgent-specific width estimate from §4.1(a).

**4.4 `fitView` interaction.** `fitView` (mount prop) and the toolbar's `fitView({duration:250})` call operate on whatever `nodes`/`positions` React Flow currently has mounted — they read the live node positions at call time, so they automatically adapt to dagre-computed positions with no code change. No interaction risk.

**4.5 Hand-edited/foreign-file class of edge cases does not apply here** — this feature has no filesystem-write path at all (pure client-side rendering derived from in-memory `artifacts`, which itself came from the daemon via existing RPC untouched by this feature). Listed explicitly to confirm this was considered and correctly ruled out, not skipped.

**4.6 Daemon disconnect mid-edit** — also does not apply; `daemonConnected` is an existing prop this feature doesn't touch, and neither commit adds any new daemon-RPC call.

**4.7 Re-publish/idempotency** — not applicable; this feature never touches the publish pipeline.

**4.8 Package upgrade transitively breaking a type.** `@xyflow/react` v12 renames a small number of types/props at the margins (e.g. some internal store-hook names) beyond the ones Symbion uses — since `grep` confirms Symbion only imports `ReactFlow` (default), `Background`, `BackgroundVariant`, `ReactFlowProvider`, `useReactFlow`, `Connection`, `Edge`, `Node`, `Handle`, `Position`, `NodeProps`, `BaseEdge`, `EdgeLabelRenderer`, `getBezierPath`, `EdgeProps` — all of which the research spike (§11.3 Candidate A) already confirmed have "full parity, near-zero rewrite" in v12 — this risk is low but `npm run build`'s typecheck step is the concrete gate that catches any surprise (see Test Plan).

**4.9 Performance of running dagre synchronously inside `useMemo`.** Acceptable. Symbion's graphs are single-digit to a few dozen nodes (per the research spike's repeated sizing assumption, "~10-30 nodes"); dagre's layered algorithm is O(V+E) to low-polynomial for graphs this size and runs in low single-digit milliseconds — well within a single React render's budget, no debouncing/memoized-layout-cache needed beyond the `useMemo`'s existing dependency array (which already only recomputes when `commands`/`agents`/etc. actually change, not on every unrelated re-render like hover).

### 5. Trade-off decisions + assumptions (for dev/Checker to track)

- **Decision**: two commits (library upgrade, then layout), sequenced, not squashed — §0.
- **Decision**: `@dagrejs/dagre` over `elkjs` — synchronous API fits the existing `useMemo`/E10 architecture; elkjs's async API would force a bigger architectural change for no shape-fit benefit here — §2.
- **Decision**: fixed-estimate node dimensions, not measured — avoids a two-pass render architecture or breaking E10 — §4.1.
- **Decision**: full re-layout every render, no position-pinning — simpler, no new stale-cache risk, and not a regression vs. today's already-reflowing naive layout — §4.2. Flagged explicitly for QA to judge subjectively (see testplan).
- **Assumption**: no other workspace package or e2e/Playwright test currently imports from `"reactflow"` directly (confirmed via repo-wide grep — only the 6 hits in `apps/web/src` listed in §1.1; `e2e/*.spec.ts` do not reference React Flow internals, they only interact via the rendered DOM).
- **Assumption**: CSS variable rename in xyflow's v12 migration guide is a non-issue for Symbion specifically, because Symbion never overrode any `--rf-*`/`.react-flow__*` class (confirmed by reading `globals.css` in full + repo-wide grep for `react-flow__`) — flagged so the Checker doesn't need to re-verify this from scratch, but should spot-check the built app visually per the test plan anyway (belt-and-suspenders, since a desk-read of one CSS file is cheap to double check).
- **Trade-off accepted**: choosing full re-layout (§4.2) means some existing nodes will visibly move position on every add/delete/edit that changes the artifacts array identity — this is called out as an accepted, non-regressive trade-off, not silently absorbed.

### 6. Suggested next step

Hand off to `feature-builder`/`dev` to implement per §1-§4 above, then run `/build`.

## BUILD — implementation notes (2026-07-15, feature-builder)

> Both commits implemented in this working tree as one sequential diff (§0's
> "single commit if the dev's tooling makes only one practical" escape hatch —
> here it's a deliberate choice to keep the review request as one pass, but the
> diff is logically separable: package.json/import-rename hunks = Commit A,
> `computeLayout.ts` + the `useMemo` restructure + dimension constants = Commit B).
> Recommend the Checker/orchestrator split into two commits when staging if a
> strict two-commit history is still wanted — the file-level changes below are
> already partitioned by concern.

### Files changed

**Commit A (`@xyflow/react` v12 upgrade):**
- `apps/web/package.json` — removed `"reactflow": "^11.11.4"`, added `"@xyflow/react": "^12"` (resolved to `12.11.2`).
- `apps/web/src/components/DependencyGraph.tsx` — import rename + CSS import rename.
- `apps/web/src/components/graph/CommandNode.tsx` — import rename.
- `apps/web/src/components/graph/AgentNode.tsx` — import rename.
- `apps/web/src/components/graph/MissingAgentNode.tsx` — import rename.
- `apps/web/src/components/graph/AnimatedEdge.tsx` — import rename.
- `package-lock.json` (root) — regenerated via `npm install` run from repo root, per PLAN §1.1's npm-workspaces note.

**Commit B (layout algorithm swap):**
- `apps/web/package.json` — added `"@dagrejs/dagre": "^3"` (resolved to `3.0.0`).
- `apps/web/src/components/graph/computeLayout.ts` — **new file**, the pure `computeLayout(nodes, edges) => Map<id, {x,y}>` wrapper described in PLAN §1.2/§3.
- `apps/web/src/components/graph/computeLayout.test.ts` — **new file**, T-1.1.1 through T-1.1.7 from the test plan (7 tests, all passing).
- `apps/web/src/components/DependencyGraph.tsx` — the `baseNodes`/`baseEdges`/`missingAgentMentions` `useMemo` restructured into the three-phase (build shape → layout → merge) pipeline per PLAN §3; added `NODE_WIDTH`/`NODE_HEIGHT`/`MISSING_AGENT_NODE_WIDTH` constants.

### Deviations from the PLAN required to make Commit A actually build (found by `npm run build`, not foreseeable from a desk-read of the migration guide's headline bullets)

The PLAN's §1.1/§4.8 assumption that `@xyflow/react` v12 is a "near-zero rewrite" for Symbion's specific import surface was *directionally* right but missed three real v12 API changes that only surfaced via `tsc`/Next's typecheck — flagging explicitly since the PLAN characterized this as purely mechanical:

1. **`ReactFlow` is a named export in v12, not a default export.** `import ReactFlow from "reactflow"` → `import { ReactFlow } from "@xyflow/react"`. Fixed in `DependencyGraph.tsx`.
2. **`NodeProps<T>`/`EdgeProps<T>`'s generic parameter changed shape.** In v11, `T` was just the `data` payload type (e.g. `NodeProps<CommandNodeData>`). In v12, `T` must extend the full `Node`/`Edge` type (e.g. `NodeProps<Node<CommandNodeData>>`, `EdgeProps<Edge<AnimatedEdgeData>>`). Fixed in `CommandNode.tsx`, `AgentNode.tsx`, `MissingAgentNode.tsx`, `AnimatedEdge.tsx` (added `type Node`/`type Edge` imports alongside the existing named imports).
3. **v12's `data` payload type must satisfy `Record<string, unknown>`** (an index signature), because `Node<NodeData>`/`Edge<EdgeData>` constrain their generic to that bound. Added `[key: string]: unknown;` to `CommandNodeData`, `AgentNodeData`, `MissingAgentNodeData`, `AnimatedEdgeData` — a type-level addition only, does not change any field, runtime shape, or behavior of these interfaces.
4. **`isValidConnection`'s callback parameter widened from `Connection` to `Edge | Connection`.** `DependencyGraph.tsx`'s `isValidConnection` only reads `.source`/`.target` (present on both shapes), so the fix was widening the param type annotation from `(conn: Connection) =>` to `(conn: Edge | Connection) =>` — zero logic change.

None of these four changes touch runtime behavior, the `data`-bag contract shape, or any interaction logic — they are exclusively TypeScript-level adjustments required by v12's stricter/changed generic constraints. Flagged for the Checker to verify independently (in particular #3's index signature, since a sufficiently paranoid reviewer might worry it silently widens the type and permits typos to slip through — it does technically loosen strictness on `data`'s exact shape, since the interfaces already declared every field they use; the index signature only affects structural compatibility checks against `Node`/`Edge`, it doesn't remove any existing property's type).

### Assumptions made (for the Checker to verify independently)

1. **Node dimension estimates**: `NODE_WIDTH = 160`, `NODE_HEIGHT = 40` for command/agent nodes, `MISSING_AGENT_NODE_WIDTH = 200` for missingAgent nodes — exactly the PLAN §4.1(a) recommended constants, not independently re-derived or measured against actual rendered DOM sizes.
2. **Dagre layout options beyond `rankdir: "LR"`**: added `nodesep: 40, ranksep: 120, marginx: 20, marginy: 20` in `computeLayout.ts`. These are NOT specified numerically in the PLAN (§2 says "tuned for the node sizes below" without giving numbers) — I chose these as reasonable defaults given the ~160×40 node estimate (enough vertical gap between same-rank nodes, enough horizontal gap between the two rank columns to fit edge labels/badges). **This is a judgment call the Checker/QA should visually verify against T-3.4's "no two node boxes visually overlap" / "edges visibly reduced crossing" bar** — if cramped or too sparse in practice, these are one-line tunables, not an architecture change.
3. **`computeLayout.ts` constructs a fresh `dagre.graphlib.Graph()` on every call** (no module-level singleton/cache) — matches PLAN §3's E10-conformance requirement that dagre's graph object never leaks state across unrelated re-renders.
4. **Defensive `hasNode` guard in `computeLayout.ts`**: before calling `g.setEdge(source, target)`, I check both ids were registered via `g.setNode` first (dagre throws otherwise). Per PLAN §4.3, every node (including `missing-${mention}` synthetic nodes) is included in the dimension list fed to `computeLayout`, so this guard should never trigger in practice — it's defensive-only, matching the PLAN's own "should never happen" framing for the Phase (c) merge fallback.
5. **`missingAgent` nodes are still deduplicated via the existing `Map<string, Node>()` keyed by `missing-${mention}`** — unchanged from before; only the `position` field construction changed (removed the `missingIndex` counter entirely since dagre now computes all positions, PLAN §4.3 confirms no special-casing needed beyond the width estimate).
6. **Full re-layout on every render (no position-pinning)** — implemented exactly as PLAN §4.2 mandates; no ref/cache holds previous positions across renders. Confirmed via code inspection: the `useMemo`'s dependency array is unchanged from before this feature (same `commands`/`agents`/etc. deps), so recompute-on-change semantics are identical to today, just now flowing through `computeLayout` instead of naive index math.
7. **Single sequential diff, not two separate git commits** — implemented as one working-tree change (no commits created; per this agent's instructions, only create commits when the user explicitly asks). The diff is partitioned by concern in the "Files changed" section above so a Checker/orchestrator can stage/commit as two commits if desired.
8. **Did not open a live browser to visually inspect T-3.3 (Commit A pixel-parity) or T-3.4 (Commit B layout quality)** — these are the two testplan items most valuable for the Checker or a manual QA pass to verify, since they require `npm run dev:web`/`npm run build && npm run start` and eyeballing a real graph, which this build pass didn't drive (no browser tool available in this session). Flagged as an explicit gap, not silently skipped — see "Deferred" below.

### Deferred / explicitly not done in this BUILD pass

- **T-2 (new Playwright spec for drag-connect)** — testplan explicitly marks this as a recommended fast-follow, not a blocking gate. Not written in this pass.
- **T-1.3 (component smoke test for `DependencyGraph`)** — testplan marks this "recommended, not required." Not written in this pass (would need `ReactFlowProvider` + jsdom wiring not currently exercised by any existing web test).
- **T-3.1 through T-3.9 (manual/visual verification checklist)** — requires a running dev/prod build with a live browser; not executed in this BUILD pass. This is the primary remaining gate before this feature can be considered QA-complete — see testplan §T-4's definition of done.
- **Two separate git commits** — not created (see assumption #7 above); left for the orchestrator/Checker to decide how to stage.

### Build/test output confirmation

- `npm test` (root, all three Vitest projects — core/daemon/web): **59 test files, 583 tests, all passing** (includes the 7 new `computeLayout.test.ts` cases and the 3 pre-existing web test files unmodified and green).
- `npm run build` (root, all workspaces: core/rpc-types/daemon typecheck via `tsc`, then `apps/web`'s `next build`): **passes clean** — Next.js's own typecheck-and-lint step (`next build`'s "Linting and checking validity of types...") completed with zero errors after the deviations above were fixed; zero remaining warnings referencing `reactflow`; production bundle generated successfully (`First Load JS` unchanged in order of magnitude from before, ~446 kB for `/`).
- `grep -rn 'from "reactflow"' apps/web/src` and `grep -rn "reactflow" apps/web/package.json` both return **zero hits** (T-3.2 confirmed mechanically).
- `npm ls @xyflow/react @dagrejs/dagre -w @symbion/web`: confirms `@xyflow/react@12.11.2` and `@dagrejs/dagre@3.0.0` both resolved correctly under the single root-hoisted `node_modules` (npm workspaces).
- `next lint` was not run standalone (it prompts interactively for first-time ESLint config in this repo, pre-existing condition unrelated to this feature) — `next build`'s own bundled lint-and-typecheck step is the actual gate exercised, and it passed.

## SHIP — deploy notes (2026-07-15)

Shipped via `/simplify-implementation` fast-track (plan → build → ship) — the independent `/review` (code-reviewer + architect) and `/qa` (live browser) Checker stages are **intentionally skipped**, per this command's own design for small, reversible, low-risk changes. Recording the skip and residual risk explicitly, as the fast-track's own guidance requires:

**Why this qualifies for the skip**: no daemon RPC, filesystem-write/path-handling, or secret-storage code touched (confirmed via `git diff --stat` — `apps/web` components + `package.json`/`package-lock.json` only); both changes were already de-risked by a full research spike (`graph-rendering-library-evaluation-STATE.md`) immediately prior; `npm test` (583/583 passing) and `npm run build` (clean) both gate this change mechanically.

**Residual risk accepted, named explicitly (not silently skipped)**:
1. **No live-browser visual verification was performed** (testplan T-3.1 through T-3.9) — the Maker itself flagged this as the primary remaining gap. In particular: T-3.3 (pixel-parity of the v12 upgrade — do node/edge visuals look identical to before) and T-3.4 (does the new dagre layout actually look better — no overlapping nodes, reduced edge crossing, reasonable spacing) have only been verified by reading code, not by opening a real graph in a browser.
2. **Dagre spacing constants (`nodesep: 40, ranksep: 120, marginx/y: 20`) are a judgment call**, not measured against actual rendered DOM dimensions (`NODE_WIDTH`/`NODE_HEIGHT` are estimates). If cramped or too sparse in practice, these are one-line tunables — not an architecture concern — but this has not been visually confirmed.
3. **No new Playwright spec or DependencyGraph component smoke test** was added (both explicitly optional per the testplan) — existing coverage for the graph surface remains what it was before this feature (i.e., none at the component/e2e level; unit coverage now includes the new `computeLayout.test.ts`).

**Recommendation**: the next time someone runs the Symbion web app locally (e.g. via `/run` or manual `npm run dev`), do a quick visual pass on the dependency graph — confirm nodes/edges render identically to before, and that the new auto-layout looks reasonable on a project with several commands/agents. If something looks off, the fix is isolated to `computeLayout.ts`'s constants or `DependencyGraph.tsx`'s merge-phase, not a deeper redesign.

## Done

Feature: **graph-lib-v12-and-layout-upgrade** — shipped via `/simplify-implementation` fast-track.

- `@xyflow/react` v12 upgrade: complete, build clean, zero remaining `reactflow` references.
- Dagre-based auto-layout: complete, 7 new unit tests passing, integrated into the existing derive-from-artifacts pipeline without violating the E10 invariant.
- Review/QA Checker stages intentionally skipped per the fast-track; residual risk (live visual verification) named above, not silently dropped.
