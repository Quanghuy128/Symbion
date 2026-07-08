# boot-terminal-ux — Test Plan

Companion to `docs/loops/boot-terminal-ux-STATE.md` (PLAN section). Written
for `dev`/`feature-builder` to implement against and `/qa` to execute
step-by-step. Gate: `code-reviewer` + `architect` (`/review`) and
`security-reviewer` (`/cso`, **mandatory** — this feature touches the
session/token messaging path) must both pass before `/ship`.

## 1. Unit tests — Vitest, `apps/daemon`

### 1.1 `apps/daemon/test/banner.test.ts` (new)

- **TC-BAN-1**: `buildBootBanner({ version: "0.1.0", url: "http://127.0.0.1:20132/?t=abc", useEmoji: false, isTty: false })`
  returns exactly `["Symbion v0.1.0", "Symbion daemon đang chạy: http://127.0.0.1:20132/?t=abc"]`
  — byte-identical to today's two plain lines (regression guard for
  non-TTY/off case and for `e2e/daemon-fixture.ts`'s regex dependency).
- **TC-BAN-2**: same input with `isTty: true`, no `terminalColumns` (undefined)
  → returns 4 lines: `=`-only border, version line, server line, `=`-only
  border of equal length; border length equals the longer of the two content
  lines.
- **TC-BAN-3**: `useEmoji: true` → version line starts with the emoji prefix;
  server line is unaffected (still byte-identical `Symbion daemon đang chạy: ...`).
- **TC-BAN-4**: the returned server line, in every branch (TTY or not, emoji
  or not), always exactly matches
  `/^Symbion daemon đang chạy: http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+$/`
  for a representative URL — regression guard for the `e2e/daemon-fixture.ts`
  `URL_RE` dependency found in PLAN §P0.2. This is the single highest-value
  test in this file; do not remove it even if refactoring `banner.ts`.
- **TC-BAN-5 (EC-B.1, narrow terminal)**: `isTty: true`, `terminalColumns: 10`
  (narrower than the URL line) → falls back to the plain 2-line form, no
  border, no wrapped/staircase output.
- **TC-BAN-6**: `terminalColumns: 0` or negative is treated as "unknown,"
  falling back to the 100-column cap, not to the narrow-terminal branch.
- **TC-BAN-7 (`supportsEmoji`)**: `platform: "win32"`, `env: {}` (no
  `WT_SESSION`/`TERM_PROGRAM`) → `false`. `platform: "win32"`, `env: {
  WT_SESSION: "1" }` → `true`. `platform: "darwin"`, `env: {}` → `true`.
  `env: { SYMBION_FORCE_ASCII: "1" }` → `false` regardless of platform.
  `env: { SYMBION_FORCE_EMOJI: "1" }` → `true` regardless of platform.
- **TC-BAN-8**: No line returned by `buildBootBanner` under any input
  combination contains a raw ANSI escape sequence (`\x1b[`) — this module
  never emits color codes (PLAN §P1).

### 1.2 `apps/daemon/test/openBrowser.test.ts` (new)

Mock `node:child_process`'s `exec` via `vi.mock`.

- **TC-OPEN-1**: on `win32`, `openInBrowser` invokes `exec` with a command
  string containing `start "" "<url>"` (empty title before the URL) — not
  the old bare `start "<url>"`.
- **TC-OPEN-2**: on `darwin`/other non-win32, command uses `open`/`xdg-open`
  respectively, unchanged from today's mapping.
- **TC-OPEN-3**: when the mocked `exec` callback is invoked with a non-null
  error, `onFailure` is called exactly once with a message that mentions the
  URL should be opened manually. When invoked with `null` (success), `onFailure`
  is never called.
- **TC-OPEN-4**: `openInBrowser` never throws synchronously even if `exec`'s
  mock immediately calls back with an error (no unhandled rejection/exception
  escapes the function).

### 1.3 `apps/daemon/test/menu.test.ts` (existing — verify UNCHANGED)

- **TC-MENU-VERIFY**: run the existing suite unmodified after the full diff
  lands. TC-MENU-5 and TC-MENU-6 must still pass with **zero edits to the
  test file** (PLAN §P0.1) — if a dev PR modifies this file, that is a
  reviewable red flag, not an expected part of this feature, and
  `code-reviewer`/`architect` should ask "why" before approving.

### 1.4 `apps/daemon/test/server.integration.test.ts` (existing — verify UNCHANGED)

- **TC-SEC-VERIFY**: the full T15 security suite (tokenless-ping-succeeds,
  missing/wrong-token-401, correct-token-200, foreign-Origin-403) passes
  unmodified — confirms `server.ts` truly received zero changes.

## 2. Unit tests — Vitest, `apps/web`

### 2.1 `apps/web/src/lib/store/useArtifactStore.heartbeat.test.ts` (new)

Mock `../rpc/client`'s `callRpc` and `hasSession`.

- **TC-HB-1 (daemon down)**: `callRpc("ping", ...)` mock rejects (simulates
  `fetch` throwing/connection refused) → after `tick()`, store state is
  `{ daemonReachable: false, sessionValid: false, daemonConnected: false }`.
- **TC-HB-2 (no session, daemon up)**: `ping` resolves, `hasSession()` mocked
  to return `false` → `{ daemonReachable: true, sessionValid: false,
  daemonConnected: false }`, and `callRpc("listProjects", ...)` is **not**
  called (client-side short-circuit, no wasted network call — PLAN §P2 step 2).
- **TC-HB-3 (stale/foreign token)**: `ping` resolves, `hasSession()` returns
  `true`, `listProjects` mock rejects with `new DaemonRpcError({ code:
  "unauthorized", message: "..." })` → `{ daemonReachable: true, sessionValid:
  false, daemonConnected: false }`.
- **TC-HB-4 (fully connected)**: `ping` resolves, `hasSession()` returns
  `true`, `listProjects` resolves → `{ daemonReachable: true, sessionValid:
  true, daemonConnected: true }`.
- **TC-HB-5 (unexpected non-401 error fails closed)**: `listProjects` rejects
  with a generic `Error` (not `DaemonRpcError`/not `unauthorized`) →
  `daemonConnected` must be `false` (fail-closed default, PLAN §P1) — must
  NOT be left in whatever state it was in before the tick.
- **TC-HB-6 (idempotent start/stop)**: calling `startHeartbeat()` twice does
  not create two intervals (existing behavior, must not regress); the
  returned stop function clears the timer.
- **TC-HB-7 (immediate first tick)**: `startHeartbeat()` triggers a tick
  synchronously/on next microtask without waiting the full interval
  (existing behavior, must not regress).

### 2.2 `apps/web/src/components/DaemonStatusBadge.test.tsx` (new)

Render with a mocked/seeded store state (via a lightweight state override or
by wrapping `useArtifactStore.setState` in the test, matching existing
web-test conventions in this repo).

- **TC-BADGE-1**: `{ daemonReachable: true, sessionValid: true }` → renders
  the green "connected" text; no destructive/red styling classes present.
- **TC-BADGE-2**: `{ daemonReachable: false, sessionValid: false }` → renders
  the existing red "daemon mất kết nối" text (unchanged wording — regression
  check against today's behavior for genuine daemon-down).
- **TC-BADGE-3 (the new state)**: `{ daemonReachable: true, sessionValid:
  false }` → renders text distinct from both TC-BADGE-1 and TC-BADGE-2 (e.g.
  asserts it does NOT contain "mất kết nối" and DOES contain wording steering
  the user back to the terminal, e.g. "quay lại terminal" / "phiên" /
  "token"). This is the direct, testable assertion for FR-A.2/AC-A.2/AC-A.3.

### 2.3 `apps/web/src/components/AppShell.tsx` — behavior covered indirectly

No new dedicated unit test file required if none exists today for AppShell;
cover the classification call site via TC-HB-3/TC-HB-5's `reportConnectionError`
unit coverage (same function, single call site) rather than duplicating an
AppShell-level test, unless the existing test conventions in this repo already
have an `AppShell.test.tsx` — if so, add one assertion there that a 401 from
`loadProjects` on mount results in `sessionValid: false` rather than the old
generic `daemonConnected: false`.

## 3. Integration/e2e tests — Playwright, real daemon (`e2e/`)

Reuses `e2e/daemon-fixture.ts`'s `bootDaemon()` unmodified per PLAN §P0.2's
finding — if this fixture needs any edit at all to keep working, that itself
is a signal the banner's server-line text was changed and must be reverted to
match PLAN §P1's byte-identical requirement.

- **TC-E2E-1 (AC-A.1 baseline, regression)**: `bootDaemon()` → navigate to
  `url` in a fresh Playwright browser context → app loads, `listProjects`
  succeeds, no error banner shown. (Same as any existing happy-path spec;
  confirms zero regression from this feature.)
- **TC-E2E-2 (AC-A.3 — refresh after token strip)**: navigate to `url` →
  wait for the app to strip `?t=` from the address bar (assert via
  `page.url()` no longer contains `t=`) → `page.reload()` → assert the
  `DaemonStatusBadge` shows the new distinct "session expired/stale"
  messaging (TC-BADGE-3's exact copy), not the generic disconnected banner,
  within one heartbeat interval (poll up to ~5s).
- **TC-E2E-3 (AC-A.2 — stale URL from a prior boot)**: `bootDaemon()` twice
  in the same test (`daemonA`, `daemonB`, different ports/tokens) → open
  `daemonA.url` in a browser tab → stop `daemonA`'s handle → assert the tab's
  next RPC-triggering action (or the next heartbeat tick) shows daemon-down
  messaging (since the process is actually gone, not just token-invalid —
  confirms the daemonReachable=false branch, distinguishing this from
  TC-E2E-2's daemonReachable=true/sessionValid=false branch). *(Skip/park
  this case if two-daemon orchestration in one Playwright test proves flaky
  in practice — multi-instance support itself is explicitly out of scope per
  decision #5; this test only needs a second daemon transiently to produce a
  "stale token against a live-but-different daemon" condition. An acceptable
  simpler substitute: reuse `daemonA`'s browser tab against `daemonA` itself
  after calling `daemonA.stop()`, which produces true daemon-down without
  needing two daemons at once.)*
- **TC-E2E-4 (AC-B.2 — URL copy-paste integrity)**: with the app running,
  read the daemon's raw stdout capture from `bootDaemon()` (already captured
  by the fixture to parse `url`) and assert the exact server line contains
  no leading/trailing box-drawing characters or ANSI codes around the URL
  substring — since this is a stdout-string assertion, not a real terminal
  selection, it's a proxy for AC-B.2's real-terminal claim; note in the PR
  that true clipboard/selection behavior needs one manual check per §4 below.
- **TC-E2E-5 (AC-A.5 headless stdin pattern still works)**: reuse the
  `connect-providers-STATE.md §12.2` pattern — pipe a single digit to the
  daemon's stdin (`bootDaemon` already leaves stdin open per its own doc
  comment) and confirm the process responds to `"3"` (exit) or `"2"` (tray)
  as expected, unaffected by the banner change.

## 4. Manual / exploratory checks (cannot be fully automated)

- **MAN-1 (AC-B.1, visual match)**: run `npm run start` in Windows Terminal
  (modern, ANSI+emoji capable) and eyeball the banner against the reference
  image's structure (border/version/URL grouped, one-time print, no redraw
  on invalid menu input).
- **MAN-2 (decision #4's concrete target)**: run `npm run start` in legacy
  `cmd.exe` (not Windows Terminal — actually launch `cmd.exe` directly, not
  a Windows Terminal tab hosting cmd) and confirm: no mojibake, no emoji
  replaced by a box/question-mark glyph, ASCII border renders correctly
  (this validates `supportsEmoji()`'s `WT_SESSION` heuristic actually
  resolves to `false` in this real environment, not just in unit-mocked env
  vars).
- **MAN-3 (AC-B.2, real terminal selection)**: in a real terminal, double-
  click and triple-click the printed server line and confirm the full URL
  (including `?t=<token>`) pastes intact with no extra characters.
- **MAN-4 (AC-A.4, auto-open failure visible)**: temporarily rename/break the
  OS's default browser association (or run in an environment with no GUI
  browser, e.g. WSL without a browser configured) → choose `"1"` → confirm a
  visible terminal message appears (not silence) instructing manual open.
- **MAN-5 (`npm run start > out.txt`, AC-B.3)**: pipe stdout to a file,
  inspect with a plain-text viewer — confirm the two-line plain form (no
  border, no emoji) appears exactly as before this feature, and no raw
  escape sequences are present.
- **MAN-6 (EC-NEW.2, Hide to Tray + reuse terminal)**: boot, choose `"2"`
  (Hide to Tray), confirm the terminal does NOT return a shell prompt (the
  process is still alive); Ctrl+C, then `npm run start` again in the same
  window — confirm the new box prints below the old scrollback without
  corrupting/overwriting it.

## 5. Gate checklist before `/ship`

- [ ] All unit tests in §1–2 pass (`npm run test` in `apps/daemon` + `apps/web`).
- [ ] `e2e/` suite passes, including the existing `happy-path.spec.ts` and
      `auto-generate-body.spec.ts` (regression check on the fixture
      dependency from PLAN §P0.2) plus the new TC-E2E-* cases in §3.
- [ ] `apps/daemon/test/menu.test.ts` diff is empty (PLAN §P0.1 / TC-MENU-VERIFY).
- [ ] `apps/daemon/test/server.integration.test.ts` diff is empty (TC-SEC-VERIFY).
- [ ] `code-reviewer` + `architect` pass via `/review` (checks implementation
      matches this PLAN, including the P0 flaw resolutions).
- [ ] `security-reviewer` passes via `/cso` (**mandatory** — session/token
      messaging path; see PLAN §P5 for the exact three things `/cso` should verify).
- [ ] At least MAN-2 (legacy `cmd.exe`) from §4 has been manually verified on
      a Windows machine, per decision #4's concrete named target.
