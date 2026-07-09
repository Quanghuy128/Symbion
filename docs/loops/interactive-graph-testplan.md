# Interactive Graph — TEST PLAN

Companion to `interactive-graph-STATE.md` §6 (phase PLAN). Follows the pipeline convention: **core unit (Vitest)** carries ~80% of correctness cheaply, **daemon integration (Vitest)** covers the persistence seam, **web journey (chrome-devtools)** covers the interactive canvas. Each case maps to a PLAN edge case (E#) or scope item (P#).

Acceptance bar: every case below must be verifiable; the byte-stability round-trip (U1) is a hard gate for REVIEW/QA.

---

## 1. Core unit tests (Vitest) — `packages/core`

### 1.1 `src/ir/agentBlock.test.ts` (NEW)

**Parse:**
- **U1 (GATE) round-trip identity:** for a table of bodies (no block; block with 1 ref; block with count; block with goal; block with count+goal; block with 3 refs mixed; block preceded by prose; empty body), assert `setAgentBlock(body, parseAgentBlock(body)) === body` byte-for-byte.
- U2 `parseAgentBlock("")` → `[]`; body with no delimiters → `[]`.
- U3 parse `- @feature-builder` → `{name:"feature-builder"}` (count/goal undefined).
- U4 parse `- @qa ×2` → `{name:"qa", count:2}`.
- U5 parse `- @cr — Review the diff` → `{name:"cr", goal:"Review the diff"}`.
- U6 parse `- @x ×3 — Do the thing` → `{name:"x", count:3, goal:"Do the thing"}`.
- U7 preserves first-appearance order across 3 refs.
- U8 goal containing `×` and `—` inside the free text is captured whole (only the first `—` delimiter splits).
- U9 exact codepoints: `×` is U+00D7 and `—` is U+2014; an ASCII `x2` or ` - goal` (hyphen) is NOT parsed as count/goal (A7).

**Render:**
- U10 `renderAgentBlock([{name:"a"}])` omits `×count` and `— goal`.
- U11 count === 1 or undefined ⇒ no `×1` written (A5); count > 1 ⇒ `×N`.
- U12 empty/whitespace goal ⇒ no `—` segment.
- U13 block wrapped in `<!-- symbion:agents -->` / `<!-- /symbion:agents -->`, `## Agents` heading present, no trailing spaces on lines.

**Upsert / remove / setAgentBlock:**
- U14 `upsertAgentRef(bodyNoBlock, ref)` creates the block with exactly one blank line before the opening delimiter when body non-empty (A: placement rule).
- U15 `upsertAgentRef` on existing block replaces the matching `@name` line in place (order preserved), leaves others untouched.
- U16 `upsertAgentRef` adding a new name appends at end of the ref list.
- U17 `removeAgentRef` drops one line; removing the last ref removes the whole block + its surrounding blank line ⇒ restores pre-block bytes (E11 partial).
- U18 `setAgentBlock(body, [])` strips the block entirely and restores original bytes.
- U19 `upsertAgentRef` is idempotent: applying the same ref twice === applying once (E2).
- U20 `hasAgentBlock` true only when both delimiters present; corrupted/half-deleted delimiter ⇒ false (E11).

**Tolerance:**
- U21 unrecognized `- @` line inside block (bad grammar) is dropped on canonical re-render but NOT on plain parse-without-mutation (E11 semantics: re-render only on mutation).
- U22 a stray non-ref line inside the block does not throw.

**Interop with existing extractor:**
- U23 `extractAgentMentions(bodyWithBlock)` still returns the block's `@name`s (edges keep deriving) — guards against the block accidentally hiding mentions.

### 1.2 `src/ir/validate.test.ts` (EXTEND)
- U24 `agentblock-malformed` warning (not error) for a bad `- @` line inside block; Save not blocked.
- U25 `agentref-count-invalid` warning for `×0` / non-integer.
- U26 existing `mention-missing-agent` still fires for a block ref whose agent doesn't exist (E4/E7).
- U27 adding a valid ref does NOT introduce any new **error** (drag-connect must never be blocked by validate).

### 1.3 `src/parse/scan` round-trip (EXTEND existing parse tests)
- U28 render a command whose body contains the agents block → `parseClaudeFile` → body still contains the intact block (block is NOT stripped like the `managed-by` marker is) (A6).

---

## 2. Daemon integration tests (Vitest) — `apps/daemon`

Confirm the **frozen RPC surface** carries the block with no new method (A2).
- D1 `saveArtifact` with a command whose body has an agents block persists to `.symbion/store.json` and returns a merged project whose command body === input body (byte-exact).
- D2 reload project (`loadProject`) → the block survives store serialization round-trip.
- D3 `saveArtifact` runs `validateAllArtifacts`; a name-duplicate created via the canvas path still rejects with the same error shape the list path produces (E12).
- D4 `deleteArtifact` on a referenced agent succeeds and returns a project where commands still contain the now-dangling `@name` (no cascade scrub) (E4).
- D5 (negative) confirm NO new RPC method was registered for graph editing (grep the RPC method map) — enforces A2.

---

## 3. Web journey tests (chrome-devtools) — `apps/web`

Run against a seeded project with ≥2 commands and ≥2 agents. Switch to **Sơ đồ** tab.

- W1 **Drag edge (P1/E1):** drag from a CommandNode source handle to an AgentNode target handle → after save, the command's body gains `- @<agent>` and an edge renders. Verify by reopening the command in the drawer (markdown tab) that the block exists.
- W2 **Invalid connect (E1/E3):** attempt command→command and agent→agent → connection rejected (no edge, toast). Self-loop impossible.
- W3 **Duplicate connect (E2):** drag the same command→agent twice → only one `@name` line; neutral toast on the second.
- W4 **`+` modal (P2):** click the `+` on an edge → modal opens → set count=2, goal="Do X" → Save → body line becomes `- @<agent> ×2 — Do X`. Reopen modal → fields prefilled from `parseAgentBlock`.
- W5 **Edge delete (P3):** hover edge → click × → `@name` line removed; if it was the last ref, block gone. Edge disappears.
- W6 **Add workflow on canvas (P4):** canvas ＋ menu → Add workflow → BuilderDrawer opens with blank draft → fill name/description → Save → new CommandNode appears. No draft node before save (E8).
- W7 **Add agent on canvas (P4):** same via Add agent.
- W8 **Edit/customize node (P5):** node ⋯ → Edit → SAME BuilderDrawer as list → change description → Save → node label/description reflects.
- W9 **Delete node (P6):** node ⋯ → Delete → confirm dialog → `deleteArtifact` → node removed.
- W10 **Delete referenced agent (E4):** delete an agent that a command references → agent node gone, dangling ref becomes a MissingAgentNode with danger edge + warning toast naming affected command(s). Command body still has the `@name`.
- W11 **Missing-agent → create (P7):** on a MissingAgentNode click "＋ Tạo agent này" → drawer prefilled with the mention name → Save → placeholder becomes a real AgentNode, edge de-danger'd.
- W12 **Copy run command (P8):** command ⋯ → Copy run command → existing dialog opens.
- W13 **Daemon disconnect (E9):** simulate heartbeat failure → connect/＋/delete affordances disabled; an in-flight drag save failure shows error toast and leaves canvas unchanged.
- W14 **Validation surfaced (E7/E12):** add a workflow with a duplicate name on canvas → drawer Save blocked with the same `name-duplicate` error as the list.
- W15 **Layout stability (E-layout):** nodes are NOT free-draggable; positions stable across re-renders after a mutation.
- W16 **Round-trip via markdown tab (E11):** open command markdown tab, verify the block text is human-readable + editable; hand-edit prose around the block, Save, reopen graph → edges intact, block untouched.

### 3.1 Design-surface journey tests (from `interactive-graph-design.md`)
- W17 **First-run hint bar (N):** fresh per-user flag → hint bar shows under status chips on first Sơ đồ open; `[Đã hiểu]` dismisses; reload → hint bar does NOT return (localStorage flag set). Also auto-fades after first successful link.
- W18 **Toast variants (P):** assert the correct variant/copy per the §5 locked map — success (edge created, `Đã liên kết …`), neutral (`Đã liên kết rồi.` on duplicate), warning (`{n} workflow vẫn tham chiếu …`), error (`Chỉ nối được /command → agent.`). Verify success shows the ✓/`text-success` treatment newly added to `ui/toast.tsx`.
- W19 **Unlinked-command chip (O):** a command whose body references an agent by backtick (matching an existing agent name) and has zero `@name` → shows the `warning`-colored "chưa liên kết" chip (NOT danger); tooltip teaches the @name convention; `[Sửa body]` opens the drawer. A command with a real `@name` edge shows NO chip. A backtick token matching NO agent → NO chip (conservative heuristic).
- W20 **Ghost edge during save (Q):** on drag-drop, a transient dashed ghost edge + spinner renders while `saveArtifact` is pending, then is replaced by the real solid edge with no layout shift; on a forced save failure the ghost is removed and the canvas is byte-identical to before (no committed edge).
- W21 **Just-landed ring (I):** after adding a node, the new node shows the transient accent ring; if it lands outside the viewport, a soft `fitView` re-centers.
- W22 **Modal count stepper validation (L):** `[−] N [+]` stepper enforces integer ≥1; entering/forcing 0 or empty disables **Lưu** with the danger helper; `count===1 && goal empty` preview shows a plain link + the "no label" note (A5).
- W23 **Disconnected ribbon (R):** with daemon down, the canvas stays viewable (pan/zoom/hover-highlight work), the ribbon shows, handles render hollow + non-connectable, `+`/`×`/⋯/＋ disabled; the `?` legend stays enabled. On reconnect the ribbon disappears with no toast.
- W24 **`?` legend (A):** clicking `?` opens the legend popover explaining edge/handle/⋯/unlinked states; outside-click closes it.

---

## 4. Mapping to pipeline conventions
- Core unit + daemon integration = the Vitest layer per `CLAUDE.md` ("~80% of correctness lives in core as cheap unit tests"). U1 is the analog of the byte-stable render/parse invariants already tested for customFields.
- Web journey = chrome-devtools per `CLAUDE.md` test row.
- REVIEW acceptance: architect confirms A2/A4 (no IR/RPC/store-shape drift, no optimistic draft nodes) and A3 (U1 passes). security-reviewer via `/cso` is **not required** — this feature adds no new RPC, no new fs-write path, no secrets (all effects go through the pre-existing, already-reviewed `saveArtifact`/`deleteArtifact`). Note this explicitly at the ship gate.
