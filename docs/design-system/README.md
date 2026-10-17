Symbion is a local tool for authoring AI-coding workflows (slash commands) and agents, seeing how they depend on each other, and publishing them into a repository's `.claude/` folder and `AGENTS.md`. The interface is a calm, dark workspace: a sidebar of projects and recent items, one focused main area, and a single mint accent for the action that matters. Everything that writes to disk is shown before it happens.

## Content fundamentals

- **Voice.** Plain, short, and specific. Say what happens: "Publish", "Write 4 files", "Copy run command". After it happens, use the past tense: "Published 4 files to symbion-demo".
- **Person.** Address the user as "you". Symbion speaks about itself by name only when needed ("Symbion's version"). The home greeting uses their name: "What are we automating, huy?"
- **Casing.** Sentence case everywhere: buttons, titles, menu items. Uppercase only in the `overline` style (sidebar group labels, badges).
- **Names of things.** Use the user's words. Say *workflow* (not "command") and *agent* (not "subagent") in the UI. Write workflow names as `/ship` in mono and agent names as `feature-builder`.
- **Errors.** Name the problem, then the fix: "reviewer.md was edited by hand. Keep the file on disk or overwrite it with Symbion's version." Don't apologise, and don't write "Something went wrong".
- **Safety copy is factual.** "Nothing is written until you confirm." Don't reassure with adjectives.
- **No emoji.** Status glyphs (◉ ✓ ✗ ○) are part of the run vocabulary. They are not decoration.
- **Language.** Copy ships in Vietnamese and English (`<html lang>` follows Settings → Language). Keep the same tone in both. Leave identifiers, paths and model ids untranslated.

## Visual foundations

### Color

- **Theme.** Dark is the primary theme and Light mirrors it; both are defined for every token. Neutrals are cool slate with a slight blue bias.
- **Grounds.** `bg-app` is the main area and `bg-sidebar` the sidebar and code wells. `surface` is for anything raised: composer, inputs, menus, dialogs, graph nodes. Use `surface-hover` for hover and the selected nav item, and `surface-active` for the on segment of a segmented control.
- **Text.** Use `ink` for primary text, `ink-2` for nav and list labels, and `ink-3` for secondary values. Descriptions and metadata use `ink-muted`, which keeps 4.5:1 contrast on all three grounds in both themes. `ink-faint` is only for placeholders and disabled text.
- **Accent.** `mint` is the one accent. It fills the primary button, the send button, the logo, the selected node ring and the selected filter chip. Text on mint is always `on-mint`, never white. Link text uses `mint-text`.
  - Spend mint sparingly: one primary action per view.
- **Kinds.** Workflows are `workflow` (amber) and agents are `agent` (blue), each with a `-soft` ground for tiles and badges. Skills use `skill`. Kind colour appears on the Kind tile and on badges, never as large fills.
- **Status.** Statuses are separate from the accent:
  - `success`: done, published, connected
  - `running`: live run
  - `warning`: draft, lossy, drift
  - `danger`: conflict, error, disconnected

  Each has a `-soft` ground. A status always carries a word or a glyph too.
- **Lines.** `line` is for hairline dividers, `line-soft` for card outlines and `line-strong` for control borders. Separate rows with hairlines rather than boxing each one.

### Type

| Style | Family | Use |
|---|---|---|
| `greeting` | display (Bricolage Grotesque 600) | The home greeting |
| `page-title` | display | One per screen |
| `dialog-title` | display | Dialogs, drawers and empty states |
| `title` | Instrument Sans | Section headings |
| `body` | Instrument Sans | Prose and the composer |
| `ui` | Instrument Sans | Default for rows, inputs and buttons |
| `label` | Instrument Sans | Small buttons, chips, tabs and form labels |
| `caption` | Instrument Sans | Metadata and help text |
| `overline` | Instrument Sans | Uppercase labels |
| `code`, `code-sm` | IBM Plex Mono | Paths, `/commands`, editors, diffs, logs and token counts |

- **Display tracking.** Display styles use tight tracking (-0.02em). Never use the display face below 20px.
- **The scale is closed.** Map the old arbitrary sizes onto it:
  - 9.5, 10 and 10.5px → `overline`
  - 11, 11.5 and 12px → `caption`
  - 12.5 and 13px → `label`
  - 13.5px and `text-sm` → `ui`
- **Numbers.** Columns of numbers (durations, tokens, counts) use `font-variant-numeric: tabular-nums`.

### Spacing and layout

- **Grid.** Spacing is a 4px grid: `space-1` to `space-12`.
- **Main area.** The main area is padded `space-10`. Content is centred at `content-max` (920px) for Home and Settings, and at `content-wide` (1040px) for Project and Templates.
- **Sidebar.** `sidebar-width` is 288px. It collapses to a 56px icon rail below 1100px.
- **Builder drawer.** The drawer is `drawer-width` (560px) from the right. The live preview adds a column beside it on wide screens.
- **Gaps.** Sections are `space-6` apart, cards `space-4`, and buttons in a row `space-2`.

### Shape, depth and borders

- **Radii.**
  - `radius-md` (10px): buttons, inputs, nav items and rows
  - `radius-lg` (14px): cards, panels, graph nodes and toasts
  - `radius-xl` (20px): composer and dialogs
  - `radius-pill`: badges and chips
- **Shadows** mark floating layers only:
  - `shadow-menu`: menus and tooltips
  - `shadow-dialog`: dialogs and the drawer
  - `shadow-toast`: toasts and the run bar
  - `shadow-composer`: the composer

  Cards sitting on the page take an outline, not a shadow.
- **Stacking.** Use the `zIndex` tokens: rail < run bar < drawer < dialog < menu < toast.

### States and motion

- **Hover** fills `surface-hover`.
- **Focus** is a 2px solid `focus-ring` outline with a 2px offset, on every interactive element. Inputs add a 3px `mint-soft` halo.
- **Disabled** is 45% opacity, still visible. Example: "Write 4 files" before the diff is reviewed.
- **Motion** is short and functional:
  - 120ms colour transitions
  - dialog pop-in
  - pulsing glyphs only while a run is live
  - flowing dashes on running edges

  Under `prefers-reduced-motion`, everything stops.

### The graph

- **Canvas.** `bg-deep` with a `graph-dot` dot grid at 16px.
- **Nodes.** `surface` cards with a Kind tile. States show as rings: `mint` selected, `running` live, `danger` error. A missing agent has a dashed `line-strong` outline.
- **Edges.** `line-strong`, `running` when live, dashed `danger` when broken.

## Iconography

- **Library.** Use `lucide-react` (already a dependency) at 16px with a 1.6 stroke, in `currentColor`. Icons sit `space-2` before their label.
- **Remove the stand-ins.** Replace the unicode stand-ins (＋ ⤢ ⧉ ⟳ 🕘 ↳ ⚠) and the hand-drawn inline SVGs in `AppRail` with lucide icons.
- **Exception: status glyphs.** The status glyphs in StatusGlyph stay as text characters. They are the run vocabulary.
- **Kind marks.** A workflow is a slash in an amber Kind tile and an agent is a bot in a blue Kind tile.
- **Logo.** The mark is two overlapping mint circles, drawn as inline SVG (see Logo). There is no bitmap logo.

## Using this system in apps/web

- **One source for colour.**
  - Declare these tokens as CSS variables in `globals.css`, both themes, and point `tailwind.config.ts` colours at them. Delete the duplicate hex palette and the RGB-triplet legacy tokens.
  - Remove every `text-green-600` and `text-amber-*` class, every inline hex in `components/graph/*`, and every `bg-white/[.06]`. Use `surface-hover`, the status tokens and the kind tokens instead.
- **Fonts.**
  - Load Bricolage Grotesque (500, 600), Instrument Sans (400–600) and IBM Plex Mono (400, 500) with `next/font/google`.
  - Expose them as `--font-display`, `--font-sans` and `--font-mono`.
- **Components.** Each component card here describes one primitive in `components/ui/`. New primitives to add are Tabs, SegmentedControl, Banner, IconButton and StatusGlyph (moved from `run/agents`). Everything in the feature folders composes them.
- **Code editors.** CodeMirror gets one theme built from these tokens; see CodeBlock.
- **Safety stays visible.** Keep the diff-before-write flow, the conflict Banner and the disabled publish gate exactly as these components show them.
