# Test Plan: resizable-builder-drawer

Manual/live verification (UI-only; no unit-test surface in packages/core). Verify in
`apps/web` dev server, open a workflow/agent to bring up `BuilderDrawer`.

## Build gate
- [ ] `npm run build` clean (typecheck passes — new hook typed, no unused vars).

## Resize behavior
- [ ] Divider is visible between form and preview, shows `col-resize` cursor on hover.
- [ ] Drag divider right → form pane widens, preview narrows; drag left → opposite.
- [ ] Cannot drag past clamp (form stays within ~25%–75%); neither pane collapses.
- [ ] Fast drag that leaves the divider still tracks (pointer capture / window listeners).
- [ ] No text gets selected while dragging.
- [ ] Release drag → ratio persists; reopen drawer (or refresh) → same ratio restored.
- [ ] First-ever open (no localStorage) → defaults to 50/50, no hydration warning in console.

## Làm gọn (visual)
- [ ] Spacing tighter than before; all fields still present (name/command name,
      description, tools/Nội dung, model picker, generate button, Nâng cao for agents).
- [ ] Header, tabs, footer all render correctly with reduced padding; no clipping.
- [ ] Both agent modal and workflow modal look consistent.

## Regression
- [ ] Save still works (Lưu button, validation errors still show).
- [ ] Live preview still updates as you type.
- [ ] Backdrop click / ✕ / Hủy still close the drawer.
