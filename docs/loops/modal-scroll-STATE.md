# Modal vertical scroll — STATE

## Scope (trivial, fast-track /simplify-implementation)

Bug: the import dialog can't scroll vertically. With a repo like `vpo` producing
~12 agents + 5 commands + ~14 skipped-file reclassify rows + the checkbox list +
"Browse files manually" button, the dialog panel grows taller than the viewport
and the overflowing rows become **unreachable — there is nothing to scroll**.

Small, reversible, presentation-only CSS fix. No RPC, no fs, no daemon, no
secrets. Eligible for the fast-track.

## PLAN — root cause & fix

Root cause: the shared `Dialog` panel (`apps/web/src/components/ui/dialog.tsx`)
is centered in a `fixed inset-0 flex` overlay with **no `max-height` and no
`overflow`**, so it expands to fit content and extends off-screen. Secondary:
the skipped-files list in `ImportReviewStep` had no height cap (unlike the
agents/commands checkbox list, which already had `max-h-48 overflow-y-auto`).

Fix (2 edits):
1. `ui/dialog.tsx` — panel gets `flex max-h-[85vh] flex-col overflow-y-auto` so
   it never exceeds the viewport and its body scrolls. Shared primitive → fixes
   this modal AND every other dialog with the same latent overflow.
2. `ImportReviewStep.tsx` — skipped-files container gets `max-h-48 overflow-y-auto`,
   matching the existing checkbox list, so a long skipped list stays bounded
   inside the (now-scrollable) dialog.

## BUILD — implementation notes

- Edited `apps/web/src/components/ui/dialog.tsx` (panel max-height + scroll).
- Edited `apps/web/src/components/ImportReviewStep.tsx` (skipped-list cap).
- Verified: `npm run build -w apps/web` — compiled clean, typecheck + lint pass.
- Not live-verified in a browser (fast-track); a manual QA pass in the running
  app would confirm the scroll behavior visually.

## Ship status: FIX APPLIED, NOT COMMITTED (deliberate)

Per user decision: the working tree also holds the in-flight `manual-file-picker`
feature whose `/cso` F1 security fix has NOT been re-audited. `git add -A` +
commit would sweep that un-re-audited security change in with this CSS fix,
bypassing the mandatory `/cso` re-pass. So this fix is applied to the working
tree only — it will be committed together with manual-file-picker once `/cso`
re-passes. The fast-track's own note warns against committing across a trust
boundary; honoring that here.

---

## Follow-up: FolderBrowserDialog sizing + pinned footer (2026-07-13)

Reported: the "Select a folder" browse modal is too small, and its Cancel /
"Select this folder" buttons scroll away instead of staying in a fixed footer.

Root cause (same thread as the modal-scroll fix): the shared Dialog panel is now
`max-h-[85vh] overflow-y-auto`, so `DialogFooter` — a normal flex child of the
panel — scrolled WITH the panel. The footer was structurally present but not
pinned. Size: panel `w-[480px]` + inner list `max-h-72` (288px) read as cramped.

Fix (per-dialog, does NOT touch the shared primitive — user decision):
- `FolderBrowserDialog` panel → `flex w-[640px] flex-col` (wider).
- Body wrapper → `flex min-h-0 flex-1 flex-col`; the list → `min-h-0 flex-1
  overflow-y-auto max-h-[55vh]`. The INNER LIST is now the single scroll region,
  so header + footer pin while only the folder list scrolls. Total height stays
  under 85vh so the shared panel itself doesn't scroll.
- Verified: `npm run build -w apps/web` clean. Not browser-verified (no Chrome in
  this env) — a manual glance in the running app would confirm the pin visually.

NOT committed (same rationale as the parent fix — waits for the combined
manual-file-picker + import-lifecycle commit after /qa).

---

## Round 3: pinned footer — fixed at the PRIMITIVE (reverses per-dialog decision)

The round-2 per-dialog FolderBrowserDialog fix DID NOT WORK (user: "chưa fixed" +
screenshot showing list only, no header/footer). Root cause of the failure (3-strike
challenge-the-architecture): the shared Dialog panel was `max-h-[85vh] overflow-y-auto
flex flex-col` — a MAX-HEIGHT panel that scrolls AS A WHOLE. No per-dialog flex trick
can pin a footer inside it, because when content overflows the PANEL scrolls, carrying
header+footer out of view. Trying to pin inside a scrolling max-h panel is the wrong
layer. Confirmed: apps/web/out/ was fresh (not a staleness issue) — the fix was
genuinely wrong.

Fix (PRIMITIVE — ui/dialog.tsx, reverses the earlier "per-dialog only" decision because
that approach was proven impossible):
- Panel: removed `overflow-y-auto`; now `flex max-h-[85vh] flex-col` (fixed-height flex
  column, does NOT scroll itself).
- DialogHeader + DialogFooter: added `shrink-0` → fixed slots that never scroll/compress.
- NEW `DialogBody` component: `min-h-0 flex-1 overflow-y-auto` — the single scroll region
  between header and footer. Header + footer now pin for EVERY dialog.

Blast radius (removing panel-scroll means any tall-content dialog needs DialogBody or it
clips). Audited all 12 footer dialogs:
- CONVERTED to DialogBody (relied on panel scroll / have tall content): FolderBrowserDialog,
  ImportDialog, CreateProjectDialog, TemplatePreviewModal (renders full template raw),
  PublishResultView (variable-length errors list).
- SAFE without DialogBody (already had inner overflow, or short/bounded content):
  PublishDiffView (own max-h-96 overflow-y-auto), CopyRunCommandDialog, PublishDialog,
  GenerateBodyButton + GenerateDescriptionButton ("Replace content?" confirms),
  graph/EdgeRelationModal (stepper + one textarea).

Verified: `npm run build -w apps/web` clean, out/ rebuilt 20:58. NOT browser-verified
(no Chrome in env). ⚠️ The 5 converted dialogs + the primitive change should get a visual
QA pass — this touches a shared component used by all 12 modals.

NOT committed (waits for the combined post-/qa commit).
