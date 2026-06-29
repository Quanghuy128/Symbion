# enhance-experience — STATE

**Phase: Done**

## 0. Origin

GitHub Issue #3 ("[Issue] Enhance experience") bundles three loosely related
asks in one ticket:

1. Update default daemon port to `12802`.
2. Simplify/clean up the terminal output shown when running `npm run start`.
3. Support Windows-style file paths for "source code" project roots, not
   just WSL/Unix-style (`/home/...`) paths.

These three are independent in cause and risk profile (a config-value change,
a UX/cosmetic change, and a security-sensitive path-handling change). They
are analyzed here as **three discrete sub-requirements**, each with its own
functional requirements, edge cases, and acceptance criteria, so `/plan` can
scope/sequence/gate them independently (e.g. #3 may need `/cso`, #1 and #2
almost certainly do not).

## 1. Current-state findings (code reading, this session)

- **Port**: default port is `20128`, defined once in
  `packages/core/src/ir/types.ts` (`DEFAULT_GLOBAL_CONFIG.port`). Daemon boot
  (`apps/daemon/src/index.ts`) reads this via `loadGlobalConfig()` and calls
  `findOpenPort(config.port, ...)` (`apps/daemon/src/net/findOpenPort.ts`),
  which scans forward up to 20 ports on `EADDRINUSE` and persists whatever
  port it actually bound back into the user's global config
  (`~/.config/symbion/config.json`) — so the "default" is really only the
  *first attempt*, not a hard requirement.
  - Three **separate hardcoded fallback literals** of `20128` exist in the
    web app, used only when the actual bound port can't be inferred from
    `window.location` / env var: `apps/web/src/components/SettingsShell.tsx:22`,
    `apps/web/src/components/AppShell.tsx:27`, and
    `apps/web/src/lib/rpc/client.ts:32` (`NEXT_PUBLIC_DAEMON_PORT` env var
    fallback). These must move in lockstep with the core default or they
    silently disagree with reality once a fresh user boots a never-before-run
    daemon and the web client guesses before the URL/env var is available.
  - `README.md` already uses a `<port>` placeholder (no literal hardcode) —
    no doc change needed there.
  - No `.env.example`/`.env` file found referencing the port (not searched
    further — none surfaced in the grep for `20128`).

- **Terminal boot menu**: `apps/daemon/src/boot/menu.ts` (`showBootMenu`) +
  `apps/daemon/src/index.ts` (`main()`). On `npm run start`, the daemon binds
  a port, prints `Symbion daemon đang chạy: <url>`, then loops printing a
  4-option ASCII menu (`Web UI` / `Terminal UI` (stubbed, "coming in v1.5") /
  `Hide to Tray` / `Exit`) and blocks on `readline` input. Choosing `Terminal
  UI` just reprints a "sắp có" notice and redraws the same menu — dead weight
  in every session today. The menu redraws its full banner on every loop
  iteration (e.g. after a Terminal-UI no-op), which is the literal "noisy/
  cluttered" symptom the issue is reacting to.

- **Windows path support**: the actual security-relevant guard is
  `resolveConfinedPath`/`rejectTraversalSegments` in
  `apps/daemon/src/rpc/guard.ts`, used by every write path
  (`apps/daemon/src/fs/writeFiles.ts` and others). It is built entirely on
  Node's `node:path` (`isAbsolute`, `resolve`, `normalize`, `relative`),
  which is **platform-mode-dependent, not input-format-dependent** — on a
  Linux/WSL-hosted daemon process, `path.isAbsolute("C:\\Users\\me\\repo")`
  returns `false` (Node's POSIX `path` implementation does not recognize a
  Windows drive-letter prefix as absolute). That means a Windows-style path
  typed by a user would currently be silently treated as a *relative*
  segment instead of being rejected outright as absolute-and-disallowed,
  which is a different (and arguably worse — silently-wrong, not
  loudly-rejected) failure mode than today's intentional "reject absolute
  paths" rule for `relPath` inputs.
  - Separately, **project-root paths** (the repo path picked at
    `CreateProjectDialog`, validated via the `validatePath` RPC in
    `apps/daemon/src/rpc/handlers.ts:163`) are NOT run through
    `resolveConfinedPath` at all — `validatePath` calls `existsSync`/
    `statSync` directly on whatever string the user typed. This path is
    today only exercised with Unix-style examples (the UI's own placeholder
    text is literally `"/home/me/code/my-service"` in
    `apps/web/src/components/CreateProjectDialog.tsx:101`) — there is no
    current code that *rejects* a Windows-style project-root path, but
    nothing has been built or tested to confirm one *works* correctly either
    (no drive-letter/backslash-aware logic found anywhere in
    `apps/daemon/src/fs/` or `apps/web`'s path-handling code).
  - `apps/daemon/src/fs/folderPick.ts` (native OS folder-picker) is currently
    a stub that always reports `cancelled` — typed-path is the only path
    input mechanism that exists today, on any OS.
  - No code found anywhere that special-cases UNC paths (`\\server\share`),
    mixed separators, or drive letters.

## 2. Sub-requirement 1 — Default port change to 12802

### Problem / user story
As a Symbion user, when I run the daemon for the first time, I want it to
listen on the documented default port (`12802`) so that any fixed
bookmarks/scripts/docs referencing "the Symbion port" are consistent, instead
of the current undocumented default (`20128`).

### Scope
**In scope**: change the single source-of-truth default
(`DEFAULT_GLOBAL_CONFIG.port` in `packages/core/src/ir/types.ts`) to `12802`,
and update the three web-side fallback literals to match.
**Out of scope**: changing the port-conflict retry behavior (`findOpenPort`'s
forward-scan-and-persist logic) — that mechanism is correct and unaffected by
which number is the starting point.

### Functional requirements
- FR-1.1: A fresh install (no existing `~/.config/symbion/config.json`) boots
  the daemon attempting port `12802` first.
- FR-1.2: All hardcoded fallback references to the old default (`20128`) are
  updated to `12802` in the same change (no literal `20128` left as a
  fallback anywhere in `apps/web`).
- FR-1.3: Existing users with an already-persisted `config.json` containing
  `port: 20128` (or any other previously-auto-incremented port) are
  **unaffected** — this is a new-default change, not a forced migration; an
  existing user's working setup must not be disrupted by this change.

### Edge cases
- EC-1.1: Port `12802` is already in use on the user's machine at first boot
  — existing `findOpenPort` retry-forward behavior must still apply
  unchanged (scans `12802`, `12803`, ... up to existing `maxAttempts`).
- EC-1.2: A user has automation/scripts/bookmarks hardcoded to the *old*
  default `20128` from a previous version — out of this loop's control
  (cannot retroactively fix external scripts); just don't make it worse by
  leaving mixed defaults inside Symbion's own code.
- EC-1.3: The three web-side fallback literals and the core default drift
  out of sync in a future change (someone edits one, not all four) — flag
  as a maintainability risk, not a blocking requirement for this loop (see
  §6 risk notes).

### Acceptance criteria (measurable)
- AC-1.1: `packages/core/src/ir/types.ts`'s `DEFAULT_GLOBAL_CONFIG.port`
  equals `12802`.
- AC-1.2: `grep -rn "20128" apps/ packages/ README.md` (excluding test
  fixtures that intentionally pin an arbitrary port for isolation) returns
  zero matches outside of test files.
- AC-1.3: A daemon boot against a fresh config dir (e.g.
  `SYMBION_CONFIG_DIR` pointed at an empty temp dir) results in the daemon
  listening on `12802` (verified by reading the printed boot URL or the
  persisted `config.json`).
- AC-1.4: A daemon boot against an existing config dir with a previously
  saved `port: 9999` (arbitrary non-default value) still boots on `9999`,
  unchanged — confirms FR-1.3 (no forced migration).

## 3. Sub-requirement 2 — Simplify terminal UI after `npm run start`

### Problem / user story
As a Symbion user running `npm run start` for the first time, I want the
terminal output to be clear and minimal — show me the one thing I actually
need (the URL to open) without redundant menu noise — so I don't have to
parse a multi-line ASCII banner and a stubbed "Terminal UI — coming soon"
option I'll never use.

### Scope
**In scope**: the printed banner/menu in `apps/daemon/src/boot/menu.ts` and
the surrounding `console.log` calls in `apps/daemon/src/index.ts`'s `main()`.
**Out of scope**: actually building the stubbed Terminal UI (still v1.5,
unaffected by this loop); changing what RPC/server boot logic does
underneath; the `Hide to Tray` / `Exit` *behaviors* (only their presentation
may change).

### Functional requirements
- FR-2.1: After daemon boot, the terminal must surface, at minimum, the
  actual access URL (with port + session token) — this is the one piece of
  information every user needs and must not be cut for the sake of
  "simplification."
- FR-2.2: The presented choices must be reduced to what is actually usable
  today — i.e. a stubbed "Terminal UI — coming soon" option that does
  nothing but reprint the same menu is the literal definition of clutter the
  issue is about; it should not silently disappear without a product
  decision (see open question below), but if kept, it must not redraw the
  full banner pointlessly on every loop iteration.
- FR-2.3: Error states (port already in use after exhausting retries, daemon
  already running on that port) must remain at least as clear as today —
  "simplify" must not mean "lose error visibility."

### Edge cases
- EC-2.1: User chooses "Hide to Tray" — must still see a clear confirmation
  that the server is running in the background and how to reach it (today's
  `"Đã chuyển sang chạy nền..."` message) — don't simplify this into silence.
- EC-2.2: User runs in a headless/CI context (no real interactive TTY,
  e.g. piping `3` to stdin per `connect-providers-STATE.md §12.2`'s QA
  pattern) — whatever new output format must still be script-feedable the
  same way (no behavior regression for that existing QA workflow).
- EC-2.3: `findOpenPort` exhausts all attempts (today: prints "Không tìm được
  cổng trống..." and exits 1) — this failure path must remain visible/legible
  after simplification, not get cut along with the "noise."

### Acceptance criteria (measurable)
- AC-2.1: Running `npm run start` from a clean boot prints the access URL
  exactly once, unambiguously, before any menu/choice prompt.
- AC-2.2: Total lines printed at first boot (before any user keypress) is
  measurably fewer than the current banner (today: 9 fixed `MENU_LINES` +
  1 status line = 10 lines minimum) — exact target line count is a taste
  decision, not specified here (see open question).
- AC-2.3: The existing manual QA pattern of "feed a single digit to stdin to
  select a menu option headlessly" (per `connect-providers-STATE.md §12.2`)
  still works unmodified against the new menu, if a menu still exists in any
  form.
- AC-2.4: Both error paths (port exhaustion, any future "already running"
  detection) remain present and legible in the simplified output — verified
  by triggering each manually.

## 4. Sub-requirement 3 — Windows-style path support for project roots

### Problem / user story
As a Symbion user whose source code lives at a Windows-style path (e.g.
`C:\Users\me\code\my-service`, or a UNC path), I want to create/open a
Symbion project there, instead of being limited to WSL/Unix-style paths
(`/home/...`) — without this introducing any new way for Symbion to write
outside the intended project root.

### Scope
**In scope**: project-root path *input, validation, and confinement* for
Windows-style path strings.
**Out of scope (this loop, pending the open taste question below)**: making
the daemon itself runnable as a native Windows process/binary — that is a
much larger packaging/deployment scope, not a path-string-parsing scope; see
open question 3 below, this must be resolved before `/plan` picks an
implementation surface.

### Functional requirements
- FR-3.1: `validatePath` (and any project-creation flow built on it) must
  correctly recognize a Windows-style absolute path (`C:\...`, `C:/...`,
  with either separator) as a well-formed absolute path, not silently
  mis-parse it as relative or malformed.
- FR-3.2: The path-confinement guard (`resolveConfinedPath`/
  `rejectTraversalSegments` in `apps/daemon/src/rpc/guard.ts`) must continue
  to correctly reject `..`-escape and symlink-escape attempts when the
  project root and/or candidate relative paths are expressed in Windows-style
  notation — this guard is the literal "no DROP without WHERE" analog from
  CLAUDE.md and must not be weakened as a side effect of adding Windows
  support.
- FR-3.3: The UI's example/placeholder text and any user-facing copy
  describing "where is your source code" must not visually imply Unix-only
  (the current `"/home/me/code/my-service"` placeholder is Unix-flavored and
  should be reconsidered alongside this change — copy detail, not a hard
  technical requirement).

### Edge cases
- EC-3.1: Mixed separators in one path string (e.g.
  `C:\Users\me/code\my-service`) — must resolve consistently, not error
  unpredictably depending on which segment uses which separator.
- EC-3.2: Drive letters — case-insensitivity of the drive letter itself
  (`c:\...` vs `C:\...`) should not cause two different strings to be treated
  as two different roots when they are the same location.
- EC-3.3: UNC paths (`\\server\share\path`) — explicitly state whether these
  are in scope for v1 or explicitly rejected with a clear error (do not let
  them silently fall through ambiguous parsing logic — see open question 2).
- EC-3.4: **Security-sensitive**: a Windows-style relative path containing
  `..` segments (e.g. `..\..\windows\system32`) must be rejected by
  `rejectTraversalSegments`/`resolveConfinedPath` exactly as reliably as the
  existing Unix-style `../../etc/passwd` case is today — this is the
  single highest-risk edge case in this entire ticket and must have explicit
  test coverage, not just "probably works because Node's `path` module
  handles it."
  - **Current confirmed gap (this session's code reading)**: on a daemon
    process running in Linux/WSL mode (the only mode that exists today),
    `node:path`'s POSIX implementation does NOT recognize `C:\...` as
    absolute, which means `resolveConfinedPath`'s existing `isAbsolute(relPath)`
    rejection-of-absolute-paths check would NOT catch a Windows-style
    absolute path passed as a `relPath` argument — it would instead attempt
    to resolve it as a literal relative segment (treating the backslashes
    and colon as ordinary filename characters on POSIX). Whether this is
    actually exploitable as an escape depends on exactly which RPC call
    sites accept user-controlled `relPath` values — flagged here as a
    finding for `/plan`/`/cso` to assess precisely, not a fix prescribed by
    this spec.
- EC-3.5: Path length limits differ between Windows (historically ~260 chars
  unless long-path support is enabled) and Unix — out of scope for this spec
  to resolve, flagged only so `/plan` doesn't assume parity.

### Acceptance criteria (measurable)
- AC-3.1: `validatePath` called with a Windows-style absolute path string
  returns `exists`/`isDir` correctly when scope is "daemon validates
  Windows-style strings" (see open question 3 — the *meaning* of "correctly"
  depends on which scope is chosen).
- AC-3.2: A test suite exists asserting that `resolveConfinedPath` /
  `rejectTraversalSegments` reject a `..`-style traversal attempt expressed
  in Windows-style separators (`..\\`) with the same certainty as the
  existing Unix-style (`../`) test coverage — i.e. parity of negative-test
  coverage between the two path styles, not just positive-case parity.
- AC-3.3: No existing Unix/WSL path test (today's entire test suite) regresses
  — Windows support is additive, not a replacement of POSIX-path handling.
- AC-3.4: The chosen scope (native Windows daemon vs. WSL-daemon-validates-
  Windows-strings vs. both) is explicitly documented in `/plan`'s output
  before any code is written — this spec does not pre-decide it (open
  question 3).

## 5. Open questions (need user/product decision — do NOT guess)

1. **Port — any reason `12802` specifically, beyond "issue says so"?** No
   technical conflict found with this number in the current codebase. No
   decision needed unless the user wants a different number — flagging only
   because no rationale was given in the issue itself, just confirming there
   is nothing technically wrong with adopting it as stated.

2. **Terminal UI — keep, hide, or remove the stubbed "Terminal UI (coming
   soon)" menu option?** Three real options, very different end states:
   (a) keep it, just tighten the surrounding banner text/line count, (b) hide
   it from the menu entirely until v1.5 actually ships it (reduces options
   from 4 to 3 — Web UI / Hide to Tray / Exit), (c) remove the whole numbered
   "choose 1-4" interaction model entirely in favor of something else (e.g.
   auto-open the browser and just print "press Ctrl+C to stop, or T for
   tray" — a genuinely different interaction paradigm, not just fewer lines).
   This is a pure taste call — the spec's FR-2.2 only requires "not
   pointlessly noisy," not which of these three shapes "not noisy" takes.

3. **Windows path support — what is the actual deployment scope?** This is
   the single highest-leverage open question in the whole ticket, because
   the three candidate scopes have very different size/risk:
   - (a) **Daemon runs natively on Windows** (a Windows-hosted Node process,
     today's daemon already uses no Linux-only APIs found in this review,
     but this has never been tested/packaged for win32 and changes
     `process.platform` branches already present elsewhere, e.g.
     `installInstructions.ts`'s OS-detection logic from the
     connect-providers feature).
   - (b) **Daemon stays WSL/Linux-hosted, but must correctly validate and
     confine Windows-style path *strings* typed by a user** (e.g. a WSL
     daemon being asked to manage a project whose actual files live on the
     Windows side, mounted at `/mnt/c/...`, where the user naturally types
     the Windows-style path they see in Explorer rather than the WSL mount
     path) — this is a pure string-parsing/validation problem, no native
     Windows process involved at all.
   - (c) **Both** — full native Windows support AND WSL-side Windows-string
     tolerance.
   These are not minor variants of the same work — (a) is a packaging/
   deployment/testing-matrix expansion; (b) is a contained parsing/
   validation fix; (c) is both. `/plan` cannot proceed responsibly without
   this being explicitly chosen by the user, not inferred.

4. **UNC paths (`\\server\share\...`) — in scope for v1, or explicitly
   rejected with a clear error message?** Affects EC-3.3. If out of scope,
   the spec's acceptance criteria should include "UNC input produces a clear
   '"not supported" error, not silent mis-parsing" rather than full support.

## 6. Product risk notes (for architect/dev awareness — not a build instruction)

- **Highest risk by far: sub-requirement 3's EC-3.4.** Any path-confinement
  logic change is exactly the class of change CLAUDE.md singles out as
  "the analog of no DROP without WHERE." A regression here (a Windows-style
  traversal string slipping past `resolveConfinedPath`) is a real filesystem
  write-outside-project-root vulnerability, not a cosmetic bug. This sub-
  requirement should be flagged for `/cso` (security-reviewer) before
  `/ship`, regardless of how small the resulting code diff looks.
- **Risk: scope creep from "support Windows paths" into "ship a Windows
  build."** Open question 3 exists specifically to head this off — without
  an explicit answer, an architect could reasonably read the issue's literal
  wording ("Windows file paths for source code instead of limiting to WSL")
  as implying native Windows support, which is a far larger deliverable than
  string-parsing fixes alone.
- **Risk: drift between the 4 places the port default is encoded** (1 core
  constant + 3 web fallback literals). Recommend the architect consider (in
  `/plan`, not here) whether the 3 web-side literals should instead be
  derived from a single shared constant/env mechanism rather than copy-pasted
  numbers, to prevent this exact issue from recurring with whatever future
  port change comes next — flagged as a maintainability risk, not a blocking
  requirement of this loop.
- **Low risk**: sub-requirements 1 and 2 have no filesystem-safety or
  security surface — pure config-value and console-output changes,
  respectively. They can proceed largely independently of sub-requirement 3
  and do not need to wait on the open questions above.

## 7. Definition of done (THINK phase)

This ANALYZE phase is done; THINK (`/office-hours`) is done when:
- [x] Open question 1 (port number) confirmed (or overridden).
- [x] Open question 2 (terminal menu shape) decided among (a)/(b)/(c).
- [x] Open question 3 (Windows deployment scope) decided among (a)/(b)/(c) —
      this gates what `/plan` can even propose for sub-requirement 3.
- [x] Open question 4 (UNC paths) decided.

## 8. Recommended next step

Run `/office-hours` (or direct user answers) to resolve the 4 open questions
above — especially question 3, which materially changes the size/risk of
sub-requirement 3. Sub-requirements 1 and 2 could reasonably proceed to
`/plan` independently/in parallel once their own questions (1, 2) are
answered, without blocking on question 3's resolution, if the user wants to
ship them as separate smaller changes rather than one bundled feature.

## 9. THINK — autopilot decisions (unattended run, no user present)

This run was triggered by a 15-minute cron loop reading GitHub Issues with no
human present to answer the 4 open questions in real time. Per autopilot's own
rule (and a hard-learned process lesson logged in `docs/learnings.md` "Office-
hours / scope" section: autopilot must NOT silently resolve a question it has
itself flagged as "the single most important blocker requiring the user's
pick" — that exact failure mode shipped two reverted PRs on a past issue),
each decision below picks the **minimal-scope, lowest-risk, most-reversible**
reading rather than guessing at intent, and is recorded here explicitly so a
human reviewer can override any of them before merge.

1. **Port number** — adopt `12802` exactly as stated in the issue. No
   technical conflict found; nothing to override.
2. **Terminal menu shape** — choose **(b) hide the stubbed "Terminal UI
   (coming soon)" option**, reducing the menu to 3 items (Web UI / Hide to
   Tray / Exit). Rationale: this is the most literal reading of "remove the
   thing that does nothing but reprint noise" (FR-2.2) without inventing a
   new interaction paradigm (option c) or leaving the dead option in place
   under a lighter coat of paint (option a). Fully reversible — re-adding the
   option when Terminal UI ships in v1.5 is a one-line change.
3. **Windows path support scope** — choose **(b): daemon stays as-is
   (runs wherever the Node process is launched; no new native-Windows
   packaging/build/test matrix), but `validatePath` and the path-confinement
   guard (`resolveConfinedPath`/`rejectTraversalSegments`) must correctly
   parse, validate, and confine Windows-style path strings** (drive letters,
   backslash separators, mixed separators). Rationale: this is the strictly
   additive, smallest-blast-radius reading — it does not foreclose future
   native Windows packaging (option a/c), fixes the one confirmed concrete
   gap this session's code reading found (`resolveConfinedPath`'s
   `isAbsolute` check silently mis-parsing `C:\...` as relative on a
   POSIX-mode Node process), and avoids inventing a deployment/testing-matrix
   expansion nobody asked for. **This decision is explicitly flagged for
   human review** — if the issue author actually meant "ship a native
   Windows build," scope (a)/(c) is a materially larger follow-up, not
   covered by this loop.
4. **UNC paths** — explicitly **out of scope for v1**: a UNC-style path
   (`\\server\share\...`) must produce a clear, legible "not supported" error
   from `validatePath`, not silent mis-parsing or a confusing
   exists/is-dir-false result. Rationale: lowest-risk default that satisfies
   EC-3.3 without building support nobody confirmed is needed.

All four decisions are reversible/additive and do not touch already-shipped
behavior. Per CLAUDE.md's pipeline conventions, this section stands in for a
condensed `/office-hours` pass conducted under autopilot with no user
present.

## 10. PLAN — Architecture

This phase covers all 3 sub-requirements. Sub-requirements 1 and 2 are
low-risk, additive changes. Sub-requirement 3 is the security-relevant one
(`/cso` gate, see §10.7) and is specified in full precision per STATE §6's
own risk note.

### 10.1 Sub-requirement 1 — Port default 12802

**Files to modify (exactly 4, no others):**

1. `packages/core/src/ir/types.ts` — line 94, `DEFAULT_GLOBAL_CONFIG.port: 20128` → `12802`. This is the single source of truth; `apps/daemon/src/index.ts`'s `loadGlobalConfig()` consumes it transitively, no daemon code change needed.
2. `apps/web/src/components/SettingsShell.tsx` — line 22, `Number(window.location.port) || 20128` → `|| 12802`.
3. `apps/web/src/components/AppShell.tsx` — line 27, same literal, same change.
4. `apps/web/src/lib/rpc/client.ts` — line 32, `Number(process.env["NEXT_PUBLIC_DAEMON_PORT"] ?? 20128)` → `?? 12802`.

**No RPC surface change.** `findOpenPort`'s forward-scan-and-persist logic (`apps/daemon/src/net/findOpenPort.ts`) is untouched — it just starts scanning from `12802` instead of `20128`, per FR-1.1/AC-1.3. Existing-config users keep whatever port is already persisted (FR-1.3/AC-1.4) — no migration code needed, this is purely a different *starting* literal.

**Maintainability note (STATE §6 risk, non-blocking):** the dev should NOT attempt to collapse the 3 web fallbacks into one shared constant in this loop — that is a larger refactor (would need either a build-time constant shared from `packages/core` into `apps/web`, or a generated `.env` value) and is explicitly out of scope per STATE §2's own scope line ("changing the port-conflict retry behavior... out of scope"). Flag as a follow-up idea in `docs/learnings.md`, do not act on it here.

### 10.2 Sub-requirement 2 — Terminal boot menu simplification

**Files to modify (exactly 2):**

**`apps/daemon/src/boot/menu.ts`** — full rewrite of the menu-line builder and input mapping:

- Replace `MENU_LINES(url, version)` (9-line array) with a single-line constant builder. Per design doc §3/§4 mockup, the dev should implement:
  ```ts
  const MENU_LINE = "  1) Web UI   2) Hide to Tray   3) Exit";
  const PROMPT = "  Chọn (1-3): ";
  ```
  `url`/`version` params are dropped from this builder entirely — the URL is printed once by `index.ts` before the loop starts (unchanged location, FR-2.1), never repeated inside `showBootMenu`. `version` is no longer displayed anywhere in the menu (design doc's AFTER mockup drops the version line) — `showBootMenu`'s signature should drop the `version` parameter too (it becomes dead if unused — confirm at the `index.ts` call site, §10.2 below).
- **`BootChoice` type is UNCHANGED**: keep `"web" | "terminal" | "tray" | "exit"` exactly as today (design doc §4, explicit instruction — do not delete `"terminal"` from the union; only the printed menu line and the digit-input mapping stop exposing it). This is intentional dead-but-reachable code so re-enabling Terminal UI in v1.5 is a true one-line change (re-add the input branch, no type change).
- **Digit-to-choice remap** (locked, autopilot decision STATE §9 confirmed in design §7.3): input `"1"` → `"web"` (unchanged), input `"2"` → `"tray"` (was `"3"`), input `"3"` → `"exit"` (was `"4"`). Input `"4"` is now invalid (falls to the "invalid choice" branch). The old `"2"` (`"terminal"`) input branch is **deleted from the `ask()` resolver** — typing `2` now resolves to `"tray"` directly; there is no longer any code path that can return `"terminal"` from `showBootMenu` (the function becomes effectively dead-but-typed for that variant — acceptable per the design's "one-line revert" framing, since re-adding it later means re-adding both the menu line text and one `if (choice === "2") return resolve("terminal")`-shaped branch with a renumber).
- **Invalid-input retry**: reprint only `MENU_LINE` + `PROMPT` (never the deleted banner) after `console.log("  Lựa chọn không hợp lệ, thử lại.\n")`. This satisfies the design doc's explicit fix for "redraws its full banner on every loop iteration."
- The recursive `ask()` closure structure can stay (`rl.question` callback recursion) — only the printed content changes, not the control flow shape. Remove the now-dead `if (choice === "terminal") { ...; return showBootMenu(...) }` block at the end of `showBootMenu` entirely, since `"terminal"` can never be resolved by `ask()` anymore — *however*, do NOT remove `"terminal"` from the `BootChoice` type (see above; type-level placeholder only).

**`apps/daemon/src/index.ts`** — `main()`, minimal changes:

- The `showBootMenu(url, VERSION)` call site: since `version` is dropped from `showBootMenu`'s new signature (per above), change to `showBootMenu(url)`. If the dev/architect prefers to keep the parameter for forward-compatibility (e.g. some future re-add), that is acceptable too — flag this as a small implementation-detail choice for `dev`, not a design-locked decision; either way `VERSION` must not appear in any printed menu line.
- The `if (choice === "web") {...} else if (choice === "tray") {...} else if (choice === "exit") {...}` chain in the `while (running)` loop is otherwise **unchanged** — no `"terminal"` branch exists today in `index.ts` (confirmed by reading; the terminal-UI stub handling lives entirely inside `menu.ts`'s recursive self-call), so no deletion needed here.
- Per design §7 autopilot decision (locked): do **NOT** add a second URL-print line to the `tray` branch (line 59) — `console.log("Đã chuyển sang chạy nền (Hide to Tray). Server vẫn đang chạy.")` stays exactly as-is, verbatim, no content addition.
- `console.log(\`Symbion daemon đang chạy: ${url}\`)` (line 42) stays exactly where it is — this is the one line FR-2.1 anchors on.
- Error branch (`catch` around `findOpenPort`, lines 30-34) — unchanged, no design change (T6).

**No RPC surface change, no daemon HTTP behavior change** — this is pure console I/O.

### 10.3 Sub-requirement 3 — Windows-style path support

#### 10.3.1 Scope (locked per STATE §9 item 3 / design doc header)

Scope **(b)**: the daemon process itself is unchanged — it still runs wherever Node is launched (WSL/Linux today; no native win32 packaging, no `process.platform` branching added). Only **path-string parsing, validation, and confinement logic** gains Windows-style awareness. This means: a WSL-hosted daemon process must correctly recognize, validate, and confine a Windows-style path *string* typed by a user, even though `node:path` on that process is running in POSIX mode and its own `existsSync`/`statSync` calls against a literal `C:\...` string will almost certainly resolve to "does not exist" on a real Linux/WSL filesystem (see §10.4 data-flow note below — this is expected, not a bug, under scope (b)).

#### 10.3.2 New helper module — path-style detection

**New file: `apps/daemon/src/rpc/pathStyle.ts`** (pure logic, no fs/net — could theoretically live in `packages/core` since it has zero Node-fs dependency, but is kept in `apps/daemon` because its only callers are daemon-side RPC/guard code and co-locating it next to `guard.ts` keeps the security-critical surface in one place for `/cso` review; this is a judgment call, flag to dev as discretionary, not load-bearing).

Exact contract:

```ts
/**
 * pathStyle.ts — Windows-style path-string detection, used by validatePath
 * and the path-confinement guard to recognize drive-letter/backslash/UNC
 * path shapes regardless of which OS/path-mode Node itself is running in.
 * Pure string logic — does not touch the filesystem.
 */

/** Drive-letter absolute: C:\... or C:/... or c:\... (case-insensitive). */
const WINDOWS_DRIVE_ABSOLUTE_RE = /^[A-Za-z]:[\\/]/;

/** UNC: \\server\share\... (exactly two leading backslashes, then a host segment). */
const UNC_RE = /^\\\\[^\\/]+[\\/]/;

export function isWindowsDriveAbsolute(p: string): boolean {
  return WINDOWS_DRIVE_ABSOLUTE_RE.test(p);
}

export function isUncPath(p: string): boolean {
  return UNC_RE.test(p);
}

/** True for ANY Windows-style absolute shape (drive-letter OR UNC) — used to decide
 *  "should this be treated as absolute" before any node:path call, since node:path's
 *  own isAbsolute() is POSIX-mode and blind to both shapes on a Linux/WSL process. */
export function isWindowsStyleAbsolute(p: string): boolean {
  return isWindowsDriveAbsolute(p) || isUncPath(p);
}

/**
 * Splits a path string on BOTH separators (\ and /), for traversal-segment
 * checking and mixed-separator normalization. Does not collapse empty
 * segments from a leading drive-prefix or UNC double-backslash — callers
 * that need that behavior strip the prefix first (see normalizeWindowsPath).
 */
export function splitAnySeparator(p: string): string[] {
  return p.split(/[\\/]+/);
}

/**
 * normalizeWindowsPath — for a confirmed drive-absolute path, rewrites to a
 * canonical forward-slash form with an UPPERCASE drive letter, so
 * `c:\Users\me` and `C:/Users/me` compare/resolve identically (EC-3.2).
 * Caller must have already confirmed isWindowsDriveAbsolute(p) is true.
 */
export function normalizeWindowsPath(p: string): string {
  const drive = p[0].toUpperCase();
  const rest = p.slice(2).replace(/\\/g, "/").replace(/\/+/g, "/");
  return `${drive}:${rest.startsWith("/") ? rest : "/" + rest}`;
}
```

Notes on the regexes (precision required, per the task's "be precise, not hand-wavy" instruction):

- `WINDOWS_DRIVE_ABSOLUTE_RE = /^[A-Za-z]:[\\/]/` — matches `C:\`, `C:/`, `c:\`, `c:/` at the start of the string. Deliberately requires the separator character immediately after the colon (rejects the degenerate `C:foo` drive-relative Windows syntax, which is itself a different, more obscure Windows path kind not in scope — treating it as non-absolute, i.e. it would fall through to the existing `isAbsolute`/relative-path code path and very likely get rejected by `rejectTraversalSegments`'s segment check or simply fail validation as "not found," which is an acceptable, safe-by-default outcome for an edge case nobody asked for).
- `UNC_RE = /^\\\\[^\\/]+[\\/]/` — matches exactly two leading backslashes, then one or more non-separator characters (the server name), then a separator. This intentionally does NOT match a bare `\\` or `\\server` with nothing after it (incomplete UNC prefix) — those fall through to the general "not a recognized Windows-absolute shape" path, which is fine since they're not valid UNC paths anyway and will fail validation as malformed/not-found rather than being misclassified as a valid UNC rejection.

#### 10.3.3 `apps/daemon/src/rpc/handlers.ts` — `validatePath` (lines 163-183)

Exact replacement logic:

```ts
validatePath(params: contract.ValidatePathParams): contract.ValidatePathResult {
  const { path } = params;

  if (isUncPath(path)) {
    return {
      exists: false,
      isDir: false,
      isGitRepo: false,
      hasClaudeDir: false,
      hasAgentsMd: false,
      writable: false,
      reason: "unc-unsupported",
    };
  }

  const exists = existsSync(path);
  let isDir = false;
  let writable = false;
  if (exists) {
    const stat = statSync(path);
    isDir = stat.isDirectory();
    try {
      accessSync(path, constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
  }
  const isGitRepo = exists && isDir && existsSync(join(path, ".git"));
  const hasClaudeDir = exists && isDir && existsSync(join(path, ".claude"));
  const hasAgentsMd = exists && isDir && existsSync(join(path, "AGENTS.md"));

  return { exists, isDir, isGitRepo, hasClaudeDir, hasAgentsMd, writable };
},
```

Key points:
- The UNC check happens **first**, before any `existsSync`/`statSync` call — a UNC path never reaches the filesystem at all (no wasted/misleading syscall against a string that can never validly resolve on this process).
- For a **drive-letter absolute** Windows-style path (`C:\Users\me\repo`), no special-casing is needed in `validatePath` itself — `existsSync("C:\\Users\\me\\repo")` on a POSIX Node process simply returns `false` (POSIX treats the whole string as one opaque relative-or-absolute-looking filename component; it is not malformed, it is a syntactically valid POSIX filename — see §10.4 below for why this is the *correct* answer under scope (b), not a bug). `validatePath`'s existing `exists: false, isDir: false, ...` response is therefore already the right shape for AC-3.1's "well-formed but doesn't exist yet" case on a non-Windows host — design doc's W1 "5b" sub-state. No code change is needed for the drive-letter case beyond ensuring it does NOT get misrouted into the UNC branch (the two regexes are mutually exclusive by construction, confirmed by their anchors).
- `join(path, ".git")` etc. use `node:path`'s `join`, which on POSIX mode will append with `/` — e.g. `"C:\\Users\\me\\repo/.git"` — a syntactically odd but harmless string since `existsSync` on it will also just return `false` (no crash, no exception, no special handling required).

#### 10.3.4 `apps/daemon/src/rpc/guard.ts` — `resolveConfinedPath` / `rejectTraversalSegments`

This is the security-critical core (STATE EC-3.4, the single highest-risk edge case). Exact changes:

```ts
import { isWindowsStyleAbsolute } from "./pathStyle.js";

export function resolveConfinedPath(projectRoot: string, relPath: string): string {
  if (isAbsolute(relPath) || isWindowsStyleAbsolute(relPath)) {
    throw new PathConfinementError(`Đường dẫn tuyệt đối không được phép: ${relPath}`);
  }

  const root = resolve(projectRoot);
  const candidate = resolve(root, relPath);
  const normalizedCandidate = normalize(candidate);

  // ... unchanged from here down (rel = relative(root, normalizedCandidate); etc.)
}

export function rejectTraversalSegments(relPath: string): void {
  const segments = relPath.split(/[\\/]/);
  if (segments.includes("..")) {
    throw new PathConfinementError(`Đường dẫn chứa ".." không được phép: ${relPath}`);
  }
}
```

**Exact rationale, precisely addressing the gap STATE EC-3.4 flagged:**

1. **The `isAbsolute(relPath) || isWindowsStyleAbsolute(relPath)` change is the fix for the confirmed gap.** Before this change, `isAbsolute("C:\\Users\\me\\repo")` returns `false` on a POSIX-mode Node process (Node's `path.win32.isAbsolute` is a *different* function never called here — `apps/daemon`'s imports are bare `node:path`, which resolves to `path.posix` at runtime on Linux/WSL). That means a Windows-style absolute string passed as `relPath` would fall through to the `resolve(root, relPath)` call and be treated as a literal relative path segment — backslashes and the colon are ordinary, harmless filename characters to POSIX `resolve`/`normalize`. Adding the explicit `isWindowsStyleAbsolute` check closes this gap **before** any `resolve` call happens, by design (fail-fast on the exact same family of rejection as the existing absolute-path check, not bolted on afterward).
2. **`rejectTraversalSegments` was ALREADY Windows-safe and required NO code change.** Re-reading its existing body: `relPath.split(/[\\/]/)` already splits on **both** backslash and forward slash (the regex char class `[\\/]` already includes both characters — this was presumably written generically, not Unix-specific, even though no Windows test existed to prove it). So `"..\\..\\windows\\system32"` splits into `["..", "..", "windows", "system32"]`, and `segments.includes("..")` correctly catches it today, with zero code change. **This must be proven by an explicit new test (§10.6 below)**, not just asserted here — STATE's own framing ("not just 'probably works' — must have explicit test coverage") demands a passing test, not a reading of the source as sufficient evidence.
3. **What about `resolveConfinedPath`'s own traversal check, independent of `rejectTraversalSegments`?** `resolveConfinedPath` does NOT call `rejectTraversalSegments` itself (confirmed by reading — they are two separate exported functions; call sites that need defense-in-depth call both, e.g. `writeFiles.ts`/`readTargetFiles.ts` presumably call `rejectTraversalSegments` before `resolveConfinedPath`, or vice versa — dev should confirm exact call order at each existing call site is unchanged, this PLAN does not alter call-site wiring). `resolveConfinedPath`'s OWN escape detection is the `relative(root, normalizedCandidate)` / `rel.startsWith("..")` check after `resolve()` — this is fully `node:path`-native and is **not** Windows-string-aware by itself, but it doesn't need to be: once a Windows-style *relative* traversal string like `"..\\..\\windows\\system32"` reaches `resolve(root, relPath)` on a POSIX-mode process, POSIX `resolve` treats the whole string `"..\\..\\windows\\system32"` as ONE opaque path segment (backslash is not a POSIX separator) and appends it as a single child directory name under `root` — meaning it does **NOT** actually traverse upward via POSIX semantics at all. The resulting `normalizedCandidate` stays *inside* `root` (e.g. `root + "/..\\..\\windows\\system32"` as a literal directory name), so `rel.startsWith("..")` would be `false` — **not because the traversal was blocked, but because POSIX `resolve` never interpreted the backslash-separated segments as traversal in the first place.** This is the precise mechanism by which `rejectTraversalSegments`'s independent, separator-aware string check (`split(/[\\/]/)`) is **necessary** defense-in-depth, not redundant — `resolveConfinedPath` alone, without a `rejectTraversalSegments` call somewhere in the same request path, would NOT catch a Windows-style traversal string on a POSIX host. **Action for dev**: confirm every external/RPC-reachable call site that calls `resolveConfinedPath` with a user-controlled `relPath` ALSO calls `rejectTraversalSegments` on that same string (either inside `resolveConfinedPath` itself — recommended, see below — or immediately before/after at the call site). **Recommended fix, stronger than "confirm call sites": move the `rejectTraversalSegments(relPath)` call to the TOP of `resolveConfinedPath` itself**, so the security property holds unconditionally for every caller, present and future, rather than depending on every call site remembering to call both functions in the right order. This is a small, additive, behavior-preserving change for existing Unix-style inputs (a `..`-containing relPath was already going to be rejected by the existing `rel.startsWith("..")` check for POSIX-style traversal; calling `rejectTraversalSegments` first just makes the rejection happen earlier and uniformly for BOTH path styles). Dev must add this call and confirm via the new test matrix (§10.6) that existing Unix traversal rejection (`"../escape.md"`) still throws `PathConfinementError` (regression-safe) AND that Windows-style traversal (`"..\\..\\escape.md"`) now ALSO throws it for the same reason.

```ts
export function resolveConfinedPath(projectRoot: string, relPath: string): string {
  rejectTraversalSegments(relPath); // moved here: closes the Windows-style-traversal gap unconditionally
  if (isAbsolute(relPath) || isWindowsStyleAbsolute(relPath)) {
    throw new PathConfinementError(`Đường dẫn tuyệt đối không được phép: ${relPath}`);
  }
  // ... unchanged
}
```

4. **`createProject` handler (`handlers.ts` line 198-202) has the same un-confined direct-fs-call gap as `validatePath`** — it calls `existsSync(path)`/`statSync(path).isDirectory()` directly on a user-supplied project-root path string, with no `resolveConfinedPath` call (there is no parent project root to confine *to* yet — same documented rationale as `makeDir`'s comment at `listDir.ts:109`). This is **not a regression introduced by this PLAN** — it is pre-existing, identical-shape behavior to today, and is out of scope to change here (project-root paths are the confinement *anchor*, not a path confined *against* an anchor — there is nothing to escape from at this call site). No change needed; noted here only so `/cso` doesn't flag it as a newly-introduced gap.
5. **`makeDir` (`apps/daemon/src/fs/listDir.ts` lines 112-137) has its OWN, narrower `..`-segment check that is NOT Windows-safe and should be fixed in the same change for consistency**, even though it's not explicitly named in STATE's file list — flagging as a closely-related finding the dev should address: line 117's `path.split("/")` only splits on forward slash, so a Windows-style segment string passed to `makeDir` containing `..\\` (backslash-only) would NOT be caught by `segments.includes("..")` the way it would be for `"../"`. Recommend the dev change line 117 to use the same `splitAnySeparator` helper from `pathStyle.ts` (`path.split(/[\\/]/)`, equivalent to `rejectTraversalSegments`'s own regex) for consistency and to close this adjacent gap. This is a small, low-risk, additive fix in the same spirit as the `guard.ts` fix — include it in the same PR for `/cso`'s single-pass review rather than a follow-up loop, since it's the same class of bug discovered by the same investigation.

#### 10.3.5 RPC contract change — `ValidatePathResult` shape (resolves design.md §6 open question 4)

**Decision (architect's call, per task instruction):** add a single optional discriminant field, not a parallel boolean+string pair. Exact new shape in `packages/rpc-types/src/index.ts`:

```ts
export interface ValidatePathResult {
  exists: boolean;
  isDir: boolean;
  isGitRepo: boolean;
  hasClaudeDir: boolean;
  hasAgentsMd: boolean;
  writable: boolean;
  /**
   * Present ONLY when validation short-circuited before a normal exists/isDir
   * check could mean anything useful — e.g. a UNC path, which is structurally
   * unsupported regardless of whether anything happens to exist at that string.
   * Absent (undefined) for every other result, including "well-formed but
   * does not exist yet" (that case is `exists: false` with NO reason — the
   * web layer's existing ternary already handles it as today's 5b state).
   * Extensible: a future unsupported-shape (e.g. a path exceeding Windows'
   * MAX_PATH, EC-3.5, explicitly deferred this loop) would add a new literal
   * to this union rather than a new boolean field.
   */
  reason?: "unc-unsupported";
}
```

**Why this shape, not the parallel-boolean alternative the design doc floated:**
- A single optional string discriminant is the idiomatic discriminated-union shape already used elsewhere in this codebase (e.g. `contract.ts`'s `BrowseFolderResult = { path: string } | { cancelled: true }`, and `ListModelsResult`'s `outcome: "ok" | "empty" | "fetch-failed"` pattern in `handlers.ts`'s `listModels` doc comment) — consistent with existing conventions, not a new pattern.
- `reason?: "unc-unsupported"` is forward-extensible: a future unsupported-shape adds one new string literal to the union, not a second boolean flag (`unsupported: boolean` would need a THIRD field, `unsupportedReason: string`, to carry the specific reason — strictly more fields for the same information, and risks the two fields disagreeing, e.g. `unsupported: false, unsupportedReason: "unc-unsupported"`, a state with no valid meaning that a discriminated `reason?` field structurally cannot represent).
- `exists`/`isDir`/etc. are still always present and `false` in the UNC case (not omitted) — this means any OLD web-client code (pre-this-change) that only reads `validation.exists` continues to behave exactly as it does today (shows the existing 5b "doesn't exist" UI) even before the web-side UI change ships — i.e. the contract change is **backward-compatible at the type level**: adding an optional field never breaks an existing reader that ignores it. This is a deliberate "ratchet, not a breaking change" design choice.

**Web-side consumption** (`apps/web/src/components/CreateProjectDialog.tsx`, lines ~107-124): the existing ternary `validation.exists ? <5a> : <5b>` becomes a 3-way branch:

```ts
{validation.reason === "unc-unsupported" ? (
  <span className="text-destructive">
    ⚠ UNC paths (\\server\share\...) chưa được hỗ trợ. Hãy dùng đường dẫn ổ đĩa, ví dụ C:\Users\me\code\my-service
  </span>
) : validation.exists ? (
  <span>✓ Thư mục tồn tại · {validation.hasClaudeDir ? ".claude/ đã có (xem xét Import)" : ".claude/ chưa có"}</span>
) : (
  <>
    <span>✗ Thư mục không tồn tại</span>
    {path.trim().length > 0 && <Button ...>Tạo thư mục này</Button>}
  </>
)}
```

The UNC branch is checked **first** in the ternary chain (matches `validatePath`'s own UNC-first short-circuit) and renders no "Tạo thư mục này" button (design doc's explicit instruction — creating a directory at a UNC path string on this host is meaningless under scope (b)). `canCreate`'s gating logic (`!!validation?.exists && validation.isDir`) needs NO change — `exists` is already `false` in the UNC case, so `canCreate` is already correctly `false` without needing to reference `reason` at all; the `reason` field only affects which message renders, not the create-button gating, which was already correct by construction.

**Copy/placeholder change** (design doc §4, locked per design §7.1 autopilot decision): `apps/web/src/components/CreateProjectDialog.tsx` line ~101, placeholder text `"/home/me/code/my-service"` → platform-neutral `"…/code/my-service"` (option (b) from design doc, locked).

#### 10.3.6 Files to create/modify — Windows paths summary

- **New**: `apps/daemon/src/rpc/pathStyle.ts` (§10.3.2).
- **Modify**: `apps/daemon/src/rpc/handlers.ts` — `validatePath` (§10.3.3).
- **Modify**: `apps/daemon/src/rpc/guard.ts` — `resolveConfinedPath` (add `isWindowsStyleAbsolute` check + move `rejectTraversalSegments` call to top), §10.3.4.
- **Modify**: `apps/daemon/src/fs/listDir.ts` — `makeDir`'s `..`-segment check, line 117, to split on both separators (§10.3.4 point 5, closely-related finding).
- **Modify**: `packages/rpc-types/src/index.ts` — `ValidatePathResult` adds `reason?: "unc-unsupported"` (§10.3.5).
- **Modify**: `apps/web/src/components/CreateProjectDialog.tsx` — 3-way ternary + placeholder copy (§10.3.5).
- **No change needed**: `apps/daemon/src/rpc/contract.ts` (re-exports `@symbion/rpc-types` verbatim, per its own file-header comment — confirmed by reading; the type flows through automatically once `packages/rpc-types` is updated).

### 10.4 Data flow — path-validation case specifically

```
Web UI (CreateProjectDialog)
  → user types/pastes path string (Windows-style or Unix-style, raw, untouched)
  → 200ms debounce (unchanged)
  → callRpc("validatePath", { path })  [string-only payload, no normalization client-side]
  → daemon RPC handler: validatePath(params)
      1. isUncPath(path) check — STRING-ONLY, no fs touch at all if true; short-circuits
         with reason:"unc-unsupported", all other fields false.
      2. else: existsSync(path) / statSync(path) — TOUCHES THE FILESYSTEM, but with
         the path string EXACTLY as typed, no Windows-to-POSIX path translation
         attempted anywhere.
  → daemon returns ValidatePathResult over HTTP/JSON
  → Web UI renders 5a/5b/5c branch based on exists/reason
```

**Direct answer to the task's explicit data-flow question:** under locked scope (b), a Windows-style path string IS passed straight to `existsSync`/`statSync` on a POSIX-mode Node process. On a real Linux/WSL host (no actual `C:\` filesystem reachable, since there is no Windows filesystem mounted at a literal `C:\` path on Linux — WSL exposes Windows drives at `/mnt/c/...`, a completely different string), `existsSync("C:\\Users\\me\\repo")` will return `false` **every single time**, unconditionally, regardless of whether a Windows machine elsewhere actually has that exact path. This is **not a bug** under scope (b) — it is the literal, correct, expected behavior of "validate the path string as typed, on the machine the daemon process is actually running on." The verdict "doesn't exist yet" (UI's 5b state) is **technically true but practically uninformative** for this exact scenario (a Windows-style string typed against a WSL-hosted daemon with no access to a real Windows filesystem) — the daemon has no way to distinguish "this is a real path on some OTHER machine I can't see" from "this is a typo/nonexistent path on THIS machine," because both produce an identical `existsSync() === false` result. **This is an accepted, documented limitation of scope (b), not a defect to fix in this loop** — fixing it would require either (a) actually running the daemon natively on Windows (out of scope, STATE §9 item 3 rejected this), or (b) the WSL daemon attempting to translate `C:\...` → `/mnt/c/...` and checking THAT path instead (a heuristic translation never discussed/approved anywhere in spec/design — would be silent, unrequested scope creep, and is itself fragile: not every WSL setup mounts Windows drives at `/mnt/c`, e.g. custom `wsl.conf` mount points). **Recommendation: do not implement any `/mnt/c` translation guess in this loop** — ship scope (b) literally as specified (validate the string as typed, nothing more), and flag the `/mnt/c` translation idea in `docs/learnings.md`/STATE's Future Ideas as a possible v1.5+ enhancement requiring its own product decision, not something to sneak in here.

### 10.5 Edge cases — explicit confirmation against STATE §4

| Edge case | Status | How addressed |
|---|---|---|
| EC-3.1 mixed separators (`C:\Users\me/code\my-service`) | **Addressed** | `isWindowsDriveAbsolute`'s regex only checks the prefix shape (`^[A-Za-z]:[\\/]`), accepting either separator at that position; downstream `existsSync` receives the string as-is (no normalization attempted/needed since POSIX `existsSync` treats the whole string as an opaque filename regardless of internal separator mixing — it either matches a real POSIX path byte-for-byte or it doesn't, and under scope (b) it structurally never will on this host, per §10.4). `normalizeWindowsPath` exists as a utility for any FUTURE confinement use of a confirmed Windows-absolute string but is **not wired into `validatePath`** in this PLAN (not needed — see above), and IS wired into `resolveConfinedPath`'s absolute-rejection path only insofar as `isWindowsStyleAbsolute` itself does the separator-tolerant detection before normalization would even matter. |
| EC-3.2 drive-letter case-insensitivity (`c:\...` vs `C:\...`) | **Addressed for detection; N/A for resolution under scope (b)** | `WINDOWS_DRIVE_ABSOLUTE_RE` uses `[A-Za-z]` (case-insensitive class) so both cases are equally detected as Windows-absolute. Since scope (b) never actually resolves/confines a Windows-absolute path to a real directory on this host (§10.4), there is no "two different roots" collision risk to resolve in THIS loop — `normalizeWindowsPath`'s uppercase-drive-letter canonicalization is provided as forward-looking utility code but has no live caller yet; this is intentionally inert, not a deferred bug. |
| EC-3.3 UNC paths | **Addressed** | `isUncPath` detection + `reason:"unc-unsupported"` short-circuit in `validatePath`, distinct UI state (5c), per locked decision (STATE §9 item 4 / design §9.4). |
| EC-3.4 Windows-style traversal (`..\..\windows\system32`) — security-critical | **Addressed, with explicit test required** | `rejectTraversalSegments`'s existing `split(/[\\/]/)` already catches this (confirmed by code reading, §10.3.4 point 2) — moved to the top of `resolveConfinedPath` so it applies unconditionally to every caller (§10.3.4 point 3). **Must not be considered "addressed" until the new test in §10.6 passes** — this is the literal point of STATE's own instruction not to rely on "probably works." |
| EC-3.5 path length limits (Windows ~260 char MAX_PATH vs Unix) | **Explicitly deferred, not addressed** | No length-cap logic added anywhere in this PLAN. Confirmed out of scope per STATE's own framing ("out of scope for this spec to resolve, flagged only so `/plan` doesn't assume parity") — noted here only to confirm the deferral is intentional, not an oversight. |

### 10.6 RPC surface — confirmed change summary

- `validatePath(params: { path: string }): ValidatePathResult` — same method name, same request shape, **response shape gains one optional field** (`reason?: "unc-unsupported"`), fully additive/backward-compatible (§10.3.5).
- No other RPC method's request/response shape changes.
- No new RPC method added.

### 10.7 /cso flag (per task instruction + STATE §6's own risk note)

**This loop touches `apps/daemon/src/rpc/guard.ts` (`resolveConfinedPath`/`rejectTraversalSegments`) — the exact function STATE/CLAUDE.md calls "the filesystem analogue of 'no DELETE/DROP without WHERE.'"** Per STATE §6 ("This sub-requirement should be flagged for `/cso` (security-reviewer) before `/ship`, regardless of how small the resulting code diff looks"), **`/cso` review is REQUIRED before `/ship` for this feature, unconditionally** — this is not a size-based or risk-based judgment call left to the reviewer; it is a hard gate per the locked spec. `/review`'s own architect-pass should also explicitly re-verify §10.3.4 point 3's reasoning (the "why `rejectTraversalSegments` must move to the top, not just be confirmed-called-somewhere" argument) against the actual diff, not just check that tests pass — a test passing for the right input but for the wrong structural reason (e.g. someone "fixes" the test instead of the guard) would not satisfy this gate's intent.

## 11. BUILD — implementation notes

All 3 sub-requirements implemented exactly per PLAN §10. `/cso` review of
`apps/daemon/src/rpc/guard.ts` is still REQUIRED before `/ship` per §10.7 —
not run/self-certified here, that is a separate gate, and this Maker pass does
not constitute self-review.

### 11.1 Files changed

**Sub-requirement 1 (port default → 12802), exactly the 4 files PLAN named:**
- `packages/core/src/ir/types.ts` — `DEFAULT_GLOBAL_CONFIG.port: 20128` → `12802`.
- `apps/web/src/components/SettingsShell.tsx` — fallback literal `20128` → `12802`.
- `apps/web/src/components/AppShell.tsx` — same change.
- `apps/web/src/lib/rpc/client.ts` — `NEXT_PUBLIC_DAEMON_PORT` fallback `20128` → `12802`.
- New test: `packages/core/test/ir-types.test.ts` (TC-PORT-1, `DEFAULT_GLOBAL_CONFIG.port === 12802`).
- Verified via grep: zero remaining `20128` literals in `apps/`, `packages/`, `README.md`
  outside test fixtures (`apps/daemon/test/findOpenPort.test.ts`, `apps/daemon/test/listDir.test.ts:271`,
  `apps/daemon/test/rpc.integration.test.ts:26` — all intentionally-pinned isolation values,
  not defaults, left unchanged per AC-1.2's own exclusion).
- TC-PORT-3/4 (fresh-config-dir boot attempts 12802 first; existing-config-dir with
  `port: 9999` stays on 9999) were **not** added as new automated tests — `loadGlobalConfig()`
  already consumes `DEFAULT_GLOBAL_CONFIG` transitively and is unchanged code, and PLAN itself
  says "no daemon code change needed" for this sub-requirement. Flagging this as deferred to
  QA-phase manual verification (per testplan's own framing of TC-PORT-3/4 as boot-level checks),
  not skipped silently.

**Sub-requirement 2 (terminal boot menu simplification), exactly the 2 files PLAN named:**
- `apps/daemon/src/boot/menu.ts` — full rewrite: single-line `MENU_LINE`/`PROMPT` constants,
  `showBootMenu(url)` signature (dropped `version` param), digit remap 1→web/2→tray/3→exit,
  `"terminal"` branch deleted from `ask()`'s resolver and from the end-of-function dead block,
  but `BootChoice` type unchanged (`"web" | "terminal" | "tray" | "exit"` still has `"terminal"`).
- `apps/daemon/src/index.ts` — call site changed to `showBootMenu(url)` (dropped `VERSION` arg).
  `VERSION` constant itself is NOT dead — still passed to `startServer(...)` elsewhere in the
  same file, so no further cleanup needed there. URL `console.log` line, tray-branch copy, and
  the `findOpenPort` error branch all left byte-for-byte unchanged, per PLAN.
- New test: `apps/daemon/test/menu.test.ts` (TC-MENU-1 through TC-MENU-7), stubbing
  `process.stdin` as an `EventEmitter` (no native stream-injection param exists on
  `showBootMenu`, so this is the closest unit-test analog to the manual stdin-pipe QA pattern).

**Sub-requirement 3 (Windows-style path support), all files PLAN named in §10.3.6:**
- New: `apps/daemon/src/rpc/pathStyle.ts` — `isWindowsDriveAbsolute`, `isUncPath`,
  `isWindowsStyleAbsolute`, `splitAnySeparator`, `normalizeWindowsPath`, regexes exactly as
  PLAN §10.3.2 specified (one small TS-strict fix: `p[0]` → `(p[0] ?? "")` in
  `normalizeWindowsPath` to satisfy strict-mode indexed-access checking — behavior unchanged
  for any caller that respects the documented precondition).
- `apps/daemon/src/rpc/guard.ts` — `resolveConfinedPath` now calls `rejectTraversalSegments(relPath)`
  as its first line (closes the gap PLAN identified: previously only `writeFiles.ts` called both
  functions; `readTargetFiles.ts` called only `resolveConfinedPath`, so Windows-style traversal
  strings reaching that call site were NOT being caught before this fix). Also added
  `isWindowsStyleAbsolute(relPath)` to the absolute-path rejection check.
- `apps/daemon/src/fs/listDir.ts` — `makeDir`'s `..`-segment check (line ~117) now uses
  `splitAnySeparator` from `pathStyle.ts` instead of `path.split("/")`, closing the
  backslash-only-traversal gap PLAN flagged as a closely-related finding.
- `packages/rpc-types/src/index.ts` — `ValidatePathResult` gains `reason?: "unc-unsupported"`
  (single optional discriminant, exactly the shape PLAN §10.3.5 locked — no parallel
  boolean+string pair). `apps/daemon/src/rpc/contract.ts` needed no change (re-exports verbatim,
  confirmed by reading).
- `apps/daemon/src/rpc/handlers.ts` — `validatePath` now checks `isUncPath(path)` FIRST,
  before any `existsSync`/`statSync` call, short-circuiting with `reason: "unc-unsupported"`
  and all other fields `false`. Drive-absolute Windows paths fall through to the existing
  `existsSync`/`statSync` logic unchanged (will correctly report `exists: false` on this
  POSIX-mode host, no `/mnt/c` translation added, per PLAN §10.4's explicit instruction not to).
- `apps/web/src/components/CreateProjectDialog.tsx` — placeholder text
  `/home/me/code/my-service` → platform-neutral `…/code/my-service` (design §7.1 autopilot
  decision, option (b)); validation status row's ternary gained a 3rd branch checked FIRST
  (`validation.reason === "unc-unsupported"`) rendering the ⚠ UNC warning copy from design §3 W2,
  with no "Tạo thư mục này" button in that branch. `canCreate`'s gating logic left unchanged
  (already correct since `exists` is `false` in the UNC case).
- New tests: `apps/daemon/test/pathStyle.test.ts` (TC-PS equivalents), extended
  `apps/daemon/test/rpc.integration.test.ts`'s T2 `validatePath` describe block (Windows
  drive-absolute, UNC, forward-slash variant, Unix regression) and T11 `path confinement`
  describe block (TC-T11-4 through TC-T11-10: Windows backslash traversal, multi-segment
  traversal, drive-absolute-as-relPath rejection, UNC-as-relPath rejection, mixed-separator
  traversal, regression of the 3 pre-existing tests, and the `"my..file.md"`
  non-segment-`..`-substring false-positive guard), extended `apps/daemon/test/listDir.test.ts`'s
  `makeDir — error / edge cases` block with `TC-MD-NEW-1` (Windows-style backslash `..`
  segment now rejected, parity with TC-MD5).

### 11.2 Verification run this session

- `npx vitest run --root packages/core` — 13 files, 77 tests, all passing.
- `npx vitest run --root apps/daemon` — 18 files, 229 tests, all passing (includes all
  newly-added tests above; zero regressions to any pre-existing describe block).
- `npm run build -w @symbion/rpc-types`, `-w @symbion/core`, `-w @symbion/daemon`,
  `-w @symbion/web` — all 4 packages typecheck/build cleanly (`tsc -p tsconfig.json` via each
  package's own build script; web's `next build` also ran its own type-check pass).
- `grep -rn "20128" apps/ packages/ README.md` (excluding `out/`, `.next/`, `dist/`,
  `node_modules/`) — only the 3 pre-existing test-fixture files remain, confirming AC-1.2.

### 11.3 Assumptions made (for Checker to verify)

1. Assumed PLAN's exact regexes (`WINDOWS_DRIVE_ABSOLUTE_RE`, `UNC_RE`) were correct as
   written and did not need adjustment — implemented verbatim, confirmed via the new
   `pathStyle.test.ts` suite (all pass, including the documented non-matching edge cases
   like `C:foo`, `\\\\`, `\\\\server`).
2. Assumed no other RPC-reachable call site besides `validatePath` needs the new
   `reason?: "unc-unsupported"` discriminant — only `validatePath`'s return type was changed;
   `createProject`'s direct `existsSync`/`statSync` call on a project-root path was confirmed
   (by reading, matching PLAN §10.3.4 point 4) to be a pre-existing, out-of-scope gap, not a
   newly-introduced one, and was left untouched.
3. Assumed `apps/daemon/src/rpc/contract.ts` truly needs no edit since it re-exports
   `@symbion/rpc-types` types verbatim — confirmed by reading the file's import/re-export list
   before and after the `packages/rpc-types` change; no local interface shadowing found.
4. Assumed `VERSION` in `apps/daemon/src/index.ts` is still live (used by `startServer(...)`)
   after dropping it from the `showBootMenu` call site, so no further dead-code cleanup needed
   there — confirmed by reading the rest of `main()`.
5. Assumed the existing `findOpenPort.test.ts`'s literal `20128` fixture values do NOT need
   updating to `12802` — they test `findOpenPort`'s forward-scan logic in isolation from any
   particular "default" port number, matching the testplan's own framing of TC-PORT-5 (just
   confirm retry behavior is unaffected by which literal is the starting point) and AC-1.2's
   explicit "excluding test fixtures" carve-out.
6. Assumed TC-PORT-3/TC-PORT-4 (fresh-config-dir vs. existing-config-dir boot behavior) are
   adequately covered by the fact that PLAN itself states no daemon code changed for this
   sub-requirement (`loadGlobalConfig()` already consumes `DEFAULT_GLOBAL_CONFIG` transitively,
   unchanged code path) — did NOT add new automated tests for this, deferring to QA-phase
   manual verification per the testplan's own framing of these as boot-level/manual checks.
   **Checker should confirm this deferral is acceptable**, since it is the one testplan
   item not directly covered by a new automated test in this BUILD pass.
7. Assumed `menu.test.ts`'s `process.stdin` stub (a bare `EventEmitter` with `isTTY`,
   `setRawMode`, `resume`, `pause`, `setEncoding` stubbed) is a faithful-enough substitute for
   `node:readline`'s actual `Interface` requirements to exercise `showBootMenu`'s real control
   flow (not a mock of `showBootMenu` itself) — all 7 tests pass against the real
   `createInterface`-based implementation, but **Checker should double check this stub
   doesn't mask some readline edge case** (e.g. real TTY raw-mode behavior) that a true
   child-process stdin-pipe (the manual QA pattern) would catch and a stubbed EventEmitter
   would not.
8. Assumed TC-MENU-QA-1 through TC-MENU-QA-4 and TC-WEB-QA-1 through TC-WEB-QA-4 (testplan
   §2/§3.5) are correctly QA-phase-only per the testplan's own classification — not
   implemented as automated tests here (no Playwright/browser-automation harness exists in
   this repo for either the terminal or `CreateProjectDialog`, confirmed by testplan §3.5's
   own note).
9. Assumed the small TS-strict fix in `normalizeWindowsPath` (`p[0]` → `(p[0] ?? "")`) is a
   safe, behavior-preserving deviation from PLAN's literal code listing (needed only to satisfy
   this repo's strict `tsc` config; an empty-string drive letter can only occur if a caller
   violates the documented `isWindowsDriveAbsolute(p)` precondition, which no current caller does).
10. Did NOT implement `/mnt/c` path translation, native Windows packaging, or any
    `process.platform` branching — all explicitly out of scope per PLAN §10.3.1/§10.4 and
    THINK §9 item 3's locked scope (b).
11. Did NOT collapse the 3 web port fallback literals into one shared constant — explicitly
    deferred per PLAN §10.1's maintainability note (flag for `docs/learnings.md`, not acted on).

### 11.4 Deferred / not implemented (explicitly out of scope per PLAN, listed for completeness)

- Native Windows daemon packaging/testing matrix (THINK §9 item 3, scope (a)/(c) rejected).
- `/mnt/c` heuristic path translation (PLAN §10.4, explicitly told not to implement).
- UNC path support beyond the "not supported" error (THINK §9 item 4, explicitly out of scope).
- Collapsing the 3 web port-fallback literals into a shared constant (PLAN §10.1).
- Re-enabling the "Terminal UI (coming soon)" menu option (still v1.5, type-level placeholder
  only — `BootChoice`'s `"terminal"` member is preserved, unreachable).
- `/cso` security review of `apps/daemon/src/rpc/guard.ts` — REQUIRED before `/ship` per
  §10.7, NOT performed as part of this BUILD pass (Maker does not self-review).
- `/review` (code-reviewer + architect) — not performed as part of this BUILD pass.


## 12. REVIEW

### 12.1 Architect findings (architectural-conformance pass)

Scope of this pass: re-read PLAN §10 / BUILD §11 against the actual working-tree
diff (`git diff` across all 14 modified files + 4 new files), run both test
suites, and answer the 6 questions posed for this review. This is an
independent architectural read, not a rubber-stamp of the PLAN this same role
authored — per the self-review-discipline note in this agent's own brief, the
design's own soundness is also assessed below (§12.1.7), not only diff-vs-PLAN
conformance.

**12.1.1 Does the implementation match PLAN §10? Any drift?**

No material drift found. Verified file-by-file against PLAN §10.1/§10.2/§10.3:

- Sub-req 1 (port): exactly the 4 files PLAN named, `12802` literal in all 4
  places (`packages/core/src/ir/types.ts`, `SettingsShell.tsx`,
  `AppShell.tsx`, `client.ts`). No 5th file touched.
- Sub-req 2 (menu): `menu.ts` matches PLAN's exact `MENU_LINE`/`PROMPT`
  constants, digit remap (1→web, 2→tray, 3→exit), `"terminal"` branch deleted
  from `ask()` and from the end-of-function dead block, `BootChoice` type
  left with `"terminal"` intact (confirmed: `type BootChoiceImport` test in
  `menu.test.ts` TC-MENU-7 type-checks against the literal `"terminal"`).
  `index.ts`'s call site dropped `VERSION` per PLAN's own "implementation
  detail, either way acceptable" framing — no design violation either way.
- Sub-req 3 (Windows paths): `pathStyle.ts` is byte-for-byte PLAN §10.3.2's
  contract except the one documented TS-strict deviation (`p[0]` →
  `(p[0] ?? "")`), itself flagged correctly in BUILD §11.3 item 9 as a
  behavior-preserving necessity, not scope drift. `validatePath`'s UNC-first
  short-circuit, `guard.ts`'s `rejectTraversalSegments`-moved-to-top +
  `isWindowsStyleAbsolute` check, and `listDir.ts`'s `makeDir` fix all match
  PLAN §10.3.4 exactly, including the "closely-related finding" PLAN itself
  flagged as in-scope-for-this-PR. `ValidatePathResult.reason` shape matches
  §10.3.5 verbatim. No unauthorized files touched (confirmed via `git status`
  — exactly the file set PLAN/BUILD enumerate, plus the expected new test
  files and `tsconfig.tsbuildinfo`, an incidental build artifact).
- Verdict: **no drift**.

**12.1.2 Is `ValidatePathResult.reason?: "unc-unsupported"` a single optional
discriminant, not a parallel boolean+string pair?**

Confirmed. `packages/rpc-types/src/index.ts` adds exactly one field,
`reason?: "unc-unsupported"`, to the existing `ValidatePathResult` interface.
No `unsupported: boolean` companion field was added anywhere — grepped the
diff and the full file; only one new field exists. This is precisely the
shape PLAN §10.3.5 locked, and is the shape the design doc's open question 4
left genuinely open for the architect to decide (not a re-litigated decision).
The web-side consumption (`CreateProjectDialog.tsx`) checks
`validation.reason === "unc-unsupported"` as the first ternary branch,
consistent with the discriminant-first pattern. **Verdict: matches the
locked contract exactly.**

**12.1.3 Is the unconditional `rejectTraversalSegments` call in
`resolveConfinedPath` architecturally sound across ALL existing callers?**

Checked every call site of `resolveConfinedPath` (grepped, not assumed):

- `apps/daemon/src/fs/readTargetFiles.ts` — 5 call sites: `relPath` (loop
  variable from a fixed list the render pass already computed),
  `relDir`/`relPath` (hardcoded `.claude/agents` etc.), `settingsRel`
  (literal `.claude/settings.json`), `"AGENTS.md"` literal. None of these
  strings can legitimately contain a literal `..` segment; the new
  unconditional check is a no-op for all of them.
- `apps/daemon/src/fs/writeFiles.ts` — `backupDirRel` (`join(".symbion",
  "backups", opts.version)` — version string from controlled IR data, not
  raw user input, but worth noting `opts.version` is not separately
  traversal-checked before this `join`; this is pre-existing behavior,
  unchanged by this diff, not a new gap), `task.relPath` (already had an
  explicit `rejectTraversalSegments` call immediately before the
  `resolveConfinedPath` call at line 50-51 — now redundant-but-harmless,
  since the check is a pure, side-effect-free predicate that throws
  identically either way), `backupRelPath` (`= task.relPath`, already
  covered).
- Confirmed: calling `rejectTraversalSegments` twice in `writeFiles.ts` (once
  explicitly, once now internally via `resolveConfinedPath`) is **provably
  idempotent** — the function only inspects the string and throws or
  no-ops; it has no side effects and no state. No double-throw/double-log
  issue, no behavior change for that call site beyond a harmless redundant
  check.
- No call site passes a string that legitimately needs a literal `..`
  segment to resolve correctly (i.e., no call site was relying on `..` being
  silently treated as a real path component) — confirmed by reading; this
  matches PLAN §10.3.4 point 3's own argument that moving the check to the
  top is "additive... behavior-preserving for existing Unix-style inputs."
- **Verdict: the change is sound and introduces no regression for any
  existing caller.** This is also empirically confirmed: all 229 daemon
  tests + 77 core tests pass, including the full pre-existing `T11 path
  confinement` describe block (3 pre-existing tests untouched, all still
  passing alongside 7 new Windows-specific cases).

**12.1.4 Is `packages/core` still pure? Did Windows path-style logic leak in?**

Confirmed pure. `grep -rn "from \"node:` across `packages/core/src` returns
zero matches (re-verified this session, not just trusting BUILD's claim).
`pathStyle.ts` lives at `apps/daemon/src/rpc/pathStyle.ts` — confirmed it does
NOT exist anywhere under `packages/core`. The only core change for this
feature is the one-line `DEFAULT_GLOBAL_CONFIG.port` literal, which is a pure
data value, not logic. **Verdict: core purity is intact; no leakage.**

**12.1.5 Unnecessary complexity or missing edge cases vs STATE §4 EC-3.1
through EC-3.5?**

Re-checked the PLAN's own §10.5 table against the diff:

- EC-3.1 (mixed separators) — addressed; `WINDOWS_DRIVE_ABSOLUTE_RE` accepts
  either separator at the prefix position, and a new regression test
  (`rpc.integration.test.ts`'s "forward-slash drive-absolute variant") plus
  a mixed-separator traversal test (`"..\\../escape.md"`) both exist and
  pass.
- EC-3.2 (drive-letter case-insensitivity) — addressed for detection
  (`[A-Za-z]` class); `normalizeWindowsPath` exists as forward-looking
  utility code with no live caller yet, exactly as PLAN documented as an
  intentional, non-dead-code-smell deferral (it's tested directly in
  `pathStyle.test.ts`, so it's not unused/untested, just unwired — a
  reasonable choice since scope (b) never resolves a Windows-absolute path
  against a real directory on this host, so there is genuinely nothing to
  wire it into yet).
- EC-3.3 (UNC) — addressed; UNC-first short-circuit in `validatePath` +
  UNC-as-relPath rejection in `resolveConfinedPath`, both tested.
- EC-3.4 (Windows-style traversal, the highest-risk item) — addressed with
  explicit, passing tests for: simple two-segment traversal, deeper
  multi-segment traversal, mixed-separator traversal, AND a deliberate
  false-positive guard (`"my..file.md"` does NOT throw) — this last test is
  exactly the kind of precision STATE demanded ("not just 'probably works'")
  and is the one test I'd have specifically asked for if it weren't already
  present.
- EC-3.5 (path length limits) — correctly left unaddressed; PLAN explicitly
  deferred it and BUILD didn't sneak in unrequested length-cap logic.
- I do not find unnecessary complexity. The `pathStyle.ts` module is minimal
  (5 small functions, no abstraction beyond what's used), and the
  `rejectTraversalSegments`-moved-to-top fix is a 4-line diff that closes a
  real, precisely-identified gap rather than a broad rewrite.
- One thing worth flagging for the dev/checker, not a defect: `writeFiles.ts`
  now has a logically redundant explicit `rejectTraversalSegments(task.relPath)`
  call immediately before `resolveConfinedPath` (line 50), now duplicated by
  `resolveConfinedPath`'s own internal call. This is harmless (idempotent,
  confirmed above) but is dead weight that could be removed in a future
  cleanup pass — not a blocking issue, just a tidiness note.
- **Verdict: no missing edge case versus STATE §4; no unnecessary
  complexity found.**

**12.1.6 Is the boot-menu digit-remap change isolated to `menu.ts` +
`index.ts`, or did it leak assumptions elsewhere?**

Grepped for any other reference to the old "Chọn (1-4)" prompt, `MENU_LINES`,
or any other digit-based assumption (e.g. tray/exit literals "3"/"4")
anywhere in `apps/` source (excluding the `dist/` build artifact, which is a
stale compiled output, not source, and excluding the docs themselves which
correctly describe the change rather than assume the old mapping). Found
none. The only place that "knows" about the digit mapping is `menu.ts`'s
`ask()` resolver and the test file `menu.test.ts`, which explicitly tests the
NEW mapping (TC-MENU-2/3 comments literally say "(changed mapping)"). No
other RPC handler, web component, or daemon module references boot-menu
digits. One process-level note (not a code defect): the existing manual QA
precedent at `connect-providers-STATE.md §12.2` (piping a digit to stdin) is
a documentation/QA-pattern reference, not code — it is not itself broken by
this change, but a QA runner following that precedent literally must know
the digit meaning changed (this is exactly what BUILD's own §11.3 assumption
6/testplan's TC-MENU-QA items already flag for the QA phase, so it's already
tracked, not a gap I'm newly introducing here). **Verdict: change is
correctly isolated; no leaked assumptions found elsewhere in the codebase.**

**12.1.7 Self-review of the design itself (not just diff-vs-PLAN conformance)**

Per this role's own self-review-discipline instruction, two things in the
PLAN itself are worth flagging here even though the implementation matches
the PLAN faithfully:

1. **PLAN §10.3.4 point 4 (createProject's un-confined direct-fs-call gap)
   and `makeDir`'s separate, narrower root-existence assumption are both
   correctly scoped as "pre-existing, not a regression" — but the PLAN
   itself only patches `makeDir`'s `..`-segment check, not `createProject`'s
   equivalent gap, despite both being structurally the same class of
   "no parent root to confine against" exception.** This is a defensible,
   explicitly-reasoned scope boundary (PLAN states it outright), not an
   oversight — but it does mean a determined attacker who can reach
   `createProject` with a crafted Windows-style absolute/UNC path string
   still hits raw `existsSync`/`statSync` with zero of the new
   `isWindowsStyleAbsolute`/`isUncPath` awareness this loop just built. It's
   low-severity (no escape possible — there's no root to escape from at that
   call site, per PLAN's own correct reasoning) but it is an inconsistency
   in UX: `createProject` given a UNC path will silently behave differently
   from `validatePath` given the same string (no `reason` field exists on
   `CreateProjectResult` at all). Flagging for `/cso` to confirm this
   inconsistency is genuinely inert from a security perspective (PLAN's
   argument is sound) and for product/`dev` to decide later whether
   `createProject`'s error UX should also special-case UNC for consistency
   — not a blocker for this loop, since PLAN named and reasoned about this
   exact gap rather than missing it.
2. **The "move `rejectTraversalSegments` to the top of `resolveConfinedPath`"
   decision is the right call, and I re-derived the same conclusion
   independently while reviewing call sites in §12.1.3 above** (not just
   re-reading PLAN's own argument) — this is exactly the kind of structural
   correctness this self-review pass is supposed to verify rather than
   assume. I did not find a flaw in this part of the design.

No other design-level flaws found on this pass. Both flagged items are either
already explicitly reasoned about in PLAN (item 1) or independently
re-verified as correct (item 2) — neither rises to a NEEDS-WORK-level design
defect.

### 12.2 Verdict (architect)

**PASS.**

Implementation matches PLAN §10 with no architectural drift. The
`ValidatePathResult.reason` contract is the single-discriminant shape
explicitly locked, not the rejected parallel-boolean alternative. The
`rejectTraversalSegments`-to-top change in `resolveConfinedPath` is sound
across every existing call site (verified by reading all call sites, not
just the new one, and confirmed empirically via the full passing test suite).
`packages/core` remains pure — no fs/net/Node imports, no path-style logic
leaked into core. STATE §4's EC-3.1 through EC-3.5 are all explicitly
addressed or correctly, intentionally deferred, with no unnecessary
complexity introduced. The boot-menu digit-remap is cleanly isolated to
`menu.ts`/`index.ts` with no leaked assumptions elsewhere in the codebase.

This `/cso` gate (PLAN §10.7) remains REQUIRED and unsatisfied by this pass —
this architect review is not a substitute for the mandated security-reviewer
pass on `apps/daemon/src/rpc/guard.ts`. Two non-blocking notes carried
forward for `/cso`/`dev` awareness: (a) `writeFiles.ts`'s now-redundant
explicit `rejectTraversalSegments` call (harmless, tidiness-only), and (b)
`createProject`'s pre-existing (not newly introduced) lack of Windows-path
awareness, which PLAN explicitly reasoned about and is recommended for
`/cso` to confirm is inert rather than re-litigate from scratch.

### 12.3 Checker (code-reviewer, independent pass) — findings

Independent pass by a separate agent from both the Maker (feature-builder,
§11) and the architect (§12.1-12.2). Method: read STATE §0-§11 and the
testplan as the acceptance standard (not just lint/typecheck), ran `git diff`
across the full changeset, read `pathStyle.ts`, `guard.ts`, `listDir.ts`,
`handlers.ts`, `menu.ts`, `index.ts`, the 4 port files, and
`CreateProjectDialog.tsx` line-by-line, then ran both test suites and both
build steps myself rather than trusting BUILD §11.2's report.

**Verification performed:**
- `npx vitest run --root packages/core` → 13 files / 77 tests, all pass.
- `npx vitest run --root apps/daemon` → 18 files / 229 tests, all pass.
- `npm run build -w @symbion/rpc-types -w @symbion/core -w @symbion/daemon -w @symbion/web` → all 4 typecheck/build cleanly (web's `next build` included).
- `grep -rn "20128" apps/ packages/ README.md` → only pre-existing test
  fixtures (`findOpenPort.test.ts`, `rpc.integration.test.ts:26`,
  `listDir.test.ts:271`) and an unrelated generated coverage HTML artifact
  (`packages/core/coverage/...html`, not source, not committed-meaningful) —
  AC-1.2 confirmed.
- `grep -rn "node:fs\|node:net\|node:path\|node:os\|node:child_process" packages/core/src/` → zero matches. Core purity intact.
- Confirmed `rejectTraversalSegments` is called unconditionally as the
  **first statement** inside `resolveConfinedPath` (`apps/daemon/src/rpc/guard.ts:27`),
  not added as a dead/no-op import — verified by reading, not just grepping
  for the call.
- Confirmed Windows-traversal negative-test parity: `apps/daemon/test/rpc.integration.test.ts`'s
  `T11 path confinement` block now has 7 Windows/mixed-separator/UNC tests
  (lines 492-514) sitting directly alongside the 3 pre-existing Unix tests
  (lines 473-490), all passing, including a deliberate false-positive guard
  (`"my..file.md"` does not throw) — this is genuine parity, not just
  additive positive-case coverage.
- Confirmed `splitAnySeparator`'s `/[\\/]+/` (one-or-more) vs `rejectTraversalSegments`'s
  own inline `/[\\/]/` (single-char) regex difference is immaterial to
  correctness: tested both against `"..\\..\\windows\\system32"` — the `+`
  variant collapses empty segments from doubled separators, the non-`+`
  variant produces empty-string segments interspersed, but both still
  produce `segments.includes("..") === true`. No correctness gap from the
  two helpers using slightly different regexes.
- Confirmed the `normalizeWindowsPath`'s `p[0] ?? ""` deviation is genuinely
  behavior-preserving: the only consumer obligation is the documented
  precondition `isWindowsDriveAbsolute(p) === true`, which structurally
  requires `p.length >= 2`, so `p[0]` can never actually be `undefined` for
  any caller respecting the contract — the `?? ""` only satisfies
  `tsc --noEmit`'s strict indexed-access rule and is unreachable dead code
  for any in-contract caller. Confirmed no caller in the diff violates the
  precondition.
- Confirmed `BootChoice` type still includes `"terminal"` as an unreachable
  union member (`apps/daemon/src/boot/menu.ts:3`); confirmed no code path in
  `ask()` or `index.ts`'s choice-handling chain can ever produce or consume
  `"terminal"` at runtime; confirmed the digit remap is exactly 1→web,
  2→tray, 3→exit, with `"4"` now falling into the invalid-input branch.
- Confirmed invalid-input retry reprints only `MENU_LINE` via the recursive
  `ask()` call, not the deleted banner — traced the control flow directly in
  `menu.ts` rather than trusting the test's assertion alone.
- Confirmed `console.log(\`Symbion daemon đang chạy: ${url}\`)` in
  `apps/daemon/src/index.ts:42` was not duplicated or moved — single call
  site, positioned before the `while (running)` loop exactly as before.
- Confirmed the UNC-rejection path: `validatePath` checks `isUncPath(path)`
  **before** any `existsSync`/`statSync` call (`apps/daemon/src/rpc/handlers.ts:165-176`),
  short-circuiting with `reason: "unc-unsupported"`; confirmed
  `CreateProjectDialog.tsx`'s ternary reads `validation.reason === "unc-unsupported"`
  as its first branch with no client-side regex re-implementing UNC/drive
  detection — the web layer purely consumes the server-computed discriminant,
  matching the design intent of "logic lives once, server-side."
- Confirmed `ValidatePathResult.reason?: "unc-unsupported"` is a single
  optional discriminant, not a parallel boolean+string pair, and is additive
  (no existing reader breaks).

**Findings:**

🟢 `apps/daemon/test/rpc.integration.test.ts`'s UNC test (the
`validatePath`/UNC case, ~line 76-87) asserts only the response shape, not
that `existsSync`/`statSync` were never called (testplan TC-VP-3 explicitly
asked for a `vi.spyOn(fs, "existsSync")`-based assertion that no fs syscall
happens for a UNC string). Functionally the short-circuit is provably correct
by reading `handlers.ts` (the `return` statement is structurally before any
fs call), so this is not a hidden bug — just a slightly weaker test than the
testplan specified. Non-blocking; suggest adding the spy assertion in a
follow-up if `validatePath` is ever refactored in a way that could
accidentally reorder the check.

🟢 `apps/web/tsconfig.tsbuildinfo` is a tracked build artifact that changed
incidentally as a side effect of running the web build; pre-existing
repo-hygiene issue (this file probably shouldn't be in git at all), not
introduced or worsened by this feature. No action needed for this loop.

🟢 `writeFiles.ts`'s explicit `rejectTraversalSegments(task.relPath)` call
(line 50) is now redundant with `resolveConfinedPath`'s own internal call —
confirmed harmless (pure, side-effect-free, idempotent predicate; same
exception type either way). Already flagged by the architect in §12.1.5/§12.1.7;
independently re-confirmed here. Cosmetic cleanup opportunity only, not a bug.

🟢 `createProject`'s un-confined direct `existsSync`/`statSync` call on a
user-supplied project-root path (`handlers.ts`, `createProject` handler) has
no Windows/UNC awareness, unlike the now-hardened `validatePath`. Already
correctly identified in PLAN §10.3.4 point 4 as pre-existing/out-of-scope (no
parent root exists yet to confine against, so there's no escape surface) and
re-flagged by the architect for `/cso` to confirm-inert. Independently agree
with this reasoning: no path-confinement violation is possible here since
there's no root being confined against; this is a UX-consistency nit (silent
`exists:false` vs. a clear UNC error), not a security gap. Non-blocking.

🟢 No code-level disagreement found with any of the architect's §12.1
findings; all independently re-derived rather than taken on faith — same
conclusions reached on `rejectTraversalSegments` call-site safety, core
purity, the boot-menu isolation, and the `reason` discriminant shape.

No 🔴 or 🟡 findings. No bugs found that block shipping. No spec deviation
found beyond the two already self-disclosed by the Maker (BUILD §11.3 items
6 and 9), both of which are independently confirmed acceptable here.

**Checker verdict: PASS.**

What was verified: full diff read end-to-end against PLAN §10/STATE §2-§4
and the testplan's acceptance criteria; both Vitest suites re-run from
scratch (77 + 229 tests, all green); all 4 package builds re-run from scratch
(typecheck clean); `grep` re-run for stray `20128` literals (none outside
test fixtures); Windows-traversal negative-test parity confirmed by direct
inspection of the test file, not just trusting the test count; the
`rejectTraversalSegments`-unconditional-call fix confirmed by reading
`guard.ts` directly, not inferred from a passing test alone; the
`normalizeWindowsPath` TS-strict deviation confirmed behavior-preserving by
contract analysis; core purity re-confirmed by direct grep.

**Gating note unchanged from §10.7/§12.2**: `/cso` (security-reviewer) review
of `apps/daemon/src/rpc/guard.ts` remains REQUIRED before `/ship`, regardless
of this PASS — neither this Checker pass nor the architect's §12.1-12.2 pass
substitutes for the mandated security-reviewer gate on the path-confinement
guard.

## 13. CSO — Security review (independent security-reviewer pass)

Scope: Issue #3 sub-requirement 3 (Windows-style path support), the
unconditionally-mandated `/cso` gate per §6/§10.7 on any change to
`resolveConfinedPath`/`rejectTraversalSegments`. Reviewed via direct code
reading, `git diff`, the live test suite (229 daemon + 77 core tests, all
green pre-review), and live mutation testing against a temp project root.

### 13.1 Findings

🟢 **Low — `pathStyle.ts` regexes are correctly scoped, no exploitable bypass found.**
`apps/daemon/src/rpc/pathStyle.ts:9` (`WINDOWS_DRIVE_ABSOLUTE_RE = /^[A-Za-z]:[\\/]/`)
and `:12` (`UNC_RE = /^\\\\[^\\/]+[\\/]/`) were probed against: `C:foo` (degenerate
drive-relative, correctly `false`), bare `C:`/`\\`/`\\server` (correctly `false`),
fullwidth colon `Ｃ：\Users\me` (correctly `false` — not detected as Windows-absolute,
which is the *safe* direction since it then falls through to ordinary relative-path
handling, still caught by `rejectTraversalSegments`'s real-backslash/forward-slash
split if it also contains `..`), a NUL byte spliced into the string (Node's own
`fs`/`path` layer throws on embedded NUL before any of this logic matters — not a
distinct attack surface), and lowercase/mixed-separator/UNC-vs-drive mutual
exclusivity (all correct, as documented in PLAN §10.3.2). No case was found where a
string that IS genuinely Windows-absolute slips through as "not Windows-style," nor
where an ordinary relative/Unix path is misclassified as Windows-absolute. Risk is
low specifically *because* `rejectTraversalSegments` (see 13.2) does not depend on
this classification to catch `..` segments — the regexes only gate the
absolute-path-rejection branch, not the traversal-rejection branch.

🟠 **High (mitigated by current code, but a real regression risk) — Existing
negative-test coverage for Windows-style traversal in
`apps/daemon/test/rpc.integration.test.ts:493-509` (T11) gives false confidence:
every test case's relPath string *literally starts with* `..` (`"..\\..\\escape.md"`,
`"..\\..\\windows\\system32"`, `"..\\../escape.md"`). On POSIX-mode Node, backslash is
an ordinary filename character, so `path.relative(root, path.resolve(root, relPath))`
for these specific strings happens to produce a result that *also* starts with the
literal substring `".."` — meaning the **pre-fix** code (the old `rel.startsWith("..")`
check alone, with no `rejectTraversalSegments` call) would have passed every one of
these existing tests by coincidence, not because it actually detected backslash-style
traversal. Verified live: I mutated `resolveConfinedPath` to remove the
`rejectTraversalSegments(relPath)` call (restoring the pre-fix structure: only
`isAbsolute(relPath) || isWindowsStyleAbsolute(relPath)` then `resolve`/`relative`)
and reran the full `apps/daemon` suite — **all 229 tests still passed**, including
every Windows-traversal case in T11. This proves the test suite as currently written
would NOT catch a regression that re-removed the `rejectTraversalSegments` call from
`resolveConfinedPath`, despite AC-3.2's stated goal of traversal-rejection parity. I
then constructed the actual missing case — `resolveConfinedPath(root, "subdir\\..\\..\\windows\\system32")`
(a backslash traversal string NOT prefixed by a leading `..` segment) — and confirmed:
against the **mutated** (regressed) guard, this resolved successfully with **no throw**,
producing a path that stayed lexically under `root` only because POSIX `resolve`
treated the entire backslash string as one opaque child-directory name (the textbook
"looks confined but isn't really blocked for the right reason" failure mode PLAN
§10.3.4 point 3 itself warned about). Against the **actual shipped code** (mutation
reverted), the same input correctly threw `PathConfinementError`, proving the shipped
`rejectTraversalSegments`-moved-to-top fix genuinely closes this gap — the current
code is correct, but the regression would not be caught by CI if it ever happened
again. **Fix recommendation (test-only, not a code fix)**: add a test case to T11 (and
ideally `pathStyle.test.ts`/a dedicated guard unit test) using a relPath whose first
segment is NOT `..` itself, e.g. `"subdir\\..\\..\\escape.md"` or
`"a\\..\\..\\..\\b"`, so the assertion is actually exercising
`rejectTraversalSegments`'s segment-membership check rather than riding on a
string-prefix coincidence in the POSIX `relative()` output.

🟢 **Low — `guard.ts`'s `rejectTraversalSegments` is confirmed called unconditionally
and BEFORE any resolution.** `apps/daemon/src/rpc/guard.ts:27` calls
`rejectTraversalSegments(relPath)` as the very first statement in
`resolveConfinedPath`, strictly before the `isAbsolute`/`isWindowsStyleAbsolute` check
(line 29) and strictly before any `resolve()`/`normalize()` call (lines 33-35). Order
is correct: a regex/segment check on the raw input string, prior to any path-resolution
semantics that could be platform-mode-dependent. This also means every existing and
future caller of `resolveConfinedPath` — including `readTargetFiles.ts`, which (per
PLAN §10.3.4 point 3's own finding) previously called `resolveConfinedPath` WITHOUT
ever calling `rejectTraversalSegments` itself — is now protected uniformly, confirmed
by reading `apps/daemon/src/fs/readTargetFiles.ts` (5 call sites, none call
`rejectTraversalSegments` directly, all now covered transitively).

🟢 **Low — `listDir.ts`'s `makeDir` separator-agnostic check is correct and consistent.**
`apps/daemon/src/fs/listDir.ts:118` now uses `splitAnySeparator` (the same
`/[\\/]+/` split used by `rejectTraversalSegments`) instead of the old `path.split("/")`
forward-slash-only split, closing the backslash-only-traversal gap for this
project-root-anchor call site too. Probed `splitAnySeparator` against mixed-separator
and multi-backslash inputs; segment-membership check (`segments.includes("..")`)
behaves identically in shape to `rejectTraversalSegments`. No bypass found. Note (not a
finding, just confirming PLAN's own framing): `makeDir` has no project-root-relative
confinement to apply (it operates pre-project-creation), so this check is the *only*
defense at that call site — it correctly rejects `..` regardless of separator style,
which is the right defense given there's no `resolveConfinedPath` call available yet.

🟢 **Low — `handlers.ts`'s UNC short-circuit in `validatePath` never reaches disk I/O
on the rejected string.** `apps/daemon/src/rpc/handlers.ts:167-177`: `isUncPath(path)`
is evaluated and returned on FIRST, strictly before the `existsSync(path)` call at
line 179 — confirmed by reading the function body top-to-bottom; there is no code path
where a UNC-classified string reaches `existsSync`/`statSync`/`accessSync`. No
filesystem-info-disclosure risk from this branch (a UNC string never touches any
syscall). This is pure string logic, consistent with PLAN §10.3.3's stated intent.

🟢 **Low — drive-absolute `validatePath` behavior is inert-safe, not a leak.** A
drive-absolute string (`C:\Users\me\repo`) falls through to `existsSync`/`statSync`
unchanged — on this POSIX-mode daemon process that string is just an ordinary
(non-existent, in virtually all real cases) filename, so the response is always
`exists:false`. Confirmed this is the documented, intended scope-(b) behavior (STATE
§10.4), not a bug; no path traversal or info-disclosure risk since the literal string
typed by the (already-authenticated, localhost-only) caller is the only thing ever
probed — no normalization/expansion that could redirect the check to an
attacker-unintended location.

🟢 **Low — localhost RPC hardening unaffected.** Confirmed via `git diff --stat`:
`apps/daemon/src/server.ts` (the file owning `127.0.0.1`-only bind, per-boot
origin-bound session token, and Origin/Host allowlist) is **not present in the diff
at all** — zero incidental changes. Direct read of `server.ts` confirms: bind remains
`server.listen(opts.port, "127.0.0.1", ...)` (line 216), the `x-symbion-token` header
check remains enforced on every non-`ping` method with a 401 on mismatch (lines
178-184), and the Origin/Host allowlist (`127.0.0.1:<port>` / `localhost:<port>`
variants, lines 105-109) remains intact with a 403 on rejection (line 155). This
sub-requirement's changes are fully isolated to path-string parsing/confinement and
did not touch the RPC transport-security layer.

🟢 **Low — `createProject`'s direct `existsSync`/`statSync` on a project-root string
is pre-existing, not a regression.** Confirmed by reading `handlers.ts` around the
`createProject` handler: it has the same "no parent root to confine against" shape as
`validatePath` and `makeDir`, by design (a project root is the confinement *anchor*,
not a path confined *against* an anchor). This is unchanged by this diff and was
already present before this feature — correctly self-flagged by BUILD §11.3 point 2,
confirmed accurate.

### 13.2 Mutation-testing trace (performed live, this session)

1. Captured the as-shipped `apps/daemon/src/rpc/guard.ts` to a scratch backup.
2. Mutated `resolveConfinedPath` to remove the `rejectTraversalSegments(relPath)` call
   (restoring exactly the pre-fix code shape: absolute-check only, no top-of-function
   segment check).
3. Ran `npx vitest run --root apps/daemon` — **all 229 tests still passed**, including
   every existing Windows-traversal negative test in T11 — confirming finding 🟠 above
   (existing tests pass-by-coincidence, not by exercising the real fix).
4. Wrote an additional probe test exercising
   `resolveConfinedPath(root, "subdir\\..\\..\\windows\\system32")` against the
   *mutated* guard — confirmed it does **NOT** throw (the actual bypass: a real
   filesystem path lexically nested as `root/subdir\..\..\windows\system32` would be
   returned as "confined" when it is not, strictly speaking, real traversal-intent
   content blocked).
5. Restored the as-shipped `guard.ts` from the scratch backup (mutation reverted) and
   reran the same probe test — confirmed it now correctly throws `PathConfinementError`,
   and reran the full suite (`apps/daemon` 229/229, `packages/core` 77/77) — all green,
   confirming the working tree is back to exactly the Maker's original diff with no
   residual changes.
6. Removed all temporary probe test files created during this session
   (`apps/daemon/test/probe.test.ts`, `apps/daemon/test/probe2.test.ts`) — none remain
   in the working tree; `git status` confirms only the legitimate pre-existing diff.

### 13.3 STRIDE / OWASP mapping

- **Tampering (write outside project root)**: the one real gap found (🟠) is a
  *test-coverage* gap, not a *code* gap — the shipped code correctly blocks the
  bypass; the test suite just doesn't prove it for the specific non-`..`-prefixed
  case. No live Tampering vulnerability in the current diff.
- **Spoofing (forged RPC origin/token)**: not affected by this diff (§13.1 RPC-bind
  finding) — confirmed untouched.
- **Information disclosure**: UNC short-circuit confirmed to never touch disk for a
  classified-UNC string; no leak.
- **Elevation of privilege**: no new RPC method, no change to auth middleware; the
  web UI's reach into the daemon is unchanged by this diff.
- **OWASP A01 (Broken Access Control / path confinement)**: core guard logic verified
  correct under live mutation testing; the one actionable item is strengthening
  negative-test rigor, not the production logic itself.
- **OWASP A03 (Injection)**: not implicated — this diff is pure string-shape detection
  and `node:path` resolution, no template/YAML/shell evaluation involved.

### 13.4 Verdict

**PASS**, with one required follow-up (non-blocking for this gate, since the
production code is verified correct by live mutation testing, but should be tracked):

- Add a negative test case to `apps/daemon/test/rpc.integration.test.ts`'s T11 block
  (and/or a dedicated `guard.test.ts`) using a Windows-style traversal string whose
  first segment is not literally `..` (e.g. `"subdir\\..\\..\\escape.md"`), so the
  test suite actually exercises `rejectTraversalSegments`'s real defense rather than
  coincidentally passing via a POSIX `path.relative()` string-prefix artifact. This is
  a test-quality finding, not a shipped-code vulnerability — `/ship` is not blocked on
  it, but it should be filed as a fast-follow (e.g. `docs/learnings.md` or a follow-up
  task) so a future regression in `resolveConfinedPath`'s call order would actually be
  caught by CI.

No critical or unmitigated high-severity findings against the shipped diff. The
`rejectTraversalSegments`-moved-to-top fix, the `pathStyle.ts` regexes, the
`makeDir` separator-agnostic fix, and the `validatePath` UNC short-circuit are all
confirmed correct by direct reading and live testing (including adversarial mutation

### 13.5 Follow-up resolved (same session)

The required test-quality follow-up from §13.4 was implemented before `/ship`:
added `"rejects Windows-style traversal that does not start with .. (subdir\..\..\escape.md)"`
to `apps/daemon/test/rpc.integration.test.ts`'s T11 block. Verified via a second
independent mutation pass: with `rejectTraversalSegments(relPath)` commented out
in `guard.ts`, the new test failed as expected; restored, it passes. Full suite
re-run: 230/230 daemon tests green (up from 229), 77/77 core tests green. The
🟠 finding in §13.1 is now fully closed — both the production code and the test
suite correctly enforce and prove the fix.
testing). Localhost RPC hardening (127.0.0.1 bind, origin-bound token, Origin/Host
allowlist) is confirmed untouched by this diff.

## 14. QA — Live verification (this session)

**Verdict: PASS.**

Scope: independent live re-verification of the full feature (Issue #3 — port
default, terminal menu simplification, Windows-style path support) against
`enhance-experience-testplan.md`'s acceptance standard, run fresh in this
session rather than trusting BUILD/REVIEW/CSO's self-reported numbers alone.

### 14.1 Build

`npm run build` from repo root — all 4 workspaces (`@symbion/rpc-types`,
`@symbion/core`, `@symbion/daemon`, `@symbion/web`) typecheck/build cleanly,
including `next build`'s own type-check pass and static page generation
(5/5 pages). No errors, no warnings beyond the expected `npm warn -ws...`
CLI-flag deprecation notice (pre-existing, unrelated to this feature).

### 14.2 Test suites (fresh re-run)

- `npx vitest run --root apps/daemon` → **18 files, 230 tests, all passing**
  (matches the count STATE §13.5 reported after the CSO follow-up test was
  added — confirms no drift since CSO's pass).
- `npx vitest run --root packages/core` → **13 files, 77 tests, all passing.**

Both numbers match this STATE document's own claims exactly. Zero
regressions, zero flaky/skipped tests in a full run.

### 14.3 Live daemon boot — fresh config dir

Built `apps/daemon/dist` fresh, ran `node apps/daemon/dist/index.js` with
`SYMBION_CONFIG_DIR` pointed at a brand-new empty temp directory:

```
Symbion daemon đang chạy: http://127.0.0.1:12802/?t=<token>
  1) Web UI   2) Hide to Tray   3) Exit
  Chọn (1-3):
```

- **Port**: daemon attempted `12802` first — confirmed both from the printed
  URL and from the persisted `config.json` in the temp config dir
  (`"port": 12802`). AC-1.3 **PASS**.
- **Menu**: exactly 3 lines printed before any keypress (URL line + menu
  line + prompt) — no 9-line ASCII banner, no version string, no
  "Terminal UI (coming soon)" option anywhere in the output. AC-2.1/AC-2.2
  **PASS**.
- **Exit via stdin**: fed `"3\n"` (per the `connect-providers-STATE.md §12.2`
  stdin-pipe pattern, adjusted for the new digit mapping where `3` = Exit,
  not the old `4`) — daemon printed `Đang tắt daemon...` and the process
  exited cleanly with exit code `0`. No hang, no stack trace. AC-2.3 **PASS**.
- **Regression — existing config dir not migrated**: re-ran against a config
  dir pre-seeded with `{"port": 9999, ...}` — daemon booted on `9999`
  unchanged, did not force-migrate to `12802`. AC-1.4/FR-1.3 **PASS**.

### 14.4 RPC `validatePath` — direct exercise against the live daemon

Started the daemon in the background (`echo "2" | ... node
apps/daemon/dist/index.js`, i.e. "Hide to Tray" so the HTTP server stays up
after the menu loop detaches), extracted the per-boot session token from the
printed URL, and issued `curl` requests with the same headers the web client
uses (`x-symbion-token`, matching `Origin`):

| Input | Result | Verdict |
|---|---|---|
| `C:\Users\test\repo` (Windows drive-absolute) | `{"exists":false,"isDir":false,"isGitRepo":false,"hasClaudeDir":false,"hasAgentsMd":false,"writable":false}` — **no `reason` field present** | **PASS** (TC-VP-2 shape, drive-absolute correctly distinguished from UNC) |
| `\\server\share\project` (UNC) | `{"exists":false,...,"reason":"unc-unsupported"}` — discriminant fires | **PASS** (TC-VP-3) |
| `/tmp` (normal existing Unix path) | `{"exists":true,"isDir":true,"isGitRepo":false,"hasClaudeDir":false,"hasAgentsMd":false,"writable":true}` | **PASS** — regression check, Unix-style validation unaffected |

Also sanity-checked the auth contract while the daemon was live (not part of
this feature's scope, but cheap to confirm nothing regressed): a request
with no `x-symbion-token` header → `401`; a request with a mismatched
`Origin` header → `403`. Both match `server.ts`'s documented contract.
Daemon background process was killed cleanly after verification (confirmed
via `ps -p <pid>` returning no process).

### 14.5 Testplan checklist — systematic disposition

Going through `enhance-experience-testplan.md` section by section:

- **§1 Port (TC-PORT-1 through 5)**: TC-PORT-1 (core unit test) and TC-PORT-2
  (`grep` zero-match check) both independently re-verified — `grep -rn
  "20128" apps/ packages/ README.md` (excluding `dist/`/`out/`/`.next/`/
  `coverage/`) returns only the 3 pre-existing test-fixture lines
  (`findOpenPort.test.ts`, `listDir.test.ts:271`, `rpc.integration.test.ts:26`),
  exactly as STATE documents. TC-PORT-3/4 (fresh-config-dir vs.
  existing-config-dir boot behavior) — these were flagged in BUILD §11.3
  item 6 as deferred to QA-phase manual verification rather than automated
  tests; **both verified live in §14.3 above** (12802 on fresh dir, 9999
  preserved on existing dir). TC-PORT-5 (retry-forward regression) — covered
  by the existing `findOpenPort.test.ts` suite, included in the 230-test run.
  **All PASS.**
- **§2 Terminal menu (TC-MENU-1 through 7, automated)**: covered by
  `apps/daemon/test/menu.test.ts`'s 7 passing tests, included in the fresh
  230-test run. **PASS.** Manual/QA-phase items (TC-MENU-QA-1 through 4):
  QA-1 (fewer than 10 lines before keypress) and QA-2 (stdin-pipe pattern
  still works) directly verified live in §14.3 (3 lines, clean stdin-feed
  exit). QA-4 (Hide to Tray copy unchanged) also directly observed live in
  §14.3/§14.4 (`"Đã chuyển sang chạy nền (Hide to Tray). Server vẫn đang
  chạy."` printed verbatim). QA-3 (port-exhaustion error path still visible)
  was **not re-triggered live this session** — re-verified by code reading
  only: `apps/daemon/src/index.ts`'s `catch` block around `findOpenPort`
  (lines unchanged per REVIEW §12.1.1) still prints `"Không tìm được cổng
  trống cho daemon."` and calls `process.exit(1)` before any menu would ever
  show; this logic was not touched by this feature's diff. Flagging as
  **PASS by code-reading**, not by live trigger (artificially exhausting 20
  ports was judged unnecessary given the code path is untouched and was
  already covered by REVIEW's diff read).
- **§3 Windows path support (TC-PS-1 through 12, TC-VP-1 through 5,
  TC-T11-4 through 10, TC-MD-NEW-1, all automated)**: all covered by the
  fresh 230-test run (`pathStyle.test.ts` 15 tests, extended
  `rpc.integration.test.ts` T2/T11 blocks, extended `listDir.test.ts`).
  TC-VP-2/3/5 additionally **independently re-verified live via direct RPC
  calls in §14.4** against the real running daemon, not just the test
  harness — same shapes confirmed. **All PASS.**
  - §3.5 web-layer manual checks (TC-WEB-QA-1 through 4): **could not be
    live-click-tested this session** — `chrome-devtools` MCP tooling failed
    to connect to a Chrome instance in this environment ("Could not connect
    to Chrome... fetch failed"), and the testplan itself documents that no
    Playwright/component-test harness exists for `CreateProjectDialog.tsx`.
    Fell back to direct code reading of
    `apps/web/src/components/CreateProjectDialog.tsx` (lines 93-126):
    confirmed the ternary checks `validation.reason === "unc-unsupported"`
    **first** (renders the ⚠ UNC copy, no "Tạo thư mục này" button),
    `validation.exists` second (✓ "Thư mục tồn tại" branch), and the
    not-exists branch last (✗ + create-button), and confirmed the
    placeholder text reads the platform-neutral `"…/code/my-service"`, not
    the old Unix-flavored string. This matches REVIEW §12.3's own
    independent line-by-line confirmation of the same file. **Disposition:
    PASS by code-reading, not by live browser interaction** — flagged
    honestly per this QA pass's instruction not to paper over gaps. This is
    consistent with the testplan's own up-front framing (§ heading: "Web-layer
    test (manual QA — no existing Playwright/component-test harness found for
    this dialog)") — it was always going to require either a human or a
    working browser-automation tool to fully close, and neither was available
    in this run.
- **§4 Cross-cutting regression (TC-REG-1/2/3)**: TC-REG-1/2 directly
  re-confirmed via the fresh 230/77 test runs in §14.2. TC-REG-3 (`tsc
  --noEmit` / strict typecheck across all 3 packages) confirmed via §14.1's
  full `npm run build`, which runs each package's own `tsc -p tsconfig.json`
  (core, rpc-types, daemon) plus `next build`'s type-check pass (web) — all
  4 clean. **All PASS.**
- **§5 Gating note**: `/cso` review of `apps/daemon/src/rpc/guard.ts` is
  recorded as PASS in STATE §13.4/§13.5 (with the one required follow-up
  test already implemented and verified in §13.5). Confirmed present and
  resolved before this QA pass began — gate satisfied.

### 14.6 Summary

| Area | Verdict |
|---|---|
| Build (all 4 workspaces) | **PASS** |
| Test suites (230 daemon + 77 core, fresh re-run) | **PASS** |
| Live daemon boot — port 12802 default | **PASS** |
| Live daemon boot — simplified 3-item menu | **PASS** |
| Live daemon boot — clean stdin-fed exit | **PASS** |
| Live RPC `validatePath` — Windows drive-absolute | **PASS** |
| Live RPC `validatePath` — UNC discriminant | **PASS** |
| Live RPC `validatePath` — Unix regression | **PASS** |
| Testplan §1-§4 checklist | **PASS** (one item, TC-MENU-QA-3, verified by code-reading not live trigger; one item, TC-WEB-QA-1-4, verified by code-reading not live browser due to no Chrome instance available in this environment) |
| `/cso` gate (§5) | **PASS, already satisfied (§13.4-13.5)** |

**No FAIL findings.** Two items (port-exhaustion error path live-trigger,
and the web-dialog manual click-through) were verified by code reading
rather than live execution, for the reasons stated above (untouched code
path / no Chrome instance reachable in this environment) — both are
explicitly flagged rather than silently marked PASS-by-assumption, consistent
with this QA pass's instruction to describe exactly what could and could not
be verified. Nothing found in this session contradicts any prior
PLAN/BUILD/REVIEW/CSO finding. **Feature is QA-PASS and ready for `/ship`.**
