---
description: Step 4 of the pipeline — independent Checker (code-reviewer + architect) reviews the built code
---

You are at the **review** step of the Symbion pipeline.

Feature: **$ARGUMENTS**

<!-- process-manager 2026-06-28: added precondition + cso trigger check + fixed STATE heading (audit-process finding: review never checked BUILD existed, never flagged when /cso applies, and "write the review result to STATE" had no fixed heading so every feature invented its own). -->
**Precondition**: read `docs/loops/<feature>-STATE.md`. If it has no heading containing `BUILD` (substring match, not an exact `## BUILD` literal — see CLAUDE.md's pipeline note), stop and tell the user `/build` hasn't run yet (or hasn't recorded its report).

**Security-review trigger check**: run `git diff --stat` and check whether the diff touches `apps/daemon/` RPC handlers, filesystem-write/path-handling code, or secret storage. If so, tell the user this change qualifies for `/cso` per CLAUDE.md's security model — recommend running it alongside or right after this review, don't let it be silently skipped.

Run two independent review agents in parallel via the Agent tool:

**1. `code-reviewer`** (Checker) — standard code review:
- Pass: feature name + path to STATE + plan + acceptance criteria.
- Pass: the full list of assumptions the Maker listed (ask it to verify each one).
- Pass: the diff/changed files (run `git diff` first to gather them).
- Returns findings 🔴/🟡/🟢 + verdict PASS/NEEDS-WORK.

**2. `architect`** (architectural review) — design conformance:
- Pass: the same diff + the original design from STATE.
- Ask it to assess: does the implementation match the design? Any architectural drift, unnecessary complexity, or missing edge-case handling?
- Ask it to also flag flaws in the *original design itself* if it finds any — not just implementation drift. Authoring the PLAN and reviewing conformance to it both fall to `architect`; treat that as a reason to scrutinize the design harder, not a reason to assume it was right.
- Returns architectural findings + verdict.

Aggregate both verdicts:
- Any NEEDS-WORK finding → return to `/build` for the Maker to fix (pass all findings), then re-run `/review`.
- Both PASS → write the review result to STATE under a heading containing `REVIEW` (substring match), then suggest running `/qa` (and `/cso` first/alongside if the trigger check above applies).

<!-- retro 2026-06-28: corrected exact-heading wording to substring match across this and other commands — every real STATE file uses decorated headings, not the bare keyword alone. -->
