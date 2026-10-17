# Feature: ui-design-system — refactor apps/web onto the Symbion design system

## Phase: REVIEW PASS → committed, QA not run

## 1. Requirements

Refactor the whole `apps/web` UI onto the new Symbion design system (ink + mint identity) so every
screen draws from one token source and one set of primitives.

Source of truth (copied into the repo, read these first):
- `docs/design-system/README.md` — brand book: voice, colour/type/spacing/radius/shadow rules, icon rules, "Using this system in apps/web" migration notes.
- `docs/design-system/tokens.json` — every token (Dark first, Light second), type scale, spacing, radius, shadow, size, zIndex.
- `docs/design-system/reference.css` — reference implementation of every component as `sy-*` CSS classes (NOT to be shipped as-is; port to Tailwind + React primitives).
- `docs/design-system/components.md` + `docs/design-system/components/<Name>.html` — guideline + static preview per component (25).
- Canvas mockups of the 7 screens: Home, Project, Editor (builder), Graph, Publish, Templates, Settings — same layout as the components.

Inventory problems this fixes (from scan of master@a4b679b):
- Two overlapping colour systems (named hex in `tailwind.config.ts` + RGB-triplet CSS vars in `globals.css`).
- ~131 arbitrary font sizes (`text-[11px]` ×37, `[10px]` ×28, `[10.5px]` ×16 …).
- ~30 inline hex values in `components/graph/*`; 11 light-theme leftovers (`text-green-600`, `text-amber-*`).
- `bg-white/[.06]` ×31 as an ad-hoc hover token.
- Three hand-rolled tab styles; unicode glyphs used as icons; CodeMirror uses built-in `theme="dark"`.

## 3. Scope (locked)

IN:
1. **Token layer**: CSS variables in `globals.css` for every colour/shadow token in `tokens.json` (dark values on `:root`; light values under `[data-theme="light"]` defined but not exposed — see OUT). Tailwind config maps colours/radius/shadow/spacing/fontSize/zIndex to those vars with the design system's names. Delete the duplicate hex palette + RGB-triplet legacy tokens once no usages remain.
2. **Fonts**: Bricolage Grotesque (500/600), Instrument Sans (400–600), IBM Plex Mono (400/500) via `next/font/google` → `--font-display`, `--font-sans`, `--font-mono`. Drop IBM Plex Sans.
3. **Type scale**: Tailwind `fontSize` = the 11 styles (greeting, page-title, dialog-title, title, body, ui, label, caption, overline, code, code-sm). Replace every arbitrary `text-[Npx]` per the README mapping. Zero `text-[` arbitrary sizes left.
4. **Primitives in `components/ui/`**: restyle Button (primary/outline/ghost/danger/danger-outline; sm/default/lg), Badge (kind + state variants), Dialog, Input/Select/Textarea, Checkbox, RowMenu, Tooltip, Toast; ADD Tabs, SegmentedControl, IconButton, Banner, StatusGlyph (moved from `run/agents`, keep its glyph set & API), Kind tile.
5. **App shell**: Sidebar per design (logo, primary nav, Pinned, Recent workflows/agents, user row with daemon status) replacing AppRail + ProjectSidebar visuals; collapses to icon rail < 1100px. Main area `bg-app`.
6. **Screens**: restyle Home/EmptyState (+ Composer where a create entry exists today — no new backend behaviour), ProjectView (ListRow, Tabs, List/Graph SegmentedControl), BuilderDrawer + forms + LivePreviewPane, PublishDialog + DiffView + ConflictResolver + result, Templates (cards, chips, preview modal), Settings (SettingRow, providers, run settings), Import/Create dialogs, Run engine UI (RunBar, RunDialog, agents panel, transcript), Graph (nodes/edges/canvas/toolbar/legend per GraphNode guideline, tokens only — no inline hex).
7. **Icons**: lucide-react for every unicode stand-in and inline SVG icon; StatusGlyph characters stay.
8. **CodeMirror**: one theme built from tokens, used by MarkdownTab + TemplateMarkdownViewer.
9. **Copy**: keep existing Vietnamese copy and i18n; only change wording where a component guideline demands it (button verbs).

OUT (explicitly):
- No light theme toggle / no Light QA (tokens defined, not exposed).
- No new features, routes, RPC methods, daemon or core changes. Pure presentation.
- No behaviour change to publish safety: diff-before-write, conflict blocking, disabled "write" gate stay exactly.
- No new Composer AI behaviour — if Home has no create-from-prompt today, Composer is NOT added.
- Do not reference any third-party product as a design source in code, comments or docs.

Acceptance:
- `npm run build`, typecheck, lint and all existing tests pass.
- grep: no `#[0-9a-f]{6}` in `apps/web/src/**/*.tsx` (outside a single tokens-derived theme file for CodeMirror if needed), no `text-[\d`, no `bg-white/[`, no `text-(green|amber|red)-\d`.
- Every screen in the journey renders with the new tokens in the browser (QA via chrome-devtools).

Phasing suggestion for the plan (each phase leaves the app building): P1 tokens+fonts+tailwind (with temporary aliases from old names) → P2 primitives → P3 shell/sidebar → P4 screens → P5 graph + run + CodeMirror → P6 remove aliases + grep gates.

## 6. PLAN — Architecture

### 6.0 Invariants (code-reviewer: these are pass/fail)

- **Presentation only.** No file under `apps/daemon/`, `packages/core/`, `packages/rpc-types/` changes. No new RPC method; `apps/web/src/lib/rpc/*`, `lib/store/*` and `lib/run/*` are not touched at all. No local-store (`.symbion/store.json`, `.symbion/runs/`, user config dir) schema change, no init/migration. The data flow **web UI → typed localhost RPC (`scan`/`render`/`computeDiff`/`write`/run methods) → daemon → filesystem + git → RPC result → UI** is byte-for-byte unchanged; this feature only changes how results are drawn.
- **Filesystem safety unaffected and must stay so.** Render → temp → diff preview → confirm → write is unchanged. In `publish/PublishDiffView.tsx` and `publish/ConflictResolver.tsx` the following are **logic-frozen** (diff must show only className / JSX-wrapper / icon changes around them):
  - initial selection: `res.files.filter((f) => f.status !== "conflict" && f.status !== "same")`
  - `toggle`, `handleWrite`, the `onResolve` handler that adds/removes the conflict file from `selected`
  - the write gate: `disabled={nothingToWrite || selected.size === 0 || writing || !daemonConnected}`
  - ConflictResolver's "Keep is the visual default" condition `resolution !== "overwrite"`
- **Copy is preserved** byte-for-byte except: (a) leading/trailing unicode stand-in glyphs that become lucide icons (exact list in 6.9 R-2), (b) DiffView state words (`New`/`Updated`/`Unchanged`/`Conflict`) that replace the `+ ~ = !` glyphs, (c) a single page title "Settings" on the settings screen. Remaining Vietnamese strings (`Theo markdown`, `Xong`, `[Chèn $ARGUMENTS]`) stay exactly.
- Every phase ends with `npm run build` + `npm run test:web` green (aliases guarantee the build; see 6.2.4).

### 6.1 Baseline inventory (measured on this branch, apps/web/src/**/*.tsx)

| Item | Count | Where |
|---|---|---|
| Arbitrary font sizes `text-[Npx]` | 131 in 52 files | `[11px]`37 `[10px]`28 `[10.5px]`16 `[13px]`15 `[12.5px]`12 `[11.5px]`9 `[9.5px]`5 `[12px]`4 `[15px]`2 `[9px]`1 `[23px]`1 `[13.5px]`1 |
| Tailwind default sizes | `text-xs` 127, `text-sm` 72, `text-lg` 3 | README mapping omits these — handled in 6.2.3 |
| `bg-white/[.06]` / `[.04]` / `[.03]` / `[.055]` | 31 / 7 / 5 / 1 (18 files for `.06`) | hover/ground ad-hoc |
| **Opacity modifiers on named token colours** | 40 | `bg-warning/10`8 `bg-danger/10`7 `border-warning/40`6 `bg-warning/15`4 `border-danger/40`3 `border-warning/30`2 `bg-brand-accent-soft/80`2 `outline-brand-accent/60`2 + 6 singles |
| `border-white/40|50`, `bg-black/50`, `text-white(/NN)` | 7, 3, 9 | handles, scrims, text on fills |
| Light-theme leftovers | 10 lines in 7 files | ApplyResultPanel, AuthorSkippedSummary, LicenseAcknowledgmentStep, ProvidersPanel:119, ProviderStatusPill:86-87, TemplatePreviewModal:190/194, TemplateSection:38, TemplatesView:179 |
| Inline hex | 29 in 8 files | AgentNode 7, CommandNode 7(+1 rgba), DotGridBackground 4 (3 in comments), GraphEdgePath 5, GraphCanvasMenu 2, GraphToolbar 2, GraphCanvas 1, GraphEdgeLabel 1 |
| `font-bold` | 11 | DS max weight is 600 |
| `tracking-[…]` | 15 | absorbed by type tuples |
| Unicode stand-ins in JSX | `▶`13 `⋯`13 `🕘`9 `▸`8 `✕`6 `⟳`5 `＋`4 `⤢`3 `↳`3 `■`3 `⧉`2 `↧`1 `⦿`1 (+`⚠`42 incl. comments) | |
| Old colour classes | `text-text-body`129 `text-text-muted`92 `text-text-faint`79 `border-border-hairline`53 `text-danger`51 `text-warning`40 `text-muted-foreground`38 `bg-bg-menu`22 `text-text-strong`20 `border-border-input`20 `border-border-menu`19 `text-success`18 `text-text-dim`16 … | |
| Button | 88 call sites in 28 files; `variant="outline"`46, `"destructive"`6, `"ghost"`4, **no variant (= primary) ≈32** | |
| Dead components (zero importers) | `AppNav.tsx`, `ProjectSidebar.tsx` | delete in P3 |
| Shells that render the rail | `AppShell.tsx`, `SettingsShell.tsx`, `TemplatesView.tsx` | all import `AppRail` |

### 6.2 Token layer

#### 6.2.1 `globals.css` shape (P1)

```css
@tailwind base; @tailwind components; @tailwind utilities;

@layer base {
  :root {
    color-scheme: dark;                       /* native <select> popups, checkboxes, scrollbars */
    --bg-app: #15171c;  --bg-sidebar: #101216;  --bg-deep: #0b0c10;
    --surface: #1c1f26; --surface-hover: #242833; --surface-active: #2a2e38;
    /* … every colour token in tokens.json, name = `--<token name>`, dark value … */
    --shadow-menu: 0 8px 24px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.04);
    --shadow-dialog: …; --shadow-toast: …; --shadow-composer: …;
  }
  [data-theme="light"] { color-scheme: light; /* every token, light value */ }

  body { background: var(--bg-app); color: var(--ink); font-family: var(--font-sans), system-ui, sans-serif;
         font-size: 14px; line-height: 20px; -webkit-font-smoothing: antialiased; }
  :where(button, a, input, select, textarea, summary, [tabindex]):focus-visible {
         outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  ::selection { background: var(--mint-soft); }
}
```
- Hex values live **only** in `globals.css` (CSS, not `.tsx`) — the grep gate is about `.tsx`.
- The RGB-triplet legacy vars (`--background`, `--foreground`, `--muted`, `--muted-foreground`, `--border`, `--primary`, `--primary-foreground`, `--destructive`, `--accent`, `--radius`) are **deleted in P1**: the legacy Tailwind keys that used them are re-pointed to the new vars by the alias layer (6.2.4). The old body rule using `rgb(var(--background))` is replaced.
- Scrollbar colour `rgba(255,255,255,.14)` → `var(--line-strong)`.
- Keep the global `prefers-reduced-motion` block verbatim (it already satisfies "everything stops").

#### 6.2.2 `tailwind.config.ts` shape (final, after P6)

```ts
const v = (n: string) => `var(--${n})`;
theme: {
  fontSize: {                                   // P1: under `extend`; P6: moved to top-level (drops xs/sm/lg/…)
    greeting:      ["40px", { lineHeight: "46px", fontWeight: "600", letterSpacing: "-0.02em" }],
    "page-title":  ["32px", { lineHeight: "38px", fontWeight: "600", letterSpacing: "-0.02em" }],
    "dialog-title":["22px", { lineHeight: "28px", fontWeight: "600", letterSpacing: "-0.015em" }],
    title:   ["17px", { lineHeight: "24px", fontWeight: "500" }],
    body:    ["15px", { lineHeight: "22px", fontWeight: "400" }],
    ui:      ["14px", { lineHeight: "20px", fontWeight: "400" }],
    label:   ["13px", { lineHeight: "18px", fontWeight: "500" }],
    caption: ["12px", { lineHeight: "16px", fontWeight: "400" }],
    overline:["11px", { lineHeight: "14px", fontWeight: "600", letterSpacing: "0.06em" }],
    code:    ["13px", { lineHeight: "20px", fontWeight: "400" }],
    "code-sm":["12px", { lineHeight: "18px", fontWeight: "400" }],
  },
  extend: {
    colors: {
      app: v("bg-app"), sidebar: v("bg-sidebar"), deep: v("bg-deep"),
      surface: { DEFAULT: v("surface"), hover: v("surface-hover"), active: v("surface-active") },
      line:    { DEFAULT: v("line"), soft: v("line-soft"), strong: v("line-strong") },
      ink:     { DEFAULT: v("ink"), 2: v("ink-2"), 3: v("ink-3"), muted: v("ink-muted"), faint: v("ink-faint") },
      mint:    { DEFAULT: v("mint"), text: v("mint-text"), hover: v("mint-hover"), strong: v("mint-strong"), soft: v("mint-soft") },
      "on-mint": v("on-mint"), "focus-ring": v("focus-ring"),
      workflow:{ DEFAULT: v("workflow"), soft: v("workflow-soft") },
      agent:   { DEFAULT: v("agent"),    soft: v("agent-soft") },
      skill:   { DEFAULT: v("skill"),    soft: v("skill-soft") },
      running: { DEFAULT: v("running"),  soft: v("running-soft") },
      success: { DEFAULT: v("success"),  soft: v("success-soft") },
      warning: { DEFAULT: v("warning"),  soft: v("warning-soft") },
      danger:  { DEFAULT: v("danger"), text: v("danger-text"), soft: v("danger-soft") },
      "on-danger": v("on-danger"),
      diff: { add: v("diff-add"), del: v("diff-del") },
      overlay: v("overlay"), "graph-dot": v("graph-dot"),
      // ...LEGACY_ALIASES (P1–P5 only, see 6.2.4)
    },
    borderColor: { DEFAULT: v("line") },        // bare `border` today falls back to gray-200 (#e5e7eb)!
    fontFamily: {
      display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
      sans:    ["var(--font-sans)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      mono:    ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
    },
    borderRadius: { xs: "6px", sm: "8px", md: "10px", lg: "14px", xl: "20px", pill: "999px" },
    boxShadow: { menu: v("shadow-menu"), dialog: v("shadow-dialog"), toast: v("shadow-toast"),
                 composer: v("shadow-composer"),
                 "ring-running": "0 0 0 2px var(--running), 0 0 18px var(--running-soft)" },
    spacing:  { "control-sm": "30px", "control-md": "36px", "control-lg": "40px",
                sidebar: "288px", rail: "56px", drawer: "560px" },
    maxWidth: { content: "920px", "content-wide": "1040px" },
    zIndex:   { rail: "10", runbar: "30", drawer: "40", dialog: "50", menu: "60", toast: "70" },
    transitionDuration: { DEFAULT: "120ms" },
    keyframes: { /* fadeIn, slideIn, popIn unchanged; pulse/glowPulse/countLockIn re-coloured with var(); */
      livePulse: { "50%": { opacity: ".35" } } },
    animation: { /* existing names kept */ livePulse: "livePulse 1.6s ease-in-out infinite" },
  },
}
```
- **Spacing needs no additions for `space-1…12`**: DS 4px grid equals Tailwind's default scale (`p-1`=4px … `p-12`=48px). Only sizes are added.
- Keyframe recolour: `pulse` (handle affordance) `rgba(129,140,248,.5)` → `var(--mint-soft)`; `glowPulse` `rgba(34,211,238,…)` → `var(--running-soft)`→`transparent`; `countLockIn` white → `var(--ink-faint)`. Names unchanged (tests assert `animate-glowPulse` on graph nodes).
- Display face is a family, not part of the size tuple: headings use `font-display text-page-title` (and `dialog-title`, `greeting`). Never `font-display` below 20px (only those three sizes).
- Explicit `font-medium/semibold` classes still win over tuple weights (Tailwind emits fontWeight after fontSize).

#### 6.2.3 Font-size mapping (apply mechanically, context rule first)

| Old | Sans context | `font-mono` context | Notes |
|---|---|---|---|
| `[9px]` `[9.5px]` `[10px]` `[10.5px]` | `text-overline` (+`uppercase` only if it already was) | `text-code-sm` | drop `font-bold`, `tracking-[.05em]/[.06em]/[.09em]` (tuple carries 0.06em) |
| `[11px]` `[11.5px]` `[12px]` `text-xs` | `text-caption` | `text-code-sm` | |
| `[12.5px]` `[13px]` | `text-label` | `text-code` | |
| `[13.5px]` `text-sm` | `text-ui` | `text-code` | |
| `[15px]` | `text-body`; **heading** (`DialogTitle`, drawer `h2`) → `font-display text-dialog-title` | — | |
| `text-lg` | `text-title` | — | Settings section headings |
| `[23px]` (ProjectView h1) | `font-display text-page-title` | — | drop `tracking-[-.02em]` |

The README mapping does not mention mono text or Tailwind's default `text-xs/sm/lg`; this table is the authoritative superset. Sizes grow by 1–2px in many dense places (10→11, 11→12): see risk R-6.

#### 6.2.4 Alias layer (P1 → deleted in P6)

`LEGACY_ALIASES` object in `tailwind.config.ts`, each old key pointing to a **new var**, so P1 re-skins the whole app without touching call sites and every phase builds:

| Old key (class example) | → New var | Final class to migrate to |
|---|---|---|
| `bg-app` (`bg-bg-app`) | `--bg-app` | `bg-app` |
| `bg-rail` | `--bg-sidebar` | `bg-sidebar` |
| `bg-panel` (`bg-bg-panel`) | `--bg-app` | page panels/rows: `bg-app` or none (hairline rows); dialogs/drawer: `bg-surface` |
| `bg-surface` | `--surface` | `bg-surface` |
| `bg-menu` | `--surface` | `bg-surface` (+`shadow-menu`) |
| `bg-input` | `--surface` | `bg-surface` |
| `bg-code` | `--bg-sidebar` | `bg-sidebar` (CodeBlock) / `bg-deep` (RunLogTail, RawEventLog) |
| `border-hairline`, `border-subtle` | `--line` | `border-line` |
| `border-input` | `--line-strong` | `border-line-strong` |
| `border-menu` | `--line-soft` | `border-line-soft` |
| `text-strong`, `text-body` | `--ink` | `text-ink` |
| `text-secondary` | `--ink-3` | `text-ink-3` |
| `text-muted`, `text-dim` | `--ink-muted` | `text-ink-muted` |
| `text-faint` | **`--ink-muted`** (deliberate, see F-3) | `text-ink-muted`; `text-ink-faint` only for placeholder/disabled/thinking/interrupted |
| `brand-accent` | `--mint` | `bg-mint` + `text-on-mint` / `border-mint` / `ring-mint` |
| `brand-accent-soft` | `--mint-soft` | `bg-mint-soft` |
| `accent-text` / `accent-text-hi` | `--mint-text` / `--mint-hover` | `text-mint-text` / `hover:text-mint-hover` |
| `command`, `command-hi` | `--workflow` | `workflow` |
| `agent-hi` | `--agent` | `agent` |
| `danger-hi` | `--danger-text` | `text-danger-text` |
| `overwrite-btn` | `--danger` | Button `variant="danger"` |
| `run-active` / `run-active-soft` | `--running` / `--running-soft` | `running` / `running-soft` |
| legacy `border`/`background`/`foreground` | `--line`/`--bg-app`/`--ink` | `border-line` / `bg-app` / `text-ink` |
| legacy `muted` / `accent` | `--surface-hover` | `bg-surface-hover` |
| legacy `muted-foreground` | `--ink-muted` | `text-ink-muted` |
| legacy `primary` / `primary-foreground` | `--mint` / `--on-mint` | |
| legacy `destructive` | `--danger` | `danger` |
| radius `nav-item` / `panel` / `dialog` | 10 / 14 / 20 px | `rounded-md` / `rounded-lg` / `rounded-xl` |
| shadow `dropdown` / `drawer` / `glow-run` | menu / dialog / ring-running | `shadow-menu` / `shadow-dialog` / `shadow-ring-running` |

Keys that are the same name in old and new (`success`, `warning`, `danger`, `agent`, `skill`) are simply re-pointed; no alias needed.

**Opacity modifiers (MUST be fixed in P1, not later).** Token colours are `var(--x)` holding a full colour, so Tailwind 3.4 cannot apply `/NN`: `withAlphaValue` returns the colour unchanged, i.e. `bg-danger/10` renders **solid** danger the moment P1 re-points `danger` to a var. All 40 token-colour modifier usages are migrated in P1 in the same commit:

| Old | New |
|---|---|
| `bg-warning/5|10|15` | `bg-warning-soft` |
| `bg-danger/5|10` | `bg-danger-soft` |
| `bg-danger/90` (DaemonStatusBadge) | `bg-danger-soft` + `text-danger-text` |
| `border-warning/30|40`, `border-danger/40` | `border-warning`, `border-danger` (or drop the border — Banner has none) |
| `text-warning/80`, `text-danger/70|80` | `text-warning`, `text-danger-text` |
| `bg-brand-accent-soft/80` (hover) | `hover:bg-mint-soft` → hover state `hover:bg-surface-hover` |
| `outline-brand-accent/60` | `outline-focus-ring` |

`white`/`black` modifiers keep working through P1 (real colours) and are removed in P2–P5: `bg-white/[.06]`,`[.055]` → `bg-surface-hover`; `bg-white/[.03]`,`[.04]` → `bg-surface-hover` (hover) or `bg-sidebar` (static well); `bg-black/50` → `bg-overlay`; `border-white/40|50` → `border-line-strong`; `text-white*` → `text-on-mint` / `text-on-danger` / `text-ink`. A guard test forbids any `/` modifier on a token colour from P1 on (testplan U-G2).

#### 6.2.5 Fonts (`app/layout.tsx`, P1)

```ts
import { Bricolage_Grotesque, Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500","600"], variable: "--font-display", display: "swap" });
const sans    = Instrument_Sans({ subsets: ["latin"], weight: ["400","500","600"], variable: "--font-sans", display: "swap" });
const mono    = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400","500"], variable: "--font-mono", display: "swap" });
<html lang="vi" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
```
All three families verified present in the installed `next@14.2.35` font-data. IBM Plex Sans is dropped; Plex Mono 600 is dropped (grep `font-mono` + `font-semibold` co-occurrences → `font-medium`). `font-bold` (11) → `font-semibold` (only 400–600 are loaded; 700 would be faux-bold). `<html lang>` is NOT changed (see F-9).

#### 6.2.6 `lib/utils.ts` — tailwind-merge must learn the new scale (P1, mandatory)

`cn()` = `twMerge(clsx())`. tailwind-merge v2 classifies unknown `text-*` as a **text colour**, so `cn("text-caption", "text-ink-muted")` would silently **drop** `text-caption`, and `cn("text-ui", className="text-label")` would keep both. Replace with:
```ts
const twMerge = extendTailwindMerge({ extend: {
  classGroups: {
    "font-size": [{ text: ["greeting","page-title","dialog-title","title","body","ui","label","caption","overline","code","code-sm"] }],
    rounded: [{ rounded: ["xs","pill"] }],
    shadow: [{ shadow: ["menu","dialog","toast","composer","ring-running"] }],
    z: [{ z: ["rail","runbar","drawer","dialog","menu","toast"] }],
  },
}});
```
Pinned by unit test U-U1.

### 6.3 Data flow (unchanged — stated for the reviewer)

```
user edits form / CodeMirror ──► IR in useArtifactStore (memory)        [no change]
Save ──► callRpc("saveArtifact"…) ──► daemon ──► .symbion/store.json   [no change]
Publish ▸ PublishDialog ──► callRpc("computeDiff") ──► daemon renders to temp, diffs vs disk (read-only)
        ──► PublishDiffView (restyled only) ──► user selects / resolves conflicts (logic frozen)
        ──► "Write to disk" (gate frozen) ──► callRpc("write") ──► daemon: confine path, backup, temp→rename
        ──► PublishResultView (restyled only)
Run ──► RunDialog ──► run RPC/WS ──► daemon spawns CLI ──► events ──► useRunStore ──► RunBar/AgentsPanel/graph overlay (restyled only)
```
RPC methods that touch disk: `write` (and the store-saving methods) — none are added, removed or re-parameterised. The only "new" runtime inputs are CSS variables.

### 6.4 Phases and files

Each phase = one commit (or small series) that builds and passes `npm run test:web`.

#### P1 — tokens, fonts, Tailwind, merge (no visual layout change, full re-skin via aliases)
| File | Action |
|---|---|
| `apps/web/src/app/globals.css` | rewrite per 6.2.1 (delete RGB triplets, add all tokens both themes, focus rule, color-scheme) |
| `apps/web/tailwind.config.ts` | rewrite per 6.2.2 + `LEGACY_ALIASES` (6.2.4); `fontSize` under `extend` for now; delete hex palette |
| `apps/web/src/app/layout.tsx` | fonts per 6.2.5 |
| `apps/web/src/lib/utils.ts` | `extendTailwindMerge` per 6.2.6 |
| the ~20 files holding the 40 token-colour opacity modifiers | mechanical swap per 6.2.4 table (incl. `ui/badge.tsx`, `ui/row-menu.tsx`, `DaemonStatusBadge.tsx`, `graph/DaemonRibbon.tsx`, `publish/ConflictResolver.tsx`, `PublishDiffView.tsx`, `PublishResultView.tsx`, `graph/CommandNode.tsx`, `graph/MissingAgentNode.tsx`, `run/agents/AgentTree.tsx`, …) |
| NEW `apps/web/src/designSystemGuard.test.ts` | guard test, P1 rules only (U-G1/U-G2); rules tighten per phase (6.4 P6) |
| NEW `apps/web/src/lib/utils.test.ts` | U-U1 |
| NEW `apps/web/src/designTokens.test.ts` | U-T1..T3 (tokens.json ⇔ globals.css ⇔ tailwind config) |

#### P2 — primitives (`apps/web/src/components/ui/`)
| File | Action |
|---|---|
| `button.tsx` | rewrite with `cva`; API 6.5 |
| NEW `icon-button.tsx` | |
| `badge.tsx` | rewrite; API 6.5 (keeps `variant="draft"|"default"` aliases) |
| NEW `kind.tsx` | Kind tile |
| NEW `tabs.tsx`, NEW `segmented-control.tsx`, NEW `banner.tsx` | |
| NEW `status-glyph.tsx` | moved from `run/agents/StatusGlyph.tsx` (delete old file; update 6 importers: AgentDetailHeader, AgentDetailView, AgentGroups, AgentInstancePicker, AgentTree, TranscriptRowView; move `primitives.test.tsx` StatusGlyph block to `ui/status-glyph.test.tsx`) |
| `dialog.tsx` | restyle + `role="dialog" aria-modal aria-labelledby`, `DialogClose`; keep `fixed` on scrim (e2e xpath) |
| `input.tsx` | restyle Input; ADD `Select`, `Textarea`, `Field` (label/help/error) |
| `checkbox.tsx` | restyle; optional `label`; ADD `Radio` |
| `row-menu.tsx` | restyle; ADD `MenuItem`, `MenuDivider`, `menuSurfaceClass`; trigger → IconButton (`MoreHorizontal`) |
| `tooltip.tsx` | inverted style, 400ms hover delay, `side` |
| `toast.tsx` | restyle; role status/alert |
| `staggered-reveal.tsx` | untouched |
| NEW `ui/primitives.test.tsx` | U-P1..P12 |
| all Button call sites that pass size overrides (`className="h-7 px-2 text-xs"` in CancelControl etc.) | replace with `size="sm"` |

#### P3 — shell / sidebar
| File | Action |
|---|---|
| NEW `components/shell/Sidebar.tsx` | replaces `AppRail` (same props `{onCreateProject, onSelectProject}`; keeps project-remove confirm + toast logic verbatim, keeps width persistence key `symbion:rail-width`) |
| NEW `components/shell/NavItem.tsx` | replaces `rail/NavItem.tsx` |
| NEW `components/shell/Logo.tsx` | inline SVG mark (+ wordmark) |
| NEW `lib/hooks/useMediaQuery.ts` | `(min-width:1100px)` → collapsed rail |
| `AppShell.tsx`, `SettingsShell.tsx`, `TemplatesView.tsx` | import `Sidebar`; `main` → `bg-app` |
| `DaemonStatusBadge.tsx` | user-row style; copy kept (tests TC-BADGE-1..3 and e2e "daemon disconnected") |
| DELETE `AppRail.tsx`, `rail/NavItem.tsx`, `ProjectSidebar.tsx`, `AppNav.tsx` | (last two are already dead) |
| NEW `components/shell/Sidebar.test.tsx` | U-S1..S4 |

#### P4 — screens (split P4a / P4b if the diff gets large)
P4a Home / Project / Builder / Publish / dialogs: `EmptyState`, `ProjectView`, `BuilderDrawer`, `AgentForm`, `WorkflowForm`, `LivePreviewPane`, `ModelPicker`, `GenerateBodyButton`, `GenerateBodyDisclosure`, `GenerateDescriptionButton`, `ProviderStatusPill`, `CreateProjectDialog`, `FolderBrowserDialog`, `FileTreePicker`, `ImportDialog`, `ImportReviewStep`, `ImportScanningState`, `ProjectPickerStep`, `WorkflowDetectionPanel`, `CopyRunCommandDialog`, `publish/PublishDialog`, `publish/PublishDiffView`, `publish/ConflictResolver`, `publish/PublishResultView`.
P4b Templates / Settings: `TemplatesView`, `TemplateSection`, `TemplateCard`, `TemplatePreviewModal`, `AuthorTabs` (→ composes `ui/tabs`), `AuthorFetchErrorPanel`, `AuthorFetchLoadingState`, `AuthorSkippedSummary`, `ApplyResultPanel`, `LicenseAcknowledgmentStep`, `SettingsShell`, `ProvidersPanel`, `run/RunSettingsSection`. NEW `components/SettingRow.tsx` (local composite, not a ui primitive).
e2e selector updates (R-2) land in the same commit as the copy/icon change that causes them.

#### P5 — graph + run engine UI + CodeMirror
- Graph: `DependencyGraph.tsx`, `graph/AgentNode.tsx`, `CommandNode.tsx`, `MissingAgentNode.tsx`, `NodeHandle.tsx`, `NodeMenu.tsx`, `NodeTokenBadge.tsx`, `NodeDeleteConfirm.tsx`, `GraphCanvas.tsx`, `GraphCanvasMenu.tsx`, `GraphToolbar.tsx`, `GraphLegend.tsx`, `GraphHintBar.tsx`, `GraphStatusChips.tsx` (→ Badges), `GraphEdgePath.tsx`, `GraphEdgeLabel.tsx`, `EdgeRelationModal.tsx`, `DaemonRibbon.tsx` (→ Banner), `DotGridBackground.tsx`.
- Run: `run/RunBar.tsx`, `RunDialog.tsx`, `RunCommandPalette.tsx`, `RunHistoryPopover.tsx`, `RunLogTail.tsx`, `RunSummarySection.tsx`, `TokenBreakdownCard.tsx`, `PreflightStrip.tsx`, `PastRunBanner.tsx`, `MissionStatusStrip.tsx`, `DegradedTelemetryChip.tsx`, `CancelControl.tsx`; `run/agents/*` (all non-test `.tsx`).
- CodeMirror: NEW `apps/web/src/lib/codemirror/theme.ts`; `MarkdownTab.tsx`, `TemplateMarkdownViewer.tsx` → `theme={symbionEditorTheme}`. `apps/web/package.json`: add explicit deps `@codemirror/language` (^6.12.4) and `@lezer/highlight` (^1.2.3) — already in the lockfile transitively; declaring them avoids relying on hoisting.
- Test updates (expected class tokens only, assertion intent unchanged): `graph/NodeHandle.test.tsx` (`bg-command`→`bg-workflow`, `border-white/40`→`border-line-strong`), `run/agents/transcript.test.tsx:40` (`text-text-faint`→`text-ink-faint`), `ui/status-glyph.test.tsx` (classes + `animate-livePulse`). NEW `lib/codemirror/theme.test.ts`, NEW `graph/nodeRings.test.tsx`.

#### P6 — remove aliases, close the scale, gates
| File | Action |
|---|---|
| `tailwind.config.ts` | delete `LEGACY_ALIASES`, alias radii/shadows; move `fontSize` from `extend` to top-level `theme.fontSize` (drops `text-xs/sm/base/lg/…`) |
| `designSystemGuard.test.ts` | enable all rules (U-G1..G6) |
| any stragglers the guard finds | fix |
| `CLAUDE.md` | one line under Stack: "Design system: `docs/design-system/` (tokens via CSS vars in `globals.css`; primitives in `components/ui/`)" — only if `/ship` agrees; otherwise leave docs |

### 6.5 Primitive APIs

```ts
// button.tsx
type ButtonVariant = "primary" | "outline" | "ghost" | "danger" | "danger-outline"
                   | "default" /* = primary */ | "destructive" /* = danger */;
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;          // default "primary"
  size?: "sm" | "default" | "lg";   // 30 / 36 / 40px (h-control-*)
  icon?: LucideIcon;                // 16px, stroke 1.6, aria-hidden, gap-2 before children
}
// base: inline-flex items-center justify-center gap-2 rounded-md text-ui font-medium transition-colors
//       disabled:opacity-45 disabled:cursor-not-allowed      (NOT pointer-events-none, NOT hidden)
// primary bg-mint text-on-mint hover:bg-mint-strong | outline border border-line-strong text-ink hover:bg-surface-hover
// ghost text-ink-2 hover:bg-surface-hover hover:text-ink | danger bg-danger text-on-danger
// danger-outline border border-danger text-danger-text | sm: h-control-sm px-2.5 text-label rounded-sm
export const buttonVariants;        // exported for <Link> styled as a button

// icon-button.tsx
interface IconButtonProps extends Omit<ButtonHTMLAttributes, "children"> {
  "aria-label": string;             // REQUIRED (type-level)
  icon: LucideIcon;
  size?: "default" | "sm";          // 36 / 30
  variant?: "ghost" | "send";       // send = composer only (unused this pass)
  tooltip?: boolean;                // default true → <Tooltip content={aria-label}>
}

// badge.tsx
type BadgeVariant = "neutral" | "workflow" | "agent" | "skill" | "success" | "running" | "warning" | "danger" | "plain"
                  | "default" /* = neutral */ | "draft" /* = neutral, see F-6 */;
interface BadgeProps extends HTMLAttributes<HTMLSpanElement> { variant?: BadgeVariant }   // dot except plain; text-overline uppercase rounded-pill h-[22px]

// kind.tsx
interface KindProps { kind: "workflow" | "agent" | "skill"; size?: "sm" | "md"; className?: string } // 22px tile; Slash / Bot / Sparkles; aria-hidden (name is adjacent text)

// tabs.tsx
interface TabItem { id: string; label: ReactNode; count?: number }
interface TabsProps { items: TabItem[]; value: string; onValueChange(id: string): void; "aria-label": string; idPrefix?: string }
// role=tablist/tab, aria-selected, aria-controls=`${idPrefix}-panel-${id}`, roving tabindex, ←/→/Home/End
export function tabPanelProps(idPrefix: string, id: string): { role: "tabpanel"; id: string; "aria-labelledby": string };

// segmented-control.tsx
interface SegmentOption<T extends string> { value: T; label: ReactNode; icon?: LucideIcon }
interface SegmentedControlProps<T extends string> { options: SegmentOption<T>[]; value: T; onValueChange(v: T): void; "aria-label": string; size?: "sm" | "default" }
// role=radiogroup / radio + aria-checked, roving tabindex, arrow keys; track bg-sidebar, thumb bg-surface-active text-ink, others text-ink-muted

// banner.tsx
interface BannerProps { tone: "danger" | "warning" | "success"; title?: ReactNode; icon?: LucideIcon | null; action?: ReactNode; className?: string; children?: ReactNode }
// role="alert" for danger, "status" otherwise; title rendered <strong class="text-ink font-medium">

// status-glyph.tsx — API IDENTICAL to run/agents/StatusGlyph.tsx (GlyphStatus, GLYPHS, StatusGlyph{status, live, size, glyphOverride, className})
// colour classes: starting/running text-running · done/ok text-success · error text-danger · pending text-ink-muted · interrupted/thinking/neutral/unknown text-ink-faint
// size sm → text-code-sm, md → text-code; w-3.5; pulse → motion-safe:animate-livePulse; data-pulse/role="img"/aria-label unchanged

// dialog.tsx — existing exports unchanged: Dialog{open,onClose,className,children}, DialogHeader, DialogTitle, DialogBody, DialogFooter
// + DialogClose({ onClose, label = "Close" }) → IconButton sm X
// panel: bg-surface rounded-xl shadow-dialog p-6 max-h-[85vh] (unchanged layout contract); scrim: fixed inset-0 z-dialog bg-overlay
// DialogTitle: font-display text-dialog-title text-ink; DialogFooter: -mx-6 -mb-6 mt-5 border-t border-line px-6 py-4 gap-2 justify-end

// input.tsx
export const Input, Textarea, Select   // forwardRef, native elements; h-control-md bg-surface border-line-strong rounded-md text-ui
                                        // focus: border-focus-ring + ring-[3px] ring-mint-soft; aria-[invalid=true]:border-danger
export function Field({ label, htmlFor, help, error, children }): JSX.Element   // label text-label text-ink-2; help caption ink-muted; error caption danger-text

// checkbox.tsx
export const Checkbox: forwardRef<HTMLInputElement, InputHTMLAttributes & { label?: ReactNode }>  // 18px, appearance-none, peer-checked lucide Check text-on-mint
export const Radio: same shape, rounded-full

// row-menu.tsx — RowMenu{items, open, onOpenChange, triggerLabel="Options"} unchanged
interface RowMenuAction { label: string; onSelect(): void; danger?: boolean; disabled?: boolean; icon?: LucideIcon; shortcut?: string }
export function MenuItem(props: RowMenuAction): JSX.Element;
export const MenuDivider; export const menuSurfaceClass: string;  // "z-menu rounded-md bg-surface p-[5px] shadow-menu"
// + Escape closes; trigger = IconButton sm MoreHorizontal (accessible name stays "Options")

// tooltip.tsx — Tooltip{content, children, className} unchanged + side?: "bottom"|"top" (default bottom) + delayMs = 400 (hover); focus immediate
// style: bg-ink text-app text-caption rounded-sm shadow-menu max-w-[260px] z-menu

// toast.tsx — Toaster() unchanged (store-driven, 2.2s auto-dismiss for every variant — see F-11)
// surface card rounded-lg shadow-toast border-line-soft; 20px round icon (Check / AlertTriangle / X / Info); role="alert" for error else "status"; z-toast
```

### 6.6 Screen decisions

- **Home** (`AppShell` without project): `EmptyState` = DS EmptyState (44px surface tile with mint `FolderPlus`, dialog-title "No projects yet", sentence "Create a new one or import .claude/", primary "New project" + outline "Import existing .claude/"). With projects but none selected: muted ui text unchanged. **No Composer, no greeting** (no create-from-prompt, no user name exists).
- **ProjectView**: header h1 `font-display text-page-title`, path `font-mono text-code-sm text-ink-muted`; actions: Remove project → `danger-outline sm` (it opens a confirm, not irreversible itself), List/Graph → `SegmentedControl` (labels "List"/"Graph"), Publish → primary `icon={Upload}` "Publish". Body `max-w-content-wide px-10 py-10`. Sections stay **stacked** (Workflows, then Agents) — **no Tabs** (D-6). Rows = ListRow: hairline list, `Kind` tile, `/name` in `font-mono text-code` for workflows, agent name `text-ui`, description `text-caption text-ink-muted truncate`, `Badge` "draft", RowMenu. The `○/●` prefix glyph is dropped (Kind + Badge carry kind/state). Empty-project state: one primary ("Add workflow") + one outline ("Add agent").
- **BuilderDrawer**: scrim `bg-overlay z-drawer`; panel `bg-surface shadow-dialog rounded-l-xl`; width/split persistence unchanged; title `font-display text-dialog-title`; Form/Markdown → `SegmentedControl` (labels "By description" / "Theo markdown" kept); close → `DialogClose`-style IconButton; footer Cancel = ghost, Save = primary. Resize hover line `bg-mint`.
- **LivePreviewPane / TemplateMarkdownViewer / CopyRunCommandDialog**: CodeBlock styling (bg-sidebar well, line border, radius-lg, 36px header with `FileText` icon + path `text-code-sm`, provider Badge plain right).
- **Publish**: title "Publish"; Version → `Field`+`Input`; target cards keep button semantics, add `aria-pressed`, `☑/☐` → lucide `SquareCheck`/`Square`; lossy note `text-warning`; Codex ack → `Checkbox label`. Diff list: per file row `Checkbox` + mono path + state Badge (`new`→success "New", `update`→warning "Updated", `same`→plain "Unchanged", conflict→danger "Conflict"); first-foreign-merge notice → `Banner tone="warning"`; disconnected / write error → `Banner tone="danger"`; Write button primary lg "Write to disk"/"Nothing to write" (gate frozen). ConflictResolver → danger Banner (copy kept: title "CONFLICT — {relPath}", body "The file was hand-edited after the last publish."), buttons "Keep the on-disk version" (outline, `aria-pressed` + `bg-surface-active` when chosen) / "Overwrite" (`danger` when chosen, `danger-outline` otherwise). Result: success line with `Check` icon, errors as danger Banner rows, Backup path `font-mono text-code-sm`, "Xong" primary.
- **Templates**: page-title "Templates"; `AuthorTabs` composes `Tabs` (keeps `aria-label="Template authors"`); grid `grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4`; TemplateCard = card (line-soft, radius-lg, no shadow) — media well only from data the card already has (no new fetch); preview modal = Dialog.
- **Settings**: add page-title "Settings"; "AI providers" / "Project settings" become `text-title` section headings; provider cards → `SettingRow` with status Badge (replaces `ProviderStatusPill`'s green/amber dot); run permission radios → `Radio`; no Appearance control.
- **Run UI**: RunBar = in-flow dock card (`m-3 h-12 rounded-lg bg-surface border-line-soft shadow-toast z-runbar`), StatusGlyph replaces the inline `◉✓✗◼`, mono `/name`, `tabular-nums` elapsed; Stop = outline sm with `Square` icon; dismiss = IconButton X. **No progress bar, no tokens, no "Agents" button** (no data / no wiring — F-8). RunLogTail + RawEventLog `bg-deep`. AgentsPanel "Raw log" stays a button (IconButton, aria-label kept) — **not Tabs** (D-7).
- **Graph**: see 6.7.

### 6.7 Graph specifics (P5)

- **Node footprint is frozen at 160×40 (missing 200×40)**: `NODE_WIDTH/NODE_HEIGHT` in `DependencyGraph.tsx` drive dagre layout and edge anchors (`y + height/2`); persisted node positions and tests (`graphGeometry.test` T-2.1, `GraphCanvas.test` 200/80 sizing) depend on them. The node renders `h-10` (fixed, so anchors stay exact) with Kind tile + single-line label (`text-label`, truncate). The DS node's 196px width and mono subtitle line are **not** adopted (D-5).
- Node root keeps class `group` (CommandNode.test `.closest(".group")`) and keeps an **inline `style.opacity`** (DependencyGraph.agents.test:195 queries `div[style*='opacity']` — moving dimming to a class would make that assertion pass vacuously).
- Ring mapping (inline `boxShadow` strings with `var()` only — no hex):

| State | Old | New |
|---|---|---|
| run active/starting | `#22d3ee` 2px + glowPulse | `0 0 0 2px var(--running), 0 0 18px var(--running-soft)` + `animate-glowPulse` (recoloured keyframe) |
| run done | `#4ade80` | `0 0 0 2px var(--success)` |
| run error | `#f87171` | `0 0 0 2px var(--danger)` |
| cancelled | white .3 | `0 0 0 2px var(--line-strong)` |
| justAdded | indigo 3px | `0 0 0 2px var(--mint)` |
| highlighted (hover neighbour) | `#c7d2fe` | `0 0 0 2px var(--ink-3)` (mint is reserved for selection) |
| runHalo selected / hover | `border-brand-accent` / `border-white/50` | `border-mint` / `border-line-strong` |
| body | solid `#818cf8` / `#a78bfa`, white text | `bg-surface border border-line-soft text-ink`, Kind tile carries kind |
| missing agent | danger dashed + danger-soft | `border-[1.5px] border-dashed border-line-strong bg-transparent text-ink-muted`; inbound edge stays dashed danger |

- NodeHandle: connectable source `!bg-workflow`, target `!bg-agent`, non-connectable `!bg-transparent !border !border-line-strong` (test updated).
- Edges (`GraphEdgePath`): `stroke` via inline style `var(--line-strong)` base, `var(--running)` flowing/settled, `var(--danger)` missing, `var(--mint)` highlighted, `var(--running)` + width 2.5 runLinked; pending `var(--line-strong)` dashed. Widths/opacity/dash logic unchanged. Connect ghost line in `GraphCanvas` → `className="stroke-mint"`.
- Canvas: container `bg-deep`; `DotGridBackground` pitch 20→16, r .5→1.2, `className="fill-graph-dot"` on the circle (CSS var in a presentation attribute is unreliable; use the class). No snapping depends on the pitch (checked).
- Kind dots in GraphToolbar/GraphCanvasMenu/GraphEdgeLabel (`style={{background:"#818cf8"}}`) → `<Kind size="sm">` or `bg-workflow`/`bg-agent` classes. Menus compose `menuSurfaceClass` + `MenuItem`. Toolbar unicode (`＋ ⤢ ⧉ ⟳ 🕘`) → IconButtons (`Plus`, `Maximize2`, `Copy`, `RefreshCw`, `History`) with the existing aria-labels/titles as labels.

### 6.8 CodeMirror theme (`lib/codemirror/theme.ts`)

```ts
export const editorThemeSpec = { "&": { color: "var(--ink-2)", backgroundColor: "var(--bg-sidebar)", fontSize: "13px" },
  ".cm-content": { fontFamily: "var(--font-mono)", lineHeight: "20px", caretColor: "var(--ink)" },
  ".cm-gutters": { backgroundColor: "var(--bg-sidebar)", color: "var(--ink-faint)", border: "none" },
  ".cm-activeLine": { backgroundColor: "var(--surface-hover)" }, ".cm-activeLineGutter": {...},
  "&.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "var(--mint-soft)" },
  "&.cm-focused": { outline: "2px solid var(--focus-ring)", outlineOffset: "2px" }, ".cm-cursor": { borderLeftColor: "var(--ink)" } };
export const editorHighlight = HighlightStyle.define([
  { tag: tags.heading, color: "var(--ink)", fontWeight: "600" }, { tag: tags.contentSeparator, color: "var(--workflow)" },
  { tag: [tags.string, tags.url, tags.link], color: "var(--mint-text)" }, { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: "var(--agent)" },
  { tag: [tags.comment, tags.meta, tags.processingInstruction], color: "var(--ink-muted)" }, { tag: tags.emphasis, fontStyle: "italic" }, { tag: tags.strong, fontWeight: "600" } ]);
export const symbionEditorTheme: Extension[] = [EditorView.theme(editorThemeSpec, { dark: true }), syntaxHighlighting(editorHighlight)];
```
Because every value is `var(--…)`, **no hex exemption** is needed in the grep gate. Wrapper div gets `rounded-lg border border-line overflow-hidden`. Optional (D-11): use `yamlFrontmatter({ content: markdown() })` from the already-installed `@codemirror/lang-yaml@6.1.3` so frontmatter keys get the `agent` colour — editor-only, does not change IR parsing (core `parseClaudeFile` remains the parser).

### 6.9 Edge cases & risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | **Tests asserting class names**: NodeHandle.test (`bg-command`, `border-white/40`), CommandNode.test (`bg-transparent`, `.group`), primitives.test (StatusGlyph colour classes, `animate-glowPulse`), transcript.test:40 (`text-text-faint`), :70/74 (`text-danger`), AgentTree.test:133 (`text-danger`), AgentsPanel.test:101 (`outline` on focused row), DependencyGraph.agents.test:135-136 (`w-[360px]`, `h-[calc(100vh-200px)]`) and :195 (`style*='opacity'`) | update expected tokens in the same commit that renames them; keep `text-danger` (still valid), keep `outline` (`outline outline-1 outline-focus-ring`), keep the two layout classes and the inline opacity |
| R-2 | **Accessible names change when a leading glyph becomes an icon** | lockstep updates: e2e `happy-path` & `auto-generate-body`: `"+ New project"`→`"New project"` (scope to `page.getByRole("main")` — the sidebar IconButton is also named "New project" ⇒ strict-mode collision otherwise), `"+ Add agent"`→`"Add agent"`, `"+ Add workflow"`→`"Add workflow"`, `"↧ Import existing .claude/"`→`"Import existing .claude/"`, `"Publish ▸"`→`"Publish"`; unit `CancelControl.test` `"■ Stop run"`→`"Stop run"` (trigger and confirm never co-exist — verified). Keep as text (not icon-ised, low value, tested): `← Agents`, `← back`, `↓ N new · Jump to latest`, `▼ following`, `⋯ truncated…`, `◼ interrupted…`, `✓ Folder exists`, `✓/✗` result lines |
| R-3 | e2e may already be stale (`getByText("·draft")` while Badge renders "draft") | record a **baseline** `npm run test:e2e` result before P1; only regressions vs baseline count |
| R-4 | **Opacity modifiers on var colours render solid** | fixed in P1 (6.2.4) + guard U-G2 |
| R-5 | **tailwind-merge drops `text-<scale>`** | `extendTailwindMerge` in P1 + U-U1 |
| R-6 | Size growth (10→11, 11→12px, glyph w-3→w-3.5) overflowing fixed boxes: graph node 40px, NodeTokenBadge, AgentTree rows, RunBar, sidebar rows | QA screenshots at 1280 and 1050px; node label `truncate`; badges `text-overline` only |
| R-7 | Tailwind JIT cannot see dynamic class strings | never build class names by concatenation (`"text-" + tone`); use full literal maps (`const TONE = { danger: "bg-danger-soft text-danger-text", … }`). Existing literal maps (StatusGlyph GLYPHS, RunBar) stay literal |
| R-8 | next/font variable wiring | the three `.variable` classes must be on `<html>` (Tailwind `fontFamily` reads them); verify computed `font-family` in QA V-1; build needs network for Google font download (unchanged from today) |
| R-9 | Graph inline styles computed at runtime | only `var(--…)` strings in `style`; SVG `fill`/`stroke` via classes (`fill-graph-dot`, `stroke-mint`) or `style`, never presentation attributes with var() |
| R-10 | Reduced motion | global block kept; StatusGlyph `motion-safe:animate-livePulse`; edge `animate-dashFlow` and node `animate-glowPulse` already covered |
| R-11 | Focus visibility | 7× `outline-none` + `focus-visible:ring-*` would override the global focus rule; remove them (Input/Select/Textarea use border + halo instead, which is the DS rule); guard U-G6 |
| R-12 | Bare `border` previously defaulted to gray-200 | `borderColor.DEFAULT = var(--line)`; QA looks for unexpected hairlines |
| R-13 | z-index inversion: toast (z-50) currently equals dialog | toast → z-toast(70), tooltip/menus → z-menu(60), drawer z-drawer(40), dialog z-dialog(50); local `z-10/20` inside graph stacking contexts stay numeric |
| R-14 | Publish gate / conflict blocking | logic-frozen lines (6.0); QA J-P3 proves the conflict file cannot be written without explicit Overwrite and that "Write to disk" is disabled when nothing is selected |
| R-15 | Daemon disconnect mid-edit | unchanged logic; restyled Banner/ribbon must still render the exact words "daemon disconnected" (e2e) and Save/Publish/Generate stay disabled (QA J-D1) |
| R-16 | Hand-edited managed file / foreign file / invalid frontmatter / re-publish unchanged | unchanged daemon/core behaviour; only their UI states are restyled — QA covers each (conflict Banner, foreign-merge Banner, MarkdownTab error line, "Nothing to write") |
| R-17 | Static export (`output: "export"`) | no server components with runtime CSS; CSS vars resolve client-side; nothing new to export |
| R-18 | Sidebar collapse SSR flash | `useMediaQuery` defaults to expanded on first render (static HTML), collapses after hydration on narrow screens — acceptable, no layout-dependent logic |

### 6.10 Flaws in the spec / design system (critical review)

- **F-1 Opacity-modifier incompatibility** is not mentioned anywhere: a straight "point colours at CSS vars" migration silently turns 40 tinted grounds into solid fills. Handled in P1.
- **F-2 Non-text contrast**: `line-strong` is 1.58:1 on `bg-app` (1.47 light). The DS accepts this for inputs, but the **unchecked Checkbox/Radio is identified only by its border** → fails WCAG 1.4.11. Decision D-9: Checkbox/Radio unchecked border uses `ink-muted` (5.2:1); inputs keep `line-strong`.
- **F-3 `ink-faint` (2.79:1)** is the natural target for the 79 `text-text-faint` usages, many of which are readable metadata/section labels. Alias maps them to `ink-muted`; `ink-faint` only where the DS allows. StatusGlyph `interrupted/thinking/unknown` in `ink-faint` still conveys state below 3:1 — mitigated by `aria-label` and adjacent words; flagged for the designer.
- **F-4 `ink-muted` on `surface-active` = 4.25:1** (fails AA) — never place muted text on the selected segment/pressed ghost; segmented thumb uses `ink`.
- **F-5 Token collisions**: `line` == `surface-hover` (#242833) and `line-soft` == `surface-active` in dark → hairlines disappear under a hovered row; `success` (#7ee8b5) and `mint` (#3ddc97) are both green, weakening "status is separate from accent". Not blocking; designer follow-up.
- **F-6 Draft colour contradiction**: README says `warning` = draft; components.md Badge says draft is the default (neutral) badge. Chosen: neutral (component card is the more specific rule; draft is a normal state, not a warning).
- **F-7 BuilderDrawer contradiction**: Tabs card lists BuilderDrawer among tab styles to convert, SegmentedControl card lists "Form/Markdown in the builder". Chosen: SegmentedControl (two editors of one object = a mode).
- **F-8 DS depicts data/behaviour that does not exist**: RunBar step "3 of 5", progress, token total, "Agents" and "View summary" actions; Sidebar Pinned (no pin data), Recent (would need cross-component "open builder" wiring), user avatar/name, Search, manual collapse button, "New workflow" and "Graph" nav items (graph is a project mode, not a route); Composer + greeting name; Settings Appearance; DiffView **line-level** diff with line numbers (current publish lists files only; core has no line-diff function, adding one = core change); a "I've reviewed the diff" Checkbox gate (adding it = publish behaviour change). All OUT for this pass; rendered only where data exists.
- **F-9 Copy/i18n premise is stale**: scope says "keep Vietnamese copy and i18n" but `i18n-english` already converted UI copy to English and there is **no i18n layer and no Settings → Language**; only a few Vietnamese strings remain (`Theo markdown`, `Xong`, `[Chèn $ARGUMENTS]`), and `<html lang="vi">` now mislabels English content (screen readers). Not changed here (out of scope); recommend a separate fix.
- **F-10 README mapping is incomplete**: no rule for mono text, `text-xs/sm/lg` (202 usages) or 15/23px headings — superseded by 6.2.3.
- **F-11 Toast**: DS says errors persist until dismissed; today all toasts auto-dismiss at 2.2s and the store has no close affordance. Kept as-is (behaviour change) — follow-up.
- **F-12 Missing primitives the code needs**: Radio (RunSettingsSection), Select/Field (raw selects in PublishDialog, SettingsShell, ModelPicker), popover/menu surface (RunHistoryPopover, AgentInstancePicker, RunCommandPalette, GraphLegend), Spinner (GraphEdgeLabel, generate buttons), Breadcrumb (AgentsPanel). Added minimally (Radio, Select, Field, `menuSurfaceClass`); spinner/breadcrumb composed from tokens in place.
- **F-13 GraphNode spec vs layout engine**: DS node (196px, two lines) conflicts with the fixed 160×40 dagre estimate and persisted positions. Kept 160×40 (D-5).
- **F-14 Missing graph states in DS**: done, cancelled, highlighted, justAdded, run-halo, dimmed, unlinked chip, connectable handle — mapped in 6.7.
- **F-15 Skill Kind icon** unspecified — chose `Sparkles`.
- **F-16 Lint gate is not runnable**: `apps/web` has no ESLint config/dependency; `next lint` prompts interactively and `next build` skips lint. "Lint passes" cannot be a gate as written; replaced by `tsc --noEmit` + the guard test. Adding ESLint is out of scope.
- **F-17 "One primary per view"** vs ≈32 default-variant Buttons: the `default→primary` alias keeps churn low but would put several mint buttons on one view; P4 demotes per view (empty-project state, ConflictResolver, dialogs: only the step's main action stays primary).

### 6.11 Decisions & assumptions (for dev / Checker)

- D-1 Colour tokens are CSS vars with full values (no channel triplets); opacity modifiers on token colours are banned.
- D-2 Alias layer maps old keys → new vars (6.2.4); deleted in P6. `text-faint` → `ink-muted`.
- D-3 `fontSize` is extended in P1, made exclusive in P6.
- D-4 tailwind-merge extended in P1.
- D-5 Graph node footprint frozen at 160×40; inline opacity kept.
- D-6 ProjectView keeps stacked Workflows/Agents sections — **deviation from scope item 6 ("Tabs")**: tabs would hide one list (IA change) and break e2e flows that use both "Add" buttons. If the user insists on Tabs, it is a follow-up with e2e updates.
- D-7 AgentsPanel raw log stays a button (tests click `name: "Raw log"` / `"← back"`); AuthorTabs is the only Tabs consumer this pass; BuilderDrawer uses SegmentedControl.
- D-8 Sidebar shows only existing data: Logo, nav (Project `/` with "New project" IconButton, Templates, Settings), "Projects" group = existing project list with remove IconButton (`Remove {name}` label kept), daemon status row. Drag-resize kept (default 288, clamp 240–400, same storage key); collapsed (<1100px) is a fixed 56px icon rail with Tooltips and no resize. The stale hard-coded caption "v0.3.0 · daemon" is dropped.
- D-9 Checkbox/Radio unchecked border = `ink-muted` (F-2).
- D-10 No line-level diff, no reviewed-checkbox gate, no RunBar progress/agents button, no Composer.
- D-11 CodeMirror theme via `var()`; explicit deps `@codemirror/language`, `@lezer/highlight`; `yamlFrontmatter` optional.
- D-12 Light tokens defined under `[data-theme="light"]`; nothing sets `data-theme`.
- D-13 Icons: lucide 16px, `strokeWidth={1.6}`, `aria-hidden`; StatusGlyph characters and in-copy arrows stay text.
- D-14 Disabled = `opacity-45 cursor-not-allowed`, never hidden.
- A-1 lucide-react@0.439 has every icon named here (`Slash`, `Bot`, `Sparkles`, `MoreHorizontal`, `SquareCheck`, `Square`, `Upload`, `FolderPlus`, `Maximize2`, `History`, `RefreshCw`, `Copy`, `Trash2`, `LayoutGrid`, `Settings`, `Folder`, `FileText`, `X`, `Check`, `AlertTriangle`, `Info`, `XCircle`, `CheckCircle2`). If one is missing in that version, pick the nearest existing glyph; do not upgrade lucide.
- A-2 No component relies on Tailwind's default `rounded-md` = 6px or `rounded-lg` = 8px for geometry (3 and 1 usages; visual only).

### 6.12 Acceptance (what /review and /qa check)

1. Invariants 6.0 hold (`git diff --stat master -- apps/daemon packages` is empty; publish logic lines unchanged).
2. `npm run build`, `npx tsc --noEmit -p apps/web`, `npm run test:web` (incl. new guard/unit tests) green; `npm test` (all projects) green; e2e no worse than the pre-P1 baseline.
3. Grep gates in the testplan §2 return zero hits.
4. chrome-devtools journey in the testplan §4 passes with screenshots.

Test plan: `docs/loops/ui-design-system-testplan.md`.

## 11. BUILD — implementation notes

Maker: feature-builder. Not self-reviewed; every item under "Assumptions" and "Unsure" is for the Checker to verify.

### 11.1 How the work was organised (deviation from the plan's phase mechanics)

The plan's alias layer (6.2.4, P1 to P6) was **not built**. The colour/size/radius/shadow renames were applied to every non-test `.tsx` call site with a one-off codemod in P1, and `tailwind.config.ts` was written directly in its final shape (top-level `theme.fontSize`, no `LEGACY_ALIASES`, no legacy radii/shadows). P1 and P6 therefore collapsed into one step; the app never sat in a half-aliased state, but "P1 only" intermediate visuals do not exist. The final state satisfies the P6 acceptance list. P2-P5 were then done by hand on top. Codemod rules: old-name map (6.2.4), opacity-modifier fixes (6.2.4 table), `bg-white/..` / `bg-black/50` / `border-white/..` swaps, the 6.2.3 size map with mono detection (`font-mono` in the same class string), `font-bold` to `font-semibold` (`font-medium` on mono), `tracking-[...]` removal, `text-white` to `text-on-mint` / `text-on-danger` where the same string has a mint/danger fill. A second sweep: form labels, `text-danger` to `text-danger-text` (all copy; `ui/status-glyph.tsx` keeps `text-danger`), `Cancel` buttons to `ghost`.

### 11.2 Files changed per phase

**P1 tokens/fonts/tailwind/merge** - `apps/web/src/app/globals.css` (kept the earlier partial edit after verifying every colour/shadow value against tokens.json, dark and light; body/focus/selection/scrollbar rules), `apps/web/tailwind.config.ts` (rewritten), `apps/web/src/app/layout.tsx` (Bricolage Grotesque / Instrument Sans / IBM Plex Mono; `<html lang>` untouched), `apps/web/src/lib/utils.ts` (`extendTailwindMerge`), codemod over ~95 `.tsx`. NEW tests: `lib/utils.test.ts`, `designTokens.test.ts` (tokens.json, globals.css and tailwind agree), `designSystemGuard.test.ts` (rules G1-G6, all enabled, green).

**P2 primitives** (`components/ui/`) - rewritten: `button.tsx` (cva, `icon` prop, aliases default=primary / destructive=danger), `badge.tsx`, `dialog.tsx` (role=dialog / aria-modal / aria-labelledby via context, `DialogClose`, scrim keeps `fixed`), `input.tsx` (+`Textarea`, `Select`, `Field`), `checkbox.tsx` (+`Radio`, optional `label`), `row-menu.tsx` (+`MenuItem`, `MenuDivider`, `menuSurfaceClass`, Escape closes, trigger is an `IconButton`, accessible name stays "Options"), `tooltip.tsx` (inverted, 400 ms hover delay, `side` incl. an extra `"right"`), `toast.tsx`. NEW: `icon-button.tsx`, `kind.tsx`, `tabs.tsx`, `segmented-control.tsx`, `banner.tsx`, `status-glyph.tsx` (moved with `git mv` from `run/agents/StatusGlyph.tsx`; 6 importers updated; pulse is now `motion-safe:animate-livePulse`; interrupted/thinking/neutral/unknown are `text-ink-faint`), tests `ui/primitives.test.tsx` (U-P1..P12), `ui/status-glyph.test.tsx` (StatusGlyph block moved out of `run/agents/primitives.test.tsx`). `CancelControl.tsx` / `PreflightStrip.tsx` size overrides became `size="sm"`; the `CancelControl` trigger is `icon={Square}` + text "Stop run" (test queries updated).

**P3 shell** - NEW `components/shell/Sidebar.tsx`, `shell/NavItem.tsx`, `shell/Logo.tsx`, `shell/Sidebar.test.tsx` (5 tests), `lib/hooks/useMediaQuery.ts`. `AppShell.tsx`, `SettingsShell.tsx`, `TemplatesView.tsx` use `Sidebar`; `DaemonStatusBadge.tsx` restyled (+`compact` form). DELETED `AppRail.tsx`, `rail/NavItem.tsx`, `ProjectSidebar.tsx`, `AppNav.tsx`. Sidebar shows only data that exists (Logo, Project/Templates/Settings nav, "New project" IconButton, project list with the `Remove {name}` IconButton + the original `window.confirm` + toast logic, daemon row). Drag-resize kept (key `symbion:rail-width`, default 288, clamp 240-400, so an old stored 236 now clamps to 240). **Collapse toggle (user addition)**: IconButton "Collapse sidebar" / "Expand sidebar" folds it to a 56px icon rail (`w-rail`, `data-collapsed`), persisted in `localStorage` key `symbion:rail-collapsed` inside try/catch; viewports under 1100px (`useMediaQuery("(min-width: 1100px)", true)`) are forced to the icon rail and the toggle is hidden there. The rail has Tooltips (right side), project initial buttons (accessible name = project name) and a compact daemon indicator (sr-only text keeps "daemon connected/disconnected").

**P4a** - `EmptyState`, `ProjectView` (stacked Workflows/Agents kept; ListRow = local `renderRow` helper with `Kind`, mono `/name`, draft `Badge`; `SegmentedControl` List/Graph; Publish `icon={Upload}`; project "Delete" is `danger-outline sm`, copy unchanged), `BuilderDrawer` (SegmentedControl "By description" / "Theo markdown", IconButton close, `rounded-l-xl bg-surface`, `font-display text-dialog-title`), `AgentForm` / `WorkflowForm` (Textarea, lucide chevrons/X/Plus), `LivePreviewPane`, `ModelPicker` (`Select`), `GenerateBody*`, `CreateProjectDialog` (scan error is a `Banner`), `FileTreePicker` (lucide, `Select`), `ImportReviewStep` (`Select`, `Checkbox`), `ProjectPickerStep` (`Radio`, `Search` icon), `WorkflowDetectionPanel`, `CopyRunCommandDialog`, `publish/PublishDialog` (`Field` + `Input`, `aria-pressed`, `SquareCheck`/`Square`, `Checkbox label`, Cancel ghost, "Preview changes" lg), `publish/PublishDiffView` (`Checkbox` + mono path + state `Badge` New/Updated/Unchanged/Conflict; foreign-merge and disconnected/write-error as `Banner`; "Write to disk" `size="lg"`), `publish/ConflictResolver` (danger `Banner`, Keep outline + `aria-pressed` + `bg-surface-active`, Overwrite `danger` / `danger-outline`), `publish/PublishResultView` (`Check` icon, error `Banner`s).

**P4b** - `TemplatesView` (display page title, `max-w-content-wide`), `AuthorTabs` (composes `Tabs`, `aria-label="Template authors"`), `TemplateSection` (auto-fill 300px grid), `TemplateCard` (`Kind` + plain `Badge`), `TemplatePreviewModal` (kind `Badge`), `ApplyResultPanel`, `AuthorFetchLoadingState`, `SettingsShell` (page title "Settings", `h2` section headings `text-title`, a `Select` inside NEW `components/SettingRow.tsx`), `ProvidersPanel` (status as `Badge`, card styling), `run/RunSettingsSection` (`Radio`, `Checkbox`, `Plus`).

**P5 graph + run + CodeMirror** - NEW `graph/nodeRings.ts` (+`nodeRings.test.tsx`); `graph/AgentNode.tsx`, `CommandNode.tsx` (Kind tile, `bg-surface`, var()-only rings, inline `style.opacity` and class `group` kept), `MissingAgentNode.tsx`, `NodeMenu.tsx` (`Play` icon, label "Execute…"), `NodeTokenBadge.tsx`, `GraphEdgePath.tsx` (var() strokes), `GraphCanvas.tsx` (`bg-deep`, ghost line `stroke-mint`), `DotGridBackground.tsx` (rewritten: pitch 16, r 1.2, `fill-graph-dot`; old library-fidelity comment removed), `GraphToolbar.tsx` / `GraphCanvasMenu.tsx` (labelled ghost `Button`s with lucide icons, `MenuItem` / `menuSurfaceClass`), `GraphEdgeLabel.tsx`, `DaemonRibbon.tsx` (danger `Banner` + Retry), `GraphHintBar.tsx`, `EdgeRelationModal.tsx` (`Textarea`, `aria-invalid`), `DependencyGraph.tsx` (History/X icons, `bg-deep`). Run: `RunBar.tsx` (in-flow dock card, `StatusGlyph`, mono name, IconButton dismiss), `RunDialog.tsx` (Execute button `Play`/`Loader2`, text "Execute" / "Execute anyway" / "Starting…"), `RunCommandPalette.tsx`, `PastRunBanner.tsx`, `RunSummarySection.tsx`, `run/agents/RawEventLog.tsx` (`bg-deep`), `RunFinishedStrip.tsx`, `AgentInstancePicker.tsx`, `AgentsPanel.tsx`, `TranscriptRowView.tsx` (thinking label `text-ink-faint`). CodeMirror: NEW `lib/codemirror/theme.ts` (+`theme.test.ts`), `MarkdownTab.tsx`, `TemplateMarkdownViewer.tsx` (`theme={symbionEditorTheme}`, rounded bordered wrapper), `apps/web/package.json` + two lines in root `package-lock.json` (`@codemirror/language ^6.12.4`, `@lezer/highlight ^1.2.3`; the workspace entry was hand-edited, no `npm install` was run).

**P6** - nothing to remove (no aliases). Guard test fully enabled. `CLAUDE.md` NOT edited (plan: only if /ship agrees).

**Tests updated for old class/glyph text** - `graph/NodeHandle.test.tsx` (`bg-workflow`, `border-line-strong`), `run/agents/transcript.test.tsx` (`text-ink-faint`, `text-ink`), `run/CancelControl.test.tsx` ("Stop run"), `run/agents/primitives.test.tsx` (StatusGlyph block removed). e2e specs `e2e/happy-path.spec.ts`, `e2e/auto-generate-body.spec.ts` updated per R-2 ("New project" scoped to `main`, "Add agent/workflow", "Import existing .claude/", "Publish" exact, sidebar project button via `getByRole("complementary")` regex, `·draft` replaced by exact "draft").

### 11.3 Commands run and results (final state)

- `npx vitest run --project web`: **32 files / 202 tests pass** (24 / 161 at start; +8 files, +41 tests).
- `cd apps/web && npx tsc --noEmit`: 0 errors other than jest-dom matcher typing errors (`toBeInTheDocument` etc.) that already existed at baseline (14 lines at baseline; 30 now only because my new test files also use `toBeInTheDocument`). No new non-matcher errors. The matcher-typing gap itself is pre-existing and not fixed.
- `npm run build -w @symbion/web`: pass after P1, after P3 and at the end (`Compiled successfully`, 6/6 static pages). `next build` does not lint (no ESLint config, F-16).
- `npm test` (all projects): web all green; **15 daemon test files / 58 tests fail** (symlink / permission / backup-copy tests such as `importLifecycle.security.test.ts`, `importTree.test.ts`). No file under `apps/daemon` or `packages/` was touched (`git diff --stat master -- apps/daemon packages` is empty), so these look like Windows-environment failures; NOT verified against a clean master baseline. Checker: confirm they fail identically on master.
- `npm run build -w core -w rpc-types -w daemon` was run once while trying e2e (the `dist` dirs are git-ignored).
- e2e: **could not be run, no baseline possible**. `e2e/daemon-fixture.ts` still requires the retired `?t=<token>` boot URL (`URL_RE`), so the fixture times out before any UI loads, and no Playwright browser is installed. Selectors were updated by reading only. A hand-made smoke (static `apps/web/out` served locally, Edge via `channel: "msedge"`) loaded `/`, `/settings`, `/templates` at 1280 and 1000 px: Instrument Sans is the computed body font; expanded sidebar, collapsed rail, empty state and template grid rendered. Screenshots were only eyeballed by the Maker; no journey (project / builder / publish / graph / run) was exercised in a browser.

### 11.4 Remaining grep-gate results (testplan §2, `apps/web/src`)

G1 hex in `.tsx`: 0. G2 `text-[N`: 0, `tracking-[`: 0. G3 `bg|border|text-(white|black)`: 0. G4 palette leftovers: 0. G5 opacity modifier on a token colour: 0. G6 legacy names: 0 (two comment hits reworded); default sizes / `font-bold` / `outline-none`: 0. G7 `theme="dark"`: 0. G8 unicode stand-ins: only comments, tested copy and the items listed in 11.6. G9 removed files: all gone. G10: one pre-existing product-copy hit (`TemplatesView.tsx`: "Get inspired by community template sets (e.g. ECC)", the template-library link text, not a design reference; left unchanged). G11 scope: `git diff --stat master -- apps/daemon packages` is empty. G1-G6 are also enforced by `designSystemGuard.test.ts`.

### 11.5 Assumptions the Checker must verify

1. Publish logic is unchanged: in `publish/PublishDiffView.tsx` and `ConflictResolver.tsx` the initial-selection filter, `toggle`, `handleWrite`, `onResolve`, the write gate `disabled={nothingToWrite || selected.size === 0 || writing || !daemonConnected}` and `resolution !== "overwrite"` are identical (only className / JSX around them changed; the Keep button uses `resolution !== "overwrite"` for `aria-pressed` and styling only). Please diff.
2. Codemod risk: my first-occurrence string replacements once hit a doc comment instead of JSX (`MissingAgentNode`, fixed). Skim for other comment/JSX mix-ups and for class names that exist in no stylesheet (spot-checked in the built CSS: `h-control-*`, `w-rail`, `text-code-sm`, `z-menu`, `fill-graph-dot`, `animate-livePulse`, `ring-mint-soft`, `aria-[invalid=true]:border-danger` are present).
3. Plan deviations: (a) no alias layer (11.1); (b) graph nodes use `min-h-10` + flex column instead of a fixed `h-10` because `NodeTokenBadge` renders a second line inside the node; width stays 160/200 via `GraphNode` and dagre `NODE_HEIGHT` is untouched, so anchors are exact only when no badge is shown (before this change nodes were about 34px and auto-sized); (c) `Tooltip` got `side="right"`; (d) toolbar/menus keep visible text labels ("Add", "Fit to view") with lucide icons instead of icon-only buttons; (e) `outline-none` became `focus-visible:outline-0` on three non-field elements (`AgentsPanel` root and `AgentInstancePicker` with `tabIndex={-1}`, the `RunCommandPalette` input) so the global focus rule is suppressed there on purpose; (f) Settings section headings are `h2` under a new `h1` "Settings".
4. Copy is preserved except: leading glyphs replaced by icons ("+ New project" to "New project", "+ Add agent/workflow", "Publish ▸" to "Publish", "↧ Import…", "■ Stop run" to "Stop run", "▶ Execute…" to "Execute…", "▶ Run again" to "Run again", checkbox glyphs, clock glyph, the "⦿" in the daemon ribbon, the "ℹ"/"⚠" lead glyph on the publish foreign-merge and disconnected lines, "✗ Write failed:" to "Write failed:", conflict title "! CONFLICT —" to "CONFLICT —"); the DiffView state words; the "Settings" title; the sidebar group label "Projects" and "No projects yet" (was "∅ no projects yet"); the dropped hard-coded "v0.3.0 · daemon" caption.
5. Behaviour / a11y side effects to confirm: `Dialog` now has `role="dialog" aria-modal`; `DialogFooter` is full-bleed with a top border (`-mx-6 -mb-6`, assumes every Dialog panel keeps `p-6`); the disconnected `DaemonStatusBadge` is `role="alert"`; `ConflictResolver` is a danger `Banner` (`role="alert"`, one per conflicted file); the `RowMenu` trigger gained `aria-haspopup` / `aria-expanded`; Tooltip hover now has a 400 ms delay (no hover tests found, but QA should check the `GenerateBodyButton` / `ModelPicker` tooltips); `Button` still does NOT default `type="button"` (unchanged).
6. Tailwind specifics: `text-label` carries weight 500 and `text-overline` weight 600, so dense text that used `text-[13px]` / `text-[10px]` changes weight; `rounded-md/lg/sm` now mean 10/14/8px (visual only). `bg-panel` became `bg-app` and `bg-code` became `bg-sidebar` everywhere via the codemod; only `RawEventLog` and the run-summary stderr `<pre>` got `bg-deep`. Other former panel rows (list rows, cards) may deserve `bg-surface` or no ground: designer call.
7. Sidebar: `localStorage` access is guarded; jsdom's `localStorage` is broken under this Node (25), so the Sidebar test installs an in-memory stand-in.
8. The CodeMirror wrapper adds `overflow-hidden rounded-lg border border-line`; `theme.ts` is variable-only (CodeMirror theme CSS resolves `var()`).
9. `package-lock.json` hand-edit (two dependency lines): verify `npm install --package-lock-only` is a no-op.
10. `docs/design-system/` and the two loop docs were untracked at the start; only this STATE file was edited. The earlier partial `globals.css` was kept (values re-verified by the token test).

### 11.6 Deferred / not done / unsure

- Not done: browser QA of the journey (QA stage), light theme (out of scope), e2e execution (fixture stale), the `CLAUDE.md` line.
- Left as text (tested or in-copy, per R-2): disclosure chevrons in `RunDialog`, `RunSummarySection`, `AgentGroups`, `PromptBlock`, `TranscriptRowView`; the reconnecting / LIVE spinner glyphs in `RunBar`, `MissionStatusStrip`, `TokenBreakdownCard`; `↳ symlink` / `↳ +n`; the copy glyph in `StepPreview`; the legend glyphs in `GraphLegend`; `⚠` / `✓` / `✗` lead glyphs inside many sentences; `← back`; `Open project →`.
- Not adopted (per plan decisions): Tabs in ProjectView, RunBar progress / agents button, Composer, line-level diff, reviewed-checkbox gate.
- Unsure: (1) node `min-h-10` vs fixed `h-10` with persisted positions; (2) the edge base colour `var(--line-strong)` on `bg-deep` is very low contrast (plan-mandated; the designer may want `ink-faint`); (3) `ProviderStatusPill` still uses coloured dot glyphs rather than a `Badge`; (4) Toast still auto-dismisses errors after 2.2 s (F-11, unchanged); (5) the project-level "Delete" button keeps the word "Delete" although its semantics are remove-from-list (copy preserved).

## 12. REVIEW — code-reviewer + architect (static read, no tests run)

Verdicts: code-reviewer **PASS**, architect **PASS**. No blocking findings. /cso not triggered (no daemon / packages / fs-write / secrets in the diff).

Verified: publish gate + conflict handling unchanged (class/markup/aria only); handlers preserved; twMerge extended for the new scale; no dynamic Tailwind class construction; sidebar localStorage in try/catch and read after mount; global focus-visible ring kept; guard tests cover grep gates; daemon/packages untouched.

Follow-ups (not blocking, carry to QA / next change):
1. Sidebar state is per-shell, so a collapsed sidebar flashes expanded for one frame on navigation — lift state into a shared layout/context.
2. `darkMode: "class"` and `codemirror/theme.ts` `{dark:true}` are dead wiring until a light theme exists.
3. Graph edge base colour `line-strong` on `bg-deep` is low contrast (plan flaw) — consider `ink-faint`.
4. Run `npm install --package-lock-only` to confirm the two hand-edited lockfile lines are a no-op.
5. `min-h-10` graph nodes vs dagre NODE_HEIGHT: edge anchors may be slightly off when the token badge renders — check in QA.
6. Danger `Banner` uses role="alert" per conflicted file — check it is not noisy; `Sidebar.tsx` writes localStorage inside a state updater (impure, harmless).
7. Not exercised: e2e (fixture still expects the retired `?t=` boot URL), browser journeys, and the 58 daemon test failures need a master baseline comparison.

## Phase: REVIEW PASS → next /qa (skipped by request; committed without QA)
