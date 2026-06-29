# load-existing-workflows — TEST PLAN

Companion to `load-existing-workflows-STATE.md` §10 (PLAN). Covers the new
`step` state machine in `CreateProjectDialog`, the extracted
`ImportReviewStep`, the new `WorkflowDetectionPanel`/`ImportScanningState`,
and the EC-4/empty-dir resolutions from §10.1/§10.5.

No daemon/RPC/core code changes are introduced by this loop (§10.7), so no
new Vitest coverage is required for `apps/daemon` or `packages/core` —
existing `scanClaudeDir`/`importArtifacts`/`parseClaudeDir`/`parseClaudeFile`
unit/integration tests are unchanged and must continue passing unmodified
(regression-only, not new-case, for those layers).

## A. Unit tests (Vitest) — `apps/web`

New/extended test files: `apps/web/src/components/__tests__/WorkflowDetectionPanel.test.tsx`,
`apps/web/src/components/__tests__/ImportReviewStep.test.tsx`,
`apps/web/src/components/__tests__/CreateProjectDialog.test.tsx` (extended or new).

### A1. `WorkflowDetectionPanel` (pure presentational)

1. `hasClaudeDir=true, importAvailable=true, hasAgentsMd=false` → renders both
   "Không, tạo trống" and "Có, nhập vào" buttons; clicking each calls
   `onDecline`/`onConfirm` exactly once, no other side effects.
2. `hasClaudeDir=true, importAvailable=false` (the empty-.claude/-dir case,
   §10.1) → this component should never even mount in that case per the
   parent's gating logic — covered by CreateProjectDialog tests (A3.4), not
   here; if mounted directly with this prop combo for isolation, it must
   still render only the decline action (no false "import" affordance),
   confirming the component itself never assumes `hasClaudeDir` alone means
   importable.
3. `hasClaudeDir=false, hasAgentsMd=true` (Codex-only, Q5) → renders the
   informational copy naming "AGENTS.md (Codex)", exactly one button
   ("Đã hiểu, tạo trống" / decline-only), and does NOT render any element
   that could be clicked to trigger an import action for AGENTS.md (assert
   absence, not just that `onConfirm` isn't wired).
4. `hasClaudeDir=true, hasAgentsMd=true, importAvailable=true` (both
   detected) → renders the "found: .claude/, AGENTS.md (informational)"
   combined copy; still exactly two action buttons (decline/confirm), the
   AGENTS.md mention has no separate button.

### A2. `ImportReviewStep` (pure presentational, extracted)

1. Given a `scanned` result with N agents + M commands, all ids present in
   `selected` → renders N+M checkboxes, all checked.
2. Toggling one checkbox calls `onToggle(id)` with the correct id exactly
   once; does not mutate `selected` itself (parent owns state — assert the
   component doesn't crash if `selected` prop doesn't change between
   renders, i.e. it's a controlled component).
3. Given `scanned.skipped` with 2 entries → renders both skipped reasons as
   text, and confirms no checkbox is rendered for skipped entries (matches
   ImportDialog's existing "skipped items not listed/selectable" behavior,
   regression-checked against the pre-extraction behavior).
4. Snapshot/structural equivalence check: rendering `ImportReviewStep` with
   the same props that `ImportDialog`'s pre-extraction inline JSX would have
   received produces the same visible text/structure (counts line, skipped
   lines, checkbox list) — guards against behavior drift during extraction.

### A3. `CreateProjectDialog` — step state machine

1. **Initial state**: `step === "form"`, no detection panel rendered, plain
   name+path fields, "Tạo dự án" button present and todays-disabled-until-valid
   behavior unchanged.
2. **No detection for an ordinary path**: mock `validatePath` to resolve
   `{ exists: true, isDir: true, hasClaudeDir: false, hasAgentsMd: false }`
   → assert `scanClaudeDir` is never called, `step` stays `"form"`.
3. **Detection fires for a real `.claude/` dir**: mock `validatePath` →
   `hasClaudeDir: true`; mock `scanClaudeDir` → `{ agents: [a], commands: [],
   skipped: [] }` → assert `scanClaudeDir` IS called automatically (no user
   click required) once `validatePath` resolves, and `step` transitions to
   `"detected"` with the panel visible naming ".claude/".
4. **Empty-`.claude/`-dir false positive is suppressed (§10.1's core fix)**:
   mock `validatePath` → `hasClaudeDir: true`; mock `scanClaudeDir` →
   `{ agents: [], commands: [], skipped: [] }` (e.g. only a stray
   `settings.json`) → assert the detection panel is NEVER rendered and
   `step` stays `"form"` even though `hasClaudeDir === true`. This is the
   single most important regression test for this loop — it directly
   verifies the STATE §7 risk note is closed.
5. **`hasAgentsMd`-only path (Q5)**: mock `validatePath` →
   `{ hasClaudeDir: false, hasAgentsMd: true }` → assert `scanClaudeDir` is
   STILL called eagerly only if `hasClaudeDir` (per §10.1's
   `showDetectionPanel` formula, `scanClaudeDir` is irrelevant to the
   AGENTS.md-only case since there's nothing to scan for Codex) — i.e.
   assert `scanClaudeDir` is NOT called when `hasClaudeDir === false`, and
   the panel still renders (informational-only variant) using `hasAgentsMd`
   alone.
6. **EC-4 guard**: with `projects` (from the store) containing
   `{ path: "/home/me/code/geochat" }` and the user typing that exact path →
   assert `scanClaudeDir` is NEVER called and the detection panel is NEVER
   shown, regardless of what `validatePath` returns for `hasClaudeDir` —
   assert instead the existing "already exists"/error affordance path is
   what renders (or that clicking "Tạo dự án" surfaces the
   `already-a-project` error exactly as today, if the UI defers the message
   to submit time — whichever the implementation picks, assert no import
   prompt ever appears).
7. **Decline path is zero-RPC beyond `validatePath`**: from `step ===
   "detected"`, click "Không, tạo trống" → assert no `scanClaudeDir` calls
   beyond the one eager call already made before the panel rendered (i.e.
   exactly one `scanClaudeDir` call total for the whole interaction), no
   `createProject`/`importArtifacts` calls, `step` returns to `"form"`,
   `declined === true`, and the plain "Tạo dự án" button is visible and
   enabled.
8. **Confirm path reuses the cached scan, zero extra RPC for the
   transition**: from `step === "detected"` (scan already resolved), click
   "Có, nhập vào" → assert `step` becomes `"review"` WITHOUT any new
   `scanClaudeDir` call (the cached result from step 3's eager call is
   reused) — directly tests §10.1's "S3 should rarely render" claim.
9. **Full happy path — confirm → review → import**: click "Có, nhập vào" →
   toggle off one checkbox → click "Nhập N mục đã chọn" → assert
   `createProject` is called once with the typed/derived name+path, then
   `importArtifacts` is called once with `projectId` from `createProject`'s
   result and `selectedIds` matching the post-toggle selection (i.e. the
   deselected item's id is excluded) → dialog closes.
10. **Path edited away mid-detection resets to form**: from `step ===
    "detected"`, edit the path field to a path with no `.claude/`/`AGENTS.md`
    → assert `step` resets to `"form"`, panel disappears.
11. **Path field disabled during scanning/review**: once `step` is
    `"scanning"` or `"review"`, assert the path `Input` and "Chọn…" button
    both have `disabled` set; once back to `"form"`/`"detected"`, assert
    they're enabled again.
12. **Scan RPC error surfaces inline, offers recovery**: mock the eager
    `scanClaudeDir` call to reject → assert an inline error renders with
    both "Thử lại" and "Tạo dự án trống" actions (per design §5), no
    unhandled promise rejection, dialog does not silently get stuck.
13. **AGENTS.md informational line never gains a checkbox/action**: in the
    "both `.claude/` and `AGENTS.md` detected" case (mock both true, scan
    returns ≥1 importable item), assert the rendered review step (S4) only
    ever lists `.claude/`-derived agents/commands as checkboxes — no
    AGENTS.md-derived entry appears in the checkbox list at any step.

### A4. `ImportDialog` (regression-only, refactor verification)

1. Existing `ImportDialog` behavior (scan → review → import) is unchanged
   after refactor: mock `scanClaudeDir`/`createProject`/`importArtifacts`
   exactly as today's existing test(s) do (if none exist yet, add the
   baseline scan→toggle→import happy-path test) and assert identical
   resulting RPC call sequence/args pre- and post-refactor.
2. `ImportReviewStep` is the component actually rendered inside
   `ImportDialog` post-refactor (e.g. via a test-id or structural assertion)
   — guards against the extraction silently duplicating JSX instead of
   delegating.

## B. End-to-end (Playwright / chrome-devtools journey)

Fixture setup: a scratch directory with a real `.claude/agents/*.md` +
`.claude/commands/*.md` structure (some valid, at least one with broken
frontmatter to exercise `skipped`), a separate scratch directory with an
empty `.claude/` (zero files) to exercise the false-positive fix, a separate
directory with only `AGENTS.md`, and a path already registered as a Symbion
project (has `.symbion/store.json`).

1. **Happy path — detect, confirm, import**: open "+ Tạo dự án", type the
   path to the fixture with real `.claude/` content → detection panel
   appears within a bounded wait (no manual scan click) naming ".claude/" →
   click "Có, nhập vào" → review screen shows correct agent/command counts
   and the one skipped file with its reason → uncheck one item → click
   "Nhập N mục đã chọn" → dialog closes → new project appears in the sidebar
   → opening it shows exactly the selected artifacts (and not the unchecked
   one) with `status: draft` (verifiable via the artifact editor's UI badge
   for draft/published, if surfaced) → confirm the original `.claude/*.md`
   files on disk are byte-for-byte unchanged (e.g. via the fixture's
   checksum before/after).
2. **Decline path**: same starting point, click "Không, tạo trống" → plain
   form returns with hint text confirming decline (wireframe d) → click
   "Tạo dự án" → empty project created → confirm `.claude/` files on disk
   are untouched → confirm the project's store has zero artifacts.
3. **Empty-`.claude/`-dir false positive**: point at the empty-`.claude/`
   fixture → assert the detection panel NEVER appears, "Tạo dự án" is the
   only/normal action, no loading spinner ever flashes either (the eager
   scan happens but yields nothing, so UI stays on plain form throughout).
4. **AGENTS.md-only informational case**: point at the AGENTS.md-only
   fixture → detection panel appears, naming "AGENTS.md (Codex)", only one
   action button, clicking it creates an empty project, confirm `AGENTS.md`
   on disk is untouched afterward.
5. **EC-4 already-a-project guard**: point at the path that already has
   `.symbion/store.json` → assert the detection/import panel never appears
   at any point, and the existing "already a project" UX (error or redirect)
   is what the user sees instead — this must hold even though that path's
   `.claude/` dir (if any) also has real importable content, proving the
   EC-4 check wins over the detection check.
6. **Re-prompt with no memory (Q4)**: decline once, close the dialog, reopen
   "+ Tạo dự án", type the exact same path again → detection panel reappears
   (nothing remembered), confirming Q4's locked decision.
7. **Cancel via Hủy/Escape at every step is a clean no-op**: from each of
   S1/S2(detected)/S3(scanning, if reachable)/S4(review), click "Hủy" (or
   press Escape) → dialog closes, no RPC side effects beyond whatever
   read-only calls had already completed, no project created, no files
   touched — repeat for all 4 steps as 4 separate assertions/scenarios.

## C. Out of scope for this test plan (per STATE/design "Future Ideas")

- `AGENTS.md` → IR import correctness (no parser exists; nothing to test).
- Import-into-an-existing-non-empty-project UI (no entry point built this
  loop; `importArtifacts`'s merge behavior for that case is already covered
  by existing daemon-side tests, unchanged).
- `.github/` detection (explicitly out of v1 provider scope).
- Marker-stamping on import (Q1 locked to "never" — no test needed for a
  behavior that must not exist; if a future regression introduces it, that
  would be caught by EC-1-style "original file unchanged" assertions above,
  e.g. B1's checksum check, which would fail if a marker were silently
  added).
