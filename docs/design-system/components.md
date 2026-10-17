# Badge

A pill that names a kind or a state in one or two words, with a 6px dot in the same colour.

| class | words used in the app |
|---|---|
| `sy-badge--workflow` / `--agent` / `--skill` | the item kind |
| (default) | Draft, Unpublished, Managed |
| `sy-badge--success` | Published, Created, Updated, Connected, OK |
| `sy-badge--running` | Running, Starting, Checking |
| `sy-badge--warning` | Lossy, Drift, Needs model |
| `sy-badge--danger` | Conflict, Error, Failed, Disconnected |
| `sy-badge--plain` | versions and counts (no dot) |

- Overline type (11px, 600, uppercase, 0.04em). Colour is never the only signal: the word is required.
- Replaces `badge.tsx`, `ProviderStatusPill`, `GraphStatusChips` and the light-theme `text-green-600` / `text-amber-*` leftovers.

# Banner

An inline notice inside a screen or dialog for a condition that blocks or changes the next step: a publish conflict, a missing agent, a disconnected daemon.

- Soft ground (`danger-soft`, `warning-soft`, `success-soft`) with matching text; the first clause in `<strong>` (`ink`) names the problem, the rest says what to do.
- Sits above the thing it is about; never floats. Use Toast for transient results.
- Replaces the red `bg-danger/90` daemon banner.

# Button

Buttons start an action; the label says exactly what happens, verb first, sentence case ("Publish", "Write 4 files", "Copy run command").

## Variants
| class | use |
|---|---|
| `sy-btn--primary` | The one action the screen or dialog exists for. **At most one per view.** Fill `mint`, text `on-mint`. |
| `sy-btn--outline` | Secondary actions next to a primary, card actions ("Apply"). Border `line-strong`. |
| `sy-btn--ghost` | Tertiary and dismiss ("Cancel"), toolbar actions. |
| `sy-btn--danger` | Irreversible confirm only: "Overwrite" in the conflict resolver, "Delete project". Fill `danger`, text `on-danger`. |
| `sy-btn--danger-outline` | A destructive option offered beside safer ones. |

## Sizes
`sy-btn--sm` (control-sm, 30px) in toolbars, rows and cards; default (control-md, 36px); `sy-btn--lg` (control-lg, 40px) for the primary in a dialog footer.

## Rules
- Keep the publish gate: "Write N files" stays `disabled` until the diff is reviewed. Disabled = 45% opacity, never hidden.
- Icon before the label at 16px, `space-2` gap. Icon-only actions use IconButton.
- Code mapping: `variant="default"` → primary, `"outline"` → outline, `"ghost"` → ghost, `"destructive"` → danger. Delete the `overwrite-btn` red: use danger.

# Checkbox

A square 18px check with its label to the right, for independent on/off choices.

- Checked: `mint` fill with an `on-mint` tick; unchecked: `line-strong` border on `surface`.
- The whole label is the hit target.
- The publish gate ("I've reviewed the diff") is a Checkbox, never a switch.

# CodeBlock

Read-only file previews: the live preview pane, template viewer, run command, step previews.

- `bg-sidebar` well, `line` border, `radius-lg`; header row with file icon and path in code-sm, provider Badge on the right.
- Body in the code style (IBM Plex Mono 13/20). Syntax colours come from tokens: keys `agent`, strings `mint-text`, frontmatter fences `workflow`, comments `ink-muted`.
- Build one CodeMirror theme from these tokens and use it in `MarkdownTab` and `TemplateMarkdownViewer` instead of the built-in `theme="dark"`.

# Composer

The home screen's one input: describe a workflow or agent in plain words and Symbion drafts it.

- `surface`, `line-strong` border, `radius-xl`, `shadow-composer`; body type 15px.
- Bottom bar: attach (template), Workflow/Agent SegmentedControl, the model in caption `ink-muted`, send IconButton.
- Sits under the greeting (greeting style) with shortcut chips below it.

# Dialog

A modal for a focused task or a confirmation: Publish, Import, Create project, Run, Template preview.

- `surface` panel on the `overlay` scrim, `radius-xl`, `shadow-dialog`, max height 85vh; only the body scrolls.
- Title in the dialog-title style (display face, 22px); close IconButton top-right; footer right-aligned: ghost Cancel, then the one primary (or danger) action named with its verb.
- Multi-step dialogs (TemplatePreviewModal, RunDialog) show the step in the title area, not in a stepper bar.

# DiffView

The publish diff: one block per file, line numbers, +/− gutter, tinted added and removed lines.

- File header in mono with the file's state Badge: success "New", warning "Updated", danger "Conflict".
- Added lines `diff-add` with a `success` "+"; removed `diff-del` with a `danger` "−". Text stays `ink` so it reads on both tints.
- A conflicted file shows the Banner above its diff and blocks "Write N files" until resolved.

# EmptyState

What a screen shows when it has nothing yet: an icon tile, a dialog-title headline, one sentence, and at most two actions.

- Centered in the main area, `space-12` vertical padding; the mark tile is `surface` with a `mint` icon.
- Headline states the situation ("No projects yet"); the sentence says how to start.

# GraphNode

A workflow or agent on the dependency graph canvas, plus the edges between them.

- Node: `surface` card, `radius-lg`, Kind tile + name + mono subtitle. No solid kind fills: the Kind tile carries the kind.
- States as rings: selected 2px `mint`; running 2px `running` + soft glow; error 2px `danger`; missing agent = dashed `line-strong` outline, transparent.
- Edges 1.5px `line-strong`; running edges dashed and flowing in `running`; broken edges dashed `danger`.
- Canvas `bg-deep` with a `graph-dot` dot grid at 16px (`space-4`). Remove the inline hex styles in `graph/*`.

# IconButton

A square button holding one 16px icon, for toolbar, row and window actions where the icon is unambiguous.

- Always give it an `aria-label` and a Tooltip with the same words.
- Default 36px, `sy-iconbtn--sm` 30px in rows and dialog headers (close ✕, row ⋯).
- `sy-iconbtn--send` is the composer's submit: `mint` fill, `on-mint` arrow. Only in the Composer.
- Replaces the unicode glyph buttons (＋ ⤢ ⧉ ⟳) in the graph toolbar and rail.

# Input

Text inputs, selects and textareas share one shape: `surface` fill, 1px `line-strong` border, `radius-md`, 36px tall.

- Wrap in `sy-field` with a visible `sy-label` above; helper text in `sy-help` (caption, `ink-muted`) below.
- Focus: border turns `focus-ring` plus a 3px `mint-soft` halo.
- Errors: set `aria-invalid="true"` and put the message in `sy-error` (`danger-text`). Say what is wrong and how to fix it.
- Identifiers (agent names, paths, model ids) use `sy-mono`.
- `sy-textarea` is for plain multi-line text; markdown bodies use the CodeMirror editor themed with the same tokens (see CodeBlock).

# ListRow

A workflow or agent in a project list: Kind tile, name, one-line description, status Badge, ⋯ RowMenu.

- Rows are separated by `line` hairlines, not boxed; hover fills `surface-hover`.
- Workflow names are `/command` in mono; agent names in the sans.
- Clicking the row opens the builder drawer.

# Logo

Two overlapping circles, one filled and one outlined, both `mint`: two parts working as one. The wordmark is "Symbion" in the display face, 600.

- Use the mark alone at 22px in the collapsed rail and the favicon; mark + wordmark in the sidebar header.
- Mark only ever in `mint`; the wordmark in `ink`. No other colours, no outlines around it.
- Drawn inline as SVG (see preview); there is no bitmap logo in the repository.

# NavItem

One row of the sidebar: 16px icon, label, optional trailing count.

- 36px tall, `radius-md`, `ink-2` label, `ink-muted` icon.
- Hover and current page share `surface-hover`; mark the current page with `aria-current="page"`. No accent spine: drop the indigo bar from `rail/NavItem.tsx`.
- Group labels (`sy-navgroup`) use the overline style: "Pinned", "Recent".

# RowMenu

The ⋯ menu on a row, node or card: a `surface` popover with `shadow-menu`, 32px items, `radius-sm` hover.

- Icon, label, optional shortcut (`sy-kbd`). Destructive items last, after a divider, in `danger-text`.
- Same component for `NodeMenu` and `GraphCanvasMenu` in the graph.

# RunBar

The docked strip at the bottom of a project while a run is live: status glyph, command, step, elapsed time, tokens, progress, and actions.

- `surface`, `radius-lg`, `shadow-toast`, 48px; numbers use tabular figures.
- Progress fill `running`; on finish the glyph turns ✓ `success` or ✗ `danger` and the bar offers "View summary".
- "Agents" opens the agents panel; Cancel asks for confirmation inline.

# SegmentedControl

Two to four mutually exclusive options that switch a mode in place: Workflow/Agent in the composer, List/Graph in a project, Form/Markdown in the builder, appearance in Settings.

- Track `bg-sidebar`, selected thumb `surface-active` with `ink` text; others `ink-muted`.
- `role="radiogroup"` with `role="radio"` + `aria-checked` buttons.
- Replaces the outline-button List/Graph toggle in `ProjectView`.

# SettingRow

One setting: title and description on the left, its control or status on the right, rows divided by `line` hairlines.

- 18px vertical padding; title 14.5px `ink`, description caption `ink-muted` (mono for addresses and paths).
- Provider cards in `ProvidersPanel` become SettingRows with a status Badge.

# Sidebar

The app frame's left column (288px, `sidebar-width`): logo row, primary NavItems, Pinned projects, Recent workflows and agents, and the user row with daemon status.

- Ground `bg-sidebar` with a 1px `line` right edge; the main area is `bg-app`.
- Recent items lead with a Kind tile (`sy-kind--workflow` / `sy-kind--agent`) so kinds read without text.
- The user row owns daemon state: "● Daemon connected" in `success`; disconnected switches it to `danger-text` and shows the DaemonRibbon banner in the main area.
- Collapses to a 56px icon rail below 1100px; replaces `AppRail` + `ProjectSidebar`.

# StatusGlyph

A one-character mark for a run or agent status inside dense rows (agent tree, transcript, run history).

- The glyph set from `run/agents/StatusGlyph.tsx` stays: ◌ starting, ◉ running, ✓ done/ok, ✗ error, ◼ interrupted, ○ pending, · thinking, ? unknown.
- Colours move to tokens: running/starting `running`, done `success`, error `danger`, pending `ink-muted`, the rest `ink-faint`.
- Pulse (`data-live="true"`) only while the run is live, never on history; off under reduced motion.
- Always `role="img"` with an `aria-label`.

# Tabs

Underline tabs switch between sibling panels of the same object: Workflows / Agents on a project, author tabs in Templates, Transcript / Raw log in the agents panel.

- Selected tab: `ink` label with a 2px `ink` underline sitting on the `line` rule. Unselected: `ink-muted`.
- Counts go in `sy-count` after the label.
- **Intentional addition:** the code has three hand-rolled tab styles (BuilderDrawer, AuthorTabs, AgentTree). They all become this one. Use SegmentedControl instead when the switch changes a mode rather than a panel.

# TemplateCard

A template in the gallery: a mono preview of its files on top, title, one-line description, counts and Apply.

- `sy-card`: `line-soft` outline, `radius-lg`, no shadow. Preview well `bg-sidebar` in code-sm.
- Grid `repeat(auto-fill, minmax(300px, 1fr))` with `space-4` gaps.
- Apply opens TemplatePreviewModal (Dialog), never applies directly.

# Toast

A short message about something that just happened, bottom-centre, one at a time, gone after 2.2s (errors stay until dismissed).

- `surface` card, `radius-lg`, `shadow-toast`; a 20px round icon tinted by variant: success, warning, error, neutral.
- Past tense for done things ("Published 4 files"); errors say what to do next and may carry one ghost action.
- `role="status"` for success/neutral, `role="alert"` for errors.

# Tooltip

A small inverted label (`ink` ground, `bg-app` text) that names an icon-only control or shows a shortcut.

- Caption type, `radius-sm`, `shadow-menu`, max 260px. Shows on hover and keyboard focus after 400ms.
- Never put the only copy of important information in a tooltip.

