# Process Audit — 2026-06-28

Triggered by direct user request ("check lại toàn bộ quá trình → điều chỉnh
các command hay agent phù hợp → cải thiện workflow"). Three independent
`process-manager` agents audited the pipeline in parallel — Agents layer
(roles/tools), Commands layer (SOPs/preconditions/output contracts), and
Handoff contracts (artifact flow between adjacent stages) — then findings
were synthesized and fixes applied in this same run.

## Executive summary

**Pipeline health: solid foundations, weak guard discipline.** All 3
auditors independently converged on the same root cause from different
angles: commands describe *what* artifact to produce ("write to STATE,"
"create a testplan") but rarely pin down *the exact heading/filename*, and
almost no downstream command verified an upstream artifact actually existed
before proceeding. This worked in practice because a human/agent reads the
whole STATE file anyway, but it's a latent risk for any future automation
(including `process-manager` itself) that needs to grep STATE files
programmatically, and it already let real gaps slip through silently in
this project's own history (the `ollama-dynamic-models` ship decision had
to be manually caught and explicitly documented as a skip, rather than the
pipeline catching it).

**Top 3 issues found:**
1. **No fixed STATE.md section-heading schema** — every feature invented
   its own numbering (`## 10. PLAN` vs `## 3. Architecture` vs ad hoc),
   making it impossible for a command to reliably check "did the prior
   stage finish?" without reading the entire file by eye.
2. **No mechanical `/cso` gate** — CLAUDE.md documents it as required
   "when touching RPC/fs-write/secrets," but neither `autopilot.md` nor
   `/ship.md` ever checked the trigger condition or verified it ran.
3. **No precondition guards across the chain** — `/build` didn't check a
   plan/testplan existed, `/qa` didn't check `/review` passed, `/design`'s
   output was silently un-read by `/plan`. Failures surfaced late (often
   only at `/qa` or `/ship`) instead of at the broken handoff itself.

## Findings

### 🔴 Critical

| # | Area | Finding | Source |
|---|---|---|---|
| 1 | Commands/Handoffs | No fixed STATE.md section-heading schema — root cause behind ~5 other findings | Auditor 2, 3 |
| 2 | Commands/Handoffs/Agents | `/cso`'s trigger condition documented in CLAUDE.md, never mechanically checked in `autopilot.md` or `/ship.md` | Auditor 1, 2, 3 |
| 3 | Handoffs | `/build` had no check that `/plan` produced a testplan/PLAN section before coding | Auditor 2, 3 |
| 4 | Handoffs | `/qa` never checked `/review` actually PASSed before running | Auditor 2, 3 |
| 5 | Handoffs | `/office-hours` → `/design`/`/plan` had no canonical feature-slug derivation rule — downstream commands could look for a STATE file under the wrong name | Auditor 3 |
| 6 | Agents | QA stage had no named/owned subagent, unlike every other stage (ambiguous: oversight or intentional?) | Auditor 1 |

### 🟡 Warning

| # | Area | Finding | Source |
|---|---|---|---|
| 7 | Agents | `architect`'s dual role (PLAN author + REVIEW participant) creates an undisclosed self-review blind spot on its own design doc | Auditor 1 |
| 8 | Handoffs | `/analyze` produced zero file artifact — pure ephemeral chat output, inconsistent with `autopilot.md`'s own ANALYZE-section behavior | Auditor 2, 3 |
| 9 | Handoffs | `/design`'s output (`<feature>-design.md`) was never explicitly read by `/plan.md` or `architect.md` — at real risk of silent disuse | Auditor 2, 3 |
| 10 | Agents | `dev` vs `feature-builder` boundary ("large" undefined) left a gray zone with no tie-breaker | Auditor 1 |
| 11 | Handoffs | `/ship.md` checked `/review`+`/qa` PASS but never `/cso`, even for features that flagged themselves as needing it | Auditor 3 |
| 12 | Commands | `/autoplan.md` described its output artifact ("write full STATE") less precisely than `/plan.md` for the same artifact type | Auditor 2 |

### 🟢 Improvement

| # | Area | Finding | Source |
|---|---|---|---|
| 13 | Agents | `code-reviewer`/`security-reviewer` checklist overlap is intentional (defense-in-depth) but undocumented as such | Auditor 1 |
| 14 | Agents | Makers told "never hardcode secrets" with no positive pattern for where new config/secrets should live | Auditor 1 |
| 15 | Agents | `designer`'s "Open Design Questions" output had no explicit cross-reference requiring `architect` to check it | Auditor 1 |
| 16 | Commands | `/retro` and `/learn` both claim "promote learnings" with light cross-referencing | Auditor 2 |
| 17 | Commands | `/audit-process`'s embedded per-agent prompts duplicate `process-manager.md`'s own dimension definitions — risk of drift if one changes without the other | Auditor 2 |
| 18 | Commands | `/ship.md` didn't suggest `/canary`/`/document-release` as natural next steps | Auditor 2 |
| 19 | Handoffs | `canary→investigate` regression loop-back wasn't reflected in CLAUDE.md's pipeline diagram | Auditor 3 |

## Applied fixes (this run)

All fixes below are marked in their files with `<!-- process-manager
2026-06-28: ... -->` comments explaining the change and the finding that
triggered it.

- **#1 (heading schema)** — `CLAUDE.md`'s pipeline diagram now lists the
  exact literal heading each stage writes (`## ANALYZE`, `## THINK`,
  `## PLAN`, `## BUILD`, `## REVIEW`, `## CSO`, `## QA`) with an explicit
  instruction not to freelance different names. Every command that writes
  to STATE (`analyze.md`, `office-hours.md`, `plan.md`, `build.md`,
  `review.md`, `cso.md`, `qa.md`) was updated to reference its exact
  heading.
- **#2 (`/cso` gate)** — `autopilot.md` Step 6 now runs a `git diff --stat`
  trigger check and invokes `security-reviewer` in the same parallel batch
  when the diff touches daemon RPC/fs-write/secrets. `review.md` now runs
  the same trigger check and recommends `/cso` explicitly. `ship.md`'s
  precondition section now requires confirming a `## CSO` PASS exists in
  STATE before shipping any qualifying change.
- **#3 (`/build` precondition)** — `build.md` now reads STATE first; stops
  (or asks for explicit confirmation) if no `## PLAN` section exists, and
  warns if the testplan file is missing despite PLAN being marked done.
- **#4 (`/qa` precondition)** — `qa.md` now reads STATE first and confirms
  `## REVIEW` says PASS before running; warns explicitly (not a silent
  fallback) if the testplan file is missing despite PLAN being done.
- **#5 (feature slug)** — `office-hours.md` and `analyze.md` now state the
  rule: derive a kebab-case slug from the request, state it back to the
  user once, so every downstream command resolves the same filename.
  `office-hours.md` also gained a precondition check for a pre-existing
  STATE file (append/ask, don't silently overwrite).
- **#6 (QA ownership)** — documented explicitly in `qa.md` as an
  intentional decision: QA has no subagent because its job is mechanical
  verification (run build/tests/testplan, report pass/fail), not a
  judgment call — no self-review risk since it authors nothing it then
  checks. `CLAUDE.md`'s Agents line now states this explicitly too.
- **#7 (architect self-review)** — `architect.md` and `review.md` both
  gained an explicit instruction: actively look for flaws in the original
  design itself during review, don't treat a design doc as infallible just
  because the same role authored it.
- **#8 (`/analyze` artifact)** — `analyze.md` now writes its synthesis to
  `docs/loops/<feature>-STATE.md` under `## ANALYZE` before ending, instead
  of leaving it only in conversation history.
- **#9 (`/design` → `/plan` read)** — `plan.md` now explicitly reads
  `<feature>-design.md` if it exists and incorporates it; `architect.md`'s
  own principles weren't changed further here since the command-level fix
  covers the gap.
- **#10 (`dev`/`feature-builder` tie-breaker)** — `dev.md` gained a concrete
  rule: if STATE already has a `## PLAN` section, use `feature-builder`
  even for a small-looking change; `dev` is for tasks that never went
  through `/plan` at all.
- **#11 (`/ship` cso gate)** — covered by the same fix as #2.
- **#12 (`/autoplan` artifact precision)** — `autoplan.md` now names the
  exact STATE headings and the testplan filename explicitly.
- **#18 (`/ship` next-step suggestions)** — `ship.md` step 6 now suggests
  `/canary` and `/document-release` as natural follow-ups.
- **#19 (canary in the pipeline diagram)** — `CLAUDE.md`'s pipeline diagram
  now includes a `/canary` line showing the post-ship regression loop back
  to `/investigate`.

## Deferred improvements (too large for this run — priority order)

1. **#17 — De-duplicate `/audit-process`'s embedded prompts vs
   `process-manager.md`'s canonical dimension list.** Requires rewriting
   the command's 3 sub-prompts to reference the agent file rather than
   restate it — a moderate edit, deferred to avoid scope-creeping this
   already-large multi-file change.
2. **#13 — Document the `code-reviewer`/`security-reviewer` checklist
   overlap as intentional defense-in-depth** in both agent files. Small,
   low-risk, deferred only because it's purely a clarifying comment with
   zero behavioral effect — lowest priority of all open items.
3. **#14 — Add a positive "where do new secrets/config live" pattern** to
   `feature-builder.md`/`dev.md`, referencing the `SYMBION_OLLAMA_BASE_URL`
   SSRF incident in `docs/learnings.md` as the cost of skipping this.
   Deferred pending a real second occurrence to confirm the pattern is
   worth codifying now vs. waiting for the next instance.
4. **#15 — `architect.md` cross-reference to `designer`'s "Open Design
   Questions."** Now partially covered by `plan.md`'s new
   design-doc-read instruction (#9's fix), but not explicitly tied to the
   "don't silently resolve open questions yourself" framing from
   `docs/learnings.md`'s office-hours/scope entries. Worth a follow-up
   pass once a feature actually exercises this path.
5. **#16 — `/retro` vs `/learn` "promote learnings" ownership.** Minor
   ambiguity, no observed practical conflict yet — defer until it actually
   causes confusion in a real run.

## Recommendation

Given the number and structural nature of these fixes (8 command files + 1
agent file + CLAUDE.md edited in one pass), recommend running `/retro` on
the next 1-2 features that go through the updated pipeline specifically to
confirm the new preconditions/headings behave as intended in practice (not
just on paper) — e.g., does `/build` actually stop cleanly when STATE has
no `## PLAN`, does `/qa` actually catch a missing `## REVIEW`. A `/retro`
after real usage will catch anything this audit's static reading missed.

## Addendum (same-day `/retro`) — heading-match fix was itself wrong, corrected

The `/retro` run later this same day caught a real bug in this audit's own
fix for finding #1. This audit's applied fix said every STATE-writing stage
uses "the exact literal heading" (`## PLAN`, `## BUILD`, etc.). Retro
diffed that claim against the actual STATE files shipped *in this very
session* (`multi-provider-settings-STATE.md`, `ollama-dynamic-models-
STATE.md`) and found neither uses the bare literal heading — both use
decorated headings like `## 6. PLAN — Architecture` and `## 11. BUILD —
implementation notes`. An exact-string precondition check would have
silently failed against the very work this audit was meant to safeguard.

Retro corrected this to a substring-match rule for `PLAN`/`BUILD`/
`REVIEW`/`CSO`/`QA` (these keywords DO appear verbatim somewhere in real
headings, confirmed by grep across 3 real features) — but then found a
**second, deeper problem**: `ANALYZE` and `THINK` never appear in any real
STATE heading at all, not even loosely. They're pipeline-stage vocabulary
that never made it into the actual documents. Substring-matching those two
would have *also* silently failed. The final correction drops the
keyword-match approach for those two stages entirely, replacing it with
"check for a `Scope`-style section" (the real, observable signal that
`/office-hours` ran), and leaves the keyword-substring approach only where
it's actually grounded in real file content.

**Process lesson**: a same-day audit-then-retro pair caught a 2-layer bug
in the audit's own fix before any feature actually hit the broken
precondition check in practice. This is exactly the value of pairing
`/audit-process` (static reading of command text) with `/retro` (checking
that text against real artifacts) rather than treating either as
sufficient alone. See `docs/learnings.md`'s "Process audit" entry for the
full trace and the promoted-confidence lesson this produced.
