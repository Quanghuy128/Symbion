# enhance-experience — Design

Scope note: this design covers **only sub-requirements 2 and 3** of
`enhance-experience-STATE.md`, per the THINK decisions locked in §9:

- §9 item 2 → terminal boot menu reduced from 4 items to 3 (Web UI / Hide to
  Tray / Exit); the stubbed "Terminal UI (coming soon)" option is hidden, not
  removed-from-code (one-line revert when v1.5 ships it).
- §9 item 3 → daemon stays where it runs today (no native Windows
  packaging); `validatePath` + path-confinement guard must correctly handle
  Windows-style path *strings*. This doc's UI slice is the **copy/placeholder
  + error-message surface** of `CreateProjectDialog`, not the guard logic
  itself (that's `/plan`'s and `apps/daemon`'s job).
- §9 item 4 → UNC paths (`\\server\share\...`) explicitly **rejected** with a
  clear error, not silently mis-parsed.

Sub-requirement 1 (port default) has no UI surface — skipped per the task
brief.

---

## 1. User Journey

### Journey A — Terminal boot (sub-requirement 2)

1. User runs `npm run start` in a terminal.
2. Daemon binds a port (retrying forward on conflict, unchanged logic).
3. Terminal prints **one line**: the access URL, prominently, before
   anything else — satisfies FR-2.1 ("must surface, at minimum, the actual
   access URL... must not be cut").
4. A compact 3-line menu appears: `Web UI`, `Hide to Tray`, `Exit`. No
   stubbed option, no full-banner redraw.
5. User types `1` and Enter → terminal prints `Mở: <url>` and attempts to
   open the system browser. Menu does **not** redraw (process moves on to
   either staying foregrounded or, if the user later chooses tray/exit,
   redraws only the compact prompt, not the banner).
6. Alternative: user types `2` → prints a clear "running in background"
   confirmation (EC-2.1, unchanged copy) and detaches; process keeps
   serving HTTP in the background.
7. Alternative: user types `3` → prints shutdown line, closes the daemon,
   process exits.
8. Error path: if no port could be bound after retries, the user sees a
   clearly-marked error block **before** any menu is shown at all (FR-2.3 /
   EC-2.3) — this never got "simplified away."

### Journey B — Create Project with a Windows-style path (sub-requirement 3)

1. User opens "Tạo dự án mới" (Create Project) dialog from the sidebar.
2. Placeholder/example text under "Đường dẫn repo" no longer implies
   Unix-only — it shows a path shape that reads as platform-neutral or
   explicitly demonstrates a Windows example, per FR-3.3.
3. User pastes `C:\Users\me\code\my-service`.
4. Debounced `validatePath` call fires (existing 200ms debounce, unchanged).
5a. **Path exists and is a directory** → green "✓ Thư mục tồn tại" line,
    same as today, just now also true for Windows-style strings.
5b. **Path is well-formed but doesn't exist yet** → existing "✗ Thư mục
    không tồn tại" + "Tạo thư mục này" affordance, unchanged behavior, now
    also correctly triggered (not silently mis-parsed as relative) for
    Windows-style strings.
5c. **Path is a UNC path** (`\\server\share\project`) → distinct,
    explicit error state: "UNC paths chưa được hỗ trợ" — never shown as a
    generic "doesn't exist" message, because that would mislead the user
    into clicking "Tạo thư mục này" against an unsupported path shape.
6. User clicks "Tạo dự án" once validation is green; same downstream flow
   as today (unchanged).

---

## 2. Screen Inventory

| # | Screen / surface | Entry trigger | Exit path |
|---|---|---|---|
| T1 | Terminal: boot success + URL line | `npm run start`, port bind succeeds | falls through to T2 |
| T2 | Terminal: compact 3-item menu | immediately after T1 | user keypress 1/2/3 → T3/T4/T5 |
| T3 | Terminal: "Web UI" chosen, browser-open attempt | menu choice `1` | returns to T2 (menu re-prompts, compact form only) |
| T4 | Terminal: "Hide to Tray" confirmation | menu choice `2` | process detaches, no further terminal interaction |
| T5 | Terminal: "Exit" confirmation + shutdown | menu choice `3` | process exits |
| T6 | Terminal: port-bind error (no menu shown) | `findOpenPort` exhausts attempts | process exits 1 |
| W1 | Web: Create Project dialog (existing, modified) | "+ Tạo dự án" button in sidebar (unchanged trigger) | "Tạo dự án" success → dialog closes; "Hủy" → dialog closes |
| W2 | Web: Create Project dialog, UNC-path error state (new sub-state of W1, not a separate modal) | user types/pastes a `\\server\share\...` path | corrected input clears the error |

---

## 3. ASCII Wireframes

### T1 + T2 — Terminal boot success, compact menu (AFTER)

```
$ npm run start

Symbion daemon đang chạy: http://127.0.0.1:12802/?t=a1b2c3d4

  1) Web UI   2) Hide to Tray   3) Exit
  Chọn (1-3): _
```

Compare to BEFORE (current `apps/daemon/src/boot/menu.ts` + `index.ts`,
verbatim today):

```
$ npm run start

Symbion daemon đang chạy: http://127.0.0.1:20128/?t=a1b2c3d4
========================================
  Symbion — Choose Interface (0.1.0)
  Server: http://127.0.0.1:20128/?t=a1b2c3d4
========================================
  1) Web UI (Open in Browser)
  2) Terminal UI (Interactive CLI)
  3) Hide to Tray (Background)
  4) Exit
----------------------------------------
  Chọn (1-4): _
```

Before = 10 lines printed before any keypress (1 status + 9 `MENU_LINES`).
After = 3 lines printed before any keypress (1 status + 1 blank + 1 menu
line) — satisfies AC-2.2 ("measurably fewer... exact count is a taste
decision"); the blank line is a deliberate visual separator between "the
fact" (URL) and "the choice" (menu), not noise.

Design choices baked into the AFTER mockup:
- URL is on its **own line**, unboxed, unbannered — first thing printed,
  nothing competing with it (FR-2.1).
- Menu collapses to a **single line** of `N) Label` triplets instead of a
  9-line bordered block. No version number, no "Server:" duplicate line
  (URL already shown once above — printing it twice was part of the
  original noise).
- Numbering re-flows 1-3 (not 1,3,4) — no gap where "Terminal UI" used to
  be `2)`. This is intentional: a `2) Hide to Tray` / `3) Exit` numbering
  that skips `2`'s old meaning entirely avoids a stale muscle-memory trap
  for anyone who used the old menu (no carryover collision with old `2`
  meaning something else).
- Invalid input message kept terse, on its own line, then **the menu line
  reprints** (not the whole banner) — fixes the literal complaint in
  STATE §1 ("redraws its full banner on every loop iteration").

### T2 — invalid input retry (AFTER)

```
Symbion daemon đang chạy: http://127.0.0.1:12802/?t=a1b2c3d4

  1) Web UI   2) Hide to Tray   3) Exit
  Chọn (1-3): 9
  Lựa chọn không hợp lệ, thử lại.
  1) Web UI   2) Hide to Tray   3) Exit
  Chọn (1-3): _
```

Only the single menu line + prompt redraw — never the URL line or any
banner border again.

### T3 — "Web UI" chosen (AFTER)

```
  Chọn (1-3): 1
  Mở: http://127.0.0.1:12802/?t=a1b2c3d4

  1) Web UI   2) Hide to Tray   3) Exit
  Chọn (1-3): _
```

Menu loop continues (daemon stays foregrounded so the user can still choose
tray/exit later) — same control flow as today, only the redraw is the
compact line, never the full banner. Satisfies EC-2.2 (CI/headless stdin-feed
pattern: feeding `"1\n"` still works unmodified, still resolves to `"web"`).

### T4 — "Hide to Tray" chosen (AFTER)

```
  Chọn (1-3): 2
  Đã chuyển sang chạy nền (Hide to Tray). Server vẫn đang chạy.
  Truy cập tại: http://127.0.0.1:12802/?t=a1b2c3d4
$
```

Note: existing copy ("Đã chuyển sang chạy nền...") is preserved verbatim
(EC-2.1 forbids simplifying this into silence) — this design **adds** a
second line repeating the access URL, since once the menu is gone the user
has no other on-screen reminder of the URL for this session. This is a
small content addition, not a cut — flagged in Open Questions below since
it's a minor scope nudge beyond pure "simplification."

### T5 — "Exit" chosen (AFTER)

```
  Chọn (1-3): 3
  Đang tắt daemon...
$
```

Unchanged from today's copy/behavior, only reachable via the new numbering.

### T6 — port-bind exhaustion error (AFTER — unchanged from today, shown for completeness per FR-2.3)

```
$ npm run start
Không tìm được cổng trống cho daemon. Error: ...
$ echo $?
1
```

No menu is ever shown in this path — error prints to stderr, process exits
1, exactly as today. This mockup exists only to confirm the "simplification"
did not touch this path at all (AC-2.4).

---

### W1 — Create Project dialog (AFTER, Windows-path-aware copy)

```
┌──────────────────────────────────────────────────┐
│  Tạo dự án mới                                 [x]│
├──────────────────────────────────────────────────┤
│  Tên dự án                                        │
│  ( My API Service                               ) │
│                                                    │
│  Đường dẫn repo                                   │
│  ( C:\Users\me\code\my-service  ) [ Chọn… ]       │  ← placeholder shown when empty
│  ✓ Thư mục tồn tại · .claude/ chưa có             │
│                                                    │
├──────────────────────────────────────────────────┤
│                              [ Hủy ] [ Tạo dự án ]│
└──────────────────────────────────────────────────┘
```

### W1 — empty-state placeholder detail (input shown empty, placeholder text grey)

```
  Đường dẫn repo
  ( C:\Users\me\code\my-service              ) [ Chọn… ]
    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ grey placeholder text
```

### W1 — valid path, not yet created (sub-state 5b)

```
  Đường dẫn repo
  ( C:\Users\me\code\new-service              ) [ Chọn… ]
  ✗ Thư mục không tồn tại                [ Tạo thư mục này ]
```

Unchanged structure from today — only the path *string itself* now
correctly resolves as "well-formed absolute, just missing" instead of
(today's latent bug) "malformed/relative."

### W2 — UNC path rejected (sub-state 5c, NEW)

```
  Đường dẫn repo
  ( \\fileserver\teams\my-service              ) [ Chọn… ]
  ⚠ UNC paths (\\server\share\...) chưa được hỗ trợ.
    Hãy dùng đường dẫn ổ đĩa, ví dụ C:\Users\me\code\my-service
```

This is a **distinct visual state** from "doesn't exist" (5b) — uses a
warning glyph (⚠) instead of the✗ used for "not found," and offers no
"Tạo thư mục này" action (creating a directory at a UNC path is not what
this button means, and offering it here would be actively misleading).
Renders in the same `text-xs text-muted-foreground`-adjacent row as the
other validation states, but the message itself should read in a
warning/error tone (see Component Breakdown for exact class recommendation).

---

## 4. Component Breakdown

### Terminal (sub-requirement 2) — no shadcn, plain console output

No React/shadcn components involved. Architect-facing interface contract:

- `apps/daemon/src/boot/menu.ts`
  - `MENU_LINES(url, version)` → replace with a single-line builder, e.g.
    `MENU_LINE = "  1) Web UI   2) Hide to Tray   3) Exit"` (version string
    and bordered banner dropped entirely from the per-loop redraw; URL is
    printed once by the caller in `index.ts`, not repeated inside the menu
    function).
  - `BootChoice` type: keep `"web" | "terminal" | "tray" | "exit"` as the
    TypeScript union (do not delete `"terminal"` from the type — only hide
    it from the printed menu / accepted input mapping) so re-enabling it in
    v1.5 is the one-line change the THINK rationale promises. Confirm with
    architect: input `"2"` now maps to `"tray"` (not `"terminal"`), `"3"`
    maps to `"exit"` — the digit-to-choice mapping shifts, this is the one
    behavior change a CI/headless script piping digits must be aware of
    (AC-2.3 cares about "a menu still exists in usable form," not that the
    digits keep their old meaning — confirmed acceptable per STATE's own
    framing of AC-2.3, but flag this explicitly to dev/QA since
    `connect-providers-STATE.md §12.2`'s prior digit-feeding pattern
    presumably assumed the *old* numbering).
  - Invalid-input retry: reprint only the single menu line + prompt, not
    `MENU_LINES` in full.
- `apps/daemon/src/index.ts`
  - Keep URL `console.log` exactly where it is today (before the menu
    loop starts) — this line is the one FR-2.1 anchors on, do not move it
    inside `showBootMenu`.
  - `tray` branch: add one line printing the URL again (see T4 above) —
    confirm with user/architect, this is a content addition flagged in Open
    Questions.
  - Error branch (`catch` around `findOpenPort`): unchanged, no design
    change needed (T6).

### Web — `CreateProjectDialog.tsx` (sub-requirement 3)

Existing shadcn components, no new ones needed for this slice:

- `Input` (existing) — `placeholder` prop text changes only.
- `Button` — unchanged usage (`Chọn…`, `Tạo thư mục này`, `Hủy`, `Tạo dự án`).
- Validation status row (currently a plain `<div>`/`<span>` block, not a
  shadcn component) — needs a **third branch** added to the existing
  ternary (`validation.exists ? ... : ...`) to special-case UNC paths. New
  prop/state surface needed from the daemon side (architect's call, flagged
  here as the contract this UI needs):
  - `ValidatePathResult` needs an additional discriminant so the web layer
    doesn't have to re-implement UNC-sniffing itself (regex-matching
    `^\\\\` client-side would duplicate logic the daemon must also enforce
    for the security guard) — e.g. a `reason?: "unc-unsupported"` field, or
    a parallel `unsupported: boolean` + `unsupportedReason: string` pair, on
    `ValidatePathResult`. **This is a data-contract decision for the
    architect**, not decided here — the UI only needs *some* boolean/enum
    signal to pick branch 5c instead of 5b.
  - No new component file needed; this is a conditional-rendering change
    inside the existing status-row JSX block (lines ~107-124 today).

### Copy/placeholder text changes (both FR-3.3 and the UNC error message)

| Element | Current (Unix-flavored) | Proposed |
|---|---|---|
| Input placeholder | `/home/me/code/my-service` | `C:\Users\me\code\my-service` (or platform-neutral `…/code/my-service` — see Open Question 1 below) |
| "doesn't exist" message | `✗ Thư mục không tồn tại` | unchanged — already platform-neutral text |
| New UNC error message | (none today) | `⚠ UNC paths (\\server\share\...) chưa được hỗ trợ. Hãy dùng đường dẫn ổ đĩa, ví dụ C:\Users\me\code\my-service` |

---

## 5. Interaction Notes

**Terminal:**
- No spinners/animations — this is a synchronous readline prompt, identical
  interaction model to today, just fewer lines printed per cycle.
- Menu redraw on invalid input: print error line, blank line is *not*
  inserted (today's code already does `console.log("  Lựa chọn không hợp
  lệ, thử lại.\n")` — the trailing `\n` already gives one blank line; keep
  that single blank line, don't add a second).
- Browser auto-open (`xdg-open`/`open`/`start`) failure is already
  swallowed silently (`catch { /* ignore */ }`) — out of scope to change,
  not part of this design.

**Web dialog:**
- Debounce timing (200ms) unchanged — Windows-style paths go through the
  identical debounce → RPC → state-update cycle, no new loading state
  needed beyond what exists.
- UNC branch (5c) should **not** show the "Tạo thư mục này" button at all
  (unlike 5b) — prevents a confusing action against a path type explicpitly
  marked unsupported.
- Empty input (`path === ""`): unchanged — `validation` resets to `null`,
  no status row shown, exactly as today.
- Error display for UNC should use a **distinct color/icon (⚠ vs ✗)** so a
  user scanning quickly does not mistake "your shape of path string isn't
  supported" for "this specific folder doesn't exist yet, click here to
  create it" — those are different repair actions (rewrite vs. create-dir)
  and must not look the same.
- Mixed-separator and case-insensitive drive-letter paths (EC-3.1, EC-3.2)
  are **not** distinct UI states — if the daemon's `validatePath` correctly
  normalizes these server-side, the UI shows the same 5a/5b states as any
  other valid Windows path. No UI design needed for those edge cases beyond
  "the daemon must normalize before responding" (architect/dev concern, not
  a UI state).

---

## 6. Open Design Questions

These need a taste call before `/plan` locks the design — not guessed here:

1. **Placeholder text: Windows-flavored example, or platform-neutral?**
   FR-3.3 only requires "not visually imply Unix-only." Two reasonable
   options:
   (a) Switch the placeholder outright to a Windows example
       (`C:\Users\me\code\my-service`) — clearest signal Windows is
       supported, but now *implies* Windows-only to a Linux/WSL user (the
       opposite problem).
   (b) Use a platform-neutral placeholder (`…/code/my-service` or
       `<your-project-folder>`) that doesn't commit to either style.
   (c) Keep both: small helper text under the input showing one example of
       each style (`vd: /home/me/code/my-service hoặc C:\Users\me\code\my-service`).
   This doc does not pick one — recommend (c) for clarity but it adds a
   line of UI; (a)/(b) are cheaper. **Needs your pick.**

2. **Tray confirmation: should it really print the URL a second time
   (T4)?** The locked spec (EC-2.1) only requires the existing confirmation
   message not go silent — it does not ask for a content *addition*. Adding
   the URL line is this designer's judgment call (once the menu vanishes,
   nothing else on screen reminds the user how to reach the server), but
   it's a scope nudge beyond pure "simplify," however small. Confirm before
   `/plan` treats it as in-scope, or revert to copy-unchanged.

3. **Digit-to-choice remapping in the menu (`2`→tray, `3`→exit instead of
   `3`→tray, `4`→exit)** — confirmed acceptable per AC-2.3's own wording,
   but flagging explicitly since it's a behavior change for any
   script/muscle-memory built against the old numbering. If you'd rather
   *keep* old digits 1/3/4 with a gap at 2 (visually odd but zero migration
   risk for existing scripts), say so now — current design assumes
   renumbering 1-3 is preferred (cleaner UI) over digit-stability.

4. **UNC error-state data contract** (`ValidatePathResult` needs some new
   field to distinguish "UNC, unsupported" from "doesn't exist") — this is
   really an architect-level API decision, flagged here only because the UI
   can't render branch 5c without *some* signal from the daemon. Not a
   taste question, just noting it must be resolved in `/plan` before BUILD.

---

## 7. Autopilot decisions on open design questions (unattended run, no user present)

Same rationale as STATE §9 — this run has no human present to answer in real
time, so each taste call below picks the safer/cheaper/more-reversible option
and is documented for review rather than silently baked in.

1. **Placeholder text** → option **(b) platform-neutral** (`…/code/my-service`
   or equivalent). Rationale: avoids the new "implies Windows-only to a
   Linux/WSL user" problem that option (a) would introduce, and is the
   cheapest to implement (no added helper-text line, unlike (c)). Fully
   reversible copy-only change.
2. **Tray confirmation second URL line (T4)** → **do not add it**; keep the
   existing confirmation copy unchanged, verbatim. Rationale: the locked spec
   (EC-2.1) only requires the message not go silent, not a content addition;
   adding scope beyond what's specified is exactly the kind of unrequested
   change that should wait for a real product decision rather than a
   designer's (or autopilot's) judgment call.
3. **Digit-to-choice remapping** → accept the renumbering (`1` Web UI / `2`
   Hide to Tray / `3` Exit), confirmed acceptable per AC-2.3's own wording.
   Rationale: cleaner UI, and the spec's own acceptance criterion already
   treats "a menu still exists in usable form" (not digit-stability) as the
   bar — no override needed here.

Question 4 (the `ValidatePathResult` data contract) is correctly an
architect-level decision, not a taste call — left for `/plan` to resolve.

## Future ideas (explicitly out of scope this loop)

- Native OS folder-picker (`apps/daemon/src/fs/folderPick.ts` is currently a
  stub) would sidestep all manual path-typing ambiguity for both Unix and
  Windows users — not part of this loop, flagged for a future feature.
- A live-validated path-format hint (e.g. inline "looks like a Windows
  path" badge) is unnecessary complexity beyond what FR-3.3 asks for.
