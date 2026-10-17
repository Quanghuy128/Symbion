# free-node-dragging — TEST PLAN

> Companion to `free-node-dragging-STATE.md`'s `## PLAN — Architecture` section. Written by
> `architect` per `/plan`. Maps directly to AC-1..AC-6 from STATE's Acceptance Criteria.
>
> **Explicit framing (per task instructions)**: this graph surface has a recurring, unresolved gap
> — live browser verification has not happened across multiple recent features
> (`self-coded-graph-migration` shipped with zero live QA). This test plan therefore leans as
> heavily as possible on Vitest unit/integration tests that require **no browser at all**, and
> clearly marks the handful of cases that genuinely cannot be verified without one. Do not treat the
> "requires a browser" section as optional filler — it is the ONLY place AC-1/AC-2/AC-5's actual
> pixel/DOM-level behavior is checked, and its absence in prior features is exactly the gap this
> plan is trying not to repeat blindly.

## 1. Unit tests — `packages/core` (Vitest, no DOM/Node/fs dependency)

### 1.1 `parseLayoutOverrideFile` (new, `packages/core/src/graph/layoutOverride.ts`)

File: `packages/core/test/graph/layoutOverride.test.ts`

- **T-2.1.1**: valid `{ schemaVersion: 1, positions: { "id-1": {x:10,y:20} } }` → returns
  `{ "id-1": {x:10,y:20} }` unchanged.
- **T-2.1.2**: `undefined` input → returns `{}` (AC-4 — missing file, since the daemon passes
  `undefined`/absence through to this function when the file doesn't exist).
- **T-2.1.3**: malformed JSON already failed to parse upstream — this function receives the
  **parsed** value; feed it a non-object (`"not an object"`, `42`, `null`, `[]`) → returns `{}` for
  each (AC-4 — corrupt/wrong-shape file).
- **T-2.1.4**: object missing `positions` key entirely → returns `{}`.
- **T-2.1.5**: object with wrong `schemaVersion` (e.g. `2`, `"1"`, missing) → returns `{}` (forward-
  compat: an unknown/future schema is treated as unreadable, not partially trusted).
- **T-2.1.6**: `positions` containing one valid entry and one malformed entry (e.g.
  `{ "good": {x:1,y:2}, "bad": {x:"nope",y:2}, "bad2": {x:1}, "bad3": "not-an-object" }`) → returns
  ONLY `{ "good": {x:1,y:2} }` — the single-bad-entry-doesn't-invalidate-the-file case (AC-4/edge
  case #5, the one that most needs a dedicated test since it's the subtlest branch).
- **T-2.1.7**: entry with `x`/`y` as `NaN`/`Infinity`/`-Infinity` → dropped (not "finite number").
- **T-2.1.8**: entry with extra unexpected keys alongside valid `x`/`y` (e.g. `{x:1,y:2,z:3}`) →
  kept, extra key ignored (forward-tolerant, doesn't punish unknown-but-harmless extra data).
- **T-2.1.9**: empty `positions: {}` → returns `{}` (not an error case — a project that's simply
  never had any node dragged).

### 1.2 `mergeLayoutPositions` (new, same file)

File: `packages/core/test/graph/layoutOverride.test.ts` (same file, second `describe` block)

- **T-2.2.1**: no overrides at all → every node id lands in `unpinnedIds`; `computeDagre` is called
  with the FULL node-id list; result exactly equals whatever the (fake/stub) `computeDagre` returned
  for every id. (Regression guard: today's pre-feature behavior must be exactly reproduced when
  `overrides = {}`.)
- **T-2.2.2**: all node ids have overrides → `computeDagre` is called with an EMPTY array (assert
  via a spy) and is never consulted for any position; every result position equals the override
  verbatim.
- **T-2.2.3**: mixed pinned/unpinned — assert (a) pinned ids' positions in the result exactly equal
  their override values (not touched/transformed), (b) unpinned ids' positions exactly equal
  whatever the stub `computeDagre` returned for them, (c) `computeDagre` is called with ONLY the
  unpinned id list (assert the exact array passed, catching an accidental "pass everyone" bug) —
  this is the single most important test in the whole suite: it's the direct unit-level proof of
  AC-2 ("new node gets dagre position, pinned nodes don't move"), decoupled from any DOM/dagre
  reality.
- **T-2.2.4**: an override key present in `overrides` but ABSENT from `nodeIds` (the STATE-locked
  "deleted artifact, orphaned entry" case) → that key is silently ignored; it does NOT appear in the
  result map at all (result only ever contains entries for ids in `nodeIds`); `computeDagre` is
  unaffected. Direct unit proof of AC-3's "no crash / no corruption" at the merge-logic layer.
- **T-2.2.5**: `computeDagre` returns a `Map` that's MISSING an entry for one of the unpinned ids it
  was asked about (simulating a hypothetical dagre gap) → `mergeLayoutPositions` must not throw;
  document the actual fallback behavior chosen (e.g. `{x:0,y:0}` or omit the id) — whichever
  `mergeLayoutPositions`'s implementation picks, pin the exact behavior with an assertion so a
  future refactor can't silently change it.
- **T-2.2.6**: empty `nodeIds` (no artifacts at all) → returns an empty map; `computeDagre` is called
  with `[]` (or not called at all, whichever the impl chooses — pin the exact contract).
- **T-2.2.7**: determinism — same `nodeIds`/`overrides`/deterministic-stub-`computeDagre` called
  twice produces identical output both times (mirrors `computeLayout.test.ts`'s existing T-1.1.6
  determinism-check pattern).

## 2. Daemon integration tests — `apps/daemon` (Vitest, real tmp-dir filesystem, no browser)

New file: `apps/daemon/test/run-nodeLayout.test.ts` (naming mirrors the existing
`run-listRuns-prune.test.ts` sibling convention already in this directory).

Follow the exact tmp-project-dir setup pattern the existing `run-listRuns-prune.test.ts` /
`runStore.ts` tests already use (real `fs`, a throwaway tmp directory as `projectRoot`, no mocking of
`fs` itself) so this exercises the real `resolveConfinedPath` + `atomicWriteJson` code paths, not
stubs.

- **T-3.1 (happy path, round-trip)**: `getNodeLayout` on a fresh project (no `layout.json` yet)
  returns `{ positions: {} }`. Call `setNodeLayout({projectId, nodeId:"a", position:{x:1,y:2}})`;
  assert the returned `positions` contains `{a:{x:1,y:2}}`. Call `getNodeLayout` again; assert it
  now returns the same entry — proves the file was actually written and re-read, not just held in
  memory (AC-1's server-side half).
- **T-3.2 (upsert, not replace)**: after T-3.1's write, call `setNodeLayout` for a SECOND node id
  `"b"`; assert the returned map contains BOTH `"a"` and `"b"` — proves the write is a read-modify-
  write upsert, not a destructive bulk replace (directly protects AC-2/AC-3: adding one node's
  position must never erase another's).
- **T-3.3 (overwrite same id)**: call `setNodeLayout` twice for the SAME `nodeId` with two different
  positions; assert only the LATEST position survives (last-write-wins for a single key, matching
  STATE's locked no-conflict-resolution decision).
- **T-3.4 (missing file → getNodeLayout)**: on a project directory that has `.symbion/` but no
  `layout.json` file at all, `getNodeLayout` returns `{ positions: {} }` without throwing (AC-4).
- **T-3.5 (corrupt file → getNodeLayout)**: write literal invalid JSON (`"{not valid json"`) directly
  to `.symbion/layout.json` via raw `fs.writeFileSync` (bypassing the daemon, simulating hand-
  corruption or a crash mid-write from a prior version), then call `getNodeLayout` — must return
  `{ positions: {} }}`, never throw (AC-4, the whole-file-corrupt case end-to-end through the real
  handler, not just the pure parser).
- **T-3.6 (corrupt file → setNodeLayout still succeeds)**: same corrupt-file setup as T-3.5, then
  call `setNodeLayout` for a new node id — must succeed and produce a fresh, valid file containing
  ONLY the newly-set entry (proves a corrupt existing file doesn't block future writes — the
  "treated as `{}}` on read" contract applies on the write path's own internal read too).
- **T-3.7 (atomic write / no partial file)**: after a successful `setNodeLayout` call, assert no
  leftover `.symbion-tmp-*` temp file remains in the directory (same convention any other
  `atomicWriteJson` consumer's test would check) — confirms the shared primitive's temp→rename
  behavior is actually exercised, not bypassed.
- **T-3.8 (path confinement)**: call `setNodeLayout`/`getNodeLayout` with a `projectId` that does not
  exist in the global config (`findProjectPath` throws) → the RPC surfaces an error (not a crash,
  not a write to an arbitrary location) — same pattern every other per-project handler's "unknown
  projectId" case already has coverage for elsewhere; add the equivalent here for parity (AC-6).
- **T-3.9 (invalid-params)**: `setNodeLayout` with a missing `nodeId`, or non-finite
  `position.x`/`position.y` (`NaN`, `Infinity`, a string) → throws `RpcError("invalid-params", …)`,
  no file is written (assert the file is untouched / still absent).
- **T-3.10 (never touches other `.symbion/` content)**: seed a project with an existing
  `store.json` and a `runs/` directory (with a fake run.json inside) BEFORE calling `setNodeLayout`;
  after the call, assert both `store.json`'s content and the `runs/` directory's content are
  byte-identical to before — direct proof of AC-6's "does not touch or corrupt any existing
  `.symbion/` content (e.g. `runs/`)".
- **T-3.11 (fresh project, no `.symbion/` dir yet at all)**: call `setNodeLayout` on a project
  whose `.symbion/` directory doesn't exist yet (edge case #8 from the PLAN) — must succeed (mkdir-
  recursive), producing `.symbion/layout.json` with the one entry, no crash.

## 3. Unit tests — `apps/web` gesture-adjacent logic (Vitest + Testing Library, still no real browser)

The existing `useConnectDrag.test.ts` is the precedent for testing these hooks via
`@testing-library/react`'s `renderHook` + simulated DOM events (jsdom), WITHOUT a real browser —
this is a meaningfully different tier than the "genuinely needs a browser" section below, and should
be preferred wherever it's sufficient.

New file: `apps/web/src/components/graph/useNodeDrag.test.ts` (mirrors `useConnectDrag.test.ts`'s
structure).

- **T-4.1**: `startDrag` below the pixel-movement threshold, then `mouseup` at (near-)the same
  point → no `onCommitPosition` callback fires (this was a click, not a drag).
- **T-4.2**: `startDrag`, `mousemove` past the threshold, `mouseup` → `onCommitPosition` fires
  exactly once with the final local (container-relative) coordinates.
- **T-4.3**: `Escape` keydown mid-drag → drag is cancelled, no `onCommitPosition` call, and node
  position reverts to pre-drag (mirrors `useConnectDrag`'s existing Escape-cancel test).
- **T-4.4**: `disabled: true` (authoring-suspended passthrough) → `startDrag` is a no-op, no drag
  state ever enters, mirroring `useConnectDrag`'s `disabled` test.
- **T-4.5**: `daemonConnected: false` at `mouseup` time → local position commit still happens
  (optimistic UI per PLAN §4/edge case #7) but the "persist" callback is NOT invoked (or invoked
  with a flag the caller uses to skip the RPC) — assert the exact contract the hook exposes for this
  distinction.

New/modified: `GraphCanvas.test.ts` (or wherever `NodeConnectBoundary`'s existing behavior is
covered) — add cases for the dispatch-boundary logic in PLAN §6:

- **T-4.6**: simulated `mousedown` with `event.target` inside an element carrying
  `data-handle-role="source"` → only the connect-drag start callback fires, node-drag start callback
  does NOT fire (AC-5, the connect-handle-still-works-unchanged half).
- **T-4.7**: simulated `mousedown` with `event.target` being the plain node body (no
  `data-handle-role`, no `data-no-node-drag`) → only the node-drag start callback fires, connect-
  drag start does NOT fire (AC-5, the node-body-doesn't-trigger-connect half).
- **T-4.8**: simulated `mousedown` with `event.target` inside an element carrying
  `data-no-node-drag` (e.g. the ⋯ menu trigger) → NEITHER callback fires (lets the control's own
  native click/menu-open behavior proceed unobstructed) — this is the companion-change regression
  guard flagged in PLAN §9 item 4.

## 4. `DependencyGraph.tsx` integration-level unit tests (Vitest + Testing Library / jsdom)

If `DependencyGraph.tsx` already has a test file, extend it; otherwise this may need a new
`DependencyGraph.test.tsx` — check existing conventions at `/build` time. Key cases, still no real
browser required (jsdom is sufficient since these only assert on rendered `position` style
values/RPC-call spies, not actual pixel rendering or drag-and-drop event realism):

- **T-5.1**: given a stubbed `getNodeLayout` RPC response with one override, the rendered node for
  that id has its `position` prop equal to the override, NOT a dagre-computed value (mock/spy
  `computeLayout` to return a deliberately different position, and assert the override wins) — this
  is the most direct feasible-without-a-browser proxy for AC-1's "reload shows the dragged
  position."
- **T-5.2**: given the same setup plus a NEW artifact added to `artifacts` (one not present in the
  override map), the new node's position comes from the (stubbed) `computeLayout` output, and the
  overridden node's position is unchanged — proxy for AC-2 at the component-integration level (on
  top of the pure-function-level T-2.2.3 above).
- **T-5.3**: `getNodeLayout` stub rejects / throws → `DependencyGraph` still renders (falls back to
  treating overrides as empty), no unhandled-rejection crash — component-level proxy for AC-4.

## 5. Genuinely requires a real browser (mark explicitly — do not skip silently)

These are the cases that cannot be honestly verified by jsdom/Testing Library alone, because they
depend on real pointer-event sequencing, real layout/geometry, or real page-reload persistence.
**Given this feature's own STATE explicitly flags it as touching daemon RPC + fs-write surface, and
given this graph surface's track record of shipping without live QA, treat this section as
mandatory manual verification at `/qa` time, not optional** — the unit/integration layers above
cover the LOGIC exhaustively, but none of them prove the actual on-screen drag gesture feels right
or that a real page reload round-trips correctly end-to-end through a real running daemon.

- **M-1 (AC-1, end-to-end)**: in a real browser against a real running daemon + real project
  folder, drag a command node to a new spot, reload the page (actual browser F5, not a simulated
  re-render) — confirm the node reappears at the dragged spot, not a dagre-recomputed one.
- **M-2 (AC-2, end-to-end)**: with one node already manually dragged, use the "Add" flow to create a
  brand-new command or agent — confirm the pre-existing dragged node does NOT visibly jump/move, and
  the new node appears somewhere reasonable (dagre-computed, possibly overlapping per PLAN §0's
  flagged risk — note whether an actual overlap is visible, since that's the honest visual-quality
  question office-hours didn't stress-test).
- **M-3 (AC-5, real pointer events)**: confirm with real mouse drags (not simulated DOM events) that
  (a) dragging from a connect-handle still creates a link and does NOT move the node, (b) dragging
  the node body moves it and does NOT create a spurious link, (c) clicking (not dragging) the node
  body still fires its existing click behavior (edit-drawer open / mission-mode filter, depending on
  mode) exactly as before this feature.
- **M-4 (AC-6, spot-check)**: after several drags, manually inspect
  `.symbion/<project>/layout.json` on disk — confirm it's valid JSON, confirm `.symbion/store.json`
  and `.symbion/runs/` are untouched/unchanged (file mtimes / diff against a pre-drag copy).
- **M-5 (companion-control regression, from PLAN §9 item 4)**: manually click the ⋯ menu, Execute
  button, and delete-confirm buttons on a node AFTER this feature ships — confirm none of them
  accidentally trigger a node-drag or get swallowed by the new mousedown-capture boundary.
- **M-6 (visual-collision honesty check, from PLAN §0)**: build up a graph with 5+ nodes, manually
  drag 2-3 of them to deliberately "out of the way" spots, then add several more new
  commands/agents — visually confirm whether dagre's auto-placement for the new nodes collides with
  the pinned ones. This is NOT a pass/fail gate (STATE didn't set a visual-quality acceptance bar),
  but the outcome should be recorded in QA notes so the collision risk flagged in PLAN §0 is
  confirmed/refuted with a real example rather than staying theoretical.

## 6. Explicitly out of scope for this test plan

- Any test of `computeLayout.ts` itself beyond what `computeLayout.test.ts` already covers — PLAN
  §5 makes zero changes to that file/function.
- Any test of a "reset to auto-layout" affordance — doesn't exist (STATE anti-goal).
- Any multi-tab/multi-writer conflict-resolution test — explicitly not implemented (STATE locked
  decision); T-3.3's last-write-wins test is the only coverage needed for that decision, not a gap.

## 7. `setNodeLayout` retry enhancement (2026-07-19)

> Companion to `free-node-dragging-STATE.md`'s `## PLAN — setNodeLayout retry` section. Extends
> the existing `DependencyGraph.test.tsx` (§4 above) — same mocking pattern (`vi.mock` of
> `@/lib/rpc/client`'s `callRpc`, dispatched by `method` string) with `vi.useFakeTimers()` added to
> control the retry backoff deterministically instead of waiting on real `setTimeout` delays.

- **T-7.1 (retry-then-succeed, silent)**: mock `callRpc("setNodeLayout", …)` to reject once then
  resolve on the 2nd call; simulate a drag commit; advance fake timers past the first backoff
  delay (250ms); assert `callRpc` was called exactly twice, `showToast` was NEVER called, and the
  final rendered/reconciled override position equals the 2nd call's returned `positions` map. This
  is the core "silent recovery from a single transient failure" case the whole enhancement exists
  for.
- **T-7.2 (exhausts all attempts, toast shown once)**: mock `callRpc` to reject on all 3 calls;
  simulate a drag commit; advance fake timers past both backoff delays; assert `callRpc` was
  called exactly 3 times (not 2, not 4 — pins the "3 total attempts" contract) and `showToast` was
  called exactly ONCE with the existing "Position not saved — try again." message (not once per
  failed attempt — no toast spam).
- **T-7.3 (daemon disconnects mid-retry, aborts early)**: mock `callRpc` to reject on the 1st call;
  set the store's `daemonConnected` to `false` (simulating disconnect) before advancing timers past
  the first backoff delay; assert `callRpc` was called only ONCE (the retry loop must not attempt a
  2nd call once disconnection is detected) and `showToast` fires promptly (not delayed waiting out
  the full backoff schedule) with the existing failure toast.
- **T-7.4 (same-node supersession — the important case)**: mock `callRpc` so the FIRST commit's
  call rejects on attempt 1 and only resolves (with a stale/older position in its mocked result) on
  a delayed attempt 2; before that retry resolves, simulate a SECOND drag commit for the SAME
  `nodeId` with a different, newer position, whose own `callRpc` call resolves immediately/first.
  Advance timers to let both async chains settle. Assert: (a) the final reconciled override
  position for that node matches the SECOND (newer) commit's result, never the first commit's
  stale result; (b) `showToast` is never called for the first commit's outcome even though it
  eventually resolves after being superseded (no toast, no reconcile from the stale chain); (c) if
  the first commit's superseded call instead REJECTS after being superseded (all 3 of its own
  attempts exhausted), still no toast fires for it — only the second (current) commit's own
  eventual outcome can produce a toast/reconcile. This is the direct test of PLAN §2's token-guard
  mechanism and the task's flagged "genuinely important edge case."
- **T-7.5 (different nodes, independent retry sequences)**: simulate near-simultaneous drag
  commits for two DIFFERENT node ids, each with its own failing-then-succeeding `callRpc` mock
  sequence; assert both nodes' positions eventually reconcile correctly and independently (proves
  the token map is correctly keyed per-`nodeId`, not a single shared counter that would
  accidentally cross-supersede unrelated nodes).
- **T-7.6 (first attempt succeeds, zero regression)**: mock `callRpc` to resolve immediately on the
  1st call; assert `callRpc` was called exactly once (no unnecessary retry-loop overhead/extra
  calls) and the existing pre-enhancement behavior (immediate silent reconcile) is unchanged — a
  regression guard for the common/happy path, which must not slow down or double-call now that a
  retry wrapper sits around it.
- **T-7.7 (`handleNodeDragDaemonDisconnected` unchanged)**: simulate a drag commit via
  `handleNodeDragDaemonDisconnected` (the already-known-disconnected-at-mouseup path) — assert
  `callRpc("setNodeLayout", …)` is NEVER called at all (no retry loop is entered for this path,
  confirming it truly was left untouched) and the existing "Daemon offline…" warning toast still
  fires exactly as before this enhancement.

### Explicitly out of scope for this addendum

- Any test of `retrySetNodeLayout`'s exact backoff timing values (`250`/`750`ms) beyond confirming
  the CORRECT NUMBER of attempts and that retries are staggered (not immediate busy-looping) — the
  literal millisecond values are a tunable default per PLAN §6 item 1, not a locked contract worth
  pinning exactly.
- Any change to or new test of `getNodeLayout`/the daemon-side `setNodeLayout` handler — this
  enhancement is purely client-side; the existing daemon integration tests (§2 above, T-3.1..3.11)
  remain the complete and unchanged coverage for the RPC/filesystem side.
