# workflow-agent-run — STATE

> Feature: **Next increment of the Run Engine** — running workflow agents from Symbion, building on what `graph-execution-realtime` already shipped (P1 execute/cancel/glow, P2 telemetry/pricing/timeline, P3 history/reattach/settings).
> Pipeline stage: **SHIPPED 2026-10-17** — plan → build → review (APPROVE-WITH-FIXES, fixed) → live QA (F1 fixed, re-verified) → ship. /cso intentionally skipped by the user (§10.9).
> Created 2026-10-16 by /analyze (3 parallel BA angles: requirements, solution, ideas).

## 1. Original request (user, translated)

"Call agents and analyze the feature of running workflow agents." Since a run engine already exists, this analysis treats the request as: *what is missing / what is the next increment for running workflow agents?*

## 2. Current baseline (what exists)

- `apps/daemon/src/run/runManager.ts`: a single-run engine. `Map<projectId, ActiveRun|RESERVED>` is the 1-active-run-per-project lock. It does a detached `spawn()` (process group), parses stdout line by line, writes `events.jsonl`, streams over SSE, enforces the token cap through `core.fold/rollup`, and has a wall-clock timer. Cancel sends SIGTERM to the group, then SIGKILL after 5 s. `finalize()` records git numstat and totals. `sessionId` is captured but unused.
- `cliDriver.ts`: builds Claude CLI argv only. This is the provider seam.
- Preflight, nonce-bound consent, first-run acknowledgment, per-project `runConfig` (model, allowedTools, permission mode, limits).
- History of the last 50 runs per project, a read-only past-run overlay, reattach after F5.
- Pure telemetry in `packages/core/src/run/` (events, parseStreamJson, aggregate, pricing).
- ⚠️ `CLAUDE.md` still says "Run engine deferred to v2 / v1 = Copy run command". That is stale and should be fixed via `/document-release`.

## 3. Requirements

**Core need:** close the loop Author → Launch → Watch → **Learn**. The authored graph becomes the runtime dashboard. Run evidence (cost per node, behaviour per artifact version) feeds back into editing prompts. "Learn" is the stated multiplier, and none of it is built yet.

### Functional requirements: status

| # | Requirement | Status |
|---|---|---|
| FR-1 | Execute a published command (node / ⌘K) with requirement, model override, preflight, nonce consent | EXISTS |
| FR-2 | Lifecycle, process-tree cancel, wall-clock + token ceilings, 1 run per project, crash reconcile | EXISTS (WSL `claude.exe` group-kill reaching grandchildren unproven: PARTIAL) |
| FR-3 | stream-json telemetry, roll-up, fresh tokens + ~$ | EXISTS (`TimelineRow.unattributed` never set: PARTIAL) |
| FR-4 | Realtime overlay (glow, tickers, edge flow, timeline, reattach) | PARTIAL: graph swapped to a self-coded renderer (b965819, 9c1202d) after the run engine shipped; overlay not re-verified live |
| FR-5 | History, past-run overlay | EXISTS (manual delete MISSING) |
| FR-6 | Preflight auth check | PARTIAL (auth failure only caught at spawn) |
| FR-7 | Live browser QA of P2/P3 journeys J12–J43 | MISSING (shipped with residual risk) |
| FR-8 | Surface tools the headless run denied, with an approve path | MISSING |
| FR-9 | Pipeline chaining (/analyze→/plan→/build) with approval gates | MISSING |
| FR-10 | Compare runs across artifact versions (runs tagged with artifact hash) | MISSING |
| FR-11 | $ budget caps (soft banner / hard abort) | MISSING (token cap only) |
| FR-12 | Replay scrubber over events.jsonl | MISSING |
| FR-13 | Desktop notification when a run ends | MISSING |
| FR-14 | Checkpoint / rollback of the agent's writes | MISSING |
| FR-15 | Codex execution driver | MISSING (seam exists) |
| FR-16 | Pause / inject feedback / follow-up turn (`--resume`) | MISSING |
| FR-17 | Concurrency > 1 per project, queue | MISSING (by design) |

### Non-functional requirements and known gaps

- **Argv injection:** `allowedTools` entries are only length-checked before being joined into `--allowedTools`. Validate against a tool-spec grammar and reject a leading `-`, whitespace and commas.
- **Trust boundary:** `validateRunConfig` does not shape-check `firstRunAck`, which is the consent-bypass anchor.
- **Secrets:** the child inherits `process.env` verbatim. Transcripts are not redacted and cannot be manually purged.
- **Localhost:** the nonce only defeats blind CSRF. Every new spawn-capable RPC (resume, chain) must inherit the nonce gate.
- **Reliability:** ~1/20 full-suite flake (prune race tests) is not root-caused. WSL kill is unproven.
- **Cost:** the hand-maintained pricing table goes stale. The token cap ignores cache-heavy spend.
- **Drift:** clamp constants are duplicated between daemon and web.
- **Safety principle:** the agent's own file writes bypass Symbion's "never write silently" guarantee. This is disclosed in the consent copy; checkpoint/rollback is the only real mitigation.

### Candidate acceptance criteria (if the next increment = hardening + verification)

1. **AC-N1:** journeys J1–J43 pass in a real browser on the self-coded renderer, each recorded in STATE.
2. **AC-N2:** `validateRunConfig` rejects malformed `allowedTools` entries and a malformed `firstRunAck`, with unit tests.
3. **AC-N3:** cancel on WSL leaves zero descendant processes within 5 s (verified by a process listing), or the UI shows a sticky `kill -9` fallback.
4. **AC-N4:** each CLI-denied tool appears as a labelled feed row. The summary counts denials and links to add them to `allowedTools`.
5. **AC-N5:** the flake is root-caused via `/investigate`, then 50 consecutive green full-suite runs.
6. **AC-N6:** clamp constants have a single source in `packages/core`.

## 4. Solution Options (ranked)

### Rank 1: A. Pipeline Runs: an orchestrator over the existing RunManager (L)

A `PipelineRun` owns ordered steps (command + requirement + model). Each step is a normal `RunManager.start()` run. Between steps an **approval gate** (`awaiting-approval`) shows the step's summary, git diff and STATE section. The user can approve, edit the next requirement, re-run, or abort. Optionally `--resume <sessionId>` carries context to the next step.

- Reuses the lock, ceilings, cancel and finalize. Persists a thin `.symbion/runs/pipelines/<id>/pipeline.json` that points at child runIds.
- **Impacted files:**
  - New `apps/daemon/src/run/pipelineManager.ts`
  - New `packages/core/src/run/pipeline.ts` (pure state machine + aggregate cost)
  - `runStore.ts` (persist pipelines; prune must leave child runs of a live pipeline alone)
  - `rpc/handlers.ts` + `packages/rpc-types` (`startPipeline`, `approveStep`, `abortPipeline`, `listPipelines`)
  - `preflight.ts` (all steps preflighted up front)
  - `nonces.ts` (nonce per pipeline + per approval, single-use, bound to `(pipelineId, stepIdx)`)
  - `cliDriver.ts` (`--resume`, feature-detected via `cliVersion.ts`)
  - Web: a stepper in the run bar and mission mode
- **Risks:**
  - A daemon restart mid-step leaves the pipeline `paused`, not `failed`.
  - Needs a **whole-pipeline $ cap**.
  - Gates are enforced on the daemon side and never auto-approve.
  - A cancelled step must never count as an approval.

### Rank 2: B. Provider abstraction + Codex exec driver (M–L)

A `RunDriver` interface (`resolveBin`, `buildArgv`, `parseLine`, `resumeArgs`, `capabilities`) with `ClaudeCliDriver` and `CodexExecDriver`. Codex `exec --json` parses into the **same** `RunEvent` union. Subagent attribution is lossy, so all its usage goes to the command bucket.

- **Impacted files:** `cliDriver.ts`, `runManager.ts` (call `driver.parseLine`), `runConfig.ts`, `pricing.ts`, `preflight.ts` (Codex needs `AGENTS.md`).
- **Risks:**
  - The consent dialog must state Codex's real sandbox/approval posture, not a translated one.
  - Pin a `.ndjson` fixture per CLI version.
- The **seam refactor alone (S)** can land first, which makes A provider-neutral for free.

### Rank 3: C. Concurrency + git worktree isolation (XL)

Each run gets a worktree under `.symbion/worktrees/<runId>`, with a FIFO queue and a global concurrency limit. When a run ends, the user sees a diff of its branch and chooses merge, apply or discard.

- Fixes the "dirty tree, can't roll back" problem.
- **Costs:**
  - Path confinement must extend to worktree roots.
  - Disk use grows with every worktree.
  - `.claude/` must be committed to exist in a worktree.
  - Merge-conflict UI.
  - Garbage collection for orphaned worktrees.
- Defer. A cheap partial step is "run in a worktree" as a per-run option while keeping the 1-run lock.

### Cross-cutting edge cases

- **Orphans:** a detached group survives daemon exit. Record `pid` + start time in `run.json` so boot reconcile can detect, and with consent kill, a live orphan instead of marking `failed(daemon-restarted)` while it is still writing.
- **Stream parsing:**
  - Add a per-line byte cap.
  - Handle stdout that never ends with a newline, and stderr interleaving with stdout.
  - Unknown formats degrade to `unknown` events and never crash.
- **Hostile commands:** authored `.md` files are executable instructions. Preflight should flag unmanaged or modified-since-viewed commands before running them under `acceptEdits`.
- **Resumed sessions:** a resumed session carries earlier tool permissions forward.

## 5. Ideas & Opportunities

**10× idea: "Learn + Iterate".** Run → spot the problem → edit the prompt → re-run → prove it got better. Symbion holds both a workflow's source and its runtime trace, which is a unique position.

1. **Run diff (A/B).** Compare two runs of the same command: per-node tokens, $, duration, tool counts, files touched, final message, tagged by artifact hash. Cheap, because the data already exists in `events.jsonl` and `run.json`.
2. **Prompt-change eval.** A golden-input set per command, run against the old and new artifact versions, with a pass/regress table. Start with deterministic checks; LLM-judge later.
3. **Trace-to-source jump.** An expensive timeline step opens the agent `.md` in CodeMirror with a hint like "61% of tokens in Read". Works like a flame chart.
4. **Re-run with tweaks.** From history: re-run, re-run with another model, re-run with the edited prompt.

**Natural pairings:**
- STATE-driven pipelines (option A)
- **Dry-run** (`--permission-mode plan`, badged "dry")
- **Budget forecast** from history (for example "~$0.40–0.90, p50 6 min") with soft/hard caps
- **Checkpoint + "Revert this run"**
- Run in a worktree
- Desktop notifications
- One-click "allow this tool" from a denial row (through the settings editor with confirm)

**UX:**
- A combined "Publish & Run": two explicit consents, diff preview then run confirm.
- A "what's happening now" one-line status during a run.
- Promote history from a popover to a filterable runs list.
- Every run summary ends with next actions: edit agent, re-run, compare.

**Simplify / defer:**
- Pause/inject mid-run (no clean stdin channel in headless stream-json)
- Codex execution
- LLM-judge evals
- **Pay down the P2/P3 live-QA debt on the new renderer before building on top.**

## 6. Open Questions (to resolve in /office-hours)

1. **Direction of the next increment:**
   - (a) hardening + verification (AC-N1…N6)
   - (b) Learn/iterate (run diff, re-run with tweaks, $ budgets)
   - (c) orchestration (pipeline runs with gates)
   - (d) provider seam + Codex
2. Pipelines: carry context with `--resume` (cheaper, context grows) or a fresh session per step using STATE.md handoff (reproducible, matches Symbion's convention)?
3. Gates: before every step, or only before steps that write (build/ship)?
4. Denied tools: report-only, or interactive approve-and-resume (needs a resume spawn path)?
5. Is an automatic git checkpoint (branch/stash/worktree) before a run acceptable, or must git stay hands-off unless asked?
6. Budget defaults: per run, per day or per project-month? At the hard limit, abort or pause for approval?
7. Allow running unpublished drafts (render to temp), or keep "published only" locked?
8. Codex execution: near-term, or stay Claude-only?
9. History retention: keep 50, or add "pin run" once runs become eval baselines?

## 7. Recommended Next Step

**`/office-hours`.** The scope is not locked: three credible directions compete (hardening, Learn, orchestration). The synthesis recommends this order:

1. A short **hardening slice** first (AC-N1 live QA on the self-coded renderer, AC-N2 argv/consent validation, AC-N5 flake). The surface is unverified since the renderer swap and has two real input-validation gaps.
2. Then the **RunDriver seam (S)**.
3. Then either **Learn** (run diff + re-run with tweaks) or **Pipeline Runs (A)**, depending on the answer to Q1.

## 8. Research: how the Claude Code extension shows runtime agents

The user wants Symbion's run experience to match the Claude Code VS Code extension, based on 3 reference screenshots: the "Agent map" modal, a subagent detail popover, and a full subagent transcript view. Observed on this machine (extension `anthropic.claude-code-2.1.301`):

- **Same data source as Symbion.** The extension drives the `claude` CLI / Agent SDK and consumes stream-json messages. Every message carries `parent_tool_use_id`, which ties a subagent's messages to the `Agent`/`Task` tool_use that spawned it. That link is the whole basis of the agent tree. Symbion's parser already reads it (`packages/core/src/run/parseStreamJson.ts:165`), and the P2 roll-up already attributes tokens per agent.
- **Per-subagent transcripts.** The CLI writes `~/.claude/projects/<proj>/<session>/subagents/agent-<id>.jsonl` (lines carry `isSidechain`, `agentId`, `parentUuid`) plus `agent-<id>.meta.json` (`agentType`, `description`, `toolUseId`, `requestShape: background`, `finished`). "Open transcript" opens that file. **Symbion will NOT read these** (decision Q6): they sit outside the project root and use an internal CLI format.
- **UI anatomy**
  - **Agent map:** the main agent node (name, model, tokens in context), its subagents (status dot, duration, tokens) and a separate "background tasks" group (shell, duration).
  - **Subagent detail:** the prompt it was given, "Tool calls (N)" with a one-line summary per call (`Glob pattern: …`, `Read file (lines a–b)`, `Grep "…" (in …)`), and Open transcript / Stop agent.
  - **Transcript view:** header (status, agentType, model, background/foreground, "Spawned by the main agent", duration, tokens), the prompt bubble, then a vertical timeline of Thinking and tool calls with a status dot per row (green ok, red error, grey thinking) and a result line ("Found 5 files", "123 lines of output").
- **Headless limitation.** In `claude -p --output-format stream-json` there is no channel to stop a single subagent. Only the whole process group can be cancelled.

## 9. Scope (locked in /office-hours, 2026-10-16)

### Problem
Today a Symbion run shows glow and tokens on graph nodes plus one flat timeline for the whole run. Users can't see *what each agent is doing*: which prompt it got, which tools it called and what came back. The Claude extension's agent map plus drill-down is the reference experience.

### Goal / "done"
While a run is live, and when re-opening a past run, the user can see the tree of agents for that run and drill into any agent to read its prompt, its tool calls and its final result, updating in real time, at the same fidelity as the Claude extension.

### Scope IN
1. **Agents panel on the right of the graph** (decision Q1). The graph stays visible and keeps its glow. The panel shows:
   - **Live agent tree:** the root command (model, tokens) → its subagents (status dot running/done/error, elapsed duration, tokens, agentType, description) → a **background tasks** group (Bash `run_in_background` tool calls: command summary, status, duration; best effort).
2. **Agent detail** (same panel, with ← back):
   - Header: status, agentType, model, duration, tokens, "spawned by …"
   - The prompt it was given (the Task/Agent tool_use input)
   - Tool calls, one line each in the extension's summary style
   - Thinking rows
   - Final result text
3. **Full transcript per agent.** The detail view *is* a vertical timeline (screenshot 3 style) with status dots per row and live auto-scroll that pauses when the user scrolls up. Clicking a tool row expands it to show the input/output preview (decision Q4).
4. **Past runs.** Opening a run from History renders the same tree and detail, read-only, from `events.jsonl`.
5. **Replaces `RunTimelinePanel`** (decision Q5). The root agent's transcript is the old timeline. `TokenBreakdownCard`, `RunSummarySection`, cancel and preflight remain.
6. **Graph ↔ panel linking.** Clicking an agent node on the graph during or after a run opens that agent's detail. Selecting an agent in the panel highlights its node.

### Scope OUT (this iteration)
- **Stopping an individual subagent** (decision Q3). The only stop is **"Stop run"** at the root level, labelled as stopping the whole run. Subagent details have no Stop button.
- Reading the CLI's own transcripts under `~/.claude/projects` (no "Open transcript" to an external file).
- Raising `PREVIEW_CAP` (stays 2,000 chars). Expanded rows show the capped preview with an explicit "…truncated" marker.
- Pipelines/chaining, run diff, eval, $ budgets, Codex driver, concurrency, worktrees, pause/inject (all still candidates from §6).
- A modal "Agent map" variant.

### Data model impact
- **No change** to the canonical IR, to publish/upsert, or to `events.jsonl` format/caps.
- **New pure derivation in `packages/core/src/run/`:** `deriveAgentTree(events) → AgentNode[]`. It groups events by `parent_tool_use_id`, maps each Task/Agent `tool_use` to a child agent (prompt, agentType, description), pairs tool_use with tool_result by id, derives status and duration from timestamps, and puts token totals in line with the existing roll-up. A `summarizeToolCall(name, input, result) → string` produces the one-line labels. Both are unit-testable on the existing `.ndjson` fixtures (simple + subagent).
- Daemon: likely no new RPC. The existing SSE stream plus the run history read provide the events. Confirm in /plan whether past-run `events.jsonl` is already served in full or needs paging.

### Edge cases
- A subagent whose Task tool_use is unseen or unknown (event parsed before its parent): put it under an "unattributed" bucket, never drop it. Wire up `TimelineRow.unattributed` (currently never set).
- Nested subagents (depth > 1): render recursively.
- Parallel subagents finishing out of order. A subagent left running when the run ends or is cancelled is shown as `cancelled`/`interrupted`, never a stuck green "running".
- A tool_result with `is_error` gives a red dot. A tool_use with no result gives a pending dot (or interrupted once the run is terminal).
- Reattach after F5 mid-run: the tree is rebuilt fully from replayed events, so it doesn't drift from what a live client sees.
- Large runs (thousands of events): virtualize the transcript list. The tree derivation must be incremental (fold per event), not a full re-scan per SSE message.
- Degraded or unknown CLI format: `unknown` events show as a neutral row, and the panel never crashes.
- Secrets: show only previews already stored in `events.jsonl`, with no new exposure.

### Impact on existing features
- `RunTimelinePanel.tsx` is removed or folded into the new panel. Its tests move to the new derivation and UI.
- `MissionStatusStrip`, `RunBar`, `CancelControl` (now "Stop run"), `PastRunBanner` and the history popover are kept and wired to the panel.
- The graph renderer (self-coded, b965819 / 9c1202d) gets a selection hook for agent nodes. Glow and edge flow are unchanged.
- No impact on the project store, providers/adapters or publish.

### Acceptance criteria (for the Checker)
1. **AC-1:** With the subagent fixture, `deriveAgentTree` returns the root plus each subagent with the correct prompt, agentType, status, duration, tool-call count and tokens that match the existing roll-up exactly.
2. **AC-2:** `summarizeToolCall` produces extension-style one-liners for Read (with line range), Glob, Grep, Bash, Edit/Write, Agent/Task, WebFetch, and a generic fallback, all unit-tested.
3. **AC-3:** During a live run in a real browser, the Agents panel shows subagents appearing as they are spawned, status dots and durations and tokens updating live, and background shell tasks listed.
4. **AC-4:** Clicking an agent (in the panel or on its graph node) opens its detail: prompt, tool calls in order, Thinking rows, final result. Tool rows expand to the capped preview with a truncation marker when cut.
5. **AC-5:** The transcript auto-scrolls while live, pauses when the user scrolls up, and resumes with a "jump to latest" control.
6. **AC-6:** After F5 mid-run, the reattached panel matches the pre-refresh state. Opening a past run from History renders the same tree and details read-only.
7. **AC-7:** A cancelled run leaves no agent or tool row stuck in "running". Error results show red.
8. **AC-8:** Only a root-level "Stop run" exists, with no per-subagent stop. It cancels the whole process group as today.
9. **AC-9:** `RunTimelinePanel` is gone, with no lost information: everything it showed is reachable in the root agent's transcript.
10. **AC-10:** A run with 2,000+ events scrolls smoothly (virtualized), and the per-event derivation stays incremental.

## 10. PLAN — Architecture (by /plan, 2026-10-16)

> Inputs: §8 research, §9 locked scope + AC-1…AC-10, `workflow-agent-run-design.md` (§6 resolved). Test plan: `workflow-agent-run-testplan.md`.
> Binding for `feature-builder` (maker) and `code-reviewer` / `architect` (checkers). Each "D-n" is a decision the Checker verifies; each "A-n" is an assumption to re-check during BUILD.

### 10.1 Answers to the open data questions (verified against code + fixtures)

| # | Question | Answer (evidence) | Consequence |
|---|---|---|---|
| Q-a | Is thinking text stored in `events.jsonl`? | **No.** The CLI does emit it (`fixture-subagent.ndjson` line 7: `{"type":"thinking","thinking":"The user wants…","signature":…}`), but `readContentParts` in `packages/core/src/run/parseStreamJson.ts` drops every part type other than `text`/`tool_use`/`tool_result`. A thinking-only assistant event is persisted as `message` with `parts: []`. | D-1: the parser learns a `thinking` part (capped at `PREVIEW_CAP`, `signature` dropped). New runs get expandable Thinking rows. Runs persisted before this change get non-expandable "Thinking" rows, inferred from `message` events with `parts.length === 0` (design Q6: "expandable only if stored"). |
| Q-a′ | Are tool results stored? (Not asked, but load-bearing) | **Only as `unknown`.** `parseLine` recognizes only `system/init`, `assistant` and `result`. Every `type:"user"` line, which is where `tool_result` lives (fixture line 9), and every `system/task_*` line (fixture lines 8, 12, 14: `task_started` carries `prompt`/`description`/`subagent_type`/`tool_use_id`; `task_notification` carries `status`) is persisted as `{kind:"unknown", type, rawTruncated}` with the raw capped at `RAW_CAP` = 8,192. So **no `tool_result` ContentPart is ever produced from real CLI output today**, `is_error` is never read, and pairing tool_use → result is impossible from parsed events. | D-1 (same change): the parser recognizes `user` and `system/task_*`. Legacy runs are recovered by D-3 (`upgradeLegacyEvent`). |
| Q-b | Is a past run's `events.jsonl` served in full or paged? | **Paged, and complete.** `runStore.readEvents` caps at `EVENTS_CAP = 500` per call. `getRunEvents` returns `done` iff the run is terminal and `lastReturned >= run.lastSeq`. `useRunStore.openHistoryRun` already loops `afterSeq` until `done`. SSE backfill also chunks by 500 until short. A 2,000+ event history therefore loads fully in ≥5 calls. | No RPC change. Risk R-4: `readEvents` re-reads the whole file per page (O(n·pages)). That is acceptable at the v1 sizes and is not touched (touching it is a daemon change). |
| Q-c | Are timestamps sufficient for per-row m:ss and per-agent duration? | **Yes, at ingest resolution.** `PersistedRunEvent.ts = Date.now()` at daemon ingest (`runManager.ingestLine`). stream-json emits one event per content block as it completes, so `ts` ≈ block end. Per-row `atMs = ts − originMs`, where `originMs = Date.parse(run.startedAt)`, falling back to the first event's `ts` (so 0:00 aligns with `MissionStatusStrip`'s elapsed). Agent start is the `ts` of its dispatch `tool_use`. Agent end is the `ts` of the completion signal (D-5). | A-1: the error is ≤ one content block (seconds, not minutes). The CLI's own `user.timestamp` and `task_notification.usage.duration_ms` are NOT used, so live and replay share one clock source. |
| Q-d | How is Bash `run_in_background` detectable? | From the **tool_use input** (`input.run_in_background === true`). Today that input survives only inside `inputPreview` (JSON, cut at 2,000 chars, so it can be lost for long commands). Completion: the immediate tool_result only says "running in background with ID …". Real completion can only be inferred best-effort from later `system/task_*` events carrying the same `tool_use_id`, a later `BashOutput`/`TaskOutput` result reporting a terminal status for the captured shell id, or a `KillShell`/`KillBash` call on it. **None of these are in a recorded fixture yet.** | D-1 adds `background?: true` to the parsed `tool_use` part, computed from the full input **before** truncation. D-5 covers status. Background tasks with no completion signal at run end → `unknown` (run completed) or `interrupted` (run failed/cancelled). Never `running` (AC-7). A-2: BUILD records a real background-Bash fixture if it can do so cheaply; otherwise synthetic tests only, and QA labels the result "best effort". |
| Q-e | Is any daemon change necessary? | **No daemon source change and no RPC/SSE contract change.** However, the daemon calls `core.parseLine` at ingest, so D-1 **changes what new runs persist in `events.jsonl`**. It adds new `RunEvent` kinds and part fields. `user` lines drop from ≤8,192-char raw to ≤2,000-char previews. Thinking text (≤2,000 chars per block) becomes newly persisted. The `PersistedRunEvent` envelope, the caps, the seq/ts semantics, the files, the RPC methods and the SSE frames are all unchanged. | ⚠️ **Flag for the orchestrator:** this is an *additive* deviation from §9's "no change to `events.jsonl` format". The user should ack it. It is the only way to satisfy "Thinking rows" plus result pairing at fidelity (see D-1 trade-off). Recommend a **short `/cso`** focused on (1) the parser as the trust boundary for untrusted CLI output, (2) thinking text newly at rest on disk, (3) the UI rendering untrusted text as plain text only. No new spawn/RPC surface exists, so the nonce/consent rules are unaffected. |

### 10.2 Architecture and boundaries

```
packages/core/src/run/            (PURE — no Node imports; purity.test.ts must stay green)
  events.ts            MOD  RunEvent/ContentPart additive kinds; delete TimelineRow
  parseStreamJson.ts   MOD  parse `user` → tool-results, `system/task_*` → task, `thinking` parts,
                            tool_use.background + tool_use.fields (pre-truncation)
  legacyEvents.ts      NEW  upgradeLegacyEvent(ev): re-interpret pre-upgrade `unknown` user/system lines
  toolInput.ts         NEW  readToolInput(part): fields ?? tolerant JSON parse of inputPreview
  summarizeToolCall.ts NEW  summarizeToolCall(tool, input, result?) → { label, resultLabel? }
  agentTree.ts         NEW  AgentTreeState + initAgentTree / foldAgentTree / foldAgentTreeBatch
                            + selectAgentView (terminal mapping, tokens from RunState) + view-model types
  aggregate.ts         MOD  fold(): new kinds are explicit no-ops (NOT counted in unknownEvents)
  derive.ts            MOD  delete timelineRows (absorbed); runSummary untouched
  index.ts             MOD  export new modules
packages/rpc-types/src/index.ts  MOD  drop the TimelineRow re-export (type-only; rebuild dist)
apps/daemon/**                   NO SOURCE CHANGE (persisted content changes via core.parseLine — §10.1 Q-e)
apps/web/src/lib/run/
  useRunStore.ts       MOD  timeline/historyTimeline → agentTree/historyAgentTree (+ historyEvents);
                            incremental foldAgentTreeBatch per accepted batch; eventToTail exported + new kinds
  windowing.ts         NEW  pure computeOffsets / computeWindow (virtualization math)
  useWindowedList.ts   NEW  scroll container hook (follow/pause/new-count, measured expanded rows)
  agentsPanelSession.ts NEW sessionStorage {view, agentId} per runId (AC-6 restore)
  useNow.ts            NEW  one shared 1 s clock (only ticks while live)
apps/web/src/components/run/agents/   NEW (design §4 component table, 1:1)
  AgentsPanel, AgentTree(+AgentTreeRow), RunOutcomeCard, BackgroundGroup, UnattributedGroup,
  AgentDetailView, AgentDetailHeader, PromptBlock, TranscriptList, TranscriptRowView, StepPreview,
  ResultCard, RunFinishedStrip, JumpToLatestPill, StatusGlyph, LiveDuration, AgentInstancePicker,
  RawEventLog (S5: full-history raw lines on the same windowed list)
apps/web/src/components/
  DependencyGraph.tsx  MOD  mount AgentsPanel (w-[360px]); delete panelFilterId + filter chips + panelMode
                            + the auto-switch-to-Summary effect; own selectedRunAgentId/hoveredRunAgentId;
                            node-click mapping + picker + toast; grow height while a run is shown
  graph/GraphCanvas.tsx MOD onNodeClick(id, anchorRect) — the rect anchors the instance picker
  graph/CommandNode.tsx, graph/AgentNode.tsx  MOD  runHalo?: "hover" | "selected" (outer ring outside status ring)
  graph/GraphEdgePath.tsx MOD runLinked?: boolean (brighter stroke)
  run/CancelControl.tsx  MOD  "■ Stop run" + confirm copy (design §1.12); test updated
  run/RunSummarySection.tsx MOD [Feed] → "← Agents" (onBack); optional onOpenAgent(label) on cost rows
  run/RunTimelinePanel.tsx  DELETE (after S10; see §10.6)
```

D-2 (boundary): `deriveAgentTree` from §9 is realized as **`foldAgentTree` (incremental state) + `selectAgentView` (pure projection)**. The convenience `deriveAgentTree(events, runState, ctx) = selectAgentView(foldAgentTreeBatch(initAgentTree(), events), runState, ctx)` is exported for tests and one-shot use. The web never calls it per SSE message.

### 10.3 Core contracts

**D-1 — parser extension (additive; never throws; caps unchanged)**

```ts
// events.ts — additions only
type ContentPart =
  | …existing…
  | { kind: "thinking"; textPreview: string }                     // "" for redacted_thinking
// tool_use part gains:   background?: true;  fields?: ToolFields
// tool_result part gains: isError?: true;  async?: true           // async = tool_use_result.isAsync || status==="async_launched"
type ToolFields = Record<string, string | number | boolean>;      // whitelist below, strings capped
type RunEvent =
  | …existing…
  | { kind: "tool-results"; parentToolUseId: string | null; parts: Extract<ContentPart,{kind:"tool_result"}>[] }  // type:"user"
  | { kind: "task"; subtype: string; taskId: string; toolUseId?: string; status?: string;
      taskType?: string; subagentType?: string; description?: string; promptPreview?: string; summary?: string }
```

- `fields` whitelist (scalars only, read from the **full** input before truncation): `file_path, path, offset, limit, pattern, glob, output_mode, command, description, run_in_background, subagent_type, url, query, shell_id, bash_id, notebook_path`. Each string is capped at 300 chars. `prompt` is **not** in `fields`. It already lives in `inputPreview`, and for agents `task.promptPreview` (≤ `PREVIEW_CAP`) is the clean copy. So no field duplicates large content.
- `type:"system"` with a subtype other than `init` or `task_*` (e.g. `thinking_tokens`) and `rate_limit_event` stay `unknown`, unchanged.
- `user` lines whose content is not a tool_result array (e.g. replayed prompts) → `tool-results` with `parts: []`. They are ignored by the tree and shown in Raw.
- **Trade-off:** the alternative (B) was "no parser change; re-parse `unknown.rawTruncated` at view time". It was rejected. Thinking text is not in the raw at all, and any tool result over ~8 KB (any non-trivial Read) is cut mid-JSON and unrecoverable. B is kept only as the legacy path (D-3).

**D-3 — `upgradeLegacyEvent(ev: RunEvent): RunEvent`** (pure; applied inside `foldAgentTree` only, never re-persisted)
- `unknown` with `type ∈ {"user","system"}` → `JSON.parse(rawTruncated)` → re-run the D-1 branch via an internal `parseObject` shared with `parseLine`. No duplicate logic.
- If the raw was truncated (ends with the `…[truncated N chars]` marker, so JSON fails) and `type === "user"`: salvage with a regex over `"tool_use_id":"(toolu_[^"]+)"` and `"is_error":\s*true`. This gives `tool-results` parts with `resultPreview: ""` and a `legacyTruncated: true` flag on the row. Output reads "result not recoverable (pre-upgrade run)".
- Everything else passes through untouched.

**D-4 — `summarizeToolCall(tool, input: ToolFields | null, result?: {text; isError; truncated}) → { label; resultLabel? }`** (`input` comes from `readToolInput(part)` = `part.fields ?? tolerantParse(part.inputPreview)`)

| Tool | label | resultLabel |
|---|---|---|
| Read | `Read <basename>` + ` (a–b)` when offset/limit (a=offset, b=offset+limit−1; `(from a)` if only offset) | `N lines` (`N+ lines` if truncated) |
| Glob | `Glob "<pattern>"` + ` (in <path>)` | `N files` / `No files` |
| Grep | `Grep "<pattern>"` + ` (in <path or glob>)` | `N matches` (lines) / `No matches` |
| Bash | `Bash <first line of command, ≤80>` | `background` if background; `error` if isError; else `N lines of output` |
| Edit / MultiEdit / Write / NotebookEdit | `Edit <basename>` etc. | `error` on isError, else none |
| Agent / Task | `Agent <subagent_type ?? "subagent"> "<description>"` | — (status mirrors the child) |
| WebFetch / WebSearch | `WebFetch <host/path>` / `WebSearch "<query>"` | `error` or none |
| TodoWrite | `TodoWrite` | — |
| `mcp__<server>__<tool>` | `<server> · <tool>` | `error` or none |
| fallback | `<Tool>` + ` <first string field, ≤60>` if any | `error` or `N lines` |

- Never throws. `label` is capped at 200 chars. The UI applies the ellipsis and shows the full label in a tooltip.
- Basename only in the label. The full path is visible in the expanded INPUT.

**D-5 — `agentTree.ts` (the incremental fold)**

```ts
export type AgentStatus = "starting"|"running"|"done"|"error"|"interrupted";
export type RowStatus   = "ok"|"error"|"pending"|"interrupted"|"neutral";
export interface TranscriptRow {               // design §4, plus id/legacy fields
  id: string;            // `${seq}:${partIndex}` — stable across live/replay (React key, expanded-set key)
  seq: number; atMs: number; agentId: string;
  kind: "thinking"|"tool"|"spawn"|"text"|"result"|"system"|"unknown";
  status: RowStatus; label: string; resultLabel?: string;
  childAgentId?: string; background?: boolean; legacyTruncated?: boolean;
  preview?: { input?: string; output?: string; truncated: boolean; isError: boolean;
              stepTokens?: { input: number; output: number } };
}
export interface AgentTreeState { /* opaque to web; copy-on-write maps, see invariants */ }
export function initAgentTree(): AgentTreeState;
export function foldAgentTree(s: AgentTreeState, e: PersistedRunEvent): AgentTreeState;
export function foldAgentTreeBatch(s: AgentTreeState, es: readonly PersistedRunEvent[]): AgentTreeState;
export interface AgentViewContext { runStatus: RunStatus; runStartedAtMs: number|null; runEndedAtMs: number|null;
  commandName: string; requirement: string; model: string|null; agentNames: ReadonlySet<string> }
export interface AgentView { root: AgentNode; unattributed: AgentNode|null; background: BackgroundTask[];
  agentsById: ReadonlyMap<string, AgentNode>; rowsByAgent: ReadonlyMap<string, readonly TranscriptRow[]>;
  instancesByType: ReadonlyMap<string, readonly string[]>; agentCount: number }
export function selectAgentView(tree: AgentTreeState, run: RunState, ctx: AgentViewContext): AgentView;
```

`AgentNode` and `BackgroundTask` are exactly as in design §4, plus `mode: "foreground"|"background"` (header "background/foreground") and `spawnedBy: string|null`.

Fold rules (each event `upgradeLegacyEvent`-ed first; seq guard `e.seq <= lastSeq` → same reference, mirroring `fold`):
1. **Agent identity.** `"root"` is created at init. A child's id is its dispatch `tool_use.toolUseId`, and the child is created when an `Agent`/`Task` tool_use is seen in any agent's message. `parentId` is the agent owning that message (`parentToolUseId ?? "root"`). Nesting is therefore recursive by construction. A duplicate dispatch id is ignored.
2. **agentType** = `part.subagentType` → `task.subagentType` → first child message's `topLevelSubagentType` → `"subagent"`. For classification against the roll-up (AC-1), `selectAgentView` prefers `RunState.dispatches.get(id)?.subagentType`, which is the same source `rollup` uses.
3. **Prompt / description.** Prompt is `task_started.promptPreview`, falling back to a tolerant extract of `input.prompt` from `inputPreview`, with `promptTruncated` set when cut. Description is `fields.description`. The root's prompt is `ctx.requirement` (labelled REQUIREMENT).
4. **Rows.** Every message part becomes one row in its owner agent: `thinking`, `text` (skip empty), `tool` (pending), or `spawn` (Agent/Task; `childAgentId`). `init` becomes a root `system` row (`init session · <model>`). `result` becomes a root `system` row (`result · <subtype>[ (error)]`, status error iff isError). `unknown` becomes a root `unknown` row (neutral, raw preview), **except** `system/thinking_tokens`, which sets the owner's `nowDoing = "Thinking…"` and adds no row. `parse-error` becomes a root `unknown` row labelled `parse-error`. `stepTokens` are the message's usage (input/output).
5. **Pairing.** `tool-results` parts update the row found via `toolIndex[toolUseId]` **in place**: copy-on-write of that one row and that agent's array. Status becomes ok or error, and `resultLabel` + `preview.output` are set. A result for an unknown toolUseId becomes a standalone neutral `tool` row "result (unmatched)" in the event's owner agent. A second result for the same id is ignored (idempotent).
6. **Agent completion (D-5a).** *Foreground* dispatch: its tool_result gives done or error, `result.text = resultPreview`, `endedAtMs = ts`. *Async* dispatch (tool_result `async: true`): the tool_result does **not** complete it. Completion comes from a `task` event with that `toolUseId`, or via `taskId → toolUseId` learned from `task_started` (`task_updated` has no tool_use_id). The status maps `completed` → done, `failed`/`error` → error, `killed`/`stopped`/`cancelled` → interrupted. The result text is that agent's last non-empty `text` row. `mode = "background"`.
7. **Unattributed.** A message whose `parentToolUseId` has no known agent goes to the `"unattributed"` pseudo-agent, with its rows tagged by the orphan parent id. If that dispatch is seen later, its orphan rows are **moved** to the real agent (order preserved by seq) and the parent id is removed from the orphan set. The unattributed node is `null` when empty.
8. **Background tasks.** A tool_use with `background: true` adds a `BackgroundTask{toolUseId, ownerAgentId, label, status:"running", startedAtMs}`. The shell id is captured from its tool_result text (`/ID:\s*(\S+)/`). It becomes done/error on a `task` event for that toolUseId, or on a `BashOutput`/`TaskOutput` result for that shell id that reports a terminal status. It becomes interrupted on `KillShell`/`KillBash` for that id. Otherwise it stays running until the terminal mapping (best effort, A-2).
9. **Counters.** `toolCount`/`errorCount` cover the agent's own tool rows. `nowDoing` is the label of its latest row while it runs (throttling is the web's job).

`selectAgentView` (pure, memoized by reference):
- **Tokens are never re-summed by the tree.** An agent's `freshTokens`/`usage` = `run.actors.get(id === "root" ? "main" : id)?.usage`. That is the same F5-deduped `fold` the graph badges use, so panel numbers equal badge numbers (design §5). The root row shows `rollup(run, agentNames).command.totalFresh` (= the command node badge). Subagent rows show their own fresh. The unattributed node shows Σ orphan actors.
- **Terminal mapping (AC-7).** Applied iff `runStatus ∈ {completed, failed, cancelled, timedOut}`. Root: completed → done, failed → error, cancelled/timedOut → interrupted. Every non-terminal subagent → interrupted, with `endedAtMs = runEndedAtMs`. Every pending row → interrupted. A running background task → `unknown` if completed, else interrupted. While `cancelling`, root is `running` (the UI shows "stopping…" with static glyphs). Root status before any event is `starting`.
- **Spawn rows** take their status from the child (`running` → pending glyph `◉`, done → ok, error → error, interrupted → interrupted).
- **Result card.** Root: the last root `text` row (same rule as `runSummary.finalMessage`). Subagent: D-5a.
- **Identity.** An untouched agent keeps the same `AgentNode` and the same `rows` array reference across folds (cache keyed by record ref + actor-usage ref + terminal flag). The terminal mapping copies rows once, at the transition.

Invariants the Checker verifies (unit-tested): (I1) fold is a pure function of the seq-ordered prefix, so a replay equals live (AC-6). (I2) `foldAgentTreeBatch(s, es)` deep-equals the sequential `foldAgentTree` over es. (I3) no event is dropped: every non-`tool-results` event yields ≥1 row or a documented suppression (thinking_tokens). (I4) never throws on any `RunEvent`, including `fixture-garbage`.

### 10.4 Data flow

```
claude CLI stdout ─line→ daemon.ingestLine ─core.parseLine (D-1)→ {seq,ts,ev}
     ├─ appendEvent → .symbion/runs/<id>/events.jsonl   (ONLY disk write; unchanged code path)
     └─ broadcaster → SSE "run" frames                    (unchanged)
web useRunStore.applyEvents(batch)  ── seq-dedup gate (unchanged)
     ├─ foldState  = fold(…)                  (tokens; unchanged)
     ├─ agentTree  = foldAgentTreeBatch(agentTree, accepted)   ← NEW, O(batch) + one COW per touched agent
     └─ (timeline recompute over allEvents — REMOVED; that was the O(n)-per-batch hot path)
DependencyGraph (container)
     view = useMemo(selectAgentView(tree, foldState, ctx))   ctx from run/historyRun + agentNames
     ├─ graph nodes: runHalo from selectedRunAgentId / hoveredRunAgentId → node via view.agentsById[id].agentType
     │               (root → effectiveActiveArtifactId; agentType → agent node by name; else "not on graph")
     └─ <AgentsPanel view rows live readOnly selectedAgentId onSelectAgent onHoverAgent …/>
           view stack: tree → agent(id) → summary | raw ; Esc/Backspace pop; sessionStorage per runId
History: openHistoryRun loops getRunEvents (unchanged) → historyAgentTree = foldAgentTreeBatch(init, all)
         → same AgentsPanel with readOnly=true, live=false
Graph node click (missionLike): command → "root"; agent name N → instances = view.instancesByType[N]
         0 → toast "`N` did not run in this run."   1 → select   ≥2 → AgentInstancePicker at anchorRect
```

**No RPC method touches disk differently from today.** The only reads are the existing SSE `/run-events` and `getRunEvents`. The web writes nothing to disk. `sessionStorage` and `localStorage` are browser-only.

### 10.5 Web specifics

- **D-6 Virtualization: no new dependency.** `windowing.ts` implements `computeOffsets(count, rowH, measured: Map<index,height>) → Float64Array` (prefix sums, O(n), recomputed only when the count or a measurement changes; ~2k rows is under 1 ms) and `computeWindow(offsets, scrollTop, viewportH, overscan=10) → {start,end}`. Collapsed rows have a fixed height (`ROW_H = 20px`, one line, `truncate`). Only expanded rows are measured (a `ResizeObserver` on the expanded wrapper). `TranscriptList` renders a spacer of `total` height and absolutely positions `[start,end)`. **Justification:** rows are uniform except for a handful of expanded ones, and follow/pause logic must be bespoke anyway. `@tanstack/react-virtual` is the fallback only if QA J10 fails on jank, and it would need a recorded trade-off.
- **Follow** (AC-5): on by default when `live`. A distance from the bottom > 24 px pauses it and records `rowsAtPause`. The pill shows `rows.length − rowsAtPause`. Expanding a row pauses. While paused, appends never change `scrollTop`. `End`, the pill, or scrolling to the bottom resumes. History/readOnly has no follow and no pill.
- **One clock:** `useNow(1000, enabled = live)` lives in `AgentsPanel`. `LiveDuration` gets `nowMs` as a prop. Nothing ticks for history.
- **Now-doing throttle** ≤ 4/s: `useThrottledValue(node.nowDoing, 250)` in `AgentTreeRow`.
- **Motion:** row insert animation only when `live && batchSize ≤ 5 && !reducedMotion`. The F5 backfill (500-event batches) and history therefore render without animation (design §5 "whole tree in one swap"). S8 skeleton: `historyLoading` or (`connection === "reconnecting"` && `lastSeq === 0`).
- **Restore after F5** (AC-6): `agentsPanelSession.ts` stores `{view:"tree"|"agent", agentId}` under `symbion:agentsPanel:<runId>`. It is restored once the view contains that agentId (agent ids are toolUseIds, stable across replay). Otherwise it falls back to the tree.
- **Layout:** panel `w-[360px]` (Q1). While `missionLike` or a terminal summary is shown, the graph row is `h-[calc(100vh-<header offset>)] min-h-[480px]` (Q2). Otherwise it is 480 as today.
- **Error boundary per row** (`TranscriptRowView` wrapped) → "couldn't render this step". All text renders as plain React text. **No markdown / `dangerouslySetInnerHTML`** (security: CLI output is untrusted).
- **Stop** (AC-8): the only stop is `CancelControl` in `MissionStatusStrip`/`RunBar`, relabelled "■ Stop run" with the design copy. `AgentDetailHeader` has no stop affordance (a test asserts this).
- **Removed behaviour (Q3):** the `wasMissionActiveRef` auto-switch-to-Summary effect is deleted. At terminal, the tree shows `RunOutcomeCard`, and an open detail shows `RunFinishedStrip`.

### 10.6 What moves out of `RunTimelinePanel` (AC-9 parity map)

| Old (RunTimelinePanel / `timelineRows`) | New home |
|---|---|
| `⚙ init session · model` | root transcript `system` row |
| `💬` text (main / actor-suffixed) | `text` row in the owning agent's transcript |
| `⚙ <tool>` + expandable `tool/input/stepTokens` | `tool` row (summarized label) → expand: INPUT + OUTPUT + step tokens |
| `🤖 Task → <subagent>` dispatch card | `spawn` row in the parent (drills into the child) + a tree row |
| `↩ result` | merged into its tool row (resultLabel + OUTPUT); unmatched → standalone row |
| `<agent> settled Σ n` | tree row status glyph + tokens; spawn row status |
| `✓/✗ result · subtype` | root `system` row + Outcome card |
| `? unknown(type)` / `⚠ parse-error` | root `unknown` row (neutral, expandable raw). `system/thinking_tokens` is the only suppression (Raw keeps it) |
| `+Δtok` per row | step tokens in the expanded preview; per-agent totals in the header/tree |
| filter chips / node-click filter | drill-down into the agent (design: "drilling in *is* the filter") |
| `m:ss` column | kept (Q5), relative to `run.startedAt` |
| Raw tab (`RunLogTail`, 200-line cap) | S5 `RawEventLog` via `≡` in the root header. It covers **all** events (live: `allEvents`; history: `historyEvents`) on the windowed list. This fixes the old bug where history showed the *live* tail |
| Summary tab | `[View summary]` → `RunSummarySection` (← Agents) |
| follow/pause footer | `TranscriptList` follow + Jump pill |

Tests that move: `packages/core/test/run/derive.test.ts` #1 and #5 (timeline ordering, depth/actor suffix) are deleted and re-expressed as `agentTree.test.ts` cases (dispatch precedes the child's rows; child rows live under the child). `runSummary` tests #2–#4 stay as they are.

### 10.7 Edge cases (design §5 + STATE §9 → handling → test id in testplan)

| Edge case | Handling | Test |
|---|---|---|
| Child message before its dispatch (unattributed) | D-5 rule 7: unattributed pseudo-agent, promoted when the dispatch arrives; never dropped | U-T7, U-T8 |
| Nested subagents depth > 1 | recursive by `parentId`; UI indents 12 px/level, capped at 3 with "↳ +n" | U-T5, W-4 |
| Parallel subagents finishing out of order | completion keyed by toolUseId; tree keeps spawn order (no re-sort) | U-T6 |
| Agent running when the run ends/cancels | terminal mapping → interrupted, durations frozen at `runEndedAtMs` | U-T10, J7 |
| tool_result `is_error` | row error (red `✗` glyph only); agent `errorCount++`; agent itself error only on its own failure | U-T9, W-6 |
| tool_use with no result | pending `○`; interrupted at terminal; StepPreview "waiting for result…" / "◼ interrupted — no result recorded" | U-T10, W-7 |
| Async agent: immediate "launched" tool_result | not a completion; waits for the `task` event (fixture-subagent) | U-T3 |
| Two `init`/`result` pairs in one stream (fixture lines 13–17) | root status from **run status**, never from the first `result`; both rendered as system rows | U-T4 |
| F5 mid-run | attach(afterSeq 0) resets and replays → I1 guarantees equality; session view restore | U-T11, J6 |
| SSE reconnect (afterSeq > 0) / poll fallback | tree NOT reset; the seq guard dedups; same `applyEvents` path | U-T12, W-10 |
| Daemon disconnect mid-view | panel keeps the last state, pulses freeze (connection ≠ live); no writes exist to lose | J6b |
| Daemon restart → reconciled failed | terminal mapping applies on the `state` frame | U-T10 |
| 2,000+ events | incremental batch fold + windowed list | U-T13 (perf + identity), W-9, J10 |
| Unknown / garbage lines | neutral `?` row; never throws (I4) | U-T14 |
| Degraded telemetry | header chip + inline note "Subagent attribution unavailable…" | W-11 |
| Past run with missing/pruned events.jsonl | 0 events but `run.lastSeq > 0` → "Transcript unavailable for this run." + `[View summary]` if `totals` | W-12, J6c |
| Pre-upgrade past run | D-3 legacy upgrade; Thinking non-expandable; truncated results flagged | U-L1…L4, J6d |
| Agent not on graph (Explore, general-purpose) | `not on graph` tag; no halo; node click N/A | W-13 |
| Node that did not run / ran N times | toast / instance picker | W-14, J4 |
| Truncated preview | explicit `⋯ truncated — preview capped at 2,000 chars` (detected via the `…[truncated` marker); copy copies the stored preview exactly | U-S9, W-7 |
| Secrets | only previews already persisted; plain-text rendering; no new reads outside the project | review + /cso |
| Foreign files / publish | untouched: the feature does not write files | — |

### 10.8 Build sequence (small slices; each ends green: `npm test -w packages/core`, `-w apps/daemon`, `-w apps/web`, `tsc --noEmit`)

1. **S1 core parser (D-1)**: `events.ts` + `parseStreamJson.ts` (`user`, `task_*`, `thinking`, `background`, `fields`, `isError`, `async`); `fold` no-ops for the new kinds; web `eventToTail` handles the new kinds (exhaustive). Tests U-P*. **Run the full daemon suite**, which proves "no daemon change".
2. **S2 legacy upgrade (D-3)** + `toolInput.ts`. Tests U-L*.
3. **S3 `summarizeToolCall` (D-4).** Tests U-S* (AC-2).
4. **S4 `agentTree.ts` fold + select + terminal mapping (D-5)** + synthetic fixtures. Tests U-T* (AC-1, AC-7, AC-10 core).
5. **S5 delete `timelineRows`/`TimelineRow`** (core, rpc-types re-export, dist rebuild); migrate derive tests #1/#5.
6. **S6 store**: `agentTree`/`historyAgentTree`/`historyEvents`; remove `timeline`/`historyTimeline`. Test W-10.
7. **S7 primitives**: `StatusGlyph`, `useNow`/`LiveDuration`, `windowing.ts` + `useWindowedList`. Tests W-1, W-2, W-9a.
8. **S8 transcript**: `TranscriptList`, `TranscriptRowView` (+boundary), `StepPreview`, `JumpToLatestPill`, `ResultCard`. Tests W-5…W-9.
9. **S9 panel**: `AgentTree`/rows, groups, `RunOutcomeCard`, `AgentDetailView`/`Header`/`PromptBlock`, `RunFinishedStrip`, `RawEventLog`, `AgentsPanel` (stack, keyboard, session). Tests W-3, W-4, W-11, W-12, W-15.
10. **S10 graph wiring**: `DependencyGraph` (mount, remove filter + auto-summary, selection/hover, height/width), `GraphCanvas` anchorRect, node halos, edge `runLinked`, `AgentInstancePicker`, toast; `CancelControl` copy; `RunSummarySection` back/links. Tests W-13, W-14, W-16; update `DependencyGraph.test.tsx`.
11. **S11 cleanup + QA harness**: delete `RunTimelinePanel.tsx`; add the QA fixtures (`fixture-agents-synthetic.ndjson`, `fixture-big-2500.ndjson` generator script under `apps/daemon/test/fixtures/`, test-only) for the fake CLI; grep for the remaining `timeline`/`panelFilterId`/`RunTimelinePanel` references (must be 0).
12. Then `/review` (+ short `/cso` per §10.1 Q-e) → `/qa` (J1–J10).

### 10.9 Decisions, assumptions, risks (track in REVIEW)

- **D-1** additive parser extension changes new runs' persisted content → needs user ack + short /cso (§10.1 Q-e).
  - **USER DECISION 2026-10-16:** D-1 **ACKED** (including newly persisted thinking text). **/cso intentionally SKIPPED** by user choice. Residual risk accepted:
    - thinking text is now at rest in gitignored `events.jsonl`;
    - the parser is the trust boundary for untrusted CLI output.

    The code-reviewer must explicitly check that (1) the parser never throws on hostile input and caps are enforced, and (2) the UI renders all CLI-derived text as plain text (no `dangerouslySetInnerHTML` / markdown-to-HTML).
  - Pipeline for this feature: plan → build → code-reviewer → live QA → ship (simplify-implementation fast-track with review+QA added back by the user).
- **D-2** fold + select split; `deriveAgentTree` is a test/one-shot convenience only.
- **D-5** tokens are read from `RunState` and never recomputed. Any tree-side token math is a defect (AC-1 / "numbers cannot drift").
- **D-6** no virtualization dependency.
- **D-7** the root model is `init.model` (falling back to `run.modelOverride`). Subagent model is the first child message's `model`.
- **A-1** ingest `ts` is accurate enough for m:ss. **A-2** background-Bash completion signals are unverified against a real CLI. **A-3** `task_*` event shapes are pinned to CLI 2.1.x from `fixture-subagent`; unknown subtypes degrade to `task` with no status effect.
- **R-1** the `fold` messageId `Set` copy per message is O(messages per actor) (quadratic on very long single-actor runs). Out of scope (shared with the daemon), measured in U-T13; flag if > 200 ms at 5k events. **R-2** a CLI format drift on `user`/`task_*` breaks pairing but never crashes (I4). **R-3** a legacy run with large results shows "not recoverable" rows. **R-4** `readEvents` re-reads the whole file per 500-page. **R-5** `allEvents` array copy per batch remains O(n) per batch (cheap; kept for `runSummary`/Raw).

## 11. BUILD — implementation notes (feature-builder, 2026-10-17)

> Maker output. NOT self-reviewed — everything below is for the Checker (`code-reviewer`) and `/qa` to verify. Nothing committed.

### 11.1 Final gate results (all green)

| Gate | Result |
|---|---|
| `npm run test:core` | 30 files, **281 passed** (baseline 230; +53 new, −2 migrated derive #1/#5) |
| `npm run test:daemon` | 38 files, **409 passed** (baseline 408; +1 new test-only file) — **zero edits under `apps/daemon/src`** (`git diff -- apps/daemon/src` empty) |
| `npm run test:web` | 24 files, **156 passed** (baseline 89; +67) |
| `npm run build` (core, rpc-types, daemon `tsc`, web `next build` incl. lint + type check) | exit 0 |
| U-T13 timing (logged) | batch fold 2,400 ev ≈ 15–46 ms (<150); `fold`+`foldAgentTree` per event × 5,000 ≈ 110–155 ms (<500; R-1 not triggered) |

Note: `npx tsc --noEmit` in `apps/web` reports pre-existing `toBeInTheDocument` type errors in older test files (jest-dom matchers are only typed via the vitest setup). They pre-date this feature and `next build` passes; not touched.

### 11.2 Slices completed (§10.8)

- **S1** parser D-1 (`events.ts`, `parseStreamJson.ts`): `user` → `tool-results` (`isError`, `async`), `system/task_*` → `task`, `thinking`/`redacted_thinking` parts (signature dropped), tool_use `background` + whitelisted `fields` (pre-cap, strings ≤300 via `TOOL_FIELD_CAP`). `parseLine` split into `parseLine` + exported `parseStreamJsonRecord` (shared with D-3; wrapped in try/catch → `unknown`). `aggregate.fold`: explicit no-op cases. Web `eventToTail` exported + exhaustive. Tests U-P1…U-P16 (`parseStreamJson.user-task.test.ts`; U-P15 values snapshotted from the pre-change `dist`).
- **S2** `legacyEvents.ts` (`upgradeLegacyEvent`) + `toolInput.ts` (`readToolInput`, `parseInputPreview`, `extractPromptFromPreview`, `isTruncatedPreview`, `stripTruncationMarker`). Tests U-L1…U-L5.
- **S3** `summarizeToolCall.ts` (+ `countLines`, `LABEL_CAP`). Tests U-S1…U-S11.
- **S4** `agentTree.ts` (`initAgentTree`/`foldAgentTree`/`foldAgentTreeBatch`/`selectAgentView`/`deriveAgentTree`) + `fixture-agents-synthetic.ndjson` + `test/run/helpers/bigRun.ts`. Tests U-T1…U-T20 + a J2 label pre-check.
- **S5** `timelineRows`/`TimelineRow` deleted (core, rpc-types re-export); derive #1/#5 removed (re-expressed as U-T19).
- **S6** store: `timeline`/`historyTimeline` → `agentTree` (incremental `foldAgentTreeBatch` per accepted batch), `lastBatchSize`, `historyAgentTree`/`historyFoldState`/`historyEvents`. Test W-10.
- **S7** `windowing.ts`, `useWindowedList.ts`, `useNow.ts` (+ `useThrottledValue`, `useReducedMotion`), `StatusGlyph`, `LiveDuration`. Tests W-1, W-2, W-9a.
- **S8** `TranscriptList` (+ `PositionedRow` measurement), `TranscriptRowView` (+ `RowErrorBoundary`), `StepPreview` (+ `CopyButton`), `JumpToLatestPill`, `ResultCard`. Tests W-5…W-9.
- **S9** `AgentTree`/`AgentTreeRow`, `AgentGroups` (Background/Unattributed), `RunOutcomeCard`, `AgentDetailView`, `AgentDetailHeader`, `PromptBlock`, `RunFinishedStrip`, `RawEventLog`, `AgentsPanel`, `agentsPanelSession.ts`. Tests W-3, W-4, W-11, W-12, W-13, W-15, W-16, W-17, W-20.
- **S10** `DependencyGraph` (panel mount 360px, filter chips / `panelMode` / auto-summary effect removed, selection + hover halo, node click → detail / picker / toast, grows to viewport height), `GraphNode`/`GraphCanvas` (`onNodeClick(id, anchorRect)`), `CommandNode`/`AgentNode` (`runHalo` ring outside the status ring), `GraphEdgePath` (`runLinked`), `AgentInstancePicker`, `CancelControl` ("■ Stop run" + design copy), `RunSummarySection` (`← Agents` / `onBack`, `onOpenAgent`). Tests W-14, W-16, W-18; `CancelControl.test.tsx` updated.
- **S11** `RunTimelinePanel.tsx` deleted; W-19 guard (`apps/web/src/agentRunParityGuard.test.ts`, scans `apps/` + `packages/` source) passes with 0 matches; QA fixtures added (see 11.4).

### 11.3 Files

- **core (new):** `packages/core/src/run/{agentTree,legacyEvents,summarizeToolCall,toolInput}.ts`; tests `packages/core/test/run/{agentTree,legacyEvents,summarizeToolCall,parseStreamJson.user-task}.test.ts`, `packages/core/test/run/helpers/bigRun.ts`, `packages/core/test/fixtures/run/fixture-agents-synthetic.ndjson`.
- **core (mod):** `events.ts`, `parseStreamJson.ts`, `aggregate.ts`, `derive.ts`, `index.ts`, `test/run/derive.test.ts`. **rpc-types:** `src/index.ts` (drop re-export).
- **daemon (test-only):** `apps/daemon/test/run-agentEvents.test.ts` (D-2), `apps/daemon/test/fixtures/fixture-agents-synthetic.ndjson` (copy), `apps/daemon/test/fixtures/gen-fixture-big.ts`. Root `.gitignore`: `apps/daemon/test/fixtures/fixture-big-*.ndjson`.
- **web (new):** `apps/web/src/lib/run/{windowing,useWindowedList,useNow,agentsPanelSession}.ts`; `apps/web/src/components/run/agents/*` (AgentsPanel, AgentTree, AgentGroups, AgentDetailView, AgentDetailHeader, PromptBlock, TranscriptList, TranscriptRowView, StepPreview, ResultCard, RunOutcomeCard, RunFinishedStrip, JumpToLatestPill, StatusGlyph, LiveDuration, AgentInstancePicker, RawEventLog, format.ts, agentsTestUtil.ts) + tests; `DependencyGraph.agents.test.tsx`, `run/RunSummarySection.test.tsx`, `lib/run/{windowing,useRunStore.agentTree}.test.ts`, `agentRunParityGuard.test.ts`.
- **web (mod):** `DependencyGraph.tsx`, `graph/{GraphNode,GraphCanvas,CommandNode,AgentNode,GraphEdgePath}.tsx`, `run/{CancelControl,CancelControl.test,RunSummarySection}.tsx`, `lib/run/useRunStore.ts`. **Deleted:** `run/RunTimelinePanel.tsx`.

### 11.4 Deviations from the plan (Checker: please judge each)

1. **S5 + S6 + the S11 deletion were landed together**: deleting `TimelineRow` breaks `RunTimelinePanel`/the store, so the slices could not each end green separately.
2. **View-model field names** (additive or renamed vs design §4): `AgentNode.graphNodeId` → **`graphKey`** (`"main"` | graph agent name | `null`; DependencyGraph maps it to node ids, since core does not know artifact ids). `AgentNode.spawnedBy` = the parent **agent id** (the UI resolves the label). Added `AgentNode.depth`; `TranscriptRow.ts`, `.tool`, `.orphanOf`; `preview.inputTruncated` (`truncated` refers to OUTPUT); `BackgroundTask.rowId`, `.command`, `.shellId`; `AgentView.eventCount`; `ToolResultPart.legacyTruncated` (set only by `upgradeLegacyEvent`, never persisted).
3. **`task` events produce a root `system` row** (`task · <subtype> · <status> · <description>`). Rule 4 did not specify one; chosen to satisfy I3 and the "nothing dropped" parity of the old timeline (which showed them as `unknown`).
4. **`toolCount` counts `tool` rows only**; spawn (Agent/Task) rows are not counted.
5. **tool_result content arrays are flattened to text** (text blocks joined with `\n`, images → `[image]`, other blocks JSON) instead of `JSON.stringify` of the array. This also changes assistant-side `tool_result` parts (never observed in real output).
6. **`async`** is set by the parser only when the user line has exactly one tool_result. The tree additionally treats a result preview starting with `Async agent launched` as async (defensive).
7. **`attach(afterSeq = 0)` now also resets `rawTail`** (it did not before, so an F5 replay could duplicate raw lines).
8. **`live` vs `connectionLive`** on `AgentsPanel`: follow/pill semantics stay on while reconnecting/polling, while pulses and tickers freeze (design §5). The plan only had `live`.
9. **History placeholder**: while `openHistoryRun` is in flight (no `historyRun` yet) DependencyGraph passes an empty placeholder context so the S8 skeleton renders.
10. **Outcome card "Adjust ceilings ›"** is a plain `<a href="/settings?project=…#execution">`, not `useRouter` (keeps the panel router-free; `RunSummarySection` keeps its own router link).
11. **Big QA fixture is generated, not committed** (~0.8 MB): `npx vite-node apps/daemon/test/fixtures/gen-fixture-big.ts [count]` writes `fixture-big-2500.ndjson` next to it (gitignored). Source of truth: `bigRun.ts` (same generator as U-T13).
12. **A daemon test file was added** (`run-agentEvents.test.ts`, D-2) even though §2 said "no new daemon tests expected". It is test-only and asserts the persisted kinds, no `signature` on disk, and `totals.fresh` = 20 (unchanged).
13. The testplan's fixture "line N" references are off by one versus the real `fixture-subagent.ndjson` (one more `thinking_tokens` line). Tests locate lines by content.

### 11.5 Assumptions (to verify)

- **A-B1** jsdom: `clientHeight` = 0, so `useWindowedList` falls back to a 400 px viewport; `scrollTop` is settable. W-8/W-9 rely on this. Real-browser follow/pause and `ResizeObserver` measurement of expanded rows (`EXPANDED_ESTIMATE_PX` = 160 until measured) are unverified, so J5/J10 are needed.
- **A-B2** Mission layout height `h-[calc(100vh-200px)] min-h-[480px]`: the 200 px header offset is a guess; check it in QA.
- **A-B3** `selectAgentView` memo caches are module-level `WeakMap`s keyed by internal records/arrays. They are pure-equivalent (only affect identity) but are shared across callers.
- **A-B4** Timestamps: rows store the ingest `ts` (A-1). Agent start = dispatch `ts`. Async agent end = `task_updated`/`task_notification` `ts` (whichever maps to a completed status first).
- **A-B5** Background Bash completion (A-2): implemented as best effort (task event for the toolUseId, `BashOutput`/`TaskOutput` results with `<status>…</status>`/`status: …` + exit code, `KillShell`/`KillBash`). None of this is verified against a real CLI. `ID:` capture uses `/ID:\s*(\S+)/`-style matching on the immediate result.
- **A-B6** `AgentsPanel` resets its stack when `runId` changes. Session restore (AC-6) gives up on the stored agent once the view is terminal/read-only and the agent is absent.

### 11.6 Not done / left for QA or follow-up

- No live browser verification (J1–J10). That is `/qa`. The QA harness is ready: `apps/daemon/test/fixtures/fixture-agents-synthetic.ndjson` + generator.
- Design polish not implemented: the "↓ 1 new agent" chip for tree inserts below the fold; `countLockIn` settle flash on glyphs; mirrored slide on back (only the forward `slideIn` exists); the per-row tree hover `TokenBreakdownCard` is present but the detail header shows a plain `title` tooltip instead.
- The `cancelling` state shows "stopping…" in the detail header and static glyphs. The tree has no "stopping…" text (the strip already shows CANCELLING).
- The optional real-CLI parity fixture (`fixture-real-agents.ndjson`, retires A-2/A-3) was not recorded (it costs tokens).
- R-4 (`readEvents` re-reads the file per page) is untouched, by design.

### 11.7 Points for the Checker (explicit, per §10.9 D-1 user decision)

1. Parser never throws on hostile input and caps are enforced: `parseStreamJsonRecord` try/catch; `TOOL_FIELD_CAP` 300 on every `fields` string and on task ids/status/types; `PREVIEW_CAP` on thinking/description/prompt/summary/result; `RAW_CAP` unchanged. Covered by the U-P13 fuzz, U-T14 and the legacy salvage regexes in `legacyEvents.ts`.
2. All CLI-derived text renders as plain React text. Grep confirms there is no `dangerouslySetInnerHTML`/markdown in `apps/web/src/components/run/**` or `DependencyGraph.tsx`. A test renders `<img onerror>`/`<b>` payloads literally (`transcript.test.tsx`).
3. D-5: `agentTree.ts` does no token math. Every number comes from `RunState.actors` / `rollup` (U-T1, U-T2). The unattributed node sums fresh over actors whose key is not a known agent; that is the one place tokens are added in the tree view, and the Checker should confirm it is acceptable.
4. The no-stop rule (AC-8): the only stop remains `CancelControl` (strip / RunBar). Esc in the panel never reaches cancel (W-15, W-16).

## 12. REVIEW — independent Checker (code-reviewer, 2026-10-17)

**Verdict: APPROVE-WITH-FIXES.** The reviewer ran the gates themselves, all green: core 281/281, daemon 409/409, web 156/156, `npm run build` exit 0. `git diff -- apps/daemon/src` is empty, there are no `node:` imports in core, and the RPC/SSE contracts are unchanged.

**Hostile-input fuzz** (substitutes for the skipped /cso). The inputs were 200k-deep arrays, 100k-deep objects, 5 MB strings, wrong types, `__proto__`/`constructor` keys and truncated legacy lines.
- The parser, legacy upgrade, fold and tree fold never threw.
- No prototype pollution.
- Thinking, preview, fields and prompt are all capped. `background` is read before truncation.
- **XSS:** no `dangerouslySetInnerHTML`, `innerHTML` or markdown renderer on any run or graph surface.

| # | Sev | Where | Issue | Disposition |
|---|---|---|---|---|
| 1 | MAJOR | `parseStreamJson.ts:136,206` | `tool_use_id` / `parent_tool_use_id` on `user` lines are uncapped, so a 6 MB event was persisted (regression vs the 8 KB RAW_CAP) | **fix before ship**; also cap tool_use `id`/`name`/`subagentType` |
| 2 | MINOR | `agentTree.ts:478-523` | `promoteOrphans` doesn't rewrite `BackgroundTask.ownerAgentId`, so clicking the task opens the wrong transcript | fix |
| 3 | MINOR | `agentTree.ts:980-993` | unattributed memo deps miss the summed `usage`, so a stale cache-token breakdown is shown | fix |
| 4 | MINOR | agentTree unattributed sum | an actor keyed literally `"root"`/`"unattributed"` is dropped | fix (exclude only `"main"` + real ids) |
| 5 | MINOR | `AgentsPanel.tsx:133-136` | F5 restore gives up after the first 500-event chunk (AC-6) | fix |
| 6 | MINOR | `useRunStore.ts openHistoryRun` | no stale-request guard (A then B quickly shows A's tree under B) | fix |
| 7 | NIT | `TranscriptList.tsx:76-83` | setState inside the `setExpanded` updater | fix |
| 8 | NIT | `agentTree.ts:1017` | O(n²) `indexOf` sort | fix if cheap |
| 9 | NIT | `graphKey` | an agent dispatched only by a subagent shows "not on graph" | note for QA (matches the badge roll-up) |

### 12.1 BUILD — review fixes (feature-builder, 2026-10-17)

Maker output, not self-reviewed. Items 1–8 applied; 9 is a QA note only. No daemon source / RPC / SSE change; nothing committed.

1. **Parser id caps** (`parseStreamJson.ts`). A new `optId()` hard-caps ids at `TOOL_FIELD_CAP` (300, no marker) for:
   - `user` tool_result `tool_use_id` and `parent_tool_use_id`
   - assistant `parent_tool_use_id`
   - task `task_id` / `tool_use_id`

   `capField` now also covers the tool_use `id`, `name` and `subagentType`, plus the message `id`, `model` and `topLevelSubagentType`.
   Test U-P13b: a 5 MB id + 1 MB parent `user` line serializes to < 1,000 chars, and every assistant id/name/type is ≤ 300.
2. **`promoteOrphans`** now rewrites `BackgroundTask.ownerAgentId` from `unattributed` to the promoted agent when the task's `rowId` moved (test #2).
3. **Unattributed memo deps** now include the summed `usage.input/output/cacheRead/cacheWrite` by value (test #3: a cache-only change with no new row refreshes the node).
4. **Unattributed sum** now skips only `"main"` and real subagent ids. Actors keyed `"root"`/`"unattributed"` are counted and equal `rollup().unrecognized` (test #4).
5. **AgentsPanel F5 restore** gives up on a missing agent only once the replay is complete:
   - read-only or terminal runs: when `eventCount >= runInfo.lastSeq`
   - live runs: additionally `connectionLive` and the last batch < 500
   - any user navigation (push/pop) stops auto-restore

   Test: restore survives a full chunk, a reconnecting connection, and a terminal-but-not-caught-up state.
6. **`openHistoryRun` stale guard**: `get().historyRunId !== runId` is checked after each page fetch and before the final `set`. Test: a slow A opened before B never overwrites B.
7. **`TranscriptList.toggle`**: `wl.pause()` is moved out of the `setExpanded` updater (it reads an `expandedRef`).
8. **`instancesByType` sort** uses an O(n) index map instead of `indexOf`.

**Gates after the fixes (verbatim):**
- `npm run test:core`: Test Files 30 passed (30), Tests 285 passed (285)
- `npm run test:daemon`: Test Files 38 passed (38), Tests 409 passed (409)
- `npm run test:web`: Test Files 24 passed (24), Tests 158 passed (158)
- `npm run build`: exit 0
- `git diff -- apps/daemon/src`: empty

**Open points for the Checker:**
- #1 caps message `id`/`model` too. This is beyond the ask; real values are far below 300, so dedup is unaffected.
- #5 uses "last batch < 500" as the live backfill-complete signal. It depends on the daemon's `EVENTS_CAP` = 500 chunking, which is not imported.

## 13. QA — live browser run (2026-10-17, orchestrator, headless Chromium 149 over CDP)

Harness: isolated daemon (`SYMBION_CONFIG_DIR` in scratchpad, fake CLI `fake-claude.mjs`, $0), scratch git project `qa-agents` (`/analyze` @-mentions `ba` + `Explore`). Real `~/.config/symbion` and the `geochat` project were not touched. chrome-devtools MCP and the Playwright MCP browser were unavailable, so the checks ran as Playwright scripts against a local headless Chromium. Screenshots: `scratchpad/qa/shots/`.

| J | AC | Result | Evidence |
|---|---|---|---|
| J3 | AC-3 | PASS | Panel appears with the run. Subagent rows appear as dispatched, graph nodes glow, durations and tokens tick, now-doing line updates, BACKGROUND group shows. |
| J2 | AC-2 | PASS | `Read STATE.md (40–189) · 150 lines`, `Glob "docs/loops/*.md" · 41 files`, `Grep "…" (in packages) · 3 matches`, `Bash npm test · error`, `Agent … ›`, `Bash … · background`. |
| J4 | AC-4 | PARTIAL | Agent detail (header, 3-line prompt + Show more, rows in order, Result card) PASS. **Graph-node click after the run has ended FAILS (F1).** Instance picker not verified. |
| J5 | AC-5 | PASS | 2,500-event live run: paused at `scrollTop` 200, stayed at 200 while new rows arrived, pill "↓ 10 new · Jump to latest", pill and `End` both resumed following. |
| J6 | AC-6 | PASS | B's detail restored after F5 once the Graph tab is opened. |
| J6e | AC-6 | PASS | Past run under the banner: same tree, "not on graph" only on `general-purpose` (correct), drill-down works. |
| J7 | AC-7 | PASS | Cancel: card "◼ Cancelled by you · 13s", 0 `◉` anywhere, Explore `◼ interrupted`, agent A `✓` with "4 tools · 1 error". |
| J8 | AC-8 | PASS | Only `■ Stop run` (strip + RunBar) in both tree and agent detail. Confirm copy "Stops the whole run, including all subagents. Files already written stay written." |
| J9 | AC-9 | PASS | No auto-switch to Summary, "Run finished" strip present, Raw via `≡` shows 2,500 events, Summary via `View summary`. |
| J10 | AC-10 | PASS | 0 long tasks during a 2,500-event stream, scroll frame gap max 19 ms, 39–43 transcript rows in the DOM (≤60), history reopen to visible tree 108 ms. |

**NOT verified live:** J1 (token equality vs badge hover), J6b (daemon restart mid-run), J6c (missing `events.jsonl`), J6d (legacy pre-upgrade run), `prefers-reduced-motion`, the hover halo visuals, the instance picker. Covered only by unit/component tests.

### Defects found
- **F1 (MAJOR): graph↔panel linking breaks as soon as a run ends.**
  - Repro: run `/analyze` to completion, then look at the panel. All three agents carry "not on graph" although `ba` and `Explore` are graph nodes (history view of the same run is correct). Clicking the `ba` node does nothing (panel stays on the tree, no detail/picker/toast).
  - Cause: `DependencyGraph.tsx`: `runParticipantAgentNames` (`:635`), the halo ids (`:690-691`), the selection reset (`:695`) and `onNodeClick` (`:1192`) are all gated on `missionLike = missionActive || viewingHistory`, but the panel is also shown in the terminal-with-summary state (`panelShown`, `:1064`). With `missionLike` false `agentNames` is empty, so `graphKey` is `null` for every agent.
  - Violates STATE §9 item 6 ("during or after a run") and AC-4.
- **Pre-existing, not part of this change (noted only):**
  - After F5 the project reopens on the List tab and a live run only reattaches once the Graph tab is opened.
  - After reattaching to a finished run the strip/RunBar elapsed shows `00:00`.

### 13.1 BUILD — QA fix F1 (feature-builder, 2026-10-17)

Maker output, not self-reviewed. Fix for the "not on graph" tag and dead node clicks on a terminal run with a summary.

- **Cause:** panel linking was gated on `missionLike` (`missionActive || viewingHistory`), but the panel is also shown for a terminal run with a summary, so `agentNames` was empty and every `graphKey` was null.
- **Fix** (`DependencyGraph.tsx` only):
  - `panelShown` is computed early and aliased as `panelLinkLike`.
  - A new `panelAgentNames` memo is derived from the effective command's @mentions whenever the panel is shown. It feeds `agentCtx`.
  - `panelLinkLike` also gates the halo ids, the selection-reset effect, `onNodeClick` and the `runLinked` edge.
  - In the terminal state the nodes get the halo only. There is no dimming, and `highlighted` is unchanged.
- **Unchanged:** `runParticipantAgentNames`, dimming, glow, dispatch, edge settle tint and `runParticipant` stay on `missionLike`.
- **Tests (3 new, in `DependencyGraph.agents.test.tsx`):**
  - graph agents keep their `graphKey`; `Explore` stays tagged; 2 instances → picker, 0 → toast, command node → root and halo.
  - 1 instance opens its detail.
  - authoring unchanged after the run: nodes not dimmed, toolbar enabled.

**Gates (verbatim):**
- core: Test Files 30 passed (30), Tests 285 passed (285)
- daemon: Test Files 38 passed (38), Tests 409 passed (409)
- web: Test Files 24 passed (24), Tests 161 passed (161)
- `npm run build`: exit 0
- `git diff -- apps/daemon/src`: empty

## 14. SHIP — close-out (2026-10-17)

- **F1 re-verified live:** after a run ends, "not on graph" shows only on `general-purpose`. `ba` ×2 opens the instance picker, picking "Solutions angle" opens its detail, Explore opens its detail, and the command node opens the root. **J4 PASS.**
- **Final gates:** core 285/285, daemon 409/409, web 161/161, `npm run build` exit 0, `git diff -- apps/daemon/src` empty (no RPC/SSE change), no secret files.
- **Review fixes (items 1–8) and QA fix F1** are in; details in §12, §12.1, §13, §13.1.
- **Residual risk (accepted):**
  - /cso was skipped, so thinking text is now at rest in gitignored `events.jsonl`. The reviewer's fuzz and XSS checks (§12) stand in for it.
  - Background-Bash completion and `task_*` event shapes are only covered by synthetic fixtures; no real-CLI fixture was recorded (A-2/A-3).
  - NOT verified live: J1, J6b, J6c, J6d, `prefers-reduced-motion`, hover halo visuals.
  - Some design polish was not built: "↓ 1 new agent" chip, the settle flash, the reverse slide on back.
- **Follow-ups:**
  - ~~CLAUDE.md still says "Run engine deferred to v2"~~ — DONE: README.md + CLAUDE.md updated by /document-release (2026-10-17).
  - Record a real-CLI fixture.
  - Pre-existing: List tab after F5, `00:00` elapsed on a reattached finished run.
