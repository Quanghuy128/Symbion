# enhance-experience — Test Plan

Companion to `enhance-experience-STATE.md` §10 (PLAN). Organized by sub-requirement.
Unit tests = Vitest (`apps/daemon/test/`, `packages/core/test/`). No Playwright/e2e
journey exists yet in this repo for the terminal or CreateProjectDialog surfaces —
manual/QA-phase verification is specified where automated e2e isn't practical
(terminal stdin-feed pattern), per the existing `connect-providers-STATE.md §12.2`
precedent referenced in STATE.

---

## 1. Sub-requirement 1 — Port default (Vitest, unit)

File: `packages/core/test/ir-types.test.ts` (new, or add to existing core IR test file
if one already covers `DEFAULT_GLOBAL_CONFIG`).

| Test | Assertion |
|---|---|
| TC-PORT-1 | `DEFAULT_GLOBAL_CONFIG.port === 12802` |
| TC-PORT-2 | `grep -rn "20128" apps/ packages/ README.md` (excluding test fixtures that intentionally pin an arbitrary port) returns zero matches — run as a CI/QA-phase shell check, not a Vitest assertion (AC-1.2). |

File: `apps/daemon/test/findOpenPort.test.ts` (existing — extend, do not replace).

| Test | Assertion |
|---|---|
| TC-PORT-3 | Fresh config dir (`SYMBION_CONFIG_DIR` pointed at an empty temp dir), daemon boot attempts port `12802` first (mock/stub `startServer` to capture the first candidate port passed to `findOpenPort`'s callback). Regression-safe re-assertion of FR-1.1/AC-1.3. |
| TC-PORT-4 | Existing config dir pre-seeded with `{ port: 9999, ... }` — daemon boot does NOT override to `12802`; boots on `9999` unchanged (AC-1.4, FR-1.3 no-forced-migration). |
| TC-PORT-5 (regression) | Port `12802` already bound by another process at boot — `findOpenPort` retries forward (`12803`, `12804`, ...) exactly as today's existing retry-forward test already covers; just confirm the starting literal changed without altering retry-count/backoff behavior (EC-1.1). |

---

## 2. Sub-requirement 2 — Terminal boot menu (Vitest unit + manual QA)

File: `apps/daemon/test/menu.test.ts` (new).

`showBootMenu` reads from `process.stdin` via `readline` — test by piping a mock
readable stream (existing pattern: feed `"<digit>\n"` to stdin, per
`connect-providers-STATE.md §12.2`'s documented manual QA pattern; for Vitest,
construct a `Readable` stream and pass it as `input` if `showBootMenu`'s signature
allows injecting streams, or capture `console.log` calls via `vi.spyOn`).

| Test | Assertion |
|---|---|
| TC-MENU-1 | Feeding `"1\n"` resolves to `"web"` (unchanged mapping). |
| TC-MENU-2 | Feeding `"2\n"` resolves to `"tray"` (CHANGED mapping — was `"3"`/`"terminal"` before; this is the one behavior change flagged in design §4/PLAN §10.2 that headless scripts must adapt to). |
| TC-MENU-3 | Feeding `"3\n"` resolves to `"exit"` (CHANGED mapping — was `"4"` before). |
| TC-MENU-4 | Feeding `"4\n"` is now INVALID (was `"exit"` before the renumber) — triggers the "Lựa chọn không hợp lệ" retry path, then a second valid digit resolves correctly. |
| TC-MENU-5 | Console output for a single `showBootMenu` call (before any input) is exactly: `MENU_LINE` + the prompt — i.e. no banner border lines (`====`), no version string, no "Server:" line are ever printed by `showBootMenu` itself (AC-2.2, verified by asserting `console.log` was NOT called with any line matching `/={3,}/` or `/^  Symbion — Choose Interface/`). |
| TC-MENU-6 | Invalid-input retry reprints ONLY the menu line + prompt (not the full banner) — assert `console.log`'s call list on the second prompt cycle contains the menu line exactly once, no duplicate banner content (regression target for the literal STATE §1 complaint). |
| TC-MENU-7 (type-level) | `BootChoice` type still includes `"terminal"` as a valid TS union member (compile-time check — e.g. `const x: BootChoice = "terminal";` in a `.test-d.ts` or a simple assignment compiled as part of `tsc --noEmit`) — confirms the "one-line revert" promise wasn't broken by accidentally narrowing the type. |

Manual/QA-phase (not automatable as Vitest without spawning a real child process):

| Test | Assertion |
|---|---|
| TC-MENU-QA-1 | `npm run start` from a clean boot: total lines printed before any keypress is fewer than today's 10-line minimum (AC-2.1/AC-2.2) — count manually or via `npm run start | head -n 5 \| wc -l` against a piped EOF stdin. |
| TC-MENU-QA-2 | The existing "headless: pipe a single digit to stdin" QA pattern (`echo "1" \| npm run start`, per `connect-providers-STATE.md §12.2`) still works against the NEW menu — confirms AC-2.3 ("a menu still exists in usable form," digit-stability not required). |
| TC-MENU-QA-3 | Trigger port exhaustion (bind all ports `12802`-`12821` manually with dummy listeners, or temporarily patch `maxAttempts` to 1 with one port pre-occupied) — confirm the "Không tìm được cổng trống..." error still prints clearly and `process.exit(1)` still fires, with NO menu ever shown (AC-2.4/EC-2.3/T6). |
| TC-MENU-QA-4 | Choose "Hide to Tray" (`2`) — confirm `"Đã chuyển sang chạy nền (Hide to Tray). Server vẫn đang chạy."` still prints verbatim (EC-2.1, unchanged copy per locked autopilot decision NOT to add a second URL line). |

---

## 3. Sub-requirement 3 — Windows-style path support (Vitest unit, security-critical)

### 3.1 `apps/daemon/test/pathStyle.test.ts` (new — pure string-logic unit tests)

| Test | Assertion |
|---|---|
| TC-PS-1 | `isWindowsDriveAbsolute("C:\\Users\\me\\repo")` → `true` |
| TC-PS-2 | `isWindowsDriveAbsolute("C:/Users/me/repo")` → `true` (forward-slash variant) |
| TC-PS-3 | `isWindowsDriveAbsolute("c:\\Users\\me\\repo")` → `true` (lowercase drive letter) |
| TC-PS-4 | `isWindowsDriveAbsolute("/home/me/repo")` → `false` (Unix path unaffected) |
| TC-PS-5 | `isWindowsDriveAbsolute("repo/sub")` → `false` (relative path unaffected) |
| TC-PS-6 | `isWindowsDriveAbsolute("C:foo")` → `false` (drive-relative Windows syntax, deliberately not recognized — PLAN §10.3.2 note) |
| TC-PS-7 | `isUncPath("\\\\fileserver\\teams\\my-service")` → `true` |
| TC-PS-8 | `isUncPath("\\\\")` → `false` (incomplete UNC prefix, no server name) |
| TC-PS-9 | `isUncPath("\\\\server")` → `false` (no trailing separator after server name) |
| TC-PS-10 | `isUncPath("C:\\Users\\me")` → `false` (drive-absolute is not UNC) |
| TC-PS-11 | `isWindowsStyleAbsolute(...)` → `true` for both drive-absolute and UNC inputs, `false` for Unix-absolute and relative inputs. |
| TC-PS-12 | `normalizeWindowsPath("c:\\Users\\me/code\\my-service")` → `"C:/Users/me/code/my-service"` (mixed-separator + lowercase-drive normalization, EC-3.1 + EC-3.2). |

### 3.2 `apps/daemon/test/rpc-validatePath.test.ts` (new, or extend `rpc.integration.test.ts`'s existing `T2 validatePath` describe block)

| Test | Assertion |
|---|---|
| TC-VP-1 (regression) | Existing Unix-style tests (`existing dir -> exists+isDir true`, `with .claude/ -> hasClaudeDir true`, `non-git -> isGitRepo false`, `missing path -> exists false`) all still pass unmodified — zero regression to today's behavior for Unix-style inputs (AC-3.3). |
| TC-VP-2 | `validatePath({ path: "C:\\Users\\me\\nonexistent-repo" })` (Windows-style, drive-absolute, well-formed, does not exist on this host) → `{ exists: false, isDir: false, isGitRepo: false, hasClaudeDir: false, hasAgentsMd: false, writable: false }`, **`reason` field is `undefined`** (NOT `"unc-unsupported"` — confirms drive-absolute is correctly distinguished from UNC, AC-3.1 under scope (b)). |
| TC-VP-3 | `validatePath({ path: "\\\\fileserver\\teams\\my-service" })` (UNC) → `{ exists: false, isDir: false, isGitRepo: false, hasClaudeDir: false, hasAgentsMd: false, writable: false, reason: "unc-unsupported" }` — the new discriminant fires, no `existsSync`/`statSync` call attempted (verify via `vi.spyOn(fs, "existsSync")` and assert it was NOT called for this input, confirming the short-circuit happens before any fs touch). |
| TC-VP-4 | `validatePath({ path: "C:/Users/me/code/my-service" })` (forward-slash drive-absolute variant) → same shape as TC-VP-2, confirms mixed-separator tolerance at the detection layer (EC-3.1). |
| TC-VP-5 | A directory that DOES exist on the real test host, validated with a Unix-style path string identical to today's existing passing test — confirms the new UNC-check branch added at the top of `validatePath` does not accidentally short-circuit or alter behavior for ordinary Unix paths (regression guard specifically for the new early-return branch). |

### 3.3 `apps/daemon/test/rpc.integration.test.ts` — extend existing `T11 path confinement (E14)` describe block

This is the **highest-priority test addition in this entire feature** — STATE's own
words: "must have explicit test coverage, not just 'probably works.'" Add directly
alongside the 3 existing T11 tests so parity is visually obvious in the same file.

| Test | Assertion |
|---|---|
| TC-T11-4 (NEW, security-critical) | `expect(() => resolveConfinedPath(projectRoot, "..\\\\..\\\\escape.md")).toThrow(PathConfinementError)` — Windows-style backslash traversal, exact parity test to the existing `"../escape.md"` case (TC at line 435). **This is the literal AC-3.2 requirement.** |
| TC-T11-5 (NEW) | `expect(() => resolveConfinedPath(projectRoot, "..\\\\..\\\\windows\\\\system32")).toThrow(PathConfinementError)` — the exact example string from STATE EC-3.4's own wording, multi-segment Windows traversal. |
| TC-T11-6 (NEW) | `expect(() => resolveConfinedPath(projectRoot, "C:\\\\Users\\\\me\\\\repo")).toThrow(PathConfinementError)` — Windows-style absolute path rejected as absolute-and-disallowed (parity to existing `"/etc/passwd"` case at line 439), confirms the `isWindowsStyleAbsolute` check added to `resolveConfinedPath`. |
| TC-T11-7 (NEW) | `expect(() => resolveConfinedPath(projectRoot, "\\\\\\\\server\\\\share\\\\file.md")).toThrow(PathConfinementError)` — UNC-style string passed as a `relPath` is also rejected as absolute-and-disallowed (same code path as TC-T11-6, confirms `isWindowsStyleAbsolute` catches both sub-shapes). |
| TC-T11-8 (NEW) | Mixed-separator traversal: `expect(() => resolveConfinedPath(projectRoot, "..\\\\../escape.md")).toThrow(PathConfinementError)` — one segment backslash, one segment forward-slash, still caught (EC-3.1 applied to the traversal check specifically). |
| TC-T11-9 (NEW, regression) | The 3 EXISTING T11 tests (`"../escape.md"`, `"/etc/passwd"`, symlink escape) still throw `PathConfinementError` after the `rejectTraversalSegments`-moved-to-top change — i.e. moving the call earlier in `resolveConfinedPath` must not change the outcome (still reject) for any existing passing case, only the order/mechanism by which rejection happens. Run the existing 3 tests unmodified; they must still be green. |
| TC-T11-10 (NEW) | A LEGITIMATE relative path containing a literal `..` as part of a longer, non-traversing segment name is NOT a real-world case `rejectTraversalSegments` needs to special-case (the existing check is segment-exact: `segments.includes("..")`, not a substring match) — add one test confirming a filename like `"my..file.md"` (no separator-bounded `..` segment) is NOT rejected, to prove the check is precise and doesn't false-positive on the new Windows-aware split regex. (Regression guard against an overly broad fix.) |

### 3.4 `apps/daemon/test/listDir.test.ts` — extend `makeDir — error / edge cases`

| Test | Assertion |
|---|---|
| TC-MD-NEW-1 | `makeDir("/tmp/symbion-test/..\\\\escape")` (Windows-style backslash `..` segment passed to `makeDir`, which today only splits on `/`) — after the PLAN §10.3.4 point 5 fix (split on both separators), this must throw `RpcError("invalid-params", ...)`, parity with the existing TC-MD5 Unix-style `..`-segment rejection. **Before the fix, this test should be written first and confirmed to FAIL (red) against the unfixed code, to prove the gap is real and not hypothetical**, then the fix applied to turn it green — standard regression-test discipline for a security fix. |

### 3.5 Web-layer test (manual QA — no existing Playwright/component-test harness found for this dialog)

No automated component test exists today for `CreateProjectDialog.tsx` (confirmed —
no `*.test.tsx`/`*.spec.tsx` found under `apps/web` in this codebase as of this PLAN).
Manual QA-phase verification, to run during `/qa`:

| Test | Assertion |
|---|---|
| TC-WEB-QA-1 | Open Create Project dialog, type `\\fileserver\teams\my-service` → UI shows the distinct ⚠ UNC warning message (5c), NOT the ✗ "doesn't exist" message (5b), and NO "Tạo thư mục này" button is rendered. |
| TC-WEB-QA-2 | Type a real existing directory path on the test machine (Unix-style, e.g. `/tmp`) → still shows ✓ "Thư mục tồn tại" (5a) — regression check that the new 3-way branch didn't break the existing happy path. |
| TC-WEB-QA-3 | Type a well-formed but nonexistent Windows-style path (e.g. `C:\Users\nobody\nonexistent`) on a Linux/WSL test machine → shows ✗ "Thư mục không tồn tại" + "Tạo thư mục này" button (5b, NOT 5c) — confirms drive-absolute and UNC are visually distinguished correctly end-to-end through the real RPC round-trip, not just at the unit-test level. |
| TC-WEB-QA-4 | Placeholder text in the empty input reads the new platform-neutral copy (`…/code/my-service`), not the old Unix-flavored `/home/me/code/my-service`. |

---

## 4. Cross-cutting regression confirmation (run once, after all 3 sub-requirements are implemented)

| Test | Assertion |
|---|---|
| TC-REG-1 | Full existing `apps/daemon/test/` suite passes unmodified (`npm test` in `apps/daemon`) — zero regressions across ALL existing describe blocks, not just the ones touched (T1-T14 in `rpc.integration.test.ts`, all of `listDir.test.ts`, etc.) — AC-3.3's literal wording. |
| TC-REG-2 | Full existing `packages/core/test/` suite passes unmodified. |
| TC-REG-3 | `tsc --noEmit` (or the repo's equivalent strict-typecheck script) passes across all 3 packages after the `ValidatePathResult` shape change — confirms the optional `reason` field doesn't break any existing consumer that destructures the full shape (e.g. any code doing exhaustive object-shape checks would need updating; expected to be none, since the field is additive-optional). |

---

## 5. Gating note (carried from STATE §10.7)

`/cso` (security-reviewer) review of `apps/daemon/src/rpc/guard.ts` is **required**
before `/ship`, regardless of diff size — per STATE §6's own risk note and §10.7.
The test cases in §3.3 above (TC-T11-4 through TC-T11-10) are the concrete evidence
`/cso` should check were actually run and green, not just present in the diff.
