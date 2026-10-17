# workflow-agent-run — Design (angle: RICH / IMMERSIVE "mission control")

> Designer angle 1 of 3 for `/design`. Source of truth for scope: `docs/loops/workflow-agent-run-STATE.md` §9 (LOCKED). Reference: STATE §8 (Claude Code extension Agent map, subagent detail, transcript).
> This angle pushes expressiveness (motion, live tickers, graph-panel linking) **inside** the locked scope. Anything beyond scope is listed under "Future ideas" and is not part of this iteration.

## 0. Constraints found in the codebase (binding)

- **No `DESIGN.md` exists at the repo root** (glob for `**/DESIGN.md` returns nothing). The de-facto design system is `apps/web/tailwind.config.ts`, which says it was "ported from DESIGN.md" via `docs/loops/symbion-dark-redesign-design.md` §7. This doc treats those Tailwind tokens as binding: `bg-panel #13151a`, `bg-menu #1b1e25`, `bg-code #08090c`, `border-hairline`, `text-body/muted/faint`, `agent #a78bfa`, `command #818cf8`, `success #4ade80`, `warning #fbbf24`, `danger #f87171`, `run-active #22d3ee` (live state only, never used for outcomes), `rounded-panel 12px`, `rounded-pill`, `shadow-dropdown`, and the animations `glowPulse`, `dashFlow`, `countLockIn`, `slideIn`, `fadeIn`, `popIn`. Dark-only.
- **Current mount point** (`DependencyGraph.tsx:1040-1192`): the graph and panel share a **fixed 480 px tall** flex row. The panel is `w-[320px]` with `border-l`. `MissionStatusStrip` (status, elapsed time, `CancelControl`) sits above it. `PastRunBanner` (amber, read-only, "Run again" / "Exit history") sits above the strip when viewing history.
- **Graph nodes** (`AgentNode.tsx`) already have `runStatus: idle|working|settled|error`. That drives a single `boxShadow` ring (cyan / green / red) plus `animate-glowPulse` while working, `highlighted`, `dimmed`, `invocations {done,total}` (×N), and `runPulseKey` for a one-shot pulse. The canvas already exposes `onNodeHover` / `onNodeClick`.
- **Toaster** (`ui/toast.tsx`) shows **one toast at a time**, bottom-center, auto-dismiss after 2,200 ms, with variants neutral, success, warning and error. Having a single slot shapes the toast design in §5.7.
- **Data model** (§9): no new RPC is expected. The panel is fed by `deriveAgentTree(events)` (incremental fold) and `summarizeToolCall(...)`. Previews stay capped at 2,000 chars (`PREVIEW_CAP`).

---

## 1. User Journey (happy path)

1. **Launch.** On the graph tab, the user runs `/build` from the node's ▶ or ⌘K → RunDialog → preflight → consent, all unchanged. The mission chrome appears: `MissionStatusStrip` shows `◌ STARTING /build`. The right-hand **Agents panel** slides in (`slideIn` 200 ms). It already has the root row `/build · opus · starting…` with a hollow cyan dot, and a one-line ghost hint, "waiting for the CLI to start streaming…".
2. **First tokens.** The first stream event arrives. The root dot turns solid cyan and starts pulsing. Duration ticks every second (`00:03`, `00:04`…). The token count rolls up smoothly as usage events land. On the graph, the `/build` node starts `glowPulse`, exactly as today.
3. **Subagent spawned.** The root agent calls `Task(code-reviewer)`. A new child row **slides in** under the root (fadeIn + 4 px drop, 160 ms), showing its pulsing dot, `code-reviewer`, the description "Review the diff for…", `00:00` and `— tok`. At the same moment the `/build → code-reviewer` edge on the graph starts its `dashFlow` current and the agent node starts glowing. Panel and graph light up **together**.
4. **Parallel siblings.** Two more subagents spawn (`explore` ×2). Each sibling row carries a thin **token-share bar** under it, so a sibling that is eating the budget is obvious at a glance. The graph's `explore` node shows `0/2` (the existing invocations counter).
5. **Hover to locate.** The user hovers the `code-reviewer` row. On the graph, that node gets a white selection-halo *outside* its status ring, the edge from `/build` brightens, and other nodes dim slightly (to 70%; the run's own 35% non-participant dim stays as is). Mouse-out restores the graph within 120 ms.
6. **Drill down.** Clicking the row (or pressing Enter) slides **Agent detail** in from the right. Its header shows `← Agents`, a breadcrumb `/build › code-reviewer`, a status chip, agentType, model, "spawned by /build", a live duration and live tokens. Below that comes the **prompt bubble** (clamped to 6 lines, with "Show full prompt"), then the **transcript timeline**: `Thinking` rows (grey dot), tool rows (`Read src/run/runManager.ts (lines 40–189)` → result line "150 lines") and new rows sliding in at the bottom as they stream. The selected node on the graph keeps its halo for as long as the detail is open.
7. **Peek without committing.** Hovering a tool row for 400 ms opens a small **hover preview card** next to the panel with the first ~8 lines of the result. Clicking expands the row inline to the full capped preview (input + output, 2,000 chars, ending "…truncated" when cut).
8. **Scroll back in time.** The user scrolls up to re-read a Grep result. Auto-follow pauses. A floating pill appears at the bottom: `↓ 7 new · Jump to latest`, and the count increments live. Clicking it (or pressing `End`) smooth-scrolls to the bottom and resumes following.
9. **Agent finishes.** `code-reviewer` completes. Its dot settles to green with a `countLockIn` flash. The duration freezes. The final **Result card** appears at the bottom of its transcript. On the graph the node turns to the green settled ring (as today). Because the user is *not* looking at that agent's detail (they went back), a success toast appears: `✓ code-reviewer finished · 1m 12s · 18.4k tok`. Several finishes that land close together share one toast (see §5.7).
10. **Error somewhere.** An `explore` instance hits a tool error. The tool row's dot turns red, the agent row gets a red dot once the agent ends with an error, and a red **error toast** appears with `[View]`, which jumps to that agent's detail.
11. **Graph to panel.** The user clicks the `explore` node on the graph. It has 2 instances, so the panel shows the tree scrolled to the `explore` instances with both rows highlighted (one instance would open its detail directly; see §6, Q4).
12. **Run ends.** The root turns green. `MissionStatusStrip` shows `✓ COMPLETED`. The panel tab bar switches to **Summary** (existing auto-switch behaviour) with the existing `RunSummarySection`. The **Agents** tab stays one click away, now a frozen tree.
13. **Later: a past run.** From `🕘 runs 12` the user opens run #9. The amber `PastRunBanner` appears, and the panel opens on the **Agents** tab with a "read-only" chip. The same tree and details are rendered from `events.jsonl` with no pulsing, no ticking and no jump-to-latest pill. Graph glow is frozen at final states. Exit history returns to authoring mode.

---

## 2. Screen Inventory

| # | Screen / state | Entry trigger | Exit path |
|---|---|---|---|
| S0 | **Mission layout**: graph + Agents panel (modified layout) | run starts / reattach / open past run | run ends, then panel close (×) / Exit history |
| S1 | **Agents panel: Tree view (live)** | default tab during a live run | click row → S3; tab → Summary/Raw |
| S2 | **Tree view: starting / waiting** | run status `starting`, 0 events | first event → S1 |
| S3 | **Agent detail: live transcript** (root or subagent) | row click / Enter / graph node click (1 instance) / toast `[View]` / spawn-row click in a parent transcript | `← Agents` / Esc / `←` key → S1; breadcrumb segment → parent detail |
| S4 | **Transcript: tool row expanded** | click / Space on a tool row | click again / Space / Esc (collapses first) |
| S5 | **Hover preview card** (transient) | 400 ms hover on a tool or thinking row | mouse-out (100 ms grace) / click (promotes to S4) |
| S6 | **Transcript: follow paused + Jump to latest** | user scrolls up while live | pill click / `End` / scroll to bottom |
| S7 | **Terminal: Summary tab** (existing `RunSummarySection`, re-hosted) | run reaches a terminal status (auto) | tab → Agents (frozen tree) |
| S8 | **Cancelling / Cancelled / Failed / Timed-out tree** | Stop run / failure / ceiling | Summary tab / close |
| S9 | **Past run (read-only)**: tree + detail | History popover → pick run | Exit history (banner) |
| S10 | **Loading past run / reattaching (skeleton)** | history fetch in flight / F5 replay | data ready → S9 / S1 |
| S11 | **Degraded telemetry** (flat tree) | `degraded` flag from the store | none (informational) |
| S12 | **Toasts** (agent finished / agent error / run ended) | events while the panel is not showing that agent | auto-dismiss 2.2 s / `[View]` → S3 |
| S13 | **Raw tab** (existing `RunLogTail`) | tab click | tab click |

No modal is introduced. The "Agent map" modal is explicitly OUT of scope (§9).

---

## 3. ASCII Wireframes

Panel width is drawn at ~46 columns ≈ 360 px (see §6 Q1: today it is 320 px). Glyph legend used throughout:

```
●  solid dot            ◉  pulsing dot (run-active cyan, glowPulse)
○  hollow / pending     ◼  cancelled / interrupted (text-faint)
✓  done (success)       ✕  error (danger)      ◐  cancelling (warning)
▸/▾ collapsed/expanded  ⟶  drills into child agent
```

Colour key: `◉` is cyan (`run-active`), `●` with ✓ is `success`, `✕` is `danger`, `◼` and `○` are `text-faint`, and Thinking rows are `text-muted` grey.

### S0 — Mission layout (graph + Agents panel)

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ RUNNING  /build — "add retry to webhook sender"           ⏱ 02:41   [ ■ Stop run ]        │ ← MissionStatusStrip (existing)
├──────────────────────────────────────────────┬─────────────────────────────────────────────┤
│ [+ Add] [Fit] [?]                            │ Agents  Summary  Raw         ⟳  ⚠deg   [×] │ ← PanelTabs
│ (🕘 runs 12)                                  ├─────────────────────────────────────────────┤
│                                              │ ◉ /build      opus · 02:41 · 41.2k tok     │
│        ┌──────────────┐                      │   ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │
│        │ /build    ◉  │ ═══╗  (dashFlow)     │   ├ ✓ code-reviewer       1m12s  18.4k     │
│        │ 41.2k · $.31 │    ║                 │   │   ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔                  │
│        └──────────────┘    ║                 │   ├ ◉ explore  "find webhook…"  0:48  6.1k │
│            ║               ▼                 │   │   ▔▔▔▔▔▔                               │
│            ║      ╔══════════════════╗       │   └ ◉ explore  "map retry…"     0:31  3.0k │
│            ╚═════>║ ░ code-reviewer ░║ ← halo│       ▔▔▔                                  │
│                   ╚══════════════════╝ (hov) │   BACKGROUND TASKS (1)                     │
│                     ┌───────────┐            │   ◉ $ npm test -- --watch=false   0:22     │
│                     │ explore 0/2│ ◉         │                                             │
│                     └───────────┘            │                                             │
├──────────────────────────────────────────────┴─────────────────────────────────────────────┤
```

- The panel stays inside the existing 480 px graph row. Its tabs replace the old `Feed | [≡ Raw] | Summary`.
- The hovered panel row (`code-reviewer`) gives a halo on its node and a brighter edge on the graph.

### S1 — Tree view (live), detailed row anatomy

```
┌─────────────────────────────────────────────┐
│ Agents  Summary  Raw                    [×] │  tabs: Summary disabled until terminal
├─────────────────────────────────────────────┤
│ ROOT                                        │  section label 10px text-faint uppercase
│ ┌─────────────────────────────────────────┐ │
│ │ ◉ /build                     ⏱ 02:41    │ │  root card: bg-surface, rounded-panel
│ │   opus · 4 agents · 23 tools  41.2k tok │ │  tokens = existing roll-up (fresh)
│ │   ~$0.31                       [Open ⟶] │ │  Open ⟶ = root transcript (old timeline)
│ └─────────────────────────────────────────┘ │
│ SUBAGENTS (3)                     ▾ sort: ⏱ │  sort: spawn order (default) | tokens
│  ◉ explore            0:48     6.1k tok     │  ← selected row: bg-brand-accent-soft
│    "find webhook sender call sites"         │     + 2px left bar brand-accent
│    ███████░░░░░░░░░░░░░░░░░░░  22%          │  token-share bar vs siblings (2px tall)
│  ◉ explore            0:31     3.0k tok     │
│    "map retry semantics in queue/"          │
│    ███░░░░░░░░░░░░░░░░░░░░░░░  11%          │
│  ✓ code-reviewer      1m12s   18.4k tok     │  done: green dot, frozen duration
│    "Review the diff for regressions"        │
│    ██████████████████░░░░░░░░  67%          │
│    └ ✓ explore        0:19     2.2k tok     │  nested (depth 2), indented 12px
│      "list test files touching sender"      │
│ BACKGROUND TASKS (1)                    ▾   │  collapsible group
│  ◉ $ npm test -- --watch=false    0:22      │  click → expands inline (no detail view)
│ UNATTRIBUTED (2)  ⚠                      ▸  │  warning tint, collapsed by default
│                                             │
│ ─────────────────────────────────────────── │
│ ↑↓ move · ↵ open · esc back · / filter      │  key hint footer, 10px text-faint
└─────────────────────────────────────────────┘
```

Row anatomy for a subagent row (two lines plus a bar, 44 px total):

```
 [dot] [agentType 12.5px text-body]      [⏱ mono tabular]  [tokens mono tabular]
       ["description" 11px text-muted, 1-line truncate]
       [token-share bar 2px, agent violet @60%, % label text-faint on hover only]
```

### S2 — Tree view: starting / waiting

```
┌─────────────────────────────────────────────┐
│ Agents  Summary  Raw                    [×] │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │ ○ /build                      ⏱ 00:02   │ │  hollow cyan ring, slow breathing
│ │   opus · starting…              — tok   │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│   ░░░░░░░░░░░░░░░░░░░░░░░░  (shimmer row)   │  one skeleton row, 40% opacity
│                                             │
│   waiting for the CLI to start streaming…   │  same copy as today, animate-pulse
│                                             │
└─────────────────────────────────────────────┘
```

### S3 — Agent detail (live transcript)

```
┌─────────────────────────────────────────────┐
│ [← Agents]  /build › code-reviewer      [×] │  breadcrumb: each segment clickable
├─────────────────────────────────────────────┤
│ ◉ RUNNING   code-reviewer                   │  status chip (cyan text, pill)
│ sonnet · foreground · spawned by /build     │  11px text-muted
│ ⏱ 0:54   18.4k tok   ~$0.09   12 tools      │  live tickers, mono tabular-nums
├─────────────────────────────────────────────┤
│ PROMPT                                  ⧉   │  ⧉ = copy prompt
│ ┌─────────────────────────────────────────┐ │
│ │ Review the diff on feat/retry for       │ │  prompt bubble: bg-code, rounded-panel
│ │ regressions in the webhook sender.      │ │  clamp 6 lines + fade mask
│ │ Focus on idempotency and the backoff…   │ │
│ │                      [Show full prompt] │ │
│ └─────────────────────────────────────────┘ │
│ TRANSCRIPT                                  │
│ 00:01 ● Thinking                            │  grey dot, italic first line on hover
│ 00:03 ✓ Glob  pattern: "src/**/webhook*.ts" │
│         Found 5 files                       │  result line 10.5px text-muted
│ 00:04 ✓ Read  sender.ts (lines 40–189)      │
│         150 lines                           │
│ 00:09 ✓ Grep  "retryAfter" (in src/)        │
│         12 matches in 4 files               │
│ 00:12 ✕ Bash  npm test -- sender            │  red dot
│         exit 1 · 123 lines of output        │  result line text-danger
│ 00:20 ⟶ Agent explore "list test files…" ✓ │  spawn row: click drills into child
│ 00:31 ● Thinking                            │
│ 00:33 ○ Edit  sender.ts                     │  pending: hollow cyan ring, no result yet
│         ·  ·  ·                             │  typing-dots placeholder
│                                             │
│        ╭────────────────────────╮           │
│        │ ↓ 3 new · Jump to latest│           │  S6 pill (only when follow paused)
│        ╰────────────────────────╯           │
├─────────────────────────────────────────────┤
│ ▼ following                     [ / find ]  │  footer: follow state (as today)
└─────────────────────────────────────────────┘
```

- The header (status, meta, tickers) is **sticky**. The prompt bubble scrolls away with the transcript.
- The root agent's detail is the same view with the breadcrumb `/build` and "spawned by: you (run requirement)". Its prompt bubble shows the run requirement.

### S3b — Agent detail, terminal (Result card)

```
│ 01:10 ✓ Edit  sender.ts (+14 −3)            │
│ 01:12 ● Thinking                            │
│ ┌ RESULT ─────────────────────────────── ⧉ ┐│  bg-surface, left bar success
│ │ Found 2 regressions:                     ││  (danger bar if agent errored)
│ │ 1. backoff resets on 429 …               ││
│ │ 2. idempotency key not forwarded …       ││
│ │                     …truncated (2,000)   ││  explicit marker when capped
│ └──────────────────────────────────────────┘│
│ ✓ DONE in 1m12s · 18.4k tok · ~$0.09        │  footer replaces "following"
```

### S4 — Tool row expanded

```
│ 00:04 ▾ ✓ Read  sender.ts (lines 40–189)    │  row gets bg-panel, chevron rotates
│   ┌ INPUT ───────────────────────────── ⧉ ┐ │
│   │ { "file_path": "src/webhook/sender.ts",│ │  bg-code, mono 10.5px
│   │   "offset": 40, "limit": 150 }         │ │
│   ├ OUTPUT ──────────────────────────── ⧉ ┤ │
│   │  40  export async function send(…) {   │ │  scroll inside, max-height 220px
│   │  41    const res = await fetch(…)      │ │
│   │  …                                     │ │
│   │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │ │
│   │ …truncated — preview capped at 2,000   │ │  warning-tinted marker line
│   │   chars                                │ │
│   └────────────────────────────────────────┘ │
│   step tokens  in 1,204 · out 88    ⏱ 0.4s  │  carries over the old timeline's info
```

- An error output gets a `danger/10` background and a "✕ is_error" label.
- An unknown/degraded event row expands to the raw preview with the label "Unrecognized event: <type>".

### S5 — Hover preview card (transient)

```
                         ┌───────────────────────────────┐
  00:09 ✓ Grep "retry…" ─┤ Grep  "retryAfter" (in src/)  │  popIn, shadow-dropdown, w-[300px]
                         │ src/queue/retry.ts:14         │  rendered LEFT of the panel,
                         │ src/webhook/sender.ts:62      │  overlaying the graph edge
                         │ src/webhook/sender.ts:88      │
                         │ … +9 more · click to expand   │
                         └───────────────────────────────┘
```

Hovering a tree row instead shows a prompt preview card (the first 4 lines of the prompt, agentType, model).

### S8 — Cancelling / Cancelled / Failed

```
CANCELLING (after [■ Stop run] confirm)         CANCELLED (terminal)
┌─────────────────────────────────────────┐    ┌─────────────────────────────────────────┐
│ ◐ /build   stopping whole run…   02:58  │    │ ◼ /build   cancelled by you    02:59    │
│  ◐ explore            0:52   6.4k       │    │  ◼ explore   interrupted   0:52   6.4k  │
│  ✓ code-reviewer      1m12s 18.4k       │    │  ✓ code-reviewer         1m12s 18.4k    │
│  ◐ explore            0:35   3.1k       │    │  ◼ explore   interrupted   0:35   3.1k  │
│ BACKGROUND TASKS                        │    │ BACKGROUND TASKS                        │
│  ◐ $ npm test …              0:31       │    │  ◼ $ npm test …   interrupted   0:31    │
└─────────────────────────────────────────┘    └─────────────────────────────────────────┘
 pulse stops; amber half-dots; tickers freeze    no row is ever left ◉ (AC-7)

FAILED (exit 1)                                  TIMED-OUT (ceiling)
│ ✕ /build   failed · exit 1     01:40    │    │ ◼ /build  stopped · token cap  04:10  │
│  ✓ code-reviewer      1m12s 18.4k       │    │  ◼ explore   interrupted …            │
│  ✕ explore  "find webhook…"  0:48       │    │  (warning tint on the root card)      │
│ [View stderr in Summary ⟶]              │    │ [Adjust ceilings ⟶] (existing link)   │
```

### S9 — Past run (read-only)

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ 🕘 VIEWING PAST RUN · #9 · Oct 14, 16:02   completed · 3m 4s · read-only  [▶ Run again][Exit]│ ← PastRunBanner (existing)
├──────────────────────────────────────────────┬─────────────────────────────────────────────┤
│  (graph, frozen final glow states)           │ Agents  Summary  Raw        [read-only] [×] │
│                                              ├─────────────────────────────────────────────┤
│                                              │ ✓ /build      opus · 3m4s · 52.0k tok      │
│                                              │  ✓ code-reviewer      1m12s  18.4k         │
│                                              │  ✓ explore            0:48    6.1k         │
│                                              │ BACKGROUND TASKS (1)                       │
│                                              │  ✓ $ npm test …       0:22                 │
│                                              │                                             │
│                                              │ ↑↓ move · ↵ open · esc back                │
└──────────────────────────────────────────────┴─────────────────────────────────────────────┘
```

- No pulsing, no tickers, no follow footer and no Jump pill. Timestamps are run-relative.
- The detail view is identical to S3b. Nothing in it is editable.

### S10 — Loading past run / reattaching

```
┌─────────────────────────────────────────────┐
│ Agents  Summary  Raw                    [×] │
├─────────────────────────────────────────────┤
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  3 shimmer rows (root card + 2 children)
│   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░           │
│   ░░░░░░░░░░░░░░░░░░░░░░░░░░               │
│   rebuilding agent tree… 1,240 events      │  F5 reattach only: live event counter
└─────────────────────────────────────────────┘
```

### S11 — Degraded telemetry

```
│ Agents  Summary  Raw          ⚠ degraded  [×]│  existing DegradedTelemetryChip
│ ◉ /build      opus · 01:10 · — tok           │
│ ┌──────────────────────────────────────────┐ │
│ │ ⚠ Subagent attribution unavailable for   │ │  warning/10 inline notice
│ │   this CLI output. All activity is shown │ │
│ │   in the root transcript.     [Open ⟶]   │ │
│ └──────────────────────────────────────────┘ │
```

### S12 — Toasts (existing Toaster, bottom-center)

```
            ╭──────────────────────────────────────────────╮
            │ ✓ code-reviewer finished · 1m12s · 18.4k tok │   success
            ╰──────────────────────────────────────────────╯
            ╭──────────────────────────────────────────────╮
            │ ✕ explore failed: Bash exit 1        [View]  │   error (needs a toast action, §6 Q6)
            ╰──────────────────────────────────────────────╯
            ╭──────────────────────────────────────────────╮
            │ ✓ 3 agents finished                          │   coalesced (≤1.5s window)
            ╰──────────────────────────────────────────────╯
```

### Graph-side states (no new screen, overlay on existing nodes)

```
 idle-in-run        working              settled           error            panel-hovered       panel-selected
 ┌─────────┐      ┌─────────┐ ◉pulse   ┌─────────┐ green  ┌─────────┐ red  ┌─────────┐ +halo   ┌─────────┐ +halo
 │ explore │ 35%  │ explore │ cyan     │ explore │ ring   │ explore │ ring │ explore │ white   │ explore │ accent
 └─────────┘ dim  └─────────┘ ring     └─────────┘        └─────────┘      └─────────┘ 2px gap └─────────┘ 2px gap
```

The halo is a **second** ring at a 2 px offset *outside* the status ring, so selection never hides status. Hover uses `white/50`, selection uses `brand-accent`.

---

## 4. Component Breakdown (interface contracts, no implementation)

### Existing components (kept and re-wired)
- `MissionStatusStrip`: unchanged layout. `CancelControl` is relabelled **"■ Stop run"** with the confirm copy "Stops the whole run, including all subagents." It is the **only** stop control (AC-8).
- `PastRunBanner`, `RunHistoryPopover`, `RunSummarySection`, `TokenBreakdownCard`, `RunLogTail`, `DegradedTelemetryChip`: re-hosted inside the new panel tabs, unchanged.
- `ui/badge` for the status chip, `ui/tooltip` for truncated descriptions, `ui/button` (ghost) for `← Agents`, `[Open ⟶]` and the copy buttons, and `ui/toast` (Toaster, extended, see below).
- `RunTimelinePanel`: **deleted**. Its row-expand data (`tool`, `input`, `stepTokens`) moves into `ToolRowExpanded`.

### New components (`apps/web/src/components/run/agents/`)

| Component | Props / state contract |
|---|---|
| `AgentsPanel` (replaces `RunTimelinePanel` at the mount point) | `tree: AgentTreeView` (root, children, backgroundTasks, unattributed), `liveness: "live" \| "terminal" \| "history"`, `runStatus`, `tab: "agents"\|"summary"\|"raw"`, `onTabChange`, `view: {kind:"tree"} \| {kind:"detail", agentId}`, `onViewChange`, `hoveredAgentId`, `onHoverAgent(id\|null)`, `summary?`, `rawLines`, `degraded`, `degradedReason`, `connection`, `projectId`, `onRerun`, `onClose`. Owns no data derivation, only view state passed in or out. |
| `PanelTabs` | `tab`, `summaryAvailable`, `historyMode`, `degradedChip?`, `connection`, `onClose`. |
| `AgentTree` | `root`, `children`, `backgroundTasks`, `unattributed`, `selectedId`, `hoveredId`, `sort: "spawn"\|"tokens"`, `onSelect`, `onHover`, `onOpen`, `animateInserts: boolean` (false during replay/history). Keyboard roving focus (↑↓ / Enter / →). |
| `AgentRootCard` | `agent: AgentNode` (name, model, status, startedAt, endedAt, tokens, costUsd, agentCount, toolCount), `live`, `onOpen`. |
| `AgentTreeRow` | `agent`, `depth`, `siblingMaxTokens` (for the share bar), `selected`, `hovered`, `live`, `isNew` (drives slide-in once), `onClick`, `onHover`. Recursive for `children`. |
| `AgentStatusDot` | `status: "pending"\|"running"\|"done"\|"error"\|"cancelling"\|"interrupted"\|"cancelled"\|"thinking"\|"unknown"`, `live: boolean` (pulse only when live and running), `size: "sm"\|"md"`. Always has `aria-label`. |
| `LiveDuration` | `startedAt`, `endedAt?`, `ticking: boolean`. One shared 1 s ticker for the whole panel, not one timer per row. |
| `TokenCounter` | `value`, `animate: boolean` (300 ms count-up tween on change, off under reduced motion), `format: "short"\|"full"`. |
| `TokenShareBar` | `value`, `max`, `color: "agent"\|"command"`. Hidden when there is only 1 sibling. |
| `BackgroundTasksGroup` | `tasks: {id, commandSummary, status, startedAt, endedAt?}[]`, `expandedId`, `onToggle`. Rows expand inline to the Bash tool preview. |
| `UnattributedGroup` | `rows: TranscriptRow[]`, `collapsed`, with a tooltip explaining "events whose parent agent wasn't seen". |
| `AgentDetail` | `agent`, `breadcrumb: {id,label}[]`, `rows: TranscriptRowModel[]`, `result?: {text, truncated, isError}`, `live`, `onBack`, `onNavigate(agentId)` (breadcrumb + spawn rows). |
| `AgentDetailHeader` | `agent`, `spawnedBy: string \| "you"`, `live`. Sticky. |
| `PromptBubble` | `text`, `truncated`, `clampLines=6`, `expanded`, `onToggle`, `onCopy`. |
| `TranscriptList` | `rows`, `follow: boolean`, `onFollowChange`, `newSincePause: number`, `expandedSeq`, `onToggleRow`, `virtualized` (always; windowed rendering for 2,000+ rows, AC-10), `animateInserts`. |
| `TranscriptRow` (variants: `ToolRow`, `ThinkingRow`, `SpawnRow`, `TextRow`, `UnknownRow`) | `seq`, `atMs`, `status`, `summary` (from `summarizeToolCall`), `resultLine?`, `expandable?`, `isNew`, `onHoverPreview(seq\|null)`. `SpawnRow` adds `childAgentId` and `childStatus`. |
| `ToolRowExpanded` | `input: string`, `output?: string`, `inputTruncated`, `outputTruncated`, `isError`, `stepTokens`, `durationMs?`, `onCopy(part)`. |
| `HoverPreviewCard` | `anchorRect`, `title`, `lines: string[]` (≤8), `moreCount`, `side: "left"`. Portal-rendered, no focus trap. |
| `ResultCard` | `text`, `truncated`, `isError`, `onCopy`. |
| `JumpToLatestPill` | `count`, `onJump`. |

### Graph changes (`components/graph/`)
- `AgentNodeData` / `CommandNodeData` gain `runHovered?: boolean`, `runSelected?: boolean` (the outer halo ring, composed with the status ring) and `runLinkDim?: boolean` (dims to 70% while a panel row is hovered).
- `GraphEdgePath` gains `runLinked?: boolean`, which brightens the stroke and adds a +0.5 px width for the hovered agent's incoming edge.
- `DependencyGraph` owns `hoveredRunAgentId` and `selectedRunAgentId`. Panel ↔ graph mapping is many-to-one: runtime agent instance → graph node via `agentType` = agent name, and root → command node.
- `onNodeClick` while `missionLike`: no longer sets `panelFilterId`. It resolves the instances of that node. With 1 instance it opens detail. With N instances it switches to the tree, scrolled there, with those rows flashed (see §6 Q4).

### Toaster extension
- An optional `action?: {label, onClick}` on the toast (for `[View]`). It is a small, generic addition (§7).
- A run-scope coalescing helper in the run store: finishes inside a 1.5 s window collapse into one "✓ N agents finished" toast.

---

## 5. Interaction Notes

### 5.1 Motion (all of it collapses under `prefers-reduced-motion`, joining the existing globals.css block)
- **Row insert** (new subagent, new transcript row): `fadeIn` + translateY(4 px→0), 160 ms. This runs **only** while live, the user is following, and the row is not part of a replay batch. Replayed or history rows render with no animation.
- **Running dot**: a 1.8 s `glowPulse` at dot scale (cyan). Under reduced motion it becomes a static solid cyan dot.
- **Status settle**: a one-shot `countLockIn` on the dot and row on running→done or error, mirroring the node lock-in already on the graph.
- **Drill-down**: the detail enters with `slideIn` (translateX 24 px→0, 200 ms). Going back enters the tree from the left (a mirrored keyframe, §7). The tree's scroll position and focused row are **preserved** on back.
- **Token tween**: a 300 ms count-up on each usage update. It is skipped when the delta is under 50 tokens, so it doesn't jitter.
- **Graph link**: hover halo and edge brighten in 120 ms with `transition: box-shadow`. There is no layout shift, since nodes never resize (the existing fixed-width badge rule).

### 5.2 Live tickers
- One panel-level `requestAnimationFrame`-free 1 s interval drives every `LiveDuration` with `ticking=true`. Durations show `0:48` under 10 min, `12:04` otherwise, and `1m12s` once frozen.
- Tokens come from the same roll-up as the graph badges. Panel and node numbers must be **identical** at every instant (AC-1).

### 5.3 Follow / auto-scroll (AC-5)
- Follow is on by default in a live detail view. Scrolling up more than 24 px from the bottom pauses it (the same threshold as today). The pill counts rows appended since the pause. `End`, the pill, or scrolling back to the bottom resumes following.
- New rows that arrive while paused never animate and never move the viewport (anchor-preserving).
- The tree view also auto-reveals newly spawned children only if the tree is scrolled to the top or bottom; otherwise it shows a small `↓ 1 new agent` pill.

### 5.4 Keyboard
- Tree: `↑/↓` move, `Enter`/`→` open detail, `/` filters the tree by name or description (client-side).
- Detail: `Esc`/`←`/`Backspace` go back (Esc first collapses an expanded row), `j/k` move between rows, `Space` toggles expand, `End` jumps to latest, `[`/`]` go to the previous/next sibling agent.
- Shortcuts are active only while focus is inside the panel, so they never collide with graph or ⌘K shortcuts.

### 5.5 Empty states
- Run with no subagents: the tree shows the root card plus a faint line, "No subagents spawned (yet)". The BACKGROUND TASKS and UNATTRIBUTED groups are **absent** (not shown as empty), following the codebase rule "absence is the cleanest empty state".
- Agent with no tool calls yet: the transcript shows a typing-dots row under the prompt.
- Agent with no result text at the end: the Result card reads "No final message", in italic text-faint.

### 5.6 Error / edge states
- Tool `is_error`: red dot, red result line, and an expanded output with a danger tint. The agent row only goes red if the **agent** ends in error (a tool error alone does not fail the agent). On the row, a small `1✕` counter next to the tool count flags agents with tool errors.
- Tool with no result: hollow cyan ring while live, then `◼ interrupted` when the run is terminal (AC-7).
- Unknown event: a neutral grey `?` dot with "Unrecognized event: <type>". It is expandable to the raw preview and never crashes.
- Reconnecting (`connection === "reconnecting"`): the panel header shows `⟳ reconnecting…`. Pulsing dots freeze to static cyan, tokens dim to 60%, and durations keep ticking because they are wall-clock based. Everything resumes on reconnect without a re-animation storm.
- F5 reattach: S10 skeleton, then the full tree at once. **No toasts and no insert animations** for replayed events, and the previous view (tree or detail plus agentId) is restored from session storage if that agent still exists.
- Cancelled: `◐` amber half-dots during `cancelling` (no pulse), then `◼ interrupted` on every non-terminal row.
- Large runs: virtualization keeps the row height fixed (collapsed rows are 1 or 2 lines). Expanded rows are measured. The hover preview is disabled while scrolling fast (more than 1 row/16 ms).

### 5.7 Toasts (single-slot Toaster)
- **Fire for:** an agent finishing (success), an agent erroring (error, with `[View]`), and the run ending (completed/failed/cancelled, with `[Summary]`).
- **Suppress when:** the user is already viewing that agent's detail, the event is a replay or history, or the run-end toast would duplicate the strip status (it still fires, since the strip may be off-screen when scrolled).
- **Priority:** error beats run-end beats finish. A lower-priority toast never replaces a visible error toast.
- **Coalescing:** finishes within 1.5 s merge into "✓ N agents finished".

### 5.8 Past run (read-only)
- `liveness="history"` sets `ticking=false`, `animateInserts=false` and `follow` off, with no follow footer, no Jump pill and no toasts. The `[read-only]` chip sits in the tab bar (the amber banner already says so). The graph shows frozen final status rings, and hover/selection linking works exactly as live.

---

## 6. Open Design Questions (need a taste call, not guessed)

1. **Panel width.** Today it is 320 px. The two-line agent rows plus the share bar and tool one-liners fit better at **360–400 px**. Options: keep 320, go to 380 fixed, or make it resizable (drag the left border, persisted). Related: the graph row is a **fixed 480 px** tall, which makes the transcript short. Should mission mode grow that height (for example to the viewport)?
2. **Token-share bar.** Show it always, only on hover, or only when siblings ≥ 2? And should it be token share or $ share?
3. **Toasts per agent finish.** The brief asks for them, but a 6-way fan-out still produces noise even with coalescing. Options: (a) finish + error + run-end as specified, (b) error + run-end only, with finishes shown as in-panel flashes, (c) user setting.
4. **Graph click on a node with N runtime instances.** Choices: (a) tree view with the instances highlighted, (b) open the most recent instance's detail, (c) a small instance chooser popover on the node.
5. **"Stop run" placement.** Keep it only in `MissionStatusStrip` (current), or also mirror it on the panel's root card? Both would stop the whole run. A mirror is closer to the extension's per-agent Stop location, but it risks implying per-agent stop.
6. **Toast action button.** `[View]` / `[Summary]` need an action slot on the Toaster, which currently has none. Is extending the shared Toaster acceptable, or should toasts stay text-only?
7. **Raw tab.** Keep `Raw` as a third tab (the existing `RunLogTail`), or drop it now that the root transcript covers the old feed (AC-9 only requires the feed to be covered)?
8. **Terminal auto-switch.** On run end, auto-switch to **Summary** (today's behaviour) or stay on **Agents**? For past runs, open on Agents (proposed) or Summary?
9. **Hover preview card.** It overlays the graph to the left of the panel. Is a floating card over the canvas acceptable, or must previews stay inside the panel (expand only)?
10. **Background tasks.** Treat them as a group in the tree with inline expand (proposed), or give them a detail view like agents?

---

## 7. Design System Updates (proposed, not applied)

`DESIGN.md` does not exist at the repo root; tokens live in `apps/web/tailwind.config.ts`. These are proposed additions in canonical order. Only reusable items are listed.

```diff
## Colors
+ run-interrupted: text-faint (#565c68)  — terminal "never finished" state (cancelled/interrupted
+                                           agents & tool rows). Distinct from success/danger; never cyan.
+ run-thinking:    text-muted (#9aa0ab)  — Thinking rows in any transcript.
  (run-active stays live-only; outcomes keep success/danger/warning.)

## Layout
+ panel-right-run: 360–400px (pending Q1) — right-side run panel width, shared by future run surfaces.

## Elevation & Depth
+ selection-halo: second ring 2px OUTSIDE any status ring (box-shadow composition:
+   status 0 0 0 2px <status>, then 0 0 0 4px bg-panel, then 0 0 0 6px <halo>).
+   Hover halo = white/50, selected halo = brand-accent. Rule: selection never replaces status.

## Components
+ StatusDot: 8px (md) / 6px (sm); variants pending|running|done|error|cancelling|interrupted|thinking|unknown;
+   running pulses only when live; always aria-labelled.
+ Toast: optional single action (label + onClick); priority error > run-end > info; coalescing window 1.5s.
+ Animation slideInBack: translateX(-24px)→0, .2s cubic-bezier(.2,.8,.2,1) — mirror of slideIn for back nav.
+ Animation rowIn: opacity 0→1 + translateY(4px)→0, .16s — streamed-list inserts; disabled during replay.

## Do's and Don'ts
+ Do: freeze all live affordances (pulse, tickers, insert motion, toasts) in read-only/replayed views.
+ Don't: animate rows that arrive via replay/reattach.
```

---

## Future ideas (out of locked scope; do not build now)
- A run **scrubber** over the tree (FR-12): drag time to see which agents were alive.
- A flame-chart / Gantt mini-view of agent lifetimes under the tree.
- A **trace-to-source jump**: "61% of tokens in Read". Open the agent `.md` in CodeMirror from the detail header.
- A **denied-tools row**, "allow this tool", wired to the settings editor (FR-8).
- Desktop notification on run end (FR-13).
- Per-subagent Stop (needs a CLI channel; explicitly OUT in §9).
- An "Agent map" modal variant.

---

**Next step:** compare with the other two designer angles and merge into `docs/loops/workflow-agent-run-design.md`, resolve §6 with the user, then run `/plan`.
