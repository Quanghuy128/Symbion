# workflow-agent-run — Test Plan

> Companion to `workflow-agent-run-STATE.md` §10 (PLAN). `/build` implements these alongside each slice (S1–S11). `/qa` executes §4 in order.
>
> **Runners:**
> - Vitest, via `npm test -w packages/core`, `npm test -w apps/daemon` and `npm test -w apps/web` (jsdom + Testing Library)
> - Live browser journeys via **chrome-devtools**, the repo convention. The `apps/web/e2e` Playwright specs are not extended for this feature.
>
> **IDs:** U-P parser · U-L legacy · U-S summarize · U-T agent tree · W web component · J live journey. J1–J10 map 1:1 to AC-1…AC-10.

---

## 0. Fixtures and harness

### 0.1 Core fixtures (`packages/core/test/fixtures/run/`)

| Fixture | Source | Purpose |
|---|---|---|
| `fixture-simple.ndjson` | REAL (exists) | Root only. Checks unknown `rate_limit_event` and the result row. |
| `fixture-subagent.ndjson` | REAL (exists, = `docs/loops/graph-execution-realtime-fixture-subagent.ndjson`) | Covers: async Agent dispatch, `task_started` / `task_updated` / `task_notification`, a `user` tool_result with `tool_use_result.isAsync`, a thinking part, `system/thinking_tokens`, a subagent text "pong", and two init/result pairs. Used for AC-1. |
| `fixture-agents-synthetic.ndjson` | NEW, hand-written stream-json lines (S4) | See the spec below. |
| `fixture-garbage.ndjson` | exists | I4: never throws. |
| `fixture-duplicate-usage.ndjson` | exists | Proves tokens come from `fold`, deduplicated by message id. |
| legacy events (in-test) | built in the test file | `PersistedRunEvent[]` exactly as the **pre-upgrade** parser persisted `fixture-subagent`. The `user` and `system` lines become `{kind:"unknown", type, rawTruncated: line}`, and the thinking-only assistant line becomes `message` with `parts: []`. |
| big-run generator | NEW `packages/core/test/run/helpers/bigRun.ts` | A deterministic generator for N events (default 2,500): root plus 6 subagents (2 nested), each event with Read/Grep/Bash pairs. Also emitted to `apps/daemon/test/fixtures/fixture-big-2500.ndjson` for QA (test-only file). |

**`fixture-agents-synthetic.ndjson` must contain, in this order:**

1. `init`
2. A root thinking part and a root text part.
3. Root `Agent` dispatch **A** (`subagent_type: "ba"`, `description: "Requirements angle"`, prompt ~2,500 chars so it is truncated). Then root `Agent` dispatch **B** (`ba`, "Solutions angle"), foreground.
4. A messages (`parent_tool_use_id: A`):
   - Read with `file_path`, `offset: 40`, `limit: 150`, and its result (150 lines)
   - Glob and its result (41 lines)
   - Grep with `path`
   - Bash `npm test` with an **`is_error: true`** result
5. B messages:
   - an `Agent` dispatch **C** (`Explore`, nested depth 2)
   - C messages: one Read with **no result ever**
6. **Out of order:** the tool_result for B arrives **before** the tool_result for A.
7. A root Bash with `run_in_background: true` and its immediate result `"Command running in background with ID: bash_1"`.
8. **Orphan:** a message with `parent_tool_use_id: "toolu_ORPHAN"` (`subagent_type: "general-purpose"`). It arrives **before** its dispatch tool_use, which comes later.
9. A `{"type":"totally_new_event"}` line.
10. Root text "All three angles returned…".
11. `result` (success).

C has no completion, and the background task has no completion.

### 0.2 QA harness: fake CLI (hermetic, $0)

Start the daemon with:

```
SYMBION_CLAUDE_BIN=<repo>/apps/daemon/test/fixtures/fake-claude.mjs
FAKE_CLAUDE_FIXTURE=<fixture>
FAKE_CLAUDE_DELAY_MS=<ms>
```

The child inherits env, so the `FAKE_CLAUDE_*` variables reach the fake CLI.

- **Live journeys (J3–J8):** `fixture-agents-synthetic.ndjson` at `FAKE_CLAUDE_DELAY_MS=800`, so a full run takes ~25 s and is watchable.
- **J10:** `fixture-big-2500.ndjson` at `FAKE_CLAUDE_DELAY_MS=2`.
- **J7 (cancel):** synthetic fixture at `FAKE_CLAUDE_DELAY_MS=1500`. Cancel while C is running.
- **J6d (legacy run):** copy a pre-upgrade run directory into `.symbion/runs/` of the QA project. Any run made on `master` before S1 qualifies; record it before merging S1.
- **Optional real-CLI parity check** (costs tokens): one run of a command that dispatches 2 agents, one of them calling `Bash` with `run_in_background`. If affordable, save its stdout as `packages/core/test/fixtures/run/fixture-real-agents.ndjson`. This retires A-2 / A-3.

---

## 1. Core unit tests (Vitest, `packages/core/test/run/`)

### 1.1 Parser — `parseStreamJson.user-task.test.ts` (S1)

| ID | Case | Expect |
|---|---|---|
| U-P1 | fixture-subagent line 9 (`type:"user"`) | `{kind:"tool-results", parentToolUseId:null, parts:[{kind:"tool_result", toolUseId:"toolu_01DHEMvEreddZCGDShSNn9E7", async:true, resultPreview starts "Async agent launched"}]}` |
| U-P2 | user tool_result with `is_error: true` (synthetic) | `isError: true`. The key is absent when the source is false or missing. |
| U-P3 | fixture-subagent line 8 `task_started` | `{kind:"task", subtype:"task_started", taskId:"ad84ba941854fb18d", toolUseId:"toolu_…SNn9E7", subagentType:"general-purpose", description:"Trivial ping task", promptPreview:'Reply with the single word "pong".', taskType:"local_agent"}` |
| U-P4 | line 12 `task_updated` (`patch.status`) | `status:"completed"`, `toolUseId` undefined |
| U-P5 | line 14 `task_notification` | `status:"completed"`, `summary` set |
| U-P6 | line 7 thinking part | `parts:[{kind:"thinking", textPreview:"The user wants me…"}]`. **No `signature` anywhere** in the JSON-stringified event. |
| U-P7 | `redacted_thinking` part | `{kind:"thinking", textPreview:""}` |
| U-P8 | tool_use `Bash` with `run_in_background:true` and a 5,000-char command | `background:true` is present even though `inputPreview` is truncated. `fields.command.length ≤ 300`. |
| U-P9 | tool_use `Read` | `fields` = `{file_path, offset, limit}` only (whitelist). An unlisted key such as `foo` is absent. Any `prompt` key is absent from `fields`. |
| U-P10 | thinking text of 3,000 chars | capped by `PREVIEW_CAP` with the `…[truncated` marker |
| U-P11 | `system/thinking_tokens` and `rate_limit_event` | still `unknown` (unchanged) |
| U-P12 | `user` with string content / no tool_result | `tool-results`, `parts:[]`, no throw |
| U-P13 | fuzz: 200 random mutations of user/task lines (deleted fields, wrong types) | never throws; every result is a valid `RunEvent` kind |
| U-P14 | `fold` over every new kind | `tokens` / `actors` / `dispatches` deep-equal the run with those events removed; `unknownEvents` not incremented |
| U-P15 | `rollup(fold(fixture-subagent))` before vs after S1 | identical `command` / `byAgent` / `unrecognized` (regression pin: values snapshotted from `master`) |
| U-P16 | `purity.test.ts` | still green (no Node imports in the new files) |

### 1.2 Legacy upgrade — `legacyEvents.test.ts` (S2)

| ID | Case | Expect |
|---|---|---|
| U-L1 | legacy `unknown{type:"user"}` with full raw | `upgradeLegacyEvent` deep-equals `parseLine(raw)` |
| U-L2 | legacy `unknown{type:"system"}` task_started | equals the `task` event from U-P3 |
| U-L3 | legacy user raw truncated at 8,192 (marker present), with `tool_use_id` and `"is_error":true` before the cut | `tool-results` with `toolUseId` salvaged, `isError:true`, `resultPreview:""`, and a legacyTruncated signal |
| U-L4 | legacy `unknown{type:"rate_limit_event"}` / `parse-error` / `message` | passed through by reference (`===`) |
| U-L5 | full legacy fixture-subagent replay vs new-parser replay through `deriveAgentTree` | same agents, statuses, prompts, tokens and tool pairing. Differences are limited to: the Thinking row is not expandable (no `preview`) |

### 1.3 `summarizeToolCall.test.ts` (S3, **AC-2**)

| ID | Input | label / resultLabel |
|---|---|---|
| U-S1 | Read `{file_path:"/a/b/runManager.ts", offset:40, limit:150}`, result of 150 lines | `Read runManager.ts (40–189)` / `150 lines` |
| U-S2 | Read with no offset/limit; Read with only an offset | `Read x.ts`; `Read x.ts (from 40)` |
| U-S3 | Glob `{pattern:"docs/loops/*.md"}`, 41-line result; empty result "No files found" | `Glob "docs/loops/*.md"` / `41 files`; `No files` |
| U-S4 | Grep `{pattern:"parent_tool_use_id", path:"packages"}` | `Grep "parent_tool_use_id" (in packages)` / `N matches` |
| U-S5 | Bash multi-line command; with `isError`; with `background` | first line only, ≤80 chars; `error`; `background` |
| U-S6 | Edit / Write / MultiEdit / NotebookEdit | `Edit sender.ts`, `Write x.md`, … |
| U-S7 | Agent `{subagent_type:"ba", description:"Ideas angle"}`; Task with no subagent_type | `Agent ba "Ideas angle"`; `Task subagent "…"` |
| U-S8 | WebFetch `{url:"https://docs.x.com/a/b?q=1"}`; WebSearch `{query}`; `mcp__github__create_issue` | `WebFetch docs.x.com/a/b`; `WebSearch "q"`; `github · create_issue` |
| U-S9 | result text ending in the `…[truncated 120 chars]` marker | resultLabel uses `N+ lines`; a helper `isTruncatedPreview()` returns true |
| U-S10 | unknown tool `Frobnicate {target:"x"}`; `input = null`; label > 200 chars | `Frobnicate x`; `Frobnicate`; capped at 200 |
| U-S11 | `readToolInput`: legacy part with no `fields`, `inputPreview` valid JSON / truncated JSON | parsed object / best-effort `{}` with no throw |

### 1.4 Agent tree — `agentTree.test.ts` (S4)

| ID | Case | Expect |
|---|---|---|
| U-T1 | **AC-1 (real)**: fixture-subagent, ctx `completed` | Root and 1 child `toolu_…SNn9E7`: agentType `general-purpose`, description `Trivial ping task`, prompt `Reply with the single word "pong".`, status `done` (from the `task_notification`, **not** the async tool_result), `mode:"background"`, `toolCount 0`, result text `pong`. `freshTokens` === `freshOf(fold(...).actors.get(id).usage)`. Root `freshTokens` === `rollup(...).command.totalFresh`. |
| U-T2 | **AC-1 (synthetic)**: Σ over instances grouped by `dispatches.subagentType ∈ agentNames` | equals `rollup().byAgent` per name exactly. The non-matching and orphan sum equals `rollup().unrecognized.fresh`. Instance tokens are exact per toolUseId. |
| U-T3 | async agent before its notification (fixture prefix through line 11) | child `running`; tool row for the dispatch shows a spawn row with status mirroring the child (pending) |
| U-T4 | two init/result pairs (fixture full); `runStatus:"running"` | root stays `running` after the first `result`. Root transcript has 2 `init` system rows and 2 `result` system rows in seq order. |
| U-T5 | nested C under B | `C.parentId === B`; `B.children[0] === C`; root's children are `[A, B, orphan-promoted]` in spawn order |
| U-T6 | B's result arrives before A's | both `done`; tree order is still A then B; `endedAtMs` matches their own result `ts` |
| U-T7 | orphan message before its dispatch (fold the prefix) | `view.unattributed` non-null with that row; `rowsByAgent.get("unattributed")` length ≥ 1 |
| U-T8 | after the dispatch arrives | orphan rows moved to the real agent in seq order; `unattributed === null`; no row lost (count invariant) |
| U-T9 | A's Bash `is_error` | row `status:"error"`, `resultLabel:"error"`, `preview.isError`; `A.errorCount === 1`; `A.status === "done"` (not error) |
| U-T10 | **AC-7**: synthetic with ctx `cancelled`, `runEndedAtMs = T` | no AgentNode in `running` / `starting`. C becomes `interrupted` with `endedAtMs = T`. C's Read row is `interrupted`. Background task `bash_1` becomes `interrupted`. Root is `interrupted`. With `completed`, the background task is `unknown`. With `failed`, root is `error`. Repeat with a `cancelling` ctx: root `running`, no mapping applied. |
| U-T11 | **AC-6 / I1**: fold every prefix k of the synthetic fixture event by event vs `foldAgentTreeBatch` of the same prefix in chunks of 1/7/500 | `selectAgentView` deep-equal for all k |
| U-T12 | seq guard: refold an already-seen event; batch with duplicates | same state reference / identical view |
| U-T13 | **AC-10**: big run (2,500 events) | (a) `foldAgentTreeBatch` over all < 150 ms. (b) Folding event 2,501 into agent X leaves `rowsByAgent.get(Y)` and `agentsById.get(Y)` **reference-equal** for every Y ≠ X and ancestor. (c) `fold` + `foldAgentTree` per event over 5,000 events < 500 ms total, logged for R-1. |
| U-T14 | I4: fixture-garbage plus every `RunEvent` kind with empty / missing fields | no throw; unknown → neutral `unknown` row; parse-error → row labelled `parse-error` |
| U-T15 | I3: each non-`tool-results` event in the synthetic fixture | ≥1 row, except `system/thinking_tokens` (0 rows, sets `nowDoing: "Thinking…"`) |
| U-T16 | rows: timestamps | `atMs = ts − runStartedAtMs`; falls back to the first `ts` when `runStartedAtMs` is null; ids are `${seq}:${partIndex}` and unique |
| U-T17 | tool pairing idempotence: duplicate tool_result; result for an unknown id | duplicate ignored; standalone "result (unmatched)" row |
| U-T18 | prompt truncation (A's 2,500-char prompt, no task_started) | `promptTruncated:true`; the prompt text is the tolerant extract, never raw JSON |
| U-T19 | migrated from derive #1 / #5 | the dispatch spawn row's seq is earlier than the first row of the child; child rows are absent from the root transcript |
| U-T20 | `instancesByType` | `ba → [A, B]`, `Explore → [C]`; root not included |

`derive.test.ts`: delete the `timelineRows` tests #1 and #5 (migrated to U-T19). Tests #2–#4 are unchanged and must pass.

---

## 2. Daemon regression (S1 gate; no new daemon tests expected)

| ID | Case | Expect |
|---|---|---|
| D-1 | full `npm test -w apps/daemon` after S1 | green with zero edits under `apps/daemon/src`. Test edits are limited to fixtures/expectations that assert on parsed kinds, each justified in BUILD notes. |
| D-2 | `run-happyPath` with `FAKE_CLAUDE_FIXTURE=fixture-subagent` | persisted `events.jsonl` contains `tool-results` and `task` kinds and no `unknown{type:"user"}`; the token-cap rollup value is unchanged |
| D-3 | `git diff master -- apps/daemon/src` at REVIEW | empty (the "no daemon change" claim is verifiable) |

---

## 3. Web component tests (Vitest + Testing Library, jsdom)

| ID | Component / unit | Case | Expect |
|---|---|---|---|
| W-1 | `StatusGlyph` | every status × live | the glyph matches the design §3 legend, `aria-label` is present, and the pulse class appears only when `live && running` |
| W-2 | `useNow` / `LiveDuration` | fake timers; `ticking=false` | updates once per second only while live; history renders a frozen `m:ss` |
| W-3 | `AgentTree` | synthetic view (live) | row order is root, A, B, C (indented), orphan; Background group with 1 item; Unattributed hidden when null; "No subagents spawned." for a root-only view |
| W-4 | `AgentTreeRow` depth | depth 4 synthetic | indent capped at 3, then "↳ +n" |
| W-5 | `TranscriptRowView` | each kind | thinking is faint; tool has label · resultLabel; spawn has `›` and calls `onOpenAgent(childId)` on Enter / click; unknown is a neutral `?` row |
| W-6 | error row | `status:"error"` | only the glyph carries the danger class; the label keeps body colour; OUTPUT header reads "· error" |
| W-7 | `StepPreview` | truncated output; pending live; pending terminal; Copy | shows `⋯ truncated — preview capped at 2,000 chars`; "waiting for result…"; "◼ interrupted — no result recorded"; the clipboard receives the stored preview exactly |
| W-8 | `TranscriptList` follow (**AC-5**) | live, mocked dimensions: append rows; scroll up 30 px; append 7; click the pill; press `End` | pinned to the bottom; paused with the pill hidden until a new row arrives; pill reads `↓ 7 new · Jump to latest`; `scrollTop` unchanged while paused; the pill resumes; `End` resumes; expanding a row pauses; readOnly shows no pill and no "following" footer |
| W-9 | `TranscriptList` virtualization (**AC-10**) | 2,500 rows, viewport 400 px | rendered row elements ≤ 60. Scrolling to the middle renders the rows around index ~1,250. The total spacer height = 2,500 × ROW_H plus expanded deltas. |
| W-9a | `windowing.ts` (pure) | `computeOffsets` / `computeWindow` tables | correct prefix sums with measured overrides; window clamps at both ends; overscan respected |
| W-10 | `useRunStore` | `applyEvents` in 3 batches vs 1 batch; `attach(afterSeq>0)` keeps the tree; `attach(0)` resets; `openHistoryRun` paging (mock 3 pages of 500) | identical `agentTree` view; reconnect does not reset; history tree built from all 1,500 events; `timeline` / `historyTimeline` keys no longer exist |
| W-11 | `AgentsPanel` degraded | `degradedReason` set | header chip plus the inline note "Subagent attribution unavailable…" |
| W-12 | `AgentsPanel` past run with no events, `run.lastSeq > 0` | — | "Transcript unavailable for this run."; `[View summary]` only when totals exist |
| W-13 | `AgentTreeRow` not on graph | agentType `Explore` not in graph agents | `not on graph` tag; hover does not call `onHoverAgent` with a node mapping |
| W-14 | `DependencyGraph` node click (mission) | command node; agent `ba` with 2 instances; agent with 0 instances | selects root; `AgentInstancePicker` lists 2 rows (↑↓ + Enter picks); toast "`x` did not run in this run." |
| W-15 | `AgentsPanel` stack + keys | Enter opens; Esc collapses an expanded row first, then pops; Backspace pops; ↑↓ moves the tree focus; scroll / focus restored on back; keys ignored when focus is outside the panel | as stated; **Esc never calls cancel** |
| W-16 | `CancelControl` / `AgentDetailHeader` (**AC-8**) | render | button text "■ Stop run"; confirm copy "Stops the whole run, including all subagents. Files already written stay written."; `AgentDetailHeader` (root and subagent) contains no stop/cancel button (query by role and name) |
| W-17 | session restore (**AC-6**) | sessionStorage holds `{view:"agent", agentId:B}`; the view later contains B | opens B's detail; an unknown agentId falls back to the tree |
| W-18 | `RunSummarySection` | `← Agents` calls `onBack`; a cost row calls `onOpenAgent` | as stated; the `[Feed]` text is gone |
| W-19 | AC-9 guard | repo grep (in a test or CI script): `RunTimelinePanel`, `timelineRows`, `TimelineRow`, `panelFilterId` | 0 matches outside `docs/` |
| W-20 | `RawEventLog` | history mode with 1,500 events | shows the history run's events (not the live tail); windowed |

---

## 4. Live browser journeys (chrome-devtools; `/qa` runs in order)

Setup:
1. Run `npm run dev` with the daemon started using the §0.2 env.
2. Create a QA project with command `/analyze` that @mentions agents `ba` and `Explore`, so B's nested `Explore` maps to a node. Publish it.
3. For each J, record in STATE QA: a screenshot, the console (must show 0 errors), and pass/fail.

| J | AC | Steps | Pass criteria |
|---|---|---|---|
| **J1** | AC-1 | Run `/analyze` on `fixture-subagent.ndjson` (delay 50). After the run ends, compare each tree row's tokens with the graph badge (hover → TokenBreakdownCard), and with `runSummary` cost-by-node. | Root tokens equal the command badge. The `general-purpose` child shows prompt `Reply with the single word "pong".`, status ✓, its own tokens, and `0 tools`. All numbers equal the badges exactly. |
| **J2** | AC-2 | Run the synthetic fixture. Open A, then the root. | Rows read `Read STATE.md (40–189) · 150 lines`, `Glob "…" · 41 files`, `Grep "…" (in packages)`, `Bash npm test … · error`, `Agent ba "Solutions angle" ›`, `Bash … · background`. Long labels ellipsize, with the full text in a tooltip. |
| **J3** | AC-3 | Synthetic fixture, delay 800. Watch without interacting. | Subagent rows fade in **at the moment** the dispatch is streamed, and the matching node glows. Durations tick every second; tokens update. The now-doing line changes. The BACKGROUND · 1 group shows `$ …` running. No re-sorting. The root `◌ starting…` shows before the first event. |
| **J4** | AC-4 | During the run: click B in the panel, then `←`. Click the `ba` node on the graph (2 instances), pick "Solutions angle" in the picker. Click the command node. Expand a tool row. | Detail shows the header (status, ba, model, duration, tokens, "spawned by /analyze"), a 3-line prompt with Show more, tool rows in order, a Thinking row, and on finish the Result card. The selected node shows the brand-accent halo **outside** the status ring; hover gives a soft halo. Expanded INPUT/OUTPUT appear in `bg-code`, with the truncation marker on a capped preview. The command node opens the root detail with REQUIREMENT. |
| **J5** | AC-5 | In the root detail while live: scroll up >24 px, wait for ≥3 rows, click the pill. Repeat, and press `End`. | The viewport does not move while paused. The pill counts new rows. The pill and `End` both resume following. Expanding a row pauses following. |
| **J6** | AC-6 | Mid-run, open B's detail, then press F5. | The skeleton shows, then B's detail is restored. Tree, statuses, durations, tokens and row count match the screenshot taken before the refresh (run-elapsed tickers excepted). No replay animations. |
| J6b | AC-6 | Mid-run, stop the daemon for 15 s, then restart it. | `⟳ reconnecting…` / polling. Pulses freeze, the panel keeps its state, and it catches up after reconnect with no duplicate rows. |
| J6c | AC-6 | Open a past run from 🕘, then delete its `events.jsonl` on disk and reopen it. | "Transcript unavailable for this run." plus `[View summary]`. |
| J6d | AC-6 | Open the pre-upgrade (legacy) run from 🕘. | The tree renders. Tool results are paired, or explicitly marked "not recoverable". Thinking rows are not expandable. No crash. |
| J6e | AC-6 | Open the completed synthetic run from 🕘. | `PastRunBanner` shows. Same tree and details, read-only: no ticking, no follow, no motion. Drill-down, expand and graph linking all work. |
| **J7** | AC-7 | Synthetic fixture, delay 1500. Stop the run while C is running. Separately, wait for the `is_error` Bash row. | After the cancel settles: no `◉` anywhere in the tree, any detail, or the background group. C and its pending Read show `◼ interrupted`, with durations frozen. Outcome card: `◼ Cancelled by you · …`. The error row shows a red ✗ glyph only, and A shows `· 1 error` with A itself ✓. |
| **J8** | AC-8 | Inspect every subagent detail and the root detail. Use `■ Stop run` in `MissionStatusStrip`. Run `ps` for descendants after 5 s (fake CLI with `FAKE_CLAUDE_MODE=spawn-child` for the process check). | The only stop control is `■ Stop run` in the strip / RunBar, with the two-step confirm copy. No per-agent stop button exists. The process group is gone (same as today's cancel). |
| **J9** | AC-9 | Walk the §10.6 parity map against a terminal synthetic run: init row, text rows, tool rows with input and step tokens, dispatch → spawn row, result rows, unknown row, `m:ss` column, Raw via `≡` (all events), Summary via `[View summary]`. | Every old timeline item is reachable. `RunTimelinePanel` no longer exists (W-19 green). No auto-switch to Summary at run end: the Outcome card shows, plus the "Run finished" strip when inside a detail. |
| **J10** | AC-10 | `fixture-big-2500.ndjson` at delay 2. Open the root detail and record a chrome-devtools Performance trace while the run streams and while scrolling top ↔ bottom. Inspect the DOM row count. | No long task > 100 ms while streaming. Scrolling stays smooth (frames ≈ 60 fps, no task > 50 ms in the scroll section). DOM transcript rows ≤ 60 at any time. The history reopen of the same run renders in < 1 s after the data loads. |

Also check during QA:
- The panel is 360 px wide (Q1) and the graph row grows to the viewport height during a run (Q2).
- `prefers-reduced-motion` (devtools emulation) turns off every fade, slide and pulse.
- Keyboard hint is shown faint while live (Q9).
- No toasts are fired for agents (Q10).
