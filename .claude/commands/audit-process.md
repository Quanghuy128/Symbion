---
description: Audit the autoworkflow pipeline — 3 parallel process-manager angles (role clarity, handoff contracts, SOP quality) then synthesize findings and apply fixes
---

You are running the **audit-process** step — a periodic quality check on the Symbion autoworkflow machine itself (not the product code).

Spin up **3 independent process-manager agents in parallel** using the Agent tool (subagent_type: `process-manager`), each auditing a different dimension of the pipeline. Send all 3 Agent calls in a single message so they run concurrently.

---

**Agent 1 — Role & Responsibility Auditor**
Prompt: "You are the Process Manager for Symbion. Audit the AGENTS layer of the pipeline.

Read every file in .claude/agents/ and the pipeline section of CLAUDE.md.

For each agent, assess:
- Is the role clearly scoped? No ambiguity about what this agent owns vs doesn't own?
- Are MUST NOT rules explicit? Are there gaps where two agents could claim the same responsibility?
- Does the output contract (what the agent produces) match what downstream stages actually need?
- Is the agent's tool list (Read/Write/Bash etc.) appropriate for its role — not too broad, not missing?

Return a structured findings list: 🔴 critical / 🟡 warning / 🟢 improvement.
For each finding: agent file + specific section + issue + recommended fix.
Do NOT apply fixes yet — report only."

**Agent 2 — SOP & Command Auditor**
Prompt: "You are the Process Manager for Symbion. Audit the COMMANDS layer of the pipeline.

Read every file in .claude/commands/ and the pipeline section of CLAUDE.md.

For each command, assess:
- Are input preconditions stated? (e.g. 'requires STATE file from /office-hours')
- Is the output artifact precisely defined? (filename, directory, section names)
- Is the handoff to the next step explicit? Does the command tell the agent what to do next?
- Is the prompt given to subagents specific enough, or is it too vague to produce consistent output?
- Are there pipeline stages in CLAUDE.md with no corresponding command?

Return a structured findings list: 🔴 critical / 🟡 warning / 🟢 improvement.
For each finding: command file + specific section + issue + recommended fix.
Do NOT apply fixes yet — report only."

**Agent 3 — Handoff Contract Auditor**
Prompt: "You are the Process Manager for Symbion. Audit the HANDOFFS between pipeline stages.

Read CLAUDE.md (pipeline section), all .claude/commands/*.md, all .claude/agents/*.md, and any existing docs/loops/ files to see real artifacts.

For each adjacent stage pair in the pipeline (analyze→office-hours, office-hours→design, design→plan, plan→build, build→review, review→qa, qa→ship, ship→canary), assess:
- What artifact does the upstream stage produce? Is the format/location explicit?
- Does the downstream stage know exactly where to find it and what to expect?
- Is there a guard: if the upstream artifact is missing, does the downstream stage catch it early or silently proceed?
- Are there orphaned artifacts (produced but never consumed)?

Return a structured findings list: 🔴 broken handoff / 🟡 implicit handoff / 🟢 improvement.
For each finding: stage pair + artifact name + specific issue + recommended fix.
Do NOT apply fixes yet — report only."

---

After all 3 agents finish:

1. **Synthesize** the three finding lists — deduplicate overlapping findings, rank by severity.

2. **Apply fixes immediately** for all 🔴 critical and clear 🟡 warning findings:
   - Edit `.claude/agents/*.md` or `.claude/commands/*.md` directly.
   - Create missing files if a pipeline stage has no backing command/agent.
   - Mark every edit with `<!-- process-manager <today's date>: <reason> -->`.
   - Update `CLAUDE.md` pipeline section if stage names or order changed.

3. **Write the audit report** to `docs/loops/process-audit-<today's date>.md` with sections:
   - Executive Summary (pipeline health + top 3 issues)
   - Findings (🔴 / 🟡 / 🟢)
   - Applied Fixes (what was changed this run)
   - Deferred Improvements (too large for this run — priority order)

4. Tell the user: how many findings, how many fixes applied, and whether a `/retro` is recommended.
