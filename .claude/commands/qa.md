---
description: Step 5 of the pipeline — Checker runs the feature live (build + dev + behavior verification)
---

You are at the **qa** step of the Symbion pipeline.

Feature: **$ARGUMENTS**

**Read the test plan first**: if `docs/loops/<feature>-testplan.md` exists (created by `/plan`) → follow each step as the acceptance standard. Otherwise fall back to the acceptance criteria in STATE.

Verify real behavior (not just reading code):
1. `npm run build` — must pass (typecheck + lint).
2. `npm run dev` (background) → wait until ready → verify root route returns 200 and no runtime errors in the log.
3. Verify each acceptance criterion from STATE: run the `packages/core` unit tests + the daemon RPC integration tests (scan→render→diff→write against a temp repo); for the web journey use chrome-devtools if Chrome is available. Assert on-disk files are byte-valid + contain managed markers, and that conflicts/foreign files are never silently overwritten.
4. Use the design doc/scope as the standard — do NOT pass just to be done.

Write PASS/FAIL result to STATE.
- FAIL → return to `/build`.
- PASS → suggest running `/ship`.

Remember to TaskStop the dev server when done.
