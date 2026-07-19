# free-node-dragging — STATE

> Feature: allow manual drag-to-reposition of graph nodes (command/agent), with the dragged
> position persisted across reloads — reopening the `nodesDraggable=false` decision that was
> locked twice previously (once under React Flow, once during `self-coded-graph-migration`'s own
> scope-lock). Scope locked via `/office-hours`, 2026-07-18.

## Problem

Symbion's dependency graph currently positions every node via dagre's auto-layout — there is no
way for a user to manually reposition a node, and any such reposition would be lost on the next
render anyway (positions are recomputed from `artifacts` on every relevant change, per the E10
derive-from-artifacts invariant). Users want to be able to drag a node to a preferred position and
have that position "stick" — surviving reloads, not fighting the auto-layout on every edit.

## Scope

### In scope

- **Manual drag-to-reposition** for command/agent/missing-agent nodes on the dependency graph
  canvas (`GraphCanvas`/`GraphNode`, the self-coded renderer shipped in
  `self-coded-graph-migration-STATE.md`).
- **Persisted positions**: once a node is manually dragged, its position is saved and survives a
  page reload / re-opening the project — not just a same-session, in-memory override.
- **Hybrid layout model**: a node that has been manually dragged keeps its manual position on
  subsequent renders, even when new nodes/edges are added elsewhere in the graph. Only genuinely
  **new** nodes (never manually positioned before) get a dagre-computed position. Existing manually
  positioned nodes are never silently re-laid-out by dagre once they have a stored override.
- **Storage location**: manual positions are stored in a **separate file under `.symbion/`**, not
  in the command/agent `.md` frontmatter or body — this is presentation/layout data, not workflow
  content, and must not touch the canonical IR (per CLAUDE.md's "core IR is vendor-agnostic,
  layout is a presentation concern" principle already cited in prior graph-related STATE files).
- **Graceful handling of stale/missing/corrupt position data**: if the position-storage file is
  missing, malformed, or contains a `node-id` that no longer corresponds to an existing artifact
  (e.g. the artifact was deleted), that specific entry is silently ignored and the affected node
  falls back to dagre auto-layout — never a crash, never a blocking error.
- **No conflict resolution for concurrent writers**: last-write-wins if two tabs/sessions
  manually reposition nodes in the same project around the same time — Symbion is a local,
  single-user-per-machine daemon tool; this matches the existing precedent (no other part of
  Symbion implements multi-writer conflict resolution for presentation-only data).

### Out of scope (explicit anti-goals)

- Any change to the canonical IR / command/agent `.md` file format — positions never enter
  frontmatter or body content.
- Multi-user/multi-tab conflict resolution, locking, or broadcast — last-write-wins is the accepted
  behavior, not a gap to fix later.
- A "reset to auto-layout" UI affordance (e.g. a button to clear all manual overrides) — not asked
  for; if wanted later, it's a small, separate follow-up, not part of this feature's acceptance bar.
- Any change to pan/zoom (still out of scope per `self-coded-graph-migration`'s own locked
  decision — this feature does not reopen that separately).
- Any change to how `dagre`/`computeLayout.ts` itself computes positions for nodes that have NEVER
  been manually dragged — the auto-layout algorithm itself is untouched; this feature only adds an
  override layer on top of it.

## Data model

- **New file**: a per-project layout-override file under `.symbion/` (exact filename/schema is
  `/plan`'s job to specify, not locked here) storing `{ [artifactId]: { x: number, y: number } }`
  or equivalent — keyed by artifact ID (stable across renames, unlike artifact name), scoped to a
  single project (consistent with `.symbion/`'s existing per-project scoping for `runs/` etc.).
- **No change to `packages/core`'s Canonical IR** — command/agent `.md` files and their parsed IR
  representation are completely unaffected by this feature.
- **No change to `packages/rpc-types`'s existing artifact CRUD shapes** — this is new,
  layout-specific data, not an extension of `CanonicalArtifact`.

## Edge cases (confirmed via office-hours, do not re-derive)

1. **Node with a manually-saved position gets deleted (artifact removed)**: the corresponding
   layout-override entry becomes orphaned. Per the locked "graceful degradation" decision, this
   should be treated the same as any other stale entry — ignored, not actively cleaned up as part
   of this feature's v1 (a cleanup/pruning pass, if wanted, is a separate future concern, similar to
   how `self-coded-graph-migration`'s STATE treats retention-pruning-style concerns as separable).
2. **New node added to a project that already has manual overrides elsewhere**: the new node gets
   a dagre-computed position (as if the manually-positioned nodes weren't there, OR accounting for
   them as fixed obstacles — `/plan`'s job to decide which is more correct/simpler); existing
   manually-positioned nodes must not move.
3. **Concurrent write (two tabs)**: last-write-wins, no special handling, per the locked decision.
4. **Missing/corrupt layout-override file**: treated as "no overrides exist yet" — falls back
   entirely to dagre auto-layout for every node, no crash, no user-visible error.
5. **A single stale/malformed entry within an otherwise-valid file**: that one entry is ignored
   (falls back to dagre for that node only); the rest of the file's valid entries are still
   honored — a malformed entry must not invalidate the whole file.

## Impact on existing features

- **`computeLayout.ts` / dagre integration**: needs to accept a set of "pinned" positions (the
  manually-dragged nodes) and lay out only the remaining nodes around them — an extension of the
  existing dagre call, not a replacement. Exact mechanism is `/plan`'s job.
- **`GraphCanvas`/`GraphNode`/`useConnectDrag` (self-coded renderer, shipped)**: needs a new
  drag-to-reposition gesture, distinct from the existing connect-drag (drag-from-a-handle-to-link)
  gesture — dragging the NODE BODY itself (not a handle) repositions it; dragging FROM a handle
  still starts a connect-drag. Must not conflict with or accidentally trigger the other gesture.
- **E10 (derive-from-artifacts) invariant**: this feature is the first deliberate, sanctioned
  exception-shaped case — node position becomes derived from `artifacts` PLUS a new layout-override
  data source, not from `artifacts` alone. This must be handled carefully so it doesn't quietly
  reintroduce "mirrored local state that drifts from source of truth" — the override file itself
  IS the source of truth for manually-positioned nodes (not a cache of something else), so this is
  an intentional, bounded extension of E10's spirit (derive from ALL relevant server-side sources,
  never invent client-only state), not a violation. `/plan` should state this explicitly.
- **Daemon RPC surface**: reading/writing the layout-override file is a new filesystem
  read/write path — needs a daemon RPC method (or reuse of an existing generic project-file
  read/write primitive if one exists) since `apps/web` never touches disk directly. This means
  **this feature DOES touch daemon RPC + filesystem-write surface**, unlike `self-coded-graph-migration`
  itself — `/cso` (security review) is very likely required at `/review` time, not skippable via a
  fast-track. Flag this prominently for `/plan` and downstream stages.

## Acceptance criteria (for the Checker to verify)

- **AC-1**: Dragging a node's body to a new position, then reloading the page, shows the node at
  the dragged position (not reset to a dagre-computed one).
- **AC-2**: Adding a new artifact (command or agent) to a project that has existing manually-dragged
  nodes does not move any of the already-positioned nodes — only the new node gets a
  dagre-computed position.
- **AC-3**: Deleting an artifact that had a manually-saved position does not crash the app, does
  not corrupt the layout-override file for other nodes, and the graph continues to render normally
  for all remaining nodes.
- **AC-4**: A missing or syntactically-corrupt layout-override file does not crash the app — the
  graph falls back to full dagre auto-layout, same as today's pre-feature behavior.
- **AC-5**: Dragging a node's body does not accidentally trigger a connect-drag (link-creation)
  gesture, and dragging from a connect handle does not accidentally trigger a node-reposition.
- **AC-6**: The new filesystem read/write path (layout-override file) is path-confined to the
  correct project's `.symbion/` directory, follows Symbion's backup-before-write /
  atomic-temp-then-rename convention for the write side, and does not touch or corrupt any
  existing `.symbion/` content (e.g. `runs/`).

## Suggested next step

`/plan` — architect should specify: the exact layout-override file schema/name, the daemon RPC
method(s) needed to read/write it, how `computeLayout.ts`'s dagre call is extended to treat
manually-positioned nodes as pinned/fixed, and the node-body-drag gesture's interaction with the
existing `useConnectDrag` hook (must not conflict). **Given this feature touches daemon RPC +
filesystem-write surface (unlike the parent migration), `/cso` should very likely run at `/review`
time — do not route this through `/simplify-implementation`'s fast-track.**

## PLAN — Architecture

> Written by `architect` per `/plan`. Read `free-node-dragging-STATE.md`'s Scope/Data
> model/Edge cases/Acceptance criteria above as the locked baseline — not re-litigated here except
> where explicitly flagged as a flaw. Companion file: `free-node-dragging-testplan.md`.

### 0. Flags on the STATE spec itself (read first)

- **The "hybrid layout" decision has a real, unaddressed visual-collision risk.** Pinning a
  manually-dragged node's `(x, y)` forever while dagre freely lays out every *other* node around it
  (see §5 below for the exact mechanism) means: as the graph grows, dagre has **zero awareness** of
  where pinned nodes sit. Dagre's own auto-layout for the *un-pinned* subset can trivially choose
  coordinates that land exactly on top of (or overlapping) a pinned node's box, because pinned nodes
  are invisible to the dagre run that's positioning everyone else. This is not a hypothetical edge
  case — it is close to guaranteed after a few edits to any graph with 2+ manually-positioned nodes,
  because dagre's rank/order assignment for the remaining nodes has no obstacle-avoidance term for
  the pinned set. **This plan proceeds with the STATE-locked design anyway** (re-implementing
  proper obstacle-aware layout is out of scope and no library-level primitive exists for it in
  `@dagrejs/dagre` — see §5), but explicitly documents this as an accepted visual-quality
  trade-off, not a defect to silently fix. `/office-hours` scoped acceptance around *persistence*
  correctness (AC-1..AC-6), not visual quality of the resulting layout — this is worth surfacing to
  the product owner as a known follow-up risk (e.g. "nudge on collision" or "resume dagre for
  everyone on explicit user request" are both out of scope here, per STATE's anti-goals).
- **Edge routing to/from a pinned node is unaffected by pinning** — `computeLayout` only ever
  returns node positions; `GraphCanvas`'s SVG edge layer already computes anchors from whatever
  `position`/`width`/`height` a node object carries (`graphGeometry.ts`), regardless of which
  positioning strategy produced them. No edge-routing change is needed — edges will simply connect
  to wherever the pinned node visually is, straight lines, exactly as today. This is fine
  functionally but reinforces the collision risk above (a straight edge crossing behind/through an
  overlapping pinned node is visually confusing, not a crash).
- **STATE's edge case #2 offers architect a choice** ("dagre computed as if manually-positioned
  nodes weren't there, OR accounting for them as fixed obstacles") — resolved below in §5: dagre
  runs over the **un-pinned subset only**, entirely unaware of pinned nodes (the "as if they weren't
  there" branch). Treating them as true obstacles isn't reasonably achievable with
  `@dagrejs/dagre`'s public API (no obstacle/exclusion-zone primitive exists in `dagre.layout()`);
  simulating one (e.g. inflating `nodesep`/`ranksep` near pinned coordinates) was considered and
  rejected as complexity that still wouldn't guarantee non-overlap, for a feature whose STATE
  explicitly scoped out "reset to auto-layout" UI and any dagre algorithm change.
- **STATE's rename-stability assumption is verified correct**: `CanonicalArtifact.id` (`packages/core/src/ir/types.ts:33`)
  is a server-minted uuid (`randomId()` in `apps/daemon/src/rpc/handlers.ts`), assigned once at
  creation and never regenerated on rename (a rename only changes `.name`, confirmed by reading
  `saveArtifact`'s handler path — `id` is preserved verbatim across every existing artifact-update
  call). Keying the layout-override file by `artifact.id` is safe as designed.
- **A missing edge case worth naming explicitly** (not in STATE's list of 5, found while reading
  `DependencyGraph.tsx`): the **synthetic `missing-<agentName>` node** (id like `missing-foo`, built
  fresh every render in the `useMemo` at DependencyGraph.tsx:616-628, never a real
  `CanonicalArtifact`). If a user drags a missing-agent node, what gets pinned? Decision: **missing-agent
  nodes are draggable and their positions persist** using their synthetic id (`missing-<name>`) as
  the override key — same file, same mechanism, no special-casing needed elsewhere, since the
  override lookup is a flat `Map<string, Position>` keyed by whatever id string a node happens to
  carry (real artifact id or synthetic missing-id, indistinguishable to the merge function). The one
  behavioral wrinkle: if the missing agent is later actually created (STATE's `handleCreateAgent`
  flow), the new real agent gets a **different**, freshly-minted uuid — so the old
  `missing-<name>` override entry becomes orphaned (harmless, per the existing "stale entry ignored"
  graceful-degradation rule) and the new agent node starts fresh at a dagre position, unless the user
  drags it again. This is acceptable and requires no extra code; flagging it so the Checker doesn't
  mistake it for a bug.

### 1. Architecture — files to create/modify

**`packages/core`** (pure — new logic lives here per CLAUDE.md's "core owns render/diff/pure
transforms" rule):

- **NEW** `packages/core/src/graph/layoutOverride.ts`
  - `export interface LayoutOverrideEntry { x: number; y: number }`
  - `export interface LayoutOverrideFile { schemaVersion: 1; positions: Record<string, LayoutOverrideEntry> }`
  - `export function parseLayoutOverrideFile(raw: unknown): Record<string, LayoutOverrideEntry>` —
    pure validation/sanitization: given arbitrary parsed JSON (or `undefined`/malformed), returns a
    clean `Record<string, {x,y}>`, silently dropping any entry that isn't a finite-number `{x,y}`
    pair, dropping the whole thing to `{}` if the top-level shape itself is invalid (not an object,
    wrong `schemaVersion`, missing `positions`). **This is the single function both the daemon
    (reading the file) and any future test call to verify graceful degradation** — centralizing the
    "what counts as a valid entry" rule in `core` instead of duplicating ad hoc validation in the
    daemon handler.
  - `export function mergeLayoutPositions(input: { nodeIds: string[]; overrides: Record<string, LayoutOverrideEntry>; computeDagre: (unpinnedIds: string[]) => Map<string, {x:number;y:number}> }): Map<string, {x:number;y:number}>`
    — the pinned/unpinned split + merge logic (see §5 for exact algorithm), unit-testable without
    dagre or any DOM/React dependency. Takes a `computeDagre` callback (not a hard dependency on
    `@dagrejs/dagre`, which lives in `apps/web`, not `packages/core` — dagre is a web-only
    dependency today per `computeLayout.ts`'s location; core stays pure and framework-position-
    library-agnostic) so this function is trivially unit-tested with a fake/deterministic layout
    callback.
  - Exported from `packages/core/src/index.ts` alongside the existing IR/render/diff exports.

  *Why core, not web:* the pin/merge decision ("is this id pinned, and if not, what set of ids does
  dagre need to lay out") is pure data transformation with no DOM/Node dependency — it belongs in
  core per the "≈80% of correctness lives here as cheap unit tests" principle, exactly like
  `selectPruneTargets` (the run-retention precedent already used by `runStore.ts`'s `prune()`).
  `computeLayout.ts` itself (the actual `@dagrejs/dagre` call) stays in `apps/web` unchanged, per
  STATE's explicit anti-goal ("no change to how computeLayout.ts itself computes positions").

**`apps/daemon`** (the only fs-touching layer):

- **NEW** `apps/daemon/src/store/layoutStore.ts` — follows `runStore.ts`'s established
  read/write/path-confinement pattern exactly (see §3 below for the full read/write contract).
- **MODIFY** `apps/daemon/src/rpc/handlers.ts` — add two handler entries (`getNodeLayout`,
  `setNodeLayout`) to the flat `handlers` object (same convention as `listRuns`/`cancelRun` —
  confirmed the file has no switch statement, `handlers` is dispatched via
  `handlers[method as keyof typeof handlers]` in `server.ts:158`).
- **MODIFY** `apps/daemon/src/rpc/contract.ts` — re-export the two new param/result types from
  `@symbion/rpc-types` (same `export type { ... } from "@symbion/rpc-types"` pattern already used
  for every other RPC shape).

**`packages/rpc-types`**:

- **MODIFY** `packages/rpc-types/src/index.ts` — add `GetNodeLayoutParams`/`GetNodeLayoutResult`,
  `SetNodeLayoutParams`/`SetNodeLayoutResult`, and extend the `RpcMethod` union with
  `"getNodeLayout" | "setNodeLayout"` (see §3 for exact shapes).

**`apps/web`**:

- **MODIFY** `apps/web/src/components/graph/computeLayout.ts` — no signature change to
  `computeLayout` itself (STATE anti-goal); the pin/merge orchestration lives in
  `packages/core`'s `mergeLayoutPositions`, called from `DependencyGraph.tsx`, which passes
  `computeLayout` itself as the `computeDagre` callback for the unpinned subset.
- **MODIFY** `apps/web/src/components/DependencyGraph.tsx` — Phase (b)/(c) of the existing
  `useMemo` (lines ~652-675) changes from "call `computeLayout` over all nodes" to "call
  `mergeLayoutPositions` over all nodes, given the fetched override map." New state: fetch overrides
  once on mount/projectId-change (`getNodeLayout` RPC), keep in a `useState`
  (`Map<string, {x,y}>`), refreshed after every successful drag-persist (optimistic local update, see
  §4). New callback: `handleNodeDragEnd(id, position)` — persists via `setNodeLayout` RPC, then
  updates local override state.
- **NEW** `apps/web/src/components/graph/useNodeDrag.ts` — the node-body-drag gesture hook,
  structurally parallel to `useConnectDrag.ts` (rAF-throttled `mousemove`, `mouseup`-commits,
  `Escape`-cancels), but drives **position updates**, not a connect ghost-edge. See §6 for the
  gesture-conflict resolution with `useConnectDrag`.
- **MODIFY** `apps/web/src/components/graph/GraphCanvas.tsx` — wire `useNodeDrag` alongside
  `useConnectDrag`; the node-body `onMouseDownCapture` boundary (`NodeConnectBoundary`, currently
  connect-drag-only) is renamed/extended to route to one gesture or the other based on drag origin
  (§6).
- **MODIFY** `apps/web/src/components/graph/GraphNode.tsx` — no structural change needed; it
  already receives `position` as a prop from `GraphCanvas`'s `nodes` array, so a locally-tracked
  "currently being dragged" position can be layered in at the `GraphCanvas` render call site
  (ephemeral, same pattern `dragConnect.cursor` already uses) without touching `GraphNode` itself.
  A `data-drag-role="body"` marker attribute is added to `GraphNode`'s root div so the
  mousedown-origin check in §6 can distinguish "node body" from "connect handle" unambiguously.

### 2. Layout-override file schema

- **Filename/location**: `.symbion/<project>/layout.json` — i.e. `join(projectRoot, ".symbion", "layout.json")`,
  a sibling of `store.json` (NOT nested under `runs/`, since this isn't run data; matches
  `store.json`'s existing top-level-under-`.symbion` placement, confirmed via `store.ts:75`
  `projectStorePath`).
- **Shape**:
  ```json
  {
    "schemaVersion": 1,
    "positions": {
      "<artifactId-or-missing-agent-synthetic-id>": { "x": 240, "y": 120 }
    }
  }
  ```
  - Keyed by the SAME id string used in `GraphCanvasNode.id` (real `CanonicalArtifact.id` uuid, or
    a synthetic `missing-<name>` string) — one flat map, no kind-discrimination needed since ids are
    already namespace-disjoint (uuids vs. the literal `missing-` prefix).
  - `x`/`y` are plain finite numbers in the same coordinate space `computeLayout`'s dagre output
    already uses (canvas-local, unitless, top-left-origin) — no transform needed when merging.
  - `schemaVersion: 1` today, following `store.json`'s and `run.json`'s precedent of a
    forward-migration hook even though there's nothing to migrate yet.
- **No `.gitignore` entry needed inside `.symbion/`** — `.symbion/` as a whole is already
  gitignored at the project root in every existing Symbion-managed project (confirmed: only
  `.symbion/runs/` has its own additional self-ignoring `.gitignore`, because runs specifically may
  contain transcript secrets and the *parent* ignore rule's existence isn't verified from
  `runStore.ts` alone — but `layout.json` carries no secret data, so no dedicated ignore file is
  required regardless).

### 3. Daemon RPC surface

Two new methods added to `RpcMethod`, following the exact `params`/`result` naming convention of
`listRuns`/`updateSettings`:

```ts
// packages/rpc-types/src/index.ts
export interface NodeLayoutPosition { x: number; y: number }

export interface GetNodeLayoutParams {
  projectId: string;
}
export interface GetNodeLayoutResult {
  positions: Record<string, NodeLayoutPosition>;
}

export interface SetNodeLayoutParams {
  projectId: string;
  nodeId: string;
  position: NodeLayoutPosition;
}
export interface SetNodeLayoutResult {
  positions: Record<string, NodeLayoutPosition>; // full updated map, so the client
                                                   // never has to locally guess/merge
}
```

- **`getNodeLayout`**: read-only. Called once per project-load (mirrors `listProjects`/`loadProject`
  being called once on mount). Reads `.symbion/<project>/layout.json`; missing/corrupt file (or a
  file whose contents fail `parseLayoutOverrideFile`) returns `{ positions: {} }` — **never throws**
  for a missing/corrupt file (AC-4). A genuine path-confinement violation (shouldn't be reachable
  given `projectId` always maps to a config-registered path, but defense-in-depth per every other
  handler's convention) still throws `RpcError("path-confinement", …)`.
- **`setNodeLayout`**: single-node upsert, not a bulk replace — the daemon reads the current file
  (tolerating corruption the same way `getNodeLayout` does — corrupt existing file is treated as
  `{}`, NOT an error that blocks the write), sets/overwrites the one `nodeId` entry, and
  atomically writes the whole file back. **Last-write-wins is enforced naturally here**: two
  concurrent `setNodeLayout` calls for two DIFFERENT node ids both read-modify-write the same file;
  the second writer's rename simply wins for the file as a whole, but since each call only mutates
  its own key, the only way to actually lose data is two writes to the file racing at the OS level
  (temp-then-rename), which per STATE's explicit "no conflict resolution" scope is accepted as-is
  (this is materially the same one-writer-at-a-time story `store.json` already has for artifact
  saves — no new risk class introduced).
- **Validation**: `setNodeLayout` rejects (throws `RpcError("invalid-params", …)`) if `nodeId` is
  empty, or `position.x`/`position.y` are not finite numbers — mirrors every other handler's
  `typeof p.x !== "..."` guard style (e.g. `listRuns`'s `typeof p.projectId !== "string"` check).
  `nodeId` is NOT validated against the current artifact list server-side (the daemon doesn't need
  to know if an id is "real" — a stale/orphaned id is exactly the accepted edge case #1; validating
  it would require the handler to load+parse the whole project store on every drag-persist, adding
  cost and coupling for no correctness benefit given the graceful-degradation contract already
  covers orphaned entries on read).
- **No `deleteNodeLayout`/bulk-clear method** — correctly out of scope per STATE's anti-goal (no
  "reset to auto-layout" UI); not adding one preemptively.

### 4. Data flow

```
1. Project load (DependencyGraph mounts / projectId changes)
     web: getNodeLayout({projectId}) --RPC--> daemon
     daemon: layoutStore.readLayout(projectRoot)
             -> fs read .symbion/<project>/layout.json
             -> core.parseLayoutOverrideFile(raw) [missing/corrupt -> {}]
             <-- { positions }
     web: setState(overridePositions)   // useState<Map<string, {x,y}>>

2. Every render (existing useMemo, Phase b/c in DependencyGraph.tsx)
     web: core.mergeLayoutPositions({ nodeIds: allNodeIds, overrides: overridePositions,
            computeDagre: (unpinnedIds) => computeLayout(unpinnedDimensions, filteredEdges) })
          -> Map<id, {x,y}>   // pinned ids: override value verbatim
                               // unpinned ids: whatever computeDagre returned for them
     web: laidOutNodes = allNodes.map(n => ({ ...n, position: merged.get(n.id) }))
     -> GraphCanvas renders

3. User drags a node body (mousedown on body, not a handle -> useNodeDrag, see §6)
     web: mousemove -> local ephemeral "beingDragged: {id, position}" state (NOT
          persisted yet, NOT written to overridePositions) -> GraphNode renders at the
          live cursor-following position (same ephemeral-overlay technique
          `dragConnect.cursor` already uses for the ghost connect-edge)
     web: mouseup -> commit:
            (a) optimistic: overridePositions.set(id, finalPosition) locally, immediate re-render
                at the settled position (no visible snap-back waiting on the RPC round-trip)
            (b) fire-and-forget-but-tracked: setNodeLayout({projectId, nodeId: id, position})
                --RPC--> daemon
     daemon: layoutStore.writeLayoutEntry(projectRoot, nodeId, position)
             -> fs read-modify-write .symbion/<project>/layout.json
                (backup-before-write + atomic temp->rename, see §8)
             <-- { positions: <full updated map> }
     web: on RPC success -> reconcile local overridePositions with the server's returned
            full map (defends against a rare read-modify-write race from a second tab,
            per last-write-wins)
          on RPC failure -> showToast("Position not saved — try again.", "error");
            local optimistic position is LEFT AS-IS for this session (does not revert to
            dagre mid-session — reverting would be visually jarring and the position is
            still correct for THIS tab; it simply won't survive a reload, which the toast
            communicates). This is a deliberate simplicity choice: no retry queue, no
            local-storage fallback — matches STATE's "no extra complexity beyond the
            locked scope" spirit.

4. Page reload
     -> step 1 replays; the just-persisted position round-trips from disk, same as any
        other manually-dragged node from a prior session (AC-1).
```

**E10 compliance note** (STATE's own callout, restated concretely): step 2's `mergeLayoutPositions`
sources `overrides` from server state fetched in step 1 — it is not client-invented state. The
`useState<Map>` holding `overridePositions` is a **cache of the override file's content**, refreshed
from the daemon on load and reconciled after every write — structurally identical to how
`nodeRunData`/`timeline` already cache server-derived run state in `useRunStore`. It is not a second
copy of `artifacts`; it's a second, legitimate data source that `mergeLayoutPositions` combines with
`artifacts`-derived node ids, exactly as STATE's "Impact on existing features" section already
concluded.

### 5. `computeLayout.ts` extension / pinned-node mechanism

**Investigated and rejected**: `@dagrejs/dagre` (v3.0.0, confirmed installed) has no public API for
"lay out graph B, but treat these specific nodes as fixed obstacles others must route around."
`g.setNode(id, {x, y, width, height})` lets you PRE-SET a position, but `dagre.layout()`
unconditionally recomputes `x`/`y` for every node during ranking/positioning — pre-set coordinates
are not honored as constraints, they're simply overwritten. There is no `fixed: true` node flag or
equivalent in dagre's graphlib node metadata that the layout engine respects. (This was verified by
reading the currently-vendored `@dagrejs/dagre` version's public surface — `computeLayout.ts`'s own
existing call already only ever reads `g.node(id).x/y` post-layout, never pre-seeds them, which is
consistent with pre-seeding being pointless here.)

**Chosen mechanism — split-and-overlay, entirely in `packages/core`'s `mergeLayoutPositions`, zero
changes to `computeLayout.ts` or the dagre call itself** (satisfies STATE's explicit anti-goal):

```
function mergeLayoutPositions({ nodeIds, overrides, computeDagre }):
  pinnedIds   = nodeIds.filter(id => overrides[id] exists)
  unpinnedIds = nodeIds.filter(id => !overrides[id])
  dagrePositions = computeDagre(unpinnedIds)   // dagre lays out ONLY the unpinned subset
  result = new Map()
  for id of pinnedIds:   result.set(id, overrides[id])
  for id of unpinnedIds: result.set(id, dagrePositions.get(id))
  return result
```

Edges passed to `computeDagre`/`computeLayout` for the unpinned-subset run must ALSO be filtered to
only those whose source AND target are both in `unpinnedIds` (an edge touching a pinned node is
simply omitted from dagre's edge input — dagre never needs to know that edge exists, since it isn't
positioning that endpoint). `DependencyGraph.tsx`'s call site does this filtering when constructing
the `computeDagre` callback passed into `mergeLayoutPositions`.

This directly resolves STATE's edge-case #2 per the "as if manually-positioned nodes weren't there"
reading — confirmed as the only mechanism actually available given dagre's real API surface (§0's
flagged trade-off: this is why collisions between pinned and freshly-dagre-positioned nodes are
possible over time — dagre genuinely has zero information about where pinned nodes sit).

### 6. Node-body-drag vs. connect-drag disambiguation

Both gestures start on `mousedown` somewhere inside a rendered node. The existing
`NodeConnectBoundary` in `GraphCanvas.tsx` (lines 354-373) already distinguishes "did mousedown
originate on `[data-handle-role="source"]`" via `e.target.closest(...)` — **this exact pattern
extends cleanly**:

```tsx
function NodeInteractionBoundary({ onStartConnect, onStartNodeDrag, children }) {
  return (
    <div
      onMouseDownCapture={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-handle-role="source"]')) {
          onStartConnect(e.clientX, e.clientY);   // existing useConnectDrag path, unchanged
          return;
        }
        // anywhere else inside the node body (but not on an interactive leaf
        // control — see exclusion list below) starts a node-reposition drag.
        if (target.closest('[data-no-node-drag]')) return;
        onStartNodeDrag(e.clientX, e.clientY);
      }}
    >
      {children}
    </div>
  );
}
```

- **Mutual exclusion is structural, not timing-based**: the `.closest('[data-handle-role="source"]')`
  check is evaluated FIRST and returns early — a mousedown can never satisfy both branches, so
  `useConnectDrag` and the new `useNodeDrag` can never both be "started" from the same mousedown
  event. This directly satisfies AC-5.
- **New exclusion list** (`data-no-node-drag`): `CommandNode`/`AgentNode`/`MissingAgentNode` already
  render several **interactive leaf controls INSIDE the node body** that must keep their own
  click/mousedown behavior (the ⋯ menu trigger, the Execute button, the delete-confirm's buttons,
  etc. — confirmed present in `DependencyGraph.tsx`'s data bag: `onEdit`/`onDelete`/`onExecute`/
  `onCopyRun` are all wired as click handlers on elements INSIDE these node components). Each such
  control needs a `data-no-node-drag` attribute added (small addition to those three leaf
  components) so a mousedown intended to open the ⋯ menu or click Execute doesn't ALSO kick off a
  node-drag. This is a **necessary companion change** the STATE spec didn't call out explicitly —
  flagging it here so `/build` doesn't miss it (a real, findable regression otherwise: dragging on
  the ⋯ button would move the node instead of opening the menu).
- **Drag-vs-click disambiguation** (a node body click still needs to work for the existing
  `onNodeClick` — e.g. the run-history filter-by-actor click in mission mode, `DependencyGraph.tsx`
  line ~919): `useNodeDrag` only commits to "this was a drag" once total mouse movement since
  mousedown exceeds a small pixel threshold (e.g. 4px — a standard drag-vs-click disambiguation
  threshold, mirrors common UI conventions; no existing precedent in this codebase to match since
  `useConnectDrag` has no equivalent click case to disambiguate against — connect-drag has no
  "click" meaning at all). Below threshold on mouseup, treat as a plain click (fires `onClick`, no
  `setNodeLayout` call, no drag state ever entered) — this ALSO means AC-1's "drag to a new
  position" and the pre-existing plain node click (edit-on-click / mission-mode-filter-on-click)
  coexist without conflict.
- **Suspension**: `useNodeDrag` must respect `authoringSuspended` (mission-active / viewing-history)
  exactly like `useConnectDrag` already does via its `disabled` prop — dragging nodes during a live
  run or history playback is out of scope/would be confusing given the graph is already
  presented as frozen in those modes.

### 7. Edge cases

The 5 STATE-locked cases, restated with the concrete mechanism each maps to:

1. **Deleted artifact with a saved position** → orphaned `layout.json` entry. No active cleanup.
   `mergeLayoutPositions` only ever looks up `overrides[id]` for ids present in the CURRENT
   `nodeIds` list (derived from live `artifacts`) — an orphaned entry for a deleted id is simply
   never read again; it sits inertly in the file (AC-3: no crash, no corruption of other entries,
   since `setNodeLayout`'s read-modify-write only ever touches its OWN key on write, and
   `getNodeLayout`'s read is whole-file but non-destructive).
2. **New node + existing overrides elsewhere** → resolved by §5's split (new node's id is absent
   from `overrides`, so it lands in `unpinnedIds` and gets a dagre position from the
   unpinned-subset-only layout run); pinned nodes are never included in that dagre call at all, so
   they structurally cannot move (AC-2).
3. **Concurrent write (two tabs)** → `setNodeLayout`'s read-modify-write + atomic rename is the
   unit of atomicity; last writer's rename wins for the whole file, no locking, per STATE's locked
   decision. Documented in §3 above.
4. **Missing/corrupt file entirely** → `parseLayoutOverrideFile` (core, unit-tested) returns `{}`
   for any top-level shape failure; `getNodeLayout` never throws for this case (AC-4).
5. **One malformed entry in an otherwise-valid file** → `parseLayoutOverrideFile` validates
   per-entry (`typeof x === "number" && Number.isFinite(x)` etc.) and drops only the bad entry,
   keeping the rest — this is what makes case 5 different from case 4 in the pure function's
   contract, and is exactly what its unit tests target (see testplan).

**New edge cases found while reading the code** (beyond STATE's 5):

6. **Missing-agent synthetic node id drag** — covered in §0; accepted behavior, no special-casing.
7. **Daemon disconnect mid-drag** (analogous to `useConnectDrag`'s existing handling) — `useNodeDrag`
   must check `daemonConnected` the same way `useConnectDrag` does: if the daemon is down when
   `mouseup` fires, the local optimistic position is still applied (harmless UI-only), but
   `setNodeLayout` is skipped entirely (no point firing an RPC that will fail) and a toast informs
   the user the position won't survive a reload until reconnected. This mirrors "daemon disconnect
   mid-edit" from CLAUDE.md's general edge-case checklist, applied here.
8. **`setNodeLayout` called for a project whose `.symbion/` directory doesn't exist yet** (a
   never-before-persisted-anything project) — `layoutStore.writeLayoutEntry` must `mkdirSync(dir,
   {recursive:true})` before the atomic write, same as `writeRunJson`'s existing
   `mkdirSync(dir, {recursive:true})` call in `runStore.ts:76`. Not calling this out would be a
   real first-drag crash on a fresh project.
9. **Drag ends outside the scrollable canvas container** (dragged past the visible/scrolled
   viewport edge) — `useNodeDrag`'s `mousemove`/`mouseup` listeners are bound on `window` (same
   pattern as `useConnectDrag`), so the drag continues tracking correctly even if the cursor leaves
   the container's bounds; position is still computed relative to `containerRef`'s bounding rect via
   the same `toLocalPoint` helper pattern already proven in `useConnectDrag.ts`.

### 8. Security / filesystem-safety plan (for `/cso`)

This section is written so `/cso` can verify each guarantee directly against the code rather than
rediscover conventions from scratch.

- **Path confinement**: `layoutStore.ts`'s `layoutPathAbs(projectRoot)` calls
  `resolveConfinedPath(projectRoot, join(".symbion", "layout.json"))` — the exact same function
  `runStore.ts`/`store.ts` already use (`apps/daemon/src/rpc/guard.ts`). `projectRoot` itself is
  never derived from client input directly — both `getNodeLayout`/`setNodeLayout` take a
  `projectId` (opaque string), resolved server-side via the existing `findProjectPath(projectId)`
  helper (handlers.ts:81-88) which looks it up in the daemon's own `loadGlobalConfig()` project
  registry — a client can never supply an arbitrary filesystem path directly, only a `projectId` the
  daemon already knows about and already trusts for every other RPC (`listRuns`, `saveArtifact`,
  etc.). No new attack surface is introduced here beyond what every existing per-project RPC already
  accepts.
- **`nodeId` is never used to construct a filesystem path** — unlike `runId` (which IS embedded in
  a directory name, hence `runStore.ts`'s `RUNID_RE` regex allowlist gate), `nodeId` here is only
  ever used as a **JSON object key** inside the single, fixed-name `layout.json` file. There is no
  path-injection surface for `nodeId` at all (it never touches `join()`/`resolveConfinedPath`),
  which is a materially SMALLER attack surface than `runStore.ts`'s `runId`-in-path pattern — worth
  `/cso` explicitly confirming this asymmetry is intentional and correct, not an oversight.
- **Atomic write**: `layoutStore.ts`'s write path reuses `atomicWriteJson` from
  `apps/daemon/src/store/store.ts` (the SAME shared primitive `store.ts`'s own docstring says to
  reuse rather than reimplement — "one write-primitive, not two") — mkdir-recursive + temp-file +
  `renameSync`. No new temp-then-rename implementation is introduced.
- **Backup-before-write**: unlike `store.json` (which has no backup-before-write of its own general
  saves — only `safeDeleteProjectStore` backs up before a DESTRUCTIVE delete) and unlike `run.json`
  (which is never user-hand-edited in practice), `layout.json` is a low-stakes, fully-regenerable
  file: **worst-case data loss from an unbacked-up overwrite is "some manually-dragged nodes revert
  to dagre auto-layout"** — annoying, but not data loss of authored content (commands/agents are
  untouched; this file holds zero canonical IR). Given that, and following the precedent that
  `store.json`'s own routine `saveProjectStore` calls (used on every single artifact save) do NOT
  backup-before-write either — only the explicit delete path does — **this plan does NOT add a
  backup-before-write step for every `setNodeLayout` call** (that would mean writing a
  `.symbion/backups/<timestamp>/layout.json` copy on every single node drag, which is disproportionate
  churn for a presentation-only, easily-regenerable file, and CLAUDE.md's backup-before-write rule
  is stated in the context of the PUBLISH pipeline's overwrite of MANAGED, hand-editable target
  files — `layout.json` is neither hand-edited by the user nor part of the publish/managed-marker
  system). **This is a deliberate, named deviation from a literal reading of CLAUDE.md's
  filesystem-safety section, flagged explicitly for `/cso` to confirm or override** — the
  alternative (backup every drag) was rejected as unjustified I/O churn for reversible,
  presentation-only data, but `/cso` may reasonably disagree and require it; if so, the fix is a
  one-line addition (call `atomicWriteJson`'s sibling backup helper before the write, following
  `safeDeleteProjectStore`'s copy-before-mutate pattern) with no architectural change needed.
- **Never touches foreign/unmanaged files**: `layoutStore.ts` only ever opens the single literal
  path `.symbion/layout.json` — no glob, no readdir-and-iterate, no user-supplied filename
  component. Symlink-escape is covered by `resolveConfinedPath`'s existing symlink-realpath check
  (same as every other daemon fs call).
- **No secrets in this file** — plain numeric coordinates only; no chmod/dirMode hardening (like
  `secrets.ts`'s 0600) is warranted, matching `store.json`'s own default-permissions posture.
- **RPC hardening**: both new methods ride the existing localhost-bind + Origin/Host-allowlist
  posture (`server.ts`) — no new session/auth surface is introduced, consistent with every other
  RPC method.

### 9. Trade-offs / assumptions for dev + Checker to track

1. **Accepted visual-quality risk** (§0): pinned nodes can visually collide with dagre-positioned
   nodes as a graph grows. Not fixed in this feature; flagged for a possible future "detect overlap,
   nudge" follow-up, explicitly out of scope here.
2. **No backup-before-write for `layout.json`** (§8) — deliberate deviation from a literal reading
   of CLAUDE.md, justified by the file's low-stakes/fully-regenerable nature. `/cso` should
   explicitly confirm or override this.
3. **Drag-vs-click pixel threshold** (§6) is a new interaction primitive with no prior precedent in
   this codebase (4px chosen as a reasonable default) — `/build` should treat the exact number as a
   tunable, not a locked spec value.
4. **`data-no-node-drag` attribute must be added to every existing interactive leaf control** inside
   `CommandNode`/`AgentNode`/`MissingAgentNode` (§6) — a real, easy-to-miss companion change; the
   Checker should specifically click-test the ⋯ menu / Execute / delete-confirm controls post-drag-
   gesture-implementation (AC-5's spirit, even though STATE's AC-5 wording only mentions the
   connect-handle case explicitly).
5. **Optimistic local position on `setNodeLayout` failure is not reverted** (§4 step 3) — a
   deliberate simplicity choice; if the daemon is down, the drag "feels" like it worked for the rest
   of the session but silently won't survive a reload (communicated via toast only). No retry queue.
6. **`mergeLayoutPositions` lives in `packages/core`, but is a NEW kind of core function** (it
   orchestrates a caller-supplied side-effect-free callback rather than being pure input→output over
   fs/render data like every other core function) — this is a deliberate, narrow exception to keep
   dagre (a web-only dependency) out of `packages/core`'s dependency graph while still unit-testing
   the pin/merge LOGIC in core. The Checker should confirm `packages/core/package.json` gains no new
   dependency on `@dagrejs/dagre` as a result of this file's existence.

## BUILD — implementation notes

> Written by `feature-builder` (Maker) per `/build`. Implements the PLAN section above exactly —
> no scope re-derivation. **Maker does not self-review** — the below is a factual change log +
> an explicit assumptions list for `code-reviewer`/`security-reviewer` (`/cso`) to verify
> independently, not a self-certification that anything "looks good."

### Files changed / created

**`packages/core`** (pure):
- **NEW** `packages/core/src/graph/layoutOverride.ts` — `parseLayoutOverrideFile` +
  `mergeLayoutPositions`, exactly per PLAN §1/§5.
- **NEW** `packages/core/test/graph/layoutOverride.test.ts` — testplan §1.1/§1.2, T-2.1.1..9 +
  T-2.2.1..7 (16 tests, all passing).
- **MODIFY** `packages/core/src/index.ts` — barrel-exports the new module.

**`packages/rpc-types`**:
- **MODIFY** `packages/rpc-types/src/index.ts` — added `NodeLayoutPosition`,
  `GetNodeLayoutParams`/`Result`, `SetNodeLayoutParams`/`Result`, extended `RpcMethod` with
  `"getNodeLayout" | "setNodeLayout"`, per PLAN §3.

**`apps/daemon`**:
- **NEW** `apps/daemon/src/store/layoutStore.ts` — `readLayout`/`writeLayoutEntry`, mirrors
  `runStore.ts`'s path-confinement (`resolveConfinedPath`) + atomic-write (`atomicWriteJson`)
  conventions exactly, per PLAN §2/§3/§8.
- **MODIFY** `apps/daemon/src/rpc/contract.ts` — re-exports the 4 new types + `NodeLayoutPosition`.
- **MODIFY** `apps/daemon/src/rpc/handlers.ts` — added `getNodeLayout`/`setNodeLayout` to the flat
  `handlers` object, with the exact validation PLAN §3 specifies (non-empty `nodeId`, finite
  `x`/`y`; `nodeId` NOT validated against the artifact list).
- **NEW** `apps/daemon/test/run-nodeLayout.test.ts` — testplan §2, T-3.1..3.11 (11 tests, all
  passing), real tmp-dir fs, no mocking — round-trip, upsert-not-replace, overwrite/last-write-wins,
  missing/corrupt file, atomic-write (no leftover temp file), path-confinement (unknown projectId),
  invalid-params (missing nodeId / non-finite x-y), never-touches-other-`.symbion/`-content
  (`store.json`/`runs/` byte-identical before/after), fresh-project-no-`.symbion/`-dir-yet.

**`apps/web`**:
- **NEW** `apps/web/src/components/graph/useNodeDrag.ts` — the node-body-drag-to-reposition
  gesture hook, structurally parallel to `useConnectDrag.ts` (rAF-throttled mousemove, mouseup-
  commits, Escape-cancels). 4px drag-vs-click pixel threshold (tunable, per PLAN §9 item 3).
  Exposes `onCommitPosition` (daemon connected) vs. `onDaemonDisconnectedCommit` (daemon down at
  mouseup — local optimistic position still applied, RPC skipped) as two separate callbacks so the
  caller's contract for edge case #7 is explicit at the type level, not inferred from a boolean flag.
- **NEW** `apps/web/src/components/graph/useNodeDrag.test.ts` — testplan §3, T-4.1..4.5 (5 tests,
  all passing).
- **MODIFY** `apps/web/src/components/graph/GraphCanvas.tsx` — wired `useNodeDrag` alongside
  `useConnectDrag`; renamed `NodeConnectBoundary` → `NodeInteractionBoundary` (PLAN §6's exact
  3-branch dispatch: connect-handle → connect-drag; `[data-no-node-drag]` → neither; else →
  node-drag). Node's rendered `position` is overlaid with the live drag position while
  `nodeDragState.nodeId === n.id` (ephemeral, same technique `dragConnect.cursor` already uses for
  the connect ghost-edge — never written into `nodes`/override state until mouseup commits, E10-
  compliant). Bounding box (`content`) now also folds in the live node-drag position so a
  far-dragged node isn't SVG-clipped, mirroring the existing connect-drag clipping fix.
- **MODIFY** `apps/web/src/components/graph/GraphCanvas.test.tsx` — added T-4.6/T-4.7/T-4.8 (the
  3-way dispatch-boundary tests, testplan §3) alongside the existing 10 tests (13 total, all
  passing).
- **MODIFY** `apps/web/src/components/graph/GraphNode.tsx` — added `isBeingDragged?: boolean` prop
  (cursor: grabbing + elevated z-index while dragged); no structural change otherwise, per PLAN §1.
- **MODIFY** `apps/web/src/components/graph/CommandNode.tsx` — added `data-no-node-drag` to the
  "not linked" chip button (PLAN §6/§9 item 4 companion change).
- **MODIFY** `apps/web/src/components/graph/MissingAgentNode.tsx` — added `data-no-node-drag` to
  the "＋ Create this agent" button (same companion change).
- **MODIFY** `apps/web/src/components/ui/row-menu.tsx` — added `data-no-node-drag` to `RowMenu`'s
  root wrapper `<div>` (covers the ⋯ trigger + every menu item, including Execute/Edit/Copy run
  command/Delete for both `CommandNode` and `AgentNode` in one place, since `NodeMenu` is a thin
  wrapper over the shared `RowMenu` primitive). This is a shared, non-graph-specific UI primitive —
  the attribute is a harmless no-op for RowMenu's other call sites (only ever read by
  `GraphCanvas`'s mousedown-capture boundary).
- **MODIFY** `apps/web/src/components/DependencyGraph.tsx` — new `layoutOverrides` state
  (`useState<Record<string, LayoutOverrideEntry>>`), fetched via `getNodeLayout` in a `useEffect`
  keyed on `projectId` (mirrors the existing `runCount`-refresh effect's cancelled-flag pattern for
  a stale-response guard); `handleNodeDragCommit`/`handleNodeDragDaemonDisconnected` callbacks
  implementing PLAN §4 step 3 exactly (optimistic local set → fire-and-forget `setNodeLayout` →
  reconcile with the server's full returned map on success / toast + leave-as-is on failure).
  Phase (b)/(c) of the big `useMemo` now calls `mergeLayoutPositions` (from `@symbion/core`)
  instead of calling `computeLayout` directly — the `computeDagre` callback passed in filters
  edges to the unpinned subset per PLAN §5, and `computeLayout.ts` itself is completely unchanged.
  Wired `onNodeDragCommit`/`onNodeDragDaemonDisconnected` into the `GraphCanvas` render call site,
  gated by `authoringSuspended` (undefined during a mission/history, matching every other authoring
  callback's existing gating pattern in this file).
- **NEW** `apps/web/src/components/DependencyGraph.test.tsx` — testplan §4, T-5.1/T-5.2/T-5.3 (3
  tests, all passing) — mocks `@/lib/rpc/client`'s `callRpc` (dispatches by `method` string, since
  both this component's `getNodeLayout` call and `useRunStore`'s mount-time `listRuns` call import
  the same function) and `./graph/computeLayout` (returns a deliberately different position than
  any override, so T-5.1 proves the override wins).

### Test/build output confirmation

- `packages/core`: 26 test files, 230 tests passed (includes the new 16-test
  `layoutOverride.test.ts`).
- `apps/daemon`: 37 test files, 408 tests passed (includes the new 11-test
  `run-nodeLayout.test.ts`).
- `apps/web`: 15 test files, 81 tests passed (includes the new `useNodeDrag.test.ts` (5),
  `DependencyGraph.test.tsx` (3), and the 3 new cases added to `GraphCanvas.test.tsx`).
- `npm run test` (repo root, all 3 vitest projects): **78 test files, 719 tests passed**, 0
  failures.
- `npm run build` (repo root — `core` → `rpc-types` → `daemon` → `web`/`next build`): **all 4
  packages built successfully**, Next.js production build compiled + typechecked + generated all
  static pages with zero errors.
- `npx tsc -p apps/web/tsconfig.json --noEmit`: zero NEW type errors introduced (a pre-existing,
  unrelated set of `toBeInTheDocument` matcher-typing errors in 4 test files —
  `DaemonStatusBadge.test.tsx`, `CommandNode.test.tsx`, `GraphCanvas.test.tsx`,
  `CancelControl.test.tsx` — was confirmed present identically on the pre-change tree via
  `git stash`, so it predates and is unrelated to this feature).

### Deviations / things NOT done exactly as PLAN's letter, or deferred

- **NONE of the architecture was re-derived** — every file/RPC method/schema name/algorithm
  matches PLAN §1–§8 exactly (file paths, `layout.json` schema, `getNodeLayout`/`setNodeLayout`
  shapes, the split-and-overlay `mergeLayoutPositions` algorithm, the 3-branch mousedown dispatch).
- **`DependencyGraph.test.tsx` did not exist before this feature** (PLAN's testplan §4 flagged this
  as a "check existing conventions at /build time" open question) — created fresh, following the
  `DaemonStatusBadge.test.tsx` convention of setting real zustand store state directly (no
  `vi.mock` needed for `useArtifactStore`) plus a `vi.mock` of the `@/lib/rpc/client` module
  boundary (needed because `callRpc` makes a real `fetch()` call that would otherwise hit nothing
  in jsdom) and a `vi.mock` of `./graph/computeLayout` (needed to prove T-5.1's "override wins over
  a DELIBERATELY DIFFERENT dagre position", per testplan's own wording). Only T-5.1/T-5.2/T-5.3 were
  written (testplan §4's 3 listed cases) — no additional component-level cases were invented beyond
  what testplan specified.
- **Section 5 of the testplan (M-1..M-6, "genuinely requires a real browser") was NOT executed** —
  this is explicitly out of Maker/`/build`'s scope per the testplan's own framing ("mandatory manual
  verification at `/qa` time, not optional"). Flagging this prominently: AC-1/AC-2/AC-5's real
  pixel/DOM/page-reload behavior has NOT been live-browser-verified by this build pass. The
  unit/integration layers above cover the LOGIC exhaustively (per testplan's stated intent) but the
  testplan itself is explicit that this is not a substitute for M-1..M-6 at `/qa`.
- **`data-no-node-drag` was NOT added to `NodeDeleteConfirm.tsx`'s Cancel/Delete buttons** — verified
  by reading `DependencyGraph.tsx`'s render call site (`confirmTarget && ...` block) that
  `NodeDeleteConfirm` renders as a fixed `absolute right-3 top-3` overlay INSIDE the canvas
  container but OUTSIDE `GraphCanvas`/the per-node `NodeInteractionBoundary` entirely — it is not a
  child of any individual node's DOM subtree, so a mousedown on its buttons can never reach the
  per-node mousedown-capture boundary in the first place. No `data-no-node-drag` is structurally
  needed there; flagging this as an explicit assumption below in case the Checker's own reading of
  the DOM tree differs.

### Assumptions for the Checker to verify independently

1. **Gesture-disambiguation mechanism** (PLAN §6, AC-5): implemented EXACTLY as specified —
   `NodeInteractionBoundary`'s `onMouseDownCapture` checks `.closest('[data-handle-role="source"]')`
   FIRST (returns early → connect-drag only), then `.closest('[data-no-node-drag]')` (returns early →
   neither gesture), and only otherwise calls `onStartNodeDrag`. This is structural mutual exclusion
   (a single mousedown event physically cannot satisfy more than one branch), not a timing/state-
   based heuristic. Verified with real `fireEvent.mouseDown` + `fireEvent(window, "mousemove")` +
   `fireEvent(window, "mouseup")` sequences in `GraphCanvas.test.tsx`'s new T-4.6/T-4.7/T-4.8 (not
   just code-read) — but these are still jsdom `fireEvent`-synthesized events, not real OS-level
   pointer events; genuine real-mouse verification is M-3 in testplan §5, deferred to `/qa`.
2. **The backup-before-write deviation is exactly PLAN §8's stated position, not the Maker's own
   call** — `layoutStore.ts`'s `writeLayoutEntry` does NOT back up `layout.json` before overwriting
   it (no `.symbion/backups/<version>/layout.json` copy, unlike the publish/write pipeline's
   managed-file overwrite path). This was a PRE-EXISTING PLAN decision (§8, §9 item 2), not
   something decided during `/build` — restating it here per the task instructions' explicit
   requirement to flag it prominently, not bury it: **`/cso` must explicitly confirm or override
   this deviation from CLAUDE.md's literal backup-before-write rule.** If `/cso` requires a backup,
   the fix is additive (one call to a backup-then-write helper before `atomicWriteJson`, following
   `safeDeleteProjectStore`'s copy-before-mutate pattern) — no architectural change needed.
3. **The synthetic `missing-<agentName>` node's override when the agent is later actually created**
   — implemented per PLAN §0's exact stated behavior: NO special-casing was added anywhere. A
   dragged `missing-<name>` node persists its override under that literal synthetic id string (the
   daemon's `nodeId` is an opaque string, never validated against a "real artifact" list — see PLAN
   §3's "Validation" paragraph, implemented verbatim in `handlers.ts`'s `setNodeLayout`). When the
   agent is later created via `handleCreateAgent`, it gets a freshly-minted uuid (unrelated to the
   old `missing-<name>` string) and starts at a fresh dagre position; the old entry becomes an
   orphaned-but-harmless entry in `layout.json`, structurally identical to STATE's edge case #1
   (deleted artifact). This is PLAN's own stated resolution, followed precisely — not a Maker
   interpretation filling a gap.
4. **`useNodeDrag`'s position math uses a delta-from-mousedown model** (`base.x + (clientX -
   startClientX)`), NOT `toLocalPoint(clientX, clientY)` directly — i.e. the node's `position` prop
   at drag-start is the anchor, and the cursor's MOVEMENT (not its absolute canvas-local coordinate)
   is added to it. This was necessary because a raw `toLocalPoint(e)` would snap the node's
   top-left corner to the cursor position at drag-start (an unnatural jump, since a user's
   mousedown point is rarely the node's exact top-left corner) — PLAN §6 does not specify the exact
   position-computation formula, only that dragging repositions the node, so this is a Maker-level
   interpretation the Checker should specifically verify feels correct at `/qa` (M-1/M-3).
5. **`useNodeDrag`'s `onCommitPosition`/`onDaemonDisconnectedCommit` two-callback split** (rather
   than PLAN §3's testplan-suggested single callback "invoked with a flag") — this is a Maker-level
   API-shape choice (testplan T-4.5's own wording explicitly allows either: "or invoked with a flag
   the caller uses to skip the RPC — assert the exact contract the hook exposes"). Two separate
   callbacks were chosen for stronger type-level clarity at the `DependencyGraph.tsx` call site
   (impossible to forget to check a flag). The Checker should confirm this satisfies testplan
   T-4.5's intent (it does — verified via the passing test — but the exact shape was a documented
   implementation choice, not dictated by testplan/PLAN).
6. **4px drag-vs-click threshold** (`DRAG_THRESHOLD_PX` in `useNodeDrag.ts`) is exactly the value
   PLAN §6/§9 item 3 suggested as "a reasonable default... a tunable, not a locked spec value" — not
   independently re-derived; flagging per PLAN's own instruction that `/build` should treat it as
   adjustable, not final.
7. **`mergeLayoutPositions` confirmed to add zero new dependency to `packages/core`'s
   `package.json`** — verified: `packages/core/src/graph/layoutOverride.ts` has no imports beyond
   its own file; `packages/core/package.json` is unchanged by this feature (not modified in this
   build pass). The Checker should still independently confirm via `git diff` since PLAN §9 item 6
   specifically flagged this as something to check.
8. **RPC hardening / path-confinement**: `getNodeLayout`/`setNodeLayout` ride the existing
   localhost-bind + Origin/Host-allowlist posture unchanged (no new code added to `server.ts` — the
   flat `handlers[method]` dispatch already covers any new key added to the `handlers` object with
   zero additional wiring, confirmed by reading `server.ts:152-171` before implementing). `nodeId`
   is never used to construct a filesystem path (only ever a JSON object key) — confirmed by
   reading every line of `layoutStore.ts` that touches `nodeId`.
9. **No changes were made to `packages/core/src/run/purity.test.ts`'s scope** (it only walks
   `packages/core/src/run/`, not the new `packages/core/src/graph/` directory) — the new
   `layoutOverride.ts` file has no fs/Node imports regardless (confirmed by reading it), so this is
   a non-issue, but the purity check itself does not structurally cover the new directory; flagging
   in case the Checker wants a similar purity-test extension for `src/graph/` as a follow-up
   (out of this feature's stated scope, not requested by STATE/PLAN).

## REVIEW — round 1 (2026-07-18)

`code-reviewer`, `architect`, and `security-reviewer` all reviewed in parallel (this feature's diff
genuinely touches new daemon RPC handlers and a new filesystem-write path — the `/cso` trigger
condition, per this feature's own scope-lock flag). **All three: PASS.** Two non-blocking findings,
both confirmed real and worth fixing before ship rather than deferred indefinitely.

### 🟡 Target-handle mousedown leaks into node-drag (`code-reviewer`)

`NodeInteractionBoundary`'s gesture dispatch (`GraphCanvas.tsx`) checks for
`.closest('[data-handle-role="source"]')` specifically to route into connect-drag — but a *target*
handle (an agent node's incoming connection dot, `data-handle-role="target"`) doesn't match that
selector and isn't excluded via `data-no-node-drag` either, so a mousedown starting on a target
handle now falls through into node-drag instead of being a no-op. Not a crash, not a violation of
AC-5 (which only requires source-handle-vs-node-drag separation), but a real, surprising UX
regression: dragging from an agent's connection dot will reposition the node rather than doing
nothing. **Fix**: broaden the boundary check to `.closest('[data-handle-role]')` (either role) or
add `data-no-node-drag` to target handles.

### 🟡 `__proto__`-keyed entry mishandling in `parseLayoutOverrideFile` (`security-reviewer`)

A `layout.json` entry keyed literally `"__proto__"` (reachable via a hand-edited file, or via
`setNodeLayout({ nodeId: "__proto__", ... })` since `nodeId` is never validated against a real
artifact list) causes `out["__proto__"] = {x,y}` to reassign the returned object's own prototype
rather than adding a normal key. **Confirmed non-exploitable end-to-end today**:
`mergeLayoutPositions`'s `Object.prototype.hasOwnProperty.call(overrides, id)` guard correctly
prevents this from being usable as a real pinned-node bypass, and it doesn't survive
`writeLayoutEntry`'s spread/`JSON.stringify` round-trip (both only touch own enumerable
properties). Still a latent footgun for any future caller that reads `overrides[id]` without the
same `hasOwnProperty` discipline. **Fix**: build the returned record via `Object.create(null)`
instead of `{}` (removes the prototype to hijack entirely) — a one-line, no-behavior-change fix in
`packages/core`.

### Everything else — confirmed sound by all three Checkers

`computeLayout.ts` genuinely untouched (the pinned/unpinned merge lives entirely in
`layoutOverride.ts`'s pure `mergeLayoutPositions`, matching the plan's own stated approach, not a
Maker deviation). E10 preserved (layout-override data flows through the same derivation `useMemo`
as `artifacts`, no parallel state). RPC surface is purely additive (`getNodeLayout`/`setNodeLayout`
only, `server.ts` untouched — no RPC-hardening regression). Path confinement reuses
`resolveConfinedPath` verbatim; `nodeId` is never used in path construction, only as a JSON key.
Atomic write (`atomicWriteJson`'s temp-then-rename) confirmed to prevent partial-file corruption
under concurrent writers — the failure mode really is just "last write wins," never corruption.
**Backup-before-write deviation explicitly confirmed/accepted by `security-reviewer`**: `layout.json`
holds no canonical IR, AC-4 already mandates graceful fallback to full auto-layout on a
missing/corrupt file, so the worst case of an unbacked-up overwrite is "one dragged position is
lost, node reverts to auto-layout" — never data loss of authored content. `architect` confirmed the
hybrid-layout visual-collision risk (pinned + auto-placed nodes potentially overlapping as a graph
grows) remains genuinely unmitigated, exactly as predicted at `/plan` time, and endorsed leaving it
unmitigated for v1 given the locked scope explicitly excludes visual-quality/collision-avoidance
work. 719/719 tests independently re-confirmed by two of the three Checkers; clean build.

**Aggregate verdict: PASS**, with 2 non-blocking findings routed to a quick fix pass before ship
(both are small, well-scoped, one-line-class fixes — not worth a full `/build` cycle or re-review,
per the same reasoning applied to similarly-small confirmed findings in sibling features this
session).

## Fix pass — both round-1 findings applied (2026-07-18)

Both non-blocking findings were fixed directly (each was a one-line-class change, already fully
diagnosed by its Checker — no ambiguity left to resolve, so no separate `/build`→`/review` cycle):

1. **Target-handle drag leak**: `GraphCanvas.tsx`'s `NodeInteractionBoundary` now checks
   `.closest("[data-handle-role]")` (either role, not just `="source"`) before falling through to
   node-drag — a mousedown on a target/agent handle is now correctly excluded from both gestures,
   matching the pre-existing (source-handle-only) exclusion's intent.
2. **`__proto__`-key footgun**: `layoutOverride.ts`'s `parseLayoutOverrideFile` now builds its
   returned record via `Object.create(null)` instead of a `{}` literal — removes the prototype
   entirely, so a `"__proto__"`-keyed entry can never reassign it via bracket assignment again,
   independent of any caller remembering a `hasOwnProperty` guard.

**Verification**: `npx vitest run` on the two directly-affected test files (29/29 pass), then the
full suite (**719/719 pass, unchanged count** — both fixes are behavior-neutral for every
already-tested case, only closing the two specific gaps found), then `npm run build` (clean,
all 4 workspaces). No new tests were added for these two fixes specifically — the existing
`GraphCanvas.test.tsx` T-4.6/4.7/4.8 and `layoutOverride.test.ts`'s 16 cases already exercise the
surrounding logic; a dedicated regression test for each finding is a reasonable smaller follow-up
if this file/module sees future changes, but wasn't required to close out this review round.

Ready for `/ship`.

## PLAN — setNodeLayout retry (small enhancement, 2026-07-19)

> Scoped enhancement, not new scope. Baseline: the already-shipped `handleNodeDragCommit` in
> `apps/web/src/components/DependencyGraph.tsx` (currently ~lines 304-330, read in full above).
> Discovered via a live `/investigate` session — daemon-side logic and the RPC call itself are
> already verified correct; this closes a known, accepted resilience gap (a single transient
> `setNodeLayout` failure currently loses that drag's persistence permanently until the user
> re-drags). No change to `handleNodeDragDaemonDisconnected` (the disconnected-at-drag-time path)
> — that path is correct as-is and stays untouched per the task's explicit instruction.

### 1. Mechanism — bounded retry with a per-node in-flight token (supersession guard)

Add one small local helper, inline in `DependencyGraph.tsx` (no new file, no new package
dependency — this codebase has no existing retry utility, confirmed via grep; a ~15-line inline
helper is proportionate to the scope):

```ts
async function retrySetNodeLayout(
  fn: () => Promise<SetNodeLayoutResult>,
  attempts: number,
  delaysMs: number[], // e.g. [250, 750] — 2 retries after the initial attempt, 3 tries total
  isStillConnected: () => boolean // polled before each retry; daemon-disconnected short-circuit
): Promise<SetNodeLayoutResult> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLastAttempt = i === attempts - 1;
      if (isLastAttempt || !isStillConnected()) throw err;
      await new Promise((r) => setTimeout(r, delaysMs[i] ?? delaysMs.at(-1) ?? 500));
    }
  }
  throw lastErr;
}
```

- **Attempt count**: 3 total attempts (1 initial + 2 retries) — matches the task's suggested
  2-3 range, small and fixed, not configurable/exposed anywhere.
- **Backoff**: fixed short delays `[250, 750]` ms between attempts (not true exponential — for a
  bounded 2-retry sequence over a localhost RPC, a small fixed/near-fixed stagger is simplest and
  sufficient; exponential backoff is proportionate for many-retry/network-flaky scenarios, which
  this narrow localhost-daemon case is not). This is a tunable default, not a locked spec value —
  same posture PLAN §9 item 3 already took for the 4px drag threshold.
- **Daemon-disconnected short-circuit** (task requirement #2): before starting the retry loop
  (and before each retry attempt), check `daemonConnected` (already read into this component via
  `useArtifactStore((s) => s.daemonConnected)`, confirmed present at line 155 and already in this
  callback's usage elsewhere in the file). If `daemonConnected` is `false` at the time of the
  initial failure or before a scheduled retry fires, **abort the retry loop immediately** (no
  further attempts, go straight to the existing toast) — retrying against a known-disconnected
  daemon is pointless and would just delay the user-visible toast for no benefit. This does NOT
  touch `handleNodeDragDaemonDisconnected` (the separate, already-correct callback for
  "daemon was already known disconnected at mouseup time") — this is a NEW check inside the retry
  loop of `handleNodeDragCommit` only, covering the case where the daemon *becomes* disconnected
  mid-retry-sequence (e.g. it was up at mouseup, then crashed/restarted between attempt 1 and 2).

### 2. Same-node supersession (the one genuinely important edge case — task requirement #4)

**Decision: a newer drag-commit for the same `nodeId` cancels/supersedes an in-flight retry
sequence for a previous drag of that same node.** Rationale: without this, two races are possible
— (a) an in-flight retry for drag #1 could succeed AFTER drag #2 has already optimistically
applied and started persisting its own newer position, and drag #1's stale `setNodeLayout` call
would overwrite drag #2's newer position on disk (the RPC's read-modify-write has no ordering
guarantee across two overlapping calls for the same key); (b) drag #1's retry reconciling
`setLayoutOverrides(result.positions)` on late success could stomp the just-applied optimistic
position for drag #2 in the LOCAL state too, causing a visible snap-back to the older position.
Both are real, user-visible "stale overwrites fresh" bugs given retries can now span up to
~1 second (250+750ms) after the original mouseup — long enough for a fast second drag to land.

**Mechanism**: a `useRef<Map<string, number>>` (module-external `let` counter or a ref-held
per-node generation token — a ref is preferred since it needs no re-render and is a pure
bookkeeping concern, consistent with `dragConnect.cursor`'s existing ref-style ephemeral pattern
in this file):

```ts
const dragCommitTokenRef = useRef(new Map<string, number>());

const handleNodeDragCommit = useCallback(
  (nodeId: string, position: { x: number; y: number }) => {
    setLayoutOverrides((prev) => ({ ...prev, [nodeId]: position })); // optimistic, unchanged

    const myToken = (dragCommitTokenRef.current.get(nodeId) ?? 0) + 1;
    dragCommitTokenRef.current.set(nodeId, myToken);

    void (async () => {
      try {
        const result = await retrySetNodeLayout(
          () => callRpc<SetNodeLayoutParams, SetNodeLayoutResult>("setNodeLayout", { projectId, nodeId, position }),
          3,
          [250, 750],
          () => daemonConnected // polled by the retry helper before each attempt/retry
        );
        // Supersession guard: only reconcile if THIS call is still the latest
        // commit for this nodeId. A superseded (stale) success is silently
        // dropped — the newer drag's own commit owns the final reconciled state.
        if (dragCommitTokenRef.current.get(nodeId) === myToken) {
          setLayoutOverrides(result.positions);
        }
      } catch {
        if (dragCommitTokenRef.current.get(nodeId) === myToken) {
          showToast("Position not saved — try again.", "error");
        }
        // A superseded failure is also silently dropped — the newer drag's
        // own outcome (success or its own failure/toast) is authoritative;
        // showing a toast for an old, superseded drag would be confusing
        // ("position not saved" about a position the user already moved
        // away from).
      }
    })();
  },
  [projectId, showToast, daemonConnected]
);
```

- **Why a token/generation counter, not `AbortController`**: `callRpc`/the underlying `fetch` has
  no existing abort-wiring in this codebase (confirmed: `handleNodeDragCommit`'s current `callRpc`
  call takes no signal), and there is no correctness need to actually cancel the in-flight HTTP
  request — the request can be left to complete or fail on its own; the token only gates whether
  its *result* is allowed to affect local state. This is simpler and smaller than threading an
  `AbortSignal` through `callRpc` for a narrow-scope resilience fix.
- **Only the LATEST commit's outcome is user-visible** (toast or reconcile) — an intermediate
  drag's retry that resolves/rejects after being superseded is fully silent (no toast, no state
  write), per task guidance #3's "silent" framing extended naturally to this case: showing a toast
  about an outdated drag would be confusing, not helpful.
- **Correctness note**: the optimistic `setLayoutOverrides` at the top of the callback is NOT
  gated by the token — the newest drag's optimistic position must always apply immediately
  regardless of any prior in-flight retry, exactly as today. Only the async reconcile/toast at the
  end is gated.
- **`handleNodeDragDaemonDisconnected` is untouched** — it doesn't participate in the token map at
  all; if a node is dragged while already disconnected, no retry sequence is ever started for that
  commit, so there's nothing to supersede. If a LATER drag of the same node succeeds through
  `handleNodeDragCommit` while an earlier disconnected-commit's local optimistic position is still
  showing, the later commit's own optimistic `setLayoutOverrides` call simply overwrites it — no
  new interaction needed, this already works today since `handleNodeDragDaemonDisconnected` never
  touches the token map or starts an async chain to race against.

### 3. UI indication during retry (task consideration #3)

**Decision: silent, per the task's own lean.** No "Saving…" indicator, no spinner, no state
change visible during the retry window. Rationale: this is explicitly a small resilience patch,
not a new UX pattern (task instruction #3); the optimistic position is already showing correctly
the whole time (the drag "looks done" from the user's perspective from the moment of mouseup),
and a transient ~1s retry window resolving silently in the background matches the existing
"optimistic, reconciled quietly on success" behavior already shipped. Only the terminal outcomes
are user-visible: nothing (silent success, including a success on retry #2 or #3) or the existing
toast (all attempts exhausted, or daemon known disconnected mid-retry).

### 4. Files to modify

- **MODIFY** `apps/web/src/components/DependencyGraph.tsx` only:
  - Add the small `retrySetNodeLayout` helper (module-scope function, above the component, or a
    private local function — either is fine; no new file).
  - Add `dragCommitTokenRef` (`useRef(new Map<string, number>())`) near the existing
    `layoutOverrides` state (~line 284).
  - Modify `handleNodeDragCommit` (~lines 304-330) exactly as §2 above. Add `daemonConnected` to
    its dependency array (it's already read into the component; the callback just wasn't
    depending on it before since it never referenced it directly).
  - **No change** to `handleNodeDragDaemonDisconnected` (~lines 332-341) — confirmed out of scope
    by task instruction #2, left byte-for-byte as-is.
  - **No change** to any RPC contract, daemon handler, or `packages/core` — this is purely a
    client-side resilience wrapper around an already-correct RPC call; `setNodeLayout`'s
    idempotent upsert semantics (confirmed in the original PLAN §3/§7: re-setting the same
    `nodeId`/`position` is a harmless no-op overwrite) make client-side retries safe by
    construction — no new idempotency work needed on the daemon side.

### 5. Edge cases (explicit, for the Checker)

1. **First attempt succeeds** — unchanged behavior, no retry loop overhead beyond one extra
   `daemonConnected` check (negligible).
2. **First attempt fails, daemon still connected, second attempt succeeds** — no toast, silent
   success, reconcile happens on attempt 2's result. (New test case.)
3. **All 3 attempts fail, daemon connected throughout** — existing toast shown once, after the
   3rd failure (not once per attempt — no toast spam). (New test case.)
4. **Daemon disconnects between attempt 1 and attempt 2** — retry loop aborts immediately without
   consuming remaining attempts; existing toast shown right away (not after waiting out the full
   backoff schedule) since there's no point waiting once disconnection is known. (New test case.)
5. **Same node dragged again while a retry for the previous drag is still in flight** — the newer
   commit's optimistic position applies immediately; when the OLDER commit's retry eventually
   settles (success or exhausted failure), it is silently dropped (no reconcile, no toast) because
   its token is stale; only the NEWER commit's own eventual outcome (reconcile or toast) is
   user-visible. (New test case — the important one per task instruction #4.)
6. **Different nodes dragged concurrently** — each `nodeId` has its own token entry in the map;
   no interaction/false-supersession between different node ids (map is keyed per-id). (New test
   case, cheap regression guard against an implementation that accidentally uses a single
   non-keyed counter.)
7. **Re-publish/re-drag of the same node to the SAME position it already has** (idempotent
   drag) — no special-casing needed; `setNodeLayout` is already an idempotent upsert per the
   original PLAN, so a retry (or a duplicate commit) writing the same value again is a harmless
   no-op. No new behavior needed here, noted only for completeness against the task's own
   idempotency framing.

### 6. Trade-offs / assumptions for dev + Checker to track

1. **Fixed-delay backoff (`[250, 750]` ms), not true exponential** — a deliberate simplicity
   choice for a narrow localhost-RPC resilience patch; the exact numbers are tunable, not locked.
2. **No `AbortController`/actual request cancellation** — superseded in-flight requests are left
   to run to completion; only their effect on local state is suppressed via the token guard. This
   is simpler and sufficient given `callRpc` has no existing abort-wiring to hook into.
3. **No visible "Saving…" state** — silent-until-terminal-outcome, per task guidance; if a future
   feature wants a subtler in-progress indicator, that's a separate, explicitly-scoped follow-up.
4. **Retry is entirely client-side and requires zero daemon/RPC-contract changes** — safe only
   because `setNodeLayout` was already designed as an idempotent single-key upsert (confirmed in
   the original PLAN §3); if a future RPC method being wrapped in a similar retry were NOT
   idempotent, this pattern would need re-evaluation before reuse.

## BUILD — setNodeLayout retry implementation (2026-07-19)

> Written by `feature-builder` (Maker) per `/build` / `/simplify-implementation` fast-track (review/QA
> intentionally skipped per user decision for this small, client-side-only change, per task
> instructions). Implements the "PLAN — setNodeLayout retry" section above. **Maker does not
> self-review** — factual change log + assumptions list only, for the record.

### Files changed

- **MODIFY** `apps/web/src/components/DependencyGraph.tsx` — the ONLY production file touched,
  exactly as PLAN §4 scoped:
  - Added module-scope `retrySetNodeLayout<T>(fn, attempts, delaysMs, isStillConnected)` helper
    (above the component, near `historyTerminalStatusToRingStatus`) — generic over `T` (not
    hardcoded to `SetNodeLayoutResult`) since that's a strictly narrower, equally-correct typing;
    no behavioral difference from PLAN's sketch.
  - Added `dragCommitTokenRef` (`useRef(new Map<string, number>())`) alongside the existing
    `layoutOverrides` state.
  - Modified `handleNodeDragCommit`: bumps `dragCommitTokenRef` for `nodeId` on every commit
    (before the async chain starts); wraps the `setNodeLayout` call in `retrySetNodeLayout(fn, 3,
    [250, 750], isStillConnected)`; gates BOTH the success-reconcile (`setLayoutOverrides(result.positions)`)
    and the failure-toast on `dragCommitTokenRef.current.get(nodeId) === myToken` (the supersession
    guard) — a stale/superseded outcome (success or failure) is silently dropped, exactly per PLAN §2.
  - **No change** to `handleNodeDragDaemonDisconnected` — confirmed byte-for-byte identical to the
    pre-existing implementation (verified by diffing against the exact text read at the start of
    this build pass); it does not participate in the token map and never triggers a retry chain.
  - **No change** to any RPC contract type, daemon handler, or `packages/core` — confirmed via
    `git status`: only `DependencyGraph.tsx` (production) and a new `DependencyGraph.test.tsx`
    (already existed from the parent feature; extended here) are affected by this build pass.

- **MODIFY** `apps/web/src/components/DependencyGraph.test.tsx` — added a new
  `describe("DependencyGraph — setNodeLayout retry enhancement (testplan §7)")` block (the existing
  testplan §4 `describe` block for T-5.1..T-5.3 is untouched): T-7.1, T-7.2, T-7.3, T-7.4, an
  additional T-7.4b (superseded-commit's eventual FAILURE also silently dropped — testplan §7's
  T-7.4 bullet (c) explicitly calls this out as part of the same case; broken into its own `it()`
  for clarity rather than crammed into one long test), T-7.5, T-7.6, T-7.7 — 8 new tests total.
  - Drag commits are simulated by capturing the real `onNodeDragCommit`/`onNodeDragDaemonDisconnected`
    callbacks that `DependencyGraph` passes to `GraphCanvas` (via a `vi.mock("./graph/GraphCanvas")`
    that wraps-but-still-renders the REAL `GraphCanvas` component with a `forwardRef` shim that
    captures its props) and invoking them directly — not synthesizing real pointer-drag DOM events,
    which is `useNodeDrag.test.ts`/`GraphCanvas.test.tsx`'s job (testplan §3), not this
    component-integration layer's. This matches testplan §7's own stated approach ("extends the
    existing `DependencyGraph.test.tsx`… with `vi.useFakeTimers()`").
  - `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(ms)` drives the 250ms/750ms backoff
    deterministically, per testplan §7's explicit instruction.
  - `showToast` is set to a spy via `useArtifactStore.setState({ showToast: toastSpy })` in
    `beforeEach`, BEFORE each test's render — done this way (rather than swapping it mid-test) so
    the captured drag-commit callback closes over the spy from the start, avoiding a timing
    dependency on an extra re-render to pick up a later store-state swap.

### Deviations from PLAN's literal sketch (found during implementation, both are widenings/fixes needed to satisfy the testplan, not scope changes)

1. **`isStillConnected()` is checked immediately before EVERY attempt (including attempt 0's retries
   after a delay), not only once right after the previous attempt's failure.** PLAN §1's sketch
   only calls `isStillConnected()` inside the `catch` block, right after a failure, before deciding
   whether to schedule the next delay. Read literally, that means a disconnect that happens DURING
   the backoff delay (between attempts) is never observed — the loop would still fire the next
   attempt after the delay elapses, only checking connectivity again after THAT attempt also fails.
   Testplan T-7.3 requires the opposite: "assert `callRpc` was called only ONCE… the retry loop
   must not attempt a 2nd call once disconnection is detected" when disconnection happens during
   the first backoff window. **Fix**: added a connectivity check at the TOP of each loop iteration
   (for `i > 0`, i.e. before every retry attempt, not the very first attempt) in addition to
   keeping PLAN's original check. Functionally this is a strict superset of PLAN's sketch (catches
   a disconnect either right after a failure OR during the subsequent delay) — same "abort early,
   no wasted attempts" intent, just checked at the point that actually matters for T-7.3's
   "disconnects mid-retry" wording. Flagging this prominently since it's a deviation from the
   literal helper code PLAN §1 wrote out, not just an implementation detail — the Checker (if this
   were reviewed) should confirm this doesn't change attempt-count semantics for the "still
   connected the whole time" cases (T-7.1/T-7.2/T-7.4/T-7.5/T-7.6 all still show exactly the
   expected call counts, unaffected).
2. **`isStillConnected` reads the LIVE store value via `useArtifactStore.getState().daemonConnected`
   inside the retry helper's callback, not the `daemonConnected` variable closed over by
   `handleNodeDragCommit` at commit-time.** PLAN §2's code sketch passes `() => daemonConnected`
   (the component-scope variable) directly. That variable is frozen at the value it had when
   `handleNodeDragCommit`'s closure was created for that render — since a retry sequence can span
   up to ~1 second and the daemon can transition mid-sequence, a closed-over value would never
   reflect a disconnect that happens after the commit started (React creates a NEW closure on the
   next render with the updated `daemonConnected`, but the ALREADY-RUNNING async retry chain keeps
   referencing its OLD closure's stale value forever). Reading the live store state via `getState()`
   is a well-established zustand escape hatch for exactly this "read fresh state from inside a
   long-lived callback/effect without needing to be in the reactive dependency chain" case — no new
   subscription, no extra re-render, does not change the component's reactive `daemonConnected`
   read used elsewhere in the file for other purposes (rendering, `disabled` props, etc., all
   untouched). This was required to make T-7.3 pass at all (the closure-captured version made the
   retry loop see the disconnect only ONE render late, i.e. effectively never, since the async
   chain's own closure never re-runs). `daemonConnected` was consequently removed from
   `handleNodeDragCommit`'s `useCallback` dependency array (it's no longer referenced in the
   callback body at all — the live `getState()` read makes it unnecessary there).

### Test/build output confirmation

- `apps/web` full suite: **15 test files, 89 tests passed** (was 81 before this change — 8 new
  tests: T-7.1, T-7.2, T-7.3, T-7.4, T-7.4b, T-7.5, T-7.6, T-7.7; existing `useNodeDrag.test.ts`
  (5), `GraphCanvas.test.tsx` (13, includes the 3 dispatch-boundary cases from the parent feature),
  and `DependencyGraph.test.tsx`'s original T-5.1/5.2/5.3 all still pass unchanged).
- `npm run test` (repo root, all 3 vitest projects): **78 test files, 727 tests passed** (up from
  719 — the 8 new web tests), 0 failures.
- `npm run build` (repo root — `core` → `rpc-types` → `daemon` → `web`/`next build`): **all 4
  packages built successfully**, Next.js production build compiled + typechecked + generated all
  static pages with zero errors.
- No changes to `packages/rpc-types`, `apps/daemon`, or `packages/core` in this build pass —
  confirmed via `git status` showing only `apps/web/src/components/DependencyGraph.tsx` (modified)
  and `apps/web/src/components/DependencyGraph.test.tsx` (extended, pre-existing file from the
  parent feature) touched by this change.

### Assumptions for the record (review/QA intentionally skipped for this pass — flagging instead of self-certifying)

1. **The two deviations above (live `getState()` read + broadened connectivity-check timing) are
   correctness fixes needed to satisfy the testplan's own T-7.3 wording, not scope creep** — no
   other behavior was added beyond PLAN §1/§2/§3. This is the single most important thing for
   anyone auditing this change to independently verify, since it IS a deviation from the literal
   helper code PLAN §1 wrote out.
2. **Fixed backoff delays `[250, 750]` ms and `3` total attempts are exactly PLAN's stated values**
   — not re-derived, per PLAN §6 item 1's own "tunable, not locked" framing.
3. **No `AbortController`/request cancellation was added** — a superseded in-flight `setNodeLayout`
   call is left to run to completion; only its effect on state is suppressed via the token guard,
   exactly per PLAN §2's stated rationale (no existing abort-wiring in `callRpc` to hook into).
4. **The optimistic `setLayoutOverrides` call at the top of `handleNodeDragCommit` remains
   UNGATED by the token** (applies immediately for every commit, latest always wins visually) —
   only the async reconcile/toast at the end is gated, exactly per PLAN §2's "Correctness note".
5. **Toast message text is unchanged** (`"Position not saved — try again."`) — same string as the
   pre-existing (non-retry) failure path; no new toast copy was introduced for this enhancement.
6. **`DependencyGraph.test.tsx`'s new GraphCanvas-wrapping mock technique (`vi.importActual` +
   `forwardRef` prop-capture shim) is a new test technique in this file** — not previously used by
   the existing T-5.1..T-5.3 tests (which relied only on mocking `callRpc`/`computeLayout`, never
   `GraphCanvas` itself). This was necessary because `handleNodeDragCommit`/
   `handleNodeDragDaemonDisconnected` are only reachable via props passed into `GraphCanvas`, and
   there is no other public seam to trigger them without simulating a full real pointer-drag
   sequence (out of this component-integration layer's stated scope per testplan §7's own framing).
   Flagging this as a technique choice for independent verification that it doesn't accidentally
   suppress or alter any of `GraphCanvas`'s OWN real behavior for the T-5.x tests that share this
   file (confirmed: T-5.1/5.2/5.3 still pass unchanged, since the wrapper renders the real
   `GraphCanvas` unmodified — it only sniffs props as a side effect).
7. **T-7.5's mock `setNodeLayout` implementation returns a cumulative "full positions map"
   (`{...serverPositions}`) rather than a single-key result** — this is NOT a production-code
   assumption, it's a test-fidelity note: the REAL daemon's `setNodeLayout` always returns the
   full updated map (PLAN §3, already implemented and tested in `run-nodeLayout.test.ts`'s T-3.2
   upsert-not-replace case), so a test mock returning only the just-changed key for two
   concurrently-dragged different nodes would trigger a FALSE failure in the existing (unchanged,
   pre-existing) "reconcile with the server's full returned map" behavior — not a bug in
   `handleNodeDragCommit`. Worth an independent double-check that this reflects the real daemon
   contract correctly (it does, per the original PLAN §3/§7 already shipped and tested).
8. **Review/QA were intentionally skipped for this pass** per the task's explicit routing through
   `/simplify-implementation`'s fast-track — this BUILD section is a factual log + assumptions
   list only, not a self-certification. A future reviewer should specifically re-check assumption
   #1 above (the two literal-PLAN deviations) against the testplan's exact T-7.3/T-7.4 wording.

## SHIP — deploy notes (2026-07-19)

Shipped via `/simplify-implementation` fast-track (plan → build → ship). Independent `/review`
(code-reviewer + architect) was **intentionally skipped**, per explicit user decision confirmed
before starting — this is a small, purely client-side change (one file touched:
`DependencyGraph.tsx`) with zero changes to RPC contract, daemon handlers, or `packages/core`, so
it doesn't reopen this feature's `/cso` trust boundary (already reviewed and passed in the original
`free-node-dragging` shipment).

**Why this qualifies for the skip**: confirmed via `git diff --stat` — only `DependencyGraph.tsx`
(production) and `DependencyGraph.test.tsx` (tests) changed, both `apps/web`-only, no RPC/daemon/
filesystem-write surface touched. 727/727 tests pass (up from 719, +8 new retry-specific tests),
clean build.

**Residual risk accepted, named explicitly**:
1. **No independent Checker reviewed this diff.** The Maker made two judgment-call deviations from
   the plan's literal sketch (a mid-delay disconnect check, and reading `daemonConnected` live from
   the store rather than a closed-over value) — both are well-reasoned and justified against the
   testplan's own wording, but neither was independently re-verified by a Checker.
2. **The same-node-supersession race (the plan's own "most important edge case")** is covered by a
   unit test (T-7.4/T-7.4b) using synthetic mocked timing, not a live browser exercising real,
   variable network/timer latency — consistent with this feature's established pattern of jsdom
   verification standing in for live browser confirmation.
3. Carried forward, unchanged from the parent feature's own residual risk: this graph surface still
   has no live browser verification at all (testplan M-1..M-6, and now the retry logic's real-world
   timing behavior, remain unexercised outside jsdom).

**Recommendation**: if this retry logic is ever suspected of misbehaving in practice (e.g. a user
reports repeated "Position not saved" toasts even under normal conditions), the two Maker-flagged
deviations (assumption #1) are the first place to look — they were correctness fixes for gaps in
the plan's own sketch, not scope creep, but that also means they weren't independently reviewed by
a second party.

## Done — setNodeLayout retry enhancement

**Shipped 2026-07-19.** A single transient `setNodeLayout` failure no longer permanently loses a
dragged node's position for the session — up to 2 retries with backoff before falling back to the
existing "Position not saved" toast, with same-node drag supersession correctly handled via a
generation-token guard so a stale in-flight retry never clobbers a newer drag's outcome. Originated
from a `/investigate` session that found the underlying RPC/daemon path already correct (no bug),
but surfaced this accepted resilience gap as worth closing.
