---
description: Full pipeline autopilot — analyze → office-hours → design → plan → build → review → qa → ship → PR. Single config gate at the start, then runs unattended to a GitHub PR.
---

You are running **autopilot** for: **$ARGUMENTS**

This command runs the entire Symbion pipeline with minimal interruptions and ends with a GitHub PR created automatically.

---

## Step 0 — Configure the run (SINGLE GATE)

Before doing anything else, ask the user ONE batched question using AskUserQuestion with these exact options:

**Question: "Which phases should autopilot pause for your approval before continuing?"**
(multiSelect: true)

Options:
- `After ANALYZE+PLAN` — stop after spec+plan are written so you can read them before build starts
- `After REVIEW if 🔴 blocker found` — only pause if code-reviewer or architect finds a real blocker
- `After QA` — pause after QA PASS so you can manually verify before the PR is created
- `No pauses — full autopilot` — run straight through to the PR (cannot be combined with others)

Store the user's choices as `PAUSE_GATES` for the rest of this run.

---

## Step 1 — ANALYZE

Invoke `ba` subagent (Agent tool) with this prompt:
"Analyze this feature request for Symbion: '$ARGUMENTS'
Read CLAUDE.md and any existing docs/loops/ STATE files for context.
Produce: core user need, functional requirements, key edge cases, acceptance criteria (measurable, not vague), and open taste questions that ONLY the user can decide (data visibility, auth rules, schema shape).
Write output to docs/loops/<feature>-STATE.md section ANALYZE.
Return: the list of taste questions (if any) + a 2-sentence summary of the feature."

If the ba agent found taste questions → collect them and add to the approval gate below.

---

## Step 2 — OFFICE-HOURS (condensed, auto-decided)

Auto-decide all standard questions using CLAUDE.md defaults:
- Data flow = web UI ↔ local daemon RPC ↔ filesystem/git (never a cloud DB or custom WebSocket)
- `packages/core` stays pure (no fs/net/Node); only the daemon touches disk
- UI = Tailwind + shadcn/ui, desktop-class (NOT mobile); CodeMirror 6 editors, React Flow read-only graphs
- Strict TypeScript; filesystem writes are backup-before-write + path-confined + never silent overwrite

Document every auto-decision in docs/loops/<feature>-STATE.md section THINK.

---

## Step 3 — DESIGN

Invoke `designer` subagent with:
"Design the UI/UX for this Symbion feature: '$ARGUMENTS'
Read docs/loops/<feature>-STATE.md for the spec.
Produce: user journey (happy path), screen inventory, ASCII wireframes for each screen, component breakdown (shadcn components + new components needed), interaction notes (loading/empty/error states).
Write to docs/loops/<feature>-design.md.
Flag open design questions separately — do NOT guess on taste decisions."

---

## Step 4 — PLAN

Invoke `architect` subagent with:
"Design the technical architecture for Symbion feature: '$ARGUMENTS'
Read docs/loops/<feature>-STATE.md (spec) and docs/loops/<feature>-design.md (UI design).
Produce: package/app boundaries + files to create/modify, the daemon RPC surface, the local-store schema (init/migration), data flow (web UI → daemon RPC → filesystem/git → UI), edge cases, test plan.
Write plan to docs/loops/<feature>-STATE.md section PLAN.
Write test plan to docs/loops/<feature>-testplan.md."

---

## APPROVAL GATE A — if user selected "After ANALYZE+PLAN"

Present to user:
1. Summary of spec (from STATE section ANALYZE)
2. Architecture overview (from STATE section PLAN)
3. Any taste questions collected from ba + designer + architect
4. Ask: "Continue to build? (yes / adjust scope first)"

Wait for confirmation before proceeding to Step 5.

---

## Step 5 — BUILD

Invoke `feature-builder` subagent with:
"Implement Symbion feature: '$ARGUMENTS'
Read docs/loops/<feature>-STATE.md (full spec + plan) and docs/loops/<feature>-design.md (UI design).
Implement exactly what the plan specifies. List every assumption you make for the Checker to verify.
Update STATE section BUILD with: files changed, assumptions, anything deferred.
Do NOT self-review — that is the Checker's job."

---

## Step 6 — REVIEW

Run two review agents in parallel (single Agent message, two calls):

**code-reviewer**: "Review the implementation of '$ARGUMENTS'.
Read docs/loops/<feature>-STATE.md + docs/loops/<feature>-testplan.md as the acceptance standard.
Run git diff to see changed files.
Check: spec compliance, bugs (null/undefined, unhandled RPC errors, non-byte-stable render, marker/hash mismatch, form↔markdown IR desync), filesystem safety (path confinement, backup-before-write, never overwrite foreign files, core stays pure), conventions (CLAUDE.md).
Return findings 🔴/🟡/🟢 + verdict PASS or NEEDS-WORK."

**architect**: "Architectural review for '$ARGUMENTS'.
Read the plan in docs/loops/<feature>-STATE.md and run git diff.
Assess: does implementation match the design? Any drift, unnecessary complexity, missing edge cases?
Return findings + verdict PASS or NEEDS-WORK."

<!-- process-manager 2026-06-28: added security-reviewer trigger check (audit-process finding: CLAUDE.md documents /cso as required "when touching RPC / fs-write / secrets" but autopilot never mechanically checked the trigger condition — an unattended run touching the daemon's write/RPC surface could ship without a security review). -->
**Security-review trigger check**: run `git diff --stat`. If the diff touches `apps/daemon/` RPC handlers, filesystem-write/path-handling code, or secret storage, ALSO invoke `security-reviewer` in this same parallel batch:

**security-reviewer**: "Security audit for '$ARGUMENTS' (OWASP Top 10 + STRIDE).
Read docs/loops/<feature>-STATE.md and run git diff.
Symbion focus areas: localhost RPC hardening (127.0.0.1 bind + origin-bound token + anti DNS-rebinding), path confinement, destructive-write safety (backup-before-write, conflict blocks overwrite), secret handling.
Return findings 🔴/🟠/🟡/🟢 + verdict PASS or NEEDS-WORK."

Aggregate verdicts (including security-reviewer's, if it ran):
- Any 🔴/🟠 NEEDS-WORK → APPROVAL GATE B (below)
- All PASS → continue to QA

## APPROVAL GATE B — if user selected "After REVIEW if 🔴 blocker found" AND blockers exist

Present the 🔴 findings to the user.
Ask: "Auto-fix these blockers and re-run review? Or stop here for manual review?"
- If auto-fix: invoke `feature-builder` again with the exact blocker list → re-run Step 6 once.
- If stop: halt and report.

If no blockers (only 🟡/🟢): log findings to STATE and continue automatically.

---

## Step 7 — QA

Invoke a QA check:
"Run QA for Symbion feature '$ARGUMENTS'.
Read docs/loops/<feature>-testplan.md as the acceptance standard.
1. Run npm run build — must pass.
2. Run npm run dev in background, verify root route returns 200.
3. Verify each acceptance criterion from the test plan.
Write PASS or FAIL + details to docs/loops/<feature>-STATE.md section QA."

If QA FAIL:
- Invoke `feature-builder` once more with the QA failure details to fix.
- Re-run QA.
- If still FAIL after retry → STOP, report to user, do not create PR.

## APPROVAL GATE C — if user selected "After QA"

Show QA PASS summary to user.
Ask: "Create the PR?"
Wait for confirmation.

---

## Step 8 — SHIP + PR

1. Run `npm run build` one final time — must pass.
2. Update docs/loops/<feature>-STATE.md: mark Done.
3. Add patterns to docs/learnings.md.
4. Safety check: confirm .env.local and secrets are NOT staged.
5. Create a branch: `feat/<feature-kebab>` (git checkout -b).
6. git add relevant files selectively (no .env.local, no secrets).
7. Commit with a full English message (Conventional Commit format, imperative mood, what + why + impact).
8. git push -u origin feat/<feature-kebab>
9. gh pr create with:
   - Title: `feat(<scope>): <feature summary>`
   - Body: Summary (bullets), Test plan (checklist from testplan.md), Reviewer notes (key assumptions + findings resolved)

---

## Final report to user

Print:
- PR URL
- Phases completed
- Any findings resolved automatically
- Any items deferred to follow-up (tech debt, open design questions, future ideas)
- Suggestion: run `/canary` after merge to monitor for regressions
