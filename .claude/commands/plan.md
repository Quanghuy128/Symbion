---
description: Step 2 of the pipeline — design architecture + data flow + edge cases for the feature
---

You are at the **plan** step of the Symbion pipeline.

Feature: **$ARGUMENTS** (read the locked scope from `docs/loops/<feature>-STATE.md`).

**Invoke the `architect` subagent** via the Agent tool to produce the technical design.

Pass to architect:
- Feature name + path to STATE file + the scope/spec already written.
- Ask it to produce: architecture (package/app boundaries, files, daemon RPC surface), data flow (web UI → daemon RPC → filesystem/git → UI), edge cases, the local-store schema (init/migration — there is no SQL DB), and a test plan.

The architect writes the plan to `docs/loops/<feature>-STATE.md` (phase PLAN) and creates `docs/loops/<feature>-testplan.md` — the handoff artifact that `/qa` will read and execute step-by-step.

After the architect finishes, suggest running `/build`.
