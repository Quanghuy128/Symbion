# Feature: resizable-builder-drawer

Streamline the workflow/agent edit modal (`BuilderDrawer`) UI and make the
form↔preview split resizable by dragging the divider.

## Scope (intentionally trivial — fast-track via /simplify-implementation)

UI-only change in `apps/web`. No daemon RPC, no filesystem-write, no path handling,
no secrets. Small, reversible, low risk → `/simplify-implementation` (plan→build→ship),
independent /review + /qa + /cso deliberately skipped.

**Locked decisions (user, 2026-07-09):**
1. **Resizable divider** — drag the vertical divider between the form pane (left) and the
   `LivePreviewPane` (right) to change the split ratio. Persist the ratio to localStorage.
   NOT resizing the whole drawer width and NOT dragging the drawer's left edge.
2. **Làm gọn UI** — tighten spacing/padding and group label+control more tightly
   (e.g. `space-y-4`→`space-y-3`, `p-4`→`p-3`, compact header/footer). Keep ALL fields;
   do not hide anything into "Nâng cao".

**Residual risk:** purely presentational; worst case is a mis-persisted split ratio or a
drag handle that feels off. No data-loss surface.

## PLAN — Architecture

### Files touched (all in `apps/web/src/`)
- `components/BuilderDrawer.tsx` — replace the hard `w-1/2 / w-1/2` split with a
  flex layout driven by a `formPct` state; insert a draggable divider between the two
  panes; tighten the drawer's own header/footer padding.
- `components/WorkflowForm.tsx` — tighten spacing (`space-y-4`→`space-y-3`, field
  label margins), no field removed.
- `components/AgentForm.tsx` — same spacing pass for parity.
- **New** `lib/hooks/useResizableSplit.ts` — small reusable hook owning the split
  percentage, drag handlers (pointer events), clamp, and localStorage persistence.

No changes to `packages/core` or `apps/daemon`. No RPC surface.

### Data flow (resize)
1. `useResizableSplit(key, defaultPct)` reads `localStorage[key]` on mount (guarded for
   SSR — Next.js: only read in `useEffect`, initial render uses `defaultPct` to avoid
   hydration mismatch). Returns `{ formPct, onDragStart }`.
2. Divider `onPointerDown` → `onDragStart`: capture pointer, listen to `pointermove` on
   `window`, compute `pct = (clientX - containerLeft) / containerWidth * 100`, clamp to
   `[MIN_PCT, MAX_PCT]` (e.g. 25–75), `setFormPct`.
3. On `pointerup`: remove listeners, write final `formPct` to localStorage.
4. `BuilderDrawer` renders `<div style={{ width: \`${formPct}%\` }}>` for form,
   `<div style={{ width: \`${100 - formPct}%\` }}>` for preview, divider in between.

### Layout structure (BuilderDrawer)
```
<drawer flex row, ref=containerRef>
  <form pane   style=width:formPct%>   … header/tabs/body/footer …
  <divider     w-1 cursor-col-resize onPointerDown=onDragStart>  ← hit area padded
  <preview pane style=width:(100-formPct)%>  <LivePreviewPane/>
```
The divider replaces the current `border-l` on `LivePreviewPane`'s outer div (keep one
hairline; avoid a double border).

### Edge cases
- **SSR/hydration**: never read localStorage during render — `useEffect` only. Initial
  `formPct = defaultPct` (50).
- **Clamp**: min/max so neither pane collapses to unusable width. Min 25% / max 75%.
- **Pointer capture**: use `setPointerCapture` or window listeners so a fast drag that
  leaves the divider still tracks; always clean up listeners on pointerup/unmount.
- **Text selection during drag**: set `user-select: none` on body (or a class) while
  dragging so the drag doesn't select preview text.
- **Corrupt/out-of-range localStorage value**: parse, validate `isFinite` and within
  clamp; fall back to default if bad.
- **Narrow viewport**: drawer is `max-w-[96vw]`; percentages stay relative to the actual
  rendered container width (measured from `containerRef`), so it still works.
- **Keyboard/a11y**: give the divider `role="separator"`, `aria-orientation="vertical"`;
  (arrow-key resize optional, out of scope — note it, don't build).

### Làm gọn (spacing pass)
- Drawer padding `p-4`→`p-3`; header `mb-4`→`mb-3`; tab row `mb-4`→`mb-3`; footer
  `mt-4 pt-4`→`mt-3 pt-3`.
- Forms: outer `space-y-4`→`space-y-3`; label `mb-1` kept (already tight).
- Keep every field and control. No functional change to inputs.

## BUILD — implementation notes

Implemented per plan:
- **New** `apps/web/src/lib/hooks/useResizableSplit.ts` — hook owning `leftPct`, drag via
  window pointer listeners, clamp 25–75%, localStorage persist (key
  `symbion.builderDrawer.split`), SSR-safe (storage read in `useEffect` only), guards for
  disabled localStorage and non-finite stored values. Sets `body user-select:none` +
  `cursor:col-resize` during drag, restored on pointerup.
- `BuilderDrawer.tsx` — `containerRef` on the flex row; form pane width `${leftPct}%`,
  preview pane `${100-leftPct}%`, both `min-w-0`. Inserted a 1px divider with a widened
  invisible hit area (`-left-1.5 -right-1.5`) and an accent line on hover;
  `role="separator" aria-orientation="vertical"`. Tightened padding: `p-4→p-3`,
  `mb-4→mb-3` (header + tabs), `mt-4 pt-4→mt-3 pt-3` (footer).
- `LivePreviewPane.tsx` — dropped its own `border-l` (divider now provides the seam;
  avoids a double border).
- `WorkflowForm.tsx` / `AgentForm.tsx` — `space-y-4→space-y-3`. No field removed.

**Assumptions:**
- Clamp 25–75% is a reasonable default for both panes staying usable.
- Keyboard arrow-key resize on the separator is out of scope (noted in plan); pointer-only.
- localStorage key namespaced under `symbion.` to match app convention.

## Done (shipped via /simplify-implementation)

- **Verified:** `npm run build` clean — tsc passes for rpc-types + daemon, `next build`
  compiles + type-checks + lints with no errors.
- **Not run (fast-track):** independent /review + /qa + /cso deliberately skipped —
  UI-only, no trust boundary (no RPC / fs-write / secrets). Live drag-resize checks in
  the testplan remain manual (no dev server was running; a browser walkthrough is
  disproportionate for a presentational divider + spacing change).
- **Residual risk:** presentational only — a mis-feeling drag or mis-persisted ratio;
  no data-loss surface.

