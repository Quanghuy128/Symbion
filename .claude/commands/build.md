---
description: Step 3 of the pipeline — Maker (feature-builder) codes the feature from the plan
---

You are at the **build** step of the Symbion pipeline.

Feature: **$ARGUMENTS**

<!-- process-manager 2026-06-28: added precondition guard for missing PLAN/testplan (audit-process finding: build had no check that /plan actually ran or produced a testplan — a broken upstream handoff was only discovered 2 stages later, at /qa). -->
**Precondition**: read `docs/loops/<feature>-STATE.md`.
- If it has no heading containing `PLAN` (substring match — real STATE files write `## 6. PLAN — Architecture`-style headings, not the bare keyword alone) → stop and confirm with the user whether this is intentionally a no-plan/trivial change (e.g. routed here directly from `/analyze`) before proceeding. Do not silently invent a plan inline.
- If `docs/loops/<feature>-testplan.md` is missing despite a PLAN section existing → warn the user explicitly (this indicates `/plan` didn't finish cleanly) before continuing.
- If the feature has a UI surface and `docs/loops/<feature>-design.md` exists, read it too.

<!-- retro 2026-06-28: corrected "## PLAN section" exact-match wording to substring match, same fix applied across all commands referencing STATE headings — see docs/learnings.md "Process audit" entry. -->

**Invoke the `feature-builder` subagent** (Maker) via the Agent tool to implement the feature according to the plan in `docs/loops/<feature>-STATE.md`.

IMPORTANT — enforcing the Maker ≠ Checker principle:
- The Maker (feature-builder) only codes + updates STATE + lists assumptions.
- Do NOT let the Maker conclude "looks good." Verification is done by `/review` and `/qa` (independent Checker).

Pass to feature-builder: feature name, path to STATE, the plan, and an explicit request to list every assumption for the Checker to verify.

The Maker updates STATE under a heading containing `BUILD` (files changed, assumptions, anything deferred) — substring match, e.g. `## 11. BUILD — implementation notes` is fine, the bare word doesn't need to stand alone.

After the Maker finishes, suggest running `/review`.
