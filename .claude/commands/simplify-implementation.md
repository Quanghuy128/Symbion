---
description: Condensed pipeline for simple/trivial changes — analyze → build → review → ship, skipping design/plan/qa
---

You are running **simplify-implementation** for: **$ARGUMENTS**

This is a lightweight variant of `/autopilot` for changes small enough that a full design/plan/QA pass is overkill (e.g. a one-file fix, a small UI tweak, a straightforward wiring change). It runs: **ANALYZE → BUILD → REVIEW → SHIP**. Design, plan, and QA phases are intentionally skipped.

Before starting, briefly confirm to the user that this request looks trivial enough to skip design/plan/qa. If mid-analysis it turns out the change is more involved than expected (touches daemon RPC/fs-write/secrets, needs a real architecture decision, or has a UI surface needing design), stop and recommend the user run `/autopilot` or the full pipeline (`/analyze` → `/plan` → `/build` → `/review` → `/qa` → `/ship`) instead.

**Feature slug**: derive a kebab-case slug from `$ARGUMENTS` (state it back to the user) — used for `docs/loops/<feature>-STATE.md`.

---

## Step 1 — ANALYZE

Invoke the `ba` subagent (Agent tool) with:
"Analyze this request for Symbion: '$ARGUMENTS'
Read CLAUDE.md and any existing docs/loops/ STATE files for context.
Produce: core user need, functional requirements (kept minimal — this is a small/trivial change), key edge cases, and acceptance criteria (measurable, not vague).
Also assess: is this actually trivial (single small change, no new architecture, no new UI surface), or does it need a full plan/design? Flag explicitly if it's bigger than it looks.
Write output to docs/loops/<feature>-STATE.md under a section clearly labeled Requirements/Analysis.
Return: a 2-sentence summary + the triviality assessment."

If the `ba` agent flags this as non-trivial → stop, tell the user, and recommend `/autopilot` or `/plan` instead of continuing.

---

## Step 2 — BUILD

**Precondition**: confirm `docs/loops/<feature>-STATE.md` has the Requirements/Analysis section from Step 1 (no PLAN section is expected or required here — that's expected for this condensed flow).

Invoke the `feature-builder` subagent (Maker) with:
"Implement this Symbion change: '$ARGUMENTS'
Read docs/loops/<feature>-STATE.md for the requirements from Step 1.
This is a small/trivial change — implement directly without inventing extra architecture or scope.
List every assumption you make for the Checker to verify.
Update STATE under a heading containing BUILD (files changed, assumptions, anything deferred).
Do NOT self-review — that's the Checker's job."

---

## Step 3 — REVIEW

**Precondition**: STATE has a heading containing `BUILD`.

**Security-review trigger check**: run `git diff --stat`. If the diff touches `apps/daemon/` RPC handlers, filesystem-write/path-handling code, or secret storage, tell the user this qualifies for `/cso` per CLAUDE.md — recommend running it before `/ship`, don't skip it silently.

Run two review agents in parallel (single Agent message, two calls):

**`code-reviewer`**: "Review the implementation of '$ARGUMENTS'.
Read docs/loops/<feature>-STATE.md (requirements + BUILD notes) as the acceptance standard.
Run git diff to see changed files.
Check: requirement compliance, bugs, filesystem safety (path confinement, backup-before-write, never overwrite foreign files, core stays pure), conventions (CLAUDE.md).
Return findings 🔴/🟡/🟢 + verdict PASS or NEEDS-WORK."

**`architect`**: "Architectural review for '$ARGUMENTS'.
Run git diff. Since this change skipped a formal plan/design phase, assess whether the implementation introduces any architecture drift, unnecessary complexity, or violates Symbion's core/daemon/web boundary rules.
Return findings + verdict PASS or NEEDS-WORK."

Aggregate verdicts:
- Any 🔴 NEEDS-WORK → send findings back to `feature-builder` to fix, then re-run this review step once.
- All PASS → write the review result to STATE under a heading containing `REVIEW`, then proceed to `/ship`.

---

## Step 4 — SHIP

Same gate discipline as `/ship`, adapted for this condensed flow:

**Precondition** — read `docs/loops/<feature>-STATE.md` and verify:
- The section whose heading contains `REVIEW` says PASS.
- No QA section is required for this flow — but if `git diff --stat` shows the change touches daemon RPC/fs-write/secrets, stop and require `/cso` to run (and pass) before shipping.

1. Run `npm run build` one final time to confirm clean.
2. Update `docs/loops/<feature>-STATE.md`: mark Done, note explicitly that design/plan/qa were skipped as part of `/simplify-implementation`.
3. Add any notable pattern to `docs/learnings.md` (only if genuinely non-obvious).
4. `git add -A` → confirm `.env.local`/secrets are NOT staged → commit with a message describing the change + "shipped via /simplify-implementation (condensed pipeline)."
5. Report: what shipped, findings resolved, and that design/plan/qa were intentionally skipped.
6. Suggest `/canary` to monitor for regressions post-ship.
