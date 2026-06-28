---
description: Step 5 of the pipeline — Checker runs the feature live (build + dev + behavior verification)
---

You are at the **qa** step of the Symbion pipeline.

Feature: **$ARGUMENTS**

<!-- process-manager 2026-06-28: added review-passed precondition + fixed STATE heading + explicit warn-on-missing-testplan (audit-process finding: qa never checked /review actually passed, and silently downgraded to STATE-only acceptance criteria with no warning when the testplan was supposed to exist but didn't). -->
**Precondition**: read `docs/loops/<feature>-STATE.md`. If it has a section whose heading contains `REVIEW` (substring match — real headings look like `## 12. REVIEW — code-reviewer + architect`), confirm it says PASS — if it says NEEDS-WORK or is missing despite a BUILD section existing, stop and tell the user to run/finish `/review` first. (If there's no REVIEW section at all because review was intentionally skipped for a trivial change, proceed but note that in the QA report.)

**Read the test plan**: if `docs/loops/<feature>-testplan.md` exists (created by `/plan`) → follow each step as the acceptance standard. If STATE shows a PLAN phase completed but the testplan file is missing, **warn the user explicitly** — this likely means `/plan` didn't finish writing its artifacts — before falling back to the acceptance criteria in STATE.

<!-- retro 2026-06-28: corrected exact-heading wording to substring match — see CLAUDE.md's pipeline note and docs/learnings.md's "Process audit" entry. -->

Verify real behavior (not just reading code):
1. `npm run build` — must pass (typecheck + lint).
2. `npm run dev` (background) → wait until ready → verify root route returns 200 and no runtime errors in the log.
3. Verify each acceptance criterion from STATE: run the `packages/core` unit tests + the daemon RPC integration tests (scan→render→diff→write against a temp repo); for the web journey use chrome-devtools if Chrome is available. Assert on-disk files are byte-valid + contain managed markers, and that conflicts/foreign files are never silently overwritten.
4. Use the design doc/scope as the standard — do NOT pass just to be done.

Write PASS/FAIL result to STATE under a heading containing `QA` (substring match). If any testplan item (especially a manual/Tier-D item) could not be run live, record it as an explicit skip + residual risk — not a silent omission.
- FAIL → return to `/build`.
- PASS → suggest running `/ship`.

Remember to TaskStop the dev server when done.

<!-- process-manager 2026-06-28: documented QA's agent-ownership as an explicit decision (audit-process finding: every other pipeline stage names a subagent — feature-builder/code-reviewer/architect/security-reviewer — but QA had none, leaving it ambiguous whether that was an oversight). -->
**Why no named subagent here**: unlike `/build`/`/review`/`/cso`, QA is intentionally run by the orchestrating thread itself, not a delegated subagent. Its job is mechanical verification (run build, run tests, exercise the testplan, record pass/fail) — not a judgment call about code quality or design conformance, which is what `code-reviewer`/`architect`/`security-reviewer` exist for. There is no self-review risk here because QA does not author anything it's then checking; it just executes and reports. If this ever needs to become its own subagent (e.g. to run in isolation/parallel with other work), that's a deliberate future change, not a gap to silently patch.
