---
description: Analyze a user request — 3 parallel BA agents research requirements, then synthesize solutions and ideas
---

You are at the **analyze** step.

Request to analyze: **$ARGUMENTS**

<!-- process-manager 2026-06-28: added persistence step (audit-process finding: /analyze was the only pipeline stage producing zero file artifact — synthesis only lived in chat and was lost on session reset, unlike autopilot's own ANALYZE-section behavior). -->
**Feature slug**: derive a kebab-case slug from `$ARGUMENTS` (state it back to the user) — this is the same slug `/office-hours`/`/design`/`/plan` will use for `docs/loops/<feature>-STATE.md`.

Spin up **3 independent BA agents in parallel** using the Agent tool (subagent_type: `ba`), each approaching the request from a different angle. Send all 3 Agent calls in a single message so they run concurrently.

**Agent 1 — Requirements Analyst**
Prompt: "Analyze this request from a requirements perspective: '$ARGUMENTS'
Focus on:
- Core user need and underlying motivation (the 'why')
- Functional requirements (what the system must do)
- Non-functional requirements (performance, security, scalability)
- Explicit constraints and implicit assumptions
- Acceptance criteria — how would you know this is done?
Read relevant files in the codebase to ground your analysis. Return a structured requirements breakdown."

**Agent 2 — Solution Architect**
Prompt: "Analyze this request from a solution/architecture perspective: '$ARGUMENTS'
Focus on:
- 2–3 concrete solution approaches (with trade-offs for each)
- Which approach fits best given the current stack (TypeScript monorepo (core + daemon + web))
- Files/modules likely impacted
- Potential edge cases and risks
- Implementation complexity estimate (S/M/L/XL)
Read the codebase to ground your analysis in what already exists. Return ranked solution options."

**Agent 3 — Ideas & Opportunities**
Prompt: "Analyze this request from a creative/product perspective: '$ARGUMENTS'
Focus on:
- Ideas that go beyond the literal request — what could make this 10× better?
- Related improvements or features that would naturally pair with this
- UX considerations and user journey
- Anything that could be simplified or deferred to a future iteration
- Open questions that stakeholders should answer before committing
Read the codebase for context. Return creative ideas and open questions."

---

After all 3 agents finish, synthesize their outputs into a single response structured as:

## Requirements
(from Agent 1 — key needs, constraints, acceptance criteria)

## Solution Options
(from Agent 2 — ranked approaches with trade-offs)

## Ideas & Open Questions
(from Agent 3 — creative angles + questions to resolve)

## Recommended Next Step
Based on the synthesis: suggest whether to jump to `/office-hours` (scope still fuzzy), `/plan` (scope clear, ready to design), or `/build` (trivial change, design implicit).

---

Write this synthesis to `docs/loops/<feature>-STATE.md` (clearly-labeled sections — e.g. `## Requirements`, `## Solution Options`, `## Open Questions` — exact wording is yours) before ending your turn — so the analysis survives a session reset and `/office-hours`/`/plan` have a real artifact to read instead of relying on conversation context.

<!-- retro 2026-06-28: dropped the "literal ## ANALYZE heading" instruction — like THINK, no real STATE file uses that literal keyword; ANALYZE/THINK are pipeline-stage names, not heading vocabulary the docs actually use. PLAN/BUILD/REVIEW/QA/CSO are different — those DO appear verbatim in real headings, confirmed by grep. -->
