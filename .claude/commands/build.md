---
description: Step 3 of the pipeline — Maker (feature-builder) codes the feature from the plan
---

You are at the **build** step of the Symbion pipeline.

Feature: **$ARGUMENTS**

**Invoke the `feature-builder` subagent** (Maker) via the Agent tool to implement the feature according to the plan in `docs/loops/<feature>-STATE.md`.

IMPORTANT — enforcing the Maker ≠ Checker principle:
- The Maker (feature-builder) only codes + updates STATE + lists assumptions.
- Do NOT let the Maker conclude "looks good." Verification is done by `/review` and `/qa` (independent Checker).

Pass to feature-builder: feature name, path to STATE, the plan, and an explicit request to list every assumption for the Checker to verify.

After the Maker finishes, suggest running `/review`.
