# graph-lib-v12-and-layout-upgrade — Test Plan

> Companion to `docs/loops/graph-lib-v12-and-layout-upgrade-STATE.md` (PLAN section). Covers both decoupled changes: (A) `reactflow` → `@xyflow/react@^12`, (B) naive `i*80` layout → `@dagrejs/dagre`. This feature has **no existing unit/component tests for the graph components today** (`DaemonStatusBadge.test.tsx`, `CancelControl.test.tsx`, `useArtifactStore.heartbeat.test.ts` are the only `apps/web` Vitest files, and there are zero Playwright specs touching the graph — `e2e/*.spec.ts` covers auto-generate-body/description and a happy-path, none of which assert on graph internals). This test plan therefore both verifies non-regression of what exists AND recommends the smallest new test surface that makes this change reviewable/CI-checkable rather than relying on manual-only verification.

## T-0 Preconditions / non-goals

- No daemon RPC, no filesystem-write path is touched by this feature — no CSO trigger, no daemon-integration test needed.
- No `packages/core` change — no core unit tests needed.
- This is UI-presentation-only; the verification bar is: build/typecheck clean, existing suites green, new targeted tests for the one genuinely new logic unit (`computeLayout`), and a manual/visual checklist for the parts that are impractical to assert on cheaply (pixel-level layout quality, drag-connect interaction).

## T-1 Unit tests (Vitest) — NEW

### T-1.1 `computeLayout.ts` (the one new pure-logic file, `apps/web/src/components/graph/computeLayout.ts`)

Location: `apps/web/src/components/graph/computeLayout.test.ts` (co-located, matches existing `*.test.ts(x)` convention/glob in `vitest.config.ts`).

- **T-1.1.1** Given 2 nodes (`cmd-1` command-shaped, `agent-1` agent-shaped) and 1 edge (`cmd-1 → agent-1`), `computeLayout` returns a `Map` with an entry for both ids, each `{x, y}` numeric and finite (not `NaN`/`undefined`).
- **T-1.1.2** Given a disconnected node (no edges reference it at all — mirrors an agent with zero incoming command references, a real Symbion state), it still receives a valid `{x,y}` position (dagre must not throw/drop orphan nodes).
- **T-1.1.3** Given a `missingAgent` synthetic node id (`missing-someAgent`) referenced only as an edge target (never as a node passed with its own explicit entry unless Phase (a) includes it — assert the implementation DOES include it, per PLAN §4.3), the returned map contains a position for that synthetic id too.
- **T-1.1.4** Given an empty node list and empty edge list, returns an empty map without throwing (covers the "0 artifacts" empty-graph state).
- **T-1.1.5** Given two separate `command → agent` pairs (2 disjoint components), no two nodes end up at the exact identical `{x,y}` (basic non-overlap sanity check — a regression here would mean dagre silently failed and returned degenerate/default positions).
- **T-1.1.6** Determinism: calling `computeLayout` twice with the same input (same node/edge arrays, fresh object identities) produces the same output positions — guards against an accidental reliance on object identity/insertion-order nondeterminism that would make `fitView`/visual review flaky.
- **T-1.1.7** (documents PLAN §4.9) A 30-node / 40-edge synthetic graph completes in under e.g. 200ms in the test (generous CI-safe bound, not a tight perf assertion) — guards against an accidentally-quadratic misuse of the dagre API (e.g. rebuilding the graph object per-node) rather than asserting a tight benchmark number.

### T-1.2 Existing suites — regression gate, not new tests

- **T-1.2.1** `apps/web/src/components/DaemonStatusBadge.test.tsx`, `CancelControl.test.tsx`, `useArtifactStore.heartbeat.test.ts` all still pass unmodified after both commits (`npm run test:web` from repo root, or `vitest run --project web`). None of these import React Flow, so they are a pure regression gate confirming the dependency swap didn't break the web app's module resolution/build graph generally.
- **T-1.2.2** `npm test` (root, runs all three Vitest projects: core/daemon/web) stays fully green — confirms zero cross-workspace ripple (expected, since `packages/core`/`apps/daemon` never import `reactflow`/`@xyflow/react`).

### T-1.3 Recommended (not blocking) — new component smoke tests, if time allows

Given zero existing component tests exercise `DependencyGraph`/`CommandNode`/`AgentNode`/`MissingAgentNode` today, a full component-test suite is a larger lift than this fast-tracked feature's scope justifies. If the dev has spare time, the highest-value addition (cheap, catches real regressions from Commit A's import rename) is:

- **T-1.3.1** Render `<DependencyGraph artifacts={[oneCommand, oneAgent]} .../>` inside `ReactFlowProvider` via `@testing-library/react` + jsdom, assert the DOM contains the command label (`/name`) and agent label text — this alone would catch an import-path typo or a v12 API removal that silently breaks rendering (e.g. `NodeProps` shape change) without needing to assert on visual layout.
- Not required for this feature to ship (STATE's acceptance criteria doesn't mandate new component-test coverage), but flagged as a gap worth closing opportunistically since this PR already touches every file that would need such a test's imports updated anyway.

## T-2 E2E (Playwright) — none new required, existing suite is the regression gate

There is no existing Playwright spec that interacts with the dependency graph (`e2e/auto-generate-body.spec.ts`, `e2e/auto-generate-description.spec.ts.retired`, `e2e/happy-path.spec.ts` — none reference graph/canvas selectors per repo grep). Given the fast-track scope (STATE explicitly opts out of full `/office-hours`), writing a new graph-specific Playwright spec is **not required to ship**, but is recommended as a fast-follow because it's the only way to mechanically verify connect-drag still works post-upgrade rather than relying on manual QA every time. If written, it should assert:

- **T-2.1** `npm run test:e2e` (which runs `npm run build` first) succeeds — this alone is a strong signal: a broken `@xyflow/react` import or a dagre runtime error occurring only in the built/production bundle (vs. dev server) would surface here as a build failure or a runtime console error during any existing spec's page load.
- **T-2.2 (recommended new spec, e.g. `e2e/dependency-graph.spec.ts`)**: boot the daemon fixture, create one command + one agent via the existing import/create flow, open the project view, assert both node labels are visible in the rendered graph canvas, drag-connect command → agent (mirrors STATE's AC-4 from the sibling `interactive-graph` feature), assert the link persists (re-fetch/reload shows the edge). This exercises the real `@xyflow/react` v12 connect-drag API end-to-end, not just import resolution.

## T-3 Manual verification checklist (required — the actual acceptance gate per STATE)

Run against `npm run dev:web` (or `npm run build && npm run start` for a production-parity check) with a project that has a realistic mix of commands/agents:

- **T-3.1 Build clean**: `npm run build` (root, all workspaces) passes — typecheck, lint, Next.js build all clean, zero new warnings referencing `reactflow`/`@xyflow/react`/`dagre`.
- **T-3.2 No `reactflow` string remains**: `grep -rn "from \"reactflow\"" apps/web/src` returns zero hits; `grep -rn "reactflow" apps/web/package.json` returns zero hits (only `@xyflow/react` present).
- **T-3.3 Visual parity (Commit A alone, before Commit B lands)**: with only the library swap applied, the graph should look **pixel-identical** to pre-upgrade — node colors (`#818cf8` command, `#a78bfa` agent, dashed danger missingAgent), handle positions (source=Right on command, target=Left on agent), edge bezier curves, badges, hover-reveal `NodeMenu`, all unchanged. Any visual diff at this stage is a Commit-A regression, not layout-related.
- **T-3.4 Layout quality (Commit B)**: build a test project with **10+ commands and 10+ agents**, with some agents referenced by multiple commands and at least one dangling `@mention` (missingAgent node). Confirm:
  - No two node boxes visually overlap (this is the concrete, more-than-eyeballing bar named in the task — cross-reference against T-1.1.5's automated non-overlap check, which catches gross failures; this manual pass catches the "technically non-overlapping but ugly/cramped" case the unit test can't).
  - Edge crossings are visibly reduced vs. a mental model of the old naive `i*80` two-column stack (dagre's layered algorithm should produce fewer crossing lines for a graph with reused agents).
  - `missingAgent` (dashed/warning) nodes are laid out sensibly relative to the commands that reference them, not stacked arbitrarily far away.
- **T-3.5 Interactivity regression pass** (per STATE's acceptance criteria — "byte-for-byte behavior preserved"):
  - Connect-drag from a command's source handle to an agent's target handle succeeds and persists (existing `onConnect`/`isValidConnection` logic).
  - Attempting an invalid connection (agent→agent, self-loop, command→command) is rejected live (handle refuses to connect / no edge created).
  - Hover a node: it and its direct edges/neighbors stay full-opacity, everything else dims to ~35%.
  - Right-click empty canvas opens the pane context menu (add node / fit view) at the cursor position.
  - Click an edge: the +/× toolbar appears and stays pinned (`selectedEdgeId`); the × removes the link with the existing confirm/toast flow.
  - Add a new command/agent via the drawer: the new node renders with the transient "just added" accent ring that auto-fades (~1.6s) — confirm this still fires correctly even though the whole graph re-lays-out around the new node (PLAN §4.2's accepted trade-off — the ring should still track the correct node even as siblings shift).
  - `nodesDraggable` remains `false` — attempting to drag a node with the mouse does not move it (manual click-drag-release, confirm no position change persists).
- **T-3.6 Mission-mode overlay regression pass** (run-engine P1, `graph-execution-realtime`): start a run from a command's node menu; confirm participant nodes/edges stay full-opacity + glow ring (color keyed to `runStatus`), non-participants dim to 35%, and all authoring interactions (drag-connect, edge toolbar, context menu, delete) are disabled while the run is active. This is the highest-risk regression surface since it's the newest/most complex `data`-bag consumer (shipped same day as the research spike, `f65b34b`) — confirm it still works after BOTH commits, not just Commit A.
- **T-3.7 Empty-graph and single-node states**: a brand-new project with zero artifacts renders the empty canvas without error (dagre given empty input, per T-1.1.4); a project with exactly one command and no agents renders that single node without a layout crash.
- **T-3.8 Fit-view**: toolbar's "Fit to view" button and the automatic `fitView` on mount both correctly frame the dagre-computed layout (no nodes clipped outside the visible viewport immediately after load, for both the 2-node and 10+-node test projects from T-3.3/T-3.4).
- **T-3.9 (subjective, explicitly flagged per PLAN §4.2)**: after editing an existing artifact (e.g. renaming a command, or adding a new unrelated command), observe whether existing nodes visibly "jump" to new positions. This is an **accepted trade-off per the PLAN, not a bug to fix in this build** — but record the observation (e.g. a short note in the BUILD/QA STATE section) so a future "stabilize layout" follow-up feature has a documented before/after baseline rather than starting from scratch.

## T-4 Definition of done for this test plan

- T-1.1 (computeLayout unit tests) exist and pass.
- T-1.2 (existing suites) still pass, zero modifications needed to make them pass.
- T-3.1 through T-3.8 manually verified and recorded in the STATE file's QA section; T-3.9 observed and recorded (not gated pass/fail, informational).
- T-2 (new Playwright spec) is a recommended fast-follow, not a blocking gate for this fast-tracked feature — but its absence should be noted explicitly in the QA writeup as an accepted gap, not silently skipped.
