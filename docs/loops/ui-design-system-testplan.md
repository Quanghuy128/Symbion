# ui-design-system — Test plan

Design: `docs/loops/ui-design-system-STATE.md` §6 (PLAN). Source of truth for visuals: `docs/design-system/`.
Scope reminder: presentation only — no daemon/core/RPC/store change. Every phase must leave the build and `npm run test:web` green.

---

## 0. Baseline (before P1, on the branch tip)

| ID | Step | Record |
|---|---|---|
| B-1 | `npm run build` | pass/fail |
| B-2 | `npm test` (core + daemon + web) | pass count per project |
| B-3 | `npm run test:e2e` | pass/fail **per spec + per test** — e2e may already be stale (e.g. `getByText("·draft")`); only regressions vs this baseline count |
| B-4 | Run every grep in §2 and save the hit counts | proves the gates move from N → 0 |
| B-5 | chrome-devtools screenshots of the journey screens in §4 (before) | visual diff reference |

---

## 1. Build / type / unit gates (run after **every** phase)

```bash
npm run build                          # all workspaces; apps/web = next build + static export
npx tsc --noEmit -p apps/web           # typecheck (lint is not runnable: no ESLint config in apps/web — see STATE F-16)
npm run test:web                       # web Vitest (jsdom)
npm test                               # core + daemon + web (proves no collateral change)
git diff --stat master -- apps/daemon packages   # MUST be empty
```

### 1.1 New unit tests (Vitest, `apps/web/src/**`)

**`lib/utils.test.ts` (P1)**
| ID | Case | Expect |
|---|---|---|
| U-U1a | `cn("text-caption", "text-ink-muted")` | contains both |
| U-U1b | `cn("text-ui", "text-label")` | `"text-label"` only |
| U-U1c | `cn("rounded-md", "rounded-pill")` | `"rounded-pill"` only |
| U-U1d | `cn("shadow-menu", "shadow-dialog")` | `"shadow-dialog"` only |
| U-U1e | `cn("z-dialog", "z-toast")` | `"z-toast"` only |
| U-U1f | `cn("text-code-sm", "text-running")` | contains both |

**`designTokens.test.ts` (P1)** — reads `docs/design-system/tokens.json`, `apps/web/src/app/globals.css`, imports `apps/web/tailwind.config.ts`
| ID | Case | Expect |
|---|---|---|
| U-T1 | every colour token in tokens.json | `--<name>: <dark value>` inside `:root` and `--<name>: <light value>` inside `[data-theme="light"]` (whitespace-insensitive compare) |
| U-T2 | every shadow token | `--shadow-<name>` defined in both blocks |
| U-T3 | every `var(--x)` referenced by tailwind config colours/boxShadow | `--x` is defined in `:root` |
| U-T4 | fontSize keys | exactly the 11 DS names with px/lineHeight/weight/letterSpacing equal to tokens.json (P6: no other keys) |
| U-T5 | zIndex / borderRadius | values equal tokens.json (`rail 10 … toast 70`; `xs 6 … pill 999px`) |
| U-T6 | `globals.css` | no `--background:`/`--foreground:`/`--muted:` RGB-triplet vars; contains `color-scheme: dark` |

**`designSystemGuard.test.ts`** — walks `apps/web/src/**/*.{ts,tsx}` (skip `*.test.*`), same walker pattern as `agentRunParityGuard.test.ts`; forbidden tokens assembled at runtime so the file never matches itself
| ID | Rule (regex) | Active from |
|---|---|---|
| U-G1 | `\b(text|bg|border)-(green|amber|red|yellow|blue|indigo|violet|cyan|gray|slate|zinc)-\d{2,3}\b` | P1 |
| U-G2 | `\b(bg|text|border|ring|outline|fill|stroke|from|to|via|divide|placeholder)-(app|sidebar|deep|surface|line|ink|mint|workflow|agent|skill|running|success|warning|danger|diff|overlay|graph-dot|on-mint|on-danger|focus-ring)(-[a-z0-9]+)?\/` (opacity modifier on a token colour) | P1 |
| U-G3 | `text-\[\d` and `tracking-\[` | P6 (P4/P5 per touched file) |
| U-G4 | `#[0-9a-fA-F]{3,8}\b` inside a `.tsx` **outside comments** and `rgba?\(` in `.tsx` | P6 (graph files from P5) |
| U-G5 | `(bg|border|text)-(white|black)(\/|\b)` and `bg-white\/\[` | P6 |
| U-G6 | `\bfont-bold\b`, `\boutline-none\b`, `\btext-(xs|sm|base|lg|xl|2xl)\b`, legacy class names `\b(bg-bg-|border-border|text-text-|brand-accent|accent-text|command-hi|run-active|overwrite-btn|muted-foreground|text-foreground|bg-background|text-destructive|rounded-(panel|dialog|nav-item)|shadow-(dropdown|drawer|glow-run))` | P6 |
| U-G7 | `from "@/components/ui/status-glyph"` is the only StatusGlyph import path; `run/agents/StatusGlyph` file does not exist | P2 |
| U-G8 | no import of `AppRail`, `rail/NavItem`, `ProjectSidebar`, `AppNav` | P3 |

**`components/ui/primitives.test.tsx` (P2)**
| ID | Case | Expect |
|---|---|---|
| U-P1 | `<Button>` (no variant) and `variant="default"` | className contains `bg-mint` and `text-on-mint` (primary) |
| U-P2 | `variant="destructive"` | same classes as `variant="danger"` (`bg-danger text-on-danger`) |
| U-P3 | `variant="outline"`, `"ghost"`, `"danger-outline"` | `border-line-strong` / `hover:bg-surface-hover` / `border-danger text-danger-text` |
| U-P4 | `disabled` | element `disabled`, visible, className has `disabled:opacity-45`, no `pointer-events-none`, click handler not called |
| U-P5 | `size="sm" | default | lg` | `h-control-sm` / `h-control-md` / `h-control-lg` |
| U-P6 | `icon={Upload}` | an `svg[aria-hidden="true"]` precedes the label; accessible name = label only |
| U-P7 | `<IconButton aria-label="Close" icon={X} />` | `getByRole("button",{name:"Close"})`; hover → tooltip text "Close" after 400ms (fake timers) |
| U-P8 | `<Tabs>` 3 items | `role=tablist`, 3 `role=tab`, `aria-selected` only on value; ArrowRight moves focus + calls `onValueChange`; Home/End; only selected has `tabIndex=0` |
| U-P9 | `<SegmentedControl>` | `role=radiogroup` with `aria-label`; `role=radio` + `aria-checked`; click & arrow keys call `onValueChange` |
| U-P10 | `<Banner tone="danger" title="X">body</Banner>` | `role="alert"`, `<strong>` = "X"; `tone="warning"` → `role="status"` |
| U-P11 | `<Badge variant=…>` for all variants | `draft`/`default` render the neutral classes; `plain` has no dot; text content unchanged |
| U-P12 | `<Kind kind="workflow|agent|skill">` | `bg-workflow-soft text-workflow` etc., svg `aria-hidden` |
| U-P13 | `<Checkbox label="I understand">` | clicking the label toggles; `checked` renders the tick; unchecked border class `border-ink-muted` |
| U-P14 | `<Dialog open>` | `role="dialog"`, `aria-modal="true"`, labelled by `DialogTitle`; scrim has class `fixed` and `bg-overlay`; Escape calls `onClose` |
| U-P15 | `<RowMenu>` | trigger name "Options" (default); open → `role=menu`; Escape closes; danger item has `text-danger-text`; disabled item not selectable |
| U-P16 | Toaster with `variant:"error"` | `role="alert"`; `"success"` → `role="status"`; auto-dismiss at 2200ms unchanged for both |
| U-P17 | `<Field label help error>` + `<Input aria-invalid>` | label `htmlFor` links; error text has `text-danger-text` |

**`components/ui/status-glyph.test.tsx` (P2, moved from `run/agents/primitives.test.tsx`)** — same 10×2 legend loop; expected classes become `text-running`, `text-success`, `text-danger`, `text-ink-faint`, `text-ink-muted`; pulse assertion becomes `animate-livePulse`; glyph characters and `data-pulse` assertions unchanged.

**`components/shell/Sidebar.test.tsx` (P3)** (mock `next/navigation.usePathname`)
| ID | Case | Expect |
|---|---|---|
| U-S1 | pathname `/templates` | the Templates link has `aria-current="page"`; others don't |
| U-S2 | 2 projects in store, one current | both rendered; current has `aria-current="page"`; each has a button named `Remove <name>` |
| U-S3 | click `Remove a` → confirm true | `removeProject("a")` called; success toast (logic unchanged) |
| U-S4 | `matchMedia("(min-width:1100px)")` false | collapsed: labels visually hidden but accessible names intact, no resize separator |
| U-S5 | daemon down | footer text matches `/daemon disconnected/` |

**`lib/codemirror/theme.test.ts` (P5)**
| ID | Case | Expect |
|---|---|---|
| U-C1 | `JSON.stringify(editorThemeSpec)` + highlight spec | no `#[0-9a-f]{3,8}` and no `rgb(`; every colour is `var(--…)` |
| U-C2 | `symbionEditorTheme` | array of CodeMirror extensions (non-empty); `MarkdownTab` / `TemplateMarkdownViewer` source no longer contain `theme="dark"` |

**`components/graph/nodeRings.test.tsx` (P5)**
| ID | Case | Expect |
|---|---|---|
| U-N1 | CommandNode `runStatus:"active"` | root `style.boxShadow` contains `var(--running)`; class `animate-glowPulse` |
| U-N2 | `done` / `error` / `cancelled` / `justAdded` / `highlighted` | `var(--success)` / `var(--danger)` / `var(--line-strong)` / `var(--mint)` / `var(--ink-3)` |
| U-N3 | `dimmed` / `runParticipant:false` | inline `style.opacity === "0.35"` (inline, not class) |
| U-N4 | CommandNode / AgentNode | contain a Kind tile (`bg-workflow-soft` / `bg-agent-soft`); root has class `group` and `h-10` |
| U-N5 | MissingAgentNode | `border-dashed border-line-strong`, inline opacity |
| U-N6 | GraphEdgePath `missing` / `runFlow:"flowing"` / default | stroke `var(--danger)` dashed / `var(--running)` + `animate-dashFlow` / `var(--line-strong)` |

### 1.2 Existing tests that change (expected-token updates only — intent unchanged)

| File | Change | Phase |
|---|---|---|
| `run/agents/primitives.test.tsx` | StatusGlyph block moves to `ui/status-glyph.test.tsx`; LiveDuration block stays | P2 |
| `run/CancelControl.test.tsx` | `"■ Stop run"` → `"Stop run"` (lines 17, 27, 36, 39) | P5 |
| `graph/NodeHandle.test.tsx` | `bg-command` → `bg-workflow`; `border-white/40` → `border-line-strong` | P5 |
| `run/agents/transcript.test.tsx:40` | `text-text-faint` → `text-ink-faint` | P5 |
| `e2e/happy-path.spec.ts` | `"+ New project"` → `page.getByRole("main").getByRole("button",{name:"New project"})`; `"+ Add agent"`/`"+ Add workflow"` → `"Add agent"`/`"Add workflow"`; `"↧ Import existing .claude/"` → `"Import existing .claude/"`; `"Publish ▸"` → `"Publish"` | P4 |
| `e2e/auto-generate-body.spec.ts` | same `New project` / `Add agent` renames | P4 |

Must remain **unchanged and green**: `DaemonStatusBadge.test.tsx`, `CommandNode.test.tsx` (`.group`, `bg-transparent`, "Options", "not linked"), `GraphCanvas.test.tsx` (positions, 160×40 sizing), `graphGeometry.test.ts`, `DependencyGraph.test.tsx`, `DependencyGraph.agents.test.tsx` (incl. `w-[360px]`, `h-[calc(100vh-200px)]`, `style*='opacity'`), `AgentsPanel.test.tsx` (`outline`, "Raw log", "← back", "← Agents"), `AgentTree.test.tsx` (`text-danger`), `RunSummarySection.test.tsx`, `svgLabelNamespace.test.tsx`, `agentRunParityGuard.test.ts`, all core/daemon tests.

---

## 2. Grep gates (run from repo root after P6; all must print nothing / 0)

```bash
# G1 inline hex in tsx (comments excluded by the guard test; this raw grep must be 0 after P6 — comments with hex are rewritten too)
grep -rEn '#[0-9a-fA-F]{6}\b' apps/web/src --include=*.tsx
# G2 arbitrary font sizes / tracking
grep -rEn 'text-\[[0-9]' apps/web/src --include=*.tsx --include=*.ts
grep -rEn 'tracking-\[' apps/web/src --include=*.tsx
# G3 ad-hoc white/black grounds
grep -rEn '(bg|border|text)-(white|black)\b|bg-white/\[' apps/web/src --include=*.tsx
# G4 palette leftovers
grep -rEn '\b(text|bg|border)-(green|amber|red|yellow|blue|indigo|violet|cyan|gray|slate|zinc)-[0-9]' apps/web/src --include=*.tsx
# G5 opacity modifier on a token colour
grep -rEn '\b(bg|text|border|ring|outline|fill|stroke)-(app|sidebar|deep|surface|line|ink|mint|workflow|agent|skill|running|success|warning|danger|diff|overlay)(-[a-z0-9]+)?/' apps/web/src --include=*.tsx
# G6 legacy token names / Tailwind default sizes / bold / outline-none
grep -rEn 'bg-bg-|border-border|text-text-|brand-accent|accent-text|command-hi|run-active|overwrite-btn|muted-foreground|text-foreground|bg-background|rounded-(panel|dialog|nav-item)|shadow-(dropdown|drawer|glow-run)' apps/web/src --include=*.tsx
grep -rEn '\btext-(xs|sm|base|lg|xl|2xl)\b|\bfont-bold\b|\boutline-none\b' apps/web/src --include=*.tsx
# G7 built-in CodeMirror theme gone
grep -rEn 'theme="dark"' apps/web/src
# G8 unicode stand-ins replaced by icons (JSX text only; StatusGlyph chars and in-copy arrows are allowed)
grep -rEn '[＋⤢⧉⟳🕘↳↧⦿☑☐]' apps/web/src --include=*.tsx
# G9 removed shell files
ls apps/web/src/components/AppRail.tsx apps/web/src/components/rail apps/web/src/components/ProjectSidebar.tsx apps/web/src/components/AppNav.tsx apps/web/src/components/run/agents/StatusGlyph.tsx 2>&1 | grep -v 'No such file'
# G10 no third-party design-source references
grep -rniE "inspired by|modell?ed (after|on)|design source" apps/web/src docs/design-system   # review any hit manually
# G11 scope guard
git diff --stat master -- apps/daemon packages
```
G1–G6 are also enforced by `designSystemGuard.test.ts`, so CI catches regressions.

---

## 3. Hermetic QA environment

```bash
npm run build
export QA_ROOT=$(mktemp -d)                          # fresh project folder
export SYMBION_CONFIG_DIR=$(mktemp -d)               # isolated user config (same var the e2e fixture uses)
export SYMBION_CLAUDE_BIN="$PWD/apps/daemon/test/fixtures/fake-claude.mjs"
export FAKE_CLAUDE_FIXTURE="$PWD/apps/daemon/test/fixtures/fixture-agents-synthetic.ndjson"
export FAKE_CLAUDE_DELAY_MS=800                      # ~25 s run, watchable
node apps/daemon/dist/index.js                       # serves the built static web UI; note the printed URL (default 127.0.0.1:12802)
```
- Cancel journey: restart with `FAKE_CLAUDE_DELAY_MS=1500`.
- Error-run journey: restart with `FAKE_CLAUDE_MODE=exit1`.
- Viewports: 1440×900 (expanded sidebar) and 1050×800 (collapsed rail). Also emulate `prefers-reduced-motion: reduce` once (V-9).
- Take a screenshot at every ✱.

---

## 4. chrome-devtools visual journey

### V — global checks (on any screen)
| ID | Check | Expect |
|---|---|---|
| V-1 | `getComputedStyle(document.body)` | background `rgb(21, 23, 28)` (#15171c), color `rgb(236, 238, 243)`, font-family starts with the Instrument Sans next/font family |
| V-2 | a `font-display` heading / a `font-mono` path | Bricolage Grotesque / IBM Plex Mono families resolved; Network shows woff2 served from `/_next/static/media/` (no fonts.googleapis.com request) |
| V-3 | `getComputedStyle(document.documentElement).getPropertyValue('--mint')` | `#3ddc97` |
| V-4 | Tab through the sidebar and a dialog | every focused control shows a 2px mint outline with 2px offset; inputs show mint border + soft halo |
| V-5 | Hover a list row / nav item | fill = `--surface-hover` (#242833), no white overlay |
| V-6 | Console | no errors, no hydration warnings, no React key warnings introduced |
| V-7 | Disabled primary ("Write to disk" with nothing selected) | visible at 45% opacity, `cursor: not-allowed` |
| V-8 | Contrast spot-check with devtools picker | descriptions/metadata ≥ 4.5:1 (ink-muted), unchecked checkbox border ≥ 3:1 |
| V-9 | Reduced motion emulated during a live run | no pulsing glyph, no flowing dashes, no node glow animation; states still visible |

### J-H Home / shell
| ID | Step | Expect |
|---|---|---|
| J-H1 ✱ | Open URL with empty config | Sidebar 288px `bg-sidebar` + 1px `line` edge; Logo (two mint circles + "Symbion"); nav Project / Templates / Settings with lucide icons; "∅ no projects yet"; footer "daemon · connected" in success colour. Main = EmptyState: mint icon tile, "No projects yet", primary "New project", outline "Import existing .claude/" |
| J-H2 ✱ | Resize to 1050px | sidebar collapses to 56px icon rail; hovering an icon shows the inverted Tooltip (ink ground); no resize handle |
| J-H3 | Back to 1440px; drag the sidebar edge | width changes, persists after reload (existing behaviour) |
| J-H4 | Create project (New project → name + `$QA_ROOT` → "✓ Folder exists" → Create project) | dialog: surface panel, radius 20, dialog-title heading, ghost Cancel + one primary; project appears in sidebar with `aria-current` row style |

### J-P Project / builder / publish
| ID | Step | Expect |
|---|---|---|
| J-P1 ✱ | Project view (empty) | page-title project name (Bricolage), mono path in muted; actions: Remove project (danger-outline), List/Graph SegmentedControl, primary Publish with upload icon; empty state: primary "Add workflow" + outline "Add agent" |
| J-P2 ✱ | Add agent `code-reviewer` (tools Read, Grep, body text) → Save; add workflow `analyze` with body referencing `@code-reviewer` and `$ARGUMENTS` → Save | Drawer: overlay scrim, surface panel, dialog-title "Agent builder"; SegmentedControl "By description" / "Theo markdown"; Live preview = CodeBlock well with file icon + `.claude/agents/code-reviewer.md`; Cancel ghost, Save primary. List: hairline rows, Kind tiles (amber slash / blue bot), `/analyze` in mono, neutral "draft" Badge, ⋯ RowMenu (surface + shadow-menu, Delete last in danger-text after a divider) |
| J-P3 ✱ | Theo markdown tab: break the YAML (`name: [`) | CodeMirror uses the token theme (bg-sidebar well, mint selection, `---` in workflow amber); red "✗ … (Save temporarily locked…)" line in danger-text; Save disabled. Fix YAML → "✓ markdown is valid…" in success |
| J-P4 ✱ | Publish → Claude target → Preview changes | Publish dialog heading "Publish"; Version Field; target cards with square-check icons; Preview changes primary. Diff list: Checkbox + mono path + "New" success Badge per file; "Will initialize .claude/" caption; primary lg "Write to disk" |
| J-P5 ✱ | Write to disk | result: success line "created …", `Backup:` mono path, primary "Xong"; files exist under `$QA_ROOT/.claude/` |
| J-P6 ✱ | Re-publish with no changes | every row shows "Unchanged" plain Badge; button reads "Nothing to write" and is disabled (idempotent re-publish unchanged) |
| J-P7 ✱ | **Conflict**: append a line to `$QA_ROOT/.claude/agents/code-reviewer.md` by hand; edit the agent description in Symbion; Publish → Preview | conflict row = danger Banner "CONFLICT — .claude/agents/code-reviewer.md" + "The file was hand-edited after the last publish."; "Keep the on-disk version" shown selected (pressed) by default; "Overwrite" danger-outline. If the conflict file is the only change: "Write to disk" is **disabled**. Choose Overwrite → button becomes danger fill, Write enabled; choose Keep again → disabled again. Write with Keep on a mixed set → the hand-edited file on disk is byte-identical afterwards |
| J-P8 ✱ | **Foreign file**: create a plain `AGENTS.md` (no marker) in `$QA_ROOT`; Publish with Codex target (acknowledge lossy Checkbox) → Preview | warning Banner naming `AGENTS.md` "…will be edited by Symbion for the first time…"; lossy note in warning colour; Codex acknowledgment is a styled Checkbox whose label toggles it |
| J-P9 ✱ | Row ⋯ → Copy run command | dialog with CodeBlock styling; copy works |
| J-P10 | Row ⋯ → Delete → inline confirm | outline Cancel + danger Delete; deletion works; error line (if forced by stopping the daemon first) in danger-text |

### J-G Graph
| ID | Step | Expect |
|---|---|---|
| J-G1 ✱ | Switch to Graph (SegmentedControl) | canvas `bg-deep` with 16px dot grid in `graph-dot`; nodes are surface cards 160×40 with Kind tiles (no solid indigo/violet fills); edges 1.5px `line-strong`; Legend/Toolbar/HintBar use surface + shadow-menu, lucide icons in the toolbar (no ＋ ⤢ ⧉ ⟳ 🕘) |
| J-G2 ✱ | Hover a node | neighbour highlight ring (ink-3) and highlighted edge (mint); ⋯ NodeMenu = same RowMenu styling |
| J-G3 ✱ | Add `@ghost-agent` to the workflow body, save | missing node = dashed line-strong outline, transparent, muted label; inbound edge dashed danger; hover → "Create this agent" action |
| J-G4 ✱ | Reference an agent with backticks only | "not linked" chip is a warning Badge; click opens the drawer (behaviour unchanged) |
| J-G5 | Drag a node, reload | position persisted (unchanged); node not taller than 40px so the edge meets the node's vertical centre |
| J-G6 ✱ | Connect-drag from a handle | ghost line in mint; source handle workflow-coloured; drop on an agent → relation modal (Dialog styling) |
| J-G7 ✱ | Kill the daemon process | DaemonRibbon = Banner with "Daemon disconnected — the graph is read-only." + Retry; sidebar footer shows the disconnected block containing "daemon disconnected"; Save / Publish / Delete / Generate disabled (45% opacity). Restart daemon → recovers |

### J-R Run engine (fake CLI)
| ID | Step | Expect |
|---|---|---|
| J-R1 ✱ | Publish `analyze`; node ⋯ → Execute… → RunDialog → consent → start | RunDialog = Dialog styling, preflight strip with tokens, permission radios styled; one primary |
| J-R2 ✱ | During the run (~25 s) | RunBar docked card (surface, radius 14, shadow-toast, 48px): StatusGlyph ◉ in running colour pulsing, `/analyze` mono, elapsed `tabular-nums`, outline "Stop run" with square icon. Graph: active node ring running + glow; flowing dashed running edges |
| J-R3 ✱ | Open the agents panel | agent tree rows: StatusGlyphs (◌ ◉ ✓ ✗ ○ ◼ · ?) with token colours; focused row outline in focus-ring; transcript rows in code-sm; "Thinking" in ink-faint; Raw log button (IconButton) → raw log on `bg-deep`; "← back" returns |
| J-R4 ✱ | Run completes | glyph ✓ success, pulse stops; RunFinishedStrip / RunOutcomeCard styled; "View summary" → token breakdown card with tabular numbers; node rings success |
| J-R5 ✱ | Restart daemon with `FAKE_CLAUDE_DELAY_MS=1500`; run; Stop run → confirm | inline confirm copy unchanged, danger "Stop run" + outline "Keep running"; "◐ CANCELLING…" in warning; final glyph ◼ ink-faint; cancelled node ring line-strong |
| J-R6 ✱ | Restart with `FAKE_CLAUDE_MODE=exit1`; run | ✗ danger glyph, error ring on node, error Banner/strip readable (danger-text on danger-soft) |
| J-R7 ✱ | Open run history (toolbar history IconButton) and a past run | popover = menu surface; PastRunBanner styled; glyphs do **not** pulse on history |
| J-R8 | ⌘K / Ctrl+K | RunCommandPalette with shadow-menu, z above dialogs |

### J-T Templates
| ID | Step | Expect |
|---|---|---|
| J-T1 ✱ | Templates nav | page-title "Templates"; author Tabs (underline ink on line rule, `role=tablist` "Template authors"); card grid auto-fill ≥300px, line-soft outlines, no shadows |
| J-T2 ✱ | Open a template → preview modal | Dialog; TemplateMarkdownViewer uses the token CodeMirror theme (read-only); license/skipped notices in warning colour (no amber-600); "Copied to clipboard." in success colour |
| J-T3 ✱ | Apply into the QA project | ApplyResultPanel "✓ Applied" in success token; "open project" handoff works (unchanged) |

### J-S Settings
| ID | Step | Expect |
|---|---|---|
| J-S1 ✱ | Settings | page-title "Settings"; "AI providers" + "Project settings" as title-style section headings; provider SettingRows separated by hairlines with status Badges (Connected success / not connected warning) — no green-600/amber-500 dots |
| J-S2 ✱ | Run settings | permission-mode Radios (styled), bypass confirmation still required (behaviour unchanged); Select controls styled with `color-scheme: dark` native popup |

### J-D Daemon edge cases
| ID | Step | Expect |
|---|---|---|
| J-D1 | Open the builder, stop the daemon mid-edit, try Save | "⚠"-replacement icon + "Daemon disconnected — cannot save." in danger-text; Save disabled; edits remain in the form; restart → Save works |
| J-D2 | Toasts: trigger success (remove project), error (open a ghost project whose `.symbion/store.json` was deleted) | bottom-centre surface toast with round tinted icon; error toast has `role="alert"`; both dismiss after 2.2 s |

---

## 5. Exit criteria

- §1 gates green after every phase; §1.1 new tests present and passing; §1.2 changes limited to the listed lines.
- §2 grep gates all empty; G11 empty.
- §4 journey complete with screenshots attached to STATE `QA` section; any deviation filed as a finding with screenshot + DOM snippet.
- e2e: no regression vs baseline B-3.
