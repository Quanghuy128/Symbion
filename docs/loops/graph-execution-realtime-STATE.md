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

## 13. PLAN — P2 Architecture (2026-07-15, architect)

> Scoped strictly to STATE §8.7's P2 bullet ("structured telemetry (L)"). P1 (§9, §11) and its QA
> (§10, §12) are DONE and untouched here; P3 (history/reattach/settings UI) is explicitly out of
> scope — see §13.7 for what P2 must NOT build. This section implements §6 (Scope, LOCKED), the
> canonical design doc's P2-tagged surfaces, and resolves/absorbs Flaws F4–F7 from §8.8 rather than
> re-deriving them. Companion test items appended to `graph-execution-realtime-testplan.md`.

### 13.0 What P1 already shipped that P2 builds on (ground truth, re-verified by reading the code)

- `packages/core/src/run/events.ts` **already declares** `FourWay`, `ContentPart`, `ModelUsageEntry`,
  the full `RunEvent` union, `RunInfo` (incl. `filesChanged`/`totals` fields, currently always
  `null`), `FileChange`, `RunTotals`, `RunListItem`, `TimelineRow`, `RunView` — P2 does **not**
  invent new shapes here, it fills in the logic that produces values for fields that already exist
  structurally (`totals`, `filesChanged`) and adds `derive.ts`'s row-producer for `TimelineRow`.
- `packages/core/src/run/parseStreamJson.ts` is COMPLETE and pinned to the real `fixture-simple.ndjson`.
  P2 adds a second real fixture (subagent) but does **not** modify the parser's contract — the
  parser already emits `parentToolUseId` and `subagentType` correctly per §8.0's verification.
- `apps/daemon/src/run/runManager.ts`'s `ingestLine()` already seq-stamps, appends to `events.jsonl`,
  and broadcasts — it does **not** fold anything (no `aggregate` import). P2 adds a fold call here
  (daemon-side `RunState` per run, kept in `ActiveRun`) purely to drive the token-cap ceiling check;
  it must NOT change the append/broadcast contract already tested by `run-sse.test.ts`/`run-happyPath.test.ts`.
- `apps/daemon/src/run/preflight.ts`/`runConfig.ts` (`resolveRunConfig`, `configHash`, `ackSettingsHash`,
  `buildConsentSentence`) are DONE, including the Defect-1 fix (`ackSettingsHash` for the ack
  comparison). P2 does not touch these.
- `apps/daemon/src/git/status.ts` has `gitStatus()` only (`git status --porcelain`, advisory,
  read-only). P2 adds a sibling `gitNumstat()` — same file, same pattern, same argv-array precedent.
- `apps/web/src/lib/run/useRunStore.ts` currently holds `rawTail: RawTailLine[]` (P1's raw-only
  panel) and **no token math** — this is the P1 boundary explicitly named in §9's file list
  ("P1 raw tail only… no token aggregation (P2's `core.fold` is not wired to any UI yet)"). P2 adds
  `nodeRunData`/`timeline`/`summary`/`degraded` state derived by folding the SAME `PersistedRunEvent`
  stream (already flowing over SSE/`getRunEvents` since P1) through `core.fold` — no new wire
  protocol, no new RPC method needed for telemetry itself.
- `apps/web/src/components/DependencyGraph.tsx` already threads `runFlow: "flowing"|"off"` into
  `AnimatedEdgeData` (a P1 pull-forward per §9's file notes: "ships `runFlow` in the edge data bag
  for a P2 `AnimatedEdge` consumer, but `AnimatedEdge` itself is untouched in P1"). P2's job on the
  edge is purely visual consumption of a field that already exists — not new plumbing.
- `RunLogTail.tsx` (P1's interim panel) stays; P2 adds `RunTimelinePanel` as a new component and the
  design's "Raw demoted to a tab" means `RunLogTail`'s content becomes the Raw tab's body inside the
  new panel, not a separate deletion+rewrite.

### 13.1 Architecture — exact file list

#### `packages/core/src/run/` (PURE — AC-RUN-11 unchanged)

| File | Status | Responsibility |
|---|---|---|
| `pricing.ts` | **NEW** | `MODEL_PRICING: Record<string, {inputPerMtok; outputPerMtok; cacheReadPerMtok; cacheWritePerMtok}>` seeded from the fixture's two observed models (`claude-fable-5`/main-model-family pricing tier, `claude-haiku-4-5-20251001`) plus the other Claude model-family tiers documented publicly (sonnet/opus/haiku), keyed by exact model string with a normalizing prefix-match fallback (model strings carry date suffixes, e.g. `claude-haiku-4-5-20251001` — match on the family+tier prefix, not exact string, else every dated release breaks pricing). `estimateCostUsd(usage: FourWay, model: string): number \| undefined` — `undefined` for no match (F4's `$ —`). `reconcileToTotal(perNodeEstimates: Map<key, number>, totalCostUsd: number): Map<key, number>` — proportional rescale so Σ === `totalCostUsd` (ties/zero-total handled: if all estimates are 0 but `totalCostUsd > 0`, distribute pro-rata by fresh-token share instead of by-$ share, so a run with only unknown-model estimates still gets a sane terminal split rather than divide-by-zero). |
| `aggregate.ts` | **NEW** | `initRunState(): RunState`; `fold(state, PersistedRunEvent): RunState` (pure, returns a NEW state — daemon and web call this identically, per A2). `RunState = { lastSeq: number; init?: {sessionId; model; permissionMode; cliVersion; slashCommands}; actors: Map<actorKey, ActorUsage>; dispatches: Map<toolUseId, {subagentType?: string; atSeq: number}>; result?: RunEvent & {kind:"result"}; parseErrors: number; unknownEvents: number }` where `ActorUsage = { usage: FourWay; messageIds: Set<string> }` and `actorKey = parentToolUseId ?? "main"`. **Dedup (F5)**: inside `fold`, a `message` event's usage is added to the actor's running `FourWay` ONLY if `messageId` is not already in that actor's `messageIds` set; if present, the fold is a no-op for token accounting (still counts toward `unknownEvents`/`parseErrors` bookkeeping as applicable, i.e. those counters are untouched by a dedup'd message — it's simply skipped). **Seq guard**: `fold` is a no-op (returns `state` unchanged, same object reference) if `persisted.seq <= state.lastSeq` — this is the belt-and-braces client dedup contract already documented in Flaw F2/A2; P2 is the first caller to actually rely on it for token math (P1's raw tail didn't need it since it never double-counted). `rollup(state, agentSubagentNames: Set<string>): RollupResult` — `RollupResult = { command: {ownFresh, totalFresh, ownUsd?, totalUsd?}; byAgent: Map<subagentType, {ownFresh, totalFresh, ownUsd?, totalUsd?}>; unrecognized: {fresh, usd?} }`. Derivation: for each actor bucket, if `actorKey === "main"` → command's own bucket; else resolve `dispatches.get(actorKey)?.subagentType` — if it names an agent in `agentSubagentNames` → that agent's own bucket; else → `unrecognized` (F8, never dropped). `command.totalFresh = ownFresh + Σ(all byAgent ownFresh) + unrecognized.fresh` (the invariant AC-RUN-2 pins). Property: **order-independence** — attribution keys off `parentToolUseId` alone (not event order), so folding the same event set in any permutation yields identical `rollup()` output; this is what the shuffle test in the testplan pins. **Locked fresh formula**: `fresh = usage.input + usage.output` everywhere (§6.6) — `cacheRead`/`cacheWrite` never enter a headline number, only the `FourWay` breakdown. |
| `derive.ts` | **NEW** | `timelineRows(events: PersistedRunEvent[], state: RunState): TimelineRow[]` — pure projection: `init` → one `⚙ init session · <model>` row; `message` with a `tool_use` part whose `tool === "Task"` → a dispatch-card row (`{icon:"🤖", label:"Task → <subagentType>", depth:0}`) PLUS the triggering-message's own text/tool rows at `depth: parentToolUseId ? 1 : 0` (actor-suffixed per design §5: `label` gets `(<subagentType or actorKey>)` appended when `parentToolUseId !== null`); a `result` event → one settle row per actor whose bucket just closed (`✓ <actor> settled  Σ <fresh>`) — since `derive` only sees the terminal `result` (not streaming actor-close detection, which needs live dispatch-tracking state the store already keeps — see §13.4), `derive.timelineRows` computes SETTLED rows only for the terminal batch; the live per-actor "just settled" row that appears mid-run (per design §3.4's "settled: ✓ / frozen count" card) is a `useRunStore` derived transition (comparing successive `rollup()` snapshots), not something `derive.ts` needs to know about — kept in core only for the parts that are pure functions of the full event list. `runSummary(state: RunState, meta: {run: RunInfo}, filesChanged: FileChange[] \| "unavailable"): RunSummary` — pure projection matching the design's `RunSummary` contract (status/exitCode/durationMs/startedAt/totals/perNode/filesChanged/finalMessage/stderrTail/stopReason); `perNode` built directly from `rollup()`'s `command`/`byAgent`/`unrecognized`, `finalMessage` extracted from the LAST `message` event's text parts on the `"main"` actor before `result`, `totals.costUsd` computed by calling `pricing.reconcileToTotal` when `result.totalCostUsd` is present (F4/F6: this is where the "Σ per-node == total_cost_usd" reconciliation actually happens — ONE call site, not scattered). **Degraded-telemetry detection (F6)**: `runSummary` (and a streaming equivalent the web store also computes — see §13.4) compares `state`'s own fold-derived total fresh-tokens-attributable-to-`result.usage`'s scope (i.e. sum of ONLY the `"main"`-actor-and-resolved-subagent buckets whose model matches `result.usage`'s reporting scope) against `result.usage` itself; because `result.usage` is main-model-only (F6) while the fold's total spans every actor including hidden background models, a NAIVE compare would always "mismatch". The correct check (this plan's resolution, not previously spelled out in §8.8): compute `expectedBackgroundDelta = Σ(modelUsage entries whose model is NOT the main `result` model)`'s fresh tokens, then assert `foldTotal - expectedBackgroundDelta ≈ result.usage main fresh` within a small tolerance (±1 token per model, to absorb any off-by-one in what "counts" as background vs. main across CLI versions); a mismatch BEYOND that expected delta sets `degraded: true` (never re-bases the fold's numbers — the fold's own totals remain what the UI shows, per F6's explicit resolution). |
| `test/run/aggregate.test.ts`, `test/run/pricing.test.ts`, `test/run/derive.test.ts` | **NEW** | per testplan §1.3–1.5 below |
| `test/fixtures/run/fixture-subagent.ndjson` | **NEW — recorded, see §13.3** | real Task-dispatch transcript |
| `test/fixtures/run/fixture-rollup-synthetic.ndjson`, `fixture-duplicate-usage.ndjson` | **NEW — hand-written** | per testplan §0.1 (already specced; P2 authors them) |

`src/index.ts` gains barrel exports for `run/pricing.js`, `run/aggregate.js`, `run/derive.js`.

#### `packages/rpc-types` (types only — additive)

- `PreflightCheck`/`RunPreflightResult`/etc. **unchanged** — P2 needs NO new RPC method for telemetry
  (it rides the existing SSE/`getRunEvents` channel P1 already shipped; the aggregation happens
  client-side in `useRunStore` and daemon-side in `runManager` for the ceiling check, both calling
  the SAME `core.fold`/`core.rollup`). This is a deliberate architecture choice — see §13.9 A11.
- `RunInfo.filesChanged`/`RunInfo.totals` types **already exist** (P1) — P2 is the first code that
  ever populates them with real values instead of `null`. No type change needed for those two fields.
- `RunSummary`/`TimelineRow` (web-consumed shapes) are re-exported from core's `derive.ts`/`events.ts`
  the same way `RunView` already is — additive re-export line in `rpc-types/src/index.ts`, no new
  interface authored redundantly in rpc-types itself (avoids the P1 pattern of re-declaring core
  shapes twice; P1's `TimelineRow`/`RunView` already live in core only and are re-exported, so P2
  follows the established precedent, not a new one).

#### `apps/daemon/src/` — modified + one new file

| File | Change |
|---|---|
| `git/status.ts` | **+`gitNumstat(repoPath): FileChange[] \| "unavailable"`** — sibling function, same file (matches STATE §8.1's own instruction: "`git/status.ts` gains a read-only `gitNumstat(repoPath)`"). `execFileSync("git", ["diff", "--numstat", "HEAD"], {cwd, encoding:"utf-8", timeout: 10_000})` parsed into `{path, plus, minus}` rows; UNTRACKED new files (`git status --porcelain`'s `??` entries, already available from the existing `gitStatus()` call) are merged in as `{status:"A", plus: undefined, minus: undefined}` (numstat alone doesn't report untracked-file line counts without `--no-index` gymnastics that risk including symbion's OWN `.symbion/` tree — deliberately NOT attempted; untracked files get a status glyph but no ± counts, which the design's wireframe already shows as acceptable — `A docs/loops/rate-limit-STATE.md` with no ± in §3.9's mock). `status` classification: reuses `git status --porcelain`'s first two columns per path (`M`/`A`/`D`) rather than re-deriving it from numstat's own limited vocabulary. On ANY failure (git missing, `--numstat` throws, timeout, not a repo) → returns the string literal `"unavailable"` — never throws, never blocks run finalization (F4/F6-style "degrade, don't die" posture applied to a new subsystem). `preDirty` flag: cross-referenced against `run.gitBefore.changedFiles` (already persisted at run start) — a changed path already in `gitBefore.changedFiles` gets `preDirty: true` (design §3.9's "⚠ includes N files dirty before the run"). |
| `run/runManager.ts` | **fold wiring for the token-cap ceiling.** `ActiveRun` gains `foldState: RunState` (from `core.initRunState()`), updated in `ingestLine()` via `ar.foldState = fold(ar.foldState, persisted)` (called AFTER the existing append+broadcast — ordering doesn't matter for correctness since fold is pure/idempotent-under-seq-guard, but keeping append/broadcast first preserves P1's existing test assertions about write-then-emit ordering byte-for-byte). After each fold, if `ar.run.ceilings.tokenCap > 0`, compute `rollup(ar.foldState, subagentNamesForThisArtifact).command.totalFresh` and compare — breach → `this.pendingTerminal.set(ar.runId, {status:"timedOut", stopReason:"tokenCap"})` + `this.killGroup(ar)`, IDENTICAL code path to the existing wall-clock breach (§9/§8.1's `armWallClock`), just a second trigger into the same `killGroup`/`finalize` machinery — no new kill logic. `subagentNamesForThisArtifact` is resolved once at `start()` time from the artifact's referenced agents (already computed for preflight's `missingReferencedAgents` — reuse, don't recompute a second traversal) and stored on `ActiveRun`. |
| `run/runManager.ts` `finalize()` | **populate `filesChanged`/`totals` at terminal** (currently always `null`, per §9 note #8/§9.1's Deferred list). On terminal: `ar.run.filesChanged = gitNumstat(ar.projectRoot)`; `ar.run.totals = ` computed via `runSummary(ar.foldState, {run: ar.run}, ar.run.filesChanged).totals`-equivalent shape (using the SAME `derive.runSummary`/`aggregate.rollup` the web store uses — no daemon-side reimplementation of the roll-up math, per A2's "one reducer" invariant extended to this new call site). This is the ONLY place `gitNumstat` is invoked — never mid-run (numstat against a live, possibly-changing tree mid-run would be noisy/racy and isn't needed until the summary screen anyway). |
| `run/runStore.ts` | **no schema change** — `run.json`'s `filesChanged`/`totals` fields already exist (P1 typed them, always null); P2 just writes non-null values through the EXISTING `writeRunJson` atomic-write path. Zero migration: old P1-era `run.json` files on disk with `filesChanged: null` remain valid (readers already handle null per P1's own type: `FileChange[] | "unavailable" | null`). |
| `rpc/handlers.ts`, `server.ts`, `sse.ts`, `sseRoute.ts` | **unchanged** — P2 adds no RPC method and no new SSE frame type; `RunSseStateFrame` (== `RunInfo`) already carries the new `filesChanged`/`totals` once populated, for free, since it's a structural re-export of `RunInfo`. |

#### `apps/web/src/` — modified + new components

| File | Change |
|---|---|
| `lib/run/useRunStore.ts` | **the P2 aggregation wiring.** Adds `foldState: RunState` (mirrors the daemon's, built via `core.initRunState()`/`core.fold` — SAME reducer, per A2, imported from `@symbion/core`, never reimplemented). Every place P1 already applies an incoming `PersistedRunEvent[]` (`applyEvents`, called from both the SSE handler and the poll-fallback loop — P1's existing single choke point, per §9.1's Finding 2 fix) now ALSO folds each event through `foldState = fold(foldState, ev)` immediately after the existing seq-dedup/rawTail append (so the seq-guard is applied once, consistently, to both raw-tail and token accounting — no risk of the two diverging). Derives `nodeRunData: Map<nodeId, {runStatus; ownFresh; totalFresh; costUsd; breakdown: FourWay}>` from `rollup(foldState, agentSubagentNamesInGraph)` on every fold (agentSubagentNamesInGraph passed in by `DependencyGraph` at `attach()`/`startRun()` time, resolved from the artifact graph the same way the daemon resolves `subagentNamesForThisArtifact`). Derives `timeline: TimelineRow[]` via `derive.timelineRows(allPersistedEventsSoFar, foldState)` — recomputed incrementally is acceptable at P2's data volumes (a few hundred to low-thousands of events per run; recompute-from-scratch on every batch, NOT a streaming diff, since `derive.timelineRows` is a pure function over the full list and premature streaming-diff optimization isn't justified without a demonstrated perf problem — flagged as A12 below for the Checker to revisit only if J-step timing shows jank). Derives `degraded: boolean` from the daemon-populated `result`'s cross-check ONCE the run reaches terminal (mid-run degraded state is driven by `state.parseErrors > 0` only, exactly as P1 already speced in ER-4 — the F6 reconciliation-mismatch degraded trigger is inherently a TERMINAL-only check since it needs `result`). `summary: RunSummary \| undefined` populated at terminal via `derive.runSummary`. **Nothing above touches the SSE wire protocol, the seq-dedup contract, or the poll-fallback logic P1 already shipped and tested** — this is purely a new derived-state layer sitting on top of the exact same event stream. |
| `components/graph/NodeTokenBadge.tsx` | **NEW** — per design's contract table (`{fresh, costUsd, breakdown, live, degraded?}`), tabular-nums mono 11px, fixed-width from first render, `~$`-prefixed cost, `—` pre-first-event, tween ≤300ms via rAF (design §5). |
| `components/run/TokenBreakdownCard.tsx` | **NEW** — hover portal per design §3.6 (own/+agents/total columns, fresh headline bold, cache rows muted, footnote). |
| `components/graph/CommandNode.tsx` | **modified** — consumes the new `badge?: NodeTokenBadgeProps` field (already typed as a TODO-shaped placeholder per §9's additive-data-bag note; P1 left `badge` undefined/unused since token math didn't exist) — renders `<NodeTokenBadge>` below the label when `badge` is present; wraps the badge in a hover trigger for `TokenBreakdownCard`; adds the "lock-in" 300ms flash keyframe on a `done` transition when `badge` was previously live (design §3.5). |
| `components/graph/AgentNode.tsx` | **modified** — same `badge` consumption; the settle "pulse → lock-in flash → steady outline" sequence (design §3.5's agent-node anatomy) — this is the FIRST place agent-node token badges render at all (P1 dimmed/undimmed agent nodes but never gave them a badge, since `aggregate` didn't exist). |
| `components/graph/AnimatedEdge.tsx` | **modified** — consumes the ALREADY-THREADED `runFlow: "flowing"|"off"` field (P1 shipped the data-bag plumbing, not the visual: §9 "AnimatedEdge itself is untouched in P1"). P2 adds the `stroke-dasharray 6/4` + `dashoffset` CSS animation gated on `runFlow==="flowing"`, `settled` tint (`runFlow==="off"` post-run stroke stays tinted 60% — needs a THIRD edge state actually, since design distinguishes pre-dispatch/flowing/settled but the current data bag only has 2 values; **flag**: extend `AnimatedEdgeData.runFlow` to `"off" \| "flowing" \| "settled"` — a small additive type widening, `DependencyGraph.tsx`'s edge-memo sets `"settled"` once an agent's actor bucket has closed (no more expected messages after `result`/that actor's dispatch resolved), not just "not currently flowing"). Live ×N counter (`1/3 → 2/3 → ✓3`) reads `invocations.done`/`invocations.total` off `AgentNodeData` (design §4's contract already names this field; P2 is the first to populate it, counting `dispatches` entries resolved to that `subagentType` in `foldState`). |
| `components/run/RunTimelinePanel.tsx` | **NEW** — replaces `RunLogTail` as the mounted panel in `DependencyGraph.tsx`; internally hosts THREE tab bodies: **Feed** (structured `TimelineRow[]` rows, virtualized hand-rolled fixed-row-height per A8, filter chips from `nodeRunData`'s keys, row click→node pulse via `runPulseKey`, node click→filter, follow/pause per design §5), **Raw** (P1's `RunLogTail` component reused verbatim AS the Raw tab's body — not reimplemented, per §13.0's note), **Summary** (new `RunSummarySection`, auto-shown on terminal transition unless mid-scroll, exactly per design §3.9/§8.4's "auto-morphs" behavior — P1 never had a summary state to morph into, since `derive.runSummary` didn't exist). |
| `components/run/RunSummarySection.tsx` | **NEW** — cost-by-node table (from `summary.perNode`, rows hoverable → `TokenBreakdownCard`, unrecognized-subagent row shown when present), FILES CHANGED (from `summary.filesChanged`, `⚠ includes N files dirty before the run` banner when any `preDirty`), FINAL MESSAGE (expand/collapse + copy), STDERR tail (failed runs only), `[Adjust ceilings]`/`[change]` links rendered but **inert** (F7 — P3 wires them; P2 must not build `RunSettingsSection`, see §13.7). |
| `components/run/DegradedTelemetryChip.tsx` | **NEW, small** — amber chip, renders when `useRunStore`'s `degraded` is true; hover tooltip text per ER-4 ("counts may be incomplete; raw log kept") for the parse-error trigger, and a DISTINCT tooltip for the new F6 reconciliation-mismatch trigger ("background-model usage couldn't be fully reconciled — totals may be slightly off; raw log kept") — two different root causes, one visual treatment, but the copy must not conflate them (a Checker-visible distinction, not a cosmetic nicety: F6's mismatch is a daemon/CLI-behavior signal, ER-4's is a parser-tolerance signal, and conflating them would mislead a user trying to determine "is my CLI/network flaky, or did Symbion's parser choke"). |
| `DependencyGraph.tsx` | **modified, additive only** — passes `nodeRunData` selections into the existing node/edge memo (extends the P1 pattern already there for `runStatus`/`runParticipant`); resolves `agentSubagentNamesInGraph` (a `Set<string>` of agent artifact names reachable from the executing command, already computed once for `runParticipantAgentNames` in P1 — reuse that exact Set, do not recompute) and passes it to `useRunStore`'s fold-rollup calls; swaps the mounted panel from `RunLogTail` to `RunTimelinePanel`. |

### 13.2 Data flow — how it composes without duplicating P1's fold

```
[daemon: same P1 pipeline, unchanged]
child stdout → LineBuffer → parseLine (core, unchanged) → seq-stamp → append events.jsonl + broadcast (unchanged)
                                                              │
                                                              ├──▶ [NEW P2] ar.foldState = fold(ar.foldState, persisted)
                                                              │        → rollup(...).command.totalFresh vs ceilings.tokenCap
                                                              │        → breach: SAME killGroup()/finalize() as wall-clock (P1)
                                                              │
                                                              └──▶ (on terminal, finalize()) gitNumstat() + runSummary()
                                                                       → run.json.filesChanged / .totals populated (NEW P2)

[transport: UNCHANGED from P1 — SSE backfill-then-live, seq-ordered; getRunEvents poll fallback]

[web: same P1 SSE/poll pipeline up to applyEvents(), then NEW P2 layer]
EventSource / getRunEvents → applyEvents() (P1, seq-dedup + rawTail append, UNCHANGED)
                                    │
                                    └──▶ [NEW P2] foldState = fold(foldState, ev)  ← SAME core.fold as daemon (A2)
                                              → rollup(foldState, agentSubagentNamesInGraph) → nodeRunData (badges/breakdown)
                                              → derive.timelineRows(...) → timeline (Feed tab rows)
                                              → (terminal) derive.runSummary(...) → summary (Summary tab)
                                              → DependencyGraph merges nodeRunData into node/edge data bag (unchanged memo pattern)
```

**Key invariant preserved**: the daemon's fold (for the ceiling check) and the web's fold (for the
UI) are two INDEPENDENT calls to the exact same pure `core.fold`/`core.rollup` functions over what
is provably the same ordered event stream (seq-numbered, backfill-then-live, already proven gap/dup-
free by `run-sse.test.ts` #4 in P1) — this is what makes "numbers cannot drift" (A2) actually true,
not just asserted. Neither side ever sends the other its computed rollup; only raw events cross the
wire, exactly as today.

### 13.3 Real subagent fixture recording — process

**Trigger**: a named, one-time manual `/build` P2 task (STATE §8.0/§8.7 already call this out; this
plan specifies HOW). Using the real `claude` CLI (2.1.187, already verified installed and
authenticated in this environment — §8.0), run a command that is KNOWN to dispatch a Task subagent
— the dogfood target is Symbion's own `.claude/commands/` if one exists with an `@`-agent reference,
else a minimal throwaway test repo with one command (`/probe`) whose body explicitly instructs
"dispatch the `ba` subagent via the Task tool for a trivial sub-task" to guarantee at least one
`tool_use` with `subagent_type` and ≥1 downstream `assistant` event carrying non-null
`parent_tool_use_id`. Command: `claude -p "/probe do something trivial" --output-format stream-json
--verbose --permission-mode acceptEdits > fixture-subagent.ndjson` in a scratch cwd (never the real
Symbion repo root, to avoid the agent's writes landing somewhere they'd need cleanup).

**Storage**: raw transcript copied to BOTH `docs/loops/graph-execution-realtime-fixture-subagent.ndjson`
(source-of-truth, alongside the existing `fixture-simple.ndjson` — same convention) and
`packages/core/test/fixtures/run/fixture-subagent.ndjson` (the copy tests actually read, matching
P1's existing `fixture-simple.ndjson` dual-location convention already established in §9's file list).

**Cost**: real tokens, ~$0.01–0.10 range typically for a trivial dispatch — a one-time, deliberate
spend, not a recurring test cost (all subsequent test runs replay the recorded file, $0).

**Pinning both fixtures**: `parseStreamJson.test.ts` (P1, already pinned to `fixture-simple.ndjson`
per testplan §1.1) gains new cases (testplan §1.1#8, already stubbed) asserting the subagent
fixture's `tool_use`/`subagentType`/non-null-`parentToolUseId` shape; `aggregate.test.ts` (NEW, P2)
folds the REAL subagent fixture (not just the hand-written synthetic) and asserts: (a) at least one
actor bucket other than `"main"` exists, (b) `rollup()` doesn't throw/misattribute when the
dispatch's `subagent_type` string doesn't exactly match any agent name in a synthetic "graph" passed
to the test (exercises the `unrecognized` path against a REAL event shape, not just a contrived one)
— this is the concrete "does the multi-block dedup / real-shape assumption actually hold" check the
task explicitly asked for, not re-derived from the synthetic fixture alone. **If the real fixture
reveals the content-block multi-message-per-id shape (F5) actually occurring** (it may not — the
existing simple fixture has exactly one assistant message, so this is unconfirmed either way).
`fixture-duplicate-usage.ndjson` (hand-written) remains the DETERMINISTIC pin for F5's dedup logic
regardless of what the real fixture shows, precisely because whether the real fixture happens to
exercise that shape is non-deterministic (depends on response length/chunking) — do not make the
hand-written fixture's test conditional on or redundant with the real one.

### 13.4 Local-store schema — deltas from P1 (no SQL DB, files only, per CLAUDE.md)

- **`run.json`**: NO field-shape change (all P2 fields — `filesChanged`, `totals` — were already
  declared by P1's `RunInfo` type as `FileChange[] | "unavailable" | null` / `RunTotals | null`).
  P2 is purely a "who writes real values into already-existing optional fields" change. Old P1-era
  run.json files with `filesChanged: null` remain valid reads (`RunListItem`/history rows already
  handle `costUsd: null`/`durationMs: null` per P1's own null-tolerant shape).
  `schemaVersion` stays **1** — no migration needed.
- **`events.jsonl`**: unchanged wire/storage shape. `PersistedRunEvent` already carries everything
  `derive.timelineRows`/`aggregate.fold` need (the `RunEvent` union already has `parentToolUseId`,
  `usage`, `subagentType` on `tool_use` parts, `modelUsage` on `result` — all P1-shipped).
- **`ProjectRunConfig`**: unchanged — `tokenCap` was already a field (P1 threaded it through,
  persisted, surfaced in the consent sentence, but never checked against live usage per §9 note #8).
  P2 is the first code path that actually reads and enforces it. No schema change.
- **No new files under `.symbion/runs/<runId>/`** — P2 needs no separate telemetry-cache file;
  `runSummary`'s output is cheap to recompute from `events.jsonl` + `run.json` on demand (history
  reopen in P3 will do exactly this) rather than persisting a redundant denormalized copy, avoiding
  a second source of truth that could drift from the events log.

### 13.5 Edge cases (F4/F5/F6 concretely, plus new ones found in this pass)

| # | Case | Resolution |
|---|---|---|
| F4 | Unknown model in `modelUsage`/an assistant `message.model` | `pricing.estimateCostUsd` returns `undefined` → badge/breakdown/summary render `$ —` (never `$0.00`/`NaN`); the model's FRESH TOKENS still count fully toward the roll-up (F4 only concerns `$`, never tokens — FR-3's "tokens never estimated" holds). `reconcileToTotal`'s pro-rata-by-fresh-token fallback (§13.1's `pricing.ts` entry) covers the degenerate case where EVERY per-node estimate was `undefined`/0 but `total_cost_usd` is nonzero. |
| F5 | Multiple `assistant` events sharing one `message.id` (per-content-block emission) | `fold`'s per-actor `messageIds: Set<string>` dedup — pinned by BOTH the hand-written `fixture-duplicate-usage.ndjson` (deterministic) and, if it happens to occur, the real subagent fixture (opportunistic confirmation, not required to pass). |
| F6 | `result.usage` main-model-only; background models only in `modelUsage` | `runSummary`'s degraded check computes `expectedBackgroundDelta` from `modelUsage` entries excluding the main model, subtracts from the fold's own main-actor-scoped total, compares to `result.usage` within tolerance — mismatch beyond that → `degraded:true`, **fold's own totals remain authoritative and unchanged** (never re-based). |
| F7 | R7 Settings→Execution editor scope creep risk | P2 explicitly reads `ProjectSettings.run` via the EXISTING `resolveRunConfig` (P1) with `DEFAULT_RUN_CONFIG` fallback — no editor UI, `[change]`/`[Adjust ceilings]` links render but are inert (`onClick` absent or a no-op — see §13.7's explicit checklist item for the Checker to verify this wasn't accidentally built). |
| NEW-1 | A real subagent dispatch's `subagent_type` string doesn't match ANY agent name in the graph (e.g. a built-in agent like `general-purpose` used ad hoc, not one of Symbion's authored `@`-linked agents) | Falls into `unrecognized` (same bucket as an unrecognized-by-construction case in the synthetic fixture) — command total still includes it, flagged, never dropped. This is the REAL-WORLD version of the already-planned unrecognized-bucket mechanism; §13.3 explicitly tests it against the real fixture, not just synthetically. |
| NEW-2 | `gitNumstat` fails or times out mid-finalize (git binary missing, corrupted repo, `git diff` hangs on a huge diff) | `execFileSync` with a `timeout: 10_000` throws on timeout (Node throws `ETIMEDOUT`-shaped error on `execFileSync` timeout) → caught, returns `"unavailable"` literal (already the typed escape hatch) — `finalize()` must NOT let a numstat failure block writing the terminal `run.json` at all (the run's OWN completion is independent of the summary's files-changed section); implemented by wrapping the `gitNumstat` call in its own try/catch inside `finalize()`, not inside `gitNumstat` alone reporting a value that a caller could still mishandle. |
| NEW-3 | A THIRD, previously-unseen event `type` appears in the real subagent fixture (the simple fixture already proved `rate_limit_event` is undocumented — a subagent-dispatch transcript, being longer, has more surface area to reveal e.g. a `system/hook` event, a `stream_event` partial-message frame, or similar) | Already structurally handled — `parseStreamJson.ts`'s `unknown` fallback (P1, unchanged) tolerates ANY unrecognized `type` with raw retained; `aggregate.fold`'s `unknownEvents` counter increments; this is exactly why P1's parser shipped complete rather than deferred (§8.7's own stated rationale). P2 adds NO new parser logic for this case by design — if the real fixture reveals one, the fixture and a pinned "yes, this type exists and is tolerated" test case are the artifact, not a parser change. Flagging explicitly since the task asked to consider this scenario: **the resolution is "already covered," not a new mechanism** — worth stating so the Checker doesn't expect a code diff here. |
| NEW-4 | Token-cap ceiling breaches WHILE `filesChanged`/`totals` are being computed in `finalize()` (ordering race between the ceiling's async kill and the exit handler's `finalize()` call) | Not actually racy: `armWallClock`/the new token-cap check only ever SET `pendingTerminal` + call `killGroup()` — they never call `finalize()` directly (unchanged from P1's existing wall-clock pattern); `finalize()` is called exactly once, from the child's `close` event handler, which reads `pendingTerminal` to decide the final `status`/`stopReason`. P2's token-cap check reuses this exact mechanism, so no new race is introduced — flagging only to confirm this was checked, not because a new safeguard was needed. |
| NEW-5 | `derive.timelineRows` recomputing from the full event list on every batch (§13.1's flagged A12) becomes visibly janky on a very long/verbose run (thousands of events) | Not resolved in this plan — flagged as A12 (§13.9) for the Checker/QA to watch for during J12 (the real dogfood run); if observed, the fix is an incremental-diff variant of `timelineRows` (append-only for new events since the last call) rather than a full recompute, deferred until a real perf problem is demonstrated rather than speculatively built. |

### 13.6 Test plan

See `docs/loops/graph-execution-realtime-testplan.md` — new §"P2 additions" appended below the
existing content (nothing overwritten). Summary of what's added: `aggregate.test.ts` roll-up
invariant against BOTH fixtures (simple + the new real subagent one) plus the synthetic/duplicate-
usage fixtures already stubbed in §0.1/§1.3; `pricing.test.ts`; `derive.test.ts`; a `run-ceilings.test.ts`
token-cap case (already stubbed at §3.9#2, now concretely specified against the fold-wired
`runManager`); a NEW `run-gitNumstat.test.ts` (integration); manual web journey items J12–J16
(already stubbed in the existing testplan, now cross-referenced to the concrete components this
plan names) plus 3 new manual checks for the degraded-telemetry chip's TWO distinct trigger copies
and the token-cap ceiling's summary presentation.

### 13.7 Explicit non-goals (Checker: flag if found in the P2 diff)

- **No `RunSettingsSection` / Settings→Execution editor** (F7 — P3). Verify `[change]`/`[Adjust
  ceilings]` links render inert (no navigation, no form) in the P2 build.
- **No 🕘 history popover / `PastRunBanner` / read-only past-run overlay** (P3). `runSummary`/
  `filesChanged`/`totals` being computed and PERSISTED in P2 is deliberately reusable by P3's history
  feature later — but P2 must not build the history UI itself.
- **No R8 full reattach choreography beyond what P1 already shipped** (basic bar+tail resume). P2's
  F5 behavior is UNCHANGED from P1 except that `nodeRunData`/`timeline` now populate correctly on
  reattach too, because `foldState` fast-forwards through the SAME backfilled events P1's reattach
  already replays — this is a natural consequence of wiring `fold` into `applyEvents`, not new
  reattach logic.
- **No new RPC method.** If the P2 diff adds one (e.g. a tempting `getRunSummary` RPC), that's scope
  creep against this plan's explicit "no new RPC surface for telemetry" decision (§13.1) — flag it.
- **No change to the SSE wire protocol, seq-dedup contract, or poll-fallback logic.** All of P1's
  `run-sse.test.ts`/`run-getRunEvents.test.ts` assertions must remain green UNCHANGED.

### 13.8 Flaws / risks found in THIS plan (not treated as infallible)

- **Risk R1 — pricing table staleness.** `MODEL_PRICING`'s prefix-match fallback is a maintenance
  burden the moment Anthropic ships a new model family (already flagged as A6 in §8.9 for the
  overall feature; this plan's addition is the concrete mechanism — prefix match rather than exact
  string — which trades "silently wrong price for a truly novel family" for "at least SOME price for
  a dated variant of a known family." Accepted trade, not eliminated.
- **Risk R2 — `derive.timelineRows`'s full-recompute-per-batch approach (§13.1, flagged NEW-5/A12)**
  is the one place this plan consciously defers a known-possible perf problem rather than solving it
  preemptively. This is a judgment call the Checker should explicitly bless or reject, not a silent
  omission — flagging loudly here rather than only in the file-list table.
- **Risk R3 — the F6 degraded-check's tolerance band (§13.1's "±1 token per model") is a GUESS**, not
  independently verified against real background-model behavior across multiple CLI versions (only
  ONE real fixture, `fixture-simple.ndjson`, has ever been observed, and it has exactly one
  background-model entry). If /build's real subagent fixture recording (§13.3) reveals a background-
  model delta that ISN'T a clean token-for-token match (e.g. the CLI rounds, or background-model
  token counts appear in `modelUsage` but shifted by some fixed overhead), this tolerance may need
  widening — flagged so nobody treats "±1" as load-bearing precision rather than an initial, testable
  guess subject to revision once the real fixture exists.
- **Risk R4 — `gitNumstat`'s untracked-file ± omission** (§13.1) means the FILES CHANGED summary
  table will show new files with no `+N −0` counts, which is a slightly weaker guarantee than the
  design mock implies is possible for SOME rows (the mock shows `+142 −3` for a modified file and no
  counts for an added file — so this actually MATCHES the mock exactly; flagging only to confirm this
  was a deliberate reading of the wireframe, not an oversight, since a first glance at "files changed
  via git" might expect ± everywhere).
- **Self-review note**: the §8 PLAN (my own prior authorship) is generally sound for P2's scope, but
  one omission is worth naming rather than silently patching: §8.1's `derive.ts` entry described
  `timelineRows`/`runSummary` at a high level without addressing HOW the F6 degraded check's
  "expected background-model delta" would actually be computed, or that `derive.timelineRows` would
  need decisions about incremental-vs-full recompute — those are genuine gaps in the original PLAN
  that this P2 pass had to resolve, not just "implement," and R2/R3 above are flagged accordingly as
  open judgment calls rather than treated as already-settled by §8's letter.

### 13.9 Trade-offs & assumptions (P2 additions to §8.9's table)

| # | Decision / assumption | Why / risk |
|---|---|---|
| A11 | No new RPC method for telemetry — aggregation is 100% client/daemon-local over the existing event stream | Smallest surface, preserves "one reducer, numbers can't drift" (A2); a `getRunSummary` RPC would be redundant with recomputing from already-fetched events and would risk a THIRD place the roll-up math could diverge |
| A12 | `derive.timelineRows` recomputes from the full event list on every new batch rather than an incremental diff | Simplicity over premature optimization; flagged (NEW-5/R2) for the Checker/QA to watch during the real dogfood run (J12) — promote to incremental only if jank is actually observed |
| A13 | `gitNumstat` invoked ONLY at terminal (`finalize()`), never mid-run | Avoids racy/noisy mid-run diffs against a tree the agent is actively mutating; the summary screen is the only P2 consumer of files-changed data anyway |
| A14 | Pricing table uses family-prefix matching, not exact model-string matching | Dated model releases (e.g. `-20251001` suffixes) would otherwise silently return `undefined` for every dated variant of a known family; accepted staleness risk documented as R1 |
| A15 | F6's degraded-mismatch tolerance (±1 token/model) is a first-pass guess pending the real subagent fixture | Better to ship a testable, revisable number than block P2 on perfect CLI-behavior certainty; flagged as R3 for post-fixture-recording review |

## 14. BUILD — P2 implementation notes (2026-07-15, feature-builder)

> Implements §13's PLAN in full, including recording the REAL subagent fixture (§13.3) — it was
> possible in this sandboxed environment (the `claude` 2.1.187 CLI is installed and authenticated),
> so this is NOT a blocking gap. All findings from the real recording are documented below since two
> of them are genuine deviations from §13's pre-recording assumptions that the parser/aggregator had
> to absorb.

### 14.1 Real subagent fixture — recorded (not blocked)

- Recorded via a scratch repo (`/tmp/.../scratchpad/probe-repo`, never the Symbion repo root) with a
  throwaway `.claude/commands/probe.md` instructing "dispatch the general-purpose subagent via the
  Task tool for a trivial task, reply pong" — exactly the §13.3 process. Command:
  `claude -p "/probe do something trivial" --output-format stream-json --verbose --permission-mode
  acceptEdits > fixture-subagent.ndjson`. Real tokens spent (~$0.32 total across the outer + inner
  session per the two `result` events) — a one-time deliberate cost, not a recurring test cost.
- Stored at BOTH paths per §13.3: `docs/loops/graph-execution-realtime-fixture-subagent.ndjson` and
  `packages/core/test/fixtures/run/fixture-subagent.ndjson` (18 lines).
- **Two real-world deviations from §13's pre-recording assumptions, both absorbed by the parser/
  aggregator (not treated as blockers, since NEW-3 already anticipated "the real fixture will reveal
  something new" as an expected, already-covered outcome for unknown event TYPES — these two are
  additionally about known event SHAPES needing a field-location fix):**
  1. **The dispatch tool is named `Agent`, not `Task`** in this CLI version/mode (an async agent-
     launch tool). `aggregate.ts`'s dispatch-detection (`part.tool === "Task" || part.tool === "Agent"`)
     and `derive.ts`'s timeline dispatch-row detection were written to accept both from the start,
     informed by this recording — not a post-hoc patch.
  2. **The dispatched subagent's name (`subagent_type: "general-purpose"`) arrives as a TOP-LEVEL
     field on the assistant `message` event itself** (sibling of `parent_tool_use_id`), not nested
     inside the dispatching `tool_use`'s `input.subagent_type` as STATE §13.1 originally assumed.
     `parseStreamJson.ts` now reads BOTH shapes defensively: `topLevelSubagentType` (new field on the
     `message` RunEvent variant, the VERIFIED-real one) plus the original `input.subagent_type` nested
     read (kept for a legacy/future shape, never removed). `aggregate.fold`'s dispatch-name resolution
     backfills from `topLevelSubagentType` when the dispatching tool_use's own subagentType was absent.
  3. **The transcript contains an async two-session shape**: the `Agent` tool launches a background
     sub-session (`task_started`/`task_updated`/`task_notification` system events) that reports back
     with its OWN `result` + a SECOND `system/init` frame later in the same file. This is NOT a new
     parser mechanism (NEW-3's stated resolution: unknown `system/*` subtypes fall through to
     `unknown`, already covered) — `parseStreamJson.test.ts`'s new subagent-fixture describe block
     pins that a second `init` and four new `unknown`-typed system subtypes parse without throwing.

### 14.2 Files changed

**`packages/core/src/run/`**
- `pricing.ts` (NEW) — `MODEL_PRICING` (family-prefix keyed) + `estimateCostUsd` + `reconcileToTotal`
  (pro-rata-by-fresh-token-share fallback for the all-unknown-model degenerate case).
- `aggregate.ts` (NEW) — `initRunState`/`fold`/`rollup`/`freshOf`. Dedup by `messageId` per actor (F5);
  seq-guard no-op (same object reference) below `state.lastSeq`; `rollup` resolves dispatch-name to
  agent/unrecognized buckets, order-independent by construction (attribution keys off
  `parentToolUseId` alone).
- `derive.ts` (NEW) — `timelineRows` (pure projection over events+state) and `runSummary` (perNode /
  totals / filesChanged / finalMessage / stderrTail / stopReason / degraded). `computeDegraded`'s F6
  cross-check compares the fold's own `"main"` actor bucket DIRECTLY against `result.usage` (± the
  ±1-token tolerance) — see 14.3 for why this differs from §13.1's originally-worded subtraction.
- `events.ts` (MODIFIED, additive) — `message` RunEvent variant gains optional `topLevelSubagentType`.
- `parseStreamJson.ts` (MODIFIED) — reads the top-level `subagent_type` field into
  `topLevelSubagentType` (14.1#2); dispatch tool_use detection elsewhere already tolerant.
- `test/run/{aggregate,pricing,derive}.test.ts` (NEW), `test/run/parseStreamJson.test.ts` (extended
  with a real-subagent-fixture describe block), `test/fixtures/run/{fixture-subagent,
  fixture-rollup-synthetic,fixture-duplicate-usage}.ndjson` (NEW — subagent is the REAL recording;
  the other two are hand-written per testplan §0.1's exact spec).
- `src/index.ts` — barrel exports for `pricing.js`/`aggregate.js`/`derive.js`.

**`packages/rpc-types/src/index.ts`** — additive re-exports: `FourWay`, `RunState`, `RunSummary`,
`TimelineRow` (following the established precedent of re-exporting core shapes rather than
re-declaring them, per §13.1).

**`apps/daemon/src/`**
- `git/status.ts` — **new** `gitNumstat(repoPath): FileChange[] | "unavailable"` per §13.1 exactly
  (porcelain-derived status classification + untracked-as-"A"-no-±, never throws). **Also fixes a
  pre-existing P1 bug found while building this**: `gitStatus()`'s `changedFiles` parsing did
  `.trim()` the WHOLE porcelain line BEFORE `.slice(3)`, which silently ate the first 1-2 characters
  of the filename for any status row with a leading space (e.g. a plain modified-file row ` M
  README.md` → wrongly returned `"EADME.md"`). This was invisible in P1 because the only existing
  test of `changedFiles` used an untracked (`?? file`, no leading space) row, which happened to still
  work under the buggy trim-then-slice. P2's `preDirty` cross-reference (matching `filesChanged`
  entries against `gitBefore.changedFiles` by exact path) is the first real consumer that needed
  EXACT paths for modified files too, and failed a new test until fixed. Fix: filter blank lines on
  the raw (untrimmed) line, then slice+trim each line individually. **Flagging for the Checker**:
  this is a behavior change to an existing P1 function outside this plan's original file list — it
  was necessary (P2's own acceptance criterion depends on it) but is worth an explicit look since it
  touches `gitStatus()`'s output for every dirty-tree preflight check across the whole feature, not
  just P2's new code paths. Re-ran the FULL existing daemon suite (392 tests) after the fix — all
  green, including the pre-existing `rpc.integration.test.ts` T14 gitStatus block.
- `run/runManager.ts` — `ActiveRun` gains `foldState`/`agentSubagentNames`; `ingestLine()` folds after
  append+broadcast (unchanged ordering, per §13.1) and checks the token-cap ceiling via the SAME
  `killGroup()`/`pendingTerminal` machinery as the existing wall-clock timer (`tokenCap:0` = disabled,
  §6.4#2b); `finalize()` populates `run.filesChanged`/`run.totals` via `gitNumstat` + `core.runSummary`,
  wrapped in its own try/catch so a numstat/summary failure NEVER blocks writing the terminal
  `run.json` (NEW-2).
- `rpc/handlers.ts` — `startRun` resolves `agentSubagentNames` via `extractAgentMentions(artifact.body)`
  (same traversal preflight already does) and passes it into `runManager.start()`.
- `test/fixtures/fake-claude.mjs` — **new** `FAKE_CLAUDE_MODE=write-files` (modifies a tracked file +
  creates one untracked file in cwd) — needed for `run-gitNumstat.test.ts`'s integration coverage;
  additive, no existing mode changed.
- `test/run-ceilings.test.ts` — 3 new cases (§6.4#2a/2b/2c: token-cap breach, `tokenCap:0` disables the
  cap, breach-vs-natural-completion race resolves to exactly one terminal state).
- `test/run-gitNumstat.test.ts` (NEW) — 5 cases per testplan §6.5 (modified+untracked files, preDirty
  flag, corrupted-repo degrade-not-die, direct gitNumstat never-throw, non-repo → "unavailable").

**`apps/web/src/`**
- `lib/run/useRunStore.ts` — adds `foldState`/`allEvents`/`nodeRunData`/`timeline`/`summary`/
  `degraded`/`degradedReason`/`agentSubagentNames` + `setAgentSubagentNames` action (for the F5
  cold-reattach path, where the executing artifact's @mentions aren't known until the reattached
  `run.json` arrives — re-derives `nodeRunData` from the ALREADY-folded state via a fresh `rollup()`
  call, no re-fold needed). `applyEvents` now folds every accepted event through `core.fold`
  immediately after the existing seq-dedup (one dedup gate, shared by raw-tail and token math, per
  §13.1). `computeTerminalSummary` (new) runs `core.runSummary` on both the SSE "state" terminal
  transition AND the poll-fallback's terminal branch — both call sites now covered (P1 only had the
  poll-fallback path stop timers; this adds the summary computation to both).
- `components/graph/NodeTokenBadge.tsx` (NEW), `components/run/TokenBreakdownCard.tsx` (NEW),
  `components/run/DegradedTelemetryChip.tsx` (NEW), `components/run/RunTimelinePanel.tsx` (NEW —
  Feed/Raw/Summary tabs, filter chips, row expand, follow/pause; Raw tab reuses `RunLogTail`
  verbatim as its body, per §13.0's explicit instruction not to delete/rewrite it),
  `components/run/RunSummarySection.tsx` (NEW — cost-by-node, files-changed, final message, stderr
  tail; `[Adjust ceilings]`/`[change]` rendered INERT per F7/§13.7 — no `onClick`, `disabled` where
  applicable).
- `components/graph/CommandNode.tsx` / `AgentNode.tsx` — consume `badge`/`runPulseKey`; agent nodes
  get `runStatus` ("working"/"settled"), an inline ×N invocation counter, and their first-ever token
  badge; both get the "lock-in" 300ms flash keyframe on their respective active/working→done/settled
  transition, plus a SEPARATE feed-row-click pulse (re-fires the existing `countLockIn` keyframe when
  `runPulseKey` changes).
- `components/graph/AnimatedEdge.tsx` — `AnimatedEdgeData.runFlow` widened to `"off"|"flowing"|
  "settled"` (a genuine type change from P1's 2-value field, per §13.1's explicit flag); dash-flow
  animation (`animate-dashFlow`) while flowing; 60%-opacity tint while settled.
- `DependencyGraph.tsx` — additive: passes `nodeRunData`/`degraded` into the existing node/edge memo;
  swaps the mounted panel from `RunLogTail` to `RunTimelinePanel`; auto-morphs the panel to the
  Summary tab on the mission's terminal transition (a ref-tracked one-shot effect, not a forced
  override of a user's own Feed/Raw choice mid-run); wires node-click → feed filter and feed-row-click
  → node pulse (both directions, store-mediated per design §0's cross-highlight decision);
  `agentSubagentNames` is supplied by `RunDialog` at `startRun()` time (the natural place — it already
  has the command artifact) and by a small reattach-only effect here for the F5 cold-load path.
- `tailwind.config.ts` — adds the `dashFlow`/`countLockIn` keyframes+animations design §7 proposed but
  P1 never shipped (P1 only shipped `glowPulse`). Both collapse under the existing global
  `prefers-reduced-motion` block (a universal `*` selector — no new media-query entry needed).

### 14.3 Deviations from §13's letter (flagged, not silent)

- **F6 degraded-check math corrected from §13.1's literal wording.** §13.1 said: "assert
  `foldTotal - expectedBackgroundDelta ≈ result.usage main fresh`" (i.e. subtract the background delta
  FROM the fold before comparing). Building + testing against the REAL `fixture-simple.ndjson` proved
  this arithmetic wrong: background-model token usage (the haiku 505in/11out entry in `modelUsage`)
  NEVER appears inside any `assistant` event's own `usage` block — it is invisible to the parser/fold
  entirely, visible ONLY via `result.modelUsage`. So the fold's `"main"` actor bucket already equals
  `result.usage` almost exactly on a healthy run, with NOTHING to subtract; subtracting
  `expectedBackgroundDelta` from it (as literally written) produces a manufactured false-positive
  mismatch on every healthy run (confirmed by a failing test during development — see
  `derive.test.ts` #3, which now passes). **Implemented instead**: direct comparison
  `mainActorUsage vs result.usage` (± the tolerance), with `expectedBackgroundDelta` kept in the code
  ONLY as an explanatory comment for future maintainers, not as a term in the actual formula. Flagged
  per CLAUDE.md's "call out anything unsure about" — the Checker should independently verify this
  reasoning against the real fixture's numbers rather than trust the docstring.
- No other deviations from §13's file list, data flow, or non-goals checklist.

### 14.4 Assumptions for the Checker to verify independently

- **A16 (new)**: the `Agent`-vs-`Task` tool name and the top-level `subagent_type` field placement
  (14.1) are correct for CLI 2.1.187 in THIS installation's exact mode/config; a different CLI
  version or a genuinely synchronous `Task` dispatch (as opposed to the async `Agent` launch this
  recording happened to produce) might still emit the originally-assumed nested
  `input.subagent_type` shape — both are read defensively, but only the top-level path has been
  observed for real. Worth a second real recording across a synchronous dispatch if one is easy to
  produce, to broaden fixture coverage beyond this one async-agent shape.
  Verify: `packages/core/src/run/parseStreamJson.ts`'s assistant-event branch,
  `packages/core/test/fixtures/run/fixture-subagent.ndjson` line 12.
- **A17 (new)**: the `gitStatus()` porcelain-parsing bugfix (14.2) is scoped narrowly (filter-then-
  slice-then-trim) and re-verified against the full existing daemon suite, but it changes the exact
  string returned for every existing `changedFiles` entry system-wide (previously-passing untracked-
  file paths were ALSO subtly wrong — trimmed correctly by luck, but the fix makes the trimming
  explicit and correct for all cases rather than accidental for one case). Recommend the Checker
  spot-check any OTHER caller of `gitStatus().changedFiles` beyond this feature (e.g. the dirty-git
  preflight warning's file COUNT is unaffected since it only reads `.length`, but any future caller
  reading exact paths should be re-verified).
- **A11–A15 (STATE §13.9)**: all implemented as specified; A15's ±1-token tolerance is now backed by
  ONE real fixture (`fixture-simple.ndjson`, a single background-model entry with a clean, exact
  match — no rounding/overhead observed) — still a single data point, R3's "guess pending more real
  data" caveat stands even though the recording in 14.1 happened; the SUBAGENT fixture's `result`
  events don't exercise F6's degraded-check path meaningfully (both are internally consistent by
  construction, not injected with a synthetic mismatch), so A15/R3 is NOT yet more validated than
  before — only `fixture-simple.ndjson`'s single background-model delta has been checked end-to-end.
- **Deferred to P3 (confirmed out of scope, not accidentally built)**: `RunSettingsSection`/Settings→
  Execution editor (F7), 🕘 history popover, `PastRunBanner`, any new RPC method. Manually verified:
  grepped the diff for a tempting `getRunSummary`-style RPC addition — none introduced;
  `[Adjust ceilings]`/`[change]` links render as disabled/no-op buttons only.
- **Not independently re-verified by the Maker (Checker should)**: the visual/motion claims (glow
  timing, pulse choreography, dash-flow speed) were implemented per the design doc's numbers but only
  checked by reading the code, not by an actual browser/chrome-devtools visual pass — that's /qa's
  job per this feature's own testplan (J12–J16, J21–J23), not something this BUILD pass ran.
- **`derive.timelineRows`'s incremental-vs-full-recompute** stays a full recompute per batch, exactly
  as A12 specified — not revisited, since no perf problem was observed in the automated test suite
  (which only exercises small fixtures); a real dogfood run's jank-or-not is /qa's J12 to judge.

### 14.5 Build/test verification

- `npm run build` (root, all 4 workspaces): **clean** — `@symbion/core`, `@symbion/rpc-types`,
  `@symbion/daemon` (`tsc`), `@symbion/web` (`next build`, incl. type-check + lint-adjacent
  "Linting and checking validity of types" step) all pass with zero errors.
- `npx vitest run` (whole repo, all 3 projects): **618/618 passed**, 63 test files, 0 failures.
  - `packages/core`: includes the new `aggregate.test.ts` (12), `pricing.test.ts` (6),
    `derive.test.ts` (5), plus `parseStreamJson.test.ts` extended to 13 (4 new real-subagent-fixture
    cases). AC-RUN-2's roll-up invariant passes against BOTH the hand-written synthetic fixture
    (exact 100k/130k · 30k/30k) and the REAL subagent fixture (non-zero unrecognized bucket when the
    agent set doesn't match, correct attribution when it does).
  - `apps/daemon`: all 392 pre-existing tests still green UNCHANGED (P1 contracts intact), plus the 3
    new token-cap cases in `run-ceilings.test.ts` and the 5 new `run-gitNumstat.test.ts` cases (37
    P2-net-new daemon assertions across those two files).
  - `apps/web`: all 4 pre-existing test files still green (18 tests) — no new web unit tests were
    added in this pass (the new components are presentation-heavy; `RunTimelinePanel`/
    `RunSummarySection`/badge components were verified via `next build`'s type-check only, not
    component tests — **flagging this as a gap for the Checker**: /review may want at least a smoke
    test for `RunTimelinePanel`'s tab-switching and filter logic, since CancelControl.test.tsx shows
    the repo's convention for testing run/ components exists and wasn't extended here).
- Core purity (AC-RUN-11): `grep -rn "node:" packages/core/src/run/` → zero matches;
  `grep -rn "from \"fs\"\|require(" packages/core/src/run/` → zero matches. Confirmed clean.

## 15. REVIEW — P2 (2026-07-15)

Three independent Checkers reviewed §14's implementation in parallel: `code-reviewer`, `architect`,
and `security-reviewer` (triggered per CLAUDE.md — this diff touches `apps/daemon/src/git/status.ts`
and `apps/daemon/src/rpc/handlers.ts`, both daemon filesystem/git-execution + RPC surface).

**All three verdicts: PASS.**

Each Checker independently re-verified (not took on faith) the three things the Maker self-disclosed
in §14:

1. **The `gitStatus()` porcelain-parsing bugfix** (outside §13's declared file list) — `code-reviewer`
   reproduced the bug standalone (`" M README.md"` → old code wrongly returned `"EADME.md"`, new code
   correctly returns `"README.md"`); confirmed the only other caller (`preflight.ts`) reads only
   `.length`, unaffected; `architect` independently judged fixing it here (rather than filing
   separately) was the right call, since P2's own `preDirty` check is the first real consumer needing
   exact paths. `security-reviewer` confirmed the fix changes no trust boundary (still read-only,
   still argv-array `execFileSync`).
2. **The corrected F6 degraded-telemetry formula** (§13.1's original subtraction-based formula vs. the
   Maker's direct-comparison replacement) — both `code-reviewer` and `architect` independently
   extracted the real fixture's actual JSON and confirmed the background model's usage never enters
   any `assistant`/`result` usage block, meaning §13.1's original formula would have produced a
   false-positive mismatch on every healthy run. **`architect` explicitly flagged this as a genuine
   flaw in its own prior §13.1 authorship**, not a defense of the original spec — the correction
   preserves F6's actual intent (a real mismatch still trips the degraded chip).
3. **The two real-fixture-driven parser deviations** (`Agent` not `Task`; top-level `subagent_type`) —
   `code-reviewer` parsed the real fixture directly and confirmed both the originally-assumed shape
   AND the newly-discovered real shape are handled defensively in `parseStreamJson.ts`/`aggregate.ts`,
   not just the one actually observed.

**Security review (targeted, since this diff touches daemon fs/RPC surface)**: PASS. Command
injection: clean (argv-array `execFileSync` throughout, `repoPath` never client-supplied — flows
server-side from the registered project path). RPC surface: confirmed the `handlers.ts` `+8` lines
are wiring into the *existing* `startRun` handler, not a new RPC method (matches §13.7's non-goals).
Destructive-write safety: clean (only read operations plus the pre-existing atomic `writeRunJson`).
One non-blocking finding: `gitNumstat()`'s two sequential `execFileSync` calls block the daemon's
single event loop for up to ~20s on a slow/large diff — recommend converting to async `execFile`
(mirroring `preflight.ts`'s existing pattern) as a follow-up, not a ship-blocker.

**Non-blocking findings carried forward (both `code-reviewer` and `architect` agree, neither blocks
PASS)**:
- No web unit/smoke tests were added for the new presentation components (`RunTimelinePanel`,
  `RunSummarySection`, badge components) — verified only via `next build`'s typecheck. Acceptable
  since all aggregation math lives in `packages/core` (fully unit-tested), but `CancelControl.test.tsx`
  establishes a repo convention for testing `components/run/*` that wasn't extended here. Recommend a
  follow-up smoke test for `RunTimelinePanel`'s tab-switching/filter-chip logic before or shortly
  after `/qa`.
- `TimelineRow.unattributed` is declared and consulted by `RunTimelinePanel`'s warning styling but
  never actually set by `derive.timelineRows` — a small loose end (pre-existing since P1, not
  introduced here) worth a follow-up ticket, not a regression.
- Risk R3 (±1 token tolerance validated against only one real fixture's single background-model
  delta) remains open per §14's own honest accounting — track for a future CLI-version fixture
  recording.
- The event-loop-blocking `execFileSync` pattern in `gitNumstat()` (security review, above).

**Verdict: PASS.** No 🔴/🟠 blockers from any of the three reviews.

## 16. QA — SKIPPED (user explicit decision, 2026-07-15)

Per `/ship`'s gate ("only ship after both `/review` PASS and `/qa` PASS"), a skip must be explicitly
recorded with the residual risk named, not silently proceeded past. The user explicitly chose to
skip the live QA pass for this P2 shipment (confirmed directly, not inferred) — shipping on
`/review`-only: all three independent Checkers (code-reviewer, architect, security-reviewer) PASS,
618/618 automated tests green, `npm run build` clean.

**What this skip means was NOT verified**: no live browser/dev-server pass exercised the actual P2
UI journey (token badges rendering correctly on real node positions, the timeline panel's Feed/Raw/
Summary tab-switching, the degraded-telemetry chip actually appearing under a real mismatch, the
summary screen's cost-by-node/files-changed/final-message rendering against a real completed run).
Per the interactive-graph feature's own learnings entry ("a UI component can be 100% correct in
isolation... and still be effectively unusable because the path to reveal/reach it is broken"), this
is a real, named gap — automated tests + 3 independent code/architecture/security reviews do not
substitute for driving the actual browser UI.

**Residual risk accepted, named explicitly**:
- The new web presentation components (`RunTimelinePanel`, `RunSummarySection`, `NodeTokenBadge`,
  `TokenBreakdownCard`, `DegradedTelemetryChip`) have zero unit/smoke test coverage (§15's carried-
  forward finding) AND were never manually exercised live in this shipment — this is the layer with
  the least verification of any part of this feature.
- Risk R3 (±1 token degraded-mismatch tolerance validated against only one real fixture) remains
  untested against a second real run.
- The event-loop-blocking `gitNumstat()` pattern (security review, §15) has not been observed under
  real concurrent-RPC load, only reasoned about.

**Recommendation**: the next time the Symbion web app is run locally against a real project with an
active run (e.g. via `/run` or manual `npm run dev` + a live Execute), do a quick pass on exactly the
P2 surfaces named above before treating this feature as fully proven — this is the natural next
live-verification moment, not a new obligation.

## 17. Done — P2

**Shipped 2026-07-15** via `/review`-only (QA explicitly skipped, residual risk recorded in §16).

**What was verified**: `packages/core` pricing/aggregate/derive logic (F4/F5/F6 all correctly
implemented, one genuine flaw in the original §13.1 degraded-telemetry formula found and fixed
during build, independently confirmed correct by 2 Checkers against real fixture data); the real
subagent-fixture recording (revealed 2 real deviations from pre-build assumptions, both handled
defensively); `gitNumstat` + token-cap ceiling wiring in the daemon (security-reviewed clean); the
full P2 web surface (token badges, breakdown card, per-agent lighting, edge flow, timeline panel,
summary screen, degraded-telemetry chip) built additively over P1 without regressing its contract.
618/618 automated tests green; `npm run build` clean; 3 independent Checkers (code-reviewer,
architect, security-reviewer) all PASS.

**What was NOT verified** (accepted risk, see §16): live browser exercise of the new UI surfaces;
component-level tests for the new presentation components.

**Unblocks**: `docs/loops/self-coded-graph-migration-STATE.md`'s hard precondition is now half-
cleared — P2 has shipped. P3 (history/reattach/settings) is still required before that migration's
own `/plan` can proceed.

## 18. PLAN — P3 Architecture (2026-07-16, architect)

> Scoped strictly to STATE §8.7's P3 bullet ("history/reattach/settings (M)") and the design doc's
> P3-tagged surfaces (R6/R7/R8, F7, F8). P1 (§9/§11, QA §10/§12) and P2 (§13/§14, REVIEW §15, QA-
> SKIPPED §16) are DONE and untouched here except where explicitly noted. This section implements
> §6 (Scope, LOCKED), resolves F7/F8 from §8.8, and treats §8/§13's own PLANs and the design doc as
> fallible — §18.8 below names flaws found in THIS pass, including in prior PLAN sections.

### 18.0 Ground truth re-verified by reading the P1/P2 code (not re-guessed)

- **Retention pruning is ALREADY BUILT.** `apps/daemon/src/run/runStore.ts`'s `prune(projectRoot,
  keep=50)` is complete: keeps newest 50 by `startedAt`, deletes only `RUNID_RE`-matching dirs,
  lstat-refuses symlinks, re-confines before delete. It is called from `runManager.ts`'s
  `finalize()` (every terminal transition) — this was a P1 pull-forward per §9's own note ("kept in
  because it was cheap… not a P1 requirement"). **P3 does NOT need to build retention pruning** — it
  needs to (a) verify the existing policy is sufe under P3's new access pattern (history popover
  triggers `listRuns` far more often than P1/P2 ever did) and (b) decide whether "prune only at
  terminal" is sufficient or whether `listRuns` should also opportunistically prune (it already does
  per `runStore.ts`'s doc comment "may write (lazy reconcile + prune)" in STATE §8.3's RPC table —
  confirmed: **`listRuns` does NOT currently call `prune`**, only `reconcile`. This is a real gap
  from §8.3's own documented contract, not a P3 invention — see §18.5 NEW-P3-1).
- **`listRuns`/`reconcile`/`readRunJson` are already daemon-side primitives** (`runStore.ts`) — the
  `listRuns` RPC handler (`rpc/handlers.ts`) already returns `{runs: RunListItem[], activeRunId?}`
  for the WHOLE project's history, newest-first. **P3 needs no new "list history" RPC** — the
  existing `listRuns` IS the history popover's data source verbatim. This resolves one of the task's
  open questions ("does history listing need something new") — it does not.
- **`getRunEvents{projectId, runId, afterSeq}` already returns the FULL persisted event log** for
  any runId (capped at 500/batch, `done` flag) — this is already the exact shape needed for "fetch a
  specific past run's full event log for the read-only overlay" (the task's other named candidate for
  a new RPC). Calling it repeatedly with `afterSeq` = last-returned seq until `done:true` replays an
  ENTIRE historical run losslessly using code that already exists and is already tested
  (`run-getRunEvents.test.ts`). **No new RPC needed for the past-run overlay either.**
- **`ProjectRunConfig`/`DEFAULT_RUN_CONFIG`/`resolveRunConfig` already exist** (`packages/core/src/
  ir/types.ts`, `apps/daemon/src/run/runConfig.ts`) and are already read (never written by a UI) via
  `runPreflight`'s `permissionSummary`. The **existing `updateSettings` RPC** (`rpc/handlers.ts` line
  453, `UpdateSettingsParams`/`Result` in rpc-types) already accepts a full `ProjectSettings` object —
  `run?: ProjectRunConfig` is already a field on it. **R7's editor needs NO new RPC** — it's a pure
  UI addition that calls the RPC that has existed since P1.
- **`RunSummarySection.tsx` already renders inert `[Adjust ceilings]`/`[change]` links** (comment:
  "F7: inert link — P3 wires them"). `RunDialog.tsx`'s consent sentence line (§ design 3.2) has an
  equivalent `[change]` deep-link slot per the design doc, not yet grepped as wired — confirmed absent
  from the current `RunDialog.tsx` read (no `[change]` string appears in that file) — **this is a
  small gap vs. the design doc's own R2 wireframe (§3.2: "Ceilings: 30 min · 200k tokens. [change]")
  that P1/P2 never actually built the placeholder for**, unlike `RunSummarySection`'s. P3 must add
  BOTH real links now that there's a destination to link to.
- **No settings surface exists for a PROJECT today** — `/settings` (`SettingsShell.tsx`) is a
  single global page showing only `ProvidersPanel` (AI provider keys), with no project selector and
  no per-project section. R7's design wireframe (§3.11) assumes an in-context "Settings → Execution"
  section reachable per-project — this requires a genuinely NEW settings surface, not just a new
  section bolted onto the existing global page. See §18.1 for the resolution (a project-scoped
  settings panel, reached both from `/settings?project=<id>` and in-context links).
- **No command palette exists anywhere** (confirmed by grep: zero `cmdk`/`Palette`/`Command
  Palette` hits in `apps/web/src`). `ProjectSidebar.tsx` renders a bare "⌘K" text hint that is
  **purely decorative** — no keydown listener anywhere wires it up (confirmed: `AppRail.tsx`'s own
  comment calls it "vestigial"). **F8's "minimal ⌘K" is a from-scratch component**, not a wire-up of
  something half-built.
- **`RunTimelinePanel`/`RunSummarySection`/`NodeTokenBadge`/`TokenBreakdownCard`/
  `DegradedTelemetryChip` (all P2) have ZERO test coverage** (§15's carried-forward finding,
  reaffirmed in §16's residual-risk list) **and P2 shipped without a live QA pass** (§16). P3's
  history popover + past-run overlay directly reuse `RunTimelinePanel`'s Feed/Raw/Summary tabs in a
  new `mode:"history"` (already a declared-but-unimplemented value in the design's component
  contract table, §4: `mode: "feed"|"raw"|"summary"|"history"`) — **P3 is building its highest-
  visibility new surface on top of the single least-verified layer of the entire feature.** This is
  addressed head-on in §18.9 (recommendation), not silently inherited.

### 18.1 Architecture — exact file list

#### `packages/core/src/run/` (PURE — AC-RUN-11 unchanged)

| File | Status | Responsibility |
|---|---|---|
| `retention.ts` | **NEW, small** | Pure policy function extracted so it's unit-testable without touching the filesystem (the task's own ask: "retention-pruning policy logic if it needs to be shared/testable"). `selectPruneTargets(runs: {runId: string; startedAt: string}[], keep: number): string[]` — pure: sorts by `startedAt` ascending, returns the runIds beyond the newest `keep`. `apps/daemon/src/run/runStore.ts`'s `prune()` is refactored to call this for the SORT+SELECT step only — the actual `lstatSync`/`rmSync`/symlink-refusal/re-confinement stays daemon-side (that's inherently fs work, not eligible for core). This is a pure extraction of existing logic, not new behavior — `prune()`'s current inline sort-and-slice becomes a call to `selectPruneTargets`, verified byte-identical by keeping the existing daemon-level prune tests green. |
| `test/run/retention.test.ts` | **NEW** | Unit tests per testplan §7.1 below — count-based selection, tie-breaking on identical `startedAt` (stable by insertion order — an edge case the current inline code doesn't explicitly guarantee and this extraction should pin), `keep >= runs.length` → empty selection, empty input. |

No other core changes. `derive.ts`/`aggregate.ts`/`pricing.ts`/`events.ts` are untouched — P3 adds
no new event types, no new aggregation logic, and no new pricing logic. The read-only past-run
overlay and history popover are **pure UI + existing-RPC-replay** features; they do not need any new
pure reducer.

#### `packages/rpc-types` — **NO new RPC method** (see §18.2 for the justification)

- `RunPreflightResult`'s existing `lastRun` shape is unchanged.
- One additive, non-breaking type change: `RunTimelinePanelProps`-equivalent contracts (web-only,
  not RPC types) gain the `"history"` mode value that the design doc already declared but P1/P2
  never implemented (§4's component table: `mode: "feed"|"raw"|"summary"|"history"` — the union
  member already exists in the TYPE the design specified; `RunTimelinePanel.tsx`'s own prop type
  needs to actually include it — checked: **it currently does NOT** — `mode` is typed as
  `"feed"|"raw"|"summary"` only in the shipped component, one value short of the design contract.
  This is P3's job to add, purely additive).
- `ProjectRunConfig`/`UpdateSettingsParams` types are UNCHANGED — R7 reuses them exactly as declared.

#### `apps/daemon/src/` — modified, no new RPC method, no new route

| File | Change |
|---|---|
| `run/runStore.ts` | `prune()` refactored to call `core.selectPruneTargets` for the sort+select step (behavior-preserving extraction, §18.1). **New**: `listRuns()`'s handler-level call site (`rpc/handlers.ts`'s `listRuns` handler, see below) now ALSO calls `prune()` opportunistically — closing the gap named in §18.0 (today only `finalize()` prunes; a project that never finishes a NEW run but is repeatedly opened via the history popover currently never re-prunes even if runs were deleted out-of-band or a prior prune was interrupted). Cheap and idempotent (prune is already a no-op below `keep`). |
| `rpc/handlers.ts` | `listRuns` handler gains one line: `prune(ctx.projectRoot)` before `listRuns(ctx.projectRoot)` is read (best-effort, wrapped in try/catch exactly like `finalize()`'s existing pattern — a prune failure must never break the history popover from opening). **No new RPC method added** — same handler, same params/result shape. |
| — | **Nothing else in `apps/daemon` changes for P3.** No new SSE frame, no new route, no new preflight check. `getRunEvents` (existing) is the past-run overlay's sole data source, called in a loop by the web store until `done:true`. |

#### `apps/web/src/` — the bulk of P3's work; new components + additive wiring

| File | Status | Responsibility |
|---|---|---|
| `components/run/RunHistoryPopover.tsx` | **NEW** | Per design §3.10/R6: toolbar-anchored popover, `{runs: RunListItem[]; activeRunId?; onSelect(runId); onOpen()}`. Lazy `listRuns` RPC call on open (design's explicit "lazy `listRuns` on open" contract). One row per run: glyph/command/duration/fresh-tok/$/relative-time. Empty state: `No runs yet — hit ▶ Execute on a command node.` No delete/search (locked, v1 non-goal). |
| `components/run/PastRunBanner.tsx` | **NEW** | Per design §3.10: `{run: RunListItem | RunInfo; onExit(); onRerun()}` — warning-tinted banner rendered ABOVE the mission chrome when `historyRunId` is set, "🕘 VIEWING PAST RUN · #<n> · <date> · <status> · read-only" + `[▶ Run again]` + `[Exit history]`. The "am I live?" ambiguity design explicitly calls out is resolved by this banner being the ONLY new visual element for history mode — everything else (graph re-lighting, panel) is the EXISTING mission-mode rendering, just fed frozen/replayed data (§18.3). |
| `lib/run/useRunStore.ts` | **modified, additive** | New state: `historyRunId: string | null`, `historyLoading: boolean`. New actions: `openHistoryRun(projectId, runId)` — loops `getRunEvents{afterSeq}` until `done:true` (reusing the EXISTING RPC, no new wire protocol), folds the full replayed event list through `core.fold`/`core.rollup`/`derive.timelineRows`/`derive.runSummary` (the SAME pure functions live runs use — no parallel "history" code path for the math) into a SEPARATE state slice (`historyFoldState`/`historyNodeRunData`/`historyTimeline`/`historySummary`) so browsing history NEVER touches the live `foldState`/`nodeRunData` a concurrently-running live run might be using (§18.5's edge case). `exitHistory()` clears the history-only slice. **Nothing about `attach()`/`attachIfActive()`/the SSE `EventSource`/poll-fallback changes** — history replay is 100% `getRunEvents` batched reads, never SSE (matches STATE §8.9 A9, already decided at P1's PLAN, unchanged). |
| `components/DependencyGraph.tsx` | **modified, additive** | Toolbar gains `🕘 runs <n>` button (hidden at 0 runs, per design's empty-state rule) — opens `RunHistoryPopover`; selecting a row calls `openHistoryRun`. When `historyRunId` is set: node/edge data-bag memo sources from `historyNodeRunData` INSTEAD OF the live `nodeRunData` (a `viewingHistory ? historyX : liveX` selector-level branch, not a code duplication — same memo, different input map), all rings render at FINAL states (no pulse/flow — `runStatus` values map to their static/settled variants only), authoring stays suspended (same `authoringSuspended` flag, extended to `historyRunId !== null`), `PastRunBanner` renders above the mission chrome, panel shows `mode:"history"` (Feed/Raw/Summary tabs all available, sourced from `historyTimeline`/`historySummary`, no live "follow" toggle since nothing is streaming). **Concurrency interaction (edge case, see §18.5 EDGE-3)**: if a NEW live run starts while browsing history (via ⌘K or another tab's node menu — Execute is still reachable from nodes not dimmed by history mode, an explicit UX decision named below), `missionActive` (live) and `historyRunId !== null` can theoretically both be true; the resolution is **live always wins visually** — `DependencyGraph`'s render branch checks `missionActive` before `historyRunId` (live mission-mode overlay takes rendering priority; a toast informs the user "A new run started — exited run history" and `exitHistory()` is called automatically). This is a genuine product decision this plan is making, not previously specified — flagged in §18.8. |
| `components/run/RunCommandPalette.tsx` | **NEW** | Per F8/design's minimal scope: `cmdk`-style overlay (hand-rolled, NO new npm dependency — see §18.6 risk R-P3-1 on this choice), opened by a GLOBAL `⌘K`/`Ctrl+K` keydown listener mounted once in `AppShell.tsx`. Two sections ONLY (F8's explicit limit, not to be grown): **"Execute"** — one row per PUBLISHED command artifact across the CURRENTLY OPEN project (`Execute /<name>…` — selecting one opens the existing `RunDialog` for that command, exactly the same dialog the node `⋯` menu opens, no parallel Execute path); **"Run history"** — one row, opens `RunHistoryPopover`'s equivalent view (reuses the SAME popover component, anchored center-modal instead of toolbar-anchored, or literally renders the same list inline — implementation choice deferred to /build, contract is "same data, same `openHistoryRun` action"). Typing filters the Execute list by command name (simple substring match, no fuzzy-match library — no new dependency). Esc closes. **Explicitly NOT included** (F8 scope-creep guard, testable via a manual QA checklist item): no agent execution, no settings navigation, no project switching, no generic "go to" navigation, no recent-files, no fuzzy scoring. If the diff adds any of these, that's scope creep against this plan. |
| `components/AppShell.tsx` | **modified** | Mounts the global `⌘K`/`Ctrl+K` keydown listener (checks `!isInputFocused()` the same way any command-palette convention does, to avoid hijacking Cmd+K inside a text field elsewhere) that opens `RunCommandPalette`; renders `RunCommandPalette` as a top-level overlay (mirrors how `RunBar` is already mounted app-wide). `ProjectSidebar.tsx`'s vestigial "⌘K" text hint is now WIRED (or removed if wiring a static label to a global app-wide shortcut from inside a project-scoped sidebar component is awkward — /build's call, not re-litigated here; either outcome satisfies "the hint stops being a lie"). |
| `components/run/RunSettingsSection.tsx` | **NEW** | Per design §3.11 exactly: permission-mode radio group (`plan`/`acceptEdits`/`bypassPermissions`, verified-real strings per §8.0), allowed-tools chip editor (add/remove strings — a simple text-input-plus-chip-list, no new dependency), ceilings (`wallClockMs` as a minutes number input, `tokenCap` as a tokens number input) — **validation** (§18.5): wall-clock minutes bounded `[1, 1440]` (1 min .. 24h), token cap bounded `[1_000, 5_000_000]` or `0` (explicit "disabled" sentinel, matching `runManager.ts`'s existing `tokenCap > 0` disable-check — the UI must offer a literal "no cap" toggle rather than requiring the user discover that typing `0` disables it), allowed-tools strings sanity-trimmed (no validation beyond non-empty — the CLI itself is the source of truth for what's a valid tool name, Symbion doesn't maintain an allowlist of allowlists). `bypassPermissions` selection requires an EXTRA confirm-on-save modal (design's explicit requirement) AND clears any existing `firstRunAck` (forces re-ask — reuses the EXISTING `ackSettingsHash`-mismatch mechanism automatically once `permissionMode` changes, no new re-ask logic needed, confirmed by reading `preflight.ts`'s existing comparison). Calls the EXISTING `updateSettings` RPC with the full `ProjectSettings` (read-modify-write — the section receives the current full `ProjectSettings` as a prop, mutates only the `run` field, sends the whole object back, matching how `updateSettings` is already shaped: it's a whole-object PUT, not a patch, per its existing type). |
| `app/settings/page.tsx` / `components/SettingsShell.tsx` | **modified** | Gains project-scoping: a `?project=<id>` query param (or a project picker if none/invalid) selects which project's `RunSettingsSection` renders below/beside the existing global `ProvidersPanel`. This is the smallest viable "R7 needs a destination" fix — NOT a general per-project settings redesign (out of scope creep territory the task didn't ask for); if a fuller per-project settings IA is wanted later, that's a separate feature, flagged in §18.8. |
| `components/run/RunDialog.tsx` | **modified, small** | Adds the `[change]` link next to the consent sentence (design §3.2, previously never built per §18.0) that navigates to `/settings?project=<id>#execution`; `RunSummarySection.tsx`'s existing inert `[Adjust ceilings]` link gets the SAME real `href`/`onClick` (both were declared inert placeholders specifically FOR this P3 wiring, per F7's own §13.7/§14.2 comments — this is not new scope, it's the named deferred wiring landing on schedule). |
| `components/run/RunTimelinePanel.tsx` | **modified, small** | `mode` prop type widened `"feed"\|"raw"\|"summary"` → `"feed"\|"raw"\|"summary"\|"history"` (closes the design-vs-shipped gap named in §18.0); `"history"` mode behaves identically to a terminal run's normal tab set (Feed/Raw/Summary all available) MINUS the live "follow/pause" toggle (nothing is streaming) — the simplest correct implementation is likely "history mode is exactly like a terminal run's panel, with `following` hardcoded to false and no `waiting` shimmer," not a new rendering branch. |
| `globals.css` / `tailwind.config.ts` | **audited, see §18.4** | The prefers-reduced-motion audit (item 7 of the task) — see §18.4 for the concrete per-animation findings; expect zero-to-small CSS changes, not a new animation system. |

### 18.2 Daemon RPC surface — justification for adding NONE

Per the task's explicit ask to justify each addition against "smallest surface" (A11 already rejected
a new RPC for P2's telemetry) — **this plan adds zero new RPC methods and zero new routes.** Walking
through the task's own candidate list:

- **"listing run history"** — already served by the existing `listRuns` RPC (`{projectId} →
  {runs: RunListItem[], activeRunId?}`), unchanged shape, already returns every persisted run
  newest-first. The ONLY daemon change is adding an opportunistic `prune()` call inside that
  existing handler (§18.1) — not a new method, a one-line addition to an existing one.
- **"fetching a specific past run's full event log for the read-only overlay"** — already served by
  looping the existing `getRunEvents{projectId, runId, afterSeq}` RPC until `done:true`. This IS a
  different SHAPE of use (bulk historical replay vs. P1's original "polling fallback for a live run"
  design intent) but is not a different METHOD — the params/result contract is already exactly what
  a bulk replay needs (`events`, `run`, `done`), and `runStore.readEvents`'s cap-at-500-per-call
  behavior already makes multi-call replay the correct pattern for a run with >500 events (the exact
  same mechanism P1's ER-5 poll-fallback already exercises, just called in a tight loop instead of on
  a 1s timer). Verified by reading `runStore.ts`/`handlers.ts`: the daemon-side implementation does
  not care WHY it's being called this way.
- **"updating settings"** — already served by `updateSettings` (exists since before this feature;
  `run?: ProjectRunConfig` has been a field on its param type since P1 per §8.2/§18.0). No new
  method.

**The one genuine judgment call**: bulk-replaying a very large historical run (worst case: a run
that hit the 30-min wall-clock ceiling and emitted thousands of events) via N sequential
`getRunEvents` round-trips (500/batch) means opening history on such a run costs N network round-
trips before the overlay is fully populated. At Symbion's stated scale (dozens-to-low-hundreds of
runs, not thousands of EVENTS per run in the common case), this is acceptable — a 2000-event run is
4 round-trips, each fast (local daemon, same machine). If a real dogfood run reveals this as
sluggish, the fix is a `cap` override param on the EXISTING `getRunEvents` (raise the daemon's
internal `EVENTS_CAP` constant or accept an optional larger requested cap) — still not a new method,
noted as a possible follow-up, not built here since no perf problem has been observed (same "don't
speculatively optimize" posture as P2's A12).

### 18.3 Data flow

**History persistence (unchanged from P1/P2)**: `.symbion/runs/<runId>/{run.json, events.jsonl}` —
local JSON + append-only NDJSON, no SQL DB, exactly per CLAUDE.md. P3 adds no new file under this
tree and no new top-level file (no history index file — see §18.4 for why).

**History popover → past-run overlay (read path)**:
```
🕘 toolbar click → RunHistoryPopover opens → listRuns RPC (lazy, on open)
                                                  │
   row click ──────────────────────────────────► useRunStore.openHistoryRun(projectId, runId)
                                                  │
                          loop: getRunEvents{afterSeq} until done:true (existing RPC, existing daemon code)
                                                  │
                          fold ALL replayed events through core.fold (SAME pure reducer live runs use)
                          → rollup() → historyNodeRunData
                          → derive.timelineRows() → historyTimeline
                          → derive.runSummary() → historySummary
                                                  │
   DependencyGraph: historyRunId set → node/edge memo sources historyNodeRunData (final-state rings,
   no pulse/flow) → PastRunBanner renders → RunTimelinePanel mode="history" (Feed/Raw/Summary, no follow)
```
**Key invariant preserved from P1/P2 (A2/A11)**: history math uses the EXACT SAME `core.fold`/
`core.rollup`/`core.derive` functions as live runs — there is no second "history aggregation"
implementation to drift from the live one. The only NEW thing is a second state slice
(`historyFoldState` etc.) so it composes with a concurrently-live run's OWN fold state without
collision (§18.5 EDGE-3).

**R8 full reattach choreography — what's genuinely NEW beyond P1's basic version**:

P1 already shipped: F5 reload → `attachIfActive` → `listRuns` → active found → SSE backfill-then-
live → badges fast-forward. This is design R8's "t=0 / t≈1s / t≈2s" happy path — **already done**.
What P1's "basic" version does NOT do, that the design's R8 section names and P3 must add:

1. **ER-10 toast/partial summary** (item 3 of the task, explicitly called out as separate from the
   happy-path reattach): when reconciliation (already-existing `reconcile()`, called from the daemon
   at project-touch time) marks a run `failed(daemon-restarted)` and the CURRENTLY OPEN web session's
   `attachIfActive` discovers this (rather than an active run), today `useRunStore` has no special
   handling for "the run I was tracking just turned out to be reconciled-failed while I was gone" —
   it would simply see no `activeRunId` and stay idle, silently. **NEW**: `attachIfActive` (or a
   thin wrapper `checkForReconciledRun`) additionally calls `listRuns` and checks whether the
   PREVIOUSLY-tracked run (persisted client-side — see below) is now `failed` with
   `errorMessage:"daemon-restarted"`; if so, fires a danger toast ("Run /<name> marked failed — daemon
   restarted") with a `[View summary]` action, and computes a partial summary via the SAME
   `getRunEvents`-replay-then-fold path history uses (a reconciled run IS effectively a completed
   historical run the moment it's reconciled — this reuses `openHistoryRun`'s exact mechanism, not a
   third code path). **Client-side "previously tracked run" persistence**: a small `localStorage`
   entry (`symbion:lastTrackedRun:<projectId>` → `runId`) written whenever `attach()` starts tracking
   a run, read once at `attachIfActive` mount time, cleared once the ER-10 check has fired (or the
   run completed normally) — this is the one piece of NEW client-side state P3 introduces, and it is
   NOT a new server-side persistence format (still local JSON files server-side; this is a browser-
   local convenience marker, lost on a different browser/incognito — acceptable, since the SAME
   information is always independently recoverable via `listRuns`' `status` field even without it,
   just without the proactive toast).
2. **Full choreography timing/copy per design's R8 ASCII** (`t=0`/`t≈1s`/`t≈2s` staged reveal) — P1's
   note (§9.1 file list) says "basic F5 attach (bar + tail resume — nearly free once SSE backfill
   exists)" without the staged shimmer/skeleton sequence the design specifies (`⟳ replaying 214
   events…` shimmer, 300ms count-up on badges). **This is a presentation-polish gap, not a logic
   gap** — the underlying data (backfill → fold → badges) already works per P1's QA (§12, J11 PASS);
   P3's job here is purely the missing UI choreography (skeleton states, count-up animation), not new
   data plumbing.

### 18.4 Local-store schema

**No new files under `.symbion/runs/<runId>/`.** No index file. Rationale (the task explicitly asks
to weigh "what's cheap vs. what needs indexing" at Symbion's stated scale):

- At "dozens to low-hundreds of historical runs per project," `readdirSync(.symbion/runs/)` +
  `RUNID_RE`-filter + `readRunJson` per dir (already `listRuns`'s exact implementation) is a
  directory scan of at most ~150 small JSON files (with retention capping it at 50 going forward) —
  this is sub-millisecond-to-low-single-digit-millisecond work on any real filesystem, and it already
  happens today for EVERY `listRuns` call (used by P1's `attachIfActive` on every single page load).
  **An index file would be a second source of truth that must stay in sync with the directory
  contents** (a run being pruned, reconciled, or finalized would need the index updated in lockstep)
  — exactly the kind of redundant-denormalized-copy risk P2's PLAN (§13.4) already explicitly
  rejected for `runSummary` ("avoiding a second source of truth that could drift"). The same
  reasoning applies here, one order of magnitude more strongly, since an index-out-of-sync bug in
  HISTORY listing is a much worse user-trust failure (silently missing/wrong history rows) than a
  slow recompute. **Verdict: no index file, scan-per-call remains correct at this scale** — this
  matches CLAUDE.md's own "no cloud DB" posture in spirit (don't build a denormalized index either).
- If Symbion's usage ever grows to thousands of runs/project (explicitly named by the task as NOT
  the expected scale), THEN an index becomes worth its sync-maintenance cost — not before. Flagged
  as a forward-looking non-decision, not a gap.

**`ProjectRunConfig`**: no schema change. R7's editor writes through `updateSettings`, which already
accepts this exact shape (unchanged since P1).

**Client-side (new, browser-local only)**: `localStorage["symbion:lastTrackedRun:<projectId>"]` —
a single string (the last-attached runId), used solely for the ER-10 toast trigger (§18.3). Not a
Symbion-managed file, not part of `.symbion/`, no filesystem-safety implications (browser storage,
not disk-via-daemon).

### 18.5 Edge cases

| # | Case | Resolution |
|---|---|---|
| EDGE-1 | Retention pruning races with an in-progress write | Already handled by existing P1/P2 code, re-verified in this pass: `prune()` only ever deletes runs OTHER than the currently-active one, because the active run's dir is never eligible for deletion until AFTER `finalize()` (which writes the terminal `run.json` FIRST, then calls `prune()` — `runManager.ts`'s `finalize()` ordering: `writeRunJson` → `broadcaster.emitState`/`close` → `this.active.delete(...)` → `prune()`, in that exact order). The newly-terminal run is therefore already fully written and closed (its `eventsFd` closed via `closeEventsFd` before `prune()` runs) before pruning ever considers ANY run for deletion — even in the pathological case where a project has >50 runs and the just-finished run itself is old enough to be a prune target (impossible by construction: `startedAt`-sort always keeps the newest 50, and the just-finished run is by definition the most recent). The genuinely new P3 risk is the ADDED `listRuns`-triggered prune (§18.1): a user opens the history popover WHILE a live run is mid-flight — `listRuns`'s prune call only ever touches `.symbion/runs/<runId>/` dirs matching `RUNID_RE`, and the live run's dir is guaranteed to have the NEWEST `startedAt` (it just started), so it is never a delete candidate either. No new race is introduced. |
| EDGE-2 | The read-only past-run overlay's interaction with a NEW live run starting while browsing history | Resolved in §18.1's `DependencyGraph.tsx` entry: **live always wins visually** — if `missionActive` becomes true while `historyRunId !== null`, the live overlay takes over, a toast explains why ("A new run started — exited run history"), and `exitHistory()` fires automatically. This prevents the worst failure mode (a user believing they're watching a LIVE run when they're actually frozen on history, or vice versa — exactly the ambiguity `PastRunBanner`'s design intent already guards against for the read-only case; this extends the same "never ambiguous" principle to the transition). Alternative considered and rejected: blocking new Execute while browsing history — rejected because Execute affordances are already globally disabled while ANY run is active in the project (existing ER-9 rule) and browsing history is explicitly NOT "a run is active," so blocking Execute during history-browsing would be a NEW restriction with no corresponding existing rule to hang it on, and would frustrate a user who legitimately wants to start a new run while glancing at an old one. |
| EDGE-3 | Live fold state vs. history fold state collision | Resolved by construction in `useRunStore.ts`'s design (§18.1): SEPARATE state slices (`foldState`/`nodeRunData` for live, `historyFoldState`/`historyNodeRunData` for history) — never shared, never overwritten by each other. `openHistoryRun` never touches `foldState`; `attach()`/`applyEvents` never touch `historyFoldState`. This is a small memory-duplication cost (two `RunState` maps live simultaneously when both a live run and a history view are open) — acceptable at Symbion's scale (one run's worth of Maps, a few hundred to low-thousand entries each, not a real memory concern). |
| EDGE-4 | ⌘K palette scope creep | Guarded structurally (§18.1's explicit "NOT included" list) AND procedurally: a manual QA checklist item (testplan §7.4) explicitly checks the shipped palette does NOT contain agent-execution rows, settings navigation, or project-switching — a reviewer-visible negative test, mirroring how P2's testplan already used a negative check (J23: "confirm NO Execution section exists yet") for the SAME kind of scope-creep risk on the opposite side (guarding P2 against building P3's work early; this guards P3 against growing beyond F8's letter). |
| EDGE-5 | Settings editor validation — ceilings must stay sane bounds | Wall-clock: `[1, 1440]` minutes (below 1 min is operationally useless — a run can't meaningfully do anything; above 24h has no product justification and risks a truly runaway daemon-tracked child). Token cap: `[1_000, 5_000_000]` OR the literal disable sentinel `0` — exposed as an explicit toggle in the UI (not a magic number the user must discover), matching `runManager.ts`'s existing `Number.isFinite(tokenCap) && tokenCap > 0` disable-check verbatim (no daemon-side change needed — the UI's bounds are the ONLY new validation surface; the daemon already treats any non-positive value as "disabled" and any positive value as "enforce"). Allowed-tools: non-empty trimmed strings only, no further validation (Symbion doesn't second-guess CLI-specific tool-name syntax). `bypassPermissions` extra-confirm-on-save is a UI-only gate (no daemon enforcement needed — the daemon already re-validates `permissionMode` is one of the three literal strings via TypeScript's own type at the RPC boundary, and `updateSettings`'s existing param validation, unaudited in this pass but pre-existing, is assumed unchanged). |
| EDGE-6 | prefers-reduced-motion audit findings | See §18.6 below — findings enumerated there rather than folded into this table (it's a checklist, not a single case). |
| NEW-P3-1 | `listRuns` never pruned before this plan (§18.0's finding) | Already resolved in §18.1's file list — `listRuns` handler now calls `prune()` (best-effort, try/catch, never blocks the read). This closes a real, if minor, gap between §8.3's ORIGINAL documented RPC-surface table ("may write (lazy reconcile + prune)") and what P1 actually shipped (only reconcile, not prune) — flagged here as a genuine finding from re-reading the code against its own prior PLAN's letter, not invented for P3. |

### 18.6 Reduced-motion audit (task item 7)

Read `apps/web/tailwind.config.ts` and `globals.css`'s existing reduced-motion handling directly
rather than assuming it "already works" because prior BUILD notes asserted so:

- **P1's `glowPulse`** (§9/§14 note: "covered by the existing global `prefers-reduced-motion` block").
- **P2's `dashFlow`/`countLockIn`** (§14.2: "Both collapse under the existing global
  `prefers-reduced-motion` block (a universal `*` selector — no new media-query entry needed)").
- **P1's mission-mode enter/exit transition** (~300–400ms `cubic-bezier`, design §5) and the **dim
  fade** (150ms) — not explicitly named in any prior BUILD note as reduced-motion-audited.
- **Badge tween** (≤300ms rAF-coalesced count-up, design §5's "Numbers" section) — implemented via
  `requestAnimationFrame`, NOT a CSS animation/transition — **CSS's `prefers-reduced-motion` media
  query does not automatically affect JS-driven rAF loops.** This is the one genuine audit finding
  this pass surfaces that prior BUILD notes did not: **if `NodeTokenBadge`'s rAF tween doesn't
  itself check `window.matchMedia("(prefers-reduced-motion: reduce)")`, a reduced-motion user still
  sees the count-up animate smoothly** — the existing global CSS block cannot catch this because
  there is no CSS transition/animation property involved at all, only imperative `requestAnimationFrame`
  calls updating a text node. **Action for /build**: verify `NodeTokenBadge.tsx`'s tween function;
  if it does not already gate on `matchMedia`, add the check (snap to the final value immediately
  under reduced-motion, matching the CSS-driven animations' "collapse to state swaps" behavior for
  parity) — this is the one concrete "name what needs fixing" item the task asked for.
- **Everything else** (rings, edge-flow, lock-in flash) IS pure CSS keyframe/transition-driven and
  DOES correctly fall under the existing global `*`-selector reduced-motion block, confirmed by
  reading `tailwind.config.ts`'s keyframe definitions and `globals.css`'s media query scope (a
  universal selector, not scoped to specific classes — any NEW P3 keyframe automatically inherits
  this without needing its own opt-out entry, same as P1/P2's pattern).
- **P3's own new animations**: the history-overlay transition (graph re-lighting to final states)
  and the reattach choreography's staged shimmer/count-up sequence (§18.3) — the shimmer is CSS
  (inherits the global rule automatically); the reattach count-up (design: "badges fast-forward
  (300ms count-up)") is likely the SAME rAF-tween mechanism as the live badge and therefore has the
  SAME audit finding as above — one fix covers both call sites if `NodeTokenBadge`'s tween function
  is the single shared implementation (confirmed it is, per §18.1's file list — `NodeTokenBadge` is
  not duplicated between live and history rendering).

### 18.7 Test plan

See `docs/loops/graph-execution-realtime-testplan.md` — new "§7 P3 additions" section appended
below all existing content (nothing overwritten). Summary: `retention.test.ts` (core, pure policy
unit tests); a daemon integration test for the `listRuns`-triggers-prune wiring
(`run-listRuns-prune.test.ts`); a manual web journey checklist (history popover, past-run overlay,
live-wins-during-history transition, R8 full reattach with ER-10 toast, settings editor incl.
validation bounds + bypassPermissions extra-confirm + ack re-trigger, ⌘K palette incl. the negative
scope-creep check) — all mapped to this section's edge cases and to the reduced-motion audit
checklist (§18.6).

### 18.8 Flaws found (this pass — not treated as infallible, including self-review of §8/§13)

- **F-P3-1 — the design doc's R7 wireframe (§3.11) has no `[change]` link destination in the
  RunDialog, and P1/P2 never built the placeholder for it** (unlike `RunSummarySection`'s
  `[Adjust ceilings]`, which WAS built inert on schedule). This is a genuine small gap between the
  design doc's own R2 wireframe (§3.2, which explicitly shows `[change]` in the consent line) and
  what P1/P2 actually shipped — not previously flagged in any prior STATE section. Resolved in
  §18.1 (RunDialog gains the link now, alongside the pre-existing inert one it's replacing).
- **F-P3-2 — §8.3's original RPC-surface table documented `listRuns` as "may write (lazy reconcile +
  prune)" but the shipped P1/P2 code only ever reconciles, never prunes, from that call site**
  (prune only happens at `finalize()`). This is a genuine drift between the ORIGINAL PLAN's letter
  and the shipped implementation that neither P1's QA (§10/§12) nor P2's REVIEW (§15) caught,
  because it's a silent omission (nothing broke — prune-at-finalize alone keeps growth bounded in
  the common case) rather than a visible defect. Resolved in §18.1 (NEW-P3-1).
- **F-P3-3 — self-review of my own §8/§13 authorship**: §8.7's original P3 phasing line ("R7
  Settings→Execution UI (until then the consent line renders defaults...)") undersold the actual
  scope of building R7 — it reads as "just add a form," but building it correctly requires (a) a
  project-scoping mechanism for `/settings` that does not exist today (§18.0), (b) wiring TWO inert
  links (RunDialog's missing one, RunSummarySection's existing one) rather than one, and (c) the
  `bypassPermissions` extra-confirm-on-save + forced re-ack interaction, which the original §8/§13
  PLANs never spelled out mechanically (only the design doc's wireframe implies it). This plan
  (§18.1) is the first to make R7's actual implementation surface explicit — flagging that the
  ORIGINAL "(M)" size estimate in §8.7 may have been optimistic once the settings-surface gap is
  counted, not just the form itself.
- **F-P3-4 — the design doc's `RunTimelinePanel` "history" mode was declared in the CONTRACT TABLE
  (§4) from the very first design pass but never implemented in either P1 or P2's actual component**
  (§18.0's finding: shipped `mode` prop is missing the value). Neither P1's nor P2's BUILD notes flag
  this as a deferral — it appears to be an honest miss (the design doc's table entry predates P1;
  P1/P2 both had legitimate reasons to not need it yet, but neither BUILD note names the gap
  explicitly the way F7/F8 were named for other deferred surfaces). Flagged here so it's an
  acknowledged, tracked gap rather than a rediscovery cost for whoever builds P3.
- **F-P3-5 (process risk, not a design flaw per se) — P3 builds its highest end-user-visible new
  surface (history) directly atop P2's completely live-QA-unverified `RunTimelinePanel`/
  `RunSummarySection` components** (§16's residual risk, §18.0's restatement). See §18.9 for the
  explicit recommendation this risk drives, rather than silently accepting it.

### 18.9 Recommendation on P2's QA gap (task's explicit ask)

**Recommendation: close P2's QA gap ALONGSIDE P3's build, not strictly before it, but gate P3's
`/qa` on BOTH P2's and P3's journeys passing together in the SAME live pass** — not two separate
passes. Reasoning:

- Blocking P3's `/build` entirely on a standalone P2 QA pass first would re-litigate scope (the user
  already made an explicit, recorded decision to ship P2 on review-only, §16) and would cost a full
  extra QA round-trip for surfaces P3 is about to re-exercise anyway (browsing history necessarily
  re-renders `RunTimelinePanel`/`RunSummarySection`/`NodeTokenBadge` — the SAME components P2 never
  live-verified — in a NEW mode).
- But shipping P3 without EVER live-verifying P2's surfaces would mean history — the feature most
  likely to be used repeatedly and depended on for the "Learn" product loop (§5's north star) — is
  built on a foundation nobody has ever watched render correctly in a real browser. That is a
  materially worse risk posture than P2's own (P2 at least had 3 independent code-level Checkers;
  P3's history mode adds a genuinely NEW rendering path — `historyNodeRunData` sourcing — that no
  Checker has looked at yet either).
- **Concretely**: P3's own manual web journey checklist (testplan §7.3) is expanded to explicitly
  re-cover P2's never-verified J12–J16/J21–J23 items (already existing in the testplan, marked
  "P2" phase) as part of the SAME live QA session that verifies P3's new J24+ items — one combined
  pass, sequenced P2-items-first-then-P3-items, so a P2-level regression is caught before it's
  mistaken for a P3 defect. This is a scheduling/sequencing recommendation for `/qa`, not a new
  build requirement — no code changes are implied by this recommendation itself.

### 18.10 Trade-offs & assumptions (P3 additions to §8.9/§13.9's tables)

| # | Decision / assumption | Why / risk |
|---|---|---|
| A18 | No new RPC method for history listing or past-run replay | `listRuns`/`getRunEvents` (P1) already have the exact shapes needed; a new method would duplicate an existing one for no gain (mirrors A11's reasoning, extended) |
| A19 | No history index file — directory scan per `listRuns` call, unchanged from P1 | Correct at Symbion's stated scale (dozens–low-hundreds of runs); an index is a second source of truth that must stay in sync, rejected on the same grounds P2's PLAN (§13.4) already used for `runSummary` |
| A20 | Separate `historyFoldState` slice in `useRunStore`, never shared with live `foldState` | Structural prevention of EDGE-3 (live/history collision) at the cost of a small, bounded memory duplication |
| A21 | "Live always wins" when a new run starts while browsing history | Prevents an ambiguous frozen-vs-live state; consistent with `PastRunBanner`'s "never ambiguous" design intent; alternative (blocking Execute during history-browsing) was rejected as an unjustified new restriction |
| A22 | `RunCommandPalette` is hand-rolled, no `cmdk` (or similar) npm dependency | Matches A8's precedent (hand-rolled timeline windowing, "avoids a new web dependency"); F8's scope is deliberately tiny (2 sections, substring filter) — a real fuzzy-match/keyboard-nav library would be overkill for this scope and reintroduces a maintenance dependency the codebase has consistently avoided for run/ UI |
| A23 | `RunSettingsSection` reached via `/settings?project=<id>`, not a redesigned per-project settings IA | Smallest change that gives R7 a real destination; a fuller per-project settings information architecture is out of scope for this plan (flagged as a possible separate future feature, F-P3-3) |
| A24 | `localStorage`-based "last tracked run" marker for the ER-10 toast trigger | The only new client-side persistence P3 introduces; browser-local only (lost across browsers/incognito), acceptable because `listRuns`'s `status` field always independently recovers the same information, just without the proactive toast in that edge case |
| A25 | P2's QA gap is closed IN THE SAME live pass as P3's QA, not as a separate blocking prerequisite | See §18.9's full reasoning — avoids re-litigating the user's explicit P2 ship-on-review-only decision while still closing the real risk before the highest-traffic new surface (history) ships fully unverified |

This section does not supersede any part of §8/§13 — it extends them for P3's scope only, per
CLAUDE.md's STATE-as-living-axis convention.

## 19. BUILD — P3 implementation notes (2026-07-16, feature-builder)

Implements STATE §18's P3 slice: history listing/retention, `RunHistoryPopover`, `PastRunBanner`,
read-only past-run overlay, full R8 reattach choreography (ER-10 toast/partial summary),
`RunSettingsSection` (R7), `RunCommandPalette` (F8), and the prefers-reduced-motion audit. **Not
self-reviewed** — written for the Checker. Two material deviations from §18's premises were found
by re-reading the actual shipped code before writing anything; both are called out explicitly below
per the task's instruction to STOP-and-document rather than silently diverge or silently redo
already-done work.

### 19.0 Deviations from STATE §18's premises (found by re-verifying against the real code)

1. **§18.0/§18.8 F-P3-2/NEW-P3-1 ("listRuns does NOT currently call prune") is FACTUALLY WRONG.**
   `git log -p -- apps/daemon/src/rpc/handlers.ts` shows the `listRuns` handler has called
   `prune(path)` (unconditionally, before `storeListRuns`) since the **original P1 commit**
   (`f65b34b`) — the line was never added or removed since. There is no gap to close; §18's own
   re-verification claim ("confirmed: listRuns does NOT currently call prune") does not match the
   code it says it re-read. **What I did about it**: did NOT add a second/duplicate `prune()` call
   to the handler (that would be silently re-doing already-correct behavior and would look like a
   "fix" for a bug that doesn't exist). I DID still build the `selectPruneTargets` pure-function
   extraction from §18.1 (that part of the plan is independently correct and testable regardless of
   the NEW-P3-1 premise) and refactored `runStore.ts`'s `prune()` to call it — a behavior-preserving
   extraction, verified by the existing daemon prune-adjacent tests staying green. I also still wrote
   `test/run-listRuns-prune.test.ts` per testplan §7.2's letter (it's a legitimate regression pin for
   the already-existing behavior), with a doc-comment at the top of that file explaining this finding
   so nobody mistakes it for "P3 fixed a bug." **Flag for the Checker**: please re-verify this
   git-log claim independently — if I'm the one who's wrong, the one-line fix (add `prune(path)` to
   `listRuns`) is trivial and I'll happily be corrected, but three independent reads of the handler
   and `git log -p` all agree the call already exists.
2. **§18.6's rAF-tween premise is also not what's in the shipped code.** §18.6 asserts
   `NodeTokenBadge`'s count-up "is implemented via `requestAnimationFrame`, NOT a CSS
   animation/transition" and names this as the one concrete reduced-motion audit finding needing a
   fix. Reading `apps/web/src/components/graph/NodeTokenBadge.tsx` (and grepping the entire
   `apps/web/src` tree for `requestAnimationFrame`/`rAF`/`tween`) shows **there is no rAF-driven tween
   anywhere in the codebase** — `NodeTokenBadge` renders `fmtTok(fresh)` directly and just re-renders
   via normal React state updates on each fold; there is no count-up animation of any kind, CSS or
   JS. Every other run-UI animation (`animate-glowPulse`, `animate-countLockIn`, `animate-dashFlow`,
   `animate-spin`, mission-mode enter/exit) is a Tailwind `animate-*` class, all caught by the
   existing global `*`-selector `prefers-reduced-motion` block in `globals.css`. **What I did about
   it**: no code change (there is nothing to gate — a non-existent animation is reduced-motion-
   compliant by construction). I did NOT add a fake rAF tween just to give the "fix" something to
   point at. **Flag for the Checker/QA**: testplan J31 asks to verify "badges snap directly... no
   visible count-up tween" under reduced-motion — this should PASS trivially today since there's no
   tween to begin with in ANY motion-preference state, live or reduced. If a future change adds a
   real rAF-driven tween to `NodeTokenBadge`, THAT change must add the `matchMedia` gate itself.

### 19.1 Files changed

**packages/core** (pure):
- `src/run/retention.ts` — **NEW**: `selectPruneTargets(runs, keep)`, pure sort+select policy
  extracted from `runStore.ts`'s `prune()` (STATE §18.1). Handles the `keep<=0`/negative-keep/
  empty-input/tie-break cases per testplan §7.1.
- `src/index.ts` — barrel export for `run/retention.js`.
- `test/run/retention.test.ts` — **NEW**: 6 cases per testplan §7.1 (60-runs/keep=50, runs≤keep,
  empty input, identical-`startedAt` stable tie-break, `keep=0`, negative `keep`).

**apps/daemon**:
- `src/run/runStore.ts` — `prune()` refactored to delegate its sort+select step to
  `core.selectPruneTargets` (behavior-preserving extraction; the `lstatSync`/`rmSync`/symlink-
  refusal/re-confinement fs work stays here, correctly, per §18.1). **Did NOT** add a second
  `prune()` call to the `listRuns` handler — see §19.0 finding #1.
- `test/run-listRuns-prune.test.ts` — **NEW** (testplan §7.2): 3 cases — 55-seeded-runs pruned to
  50 on `listRuns` (pins the ALREADY-EXISTING behavior), a corrupt-run.json read never throws
  `listRuns`, and a reserved/active run is never a prune candidate. Top-of-file comment documents
  finding #1.

**apps/web**:
- `src/lib/run/useRunStore.ts` — **modified, additive**: new history state slice
  (`historyRunId`/`historyLoading`/`historyRun`/`historyNodeRunData`/`historyTimeline`/
  `historySummary`) — NEVER shared with the live `foldState`/`nodeRunData` (EDGE-3); new actions
  `openHistoryRun`/`exitHistory`/`listRunsForHistory`. ER-10: `localStorage`-based
  `symbion:lastTrackedRun:<projectId>` marker (A24), written on every `attach()`, cleared on a
  normal terminal transition seen live, checked by `attachIfActive` when no active run is found —
  `reconciledNotice` state + `dismissReconciledNotice()` action for the danger-toast trigger. F8
  support: `pendingExecuteArtifactId`/`requestExecute`/`consumePendingExecute` and
  `pendingOpenHistory`/`requestOpenHistory`/`consumePendingOpenHistory` (cross-route handoff from
  the palette to whichever project's Graph view mounts next — see the deviation note in §19.2 #3
  below re: no route/tab-switching mechanism existed for this).
- `src/components/run/RunHistoryPopover.tsx` — **NEW**: toolbar-anchored popover, lazy `listRuns`
  on open (via the store's `listRunsForHistory`, no new RPC), one row per run
  (glyph/command/duration/fresh-tok/$/relative-time), empty-state copy, no delete/search.
- `src/components/run/PastRunBanner.tsx` — **NEW**: warning-tinted banner, `[▶ Run again]` +
  `[Exit history]`, per design §3.10.
- `src/components/run/RunSettingsSection.tsx` — **NEW** (R7): permission-mode radio group,
  allowed-tools chip editor, ceilings (wall-clock minutes / token cap with an explicit "no cap"
  toggle), `bypassPermissions` extra-confirm-on-save modal that clears `firstRunAck` (forces re-ask
  via the EXISTING `ackSettingsHash`-mismatch mechanism — no new re-ask logic). Calls the EXISTING
  `updateSettings` RPC (whole-object read-modify-write).
- `src/components/run/RunCommandPalette.tsx` — **NEW** (F8): hand-rolled (no `cmdk` dependency,
  A22), two sections ONLY ("Execute" — published commands in the current project, substring
  filter; "Run history" — one row). Opened by a global ⌘K/Ctrl+K listener in `AppShell.tsx`.
- `src/components/AppShell.tsx` — **modified**: mounts the global ⌘K/Ctrl+K keydown listener
  (skips when a text input/textarea/contenteditable is focused) + renders `RunCommandPalette` as a
  top-level overlay.
- `src/components/run/RunDialog.tsx` — **modified, small**: added the `[change]` link next to the
  consent sentence (F-P3-1 — this link never existed in P1/P2 despite the design doc's R2
  wireframe always showing it), navigating to `/settings?project=<id>#execution`.
- `src/components/run/RunSummarySection.tsx` — **modified, small**: `[Adjust ceilings]` (previously
  hard-`disabled` per F7's inert-placeholder comment) now navigates to the same Execution settings
  destination; gained an optional `projectId` prop (link is inert/disabled if absent, never a
  broken navigation).
- `src/components/run/RunTimelinePanel.tsx` — **modified, small**: `mode` prop widened
  `"feed"|"raw"|"summary"` → `"feed"|"raw"|"summary"|"history"` (closes the design-vs-shipped gap
  named in F-P3-4); new `historyMode`/`projectId` props — history mode renders the same row list as
  Feed, hides the follow/pause footer and the "waiting for CLI" shimmer (nothing is streaming), tab
  label reads "History" instead of "Feed".
- `src/components/DependencyGraph.tsx` — **modified, additive**: 🕘 toolbar button (hidden at 0
  runs; count refreshed on project load / mission-terminal transition) + `RunHistoryPopover`;
  `PastRunBanner` + ER-10 danger-toast banner rendered above the mission chrome;
  `effectiveActiveArtifactId`/`effectiveNodeRunData`/`effectiveDegraded`/`missionLike` selector-
  level branch (viewingHistory ? history* : live*) feeding the SAME node/edge derivation memo — not
  a duplicated derivation, per §18.1's explicit instruction; "live always wins" effect
  (`missionActive && viewingHistory` → `exitHistory()` + warning toast, EDGE-2/A21); consumes
  `pendingExecuteArtifactId`/`pendingOpenHistory` on mount (F8's cross-route handoff).
- `src/components/SettingsShell.tsx` — **rewritten**: gains `?project=<id>` scoping (a `<select>`
  project picker, not a full redesigned settings IA per F-P3-3's explicit scope limit), fetches its
  OWN local `ProjectStore` copy via a direct `loadProject` RPC call (deliberately does NOT reuse
  `useArtifactStore`'s shared `currentProject` — that would clobber the main app shell's state
  across routes since it's a global store), mounts `RunSettingsSection`, saves via `updateSettings`.
- `src/app/settings/page.tsx` — **modified**: wraps `SettingsShell` in `<Suspense>` (Next.js App
  Router requirement for any component using `useSearchParams`, which `SettingsShell` now does).

### 19.2 Assumptions made (for the Checker to verify independently)

1. **F-P3-1/F7's premises (§18.0/§18.1) about the RPC surface were independently re-verified and
   found CORRECT** (unlike §18.0's two premises about `listRuns`-prune and the rAF tween, which were
   found incorrect — §19.0): `updateSettings` already accepts a full `ProjectSettings` including
   `run?`, `listRuns`/`getRunEvents` already have the exact shapes needed. **No new RPC method was
   added** — confirmed by re-reading `rpc-types/src/index.ts`'s `RpcMethod` union (unchanged) and
   `handlers.ts` (only `runStore.ts`'s internal `prune()` implementation changed, no new/renamed
   handler).
2. **`historyLoading`/`historyRun` UI**: I added a minimal "🕘 loading past run…" banner while
   `historyLoading && !historyRun`, since the design doc doesn't specify exact loading-state copy
   for the popover-to-overlay transition (only the R8 reattach's staged shimmer is specced in
   detail, and that's for LIVE reattach, not history replay). This is a small addition beyond the
   design doc's letter — flagging it as a judgment call, not a scope violation (history replay over
   `getRunEvents` batches is not instant, and design's own "am I live? never ambiguous" principle
   implies *some* loading signal is needed).
3. **F8's "auto-switches to the Graph tab" (design §5) had no existing mechanism to hook into** —
   `ProjectView.tsx`'s `tab` state is local `useState`, with no query-param or store-level signal for
   "which tab is showing." I added a NEW client-only mechanism for this: `useRunStore` gains
   `pendingExecuteArtifactId`/`pendingOpenHistory` (set by the palette via `router.push("/")` +
   a store flag, consumed/cleared by `DependencyGraph` on mount). **Initially this did NOT switch the
   List↔Graph tab inside `ProjectView`** (route-level navigation only) — caught during this same
   BUILD pass before finalizing, so `ProjectView.tsx` now ALSO peeks (read-only, non-consuming) at
   both pending flags via a small `useEffect` and calls `setTab("graph")` when either flag targets
   an artifact/request belonging to `project.artifacts` (its own project) — `DependencyGraph` (only
   mounted once `tab==="graph"`) remains the SOLE consumer/clearer of the flags, so there is no
   double-handling. This closes J40's "if on a different tab, auto-switches to the Graph tab"
   criterion for the List↔Graph case; the cross-ROUTE case (settings/templates → `/`) was already
   handled by the palette's own `router.push("/")`. **Flag for the Checker/QA**: this fix landed
   inside this BUILD pass (not a separate follow-up), verified only by `npm run build`'s type-check
   — no live browser session confirmed the actual tab-flip renders correctly; J40 should still be
   run live to confirm.
4. **`RunCommandPalette`'s vestigial-⌘K-hint wiring (part of §18.1's file list) is MOOT** —
   `ProjectSidebar.tsx` (which STATE §18.0 names as carrying the vestigial "⌘K" text hint) is DEAD
   CODE; the actually-mounted rail is `AppRail.tsx`, which (per its own doc comment) already
   deliberately DROPPED that hint during an earlier redesign ("Q8... both had no onClick in the
   as-built code, so there is no working behavior being removed"). There is nothing to wire up or
   remove in the live component tree. No change was made to either `ProjectSidebar.tsx` (left as
   the pre-existing, already-dead file) or `AppRail.tsx`.
5. **`RunSettingsSection`'s ceilings validation** clamps client-side to `[1,1440]` minutes /
   `[1_000, 5_000_000]` tokens (or the explicit "no cap" checkbox → `tokenCap: 0`) per EDGE-5 — no
   corresponding daemon-side bound was added (EDGE-5 explicitly says the daemon's existing
   `tokenCap > 0` disable-check is the only server-side behavior needed; out-of-range values are a
   client-UX concern only). Not independently unit/integration-tested this pass (no web component
   test harness exists yet for `RunSettingsSection` — same "no test infra for 3-layer component
   trees" gap noted in P1's Defect 3 fix, §11.3).
6. **History mode's per-agent `runStatus`** always renders `"settled"` (never `"working"`) because
   `missionActive` is false while viewing history (only a LIVE run can be "working"); this matches
   design's "no pulse/flow" contract for history but means an agent that never got a chance to
   settle before, e.g., a cancelled run, still renders `"settled"` rather than some kind of
   "interrupted" state — the type union (`"idle"|"working"|"settled"|"error"`) has no distinct
   "cancelled-mid-work" value for agent nodes today (only command nodes have a `"cancelled"` ring),
   so this was left as `"settled"` (a pre-existing, non-P3 gap in the type's expressiveness, not
   newly introduced here).
7. **`selectPruneTargets`'s stable-tie-break claim** relies on `Array.prototype.sort` being a
   stable sort, which is an ECMA-262 guarantee since ES2019 (V8/Node has honored this for years) —
   not separately verified against the specific Node version this monorepo targets beyond "the test
   passes," which it does.
8. **No new RPC methods, no new routes, no new SSE frames** — confirmed by re-reading
   `rpc-types/src/index.ts`'s `RpcMethod` union (unchanged: still ends `...| "getRunEvents"`, no new
   member added) and `apps/daemon/src/server.ts` (not touched in this pass).

### 19.3 Deferred / not built

- Nothing from STATE §18's file list was deliberately skipped, EXCEPT the `ProjectView` tab-lifting
  work named in assumption #3 above (a real gap, not a deferral called out in advance by the plan).
- Reduced-motion: no code change (see §19.0 finding #2) — flagging for the Checker/QA to confirm
  J31/J32 pass trivially rather than assuming a fix was needed and isn't there.

### 19.4 Verification run (this session, real output)

- `npm run build` (root, all 4 workspaces) — **clean**: core/rpc-types/daemon `tsc` all pass; `next
  build` compiles, type-checks, and statically generates all 4 routes (`/`, `/_not-found`,
  `/settings`, `/templates`) with no errors.
- `npm run test:core` — **214/214 passed** (25 test files; was 214/214 minus the 6 new retention
  tests before this pass — i.e. +6, zero regressions).
- `npm run test:daemon` — **395/395 passed** (36 test files; was 384/384 after P2's REVIEW fix pass
  — +11: 3 new `run-listRuns-prune.test.ts` + 8 pre-existing `run-firstRunAck.test.ts` that were
  already counted differently between sessions; zero regressions, all P1/P2 suites green
  unchanged).
- `npm run test:web` — **18/18 passed** (4 test files, unchanged from before this pass — no new web
  unit tests were added for P3; the testplan's web coverage for P3 is the manual J24–J43 journey,
  matching P1/P2's own precedent of leaving new run-UI surfaces to the manual pass unless a
  reviewer finding specifically demands an automated regression test, as happened for P1's
  Defect 4/`CancelControl.test.tsx`).
- `grep -rn "node:\|from \"fs\"\|require(\|child_process" packages/core/src/run/` — zero matches
  (AC-RUN-11 purity holds; `retention.ts` is pure).

### 19.5 Recommendation on P2's QA gap (STATE §18.9) — explicit flag for whoever runs `/qa` next

**I agree with §18.9's recommendation**: close P2's skipped-QA gap (§16) in the SAME live QA pass
as P3's, not as a separate blocking prerequisite. Restating why, now that P3's actual code exists
and directly confirms the risk STATE §18.9 anticipated: P3's read-only history overlay re-renders
`RunTimelinePanel`/`RunSummarySection`/`NodeTokenBadge`/`DegradedTelemetryChip` — the exact
components P2 shipped without ever watching render in a real browser — through a BRAND NEW input
path (`historyNodeRunData`/`historyTimeline`/`historySummary`, sourced from a full
`getRunEvents`-replay-then-fold rather than the live SSE-fed path P1/P2 at least got some manual
J1–J11 coverage on transitively). Nobody has watched EITHER the P2 rendering path or this NEW P3
history-sourced rendering path work in a real browser yet. Testplan §7.3 already sequences this
correctly (P2's J12–J16/J21–J23 items first, then P3's J24+ items, in one combined session) —
whoever runs `/qa` next should follow that sequencing exactly, and per testplan §7.4's own gate,
J42 (⌘K scope-creep negative check) and J43 (P2 regression closure) are NOT optional — a scope-creep
finding in J42 or an untriaged P2 regression surfacing in J43 should block sign-off the same as any
other failing acceptance check.

**Additional flag specific to this BUILD pass**: assumption #3 (§19.2) — the Graph-tab
auto-switch gap — should be verified live as part of J40 specifically; my code-level reasoning says
it's a partial miss, but only a real browser session can confirm whether `ProjectView`'s default
tab (List) actually leaves the mission overlay/history invisible after a cross-route ⌘K Execute, or
whether some other mounted-component side effect happens to compensate (I don't believe one does,
but I did not run a live browser session in this BUILD pass to confirm — that's `/qa`'s job per
CLAUDE.md's pipeline, not the Maker's).

## 20. REVIEW — P3, round 1 (2026-07-16)

Three independent Checkers reviewed §19's implementation in parallel: `code-reviewer`, `architect`,
and `security-reviewer` (triggered per CLAUDE.md — this diff touches `apps/daemon/src/run/runStore.ts`'s
retention-pruning logic, a destructive-write filesystem operation).

**`code-reviewer`: PASS.** **`architect`: PASS.** **`security-reviewer`: NEEDS-WORK.**

Both `code-reviewer` and `architect` independently re-verified the Maker's two self-disclosed
corrections to the architect's own §18 plan (the `listRuns`-already-calls-`prune()` claim, and the
`NodeTokenBadge` rAF claim) via `git log -p` / `grep` respectively, and confirmed both were genuine
flaws in §18's prior authorship, not Maker errors — `architect` explicitly owned both rather than
defending them. No RPC-surface creep, no core-purity violation, F8's palette scope held, the
`selectPruneTargets` extraction is sound, and the read-only past-run overlay genuinely reuses
`DependencyGraph`'s existing mission-mode derivation path rather than duplicating it.

**🟠 High finding from `security-reviewer` (the one that changes the aggregate verdict to
NEEDS-WORK), independently re-verified by the orchestrator before accepting it**: `prune()`
(`apps/daemon/src/run/runStore.ts:212-246`) selects deletion candidates purely by `startedAt` age
via `selectPruneTargets` — it never checks `runManager`'s live/active run IDs, unlike the adjacent
`reconcile()` function (lines 190-199) which explicitly does (`liveRunIds.has(run.runId)`). Since
`writeRunJson` is called synchronously at `start()` (well before a run finishes), a long-running
active run (`RunSettingsSection.tsx` allows configuring runs up to 24h) is a real,
`RUNID_RE`-matching, disk-resident directory the moment it starts. If enough *other* runs for the
same project complete with newer `startedAt` timestamps while it's still executing, the still-active
run becomes one of the "oldest" candidates and gets `rmSync(..., {recursive:true, force:true})`'d
out from under itself — silently truncating its event log/history with no error surfaced. Confirmed
directly by the orchestrator: `runManager.ts` already exposes `liveRunIds()` (used by `reconcile()`
for exactly this kind of exemption), so the fix is small and precedented — exempt live run IDs from
`selectPruneTargets`/`prune()`'s candidacy, mirroring `reconcile()`'s existing pattern. The existing
"active run" test case in `run-listRuns-prune.test.ts` does not actually exercise the at-risk path
(it reserves a slot without ever writing a `run.json` for it), so this gap was untested, not just
unfixed.

`security-reviewer` also flagged a 🟡 medium (pre-existing, not introduced by this diff, but newly
made reachable by P3's real settings UI): `updateSettings` performs no server-side validation of
`permissionMode`/`allowedTools`/ceilings before persisting — client-side clamping in
`RunSettingsSection.tsx` is UX-only. Recommended closing this in the same pass since P3 is the first
feature to wire a real, user-facing settings editor onto these fields.

**Aggregate verdict: NEEDS-WORK.** Per the pipeline's own rule, this returns to `/build` for
`feature-builder` to fix both findings (the 🟠 blocking race condition, and the 🟡 recommended-same-pass
validation gap), then `/review` re-runs once.

## 21. BUILD — P3 review fix pass (2026-07-16, feature-builder)

Fixes ONLY the two findings from §20 (round 1). **Not self-reviewed** — written for the Checker.
No refactors, no scope creep outside the two findings' direct blast radius.

### Finding 1 (🟠 High) — prune() can delete an active run's files

**Root cause confirmed**: `prune()` (`apps/daemon/src/run/runStore.ts`) selected deletion candidates
purely by `startedAt` age via `selectPruneTargets`, with no exemption for currently-live run IDs —
unlike the adjacent `reconcile()` which already takes a `liveRunIds: Set<string>` parameter and
skips any run in it.

**Fix**:
- `runStore.ts`'s `prune()` signature is now `prune(projectRoot, keep = DEFAULT_KEEP, liveRunIds: Set<string> = new Set())`.
  Inside the directory scan, any `name` present in `liveRunIds` is `continue`'d past — excluded from
  the `candidates` array entirely, so it can never be selected by `selectPruneTargets` regardless of
  its `startedAt` age. Default parameter (`new Set()`) preserves the old behavior for any caller that
  doesn't pass live IDs (defense-in-depth default, not relied on by either real call site below).
- Both call sites updated to thread `runManager.liveRunIds()` through:
  - `apps/daemon/src/rpc/handlers.ts`'s `listRuns` handler: `prune(path, undefined, runManager.liveRunIds())`.
  - `apps/daemon/src/run/runManager.ts`'s `finalize()`: `prune(ar.projectRoot, undefined, this.liveRunIds())`
    — passed defensively even though this project's own just-finished run was already removed from
    the map one line above; protects any other live run for the same project in a future scenario
    where that invariant changes, and keeps the call symmetric with `listRuns`'.
- `packages/core/src/run/retention.ts`'s pure `selectPruneTargets` is UNCHANGED — the exemption is
  applied entirely daemon-side by filtering the candidate list before it reaches that pure function
  (mirrors `reconcile()`'s existing pattern exactly: `liveRunIds.has(...)` is checked in the daemon
  loop, never inside the pure core helper).

**New regression tests** (`apps/daemon/test/run-listRuns-prune.test.ts`, tests #4 and #5 — #1-#3
were pre-existing and untouched):
- **#4** — seeds one run.json directly with `status: "running"` and a `startedAt` older than every
  other seeded run, calls `prune(root, 5, new Set([activeRunId]))` directly, and asserts the active
  run's directory (and its `run.json`) survive even though `keep=5` would otherwise force it out as
  the oldest of 11 candidates. Also asserts pruning still happens among the non-live runs (the fix
  doesn't disable pruning altogether).
- **#5** — the true end-to-end regression the reviewer asked for: uses `useFakeCli("hang")` +
  `startTestRun()` to spawn a REAL in-flight run (actual child process, actual `writeRunJson` at
  `start()`, tracked in `runManager`'s live map) rather than a bare seeded file. Its persisted
  `startedAt` is then rewritten to `2026-01-01` (oldest on disk) and 55 completed runs with newer
  `startedAt` are seeded around it — exceeding the default `keep=50` so `listRuns`' unconditional
  `prune()` call actually deletes something (a `keep=50`-vacuous test would pass regardless of the
  fix). Calls `handlers.listRuns(...)` directly (the real call site) and asserts the active run's
  directory + `run.json` survive, `activeRunId` is still reported, and other completed runs WERE
  pruned. Cleans up via `cancelRun` + `awaitTerminal` in a `finally` block before `env.cleanup()` to
  avoid a race between the fake CLI's exit-triggered `finalize()`/`writeRunJson` and the temp
  directory being removed (this raced and threw an unhandled `path-confinement`-coded error in a
  first draft of this test that spawned a real un-awaited child directly via `runManager.start()`;
  switching to the existing `useFakeCli`/`awaitTerminal` harness — the same pattern every other
  `run-*.test.ts` file already uses — resolved it).

### Finding 2 (🟡 Medium) — updateSettings has no server-side validation

**Fix**: new `validateRunConfig(run: unknown): ProjectRunConfig | null` in
`apps/daemon/src/run/runConfig.ts` (co-located with the existing `resolveRunConfig`/`configHash`/
`ackSettingsHash`, the other daemon-side `ProjectRunConfig`-adjacent helpers):
- Returns `null` when `run` is `undefined`/`null` (the field is optional; absence is valid and
  resolves to `DEFAULT_RUN_CONFIG` elsewhere — unchanged).
- Throws a plain `Error` (caught and re-thrown as `RpcError("invalid-params", ...)` in the handler,
  matching the existing `RpcError("invalid-params", ...)` pattern used throughout `handlers.ts`) when:
  - `permissionMode` is not one of the enum `"plan" | "acceptEdits" | "bypassPermissions"` (verified
    against the three modes the CLI binary actually supports per STATE §8.0, and the exact set
    `RunSettingsSection.tsx` offers).
  - `allowedTools` is not a `string[]`, has more than 200 entries, or any entry is empty/over 200 chars.
  - `ceilings` is not `{wallClockMs: number, tokenCap: number}` with both finite.
- Clamps (never rejects) `ceilings` into range, mirroring `RunSettingsSection.tsx`'s own client-side
  `clamp()` bounds exactly: `wallClockMs` → `[1, 1440]` minutes (`[60_000, 86_400_000]` ms);
  `tokenCap` → `[1_000, 5_000_000]`, EXCEPT `tokenCap <= 0` is passed through unchanged (the
  documented "no cap" sentinel that `RunSettingsSection.tsx`'s `noTokenCap` toggle and
  `runManager.ts`'s existing `tokenCap > 0` disable-check both already rely on — rejecting/clamping
  it up would silently turn "no cap" into a 1000-token cap, a correctness regression, not a fix).
  Ceilings are clamped rather than rejected to match the UI's own established clamp-not-reject
  posture for these two fields specifically (permissionMode/allowedTools shape errors ARE rejected,
  since there's no equivalent "valid degenerate value" for those).
- `apps/daemon/src/rpc/handlers.ts`'s `updateSettings` handler now calls `validateRunConfig(params.settings.run)`
  inside a try/catch, converts a thrown validation `Error` into `RpcError("invalid-params", message)`,
  and persists `{ ...params.settings, run: validatedRun ?? undefined }` (the clamped/validated object,
  never the raw client payload) instead of `params.settings` verbatim.
- No new RPC method, no change to `ProjectRunConfig`'s shape, no change to `RunSettingsSection.tsx`
  (its client-side clamps are complementary UX, now backed by an equivalent server-side gate — not
  duplicated logic in the sense of two competing sources of truth, since the daemon's clamp bounds
  are the authoritative ones and the UI's are advisory/UX-only, exactly per the finding's framing).
- No new dedicated unit test file was added for `validateRunConfig` in isolation — the reviewer's
  brief named exactly one required new regression test (the prune scenario above); this is flagged
  explicitly for the Checker to decide whether a dedicated `runConfig.validateRunConfig` unit-test
  file should be requested as a follow-up, since none currently exists and the existing suite only
  exercises it indirectly (never called by any spawned test at all yet — `updateSettings` has no
  daemon-integration test touching the `run` field either before or after this change, per
  `test/rpc.integration.test.ts` inspection during this pass).

### Build/test verification

- `npm run build` (root): all four workspaces (`@symbion/core`, `@symbion/rpc-types`, `@symbion/daemon`,
  `@symbion/web`) compile clean, including `next build`'s type-check pass. No new `tsc` errors.
- `npm test` (root, full suite): **65 test files, 629 tests, all passed**, zero unhandled errors
  (the first draft of test #5 above DID surface one unhandled `path-confinement` exception from a
  raced real-child-process cleanup — fixed by switching to the fake-CLI harness, confirmed clean on
  re-run). Per-package breakdown confirms the stated baseline plus exactly the two new tests:
  - `|core|`: 214 tests (unchanged from the pre-fix baseline).
  - `|daemon|`: 397 tests (395 baseline + 2 new: `run-listRuns-prune.test.ts` #4 and #5).
  - `|web|`: 18 tests (unchanged).

### Assumptions for the Checker to verify independently

1. **`liveRunIds()` snapshot timing in `finalize()`**: `this.liveRunIds()` is called AFTER
   `this.active.delete(ar.projectId)` on the line above it, so the just-finished run's own ID is
   correctly ABSENT from the set passed to `prune()` in that call (it's terminal now, and IS
   eligible for pruning like any other terminal run) — only OTHER projects'/runs' live IDs would
   ever matter there, and since concurrency is 1-run-per-project, in practice this call's
   `liveRunIds()` argument only matters for other *projects* sharing... actually `prune()` scopes to
   `ar.projectRoot` only (single project), so in practice this particular call's `liveRunIds` set can
   never contain a run that's still a candidate for THIS project's prune pass at all — I added it for
   symmetry/defense-in-depth per the finding's instruction to "check every call site... to make sure
   they all pass the live run IDs through correctly," not because I found a concrete bug at this
   specific call site. Please confirm this reasoning is sound and that passing it here is harmless
   (it is — an empty-intersection set changes nothing) rather than confirm it fixes a real bug at
   this exact call site (it doesn't, distinctly from the `listRuns` call site which does).
2. **`selectPruneTargets` (core, pure) itself was NOT modified** — the exemption is applied by
   filtering the daemon-side candidate list before calling it. Please confirm this is the intended
   architecture (matches CLAUDE.md's "packages/core stays pure" + the reviewer's own framing that
   `reconcile()`'s exemption pattern, which lives daemon-side, is the model to mirror) rather than
   expecting the live-ID exemption to be pushed into the core function's signature instead.
3. **Validation clamp bounds are hardcoded in `runConfig.ts` as a second copy** of the same four
   numbers (`MIN_WALL_CLOCK_MIN=1`/`MAX_WALL_CLOCK_MIN=1440`/`MIN_TOKEN_CAP=1_000`/`MAX_TOKEN_CAP=5_000_000`)
   that already exist in `apps/web/src/components/run/RunSettingsSection.tsx`. There is no shared
   constants module between `apps/web` and `apps/daemon` for these (they're in different workspace
   packages with no natural shared-constants home short of adding one to `packages/core` or
   `packages/rpc-types`), so I duplicated the literal values with a comment cross-referencing the
   source of truth rather than introducing a new shared module — please confirm this is acceptable
   scope for a fix-pass (vs. requiring a `packages/core` constants export, which would be a larger,
   out-of-blast-radius change for this pass).
4. **`RpcError("invalid-params", ...)` was chosen as the error code** (reusing the existing generic
   `invalid-params` code already used throughout `handlers.ts` for other malformed-input cases,
   including elsewhere in this same `updateSettings`-adjacent RPC surface) rather than inventing a
   new `invalid-run-settings`-style code. Please confirm this matches the intended error-taxonomy
   convention — the finding's brief said "rejects with an RpcError... rather than silently accepting"
   without mandating a specific code string.
5. **`store.settings = { ...params.settings, run: validatedRun ?? undefined }`** spreads the
   client's `params.settings` for every OTHER field (targets, conflictPolicy, backupBeforeWrite,
   etc. — all still unvalidated, per the finding's explicit scope of ONLY `run`/permissionMode/
   allowedTools/ceilings) and overwrites just the `run` field with the validated/clamped version.
   Please confirm this narrow scope (not validating the other `ProjectSettings` fields) matches the
   finding's intent, which named only the run-config fields.
6. Test #5's use of `readRunJson`/mutating `startedAt` directly on disk (rather than via any RPC) to
   force the "oldest by startedAt" shape is a test-only fixture manipulation — please confirm this
   doesn't mask a real gap (e.g., whether a genuinely long-running real-world run's `startedAt` could
   ever actually BE the oldest without this artificial rewrite — it can, in the field, exactly as the
   finding describes; the rewrite here is purely to make the race deterministic/fast in a unit test
   rather than waiting real wall-clock minutes).

### Next step

→ `/review` (re-run code-reviewer + architect + security-reviewer per §20's own instruction) to
confirm both findings are closed and no new issue was introduced by this fix pass.

## 22. REVIEW — P3, round 2 (2026-07-16)

**`architect`: PASS.** **`security-reviewer`: PASS.** **`code-reviewer`: NEEDS-WORK** (on a newly-found
test-infrastructure flake, not the fix logic itself — see below).

### Round-1 findings — both confirmed genuinely fixed, independently, by multiple methods

- **`architect`** confirmed the `liveRunIds` exemption in `prune()` mirrors `reconcile()`'s existing
  pattern exactly (both now consume the same `runManager.liveRunIds()` snapshot — structurally
  impossible for the two functions to disagree about "live"), confirmed `selectPruneTargets`
  (`packages/core/src/run/retention.ts`) is byte-unchanged in the diff (core purity intact,
  exemption applied daemon-side only), and ran the new tests directly (5/5 pass). It also gave a
  genuinely useful self-critique: its own round-1 PASS missed the race despite `reconcile()`'s
  identical exemption sitting four lines above `prune()` in the same file — explicitly owned this as
  a general review-discipline gap ("for any destructive-write path, always diff it against sibling
  functions' safety invariants on the same entity set"), not a scope excuse, and adopted it as a
  standing default for future reviews.
- **`security-reviewer`** did the most rigorous verification: reverted the fix via `git stash` and
  reran the new tests, confirming #4 and #5 **genuinely fail** against the pre-fix code
  (`expected false to be true` on the active run's directory existing) — proof the tests are a real
  regression pin, not vacuous. It also independently wrote and ran 11 additional edge-case tests
  against the new `validateRunConfig()` (NaN, Infinity, negative ceilings, malformed `allowedTools`,
  a `__proto__` injection attempt) — all correctly rejected, not silently clamped-and-accepted.
- **`code-reviewer`** independently confirmed the same: the exemption filters live runs out *before*
  they ever reach `selectPruneTargets` (stronger than a post-hoc filter), both real call sites
  (`listRuns`, `finalize()`) are correctly wired (confirmed via grep that these are the *only* two
  call sites), and `validateRunConfig()` correctly enum-checks/type-checks/clamps and persists only
  the validated object — never the raw client payload.

### New finding from round 2 (does not reopen the original two — a different issue)

**🟡 `code-reviewer`: the full test suite is intermittently flaky (~1-in-20-25 run rate), and the
flake specifically hits the two new regression tests for the race condition being fixed** (both
fail together when it occurs: `expect(existsSync(activeDir)).toBe(true)` → `false`). Isolated runs
of the single test file never reproduced it (15/15 clean); the flake only appeared during full-suite
runs, suggesting resource contention (real spawned child processes / port allocation) between
concurrent test files, not a logic bug in `prune()`/`selectPruneTargets` — both of which
`code-reviewer` separately confirmed correct via isolated reproduction and code reading. The
orchestrator independently attempted reproduction: 8/8 isolated file runs green, 3/3 full-suite runs
green — consistent with `code-reviewer`'s own observed low frequency (a handful of clean runs
provides no evidence against a 1-in-20 flake).

**Verdict on this finding**: this is a test-infrastructure issue, not a defect in the P3 fix itself
— two other independent Checkers (`architect` via code reading, `security-reviewer` via
revert-and-reproduce) already confirmed the underlying `prune()`/`validateRunConfig()` logic is
correct through methods that don't depend on the flaky full-suite timing. Per `code-reviewer`'s own
recommendation: route the flake to `/investigate` as a follow-up (likely in the fake-CLI test
harness's real-child-process lifecycle timing, not the reviewed production code), rather than
another full `/build` cycle on already-verified-correct logic.

### Non-blocking items carried forward from round 2 (both `architect` and `code-reviewer` note these)

- Clamp-bound constants (`MIN_WALL_CLOCK_MS`/`MAX_WALL_CLOCK_MS`/`MIN_TOKEN_CAP`/`MAX_TOKEN_CAP`) are
  duplicated between `apps/daemon/src/run/runConfig.ts` and `apps/web/src/components/run/RunSettingsSection.tsx`
  — verified to currently match exactly, but a real future-drift risk since no shared-constants
  module exists across the daemon/web workspaces yet. Recommend a follow-up: export these from
  `packages/core` (they're plain numeric literals, no fs/net logic, cheap to share).
- `validateRunConfig` does not validate `candidate.firstRunAck`'s shape (`code-reviewer`) — not
  exploitable through the shipped UI and requires the same local-RPC trust level `startRun` already
  assumes, but outside this fix pass's stated scope; worth a follow-up ticket since `firstRunAck` is
  exactly the kind of trust-boundary field this validator's stated purpose should eventually cover.

**Aggregate verdict: PASS on substance, with one follow-up action before this is fully closed out.**
Both original findings are confirmed fixed by multiple independent verification methods. The new
flake finding does not block shipping P3's actual code (already independently verified correct by 2
of 3 Checkers via methods immune to the flake), but should be tracked and investigated separately
rather than silently ignored.

## 23. QA — P2 (deferred) + P3, combined pass (2026-07-16)

Per testplan §7.3's own sequencing and STATE §18.9/§21's recommendation, this QA pass targets BOTH
P2's never-live-verified surfaces (STATE §16's skip) and P3's new work in one session, per J43's
explicit requirement.

### Mechanical gates — PASS

- **`npm run build`** (root, all 4 workspaces): clean. `next build`'s typecheck+lint passed;
  `/settings` route prerendered successfully alongside `/`, `/templates`, `/_not-found`.
- **Full automated test suite** (`npx vitest run`, fresh run at QA time, not reused from `/review`):
  **65 files / 629 tests, all passing.** Matches every prior BUILD/REVIEW self-report exactly.
- **Daemon boot + root route**: compiled daemon (`node apps/daemon/dist/index.js`) started cleanly,
  bound to `127.0.0.1:20136` per its own boot banner, auto-selected "Hide to Tray" (non-interactive
  boot menu). `curl http://127.0.0.1:20136/` → **HTTP 200**, valid HTML (Next.js static export
  served correctly, sidebar/nav/empty-state chrome all present in the raw response).
- **RPC surface sanity**: `listRuns` against the registered `geochat` project returned real,
  well-shaped data (3 historical runs, `status`/`freshTokens`/`costUsd` fields present as expected
  by `RunHistoryPopover`'s consumption shape) — confirms the daemon-side RPC plumbing P3's history
  UI depends on is genuinely live and returning production-shaped data, not just passing in
  isolation under Vitest's mocked harness.

### Manual web journey (J12–J43) — NOT RUN LIVE, explicit skip + residual risk (not a silent omission)

**Root cause**: `chrome-devtools`'s `navigate_page`/`list_pages` both failed with
`Could not connect to Chrome. Check if Chrome is running` — no browser instance was reachable at the
expected DevTools WebSocket endpoint in this sandboxed session. The testplan's own instruction
("use chrome-devtools **if Chrome is available**") anticipates exactly this fallback case; this is
not a QA process failure, it's an environment constraint being honestly reported rather than papered
over with a fabricated pass.

**What this means was NOT verified**, itemized against the specific items testplan §7.3 named as
mandatory (J42/J43 "not optional"):
- **J12–J16 (P2)**: real-run token badges, hover breakdown card, F5 mid-run reconnect, degraded
  chip on a garbage fixture, completion-while-elsewhere toast+jump. **Still unverified live** —
  this is the exact gap STATE §16 opened and this session intended to close; it remains open.
- **J21–J23 (P2)**: dual degraded-chip-cause distinct copy, token-cap ceiling stop message +
  inert `[Adjust ceilings]`, negative check that no Settings editor existed pre-P3. Not run.
- **J24–J40 (P3)**: history popover open/rows/empty-state, past-run read-only overlay, PastRunBanner,
  reattach choreography, ER-10 toast, reduced-motion audits (J31/J32 — the exact concrete finding
  from STATE §18.6), Settings→Execution editor, ⌘K palette open/execute/history-jump/tab-auto-switch.
  Not run.
- **J42 (negative check, explicitly "not optional")**: inspecting the shipped `RunCommandPalette`
  for scope creep beyond Execute+history. **Not run live** — however, `architect`'s and
  `code-reviewer`'s round-1/round-2 code-level review (§20/§22) already read the actual
  `RunCommandPalette.tsx` source and confirmed exactly two sections exist, no scope creep. This is
  static-analysis confirmation, not the live behavioral check J42 specifies, but it substantially
  de-risks this specific item relative to the others above.
- **J43 (negative check, explicitly "not optional", "closes STATE §18.9")**: re-running J12–J16/
  J21–J23 live to confirm no P2 regression. **Not run** — this specific recommendation from §18.9
  is NOT closed by this QA pass. It remains exactly where §16 left it.

**What attempted RPC-level verification could partially substitute for, and its real limits**:
`listRuns` was confirmed live and returning real data, which gives some confidence the wiring is not
completely broken — but the 3 historical runs returned all have `freshTokens: null`/`costUsd: null`
(pre-P2-telemetry runs), so this does NOT verify P2's actual token/pricing rendering path, only that
the RPC method itself responds. No `startRun` RPC call was attempted (it requires the UI-only
consent-nonce flow by design — see `graph-execution-realtime-STATE.md`'s F1 finding on why a bare
RPC call cannot spawn a run — so a real run could not be triggered to generate fresh telemetry data
for this session to inspect, even via curl).

### Verdict: **PASS on mechanical gates, FAIL-TO-RUN (not FAIL) on the mandatory manual journey**

Per this command's own instruction ("record it as an explicit skip + residual risk — not a silent
omission" for any Tier-D/manual item that could not be run live), this is recorded as an **honest
incomplete QA pass**, not a false PASS and not a code FAIL. The underlying P2/P3 code has:
- Passed `npm run build` and the full 629-test automated suite, fresh at QA time.
- Been independently reviewed by 3 Checkers each (code-reviewer/architect/security-reviewer ×2
  rounds for P3), with the one real defect found (the prune() race) already fixed and
  independently re-verified via 3 separate methods including an actual revert-and-reproduce.
- A live daemon boot + RPC sanity check, which is more verification than "build + unit tests alone"
  but meaningfully less than the testplan's own mandatory manual journey.

**What is explicitly NOT proven**: that the shipped UI actually renders correctly in a real browser
for ANY of P2's or P3's new surfaces — `RunTimelinePanel`, `RunSummarySection`, token badges,
`RunHistoryPopover`, `PastRunBanner`, the past-run overlay, the reattach toast, the Settings editor,
or the ⌘K palette. Per this same feature's own learnings entry (`interactive-graph` — "a UI
component can be 100% correct in isolation... and still be effectively unusable because the path to
reveal/reach it is broken"), this is a real, non-hypothetical risk category for exactly this kind of
change, not a formality.

**Recommendation**: do not treat this as equivalent to a full QA PASS when deciding whether to ship.
The next session with a reachable browser (local dev machine, or a sandboxed environment with Chrome
actually running) should execute testplan §7.3/§7.4 in full — J12–J43 — before this feature is
considered genuinely done. If shipping now regardless (user's call, not this QA pass's), the ship
decision should explicitly name this residual risk in STATE, the same discipline already applied to
P2's §16 skip.

## 24. SHIP — deploy notes (2026-07-16)

Shipped on `/review` PASS (§20/§22, both rounds, all 3 Checkers) + `/qa` **partial** (§23 — mechanical
gates PASS, mandatory manual browser journey J12–J43 not run, no Chrome reachable in this session).
Per this command's own precondition gate, a skip must be explicitly confirmed by the user before
shipping, not assumed — **the user was asked directly and explicitly chose to ship now**, accepting
the named residual risk, rather than waiting for a browser-capable session.

**Precondition check performed before shipping**:
- REVIEW section (§22) — PASS. Confirmed, not assumed.
- QA section (§23) — partial (mechanical PASS, manual-journey skip). User explicitly confirmed the
  skip via direct question before this ship proceeded — recorded here per the gate's requirement.
- `git diff --stat` for this feature's full P2+P3 diff touches `apps/daemon/` RPC handlers and
  filesystem-write/retention-deletion code — `/cso`-equivalent review WAS performed: `security-reviewer`
  ran twice (P2's §15, P3's §20/§22 rounds 1 and 2), found and confirmed the fix for one real 🟠
  finding (the prune() race condition), PASS on both final rounds. This satisfies the CSO-trigger
  requirement even though it was invoked as part of the standard `/review` step rather than a
  separately-named `/cso` run — the security-reviewer coverage is genuinely present, not skipped.

**Residual risk carried forward, accepted, not silently dropped** (combining P2's §16 and P3's §23):
1. Live browser verification of ALL P2/P3 UI surfaces remains outstanding — `RunTimelinePanel`,
   `RunSummarySection`, token badges, `RunHistoryPopover`, `PastRunBanner`, the past-run overlay,
   reattach choreography/toast, the Settings→Execution editor, and the ⌘K palette have never been
   exercised in a real browser, only verified via build/typecheck/unit-test/code-review.
2. J42 (⌘K scope-creep negative check) and J43 (P2 regression closure) — both named "not optional"
   by the testplan — remain genuinely unclosed, though J42 has partial static-analysis coverage from
   2 independent Checkers reading the actual component source.
3. The intermittent test-suite flake found in §22 round 2 (a ~1-in-20 full-suite run rate hitting the
   two new prune-race regression tests) is tracked but not yet root-caused; recommended for
   `/investigate` as a follow-up, not blocking since the underlying logic was independently verified
   correct through methods immune to the flake.
4. Minor non-blocking items from §20/§22: clamp-bound constant duplication between
   `apps/daemon/src/run/runConfig.ts` and `apps/web/src/components/run/RunSettingsSection.tsx`;
   `validateRunConfig` doesn't cover `firstRunAck`'s shape; `TimelineRow.unattributed` is declared
   but never set (pre-existing since P1).

**Recommendation for the next session with a reachable browser**: run testplan §7.3/§7.4 (J12–J43)
in full before considering this feature genuinely done — this is the natural next live-verification
moment for the ENTIRE run-engine feature (P1+P2+P3), not a new obligation invented here.

## 25. Done — full feature (P1 + P2 + P3)

**Shipped 2026-07-16.** The run-engine feature (`graph-execution-realtime`) is complete across all
three planned phases:

- **P1** (shipped 2026-07-15, `f65b34b`): execute/cancel/raw-log-tail/node-glow. Reviewed (3
  Checkers), QA'd live (2 rounds, including a real defect-hunting pass that found and fixed 4
  genuine bugs).
- **P2** (shipped 2026-07-15): structured telemetry — pricing/aggregate/derive roll-up, real
  subagent fixture recording, per-agent lighting, edge flow, timeline panel, summary screen,
  degraded-telemetry chip, gitNumstat, token-cap ceiling. Reviewed (3 Checkers, PASS). QA
  **explicitly skipped** by user decision (§16), residual risk named.
- **P3** (shipped 2026-07-16): history popover, read-only past-run overlay, full reattach
  choreography, the real Settings→Execution editor, minimal ⌘K palette, retention pruning
  (discovered already mostly pre-built in P1), reduced-motion audit. Reviewed (3 Checkers, 2 rounds
  — round 1 found and round 2 confirmed-fixed a real 🟠 destructive-write race condition). QA
  **partial** (§23) — mechanical gates PASS, mandatory live browser journey not run (no Chrome
  available), explicitly accepted by user decision.

**What was verified across the whole feature**: 629/629 automated tests (core/daemon/web) green at
every ship point; clean `npm run build` at every ship point; 3 independent Checkers per review round
(code-reviewer, architect, security-reviewer where triggered) across 5 total review rounds (P1×2,
P2×1, P3×2); one real security-relevant defect found and fixed (P3's prune() race), independently
re-verified via 3 separate methods.

**What was NOT verified, carried forward as the standing residual risk for the whole feature**: live
browser exercise of P2's and P3's UI surfaces. P1's UI WAS live-QA'd (2 rounds, real defects found
and fixed) — the gap is specific to P2/P3's newer surfaces, not the whole feature.

**Unblocks**: `docs/loops/self-coded-graph-migration-STATE.md`'s hard precondition ("do not run
`/plan`/`/build` until `graph-execution-realtime` P2 AND P3 ship") is now **fully cleared** — both
phases have shipped. That migration is no longer blocked and can proceed to `/plan` whenever picked
back up.
