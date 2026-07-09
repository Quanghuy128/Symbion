# Interactive Graph — Design (synthesized)

Synthesis of 3 parallel designer angles (edge/relationship · canvas-authoring · discoverability/cohesion) for the feature in `interactive-graph-STATE.md` (§Scope + §6 PLAN). Makes the **Sơ đồ** (React Flow) screen a full-permission authoring surface with parity to **Danh sách**.

**Binding tokens:** `apps/web/tailwind.config.ts` (ported from `symbion-dark-redesign-design.md §7`). Dark-only, IBM Plex. `accent/brand #6366f1`, `command #818cf8`, `agent #a78bfa`, `danger #f87171`, `warning #fbbf24`, `success #4ade80`, edge-default `#565c68` (text-faint), highlight `#c7d2fe`. No repo-root `DESIGN.md` — tailwind config is authoritative.

The 3 angles were coherent and cross-referenced each other's seams. Conflicts + taste-calls are resolved below (§9) with documented defaults; nothing needs a second user gate.

---

## 1. What changes at a glance

Today the graph is read-only (`nodesDraggable=false`, `nodesConnectable=false`). After this feature the canvas can: **drag command→agent to link**, **`+` edge modal** for count/goal, **delete edge**, **add / edit / delete nodes** on canvas (reusing BuilderDrawer + list delete flow), **turn a missing-agent phantom into a real agent**, and **copy run command** — all funneled through the existing `saveArtifact`/`deleteArtifact` RPCs. Layout stays auto (no free drag — deferred D1).

---

## 2. Screen / surface inventory

| # | Surface | Owner angle | Entry | Exit |
|---|---|---|---|---|
| A | **Graph toolbar** (floating, in-canvas top-left): `＋ Thêm ▾`, `⤢ Vừa khung`, `?` legend | canvas | Always on Sơ đồ tab | persists |
| B | **Canvas add-menu** (dropdown from `＋`) | canvas | click `＋ Thêm` | select / outside-click / Esc |
| C | **Canvas context menu** (right-click empty canvas) | canvas | `onPaneContextMenu` | select / outside-click / Esc |
| D | **Node ⋯ menu — command** (Sửa · Sao chép lệnh chạy · Xoá) | canvas | hover node → ⋯ | select / outside-click / Esc |
| E | **Node ⋯ menu — agent** (Sửa · Xoá) | canvas | hover node → ⋯ | " |
| F | **Node delete-confirm** (anchored popover) | canvas | ⋯ → Xoá | Hủy / Xoá / outside-click |
| G | **Missing-agent node action** (`＋ Tạo agent này`) | canvas | dangling `@mention` exists | click → drawer |
| H | **Graph empty state** (0 artifacts) | canvas | 0 artifacts on tab | click add → drawer |
| I | **Just-landed node ring** (transient) | canvas | after successful add/create-agent | auto-fade ~1.6s |
| J | **Connection drag overlay** (live line + target glow) | edge | press+drag source handle | drop / Esc |
| K | **Edge midpoint toolbar** (`+` / `×`, hover) | edge | hover non-missing edge | pointer-off / click |
| L | **`EdgeRelationModal`** (count + goal) | edge | click `+` on edge | Lưu / Huỷ / Esc / backdrop |
| M | **Inline edge-delete confirm** (`Xoá? ✓ ✗`) | edge | click `×` on edge | confirm / cancel |
| N | **First-run hint bar** | discoverability | first interactive open (per-user flag) | `Đã hiểu` / `×` / auto-fade on first link |
| O | **Unlinked-command chip + tooltip** | discoverability | command with backtick-ref but 0 `@name` edges | persistent status; tooltip on hover |
| P | **Toast system** (success/warning/error/neutral) | discoverability | any mutation result | 2200ms auto-dismiss |
| Q | **In-flight ghost edge** (transient, ephemeral) | discoverability | `saveArtifact` pending after a drag | resolve → real edge / removed |
| R | **Disconnected canvas ribbon + disabled affordances** | discoverability | `daemonConnected===false` | reconnect |

Reused unchanged: `BuilderDrawer`, `CopyRunCommandDialog`, `Dialog`, `Button`, `Input`, `Badge`, `RowMenu`/`ROW_MENU_DIVIDER`, `Toaster`, `GraphStatusChips`.

---

## 3. Core interactions

### 3.1 Drag to link (command → agent) — the heart gesture

Three frames:
- **Idle → hover command node:** its right-edge **source handle** brightens (base ~40–60% → 100%, kind color), grows ~1.4×, cursor `crosshair`, one 900ms **one-shot pulse** (never loops). First-session-only tooltip "Kéo để liên kết với agent."
- **Dragging:** live bezier follows cursor in command color `#818cf8`, 2px + drop-shadow. Canvas + non-agent nodes dim to ~40%. Valid agent targets get a violet ring `#a78bfa` and enlarged target handle. Over an invalid target (command / self / missing node) the line turns `#f87171`, cursor `no-drop` — driven by `isValidConnection` (live), `onConnect` guard is the backstop (E1).
- **Drop valid:** both handles flash `#c7d2fe` (~250ms), edge draws in via the existing `stroke-dashoffset` reveal, success toast `Đã liên kết /{cmd} → {agent}`. Under the hood: `upsertAgentRef(cmd.body, {name})` → `saveArtifact`. Drop invalid/cancel → line fades, no toast, no mutation.
- **Duplicate (E2):** drop on already-linked agent → no new edge, neutral toast `Đã liên kết rồi.`

### 3.2 Edge midpoint `+` / `×` + relationship modal (L)

- `+`/`×` toolbar renders at bezier midpoint via `EdgeLabelRenderer`, **on edge/endpoint hover or when the edge is selected** (not always — density). Ø20 circles, `bg-bg-menu`, border `rgba(255,255,255,.09)`; `+` glyph `accent-text #a5b4fc` (hover `#c7d2fe`); `×` hover → `danger`.
- **`+` → `EdgeRelationModal`** (built on existing `Dialog`, `w-[420px]`, `rounded-dialog`, `bg-bg-panel`, `shadow-dialog`, `popIn`, backdrop `fadeIn`):
  - Title `Quan hệ`; subtitle `/{cmd} ──►  {agent}` (command color → agent color).
  - **Số lượng** — number `Input` (`[−] N [+]` stepper preferred over free-typed spinner for keyboard/validation safety), min 1, default 1, helper "agent này chạy bao nhiêu lần song song." Invalid (0/empty/non-integer) → danger ring + helper `Số lượng phải là số nguyên ≥ 1`, **Lưu** disabled.
  - **Mục tiêu (tùy chọn)** — textarea (styled inline to match `Input`, not a new primitive), 3 rows, placeholder "Agent này cần đạt được điều gì?"
  - **Xem trước cạnh** — live preview panel (`bg-bg-code`) rendering the badge + goal exactly as the edge will show. `count===1 && goal empty` → preview shows a *plain* link + note "Cạnh này sẽ không có nhãn" (mirrors byte-stability rule A5: no `×1`, no decoration written).
  - Footer: `[ Huỷ ] [ Lưu ]`. Save → `AgentRef {name, count: count>1?count:undefined, goal: goal.trim()||undefined}` → `upsertAgentRef` → `saveArtifact`. Spinner + disabled while saving; on reject keep modal open + inline danger error (never lose input). Success toast `Đã cập nhật liên kết {agent}.`
- **`×` → inline confirm** (`Xoá? [✓][✗]` replacing the toolbar — lightweight, matches app's second-click-confirm ethos) → `removeAgentRef` → `saveArtifact`, edge fades out, neutral toast `Đã bỏ liên kết {agent}.`

### 3.3 Edge state gallery

1. **Plain link** (`@name`, no count/goal): solid `#565c68`, 1.5px, no badge.
2. **Decorated link** (count>1 and/or goal): solid + **`×N` pill badge** at midpoint (`bg-bg-menu`, `text-accent-text`, `rounded-pill`, 11px, `×`=U+00D7); goal shows on badge-hover tooltip. Goal-only (count=1): small filled dot badge (agent color) + goal tooltip.
3. **Missing-agent danger edge**: dashed `#f87171` "6 4" + React Flow `animated` marching-ants; **no `+`/`×`** (can't decorate a phantom).
4. **Hovered/highlighted**: stroke `#c7d2fe`, 2.5px; unrelated edges dim to 35%; midpoint toolbar fades in.
5. **Selected** (clicked): same stroke + faint accent halo; toolbar pinned without hover; click empty canvas to deselect.

---

## 4. Canvas authoring (add / edit / delete on canvas)

- **Toolbar (A)** floats top-left inside the panel (`bg-menu` pill, `shadow-dropdown`, `popIn`), does not push canvas. Its presence + the connectable handle pips are the primary "this is editable now" signal.
- **Add (B/C):** `＋ Thêm ▾` dropdown and right-click canvas context menu → `Thêm workflow` / `Thêm agent` (each row prefixed with its kind-color dot). Opens the existing **BuilderDrawer** with a `newArtifact(kind)` draft. **No draft node is placed on canvas** (E8) — the node appears only after a successful save, then does a **just-landed ring flash** (I): 2px→3px `accent` box-shadow, `popIn` scale decaying over ~1.6s (auto-layout may place it mid-column, so the ring finds the user's eye). If the new node lands outside the viewport, a soft `fitView({duration:250})` re-centers.
- **Node ⋯ menu (D/E):** ⋯ reveals on node hover (top-right), stays while its menu is open. **Reuse `RowMenu`** with a kind-conditional `items` array: command = `Chỉnh sửa` · `Sao chép lệnh chạy` · divider · `Xoá`(danger); agent = `Chỉnh sửa` · `Xoá`(danger). Edit → `setEditing(artifact)` → BuilderDrawer. Copy run → existing `CopyRunCommandDialog`.
- **Delete (F):** ⋯ → Xoá opens an **anchored confirm popover** (never deletes immediately; copies ProjectView's `confirmDelete`/`deletingId`/`deleteError` state machine). Simple case `Xoá /build?  [Hủy][Xoá]`. Agent-with-refs (E4) adds a warning line (`warning #fbbf24`): `⚠ {n} workflow vẫn tham chiếu {name} — {names} sẽ hiện liên kết đỏ.` Confirm → `deleteArtifact(id)` → merged project → re-derive; the dangling `@name`s become MissingAgent nodes (no cascade scrub). `Đang xoá…` while in-flight; inline error on failure.
- **Missing-agent → create (G):** hover reveals `＋ Tạo agent này` (`accent-soft` bg, `accent-text` label). Click → `newArtifact("agent")` pre-named to the mention → BuilderDrawer → on save the phantom becomes a real AgentNode, edge de-dangers (dashed-red → solid), success toast `Đã tạo agent "{name}".` + just-landed ring.
- **Empty state (H):** centered muted glyph + "Chưa có workflow hay agent. Nhấn ＋ để tạo." with `[＋ Thêm workflow]` (accent) `[＋ Thêm agent]` (outline) — mirrors the list's empty state. Hint bar (N) suppressed when empty; `⤢ Vừa khung` disabled.

---

## 5. Discoverability, feedback & edge states

- **First-run hint bar (N):** stacked row between `GraphStatusChips` and the canvas (never overlays nodes), `bg-menu`, `slideIn`. Copy: "Sơ đồ giờ có thể chỉnh sửa. Kéo từ chấm ● bên phải một /command sang agent để liên kết. Nhấn ⋯ trên node để Sửa · Xoá · Copy run." `[Đã hiểu]` / `[×]` dismiss; **auto-fades on first successful link**. Visibility from a `localStorage`-backed per-user flag (`lib/graphHintSeen.ts`, tiny helper — NOT a store-shape change, honors A2).
- **`?` legend (A):** the permanent, non-nagging discoverability anchor once the hint bar is gone. Popover explaining edge styles, the draggable handle, ⋯ menu, and the "chưa liên kết" state.
- **Unlinked-command chip (O):** on a command node whose body has **zero** `@name` mentions **and** contains a backtick token matching an existing agent name (conservative heuristic — avoids firing on ordinary code spans). Chip is `warning #fbbf24` on `warning/15` (reuses `Badge variant="draft"` recipe) — **never danger** (danger is reserved for *missing* agents). Tooltip teaches: "Lệnh này nhắc agent bằng backtick — dùng @tên hoặc kéo cạnh để hiện liên kết." with `[Sửa body]` → BuilderDrawer. This is how the @name-vs-backtick mismatch (A1) is surfaced without alarm and without auto-rewriting prose (D2 deferred).
- **Toast system (P):** reuse `Toaster` unchanged (bottom-center, single-toast, `popIn`, 2200ms). **Extend `showToast` variant union** to `success` (✓, `text-success`) + `warning` (⚠, `text-warning`) alongside existing `error` (✕, `text-danger`) + neutral. Locked copy map:

  | Event | Variant | Copy |
  |---|---|---|
  | Edge created (drag/modal) | success | `Đã liên kết /{cmd} → {agent}` |
  | Edge already exists (E2) | neutral | `Đã liên kết rồi.` |
  | Edge deleted (P3) | neutral | `Đã bỏ liên kết {agent}.` |
  | `+` modal saved | success | `Đã cập nhật liên kết {agent}.` |
  | Node created | success | `Đã tạo {kind} "{name}".` |
  | Node deleted (P6) | neutral | `Đã xoá.` |
  | Delete agent still referenced (E4) | warning | `{n} workflow vẫn tham chiếu {name}.` |
  | Missing-agent → created (P7) | success | `Đã tạo agent "{name}".` |
  | Copy run (P8) | neutral | `Đã copy lệnh chạy.` |
  | Invalid connect backstop (E1) | error | `Chỉ nối được /command → agent.` |
  | Save rejected / validation (E7/E9) | error | `Lưu thất bại. Thử lại.` |
  | Attempt while disconnected (E9) | error | `Mất kết nối daemon — không thể lưu.` |

- **In-flight ghost edge (Q):** because the plan is **non-optimistic** (edges appear only after `saveArtifact` returns), show a transient dashed `text-faint` ghost edge + mid-edge spinner during the pending save (component-local state, **never** in `artifacts`). Ghost path === final path (zero layout shift on commit). Success → replaced by real re-derived edge. Error → ghost vanishes, canvas byte-identical to before, error toast. Honors E6/E8.
- **Disconnected canvas (R):** graph stays fully viewable (pan/zoom/hover-highlight); only mutation is gated. Top ribbon `⦿ Mất kết nối daemon — sơ đồ ở chế độ chỉ xem. [Thử lại]` (`warning` tint). Source handles render hollow `○` + `isConnectable=false`; `＋`, ⋯, edge `+`/`×`, create-agent all `disabled` + `cursor-not-allowed` + tooltip "Cần kết nối daemon." The `?` legend stays enabled. Mirrors list's `disabled={!daemonConnected}`. On reconnect: ribbon fades, handles animate hollow→solid (~120ms), no toast.

---

## 6. Component breakdown (contracts — no implementation)

**packages/core (pure):** `agentBlock.ts` (parse/render/upsert/remove per PLAN §6.0); `validate.ts` two new warnings. Not a UI concern but the modal/edge depend on `parseAgentBlock` to decorate edges with `{count,goal}`.

**apps/web — NEW:**
- `graph/EdgeRelationModal.tsx` — `{command, agentName, initial?: AgentRef, onSave(ref)=>Promise, onClose()}`. Dialog-based.
- `graph/GraphToolbar.tsx` — `{onAdd(kind), onFitView(), onToggleLegend?, disabled}`.
- `graph/GraphCanvasMenu.tsx` — `{x, y, onClose, onAdd(kind), onFitView()}`.
- `graph/NodeMenu.tsx` — wraps `RowMenu`; `{kind, open, onOpenChange, onEdit, onDelete, onCopyRun?, deleteDisabled}`.
- `graph/NodeDeleteConfirm.tsx` (or inline state in DependencyGraph) — `{artifactName, kind, referencingCommands: string[], deleting, error, onCancel, onConfirm}`.
- `graph/GraphHintBar.tsx` — `{onDismiss}`; visibility from `lib/graphHintSeen.ts`.
- `graph/GraphLegend.tsx` — `{open, onOpenChange}`.
- `graph/DaemonRibbon.tsx` — `{onRetry}`.
- `lib/newArtifact.ts` — hoisted shared factory (from ProjectView).
- `lib/graphHintSeen.ts` — tiny localStorage helper (per-user first-run flag).

**apps/web — MODIFY:**
- `DependencyGraph.tsx` — `nodesConnectable={true}`; keep `nodesDraggable={false}`. Handlers `onConnect`, `isValidConnection`, `onConnectStart/End`, `onPaneContextMenu`. Ephemeral local state only: `connecting`, `selectedEdgeId`, `hoveredEdgeId`, `openNodeMenuId`, `contextMenu`, `confirmDeleteId`/`deletingId`/`deleteError`, `justAddedId`, `pendingConnection`, `modalTarget`. Edges/nodes stay **derived** via `useMemo` (E10) — `parseAgentBlock` decorates edges; compute `unlinked` per command node. New props from ProjectView: `onEditArtifact`/`setEditing`, plus store access `saveArtifact`/`deleteArtifact`/`newArtifact`/`showToast`/`daemonConnected`.
- `ProjectView.tsx` — pass callbacks + `setEditing` into DependencyGraph; hoist `newArtifact`; render graph empty state.
- `graph/CommandNode.tsx` / `AgentNode.tsx` — `isConnectable` (gated on `daemonConnected`), hover-revealed ⋯, one-shot handle pulse on hover, `data.unlinked?` (command) + `data.justAdded?` + menu callbacks. Stay dumb (state computed in parent).
- `graph/MissingAgentNode.tsx` — `isConnectable={false}`; hover-revealed `＋ Tạo agent này`; `data.onCreateAgent(name)`.
- `graph/AnimatedEdge.tsx` — new `data`: `count?`, `goal?`, `interactive?`, `selected?`, `pending?`, `onOpenModal()`, `onDelete()`. Add `EdgeLabelRenderer` for badge + `+`/`×` toolbar + inline delete-confirm + pending spinner. Keep existing draw-in/highlight contract.
- `ui/toast.tsx` + store `showToast` — extend variant union with `success`/`warning` (see §7).

**No `types.ts` / daemon-RPC / `useArtifactStore` *shape* change** (A2). Only additions: `showToast` variant union, a `pulse` keyframe, the two localStorage/factory helpers.

---

## 7. Design-system additions (the only durable, cross-feature ones)

Applied at build time (not a separate step):
- **Toast variants** in `tailwind`/`ui/toast.tsx` + `showToast`: `success`→✓ `text-success #4ade80`; `warning`→⚠ `text-warning #fbbf24`; `error`→✕ `text-danger` (existing); neutral (existing). Placement/motion/timing unchanged.
- **`pulse` keyframe** (one-shot handle affordance): `0% box-shadow 0 0 0 0 rgba(129,140,248,.5) → 100% 0 0 0 6px rgba(129,140,248,0)`, `animation.pulse: "pulse .9s cubic-bezier(.2,.8,.2,1) 1"` (runs once). Collapsed by the existing `prefers-reduced-motion` global block.
- **Canvas z-index layering** (convention, no token): canvas base → toolbar/hint-bar `z-10` → node/canvas menus `z-30` → edge modal `z-40` → toast `z-50` (existing).
- **Color-role discipline** (do/don't): `danger` = *missing* agents only; `warning` = "unlinked-but-exists"; never conflate. Never loop the pulse or stack toasts. Never commit edges optimistically.

Everything else composes existing tokens — no new colors/radii/shadows.

---

## 8. Edge cases (design-side; mirrors STATE §6.4)

E1 wrong-kind connect → `isValidConnection` live-reject + guard + error toast. E2 duplicate → neutral no-op. E3 self-loop → impossible by kind + `source===target` reject. E4 delete referenced agent → warning line in confirm + warning toast + MissingAgent re-derive (no scrub). E5 missing node → not connectable, only "Tạo agent này". E6/E8 non-optimistic → ghost edge ephemeral, canvas byte-identical on failure. E7 validation → error toast + drawer-inline. E9 disconnect → ribbon + disabled affordances. E10 controlled/uncontrolled → derived nodes/edges, only ephemeral UI is local state. E11 manual markdown edit → body verbatim; re-render only on graph mutation. E12 name collision → existing `name-duplicate` in drawer. E-layout → auto-layout stays (D1).

---

## 9. Taste-calls resolved (documented defaults — no second gate)

All reversible, covered by the existing design system:
1. **⋯ placement** → **hover-reveal** (matches list's quiet trigger; `?` legend + hint bar cover discoverability).
2. **Right-click context menu** → **keep** (cheap, high power-user payoff; first to cut if scope tightens).
3. **Off-screen new node** → **ring-flash always + soft `fitView` only if outside viewport.**
4. **Add-menu keyboard shortcuts** → **defer** (don't render labels we don't wire — avoids lying).
5. **Delete-confirm surface** → **anchored popover** (keeps node context; lighter than centered Dialog).
6. **Legend** → **`?` toggle popover** in toolbar (not always-on chip row — less clutter).
7. **Goal-only badge glyph** → **small filled dot** (agent color) + goal tooltip.
8. **`+`/`×` visibility** → **hover/selected only**; badge always visible.
9. **Save-gap feedback** → **ghost edge + spinner** (option a; ephemeral, honors non-optimistic rule).
10. **Count control** → **`[−] N [+]` stepper** (keyboard-safe, blocks junk input).
11. **Coach tooltip / first-run flag** → **per-user, once ever** (localStorage), session `hasLinkedOnce` for the drag tooltip.
12. **E4 delete-referenced-agent** → **confirm popover with inline warning line** (confirm-before), plus warning toast after. Safer than list's plain confirm; the cascade risk (dangling refs) justifies the extra warning.
13. **Success toast color** → **green `#4ade80`** introduced as a durable variant (§7).
14. **Unlinked-chip heuristic** → **conservative** (backtick token must match an existing agent name).

---

## Future (out of v1 — do not build)
D1 free-drag + persisted layout · D2 normalize-backtick action · D3 reorder agents in modal · D4 multi-select bulk delete · D5 inline rename · drag-to-reconnect edge · toast undo · coach-mark tour.
