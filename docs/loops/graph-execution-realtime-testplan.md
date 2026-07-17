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

---

## 6. P2 additions (architect, 2026-07-15 — companion to STATE §13)

> Appended, not overwritten. §§1.3–1.5, §3.9#2, J12–J16 were already stubbed above; this section
> makes them concrete against STATE §13's file list and adds the items §13 introduced that weren't
> previously stubbed (`pricing.ts` reconciliation edge cases, `gitNumstat` integration test, the
> degraded-chip's two distinct copy paths, the token-cap ceiling's summary presentation).

### 6.1 `aggregate.test.ts` — concretized (supersedes the stub numbering only in file location, not intent; see §1.3 above for the original case list, unchanged)

| # | Case | Expected |
|---|---|---|
| 10 | fold the REAL `fixture-subagent.ndjson` (§13.3) | at least one actor bucket key !== `"main"`; `rollup(state, agentNamesInGraph)` does not throw when `agentNamesInGraph` is an empty/unrelated set — the dispatch's `subagentType` falls into `unrecognized`, its fresh tokens still counted in `command.totalFresh` (NEW-1) |
| 11 | fold the REAL `fixture-subagent.ndjson` with the CORRECT agent name supplied | that agent's bucket shows `ownFresh > 0`; `command.totalFresh === command.ownFresh + agentBucket.ownFresh + unrecognized.fresh` holds exactly (the AC-RUN-2 invariant, now checked against a REAL transcript, not only the synthetic one) |
| 12 | `fold` called twice with the same `PersistedRunEvent` (`seq` unchanged) | second call is a no-op — returns a state with identical rollup output (seq-guard, belt-and-braces client dedup contract now actually exercised by P2's token math per STATE §13.1) |

### 6.2 `pricing.test.ts` — concretized

| # | Case | Expected |
|---|---|---|
| 4 | model string with an unseen date suffix of a KNOWN family (e.g. `claude-haiku-4-5-99999999`) | prefix-match resolves to the same per-mtok rates as the exact-dated entry seen in the fixture (A14) |
| 5 | a run whose EVERY actor's model is unknown, but `result.totalCostUsd > 0` | `reconcileToTotal`'s pro-rata-by-fresh-token-share fallback distributes the total without divide-by-zero; no node shows `$ —` when a total exists (only the LIVE mid-run view — before terminal — shows `$ —` for unknown models per node) |
| 6 | zero-usage run (edge case: a run cancelled before any assistant message) | `estimateCostUsd`/`reconcileToTotal` handle an all-zero `FourWay` without NaN; summary renders `$0.00` or `—`, never `NaN`/`Infinity` |

### 6.3 `derive.test.ts` — concretized

| # | Case | Expected |
|---|---|---|
| 3 | `runSummary` on `fixture-simple.ndjson` (the ORIGINAL P1 fixture, re-used here as the P2 degraded-check's baseline) | `degraded: false` — the haiku background-model delta (505 in / 11 out, per §8.0) reconciles within the ±1-token tolerance against `result.usage`; this is the FIRST test that actually exercises F6's reconciliation math end-to-end (P1 never computed this) |
| 4 | `runSummary` on a HAND-DOCTORED copy of `fixture-simple.ndjson` where `result.usage` is inflated by +500 tokens beyond what `modelUsage`'s background delta explains | `degraded: true`; fold's own totals in `perNode` are UNCHANGED from the non-doctored case (never re-based to match the doctored `result` — pins F6's explicit "cross-check only" resolution) |
| 5 | `timelineRows` on `fixture-subagent.ndjson` | dispatch row (`🤖 Task → <subagentType>`) appears BEFORE any row whose `actor` matches that dispatch's `parentToolUseId`-keyed bucket; subagent rows carry `depth: 1` |

### 6.4 `run-ceilings.test.ts` §3.9#2 — concretized (token cap, wall-clock already P1-passing)

| # | Case | Assert |
|---|---|---|
| 2a | fake-CLI fixture whose cumulative fresh tokens cross `ceilings.tokenCap: 1_000` partway through | terminal `status:"timedOut"`, `stopReason:"tokenCap"`; events UP TO the breach are persisted in `events.jsonl` (no events lost, none added after); process confirmed dead (same liveness-verify as the existing wall-clock case) |
| 2b | `tokenCap: 0` (disabled per project config) | run completes normally regardless of token volume — `0` means "no cap," not "cap immediately" (guard against an off-by-one treating 0 as a real ceiling) |
| 2c | breach detected exactly on the LAST event before a run would complete anyway (race between natural completion and ceiling breach) | whichever finalize path wins, the run reaches exactly ONE terminal state (never both `completed` AND `timedOut` — `finalize()`'s existing `terminalWritten` guard, unchanged from P1, is what prevents this; test pins that the guard still holds once a second trigger (token-cap) exists alongside wall-clock and natural exit) |

### 6.5 `run-gitNumstat.test.ts` — NEW (daemon integration)

| # | Case | Assert |
|---|---|---|
| 1 | a run's target repo has 1 modified tracked file (+N/−M) and 1 new untracked file, both changed by a fake-CLI mode that touches real files in the test's scratch project | `run.json.filesChanged` (post-terminal) contains both: the modified file with correct `plus`/`minus`, the untracked file with `status:"A"` and no `plus`/`minus` (R4 — matches the design mock's own asymmetry) |
| 2 | a file changed by the agent that was ALSO dirty before the run started (present in `gitBefore.changedFiles`) | that file's entry has `preDirty: true` |
| 3 | git binary made unavailable (`PATH` stripped for the numstat call, or repo `.git` corrupted) | `filesChanged === "unavailable"`; run's own terminal `status`/`exitCode` unaffected — finalize() still completes normally (NEW-2) |
| 4 | numstat given an artificially tiny timeout via a test hook and a diff large enough to exceed it | same `"unavailable"` fallback, no thrown error escapes `finalize()` |
| 5 | `gitNumstat` invoked on a non-repo project | returns `"unavailable"` (or an empty array — pick one, pin it; recommend `"unavailable"` for consistency with `gitStatus`'s own `isRepo:false` short-circuit) |

### 6.6 Manual web journey — P2 items concretized (J12–J16 already stubbed above; adding 3 new checks)

| # | Phase | Step | Expected result | AC / ER |
|---|---|---|---|---|
| J12 | P2 | (unchanged from stub above) | — | AC-RUN-2 |
| J13–J16 | P2 | (unchanged from stub above) | — | §6.6 / ER-4 / FR-5 |
| J21 | P2 | Trigger BOTH degraded-chip causes in separate runs: (a) `[FAKE, fixture-garbage]` (parse errors), (b) a hand-doctored terminal `result.usage` beyond tolerance (may require a fake-CLI mode emitting a doctored result line) | the amber chip appears in BOTH cases but with **visibly different hover copy** — (a) mentions "raw log kept" / parser tolerance framing, (b) mentions background-model reconciliation framing — confirms `DegradedTelemetryChip` doesn't conflate the two triggers (STATE §13.1's explicit requirement) | ER-4, F6 |
| J22 | P2 | `[FAKE]` run with `ceilings.tokenCap` set low enough to breach mid-run | run stops early; summary header reads `⚠ STOPPED — token cap reached` (amber, distinct from the wall-clock variant's wording) + `[Adjust ceilings]` (inert per F7, confirm no navigation happens if clicked) | AC-RUN-8, ER-7 |
| J23 | P2 | Open Settings while a P2-built run is active/completed | confirm NO Execution section/editor exists yet (F7) — only P1/P2's read-only consent-sentence surfaces are present; this is a NEGATIVE check guarding against P3 scope creep | §13.7 |

### 6.7 AC coverage — P2 deltas

| AC | P1 verdict (§12.6) | P2 target |
|---|---|---|
| AC-RUN-2 | N/A (P1 shipped no token math) | **PASS target**: §6.1#10–11 (real fixture) + existing §1.3#1–5 (synthetic) — both must pass |
| AC-RUN-8 | wall-clock only (PASS) | **PASS target extended to tokenCap**: §6.4 |
| (unnumbered) | telemetry never estimated / degrade-not-die | **PASS target**: §6.3#3–4 (F6), §6.2 (F4), J21 |

/qa gate for P2 (unchanged from the existing file's closing line): all of §1.3–§1.5/§6.1–§6.3 core
suites green, §3.9#2/§6.4 + §6.5 daemon suites green, `fixture-subagent.ndjson` recorded and present
at BOTH paths named in STATE §13.3, J12–J16 + J21–J23 pass. P2 does not pass /qa without the real
fixture — this was already true in the pre-existing testplan text and is unchanged by this addition.

---

## 7. P3 additions (2026-07-16, architect — companion to STATE §18)

Scope: history popover + read-only past-run overlay + PastRunBanner, full R8 reattach choreography
(ER-10 toast/partial summary), retention pruning's `listRuns`-triggered gap fix, R7 Settings→
Execution editor, minimal ⌘K `RunCommandPalette`, and the prefers-reduced-motion audit. Nothing
below overwrites §0–§6 above.

### 7.1 Core unit tests (Vitest, `packages/core`)

New file `test/run/retention.test.ts` for `selectPruneTargets(runs, keep)` (STATE §18.1):

| # | Case | Assertion |
|---|---|---|
| 1 | 60 runs, `keep=50` | returns exactly the 10 oldest-by-`startedAt` runIds; the 50 newest are NOT in the result |
| 2 | `runs.length <= keep` (e.g. 30 runs, `keep=50`) | returns an empty array |
| 3 | Empty `runs` array | returns an empty array (no throw) |
| 4 | Two runs with an IDENTICAL `startedAt` string, `keep=1` | stable tie-break — the SAME one of the two is selected for deletion on every call given the same input array order (pin whichever rule is chosen: e.g. "earlier in the input array = older" or an explicit secondary sort key) — this closes a real ambiguity the current inline sort doesn't explicitly guarantee |
| 5 | `keep=0` | every run is selected for deletion (degenerate but valid — the daemon-level caller is what enforces a sane minimum, not this pure function) |
| 6 | Negative `keep` | treated identically to `keep=0` (no negative-number special-casing; document as intentional, don't silently clamp) |

### 7.2 Daemon integration test (`apps/daemon`)

New file `test/run-listRuns-prune.test.ts`:

| # | Case | Assertion |
|---|---|---|
| 1 | Seed 55 completed runs directly on disk (bypassing a real spawn — write `run.json`s with distinct `startedAt` timestamps via the existing `writeRunJson` helper already used by other daemon tests), then call the `listRuns` RPC handler | response contains at most 50 runs; a subsequent `readdirSync` of `.symbion/runs/` on disk shows exactly 50 `RUNID_RE`-matching dirs remain (prune actually ran as a side effect of the READ, not just filtered the response) |
| 2 | Same seed, but simulate a `prune()` throw (e.g. temporarily make one run's dir unreadable / inject a failure) | `listRuns` RPC still returns the (unpruned-this-time) run list successfully — a prune failure never blocks the read (matches `finalize()`'s existing try/catch posture) |
| 3 | A run seeded as CURRENTLY reserved/active in `runManager`'s in-memory map (simulated) plus 55 terminal runs on disk | the active run's dir is never a prune candidate regardless of its `startedAt` (EDGE-1's "live run always has the newest startedAt" invariant, defensively re-asserted even though it's true by construction) |

### 7.3 Manual web journey checklist (Playwright/chrome-devtools per the feature's existing convention)

Per STATE §18.9's recommendation, this session should ALSO re-run the never-verified P2 items
(J12–J16, J21–J23 from §6 above) before/alongside the items below, in the same live pass.

| # | Phase | Step | Expected result | Ref |
|---|---|---|---|---|
| J24 | P3 | Complete 2–3 runs in a project (mix of completed/failed/cancelled), then click the graph toolbar's 🕘 icon | icon shows `runs <n>`, was ABSENT before run #1 (empty-state rule); popover opens with `listRuns` data, one row per run: glyph/command/duration/fresh-tok/$/relative-time, newest first | R6, design §3.10 |
| J25 | P3 | Click a completed run's row in the history popover | `PastRunBanner` appears above the mission chrome ("🕘 VIEWING PAST RUN · #n · <date> · <status> · read-only"); graph re-lights at FINAL states only (static rings, no pulse, no edge-flow animation); `RunTimelinePanel` shows Feed/Raw/Summary tabs sourced from the replayed historical data, no "follow/pause" toggle present | R6, R8 |
| J26 | P3 | While viewing a past run (J25), click `[▶ Run again]` | opens `RunDialog` prefilled with that run's requirement (reuses the existing `lastRun.requirement` pre-fill mechanism) | design §3.10 |
| J27 | P3 | While viewing a past run (J25), click `[Exit history]` | returns cleanly to the normal authoring graph (no leftover dimming/banner); authoring affordances (drag-connect, node menus) work again immediately | R6 |
| J28 | P3 | While viewing a past run (J25) in one browser tab, start a NEW live run (e.g. via ⌘K or a node menu, if not dimmed) | live mission mode takes over automatically, a toast reads "A new run started — exited run history", `PastRunBanner` disappears, the graph now shows the LIVE run's real-time state (pulsing rings) not the frozen historical one | EDGE-2, A21 |
| J29 | P3 | Start a `[FAKE, hang mode]` run, hard-kill the QA daemon process (simulating a crash), restart it, then load the web app fresh (F5-equivalent) | (a) a danger toast fires: "Run /<name> marked failed — daemon restarted" with a `[View summary]` action; (b) clicking it shows a PARTIAL summary (whatever telemetry was captured before the crash) via the read-only overlay path, not an error screen; (c) the history popover's row for this run shows `✗ failed (daemon-restarted)` | ER-10, R8 §18.3 item 1 |
| J30 | P3 | Reload the page mid-run (real F5, not a crash) on a run with a non-trivial event count (e.g. ≥50 events) | reattach shows the STAGED choreography per design's R8 ASCII: `⟳ RECONNECTING…` → skeleton glow + `⟳ replaying N events…` shimmer → badges fast-forward with a visible ~300ms count-up (not an instant snap) → toast "Reattached — run still in progress." — confirm this is visibly staged, not an instant jump-to-final-state | R8, design §3.10 |
| J31 | P3 | With `prefers-reduced-motion: reduce` active (OS/browser setting), repeat J30 (reattach) and a live run's badge tick-up | badges snap directly to their new value with NO visible count-up tween — this is the concrete audit finding from STATE §18.6 (rAF-driven tweens don't automatically respect the CSS media query); if the count-up STILL animates under reduced-motion, this is a FAIL and names the exact fix needed (`NodeTokenBadge`'s tween function must gate on `matchMedia`) | STATE §18.6 |
| J32 | P3 | Repeat with reduced-motion active: node glow pulse, edge dash-flow, "lock-in" settle flash, mission-mode enter/exit transition, dim fade | ALL collapse to instant state swaps (no looping/animating) — confirms the existing CSS `*`-selector reduced-motion block genuinely covers every P1/P2/P3 keyframe, not just the ones explicitly re-tested in prior QA passes | STATE §18.6 |
| J33 | P3 | Navigate to Settings, select a project, open the Execution section (`RunSettingsSection`) | shows the current `permissionMode`/`allowedTools`/`ceilings` (defaults if never configured); radio group offers exactly `plan`/`acceptEdits`/`bypassPermissions` | R7, design §3.11 |
| J34 | P3 | In the Execution section, attempt to set wall-clock to `0` minutes, then `2000` minutes | both rejected/clamped by client-side validation to the `[1, 1440]` bound before the RPC is even called (or the daemon rejects if client validation is bypassed — verify at least one layer enforces it) | EDGE-5 |
| J35 | P3 | Set token cap to the explicit "no cap" toggle, save, then start a run that would normally exceed a default cap | run is NOT stopped early by the token-cap ceiling (confirms the UI's "disable" toggle actually round-trips to `tokenCap<=0` server-side, not just cosmetically) | EDGE-5 |
| J36 | P3 | Select `bypassPermissions` and attempt to save | an EXTRA confirm modal appears before the save completes (design's explicit requirement); after confirming, the NEXT Execute on this project shows the first-run-ack block again (re-ask), even though this project had already been acked under the previous mode | R7, design §0 |
| J37 | P3 | From the RunDialog's consent line, click `[change]` | navigates to the Execution settings section for the SAME project (STATE F-P3-1's newly-wired link, previously nonexistent) | F-P3-1 |
| J38 | P3 | From a run summary's `[Adjust ceilings]` link (previously inert per F7) | navigates to the same Execution settings section (STATE §18.1 — the P2-built inert link now wired) | F7 |
| J39 | P3 | Press ⌘K (or Ctrl+K) anywhere in the app | `RunCommandPalette` opens; shows an "Execute" section listing every PUBLISHED command in the current project + a "Run history" row; typing filters the Execute list by substring | F8 |
| J40 | P3 | From ⌘K, select "Execute /<name>…" | opens the SAME `RunDialog` the node `⋯` menu opens (not a parallel dialog); if on a different tab, auto-switches to the Graph tab (design §5's keyboard note) | F8 |
| J41 | P3 | From ⌘K, select "Run history" | opens the same history view as the toolbar 🕘 icon (same data, same `openHistoryRun` action) | F8 |
| J42 (negative check) | P3 | Inspect the shipped `RunCommandPalette` for any row/section beyond "Execute" and "Run history" | **must find NONE** — no agent-execution rows, no settings navigation, no project-switching, no generic "go to" navigation, no recent-files list. If any exist, this is scope creep against F8's explicit limit — FAIL this check and file it as a defect, do not accept it as a nice-to-have | F8, EDGE-4 |
| J43 (negative check, P2 gap) | P3 | Re-run J12–J16 and J21–J23 from §6 above (P2's items, never live-verified per §16) | all pass — this closes STATE §18.9's recommendation; if any fail, they are P2 regressions/latent defects surfacing now, not P3 defects, and should be triaged accordingly (do not conflate a P2-origin bug with new P3 code just because it's discovered during this session) | STATE §18.9 |

### 7.4 AC coverage — P3 deltas

| AC / item | P1/P2 verdict | P3 target |
|---|---|---|
| History/R6 (unnumbered in the original 12 ACs — a design-doc-level requirement) | N/A (P1/P2 shipped no history UI) | **PASS target**: J24–J27 |
| R8 full reattach (unnumbered) | Basic version PASS (§12, J11) | **PASS target extended to full choreography + ER-10**: J29–J30 |
| F7 (R7 settings editor) | Deferred, consent-line-only PASS | **PASS target**: J33–J38 |
| F8 (⌘K palette) | Deferred, node-menu-only PASS | **PASS target + scope-creep negative check**: J39–J42 |
| Reduced-motion (§18.6) | Asserted-but-unaudited for rAF tweens | **PASS target, or a named defect for `NodeTokenBadge`'s matchMedia gate**: J31–J32 |
| P2's own gap (§16) | SKIPPED | **Closed in the SAME pass, per §18.9**: J43 |

/qa gate for P3 (mirrors the existing file's closing convention): §7.1's core suite green, §7.2's
daemon integration suite green, J24–J43 all pass (J42/J43 are explicit negative/regression checks,
not optional) — P3 does not pass /qa with J42 finding scope creep or J43 finding an unresolved P2
regression left untriaged.
