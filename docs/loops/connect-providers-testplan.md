# connect-providers — TEST PLAN

Companion to `connect-providers-STATE.md` §10 (PLAN). Written by the
architect for `dev`/`feature-builder` to implement against and for
`code-reviewer`/QA to use as the acceptance standard. No production code here.

---

## 0. Test tiers (matches the existing `llm-ollamaProvider.test.ts` convention)

- **Tier A — fake HTTP server** (`node:http` `createServer` on an ephemeral
  loopback port), used for `providerStatus.ts` reachability tests. Mirrors
  the exact pattern already in `apps/daemon/test/llm-ollamaProvider.test.ts`
  (`listenEphemeral` helper) — reuse that helper, do not reinvent it.
- **Tier B — pure unit tests, no I/O at all**, used for
  `installInstructions.ts` (OS detection is pure data-in/data-out once
  `process.platform`/`os.release()` are stubbed).
- **Tier C — RPC handler tests**, mocking `providerStatus.ts`'s exported
  function directly (vitest `vi.mock`), matching how `handlers.ts` is
  presumably already tested elsewhere for `generateBody`/`listModels` (verify
  existing `apps/daemon/test/rpc-handlers*.test.ts` pattern before writing
  new ones, to match house style for mocking).
- **Tier D — manual/integration verification** for the web components (no
  Playwright in this codebase's locked stack for this feature — CLAUDE.md
  lists chrome-devtools for web journeys; this is a small enough feature that
  a manual checklist run via chrome-devtools/dev server is proportionate,
  not a new Playwright suite).

---

## 1. Unit tests — `apps/daemon/src/llm/installInstructions.ts` (Tier B)

New file: `apps/daemon/test/llm-installInstructions.test.ts`

Stub `process.platform` via `Object.defineProperty(process, "platform", { value: ... })`
(save/restore in `afterEach`) and `os.release()` via `vi.spyOn(os, "release")`.

| Case | Setup | Expected |
|---|---|---|
| TC-1 | `process.platform = "darwin"` | `detectHostEnvironment()` → `{ kind: "macos", label: "macOS" }`, `confident: true` |
| TC-2 | `process.platform = "win32"` | `{ kind: "windows", label: "Windows" }`, `confident: true` |
| TC-3 | `process.platform = "linux"`, `os.release()` → `"6.6.87.2-microsoft-standard-WSL2"` (the exact string format from THIS session's env) | `{ kind: "wsl", label: "WSL2 (Ubuntu trên Windows)" }`, `confident: true` — this is the EC-3 "must not mishandle this session's own combination" case, test it verbatim |
| TC-4 | `process.platform = "linux"`, `os.release()` → `"5.15.0-91-generic"` (native Ubuntu, no microsoft/wsl substring) | `{ kind: "linux", label: "Linux" }`, `confident: true` |
| TC-5 | `process.platform = "linux"`, `os.release()` → `"4.19.0-MICROSOFT"` (uppercase) | `kind: "wsl"` — confirms case-insensitive match |
| TC-6 | `process.platform = "freebsd"` (or any value outside the 4 known) | `{ kind: "unknown", label: "Không xác định" }`, `confident: false` |
| TC-7 | confident case (any of TC-1..5) | `getOllamaInstallInstructions(env).variants` has length 1, matching the OS's single command |
| TC-8 | unconfident case (TC-6) | `getOllamaInstallInstructions(env).variants` has length 4 (all known OS variants), each with a non-empty `label` and `command` |
| TC-9 | `kind: "wsl"` and `kind: "linux"` | both resolve to the **same** install command string (`curl -fsSL https://ollama.com/install.sh \| sh && ollama serve`) — confirms the design doc's documented choice that WSL and native Linux share a command, only the displayed label differs |
| TC-10 | function never throws | call `detectHostEnvironment()` with every `NodeJS.Platform` value Node's type defs allow (`aix`, `android`, `darwin`, `freebsd`, `haiku`, `linux`, `openbsd`, `sunos`, `win32`, `cygwin`, `netbsd`) — assert no throw, always returns a well-formed `HostEnvironment` |

---

## 2. Unit tests — `apps/daemon/src/llm/providerStatus.ts` (Tier A — fake server)

New file: `apps/daemon/test/llm-providerStatus.test.ts`, reusing
`listenEphemeral` from the existing ollama test file (extract to a small
shared test helper if duplication is undesired — dev's call).

| Case | Setup | Expected |
|---|---|---|
| TC-D1 | Fake server responds `200 "Ollama is running"` on `GET /` | `checkOllamaReachable(baseUrl, 3000)` resolves `true` |
| TC-D2 | Fake server responds `404` on `GET /` (simulates an unexpected but real HTTP responder) | resolves `true` — any HTTP response counts as reachable per §10.3, NOT gated on status code |
| TC-D3 | Nothing listening (`http://127.0.0.1:1`) | resolves `false` (connection refused) |
| TC-D4 | Fake server never responds (hangs) | with `timeoutMs: 50`, resolves `false` within ~50-150ms (bounded — assert wall-clock time, not just the result, to catch a regression to indefinite hang) |
| TC-D5 | Fake server responds, but after closing the connection abruptly mid-response | resolves `false` (treated as unreachable, not thrown unhandled) |

## 2b. Unit tests — `resolveOllamaBaseUrl` extraction (Tier B, regression guard on the SSRF refactor)

Extends `apps/daemon/test/llm-ollamaProvider.test.ts` (same file, since this
is a refactor of existing tested code, not new code) — add/confirm:

| Case | Expected |
|---|---|
| TC-D10 | `resolveOllamaBaseUrl()` called directly returns the exact same value `new OllamaProvider().baseUrl` would have used (test via the constructor's existing observable behavior, e.g. confirm `OllamaProvider` still rejects non-loopback `SYMBION_OLLAMA_BASE_URL` exactly as TC-D7 already verifies) |
| TC-D11 | Existing TC-D7/TC-D8/TC-D9 (loopback guard, accept/reject) still pass unmodified after the extraction — this is the regression guard proving the refactor changed structure, not behavior |

---

## 3. Unit tests — `apps/daemon/src/rpc/handlers.ts` `checkProviderStatus` (Tier C)

New file or extend existing RPC handler test file (match house convention —
check for an existing `rpc-handlers*.test.ts` before creating a new file).
Mock `checkOllamaReachable` and `detectHostEnvironment`/`getOllamaInstallInstructions`
via `vi.mock("../src/llm/providerStatus.js", ...)` and
`vi.mock("../src/llm/installInstructions.js", ...)`.

| Case | Setup | Expected |
|---|---|---|
| TC-H1 | `providerId: "ollama"`, mocked `checkOllamaReachable` resolves `true` | handler resolves `{ reachable: true, checkedBaseUrl, install }` matching the mocked install instructions |
| TC-H2 | mocked `checkOllamaReachable` resolves `false` | handler resolves `{ reachable: false, ... }` — NOT a thrown `RpcError`; unreachable is a valid/expected steady state, not a server error |
| TC-H3 | `params.providerId` is `"remote"` (or any non-"ollama" string, simulating a hand-crafted request bypassing the TS contract) | throws `RpcError("invalid-params", ...)` — confirms the runtime guard mirrors `assertValidProviderId`'s defense-in-depth pattern for this narrower contract |
| TC-H4 | `params.providerId` is `undefined`/`123`/`null` (malformed JSON-off-the-wire cases) | throws `RpcError("invalid-params", ...)`, never reaches `checkOllamaReachable` |
| TC-H5 | `checkOllamaReachable` itself throws an unexpected error (defensive — should not happen per its own contract, but verify handler doesn't leak a raw 500) | handler either catches and maps to a clean error, or the test documents that `checkOllamaReachable`'s contract guarantees it never throws (resolves `false` instead) — pick one and assert it explicitly, don't leave it undefined behavior |
| TC-H6 | happy path | response shape has all 3 top-level fields (`reachable`, `checkedBaseUrl`, `install`) — schema/shape assertion, catches accidental field drops |

---

## 4. Manual / integration verification — web components (Tier D)

Run against the dev server (`npm run dev` equivalent) with a real or stopped
local Ollama, walked manually (chrome-devtools) since this is presentation +
small state machine, not logic-heavy enough to justify new Playwright infra
for this loop.

| # | Scenario | Steps | Expected |
|---|---|---|---|
| M1 | First mount, Ollama not running | Open Agent/Workflow builder with Ollama stopped | Pill briefly shows "Đang kiểm tra…" then settles to "Chưa kết nối" (amber/gray dot); no console errors |
| M2 | First mount, Ollama running | Start Ollama, reload builder | Pill settles to "Đã kết nối" (green dot) |
| M3 | Click pill while disconnected | Click the pill from M1's state | `ConnectProviderPanel` opens, names "Ollama", shows plain-language explainer, shows ONE OS-specific command block (on this dev machine — confirm command matches actual host OS) |
| M4 | Recheck after starting Ollama | From M3's open panel, start Ollama in a terminal, click "Kiểm tra lại kết nối" | Button shows brief spinner/busy state, then panel flips to "Đã kết nối" copy; underlying pill in the row also updates without closing the panel |
| M5 | Recheck while still down | From a disconnected panel, click recheck without starting Ollama | Button shows busy state then returns to disconnected — no error toast, no hang beyond ~3s |
| M6 | Dismiss panel | Click "Đóng", press `Esc`, click outside | All three close the panel; reopening does NOT auto-refire a check (pill shows last-known status immediately, no "Đang kiểm tra…" flash) |
| M7 | Daemon down entirely | Kill the daemon process, reload builder | `ProviderStatusPill` does not render at all (suppressed); existing "Daemon mất kết nối" / disabled Generate button affordance shows instead — confirms EC-7/AC-4, the two states are never conflated |
| M8 | Daemon dies while panel is open | With panel open and showing Ollama status, kill the daemon | Panel shows the "⚠ Mất kết nối tới Symbion daemon — không thể kiểm tra Ollama lúc này" note per design doc interaction notes, distinct from the Ollama-down message |
| M9 | Reactive entry point (S3) | With Ollama stopped, click "✨ Tạo nội dung" directly (skip the pill) | Existing inline error appears, PLUS new `[ Cách kết nối Ollama ]` link; clicking it opens the same `ConnectProviderPanel` as M3 |
| M10 | Remote provider untouched | Switch the form to `providerId: "remote"` (if a control exists) with no API key set, trigger Generate | Existing `auth` error message shows exactly as before — no pill, no new CTA line, confirming locked decision 4 boundary holds |
| M11 | Copy-command button | In an open panel, click the copy icon next to the command block | Command copied to clipboard (paste into a terminal to confirm exact text, no extra whitespace/newline mangling); icon swaps to a checkmark briefly |
| M12 | Non-blocking (EC-6) | With the panel open, interact with unrelated form fields (e.g. type in the Name field) behind/around it | No interaction is blocked; closing the panel never disables any other control |
| M13 | WSL host (this dev machine) | Run M3 specifically on this WSL2 environment | The shown command is the WSL/Linux curl command, and the "phát hiện:" label explicitly says "WSL2 (Ubuntu trên Windows)" — not a generic/wrong OS label — direct verification of EC-3's named risk |

---

## 5. Out of scope for this test plan (do not write tests for these)

- Model-pulled-vs-missing states (`/api/tags`) — not implemented (locked
  decision 5), so no tests for it either.
- Daemon-spawned install/pull command execution — not implemented (locked
  decision 1), no tests.
- Remote provider guided setup screen — not implemented (locked decision 4),
  no tests beyond M10's negative-confirmation case above.
- Polling/interval-based status refresh — not implemented (locked decision
  3); do not add a test asserting periodic refetch, as that would test for a
  behavior this design explicitly does not have.
