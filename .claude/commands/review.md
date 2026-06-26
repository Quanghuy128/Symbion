---
description: Step 4 of the pipeline — independent Checker (code-reviewer + architect) reviews the built code
---

You are at the **review** step of the Symbion pipeline.

Feature: **$ARGUMENTS**

Run two independent review agents in parallel via the Agent tool:

**1. `code-reviewer`** (Checker) — standard code review:
- Pass: feature name + path to STATE + plan + acceptance criteria.
- Pass: the full list of assumptions the Maker listed (ask it to verify each one).
- Pass: the diff/changed files (run `git diff` first to gather them).
- Returns findings 🔴/🟡/🟢 + verdict PASS/NEEDS-WORK.

**2. `architect`** (architectural review) — design conformance:
- Pass: the same diff + the original design from STATE.
- Ask it to assess: does the implementation match the design? Any architectural drift, unnecessary complexity, or missing edge-case handling?
- Returns architectural findings + verdict.

Aggregate both verdicts:
- Any NEEDS-WORK finding → return to `/build` for the Maker to fix (pass all findings), then re-run `/review`.
- Both PASS → write the review result to STATE, then suggest running `/qa`.
