---
description: Step 2 of the pipeline — design architecture + data flow + edge cases for the feature
---

You are at the **plan** step of the Symbion pipeline.

Feature: **$ARGUMENTS** (read the locked scope from `docs/loops/<feature>-STATE.md`).

<!-- process-manager 2026-06-28: added precondition guard + design-doc read (audit-process finding: /plan never checked THINK existed, and silently ignored /design's output even when present). -->
**Precondition**: read `docs/loops/<feature>-STATE.md`. If it has no `Scope` section (the real, checkable signal that `/office-hours` ran — no real STATE file ever contains the literal word "THINK," that's a pipeline-stage name, not heading vocabulary), stop and tell the user to run `/office-hours` first (or confirm explicitly this is an intentionally skipped step before proceeding). <!-- retro 2026-06-28: corrected from "exact `## THINK` heading," then corrected again from a substring-match version of the same mistake — see office-hours.md's matching note. -->

**If `docs/loops/<feature>-design.md` exists**, read it too — incorporate its UI/UX decisions (screen inventory, component breakdown) into the architecture rather than re-deriving them. If it doesn't exist, that's fine (not every feature needs a design pass) — proceed on STATE alone.

**Invoke the `architect` subagent** via the Agent tool to produce the technical design.

Pass to architect:
- Feature name + path to STATE file + the scope/spec already written + path to the design doc if one exists.
- Ask it to produce: architecture (package/app boundaries, files, daemon RPC surface), data flow (web UI → daemon RPC → filesystem/git → UI), edge cases, the local-store schema (init/migration — there is no SQL DB), and a test plan.
- Ask it to actively flag flaws in the design/spec itself, not only implementation risk — the architect should not treat a prior design doc (even one it wrote in a past `/plan` re-run) as infallible.

The architect writes the plan to `docs/loops/<feature>-STATE.md` under a heading containing the keyword `PLAN` (e.g. `## 6. PLAN — Architecture` — a substring match, not a bare `## PLAN` literal; `/build`/`/review`/`/qa` check for the keyword, not an exact string) and creates `docs/loops/<feature>-testplan.md` — the handoff artifact that `/qa` will read and execute step-by-step.

After the architect finishes, suggest running `/build`.
