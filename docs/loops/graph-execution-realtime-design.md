# graph-execution-realtime — Design (canonical, synthesized)

> Deliverable #2 of the locked spec (STATE §7): the UI prototype of the mission-control screen.
> Synthesized 2026-07-14 from 3 design angles (minimalist / rich-immersive / progressive-disclosure).
> Respects every STATE §6 locked decision — nothing here re-litigates surface, consent, preflight
> policy, token formula, roll-up, concurrency, history size, or settings shape.
>
> **What was blended and why:** all three angles independently converged on the same skeleton
> (one RunDialog forked from CopyRunCommandDialog · mission-mode overlay on the existing graph ·
> right timeline panel that morphs into the summary · a run bar · history · `useRunStore` folding
> SSE events through `core.aggregate`). This doc takes the **progressive-disclosure ladder** as the
> organizing spine (it decides what a first-timer must see vs what stays behind hover/click), the
> **minimalist** dialog/error discipline (one dialog does all gating; blockers=red+action,
> degradations=amber+continue; inline two-step cancel), and the **rich** angle's node/edge state
> anatomy, token-breakdown card, and reattach choreography (they ARE the feature — the user asked
> for "the more visual and detailed the realtime view, the better").
>
> Design-system note: no repo-root `DESIGN.md` exists; `apps/web/tailwind.config.ts` (dark-only
> token set) is binding. Everything below resolves to existing tokens except the proposals in §7.
> UI language: **English**, matching all shipped components.
>
> Phase tags: P1 = execute/cancel/raw-log-tail + glow · P2 = structured telemetry · P3 = history + reattach.

---

## 0. The disclosure ladder (design spine)

| Rung | Who | What they see | How it reveals |
|---|---|---|---|
| **L0 Launch** | first-timer | `▶ Execute…` on a command node → one dialog (requirement + preflight + consent) → graph glows → toast + summary | default path, zero config |
| **L1 Watch** | same run, 10 s later | timeline panel (one-line rows), token badges on lit nodes, elapsed clock, Cancel | automatic when a run starts |
| **L2 Inspect** | curious user | per-row expansion in the timeline, 4-way token breakdown on badge hover, own/+agents split, raw NDJSON tab | hover / click, never forced |
| **L3 Learn** | returning user | history (🕘 icon appears only after run #1), read-only past-run overlay, re-run prefilled, "Last run: ~$0.52" hint in the dialog | small affordances that install themselves |
| **L4 Tune** | power user | Settings → Execution (permission mode, allowed-tools, ceilings), reached from 3 in-context doors | buried; defaults mean novices never open it |

Synthesis decisions where the angles differed (rationale kept short):

| Topic | Decision | Why |
|---|---|---|
| Run bar placement | **bottom dock, app-wide** (rich + progressive) | it's global chrome; visible from any screen; VS Code-familiar |
| Cancel from the global bar | **yes**, with inline two-step confirm | a run you can't stop from where you are breeds fear; confirm step keeps it deliberate |
| Canvas height in mission mode | **keep 480 px** + `⛶ expand` toggle to viewport height | zero layout shift by default (additive overlay), cockpit on demand |
| Token badge position | **inside the node, below the label**, fixed-width `tabular-nums` | no floating elements, no node jitter; 2 of 3 angles |
| Post-run panel | timeline **auto-morphs to Summary** with `[Feed]` tab back; deferred if the user is mid-scroll | opinionated default, never yanks the view |
| Authoring during a run | **all authoring suspends** (menus, drag-to-connect, edge toolbars); resumes when overlay closes | simpler + safer than per-affordance rules; P1–P8 contracts untouched outside a run |
| Entry points v1 | node `⋯` menu + ⌘K only (list-row menu deferred) | fewest paths; add on demand |
| First-run ack persistence | per-project, **re-asked when run settings change** (mode/tools) | consent tied to what was consented to |
| Cross-highlight | node click → filters feed · feed row click → node pulses (both directions, store-mediated) | cheap via store, high inspectability |

---

## 1. User Journey

### 1A. Happy path — first run ever in this project

1. **Entry** — Graph tab. Hover `/analyze` command node → `⋯` menu shows **▶ Execute…** above
   "Copy run command" (Copy stays forever as the zero-trust fallback). Agent nodes get no Execute
   (locked: commands are the only entry points).
2. **RunDialog opens.** Requirement input autofocused. Preflight checks fire on open and render
   as they resolve (≤300 ms): `✓ claude CLI 2.1.x · authenticated`, `✓ /analyze published v0.3.0`,
   `✓ agents ba, architect published`, `✓ git tree clean`. The exact invocation echoes read-only
   below. Plain-language permission line: *"Runs in ~/code/my-service · mode acceptEdits — the
   agent may create and modify files there. Symbion's diff-preview does NOT apply to the agent's
   writes. Ceilings: 30 min · 200k tokens."* `[change]` deep-links to Settings → Execution.
3. **First run only:** acknowledgment block with a required checkbox —
   `[ ] I understand the agent may modify files in ~/code/my-service`. Execute disabled until
   ticked. Persisted per project; re-asked if run settings later change.
4. **⌘↵ / [ ▶ Execute ].** Button → `⟳ Starting…`; dialog closes on the `starting` event.
5. **Mission mode ignites** (~300 ms): non-participants fade to 35 %, `/analyze` gains a pulsing
   run-active ring, the **timeline panel** slides in on the canvas right edge, the **run bar**
   docks to the bottom of the app shell. Before the first CLI event: rings on, badges `—`,
   one shimmer row `waiting for the CLI to start streaming…`.
6. **Watch.** Timeline streams rows (`00:04 ⚙ Read CLAUDE.md +1.2k`). The command badge ticks up
   (`12.4k · ~$0.09`). On Task dispatch: the `/analyze → ba` edge flows (dash animation), `ba`
   lights with its own badge; the command badge shows the **roll-up** (own + Σ agents — the locked
   130k/30k rule). Badge hover → 4-way breakdown card (own / +agents / total columns). Node click
   filters the feed to that actor; feed row click pulses the node.
7. **Settle.** `ba` finishes: pulse stops → one 300 ms "lock-in" flash → steady outline + frozen
   count. Edge flow stops, stays tinted until run end.
8. **Completion.** Rings resolve to steady `success`; run bar flips to
   `✓ FINISHED · 4m 12s · 142.3k tok · ~$0.61`; timeline auto-morphs into the **Summary** (status,
   duration, per-node cost table, files changed via git, final message) unless the user is
   mid-scroll. Toast fires (with `[View summary]` action) if the graph isn't on screen.
9. **Close** exits mission mode; graph returns to authoring. The graph toolbar now shows
   `🕘 runs 1` — history has silently begun to exist.

### 1B. Advanced path — 10th run, power user

1. ⌘K → `Execute /analyze` (same dialog). Requirement **pre-filled with the last one, selected**
   — Enter re-runs verbatim, typing replaces. Quiet hint: `Last run: ✓ 3m 58s · ~$0.52 · yesterday`.
2. No ack block; the standing consent line + `[change]` link remain.
3. Executes, navigates elsewhere; the bottom run bar keeps live tickers
   (`◉ /analyze · my-service · 01:22 · 38.2k · ~$0.42 [View] [■]`). F5 → reattach in ≤1 s
   (§3.10). On completion checks COST BY NODE, sees `ba` burned 60 % of the budget, opens 🕘
   history to scan the last runs' cost column, goes to tighten `ba`'s prompt —
   Author → Launch → Watch → **Learn** loop closed.

---

## 2. Screen Inventory

No new routes, no new top-level screens. Everything is a dialog, an overlay state, or a section
on existing surfaces.

| # | Surface | Type | Entry trigger | Exit path | Phase |
|---|---------|------|---------------|-----------|-------|
| R1 | Execute affordance (node `⋯` menu, ⌘K) | menu items | hover command node / ⌘K | pick / Esc | P1 |
| R2 | RunDialog — compose + preflight + consent + confirm (one dialog, never a wizard) | modal | R1 · "Run again" | Execute → R3 · Cancel/Esc · `Publish first` → publish flow | P1 |
| R2a | First-run acknowledgment variant | state of R2 | first run in project (or settings changed) | tick → normal R2 | P1 |
| R2b | Preflight blocked / warn variants | states of R2 | preflight result | fix action or Cancel | P1 |
| R3 | Mission mode — graph overlay + status strip + timeline panel | overlay on graph tab | run starts · run-bar `[View]` · reattach | terminal + Close · navigate away (bar persists) | P1 glow / P2 full |
| R4 | Run bar (bottom dock, app-wide) | docked bar | active run (any screen), terminal until dismissed | dismiss (terminal only) | P1 |
| R5 | Post-run summary | panel morph inside R3's panel + toast | terminal state · `[Summary]` | `[Feed]` toggles back · Close | P2 (git delta; status-only in P1) |
| R6 | Run history popover + read-only past-run overlay | popover + overlay | 🕘 toolbar icon (hidden at 0 runs) | Esc / Exit history | P3 |
| R7 | Settings → Execution section | settings section | Settings nav · `[change]` in R2 · `[Adjust ceilings]` in ER-7 | Save/back | P1 (mode) / P2 (ceilings UI) |
| R8 | Reattach-after-F5 sequence | transient states | page load with active run | → R3 | P3 |

---

## 3. ASCII Wireframes

Token legend: `command` #818cf8 · `agent` #a78bfa · `success` #4ade80 · `warning` #fbbf24 ·
`danger` #f87171 · run-active = pending Open Q1 (drawn as cyan) · panels `bg-panel`/`bg-menu`.

### 3.1 R1 — Command node `⋯` menu

```
        ┌─────────────┐ ⋯
        │⌘ /analyze   │┌──────────────────────┐
        └─────────────┘│ ▶ Execute…           │  ← NEW, top slot (primary intent)
                       │ ✎ Edit               │
                       │ ⧉ Copy run command   │  ← untouched zero-trust fallback
                       │ 🗑 Delete             │
                       └──────────────────────┘
```
- Daemon disconnected → disabled + tooltip "Daemon offline" (same gating as Delete).
- Active run in this project → disabled + tooltip "A run is already active — [View]" (ER-9:
  prevention before error). Draft command → enabled; the dialog blocks with the Publish path
  (teaches what's needed rather than hiding the goal).

### 3.2 R2 — RunDialog, happy path (returning user — the L0 minimum)

```
┌────────────────────────────────────────────────────────────┐
│  Execute /analyze — my-service                         [×] │
├────────────────────────────────────────────────────────────┤
│  Requirement ($ARGUMENTS)                                   │
│  ( Add rate limiting to the public API                  )   │  ← autofocus; pre-filled w/ last
│  ▸ Model override (optional)                                │  ← collapsed disclosure (L2)
│                                                             │
│  Will run                                                   │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ $ claude -p "/analyze Add rate limiting to the public │ │  ← exact argv echo, bg-code,
│  │   API" --output-format stream-json                    │ │    mono; cwd shown
│  │   (cwd: ~/code/my-service)                            │ │
│  └───────────────────────────────────────────────────────┘ │
│  Last run: ✓ 3m 58s · ~$0.52 · yesterday                    │  ← only when history exists (L3)
│                                                             │
│  Preflight                                                  │
│   ✓ claude CLI 2.1.4 · authenticated                        │  ← rows render as checks resolve
│   ✓ /analyze published (v0.3.0, in sync)                    │    (skeleton "· checking…" ≤300ms)
│   ✓ agents ba, architect published                          │
│   ✓ git tree clean                                          │
│                                                             │
│  ⓘ Runs in ~/code/my-service · mode acceptEdits — the       │
│    agent may create and modify files there. Symbion's       │
│    diff-preview does NOT apply to the agent's writes.       │  ← consent copy is verbatim-stable
│    Ceilings: 30 min · 200k tokens.              [change]    │    across all surfaces (NFR-S)
│                                                             │
│                          [ Cancel ]      [ ▶ Execute  ⌘↵ ] │
└────────────────────────────────────────────────────────────┘
```
Execute enabled ⇔ requirement non-empty AND no blocking preflight ✗ AND (ack ticked, if shown).
The permission line is plain text, not warning-colored — disclosure, not alarm.

### 3.3 R2a / R2b — first-run ack · blocked · warn variants (state swaps, same dialog)

```
FIRST RUN (ack block above footer):            BLOCKED — draft (AC-RUN-13):
│ ┌─────────────────────────────────────┐ │    │ Preflight                              │
│ │ ⚠ FIRST RUN IN THIS PROJECT         │ │    │  ✗ /analyze is a DRAFT — nothing on    │
│ │ Symbion will launch an AI agent in  │ │    │    disk to run.   [ Publish first → ] │
│ │ ~/code/my-service. With mode        │ │    │  ✓ claude CLI 2.1.4 · authenticated    │
│ │ "acceptEdits" it can create and     │ │    │        [ Cancel ]  [ ▶ Execute ] (off) │
│ │ modify files there without asking.  │ │
│ │ Symbion's diff-preview does NOT     │ │    BLOCKED — ER-1 / ER-2:
│ │ apply to what the agent writes.     │ │    │  ✗ Claude Code CLI not found.          │
│ │ You can cancel the run at any time. │ │    │    [ Install instructions ] [ Re-check]│
│ │ [ ] I understand the agent may      │ │    │  ✗ CLI not signed in — run             │
│ │     modify files in ~/code/…        │ │    │    `claude login`, then  [ Re-check ]  │
│ └─────────────────────────────────────┘ │
│      [ Cancel ]  [ ▶ Execute ] (off     │    WARN-AND-ALLOW — conflict / dirty / ER-8:
│                   until ticked)         │    │  ⚠ /analyze differs on disk (hand-     │
                                               │    edited) — the ON-DISK version runs. │
Rule: blockers = danger ✗ + disabled           │  ⚠ git tree has 4 uncommitted changes  │
Execute + ONE recovery action.                 │    — rollback impossible; post-run     │
Warnings = amber ⚠, Execute stays              │    diff will be noisy.                 │
enabled, relabeled "Execute anyway".           │  ⚠ agent "ship" not published —        │
                                               │    dispatch may fail mid-run.          │
                                               │      [ Cancel ]  [ ▶ Execute anyway ]  │
```

### 3.4 R3 — Mission mode (the hero screen, P2)

```
┌ my-service ── Graph ─────────────────────────────────────────────────────────────────────────┐
│ ◉ RUNNING  /analyze — "Add rate limiting…"          ⏱ 02:14        [⛶ expand]  [ ■ Cancel ] │ ← status strip
├──────────────────────────────────────────────────┬───────────────────────────────────────────┤
│                                                  │ TIMELINE                    ⏷ live ● [≡ Raw]│
│         ╭╌╌ run-active ring, pulsing             │ filter: [All] [/analyze] [ba]              │
│  ┏━━━━━━━━━━━━━━━━━━━━┓                          │ ─────────────────────────────────────────  │
│  ┃ ⚡ /analyze         ┃ ≋≋≋≋≋≋▶ ┌─────────────┐ │ 00:02 ⚙ init session · sonnet               │
│  ┃ 130.0k tok · $0.58 ┃  flowing │ ◉ ba        │ │ 00:04 ⚙ Read CLAUDE.md            +1.2k    │
│  ┗━━━━━━━━━━━━━━━━━━━━┛  dashes  │ 30.0k·$0.11 │ │ 00:05 ⚙ Grep "STATE"              +0.8k    │
│    ▲ roll-up: own 100k           └─────────────┘ │ ┌─ dispatch ────────────────────────────┐  │
│      + ba 30k = 130k                 settled: ✓  │ │ 00:41 🤖 Task → ba "requirements pass" │  │ ← lifecycle card,
│                                      frozen count│ └────────────────────────────────────────┘  │   violet rail
│                          ≋≋≋≋≋▶ ┌──────────────┐ │ 00:43 ⚙ Read (ba) src/api.ts      +3.0k    │ ← actor-suffixed,
│                                 │ ◉ architect ⟳│ │ 01:12 ✓ ba settled            Σ 30.0k      │   2-space indent
│                                 │ 12.4k·$0.06  │ │ 01:14 🤖 Task → architect                  │
│                                 └──────────────┘ │ 02:03 ⚙ Grep (architect)          +1.1k    │
│                                     working:     │ ▼ following            [⏸ pause]           │
│  ┌ · · · · · · · ┐  ┌ · · · · · · ┐  ring pulse  │                                            │
│  │ /build        │  │ code-review │              │  (virtualized; one-line rows,              │
│  └ · · · · · · · ┘  └ · · · · · · ┘  ← dim 35%,  │   click row to expand — L2)                │
│  ⓘ legend [fit⤢][−][+]        🕘 runs 12         │                                            │
├──────────────────────────────────────────────────┴───────────────────────────────────────────┤
│ ◉ RUNNING /analyze · my-service │ 02:14 │ 142.3k tok ▲ ~$0.61 │        [ View ]  [ ■ Cancel ] │ ← run bar hides
└───────────────────────────────────────────────────────────────────────────────────────────────┘   when graph visible
```
- Canvas stays 480 px; `⛶ expand` grows it to viewport height (reverses on exit).
- All authoring affordances suspend during the run; resume the moment the overlay closes.
- Participants = executed command + reachable agents. Everything else 35 % opacity, no hover.
- Node click → filter chip in the panel (`ba ✕`); feed-row click → one-shot node pulse.
- Read-only history reopen = this exact frame, frozen (banner per §3.9, no Cancel, feed from event 0).

### 3.5 Node & edge state anatomy (spec)

```
COMMAND NODE (indigo base, unchanged)
 idle-participant   ┌ /analyze ────────────┐  full opacity, no ring, badge hidden
 starting           ┃ ⚡ /analyze ⟳        ┃  ring fades in, low-intensity glow (instant feedback
                                             even while the CLI cold-starts 2–3 s)
 active             ┃ ⚡ /analyze          ┃  ring PULSES (~1.6s box-shadow loop 0→6px)
                    ┃ 130.0k tok · $0.58   ┃  badge line: mono 11px tabular-nums, fixed width
 done               ┌ ✓ /analyze ─────────┐   static 2px success ring, count frozen
 error              ┌ ✗ /analyze ─────────┐   static 2px danger ring
 cancelled          ┌ ◼ /analyze ─────────┐   static ring text-muted (neutral — user did this
                                              on purpose, not an alarm)
AGENT NODE (violet base, unchanged)
 participant, not yet dispatched:  full opacity, badge `— tok` faint
 dispatched→working ┃ ◉ ba ⟳ 12.4k · $0.06 ┃  ring pulse, badge counts up
 settled            ┌ ✓ ba   30.0k · $0.11 ┐  pulse → one 300ms "lock-in" flash → steady
                                              outline + frozen count
 error              ✗ danger ring; the command keeps running unless the CLI aborts

EDGE (command → agent)
 pre-dispatch  ── thin, authoring color (unchanged)
 flowing       ≋≋▶ run-active, dash 6/4, dashoffset loop ~600ms, width 2.5
 live ×N       edge count badge becomes a live counter `1/3 → 2/3 → ✓3` (authored count is
               intent; actuals come from telemetry and may differ — actuals win)
 settled       flow stops, stroke stays tinted 60% until run end
```

Badge formula everywhere (locked §6.6): **fresh tokens (input+output, cache-read excluded)** +
`~$` with cache priced in. `k` under 1M with one decimal (`42.3k`); `—` before first usage event.

### 3.6 Token breakdown hover card (any badge: node, run bar, summary rows)

```
                 ┌──────────────────────────────────────────┐
                 │ /analyze — token usage        LIVE ⟳     │
                 │            own        + agents    total  │
                 │ input      38.1k      11.2k       49.3k  │
                 │ output     61.9k      18.8k       80.7k  │
                 │ ─────────────────────────────────────────│
                 │ fresh     100.0k      30.0k      130.0k  │ ← headline row, bold
                 │ cache read   1.21M    204k        1.41M  │ ← muted; cache detail lives
                 │ cache write  88.2k    31.0k      119.2k  │   ONLY here (locked)
                 │ cost                            ~$0.58   │
                 │ Headline counts fresh tokens only; cache │
                 │ traffic is included in the $ cost.       │
                 └──────────────────────────────────────────┘
```
Agent-node variant drops the `+ agents` column. Appears after 150 ms hover; values update live.

### 3.7 R4 — Run bar (bottom dock, app-wide)

```
Visible on any screen while a run is active AND its graph isn't on screen; also terminal-until-dismissed:
│ ◉ RUNNING  /analyze · my-service │ 02:14 │ 142.3k tok ▲ ~$0.61 │ [ View ]  [ ■ Cancel ]      │
│ ✓ FINISHED /analyze · my-service · 4m 12s · ~$0.61 │ [ View summary ] [ ✕ ]                  │
│ ✗ FAILED (exit 1) /analyze · my-service            │ [ Details ] [ ✕ ]                       │
│ ◐ CANCELLING… /analyze · sending SIGTERM…          │ (controls locked)                       │
```
- ~40 px, `bg-menu`, hairline top border. Status dot pulses; elapsed ticks 1 s; ticker tweens;
  `▲` flashes on delta. Active bar cannot be dismissed — it IS the reattach handle.
- `[■ Cancel]` here uses the same inline two-step as the status strip (§3.8).
- Sidebar project row gets a 6 px pulsing `●` while its run is active (cross-project awareness —
  1 run *per project*; other projects may run in parallel).
- ER-9 raced RPC (affordances were disabled but a raw call slipped through): toast
  `A run is already active — 1 per project [Open mission view]`; the dialog never opens.

### 3.8 Cancel flow (inline two-step — no modal, mission control stays visible)

```
1  [ ■ Cancel ]              → click
2  Stop this run? Files already written stay written.   [ Stop run ] [ Keep running ]
                              ← danger-filled; 5s auto-revert or click-away reverts
3  ◐ CANCELLING… sending SIGTERM…   (SIGTERM→SIGKILL ≤5s; controls locked;
                                     active rings switch to amber pulse;
                                     timeline row `◼ cancel requested`)
4a ◼ CANCELLED · 2m 31s · 98.2k tok · ~$0.44   [ Summary ] [ Dismiss ]     ← neutral, not red
4b ER-6: ⚠ Process not confirmed dead — PID 43210 may still be running.
         Check manually: `kill -9 43210`  [ ⧉ copy ]   [ Dismiss ]         ← danger, sticky;
                                                                              never claim dead while alive
```

### 3.9 R5 — Post-run summary (panel morph; graph keeps the final tableau until Close)

```
│ ┌ SUMMARY ── ✓ completed ──────────────── [Feed] ┐│  ← tab back to full timeline (L2)
│ │ /analyze — "Add rate limiting to the API…"      ││
│ │ 4m 12s · finished 14:32 · exit 0                ││
│ │ ────────────────────────────────────────────────││
│ │ COST BY NODE              own      total     $  ││
│ │  /analyze          ✓   100.0k    130.0k   0.47  ││ ← rows hoverable → §3.6 card;
│ │  ba                ✓    30.0k     30.0k   0.11  ││   hover also pulses the node
│ │  architect         ✓    12.4k     12.4k   0.06  ││
│ │  ⚠ unrecognized subagent 2.1k        —      —   ││ ← unattributable bucket, flagged
│ │  total                       142.3k tok · ~$0.61││ ← total == Σ rows (AC-RUN-2 visible)
│ │ ────────────────────────────────────────────────││
│ │ FILES CHANGED (git)                             ││
│ │  M src/api/rate-limit.ts          +142 −3       ││
│ │  A docs/loops/rate-limit-STATE.md               ││
│ │  ⚠ includes 3 files dirty before the run        ││ ← only if pre-run tree was dirty
│ │  (agent's writes, not Symbion's — review        ││
│ │   before you commit)                            ││
│ │ ────────────────────────────────────────────────││
│ │ FINAL MESSAGE                        [expand ▾] ││
│ │  "Analysis complete. Wrote STATE with 3…"  [⧉]  ││
│ │                                                 ││
│ │ [ ▶ Run again ]              [ Close ]          ││ ← Run again reopens R2 prefilled
│ └─────────────────────────────────────────────────┘│
```
- Failed: header `✗ FAILED — exit 1` danger + `STDERR (last 20 lines)` collapsible above FINAL
  MESSAGE (ER-3). Ceiling: `⚠ STOPPED — 30 min ceiling reached` amber + `[Adjust ceilings]`
  (ER-7 → L4 door in context). Cancelled: `◼ CANCELLED at 02:31` neutral.
- Toast fires at terminal state when the graph isn't visible: success 8 s with `[View summary]`,
  failed sticky, cancelled neutral, reattached info 4 s. Toast store gains an action-button slot.

### 3.10 R6 — History (🕘 popover → read-only past-run overlay) + R8 reattach

```
🕘 runs 12 (toolbar; hidden at 0 runs)         past-run overlay:
┌ RUNS — my-service (last 50) ─────────────┐  ┌ 🕘 VIEWING PAST RUN · #38 · Jul 13 14:02 ────┐
│ ◉ running /analyze "rate limit…" just now │  │   ✓ completed · 4m 12s · ~$0.61 · read-only  │
│ ✓ 14:32  /analyze  4m12s  42.3k  $0.61    │  │            [ ▶ Run again ] [ Exit history ]  │
│ ✗ 11:07  /build    12m    98.1k  $1.84    │  ├──────────────────────────────────────────────┤
│ ◼ 10:44  /build    1m      5.0k  $0.12    │  │ graph re-lit at FINAL states (✓ rings, frozen│
│ ✓ yesterday /review 6m    31.2k  $0.38    │  │ badges, no pulse/flow); feed = persisted     │
│ …                                         │  │ events, same filters/expansion; SUMMARY tab. │
│ Runs live in .symbion/runs/ (gitignored). │  │ Banner is warning-tinted — "am I live?" is   │
└───────────────────────────────────────────┘  │ never ambiguous. Missing nodes → ghost chips.│
   one row per run: glyph · command · duration └──────────────────────────────────────────────┘
   · fresh tok · $ · relative time — the power user's cost column. No delete/search in v1.

R8 — reattach after F5:
t=0   load → useRunStore lists runs → active found → run bar `⟳ RECONNECTING…` (dot amber)
t≈1s  mission mode restores with skeleton glow (rings on, badges `—`),
      timeline `⟳ replaying 214 events…` shimmer
t≈2s  getRunEvents{afterSeq:0} folds through core.aggregate → badges fast-forward (300ms
      count-up), feed fills, SSE resumes → toast "Reattached — run still in progress."
ER-10 daemon crashed mid-run → next boot reconciliation → toast (danger) "Run /analyze marked
      failed — daemon restarted."; history row `✗ failed (daemon-restarted)`; partial summary.
```

### 3.11 R7 — Settings → Execution (the L4 shelf, collapsed by default)

```
│  ▾ EXECUTION  (used by ▶ Execute)                     │
│    Permission mode                                    │
│     ○ plan        — read-only, agent proposes only    │   ← mode names/behaviors to be
│     ◉ acceptEdits — edits files freely; unlisted      │     verified against the installed
│                     shell commands still blocked      │     CLI at /plan (STATE §7 debt);
│     ○ bypassPermissions — ⚠ everything allowed        │     layout stands regardless
│       (extra confirm on save; consent line turns ⚠;   │
│        first-run ack re-asked)                        │
│    Allowed tools  [Bash(npm test) ×] [Bash(git *) ×] [+]
│    Ceilings   wall clock ( 30 ) min · tokens ( 200k ) │
│    ⓘ Every run still shows a confirm dialog.          │
```
Reached three ways, all in-context: Settings nav (deliberate) · `[change]` in R2's consent line
(curious) · `[Adjust ceilings]` in an ER-7 summary (motivated). Defaults mean novices never open it.

### 3.12 Error-state matrix (ER-1…ER-10)

Rule of thumb: **blockers = danger ✗ + disabled action + one recovery button · degradations =
amber ⚠ + the run continues · infrastructure = existing DaemonRibbon/toast patterns.** Nothing
invents a new alarm style.

| ER | Failure | Surface | Presentation |
|----|---------|---------|--------------|
| 1 | CLI not installed | R2b preflight | ✗ + copyable install command + `[Re-check]` (reuses `installInstructions` pattern); never a raw ENOENT |
| 2 | CLI not authenticated | R2b preflight | ✗ + `claude login` hint + `[Re-check]` |
| 3 | Non-zero exit | R3/R4/R5 | error rings; bar `✗ FAILED (exit 1)`; summary leads with stderr tail; partial telemetry retained |
| 4 | stream-json parse failure | R3 panel + bar chip | run continues; amber `⚠ telemetry degraded` chip (hover: "counts may be incomplete; raw log kept"); badges freeze at last-good with `≥` prefix; `[≡ Raw]` tab shows raw tail |
| 5 | SSE channel drop | R3 panel + bar | `↻ reconnecting…`; numbers freeze visibly dimmed (never stale-as-live); EventSource auto-reconnect + `getRunEvents{afterSeq}` backfill; >10 s → "polling every 1s — the run is unaffected"; data never lost, only late |
| 6 | Un-killable process | cancel flow 4b | PID + copyable `kill -9`, danger, sticky |
| 7 | Ceiling exceeded | R5 + toast | `⚠ STOPPED — <which ceiling> reached` amber (not red) + `[Adjust ceilings]` |
| 8 | Referenced agent missing/unpublished | R2b preflight (warn) + feed | pre-warned; mid-run dispatch failure → feed row `✗ Task → ship failed — agent not found`, usage rolls to command bucket flagged `unrecognized subagent` |
| 9 | Second Execute in project | R1 + bar | affordances disabled + tooltip; raced RPC → toast + bar flash; dialog never opens |
| 10 | Daemon crash mid-run | reattach path | boot reconciliation → `✗ failed (daemon-restarted)`; if UI open: existing DaemonRibbon + bar `◌ daemon disconnected`; never a zombie "running" |

---

## 4. Component Breakdown

### Reused (shadcn / existing — `apps/web/src/components/ui/`)

`Dialog`/`DialogHeader`/`DialogFooter` (R2) · `Button` · `Input` (requirement, model w/ datalist,
ceilings) · `Checkbox` (ack) · `Tooltip` (disabled reasons) · `Badge` (status/degraded chips) ·
`Toast` via `useArtifactStore.showToast` (+ optional action slot) · `NodeMenu`/`RowMenu` ·
`AnimatedEdge` (extended) · `GraphToolbar` (+🕘).

### New components (contracts only — no implementation)

| Component | Location | Props / contract |
|---|---|---|
| `RunDialog` | `components/run/RunDialog.tsx` | `{ command: CanonicalArtifact; project: Project; onClose(); onStarted(runId) }`. Consumes `preflight` RPC: `{ checks: PreflightCheck[]; blocked: boolean; needsFirstRunAck: boolean; invocationEcho: string; permissionSummary: { mode; cwd; ceilings }; lastRun?: { status; durationMs; costUsd; endedAt } }` where `PreflightCheck = { id; severity: "ok"\|"warn"\|"block"; label; action?: { label; kind: "publish"\|"install"\|"recheck"\|"settings" } }`. Execute enabled ⇔ req non-empty ∧ no block ∧ (ack ∨ !needsAck). Calls `startRun` with the UI-issued nonce (locked §6.4). |
| `PreflightStrip` | inside RunDialog | `{ result: PreflightResult \| "loading" }` — compact green line when all-✓, warn stack, block rows with actions |
| `MissionStatusStrip` | `components/run/MissionStatusStrip.tsx` | `{ run: RunView; onCancel(); cancelPhase: "idle"\|"confirm"\|"cancelling"\|"forced"; onExpand() }` |
| `RunBar` | app shell | `{ snapshot: RunView \| null; onView(); onCancel(); onOpenSummary(); onDismiss() }` — hidden when the run's own graph is on screen; cancel two-step internal. `RunView = { runId; command; project; status: "starting"\|"running"\|"cancelling"\|"completed"\|"failed"\|"cancelled"\|"timedOut"; elapsedMs; freshTokens; costUsd; degraded: boolean; connection: "live"\|"reconnecting"\|"polling" }` |
| `RunTimelinePanel` | `components/run/RunTimelinePanel.tsx` | `{ rows: TimelineRow[]; mode: "feed"\|"raw"\|"summary"\|"history"; summary?: RunSummary; filterNodeId: string\|null; onFilter(id\|null); onRowHover/onRowClick(nodeId); following: boolean; onToggleFollow(); degraded: { parseErrors: number } \| null }` — virtualized; `TimelineRow = { seq; atMs; icon; label; actor?: string; tokenDelta?; depth: 0\|1; expandable?: { tool; input; stepTokens }; raw?: boolean; unattributed?: boolean }` |
| `RunSummarySection` | same panel slot | `RunSummary = { status; exitCode?; durationMs; startedAt; totals: FourWay & { fresh; costUsd }; perNode: { nodeId\|null; label; status; ownFresh; totalFresh; costUsd; breakdown: FourWay; unrecognized?: boolean }[]; filesChanged: { path; status: "A"\|"M"\|"D"; plus?; minus?; preDirty?: boolean }[] \| "unavailable"; finalMessage?: string; stderrTail?: string; stopReason?: "wallClock"\|"tokenCap" }` + `{ onRerun(); onViewFeed(); onClose() }` |
| `NodeTokenBadge` | `components/graph/NodeTokenBadge.tsx` | `{ fresh: number; costUsd: number; breakdown: FourWay & { agents?: FourWay }; live: boolean; degraded?: boolean }` — tabular-nums mono 11px, width reserved from first render; tween ≤300 ms rAF-coalesced; `—` pre-first-event. `FourWay = { input; output; cacheRead; cacheWrite }` |
| `TokenBreakdownCard` | hover portal | `{ label; live: boolean; own: FourWay; agents?: FourWay; costUsd }` |
| `RunHistoryPopover` | toolbar anchor | `{ runs: RunListItem[]; activeRunId?; onSelect(runId); }` — lazy `listRuns` on open |
| `PastRunBanner` | over mission chrome | `{ run; onExit(); onRerun() }` |
| `RunSettingsSection` | Settings | `{ config: ProjectRunConfig; onChange }` — extra confirm on `bypassPermissions` |
| `useRunStore` | `lib/run/useRunStore.ts` (zustand, mirrors `useArtifactStore`) | `{ activeRun?: RunView; nodeRunData: Map<nodeId, { runStatus; ownFresh; totalFresh; costUsd; breakdown }>; timeline: TimelineRow[]; summary?: RunSummary; connection; degraded; historyRunId?; hoveredRunNodeId?; pulseNodeId? }` + `{ startRun(input)→runId; cancelRun(); attach(runId) (SSE + afterSeq replay); openHistoryRun(id); exitHistory(); dismiss() }`. **All numbers come from `core.aggregate` — the store never does token math** (same reducer as the daemon; UI and persisted numbers cannot drift). F5-reattach owner: on mount, `listRuns` → auto-attach if active. |

### Existing components — additive changes only (interactive-graph P1–P8 untouched outside a run)

```
CommandNodeData += { runStatus?: "idle"|"starting"|"active"|"done"|"error"|"cancelled";
                     runParticipant?: boolean;            // false → 35% dim, no hover
                     badge?: NodeTokenBadgeProps;          // roll-up totals for commands
                     onExecute?: () => void; executeDisabledReason?: string;
                     runPulseKey?: number }                // feed-row click → one-shot pulse
AgentNodeData   += { runStatus?: "idle"|"working"|"settled"|"error"; runParticipant?: boolean;
                     badge?: NodeTokenBadgeProps;
                     invocations?: { done: number; total?: number }; runPulseKey?: number }
AnimatedEdgeData+= { runFlow?: "off"|"flowing"|"settled" }
```
- `DependencyGraph.tsx` stays derivation-only: merges `useRunStore` selectors into the existing
  node/edge `data` memo (nodes remain a pure function of `artifacts + runSnapshot`); suspends
  authoring handlers while `activeRun || historyRunId`; mounts `MissionStatusStrip` +
  `RunTimelinePanel` inside the existing 480 px container; toolbar gains 🕘.
- `ProjectView` / app shell: mounts `RunBar`; sidebar row run-dot.

---

## 5. Interaction Notes

**Motion & glow** — Mission enter/exit: ~300–400 ms `cubic-bezier(.2,.8,.2,1)` (matches existing
`slideIn`); dim fade 150 ms; authoring re-enables only after the exit transition completes. Pulse
= looping ~1.6–2 s box-shadow keyframe (same technique as the existing one-shot `pulse`);
done/error/cancelled = static rings (reuses the `justAdded` box-shadow slot — never co-occur since
authoring is suspended). Settle "lock-in": one 300 ms brighter flash when a count freezes. Edge
flow: `stroke-dasharray 6/4` + `dashoffset` linear loop ~600 ms. **All animations collapse to
state swaps under `prefers-reduced-motion`** (join the existing globals.css block).

**Numbers** — Store coalesces SSE bursts; UI renders ≤4×/s (coalesce **rendering, never data** —
NFR). Badge value changes tween ≤300 ms via rAF; no counting-up theatrics elsewhere. Every $ is
`~`-prefixed (estimate caveat). Fixed badge width from first render — nodes never resize mid-run.

**Timeline** — Auto-follows tail; manual scroll pauses (`▼ following` → `⏸ paused` + `↓ N new`
chip; click resumes — no scroll hijack). Row grammar: `time · glyph · label (actor) · +Δtok`;
subagent rows = actor suffix + 2-space indent under their dispatch card (hierarchy without a tree
widget). Dispatch rows render as bordered mini-cards with a violet rail. Row click expands (L2):
tool, agent, started/elapsed, step tokens (in/out), truncated input + `[copy]`. `[≡ Raw]` = raw
NDJSON tail, last 200 lines + `[⧉ copy]` (this IS the P1 panel; P2 demotes it to a tab and ER-4's
fallback).

**Preflight** — checks run in parallel on dialog open; rows appear individually (150 ms stagger)
as `⟳` → ✓/⚠/✗; skeleton text ≤300 ms, spinner only if slower; Execute never optimistic.

**Execute** — button → `⟳ Starting…`; on reject: inline error in the dialog footer (dialog stays
open — no toast-only failure). `starting` state: strip shows `◌ STARTING…` shimmer + low-intensity
node glow so feedback is instant during CLI cold-start.

**Terminal transition** — glow → ring swap; timeline auto-morphs to Summary unless the user is
mid-scroll (then deferred until they touch the run bar); bar flips color + controls; toast if the
graph isn't visible.

**Keyboard** — R2: ⌘↵ Execute, Esc close. Mission mode: Esc collapses/expands the panel — **Esc
never cancels a run** (destructive = click-only). ⌘K: `Execute /<name>…` per published command +
`Run history`. Executing from ⌘K on another tab auto-switches to the Graph tab (mission mode is
the feature's identity).

**Concurrency gating** — while a run is active in a project, every Execute affordance (node menu,
⌘K) renders disabled with the same tooltip — one rule, everywhere.

**Consent copy is verbatim-stable** — the permission sentence in R2 is the single source of the
"Symbion's diff-preview does not cover the agent's writes" disclosure; generated from `runConfig`,
never hardcoded per-surface, never paraphrased.

**Empty states** — 🕘 hidden at 0 runs (absence is the cleanest empty state; installs itself after
run #1). Feed pre-first-event: shimmer row. `Last run:` line simply absent without history.
History popover empty copy: `No runs yet — hit ▶ Execute on a command node.`

---

## 6. Open Design Questions — ALL RESOLVED (user, 2026-07-14)

1. **Run-active color → cyan `#22d3ee` under a new `run-active` token name.** Reuses the hex
   (best contrast on indigo/violet nodes); the semantic collision with `skill` is a naming
   problem, not a visual one. Unblocks P1.
2. **Elapsed time on the running node → OUT.** Badge stays tokens+$ only; elapsed lives in the
   status strip + run bar.
3. **"Last run: ✓ 3m 58s · ~$0.52" hint in R2 → IN for v1.** Single fact, no comparison UI
   (comparison proper stays v2).
4. **Mission-mode height → 480 px + `⛶ expand` toggle** (no auto-expand).
5. **First-run ack → re-asked when permission mode/allowed-tools change.** Consent is tied to
   what was consented to.

## Future Ideas (explicitly OUT of v1 — parked so they don't creep)

Replay scrubber over `events.jsonl` · run-vs-run cost comparison (runs tagged with artifact
version) · budget soft-cap banner · desktop notifications · STATE.md-aware semantic progress ·
per-step diff preview of agent writes · canvas→feed reverse highlight · manual history delete ·
list-row Execute entry · pipeline chaining.

---

## 7. Design System — proposal only (no root `DESIGN.md` exists; do not apply)

Seeded strictly from tokens these wireframes use; `tailwind.config.ts` incumbents unchanged.

```diff
 colors:
+  run-active: "#22d3ee"                    # pulsing ring, edge flow, live dots (resolved Q1 —
+                                           # same hex as `skill`, distinct token name)
+  run-active-soft: "rgba(34,211,238,.18)"  # glow halo
+  # done/error/warn reuse success/danger/warning — aliases, no new hues
 typography:
+  ticker: "mono, 11px, 500, tabular-nums"  # badges, strip, bar — digits never jitter
 boxShadow:
+  glow-run:  "0 0 0 4px <run-active-soft>, 0 0 14px 2px <run-active-soft>"  # looping pulse
+  ring-done: "0 0 0 2px #4ade80" · ring-error: "0 0 0 2px #f87171" · ring-neutral (cancelled)
 keyframes:
+  glowPulse (looping ring) · dashFlow (edge current) · countLockIn (settle flash)
 components:
+  RunBar: { surface: bg-menu, height: 40, border-top: hairline }
+  StatusGlyphs: running "◉/⚡" (pulsing) · connecting "◌" · completed "✓" · failed "✗" ·
+                cancelled/stopped "◼" (text-muted)
 do/don't:
+  run telemetry never reuses success/warning/danger semantics for LIVENESS (only for outcomes)
+  tickers always tabular-nums mono · coalesce rendering ≤4/s, never drop data
+  all run animations collapse under prefers-reduced-motion
+  cache tokens never appear in a headline number — hover-only, priced into $
```

---

## 8. Next step

**→ `/plan`** — architect reads this doc alongside `graph-execution-realtime-STATE.md` §6 and
resolves the STATE §7 verification debts first (exact stream-json schema + parent-tool-use-id
field on the installed CLI, slash-command behavior in `-p` mode, CLI permission-mode names for R7
copy). All design taste questions are resolved (§6). **`/cso` remains mandatory before build.**
