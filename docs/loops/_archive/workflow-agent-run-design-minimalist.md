# workflow-agent-run — Design (angle: minimalist / functional)

> Input: `workflow-agent-run-STATE.md` §8 (research) + §9 (LOCKED scope).
> Existing UI read: `DependencyGraph.tsx` (panel slot at line ~1152, `w-[320px]`, container `height: 480`), `run/RunTimelinePanel.tsx`, `MissionStatusStrip`, `RunBar`, `CancelControl`, `PastRunBanner`, `TokenBreakdownCard`, `RunSummarySection`, `tailwind.config.ts`.
> `DESIGN.md`: **does not exist** at repo root, so there are no binding tokens. This doc uses only the tokens already in `tailwind.config.ts` (`run-active` #22d3ee, `success` #4ade80, `danger` #f87171, `warning` #fbbf24, `text-faint`, `bg-code`, `border-hairline`, `brand-accent`).

**Angle summary.** The panel is one surface with two views (**Tree** and **Agent**) and a back stack. There are no tabs for the live run. The old filter chips are gone because drilling into an agent *is* the filter. Every row is one line. Every glyph is a status, never decoration. Text and numbers carry the meaning; color only backs up the glyph shape, so status reads in grayscale too.

---

## 1. User Journey (happy path)

1. **Launch (unchanged).** The user runs `/build` from a graph node or ⌘K, then preflight, consent and confirm. `MissionStatusStrip` appears above the graph and the graph glows as today.
2. **Panel opens on the Tree view.** The right panel slot (where `RunTimelinePanel` used to mount) shows the **Agents** tree. It starts with one root row, `◌ /build  starting…`, and the muted line "waiting for the CLI to start streaming…".
3. **Subagents appear live.** When the root emits a `Task`/`Agent` tool_use, a child row is appended under the root with a cyan `◉` (running), its agentType, a 1-line description, a ticking duration and fresh tokens. The matching graph node glows (existing behaviour).
4. **Drill in.** The user clicks a subagent row, presses Enter on it, or clicks its node on the graph. The panel switches to the **Agent** view for that agent. The header shows status, agentType, model, duration, tokens and "spawned by /build". Below it sit the prompt (clamped to 3 lines) and the transcript timeline: one line per Thinking / tool call / result, auto-following the bottom.
5. **Inspect a tool call.** Clicking a row such as `● Read derive.ts (40–189) · 150 lines` expands it inline into INPUT / OUTPUT previews, each capped at 2,000 chars with an explicit `…truncated` marker when cut. Clicking again collapses it.
6. **Scroll up, resume.** Scrolling up pauses follow. The footer swaps to `[↓ Jump to latest · 14 new]`. Clicking it, or pressing `End`, resumes following.
7. **Back.** `← back` (or `Backspace` / `Esc`) returns to the Tree with the previously selected row still selected and scrolled into view.
8. **Run ends.** Every running row resolves to `✓` / `✗` / `◼ interrupted`. The panel footer becomes a one-line run result with a `[Summary ›]` link. `RunSummarySection` is reused unchanged behind that link.
9. **Revisit later.** From `🕘 runs N`, the user picks a past run. `PastRunBanner` appears and the same Tree/Agent views render read-only from `events.jsonl`. No follow footer is shown and nothing ticks.
10. **Stop (if needed).** The only stop control is `■ Stop run` in `MissionStatusStrip` (the existing two-step `CancelControl`). The panel never offers a stop.

---

## 2. Screen Inventory

All of these are states of **one** panel, `AgentsPanel`, which mounts in the existing 320px right slot. Nothing here is a new route or modal.

| # | Screen / state | Entry trigger | Exit path |
|---|---|---|---|
| S1 | **Tree: live** | A run starts or reattaches after F5 | Click an agent row → S2. Run ends → S3 |
| S2 | **Agent: live** (transcript of one agent) | Tree row click / Enter, graph node click, or a spawn row inside a parent transcript | `← back`, Backspace or Esc → previous view (stack). A spawn row drills deeper |
| S2a | — tool row expanded (inline, not a separate screen) | Click a tool row or press Space | Click again or Space; expanding another row does not collapse this one (see Q7) |
| S3 | **Tree: terminal** (run finished, failed, cancelled or stopped) | Run reaches a terminal status | `[Summary ›]` → S4. Dismiss in `RunBar` ✕ → panel unmounts (today's rule) |
| S4 | **Summary** (existing `RunSummarySection`, header gets `← back`) | `[Summary ›]` in the terminal footer | `← back` → S3 |
| S5 | **Past run** (S1–S4 read-only, under `PastRunBanner`) | History popover pick | `Exit history` (banner) |
| S6 | **Raw** (existing `RunLogTail`) | `≡` toggle in the root Agent header only | `≡` again or `← back` |
| — | Graph selection outline (graph-side, not a panel screen) | The agent selected in the panel | Back to Tree clears it, or another selection replaces it |

---

## 3. ASCII Wireframes

Legend: `[ ]` = button / clickable row, `( )` = input (none in this feature), `▸/▾` = expandable, `›` = drills into another view.
Status glyphs (shape carries meaning, color reinforces):
`◌` starting (faint) · `◉` running (run-active cyan, slow pulse) · `✓` done (success) · `✗` error (danger) · `◼` interrupted/cancelled (text-faint) · `○` pending tool, no result yet (text-muted) · `·` thinking (text-faint) · `?` unknown event (text-faint).

### 3.0 Placement in the existing mission layout

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ RUNNING  /build — "add agent tree to run panel"            ⏱ 03:12  [■ Stop run] │ ← MissionStatusStrip (only stop)
├────────────────────────────────────────────────────┬───────────────────────────────┤
│  [+ ][⤢][?]                                        │  AGENTS PANEL (320px)         │
│  [🕘 runs 7]                                        │  see 3.1 – 3.7                │
│                                                    │                               │
│      ┌──────────┐        ┌──────────────┐          │                               │
│      │ /build   │───────▶│ code-reviewer│ ◉ glow   │                               │
│      │  ◉ glow  │        └──────────────┘          │                               │
│      └──────────┘        ┌──────────────┐          │                               │
│           └─────────────▶│ ba  ┄┄selected┄┄ (1px brand-accent outline)              │
│                          └──────────────┘          │                               │
│                       GRAPH (glow / edge flow as today)                            │
├────────────────────────────────────────────────────┴───────────────────────────────┤
│ ◉ RUNNING  /build  03:12                                              [■ Stop run] │ ← RunBar (app-wide, unchanged)
└────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 S1 — Tree: live

```
┌───────────────────────────────┐
│ AGENTS · 3          ⚠ degraded│ ← title + count; DegradedTelemetryChip only when degraded
├───────────────────────────────┤
│[◉ /build      opus   03:12 18k]│ ← root row (model, run elapsed, fresh tok)
│[  ✓ ba               0:41  4.1k]│ ← subagent: dot · agentType · dur · tok
│[    Analyze requirement for…   ]│   line 2: description, muted, 1-line truncate
│[  ◉ code-reviewer    1:12  6.3k]│
│[    Review diff in apps/web/…  ]│
│[    ◉ Explore        0:09  0.8k]│ ← nested (depth 2): +12px indent per level
│[      Find usages of Timeline… ]│
│[  ⚠ unattributed      12 events]│ ← only if present; warning text; drillable
│                               │
│ BACKGROUND · 1                │ ← section hidden when 0
│[  ◉ npm run dev          2:31 ]│ ← click → parent transcript, row expanded
│                               │
├───────────────────────────────┤
│ ↑↓ select · ↵ open            │ ← faint hint, live only (Q9)
└───────────────────────────────┘
```

- Row order is spawn order, not status order, so rows never jump around.
- Hovering the tokens figure shows the existing `TokenBreakdownCard`: the root uses the own / +agents / total columns, subagents use the "agent-node variant" without the +agents column.
- The selected row has a `bg-brand-accent-soft` background, and the matching graph node gets the outline shown in 3.0.

### 3.2 S1 — Tree: starting / empty sub-states

```
┌───────────────────────────────┐          ┌───────────────────────────────┐
│ AGENTS                        │          │ AGENTS · 1                    │
├───────────────────────────────┤          ├───────────────────────────────┤
│[◌ /build      opus   00:02  — ]│          │[✓ /build      opus   01:04 9k]│
│                               │          │  No subagents spawned.        │ ← faint, one line
│  waiting for the CLI to start │          │                               │
│  streaming…   (pulse)         │          │                               │
└───────────────────────────────┘          └───────────────────────────────┘
        starting                                  run with no subagents
```

### 3.3 S2 — Agent: live (subagent)

```
┌───────────────────────────────┐
│[← back]  code-reviewer      ◉ │ ← back + agentType + status glyph
│ sonnet · 1:12 · 6.3k tok      │ ← model · duration · fresh tok (hover → card)
│ spawned by [/build ›]         │ ← parent link (same as back, but explicit)
├───────────────────────────────┤
│ PROMPT                     [▸]│
│ Review the diff in apps/web/  │ ← 3-line clamp; ▸ expands in place
│ src/components/run and report │
│ correctness issues with file… │
├───────────────────────────────┤
│ TRANSCRIPT · 9 tools          │
│ · Thinking                    │ ← faint, collapsed
│[✓ Glob "**/run/*.tsx" · 15 fil]│ ← one line: summary · result, truncated
│[✓ Read RunBar.tsx (1–63)·63 ln]│
│[✓ Grep "TimelineRow" (in pack…]│
│ · Thinking                    │
│[✗ Bash npm test -- run · exit1]│ ← red ✗; label stays body color
│[✓ Read derive.ts (40–189)·150 ]│
│[○ Edit AgentsPanel.tsx        ]│ ← pending: no result yet
│                               │
├───────────────────────────────┤
│ ▼ following                   │ ← or [↓ Jump to latest · 14 new]
└───────────────────────────────┘
```

- The time column from `RunTimelinePanel` (`mm:ss`) is dropped from rows to save width. The relative time shows as a `title` tooltip on hover (see Q4).
- The tool name is the first token of each line (`Glob`, `Read`, `Grep`, `Bash`, `Edit`, `Write`, `Agent`, `WebFetch`, or the raw name for the generic fallback). The text comes from `summarizeToolCall`, so there is no separate icon column.

### 3.4 S2a — tool row expanded

```
│[✗ Bash npm test -- run · exit1]│
│ ┌───────────────────────────┐ │
│ │ INPUT                     │ │ ← bg-code, mono 10px
│ │ npm test -- run           │ │
│ │ OUTPUT · error            │ │ ← "· error" in danger when is_error
│ │ FAIL src/run/derive.test… │ │
│ │ Expected 3, received 2    │ │
│ │ …                         │ │
│ │ …truncated (2,000 chars)  │ │ ← only when the stored preview was capped
│ │                  [⧉ copy] │ │ ← copies the preview text only
│ └───────────────────────────┘ │
│[✓ Read derive.ts (40–189)·150 ]│
```

- A pending tool shows `OUTPUT — waiting…` (faint). Once the run is terminal it shows `OUTPUT — interrupted (no result)`.
- A Thinking row expands to show its stored text if `events.jsonl` has it. Otherwise it is not expandable (see Q6).

### 3.5 S2 — Agent: root (the old Feed, folded in)

```
┌───────────────────────────────┐
│[← back]  /build             ◉ │
│ opus · 03:12 · 18k tok   [≡]  │ ← [≡] = Raw toggle (root only, S6)
├───────────────────────────────┤
│ REQUIREMENT                [▸]│ ← the run's requirement = root "prompt"
│ add agent tree to run panel   │
├───────────────────────────────┤
│ TRANSCRIPT · 14 tools         │
│ ⚙ init session · opus         │ ← faint system row (kept from derive.ts)
│ · Thinking                    │
│[✓ Read CLAUDE.md · 82 lines   ]│
│[◉ Agent ba "Analyze requir…" ›]│ ← spawn row: › drills into that agent (S2)
│[◉ Agent code-reviewer "Rev…" ›]│
│[✓ Bash npm run dev & · bg    ›]│ ← background task, also listed in Tree
│ ? unknown(system_hook)        │ ← unknown/degraded → neutral faint row
│[✓ Result                    ▸]│ ← final result row, expand = full text (capped)
├───────────────────────────────┤
│ ▼ following                   │
└───────────────────────────────┘
```

Everything `RunTimelinePanel` showed lands here, which covers AC-9:
- init rows, text and message rows, tool rows, the result row and unknown / parse-error rows.
- token deltas, which move into the expanded row as `step tokens: in / out` (same as today's expandable).
- Raw, which sits behind `[≡]`.

### 3.6 S3 — Tree: terminal (cancelled shown; completed/failed identical shape)

```
┌───────────────────────────────┐
│ AGENTS · 3                    │
├───────────────────────────────┤
│[◼ /build      opus   03:40 21k]│
│[  ✓ ba               0:41  4.1k]│
│[    Analyze requirement for…   ]│
│[  ◼ code-reviewer    1:58  7.9k]│ ← was running at cancel → interrupted
│[    Review diff in apps/web/…  ]│
│                               │
│ BACKGROUND · 1                │
│[  ◼ npm run dev          3:40 ]│
├───────────────────────────────┤
│ ◼ cancelled · 3m40s · 21k tok │ ← one-line run result (status color)
│ · ~$0.38 · 4 files [Summary ›]│
└───────────────────────────────┘
```

Footer variants:
- `✓ completed · …`
- `✗ failed — exit 1 · …`, with the danger color on the first segment only
- `⚠ stopped — token cap · …`, in warning

### 3.7 S4 — Summary (reused) and S5 — Past run

```
┌───────────────────────────────┐   ┌────────────────────────────────────────────────┐
│[← back]  SUMMARY — ✓ completed│   │ 🕘 VIEWING PAST RUN · #6 · Oct 16 14:02 · …    │ ← existing PastRunBanner
├───────────────────────────────┤   │ completed · 4m 12s · read-only  [▶ Run again]  │
│ (RunSummarySection body,      │   │                                 [Exit history] │
│  unchanged: cost by node,     │   └────────────────────────────────────────────────┘
│  files changed, final message,│   Panel = S3/S2/S4 exactly, except:
│  stderr, [Adjust ceilings],   │    • no "▼ following" footer, no ticking
│  [▶ Run again] [Close])       │    • no keyboard hint footer
│                               │    • durations are final values
└───────────────────────────────┘    • missing events.jsonl → see §5 error states
```

`[Feed]` in `RunSummarySection`'s header is relabelled `← back`. It is the same callback (`onViewFeed`), so it is a label change only.

---

## 4. Component Breakdown (interface contracts, no implementation)

### New: `AgentsPanel` (replaces `RunTimelinePanel`; `apps/web/src/components/run/AgentsPanel.tsx`)

Owns a view stack. It mounts in the same slot and under the same mount condition as today.

| Prop | Type (shape) | Note |
|---|---|---|
| `tree` | `AgentNode[]` (from core `deriveAgentTree`, folded incrementally) | root at `[0]`, children recursive |
| `background` | `BackgroundTask[]` | derived from Bash `run_in_background` calls |
| `unattributed` | `{ eventCount: number; rows: TranscriptRow[] } \| null` | |
| `rawLines` | `RawTailLine[]` | for the root `[≡]` view |
| `summary?` | `RunSummary` | present when terminal |
| `runStatus` | `RunInfo["status"]` | drives footer + interrupted mapping |
| `live` | `boolean` | false for past runs and terminal runs (no follow, no ticking) |
| `readOnly` | `boolean` | past run |
| `waiting` | `boolean` | no events yet |
| `degradedReason` | `DegradedReason \| null` | |
| `selectedAgentId` | `string \| null` (controlled) | lifted so the graph can set it |
| `onSelectAgent` | `(id: string \| null) => void` | panel → graph highlight |
| `onRerun`, `onClose`, `projectId` | as today | passed to `RunSummarySection` |

Internal state: `stack: Array<{view:"tree"} | {view:"agent", id} | {view:"summary"} | {view:"raw"}>`, plus the tree's keyboard cursor.

### New: `AgentTreeRow`
- Props: `node: AgentNode` (`id, agentType|commandName, description?, model?, status, startedAtMs, endedAtMs?, freshTokens, usage: FourWay, toolCount, depth`), `selected`, `nowMs` (for ticking), `onOpen`.
- Two lines for subagents, one line for the root and background rows.

### New: `AgentDetailView`
- Props: `agent: AgentNode`, `rows: TranscriptRow[]`, `parentLabel?`, `isRoot`, `live`, `onBack`, `onOpenAgent(id)`, `onToggleRaw?` (root only).
- Contains `PromptBlock` (clamp + expand) and `TranscriptList`.

### New: `TranscriptList` (virtualized)
- Props: `rows: TranscriptRow[]`, `live`, `onOpenAgent(id)`.
- Owns follow/pause state (the same 24px at-bottom threshold as today), `newSinceSeq` for the "N new" count, and `expanded: Set<seq>`.
- Virtualization uses a lightweight windowing lib or a hand-rolled one; the architect decides. Rows have variable height when expanded, so the virtualizer must measure them.

### New: `TranscriptRow` view-model (core-side shape, for `/plan`)

```
{ seq, atMs, kind: "thinking"|"tool"|"spawn"|"text"|"result"|"system"|"unknown",
  status: "ok"|"error"|"pending"|"interrupted"|"neutral",
  label: string            // summarizeToolCall output, e.g. `Read derive.ts (40–189)`
  resultLabel?: string     // "150 lines", "15 files", "exit 1"
  childAgentId?: string    // for spawn rows
  preview?: { input?: string; output?: string; truncated: boolean; isError: boolean;
              stepTokens?: {input:number; output:number} } }
```

### New: `StatusGlyph`
- Props: `status: "starting"|"running"|"ok"|"error"|"interrupted"|"pending"|"thinking"|"unknown"`.
- One map of glyph and color, shared by tree rows, transcript rows and (optionally later) `MissionStatusStrip` / `RunBar`.

### Reused / modified
- **`TokenBreakdownCard`**: unchanged; it is the hover target on token figures.
- **`RunSummarySection`**: label only (`[Feed]` → `← back`).
- **`RunLogTail`**: unchanged; shown in the root's `[≡]` view.
- **`DegradedTelemetryChip`**: unchanged; sits in the panel title row.
- **`CancelControl`**: change the idle label `■ Cancel` → `■ Stop run` so it matches the scope wording. The confirm copy "Stop this run? Files already written stay written." stays.
- **`MissionStatusStrip`, `RunBar`, `PastRunBanner`, `RunHistoryPopover`**: unchanged.
- **`DependencyGraph`**:
  - `panelFilterId` / filter chips / `onFilter` are removed.
  - Node click in mission/history mode resolves node → runtime agent id(s) and calls `setSelectedAgentId` (see Q2 for 1-to-many).
  - Pass `selectedNodeId` to `GraphCanvas`.
- **`GraphCanvas`** (self-coded renderer): new prop `selectedNodeId?: string` renders a persistent 1px `brand-accent` outline that sits *outside* the run glow ring, so the two don't compete. The existing one-shot pulse (`pulseNodeId`) is kept for "row click → flash node".
- **shadcn**: `Button` (back, summary link, jump-to-latest) and `Tooltip` (row timestamps, full truncated labels). No new shadcn primitives are needed.

---

## 5. Interaction Notes

**Selection and linking**
- Clicking a tree row opens the Agent view and sets `selectedAgentId`. The graph node gets the outline and one pulse.
- Clicking an agent node on the graph does the same from the other side. If the panel is on Summary or Raw, the graph click pushes the Agent view on top, and `← back` returns to where the user was.
- Clicking the command node opens the root Agent view.
- When an agent has no graph node (built-ins like `Explore`, `general-purpose`, or a name not in the graph), the panel still works. There is just nothing to outline, and no error is shown.
- Back to Tree keeps the selection highlighted in the tree but removes the graph outline. Only an open Agent view outlines a node (see Q3).

**Keyboard (when the panel has focus)**

| Key | Tree view | Agent view |
|---|---|---|
| `↑` / `↓` | move cursor | — |
| `↵` | open the agent under the cursor | — |
| `j` / `k` | — | move between transcript rows |
| `Space` | — | expand / collapse the row under the cursor |
| `↵` on a spawn row | — | drill into that agent |
| `Esc` / `Backspace` | — | back |
| `End` | — | jump to latest |

`Esc` never cancels a run (existing rule, design §5 of graph-execution-realtime).

**Live behaviour**
- Durations of running rows tick once per second from the shared `elapsedMs` clock. There is no per-row timer.
- Tokens update on each SSE fold. There is no animation on number change, which is fewer distractions.
- New subagents are appended. The tree does not auto-scroll. If a new row lands below the fold, a faint `+1 below` chip shows at the bottom edge, and clicking it scrolls there.
- Transcript follow: with the scroll at the bottom, new rows auto-scroll. Scrolling up more than 24px pauses, and the footer becomes `[↓ Jump to latest · N new]`. An expanded row never forces a scroll, so expanding while following does not yank the viewport.
- Status transitions swap the glyph with no fade, because instant is clearer at this density. The only motion in the panel is the `◉` running pulse, which reuses the existing slow `run-active` pulse keyframe at reduced amplitude.

**Loading**
- *Live, starting:* root row `◌` plus the muted "waiting for the CLI to start streaming…" line with the existing pulse.
- *Past run loading:* the existing banner shows "loading past run…" and the panel shows 3 faint placeholder bars in the tree shape (no spinner).
- *Reattach after F5:* the panel shows the same "waiting" state until the replay finishes, then renders the full tree at once. There is no row-by-row animation of replayed history, which would be noise.

**Empty**
- No subagents: "No subagents spawned." in faint text under the root.
- Agent with no tool calls: the transcript area shows "No tool calls." and still lists Thinking and the result.
- No background tasks: the section is hidden. Zero unattributed events: the row is hidden. This follows the existing rule: absence is the cleanest empty state.

**Error**
- A tool `is_error` gives a red `✗` and `· error` in the expanded OUTPUT header. The row label stays body color so the text is readable, and only the glyph is red.
- An agent's last result `is_error`, or the parent's tool_result for its Task being an error, gives the agent a red `✗` in the tree.
- Run failed: footer `✗ failed — exit N`. Agents still running at that moment become `◼ interrupted`, not `✗`, because an interrupted agent did not itself fail.
- SSE reconnecting: `MissionStatusStrip` already shows `⟳ reconnecting…`. The panel freezes and adds nothing, so there is no duplicate warning.
- Past run with missing or pruned `events.jsonl`: the panel shows "Transcript unavailable for this run." plus `[Summary ›]` if `run.json` has totals.
- Unknown CLI format: neutral `?` rows. `DegradedTelemetryChip` appears in the title row. The panel never throws, and each row render is guarded.
- Unattributed events: the `⚠ unattributed · N events` tree row (warning text) opens a pseudo-agent transcript of those rows.

**Cancelled / stopped**
- After the strip's two-step `■ Stop run`, the strip shows `◐ CANCELLING…` and the panel keeps updating.
- On terminal, every `◉` becomes `◼` and every `○` tool becomes `◼ interrupted`. Durations freeze at the run end time. This is a pure mapping in the derivation and covers AC-7.

**Past run (read-only)**
- Identical views. `live=false`: no follow footer, no ticking, no keyboard hint footer.
- Expand / collapse, drill and graph linking all still work. Read-only means "not streaming", not "not interactive".

---

## 6. Open Design Questions (need a taste call)

1. **Panel width and height.** Today the slot is `w-[320px]` inside a fixed `height: 480` container. Extension-style one-liners plus a 2-line tree row are cramped at 320px, and 480px shows about 14 transcript rows. Options:
   - (a) keep 320 × 480
   - (b) widen to 400px in mission/history mode only
   - (c) make the panel resizable (drag the left border, persisted per user)
   - (d) also let the graph container grow to viewport height during mission mode

   A minimalist reading prefers (b) + (d), but it is a layout taste call.
2. **Graph node → multiple runtime instances.** An agent node such as `code-reviewer` can be spawned 2+ times in one run. On a node click, should we:
   - (a) open the most recent instance
   - (b) stay on Tree and highlight all instances
   - (c) open the first instance with a `1 of 3 ‹ ›` switcher in the header
3. **Persistent graph outline vs one-shot pulse.** Should the selected agent's node keep an outline while its detail is open, or only flash once (today's pulse)? Is the outline color `brand-accent` OK next to the cyan run glow?
4. **Timestamps in transcript rows.** `RunTimelinePanel` had a `mm:ss` column. This design drops it to a tooltip to save width. Keep it visible, or tooltip only?
5. **Summary on terminal.** Today the panel auto-switches to Summary when the run ends. This design does **not** auto-switch: it stays on whatever the user was reading and adds a footer `[Summary ›]`. Keep auto-switch, or adopt the footer?
6. **Thinking rows.** Show them always (faint, one line each, as in the extension), or collapse consecutive Thinking rows into one, or hide them behind a toggle? Separately, `/plan` must confirm whether thinking text is stored in `events.jsonl` at all. If it isn't, rows are not expandable.
7. **Multi-expand.** Allow several tool rows expanded at once (current design), or accordion (one at a time, like today's `expandedSeq`)?
8. **Status color for "done".** Done is `success` green (extension parity) and running is `run-active` cyan (Symbion's existing run color). Is a green/cyan pair distinguishable enough at 8px, or should done be neutral `text-muted ✓` so that only running and error are colored (more minimalist)?
9. **Keyboard hint footer.** Show the faint `↑↓ select · ↵ open` hint, or rely on discoverability or a `?` legend?
10. **Stop in the panel.** Scope says root-level only. This design keeps it **only** in `MissionStatusStrip` and `RunBar`, with no copy on the panel's root row. Is that acceptable, or should the root Agent header also carry `■ Stop run`?

---

## 7. Design System — initial proposal

`DESIGN.md` does not exist yet. These are seeded only from tokens this feature actually uses. **Proposal only. Do not apply automatically.**

```yaml
---
version: "0.1.0"
name: "symbion-design-system"
description: "Design tokens for Symbion's desktop UI (seed from workflow-agent-run)"
colors:
  surface-panel: "#13151a"     # bg-panel
  surface-menu: "#1b1e25"      # bg-menu
  surface-code: "#08090c"      # bg-code
  hairline: "rgba(255,255,255,.06)"
  text-strong: "#f3f4f6"
  text-body: "#e5e7eb"
  text-muted: "#9aa0ab"
  text-faint: "#565c68"
  accent: "#6366f1"            # brand-accent — selection
  run-active: "#22d3ee"        # running
  success: "#4ade80"           # done/ok
  danger: "#f87171"            # error
  warning: "#fbbf24"           # unattributed / stopped / past-run
typography:
  panel-row: "mono, 11px, 400, leading-relaxed"
  panel-preview: "mono, 10px, 400"
  panel-label: "sans, 11px, 600, uppercase"   # AGENTS · 3, PROMPT, TRANSCRIPT
components:
  StatusGlyph:
    starting: "◌ text-faint"
    running: "◉ run-active (slow pulse)"
    ok: "✓ success"
    error: "✗ danger"
    interrupted: "◼ text-faint"
    pending: "○ text-muted"
    thinking: "· text-faint"
    unknown: "? text-faint"
---
```

**Components — `StatusGlyph`.** One shared glyph and color map for every run-status indicator (tree rows, transcript rows, and later the strip and bar). The shape always carries the status, and color only reinforces it.

**Do's and Don'ts**
- **Do** keep run-state color confined to the glyph. Labels stay in body text color.
- **Do** keep the existing rule "absence is the empty state" for zero-count sections.
- **Don't** introduce a second "running" color. `run-active` cyan is the only live signal, on both the graph and the panel.
- **Don't** put destructive controls (stop) inside drill-down views. They live at run scope only.

---

## Future ideas (OUT of this iteration — do not build)

- Per-agent "open this agent's `.md` in the editor" from the detail header (trace-to-source, STATE §5 idea 3).
- A `61% of tokens in Read` cost hint per agent (flame-chart style).
- A filter or search box over a long transcript.
- Copying a whole agent transcript as markdown.
- Per-subagent stop (blocked by the headless CLI, STATE §8).
- A modal "Agent map" variant (explicitly out, §9).
- A replay scrubber over a past run (FR-12).

---

**Next step:** run `/plan`. The architect reads this doc alongside STATE §9 and resolves Q6's data question: is thinking text stored in `events.jsonl`?
