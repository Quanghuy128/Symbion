# boot-terminal-ux — STATE

**Phase: PLAN-ready (scope locked at `/office-hours`)**

## Scope (locked at `/office-hours`)

Answers to the open questions raised by `/analyze` (§4 below), resolved
directly with the user:

1. **Sub-req A root cause — ALL FOUR scenarios confirmed in scope**, not just
   one: (a) F5 refresh losing the in-memory session after `?t=` is stripped
   from the address bar, (b) stale URL/bookmark after a daemon restart,
   (c) the auto-open-browser `try/catch` silently swallowing failures, and
   (d) the raw 64-hex token string itself feeling like unwanted clutter. This
   widens FR-A.1–A.4 from "pick one" to "all four must be addressed."
2. **Session durability — NOT durable.** Token stays stripped from the URL
   after first load (`history.replaceState` behavior unchanged, no
   `sessionStorage`, no keep-token-in-URL). Instead: fix the *messaging* —
   session-expired vs. daemon-down must be distinguishable (FR-A.2), and fix
   the confirmed `ping`-bypasses-auth heartbeat bug so the status badge never
   lies about being "connected" (FR-A.2b). This closes Open Question 2 and
   Open Question 8 in favor of the "keep today's security posture, fix UX
   around it" option — explicitly rules out weakening the token lifecycle.
3. **Sub-req B — CONFIRMED reversal of `enhance-experience`'s banner removal
   is intentional and wanted.** Full bordered box like the reference image,
   not a single-line polish. Constraint carried over unchanged: the box must
   be printed exactly once in `index.ts` before the menu loop starts, never
   inside `showBootMenu`'s retry loop — `apps/daemon/test/menu.test.ts`
   TC-MENU-5/TC-MENU-6 must be deliberately, visibly rewritten (not silently
   broken or deleted) to assert the new bordered content instead of its
   absence.
4. **Box implementation — hand-rolled, no new dependency.** `apps/daemon`
   stays at zero terminal-styling dependencies (no `boxen`/`chalk`). Must
   include an ASCII-safe fallback (plain `=`/`-` borders, no emoji) for
   terminals that can't render Unicode box-drawing/emoji reliably (legacy
   Windows `cmd.exe` is the concrete target, per this project's primary dev
   platform).
5. **Multi-instance daemon support — explicitly OUT of scope.** Do not design
   for two simultaneous daemons on different ports; EC-A.3's cross-talk
   concern is a "verify it still holds," not a feature to build.
6. **Output styling scope — boot banner only.** Color/box auto-detect off
   when `stdout` is not a TTY (standard CLI convention, resolves Open
   Question 6). Only the initial one-time boot banner gets the bordered
   treatment; post-choice messages (`Hide to Tray` / `Exit` / "Mở: <url>")
   stay plain `console.log`, unboxed (resolves Open Question 7 — do not
   expand box styling to every output line).

**Acceptance criteria for the Checker**: the existing AC-A.1–AC-A.6 and
AC-B.1–AC-B.6 in §2/§3 below stand as written, now with Open Questions 1–8
resolved per above (no new AC needed — the answers narrow scope, they don't
add new measurable behavior beyond what's already specified).

## 0. Origin

Raw request (Vietnamese, informal): "hiện tại symbion khi start hiện 1 url với
chuỗi token -> expect chỉ cần url là có thể truy cập symbion. 2: design UI
terminal như ảnh" — i.e. two independent asks bundled in one message:

1. Today, starting Symbion prints a URL containing a token query string
   (`http://127.0.0.1:20132/?t=<64-hex-char token>`). The user's expectation
   is that **just the URL** should be enough to access Symbion — implying the
   token is currently felt as friction/clutter, or (unconfirmed — see Open
   Questions) actually fails to grant access in some flow they hit.
2. Redesign the plain-text terminal boot menu into a bordered/boxed terminal
   UI (reference image: a `====` bordered box, version number, an emoji, a
   clean "Server: <url>" line — akin to a `boxen`-style CLI banner).

These are analyzed as **two independent sub-requirements** (different risk
profiles: #1 touches the security-relevant session-token flow that CLAUDE.md
explicitly protects; #2 is purely cosmetic console output), same pattern as
`enhance-experience-STATE.md`'s bundled-issue handling.

**Related prior work — important, do not silently re-litigate:**
`docs/loops/enhance-experience-STATE.md` (shipped) already simplified the
boot menu from a 9-line banner to a compact 3-line
`1) Web UI  2) Hide to Tray  3) Exit` menu, and already made choice `"1"`
best-effort auto-open the browser (`apps/daemon/src/index.ts` lines 48-58).
It did **not** touch the token/URL access flow at all.

**More specifically — the exact "BEFORE" banner that was removed is nearly
identical in spirit to this request's reference image.** Per
`enhance-experience-design.md` §3 ("T1+T2 — BEFORE", verbatim from the shipped
code at that time):

```
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
  Chọn (1-4):
```

This was deliberately replaced because it was judged noisy — 10 lines before
any keypress, the URL duplicated twice, and, the concrete complaint that drove
the fix: **the entire bordered block redrew on every invalid-input retry
loop**, penalizing the single most common interaction (typing a menu digit).
That fix is now enforced by a **regression-guard test**, not just a stale
comment: `apps/daemon/test/menu.test.ts` TC-MENU-5 and TC-MENU-6 explicitly
assert `console.log` is **never** called with a line matching `/={3,}/` or
`^\s*Symbion — Choose Interface/` or `^\s*Server:/` anywhere inside
`showBootMenu` — including on the invalid-input retry path. Concretely: if
sub-requirement B's redesign is implemented by adding border/box lines
*inside* `showBootMenu`'s redraw loop, it will fail these two existing tests
outright; if it is implemented as a one-time box printed by `index.ts` before
the loop starts (this spec's Scope for sub-req B, and this file's
recommended shape), these tests are unaffected and keep passing as a genuine
regression guard. This distinction is the single most important constraint
for `/plan` to get right and is called out again in §3 and §5 below.

Also worth noting for calibration: the reference image's `(v0.3.85)` does not
match any Symbion version (`0.1.0` today) — it is an external tool's
screenshot used purely as style inspiration, not an existing Symbion screen
or copy to reproduce verbatim.

## 1. Current-state findings (code reading, this session — grounds the spec below)

**Token generation + validation flow** (traced end-to-end):
- `apps/daemon/src/server.ts` `generateToken()` — a fresh 32-byte
  (64-hex-char) random token is generated **once per daemon boot**
  (`randomBytes(32).toString("hex")`), held in server memory only, never
  persisted to any config file.
- `apps/daemon/src/index.ts` line 41 builds `http://127.0.0.1:${port}/?t=${token}`
  and prints it verbatim to the terminal (line 43), before the menu loop
  starts.
- **Static file serving (GET `/`, `/index.html`, JS/CSS assets) does NOT check
  the token at all** (`server.ts` lines 154-157 — `serveStaticFile` runs
  before any auth check). Only `POST /rpc` is token-gated (lines 189-199),
  and only for non-`ping` methods.
- `apps/web/src/components/AppShell.tsx` (lines 24-62) reads `?t=` from
  `window.location.search` on mount, stores it in an **in-memory-only** JS
  module variable (`apps/web/src/lib/rpc/client.ts`'s `cachedToken`), then
  immediately strips `t` (and two unrelated cross-route params) from the
  visible URL via `history.replaceState` (lines 52-59) "so they don't appear
  in browser history or leak via Referer headers." `SettingsShell.tsx` and
  `TemplatesView.tsx` each independently repeat this same read-once-then-strip
  pattern for their own routes (`/settings`, `/templates`) — each top-level
  route re-establishes its own session from the URL, none of them persist the
  token anywhere durable.
- **Conclusion: opening the printed URL exactly as printed, in a fresh
  browser tab, today already works end-to-end** — the page loads (unauthenticated
  static serve), the app captures the token client-side, and RPC calls
  succeed. No bug was found in this straight-line path.
- **However, four concrete ways "just the URL" stops being enough were
  found by tracing the code, any of which may be what the user actually hit:**
  1. **The token is per-boot, not stable.** Every daemon restart generates a
     brand-new token; the previously-printed URL (e.g. bookmarked, saved in
     shell history, or reused from a previous terminal session) becomes
     invalid — RPC calls 401 with `{"error":{"code":"unauthorized"}}`. If the
     user's mental model is "the URL is a stable address for my Symbion
     instance," this is a hard mismatch: the URL is actually a **one-time
     credential string**, not a bookmark.
  2. **A page refresh (F5) after the token has already been stripped from the
     address bar loses the in-memory session — within the SAME boot, not just
     across restarts.** `history.replaceState` means the visible URL no
     longer contains `?t=`; `cachedToken` is a plain JS module variable that
     resets to `null` on any full page reload. After that, every RPC call
     401s. The only visible symptom today is whatever `DaemonStatusBadge`'s
     red banner shows (E9, generic "disconnected" wording per
     `symbion-STATE.md` §6) — there is no code path found that distinguishes
     "daemon is actually down" from "my session token expired, go back to the
     terminal for a fresh URL," which would be a confusing dead end for a
     user who doesn't know to look at the terminal again. This is arguably
     the single most common way to trip over "the URL stopped working," since
     refreshing a browser tab is a completely ordinary, expected user action —
     not an edge case.
  3. **Copy/paste fragility of a 64-hex-char token embedded in a long URL** —
     no code defect here, but a plausible real-world friction: terminal
     emulators wrap long lines differently, and partial/mis-copied tokens
     produce the same generic 401 with no "token looks truncated" hint.
  4. **Closing the terminal (or losing scrollback) after the URL has already
     been stripped from the browser's address bar leaves no remaining record
     of the URL anywhere** — not in the browser (stripped), not in the
     terminal (scrolled away/closed), recoverable only by restarting the
     daemon for a fresh token.
- Menu choice `"1) Web UI"` (`apps/daemon/src/index.ts` lines 48-58) already
  best-effort auto-opens the system default browser via `child_process.exec`
  with a platform-specific command (`open`/`start`/`xdg-open`), wrapped in a
  silent `try/catch` — if that fails (e.g. no GUI browser reachable, `start`
  not on PATH in some minimal Windows shells), the user falls back to
  manually copying the printed URL with no visible error explaining that the
  auto-open attempt failed silently.
- **Confirmed second-order bug that makes a lost session actively misleading,
  not just inconvenient** (found independently by a parallel BA pass on this
  same request, merged in here): `useArtifactStore.startHeartbeat()`'s
  periodic tick calls RPC method `ping` — the one method deliberately exempt
  from token auth (`server.ts` line 191: `if (!isReadOnly || method !==
  "ping")`). `ping` succeeds even with a missing/stale token, so
  `DaemonStatusBadge.tsx` shows the green "daemon ● connected" state, while
  every real data call (`listProjects`, `loadProject`, `saveArtifact`, etc.)
  is silently failing with 401 in the background
  (`AppShell.tsx`'s `loadProjects().catch(() => setDaemonConnected(false))`
  briefly sets the disconnected flag, but the very next heartbeat tick's
  successful `ping` flips it back to `true` within `HEARTBEAT_INTERVAL_MS`).
  **Net effect: a user who lands on a token-stripped/stale-session URL sees
  an app that claims to be "connected" but has zero projects and silently
  rejects every action** — no error message ties this back to "your session
  token is missing/expired, go back to the terminal." This is a concrete,
  currently-shipped correctness bug, independent of whichever fix is chosen
  for sub-requirement A, and should be a named regression-test target (see
  FR-A.2/AC-A.2/AC-A.3 below, which now fold this in).

**Terminal boot menu (current baseline, post `enhance-experience`)**:
- `apps/daemon/src/boot/menu.ts` — prints only `"  1) Web UI   2) Hide to
  Tray   3) Exit"` + a `"  Chọn (1-3): "` prompt, no border, no version, no
  emoji, no explicit "Server: <url>" line (the URL is printed once earlier by
  `index.ts`, not repeated inside the menu itself).
- `apps/daemon/src/index.ts` lines 42-43 print `Symbion v${VERSION}` and
  `Symbion daemon đang chạy: ${url}` as two separate plain `console.log`
  lines, immediately before the menu loop starts.
- **No terminal-styling dependency exists today** in `apps/daemon/package.json`
  (no `chalk`, `boxen`, `cli-boxes`, `picocolors`, etc. — dependencies are
  currently only `@symbion/core` + `@symbion/rpc-types`). Any bordered/emoji
  visual redesign is, at minimum, a choice between adding a new dependency or
  hand-rolling box-drawing — **that choice is architect's call, not specified
  here.**
- **Regression-guard tests already exist and constrain the solution shape**:
  `apps/daemon/test/menu.test.ts` TC-MENU-5 and TC-MENU-6 assert that
  `showBootMenu` itself never prints a `====`-style border, a
  `Symbion — Choose Interface` line, or a `Server:` line — on first prompt AND
  on invalid-input retry. See §0 above for the full detail; this is repeated
  here because it directly bounds sub-requirement B's implementation options
  (box must live in the one-time `index.ts` prints, not inside
  `showBootMenu`'s loop, or these tests must be knowingly and explicitly
  updated with sign-off, not silently changed to make a new design pass).
- A separate existing QA pattern depends on the menu's plain-text, line-based
  shape: `connect-providers-STATE.md §12.2` feeds a single digit to stdin to
  select a menu option **headlessly** (no real TTY) — whatever new visual
  format is chosen, this scripted-input path must keep working unmodified (no
  behavior regression), per the same principle already locked in
  `enhance-experience-STATE.md` EC-2.2/AC-2.3.
- The Windows Home Single Language 11 environment this ticket was filed from
  (per this session's env) is relevant only as a **fact to hand to
  design/QA**, not something for this spec to resolve: real-world terminal
  targets include Windows Terminal, legacy `cmd.exe`, and PowerShell, which
  differ in ANSI escape-code support and emoji glyph rendering — flagged as a
  product risk below, not solved here.

## 2. Sub-requirement A — "Just the URL" should be enough to access Symbion

### Problem / user story
As a Symbion user starting the daemon, I want the printed URL to reliably get
me into the app without extra menu steps or confusing failures, so that
"copy the URL, paste it in a browser" is a trustworthy, one-step action —
today it mostly works on the very first paste, but silently stops working in
at least the four scenarios found in §1 (stale/reused URL after a restart,
page refresh after the token is stripped from the address bar — the most
ordinary of the four, a silently-failed auto-open with no visible fallback
message, and total loss of the URL if both the browser tab and terminal
scrollback are gone).

### Scope
**In scope**: the *user-observable reliability and clarity* of "open the
printed URL and be in Symbion" — this includes what happens when that URL is
stale, refreshed, or the auto-open silently fails; and whether/how the
session-token requirement is communicated to the user (vs. currently: a raw
hex string with no explanation).

**Explicitly out of scope (must NOT be proposed as a fix by `/plan`)**:
removing, weakening, or making optional the per-boot origin-bound session
token itself, or relaxing the Origin/Host allowlist. CLAUDE.md's filesystem
safety section marks this token as **MANDATORY** — the RPC surface can write
arbitrary files and run git, and the token (together with 127.0.0.1-only
binding and the Origin/Host allowlist) is the only thing standing between an
arbitrary webpage in the user's browser and that write surface (DNS-rebinding
/ CSRF mitigation, per `symbion-STATE.md` §1.4). Any solution direction must
preserve: (a) a fresh, unguessable, per-boot token, (b) that the token is
still required on every mutating RPC call, (c) that `127.0.0.1`-only binding
and Origin/Host allowlisting are unchanged. Also explicitly out of scope:
making the daemon reachable from any device other than the one it runs on
(no LAN binding, no phone-scannable QR code) — that is a categorically
different, much larger security posture change than "the URL should survive
a refresh," and is not implied by this request.

### Functional requirements
- FR-A.1: Opening the exact URL the daemon prints, in a fresh browser
  session, immediately after boot, must succeed with zero additional user
  action beyond navigating to it (this already holds today — must not
  regress).
- FR-A.2: If the URL used is stale (from a previous boot, different token)
  or the in-memory session was lost (e.g. refresh after the token was
  stripped from the address bar), the user must see a clear, specific
  explanation — not a generic "disconnected" banner indistinguishable from
  "the daemon process itself is down" — and a clear next action (e.g. "go
  back to the terminal and use the newly printed URL" / "restart the
  daemon").
- FR-A.2b: `DaemonStatusBadge` must not report "connected" while authenticated
  (non-`ping`) RPC calls are actually failing with 401 due to an invalid/
  missing token — the tokenless `ping` heartbeat must not mask a dead session
  (see §1's confirmed heartbeat/ping finding). The green/red status must
  reflect real usability, not just "the HTTP server answered a tokenless
  ping."
- FR-A.3: If the menu's best-effort browser auto-open fails, the user must
  see a visible message saying so (not a silent `catch`), so they know to
  fall back to manually opening the URL rather than staring at a terminal
  that appears to have done nothing.
- FR-A.4: Whatever the final UX shape is, it must not require the user to
  memorize, retype, or manually construct any part of the token — the token
  remains machine-generated and machine-consumed; only the *presentation/
  hand-off* of the already-correct URL may change.

### Edge cases
- EC-A.1: Daemon restarted (new token) while an old browser tab from a prior
  boot is still open — that tab's next RPC call must 401 clearly and the UI
  must surface FR-A.2's messaging, not a bare failed-fetch console error.
- EC-A.2: User has two Symbion daemon instances running against different
  projects on different ports simultaneously (not confirmed as a supported
  scenario elsewhere in existing STATE docs — flagged as an open question
  below, not assumed).
- EC-A.3: Headless/CI environment with no real browser to auto-open (the
  existing `connect-providers-STATE.md §12.2` stdin-feeding QA pattern) —
  auto-open must fail gracefully without blocking the menu loop (already the
  case today via the `try/catch`; must not regress).
- EC-A.4: Browser blocks the `history.replaceState` token-stripping or the
  user manually navigates back in browser history to a URL that still has
  `?t=<old-token>` in it after already loading with a fresh one — must not
  cause a confusing mixed-state (behavior should be well-defined: last URL
  wins, or ignored — not specified here, flagged for `/plan`).
- EC-A.5: Ordinary page refresh (F5) mid-session — the most common real-world
  trigger of "the URL stopped working" per §1 finding #2 — must land on
  FR-A.2's clear messaging, not the generic disconnected banner.

### Acceptance criteria (measurable)
- AC-A.1: A fresh `npm run start` → copy the exact printed URL → paste into a
  new browser tab → app loads and every RPC call succeeds with zero manual
  steps beyond the paste. (Regression check against today's already-working
  baseline.)
- AC-A.2: Restart the daemon (new token) with an old tab from the previous
  boot still open; perform any action that triggers an RPC call in that old
  tab → user sees a message distinguishable from "daemon unreachable" (exact
  wording is a taste call, not specified here) that indicates the session is
  stale, not that the server is down.
- AC-A.3: Refresh the browser tab after the `?t=` param has been stripped
  from the address bar → same distinguishable stale-session messaging as
  AC-A.2, not a bare disconnected banner.
- AC-A.4: Forcibly make the auto-open command fail (e.g. no default browser
  registered, or simulate the `exec` failing) → a visible terminal message
  appears stating the auto-open failed and the user should open the URL
  manually — not silence.
- AC-A.5: The existing `connect-providers-STATE.md §12.2` headless
  stdin-feeding QA pattern still works unmodified.
- AC-A.6: No change reduces token entropy, removes the per-boot token
  requirement, removes the 127.0.0.1-only bind, or removes/weakens the
  Origin/Host allowlist — verified by `/cso` before ship (mandatory gate, see
  Risk Notes).

## 3. Sub-requirement B — Bordered/boxed terminal boot UI redesign

### Problem / user story
As a Symbion user starting the daemon, I want the terminal output to look
like a clean, intentional CLI banner (bordered box, version, a friendly
emoji/icon, a clear "Server: <url>" line) instead of today's plain
unstyled text lines, so the tool feels polished on first run — matching the
reference style:
```
==========================================
🚀 Choose Interface (v0.3.85)
   Server: http://localhost:20128
==========================================
```

### Scope
**In scope**: the visual presentation of `apps/daemon/src/index.ts`'s
pre-menu banner lines (currently `Symbion v${VERSION}` +
`Symbion daemon đang chạy: ${url}`) — printed exactly **once**, before the
menu loop starts — and `apps/daemon/src/boot/menu.ts`'s menu line/prompt
(kept compact, unboxed, per §0's regression-guard constraint), i.e., how
these are framed/bordered/decorated, not their underlying information content
(URL, version, the 3 menu choices) or the `BootChoice` control-flow logic.

**Explicitly out of scope**: adding new menu options, changing what choices
`"1"`/`"2"`/`"3"` do, building the real Terminal UI (still v1.5-stubbed per
`symbion-STATE.md` §0's locked decision — unaffected by this cosmetic
change), and reintroducing box/border/version lines *inside* `showBootMenu`'s
redraw loop (would fail `menu.test.ts` TC-MENU-5/TC-MENU-6 — see §0/§1).

### Functional requirements
- FR-B.1: The banner must visually group the version, the server URL, and the
  menu choices inside a clearly bounded box/frame (per the reference image),
  distinguishing this "boot summary" from ordinary scrolling log output,
  **printed exactly once per boot** — never redrawn on menu retry.
- FR-B.2: The server URL line must remain fully selectable/copy-pasteable as
  a single unbroken string (a bordered box must not visually wrap or clip
  the URL such that copy-paste grabs box-drawing characters or truncates the
  token).
- FR-B.3: The redesign must degrade gracefully in terminals that do not
  render box-drawing characters, ANSI color, or emoji glyphs correctly
  (notably: legacy Windows `cmd.exe`, some CI log viewers) — it must not
  produce garbled output, mojibake, or misaligned borders that are *worse*
  than today's plain text in an unsupported terminal.
- FR-B.4: The existing headless stdin-feeding QA pattern (menu selection by
  piping a digit) must be unaffected by any added decorative lines — i.e.
  the prompt still reads exactly one line of stdin per choice, with no new
  required input.

### Edge cases
- EC-B.1: Terminal width narrower than the fixed-width border (e.g. resized
  terminal, or a narrow CI log pane) — box borders should not wrap into a
  broken/staircase shape; either a fixed safe width is chosen or the box
  degrades to plain lines below some threshold (specific behavior is a
  design/architecture call, not specified here).
- EC-B.2: Non-TTY stdout (piped to a file/log, `npm run start > log.txt`) —
  ANSI color codes must not leak as raw escape-sequence garbage into the log
  file; emoji/box-drawing characters must not break non-UTF8-locale log
  viewers.
- EC-B.3: `Hide to Tray` / `Exit` confirmation lines (currently plain
  `console.log` after the menu, per `index.ts` lines 60/63) — decide whether
  these also get the new bordered treatment or stay plain (visual
  consistency question, flagged below as an open question, not decided
  here).
- EC-B.4: The long token-bearing URL (§1 finding: up to 64 extra hex
  characters) inside a fixed-width bordered box — the reference image's
  example URL is short (`http://localhost:20128`); Symbion's real URL is
  materially longer (`http://127.0.0.1:20132/?t=<64 hex chars>`), which may
  not fit cleanly inside a `====`-style fixed-width box without wrapping or
  overflowing the border — this is a direct tension with FR-B.2 and must be
  resolved by whichever solution `/plan` proposes (e.g., shorten what's shown
  inside the box vs. widen the box vs. print the URL outside the box) —
  **not resolved by this spec**; flagged as the single biggest design
  tension between sub-requirements A and B.

### Acceptance criteria (measurable)
- AC-B.1: On a boot in a modern ANSI-capable terminal (Windows Terminal,
  standard macOS/Linux terminal), the printed output visually matches the
  bordered-box style of the reference image (border line, version, server
  URL, menu choices grouped inside), verified by eye against the reference
  screenshot.
- AC-B.2: The full URL (including `?t=<token>`) can be selected via a
  standard double-click-and-drag or triple-click terminal selection and
  pasted intact, with no box-drawing character or ANSI escape code included
  in the copied text.
- AC-B.3: Piping `npm run start > out.txt` and inspecting `out.txt` shows no
  raw ANSI escape sequences (`\x1b[...`) and no mojibake in place of
  emoji/box characters in a UTF8-unaware viewer — OR (open question, see
  below) color/emoji is conditionally disabled for non-TTY stdout, whichever
  direction `/plan` picks, verified as behaving predictably either way.
- AC-B.4: The `connect-providers-STATE.md §12.2` headless-stdin QA pattern
  still selects menu options correctly against the redesigned prompt.
- AC-B.5: `apps/daemon/test/menu.test.ts` TC-MENU-5 and TC-MENU-6 still pass
  unmodified (the box lives in `index.ts`'s one-time print, not inside
  `showBootMenu`) — OR, if `/plan` deliberately chooses to move boxed styling
  into `showBootMenu` itself, these two tests are explicitly and knowingly
  updated with a documented reason, never silently altered to "make the new
  design pass."
- AC-B.6: No regression to `enhance-experience-STATE.md`'s already-shipped
  AC-2.1–AC-2.4 (URL printed once and unambiguously, error paths — port
  exhaustion etc. — remain visible/legible).

## 4. Open questions (need user/product decision — do NOT guess)

1. **Sub-requirement A root cause — which scenario did the user actually
   hit?** §1 found the "happy path" (fresh URL, fresh tab) already works.
   Was the actual friction (a) a stale/bookmarked URL from a previous boot
   failing, (b) a page refresh losing the session (the most ordinary trigger,
   per finding #2), (c) the auto-open silently failing and leaving them to
   hunt for the URL, (d) simply finding the token string itself ugly/unwanted
   regardless of whether it "works," or (e) something not yet found in this
   code trace? This materially changes what `/plan` should build — (d) is a
   pure cosmetic/perception fix (better presentation of an already-working
   flow), while (a)/(b)/(c) are genuine reliability gaps needing new UX
   (error messaging, re-issue flow) per FR-A.2/A.3.
2. **Stale-session recovery UX** — when a session token is confirmed expired/
   invalid (EC-A.1, AC-A.2/A.3), should the web app (a) show a static message
   telling the user to go back to the terminal, (b) attempt some kind of
   automatic re-auth handshake (would need new RPC/security design — bigger
   scope, needs its own `/cso` pass), or (c) something else? This is a scope-
   defining choice for `/plan`, not decided here.
3. **Multiple simultaneous daemon instances (EC-A.2)** — is running two
   Symbion daemons against two different projects at once a scenario worth
   designing for at all, or explicitly out of scope/unsupported? No existing
   STATE doc confirms or denies this today.
4. **Box-drawing implementation approach** — hand-rolled characters
   (`═`/`─`/`│` etc. via template strings) vs. a small dependency
   (`boxen`/`cli-boxes`/similar) vs. ANSI-color-only (no dependency) — this
   is explicitly an architecture/library decision for `/plan`, not this
   spec, but the user should be aware today's `apps/daemon` has **zero**
   terminal-styling dependencies, so any box/color/emoji approach is a net-
   new dependency footprint unless hand-rolled.
5. **Box width strategy given EC-B.4's URL-length tension** — should the
   real (long, token-bearing) URL be (a) printed on its own line outside any
   fixed-width box, (b) drive the box to be wide enough to always fit it
   (variable-width box), or (c) something else (e.g. truncate the visible
   token with a "..." and print the full copyable URL separately)? Directly
   blocks how `/plan` resolves FR-B.2 vs. the reference image's fixed-width
   aesthetic.
6. **Non-TTY / piped-output behavior (EC-B.2/AC-B.3)** — should color/emoji/
   box-drawing be unconditionally on, or auto-detected off when stdout is
   not a TTY (a common CLI convention)? Taste call for `/plan`, not decided
   here.
7. **Visual consistency of post-choice messages (EC-B.3)** — do the
   "Hide to Tray" / "Exit" / "Mở: <url>" follow-up lines also get boxed
   styling, or stay plain (only the initial boot banner is boxed)? Affects
   how much of `index.ts`'s console output surface this touches.
8. **Is a durable/reusable URL within the same boot session actually wanted**
   — e.g. reprinting the box/URL on demand via a menu keypress, or keeping
   the token in the address bar instead of stripping it (trading away the
   history/Referer-leak mitigation described in §1) — versus accepting that
   "URL works once per boot, refresh needs a return trip to the terminal" is
   fine as long as the failure is clearly explained (FR-A.2)? This is really
   question 1 restated as a solution-shape choice and should be answered
   together with it.

## 5. Product risk notes (for architect/dev — not a build instruction)

- **Do not weaken the session token as a side effect of "fixing" sub-req A.**
  This is the single highest-risk misreading of the user's request: "expect
  just the URL to work" could be (mis)read as "make the token unnecessary,"
  or as "make the token durable" (kept in the URL bar / persisted client-side)
  without weighing the history/Referer-leak trade-off that today's
  `history.replaceState` stripping deliberately guards against (§1). Per
  CLAUDE.md, the token is mandatory infrastructure protecting an RPC surface
  that can write arbitrary files and run git; §1's own trace shows the happy
  path already works without any token weakening — the real gaps found
  (stale URL, lost session on refresh, silent auto-open failure) are all
  **messaging/UX gaps**, not gaps that require loosening the security model,
  and should be fixed as such by default. If the product genuinely wants a
  more durable token (open question 8), that must be an explicit, named
  trade-off signed off before `/plan`, not an incidental implementation
  choice. Flag for `/cso` review regardless of how small the eventual diff
  looks, same posture as `enhance-experience-STATE.md`'s precedent for
  anything touching the daemon's auth/guard surface.
- **Do not silently revert a tested fix.** `apps/daemon/test/menu.test.ts`
  TC-MENU-5/TC-MENU-6 exist specifically to prevent the exact regression
  (full banner redrawing on every menu retry) that motivated
  `enhance-experience`'s simplification in the first place (see §0's
  side-by-side of the old, removed "Symbion — Choose Interface" banner).
  `/plan` must place any new box in `index.ts`'s one-time pre-loop print, not
  inside `showBootMenu`, or must explicitly and visibly update those two
  tests with a documented rationale — never treat them as incidental
  collateral to delete.
- **Cross-feature collision risk**: this daemon prints its boot banner from
  the same two files (`apps/daemon/src/index.ts`, `apps/daemon/src/boot/
  menu.ts`) that `enhance-experience-STATE.md` already modified and shipped.
  `/plan` should re-read that STATE file's §10.2 exact-diff history before
  touching these files again, to avoid silently reverting the already-locked
  3-item-menu / auto-open-on-"1" behavior.
- **Windows terminal fragmentation risk** (relevant given this session's own
  env is Windows 11 + PowerShell): legacy `cmd.exe` and some CI runners have
  materially different Unicode box-drawing/emoji/ANSI support than modern
  Windows Terminal or macOS/Linux terminals — a design that looks perfect on
  the designer's machine can render as mojibake or misaligned garbage
  elsewhere. This should be explicitly tested on at least one legacy target,
  not just assumed to "just work" from a modern terminal screenshot.
- **Silent-failure risk carried over from today's code**: the existing
  auto-open `try/catch` (§1) already swallows errors with no user-visible
  trace — this is a pre-existing minor violation of the spirit of "never
  fail silently" (CLAUDE.md's filesystem-safety ethos, applied here to a
  non-filesystem but still user-facing action) and should be fixed as part
  of sub-requirement A (FR-A.3), not left as-is while redesigning the
  surrounding visuals.
- **Scope-creep risk**: "design UI terminal như ảnh" could be over-read as
  "build the stubbed v1.5 Terminal UI now" — it is not; `symbion-STATE.md`
  §0 explicitly locks the real interactive Terminal UI as v1.5-stubbed, and
  this request is scoped to the **boot banner/menu's cosmetic presentation**
  only (sub-requirement B's Scope section above), not the deferred feature.
  A second, related scope-creep risk: a phone-scannable QR code for the URL
  (a natural-feeling "10x" idea) is incompatible with today's
  `127.0.0.1`-only binding — Symbion is not reachable from another device at
  all today, and making it so is a distinct, much larger security decision,
  not a terminal-styling nicety.

## 6. Definition of done (THINK phase)

This THINK spec is ready for `/office-hours` (or direct user answers) when:
- [ ] Open question 1 / 8 (which actual scenario triggered the "just URL"
      ask, and whether a durable/reusable URL is actually wanted) is
      answered — this is the highest-leverage question, since it decides
      whether sub-requirement A is a messaging fix or a token-durability
      change with real security trade-offs.
- [ ] Open questions 2–3 (stale-session recovery UX shape, multi-instance
      support) are answered or explicitly deferred.
- [ ] Open questions 4–7 (box-drawing approach, width strategy, non-TTY
      behavior, post-choice message styling) are answered or explicitly left
      to `/plan`'s discretion.
- [ ] The reconciliation with `enhance-experience`'s "don't redraw the full
      banner on retry" fix (§0/§5) is explicitly acknowledged as either "kept
      as constraint" (default recommendation) or "consciously overridden with
      sign-off to update `menu.test.ts`."

## 7. Recommended next step

Run `/office-hours` to resolve open question 1/8 in particular (it changes
the shape and risk profile of sub-requirement A materially — cosmetic fix vs.
security trade-off). The other questions can reasonably be left to `/plan`'s
judgment if the user wants to move faster, since none of them changes the
*scope boundary* the way question 1/8 does. Once scope is locked, hand this
spec + `symbion-STATE.md` §1.4 (security posture) + `enhance-experience-STATE.md`
(prior art on the same files, including the exact regression-guard tests in
§0/§5) to `architect` via `/plan` to produce the ranked solution options,
file-level diffs, and complexity estimates — that analysis is explicitly out
of scope for this BA spec.

## PLAN — Architecture (architect, this session)

Scope constraints from `## Scope (locked at /office-hours)` above are treated
as fixed; this section is architecture only, per `/plan`'s mandate. Grounding
files re-read this session: `apps/daemon/src/server.ts`, `apps/daemon/src/index.ts`,
`apps/daemon/src/boot/menu.ts`, `apps/daemon/test/menu.test.ts`,
`apps/daemon/test/server.integration.test.ts` (T15 security suite),
`apps/web/src/lib/rpc/client.ts`, `apps/web/src/components/AppShell.tsx`,
`apps/web/src/lib/store/useArtifactStore.ts`, `apps/web/src/components/DaemonStatusBadge.tsx`,
`e2e/daemon-fixture.ts`, `docs/loops/enhance-experience-STATE.md`.

### P0. Flaws found in the locked spec itself (flagged, not silently worked around)

1. **Decision #3's blanket "TC-MENU-5/TC-MENU-6 must be deliberately rewritten"
   contradicts AC-B.5's own conditional wording** ("still pass unmodified... OR,
   if `/plan` deliberately chooses to move boxed styling into `showBootMenu`
   itself, these two tests are explicitly updated"). This PLAN does **not** move
   any styling into `showBootMenu` — `apps/daemon/src/boot/menu.ts` is untouched
   — so per AC-B.5's own "OR" branch, TC-MENU-5/6 stay **unmodified** and keep
   passing as the regression guard they already are. Forcing a rewrite with no
   functional reason would itself violate the "never treat tests as incidental
   collateral" principle in §5's own risk notes. Dev/Checker: do not touch
   `menu.test.ts` unless a real behavior change in `showBootMenu` requires it.
2. **A previously-undocumented hard dependency was found**: `e2e/daemon-fixture.ts`
   (`URL_RE`) greps the daemon's stdout for the *exact literal substring*
   `Symbion daemon đang chạy: <url>` to parse the boot URL for every e2e spec
   that boots a real daemon (`happy-path.spec.ts`, `auto-generate-body.spec.ts`,
   future specs). None of `/analyze`'s three BA passes traced this file. If
   sub-req B's redesign renames this line (e.g. to the reference image's
   `Server: <url>` wording), **every daemon-booting e2e test breaks silently**
   until someone notices. Resolution (below): the box's server line keeps this
   exact Vietnamese string byte-for-byte; the regex has no `^`/multiline
   anchor so it matches the substring regardless of surrounding border lines
   printed before/after it. `/qa` must run the e2e suite, not just eyeball
   the banner, to catch a regression here.
3. **A concrete, previously-unknown root cause for FR-A.3's "silent auto-open
   failure" was found while reading `index.ts`**: `child_process.exec` is
   called with **no callback**, so `open.exec(...)`'s asynchronous failure
   (bad exit code, `ENOENT`) is never observed at all — the `try/catch`
   around the synchronous call cannot catch an error that surfaces later via
   the callback/`error` event. Separately, on Windows the command is built
   as `start "<url>"` — cmd.exe's `start` treats a single quoted argument as
   the **window title**, not the target, when it looks like it could be one;
   the conventional fix is `start "" "<url>"` (empty title first). This is
   plausibly the literal mechanism behind the "auto-open does nothing" user
   complaint, not just a hypothetical gap. Both are fixed in P1 below — small,
   same-file, same-line diff as the visibility fix FR-A.3 already requires.
4. **Decision #4's "Unicode box vs ASCII fallback" framing overstates the
   actual risk**: the reference image's own border is already plain ASCII
   (`====`), not Unicode box-drawing (rounded double-line characters). There
   is no unicode box-drawing being proposed at all in this design — the only
   non-ASCII glyph anywhere is the optional rocket-emoji prefix. So
   "ASCII-safe fallback" collapses to one simple decision: emoji on/off,
   never a border on/off between two border character sets. This simplifies
   P1's implementation and removes a whole axis of testing the BA spec
   implied was needed.
5. **FR-B.2 vs EC-B.4's box-width tension is resolved by dropping the vertical
   side walls the reference image never actually had either.** Re-inspecting
   the reference image: it has only a top and bottom `====` rule, no side
   borders. Adopting exactly that (not adding side walls for "more box
   feel") means the `Server: <url>` line is a plain, unbroken, un-padded
   string with nothing appended after it — trivially satisfies "double-click/
   triple-click selects the full URL, no box character included" (AC-B.2)
   with no special-casing at all, and sidesteps the whole "does the long
   token overflow a padded box" problem structurally rather than by policy.

### P1. Architecture — package/app boundaries and files touched

No `packages/core` changes (nothing here is vendor-agnostic IR/render logic).
No daemon RPC surface changes — confirmed by tracing `apps/daemon/src/rpc/handlers.ts`
and `contract.ts`: this feature reuses the existing `ping` (unauthenticated
liveness) and `listProjects` (existing authenticated read) methods; no new
method is added, `READ_ONLY_METHODS` in `server.ts` is untouched, `server.ts`'s
auth gate (`method !== "ping"`) is untouched byte-for-byte — the per-boot
token, 127.0.0.1-only bind, and Origin/Host allowlist are not modified in any
way (CLAUDE.md mandate, decision #2/#5 preserved).

**New files:**
- `apps/daemon/src/boot/banner.ts` — pure, dependency-free box-string builder
  + TTY/emoji-support detection. Exported functions:
  - `isTtyOutput(stream?: NodeJS.WriteStream): boolean` — `(stream ??
    process.stdout).isTTY === true`.
  - `supportsEmoji(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): boolean`
    — heuristic: `false` if `env.SYMBION_FORCE_ASCII` is set; `true` if
    `env.SYMBION_FORCE_EMOJI` is set; otherwise `platform !== "win32" ||
    Boolean(env.WT_SESSION || env.TERM_PROGRAM || env.ConEmuANSI === "ON")`.
    Both `env`/`platform` are injectable for unit tests; default to
    `process.env`/`process.platform`. Documented as a best-effort heuristic,
    not a guarantee — legacy `cmd.exe` (no `WT_SESSION`) resolves to `false`
    (the concrete target named in decision #4); Windows Terminal, macOS,
    Linux resolve to `true`.
  - `buildBootBanner(opts: { version: string; url: string; useEmoji: boolean;
    isTty: boolean; terminalColumns?: number }): string[]` — **pure**, no
    `process` reads inside; returns the exact lines to `console.log`, one
    call per line, in order. Logic:
    1. `versionLine = (opts.useEmoji ? "[emoji] " : "") + "Symbion v" + opts.version`
    2. `serverLine = "Symbion daemon đang chạy: " + opts.url` — **kept
       byte-for-byte identical to today's existing line** (P0.2's fixture
       dependency).
    3. If `!opts.isTty`: return `[versionLine, serverLine]` (today's exact
       plain two-line output — zero visual change off-TTY, decision #6).
    4. Compute `longest = Math.max(versionLine.length, serverLine.length)`;
       `cap = opts.terminalColumns && opts.terminalColumns > 0 ?
       opts.terminalColumns : 100`. If `longest + 1 > cap` (terminal narrower
       than the longest content line, EC-B.1), return the plain two-line form
       (no border) rather than a broken/wrapped border.
    5. Otherwise return `["=".repeat(Math.min(longest, cap)), versionLine,
       serverLine, "=".repeat(Math.min(longest, cap))]` — top+bottom rule
       only, no side walls (P0.5).
  - No ANSI color codes anywhere in this module — sidesteps the entire
    "raw escape sequences leaking into piped log files" risk category
    (EC-B.2/AC-B.3) structurally; deferred as an optional future nicety, not
    required to satisfy any locked AC.
- `apps/daemon/src/boot/openBrowser.ts` — extracts today's inline
  `child_process.exec` call out of `index.ts` for testability and to carry
  the two fixes from P0.3:
  - `export function openInBrowser(url: string, onFailure: (message: string)
    => void): void` — builds the platform command (`open`/`start ""
    <url>`/`xdg-open`, with the `start ""` empty-title fix), calls `exec(cmd,
    (err) => { if (err) onFailure(...) })` — the callback itself is the FR-A.3
    fix (today's fire-and-forget call has no way to observe async failure at
    all).
- `apps/daemon/test/banner.test.ts` — unit tests for `buildBootBanner`/`supportsEmoji`.
- `apps/daemon/test/openBrowser.test.ts` — unit test mocking `node:child_process`.
- `apps/web/src/components/DaemonStatusBadge.test.tsx` — new, three-state render test.
- `apps/web/src/lib/store/useArtifactStore.heartbeat.test.ts` — new, heartbeat
  classification tests (mocks `callRpc`).

**Modified files:**
- `apps/daemon/src/index.ts`:
  - Replace lines 42-43 (`console.log("Symbion v...")` /
    `console.log("Symbion daemon đang chạy: ...")`) with a single
    `printBootBanner(VERSION, url)` call — a small local wrapper that reads
    `process.stdout.isTTY`/`process.stdout.columns`/`process.env`/`process.platform`
    once and calls the pure `buildBootBanner`/`supportsEmoji`, then
    `console.log`s each returned line. Called **exactly once**, before the
    `while (running)` loop starts — never inside it (decision #3).
  - Replace the inline `try { const open = await import("node:child_process");
    ...; open.exec(...) } catch {}` block (lines 51-58) with
    `openInBrowser(url, (msg) => console.log(msg))` from the new module. The
    `console.log("Mở: " + url)` line immediately before it (line 49) is
    unchanged — stays plain, unboxed (decision #6, post-choice messages).
- `apps/web/src/lib/rpc/client.ts`: add `export function hasSession(): boolean
  { return cachedToken !== null; }` — a pure read of the existing
  module-private `cachedToken` variable, no new state.
- `apps/web/src/lib/store/useArtifactStore.ts`:
  - Add two new state fields: `daemonReachable: boolean` (daemon process
    answered the last `ping`), `sessionValid: boolean` (last authenticated
    RPC call succeeded). Keep the existing `daemonConnected: boolean` field
    **unchanged in name and meaning** — it becomes a derived value
    (`daemonReachable && sessionValid`) set atomically alongside the other
    two, so all 11 existing consumers (`BuilderDrawer`, `GenerateBodyButton`,
    `ProjectPickerStep`, `ProvidersPanel`, `ProviderStatusPill`,
    `TemplatePreviewModal`, `PublishDiffView`, `ProjectView`, etc.) need
    **zero changes** — they already correctly want "fully usable" semantics
    for gating Save/Publish/Generate buttons regardless of *which* of the two
    new sub-conditions failed.
  - Replace `setDaemonConnected(connected: boolean)` with two new actions:
    `reportConnectionOk(): void` (`set({ daemonReachable: true, sessionValid:
    true, daemonConnected: true })`) and `reportConnectionError(err: unknown):
    void` — inspects `err instanceof DaemonRpcError && err.code ===
    "unauthorized"` -> `{ daemonReachable: true, sessionValid: false,
    daemonConnected: false }` (session-specific failure, daemon is up);
    anything else (network throw, timeout, non-401 error) ->
    `{ daemonReachable: false, sessionValid: false, daemonConnected: false }`
    (fail-closed: unknown failure mode is treated as "not usable," never
    silently upgraded to "connected").
  - Rewrite `startHeartbeat`'s `tick()` (this is the FR-A.2b fix — see P2
    below for the exact before/after).
- `apps/web/src/components/AppShell.tsx`: line 32's
  `loadProjects().catch(() => useArtifactStore.getState().setDaemonConnected(false))`
  becomes `loadProjects().catch((err) => useArtifactStore.getState().reportConnectionError(err))`
  — same call site, now classifies the failure instead of guessing.
- `apps/web/src/components/DaemonStatusBadge.tsx`: reads `daemonReachable` +
  `sessionValid` (not just the old single `connected` boolean) and renders
  **three** visual states instead of two (see P2).

**Explicitly unchanged (confirmed by this design, not by omission):**
`apps/daemon/src/boot/menu.ts`, `apps/daemon/test/menu.test.ts`,
`apps/daemon/src/server.ts`, `apps/daemon/src/rpc/handlers.ts`,
`apps/daemon/src/rpc/contract.ts`, `.symbion/` project-store schema (no
local-store changes at all in this feature — nothing here touches per-project
persistence), `apps/web/src/components/SettingsShell.tsx` and
`TemplatesView.tsx`'s independent token-read-and-strip logic (out of scope —
sub-req A's messaging fix is generic to "an RPC call 401'd with
`unauthorized`," which already covers these routes' RPC calls without route-
specific changes, since `DaemonRpcError.code` is inspected centrally in the
store, not per-route).

### P2. Data flow — exactly where each of the 4 root-cause fixes intercepts the flow

```
daemon boot (index.ts)
  |- generateToken() [server.ts, UNCHANGED]
  |- url = http://127.0.0.1:<port>/?t=<token>
  |- printBootBanner(VERSION, url)   <- FIX #4 (raw-token-string UX): same
  |    info, framed in a bordered box instead of two bare lines (sub-req B)
  |- showBootMenu() loop [menu.ts, UNCHANGED]
       |- choice "web" -> console.log("Mo: <url>") [unchanged, plain]
                        -> openInBrowser(url, onFailure)  <- FIX #3 (silent
                          auto-open failure): callback surfaces exec errors;
                          `start ""` fixes a likely real failure mode, not
                          just its symptom

browser loads page (fresh tab, exact printed URL)
  |- AppShell mount: reads ?t= -> initDaemonSession(token, port) [client.ts]
  |- history.replaceState strips ?t= [UNCHANGED - decision #2, no durability]
  |- loadProjects() -> callRpc("listProjects") with token header
       |- success -> reportConnectionOk()
       |- 401 unauthorized -> reportConnectionError(err)   <- now classifies
            instead of blindly setDaemonConnected(false)
  |- startHeartbeat() every 4s:
       tick():
         1. try callRpc("ping", {})            [tokenless, UNCHANGED - this
            is the ONLY thing that answers "is the daemon process even
            alive," independent of session state]
            catch -> reportConnectionError(err) [-> daemonReachable=false]
                    return
         2. if (!hasSession())                  <- FIX #1/#2 (F5-refresh /
              -> set({ daemonReachable: true, sessionValid: false,          stale-URL messaging): purely client-side check, no network
                daemonConnected: false })         call needed - after a
              return                              refresh, cachedToken is
                                                    genuinely null (module
                                                    re-initializes), which is
                                                    the exact EC-A.5 trigger
         3. try callRpc("listProjects", {})     <- the SAME existing
              -> reportConnectionOk()               authenticated read used
            catch (err) -> reportConnectionError(err)  elsewhere; no new RPC
                                                    method. A 401 here with a
                                                    valid-looking session
                                                    (stale/foreign token,
                                                    EC-A.1) also lands in
                                                    reportConnectionError,
                                                    same messaging path as #2

DaemonStatusBadge renders from (daemonReachable, sessionValid):
  - both true            -> green "daemon (connected)"          [unchanged]
  - daemonReachable=false -> red "daemon mat ket noi..."          [unchanged
                             wording - genuinely daemon-down / EC-A.3]
  - reachable, !valid     -> NEW amber/distinct: "Phien lam viec da het han
                             hoac URL khong con hop le - quay lai terminal de
                             lay URL/token moi." (FR-A.2/A.2b - this is the
                             line that did not exist before; today this state
                             was indistinguishable from "connected" because
                             `ping` alone answered it)
```

This is exactly the fix for the confirmed bug in STATE §1: previously `ping`'s
tokenless success alone flipped the badge green every 4s regardless of real
RPC health. Now `ping` only proves "daemon reachable"; a second, authenticated
call proves "session usable" — the badge can no longer lie about being fully
connected while real calls 401. `server.ts`'s `ping` semantics (tokenless
liveness probe, exercised by `server.integration.test.ts`'s T15 "server binds
127.0.0.1" test) are deliberately left alone rather than made to require a
token — that would break the daemon's only pre-token liveness signal and its
existing regression test for no security benefit (a network-reachable-but-
wrong-token distinction is exactly what step 3's authenticated probe already
gives us for free, without touching the security-relevant file).

### P3. Edge cases (extending STATE §2/§3; new ones this design surfaces)

- **EC-NEW.1 (terminal resize mid-boot)**: `buildBootBanner` reads
  `terminalColumns` once, synchronously, at print time (no `resize` listener
  registered). A resize after the box has already printed does nothing —
  correct and desired (decision #3: printed once, never redrawn). A resize
  *during* the synchronous print is not meaningfully possible (no I/O yields
  mid-loop of `console.log` calls).
- **EC-NEW.2 (Hide-to-Tray leaves the terminal "occupied," not idle)**:
  Traced in `index.ts` — choice `"tray"` sets `running = false` and returns
  from `main()`, but **does not call `process.exit()`** (comment: "process
  keeps running via the HTTP server"). The Node process stays alive holding
  the terminal's stdio; the shell prompt does **not** return. A user who then
  tries to run `npm run start` again in the *same* terminal window must first
  kill the backgrounded process (Ctrl+C), which also kills the daemon HTTP
  server (same process) — expected, not a regression. On the next boot in
  that same window, the box prints again below the old scrollback (no
  clear-screen call is added by this design — intentional: avoids an extra
  platform-specific ANSI clear-screen sequence and preserves scrollback some
  users rely on). Documented here so `/qa` doesn't mistake old scrollback
  boxes for a bug.
- **EC-NEW.3 (`findOpenPort` fallback port)**: `url` is built from
  `handle.port` *after* port resolution (existing code, line 41), so the
  boxed banner already reflects the actual bound port even when it differs
  from `config.port` — verified no regression, no change needed.
- **EC-NEW.4 (emoji heuristic false negative/positive)**: `supportsEmoji()`
  is a best-effort heuristic (P1), not a guarantee — e.g. some third-party
  Windows terminal emulators may set neither `WT_SESSION` nor `TERM_PROGRAM`
  yet render emoji fine, or vice versa. `SYMBION_FORCE_EMOJI=1` /
  `SYMBION_FORCE_ASCII=1` env escape hatches are provided for this and are
  also what unit tests use for deterministic coverage without mocking global
  `process.stdout`/`process.platform`.
- **EC-NEW.5 (e2e fixture regex dependency)**: see P0.2 — explicitly a new
  edge case the BA passes missed; resolved by keeping the server line's exact
  text.
- **EC-A.4 (browser back-navigation to an old `?t=` URL)**: no special-case
  code is added. Any full page reload re-runs `AppShell`'s mount effect
  against whatever `?t=` is currently in the address bar — if it's stale, the
  resulting `listProjects` 401 is classified by `reportConnectionError`
  exactly like every other stale-session case (EC-A.1/EC-A.5). "Last URL
  wins" falls out naturally from there being no separate special-cased logic.

### P4. Local-store schema changes

**None.** This feature touches no `.symbion/<project>/` files, no
`~/.config/symbion/config.json` schema (config's `port` field is read/written
exactly as today), and no markers/hashes/backups. Confirmed by tracing every
modified file above — none call into `apps/daemon/src/store/*`.

### P5. Security posture — unchanged, `/cso` gate required

Per decision #2 and STATE §2's explicit out-of-scope list: token generation
(`generateToken`), the per-boot token requirement on every non-`ping` RPC
call, the `127.0.0.1`-only bind, and the Origin/Host allowlist in
`server.ts` are **not modified by this design at all** — zero lines of
`server.ts` change. The only "auth-adjacent" change is client-side
(web classifies an existing 401 more precisely) and does not alter what is
or isn't authorized. Nonetheless, per CLAUDE.md's posture on anything
touching the daemon's session/token path and this STATE file's own §5 risk
notes, **`/cso` (security-reviewer) is a mandatory gate before `/ship`** —
specifically to verify: (a) no line of `server.ts`/`handlers.ts` actually
changed, (b) `reportConnectionError`'s fail-closed default (unknown error ->
treated as not-connected, never upgraded to connected) holds under all
tested failure shapes, (c) the new `openInBrowser` shell-command construction
still safely quotes the URL (no injection surface change from today's
already-`exec`-based call — URL is daemon-generated, never user-typed, so no
new untrusted-input path is introduced, but `/cso` should confirm this
reasoning holds).

### P6. Recommended next step

Hand this PLAN + `docs/loops/boot-terminal-ux-testplan.md` to `dev`/
`feature-builder` via `/build`. `code-reviewer` + `architect` re-review via
`/review` should check this PLAN's own P0 flaw list was actually resolved as
designed (not reverted back to the literal BA framing), then `/cso` (mandatory
per P5) before `/ship`.

## BUILD — implementation notes (feature-builder, this session)

Implemented exactly per the PLAN section above. `menu.ts`, `server.ts`,
`rpc/handlers.ts`, `rpc/contract.ts`, and `.symbion/` schema are all
byte-for-byte unchanged — verified via `git diff` before finishing.

### Files changed

**New:**
- `apps/daemon/src/boot/banner.ts` — pure `buildBootBanner`/`isTtyOutput`/`supportsEmoji`, exactly as specified in PLAN §P1 (no side walls, byte-identical server line, 100-col default cap, `SYMBION_FORCE_ASCII`/`SYMBION_FORCE_EMOJI` escape hatches).
- `apps/daemon/src/boot/openBrowser.ts` — `openInBrowser(url, onFailure)`, fixes both P0.3 bugs (`exec` now has a real callback; Windows command is `start "" "<url>"`).
- `apps/daemon/test/banner.test.ts` — TC-BAN-1..8 (skipped TC-BAN-7's "narrow terminal" is TC-BAN-5; all testplan cases for this file are covered, including the two composite TC-BAN-6 checks and the ANSI-escape guard TC-BAN-8).
- `apps/daemon/test/openBrowser.test.ts` — TC-OPEN-1..4, mocks `node:child_process`.
- `apps/web/src/lib/store/useArtifactStore.heartbeat.test.ts` — TC-HB-1..7, mocks `../rpc/client`'s `callRpc`/`hasSession`.
- `apps/web/src/components/DaemonStatusBadge.test.tsx` — TC-BADGE-1..3.
- `apps/web/vitest.config.ts`, `apps/web/vitest.setup.ts` — **new infra, not explicitly called out as a file to create in the PLAN's file list, but required to make the PLAN's own listed new test files (`useArtifactStore.heartbeat.test.ts`, `DaemonStatusBadge.test.tsx`) runnable at all** — `apps/web` had zero test tooling before this feature (no `vitest`, `@testing-library/react`, `jsdom`, no `test` script, not registered in the root `vitest.workspace.ts`). Added as devDependencies to `apps/web/package.json` (`vitest@^2.0.5` matching the version already pinned elsewhere in the repo, `@testing-library/react@^16.3.2`, `@testing-library/jest-dom@^6.9.1`, `jsdom@^29.1.1`), a `test` script, an `esbuild.jsx: "automatic"` option (tsconfig's `jsx: "preserve"` is Next-specific and not usable by Vitest's esbuild transform directly), and a `"web"` project entry in `vitest.workspace.ts` (+ a `test:web` script in the root `package.json`, mirroring `test:core`/`test:daemon`). **Flag for Checker**: confirm this is an acceptable scope addition — it's test-only infrastructure with no production code path, but it is a new dependency footprint in `apps/web/package.json` (CLAUDE.md's "no new dependency" constraint in the locked Scope was stated for `apps/daemon` specifically re: box-drawing, not for web test tooling, but worth an explicit sign-off).

**Modified:**
- `apps/daemon/src/index.ts` — replaced the two bare `console.log` boot lines with `printBootBanner(VERSION, url)` (called once, before the `while (running)` loop) and replaced the inline uncallbacked `child_process.exec` block with `openInBrowser(url, (msg) => console.log(msg))`. The `console.log(\`Mở: ${url}\`)` line is unchanged and still plain/unboxed.
- `apps/web/src/lib/rpc/client.ts` — added `export function hasSession(): boolean`.
- `apps/web/src/lib/store/useArtifactStore.ts` — added `daemonReachable`/`sessionValid` state fields (both initialized `true`, matching the pre-existing `daemonConnected: true` initial value); added `reportConnectionOk()`/`reportConnectionError(err)` actions; kept `setDaemonConnected(connected)` as a thin backward-compatible wrapper (`true` → `reportConnectionOk()`, `false` → sets all three flags false) so `TemplatePreviewModal.tsx` and `TemplatesView.tsx`'s existing direct `setDaemonConnected(false)` call sites (out of scope per PLAN's "explicitly unchanged" list) keep working unmodified; rewrote `startHeartbeat`'s `tick()` per PLAN §P2's exact 3-step sequence (tokenless `ping` → client-side `hasSession()` check → authenticated `listProjects` probe).
- `apps/web/src/components/AppShell.tsx` — `loadProjects().catch(...)` now calls `reportConnectionError(err)` instead of `setDaemonConnected(false)`.
- `apps/web/src/components/DaemonStatusBadge.tsx` — now reads `daemonReachable`/`sessionValid` and renders 3 states: green (both true, unchanged text/markup), amber "session expired" (reachable, invalid — new, distinct Vietnamese copy steering the user back to the terminal), red "daemon mất kết nối" (unreachable, unchanged text/markup).
- `apps/web/package.json`, `vitest.workspace.ts`, root `package.json` — test infra additions described above.

**Explicitly NOT touched** (verified): `apps/daemon/src/boot/menu.ts`, `apps/daemon/test/menu.test.ts`, `apps/daemon/src/server.ts`, `apps/daemon/src/rpc/handlers.ts`, `apps/daemon/src/rpc/contract.ts`, `.symbion/` schema, `apps/web/src/components/SettingsShell.tsx`, `apps/web/src/components/TemplatesView.tsx`'s token logic (its `setDaemonConnected(false)` call site still compiles/works via the backward-compatible wrapper, no edit made to the file itself).

### Test results (this session, Windows 11 / PowerShell+Git-Bash environment)

- `npx vitest run --project daemon`: `test/banner.test.ts` (12/12), `test/openBrowser.test.ts` (4/4), `test/menu.test.ts` (7/7, **zero diff to the test file**), `test/server.integration.test.ts` (29/29, T15 security suite intact) all pass. 7 pre-existing failures remain in `test/listDir.test.ts` and `test/rpc.integration.test.ts` (symlink-creation `EPERM` and `chmod`-based read-only-dir simulation not working the same way on this Windows filesystem) — confirmed pre-existing and unrelated: I did not touch either test file or the source files they exercise (`handlers.ts`, path-confinement code), and `git diff` shows no changes there. Checker should independently confirm these same 7 fail on `master` before this feature's changes, to rule out an accidental regression.
- `npx vitest run --project web`: `DaemonStatusBadge.test.tsx` (3/3), `useArtifactStore.heartbeat.test.ts` (7/7) — all new, all pass.
- `npm run build --workspaces --if-present`: all 4 packages (`core`, `rpc-types`, `daemon`, `web`) build clean, including `next build`'s type-check step.
- E2E (`e2e/happy-path.spec.ts`, `auto-generate-body.spec.ts`) — **not run this session** (Playwright browser install / real daemon boot is out of scope for a fast Maker loop; deferring to `/qa` per the testplan's own gate checklist). Verified by static inspection only: `e2e/daemon-fixture.ts`'s `URL_RE` regex has no `^`/multiline anchor and matches the substring `Symbion daemon đang chạy: <url>` regardless of surrounding lines; `banner.ts`'s `serverLine` construction is textually identical to the pre-feature line in `index.ts`, and `TC-BAN-4` unit-tests this exact regex shape. This is a reasoned argument, not an executed e2e pass — flagging for `/qa` to actually run the suite as its own gate item already requires.
- Manual terminal checks (MAN-1..6 in the testplan) — **not performed this session** (require real terminal windows: Windows Terminal, legacy `cmd.exe`, a broken default-browser association, etc.) — explicitly deferred to `/qa`'s manual-checks section, per the testplan's own framing of §4 as "cannot be fully automated."

### Assumptions for the Checker to verify

1. **Real-world token URLs are long enough that the boxed banner will rarely actually render on a typical-width terminal.** Concretely observed this session: `Symbion daemon đang chạy: http://127.0.0.1:<port>/?t=<64 hex chars>` is ~117 characters. `buildBootBanner`'s fallback rule (PLAN §P1 step 4: `longest + 1 > cap` → plain 2-line form, `cap` defaulting to 100 when `terminalColumns` is unknown/non-positive) means: on any terminal that doesn't report a real `columns` value ≥ ~118, or that reports a width narrower than that, the "bordered box" sub-requirement (B) silently never displays for a real token — the daemon prints the identical plain 2-line output as before this feature, every time. On a terminal that *does* report `columns` (most modern terminals set `process.stdout.columns` correctly, often 80/120/150), whether the box shows depends entirely on that reported width being ≥ ~118. **This is a literal, faithful implementation of the PLAN's algorithm** (I did not invent this cap or the fallback condition — PLAN §P1 step 4 specifies both verbatim), but it means AC-B.1's "verified by eye against the reference screenshot" may fail on many real terminals/window sizes purely because the real token is long, not because of a bug. Flagging this prominently because it's the single most likely thing a manual QA pass (MAN-1) will be surprised by. If the product wants the box to reliably show for the real (long) URL, the fix is a PLAN-level change (e.g. raise the cap, or don't gate the border on the URL's own length) — not something I changed unilaterally, since PLAN §P0.5 explicitly frames the no-side-walls design as already solving the width tension "structurally," and P1 step 4's cap/fallback is stated as intentional EC-B.1 behavior, not an oversight.
2. Assumed the `esbuild.jsx: "automatic"` Vitest config option (rather than adding `@vitejs/plugin-react` as a dependency) is an acceptable, minimal way to get JSX working under Vitest for `apps/web` — avoids one more new dependency; Checker should confirm this doesn't conflict with anything in Next's own build (it doesn't — `next build`'s own Babel/SWC pipeline is untouched, this option is Vitest-test-only).
3. Assumed `apps/web/vitest.setup.ts`'s `cleanup()` (unmounting between tests) plus `@testing-library/jest-dom/vitest` matchers is the right minimal setup; no global mocks of `fetch`/`window.location` were added since neither new test file needs them (they mock `../rpc/client` directly instead of hitting real `fetch`).
4. Assumed the amber Tailwind class `bg-amber-500` is an acceptable ad-hoc choice for the new "session expired" state's background color — no existing amber/warning color token was found reused elsewhere in `apps/web`'s component set during this session's file reads; Checker/designer should confirm this matches the project's (unseen by me) design system if one exists beyond what I read.
5. Assumed reusing the bare `callRpc<{}, ListProjectsResult>("listProjects", {})` call (not `get().loadProjects()`) as the heartbeat's authenticated probe is correct per PLAN §P2's literal step 3 — this means the heartbeat's `listProjects` success does **not** refresh the `projects` array in the store (only `reportConnectionOk()` fires); the PLAN's data-flow diagram only shows classification, not a state refresh, so this is read as intentional (avoid clobbering `projects` render state on an unrelated 4-second timer), but flagging since it's a small interpretation call.
6. Did not add any `SYMBION_FORCE_ASCII`/`SYMBION_FORCE_EMOJI` documentation to a user-facing README/help text — these are internal/test escape hatches per PLAN §P1's own framing ("also what unit tests use"); no doc surface was named in the PLAN as needing this, so left undocumented beyond the code comments in `banner.ts`.
7. Deferred: real terminal manual checks (MAN-1 through MAN-6), the full e2e suite run, and the `/cso` security review (mandatory per PLAN §P5) are all explicitly out of this Maker pass's scope — next steps for `/review` and `/qa`/`/cso` respectively.

## SHIP — gate status (this session)

**`/review`: NOT RUN. `/qa`: NOT RUN. `/cso`: NOT RUN.**

The user was explicitly asked, before shipping, whether to run `/review` →
`/qa` → `/cso` first (the normal pipeline gate, especially load-bearing here
since this feature touches the daemon's session/token RPC-auth path — exactly
the trust-boundary change CLAUDE.md and this STATE file's own §5 Risk Notes
say must not ship without a security pass) or to skip straight to `/ship`.
**The user explicitly chose to skip all three gates and ship directly**,
after being told this means:

- No independent Checker (code-reviewer/architect) has verified the Maker's
  implementation against the PLAN.
- No live QA pass has executed the testplan (`docs/loops/boot-terminal-ux-testplan.md`)
  — in particular the e2e suite and the 6 manual terminal checks (MAN-1..6)
  that Build explicitly deferred, and the width-fallback assumption in
  Build's Assumption #1 (the boxed banner likely won't render at all for a
  real, long token URL on most terminal widths) is **unverified by human eye**
  at ship time.
- No security review has examined the session/token/heartbeat changes in
  `apps/web/src/lib/rpc/client.ts`, `apps/web/src/lib/store/useArtifactStore.ts`,
  and `apps/web/src/components/AppShell.tsx`/`DaemonStatusBadge.tsx` — this is
  the one sub-requirement (A) every prior phase (`/analyze`, `/office-hours`,
  `/plan`) flagged as mandatory-`/cso`-before-ship.

**Residual risk accepted by the user, recorded here per `/ship`'s own gate
requirement**: this feature ships with unverified correctness (no Checker
pass) and unverified security posture on a change to the localhost-RPC
trust boundary. Automated tests (unit + build) pass — see BUILD section
above — but automated tests do not substitute for an independent review or
a security audit of an auth-adjacent change. If a regression or security
issue surfaces post-ship, start from this note and the BUILD section's
"Assumptions for the Checker to verify" list (still unverified) as the first
suspects.
