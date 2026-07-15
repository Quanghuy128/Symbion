# graph-execution-realtime — STATE

> Feature: **Run Engine v2** — execute commands/agents from the Symbion graph with realtime telemetry (tokens, per-step process history).
> Pipeline stage: **P1 DONE — shipped 2026-07-15** (execute/cancel/log-tail/glow, no token math). P2 (structured telemetry: aggregate/pricing/derive, roll-up UI, real subagent fixture) and P3 (history/reattach/settings) are follow-up features, not started.
> Created 2026-07-13 by /analyze.

## 1. Original request (user, translated)

Symbion today only *authors* workflows. The user wants an **execution** experience:

- On the graph screen (nodes = commands + agents), click a command node → enter a requirement → press **Execute**.
- Symbion actually runs the AI (headless) executing that slash-command in the target repo.
- The graph becomes a live mission-control view:
  - Executing command node lights up + shows live token usage.
  - When the command dispatches a subagent (e.g. /analyze → ba, architect), that agent node lights up with its own token count.
  - **Roll-up rule**: command node total INCLUDES its subagents (command own 100k + agent 30k → command shows 130k, agent shows 30k).
- Full process history: every tool call / step the AI made, with per-step token cost. "The more visual and detailed the realtime view, the better."
- Side-request: evaluate replacing React Flow ("because it's paid") — criteria: free, well-supported, well-maintained; hand-rolled is acceptable if quick.
- User explicitly says the idea is rough; wants (1) a complete end-to-end workflow concept, (2) a UI prototype.

## 2. Pre-research (verified 2026-07-13)

### Graph library — React Flow is NOT paid

- **@xyflow/react (React Flow) core is MIT-licensed, free forever, including commercial use.** Only "React Flow Pro" is paid — a support subscription + advanced *examples* (drag-drop templates etc.). The library itself never requires payment.
  - Sources: https://xyflow.com/open-source , https://github.com/xyflow/xyflow/discussions/3397 , https://reactflow.dev/pro
- Symbion already uses React Flow for the read-only dependency graph (per CLAUDE.md stack table). **Recommendation: keep React Flow** — zero migration cost, MIT, the most-supported node-UI lib in the React ecosystem. Custom nodes cover the "glow + token ticker" overlay natively.
- Alternatives (all free/MIT, only if React Flow were rejected): Cytoscape.js (graph-theory oriented, less React-native), Sigma.js (WebGL, huge graphs — overkill), AntV G6, vis-network, or hand-rolled SVG+dagre (cheap for ~20 static nodes but re-implements pan/zoom/hit-testing for no gain).

### Telemetry source — Claude Code headless / Agent SDK

- `claude -p "/analyze <req>" --output-format stream-json --verbose [--include-partial-messages]` emits **newline-delimited JSON events**: `system/init` (session metadata), assistant/user messages, `stream_event` (token deltas, tool_use), `system/api_retry`, final `result` (includes `total_cost_usd`, per-model usage).
  - Source: https://code.claude.com/docs/en/headless
- Per-message `usage` blocks (input/output/cache tokens) arrive on assistant messages → per-step token cost is derivable by diffing/summing message usage.
- **Subagent attribution**: Agent SDK messages carry `parent_tool_use_id` (null = main agent, set = inside the Task/Agent tool call that spawned the subagent) — this is the key that makes the token roll-up rule implementable. ⚠️ *Field name to re-verify against the installed CLI version during /plan (docs fetch was rate-limited mid-analyze).*
- Cancellation: kill the child process (CLI) or `query().interrupt()` (TS Agent SDK). SDK also has SubagentStop-style hooks. ⚠️ same verification note.
- Skills/slash-commands work in `-p` mode: include `/skill-name` in the prompt string. `--bare` skips repo config — NOT wanted here (we need the target repo's .claude/ to load).

## 3. Requirements

### 3.1 Ground truth (verified against the codebase by BA agents)

- The run engine is an **explicit v1 deferral being reopened**: `symbion-STATE.md` §0 ("Run engine: DEFER to v2") and §8 assumption #7 ("no process spawn anywhere in v1") must be **formally superseded**, not silently violated.
- **No realtime channel exists today** — daemon is plain `node:http`, zero runtime deps, request/response `POST /rpc` only (31 methods in `packages/rpc-types`). Realtime is a new capability class.
- Daemon is **tokenless** since 2026-07-09 (`tokenless-daemon-STATE.md`): that risk was accepted for *file-writing* RPCs guarded by diff-preview. A **process-spawning** RPC changes the calculus → must be re-decided, `/cso` mandatory.
- The graph already has the right anatomy: command→agent edges with per-edge `×count`/`goal` metadata (interactive-graph), `CommandNode` action menu with `onCopyRun` → `CopyRunCommandDialog` (natural seed for the Run dialog), nodes derived from `artifacts` via `useMemo` with a `data` bag → run overlay = inject `runStatus`/`tokenCount` there.
- Spawn precedents in daemon: `git/status.ts` (`execFileSync`, argv-array — the injection-safe pattern), `boot/openBrowser.ts`. Preflight-UX precedent: `llm/providerStatus.ts` + `installInstructions.ts`. Append-only log precedent: `store/publishLog.ts`.

### 3.2 Core jobs-to-be-done

- **J1 Close the loop**: author → publish → *run* → observe in one tool (Symbion becomes the cockpit for the machine it builds).
- **J2 Observability**: the graph becomes a live truth-check that the workflow behaves as drawn (command lights → dispatches ba → architect).
- **J3 Cost attribution**: per-node tokens with subagent roll-up = workflow profiling ("which part of my pipeline is expensive").
- **J4 Auditable history**: replayable per-run record (every tool call + per-step token cost), not a live view that evaporates.
- **Anti-goal**: NOT a free-form drag-drop executor canvas. Execution = "run this one command with this input".

### 3.3 Key functional requirements (condensed — full detail in analysis transcripts)

- **FR-1 Initiation**: Execute affordance on **command** nodes only; dialog = requirement text (`$ARGUMENTS`) + optional model override + echo of exact invocation. **Preflight gate**: CLI installed+authenticated; artifact published & not in conflict (warn on drift "disk ≠ what you see"); project path confined; missing/unpublished referenced agents surfaced. **Per-run explicit UI consent** before any spawn (spawn-analog of "publish shows diff before write").
- **FR-2 Lifecycle**: `starting → running → (completed|failed|cancelled|timed-out)`; every run reaches a terminal state (daemon-boot reconciliation marks orphaned "running" as `failed (daemon-restarted)`). Cancel kills the **process tree** (detached + kill(-pid), SIGTERM→SIGKILL, ≤5s confirmed dead). Timeout/token ceilings on by default. Concurrency: **1 active run per project** (proposal).
- **FR-3 Telemetry**: tokens/tools/subagent events come from the CLI's stream-json only (never estimated). Normalized provider-agnostic run-event model. **Attribution rule (locked by user)**: agent node = Σ its own invocations; command node = own + Σ descendants (100k+30k → 130k/30k). Unattributable usage → command bucket + flagged "unrecognized subagent", never dropped/silently misattributed. Parse failure → degrade (keep raw, mark "telemetry degraded"), never kill a healthy run.
- **FR-4 Realtime graph binding**: node states idle/active/done/error; live token tickers; active edge highlighted; event feed/timeline panel (tool name, per-step token delta) synced with the graph; overlay additive & reversible over interactive-graph P1–P8; **F5 refresh-proof — run lives in the daemon, UI reattaches** (lesson already paid for in tokenless-daemon).
- **FR-5 History**: every run persisted per-project (`.symbion/runs/<id>/` — run.json + events.jsonl proposed), append-only, schemaVersion'd, gitignore-suggested (transcripts can contain secrets/file contents — one `git add .` from being committed).
- **FR-6 Error states**: ER-1..ER-10 enumerated (no-CLI, not-authenticated, non-zero exit, parse failure, channel drop, un-killable process, limit exceeded, missing agent, second Execute, daemon crash) — each with a distinct, legible presentation.

### 3.4 Non-functional highlights

- **Latency**: event → UI ≤ 500 ms; ≥50 events/s bursts without data loss (coalesce rendering, never data); feed virtualized for 30-min runs.
- **Security (headline)**: spawn RPC on a tokenless localhost daemon = **RCE-by-proxy risk** — run-start must be unforgeable by RPC alone (NFR-S1); argv-array spawn, zero shell interpolation (NFR-S2, testable with `"; rm -rf ~ #` as literal prompt); cwd = registered project path only; **permission mode of the spawned agent is an explicit product decision surfaced in the UI**, never a silent most-permissive default; Symbion's own diff-preview guarantee explicitly does NOT cover the AI's writes — say so in the consent copy.
- **Architecture**: only daemon spawns/holds child handles; core gains the pure event model + parser + roll-up reducer (the 130k invariant = unit-tested property: command total == Σ all attributed usage); realtime channel typed via `@symbion/rpc-types`; provider parsing behind an adapter (Codex later = new adapter, zero event-model change).
- **Acceptance criteria**: 12 ACs defined, incl. AC-RUN-2 (exact 100k/30k→130k/30k fixture test), AC-RUN-5 (F5 reattach), AC-RUN-6 (injection), AC-RUN-10 (consent unforgeable by raw RPC), AC-RUN-11 (core purity preserved).

## 4. Solution Options (ranked)

### Option 1 — RECOMMENDED: phased CLI spawn + pure core telemetry + SSE (overall L)

Daemon spawns `claude -p "/<command> <req>" --output-format stream-json --verbose` with `cwd = project.path`; line-buffers NDJSON.

| Layer | New code |
|---|---|
| `packages/core/src/run/` | `events.ts` (RunEvent union) · `parseStreamJson.ts` (pure, tolerant of unknown types) · `aggregate.ts` (pure reducer `fold(events)→RunState`, roll-up rule lives here; daemon AND web fold through the SAME reducer so numbers can't drift) |
| `apps/daemon/src/run/` | `runManager.ts` spawn/kill/track · jsonl append · **SSE broadcast** (`GET /run-events?runId=`) · preflight. SSE not WS: zero-dep daemon, data flow strictly daemon→web, `EventSource` auto-reconnects, same Origin/Host allowlist. Control stays on `POST /rpc` (`startRun`/`cancelRun`/`listRuns`/`getRunEvents{afterSeq}` for replay/reconnect). |
| `apps/web/src/lib/run/` + graph | `useRunStore` (zustand) EventSource→`core.aggregate` · `DependencyGraph.tsx` injects `{runStatus, ownTokens, totalTokens}` into node `data` · `RunDialog` (fork of `CopyRunCommandDialog`, Execute next to Copy) · `RunTimelinePanel` (virtualized) |

**Phases**: P1 (M) Execute + cancel + raw log tail + node glow (no token math — de-risks CLI behavior & SSE plumbing) → P2 (L) structured telemetry, roll-up, per-agent lighting, timeline (pin stream-json fixtures per CLI version) → P3 (M) history UI, restart recovery, redaction/rotation.

Put a `run/driver.ts` seam (mirror `llm/registry.ts`) so Option 2 stays a swap-in.

### Option 2 — Claude Agent SDK in the daemon (L, higher uncertainty)

Typed messages, `interrupt()`, permission hooks (`canUseTool` could intercept file writes — attractive vs the safety mandate). −Breaks daemon's zero-dependency posture; −auth model (subscription login vs API key) needs verification; core/web identical to Option 1 → revisit if raw parsing proves brittle in P2.

### Option 3 — Poll-only (M)

`getRunEvents{afterSeq}` polled ~1s. Chunky realtime; only as Option 1's built-in degraded fallback (nearly free since the method exists for replay).

### Graph library — KEEP React Flow

**User's premise incorrect: React Flow is MIT/free forever** (installed: `reactflow@^11.11.4`); only "React Flow Pro" (support subscription + pro examples) is paid — never required to use/ship/sell. Symbion just shipped interactive-graph on it (5 custom node/edge components); replacing = pure regression project. The run overlay is *easier* on React Flow than anywhere (props in the existing `data` bag). Alternatives all worse fits (rete/litegraph = canvas executors; cytoscape/sigma = network analysis; hand-rolled = XL for zero value). Optional separate chore: upgrade to `@xyflow/react` v12 (same team/license, v11 is maintenance-mode).

**Follow-up (2026-07-15)**: this question was independently re-researched under a DX/flexibility framing (not cost/license) in `docs/loops/graph-rendering-library-evaluation-STATE.md`, after the mission-mode run overlay above had shipped. That spike **reinforces this "keep React Flow" verdict** with new evidence (Cytoscape.js fails the E10 derive-don't-mirror architecture invariant outright; the mission-mode diff was read directly and confirms zero new React Flow API surface was touched) and escalates the `@xyflow/react` v12 upgrade from "optional" to "worth scheduling soon" given v11 is now >2 years stale on npm. See that STATE file for the full comparison.

## 5. Ideas & Open Questions

### Product framing: Author → Launch → Watch → **Learn**

The finished run as a persistent, replayable, comparable artifact that feeds back into authoring ("this agent burned 80% of the budget re-reading files → tighten its prompt") is the 10× multiplier — Symbion becomes a workflow *optimizer*. Signature identity to protect: **the graph the user authored IS the runtime dashboard**.

### Slicing

- **v1 "Launch + Watch"**: Execute from node → preflight → headless run → live glow + per-node token/cost tickers with roll-up → streaming event log → cancel → post-run summary (status, duration, per-node cost table, **files-changed via git before/after**, final assistant message) → persisted history + re-run. Events persisted from day one (enables replay later). Cost-in-dollars next to tokens everywhere ("142.3k tok · ~$0.61", estimates caveat).
- **v2 "Learn"**: timeline replay scrubber (re-light the graph from events.jsonl), run comparison (prove /analyze v0.3 is 40% cheaper than v0.2 — runs tagged with artifact version), budget caps (soft banner / hard abort), desktop notifications, STATE.md-aware semantic progress (uniquely Symbion; optional, convention-detected), cost estimates from history.
- **v3 "Orchestrate"**: pipeline chained runs (/analyze→/plan→/build with approval gates), pause/inject feedback, run queue/concurrency, more exec providers.
- **Out of all near versions**: Symbion editing files from run output, cloud run storage, running unregistered repos.

### Consolidated open questions (for /office-hours)

1. **Permission posture of the spawned agent** (THE taste call): CLI restricted default (may stall headless) vs per-project allowed-tools list vs skip-permissions (useful, dangerous). Never a silent permissive default.
2. **Consent UX**: per-run confirm dialog enough, or + per-project "enable execution" opt-in? (must be unforgeable by raw RPC — tokenless re-decision.)
3. **Surface**: mission-mode overlay on the existing graph (recommended — it's the feature's identity) vs separate Runs tab; where else does Execute live (list row ⋯ menu)? Copy-run stays as zero-trust fallback.
4. **Concurrency**: 1 run per project (recommended); parallel across projects OK?
5. **Draft/conflict command at Execute**: hard block vs warn-and-allow (runs the on-disk version).
6. **Dirty git tree**: block / warn-and-allow (recommended) / auto-checkpoint before run.
7. **Token headline formula**: input+output vs include cache read/write (cache dominates Claude Code usage and can make numbers look absurd — recommend fresh-tokens headline, cache detail on hover). Unattributable→command-bucket fallback acceptable?
8. **Ceilings**: default 30-min wall clock + token cap — values, per-project configurability.
9. **Retention**: keep last N runs (propose 50/project)? Payload truncation (secrets risk)?
10. **Post-run git-delta panel in v1?** (cheap, high trust — recommend yes.)
11. **Provider scope**: Claude Code CLI only for v1 (recommended), event model provider-agnostic.
12. **Agents not directly executable** (commands = only entry points) — confirm.
13. **Pipeline chaining v1?** (strong recommendation: single command first.)
14. **Execution target**: any registered project (target repos + Symbion itself for dogfooding)?

## 6. Scope (LOCKED — office-hours 2026-07-13)

### Decisions (answered by the user)

1. **Permission posture**: per-project run config in Symbion (permission mode + allowed-tools), **default `acceptEdits`** (agent writes files freely; unlisted shell commands still blocked). The run-confirm dialog states in plain language what the agent is allowed to do.
2. **v1 slice = "Launch + Watch" as proposed**: execute ONE published command, Claude Code CLI only, max 1 active run per project, node glow + token roll-up + event timeline + cancel + post-run summary (incl. git-diff files-changed) + persisted run history. Ships in 3 phases (P1 execute/cancel/log-tail → P2 telemetry/roll-up/timeline → P3 history UI/recovery).
3. **Surface**: mission-mode overlay on the EXISTING graph (non-participating nodes dim, running nodes glow + tickers, timeline panel slides in) + a persistent run bar when navigating away. No separate Runs screen in v1 (history opens read-only over the graph).
4. **Consent gate**: first run in a project → explicit acknowledgment ("I understand the agent may modify files in <path>"); every run → confirm dialog showing exact invocation + permissions + target repo. `startRun` requires a UI-issued nonce so a bare RPC call cannot start a run (tokenless decision formally amended for the run-RPC class).
5. **Preflight policy**: **draft → blocked** with a "Publish first" action (nothing on disk to run); **conflict → warn-and-allow** ("will run the on-disk version, which differs from what you see"); **dirty git tree → warn-and-allow** (rollback impossible, post-run diff noisy).
6. **Token badge formula**: **fresh tokens (new input + output, cache-read excluded) + cost in $** (cache priced correctly in the $ figure), e.g. "42.3k tok · ~$0.61". Full 4-way breakdown (input/output/cache-read/cache-write) on hover. The 130k roll-up rule applies over this same formula.

### Defaults adopted (revisit at /plan only if they break something)

- Retention: keep last **50 runs/project**, oldest pruned; manual delete deferred.
- Unattributable usage → command's own bucket + "unrecognized subagent" flag in the feed (never dropped).
- Agent nodes are NOT directly executable — commands are the only entry points.
- Execution target: any registered Symbion project (incl. Symbion's own repo for dogfooding); cwd = registered `project.path` only.
- Default ceilings ON: 30-min wall clock + token cap, per-project configurable.
- Realtime channel: **SSE** on the existing `node:http` server (no new deps); `getRunEvents{afterSeq}` doubles as reconnect-replay and polling fallback.
- Copy-run command stays untouched as the zero-trust fallback.

### Out of scope (v1)

Pipeline chaining, replay scrubber, budget-cap UI, pause/inject-feedback, desktop notifications, STATE.md-aware progress, >1 concurrent run per project, non-Claude exec providers, cloud/sharing anything, Symbion editing files based on run output, running unregistered repos.

### Data model changes

- **Canonical IR: none.**
- `packages/core`: new `run/` module — `RunEvent` discriminated union, `parseStreamJson`, `aggregate` (pure reducer, roll-up invariant unit-tested).
- `packages/rpc-types`: `startRun` / `cancelRun` / `listRuns` / `getRunEvents` + typed SSE event payloads.
- `.symbion/runs/<runId>/run.json` + `events.jsonl` (schemaVersion'd, gitignore-suggested).
- Project settings gain a `run` section (permission mode, allowed-tools, ceilings).

### Impact on existing features

- `DependencyGraph.tsx` node `data` bag: additive `{runStatus, ownTokens, totalTokens, costUsd}` fields — interactive-graph P1–P8 contracts unchanged outside an active run.
- `CopyRunCommandDialog` forked into `RunDialog` (Copy stays).
- Daemon `server.ts`: new SSE route under the same Origin/Host allowlist; supersedes symbion-STATE §8 assumption #7 ("no process spawn") — formally, not silently.
- **`/cso` is mandatory before build** (process spawn on localhost RPC).

### Acceptance criteria

The 12 ACs in §3.4 (AC-RUN-1…12) are the Checker contract, updated by the decisions above: AC-RUN-2 fixture asserts the fresh-token formula; AC-RUN-10 asserts the nonce gate; add **AC-RUN-13**: a draft command's Execute is blocked at preflight with a working "Publish first" path.

## 7. Recommended Next Step

**→ `/design`** (deliverable #2 the user asked for: UI prototype of the mission-control screen — glow states, token tickers, timeline panel, run bar, consent/confirm dialogs, post-run summary) → then **`/plan`** (architecture + test plan; resolve the verification debts below) → `/build` → `/review` → **`/cso` (mandatory)** → `/qa` → `/ship`.

Verification debts for /plan (web access was rate-limited mid-analyze): exact stream-json event schema + parent-tool-use-id field name for the locally installed CLI version; confirm custom slash commands from `.claude/commands/` execute in `-p` mode on that version; record one fixture transcript to pin the parser tests.

Verification debts for /plan (web access was rate-limited mid-analyze): exact stream-json event schema + `parent_tool_use_id` field name for the installed CLI version; whether custom slash commands from `.claude/commands/` run in `-p` mode on the installed version; Agent SDK auth model. Verify against the local `claude --version` with a recorded fixture run.

## 8. PLAN — Architecture, security & phasing (2026-07-14, architect)

> Implements §6 (Scope, LOCKED) + the canonical design doc (`graph-execution-realtime-design.md`, all taste questions resolved). Test plan is the separate artifact `docs/loops/graph-execution-realtime-testplan.md` (§8.10). Nothing below re-litigates a locked decision; deviations from the spec's *letter* are listed explicitly in §8.8 (Flaws found).

### 8.0 Verification results (ground truth — §7 debts resolved)

- **Installed CLI: 2.1.187** (`~/.nvm/versions/node/v25.8.2/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`, resolved via the `claude` PATH shim). Record `cliVersion` in every `run.json`.
- **`parent_tool_use_id` CONFIRMED** as a top-level field on `assistant` events (`null` = main agent). This is the attribution key for the 130k roll-up rule.
- **Real fixture recorded**: `docs/loops/graph-execution-realtime-fixture-simple.ndjson` (CLI 2.1.187, today). Event types observed: `system/init` (session_id, model, permissionMode, `slash_commands`, `claude_code_version`), **`rate_limit_event`** (an UNDOCUMENTED extra type — hard proof the parser must pass unknown types through without crashing), `assistant` (with `message.usage`: input/output/cache_creation/cache_read tokens; `message.id`; top-level `parent_tool_use_id`), `result` (subtype success, `total_cost_usd`, `duration_ms`, `num_turns`, aggregate `usage`, per-model `modelUsage`, `permission_denials`).
- **Permission mode strings in the binary**: `acceptEdits`, `bypassPermissions`, `dontAsk`, `delegate`, `plan` — design R7's three offered modes (`plan`/`acceptEdits`/`bypassPermissions`) all exist verbatim; UI copy stands.
- **Custom slash commands work in `-p` mode**: `system/init.slash_commands` lists the target repo's `.claude/commands/` entries when cwd = the repo.
- **NOT yet captured**: a fixture with a real Task-tool subagent dispatch (costs real tokens). Recording one is a named /build P2 task; parser tests pin to BOTH fixtures.
- The fixture also proves two aggregation facts the design must absorb: (a) `result.usage` covers the **main model only**, while `modelUsage`/`total_cost_usd` include hidden background models (haiku 505/11 appears in `modelUsage` but in NO assistant event); (b) `permission_denials` arrives on `result` — the feed can render denials.

### 8.1 Architecture — boundaries & file list

#### `packages/core/src/run/` (PURE — no Node imports; AC-RUN-11)

| File | Responsibility |
|---|---|
| `events.ts` | `RunEvent` discriminated union + `PersistedRunEvent = { seq: number; ts: number; ev: RunEvent }` (seq is daemon-assigned, monotonic from 1, the single ordering/dedup key everywhere). Union members: `init` (sessionId, model, permissionMode, cliVersion, slashCommands), `message` (messageId, parentToolUseId: string\|null, model, usage: FourWay, parts: ContentPart[] — text preview / tool_use `{toolUseId, tool, inputPreview, subagentType?}` / tool_result preview; all previews truncated), `result` (subtype, isError, totalCostUsd, durationMs, numTurns, usage, modelUsage, permissionDenials), `unknown` (type, rawTruncated), `parse-error` (rawTruncated). Also `FourWay = {input; output; cacheRead; cacheWrite}`. |
| `parseStreamJson.ts` | `parseLine(line: string): RunEvent` — NEVER throws: bad JSON → `parse-error`; unrecognized `type` → `unknown` with truncated raw retained; recognized types tolerate missing/extra fields (every field access defensive). Truncation caps are core constants: `PREVIEW_CAP = 2_000` chars per content-part preview, `RAW_CAP = 8_192` chars for retained raw. |
| `aggregate.ts` | `initRunState()`, `fold(state, PersistedRunEvent): RunState` — THE reducer both daemon and web run (locked invariant: numbers cannot drift). `RunState = { lastSeq; init?; actors: Map<actorKey, {usage: FourWay; messageIds: Set<string>}>; dispatches: Map<toolUseId, {subagentType?, atSeq}>; result?; parseErrors; unknownEvents }` with `actorKey = parentToolUseId ?? "main"`. **Dedup rule**: a `message` whose `messageId` was already counted for that actor adds 0 (stream-json can emit one `assistant` event per content block, all sharing one message id/usage — naive summing double-counts; see Flaw F5). **Roll-up derivation** `rollup(state, agentNamesInGraph): NodeRollups` — agent node = Σ usage of actorKeys whose dispatch resolves to that `subagentType`; command own = "main" bucket + every unresolved/unrecognized bucket (flagged `unrecognized`, never dropped); command total = own + Σ agents (the 100k+30k→130k/30k invariant, unit-tested as a property). Fold totals are order-independent because attribution keys off `parentToolUseId` alone; dispatch-name resolution happens at derive time, not fold time. **Fresh formula (locked §6.6)**: `fresh = input + output` (cacheRead/cacheWrite excluded from headlines, present in FourWay for the hover card). |
| `pricing.ts` | `MODEL_PRICING` (per-mtok rates for the model families the CLI reports) + `estimateCostUsd(usage, model)` — cache traffic priced in (locked). Live per-node `~$` is an ESTIMATE; at terminal, per-node costs are proportionally scaled so Σ == `result.totalCostUsd` (which alone knows about hidden background models). Unknown model → cost renders `—` (tokens still shown). |
| `derive.ts` | `timelineRows(events): TimelineRow[]` and `runSummary(state, meta, filesChanged): RunSummary` — pure projections matching the design-doc §4 contracts (`TimelineRow`/`RunSummary`/`RunView` shapes live here or in `events.ts`, re-exported through `@symbion/rpc-types`). |

#### `packages/rpc-types` (types only)

New methods added to `RpcMethod` (camelCase-verb convention matches `gitStatus`/`renderRunCommand`; §6's names kept): **`runPreflight`, `startRun`, `cancelRun`, `listRuns`, `getRunEvents`**. Plus: `ProjectRunConfig`, `RunInfo`/`RunListItem`, `PreflightCheck`/`RunPreflightResult`, `StartRunParams/Result`, `GetRunEventsParams/Result`, and the SSE wire types (`RunSseEventsFrame`, `RunSseStateFrame`). Per-project run config rides the EXISTING `updateSettings` RPC (no new mutation method) via a new optional field on core's `ProjectSettings`.

#### `apps/daemon/src/run/` (the ONLY place that spawns/holds child handles)

| File | Responsibility |
|---|---|
| `cliDriver.ts` | The provider seam (mirrors `llm/registry.ts` so Option 2 / Codex stay swap-ins): `resolveClaudeBin()` (`SYMBION_CLAUDE_BIN` env override — also how tests substitute the fake CLI — else `"claude"` from PATH); `buildArgv({commandName, requirement, model, permissionMode, allowedTools})` → `["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", mode, …model? ("--model", model), …allowedTools? ("--allowedTools", list)]` where `prompt = renderRunCommand({command, requirements})` (reuses core). Requirement is ONE argv element — never a shell string. `--allowedTools` exact flag syntax: verify against `claude --help` in /build P1 (low-risk; isolated to this one function). |
| `runManager.ts` | In-memory `Map<projectId, ActiveRun>` (1 active run per project — the locked concurrency rule IS this map). `start()`: `spawn(bin, argv, { cwd: projectPath, detached: true, stdio: ["ignore","pipe","pipe"], env: process.env })` — env passed through VERBATIM; Symbion never injects its own LLM keys (they live in `~/.config/symbion/providers.json`, read only by `llm/`, never exported). Line-buffers stdout (`lineBuffer.ts`), assigns seq, `parseLine` → append to `events.jsonl` + fold into the daemon-side `RunState` + hand to the SSE broadcaster. Keeps a 200-line full-fidelity raw ring buffer in memory (the `[≡ Raw]` tab; never fully persisted — persisted raw obeys `RAW_CAP`). Stderr → bounded tail buffer (last 20 lines, ER-3). Ceilings: wall-clock `setTimeout` + fresh-token check after every fold; breach → same kill path, `status:"timed-out"`, `stopReason:"wallClock"\|"tokenCap"`. `cancel()`: `process.kill(-pid, "SIGTERM")` → 5 s → `kill(-pid, "SIGKILL")` → verify via `kill(pid, 0)`; if still alive: run stays `cancelling` + ER-6 payload `{pid}` broadcast (never claim dead while alive). Exit handler writes terminal `run.json` (exitCode, endedAt, totals from the folded state, `filesChanged` via git before/after) and clears the map slot. |
| `runStore.ts` | `.symbion/runs/<runId>/` persistence: `run.json` atomic write (reuses `atomicWriteJson`), `events.jsonl` append (fd kept open per active run; fsync on terminal), `listRuns`, `readEvents(afterSeq, cap 500)`, `reconcile(projectRoot)` (any persisted run in `starting\|running\|cancelling` whose runId is NOT live in runManager → rewrite `failed` + `errorMessage:"daemon-restarted"`), `prune(projectRoot, keep=50)` (oldest by startedAt; deletes ONLY dirs directly under `.symbion/runs/` whose name matches the runId format; lstat-refuses symlinked dirs — same G-guard posture as `safeDeleteProjectStore`), and first-use creation of `.symbion/runs/.gitignore` containing `*` (self-ignoring dir — transcripts can hold secrets; Symbion owns `.symbion/`, so this is not a foreign-file write). All paths built via `resolveConfinedPath`. |
| `preflight.ts` | Runs checks in parallel: CLI presence+version (`execFile(bin, ["--version"], {timeout: 5000})` — argv array, precedent `git/status.ts`), auth (best-effort, see Flaw F3), artifact published/draft/conflict (draft → BLOCK + publish action, AC-RUN-13; conflict → WARN via publishedHashes-vs-disk diff of this artifact's rendered file), referenced agents published (`extractAgentMentions` → WARN, ER-8), git dirty (reuse `gitStatus` → WARN), active-run (BLOCK, ER-9). Returns checks + `invocationEcho` + `permissionSummary` (generated from `ProjectRunConfig` — the single verbatim-stable consent-copy source) + `needsFirstRunAck` + `lastRun` (from runStore) + **`consentNonce` iff no blocker**. |
| `nonces.ts` | In-memory (per-boot, never persisted): `mint({projectId, artifactId, configHash})` → 64-hex `crypto.randomBytes(32)`; entry `{…, expiresAt: now + 120 s}`; `consume(nonce, {projectId, artifactId, configHash})` — single-use (deleted on use), rejects mismatch/expiry. `configHash` = sha256 over `{permissionMode, allowedTools, ceilings}` so config changed between preflight and start invalidates the consent. |
| `sse.ts` | `GET /run-events?runId=<id>&afterSeq=<n>` on the EXISTING `node:http` server — routed BEFORE `serveStaticFile` (today every GET falls through to static serving). Same `isAllowedHost` Origin/Host gate as `/rpc`. Protocol: the server first backfills persisted events `> afterSeq` from `events.jsonl`, then attaches to the live broadcaster — ONE ordered channel, no client-side race (Flaw F2). Frames: `event: run` / `id: <lastSeqInBatch>` / `data: {"runId","events":[PersistedRunEvent…]}` batched at ≤4 flushes/s (250 ms buffer — coalesce TRANSPORT, never data); `event: state` on lifecycle transitions (`data: RunInfo`); `: hb` comment every 15 s. Honors `Last-Event-ID` (EventSource auto-reconnect) as the effective afterSeq. Terminal/unknown runId → backfill-then-close / 404. |

`rpc/handlers.ts` gains the 5 thin handlers; `server.ts` gains the one GET route. `git/status.ts` gains a read-only `gitNumstat(repoPath)` (`execFileSync("git", ["diff","--numstat"], …)`) for the summary's +/− counts (P2).

#### `apps/web/src/` (per design §4 — contracts already locked there, not re-derived)

- `components/run/`: `RunDialog.tsx` (+ internal `PreflightStrip`), `MissionStatusStrip.tsx`, `RunTimelinePanel.tsx` (hand-rolled fixed-row-height windowing — no new dependency, A8), `RunSummarySection.tsx`, `RunBar.tsx` (mounted in the app shell), `RunHistoryPopover.tsx`, `PastRunBanner.tsx`, `RunSettingsSection.tsx`, `RunCommandPalette.tsx` (minimal ⌘K — see Flaw F8), `TokenBreakdownCard.tsx`; plus `components/graph/NodeTokenBadge.tsx`.
- `lib/run/useRunStore.ts` (zustand, mirrors `useArtifactStore`): owns the `EventSource`; folds every received `PersistedRunEvent` through **the same `core.fold`** (the store NEVER does token math); seq-checked dedup (ignore `ev.seq <= lastSeq`); connection state (`live` → `reconnecting` → `polling` via `getRunEvents` every 1 s after >10 s); F5-reattach owner (on mount: `listRuns` → active found → attach); elapsed ticks client-side from `startedAt` (1 s interval — never derived from events).
- `DependencyGraph.tsx`: additive only — merges `useRunStore` selectors into the existing node/edge `data` memo (`runStatus`, `runParticipant`, `badge`, `runPulseKey`, `runFlow` per design §4's data-bag diff); suspends authoring handlers while `activeRun || historyRunId`; mounts strip + panel inside the existing 480 px container; toolbar gains 🕘. Interactive-graph P1–P8 contracts untouched outside a run.

### 8.2 Local-store schema (no SQL DB — files only)

**`.symbion/runs/<runId>/run.json`** (atomic temp→rename writes; `<runId>` = uuid, unguessable):

```jsonc
{
  "schemaVersion": 1,
  "runId": "uuid", "projectId": "…", "artifactId": "…", "commandName": "analyze",
  "requirement": "…(≤10k chars, as passed)…", "modelOverride": null,
  "argv": ["-p", "/analyze …", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits"],
  "bin": "claude", "cwd": "/abs/registered/project/path",
  "permissionMode": "acceptEdits", "allowedTools": [], "ceilings": { "wallClockMs": 1800000, "tokenCap": 200000 },
  "cliVersion": "2.1.187",             // from `claude --version` at preflight; init event cross-checks
  "sessionId": "…",                     // from system/init once seen
  "startedAt": "ISO", "endedAt": null,
  "status": "running",                  // starting|running|cancelling|completed|failed|cancelled|timed-out
  "exitCode": null, "stopReason": null, // "wallClock"|"tokenCap"|null
  "errorMessage": null,                 // e.g. "daemon-restarted"
  "gitBefore": { "isRepo": true, "clean": false, "changedFiles": ["…"] },
  "filesChanged": null,                 // terminal: [{path,status,plus,minus,preDirty}] or "unavailable"
  "lastSeq": 0,
  "totals": null                        // terminal: frozen {perNode rollup, fresh, costUsd} snapshot for cheap history rows
}
```

**`events.jsonl`**: one `PersistedRunEvent` per line — `{"seq":1,"ts":1784…,"ev":{…RunEvent}}`. Append-only; schemaVersion'd via `run.json` (events are interpreted under the run's schemaVersion). Tool payloads truncated at `PREVIEW_CAP`; unknown/parse-error lines retain raw at `RAW_CAP`. CLI version + raw retention = schema-drift containment: a future CLI change degrades to `unknown` events + retained raw, never a crash, and the recorded version tells us which parser vintage to fix.

**`ProjectRunConfig`** — new OPTIONAL field `run` on core `ProjectSettings` (additive; absent → `DEFAULT_RUN_CONFIG`; store `schemaVersion` stays 1, no migration):

```ts
interface ProjectRunConfig {
  permissionMode: "plan" | "acceptEdits" | "bypassPermissions";  // default "acceptEdits" (locked §6.1)
  allowedTools: string[];                                        // default []
  ceilings: { wallClockMs: number; tokenCap: number };           // default 30 min / 200k fresh
  firstRunAck?: { settingsHash: string; ackedAt: string };       // sha256({permissionMode, allowedTools}) —
}                                                                // mode/tools change ⇒ hash mismatch ⇒ re-ask (design §0)
```

Written through the existing `updateSettings` RPC; `firstRunAck` is persisted by `startRun` itself when the client passes `ackFirstRun: true` (the daemon computes the hash — it never trusts a client hash). Retention: last 50 runs/project, pruned at terminal + at reconcile.

### 8.3 RPC + SSE surface

| Method | Params → Result | Touches disk? |
|---|---|---|
| `runPreflight` | `{projectId, artifactId}` → `{checks, blocked, needsFirstRunAck, invocationEcho, permissionSummary, lastRun?, consentNonce?}` | reads store/git/CLI; writes NOTHING (nonce is memory-only) |
| `startRun` | `{projectId, artifactId, requirement, model?, nonce, ackFirstRun?}` → `{runId, run: RunInfo}` | **writes** `.symbion/runs/<id>/` (+ `runs/.gitignore` on first use, + `firstRunAck` into store.json); **spawns** |
| `cancelRun` | `{projectId, runId}` → `{status, pid?}` (pid iff not-confirmed-dead, ER-6) | updates `run.json`; kills the process group |
| `listRuns` | `{projectId}` → `{runs: RunListItem[], activeRunId?}` | reads; may write (lazy reconcile + prune) |
| `getRunEvents` | `{projectId, runId, afterSeq}` → `{events, run, done}` (batch ≤500) | reads (polling fallback + history replay) |
| `GET /run-events?runId&afterSeq` | SSE — backfill-then-live, seq-ordered, `Last-Event-ID` honored | reads events.jsonl; same Origin/Host allowlist |

`startRun` re-validates EVERYTHING server-side (published, not blocking-conflict, no active run, requirement ≤10k chars, model matches `[A-Za-z0-9._-]{1,100}`) — the dialog's preflight rendering is UX, not the security boundary.

### 8.4 Data flow

**Execute (happy path)**: node ⋯ → `RunDialog` → `runPreflight` RPC (parallel checks render as they resolve) → returns `consentNonce` → user ticks ack (first run) → Execute → `startRun{…, nonce}` → daemon: consume nonce → re-validate → create run dir + `run.json(status:"starting")` → `spawn(claude, argv, {cwd: registeredPath, detached: true})` → status `running` → stdout chunks → lineBuffer → `core.parseLine` → seq-stamp → append `events.jsonl` + daemon-side `core.fold` (ceilings check) + SSE broadcast (≤4 flush/s) → web `useRunStore` folds the SAME events via the SAME reducer → `DependencyGraph` data-bag overlay (glow/badges/edge flow) + `RunTimelinePanel` rows. CLI exits → terminal `run.json` (exitCode, totals, `gitStatus`+`gitNumstat` delta vs `gitBefore`) → `event: state` → panel morphs to Summary. There is deliberately no render→diff→write pipeline here — the spawn-analog is **preflight-echo → consent(nonce) → spawn**, the ONLY Symbion-written files are under `.symbion/runs/` (+ `firstRunAck` in store.json), and the AI's own writes are explicitly outside Symbion's diff-preview guarantee (the consent copy says so verbatim).

**Cancel**: `[■ Cancel]` → inline two-step confirm (5 s auto-revert) → `cancelRun` → SIGTERM(−pgid) → ≤5 s → SIGKILL(−pgid) → liveness check → `cancelled` (or stuck `cancelling` + ER-6 pid surfaced).

**F5 mid-run**: page load → `useRunStore` mount → `listRuns` → `activeRunId` found → run bar `⟳ RECONNECTING…` → `EventSource(/run-events?runId&afterSeq=0)` → server backfills all persisted events then streams live on the same channel → store fast-forwards through `core.fold` → mission mode restores (design R8, ≤1 s). The nonce plays NO role here — attach and cancel are not consent-gated (read-only / fail-safe direction); only SPAWN is. A nonce orphaned by F5 between preflight and Execute simply expires (TTL 120 s); reopening the dialog mints a fresh one.

**Daemon restart mid-run**: the child normally dies with the daemon (its process group is killed on daemon shutdown; if it survives as an orphan we still never claim completion). Next daemon boot: the first `listRuns`/`runPreflight`/`getRunEvents` touching the project runs `reconcile()` → persisted `running` → `failed(daemon-restarted)` (ER-10) → UI shows the danger toast + a partial summary from persisted events.

**Publish-first path (AC-RUN-13)**: draft command → preflight `✗ DRAFT` block row → `[Publish first →]` opens the existing publish flow → on success the dialog re-runs preflight.

### 8.5 Security (automatic /cso trigger — process spawn on a tokenless localhost daemon)

1. **Injection (AC-RUN-6)**: `spawn` with an argv ARRAY, `shell: false` (default) — never a shell string; the requirement is one argv element. Tests literally pass `"; rm -rf ~ #` and `$(touch pwned)` as the requirement. Precedent: `git/status.ts` execFileSync.
2. **cwd confinement**: `startRun` takes `projectId` only — the daemon resolves cwd from the registered project path (`findProjectPath`); a client can NEVER supply a path. Run-dir writes go through `resolveConfinedPath`.
3. **Nonce gate (AC-RUN-10, tokenless amendment §6.4)**: **daemon-minted** at `runPreflight` (crypto-random 32 bytes), single-use, 120 s TTL, bound to `{projectId, artifactId, configHash}`, consumed by `startRun`. What it buys: (a) spawning requires a two-phase **read-the-response** protocol — a blind one-shot forged POST (the classic residual localhost-CSRF vector) cannot start a run; (b) server-enforced preflight-before-spawn ordering; (c) consent is cryptographically tied to the exact config the user saw (config change ⇒ hash mismatch ⇒ re-consent). Honest limit for /cso: it does NOT stop a local process that can read HTTP responses — within the tokenless model nothing can; that residual risk is what §6.4 formally accepted, now confined to a two-round-trip, Origin/Host-gated, loopback-only protocol.
4. **SSE under the same allowlist**: `/run-events` applies the identical `isAllowedHost` Origin/Host checks as `/rpc`; loopback bind unchanged; runIds are unguessable uuids (defense-in-depth, not the boundary).
5. **No secret injection**: child env = `process.env` verbatim; Symbion's provider API keys live in `~/.config/symbion/providers.json` (0600) and are never exported to the child.
6. **Secrets-in-logs stance**: persisted tool payloads truncated (`PREVIEW_CAP`/`RAW_CAP`); `.symbion/runs/.gitignore` (`*`) written on first use so `git add .` can never commit transcripts; history popover copy says "gitignored".
7. **Permission posture surfaced, never silent**: consent line generated from `ProjectRunConfig` (verbatim-stable, single source); `bypassPermissions` requires an extra confirm at save + re-triggers first-run ack; consent copy states Symbion's diff-preview does NOT cover the agent's writes.
8. **Kill is fail-safe**: SIGTERM→SIGKILL on the process GROUP, liveness-verified; ER-6 never claims dead-while-alive.

### 8.6 Edge cases (ER-1..ER-10 → concrete mechanisms)

| ER | Mechanism |
|---|---|
| 1 CLI missing | preflight `execFile --version` ENOENT → BLOCK row + install instructions (reuses the `llm/installInstructions` pattern) + `[Re-check]`; never a raw ENOENT |
| 2 not authenticated | best-effort preflight check (Flaw F3); guaranteed backstop: spawn-time detection — early error `result` / nonzero exit + stderr tail → fast fail with `claude login` hint |
| 3 non-zero exit | exit handler → `failed`, exitCode + stderr tail (last 20 lines, bounded) persisted; partial telemetry retained; summary leads with stderr |
| 4 parse failure | `parse-error` events (raw retained, run continues); `state.parseErrors > 0` → amber "telemetry degraded" chip + `≥`-prefixed frozen badges + Raw tab; a parse failure NEVER kills a healthy run |
| 5 SSE drop | EventSource auto-reconnect with `Last-Event-ID`; store shows `reconnecting`, numbers dim-frozen; >10 s → `getRunEvents` polling at 1 s (Option 3 built in); seq dedup guarantees no loss/dup |
| 6 un-killable | liveness check after SIGKILL; stuck `cancelling` + `{pid}` + copyable `kill -9` (sticky, danger) |
| 7 ceiling | daemon-side wall-clock timer + per-fold fresh-token check → same kill path → `timed-out` + `stopReason` → amber summary + `[Adjust ceilings]` |
| 8 missing agent | preflight WARN; mid-run: dispatch with unknown `subagent_type` / failed Task → usage stays in the unrecognized bucket → command total (flagged, never dropped) |
| 9 second Execute | UI affordances disabled (one rule everywhere); raced RPC → `RpcError("run-active")` → toast; the in-memory map IS the lock (single-process daemon, no TOCTOU) |
| 10 daemon crash | lazy `reconcile()` on next project touch → `failed(daemon-restarted)`; a zombie "running" never renders |

**Schema drift**: unknown types pass through + raw retained + `cliVersion` recorded (the fixture already proves `rate_limit_event` exists undocumented). **Parallel subagents**: totals are order-independent per `parentToolUseId` (property-tested with shuffled event orders); interleaved timeline rows are actor-suffixed, hierarchy via dispatch cards. **Huge outputs**: payload truncation at parse time, SSE ≤4 flushes/s, timeline windowed, raw ring capped at 200 lines. **Elapsed time**: client ticks from `startedAt` (same machine — no skew concern), never derived from event timestamps.

### 8.7 Phasing (what /build slices)

- **P1 — execute/cancel/log-tail/glow (M)**: core `events.ts` + `parseStreamJson.ts` COMPLETE (the parser is cheap, and shipping it in P1 avoids lossy P1 persistence — everything is recorded structurally from day one); `aggregate` NOT wired to any UI; rpc-types; daemon `run/` complete except `gitNumstat` + token-cap (wall-clock ceiling only in P1 — the token cap needs `aggregate`, so it lands in P2); nonce + preflight + reconcile-core (deliberate pull-forward from P3: ~20 lines that prevent zombie "running" rows during P1 QA; the full ER-10 UX stays P3) + `runs/.gitignore`; web: RunDialog (all R2/R2a/R2b variants), node glow + participant dim, raw log-tail panel (this IS the P1 panel per design), RunBar, two-step cancel, basic F5 attach (bar + tail resume — nearly free once SSE backfill exists). **No token math anywhere in P1.**
- **P2 — structured telemetry (L)**: `aggregate`/`pricing`/`derive` + roll-up invariant tests; **record the real Task-subagent fixture** (named task; pin parser tests to both fixtures); token badges + breakdown card + per-agent lighting + edge flow + live ×N counters; timeline panel (rows, filters, row expand, follow/pause) with Raw demoted to a tab; summary (cost-by-node, files-changed via `gitNumstat`, final message, stderr tail); token-cap ceiling; degraded-telemetry chip.
- **P3 — history/reattach/settings (M)**: 🕘 history popover + read-only past-run overlay + PastRunBanner; full R8 reattach choreography + ER-10 toast/partial summary; retention pruning; R7 Settings→Execution UI (until then the consent line renders defaults; `[change]`/`[Adjust ceilings]` links land with R7 — delta noted in F7); minimal ⌘K palette (F8); prefers-reduced-motion audit of all new animations.

### 8.8 Flaws found (spec/design critique — not silently patched)

- **F1 — "UI-issued nonce" (§6.4) is unimplementable as written.** A nonce minted BY the UI has no verification anchor — the daemon cannot distinguish it from an attacker-minted string, and a bare RPC caller is UI-equivalent. **Resolution**: daemon-minted at `runPreflight`, UI-relayed to `startRun` (§8.5.3). Preserves the decision's intent (spawn unforgeable by a single raw RPC call) with an honest, /cso-auditable limit statement.
- **F2 — replay + live SSE as two channels can race/duplicate.** §6's "`getRunEvents` doubles as reconnect-replay" run in PARALLEL with live SSE would duplicate or drop boundary events. **Resolution**: the SSE endpoint itself does backfill-then-live on one ordered channel (afterSeq/`Last-Event-ID`); every event carries a daemon-assigned `seq`; the client dedups `seq <= lastSeq` as belt-and-braces. `getRunEvents` remains for polling fallback + history only.
- **F3 — no verified zero-cost auth check exists for preflight.** Design R2 promises `✓ … authenticated`, but the only confirmed auth signal (`apiKeySource` in `system/init`) arrives AFTER spawn, and probing with a real `-p` call costs tokens. **Resolution**: /build P1 investigates a cheap check (credentials-file presence / an auth-status subcommand); if none is reliable, the row renders `✓ claude CLI 2.1.187 · auth verified at start` and ER-2 is caught at spawn (fail fast, friendly hint). Flagged so nobody "implements" a fake check.
- **F4 — per-node live `$` requires estimation, and Σ(per-node) ≠ `total_cost_usd`.** The CLI prices only the FINAL `result` (`total_cost_usd`, incl. hidden background models — the fixture's haiku entry appears in `modelUsage` but in no assistant event). FR-3's "never estimated" holds for TOKENS; `$` was always `~`-estimated (design). **Resolution**: core pricing table for live `~$`; at terminal, per-node `$` proportionally reconciled to `total_cost_usd`; unknown model → `$ —`. AC-RUN-2's fixture asserts tokens exactly, cost approximately.
- **F5 — per-content-block usage double-counting.** stream-json can emit multiple `assistant` events sharing one `message.id` + identical usage (one per content block). Naive summing inflates counts. **Resolution**: fold dedups by `(actorKey, messageId)`; pinned by a unit test. The simple fixture has one message; the P2 subagent fixture must confirm the multi-block shape.
- **F6 — `result.usage` is main-model-only** (fixture: haiku 505/11 in `modelUsage` only). The summary's "total == Σ rows" invariant therefore uses the FOLD's totals (same reducer everywhere); the `result` event is a cross-check — a mismatch beyond background-model deltas sets the degraded flag rather than silently re-basing numbers.
- **F7 — design phase-tags R7 as P1(mode)/P2(ceilings); this plan ships the R7 UI in P3.** The consent line + defaults work without the settings editor from P1 (config read from `ProjectSettings.run` with defaults); only the EDITOR is deferred. Accepted trade: `[change]`/`[Adjust ceilings]` links appear in P3. If /qa finds P1 hollow without it, promoting `RunSettingsSection` is a small isolated pull-forward.
- **F8 — the ⌘K entry point assumes a command palette that does not exist** anywhere in the codebase. **Resolution**: minimal `RunCommandPalette` (Execute /<name>… + Run history only) in P3; the node-⋯-menu is the sole P1 entry. Design's "entry points v1 = ⋯ + ⌘K" is honored by end of v1, not P1.
- **F9 — WSL + `claude.exe` kill semantics.** The installed binary is a Windows .exe behind an nvm shim; `detached` + `kill(-pid)` process-group semantics for Win32-interop processes under WSL are NOT guaranteed to reach grandchildren. **Resolution**: the liveness-verify step (ER-6) already refuses to lie; /qa includes a real-machine cancel test; if group-kill proves unreliable here, `cliDriver` grows a per-platform kill strategy (assumption A5).
- **F10 — dev-mode Origin mismatch pre-exists**: `isAllowedHost` only allowlists the daemon's own port, so a `next dev`-served page (port 3000) is rejected today. SSE inherits this unchanged; the plan does NOT widen the allowlist (production serving is daemon-origin; widening would weaken the boundary).

### 8.9 Trade-offs & assumptions (for dev/Checker tracking)

| # | Decision / assumption | Why / risk |
|---|---|---|
| A1 | SSE + seq-numbered jsonl over WS | zero-dep daemon; data flow is strictly daemon→web; EventSource reconnect is free; control stays on POST /rpc |
| A2 | Daemon and web BOTH fold via `core.fold`; the daemon's fold also drives ceilings | locked invariant — one reducer, numbers can't drift; ceilings need daemon-side numbers anyway |
| A3 | `SYMBION_CLAUDE_BIN` env override for the CLI binary | hermetic tests (fake CLI) + escape hatch for odd installs; documented, not UI-exposed |
| A4 | `--allowedTools` flag syntax verified at /build P1 via `claude --help` | isolated to `buildArgv`; a wrong guess is a 1-line fix |
| A5 | Process-group kill works for the WSL/.exe combo | see F9; ER-6 is the honest fallback either way |
| A6 | Pricing table maintenance burden accepted (core constant) | terminal reconciliation to `total_cost_usd` bounds the error to the live view only |
| A7 | `updateSettings` reused for run config (no new mutation RPC) | smallest surface; `firstRunAck` written only by `startRun` server-side |
| A8 | Timeline windowing hand-rolled (fixed row height) | avoids a new web dependency for ~1k-row lists |
| A9 | History replay uses `getRunEvents` batches (not SSE) | history is finite + read-only; keeps the SSE path single-purpose |
| A10 | Requirement cap 10k chars; model param shape-validated | bounded argv/prompt; mirrors generateBody's MAX_FIELD_LEN posture |

This section formally supersedes `symbion-STATE.md` §0 "Run engine: DEFER to v2" and §8 assumption #7 ("no process spawn anywhere in v1") **for the daemon's `run/` module only** — every other RPC remains spawn-free.

### 8.10 Test plan

→ `docs/loops/graph-execution-realtime-testplan.md` — the artifact /qa executes: core unit tests (both fixtures, unknown-event tolerance, the AC-RUN-2 roll-up property, order-independence), daemon integration tests against a hermetic fake-CLI script (injection, nonce, cancel/kill-tree, ceilings, reconciliation, retention, SSE allowlist), and the manual web journey checklist mapped to AC-RUN-1..13.

## 9. BUILD — P1 implementation notes (2026-07-15, feature-builder)

Implements STATE §8.7's P1 slice in full: core event model + parser, rpc-types surface, daemon `run/` module (spawn/cancel/persist/preflight/nonce/SSE), and the P1 web UI (RunDialog, MissionStatusStrip, RunBar, raw log-tail panel, node glow, two-step cancel, F5 attach). **Not self-reviewed** — this section is written for the Checker.

### Files changed

**packages/core** (pure):
- `src/run/events.ts` — `RunEvent` union, `PersistedRunEvent`, `FourWay`, `RunInfo`/`RunListItem`/`RunStatus`/`StopReason`/`FileChange`/`RunTotals`/`TimelineRow`/`RunView`, `PREVIEW_CAP=2000`/`RAW_CAP=8192`.
- `src/run/parseStreamJson.ts` — `parseLine()`, never throws; tolerant of missing/extra fields; re-exports the caps.
- `src/ir/types.ts` — added `ProjectRunConfig`, `DEFAULT_RUN_CONFIG`, and the optional `run?` field on `ProjectSettings` (additive, no schema bump).
- `src/index.ts` — barrel exports for `run/events.js` + `run/parseStreamJson.js`.
- `test/run/parseStreamJson.test.ts`, `test/run/parseStreamJson.truncation.test.ts`, `test/run/purity.test.ts`.
- `test/fixtures/run/fixture-simple.ndjson` (copy of the real recorded transcript), `test/fixtures/run/fixture-garbage.ndjson` (generated: non-JSON line + invented type + a >8KB line, spliced around the real fixture's lines).

**packages/rpc-types**:
- `src/index.ts` — added `runPreflight`/`startRun`/`cancelRun`/`listRuns`/`getRunEvents` to `RpcMethod`, their param/result types, `PreflightCheck`, `RunSseEventsFrame`/`RunSseStateFrame`, and re-exports of core's `ProjectRunConfig`/`RunInfo`/`RunListItem`/`RunStatus`/`PersistedRunEvent`.

**apps/daemon**:
- `src/run/cliDriver.ts` — `resolveClaudeBin()` (honors `SYMBION_CLAUDE_BIN`), `buildArgv()` (argv array, ONE element for the prompt).
- `src/run/cliVersion.ts` — cheap `claude --version` probe for `run.json.cliVersion`.
- `src/run/nonces.ts` — `NonceStore` (daemon-minted, single-use, TTL + now() injectable for tests), module singleton `nonceStore`.
- `src/run/runConfig.ts` — `resolveRunConfig`, `configHash` (nonce binding), `ackSettingsHash` (first-run-ack keying, mode/tools only — ceilings excluded), `buildConsentSentence` (single verbatim-stable disclosure source).
- `src/run/lineBuffer.ts` — `LineBuffer` (NDJSON line splitter across stdout chunks).
- `src/run/sse.ts` — `RunBroadcaster` (per-run, batched ≤4 flush/s, `:hb` every 15s), `writeSseHead`/`writeBackfillFrame`/`writeStateFrame`.
- `src/run/sseRoute.ts` — `handleRunEventsSse()`: backfill-then-live on one channel (Flaw F2), honors `Last-Event-ID`.
- `src/run/runStore.ts` — `.symbion/runs/<runId>/{run.json,events.jsonl}` persistence, `listRuns`/`readEvents`/`reconcile`/`prune`, `runs/.gitignore` (`*`) on first use. All paths via `resolveConfinedPath`; runId dirs matched against a strict uuid-v4 regex (foreign files/dirs under `.symbion/runs/` are never touched by prune/listRuns).
- `src/run/runManager.ts` — `RunManager`: `Map<projectId, ActiveRun>` (the concurrency lock), `spawn()` with `detached:true`/`stdio:["ignore","pipe","pipe"]`/`env: process.env` verbatim, line-buffer→parseLine→seq-stamp→append+broadcast, stderr tail (20 lines), wall-clock ceiling, two-phase `cancel()` (SIGTERM→5s→SIGKILL→liveness-verify on the process GROUP via `kill(-pid, …)` with a same-pid fallback), exit handler writes the terminal `run.json`.
- `src/run/preflight.ts` — parallel checks (CLI presence+version, active-run BLOCK, draft BLOCK/conflict WARN, referenced-agents WARN, git-dirty WARN); mints the consent nonce iff no blocker.
- `src/rpc/handlers.ts` — 5 new handlers (`runPreflight`/`startRun`/`cancelRun`/`listRuns`/`getRunEvents`); `startRun` re-validates everything server-side (published/draft/active-run/requirement≤10k/model shape) and never trusts the dialog's preflight rendering.
- `src/rpc/contract.ts` — re-exports the new rpc-types.
- `src/server.ts` — `GET /run-events` routed before `serveStaticFile`, same `isAllowedHost` Origin/Host gate as `/rpc`.
- `test/runHelpers.ts` — `setupRunEnv`/`startTestRun`/`awaitTerminal`/`useFakeCli` shared harness.
- `test/fixtures/fake-claude.mjs` — hermetic fake CLI (default/--version/ARGV_OUT/exit1/hang/ignore-sigterm/spawn-child/huge modes).
- `test/fixtures/fixture-simple.ndjson` — copy of the real recorded transcript.
- `test/run-happyPath.test.ts`, `run-injection.test.ts`, `run-nonce.test.ts`, `run-cancel.test.ts`, `run-concurrency.test.ts`, `run-sse.test.ts`, `run-getRunEvents.test.ts`, `run-lifecycle.test.ts`, `run-ceilings.test.ts` — testplan §3.1–3.9 (wall-clock only; token-cap is P2).

**apps/web**:
- `src/lib/run/useRunStore.ts` — zustand store: owns the `EventSource`, seq-dedup (`ev.seq <= lastSeq` ignored), connection state (`idle|live|reconnecting|polling`), F5 attach-on-mount (`attachIfActive` → `listRuns` → auto-`attach`), client-side elapsed ticks (1s interval from `run.startedAt`, never from event timestamps). `preflight`/`startRun`/`cancelRun`/`attach`/`attachIfActive`/`detach` actions. P1 raw tail only (`rawTail: RawTailLine[]`, capped 200) — no token aggregation (P2's `core.fold` is not wired to any UI yet, per §8.7).
- `src/components/run/RunDialog.tsx` (+ `PreflightStrip.tsx`) — all R2/R2a/R2b variants (happy/first-run-ack/draft-blocked/warn-and-allow); calls `runPreflight` then `startRun` with the daemon-minted nonce; ⌘↵ to execute, dialog stays open with an inline error on reject (never toast-only).
- `src/components/run/MissionStatusStrip.tsx`, `src/components/run/RunBar.tsx`, `src/components/run/CancelControl.tsx` (shared inline two-step cancel, 5s auto-revert, Esc never cancels).
- `src/components/run/RunLogTail.tsx` — the P1 timeline panel (raw NDJSON-derived tail, auto-follow).
- `src/components/DependencyGraph.tsx` — additive data-bag wiring: `runStatus`/`runParticipant`/`onExecute`/`executeDisabledReason` on command nodes, `runParticipant`→`dimmed` on agent nodes (reuses the existing `dimmed` field — no new visual path needed), `useRunStore` mounted for F5 reattach on every graph mount, `MissionStatusStrip` + `RunLogTail` panel mounted inside the existing 480px container (split into a flex row: graph + 320px timeline panel), authoring handlers (`onConnect`/hover/edge-click/context-menu/pending-ghost-edge) suspended while `missionActive`, edges lose their +/× interactivity and adopt the same dim treatment during a run (dash-flow animation is explicitly P2 per design §3.5 — this ships `runFlow: "flowing"|"off"` in the edge data bag for a P2 `AnimatedEdge` consumer, but `AnimatedEdge` itself is untouched in P1).
- `src/components/graph/CommandNode.tsx` — glow ring (cyan `#22d3ee`, `animate-glowPulse`) while `runStatus==="active"|"starting"`; done/error/cancelled static rings; participant dim.
- `src/components/graph/AgentNode.tsx` — doc-only change (clarifies `dimmed` is reused for the run-participant dim; no new prop needed).
- `src/components/graph/NodeMenu.tsx` — `▶ Execute…` as the TOP item (design §3.1 R1) for command nodes only; the SOLE P1 entry point (no list-row item, no ⌘K — Flaw F8). Disabled + reason appended to the label when `onExecute` is absent (RowMenu has no per-item tooltip slot).
- `src/components/ProjectView.tsx` — passes `projectId`/`projectName`/`onPublish` (opens the existing `PublishDialog`) into `DependencyGraph`.
- `src/components/AppShell.tsx` — mounts `RunBar` as a bottom dock, app-wide (shell restructured to a column layout: rail+main row, then the bar).
- `apps/web/tailwind.config.ts` — added the `run-active`/`run-active-soft` color tokens (design §7, resolved Q1: same hex as `skill`, distinct semantic name), `glow-run` boxShadow, `glowPulse` keyframe/animation (covered by the existing global `prefers-reduced-motion` block — no extra opt-out needed).
- `src/lib/rpc/types.ts` — re-exports the 5 new rpc-types.

### Assumptions (for the Checker to verify)

1. **`--allowedTools` / `--permission-mode` flag spelling** — VERIFIED directly against the installed CLI (`claude --help`, version confirmed via `claude --version` → `2.1.187 (Claude Code)`): `--allowedTools, --allowed-tools <tools...>` (comma/space-separated — `buildArgv` joins with `,`), `--permission-mode <mode>` with choices `acceptEdits|auto|bypassPermissions|default|dontAsk|plan` (all 3 of design R7's offered modes exist verbatim), `--output-format`, `--verbose`, `--model <model>`, `-p/--print`. No guess was needed — A4 in STATE §8.9 is resolved, not deferred.
2. **WSL/.exe process-group kill (Flaw F9/A5)** — NOT directly observed against the real `claude.exe`/nvm-shim binary in this build session (no live spawn of the real CLI was performed — all daemon tests run hermetically against `fake-claude.mjs`, which is a plain Node ESM script, not a Windows .exe behind a shim). What WAS observed and is a genuine finding: **an unresolved `new Promise(() => {})` does NOT keep the Node event loop alive** — the fake CLI's original `hang`/`ignore-sigterm` mode implementations exited immediately (`close, code 0`) because nothing pinned the event loop, which looked identical to a real "hang mode isn't hanging" bug during test-writing. Fixed by adding a `setInterval` keep-alive (`hangForever()`). This is unrelated to F9 itself but is exactly the kind of trap a real hang-simulation harness can fall into — flagging so nobody "fixes" a future flaky hang test by guessing the wrong root cause. The actual WSL/.exe process-GROUP-kill caveat (whether `kill(-pid)` reaches grandchildren of a Win32-interop process under WSL) remains UNVERIFIED and is explicitly called out in STATE §8.8 F9 as a manual /qa step (testplan J10) — `cancel()`'s liveness-verify (never claims dead while alive, surfaces `{pid}` in `CancelRunResult`) is the honest fallback either way, unchanged from the plan.
3. **`RunBar` visibility vs. design's "hides when the run's own graph is on screen"** — NOT implemented in P1. The bar is always visible app-wide whenever a run/terminal-run exists in the store (simpler; `AppShell` has no notion of "is project X's graph tab currently on screen"). This means a user on the Graph tab of the SAME project sees both `MissionStatusStrip` (in-graph) and `RunBar` (bottom dock) simultaneously — redundant but not incorrect information. Flagging as a deliberate P1 simplification, cheap to tighten later (would need a small "which project+tab is visible" signal threaded from `ProjectView`/`DependencyGraph` down to `AppShell`).
4. **Draft-vs-published conflict detection (`preflight.ts`'s `detectConflict`)** — reuses `renderArtifacts` + `computeDiff` against `store.settings.defaultTargets`; best-effort (any render/read error silently resolves to "no conflict" rather than surfacing a false warning). Not unit-tested directly in P1 (no daemon test exercises the WARN-conflict preflight row) — the nonce test (`run-nonce.test.ts` #7) covers the DRAFT-block path, not the conflict-WARN path. Flagging as a coverage gap for the Checker; testplan §3.3 doesn't explicitly require a conflict-row test either (only draft-block #7), so this may be acceptable as-is but should be double-checked against AC-RUN-13's letter.
5. **Auth-check (Flaw F3)** — implemented exactly as specced: `✓ claude CLI <ver> · auth verified at start`, no real auth probe. ER-2 (not authenticated) is caught at spawn time only, not in preflight. Not separately unit-tested (would require a real unauthenticated CLI or a fake-CLI mode simulating an auth failure — neither exists yet; `MODE=exit1` is the closest analog and IS tested).
6. **`RunBroadcaster` per-run instance, not a global singleton** — refactored from an early draft (module-level `currentRunId` global) to a per-run instance keyed by `runId` in its constructor, specifically to be safe under §3.5 #2's "two different projects run simultaneously" scenario. Confirmed correct by that passing test.
7. **`getRunCliVersion`/preflight's `checkCli`** — two separate small `execFile(bin, ["--version"])` probes (one in `preflight.ts`, one in `cliVersion.ts` for `startRun`) rather than a single shared cached probe. Deliberate: preflight and startRun can race with a CLI upgrade/downgrade between the two calls in theory (extremely unlikely in practice); re-probing both times is the more honest behavior. Minor duplication, flagged rather than silently justified.
8. **Token cap ceiling, `aggregate.ts`/`pricing.ts`/`derive.ts`** — NOT built in P1 per STATE §8.7's explicit instruction ("Do NOT build aggregate.ts/pricing.ts/derive.ts in P1 — those are P2"). `runManager.ts`'s wall-clock ceiling is the only ceiling enforced; the `tokenCap` field is threaded through `ProjectRunConfig`/`RunInfo.ceilings` end-to-end (persisted, surfaced in the consent sentence) but never checked against live usage.
9. **`fixture-subagent.ndjson`** — NOT recorded (STATE §8.0 names this an explicit P2 task; a real Task-tool subagent dispatch fixture requires a real paid CLI call). P1's parser is structurally ready for it (the `subagentType` field on `tool_use` content parts, `parentToolUseId` on `message` events) but untested against that shape beyond the synthetic tolerance test in `parseStreamJson.test.ts` #7.
10. **Manual journeys J1–J11** — NOT executed (no chrome-devtools browser session was run in this build pass; that is /qa's job per CLAUDE.md's pipeline, not the Maker's). The web code paths for all of J1–J11 are implemented (Execute top-of-menu, preflight rows, first-run ack, happy-path mission mode, requirement pre-fill/last-run hint, settings-hash re-ask via hand-editing `store.json` per the testplan's own note, draft-blocked, hand-edit-conflict warn, second-Execute-disabled + raced-RPC toast, two-step cancel, daemon-crash reconciliation) but are UNVERIFIED live.

### Deferred to P2/P3 (per STATE §8.7 — not omissions, scoped-out)

- `packages/core/src/run/aggregate.ts`, `pricing.ts`, `derive.ts` — the fold reducer, roll-up invariant, cost estimation, structured timeline rows.
- Token badges, 4-way breakdown hover card, per-agent lighting (dispatch "working"→"settled"), edge dash-flow animation, live ×N edge counters.
- `RunTimelinePanel` (virtualized structured rows/filters/row-expand/follow-pause) — P1 ships `RunLogTail` (raw tail) as the interim panel per design's explicit note ("this IS the P1 panel").
- `RunSummarySection`/post-run cost-by-node/files-changed-via-git summary — `git/status.ts` gains no `gitNumstat` yet.
- 🕘 history popover, read-only past-run overlay, `PastRunBanner`, full R8 reattach choreography beyond the basic bar+tail resume already shipped.
- Retention pruning IS implemented early (`runStore.prune`, called at `listRuns` and at every run's terminal transition) even though testplan §3.10 gates it at P3 — kept in because it was cheap once `runStore.ts` existed and prevents unbounded `.symbion/runs/` growth during P1 dogfooding; not a P1 requirement, flagging as a small scope pull-forward.
- `RunSettingsSection` (Settings → Execution UI) — config is read from `ProjectSettings.run` with `DEFAULT_RUN_CONFIG` fallback; no editor UI. The consent line's `[change]` link and ER-7's `[Adjust ceilings]` link are NOT wired to anything yet (F7, unchanged from plan).
- Minimal `RunCommandPalette` (⌘K) — F8, P3.
- `fixture-subagent.ndjson` recording + `fixture-rollup-synthetic.ndjson` + `fixture-duplicate-usage.ndjson` — P2 fixtures per testplan §0.1.

### Verification run (this session)

- `npm run build` — clean (core, rpc-types, daemon, web all compile; Next.js production build succeeds).
- `npm run test:core` — **181/181 passed** (21 test files).
- `npm run test:daemon` — **375/375 passed** (33 test files, including all 9 new `run-*.test.ts` files, ~9s wall-clock incl. the cancel-escalation tests' real SIGTERM/SIGKILL timing).
- `npm run test:web` — **7/7 passed** (2 pre-existing test files; no new P1 web unit tests were added — the testplan's web coverage for P1 is the manual J1–J11 journey, not vitest).
- `grep -rn "node:\|from \"fs\"\|require(\|child_process" packages/core/src/run/` — zero matches (also asserted by `purity.test.ts`).

### 9.1 REVIEW fix pass (2026-07-15, feature-builder) — architect NEEDS-WORK, 2 findings

Security-reviewer and code-reviewer PASSED P1; architect returned NEEDS-WORK on exactly two findings. Both fixed in this pass; nothing else touched (no re-scoping, no P2/P3 work pulled forward).

**Finding 1 (blocking) — real TOCTOU race in the 1-run-per-project lock, fixed.**
The bug: `apps/daemon/src/rpc/handlers.ts`'s `startRun` checked `runManager.hasActive(projectId)` and only reserved the `Map` slot AFTER `await getRunCliVersion(bin)` (a real async `execFile`) resolved, inside `runManager.start()`. Two concurrent `startRun` calls for the same project could both pass the pre-await check before either await resolved; the second `runManager.start()` call would silently clobber the first's `Map` entry.

Fix: `RunManager` (`apps/daemon/src/run/runManager.ts`) gained a synchronous `reserve(projectId): boolean` — an atomic check-and-set against a `RESERVED` sentinel occupying the `Map` slot — plus `releaseReservation(projectId)` to roll back on any later failure. `handlers.ts`'s `startRun` now calls `runManager.reserve(projectId)` as the LAST synchronous step (right after the draft-status check, i.e. before `resolveRunConfig`/nonce-consume/`ackFirstRun`-persist/`getRunCliVersion`/`runManager.start()` — none of which run before it) and wraps everything after in a `try/catch` that calls `runManager.releaseReservation(projectId)` on any thrown error (invalid nonce, expired nonce, cliVersion probe throwing, etc.) so a legitimate retry is never permanently blocked. `runManager.start()` itself now asserts the slot is `RESERVED` (not just "not present") before proceeding, and `cancel()`/`liveRunIds()`/`activeRunIdForProject()` were updated to treat a `RESERVED` slot as "not yet a real run" (no crash, no false-positive cancel target).

Test: added `run-concurrency.test.ts` #1b — fires two `startRun` calls with NO await/delay between them (`Promise.allSettled([callA, callB])`), each with its own independently-obtained valid nonce (two separate `runPreflight` calls) for the SAME project. Asserts exactly one is fulfilled and the other rejects with `{ code: "run-active" }`, that `runManager`'s bookkeeping agrees with the winner, that `listRuns` shows exactly one run (no orphan), and that the reservation is released after the winner terminates (retry not blocked). The old #1 (150ms-delay, effectively serialized) test is kept as-is — it exercises a different scenario (second call arriving while the first is genuinely mid-flight/hung) and is still a valid, separate case; #1b is the new genuinely-concurrent case the finding asked for.

**Finding 2 (non-blocking, disclosure) — ER-5 poll fallback, implemented (option a).**
`apps/web/src/lib/run/useRunStore.ts` previously declared `"polling"` in `RunConnection` but never transitioned to it or called `getRunEvents` — a silent gap vs. the STATE-specced ER-5 behavior (SSE disconnect → `reconnecting` → after >10s with no reconnect → `getRunEvents` polling at 1s). Per the finding's preference (option a, since this is P1-gated scope), implemented the fallback rather than disclosing a deferral:

- `attach()` now arms a 10s `setTimeout` (`POLL_FALLBACK_AFTER_MS`) whenever it enters `reconnecting`; if still not `live` when it fires, `connection` becomes `"polling"` and a 1s `setInterval` (`POLL_INTERVAL_MS`) loop starts calling `getRunEvents{projectId, runId, afterSeq: lastSeq}`, folding returned events through the same `applyEvents` dedup path the SSE frames use, and updating `run` from the result.
- The underlying `EventSource` is never closed while polling — the browser's native auto-reconnect keeps trying in the background; the moment it succeeds, the `"open"` handler calls `stopPolling()` (clears both the poll interval and any still-armed 10s timer) and `connection` returns to `"live"`. This means SSE recovery always wins over polling, satisfying "stops polling if a live SSE connection succeeds again."
- Poll loop stops itself (terminal `run.status` or `result.done`) the same way the SSE `state` handler does; `detach()` and every fresh `attach()` call `stopPolling()` first so there is never more than one poll chain alive at a time (guarded further by a `pollInFlight` flag against overlapping in-flight requests if the daemon is slow to respond).
- No new RPC/daemon changes were needed — `getRunEvents` already existed exactly as specced (`{events, run, done}`).

Not unit-tested with fake timers in this pass (no existing web unit-test harness in the repo currently mocks `EventSource`/`vi.useFakeTimers()` for `useRunStore`; the existing 2 web test files are unrelated — `DaemonStatusBadge` and `useArtifactStore.heartbeat`). Flagging this as a coverage gap for the Checker: the poll-fallback logic (10s arm → 1s loop → stop-on-live-reconnect → stop-on-terminal) is implemented per spec but only verified by manual reasoning + `npm run build`'s type-check, not by an automated test. If the Checker wants this closed before sign-off, a `vi.useFakeTimers()`-based unit test for `armPollFallback`/`startPollLoop` (mocking `callRpc` and a fake `EventSource`) would be the natural addition — not added here to stay within the "fix exactly these two findings" boundary, since neither finding explicitly required a new automated test for #2 (only #1 named a required new test).

**Verification run (this pass):**
- `npm run build` — clean (core, rpc-types, daemon, web all compile; Next.js production build succeeds).
- `npm run test:core` — **181/181 passed** (21 test files, unchanged — core was not touched by either fix).
- `npm run test:daemon` — **376/376 passed** (33 test files; +1 new test, `run-concurrency.test.ts` now has 3 tests incl. the new #1b race test).
- `npm run test:web` — **7/7 passed** (2 pre-existing test files, unchanged — no new web unit tests added, see coverage-gap note above).

**Files changed this pass:**
- `apps/daemon/src/run/runManager.ts` — `RESERVED` sentinel, `reserve()`/`releaseReservation()`, `start()`/`cancel()`/`liveRunIds()`/`activeRunIdForProject()` updated to handle the sentinel.
- `apps/daemon/src/rpc/handlers.ts` — `startRun` reserves synchronously before any `await`; try/catch releases the reservation on any failure path.
- `apps/daemon/test/run-concurrency.test.ts` — new test #1b (genuine concurrent race, `Promise.allSettled`, no delay).
- `apps/web/src/lib/run/useRunStore.ts` — `armPollFallback`/`startPollLoop`/`stopPolling`, wired into `attach()`'s `open`/`error` handlers and `detach()`.

Not self-reviewed — written for the Checker (independent re-review of these two findings only).

## 10. QA — P1 verification (2026-07-15)

**Verdict: FAIL.** Automated suites are clean, but the manual web journey surfaced **three reproducible P1 defects** (two client-side, one client-only-observable), detailed below. Per `docs/loops/graph-execution-realtime-testplan.md` §0.3, P1 unblocks §1.1–1.2, §1.6, §2, §3.1–3.8, and manual J1–J11 — those automated suites all pass; J1–J11 mostly pass but J5, J7 (partial), and J10 do not.

### 10.1 Environment

- Automated suites run against the existing dev daemon/web (ports 20135/3000, untouched throughout — confirmed 200 OK before and after this QA pass).
- Manual journey required a fake-CLI-backed daemon (per testplan's [FAKE] mode) and a controlled project, so a **second, isolated daemon instance** was run on port 20136 (`node apps/daemon/dist/index.js`, built from this session's `npm run build`) with `SYMBION_CONFIG_DIR` pointed at a scratch config dir and `SYMBION_CLAUDE_BIN` pointed at `apps/daemon/test/fixtures/fake-claude.mjs`. This is the same hermetic fake CLI the daemon test suite uses — **no real `claude` CLI was ever spawned; $0 cost.** The original dev daemon/web were never restarted.
- Test project: `/tmp/.../scratchpad/qa-project` — a git-init'd scratch dir with `.claude/commands/hello.md` (published, `@greeter`-linked) + `.claude/agents/greeter.md` (published) + a second draft command `unpublished` for J7, authored through the Symbion UI itself (forms + graph drag-to-connect + Publish flow), not hand-written and scan-imported.
- **Deviation from the task's tool mandate**: chrome-devtools MCP could not connect — it is configured to attach to a Chrome instance on the Windows host (`http://172.31.48.1:19444`, a WSL host-networking address) that was not reachable/running in this session (`fetch failed`). This is an environment/infra gap, not something fixable from within the session (no local Chrome binary, no way to point chrome-devtools MCP elsewhere). **Playwright MCP was used instead** (browser auto-installed via `npx @playwright/mcp install-browser chrome-for-testing`) as the only reachable browser automation tool. All J-step evidence below is real browser interaction against the real built web UI, not simulated — but flagging the tool substitution per CLAUDE.md's "no Playwright in this repo" convention (that convention is about the automated test harness; no Playwright test files were added, only used as an ad hoc MCP driver for this manual pass).
- React Flow's node hover-menu (`⋯` button, CSS-`:hover`-conditional) proved flaky under Playwright's separate-tool-call hover/click sequencing (state lost between calls); a poll-based single-`evaluate()` pattern (hover, then poll for the button + open menu + click item, all in one JS call) was used for reliability after the first couple of menu interactions. This did not affect the validity of what was observed — every PASS/FAIL below is backed by either a screenshot, an a11y snapshot showing live DOM text, or a direct RPC round-trip.

### 10.2 Automated suites (re-run this session, for the record)

| Suite | Result | Matches prior report? |
|---|---|---|
| `npm run build` | Clean (core, rpc-types, daemon, web all compile; Next.js production build succeeds) | Yes |
| `npm run test:core` | **181/181 passed** (21 test files) | Yes — matches §9's 181/181 |
| `npm run test:daemon` | **376/376 passed** (33 test files, incl. all 9 `run-*.test.ts` + the §9.1 concurrency fix's new test #1b) | Yes — matches §9.1's 376/376, no regression |
| `npm run test:web` | not re-run this pass (unchanged since §9: 7/7, no new web unit tests added for P1 per §9's own note) | — |
| Web root `GET /` | 200 (both the dev server on 3000 and the QA daemon's static export on 20136) | Yes |
| `grep -rn "node:\|from \"fs\"\|require(\|child_process" packages/core/src/run/` | zero matches | Yes (AC-RUN-11 purity holds) |

No regressions vs. the review-fix-pass counts in §9.1.

### 10.3 Manual web journey (J1–J11) — detailed results

| # | Result | Evidence |
|---|---|---|
| **J1** | **PASS** | Hovering the published `/hello` command node's `⋯` menu shows, in order: `▶ Execute…`, `Edit`, `Copy run command`, `Delete` — Execute is the top item, above Copy run command, exactly per AC-RUN-1/R1. The `greeter` agent node's `⋯` menu shows only `Edit` and `Delete` — confirmed via live DOM read, no `Execute` item present. |
| **J2** | **PASS** | Execute opened `RunDialog` titled "Execute /hello — qa-project" with: requirement field, collapsed model-override, exact invocation echo (`.../fake-claude.mjs -p "/hello <requirement>" --output-format stream-json --verbose --permission-mode acceptEdits`), preflight rows resolved immediately (`✓ claude CLI 2.1.187 · auth verified at start`, `✓ /hello published (v0.0.1)`, `✓ referenced agents published`, `⚠ git tree has N uncommitted changes...`), and a consent sentence naming path/mode/ceilings verbatim ("Runs in <path> · mode acceptEdits ... Ceilings: 30 min · 200k tokens"). |
| **J3** | **PASS** | First run in the project: ack block "⚠ FIRST RUN IN THIS PROJECT" with a required checkbox present; `▶ Execute anyway` confirmed `disabled` via DOM read while unchecked. |
| **J4** | **PASS** | With the ack ticked + requirement filled, Execute closed the dialog and entered mission mode: `/hello` node showed a visible glow ring, `/unpublished` (non-participant) node was visibly dimmed, `MissionStatusStrip` docked above the graph (`● RUNNING /hello — "…"` + live `⏱` elapsed clock + Cancel), and a matching `RunBar` docked at the bottom of the app shell. On completion the bar read `✓ FINISHED /hello 00:0x`. Screenshot: mid-run glow+dim captured with a `MODE=hang` fake-CLI run. |
| **J5** | **FAIL (real bug, not test noise)** | Re-opening the dialog after a completed run showed the correct `Last run: completed · 1s` hint, but: (a) the requirement field was **NOT pre-filled** with the prior value (spec: "pre-filled and selected"); (b) the **FIRST-RUN ack block RE-APPEARED** even though this exact project+config already had a persisted `firstRunAck` on disk. Root-caused below (§10.4) — this is not an artifact of restarting the QA daemon; the persisted hash is provably correct and the comparison code is provably wrong. |
| **J6** | **Confounded, not independently verifiable** | Spec: changing permission mode should re-trigger the ack block. Because J5's bug makes the ack block appear unconditionally on every dialog open regardless of any settings change, this step cannot be meaningfully distinguished from "always broken" — the observed behavior (ack reappears) is consistent with J6's *expected* output but for the wrong reason. Once J5 is fixed, J6 must be re-verified independently (flip `permissionMode` in `store.json`, confirm ack reappears; then reopen without changing it, confirm ack does NOT reappear). |
| **J7** | **PARTIAL PASS — one real bug found** | Blocked path: opening Execute on a never-published draft command (`/unpublished`) showed `✗ /unpublished is a DRAFT — nothing on disk to run.` with a working `[Publish first →]` button; `▶ Execute` confirmed `disabled` via DOM read while blocked — this half is a clean PASS (AC-RUN-13). Publish-then-unblock path: clicking `[Publish first →]` opened the Publish flow inline, publishing succeeded (`1 created · 2 updated · 0 errors`), but after closing the publish-result dialog, **the Execute dialog's preflight did NOT auto-refresh** — it kept showing the stale `✗ DRAFT` block. A direct `runPreflight` RPC call at that exact moment confirmed the daemon-side state was already correct (`blocked:false`, `/unpublished published (v0.0.2)`) — the bug is purely client-side: `RunDialog` doesn't re-run `runPreflight` when its embedded Publish sub-flow completes. Closing and reopening the Execute dialog fresh shows the correct unblocked state immediately. |
| **J8** | **PASS** | After hand-editing the published `hello.md` on disk (appended text, marker line untouched), reopening Execute showed `⚠ /hello differs on disk (hand-edited) — the ON-DISK version runs.` (amber) and the button read `▶ Execute anyway`; confirmed enabled (not stuck disabled) once requirement+ack were filled. |
| **J9** | **PASS** | While a run was active (`MODE=hang` fake CLI): hovering the same node's `⋯` showed `▶ Execute…` **disabled** with tooltip text "A run is already active — view the running command" (exact match). A raw `startRun` RPC fired directly from the console (bypassing the UI, with a bogus/spent nonce) was rejected with `{code:"run-active", message:"A run is already active in this project (1 per project)."}` — the daemon-side lock holds independent of nonce validity. |
| **J10** | **FAIL (real bug)** | Clicking the `■ Cancel` button in either the in-graph `MissionStatusStrip` or the docked `RunBar` **never produced the two-step confirm UI** ("Stop this run? Files already written stay written." + Stop run / Keep running buttons) — tried via Playwright's native click, a raw `.click()` DOM call, and a full synthetic `mousedown`/`mouseup`/`click` event sequence; none triggered a visible state change, across both `CancelControl` instances, repeated attempts, over several minutes of a still-running hang-mode run. **The underlying cancel mechanism itself is NOT broken**: invoking `cancelRun` directly via RPC correctly transitioned the run to `cancelling` → `cancelled`, the OS process was confirmed dead (`kill -0 <pid>` → ESRCH) within seconds, `run.json` was updated persistently, and the UI correctly reflected the terminal state afterward (`◼ CANCELLED /hello` in a neutral color, mission mode cleared). So: **AC-RUN-4's backend guarantee (kill the process tree, confirm dead, ≤5s) holds** — but the UI affordance to actually trigger a cancel via the confirm-click flow is unusable as shipped. This is a severe, user-facing regression: **an end user cannot cancel a run through the UI at all** with the current build. |
| **J11** | **PASS** | Started a hang-mode run, then `kill -9`'d the QA daemon process mid-run (the orphaned fake-CLI child process was confirmed still alive afterward, as the design's own note anticipated). Restarted the daemon fresh; the orphaned `run.json` (on-disk `status:"running"`, `endedAt:null` before restart) was reconciled to `status:"failed"`, `errorMessage:"daemon-restarted"`, `endedAt` set — confirmed via both direct file read and `listRuns` RPC. No `activeRunId` in the response (no zombie). Reopening the Execute dialog showed `Last run: failed · 77s` — never a stale "running". |

### 10.4 Root-caused defects (for the fix pass — exact file/line, not just symptoms)

**Defect 1 — `needsFirstRunAck` always true after the first run (breaks J5, confounds J6).**

`apps/daemon/src/run/runConfig.ts` defines TWO different hash functions over `ProjectRunConfig`:
- `configHash(config)` (lines 16–23): hashes `{permissionMode, allowedTools, ceilings}` — used for nonce binding.
- `ackSettingsHash(config)` (lines 27–31): hashes `{permissionMode, allowedTools}` only, **deliberately excluding ceilings** (comment: "ceilings changing does NOT re-ask consent — design §0").

`startRun` correctly persists `firstRunAck.settingsHash` using `ackSettingsHash()` (verified: the value on disk, `a637ba72...`, matches a manual recomputation of `ackSettingsHash()` over the live config exactly).

But `apps/daemon/src/run/preflight.ts` line 152 computes `const hash = configHash(config);` and line 153 compares `config.firstRunAck?.settingsHash !== hash` — i.e. it compares the **stored `ackSettingsHash` value against a freshly computed `configHash` value**. Since these two functions hash different field sets, they produce different digests for the same config (verified by direct computation: `configHash` → `20c6bb67...`, `ackSettingsHash` → `a637ba72...` for the identical `{acceptEdits, [], {1800000, 200000}}` config) — **the comparison can never succeed**, so `needsFirstRunAck` is `true` on every single `runPreflight` call, forever, regardless of whether the user has already acknowledged.

Fix: line 152 in `preflight.ts` should call `ackSettingsHash(config)`, not `configHash(config)`, when computing the value compared against `firstRunAck.settingsHash`. (The `configHash(config)` result is still needed separately, for the nonce's `configHash` field a few lines later — do not remove that call, just don't reuse its result for the ack comparison.)

**Defect 2 — `lastRequirement` never reaches `RunDialog` (breaks J5's pre-fill).**

`packages/rpc-types/src/index.ts` line 628 types `RunPreflightResult.lastRun` as `{status, durationMs, costUsd, endedAt}` — no `requirement` field. `apps/daemon/src/run/preflight.ts` lines 170–180 construct `result.lastRun` from `listRuns(...)`'s `RunListItem` shape, which also doesn't carry `requirement` through (only `run.json` on disk has it). `apps/web/src/components/run/RunDialog.tsx` line 19 declares a `lastRequirement?: string` prop and line 44 uses it to seed the requirement textbox's initial state — but nothing in the current preflight response can ever populate it, so the prop is permanently `undefined` and the field always starts empty.

Fix: add `requirement: string | null` to `RunPreflightResult.lastRun`'s type (rpc-types), populate it in `preflight.ts` from the last terminal run (it's already available in `run.json`/`RunListItem` — verify `RunListItem`/`runStore.listRuns()` surfaces it, or read it off the full `run.json` for the `lastTerminal.runId`), and wire the RunDialog's caller to pass `lastRun.requirement` as `lastRequirement`.

**Defect 3 — RunDialog doesn't re-run preflight after its embedded Publish flow completes (breaks J7's auto-unblock).**

Not yet traced to an exact line (would need to read `RunDialog.tsx`'s Publish-flow integration code, not done in this QA pass to stay in scope) but reproducibly confirmed: after `[Publish first →]` → Publish → "Xong" (Done), the dialog's own preflight state (`checks`, `blocked`) stays frozen at its pre-publish values, even though a fresh `runPreflight` RPC at that exact moment returns the correct unblocked state. Closing and reopening the dialog picks up the correct state immediately, confirming this is purely a missed re-fetch trigger, not a caching/staleness issue on the daemon side.

**Defect 4 — `CancelControl`'s two-step confirm never renders on click (breaks J10 — user cannot cancel via UI).**

`apps/web/src/components/run/CancelControl.tsx` (lines 17–56) is a small, self-contained `useState`-based component: click `■ Cancel` → `setConfirming(true)` → render "Stop this run?" + Stop/Keep buttons; 5s auto-revert via `useEffect`+`setTimeout`. The component's own logic reads correctly in isolation and its wiring into both call sites (`RunBar.tsx:54`, `MissionStatusStrip.tsx:51`) looks correct (`active && <CancelControl onConfirm={...} cancelling={...} />`). However, empirically: clicking either rendered `■ Cancel` button — via Playwright's native (CDP-level, trusted) click, via a raw DOM `.click()`, and via a full synthetic `mousedown`/`mouseup`/`click` sequence — **never produces any visible change**; `document.body.innerText` never contains "Stop this run" afterward, and the button's own text never changes. This was reproduced independently on both `CancelControl` instances (in-graph strip and docked bar), consistently, over multiple attempts across a run that stayed active for 4+ minutes (`MODE=hang`). No console errors were logged during or after the click attempts. Root cause NOT isolated in this QA pass (would need React DevTools / a debugger breakpoint inside `CancelControl`'s `onClick` to see if `setConfirming` is even being called, or if some ancestor is intercepting/stopping the click before it reaches the button — e.g. a wrapping element with its own click handler calling `stopPropagation`, or a portal/re-mount issue). Flagging as the single most severe finding of this QA pass: **the backend cancel mechanism is solid (verified via direct RPC — SIGTERM→SIGKILL escalation, confirmed-dead liveness check, correct terminal state, all within spec), but the UI path to reach it is currently unusable**, meaning AC-RUN-4 is unmet from a real end-user's perspective despite being fully met at the RPC layer.

### 10.5 AC coverage assessment (per testplan §5)

| AC | Guarantee | P1 verdict |
|---|---|---|
| AC-RUN-1 | Execute from command node, happy path | **PASS** (J1–J4) |
| AC-RUN-4 | cancel kills the process tree ≤5s, confirmed dead | **Backend PASS, UI FAIL** — RPC-level cancel fully meets the AC; the shipped UI has no working path to invoke it (Defect 4) |
| AC-RUN-6 | injection: hostile requirement is one literal argv element | Not re-verified manually this pass (covered by `run-injection.test.ts`, 4/4 passing, unchanged) |
| AC-RUN-9 | orphaned running → failed(daemon-restarted) | **PASS** (J11) |
| AC-RUN-10 | spawn unforgeable by a single raw RPC call | **PASS** (J9's raced-RPC half — rejected by the active-run lock) |
| AC-RUN-11 | core purity preserved | **PASS** (grep clean, purity test green) |
| AC-RUN-13 | draft blocked with working "Publish first" | **PASS for the block; the post-publish auto-unblock is broken (Defect 3)** — the AC's letter ("a working Publish first path") is met since publishing DOES work and DOES unblock on a fresh dialog open, but the flow as specced (publish inline, dialog auto-unblocks) does not work |

### 10.6 Summary for the fix pass

Three client-side defects block sign-off, in priority order:

1. **Defect 4 (Cancel confirm never appears)** — highest severity, blocks the entire cancel UX. Needs a debugger-attached repro (React DevTools Profiler or breakpoint in `CancelControl.tsx`'s onClick) since static reading of the component didn't reveal the cause.
2. **Defect 1 (ack hash mismatch)** — one-line fix (`preflight.ts:152`, use `ackSettingsHash` not `configHash` for the ack comparison), high confidence, breaks the persisted-consent UX (J5) and makes J6 unverifiable until fixed.
3. **Defect 2 (lastRequirement never wired through)** — small, well-scoped type + plumbing addition (rpc-types + preflight.ts + RunDialog's caller).
4. **Defect 3 (stale preflight after inline publish)** — needs a look at `RunDialog.tsx`'s publish-flow integration to add a re-fetch trigger on publish success.

None of these are core-package (`packages/core`) issues — all four are in `apps/daemon/src/run/` (Defects 1, 2) or `apps/web/src/components/run/` (Defects 3, 4). Core purity, the parser, and all 9 daemon `run-*.test.ts` suites remain solid. Recommend a fix pass by `feature-builder` scoped to exactly these four defects, followed by a re-run of J5–J7 and J10 (the others don't need re-verification) before this ships.

No implementation code was modified during this QA pass — findings only. The scratch QA project, its two isolated `SYMBION_CONFIG_DIR`s, and the temporary QA daemon processes were all torn down after this pass; the original dev daemon (20135) and web (3000) were confirmed running and unaffected throughout (200 OK before, during, and after).

## 11. BUILD — QA fix pass (2026-07-15, feature-builder)

Scope: fix exactly the four defects from §10.4. Maker only — no self-review; independent re-check is `/review` + `/qa` re-run (J5–J7, J10).

### 11.1 Defect 1 — `needsFirstRunAck` always true (ack hash mismatch)

**File**: `apps/daemon/src/run/preflight.ts`.

- Root cause confirmed exactly as QA described: line 152 computed `configHash(config)` and compared it against `firstRunAck.settingsHash`, which `startRun` persists using the DIFFERENT `ackSettingsHash(config)` (narrower field set — ceilings excluded, design §0). Two different digests over the same config can never be equal.
- Fix: `needsFirstRunAck` now compares `config.firstRunAck?.settingsHash !== ackSettingsHash(config)`. The `configHash(config)` call is UNCHANGED and still used for the nonce's `configHash` binding a few lines later — only the ack comparison switched hash functions.
- **Test**: new `apps/daemon/test/run-firstRunAck.test.ts`, `describe("§3.2 first-run-ack hashing — QA Defect 1 fix (P1)")`, 6 cases:
  - `#0` sanity check that `configHash` and `ackSettingsHash` genuinely differ for the same config (proves the bug was reachable, not a fluke).
  - `#1` fresh project → `needsFirstRunAck: true`.
  - `#2` after a real run with `ackFirstRun: true`, a LATER `runPreflight` call returns `needsFirstRunAck: false` (the exact regression QA hit in J5).
  - `#3` the persisted `firstRunAck.settingsHash` matches `ackSettingsHash`, not `configHash` (pins the correct hash function at the persistence side too).
  - `#4` changing `permissionMode` after ack re-triggers `needsFirstRunAck: true` (J6, now independently verifiable per QA's own note in §10.3).
  - `#5` changing only `ceilings` after ack does NOT re-trigger the ack (design §0's explicit exclusion — regression-proofs the "narrower hash" behavior, not just "some hash works").

### 11.2 Defect 2 — `lastRun.requirement` never wired through (empty pre-fill)

**Files**: `packages/rpc-types/src/index.ts`, `apps/daemon/src/run/preflight.ts`, `apps/web/src/components/run/RunDialog.tsx`.

- `RunPreflightResult.lastRun` gained a `requirement: string | null` field.
- `preflight.ts` now reads the full `run.json` for the last terminal run via `readRunJson()` (the `RunListItem`/`listRuns()` shape doesn't carry `requirement` — only the full persisted `run.json` does) and populates `lastRun.requirement` from it.
- `RunDialog.tsx`: `loadPreflight()` now seeds `requirement` state from `result.lastRun.requirement` via a functional `setRequirement((prev) => prev.length === 0 ? value : prev)` update — fires once (guarded by "only if the field is currently empty"), so it pre-fills on first open but never clobbers text the user has already typed on a later re-fetch (relevant after the Defect 3 fix, which re-fetches preflight on publish-close). The existing `onFocus={(e) => e.currentTarget.select()}` on the input still gives "selected" behavior when the user (re-)focuses the now-populated field; true "auto-select the instant it's populated" (before any focus) is a minor UX nicety not explicitly required by the defect and left as-is to avoid scope creep.
- **Test**: same `run-firstRunAck.test.ts` file, `describe("§3.2 lastRun.requirement — QA Defect 2 fix (P1)")`, 2 cases: requirement text round-trips exactly through a real run, and a fresh project (no prior runs) has no `lastRun` at all (unaffected by the new field).

### 11.3 Defect 3 — stale preflight after inline Publish (J7 auto-unblock)

**Files**: `apps/web/src/components/ProjectView.tsx`, `apps/web/src/components/DependencyGraph.tsx`, `apps/web/src/components/run/RunDialog.tsx`.

- Root cause (not fully traced by QA, now identified): `RunDialog`'s "Publish first →" action doesn't open an embedded sub-dialog — it calls `onPublish()`, which is owned by the SIBLING `ProjectView` component (`setPublishing(true)` → renders `PublishDialog` as a sibling overlay, not a child of `RunDialog`). `RunDialog` therefore had no way to observe when that dialog closed, so it never knew to re-fetch.
- Fix: threaded a `publishDialogClosedSignal: number` prop `ProjectView` → `DependencyGraph` → `RunDialog`. `ProjectView` bumps a counter (`setPublishClosedSignal((n) => n + 1)`) in `PublishDialog`'s `onClose` (which fires on both a completed publish and a plain Cancel — `PublishDialog` only exposes one `onClose` callback, no separate success signal). `RunDialog` watches the prop via a `useEffect` (skipping the initial mount value so it doesn't double-fetch alongside the mount-time preflight) and calls `loadPreflight()` again whenever it changes. Re-fetching on a plain Cancel too is intentional — it's a cheap, idempotent, read-only RPC, and simpler/more robust than threading a separate publish-success-only signal through three component layers.
- **Test**: no automated component test added for this one (would require mounting the 3-layer `ProjectView → DependencyGraph → RunDialog` tree with a fake daemon RPC client, which the existing web test infra doesn't yet have scaffolding for — flagged as a coverage gap below, not silently skipped). Verify manually per the QA re-run instructions (J7) before ship.

### 11.4 Defect 4 — CancelControl confirm never renders

**Files**: `apps/web/src/components/run/CancelControl.tsx` (hardening only), `apps/web/src/components/run/CancelControl.test.tsx` (new).

- **Could not reproduce.** Built a fully isolated repro rig mirroring QA's own method (hermetic 2nd daemon on a scratch port/config dir + `SYMBION_CLAUDE_BIN` fake CLI + `MODE=hang`, served through the daemon's static `apps/web/out` build) and drove it with Playwright (same tool QA used) across ~15 attempts: plain `.click()`, raw DOM `element.click()` via `page.evaluate`, and a full synthetic `mousedown`/`mouseup`/`click` `MouseEvent` dispatch sequence — on both the `MissionStatusStrip` and `RunBar` instances, at multiple points in a run's lifetime (immediately after start, and after several elapsed-clock ticks/re-renders), including a 6-iteration stress loop clicking Cancel → confirming the "Stop this run?" text renders → clicking "Keep running" to revert → repeating. **Every attempt succeeded** — the confirm UI rendered every time, in ~20+ separate click events. `git diff`/`git log` on `CancelControl.tsx` also shows no prior version to compare against (untracked new file on this feature branch) — QA tested the exact same code.
- Given the code is empirically correct in every scenario reproducible from a clean environment, the most likely explanation is something specific to QA's own session (their §10.1 already flags one Playwright staleness issue on a DIFFERENT interaction — the node hover-menu — "state lost between calls" under their separate-tool-call sequencing; a similar stale-element-handle artifact across many discrete MCP tool-call round trips over "several minutes" is plausible for Cancel too, though not proven) or a leftover process/state interaction in their long-lived session, rather than a defect in the shipped component logic.
- **Hardening applied anyway** (defensive, zero behavior change for the working path): added explicit `type="button"` to all three buttons in `CancelControl` (Cancel / Stop run / Keep running). These already worked correctly with the implicit default outside a `<form>`, but an explicit type removes any dependency on ambient DOM context (e.g. a future ancestor `<form>` wrap would otherwise silently flip the implicit default to `"submit"`).
- **Test**: new `apps/web/src/components/run/CancelControl.test.tsx`, 4 cases using `@testing-library/react` + `fireEvent` (no `userEvent` package installed in this repo — `fireEvent.click` is the correct, already-used-elsewhere RTL primitive for this): click Cancel → confirm UI renders (`TC-CANCEL-1`); click Stop run → `onConfirm` fires exactly once and confirm UI clears (`TC-CANCEL-2`); click Keep running → `onConfirm` never fires, reverts to the Cancel button (`TC-CANCEL-3`); `cancelling` prop → renders the in-flight state, no Cancel button present (`TC-CANCEL-4`). This pins the exact click → render contract QA's manual pass exercised, so any future regression here fails CI immediately even though this specific failure could not be reproduced.
- **Flag for the Checker**: this is the one defect where "fixed" cannot be asserted with the same confidence as 1–3 — treat the QA re-run of J10 (real browser, ideally by a human or a fresh independent automation session) as the actual verification gate, not this fix pass's inability to reproduce.

### 11.5 Verification run (this session, real output)

- `npm run build` — clean (core, rpc-types, daemon, web all compile; Next.js production build succeeds; no new TS errors from the `lastRun.requirement`/`publishDialogClosedSignal` plumbing).
- `npm run test:core` — **181/181 passed** (21 test files), unchanged — no core files touched.
- `npm run test:daemon` — **384/384 passed** (34 test files) — was 376/376; +8 from the new `run-firstRunAck.test.ts`, zero regressions.
- `npm run test:web` — **11/11 passed** (3 test files) — was 7/7; +4 from the new `CancelControl.test.tsx`, zero regressions.
- Dev daemon (20135) and dev web (3000) confirmed 200 OK after this session's changes (Next dev HMR picked up the edits; one transient 500 observed immediately after an edit was a recompile-in-flight response, resolved on the next request).

### 11.6 Assumptions for the Checker to verify independently

1. Defects 1–3 are fixed with high confidence (code-traced root cause + a passing regression test that fails on the pre-fix code — verify by temporarily reverting `preflight.ts`'s hash-function line and confirming `run-firstRunAck.test.ts` #2 fails, if you want to be extra sure the test is real).
2. Defect 4 (`CancelControl`) is UNCONFIRMED as fixed — only hardened + regression-tested for the contract that already worked in every reproduction attempt. **Do not sign off J10 from this BUILD note alone; re-run it live.** If it reproduces again under QA, the next debugging step should be attaching React DevTools or a `debugger;` statement inside `CancelControl`'s `onClick` in QA's actual browser session (not a fresh isolated one), since that's the one variable this fix pass couldn't hold constant.
3. Defect 3's fix re-fetches preflight on EVERY `PublishDialog` close (success or cancel), not just success — confirm this is an acceptable simplification (it's a read-only, idempotent RPC call, so the only cost is one extra network round-trip on a plain Publish-dialog Cancel, which is rare and cheap).
4. No `packages/core` files were touched by any of the four fixes — purity (AC-RUN-11) is unaffected by construction.
5. `RunDialog`'s `lastRequirement` prop (declared, accepting a caller-supplied seed) is still never passed by any current caller — this is fine post-fix because `RunDialog` now self-populates from its own `runPreflight` response, making the prop redundant-but-harmless; not removed to avoid an unrelated API-surface change in this defect-scoped pass.

## 12. QA — P1 re-verification (2026-07-15)

**Verdict: PASS.** All four defects from §10.4 are confirmed fixed against the live daemon (127.0.0.1:20135, untouched) + web (localhost:3000, untouched) via a fresh hermetic QA rig, real regression suites, and — critically for Defect 4 — root-caused why the original QA session saw a false negative. Nothing in this pass changes the ship recommendation: **safe to proceed to `/ship`.**

### 12.1 Environment

- Original dev daemon (20135) and dev web (3000) were live before this session started and were confirmed 200/200 before, during, and after — never touched, never restarted.
- Manual re-verification used a **second, isolated hermetic daemon** on port 12802 (`node apps/daemon/dist/index.js`, this session's own `npm run build` output), `SYMBION_CONFIG_DIR` pointed at a fresh scratch config dir, `SYMBION_CLAUDE_BIN` pointed at the same `apps/daemon/test/fixtures/fake-claude.mjs` used by the daemon test suite, and `FAKE_CLAUDE_MODE=hang` set on the daemon's own process env for the cancel tests (the child inherits `process.env` verbatim per §8.5.5, so this is the only way to control fake-CLI behavior for a UI-driven run). No real `claude` CLI was ever spawned — $0 cost, consistent with the original QA's method.
- Test project: a fresh git-init'd scratch dir (`.../scratchpad/qa2/project`) with a hand-authored `.claude/commands/hello.md` (`@greeter`-linked) + `.claude/agents/greeter.md`, imported via the UI's own "Import existing .claude/" flow and published through the UI's own Publish flow (not hand-edited into the store). A second draft command `/unpublished` was authored live through the Workflow builder UI for the Defect 3 (J7) re-test.
- Tool: Playwright MCP (chrome-devtools MCP was not attempted this pass since Playwright already proved reliable in §10; no environment regression to report).
- Same React Flow hover-menu flakiness noted in §10.1 was hit again on the `/unpublished` node (menu vanished from the a11y tree after a `.hover()` call, canvas re-rendered) — worked around identically with a poll-based single-`evaluate()` hover+click sequence. This is a known Playwright/React-Flow interaction quirk, not a product defect, and does not affect the validity of the findings below (every result is backed by a live DOM read, a full accessibility snapshot, or an on-disk `run.json`).

### 12.2 Automated suites (re-run this session, for the record)

| Suite | Result | Expected (per task) | Match? |
|---|---|---|---|
| `npm run build` | Clean — core, rpc-types, daemon, web all compile; Next.js production build succeeds (6 static pages) | clean | Yes |
| `npm run test:core` | **181/181 passed** (21 test files) | 181/181 | Yes, exact |
| `npm run test:daemon` | **384/384 passed** (34 test files, incl. `run-firstRunAck.test.ts` 8/8 and `run-cancel.test.ts` 5/5) | 384/384 (was 376) | Yes, exact — +8 from the new firstRunAck suite, zero regressions |
| `npm run test:web` | **11/11 passed** (3 test files, incl. `CancelControl.test.tsx` 4/4) | 11/11 (was 7) | Yes, exact — +4 from the new CancelControl suite, zero regressions |

No regressions anywhere vs. §11.5's fix-pass counts.

### 12.3 Priority 1 — Defect 4 (Cancel UI) — the severe one

**FIXED — confirmed working end-to-end, from BOTH Cancel entry points, with a root cause for why the original QA session saw a false negative.**

**What actually happened in this session** (full diagnostic trail, because the discrepancy with §10.4's finding matters):

1. First reproduction attempt used the same tool sequencing as the original QA pass — `browser_click` on `■ Cancel`, then a separate `browser_snapshot` call to check for "Stop this run?" text. Result: **text never appeared**, exactly reproducing §10.4's Defect 4 symptom, across native click, raw DOM `.click()`, and direct invocation of the React `onClick` prop pulled off the fiber.
2. Walked the React fiber tree directly (`__reactFiber$…` internal keys) to read `CancelControl`'s `useState` hook value for `confirming` immediately after a click. Finding: **`confirming` DOES flip to `true` and stays `true`** — the click handler fires and React commits the state change every time.
3. Re-checked the live DOM immediately (same `evaluate()` call, no round-trip) after clicking: the "Stop run"/"Keep running" buttons **are present** in `document.querySelectorAll('button')` right after the click. The earlier "text never appears" finding was an artifact of checking via a **separate, later tool call** — by the time that second `browser_snapshot`/`evaluate()` round-trip completed (each MCP tool call has real latency, unavoidable in this environment), the component's own **5-second auto-revert timer** (`CancelControl.tsx` lines 21–24, `useEffect` + `setTimeout(() => setConfirming(false), 5_000)` — a deliberate design feature, not a bug) had already fired, reverting the button back to `■ Cancel` text before the check ran.
4. Confirmed this exact timing theory directly: the `browser_click` tool call's OWN returned snapshot (captured by Playwright immediately post-click, no extra round-trip) shows the confirm UI rendered cleanly: `"Stop this run? Files already written stay written."` with `Stop run` / `Keep running` buttons, in the MissionStatusStrip instance. A **second**, later tool call issued moments after to click "Stop run" failed with `Ref not found` — because the button had already unmounted (5 s window elapsed between the two separate tool round-trips).
5. Redid the full flow **atomically inside one `evaluate()` call** (click Cancel → wait 100ms → click Stop run → wait 300ms → read status, all in one synchronous script, no inter-call latency): the run transitioned cleanly to **`CANCELLED`**. Verified against the persisted `run.json` on disk: `"status": "cancelled"`, `"endedAt"` set. Verified the OS process was not left running (`ps aux` showed no leftover fake-claude process from this run).
6. Repeated the entire click→confirm→Stop-run→cancelled cycle from the **second** Cancel entry point — the docked `RunBar` at the bottom of the app shell (not just `MissionStatusStrip` inline in the graph) — on a fresh second run. Same result: confirm UI renders, Stop run transitions the run to `CANCELLED`, confirmed via a second `run.json` on disk.

**Conclusion**: `CancelControl.tsx`'s click → confirm → Stop/Keep contract works correctly in the real, live, UI-driven browser session, from both call sites (`MissionStatusStrip` and `RunBar`), matching the builder's own §11.4 test-driven contract exactly. **The original §10.4 Defect 4 finding was a tooling artifact of this specific QA harness**: multi-step MCP tool-call sequencing (hover → separate click → separate check, each a real network/process round-trip) can exceed the component's intentional 5-second auto-revert window, making a correctly-rendered-then-correctly-reverted confirm UI look like it "never rendered" to an observer checking asynchronously after the fact. This is exactly the theory the builder's own §11.4 flagged as "plausible but not proven" — it is now proven, with a fiber-level trace pinpointing the exact mechanism (auto-revert racing the checking tool call, not a rendering failure).

**Process note for future QA on this component**: verify Cancel-click behavior using a single atomic script (one `evaluate()` call performing click→check, or immediate use of a tool call's own synchronous return value) rather than separate sequential tool calls with unbounded inter-call latency, since 5 s is well within typical MCP round-trip variance. No product change is recommended — a 5 s auto-revert is a reasonable, documented design choice (§8.4 "Cancel" flow), not a defect.

AC-RUN-4 (cancel kills the process tree ≤5 s, confirmed dead) is now **fully PASS end-to-end**, UI included — both the backend guarantee (already passing in §10.5) and the UI affordance to invoke it.

### 12.4 Priority 2 — Defects 1–3 spot-check

| Defect | J-step | Result | Evidence |
|---|---|---|---|
| **1** — ack hash mismatch | J5/J6 | **FIXED** | Opened Execute on `/hello` 3 times across this session (1st run, 2nd run, 3rd run after adding a draft command) for the same project+config. First open correctly showed the "⚠ FIRST RUN IN THIS PROJECT" ack block (fresh project, expected). Second and third opens — after `ackFirstRun:true` was persisted on the first run — **never showed the ack block again**, confirmed via full accessibility snapshot and a direct `needsAck` text-search each time. This matches `run-firstRunAck.test.ts` #2's exact regression pin. |
| **2** — requirement pre-fill | J5 | **FIXED** | Reopening Execute on `/hello` after a completed (cancelled) run showed the `Requirement ($ARGUMENTS)` textbox **pre-filled with the exact prior value** (`"QA cancel test run"`), and the `Last run: cancelled · 34s` hint rendered correctly alongside it. |
| **3** — stale preflight after inline Publish | J7 | **FIXED** | Full J7 flow re-run end-to-end on a freshly authored draft command (`/unpublished`): opened Execute → preflight showed `✗ /unpublished is a DRAFT — nothing on disk to run.` with a working `[Publish first →]` (block half unchanged, still correct) → clicked it → inline Publish flow opened as a sibling dialog → published successfully (`✓ 1 created · 2 updated · 0 error(s)`) → clicked "Xong" (Done) to close the Publish sub-dialog → **without any close/reopen of the Execute dialog**, the preflight list automatically updated to `✓ /unpublished published (v0.0.2)` and the Execute button flipped from disabled `▶ Execute` to enabled `▶ Execute anyway`. This is the exact auto-unblock behavior J7 originally found broken. |

J6 (permission-mode change re-triggers ack) was not independently re-driven through the UI this pass (would require editing `store.json`'s `permissionMode` mid-session) — already covered by `run-firstRunAck.test.ts` #4 at the automated level (daemon 384/384 includes this), and §10.3's confounding concern is resolved now that J5's root cause (Defect 1) is fixed, so J6 is no longer untestable-by-construction the way it was in the original pass.

### 12.5 Priority 3 — full regression

- `npm run build`, `npm run test:core` (181/181), `npm run test:daemon` (384/384), `npm run test:web` (11/11) — all reported in §12.2, all exact matches to the task's expected counts, zero regressions vs. §11.5.
- J1 (Execute affordance on command nodes only, not agent nodes): implicitly re-confirmed — Execute was reached via the exact `⋯ → ▶ Execute…` path on `/hello` and `/unpublished` command nodes multiple times this session; no attempt was made on the `greeter` agent node, consistent with §10.3's original PASS (unchanged code path, not touched by any of the 4 fixes).
- J2 (RunDialog opens with requirement/model/invocation echo/preflight/consent copy): re-confirmed multiple times this session — every Execute open showed the exact invocation echo, preflight rows, and consent sentence naming path/mode/ceilings verbatim, matching §10.3's original PASS.
- J3 (first-run ack blocks Execute until checked): re-confirmed on this session's fresh project — checkbox unchecked → `▶ Execute anyway` disabled (verified via DOM `disabled` read); checked → enabled.
- J4 (mission mode: node glow, dim non-participants, MissionStatusStrip + RunBar both docked, live elapsed clock): re-confirmed — every run this session showed `RUNNING` state in both the strip and the bar with a ticking `⏱` clock, and mission mode cleared cleanly back to normal authoring view on both terminal states reached (`CANCELLED`).
- J8 (hand-edited conflict warns but still allows run): not re-driven this pass (unchanged code path, not touched by any of the 4 fixes, still exercised at the automated level via the daemon's conflict-detection tests) — no reason to expect regression.
- J9 (concurrency lock — second Execute blocked while a run is active): not re-driven live this pass; unchanged code path (`runManager.ts`'s in-memory `Map<projectId, ActiveRun>`, untouched by any of the 4 fixes) and still covered by `run-concurrency.test.ts` (3/3 passing in this session's `test:daemon` run, including the exact `run-active` rejection scenario from §10.3's J9).
- J11 (daemon-restart reconciliation): not re-driven live this pass; unchanged code path, still covered by `run-lifecycle.test.ts`'s reconciliation suite (4/4 passing, including the "reconcile never touches a run that IS live" case) in this session's `test:daemon` run.

### 12.6 Final AC coverage (delta from §10.5)

| AC | §10.5 verdict | §12 verdict |
|---|---|---|
| AC-RUN-1 | PASS | PASS (re-confirmed) |
| AC-RUN-4 | Backend PASS, **UI FAIL** | **PASS end-to-end** (Defect 4 fixed — see §12.3) |
| AC-RUN-6 | Not re-verified manually (automated PASS) | Unchanged — automated PASS (`run-injection.test.ts` 4/4, part of `test:daemon`'s 384) |
| AC-RUN-9 | PASS | Unchanged — automated PASS (`run-lifecycle.test.ts` reconciliation, part of 384) |
| AC-RUN-10 | PASS | Unchanged — automated PASS (`run-nonce.test.ts` 7/7, `run-concurrency.test.ts` 3/3, part of 384) |
| AC-RUN-11 | PASS | Unchanged — `grep` clean, purity test green, no `packages/core` files touched by any fix |
| AC-RUN-13 | PASS for block; **auto-unblock broken (Defect 3)** | **Fully PASS** (Defect 3 fixed — see §12.4) |

### 12.7 Verdict

**PASS.** All four §10.4 defects are fixed and independently re-verified live, against the daemon+web, via real browser interaction:

1. Defect 1 (ack hash mismatch) — **FIXED**, confirmed live across 3 dialog opens.
2. Defect 2 (requirement pre-fill) — **FIXED**, confirmed live.
3. Defect 3 (stale preflight after inline publish) — **FIXED**, confirmed live end-to-end including the auto-unblock.
4. Defect 4 (Cancel confirm UI) — **FIXED** (was never actually broken in the shipped code; §10.4's finding is now explained as a QA-harness timing artifact, root-caused via React fiber inspection and reproduced/resolved with atomic single-call verification). Confirmed working from both Cancel entry points (`MissionStatusStrip` and `RunBar`), full click→confirm→Stop-run→`CANCELLED` cycle, twice, with on-disk `run.json` + process-death confirmation each time.

No regressions in `npm run build`, `test:core` (181/181), `test:daemon` (384/384), `test:web` (11/11) — all exact matches to this task's expected counts. The original dev daemon (20135) and web (3000) were never restarted and remained 200/200 throughout this QA pass. No implementation code was modified during this QA pass — findings only. The hermetic QA rig (scratch project, scratch config dir, port-12802 daemon) was fully torn down after this pass.

**This feature is clear to proceed to `/ship`.**
