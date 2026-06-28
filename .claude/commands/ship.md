---
description: Step 6 of the pipeline — close out the feature: final test + update STATE/learnings + commit
---

You are at the **ship** step of the Symbion pipeline.

Feature: **$ARGUMENTS**

Only ship after both `/review` PASS and `/qa` PASS.

<!-- process-manager 2026-06-28: added explicit /review+/qa+/cso precondition gate (audit-process finding: ship's gate was stated in prose but never mechanically checked against STATE, and never checked /cso at all despite CLAUDE.md requiring it for RPC/fs-write/secrets changes). -->
**Precondition — read `docs/loops/<feature>-STATE.md` and verify, don't assume:**
- The section whose heading contains `REVIEW` (substring match — real headings are decorated, e.g. `## 12. REVIEW — code-reviewer + architect`, not a bare `## REVIEW`) says PASS (or the user explicitly waived it for a trivial change — confirm, don't guess).
- The section whose heading contains `QA` says PASS (or the user explicitly chose to skip the live QA pass — if so, this MUST already be recorded in STATE with the residual risk named; if it isn't recorded, stop and ask the user to confirm the skip explicitly before shipping, then write it down before continuing).
- If `git diff --stat` shows changes touching daemon RPC handlers, filesystem-write/path-handling, or secret storage: confirm STATE records a section whose heading contains `CSO`, with a PASS verdict. If `/cso` never ran on a change that qualifies, stop and recommend running it before shipping — do not ship an unreviewed new trust-boundary change.

<!-- retro 2026-06-28: corrected exact-heading-match wording to substring match. The original /audit-process fix assumed bare "## REVIEW"/"## QA"/"## CSO" headings; retro found every real STATE file in this session uses decorated headings instead, which an exact match would silently fail to find — exactly the kind of gap this gate exists to prevent. -->

1. Run `npm run build` one final time to confirm clean.
2. Update `docs/loops/<feature>-STATE.md`: mark Done, record what was verified (and any explicitly-accepted skipped checks from the precondition above).
3. Add patterns learned to `docs/learnings.md` (with confidence level).
4. `git add -A` → confirm `.env.local`/secrets are NOT staged → commit with a message describing the feature + "shipped through Maker→Checker pipeline."
5. Report: feature shipped, findings resolved, remaining tech debt.
6. Suggest `/canary` to monitor for regressions post-ship, and `/document-release` if user-facing docs need syncing.
