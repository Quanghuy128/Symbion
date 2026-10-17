# workflow-agent-run — Design (angle: progressive disclosure)

> Designer angle 1 of 3 for `/design`. Spec source: `docs/loops/workflow-agent-run-STATE.md` §8 (research) and §9 (LOCKED scope).
> Binding constraints: **no `DESIGN.md` exists at the repo root**. The de-facto token set is `apps/web/tailwind.config.ts`, which was ported from the dark-redesign DESIGN.md proposal (`bg-panel`, `bg-menu`, `bg-code`, `border-hairline`, `text-body/muted/faint`, `agent`, `command`, `success`, `warning`, `danger`, `run-active`, `rounded-panel`, `rounded-pill`, `shadow-dropdown`, animations `slideIn`, `glowPulse`). This design reuses only those tokens. The rule that `run-active` is for live state only and never for outcomes is kept.
> Fits into what exists: the 320px right column in `DependencyGraph.tsx` (now `RunTimelinePanel`) becomes the **Agents panel**. `MissionStatusStrip`, `RunBar`, `CancelControl`, `PastRunBanner`, `RunHistoryPopover`, `RunSummarySection`, `TokenBreakdownCard`, `RunLogTail` and `DegradedTelemetryChip` are kept and placed in it.

---

## 0. The disclosure ladder (the core idea of this angle)

Every level answers one more question. Nothing from a deeper level shows up at a shallower one unless the user has asked for it.

| Level | Question it answers | What is visible | How the user goes deeper |
|---|---|---|---|
| **L0 Graph** | "Is it running?" | Glow on nodes, status strip, elapsed time | The panel slides in by itself when a run starts |
| **L1 Tree** | "Who is working, and how far along?" | One row per agent: dot, name, short "now doing" line, duration, tokens | Click a row, click a graph node, or press `Enter` |
| **L2 Agent transcript** | "What did this agent do?" | Collapsed header, prompt clamped to 3 lines, one line per step | Click a row, or press `Enter` / `Space` |
| **L3 Expanded step** | "What exactly went in and came out?" | Input/output preview capped at 2,000 chars with "…truncated" | Copy, or "Show full prompt" |
| **L4 Power tools** | "Find the problem quickly" | Filter bar (tool type, errors only, hide thinking), keyboard nav, jump to next error, shortcuts sheet, raw log | Toggled with `F` / `?` / the `⋯` menu, and remembered for the session |

**First run vs 10th run.**
- **First-time user.** They see L0, then L1 appears with one dismissible hint ("Click an agent to see its prompt and tool calls"). There is no filter bar, the shortcuts are not shown, and Raw stays in the `⋯` menu. The tree is the whole experience and it reads like the extension's Agent map.
- **Power user.** The hint is gone because it was dismissed once. Last session's filter state is restored (for example "errors only" on). They use `j/k/Enter/Esc`, `E` for the next error and `[`/`]` to step through sibling agents. They may widen the panel. Nothing new appears on screen, only things they had already turned on.

---

## 1. User Journey

### 1a. Happy path (first-time user)

1. **Launch.** The user runs `/analyze` from a graph node or ⌘K. Preflight and consent work as today (unchanged).
2. **L0 → L1.** `MissionStatusStrip` shows `◉ RUNNING /analyze`. The right column slides in (`animate-slideIn`) as the **Agents panel** in Tree view. Before the first stream-json line arrives, the root row shows a pulsing `◌ starting…` and the body reads "Waiting for the CLI to start streaming…". This is the same copy as today.
3. **Root comes alive.** The root row `/analyze · sonnet` shows a cyan pulsing dot, elapsed time, a live token count, and a muted "now doing" line such as `Read src/run/runManager.ts`.
4. **Subagents appear.** When the root calls `Task`/`Agent`, a child row fades in under the root, indented, with agentType `ba`, its description ("Requirements angle"), a cyan dot and a ticking duration. The matching graph node glows (unchanged). A one-time hint chip sits under the tree: *"Click an agent to see what it's doing."* with `[Got it]`.
5. **Drill in (L2).** The user clicks the `ba` row, or the `ba` node on the graph. The panel pushes to **Agent detail**: `← Agents` breadcrumb, a one-line header (`◉ ba · running · 0:42 · 12.3k`), the prompt clamped to 3 lines, then a live transcript. Each row is one line: `● Glob pattern: "src/**/*.ts"  → 41 files`. The graph node gets a selection ring. The view auto-scrolls while live.
6. **Read a step (L3).** The user clicks `● Read runManager.ts (lines 40–189)`. It expands in place to show an **Input** block and an **Output** preview in `bg-code`. If the output was cut, the last line reads `…truncated (2,000 of ~14,800 chars shown)`.
7. **Scroll up.** Auto-follow pauses. The footer changes from `▼ Following` to `↓ Jump to latest · 7 new`.
8. **Back.** `← Agents` or `Esc` goes back to the tree, restoring its scroll position. The graph selection ring clears.
9. **Run ends.** All dots settle (green or red). An **Outcome card** appears at the top of the tree: `✓ Completed · 4m 12s · 48.1k tokens · ~$0.41 · 6 files changed  [View summary]`. If the user is inside an agent detail at that moment, they are **not** yanked away. A thin inline strip appears instead: `Run finished — [View summary]`.
10. **Summary.** `[View summary]` opens the existing `RunSummarySection` as a third pushed view, with `← Agents`.

### 1b. Advanced path (10th run)

1. A run fails. The status strip shows `✗ FAILED`. In the tree, one subagent row has a red dot and a `2 errors` badge.
2. The user presses `E` (next error) from anywhere in the panel. That opens the erroring agent's detail and scrolls to its first red row, already expanded.
3. The user presses `F` to reveal the filter bar and toggles `Errors only`. The transcript narrows to red rows plus the step right before each one, shown greyed for context.
4. `]` moves to the next sibling agent and the same filter stays applied. `[` moves back.
5. The user opens `⋯ → Raw log` to check the exact CLI line (the existing `RunLogTail`).
6. Later, they open the run from `🕘 runs` history. The **same** panel appears with the warning-tinted `PastRunBanner`. Everything is read-only, there is no follow footer and no Stop. The filter state persists.

### 1c. Linking path (graph-first user)

- The user clicks a graph agent node during or after a run.
  - **One** runtime instance of that agent: its detail opens directly.
  - **Several** instances (for example `ba` spawned 3 times): an **Instance picker** popover anchored to the node lists them (description, status, duration). Picking one opens that instance's detail.
  - **No** instance in this run: a toast reads "`code-reviewer` did not run in this run." The panel does not change.
- The user selects an agent in the panel. Its graph node gets a persistent selection ring. If the agentType has no graph node (built-in `general-purpose`, or not authored in this project), the row shows a `not on graph` tag and nothing is highlighted.

---

## 2. Screen Inventory

All views live inside **one** panel container, as a push/pop view stack: Tree is the root, Detail / Summary / Raw are pushed on top. There are no new modals.

| # | Screen / state | Entry trigger | Exit path |
|---|---|---|---|
| S1 | **Mission layout**: status strip, graph, Agents panel | Run starts, F5 reattach, or opening a run from history | Dismissing the terminal run (RunBar ✕), or Exit history |
| S2 | **Tree, starting** | Run is `starting` with zero events | First event arrives → S3 |
| S3 | **Tree, live** (root, subagents, background tasks, first-run hint) | First event | Row click → S6. Terminal → S4 |
| S4 | **Tree, terminal** (with Outcome card) | Run reaches completed / failed / cancelled / timedOut | `[View summary]` → S9. Row → S6 |
| S5 | **Tree, no subagents** (root only) | Run that never calls Task | Same as S3/S4 |
| S6 | **Agent detail / transcript** (live or terminal) | Tree row, graph node, `Enter`, `E` | `← Agents`, `Esc`, `Backspace` |
| S7 | **Agent detail, step expanded** | Click a step row, `Enter`/`Space` on the focused row | Click again, or `Esc` (collapses first, then a second `Esc` goes back) |
| S8 | **Agent detail, filter bar shown** | `F`, or the `⧩ Filter` icon button | `F` again, or `✕` on the bar (filters reset) |
| S9 | **Summary** (existing `RunSummarySection`) | `[View summary]` on the Outcome card or the finished strip | `← Agents` |
| S10 | **Raw log** (existing `RunLogTail`) | `⋯ → Raw log` | `← Agents` |
| S11 | **Past run** (S3–S10 read-only, under `PastRunBanner`) | History popover → a run | `Exit history` |
| S12 | **Cancelling / cancelled** | Stop run confirmed | Terminal → S4 (cancelled variant) |
| S13 | **Instance picker popover** (anchored on a graph node) | Click on an agent node with more than one instance | Pick → S6. `Esc` or click away closes it |
| S14 | **Shortcuts sheet** (small popover in the panel) | `?`, or `⋯ → Keyboard shortcuts` | `Esc` / `?` |
| S15 | **Panel collapsed rail** (power, optional, see Q3) | `⇥` collapse button, or `\` | Click the rail, or `\` |

---

## 3. ASCII Wireframes

The panel is drawn about 46 characters wide, roughly the proposed 360px (see Q1). Legend:
- `●` filled status dot. Colour is written next to it in comments: cyan = run-active (live), green = success, red = danger, grey = text-faint.
- `◌` pending / hollow. `◼` interrupted / cancelled.

### S1. Mission layout (live)

```
┌───────────┬─────────────────────────────────────────────────────────────────────────────────────┐
│ rail      │ ◉ RUNNING  /analyze — "add run diff"       ⏱ 02:14      [ ■ Stop run ]                │ ← MissionStatusStrip (only Stop control)
│           ├───────────────────────────────────────────┬─────────────────────────────────────────┤
│           │ [+][⤢][?]  [🕘 runs 7]                     │ AGENTS · live                 ⋯   ⇥   │ ← panel header
│           │                                           ├─────────────────────────────────────────┤
│           │        ┌───────────┐                      │ ● /analyze  sonnet       02:14  31.2k │ root (cyan)
│           │        │ /analyze  │ (glowing)            │   Task → ba ×3                        │ now-doing, muted
│           │        └─────┬─────┘                      │  ├ ● ba  Requirements      0:58  9.1k │ cyan
│           │      ┌───────┼───────┐                    │  │    Grep "parent_tool_use_id"       │
│           │   ┌──┴──┐ ┌──┴──┐ ┌──┴──┐                 │  ├ ● ba  Solutions         0:51  7.7k │ green (done)
│           │   │ ba  │ │arch │ │ ... │                 │  └ ● ba  Ideas             0:40  6.0k │ cyan
│           │   └─────┘ └─────┘ └─────┘                 │                                       │
│           │   (ba glowing; selection ring when picked)│ BACKGROUND TASKS (1)                  │
│           │                                           │  ● npm test -- run      1:02   bash   │ cyan
│           │                                           │                                       │
│           │                                           │ ┌───────────────────────────────────┐ │
│           │                                           │ │ ⓘ Click an agent to see its prompt │ │ first-run hint (once)
│           │                                           │ │   and tool calls.       [ Got it ] │ │
│           │                                           │ └───────────────────────────────────┘ │
├───────────┴───────────────────────────────────────────┴─────────────────────────────────────────┤
│ ◉ RUNNING /analyze 02:14                                                    [ ■ Stop run ]      │ ← RunBar (unchanged)
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### S2. Tree, starting

```
┌─────────────────────────────────────────────┐
│ AGENTS · live                        ⋯   ⇥ │
├─────────────────────────────────────────────┤
│ ◌ /analyze  sonnet          00:03     —    │ ◌ cyan, pulsing
│   starting…                                 │
│                                             │
│   Waiting for the CLI to start streaming…   │ muted, animate-pulse
│                                             │
└─────────────────────────────────────────────┘
```

### S3. Tree, live, fully disclosed row anatomy

```
┌─────────────────────────────────────────────┐
│ AGENTS · live      [degraded ⚠]      ⋯   ⇥ │ DegradedTelemetryChip only if degraded
├─────────────────────────────────────────────┤
│ ● /analyze  sonnet         02:14   31.2k   │ ← L1 root row: dot · name · model · dur · fresh tok
│   Task → ba "Ideas angle"                   │ ← now-doing line (only while running; 1 line, truncate)
│  ├ ● ba   Requirements angle  0:58   9.1k  │ ← agentType (agent hue) · description (muted)
│  │       Read derive.ts (lines 140-210)     │
│  │  └ ● Explore  scan fixtures  0:12  1.4k │ ← depth 2 (recursive; indent cap 3, then "↳ +n")
│  ├ ● ba   Solutions angle     0:51  7.7k  │ green — no now-doing line once done
│  │       14 tool calls · 1 error  ⚠       │ ← terminal agent: counts replace now-doing
│  └ ● ba   Ideas angle         0:40  6.0k  │
│          Thinking…                          │ grey italic
│                                             │
│ BACKGROUND TASKS (1)                    ▾   │ collapsible group, hidden when 0
│  ● npm test -- run        1:02    bash     │ click → opens root transcript at that row
│                                             │
│ UNATTRIBUTED (2 events)                 ▾   │ warning-tinted, only when non-empty
│  ◌ events with no known parent agent        │ click → detail of the bucket
└─────────────────────────────────────────────┘
  hover row → TokenBreakdownCard portal (existing) on the token number
```

### S4. Tree, terminal (completed / failed)

```
┌─────────────────────────────────────────────┐
│ AGENTS · finished                    ⋯   ⇥ │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │ ✓ Completed · 4m 12s · 48.1k · ~$0.41   │ │ Outcome card (bg-surface, rounded-panel)
│ │ 6 files changed       [ View summary ]  │ │  failed: "✗ Failed — exit 1" in danger
│ └─────────────────────────────────────────┘ │  + [ Next error ] secondary button
│ ● /analyze  sonnet         4:12   48.1k    │ green
│   3 subagents · 22 tool calls               │
│  ├ ● ba   Requirements        1:31  12.0k  │ green
│  ├ ● ba   Solutions           1:20  10.2k  │ red  ← "2 errors" badge (danger)
│  │       14 tool calls · 2 errors           │
│  └ ● ba   Ideas               1:02   8.4k  │ green
│ BACKGROUND TASKS (1)                    ▸   │ auto-collapsed at terminal
└─────────────────────────────────────────────┘
```

### S5. Tree, no subagents

```
┌─────────────────────────────────────────────┐
│ AGENTS · live                        ⋯   ⇥ │
├─────────────────────────────────────────────┤
│ ● /review  sonnet          00:41    6.3k   │
│   Bash git diff --stat                      │
│                                             │
│   No subagents yet — this command is        │ muted. Terminal variant:
│   working on its own.  [ Open transcript ]  │ "This run used no subagents."
└─────────────────────────────────────────────┘
```
**Open question Q4:** for a root-only run, should the panel skip the tree and open the root transcript directly?

### S6. Agent detail / transcript (L2, live)

```
┌─────────────────────────────────────────────┐
│ ← Agents  /  ba · Requirements      ⧩  ⋯  ⇥ │ breadcrumb; ⧩ = filter toggle (F)
├─────────────────────────────────────────────┤
│ ● running · ba · sonnet · 0:58 · 9.1k   ▾   │ collapsed header (1 line). ▾ expands:
│ ┌─────────────────────────────────────────┐ │
│ │ PROMPT                                  │ │ prompt bubble, clamped to 3 lines
│ │ You are the requirements analyst. Read  │ │
│ │ docs/loops/workflow-agent-run-STATE.md… │ │
│ │                          [ Show more ]  │ │
│ └─────────────────────────────────────────┘ │
│ 0:02 ● Thinking                              │ grey dot, italic, collapsed by default
│ 0:04 ● Glob pattern: "docs/loops/*.md"  41 f │ green · result summary right-aligned
│ 0:06 ● Read workflow-agent-run-STATE.md (… ▸ │ truncate middle; full text in tooltip
│ 0:09 ● Grep "parent_tool_use_id" (in pack… │
│ 0:11 ● Bash npm test -- derive   exit 1     │ red
│ 0:15 ● Thinking                              │
│ 0:18 ◌ Read parseStreamJson.ts (lines 150…   │ ◌ cyan = pending (no result yet)
│                                             │
├─────────────────────────────────────────────┤
│ ▼ Following                       7 steps   │ FollowFooter (live only)
└─────────────────────────────────────────────┘

Header ▾ expanded:
│ ● running · ba · sonnet · 0:58 · 9.1k   ▴   │
│   Spawned by /analyze (Task #2)   [ ↑ open ]│ link pops to parent detail
│   Tokens  in 6.2k · out 2.9k · cache 41k    │ muted; cache only here (locked §6.6)
│   Foreground · 7 tool calls · 1 error       │
│   Stopping one agent isn't supported —      │ muted one-liner; see Q6
│   "Stop run" stops the whole run.           │
```

Root agent detail (it replaces the old timeline: AC-9):
```
│ ← Agents  /  /analyze               ⧩  ⋯  ⇥ │
│ ● running · /analyze · sonnet · 2:14 · 31k ▾│
│ ┌ REQUIREMENT ────────────────────────────┐ │ the user's requirement = root "prompt"
│ │ add run diff                            │ │
│ └─────────────────────────────────────────┘ │
│ 0:01 ● Thinking                              │
│ 0:03 ● Read STATE.md (lines 1-248)           │
│ 0:08 ● Task → ba "Requirements angle"  ↗    │ agent hue; ↗ = open child detail
│ 0:08 ● Task → ba "Solutions angle"     ↗    │
│ 0:09 ● Bash npm test -- run  (background) ↗ │ background task row
│ 1:40 ● Text  "All three angles returned…"   │ assistant text rows (one line)
│ 4:12 ● Result  completed                    │
```

### S7. Step expanded (L3)

```
│ 0:06 ● Read workflow-agent-run-STATE.md  ▾  │ row highlighted (bg-panel)
│   ┌ INPUT ─────────────────────── [ ⧉ ] ┐   │ bg-code, mono 11px
│   │ file_path: docs/loops/workflow-…md   │   │
│   │ offset: 40   limit: 150              │   │
│   ├ OUTPUT ──────────── 189 lines [ ⧉ ] ┤   │
│   │ 40  ## 3. Requirements               │   │
│   │ 41                                   │   │
│   │ 42  **Core need:** close the loop…   │   │ max-height ~12 lines, inner scroll
│   │ …                                    │   │
│   │ ⋯ truncated — 2,000 of ~14,800 chars │   │ warning-muted marker, always last line
│   └──────────────────────────────────────┘   │
│   in 1.2k · out 84 tokens for this step      │ step tokens (from old expandable)
│ 0:09 ● Grep "parent_tool_use_id" (in pack… │

Error variant (red row expanded):
│   ├ OUTPUT · error ────────────── [ ⧉ ] ┤   │ header in danger
│   │ FAIL derive.test.ts > rollup …       │   │
```
- Copy `⧉` copies the **preview text exactly as shown**, never more than what is stored. Tooltip: "Copies the stored preview (max 2,000 chars)".
- A pending tool row expands to the INPUT block only, plus `waiting for result…`. If the run is terminal: `◼ interrupted — no result recorded`.

### S8. Filter bar (L4, power)

```
│ ← Agents  /  ba · Solutions         ⧩• ⋯  ⇥ │ ⧩• = filter active indicator
├─────────────────────────────────────────────┤
│ [All] [Read] [Grep/Glob] [Bash] [Edit/Write]│ tool chips (rounded-pill), only the
│ [Task] [Web] [Other]                        │ tools present in THIS agent; multi-select
│ ☐ Errors only   ☐ Hide thinking      [✕]   │ Checkbox ×2; ✕ = clear + close
├─────────────────────────────────────────────┤
│ ● running · ba · sonnet · 1:20 · 10.2k  ▾   │
│ 0:31 ┄ Read runStore.ts (lines 1-80)         │ context row, faint (step before the error)
│ 0:33 ● Bash npm test -- prune   exit 1      │ red
│ 0:52 ┄ Edit runStore.ts                      │
│ 0:55 ● Bash npm test -- prune   exit 1      │ red
│   2 of 14 steps shown · [ Clear filters ]   │ filter-empty also uses this line
```

### S9. Summary (existing component, pushed)

```
│ ← Agents  /  Summary                  ⋯  ⇥  │
├─────────────────────────────────────────────┤
│  (RunSummarySection unchanged: status,       │
│   cost-by-node table, FILES CHANGED, FINAL   │
│   MESSAGE, STDERR tail, [Run again], ...)    │
│  cost-by-node rows become clickable → S6     │ new: link to agent detail
```

### S10. Raw log (existing component, pushed from ⋯)

```
│ ← Agents  /  Raw log                  ⋯  ⇥  │
│  (RunLogTail unchanged)                      │
```
`⋯` menu (row-menu): `Raw log` · `Keyboard shortcuts  ?` · `Expand panel  ⇧\` (see Q1) · `Show first-run hint again`.

### S11. Past run (read-only)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ 🕘 VIEWING PAST RUN · #5 · Oct 16 14:02  failed · 3m 08s · read-only  [▶ Run again] [Exit history] │ PastRunBanner (existing)
├───────────────────────────────────────────┬─────────────────────────────────────────┤
│  graph (re-lit from replay)               │ AGENTS · past run · read-only     ⋯  ⇥ │
│                                           │ ┌───────────────────────────────────┐   │
│                                           │ │ ✗ Failed — exit 1 · 3m 08s · 22k  │   │
│                                           │ │ [ View summary ]  [ Next error ]  │   │
│                                           │ └───────────────────────────────────┘   │
│                                           │ ● /build  sonnet       3:08   22.0k     │
│                                           │  └ ● feature-builder   2:51  18.4k      │ red
│                                           │ (no follow footer, no now-doing lines,  │
│                                           │  no Stop anywhere, durations frozen)    │
```

### S12. Cancelling / cancelled

```
Cancelling (status strip shows ◐ CANCELLING… sending SIGTERM…):
│ AGENTS · stopping…                   ⋯   ⇥ │ warning text
│ ● /build  sonnet           1:12   9.4k     │ dots stop pulsing (static cyan)
│  └ ● feature-builder        0:58  7.0k     │

Cancelled (terminal):
│ ┌─────────────────────────────────────────┐ │
│ │ ◼ Cancelled by you · 1:14 · 9.4k        │ │ text-muted, not red
│ │ Files already written stay written.     │ │
│ │                       [ View summary ]  │ │
│ └─────────────────────────────────────────┘ │
│ ◼ /build  sonnet           1:14   9.4k     │ ◼ grey = interrupted
│  └ ◼ feature-builder  interrupted 0:59 7.0k│
In detail: last pending row → "◼ Read foo.ts — interrupted, no result"
```

### S13. Instance picker (anchored to a graph node)

```
        ┌─────────┐
        │   ba    │◀── clicked
        └─────────┘
   ┌───────────────────────────────────┐
   │ ba ran 3 times in this run        │  shadow-dropdown, bg-menu
   │ ● Requirements angle  1:31  12.0k │  ↑↓ + Enter
   │ ● Solutions angle     1:20  10.2k │  (red dot)
   │ ● Ideas angle         0:40   6.0k │  (cyan, live)
   └───────────────────────────────────┘
```

### S14. Shortcuts sheet

```
│ ┌ Keyboard ─────────────────────────────┐   │
│ │ j / k     next / prev row             │   │
│ │ Enter     open agent / expand step    │   │
│ │ Esc ⌫     collapse, then back         │   │
│ │ [ / ]     prev / next sibling agent   │   │
│ │ E         jump to next error          │   │
│ │ F         toggle filters              │   │
│ │ G         jump to latest (live)       │   │
│ │ \         collapse / expand panel     │   │
│ │ ?         this sheet                  │   │
│ └───────────────────────────────────────┘   │
```
The shortcuts apply only while focus is inside the panel, so they never steal graph or editor keys. **Esc never stops a run** (this rule is kept from CancelControl).

### S15. Collapsed rail (optional, Q3)

```
┌──┐
│⇤ │  expand
│● │  live dot (cyan pulse) / outcome dot
│3 │  agent count
│⚠2│  error count (only if >0)
└──┘  ~36px wide; graph gains the width
```

---

## 4. Component Breakdown

The interface contracts below are for the architect. Names are suggestions. Everything goes in `apps/web/src/components/run/agents/` unless noted.

### Reused as-is
- `MissionStatusStrip`, `RunBar`: unchanged. `CancelControl` label changes from `■ Cancel` to `■ Stop run` (spec §9 "now Stop run"). The confirm copy stays.
- `PastRunBanner`, `RunHistoryPopover`, `RunSummarySection` (gets an optional `onOpenAgent(agentId)` so cost-by-node rows can link), `RunLogTail`, `TokenBreakdownCard` (hover on token numbers), `DegradedTelemetryChip`.
- shadcn / ui: `Button` (ghost / outline / secondary), `Badge` (error count, `not on graph`, `background`), `Tooltip` (full truncated labels), `Checkbox` (Errors only, Hide thinking), `row-menu` (`⋯`), `toast` (node with no instance).

### New
| Component | Responsibility | Props / state contract |
|---|---|---|
| `AgentsPanel` | Container that replaces `RunTimelinePanel`. Owns the view stack and keyboard scope | props: `tree: AgentNode[]` (root first), `backgroundTasks: BackgroundTask[]`, `unattributed: AgentNode \| null`, `runStatus`, `mode: "live" \| "history"`, `summary?`, `rawLines`, `degraded`, `degradedReason`, `selectedAgentId \| null`, `onSelectAgent(id \| null)`, `onRerun`, `projectId`. state: `stack: Array<{view:"tree"} \| {view:"agent", agentId} \| {view:"summary"} \| {view:"raw"}>`, `treeScrollTop` (restored on pop), `collapsed` |
| `AgentTree` | L1 list, recursive | `nodes`, `selectedId`, `focusedId`, `onOpen(id)`, `showNowDoing: boolean` (false in history) |
| `AgentTreeRow` | One row | `node: AgentNode`, `depth`, `isRoot`, `onGraph: boolean` (renders `not on graph`), `selected`, `focused` |
| `BackgroundTaskGroup` / `BackgroundTaskRow` | Collapsible group, hidden at 0 | `tasks: BackgroundTask[]` `{toolUseId, commandSummary, status: running\|done\|error\|unknown\|interrupted, durationMs?}`, `onOpen(toolUseId)` → root detail scrolled to that row |
| `RunOutcomeCard` | Terminal summary at the top of the tree | `status`, `durationMs`, `freshTokens`, `costUsd?`, `filesChangedCount \| "unavailable"`, `errorCount`, `onViewSummary`, `onNextError?` |
| `RunFinishedStrip` | Inline "Run finished — View summary" while in a detail | `status`, `onViewSummary`, `onDismiss` |
| `FirstRunHint` | One-time coach chip | `onDismiss`. Persistence: see Q5 |
| `AgentDetailView` | L2 | `agent: AgentNode`, `steps: TranscriptStep[]`, `live: boolean`, `filter: TranscriptFilter`, `onFilterChange`, `onBack`, `onOpenAgent(id)` (Task rows, Spawned-by), `initialFocusStepId?` (for `E`) |
| `AgentDetailHeader` | One collapsed line, expandable meta | `agent`, `expanded`, `onToggle`, `parentLabel?` |
| `PromptBubble` | Prompt (or root requirement) clamped to 3 lines | `label: "PROMPT" \| "REQUIREMENT"`, `text`, `truncated: boolean` (stored-cap marker) |
| `TranscriptList` | Virtualized rows + follow logic | `steps`, `expandedIds: Set`, `focusedId`, `following`, `onFollowChange`, `newSinceFollowPaused: number` |
| `TranscriptRow` | Variants: `thinking`, `tool`, `task` (child link), `background`, `text`, `result`, `unknown` | `step: TranscriptStep {id, atMs, kind, label (from summarizeToolCall), resultSummary?, status: ok\|error\|pending\|interrupted\|neutral, childAgentId?, contextOnly?: boolean}` |
| `StepPreview` | L3 expansion | `input: string`, `output?: string`, `outputIsError`, `truncated: {shown:number, approxTotal?:number} \| null`, `stepTokens?`, `pending`, `interrupted` |
| `TranscriptFilterBar` | L4 | `availableTools: ToolBucket[]`, `filter: {tools: Set<ToolBucket>, errorsOnly, hideThinking}`, `onChange`, `onClose` |
| `FollowFooter` | Live only | `following`, `newCount`, `onJump` |
| `StatusDot` | Single source of the dot vocabulary | `status: running\|pending\|ok\|error\|thinking\|interrupted\|neutral`, `pulse?` |
| `AgentInstancePicker` | Popover on a graph node | `anchorRect`, `instances: AgentNode[]`, `onPick`, `onClose` |
| `ShortcutsSheet` | `?` popover | static |
| Graph change (`GraphNode` / `AgentNode` in `components/graph/`) | Persistent selection ring | new prop `runSelected: boolean`. Visually distinct from `glowPulse` and the one-shot `pulse` (see §7) |

### View-model the panel needs from `deriveAgentTree` (for /plan to confirm)
`AgentNode { id, parentId|null, kind: "root"|"subagent"|"unattributed", agentType, description?, model?, graphNodeId|null, status: "starting"|"running"|"done"|"error"|"interrupted"|"cancelled", startedAtMs, endedAtMs?, freshTokens, tokens4: FourWay, toolCallCount, errorCount, nowDoing?: string, prompt?: string, promptTruncated?: boolean, finalResult?: string, children: AgentNode[], background: boolean }`. The UI only needs `nowDoing` as "the label of the latest step". It can be computed in the UI, but doing it in core keeps it cheap and incremental.

---

## 5. Interaction Notes

### Appear / transitions
- The panel enters with the existing `slideIn` (0.2s). When the run ends it **stays** until the RunBar is dismissed (same lifecycle as today).
- A new subagent row fades in (`fadeIn` 0.16s) **without** shifting the user's scroll position. If the tree is scrolled and a row is inserted above the viewport, scroll is compensated.
- Tree → detail is a horizontal push (`slideIn` from the right). Back slides left. Under `prefers-reduced-motion` it becomes an instant swap (joins the existing globals.css block).
- Token numbers tick live. On settle, the existing `countLockIn` flash plays on the row's token number, matching graph nodes.

### Status vocabulary (one `StatusDot`, everywhere)
| Status | Dot | Token |
|---|---|---|
| running / starting | ● filled, pulsing | `run-active` |
| pending tool (no result yet) | ◌ hollow ring | `run-active` |
| ok / done | ● | `success` |
| error (`is_error`, non-zero exit, agent error) | ● | `danger` |
| thinking | ● small | `text-faint` |
| interrupted / cancelled | ◼ | `text-muted` |
| unknown event / neutral | · | `text-faint` |

When the run turns terminal, **every** running or pending dot converts to ◼ interrupted in the same render. Nothing stays cyan (AC-7). The cyan pulse is never used for a finished state.

### Live behaviour
- **Now-doing line** (tree): the label of the agent's latest step, updated at most every ~250ms so it doesn't flicker. Thinking shows as italic `Thinking…`. It is hidden once the agent is done and replaced by `N tool calls · M errors`.
- **Auto-follow** (detail): on by default while live. Scrolling up more than 24px pauses it (today's threshold). The footer shows `↓ Jump to latest · N new`. `G` or a click resumes. Opening an agent always starts **following** if that agent is live, and at the top (prompt visible) if it is finished.
- **Expanded rows while following.** Expanding a row pauses follow, so the row doesn't scroll away under the cursor.
- **Background task status** is best effort. With no completion signal in the stream, the dot becomes ◌ with the tooltip "status unknown — background shells don't always report completion". At terminal it becomes ◼.
- **Reconnecting** (SSE): a thin warning line under the panel header reads `⟳ reconnecting — agents may lag`. Nothing is cleared. On reattach the tree is rebuilt from replay and replaces the old one in one swap (AC-6), with no rows animating in.

### Empty states
- No events yet: S2 copy.
- No subagents: S5 copy.
- Agent with zero steps: `This agent hasn't called any tools yet.` (live) or `No tool calls recorded.` (terminal).
- Filter matches nothing: `0 of N steps shown · [Clear filters]`.
- No background tasks / no unattributed events: the group is **absent**, not empty (matching the project rule that absence is the cleanest empty state).

### Error / degraded states
- Agent error: red dot plus a `N errors` badge in the tree. The detail header turns red-tinted. `E` cycles through errors across all agents in tree order.
- Run failed: the Outcome card in danger shows `[Next error]`. The stderr tail stays in Summary (unchanged).
- Unknown / unparseable event: a neutral `· unrecognized event (type: foo)` row. It can be expanded to the stored raw preview. The panel never throws, and a per-row error boundary renders `· couldn't render this step`.
- Unattributed events: a warning-tinted `UNATTRIBUTED` group (S3) that opens like an agent. This finally uses `TimelineRow.unattributed`.
- Degraded telemetry: the existing chip sits in the panel header. Token numbers get a `≈` prefix.
- Truncated previews: always the explicit last line `⋯ truncated — 2,000 of ~X chars`, or `of unknown length` when the full size wasn't stored. Never a silent cut.

### Selection linking
- Panel → graph: the selected agent's node gets a persistent ring that clears on back. Hovering a tree row gives the existing one-shot `pulse` on its node (a light preview).
- Graph → panel: click opens the detail (or the picker if there are several instances, or a toast if there are none). The tree scrolls to and highlights the row before the push, so the back animation lands on it.
- Several instances of one agent all highlight the **same** node. The ring shows the selected one. The node badge could read `×3` (see Q7).

### Stop
- The only Stop is `■ Stop run` in `MissionStatusStrip` / `RunBar`. No Stop appears inside the panel or the agent detail. The subagent header's expanded meta explains why (see Q6).

### Past runs
- The same components with `mode="history"`: no follow footer, no now-doing, no hint, no Stop. Durations come from timestamps. The Outcome card is always shown. Filters, keyboard and expansion all work.
- Large past runs: render the tree first. The transcript list virtualizes, and the first paint shows `Loading 2,431 events…` if the history read is paged (the /plan question in §9).

### Performance contract (UI side)
- Transcript rows are fixed at 22px collapsed for virtualization. Expanded rows are measured.
- The tree re-renders only the rows whose `AgentNode` reference changed (this relies on an incremental fold in core).

---

## 6. Open Design Questions (taste calls, not guessed)

1. **Panel width.** Today it is a fixed 320px. One-line tool summaries plus duration and tokens are tight at 320px. Options: (a) 360px fixed, (b) 320px plus an "Expand panel" toggle to about 560px, (c) a drag-resizable splitter that remembers its width. Which one?
2. **Panel height.** The graph container is fixed at `height: 480`, so the transcript gets about 400px usable. Should the mission layout grow to fill the viewport while a run is shown, or stay at 480?
3. **Collapsed rail (S15).** Ship it in this iteration, or rely on "Exit / dismiss" only? It is a power feature that is cheap to cut.
4. **Root-only runs.** For a run with no subagents, show the tree with one row (consistent) or jump straight into the root transcript (fewer clicks)?
5. **First-run hint persistence.** Symbion persists only local files. Is a `localStorage` flag acceptable for a pure UI preference, or should it go into the user-level config dir through the daemon? The same question applies to remembered filter state and panel width.
6. **Explaining "no per-agent Stop".** Show the muted one-liner in the subagent header's expanded meta, show it as a tooltip only, or show nothing?
7. **Multiple instances on the graph.** Should an agent node show a runtime `×3` badge during or after a run? It adds information to the graph, which the spec treats as a read-only map, so it may count as graph chrome creep.
8. **Thinking rows.** Show them collapsed but visible by default (extension parity), or hide them by default behind the "Hide thinking" toggle reversed? And when expanded, do we show stored thinking text, or is it never stored or shown?
9. **Run-end behaviour.** Today the Summary tab auto-opens on terminal. This design keeps the tree and adds the Outcome card, with no auto-navigation. Confirm that dropping the auto-switch to Summary is acceptable.
10. **Selection ring colour.** It must differ from the `run-active` glow and the indigo one-shot `pulse`. Candidates: the `agent-hi` (#c4b5fd) 2px outline, or white at 35%. Pick one (it becomes a durable token, §7).
11. **Raw log placement.** It is demoted to the `⋯` menu. Is that acceptable to existing users who used the Raw tab?

---

## 7. Design System Updates (proposal only. `DESIGN.md` does not exist, so do not write it)

**Design System — additive proposal.** Seeded only from tokens this feature introduces. This is the run-engine section of the de-facto tailwind token set.

```diff
 ## Colors
+ run-status vocabulary (semantic aliases, no new hexes):
+   status.running     = colors.run-active   (filled, glowPulse)
+   status.pending     = colors.run-active   (hollow ring)
+   status.ok          = colors.success
+   status.error       = colors.danger
+   status.thinking    = colors.text-faint
+   status.interrupted = colors.text-muted   (square glyph ◼)
+ run-selected ring: TBD by Q10 (agent-hi 2px outline | white/35%)

 ## Typography
+ transcript-row: font-mono 11px / leading 22px (fixed row height for virtualization)

 ## Components
+ StatusDot: single source of run/agent/step status glyph + color; never use
+   run-active for a terminal outcome.
+ TruncationMarker: "⋯ truncated — {shown} of ~{total} chars" as the last line of
+   any capped preview; never a silent cut.

 ## Do's and Don'ts
+ Do: reveal power controls (filters, shortcuts, raw) only on request; keep
+   them remembered once turned on.
+ Don't: auto-navigate the user away from a view they are reading when a run
+   changes state — use an inline strip instead.
```

---

## Future ideas (out of locked scope, not in this iteration)
- Search within a transcript (`/` to search labels).
- Duration bar chart in the tree rows, like a flame chart (ties to the "trace-to-source" idea in §5).
- "Open agent `.md`" jump from the detail header into the CodeMirror editor.
- Compare this agent's run with the previous run of the same agent (run diff, §5).
- One-click "allow this tool" from a denied-tool row (FR-8).
- Per-subagent Stop (needs a non-headless channel; explicitly OUT).

---

**Next step:** the other designer angles get merged into `docs/loops/workflow-agent-run-design.md`. Resolve §6, then run `/plan` (the architect reads this design alongside STATE §9).
