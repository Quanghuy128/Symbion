---
description: Run office-hours + plan automatically, stopping only for "taste" decisions (single approval gate)
---

**autoplan** for feature: **$ARGUMENTS** — run the planning sequence with minimal interruptions (borrowed from gstack /autoplan).

Auto-decide vs escalate principles:
- **Auto-decide** (decide without asking, document the choice): anything reversible, covered by a principle in CLAUDE.md / learnings.md, or a sensible stack default (e.g. keep `packages/core` pure, daemon = only disk-touching process, strict TS, backup-before-write + path confinement, never silent overwrite).
- **Escalate** (ask the user): one-way / hard-to-reverse decisions, core UX trade-offs, real product choices (e.g. auth method, data visibility rules, primary schema shape).

Process:
1. **office-hours (condensed)**: self-answer questions that have clear defaults; collect "taste" questions together.
2. **plan** (via `architect` subagent): build architecture + data flow + edge cases + **test plan** + DB changes.
3. **SINGLE APPROVAL GATE**: present to user — (a) decisions already made automatically (for awareness), (b) ONLY the taste questions that need a real decision (one batched AskUserQuestion).
4. After user answers → write scope to STATE under a `Scope` section and the plan under a heading containing `PLAN` (substring match, e.g. `## PLAN — Architecture`), plus the test plan to `docs/loops/<feature>-testplan.md` — ready for `/build`.
<!-- process-manager 2026-06-28: named the exact artifacts/headings (audit-process finding: autoplan described the output loosely ("write full STATE") while /plan.md names the testplan file explicitly — inconsistent precision between two commands producing the same artifact type). -->
<!-- retro 2026-06-28: corrected "## THINK" reference — no real STATE file uses that literal keyword; the checkable signal is a Scope section. -->

Goal: the user answers exactly once for decisions that genuinely need them, instead of being interrupted at every step.
