# Auto-generate description — Design

> Source spec: [`auto-generate-description-STATE.md`](./auto-generate-description-STATE.md) (phase = PLAN, §9 OFFICE-HOURS locked 2026-06-26).
> Scope respected as locked: pure local heuristic generator, no network, no daemon RPC, always-enabled button, simple confirm dialog on overwrite (not inline diff), no body/system-prompt generation.
> Existing code read for consistency: `apps/web/src/components/AgentForm.tsx`, `apps/web/src/components/WorkflowForm.tsx`, `apps/web/src/components/ui/{button,input,dialog}.tsx`.

---

## 1. User Journey

**Happy path — Agent Builder, empty description, body already written:**

1. User is on the Agent Builder form (S7), has typed `name = "code-reviewer"`, toggled tools `Read`, `Grep`, `Bash`, and written a few lines in `Nội dung` (the system-prompt body). `description` is still empty.
2. User notices a small sparkle/wand icon button sitting immediately to the right of the `description *` label (or inline at the end of the input — see wireframe). No tooltip needed to discover it; icon affordance + adjacency to the field communicates intent.
3. User clicks the icon.
4. Because the field was empty, there is **no confirm dialog** — the heuristic runs synchronously (sub-millisecond, no spinner needed) and the `description` input is filled immediately with a generated single-line string, e.g. `"Agent that uses Read, Grep, Bash to review code changes for correctness and style."`
5. The button is disabled for the duration of the synchronous call (effectively instant, but this guards EC-5) and re-enabled immediately after.
6. The text now sits in the `description` input exactly as if the user had typed it — fully editable, included in any live preview, included in Save/Publish validation. User can tweak a word or two, or leave it as-is.
7. User continues filling the rest of the form and clicks the existing `[ Lưu ]` (Save) action — unaffected, no new save path.

**Happy path variant — description already has text (overwrite path):**

1. Same setup, but `description` already contains user-typed text.
2. User clicks the generate icon.
3. A confirm dialog appears centered on screen: *"Văn bản mô tả hiện tại sẽ được thay thế — tiếp tục?"* with `[ Hủy ]` (Cancel) and `[ Thay thế ]` (Replace) actions. The rest of the form is dimmed/inert behind the modal backdrop (existing `Dialog` primitive behavior).
4. If user clicks Cancel (or clicks the backdrop, or presses Esc if wired): dialog closes, `description` is untouched.
5. If user clicks Replace: dialog closes, heuristic runs, `description` is overwritten with the freshly generated string — same instant-fill behavior as the empty-field path.

**Edge path — blank artifact, no body, no tools (EC-1/Q6):**

1. User just created a brand-new agent; only `name` is filled (or not even that).
2. User clicks generate anyway (button is never disabled for lack of context, per Q6).
3. Heuristic falls back to a name-only template, e.g. `"Mô tả cho code-reviewer."` (or a generic stub if even `name` is empty) — always produces *something* non-empty, never throws, never shows an error state (there is no failure mode for a pure local function over valid form state).

---

## 2. Screen Inventory

| # | Screen / element | Entry trigger | Exit path |
|---|---|---|---|
| 1 | **AgentForm (S7) — description field row** (modified) | Existing entry: navigating to an agent artifact in the builder | N/A — same form, no navigation |
| 2 | **WorkflowForm (S8) — description field row** (modified) | Existing entry: navigating to a command/workflow artifact in the builder | N/A — same form, no navigation |
| 3 | **Overwrite-confirm dialog** (new, shared between both forms) | Clicking the generate icon when `description` is non-empty | `[ Hủy ]` closes without change; `[ Thay thế ]` closes and applies generated text |

No new route/page. No loading screen, no error screen — both are vacuous per STATE §9 (pure local function, no network/daemon dependency, cannot fail for any valid form state).

---

## 3. ASCII Wireframes

### 3.1 AgentForm (S7) — description field row, default state (empty description)

```
┌─────────────────────────────────────────────────────────┐
│ name *                                                   │
│ ( code-reviewer                                        ) │
│                                                           │
│ description *                                            │
│ ( placeholder: Independent reviewer…           ) [ ✨ ]  │  ← generate icon button, end of row
│                                                           │
│ tools                                                     │
│ [Read✓] [Write] [Edit] [Grep✓] [Glob] [Bash✓] [WebFetch] │
│                                                           │
│ Nội dung                                                  │
│ ┌───────────────────────────────────────────────────────┐│
│ │ You are an independent code reviewer. Review diffs    ││
│ │ for correctness, security, and style...                ││
│ └───────────────────────────────────────────────────────┘│
│                                                           │
│ ▸ Nâng cao                                                │
└─────────────────────────────────────────────────────────┘
```

### 3.2 AgentForm (S7) — after click, description filled (no confirm needed, was empty)

```
│ description *                                            │
│ ( Agent that uses Read, Grep, Bash to review code      ) [ ✨ ]│
│   changes for correctness and style.                     │
```
*(Note: Input is single-line per existing `Input` component; generated text is normalized to fit on one line — see Interaction Notes EC-4.)*

### 3.3 WorkflowForm (S8) — description field row (same pattern)

```
┌─────────────────────────────────────────────────────────┐
│ command name (→ /name)                                    │
│ ( analyze                                              ) │
│                                                           │
│ description *                                            │
│ ( placeholder: 3 BA agents research...               ) [ ✨ ]│  ← same icon, same position
│                                                           │
│ Nội dung                                    [Chèn $ARGUMENTS]│
│ ┌───────────────────────────────────────────────────────┐│
│ │ Run @ba to analyze requirements, then @architect...    ││
│ └───────────────────────────────────────────────────────┘│
│                                                           │
│ Agents tham chiếu: • ba ✓ • architect ✓                  │
└─────────────────────────────────────────────────────────┘
```

### 3.4 Generate icon button — close-up (both forms, identical component)

```
   ( description text or placeholder...               ) [ ✨ ]
                                                          ↑
                                              icon-only button,
                                              aria-label="Tạo mô tả tự động",
                                              size=sm, variant=outline,
                                              sits flush right of the Input,
                                              same row, same height (h-9/h-8)
```

States of the icon button itself:

```
Default (idle):        [ ✨ ]   ← outline variant, icon only
Pressed/disabled        [ ✨ ]   ← briefly disabled synchronously on click
  (sub-ms, EC-5 guard)         (visually near-imperceptible; no spinner swap
                                 needed since compute is instant — see §5)
```

### 3.5 Overwrite-confirm dialog (shared component, triggered from either form)

```
┌──────────────────────────────────────────────┐
│  Thay thế mô tả?                         [✕] │  ← DialogHeader + DialogTitle
├──────────────────────────────────────────────┤
│                                                │
│  Văn bản mô tả hiện tại sẽ được thay thế —    │
│  tiếp tục?                                    │
│                                                │
├──────────────────────────────────────────────┤
│                          [ Hủy ]  [ Thay thế ]│  ← DialogFooter
└──────────────────────────────────────────────┘
```
- Backdrop: `bg-black/40` full-screen, click-outside closes (= Cancel), consistent with existing `Dialog` primitive.
- `[ Thay thế ]` uses `variant="default"` (primary) since it's the affirmative continue action; `[ Hủy ]` uses `variant="outline"` or `"ghost"`.
- No preview of the *old* or *new* text inside the dialog (Q7 locked: simple confirm, not inline diff) — text content is intentionally generic/static, doesn't need form-context props.

---

## 4. Component Breakdown

### New component: `GenerateDescriptionButton`
- **Location convention**: `apps/web/src/components/GenerateDescriptionButton.tsx` (shared by both forms).
- **Base**: built on existing `Button` (`variant="outline"`, `size="sm"`, icon-only — no text label, just the sparkle/wand glyph as children; use an inline SVG or existing icon set already in the project — check for `lucide-react` or similar before introducing a new icon dependency).
- **Props (interface contract only, no implementation)**:
  - `currentDescription: string` — to decide confirm-vs-direct-apply.
  - `onGenerate: () => string` — caller-supplied closure that, when invoked, returns the generated single-line string (the heuristic call itself lives in `packages/core`, per STATE §9 architecture consequence — this button component stays generic and dumb).
  - `onApply: (value: string) => void` — called with the generated string once accepted (either immediately if `currentDescription` was empty, or after confirm).
  - `disabled?: boolean` — present for the synchronous double-click guard (EC-5) only; never set `true` for "not enough context" (Q6 locked).
  - `aria-label` / accessible name fixed to something like `"Tạo mô tả tự động"` (not a prop — baked in, for consistency across both forms).
- **Internal state**: a transient `busy` boolean flipped `true` synchronously on click and back to `false` immediately after the generate+apply (or generate+open-dialog) call completes in the same tick — guards EC-5 without needing any async machinery.
- **Does NOT** own the confirm dialog's open/closed state long-term — it owns just enough to decide "show dialog" vs "apply directly," see below.

### New component: `OverwriteConfirmDialog` (or inline composition reusing `Dialog`/`DialogHeader`/`DialogTitle`/`DialogFooter`)
- Likely does **not** need to be its own named component file — can be composed directly inside `GenerateDescriptionButton` using the existing primitives, since its content is fully static (no per-call props beyond open/onCancel/onConfirm).
- **Props if extracted as a standalone component**:
  - `open: boolean`
  - `onCancel: () => void`
  - `onConfirm: () => void`
- Uses existing `Dialog`, `DialogHeader`, `DialogTitle`, `DialogFooter` — zero new primitive needed (matches Q7 lock: "no new component class needed").

### New pure function (architect to place, likely `packages/core`): `generateDescription(input)`
- Out of UI-design scope to specify its internals, but the **shape** the button needs from it:
  - Input: `{ kind: "agent" | "command"; name: string; body: string; tools?: string[]; customFields?: CustomField[] }`
  - Output: `string` — already normalized to a single line, already trimmed, safe for YAML frontmatter (EC-4 handled here, not in the button component).
  - Never throws for any valid `CanonicalArtifact`-shaped input (Q6/EC-1 fallback to name-only or generic stub).

### Modified: `AgentForm.tsx`
- Description field row becomes a flex row: existing `Input` (description) + new `GenerateDescriptionButton`.
- Wires `onGenerate` to call `generateDescription({ kind: "agent", name: artifact.name, body: artifact.body, tools: artifact.tools, customFields: artifact.customFields })`.
- Wires `onApply` to `update("description", value)` (existing `update` helper, unchanged).

### Modified: `WorkflowForm.tsx`
- Same row pattern; `onGenerate` calls `generateDescription({ kind: "command", name: artifact.name, body: artifact.body })` (no `tools`/no mention-context per Q5 locked "no").
- Reuses the exact same `GenerateDescriptionButton` component — no duplication, no command-specific variant needed.

### Icon asset
- Confirm whether the project already has an icon library in `apps/web/package.json` (e.g. `lucide-react`) before hand-rolling an SVG sparkle/wand glyph. If none exists, a minimal inline SVG (single `<svg>` with a sparkle path) is acceptable and adds zero new dependency — flagged as an open question below since it touches dependency choice, which is the architect's call, not a pure design call.

---

## 5. Interaction Notes

- **No loading spinner, no "in flight" visual state.** Per STATE §9, generation is a synchronous pure function call — there is no network/IPC round-trip to show progress for. The button's `busy` flip-flop (click → disabled → enabled) happens within the same synchronous tick/microtask and should be visually imperceptible to the user; it exists purely to make concurrent/rapid clicks impossible (EC-5), not to communicate latency.
- **EC-5 (double-click race)**: implement by disabling the button for the duration of the synchronous handler (e.g., guard with a ref/flag checked at the top of the click handler, or simply rely on the fact that the handler is synchronous and React's state updates are batched — but be explicit: do not make the click handler `async` unless truly necessary, since that reopens a window for a second click before the first resolves). The architect should confirm in `/plan` whether a simple "ignore re-entrant clicks via a module-level/ref guard" is sufficient, or whether a `busy` state held in the button's own `useState` is enough given React's synchronous event handling model.
- **EC-2 / Q7 (overwrite confirm)**: dialog appears **only** when `currentDescription.trim() !== ""`. Whitespace-only existing text should also be treated as "non-empty" for safety (don't silently clobber even pure-whitespace user input) — or conversely, treat as empty since it's not meaningfully different from blank. **Recommend**: treat trimmed-empty as empty (skip confirm) — simpler and matches user intent (whitespace-only is not meaningfully "their text"). Flagged as a minor implementation detail, not a taste call.
- **EC-1 / Q6 (empty body fallback)**: no special UI treatment — the button looks and behaves identically regardless of context richness. The only "feedback" the user gets is the quality of the generated string itself (e.g., a terser name-only sentence vs. a richer tools+body-derived one). No tooltip explaining "this will be a weaker description" — keep it simple, matches the "always enabled" lock.
- **EC-4 (single-line normalization)**: handled entirely inside `generateDescription`, invisible to the UI layer — the button/form never receives or displays multi-line text, so there's no truncation-indicator UI needed (e.g., no "…" affordance, since the string is already correct by the time it reaches `onApply`).
- **EC-6 (no auto-regeneration on later edits)**: confirmed no special UI — after insertion, the generated text is plain editable state identical to manually typed text. No "regenerate" badge, no "this was auto-generated" indicator anywhere (matches AC-6: no `wasGenerated` flag in the IR, and correspondingly no UI surface needs to reflect one).
- **Empty-state / first-render**: the generate icon is always visible next to the field, in both the truly-blank-new-artifact state and the populated state — it is not progressively revealed or hidden based on form completeness.
- **Error state**: none. Per STATE §9, EC-3/EC-9 (backend unreachable / daemon disconnected) are vacuous since there is no backend call. No error toast, no inline error text component needed for this feature specifically (the existing `DaemonStatusBadge` disconnect banner, if present elsewhere in the shell, is unrelated/unaffected — this feature does not interact with daemon connectivity at all).
- **Focus/keyboard**: after the generated text is applied, focus should likely return to or remain available on the `description` `Input` itself (not trapped on the now-idle button) so the user can immediately start editing — recommend the click handler does not force-move focus away from natural tab order; if the confirm dialog was shown, focus should land on the dialog's primary action (`[ Thay thế ]`) when it opens, and return to the description `Input` (not the icon button) after confirm, so the user can edit immediately. This is a reasonable default the architect/dev can implement without further taste input.
- **Tooltip**: a native `title` attribute or simple tooltip reading "Tạo mô tả tự động" on the icon button is recommended for discoverability (icon-only buttons benefit from a label on hover), but is not a blocking requirement.

---

## 6. Open Design Questions

These are genuinely new — they do not re-litigate any STATE §9 lock.

1. **Icon choice / icon library dependency.** Is there already an icon library available in `apps/web` (e.g., `lucide-react`, `@radix-ui/react-icons`)? If not, should the architect/dev hand-roll a single inline SVG sparkle/wand glyph (zero new dependency, consistent with the project's minimal-dependency posture for hand-rolled shadcn-style primitives), or is adding a small icon library acceptable? This is a dependency decision, not purely visual — flagging for the architect to confirm rather than guessing in `/design`.
2. **Exact icon glyph**: sparkle (✨-style "magic") vs. wand vs. a more neutral "refresh/generate" arrow icon. Sparkle/wand reads as "AI-ish," which may be slightly misleading since this is explicitly a deterministic heuristic, not generative AI — worth a one-line gut-check from the user on whether the icon metaphor should intentionally avoid AI-sparkle iconography to set correct expectations (the STATE doc itself is careful to call this "heuristic," not "AI"). Recommend a simple "auto-fill" / lightning-bolt / refresh-with-text icon as an alternative if avoiding AI-coded visual language is desired.
3. **Tooltip text exact wording** ("Tạo mô tả tự động" suggested above) — minor copy decision, low stakes, can be finalized at `/plan` or `/build` without blocking.

---

## Future ideas (explicitly out of scope — flagged, not designed)

- Visual indicator/badge distinguishing "AI-suggested, not yet reviewed" text from confirmed text (would require the `wasGenerated` IR flag explicitly rejected in AC-6 — only revisit if the user asks).
- Regenerate button distinct from generate (e.g., a dropdown with "regenerate" once text already exists, instead of routing every click through the overwrite-confirm dialog) — not requested, current design reuses the same single button + confirm gate for both first-generation and regeneration.
- Any settings/preferences for tone or verbosity of the heuristic output.

---

## Suggested next step

Run `/plan` with the architect reading this design doc alongside `auto-generate-description-STATE.md` — the architect should lock: the exact shape/placement of `generateDescription` in `packages/core`, the icon-dependency decision (open question 1 above), and the precise EC-5 guard implementation (ref-guard vs. state-guard) referenced in §5.
