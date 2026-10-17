# workflow-agent-run — Design

> Spec: `workflow-agent-run-STATE.md` §8 (research on the Claude Code extension) and §9 (LOCKED scope).
> Synthesized from 3 designer angles (minimalist, rich, progressive), now in `_archive/`.
> `DESIGN.md` does not exist. The binding tokens are `apps/web/tailwind.config.ts`: `bg-panel`, `bg-menu`, `bg-code`, `border-hairline`, `text-body/muted/faint`, `agent`, `command`, `success`, `warning`, `danger`, `run-active` (live state only, never an outcome), `brand-accent`, `rounded-panel`, `rounded-pill`, `shadow-dropdown`. Animations: `glowPulse`, `dashFlow`, `countLockIn`, `slideIn`, `fadeIn`, `popIn`. No new colours are introduced.

## Why this blend

- **Skeleton from Minimalist.** One panel holds a push/pop **view stack** (Tree → Agent → Summary / Raw). There are no tabs, no new modals and no filter chips: drilling into an agent *is* the filter. Rows are one line. Status is carried by **glyph shape**, and colour only backs it up.
- **From Progressive.**
  - The **Outcome card** at run end, and **no auto-navigation away from what the user is reading** (an inline "Run finished" strip instead).
  - The **instance picker** for a graph node that ran N times.
  - Hidden-until-present groups (Background, Unattributed).
  - The explicit truncation marker.
- **From Rich.**
  - A **selection halo as a second ring *outside* the status ring**, so selection never hides status.
  - Hovering a panel row lights its node and edge.
  - Live tickers, row fade-in and drill-down slide. All motion is **live only**: none on replay, history or under `prefers-reduced-motion`.
  - A sticky agent header, the Result card at the end of a transcript, and the "↓ N new · Jump to latest" pill.
- **Deferred to Future Ideas:**
  - From Progressive: filter bar, `E`/`F`/`[`/`]` power keys, collapsed rail, first-run hint.
  - From Rich: hover preview card, token-share bars, per-agent toasts.

  They are good, but they are polish on top of an unproven core, and several of them carry open taste questions.

---

## 1. User Journey (happy path)

1. **Launch (unchanged).** The user runs `/analyze` from a graph node or ⌘K, then preflight, consent and confirm. `MissionStatusStrip` shows `◌ STARTING /analyze`. The **Agents panel** slides into the right slot where `RunTimelinePanel` used to be. It shows the root row `◌ /analyze · sonnet · starting…` and "Waiting for the CLI to start streaming…".
2. **Root comes alive.** On the first event, the root glyph becomes a pulsing cyan `◉`. Duration ticks and tokens update live. A muted **now-doing** line under the root shows its latest step (`Read runManager.ts (40–189)`). The command node on the graph glows as today.
3. **Subagents appear.** Each `Task`/`Agent` tool_use adds a child row (fade-in) showing `◉ ba · Requirements angle · 0:12 · 3.4k`. The graph's edge flows and the agent node glows **at the same moment**. Rows stay in spawn order and never re-sort.
4. **Locate.** Hovering a row puts a soft halo on its graph node and brightens its incoming edge.
5. **Drill in.** Clicking a row, pressing `Enter`, or clicking the node on the graph pushes **Agent detail**: a sticky header (status, agentType, model, duration, tokens, "spawned by /analyze"), the prompt clamped to 3 lines, then the **transcript**. The transcript has one line per step (Thinking, tool calls with a result summary, spawn rows), auto-follows the bottom, and new rows fade in. The node keeps a persistent **selection halo**.
6. **Inspect a step.** Clicking `✓ Read derive.ts (40–189) · 150 lines` expands it inline into INPUT / OUTPUT previews in `bg-code`. A preview that was cut ends with `⋯ truncated — preview capped at 2,000 chars`.
7. **Scroll up.** Follow pauses and a pill shows `↓ 7 new · Jump to latest`. Clicking the pill or pressing `End` resumes following.
8. **Back.** `← Agents`, `Esc` or `Backspace` pops back to the tree with the scroll position and focused row restored. The halo clears.
9. **Run ends.** Every running glyph settles in the same render: `✓` done, `✗` error, or `◼` interrupted. Nothing stays cyan.
   - In the tree, an **Outcome card** appears at the top: `✓ Completed · 4m12s · 48.1k · ~$0.41 · 6 files  [View summary]`.
   - In an agent detail, the user is not moved. A thin strip appears instead: `Run finished — [View summary]`.
10. **Summary.** `[View summary]` pushes the existing `RunSummarySection`. Its cost-by-node rows now link to agent detail.
11. **Past run.** From `🕘 runs N`, the user picks a run. `PastRunBanner` appears and the **same** views render read-only from `events.jsonl`: final values, no ticking, no follow, no motion. Expand, drill and graph linking all still work.
12. **Stop.** The only stop is `■ Stop run` in `MissionStatusStrip` / `RunBar`. It is a two-step confirm: "Stops the whole run, including all subagents. Files already written stay written."

---

## 2. Screen Inventory

All entries are states of one `AgentsPanel` (a view stack in the existing right slot) plus two small graph-side overlays.

| # | Screen / state | Entry trigger | Exit path |
|---|---|---|---|
| S1 | **Tree, starting** | Run `starting`, 0 events | First event → S2 |
| S2 | **Tree, live** (root, subagents, Background, Unattributed) | First event, or F5 reattach once replay is done | Row / node click → S4. Terminal → S3 |
| S3 | **Tree, terminal**, with Outcome card (completed / failed / cancelled / stopped) | Run reaches a terminal status | `[View summary]` → S6. Row → S4. RunBar ✕ unmounts |
| S4 | **Agent detail** (root or subagent; live or terminal) | Tree row, `Enter`, graph node (1 instance), spawn row in a parent transcript, Summary cost row | `← Agents`, `Esc`, `Backspace`, or a breadcrumb segment |
| S4a | ↳ step expanded (inline) | Click a step, or `Space` | Click / `Space`. `Esc` collapses first, then goes back |
| S4b | ↳ follow paused, Jump pill | Scroll up more than 24px while live | Pill, `End`, or scrolling to the bottom |
| S4c | ↳ "Run finished" strip | Run turns terminal while in a detail | `[View summary]`, or ✕ to dismiss the strip |
| S5 | **Raw log** (existing `RunLogTail`) | `≡` button in the root agent header | `← back` |
| S6 | **Summary** (existing `RunSummarySection`) | `[View summary]` | `← Agents` |
| S7 | **Past run**: S2–S6 read-only under `PastRunBanner` | History popover pick | `Exit history` |
| S8 | **Loading / reattaching** skeleton | History fetch, or F5 replay in flight | Data ready → S2/S3/S7 |
| G1 | **Graph halo** (hover = soft, selected = `brand-accent`) | Panel row hover / open detail | Mouse-out / back |
| G2 | **Instance picker** popover on a node | Click an agent node that ran 2+ times | Pick → S4. `Esc` or click outside closes it |

---

## 3. ASCII Wireframes

Glyph legend (the shape carries the status; colour reinforces it):

| Glyph | Status | Colour |
|---|---|---|
| `◌` | starting | `run-active`, faint pulse |
| `◉` | running | `run-active`, pulse |
| `✓` | done | `success` |
| `✗` | error | `danger` |
| `◼` | interrupted / cancelled | `text-faint` |
| `○` | pending step (no result yet) | `text-muted` |
| `·` | thinking | `text-faint` |
| `?` | unknown event | `text-faint` |

`›` means the row drills into another view. `▸` / `▾` mean collapsed / expanded.

Panel is drawn about 46 columns wide (≈360px, see Q1).

### 3.0 Mission layout

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ RUNNING  /analyze — "add run diff"                    ⏱ 02:14     [ ■ Stop run ]   │ ← MissionStatusStrip (only stop)
├──────────────────────────────────────────┬───────────────────────────────────────────┤
│ [+][⤢][?]  [🕘 runs 7]                    │ AGENTS · 3                    ⚠deg        │
│        ┌───────────┐                     │ (S1–S6 render here)                       │
│        │ /analyze ◉│══╗ dashFlow         │                                           │
│        └───────────┘  ║                  │                                           │
│              ╔════════▼═════╗            │                                           │
│              ║ ┌──────────┐ ║ ← halo     │                                           │
│              ║ │ ba  ×3 ◉ │ ║   (outside │                                           │
│              ║ └──────────┘ ║   status   │                                           │
│              ╚══════════════╝   ring)    │                                           │
├──────────────────────────────────────────┴───────────────────────────────────────────┤
│ ◉ RUNNING /analyze 02:14                                             [ ■ Stop run ]  │ ← RunBar (unchanged)
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### S1 — Tree, starting

```
┌─────────────────────────────────────────────┐
│ AGENTS                                      │
├─────────────────────────────────────────────┤
│ ◌ /analyze   sonnet          00:03     —    │
│   starting…                                 │
│                                             │
│   Waiting for the CLI to start streaming…   │ muted, animate-pulse
└─────────────────────────────────────────────┘
```

### S2 — Tree, live

```
┌─────────────────────────────────────────────┐
│ AGENTS · 4                     ⚠ degraded   │ chip only when degraded
├─────────────────────────────────────────────┤
│[◉ /analyze   sonnet          02:14  31.2k ]│ root: model · run elapsed · fresh tok
│   Task → ba "Ideas angle"                   │ now-doing (live only, ≤4 updates/s)
│[  ✓ ba   Requirements angle   0:58   9.1k ]│ agentType (agent hue) · description
│[        14 tools                          ]│ terminal agent: counts replace now-doing
│[  ◉ ba   Solutions angle      0:51   7.7k ]│
│[        Grep "parent_tool_use_id" (in p…  ]│
│[    ◉ Explore  scan fixtures  0:12   1.4k ]│ depth 2: +12px/level, cap 3 then "↳ +n"
│[  ✗ ba   Ideas angle          0:40   6.0k ]│ error: ✗ and "2 errors" in danger
│[        9 tools · 2 errors                ]│
│                                             │
│ BACKGROUND · 1                              │ hidden when 0
│[  ◉ $ npm test -- run         1:02        ›]│ → root transcript scrolled to that row
│ UNATTRIBUTED · 12 events ⚠                › │ hidden when 0; opens a pseudo-agent
├─────────────────────────────────────────────┤
│ ↑↓ select · ↵ open                          │ faint, live only (Q9)
└─────────────────────────────────────────────┘
  hover token figure → existing TokenBreakdownCard
  hover row → soft halo on its graph node + brighter incoming edge
  selected row → bg-brand-accent-soft + 2px left bar
```

### S3 — Tree, terminal (failed shown)

```
┌─────────────────────────────────────────────┐
│ AGENTS · 4                                  │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │ Outcome card: bg-surface, rounded-panel
│ │ ✗ Failed — exit 1 · 3m08s · 22k · ~$0.19│ │ status word coloured, rest body text
│ │ 4 files changed        [ View summary ] │ │
│ └─────────────────────────────────────────┘ │
│[✗ /analyze   sonnet          03:08  22.0k ]│
│[  ✓ ba   Requirements angle   1:31  12.0k ]│
│[  ◼ ba   Solutions angle      1:20   8.4k ]│ was running at failure → interrupted, not ✗
│[        interrupted                       ]│
│ BACKGROUND · 1                            ▸ │ auto-collapsed at terminal
└─────────────────────────────────────────────┘
Card variants:
  ✓ Completed · …
  ◼ Cancelled by you · … · Files already written stay written.   (text-muted)
  ⚠ Stopped — token cap · … [Adjust ceilings ›]                    (warning)
```

### S4 — Agent detail (subagent, live)

```
┌─────────────────────────────────────────────┐
│[← Agents]  /analyze › ba · Solutions     ≡? │ breadcrumb segments clickable; ≡ root only
├─────────────────────────────────────────────┤ ── sticky header ──
│ ◉ running · ba · sonnet · foreground        │
│ ⏱ 0:51 · 7.7k tok · ~$0.04 · 12 tools       │ live tickers, mono tabular-nums
│ spawned by [/analyze ›]                     │
├─────────────────────────────────────────────┤
│ PROMPT                                  [⧉] │
│ You are the solution analyst. Read          │ 3-line clamp
│ docs/loops/workflow-agent-run-STATE.md and… │
│                               [Show more ▸] │
├─────────────────────────────────────────────┤
│ 0:02 · Thinking                             │ faint (Q6)
│ 0:04 ✓ Glob "docs/loops/*.md" · 41 files    │ label · result summary
│ 0:06 ✓ Read STATE.md (40–189) · 150 lines   │ full label in tooltip when truncated
│ 0:09 ✓ Grep "parent_tool_use_id" (in pack…  │
│ 0:11 ✗ Bash npm test -- derive · exit 1     │ only the glyph is red
│ 0:20 ✓ Agent Explore "scan fixtures"      › │ spawn row: drills into the child
│ 0:31 ○ Read parseStreamJson.ts (150–220)    │ pending
│                                             │
│          ╭───────────────────────────╮      │
│          │ ↓ 7 new · Jump to latest  │      │ only while follow is paused (S4b)
│          ╰───────────────────────────╯      │
├─────────────────────────────────────────────┤
│ ▼ following                                 │
└─────────────────────────────────────────────┘
```

### S4 — Agent detail, root agent (the old timeline, folded in: AC-9)

```
│[← Agents]  /analyze                       ≡ │ ≡ → Raw log (S5)
│ ◉ running · /analyze · sonnet               │
│ ⏱ 2:14 · 31.2k tok · ~$0.27 · 23 tools      │
│ REQUIREMENT                                 │ the run requirement = root "prompt"
│ add run diff                                │
│ 0:00 · init session · sonnet                │ system row (kept from derive)
│ 0:03 ✓ Read CLAUDE.md · 82 lines            │
│ 0:08 ◉ Agent ba "Requirements angle"      › │
│ 0:09 ✓ Bash npm run dev & · background    › │
│ 0:40   Text "All three angles returned…"    │ assistant text (one line)
│ 0:41 ? unrecognized event (system_hook)     │ neutral, expandable to raw preview
```

### S4 — terminal: Result card, and the finished strip

```
│ 1:10 ✓ Edit sender.ts                       │
│ ┌ RESULT ──────────────────────────────── ⧉┐│ left bar: success (danger if agent errored)
│ │ Found 2 regressions: 1. backoff resets…  ││
│ │ ⋯ truncated — preview capped at 2,000 ch ││ only when capped
│ └──────────────────────────────────────────┘│
│ ✓ done in 1m12s · 18.4k tok · ~$0.09        │ footer replaces "following"
├─────────────────────────────────────────────┤
│ Run finished — ✓ completed  [View summary] ✕│ S4c strip (only if run ended while here)
```

### S4a — Step expanded

```
│ 0:11 ▾ ✗ Bash npm test -- derive · exit 1   │
│   ┌ INPUT ──────────────────────────── ⧉ ┐  │ bg-code, mono 10.5px
│   │ npm test -- derive                   │  │
│   ├ OUTPUT · error ──────────────────── ⧉ ┤  │ "· error" in danger; danger/10 bg
│   │ FAIL derive.test.ts > rollup …       │  │ max-height ~12 lines, inner scroll
│   │ Expected 3, received 2               │  │
│   │ ⋯ truncated — preview capped at 2,000│  │ explicit, never a silent cut
│   └──────────────────────────────────────┘  │
│   step tokens  in 1,204 · out 88            │ carried over from the old timeline
```

- **Copy** copies the stored preview exactly, never more.
- **Pending step:** INPUT, then `waiting for result…`. Once the run is terminal: `◼ interrupted — no result recorded`.

### S6 / S7 / S8 — Summary, past run, loading

```
Summary (pushed)                              Past run
┌───────────────────────────────────────┐    ┌────────────────────────────────────────────────┐
│[← Agents]  Summary — ✓ completed      │    │ 🕘 VIEWING PAST RUN · #5 · Oct 16 14:02 · …    │ PastRunBanner
│ (RunSummarySection unchanged;         │    │ failed · 3m08s · read-only [▶ Run again][Exit]│
│  cost-by-node rows → agent detail ›)  │    └────────────────────────────────────────────────┘
└───────────────────────────────────────┘    Panel = S3/S4/S6 with live=false: Outcome card always,
                                             no now-doing, no follow/pill, no ticking, no motion.
Loading / reattach
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ 3 skeleton bars in tree shape (no spinner)
│   ░░░░░░░░░░░░░░░░░░░         │
│   rebuilding agents… 1,240 ev │ then the whole tree renders in one swap
```

### G2 — Instance picker (graph)

```
        ┌──────────┐
        │  ba  ×3  │◀ click
        └──────────┘
   ┌────────────────────────────────────┐ bg-menu, shadow-dropdown, popIn
   │ ba ran 3 times                     │ ↑↓ + Enter
   │ ✓ Requirements angle  1:31  12.0k  │
   │ ◉ Solutions angle     0:51   7.7k  │
   │ ✗ Ideas angle         0:40   6.0k  │
   └────────────────────────────────────┘
 Node that did not run → neutral toast "`code-reviewer` did not run in this run."
 Root command node → opens the root agent detail.
```

---

## 4. Component Breakdown

Everything new goes in `apps/web/src/components/run/agents/`. These are interface contracts for `/plan` to confirm.

### Core (pure, `packages/core/src/run/`): view-models

```ts
AgentNode {
  id; parentId: string|null; kind: "root"|"subagent"|"unattributed";
  agentType; description?; model?; graphNodeId: string|null;
  status: "starting"|"running"|"done"|"error"|"interrupted";
  startedAtMs; endedAtMs?; freshTokens; usage: FourWay;      // = existing roll-up (AC-1)
  toolCount; errorCount; nowDoing?: string;
  prompt?: string; promptTruncated?: boolean;
  result?: { text: string; truncated: boolean; isError: boolean };
  children: AgentNode[];
}
BackgroundTask { toolUseId; ownerAgentId; label; status: "running"|"done"|"error"|"unknown"|"interrupted"; startedAtMs; endedAtMs? }
TranscriptRow {
  seq; atMs; agentId;
  kind: "thinking"|"tool"|"spawn"|"text"|"result"|"system"|"unknown";
  status: "ok"|"error"|"pending"|"interrupted"|"neutral";
  label: string;            // summarizeToolCall(name, input)
  resultLabel?: string;     // "150 lines" · "41 files" · "exit 1"
  childAgentId?: string; background?: boolean;
  preview?: { input?: string; output?: string; truncated: boolean; isError: boolean;
              stepTokens?: { input: number; output: number } };
}
```

- Derivation is an **incremental fold**: each event updates only the touched nodes and rows, keeping object identity for untouched ones so React can skip work (AC-10).
- Terminal mapping (`running` → `interrupted`, `pending` → `interrupted`) is pure, so AC-7 is unit-testable.

### New web components

| Component | Responsibility | Key props |
|---|---|---|
| `AgentsPanel` | Replaces `RunTimelinePanel` at the same mount point. Owns the view stack and the keyboard scope | `tree: AgentNode`, `background`, `unattributed`, `rowsByAgent`, `runStatus`, `live`, `readOnly`, `summary?`, `rawLines`, `degradedReason`, `selectedAgentId` (controlled), `onSelectAgent`, `onHoverAgent`, `onRerun`, `onClose`, `projectId`. State: `stack`, `treeScroll`, `treeFocus` |
| `AgentTree` / `AgentTreeRow` | S2/S3 list, recursive | `node`, `depth`, `selected`, `focused`, `live`, `isNew`, `onOpen`, `onHover` |
| `RunOutcomeCard` | Terminal card at the top of the tree | `status`, `durationMs`, `freshTokens`, `costUsd?`, `filesChanged`, `onViewSummary`, `onAdjustCeilings?` |
| `BackgroundGroup`, `UnattributedGroup` | Groups that are absent when empty | `tasks` / `eventCount`, `onOpen` |
| `AgentDetailView` | S4 | `agent`, `breadcrumb`, `rows`, `live`, `isRoot`, `onBack`, `onNavigate(agentId)`, `onRaw?` |
| `AgentDetailHeader` | Sticky meta plus tickers | `agent`, `spawnedBy`, `live` |
| `PromptBlock` | Prompt or REQUIREMENT, 3-line clamp, copy | `label`, `text`, `truncated` |
| `TranscriptList` | Virtualized list, follow / pause / new-count, `expanded: Set<seq>` | `rows`, `live`, `onOpenAgent` |
| `TranscriptRowView` | Variants by `kind` | `row`, `expanded`, `focused`, `isNew`, `onToggle` |
| `StepPreview` | S4a | `preview`, `pending`, `interrupted` |
| `ResultCard`, `RunFinishedStrip`, `JumpToLatestPill` | | |
| `StatusGlyph` | Single source of glyph and colour for every run status | `status`, `live` (pulse only when live), `size`. Always has an `aria-label` |
| `LiveDuration` | Every row is driven by **one** panel-level 1s clock | `startedAtMs`, `endedAtMs?`, `ticking` |
| `AgentInstancePicker` | G2 | `anchorRect`, `instances`, `onPick`, `onClose` |

### Modified / reused

- **`DependencyGraph`**
  - Remove `panelFilterId` / filter chips.
  - Own `selectedRunAgentId` and `hoveredRunAgentId`.
  - Map runtime instance → graph node (`agentType` = agent name; root → command node).
  - Node click in mission/history mode opens detail (1 instance), the picker (N instances) or a toast (0 instances).
- **Graph nodes (`components/graph/`)**
  - New `runHovered` / `runSelected` props draw an outer halo ring composed outside the status ring. Hover halo: `white/50`. Selected halo: `brand-accent`.
  - `GraphEdgePath` gets `runLinked`, which brightens the stroke.
  - The existing `×N` invocations badge is kept.
- **`CancelControl`:** label `■ Cancel` → `■ Stop run`. Confirm copy: "Stops the whole run, including all subagents. Files already written stay written."
- **`RunSummarySection`:** header button `[Feed]` → `← Agents`. Optional `onOpenAgent(id)` turns cost-by-node rows into links.
- **Unchanged:** `MissionStatusStrip`, `RunBar`, `PastRunBanner`, `RunHistoryPopover`, `RunLogTail` (shown as S5), `TokenBreakdownCard` (hover target), `DegradedTelemetryChip`.
- **shadcn:** `Button`, `Tooltip`, `Badge`. No new primitives.
- **Deleted:** `RunTimelinePanel`, after its derive logic and tests are absorbed into core `deriveAgentTree` / `TranscriptRow`.

---

## 5. Interaction Notes

**Selection and linking**
- **Row hover** puts a soft halo on the node and brightens the incoming edge, in 120ms with no layout shift.
- **Open detail** sets a persistent `brand-accent` halo, plus the existing one-shot pulse.
- **Back** clears the halo.
- **Built-in agents** with no graph node (`Explore`, `general-purpose`, or names not in the graph) show a `not on graph` tag on the row. Nothing is highlighted and no error is shown.

**Keyboard** (only while focus is inside the panel, so it never steals graph or ⌘K keys)

| Key | Action |
|---|---|
| `↑` / `↓` | Move the cursor in the tree |
| `Enter` | Open the agent under the cursor |
| `j` / `k` | Move between rows in a detail |
| `Space` | Expand / collapse the step |
| `Enter` on a spawn row | Drill into that agent |
| `Esc` / `Backspace` | Collapse, then back |
| `End` | Jump to latest |

**`Esc` never stops a run.**

**Live behaviour**
- One shared 1s clock drives durations. Tokens update on each SSE fold.
- Panel numbers must equal the graph badge numbers at every instant (same roll-up).
- **Now-doing** is throttled to ≤4 updates/s and hidden once the agent is done.
- **Follow:**
  - On by default in a live detail.
  - Scrolling up more than 24px pauses it and shows the pill with a live count.
  - Expanding a row pauses follow, so the row doesn't scroll away.
  - Rows arriving while paused never move the viewport.
- **Tree inserts** never auto-scroll. If a new agent lands below the fold, a `↓ 1 new agent` chip appears.

**Motion** (live only; all of it is off for replay, history and `prefers-reduced-motion`)

| Element | Motion |
|---|---|
| Row insert | `fadeIn` + 4px drop, 160ms |
| Running glyph | `glowPulse` |
| Settle (running → done / error) | One-shot `countLockIn` |
| Drill-down | `slideIn` forward, mirrored on back |
| Run end | No motion beyond glyphs settling |

**Loading**
- Live, starting: S1.
- Past run, or F5 reattach: S8 skeleton, then the whole tree in one swap. No row-by-row animation and no replay toasts.
- After F5, restore the previous view (tree, or detail + agentId) from `sessionStorage` if that agent still exists (AC-6).

**Empty** (absence is the empty state)
- No subagents: "No subagents spawned." in faint text under the root.
- Agent with no tools: "No tool calls yet." (live) or "No tool calls recorded." (terminal).
- No result text: the Result card reads "No final message".
- Background / Unattributed groups are absent when empty.

**Error and degraded**
- Tool `is_error`: red `✗` glyph on the row. The label stays body colour. The OUTPUT header reads `· error` on a danger tint.
- An agent turns `✗` only if the agent itself ends in error. Its tool errors otherwise show as a count (`2 errors`).
- An agent still running when the run fails or is cancelled becomes `◼ interrupted`, never `✗`.
- Unknown / unparseable events: a neutral `?` row, expandable to the raw preview. Each row has a render error boundary ("couldn't render this step"). The panel never throws.
- Degraded telemetry: the chip in the panel header, plus an inline note: "Subagent attribution unavailable — all activity is in the root transcript."
- SSE reconnecting: the strip already says `⟳ reconnecting…`. The panel pulses freeze to static cyan, with no duplicate banner.
- Past run with missing or pruned `events.jsonl`: "Transcript unavailable for this run." plus `[View summary]` when `run.json` has totals.

**Cancel**
- During `cancelling`, the glyphs stop pulsing (static) and the header reads `stopping…`.
- On terminal, the mapping in core converts every remaining running / pending item to `◼`. Durations freeze at the run end (AC-7).

---

## 6. Open Design Questions (taste calls for the user)

> **RESOLVED 2026-10-16 (user): every suggested option was accepted.**
> - Q1: 360px fixed.
> - Q2: the mission layout grows to viewport height.
> - Q3: drop the auto-switch to Summary.
> - Q4: instance picker.
> - Q5: visible `m:ss` column.
> - Q6: Thinking rows faint, one line each (expandable only if the text is stored).
> - Q7: done = `success` green.
> - Q8: Raw via `≡` in the root header.
> - Q9: faint keyboard hint while live.
> - Q10: no per-agent toasts.

All 3 angles raised Q1–Q3.

1. **Panel width.** Today it is a fixed 320px, which is tight for one-liners plus duration plus tokens. Options:
   - (a) 360px fixed **← suggested**
   - (b) 320px plus an "expand" toggle to about 560px
   - (c) a drag-resizable splitter, persisted
2. **Panel height.** The graph row is a fixed `height: 480`, which shows about 14 transcript rows. Should the mission layout grow to the viewport height while a run is shown? **Suggested: yes.**
3. **Run-end behaviour.** Today the panel auto-switches to Summary. This design **drops the auto-switch** in favour of the Outcome card plus the inline strip. Confirm.
4. **Graph node with N instances.** Options:
   - (a) instance picker (this design)
   - (b) open the most recent instance
   - (c) stay on the tree with all instances highlighted
5. **Timestamps on transcript rows.** Keep a visible `m:ss` column (this design; parity with the old timeline), or show it only in a tooltip to save width?
6. **Thinking rows.** Options:
   - show faint, one line each (extension parity, this design)
   - collapse consecutive ones
   - hide behind a toggle

   `/plan` must also confirm whether thinking text is stored in `events.jsonl` at all. If it isn't, Thinking rows are not expandable.
7. **Done colour.** `success` green (extension parity, this design), or neutral `text-muted ✓` so only running and error carry colour?
8. **Raw log.** Reached by `≡` in the root header (this design). Is that discoverable enough for users who relied on the old Raw tab?
9. **Keyboard hint footer** (`↑↓ select · ↵ open`). Show it faint while live, or hide it?
10. **Toasts.** None for agents in this iteration (the existing run-end feedback is kept). Should an **agent error** fire a toast with `[View]`? That would need an action slot on the single-slot Toaster.

---

## 7. Future Ideas (out of this iteration)

- **Power tools** (from Progressive): filter bar (tool type / errors only / hide thinking), `E` next error, `[` `]` sibling agents, `?` shortcuts sheet, collapsed rail, first-run hint.
- **Hover preview card** over the graph, and token-share bars per sibling (from Rich).
- **Per-agent toasts** with coalescing and priority (from Rich).
- Search inside a transcript (`/`).
- Copy a whole agent transcript as markdown.
- Trace-to-source: open the agent's `.md` in CodeMirror from the detail header, with a "61% of tokens in Read" hint.
- A Gantt / flame view of agent lifetimes, and a replay scrubber (FR-12).
- Compare this agent's run with the previous run (run diff).
- One-click "allow this tool" from a denied-tool row (FR-8).
- Per-subagent Stop (blocked by the headless CLI, §8).
- An "Agent map" modal variant.
- A `DESIGN.md` seed: the `StatusGlyph` vocabulary, the selection-halo rule ("selection never replaces status"), and the truncation-marker rule. These are proposals only and are not written.
