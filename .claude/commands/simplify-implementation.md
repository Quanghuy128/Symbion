---
description: Fast-track a small, low-risk change through plan → build → deploy (ship) with no separate analyze/design/review/qa steps
---

**simplify-implementation** for change: **$ARGUMENTS** — the condensed pipeline for small, well-understood work that doesn't warrant the full analyze → design → review → qa loop.

Use this when the change is small and reversible and the scope is already clear (bug fix, small refactor, wiring, tech debt). If scope is genuinely vague, stop and point the user at `/analyze` + `/office-hours` instead — this command does NOT clarify product scope.

It chains three existing stages back-to-back on `docs/loops/<feature>-STATE.md`: **plan → build → deploy(ship)**.

## 1. plan
Run the `/plan` step: invoke the `architect` subagent to produce architecture + data flow + edge cases + a test plan.
- The architect writes the plan to `docs/loops/<feature>-STATE.md` under a heading containing the keyword `PLAN` (substring match — real headings are decorated, e.g. `## 6. PLAN — Architecture`, not a bare `## PLAN`) and creates `docs/loops/<feature>-testplan.md`.
- **Precondition**: if STATE has no `Scope` section (the checkable signal that scope was locked), confirm with the user this is an intentionally trivial change before proceeding — do not silently invent scope inline.

## 2. build
Run the `/build` step: invoke the `feature-builder` subagent (Maker) to implement from the plan.
- **Precondition**: STATE must have a heading containing `PLAN` (substring match) and `docs/loops/<feature>-testplan.md` must exist — both produced by step 1. If either is missing, stop (step 1 didn't finish cleanly).
- Maker ≠ Checker: the Maker only codes + updates STATE (under a heading containing `BUILD`) + lists assumptions. It must NOT conclude "looks good."

## 3. deploy (ship)
Run the `/ship` step to close out and deploy the change.
- Run `npm run build` one final time to confirm clean.
- Mark STATE Done, recording what was verified.
- `git add -A` → confirm `.env.local`/secrets are NOT staged → commit with a message describing the change + "shipped through the simplify-implementation fast-track (plan→build→ship)."

<!-- Note on the skipped checks: this fast-track deliberately omits the independent /review + /qa Checker stages that /ship normally gates on. That trade-off is only sound for small, reversible, low-risk changes. If the change touches daemon RPC handlers, filesystem-write/path-handling, or secret storage (a trust boundary), DO NOT use this command — run the full pipeline with /review, /qa, and /cso, because those changes need an independent Checker per CLAUDE.md. When in doubt, record in STATE that review/qa were intentionally skipped and name the residual risk. -->

Goal: get a small change from clear scope to a committed deploy in one command, without ceremony that its size doesn't justify.
