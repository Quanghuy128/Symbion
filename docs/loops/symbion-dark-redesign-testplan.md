# Symbion dark left-rail redesign — Test Plan

> Companion to `docs/loops/symbion-dark-redesign-STATE.md` §6 (PLAN). Read that doc first for the
> file-by-file plan, 10 Open-Question resolutions, and sequencing (§6.9) that this test plan is
> organized around. Test items below are grouped by the same 6-step build order so each step can be
> verified independently before the next lands.

## 0. Cross-cutting non-regression gate (run before/after every step)

These must stay true across the *entire* feature, not just the step that touches them — regress any
of these and treat it as a blocking bug regardless of which step's PR introduced it.

- [ ] **Filesystem-safety surface untouched**: `git diff` against `packages/core/src/render/`,
      `packages/core/src/diff/`, `packages/core/src/adapters/` (write logic), and
      `apps/daemon/src/**` shows **zero** changes for the whole feature except read-only imports of
      already-exported values (`ADAPTERS.*.capability.lossy`, `extractAgentMentions`). Any diff in
      `render/marker.ts`, `diff/conflict.ts`, or any daemon RPC handler signature is an
      architecture-drift bug — halt and re-check against PLAN §6.8.
- [ ] Every documented as-built interaction from `docs/loops/symbion-ui-wireframe-context.md`
      (query-param handoffs `?t=`, `?openProject=`, `?createProject=1`; dialog/drawer state
      machines; `daemonConnected` guard on every write control) still works identically.
- [ ] `npm run build` (or equivalent) succeeds with zero new TypeScript errors in `apps/web`.
- [ ] No console errors/warnings introduced in dev mode on any of the 3 routes.

---

## 1. Infra (globals.css, tailwind.config.ts, layout.tsx, toast slice, Toaster)

**Unit (Vitest, `apps/web`):**
- [ ] `useArtifactStore`: `showToast(message)` sets `toast` to `{ id, message, variant: undefined }`
      with a fresh, unique `id` each call.
- [ ] `showToast(message, "error")` sets `variant: "error"`.
- [ ] `dismissToast()` sets `toast` back to `null`.
- [ ] Calling `showToast` twice in quick succession replaces the current toast (single-slot queue,
      per PLAN §6.2 Q4) rather than queuing both — assert the store only ever holds one `toast` value
      at a time.
- [ ] `<Toaster/>` renders nothing when `toast === null`, renders the message+variant when set.

**Visual/manual (chrome-devtools or equivalent):**
- [ ] Dark tokens apply immediately on page load on all 3 routes — no flash of the old light theme.
- [ ] IBM Plex Sans/Mono load via `next/font/google` (inspect `<head>` — no CDN `<link>` to
      `fonts.googleapis.com`; font files served from `_next/static/media/`).
- [ ] `prefers-reduced-motion: reduce` (via devtools emulation) collapses all animations
      (`fadeIn`/`slideIn`/`popIn`/edge draw-in/row stagger) to instant — verify on at least one
      instance of each (a dialog open, the drawer open, the graph tab mount).
- [ ] No light-mode `:root` variables remain in the compiled CSS (Q7) — grep build output or
      `globals.css` for the deleted light HSL values.

---

## 2. `AppRail`

**Unit (Vitest):**
- [ ] `AppRail` renders 3 primary-nav items with correct active state per `usePathname()` for each
      of `/`, `/templates`, `/settings`.
- [ ] `AppRail` renders the empty-state hint ("∅ chưa có dự án") when `projects` is empty.
- [ ] `AppRail` renders one row per project, calls `onSelectProject(id)` on click.
- [ ] `AppRail`'s "+" button calls `onCreateProject()`.
- [ ] Current project's row shows the active accent-spine state; others do not.
- [ ] No "⌘K" or "CẤU HÌNH / Cài đặt chung" markup present anywhere in `AppRail`'s render output
      (Q8 — regression test guarding the deliberate drop).

**E2E (Playwright/chrome-devtools):**
- [ ] All 3 routes render the rail (no route left on the old `AppNav`/`ProjectSidebar` mid-migration
      — this only matters if step 2 ships before step 6, verify at each intermediate commit if the
      PR is split further).
- [ ] Clicking Templates/Settings/Builder nav items navigates correctly and updates active state.
- [ ] With 10+ seeded projects, the PROJECTS section scrolls independently — brand block and daemon
      footer stay pinned (not scrolled out of view).
- [ ] A project with a very long name/path truncates visually (no horizontal overflow of the rail)
      and the full path is available via `title` tooltip on hover.
- [ ] `AppNav.tsx` and `ProjectSidebar.tsx` are deleted from the repo only after this step is fully
      merged on all 3 routes (verify via `git log`/file-existence check at the PR that removes them).

---

## 3. Builder List tab (`RowMenu`, Edit/Delete wiring, `Badge`)

**Unit (Vitest):**
- [ ] `RowMenu` renders `Edit`, `Copy run command`, divider, `Delete` for a command-kind row;
      `Edit`, divider, `Delete` for an agent-kind row (no "Copy run command" on agents).
- [ ] `RowMenu` open/close: clicking the trigger toggles open; clicking outside closes it; only one
      `RowMenu` instance is open at a time when multiple rows render (test via `openMenuId` behavior
      in `ProjectView`).
- [ ] Clicking `Edit` in `RowMenu` calls the same `setEditing` path as clicking the row itself
      (verify `BuilderDrawer` opens with the correct artifact).
- [ ] Clicking `Delete` triggers the inline confirm step, does **not** call `deleteArtifact`
      immediately (single-click safety, per PLAN §6.4).
- [ ] Confirming delete calls `useArtifactStore.deleteArtifact(artifactId)` exactly once.
- [ ] `RowMenu`'s Delete item is disabled when `daemonConnected === false` (PLAN §6.7 edge case).
- [ ] On `deleteArtifact` rejection, an inline error message renders near the row (not a silent
      failure) and the row is **not** removed from the list.
- [ ] `Badge` renders "draft" styling for `status === "draft"` artifacts, nothing for
      published/non-draft.

**E2E:**
- [ ] Full flow: create an artifact → row appears with `○ draft` badge → open `⋯` → Edit → change
      description → Save → row updates in place.
- [ ] Full flow: open `⋯` on a command row → Copy run command → dialog opens with that command
      pre-filled (existing behavior unchanged).
- [ ] Full flow: open `⋯` → Delete → confirm → row disappears from the list, a success toast
      appears (Q4 scope: delete success/failure).
- [ ] Simulate daemon disconnect (kill daemon or block RPC) mid-list-view → `⋯`'s Delete item is
      visibly disabled; existing Save/Publish controls also disabled (no regression).

---

## 4a. `BuilderDrawer` (backdrop, slideIn, 880px)

**Unit (Vitest):**
- [ ] Drawer renders a backdrop element when open (net-new — assert its presence, since today's
      drawer has none).
- [ ] Clicking the backdrop calls `onClose` (click-outside-to-close, net-new interaction).
- [ ] Clicking inside the drawer panel does **not** call `onClose` (no regression of existing
      `stopPropagation`-style behavior, now needed on the panel itself since a backdrop click
      handler exists for the first time).
- [ ] Pressing Escape still calls `onClose` (existing behavior, must not regress under the new
      backdrop).
- [ ] Drawer panel width is 880px (not 860px) — assert via computed style or class in test.

**E2E:**
- [ ] Open drawer → verify visually it slides in from the right (visual/manual check; automate via
      checking the animation class is applied on mount, then removed/settled).
- [ ] Open drawer, click backdrop → drawer closes, no data loss confirmation prompt regression (if
      one didn't exist before, one should not suddenly appear — or if the design doc implies an
      "unsaved changes" guard should exist, confirm PLAN doesn't add one — it doesn't; flag as
      future-idea only).
- [ ] With `prefers-reduced-motion: reduce`, drawer appears instantly with backdrop, no slide
      animation.
- [ ] Existing Save/Cancel/tab-switch (Theo mô tả / Theo markdown) behavior all unchanged — full
      regression pass against `docs/loops/symbion-ui-wireframe-context.md` §S7/S8.

---

## 4b. Publish flow (`PublishDialog` toggle cards, `PublishDiffView` 640px + stagger, `ConflictResolver` popIn)

**Unit (Vitest):**
- [ ] Config step: clicking the Claude/Codex "toggle card" (not a checkbox anymore) calls the same
      `toggleTarget` logic — assert `targets` array updates identically to the old checkbox behavior.
- [ ] Codex ack checkbox still only renders when `targets.includes("codex")` (unchanged conditional).
- [ ] `PublishDiffView` dialog width is 640px (not 720px).
- [ ] `StaggeredReveal` caps reveal at 12 rows — with a 20-file diff fixture, assert rows 13-20 render
      immediately (no stagger delay applied) while rows 1-12 get staggered classes/timing.
- [ ] `ConflictResolver`'s `popIn` expand only fires once (`hasRevealed` flag) — clicking
      Keep→Overwrite→Keep repeatedly does not re-trigger the mount animation (assert animation class
      only applied on first render, not on resolution toggles).
- [ ] `nothingToWrite`/"Không có gì để ghi" disabled-button logic unchanged (idempotent re-publish,
      existing behavior).

**E2E:**
- [ ] Full publish flow: Config (toggle cards) → Diff (640px, staggered reveal, one conflict row) →
      resolve conflict (Keep or Overwrite) → Write → Result. Verify each step visually matches
      DESIGN.md's dimensions and the underlying RPC calls (`computeDiff`, `write`) still fire with
      identical params to before.
- [ ] Conflict row: verify the resolver expands with `popIn` on first render only; clicking
      Keep/Overwrite back and forth does not replay the animation (visual check + the unit test
      above).
- [ ] Re-publish with no changes: `PublishDiffView` shows all `=` rows, "Không có gì để ghi" is
      disabled — idempotent-publish edge case unregressed.
- [ ] Simulate a partial write failure (mock `write` RPC to return one file error) → `PublishResultView`
      still renders the per-file error list unchanged (restyle-only file, verify no logic regression).
- [ ] Simulate daemon disconnect mid-diff-view → "⚠ Mất kết nối daemon" message appears, Write button
      disabled — unchanged existing mechanism.

---

## 5. Graph tab (`DependencyGraph`, `GraphStatusChips`, custom nodes/edges)

**Unit (Vitest):**
- [ ] `GraphStatusChips` renders "Claude · clean" always (claude adapter's `lossy` is `false`) and
      "Codex · lossy" when the codex adapter is included in the render (assert via direct import of
      `ADAPTERS.claude.capability.lossy === false` and `ADAPTERS.codex.capability.lossy === true` —
      this is the actual data-source contract from PLAN §6.1.3, test it doesn't drift).
- [ ] `GraphStatusChips` renders the missing-agent-mention warning line when
      `missingAgentMentions.length > 0`, using the same list `extractAgentMentions` already produces
      (no new derivation — assert the same mentions surfaced in `DependencyGraph`'s existing
      `missingNodes` map appear in the chips row).
- [ ] `CommandNode`/`AgentNode`/`MissingAgentNode` render with correct label/color per kind.
- [ ] `AnimatedEdge`: with >15 edges in a fixture graph, assert only the first 15 get the staggered
      draw-in treatment; edges 16+ render immediately (cap enforcement, per PLAN §6.2 Q9/design doc
      §3.2).
- [ ] `AnimatedEdge` respects `prefers-reduced-motion` — with the media query mocked "reduce", no
      stagger delay is applied to any edge.
- [ ] Hovering a node (simulate `onMouseEnter`) sets a highlighted-edges state that dims all
      non-connected edges — assert opacity/style change is scoped to only the hovered node's edges.

**E2E:**
- [ ] Graph tab shows recolored nodes (`#818cf8` commands, `#a78bfa` agents) and dotted-grid
      background, matching DESIGN.md tokens.
- [ ] A workflow referencing a nonexistent agent renders the dashed missing-agent node + a warning
      line in `GraphStatusChips` — unchanged detection logic, only presentation is new.
- [ ] Edge draw-in is visually staggered on tab mount (manual/visual check, or automate via checking
      animation-delay CSS values increase per edge index up to the cap).
- [ ] Clicking a real node still opens its `BuilderDrawer` directly (existing double-click-to-open
      behavior per wireframe context, unregressed).
- [ ] No node scale/lift/hover-popover exists (regression test against Q9's explicit "no" list —
      assert no `:hover` transform/scale styles present, no popover component rendered on hover).

---

## 6. Templates + Settings restyle

**Unit (Vitest):** none expected — this step is restyle-only per PLAN §6.4 (no new logic).

**E2E (spot-check, not exhaustive — lowest risk per sequencing):**
- [ ] Templates marketplace: tabs, cards, preview modal, license/apply/result sub-steps all function
      identically to `docs/loops/symbion-ui-wireframe-context.md`'s documented behavior, just
      restyled.
- [ ] Settings/AI Providers: Ollama/API-key provider cards, test-connection, set-default, key-save
      all function identically, just restyled. **No secrets-handling change** — confirm no API key
      value is logged, exposed in a new place, or handled differently than before (this screen is
      restyle-only per PLAN, but since it touches API keys, a quick visual/behavioral confirm is
      worth the extra minute even without a full `/cso` pass).

---

## Acceptance criteria summary (for code-reviewer / architect-reviewer / QA)

1. **Filesystem-safety non-regression** (§0 above) is the single highest-priority gate — if any
   PR in this feature touches `packages/core/src/render/`, `packages/core/src/diff/`, or
   `apps/daemon/src/**` beyond the declared read-only imports, that is architecture drift from
   PLAN §6.8 and should block merge regardless of how good the UI looks.
2. **Security review (`/cso`) is not required** for this feature (confirmed PLAN §6.8) — reviewers
   should not request one, but should independently spot-check `deleteArtifact`'s existing daemon
   handler (`apps/daemon/src/rpc/handlers.ts:271`) for backup-before-write/path-confinement when
   reviewing step 3's Delete-wiring, since PLAN explicitly flagged that as unverified-but-assumed.
3. **Visual-fidelity acceptance**: spot-check computed widths (640px diff, 880px drawer, 236px
   rail), colors (`#818cf8`/`#a78bfa` graph nodes, dark token set), and typography (IBM Plex
   Sans/Mono via `next/font/google`, no CDN `<link>`) against `DESIGN.md`'s tokens at each step —
   do not wait until the end to check fidelity, since drift compounds across 6 sequential steps.
4. **Behavior-preservation acceptance**: every checkbox in §0's cross-cutting gate must pass at
   every step boundary (steps are designed to be independently revertible per PLAN §6.9 — use that
   to bisect any regression to a single step).
5. Any Open-Question resolution the user disagrees with at the approval gate should be the *only*
   thing renegotiated — do not silently drift from other locked resolutions while addressing one
   pushback (per PLAN §6.10's explicit "easiest item to strip back" framing for Q4).
