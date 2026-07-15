# graph-execution-realtime — TEST PLAN

> Companion to `graph-execution-realtime-STATE.md` §8 (PLAN). This is the artifact `/qa` executes step-by-step and `/build` implements alongside each phase. Runner: **Vitest** (`npm run test -w packages/core`, `-w apps/daemon`), manual web journey via **chrome-devtools** (no Playwright in this repo — CLAUDE.md stack table).
>
> AC numbering note: STATE pins AC-RUN-**2** (roll-up fixture), **5** (F5 reattach), **6** (injection), **10** (nonce), **11** (core purity), **13** (draft blocked) explicitly. The remaining slots follow the coordinator's assignment used below: **4** = cancel kills process tree, **8** = ceilings stop with correct stopReason, **9** = boot reconciliation. Checkers: treat the *named guarantee* as binding, the numbering as convention.

---

## 0. Harness & fixtures (build these first — everything else depends on them)

### 0.1 Fixtures (`docs/loops/` + copies under `packages/core/test/fixtures/run/`)

| Fixture | Source | Status |
|---|---|---|
| `fixture-simple.ndjson` | REAL transcript, CLI 2.1.187 (`docs/loops/graph-execution-realtime-fixture-simple.ndjson`) — 4 lines: `system/init`, `rate_limit_event` (undocumented type), `assistant` (usage 2655 in / 4 out / 9980 cacheWrite / 0 cacheRead, `parent_tool_use_id: null`, `message.id: msg_011Cd23QyssXLp41L4TVH3Ki`), `result` (`total_cost_usd: 0.22691`, `modelUsage` incl. a haiku entry present in NO assistant event) | EXISTS — pin tests to it verbatim |
| `fixture-subagent.ndjson` | REAL transcript containing ≥1 Task dispatch (`tool_use` with `subagent_type`) + assistant events with non-null `parent_tool_use_id` | **RECORD DURING /build P2** (named task, STATE §8.0); until then P2 parser tests for dispatch shape run against `fixture-rollup-synthetic` only and are marked `.todo` for the real fixture |
| `fixture-rollup-synthetic.ndjson` | HAND-WRITTEN, the AC-RUN-2 contract: main actor messages summing to fresh **100_000** (e.g. 40k in + 60k out, plus non-zero cacheRead/cacheWrite to prove exclusion), one Task dispatch `toolu_A` → `subagent_type: "ba"`, agent messages (`parent_tool_use_id: "toolu_A"`) summing to fresh **30_000**, then `result` | create in P2 |
| `fixture-garbage.ndjson` | copy of simple fixture + 1 non-JSON line (`this is not json {`) + 1 invented type (`{"type":"totally_new_event","x":1}`) + 1 line > 8 192 chars | create in P1 |
| `fixture-duplicate-usage.ndjson` | two `assistant` events sharing ONE `message.id` + identical usage (the per-content-block shape, Flaw F5) | create in P2 |

### 0.2 Fake CLI (hermetic — daemon tests NEVER spawn the real `claude`, cost $0)

`apps/daemon/test/fixtures/fake-claude.mjs` — executable (`#!/usr/bin/env node`, chmod +x), selected via `SYMBION_CLAUDE_BIN` (STATE §8.9 A3). Behavior driven by env vars (argv belongs to `cliDriver` and must arrive untouched):

- default: prints `FAKE_CLAUDE_FIXTURE` (ndjson path) line-by-line to stdout with `FAKE_CLAUDE_DELAY_MS` between lines (default 5), exits 0. Responds to argv `--version` with `2.1.187 (Claude Code)` and exits (preflight check).
- `FAKE_CLAUDE_ARGV_OUT=<path>`: first writes its full `process.argv.slice(2)` as JSON to that path (injection assertions).
- `FAKE_CLAUDE_MODE=exit1` (replays half the fixture, prints one line to stderr, exits 1) · `hang` (prints init then sleeps forever) · `ignore-sigterm` (installs a SIGTERM no-op handler, dies only on SIGKILL) · `spawn-child` (spawns a grandchild `node -e "setInterval(()=>{},1e3)"`, writes the grandchild pid to `FAKE_CLAUDE_CHILD_PID_OUT`, then hangs) · `huge` (emits an assistant event with a 100 KB tool_use input).

All daemon tests run under `SYMBION_CONFIG_DIR=<tmp>` (existing isolation precedent) with a temp git-init'd project dir registered via the `createProject` handler.

### 0.3 Phase gating

| Phase | Unblocks |
|---|---|
| **P1** | §1.1–§1.2 (parser), §1.6 (purity), §2, §3.1–3.8 (all daemon tests except token-cap + numstat), manual J1–J11 |
| **P2** | §1.3–§1.5 (aggregate/pricing/derive), §3.9 (token cap), record `fixture-subagent.ndjson`, manual J12–J16 |
| **P3** | §3.10 (retention) if not landed earlier, manual J17–J20 |

---

## 1. Core unit tests (Vitest, `packages/core/test/run/`)

### 1.1 `parseStreamJson.test.ts` — pinned to the REAL fixture (P1)

| # | Case | Expected |
|---|---|---|
| 1 | parse `fixture-simple.ndjson` line-by-line | kinds exactly `["init","unknown","message","result"]` |
| 2 | init fields | `sessionId === "51aa1c99-43bc-4a55-a632-629da44a9280"`, `cliVersion === "2.1.187"`, `permissionMode === "bypassPermissions"`, `slashCommands` contains `"run"` |
| 3 | `rate_limit_event` line | `{kind:"unknown", type:"rate_limit_event"}`, raw retained (truncated ≤ `RAW_CAP`) — the undocumented-type proof |
| 4 | assistant line | `messageId === "msg_011Cd23QyssXLp41L4TVH3Ki"`, `parentToolUseId === null`, usage `{input:2655, output:4, cacheWrite:9980, cacheRead:0}` |
| 5 | result line | `totalCostUsd === 0.22691`, `durationMs === 6216`, `numTurns === 1`, `modelUsage` has 2 model keys, `permissionDenials` is `[]` |
| 6 | garbage fixture | non-JSON line → `{kind:"parse-error"}`; invented type → `unknown`; >8 KB line → raw truncated to `RAW_CAP`; **`parseLine` never throws** (wrap every line in `expect(...).not.toThrow()`) |
| 7 | tolerance | assistant event with `usage` field deleted → still `kind:"message"` with zeroed usage, not a throw |
| 8 | (P2) parse `fixture-subagent.ndjson` | tool_use part carries `{toolUseId, tool:"Task", subagentType}`; ≥1 message has non-null `parentToolUseId` |

### 1.2 `parseStreamJson.truncation.test.ts` (P1)

| # | Case | Expected |
|---|---|---|
| 1 | assistant event with 100 KB tool_use input | every `inputPreview` ≤ `PREVIEW_CAP` (2 000) with a truncation marker |
| 2 | serialized `RunEvent` for that line | `JSON.stringify` length ≤ ~12 KB (persistence bound) |

### 1.3 `aggregate.test.ts` — the AC-RUN-2 contract (P2)

| # | Case | Expected |
|---|---|---|
| 1 | fold `fixture-rollup-synthetic` → `rollup(state, ["ba"])` | command `{ownFresh:100_000, totalFresh:130_000}`; agent ba `{ownFresh:30_000, totalFresh:30_000}` — **exact** |
| 2 | fresh formula (locked §6.6) | non-zero cacheRead/cacheWrite in the fixture change NO fresh number; they appear in the FourWay breakdown |
| 3 | invariant property | command.totalFresh === Σ(all attributed + unrecognized fresh) for every fixture in §0.1 |
| 4 | **order-independence** | 100 seeded shuffles of the synthetic fixture's events (seq reassigned per permutation) → identical terminal rollup totals every time |
| 5 | **message-id dedup (Flaw F5)** | `fixture-duplicate-usage`: the shared-id usage counted ONCE (total == single-message usage, not 2×) |
| 6 | unrecognized subagent | events with `parentToolUseId:"toolu_UNKNOWN"` (no dispatch seen) → bucket flagged `unrecognized:true`, its fresh included in command total, NEVER dropped (Σ check) |
| 7 | parse-error events | folding `parse-error`/`unknown` increments `parseErrors`/`unknownEvents`, changes no token number |
| 8 | seq monotonicity guard | folding an event with `seq <= state.lastSeq` is a no-op (client-side dedup contract) |
| 9 | result cross-check (Flaw F6) | simple fixture: fold totals equal `result.usage` (main model); a doctored result with inflated usage sets the degraded flag, does NOT re-base totals |

### 1.4 `pricing.test.ts` (P2)

| # | Case | Expected |
|---|---|---|
| 1 | known model estimate | `estimateCostUsd` on the simple fixture's usage > 0; cacheWrite/cacheRead priced (cache-heavy usage costs more than fresh-only) |
| 2 | unknown model | returns `undefined` → UI renders `—` (never NaN/0) |
| 3 | terminal reconciliation | per-node estimates scaled so Σ(per-node $) === `result.totalCostUsd` ± 0.005 |

### 1.5 `derive.test.ts` (P2)

| # | Case | Expected |
|---|---|---|
| 1 | `timelineRows(fixture-subagent)` | dispatch row (`Task → ba`) precedes actor-suffixed subagent rows (depth 1); rows carry seq + tokenDelta |
| 2 | `runSummary` statuses | `stopReason:"wallClock"` → timed-out summary shape; `exitCode:1` + stderrTail → failed shape; perNode rows include the flagged unrecognized bucket |

### 1.6 Core purity — AC-RUN-11 (P1, also a /review gate)

- `grep -rn "node:" packages/core/src/run/` → **zero matches**; `grep -rn "from \"fs\"\|require(" packages/core/src/run/` → zero.
- `npm run test -w packages/core` green in an environment with no DOM (reducer is runtime-agnostic).

## 2. `packages/rpc-types` (P1)

Compile-only: `tsc --noEmit` across the monorepo proves the 5 new methods + SSE payload types are importable from both `apps/daemon/src/rpc/contract.ts` and `apps/web/src/lib/rpc/types.ts` with no hand-mirroring (drift = compile error).

---

## 3. Daemon integration tests (Vitest, `apps/daemon/test/`)

All: temp `SYMBION_CONFIG_DIR`, temp git-init'd project, `SYMBION_CLAUDE_BIN` → fake CLI. Helper `startTestRun()` = `runPreflight` → take `consentNonce` → `startRun` (the legitimate two-phase flow), then await terminal via `listRuns` polling.

### 3.1 `run-happyPath.test.ts` (P1)

| # | Assert |
|---|---|
| 1 | `startRun` returns runId; `.symbion/runs/<runId>/run.json` exists with `schemaVersion:1`, `status:"starting"|"running"`, `cwd` === registered project path, `cliVersion`, `gitBefore` |
| 2 | at terminal: `status:"completed"`, `exitCode:0`, `endedAt` set, `lastSeq === 4` (simple fixture) |
| 3 | `events.jsonl` has exactly 4 lines, `seq` strictly monotonic 1..4, each line parses as `PersistedRunEvent` |
| 4 | `.symbion/runs/.gitignore` exists with content `*` (secrets stance) |
| 5 | re-running the same command after completion succeeds (idempotent slot release — the map entry is freed) |

### 3.2 `run-injection.test.ts` — AC-RUN-6 (P1)

| # | Case | Assert |
|---|---|---|
| 1 | requirement = `"; rm -rf ~ #` with `FAKE_CLAUDE_ARGV_OUT` | argv JSON contains ONE element `/[cmd] "; rm -rf ~ #`-suffixed prompt — the string arrives LITERALLY inside a single argv element; no other element contains fragments of it |
| 2 | requirement = `$(touch <tmp>/pwned)` and `` `touch <tmp>/pwned2` `` | neither canary file exists after terminal |
| 3 | requirement of 10 001 chars | `RpcError("invalid-params")`, no run dir created |
| 4 | model = `foo; rm -rf /` | rejected by the `[A-Za-z0-9._-]{1,100}` shape check before spawn |

### 3.3 `run-nonce.test.ts` — AC-RUN-10 (P1)

| # | Case | Assert |
|---|---|---|
| 1 | `startRun` with NO nonce / empty string | `RpcError("run-consent-required")` (or equivalent code), nothing spawned, no run dir |
| 2 | random 64-hex nonce never minted | rejected |
| 3 | valid nonce used twice (replay) | 1st succeeds, 2nd rejected (single-use) |
| 4 | nonce minted for artifact A, spent on artifact B (same project) | rejected (binding) |
| 5 | expired nonce (TTL injected to 50 ms for the test — `nonces.ts` must accept a `now()`/TTL override) | rejected |
| 6 | `updateSettings` changes `permissionMode` between preflight and start | rejected (configHash mismatch) → new preflight required |
| 7 | preflight on a DRAFT artifact | response has `blocked:true` and **no `consentNonce` field** (AC-RUN-13 server side); a forged startRun for it fails even with a stale nonce from another artifact |

### 3.4 `run-cancel.test.ts` — AC-RUN-4 (P1)

| # | Case | Assert |
|---|---|---|
| 1 | `MODE=hang`, then `cancelRun` | terminal `status:"cancelled"` ≤ 6 s; `kill(pid, 0)` throws ESRCH |
| 2 | `MODE=ignore-sigterm` | SIGKILL escalation: dead ≤ ~6 s, `status:"cancelled"` |
| 3 | `MODE=spawn-child` (grandchild pid captured) | after cancel, **grandchild** pid is dead too (process-GROUP kill; the WSL/.exe caveat F9/A5 is re-verified manually in J10) |
| 4 | `cancelRun` on an already-terminal run | idempotent no-op result, no throw |
| 5 | events arriving after cancel initiated | no write after terminal `run.json` (file mtime stable) |

### 3.5 `run-concurrency.test.ts` — ER-9 (P1)

| # | Case | Assert |
|---|---|---|
| 1 | second `startRun` (fresh nonce) while `MODE=hang` run active in the SAME project | `RpcError("run-active")`; first run unaffected |
| 2 | simultaneous runs in TWO different registered projects | both succeed (limit is per-project) |

### 3.6 `run-sse.test.ts` (P1)

| # | Case | Assert |
|---|---|---|
| 1 | `GET /run-events?runId&afterSeq=0` with valid Host, no Origin (same-origin EventSource) | 200, `Content-Type: text/event-stream`; frames deliver seq 1..N exactly once, in order |
| 2 | Host `evil.com:PORT` → 403; Origin `http://evil.com` → 403 (same `isAllowedHost` gate as /rpc) |
| 3 | unknown runId → 404; terminal runId → full backfill then stream closes |
| 4 | attach MID-run with `afterSeq=2` | receives 3..N only — backfill-then-live on one channel, **no duplicates, no gaps** (Flaw F2 regression test) |
| 5 | burst fixture (200 events, DELAY 0) | received frame count « event count (batching), but Σ events == 200 (coalesce transport, never data) |
| 6 | plain GET to `/run-events` does not fall through to the static-file handler (route ordering in server.ts) |

### 3.7 `run-getRunEvents.test.ts` (P1)

| # | Case | Assert |
|---|---|---|
| 1 | 1 200-event synthetic run on disk | 3 calls: 500 + 500 + 200, `done:true` on the last; concatenation = seq 1..1200 exactly (polling fallback / history replay contract) |
| 2 | union of (SSE-delivered set) and (getRunEvents set) for the same run | identical after seq-dedup — the two channels can never disagree |

### 3.8 `run-lifecycle.test.ts` — exit + reconciliation, AC-RUN-9 (P1)

| # | Case | Assert |
|---|---|---|
| 1 | `MODE=exit1` | `status:"failed"`, `exitCode:1`, stderr tail persisted (≤20 lines), PARTIAL events retained in events.jsonl |
| 2 | hand-write `.symbion/runs/<id>/run.json` with `status:"running"` (no live process), then `listRuns` | that run returns `status:"failed"`, `errorMessage:"daemon-restarted"`, `endedAt` set — and the file was rewritten (persistent, not cosmetic) |
| 3 | same for `status:"starting"` and `"cancelling"` orphans |
| 4 | reconcile never touches a run whose runId IS live in runManager |

### 3.9 `run-ceilings.test.ts` — AC-RUN-8 (wall-clock P1 · token cap P2)

| # | Case | Assert |
|---|---|---|
| 1 | `MODE=hang`, project `ceilings.wallClockMs: 500` | terminal `status:"timed-out"`, `stopReason:"wallClock"`, process dead, ≤ ~6 s total |
| 2 | (P2) fixture with cumulative fresh > `tokenCap: 1_000` | terminal `status:"timed-out"`, `stopReason:"tokenCap"`; events up to the breach persisted |

### 3.10 `run-retention.test.ts` (P3)

| # | Case | Assert |
|---|---|---|
| 1 | 52 terminal run dirs, then a new terminal run | exactly 50 remain, the 3 oldest by `startedAt` gone |
| 2 | foreign file `.symbion/runs/notes.txt` + foreign dir `.symbion/runs/not-a-uuid/` | UNTOUCHED (only runId-shaped dirs are prune candidates) |
| 3 | a run dir replaced by a symlink to a dir outside the project | prune REFUSES it (lstat guard), symlink target intact, other pruning still proceeds |

---

## 4. Manual web journey (chrome-devtools; /qa executes in order)

Setup: daemon serving the built web export; a dogfood project registered (Symbion repo itself is fine); one published command with ≥2 published agent references. Two modes: **[FAKE]** = daemon started with `SYMBION_CLAUDE_BIN` → fake CLI + a chosen fixture (deterministic); **[REAL]** = the real `claude` 2.1.187, logged in (costs tokens — J12 only needs one real run).

| # | Phase | Step | Expected result | AC / ER |
|---|---|---|---|---|
| J1 | P1 | Hover a published command node → ⋯ menu | `▶ Execute…` is the TOP item, above Copy run command (which is unchanged); agent nodes have NO Execute | AC-RUN-1, R1 |
| J2 | P1 | Open RunDialog | preflight rows resolve ≤ ~300 ms: CLI version, published vX (in sync), agents published, git tree state; exact invocation echo + cwd; consent line names path/mode/ceilings verbatim per design §3.2 | FR-1 |
| J3 | P1 | First run in the project | ack block with required checkbox; Execute disabled until ticked | §6.4 consent |
| J4 | P1 | [FAKE, simple fixture] Execute | dialog closes; mission mode: non-participants dim 35 %, command node pulsing ring, run bar docks; run completes → steady success ring + `✓ FINISHED` bar | AC-RUN-1 |
| J5 | P1 | Re-open dialog after run | NO ack block (persisted); requirement pre-filled with last value, selected; `Last run:` hint present | L3 |
| J6 | P1 | Settings: change permission mode → open dialog again | ack block RE-appears (settings-hash re-ask) *(until R7 UI ships in P3, flip the value in store.json by hand and reload)* | design §0 |
| J7 | P1 | Draft command → Execute | dialog blocked: `✗ DRAFT — nothing on disk to run` + working `[Publish first →]` (opens publish flow; after publishing, preflight re-runs and unblocks); Execute stays disabled while blocked | **AC-RUN-13** |
| J8 | P1 | Hand-edit the published .md on disk → Execute | amber warn "differs on disk — the ON-DISK version runs"; button reads `Execute anyway`, still enabled | ER-warn, §6.5 |
| J9 | P1 | [FAKE, `MODE=hang`] While running: hover the same node's ⋯ + try a second Execute | affordance disabled + tooltip "A run is already active"; raw RPC race (fire `startRun` from devtools console with a spent nonce) → toast, dialog never opens | ER-9 |
| J10 | P1 | [REAL or FAKE hang] Cancel from the status strip | two-step inline confirm (5 s auto-revert); then `◐ CANCELLING…` → `◼ CANCELLED` neutral (not red); with the REAL CLI: verify via `ps` that no `claude` process survives (WSL/.exe caveat F9/A5) | AC-RUN-4, ER-6 |
| J11 | P1 | Kill the daemon mid-run, restart, reload UI | run shows `✗ failed (daemon-restarted)` — never a zombie "running" | AC-RUN-9, ER-10 |
| J12 | P2 | [REAL] Execute the dogfood command with a real requirement | command badge ticks (`12.4k · ~$0.09`…); on Task dispatch the edge flows + agent node lights with its OWN badge; command badge shows own+agents roll-up; timeline rows stream (time · glyph · label · +Δtok), subagent rows actor-suffixed under a dispatch card. **Record this transcript as `fixture-subagent.ndjson`** | AC-RUN-2 (visual), FR-4 |
| J13 | P2 | Hover the command badge | 4-way breakdown card: own / +agents / total columns; fresh headline row; cache rows muted; footnote about cache-in-$ ; agent-node card has no `+agents` column | §6.6 |
| J14 | P2 | **F5 mid-run** [FAKE, slow fixture: DELAY 300 ms] | ≤ ~1 s: bar `⟳ RECONNECTING…` → mission mode restores, badges fast-forward to correct totals (identical numbers to a never-refreshed session), SSE resumes, "Reattached" toast | **AC-RUN-5** |
| J15 | P2 | [FAKE, `fixture-garbage`] run to completion | run completes normally; amber `⚠ telemetry degraded` chip; badges `≥`-prefixed; `[≡ Raw]` tab shows the raw tail incl. the garbage line | ER-4 |
| J16 | P2 | Completion while on the Settings screen | run bar (visible app-wide) flips to `✓ FINISHED …`; toast with `[View summary]` → jumps to graph + summary: cost-by-node table (total == Σ rows), FILES CHANGED via git (with pre-dirty flag if J8's edit remains), final message | FR-5, R4/R5 |
| J17 | P3 | 🕘 toolbar icon (hidden before run #1) → popover | one row per run: glyph · command · duration · fresh tok · $ · relative time; capped at 50 | FR-5 |
| J18 | P3 | Open a past run | read-only overlay: warning-tinted `VIEWING PAST RUN` banner, graph re-lit at FINAL states (no pulse), feed from event 0, no Cancel; `[▶ Run again]` reopens R2 prefilled; `[Exit history]` restores authoring | R6 |
| J19 | P3 | During an active run: try authoring (drag-connect, node menu, edge toolbar) | all authoring suspended; resumes immediately after Close/exit | design §0 |
| J20 | P3 | OS `prefers-reduced-motion` on → run a fake run | pulse/edge-flow/count-up collapse to state swaps (joins the existing globals.css block) | design §5 |

Cross-cutting manual checks (any phase): every `$` is `~`-prefixed; badges are fixed-width `tabular-nums` (nodes never resize mid-run); elapsed clock ticks every 1 s even when no events arrive (client-side from `startedAt`); Esc never cancels a run.

---

## 5. AC coverage matrix

| AC | Guarantee | Covered by |
|---|---|---|
| AC-RUN-1 | Execute from command node, happy path | J1–J4, §3.1 |
| AC-RUN-2 | 100k+30k → 130k/30k over the fresh formula (exact fixture) | §1.3#1–5, J12/J13 |
| AC-RUN-4 | cancel kills the process TREE ≤5 s, confirmed dead | §3.4, J10 |
| AC-RUN-5 | F5 reattach, identical numbers | J14, §3.6#4 |
| AC-RUN-6 | injection: hostile requirement is one literal argv element | §3.2 |
| AC-RUN-8 | ceilings terminate with correct stopReason | §3.9, J16 (ER-7 variant) |
| AC-RUN-9 | orphaned running → failed(daemon-restarted) | §3.8#2–4, J11 |
| AC-RUN-10 | spawn unforgeable by a single raw RPC call (nonce protocol) | §3.3, J9 |
| AC-RUN-11 | core purity preserved | §1.6 |
| AC-RUN-13 | draft blocked with working "Publish first" | §3.3#7, J7 |
| (unnumbered) | telemetry never estimated / degrade-not-die / unattributable flagged | §1.3#6–7, §3.8#1, J15 |

/qa gate: all §1–§3 suites green for the shipped phase + the phase's J-steps pass. §0.1's `fixture-subagent.ndjson` recording is a hard P2 exit criterion — P2 does not pass /qa without it.
