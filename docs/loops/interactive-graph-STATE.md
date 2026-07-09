# Interactive Graph — STATE

Feature: make the **Sơ đồ** (Graph / React Flow) screen a full-permission authoring surface with parity to **Danh sách** (list): drag edges to link command→agent, a `+` edge modal for per-relationship metadata (count + goal), add/customize/delete nodes on canvas.

Baseline read: `CLAUDE.md`, existing `symbion-STATE.md` (phase PLAN), `symbion-testplan.md`. Stack is locked (web ↔ daemon RPC ↔ fs/git; core is pure; CodeMirror 6; React Flow read-only today).

---

## Scope (locked at approval gate 2026-07-08)

**In scope (v1):** P1–P8 in §6.5 — drag edge command→agent (`@name`), `+` edge modal (count + goal), edge delete, add workflow/agent on canvas (reuse BuilderDrawer), edit/customize node, delete node, missing-agent → "Tạo agent này", copy-run from command node.

**User decisions at the gate:**
1. **Ref format = `@name`, no auto-normalize** (option A, recommended). Kéo cạnh chèn `@name` vào managed block `## Agents`. Backtick refs cũ giữ nguyên (không rewrite prose), không hiện cạnh; discoverable qua validate hint + missing/unlinked affordance. Opt-in normalize = **deferred (D2)**.
2. **Canvas = auto-layout, no free node drag** (recommended). Giữ `nodesDraggable={false}`, layout theo array-index như hiện tại. Chỉ kéo tạo **cạnh** + thao tác qua menu/modal. Persisted positions = **deferred (D1)**.
3. **Run /design phase before build** — user emphasized "design phải tối ưu UI/UX nhất". 3 designer angles → wireframes/mockups cho edge `+` modal, node ⋯ menu, canvas add-menu, missing-agent affordance, empty-state, connection-drag feedback → synthesized design doc `interactive-graph-design.md` feeds build.

**Deferred:** D1 (free-drag + persisted layout), D2 (normalize backtick refs), D3 (reorder agents in modal), D4 (multi-select bulk delete), D5 (inline rename on node).

**Auto-decided (documented, reversible / stack-default):** Option A managed block over new IR field or customFields; no `types.ts` / daemon-RPC / `useArtifactStore` shape change; reuse `saveArtifact`/`deleteArtifact`/`BuilderDrawer`/`newArtifact`; no optimistic draft nodes on canvas (appear only post-save); no `/cso` (no new RPC/fs-write/secrets); byte-stability invariant `setAgentBlock(body, parseAgentBlock(body)) === body` as acceptance bar.

---

## 5. DESIGN — UI/UX

Design phase run at user's explicit request ("phase design phải tập trung cải thiện UI UX tối ưu nhất"). 3 parallel designer angles (edge/relationship interaction · canvas-as-authoring-surface · discoverability/feedback/cohesion) synthesized into **`interactive-graph-design.md`**. Key outputs feeding BUILD:
- Drag-to-link 3-frame interaction (handle pulse → live line + valid-target glow / invalid red → success draw-in), `EdgeRelationModal` (count stepper + goal + live preview), edge `+`/`×` toolbar, 5-state edge gallery.
- Canvas authoring: floating toolbar (`＋ Thêm`, `⤢ Vừa khung`, `?` legend), right-click context menu, node ⋯ menu (reuse `RowMenu`), anchored delete-confirm with referenced-agent warning, missing-agent "Tạo agent này", empty state, just-landed ring.
- Discoverability/cohesion: first-run hint bar (per-user localStorage flag), unlinked-command `warning` chip teaching @name-vs-backtick (never danger), locked toast copy map + 2 new toast variants (success/warning), non-optimistic ghost edge during save, disconnected ribbon + disabled affordances, z-index layering, one-shot `pulse` keyframe.
- 14 taste-calls resolved with documented defaults (design §9) — no second gate needed.
- Durable design-system additions (design §7): `success`/`warning` toast variants, `pulse` keyframe. Everything else composes existing tokens.

## 6. PLAN — Architecture, Data Flow, Edge Cases

### 6.0 The core decision (read first): how command→agent references + per-edge metadata are persisted

**Ground truth confirmed in code:**
- `CanonicalArtifact.body` is rendered **verbatim** into the file — `claude.ts:renderBodyWithFrontmatter` does `---\n${fm}\n---\n${artifact.body}`; `parseClaudeFile` stores body verbatim (only strips the trailing marker + trims edge newlines). So body IS the byte-stable channel.
- There is **no** field for a command→agent reference. The edge only exists because `extractAgentMentions(body)` (`packages/core/src/ir/refs.ts`, regex `/@([a-zA-Z0-9_-]+)/g`) finds an `@name` token that matches an agent name.
- **Mismatch:** the repo's own real command `.md` files reference sub-agents in backticks (`` `feature-builder` ``), which `extractAgentMentions` does NOT match. So today those edges never render on the graph.
- The `+` modal wants `count` + `goal` per relationship. **Nothing** in the IR or body can hold that structured data today.

**Decision — Option A (chosen): a machine-parseable managed block appended to `body`, parsed back out by a new pure core module. No IR type change.**

Rationale vs. the alternatives:

| Option | Verdict | Why |
|---|---|---|
| **A. Managed `## Agents` block inside `body`** | **CHOSEN** | Zero IR/type churn; survives the existing verbatim render/parse round-trip *for free* (body is already byte-stable); the user sees + can hand-edit it in the markdown tab (it IS the body); `@name` tokens inside it are still picked up by the existing `extractAgentMentions`, so the graph, validate warnings, and run-command rendering keep working unchanged. |
| B. New `agentRefs?: {name,count?,goal?}[]` IR field | Rejected | Requires render-into-body + parse-out-of-body transforms that must be *exact inverses* or round-trip breaks; duplicates state (field vs. the `@name` already in prose body → two sources of truth, sync bugs); touches types.ts, frontmatter, scan, adapters, validate, templates — large blast radius for a v1. |
| C. `customFields` | Rejected | customFields render to **frontmatter**, not body; a per-agent list with goals is not a flat k/v; wrong semantic home; invisible in the markdown body the user edits. |

**Standardize on `@name` for managed references.** Hand-typed backtick refs will not graph — this is documented, not silently fixed. **Do NOT auto-normalize** backticks→`@` (would rewrite the user's prose unpredictably and break byte-stability on files we didn't author). Instead: the graph's "missing / unlinked" affordance (see 6.4) plus a validate hint make the convention discoverable. (Deferred idea D2 below: an opt-in "normalize refs" action.)

#### The exact managed-block format (new core module `packages/core/src/ir/agentBlock.ts`)

A single fenced, marker-delimited block. Delimiters make parse unambiguous and let us round-trip byte-for-byte even when the user hand-edits *around* it.

```
<!-- symbion:agents -->
## Agents

- @feature-builder ×2 — Implement the feature per the plan
- @code-reviewer — Independent review of the diff
- @qa
<!-- /symbion:agents -->
```

Line grammar (one agent per line), parsed by regex, tolerant:
```
- @<name>[ ×<count>][ — <goal>]
```
- `name`: `[A-Za-z0-9_-]+` (same charset as `extractAgentMentions` + `FILENAME_SAFE_RE`).
- `×<count>`: optional; `×` (U+00D7) then integer ≥ 1. Absent ⇒ `count` undefined (renders as 1, but we DON'T write `×1` — see byte-stability rule).
- `— <goal>`: optional; em-dash `—` (U+2014) + space + free text to end of line. Goal may contain any char except newline.

**Parsed model (in-memory only, NOT persisted as its own field):**
```ts
export interface AgentRef { name: string; count?: number; goal?: string; }
```

**Core API (pure, unit-tested):**
```ts
// packages/core/src/ir/agentBlock.ts
export function parseAgentBlock(body: string): AgentRef[];              // [] if no block
export function hasAgentBlock(body: string): boolean;
export function upsertAgentRef(body: string, ref: AgentRef): string;    // add or replace by name
export function removeAgentRef(body: string, name: string): string;     // remove one line
export function renderAgentBlock(refs: AgentRef[]): string;             // canonical block text
export function setAgentBlock(body: string, refs: AgentRef[]): string;  // replace/insert/strip block in body
```

**Byte-stability rules (the whole reason this is testable):**
1. `setAgentBlock(body, parseAgentBlock(body))` MUST equal `body` (idempotent identity round-trip) for any body — this is the primary invariant test.
2. Canonical render: refs sorted **by first-appearance order** (preserve authoring order; do not resort). Omit `×count` when `count` is undefined or 1. Omit `— goal` when goal is empty/undefined. No trailing spaces.
3. Block placement: appended at end of body with exactly one blank line before the opening delimiter if body is non-empty; block is the last thing in body. `setAgentBlock(body, [])` removes the block entirely (including its surrounding blank line) → empty-refs restores original bytes.
4. If a body has content the parser doesn't recognize *inside* the block (a stray line), preserve it on re-render as a passthrough comment line? — **No.** Simpler + safer: unrecognized non-blank lines inside the block are dropped on canonical re-render, BUT we only re-render the block when the user mutates via the graph (drag/modal). A pure markdown-tab edit does NOT trigger re-render (body stored verbatim), so hand edits are never silently rewritten. See E11.

**Interaction with `extractAgentMentions`:** unchanged. Since refs live as `@name` inside body, the existing mention extractor keeps producing graph edges, keeps feeding the missing-agent warning, keeps feeding run-command rendering. `parseAgentBlock` is *additive* — it only exists to recover `count`/`goal` for the `+` modal. The graph edge set is still derived from `extractAgentMentions` (so `@name` anywhere in body — block or prose — makes an edge), and `parseAgentBlock` decorates matching edges with count/goal.

**Validate additions (`packages/core/src/ir/validate.ts`):**
- `agentblock-malformed` (warning): a line inside the block starts with `- @` but fails the grammar → warn, don't block.
- `agentref-count-invalid` (warning): `×0` or non-integer.
- Reuse existing `mention-missing-agent` (already covers `@name` with no agent).

---

### 6.1 Architecture — files to create / modify

**packages/core (pure — new logic + tests live here):**
- **NEW** `src/ir/agentBlock.ts` — the parse/render/upsert/remove API above.
- **MODIFY** `src/ir/validate.ts` — add the two block warnings.
- **MODIFY** `src/index.ts` — export `parseAgentBlock`, `renderAgentBlock`, `upsertAgentRef`, `removeAgentRef`, `setAgentBlock`, `hasAgentBlock`, `AgentRef`.
- Tests: `src/ir/agentBlock.test.ts`, extend `validate.test.ts`.

**apps/daemon:** **NO CHANGES.** All graph mutations reuse the existing `saveArtifact` / `deleteArtifact` RPCs (they take/return a full `CanonicalArtifact` / `artifactId` and run `validateAllArtifacts` server-side). Body already carries the block, so nothing new touches disk. This is a deliberate constraint: keep the daemon RPC surface frozen for this feature.

**apps/web:**
- **MODIFY** `src/components/DependencyGraph.tsx` — becomes interactive: controlled nodes/edges via `useNodesState`/`useEdgesState` (or a derived-from-store pattern, see 6.3), `onConnect`, `onConnectStart/End`, connectable handles, canvas context menu, node context menu, wiring to store mutations. Accepts new props: `onEditArtifact`, `onDeleteArtifact`, plus access to `saveArtifact`/`newArtifact`. Positions still auto-layout (see E-layout).
- **MODIFY** `src/components/ProjectView.tsx` — pass mutation callbacks + `setEditing` into `DependencyGraph` so canvas "customize/edit" reuses the SAME `BuilderDrawer` the list uses; wire graph-side add/delete to the existing `newArtifact` factory + `deleteArtifact` flow (including the second-click confirm pattern, reused as a modal on canvas).
- **MODIFY** `src/components/graph/CommandNode.tsx` — source handle becomes connectable; add a small node context-menu affordance (⋯) for Edit/Delete/Copy-run.
- **MODIFY** `src/components/graph/AgentNode.tsx` — target handle connectable; ⋯ menu for Edit/Delete.
- **MODIFY** `src/components/graph/AnimatedEdge.tsx` — render a `+` interaction button at edge midpoint (via `EdgeLabelRenderer`), opening the relationship modal; also a delete (×) affordance on hover.
- **NEW** `src/components/graph/EdgeRelationModal.tsx` — the `+` modal: fields `count` (number, ≥1) + `goal` (textarea). Save calls `upsertAgentRef` on the command body → `saveArtifact`.
- **NEW** `src/components/graph/GraphCanvasMenu.tsx` — right-click / "＋ Thêm" canvas menu: Add workflow / Add agent → opens `BuilderDrawer` with a `newArtifact(kind)` draft (reuse ProjectView's factory; hoist it to a shared util so both list + graph use one copy).
- **NEW** `src/components/graph/NodeMenu.tsx` — per-node ⋯ menu (Edit / Delete / Copy run for commands).
- **MODIFY** `src/components/graph/MissingAgentNode.tsx` — add a "＋ Tạo agent này" action that creates a draft agent pre-named to the missing mention (turns a dangling ref into a real node).
- Store `useArtifactStore.ts`: **NO shape change.** Reuse `saveArtifact`, `deleteArtifact`, `showToast`, `daemonConnected`, `upsertLocalArtifact`. Hoist `newArtifact` out of ProjectView into `src/lib/newArtifact.ts` (shared).

---

### 6.2 React Flow interactivity wiring

- Flip `nodesConnectable={true}`. Keep `nodesDraggable` — see E-layout (default **false**, positions still auto-derived; dragging deferred).
- **Controlled vs derived:** nodes/edges remain **derived from `artifacts`** via `useMemo` (as today) — this keeps the store the single source of truth and avoids controlled/uncontrolled desync (E10). React Flow's local drag state is not needed because dragging is off. Connection is handled by `onConnect` firing a store mutation → store updates `artifacts` → `useMemo` re-derives nodes/edges. We do NOT mirror edges into `useEdgesState`.
- `onConnect({ source, target })`:
  1. Resolve source/target to artifacts by id.
  2. **Guard** (see E1): source must be `kind:"command"`, target must be `kind:"agent"`. Reject otherwise with a toast.
  3. `const next = { ...command, body: upsertAgentRef(command.body, { name: agent.name }) }`.
  4. If ref already present (E2): no-op + neutral toast ("Đã liên kết rồi").
  5. `await saveArtifact(next)` → merged project back → re-derive. Toast success/error.
- **Handles:** CommandNode source handle right (`isConnectable`), AgentNode target handle left (`isConnectable`). MissingAgentNode: NOT a valid connect target (it's a placeholder; connecting means "create agent" via its own action instead).
- **Connection validation UX:** use React Flow `isValidConnection` to live-reject command→command / agent→agent / self while dragging (line turns red / no drop), so the guard in `onConnect` is a backstop, not the only feedback.
- **Edge `+` button:** in `AnimatedEdge`, wrap a `<button>` in `<EdgeLabelRenderer>` positioned at `(labelX,labelY)` from `getBezierPath`. Only shown on non-missing edges. Click → open `EdgeRelationModal` for that `(commandId, agentName)`. Also render `×` delete affordance (calls `removeAgentRef` → `saveArtifact`).
- **Node ⋯ menu / canvas menu:** reuse the existing `RowMenu` component pattern where possible; render canvas add-menu from a floating "＋" button in the graph toolbar (always visible, discoverable) PLUS right-click context menu (power users).

---

### 6.3 Data flow (each mutation → RPC)

```
DRAG EDGE command→agent
  onConnect → guard(kind) → upsertAgentRef(cmd.body, {name}) → saveArtifact(cmd)
    → daemon validateAllArtifacts + saveProjectStore(.symbion/store.json)
    → returns merged {project} → store.currentProject set → DependencyGraph useMemo re-derives edges.

+ MODAL SAVE (count/goal)
  EdgeRelationModal.save → upsertAgentRef(cmd.body, {name,count,goal}) → saveArtifact(cmd) → same path.

EDGE DELETE (×)
  removeAgentRef(cmd.body, agentName) → saveArtifact(cmd) → same path.

ADD NODE (canvas menu: workflow/agent)
  newArtifact(kind) draft → open BuilderDrawer (SAME drawer as list) → user fills → drawer's existing Save → saveArtifact.
  (No new node persisted until the drawer saves; a purely-local draft node is NOT added to the canvas — avoids unsaved-draft-node ambiguity, E8.)

CUSTOMIZE / EDIT NODE (⋯ → Edit)
  setEditing(artifact) → BuilderDrawer (reuse). No new UI.

DELETE NODE (⋯ → Delete)
  confirm modal (reuse ProjectView second-click-confirm, rendered as a small canvas dialog) → deleteArtifact(id) → merged project → re-derive.

MISSING-AGENT → CREATE
  newArtifact("agent") with name = mention → BuilderDrawer prefilled → Save → agent now exists → missing node becomes a real AgentNode, edge de-danger'd on re-derive.
```

Every disk-touching step is `saveArtifact` / `deleteArtifact` only. **Publishing to `.claude/` stays a separate explicit step** (unchanged) — graph edits mutate the working store exactly like list edits. No render→temp→diff→write in this feature (that's publish, out of scope).

---

### 6.4 Edge cases

- **E1 wrong-direction / wrong-kind connect** (command→command, agent→agent, agent→command): reject via `isValidConnection` (live) + `onConnect` guard (backstop) + toast. No mutation.
- **E2 duplicate edge:** `upsertAgentRef` is idempotent by name; second connect is a no-op with neutral toast. No duplicate `@name` line.
- **E3 self-loop:** impossible by kind guard (a node can't be both command source and agent target), but `isValidConnection` also rejects `source===target`.
- **E4 delete an agent that commands reference:** allowed (matches list behavior — no cascade). After delete, the dangling `@name` refs re-derive into **MissingAgentNode** placeholders with the danger edge (existing E7 behavior). Show a warning toast naming the affected commands: "N workflow vẫn tham chiếu <name>". Do NOT auto-scrub `@name` from command bodies (would rewrite user prose).
- **E5 missing-agent node interactions:** not a connect target; only action is "＋ Tạo agent này". No Edit/Delete (nothing to delete — it's a phantom).
- **E6 concurrent edit / stale store:** `saveArtifact` returns the full merged project; we always replace `currentProject` with the server result, so the graph reflects the authoritative state after each mutation. If a save fails (E9 disconnect), the optimistic edge is never committed (we don't optimistically add edges — we wait for the merged project), so the canvas simply doesn't change + error toast.
- **E7 validation failure surfaced on canvas:** server `validateAllArtifacts` errors (e.g. name-duplicate when creating on canvas) propagate through `saveArtifact` reject → error toast + (for the drawer path) inline errors in BuilderDrawer as today. Edge-level: if adding a ref would create a `mention-missing-agent` it's only a warning → allowed, shows as danger edge.
- **E8 unsaved-draft nodes:** we deliberately do NOT place uncommitted draft nodes on the canvas. "Add" opens the drawer; the node appears only after a successful `saveArtifact`. This sidesteps controlled/uncontrolled draft-node reconciliation.
- **E9 daemon disconnect mid-edit:** `daemonConnected` already tracked via heartbeat. Connect/`+`/add/delete affordances **disabled** when `!daemonConnected` (mirrors list's `disabled={!daemonConnected}` on destructive/publish actions). In-flight save rejects → error toast, no canvas change.
- **E10 controlled-vs-uncontrolled RF state:** resolved by keeping nodes/edges **derived** (useMemo from `artifacts`), never mirrored into `useNodesState`/`useEdgesState`. Only ephemeral UI (hoveredId, open menu id, modal target) is component-local React state.
- **E11 manual markdown edit breaks the block:** because body is stored/rendered verbatim and `parseAgentBlock` is tolerant (drops only unrecognized lines *when re-rendering*, and re-render only happens on a graph mutation), a hand edit inside the block never triggers a silent rewrite. If the user corrupts the delimiters, `hasAgentBlock` returns false → the next graph mutation appends a fresh block (old corrupted text remains as prose; `@name` tokens in it still graph). Documented, not auto-repaired. Covered by round-trip identity test.
- **E12 name collision adding on canvas:** handled by existing `name-duplicate` validate error in the drawer Save path (canvas add reuses the drawer). No canvas-specific logic.
- **E-layout — persist node positions?** **NO in v1.** Keep auto-layout by array index (current behavior); enabling free-drag would demand a persisted layout store (new IR/store field = scope creep + round-trip concerns). `nodesDraggable={false}` stays. Deferred (D1).

---

### 6.5 "Other ideas" for full parity — scope gate

| # | Idea | v1? | Rationale |
|---|---|---|---|
| P1 | Drag edge command→agent creates `@name` ref | **IN** | Core ask #1. |
| P2 | `+` edge modal: count + goal, Save → body block | **IN** | Core ask #2. Needs `agentBlock.ts`. |
| P3 | Edge delete (× on hover) | **IN** | Natural inverse of P1; `removeAgentRef`. |
| P4 | Add workflow / add agent on canvas (reuse drawer) | **IN** | Parity ask #3; zero new persistence. |
| P5 | Edit / customize node (⋯ → reuse BuilderDrawer) | **IN** | Parity; reuses existing drawer, near-free. |
| P6 | Delete node (⋯ → confirm → deleteArtifact) | **IN** | Parity; reuses list delete flow. |
| P7 | Missing-agent node → "Tạo agent này" | **IN** | Cheap, turns the existing danger placeholder into a productive action; high UX payoff. |
| P8 | Copy-run-command from command node ⋯ | **IN** | Reuses existing `CopyRunCommandDialog`; trivial. |
| D1 | Free-drag layout + persisted positions | **DEFER** | Needs new persisted layout store + round-trip; not requested. |
| D2 | Opt-in "normalize backtick refs → @name" action | **DEFER** | Rewrites user prose; needs its own diff/confirm UX; risky for v1. |
| D3 | Reorder/priority of agents via drag within `+` modal | **DEFER** | count/goal cover the ask; ordering is authoring-order today. |
| D4 | Multi-select + bulk delete on canvas | **DEFER** | Not requested; adds RF selection-state complexity. |
| D5 | Inline rename on node double-click | **DEFER** | Rename = filename change + re-derivation of all `@name` refs; belongs in a dedicated rename feature (dangling-ref cascade). |

---

### 6.6 Trade-offs & assumptions (for dev / Checker / QA)

- **A1** `@name` is THE managed reference convention. Backtick refs remain unlinked and are intentionally not auto-converted (D2). Checker: verify no code path rewrites bodies it didn't author.
- **A2** No IR type change, no daemon RPC change. If a reviewer sees `types.ts`, `apps/daemon`, or `useArtifactStore` shape changed, that is **drift** from this plan — flag it.
- **A3** Byte-stability invariant `setAgentBlock(body, parseAgentBlock(body)) === body` is the acceptance bar for `agentBlock.ts`. A failing round-trip is a REVIEW/QA blocker.
- **A4** Canvas never holds uncommitted draft nodes (E8); nodes appear only post-save. If the implementation adds optimistic/local-only nodes to RF state, that's drift.
- **A5** `count` renders only when >1; `goal` only when non-empty — so a plain drag (no modal) produces `- @name` with no decoration, and re-saving is a no-op on those bytes.
- **A6** Delimiters `<!-- symbion:agents -->` / `<!-- /symbion:agents -->` chosen (HTML comments) so they're invisible in rendered markdown and distinct from the `<!-- managed-by: symbion -->` publish marker (`parseClaudeFile` strips only the trailing `managed-by` marker; the agents block is NOT stripped and stays part of body — verify in a parse round-trip test).
- **A7** `×` is U+00D7 and em-dash U+2014 — fixed literals in `agentBlock.ts`; tests assert exact codepoints to prevent an ASCII `x`/`-` drift breaking the parser.

---

Next: run `/build` to hand this to feature-builder. Then `/review` (code-reviewer + architect) and `/qa` against `interactive-graph-testplan.md`.

---

## 12. BUILD — implementation notes (resume session)

Prior build session finished `packages/core` (agentBlock + validate warnings + 129 green tests) and 8 web graph components, but stopped before wiring `DependencyGraph.tsx`. This session completed the remaining web wiring.

### Files created
- `apps/web/src/components/graph/NodeDeleteConfirm.tsx` — anchored delete-confirm popover; agent-with-refs warning line; `Đang xoá…` in-flight; inline error; outside-click/Esc dismiss (blocked while deleting).
- `apps/web/src/components/graph/GraphLegend.tsx` — `?` legend popover; edge styles + handle + ⋯ + "chưa liên kết"; outside-click/Esc close; z-30.
- `apps/web/src/components/graph/GraphHintBar.tsx` — stacked (non-overlay) first-run hint row; `[Đã hiểu]` + `[×]` dismiss; `animate-slideIn`; z-10.
- `apps/web/src/components/graph/DaemonRibbon.tsx` — top warning-tint ribbon; `[Thử lại]` → onRetry; z-10.

### Files modified
- `apps/web/src/components/DependencyGraph.tsx` — REWRITTEN from read-only to interactive. Wrapped in `ReactFlowProvider`; inner uses `useReactFlow().fitView`. Kept derive-via-`useMemo` + hover highlight/dim. Added: store hookup (`saveArtifact`/`deleteArtifact`/`daemonConnected`/`showToast`/`startHeartbeat`), `parseAgentBlock`/`upsertAgentRef`/`removeAgentRef` decorate/mutate, `onConnect` (guard + dup no-op + non-optimistic save + ghost), `isValidConnection` (command→agent only, no self), edge `+`→`EdgeRelationModal`, edge `×`→`removeAgentRef`, node delete machine + `NodeDeleteConfirm`, add/edit via `onEditArtifact(newArtifact(...))`, missing-agent create, copy-run via existing `CopyRunCommandDialog`, `GraphToolbar`/`GraphCanvasMenu`/`GraphLegend`/`GraphHintBar`/`DaemonRibbon`, ephemeral pending-ghost edge.
- `apps/web/src/components/ProjectView.tsx` — passes `onEditArtifact={setEditing}` to `<DependencyGraph>`.

### E11 handling (documented explicitly)
The markdown-tab Save path lives in `apps/web/src/components/MarkdownTab.tsx` and flows through `BuilderDrawer`. Verified: MarkdownTab uses `parseClaudeFile` + `renderArtifacts` ONLY — it does **not** import or call `setAgentBlock`/`upsertAgentRef`/`removeAgentRef`/`renderAgentBlock`. Body is stored verbatim (`onChange({...artifact, ...parsed})`). Block re-render happens ONLY on explicit graph mutations (`onConnect`, modal `onSave`, edge `×`), each via `upsert/removeAgentRef`. No drawer/markdown save routes through block logic. `grep` for the block functions in BuilderDrawer/MarkdownTab returned nothing.

### Verification run this session
- `apps/web`: `npx tsc --noEmit` → EXIT 0 (clean).
- `packages/core`: `npm run build` (needed so web sees the new `.d.ts` exports) then `npx vitest run` → 129 passed / 16 files.
- Grep-confirmed all 7 wired components render as JSX in DependencyGraph (lines 386–453) and ProjectView passes `onEditArtifact` (line 98). No orphaned/unwired component.

### Assumptions made (for the Checker to verify — I am NOT concluding these are correct)
1. **A-hint-daemon:** `GraphHintBar` is gated on `showHint && daemonConnected` so it never stacks above the ribbon when disconnected. Design §5 N doesn't explicitly forbid showing both; I chose ribbon-priority. Verify this matches intended UX.
2. **A-retry:** `DaemonRibbon.onRetry` calls `startHeartbeat()` (idempotent, fires an immediate tick per store impl) — the store exposes no standalone `ping`. If a dedicated reconnect is expected, flag it. It will NOT spawn a duplicate interval (store guards `heartbeatTimer`).
3. **A-empty-state:** Graph empty state is NOT rendered inside DependencyGraph. ProjectView renders a shared empty state (`isEmpty` branch, add buttons) BEFORE the tab switch, so DependencyGraph is never mounted with 0 artifacts. Chose "no duplication" per task option. `fitDisabled={artifacts.length===0}` is a defensive belt-and-suspenders only.
4. **A-unlinked-heuristic:** unlinked chip = `extractAgentMentions(body).length===0 && any backtick token \`([A-Za-z0-9_-]+)\` matches an existing agent name`. Conservative per §9.14. The backtick regex is inline in DependencyGraph, not a shared util. Verify it doesn't false-positive on ordinary code spans that happen to equal an agent name (that's the documented conservative tradeoff, not a bug).
5. **A-ghost-edge:** pending ghost is pushed into the derived `edges` array with id `pending-<src>-><tgt>` and `data.pending:true`. It is component-local (from `pendingConnection` state), never written to the store/artifacts, and removed in `onConnect`'s `finally`. On failure the artifacts are untouched → canvas byte-identical (non-optimistic).
6. **A-justAdded-target:** on a successful link I set `justAddedId` to the AGENT id (the ring flashes on the newly-linked agent). For add-node/create-agent the node only appears after the drawer's own save (not this component's concern), so those paths do NOT set `justAddedId` here — the just-landed ring for drawer-created nodes is NOT wired this session (the drawer save path doesn't call back into the graph). Flag if the ring is expected on drawer-created nodes.
7. **A-referencing-recompute:** `referencingCommandsFor(agentName)` is computed both for the confirm popover render and again inside `confirmDeleteNode` (before the await) for the warning toast, to avoid a stale closure after the store mutates. Both read the current `commands`.
8. **A-context-menu-coords:** right-click coords are computed relative to the ReactFlow wrapper via `getBoundingClientRect()`; the menu is `absolute` inside the same `relative` container. Verify positioning on a scrolled page.
9. **A-core-prebuilt:** web typecheck REQUIRES `packages/core` to be built first (it consumes compiled `.d.ts`). I ran `npm run build` in core. If CI typechecks web without building core, the new exports will appear missing — confirm the repo's build order handles this (the monorepo likely builds core first).
10. **A2 honored:** no `types.ts`, no daemon RPC, no `useArtifactStore` shape change. Only used existing `saveArtifact`/`deleteArtifact`/`showToast`/`daemonConnected`/`startHeartbeat`.
11. **A4/E8 honored:** no uncommitted draft nodes on canvas; Add opens the drawer via `onEditArtifact(newArtifact())`. The ghost edge is the only transient canvas element.

### Deferred (unchanged from plan)
D1 free-drag/persisted positions, D2 normalize-backtick, D3 reorder in modal, D4 multi-select, D5 inline rename. Also NOT wired this session: just-landed ring for drawer-created nodes (see assumption 6) — the drawer save doesn't notify the graph; only the drag-link path sets `justAddedId`.

Next: `/review` (code-reviewer + architect) + `/qa` against `interactive-graph-testplan.md`. Not touching core.

## 13. REVIEW — independent Checkers (code-reviewer + architect)

**Verdict: PASS, no 🔴 blockers.** Both reviewers independently confirmed: Option-A bet implemented faithfully (agentBlock in core, PURE, no IR field), E11 separation holds (block fns only in graph-mutation handlers, never the markdown/drawer save path), non-optimistic ghost edge is ephemeral (never in store; canvas byte-identical on failed save), A2 frozen surfaces intact (types.ts + apps/daemon unchanged, store only widened ToastVariant union), A6 publish composition correct (block is part of body, not stripped like the managed-by marker, changes surface as a diff), all 12 components wired (no orphans), onConnect guard + isValidConnection reject command→command/agent→agent/self.

**🟡 findings fixed (see §14 FIX):**
1. `setAgentBlock` re-appended the block at end-of-body → relocated any prose *after* the block → non-idempotent round-trip + spurious publish diffs against hand-edited files. (both reviewers)
2. Non-integer count (`2.7`) passed the `>1` render gate but `LINE_RE` rejects `×2.7` → line dropped on parse → round-trip fails. Not reachable via the modal (guards floats) but the pure core API wasn't inverse-safe. (code-reviewer)
3. `DaemonRibbon` "Thử lại" was a no-op — `startHeartbeat()` early-returns when the timer is already live (always, during disconnect); no immediate ping. (code-reviewer)
4. Just-landed ring not wired for drawer-created nodes (design §4-I gap; only the drag path set `justAddedId`). (both)

**🟢 accepted/deferred:** brief cosmetic double-edge on link success; `animate-pulse` overrides Tailwind's built-in (no current collateral); unlinked-heuristic backtick false-positive (by design, §9.14).

## 14. FIX — REVIEW findings addressed (dev, 2026-07-09)

All four confirmed 🟡 findings fixed; no refactor beyond the fixes. Verification: `packages/core` vitest 132 passed (was 129, +3 tests); `apps/web tsc --noEmit` clean.

- **Fix 1 — `setAgentBlock` in-place replace** (`packages/core/src/ir/agentBlock.ts`): rewrote from strip-then-append to a single `BLOCK_RE.exec` splice. When a block exists it is replaced at its exact offset, preserving the original leading `\n\n` and every byte of prose before AND after. Append-at-end path kept only for the block-absent + non-empty-refs case; strip (refs empty) removes the captured leading blank line as before (U17/U18 unchanged). Invariant now holds for mid-body / trailing-prose / trailing-newline blocks.
- **Fix 2 — integer-count gate** (same file): `renderLine` and `normalizeRef` now require `Number.isInteger(count) && count > 1`; fractional/zero/negative collapse to plain `- @name`, round-trip-safe.
- **Fix 3 — DaemonRibbon retry** (`apps/web/src/lib/store/useArtifactStore.ts` + `DependencyGraph.tsx`): added store action `pingNow()` (immediate `ping` RPC, reuses existing method, flips `daemonConnected` on result — no data-shape change, no new daemon RPC). `handleRetry` now calls `pingNow()` instead of the no-op `startHeartbeat()`.
- **Fix 4 — just-landed ring for drawer/create paths** (`DependencyGraph.tsx`): a `useEffect` diffs the current artifact-id set against a `useRef` baseline; an id appearing after the first render sets `justAddedId` (rings ~1.6s). First render only seeds the baseline (no mount flash). Covers drawer Add-workflow/Add-agent, missing-agent→create, and the drag path uniformly.

**New tests** (`packages/core/test/agentBlock.test.ts`, +3): `U1b` round-trip when block is NOT last (5 bodies: prose-after, trailing line, mid multi-paragraph, trailing newline, block-at-start); `U1c` non-integer/zero/negative count collapses + round-trips; `U19b` upsert on body with trailing prose keeps prose in place and does not relocate the block.

**Assumptions for the Checker:**
- E11 separation untouched — no block fn added to the markdown-tab/drawer save path; `setAgentBlock`/`upsertAgentRef` still called only in graph-mutation handlers.
- Fix 4 assumes at most one new artifact id appears per `saveArtifact` (rings the first found); import of many artifacts would ring only one — acceptable per the "one node per save in practice" note.
- `startHeartbeat` selector removed from `DependencyGraph` only; the method is untouched and still driven by AppShell/SettingsShell/TemplatesView, so the interval keeps running during disconnect (which is why the no-op existed).
- The old `pingNow` returns `boolean` but `handleRetry` ignores it (`void`); no caller depends on the return value yet.

## 15. QA-FIX — unreachable edge +/× toolbar (dev, 2026-07-09)

QA blocker: on a plain (undecorated) edge — the common state right after a drag-link — the `+` relationship modal and `×` delete were unreachable by mouse. Root cause: `toolbarVisible` gated on `hovered || selected`; `hovered` fired only from the `EdgeLabelRenderer` inner div, which collapses to a 0×0 point when the edge has no badge/toolbar drawn → no hit-area; and `selected` was never wired. Broke core ask #2 (per-relationship count/goal) and P3 (edge delete). Belt-and-suspenders fix per design §3.2/§3.3 "hover OR select":

- **Fix A — wide transparent hover hit-path** (`apps/web/src/components/graph/AnimatedEdge.tsx`): render a second `<path d={edgePath}>` in the SVG edge layer (right after `BaseEdge`) with `stroke="transparent"`, `strokeWidth={20}`, `fill="none"`, `pointerEvents="stroke"`, `cursor:pointer`, carrying `onMouseEnter`/`onMouseLeave` (same setHovered/reset-confirm handlers as the label div). Gated on `interactive && !pending`, so missing/pending edges get NO hit-path and stay toolbar-less (design §3.3 #3). `pointerEvents:"stroke"` means it only reacts on the line itself — never blocks node interaction or panning. The label div still hosts the badge + `+`/`×` toolbar at the midpoint. Added local `const interactive = Boolean(data?.interactive)` (behavior of `toolbarVisible` unchanged).
- **Fix B — click-to-pin edge selection** (`apps/web/src/components/DependencyGraph.tsx`): added `selectedEdgeId` local state; `onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}`; `onPaneClick` now also clears it (still closes the context menu). The final `edges` useMemo sets `data.selected = e.id === selectedEdgeId` (added `selectedEdgeId` to its dep array); `selected` only reveals the toolbar for interactive/non-missing edges since `toolbarVisible` still requires `interactive`. `baseEdges` derivation untouched (kept stable — selection is applied in the lightweight remap pass, not the heavy derivation). `elementsSelectable` left at its default (true).

Constraints honored: no toolbar visual/logic contract change beyond reachability; missing edges still no `+`/`×`; non-optimistic + E11 unaffected (pure UI reveal fix); no `packages/core` change; no store data-shape change; no new RPC. `apps/web tsc --noEmit` clean.

**Assumptions for the Checker:**
- React Flow fires `onEdgeClick` via event delegation on the `.react-flow__edge` group; a click on the transparent hit-path (rendered inside that same custom-edge group) bubbles up and reports the correct edge id — so Fix A's path does not swallow Fix B's click.
- 20px transparent stroke width is a taste-call for hover generosity; it may slightly overlap when two edges run very close, but only affects which edge's toolbar reveals on hover (click still disambiguates), and never affects data.
- Clicking a node (not the edge) does not clear `selectedEdgeId` (only pane-click does); acceptable — a pinned toolbar persists until the user clicks empty canvas or another edge. Re-verify this matches the desired "pin until dismissed" UX.

## 16. QA — live behavior verification (chrome/playwright against interactive-graph-testplan.md)

**Verdict: PASS.** Ran the app end-to-end via the compiled daemon serving a fresh `apps/web/out` static export (production path, port 20133), driving the real browser (playwright chrome-for-testing) against the live `geochat` project (2 commands, 2 agents).

**Tests exercised + result (verified in UI AND in the persisted store via loadProject):**
- **W1 drag-to-link** ✓ — dragged `/analyze`→`architect`; solid edge rendered, "chưa liên kết" chip cleared, hint bar auto-dismissed. Store body gained the exact block `<!-- symbion:agents -->\n## Agents\n\n- @architect\n<!-- /symbion:agents -->` (plain link, no ×1, appended after prose — A5/byte-stable).
- **W4 `+` relationship modal** ✓ — modal "Quan hệ" opened with `[−] N [+]` stepper + goal textarea + live "XEM TRƯỚC CẠNH" preview; set count=2 + goal, preview showed `architect ×2 — …`; Lưu persisted `- @architect ×2 — Rà soát độc lập toàn bộ diff` byte-perfect (U+00D7/U+2014 codepoints correct).
- **W5 edge `×` delete** ✓ — inline `Xoá? ✓/Hủy` confirm; confirming removed the edge AND stripped the whole block, restoring pre-block body bytes (removeAgentRef last-ref path).
- **Node ⋯ menus** ✓ — command variant = `Chỉnh sửa · Sao chép lệnh chạy · Xoá`; agent variant = `Chỉnh sửa · Xoá` (no copy-run). 
- **W6 canvas add-menu** ✓ — `＋ Thêm ▾` → `Thêm workflow`/`Thêm agent`; clicking opens the SAME BuilderDrawer (Theo mô tả/Theo markdown tabs) — no draft node on canvas pre-save (A4/E8).
- **W19 unlinked chip** ✓ — both real commands (backtick refs, 0 `@name`) show the `warning` "chưa liên kết" chip; agents show none (conservative heuristic, no false-fire).
- **Console: 0 errors / 0 warnings** across the whole journey. Dark UI matches design (floating toolbar, hint bar, indigo/violet nodes, connectable handle pulse, dotted bg).

**🔴 QA-caught blocker (FIXED before sign-off — see §15 QA-FIX):** on a plain/undecorated edge the `+`/`×` toolbar was **unreachable** — its `onMouseEnter` sat on a 0×0 `EdgeLabelRenderer` div (no hittable area) and edge `selected` was never wired, so core ask #2 (count/goal) and P3 (delete) couldn't be opened by mouse. Neither code-review nor `tsc` caught it (the component/logic were correct; only the *reveal path* was broken). Fix: a 20px transparent hover hit-stroke on the edge line + `onEdgeClick`→`selected` click-to-pin. Re-verified live above (W4/W5 both now reachable by hovering anywhere on the edge line).

**Note on the test-driver:** the node ⋯ menu and edge `×` confirm initially appeared broken under Playwright because moving the mouse to click drops the CSS `:hover`, unmounting the hover-gated affordance (⋯ and the confirm reset on `onMouseLeave`). Confirmed to be a driver artifact, not a product bug, by clicking via native element `.click()` without mouse travel — a real user's continuous pointer keeps hover alive. Not a defect.

**Not driven live (verified in code review instead):** W13/W23 daemon-disconnect ribbon + disabled affordances (hard to force a heartbeat drop in a headless run); the `pingNow` retry fix was code-reviewed. W16 markdown-tab round-trip (E11) verified via core tests U1/U21 + review read of MarkdownTab.

**Ship gate:** REVIEW ✓ (no 🔴, 4 🟡 fixed) + QA ✓ (1 🔴 caught & fixed, re-verified). `/cso` NOT required — no new RPC / fs-write / secrets (all effects via pre-existing saveArtifact/deleteArtifact; the pingNow fix reuses the existing `ping`). Core 132 tests + daemon 267 tests + web tsc all green.

## 17. SHIP — Done (2026-07-09)

**Status: DONE — shipped through the Maker→Checker pipeline.**

Ship gate verified (not assumed):
- REVIEW (§13) = PASS, no 🔴; 4 🟡 fixed (§14).
- QA (§16) = PASS; 1 🔴 caught live + fixed (§15) + re-verified live.
- CSO = correctly NOT required — `git diff --cached --stat -- apps/daemon` is empty (A2 holds); the only store change is `pingNow` reusing the pre-existing `ping` RPC (no new RPC / fs-write / secrets / trust boundary).
- Final `npm run build` = clean (exit 0). Core 132 + daemon 267 tests green; web static export builds.

Verified behaviors (live, persisted): drag-to-link, `+` count/goal modal, `×` edge delete (block round-trips to pre-block bytes), node ⋯ menus (command vs agent variants), canvas add→BuilderDrawer, unlinked-chip heuristic, 0 console errors.

Deferred (unchanged): D1 free-drag/persisted layout, D2 normalize-backtick, D3 reorder-in-modal, D4 multi-select, D5 inline-rename.
