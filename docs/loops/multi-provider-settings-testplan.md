# multi-provider-settings — Test Plan

Handoff artifact for `/qa`. Each test case is an action + an expected,
observable result. Tiers mirror the convention already established in
`connect-providers-testplan.md`:
- **Tier A** — fake local HTTP server (`node:http`, ephemeral port),
  exercises adapters/`checkApiKeyProviderReachable` over real HTTP without
  hitting real provider APIs or needing real API keys.
- **Tier B** — pure-function unit tests (no fs, no network) — `secrets.ts`'s
  masking, registry descriptor lookup, validation guards.
- **Tier C** — RPC-handler-level integration tests (`apps/daemon/test/`),
  fake-server-over-the-wire per existing house convention
  (`rpc-generateBody.test.ts`/`rpc-checkProviderStatus.test.ts`).
- **Tier D** — manual checklist (no Playwright in this stack), run against a
  live daemon + `npm run dev -w @symbion/web`.

All file/test paths below are proposed locations — dev may adjust file
names as long as coverage is equivalent; tests should be added to
`apps/daemon/test/` per the codebase's existing layout (no test files exist
under `apps/web` today — manual Tier D covers UI behavior).

## 0. Pre-conditions for any QA run

- Real Ollama, OpenAI, Anthropic, and Gemini accounts/keys are NOT required
  for Tier A/B/C (everything is faked or pure-function). Tier D manual
  testing of "real authenticated check succeeds" (M7 below) is OPTIONAL and
  requires the QA runner to have at least one real cloud API key on hand —
  if none is available, mark M7 "not run, no key available" rather than
  skipping silently; M7's NEGATIVE case (invalid key → auth error) does NOT
  require a real valid key and should always be run.
- `npm run build` (root) passes before any manual testing begins.

## 1. Unit tests — `apps/daemon/src/llm/secrets.ts` (Tier B)

File: `apps/daemon/test/llm-secrets.test.ts`

| TC | Action | Expected |
|---|---|---|
| TC-S1 | `loadProvidersConfig()` when `providers.json` does not exist (point `SYMBION_CONFIG_DIR` at a fresh empty temp dir) | Returns `{ schemaVersion: 1, activeProviderId: null, providers: {} }`; does NOT create the file on disk (assert `existsSync` is still false after the call) |
| TC-S2 | `saveProviderKey("openai", "sk-test1234", "gpt-4o-mini")` then `loadProvidersConfig()` | File now exists; loaded config has `providers.openai.apiKey === "sk-test1234"`, `model === "gpt-4o-mini"` |
| TC-S3 | Write malformed JSON (`"{not valid"`) directly to `providers.json`, then `loadProvidersConfig()` | Returns the default empty config (no throw); a warning is logged to stderr (assert via spy) but the process does not crash |
| TC-S4 | Write valid JSON but missing `schemaVersion` field, then `loadProvidersConfig()` | Returns default empty config, no throw |
| TC-S5 | Write valid JSON with `schemaVersion: 999` (future version), then `loadProvidersConfig()` | Returns default empty config, no throw (fails soft, does not attempt to interpret unknown future shape) |
| TC-S6 | `maskKey("sk-abcdef123456")` | Returns a string ending in the literal last 4 chars (`...3456` or equivalent fixed format) and does NOT contain the full raw key substring anywhere in the output |
| TC-S7 | `maskKey("ab")` (shorter than the mask window) | Returns a sensible masked value, never throws, never returns the raw 2-char string unmasked |
| TC-S8 | `setActiveProvider("openai")` when no key is stored for openai | Throws a typed error (not a silent no-op); `loadProvidersConfig()` afterward shows `activeProviderId` unchanged from before the call |
| TC-S9 | `setActiveProvider("ollama")` (no key needed) | Succeeds; `activeProviderId === "ollama"` after |
| TC-S10 | `clearProviderKey("anthropic")` when `anthropic` was the active provider | After: `providers.anthropic` is removed/undefined AND `activeProviderId === null` (NOT silently reset to `"ollama"`) |
| TC-S11 | `clearProviderKey("gemini")` when `gemini` was NOT the active provider (some other provider is active) | After: `providers.gemini` removed; `activeProviderId` UNCHANGED (still whatever it was) |
| TC-S12 | After any `saveProviderKey`/`setActiveProvider` call, stat the file on disk | File mode bits restrict to owner read/write only (`0o600`) — platform-appropriate assertion (skip/adjust on Windows CI if file-mode semantics differ, note explicitly if skipped) |
| TC-S13 | Inspect the daemon's captured stdout/stderr across TC-S2/TC-S9/TC-S10 (any successful save/activate/clear call with a real key value) | The raw API key string (`"sk-test1234"` etc.) never appears in any logged output |

## 2. Unit tests — registry generalization (Tier B)

File: `apps/daemon/test/llm-registry.test.ts` (extend or create)

| TC | Action | Expected |
|---|---|---|
| TC-R1 | `listProviderDescriptors()` | Returns exactly 4 entries, ids `ollama`/`openai`/`anthropic`/`gemini`, `ollama.kind === "local"`, the other 3 `kind === "api-key"` |
| TC-R2 | `getProvider("ollama")` | Returns an `OllamaProvider` instance, `id === "ollama"` (regression — unchanged from before this feature) |
| TC-R3 | `getProvider("openai")` | Returns an instance with `id === "openai"` |
| TC-R4 | `getProvider("anthropic")` | Returns an instance with `id === "anthropic"` (was `"remote"` before this feature — confirm the rename, not a residual `"remote"` value anywhere) |
| TC-R5 | `getProvider("gemini")` | Returns an instance with `id === "gemini"` |
| TC-R6 | Grep `apps/daemon/src` and `apps/web/src` for the literal string `"remote"` as a provider id after the feature is built | Zero remaining references (other than historical comments explicitly explaining the rename, if any are kept) |

## 3. Unit tests — new provider adapters (Tier A, fake HTTP server)

Files: `apps/daemon/test/llm-openaiProvider.test.ts`,
`llm-anthropicProvider.test.ts` (rename/extend the existing
`llm-remoteProvider.test.ts` if one exists), `llm-geminiProvider.test.ts`.
Each file mirrors `llm-ollamaProvider.test.ts`'s existing fake-server
pattern (`listenEphemeral` helper, injectable `baseUrl` constructor option).

For EACH of the 3 new/renamed adapters, run this matrix (12 cases total, 4
per adapter):

| TC suffix | Fake server behavior | Expected `LlmProvider.generate()` outcome |
|---|---|---|
| `-success` | 200 with a valid success-shaped JSON body for that provider's API | Resolves with the expected text extracted from the body |
| `-auth` | 401 (or 403) | Throws `LlmError("auth", ...)` |
| `-rate-limit` | 429 | Throws `LlmError("rate-limit", ...)` |
| `-timeout` | Never responds (hangs past the configured timeoutMs) | Throws `LlmError("timeout", ...)`, and the call settles at/near the configured timeout (not significantly later) |

Additionally:

| TC | Action | Expected |
|---|---|---|
| TC-A1 | Construct `AnthropicProvider` (or whichever new adapters read secrets internally) with NO key saved in `providers.json` | `generate()` throws `LlmError("not-configured", ...)` (the NEW error code) WITHOUT attempting any network call (assert the fake server received zero requests) |
| TC-A2 | Each adapter's `listModels()` | Returns a non-empty static array, each entry has `id`/`label`/`tier`, no network call made |

## 4. Unit tests — `checkProviderStatus` widened branching (Tier C, RPC-level)

File: `apps/daemon/test/rpc-checkProviderStatus.test.ts` (extend existing)

| TC | Action | Expected |
|---|---|---|
| TC-H1 | `checkProviderStatus({ providerId: "ollama" })` | Unchanged behavior from the prior loop (regression) — exercises the existing Ollama-specific path, not affected by this feature |
| TC-H2 | `checkProviderStatus({ providerId: "openai" })` with no key saved | Resolves `{ reachable: false, errorCode: "not-configured", kind: "api-key" }`; assert the fake OpenAI-shaped server (if one is wired into the test) received zero requests |
| TC-H3 | `checkProviderStatus({ providerId: "anthropic" })` with a saved key, fake server returns 200 success shape | Resolves `{ reachable: true, kind: "api-key" }` |
| TC-H4 | `checkProviderStatus({ providerId: "gemini" })` with a saved key, fake server returns 401 | Resolves `{ reachable: false, errorCode: "auth", kind: "api-key" }` |
| TC-H5 | `checkProviderStatus({ providerId: "not-a-real-id" })` | Rejects with `RpcError("invalid-params", ...)` before any other logic runs |
| TC-H6 | `checkProviderStatus({ providerId: null })` | Same `invalid-params` rejection (regression of the existing null-guard, now against the widened union) |

## 5. Unit tests — new mutating RPC handlers (Tier C)

Files: `apps/daemon/test/rpc-listProviders.test.ts`,
`rpc-saveProviderKey.test.ts`, `rpc-clearProviderKey.test.ts`,
`rpc-setActiveProvider.test.ts` (or one combined file — dev's call on
file granularity).

| TC | Action | Expected |
|---|---|---|
| TC-P1 | `listProviders({})` on a fresh (no `providers.json`) daemon | Returns 4 descriptors, all `configured: false`, all `active: false`, no `maskedKey` fields present (or present-but-undefined) |
| TC-P2 | `saveProviderKey({ providerId: "openai", apiKey: "sk-abc123xyz999", model: "gpt-4o-mini" })` | Returns descriptors where `openai.configured === true`, `openai.maskedKey` ends in the key's actual last 4 chars but does NOT equal or contain the full raw key string anywhere in the JSON response body |
| TC-P3 | `saveProviderKey({ providerId: "openai", apiKey: "" })` (empty string) | Rejects with `invalid-params`, no file write occurs (`listProviders` immediately after still shows `configured: false`) |
| TC-P4 | `saveProviderKey({ providerId: "openai", apiKey: "x".repeat(100_000) })` (oversized) | Rejects with `invalid-params` |
| TC-P5 | `saveProviderKey({ providerId: "not-a-real-id", apiKey: "abc" })` | Rejects with `invalid-params` |
| TC-P6 | `clearProviderKey({ providerId: "openai" })` after TC-P2's save | Returns descriptors where `openai.configured === false`; a subsequent `generateBody({ providerId: "openai", ... })` call now fails with `llm-not-configured` (or equivalent mapped RpcError code), not a stale-success |
| TC-P7 | `setActiveProvider({ providerId: "openai" })` after a key is saved | Returns descriptors where `openai.active === true` and every other provider's `active === false` |
| TC-P8 | `setActiveProvider({ providerId: "anthropic" })` when NO key is saved for anthropic | Rejects with `invalid-params`; `listProviders` immediately after shows `activeProviderId` unchanged |
| TC-P9 | `setActiveProvider({ providerId: "ollama" })` | Succeeds (Ollama needs no key) |
| TC-P10 | Call `saveProviderKey`/`clearProviderKey`/`setActiveProvider` WITHOUT the `x-symbion-token` header | All 3 reject with 401/unauthorized — confirms these new mutating methods are NOT in `READ_ONLY_METHODS` and still require the session token (same auth-gate regression check the prior loop ran for `checkProviderStatus`) |
| TC-P11 | Call `listProviders` WITHOUT the `x-symbion-token` header | Also rejects with 401 (it's a normal authenticated RPC even though it's read-only — confirm `READ_ONLY_METHODS` membership doesn't bypass the token gate, mirrors the prior loop's TC for `checkProviderStatus`) |

## 6. Integration — full round-trip (Tier C)

File: `apps/daemon/test/rpc-providerSettings-roundtrip.test.ts`

| TC | Action | Expected |
|---|---|---|
| TC-I1 | `saveProviderKey("anthropic", validKey)` → `setActiveProvider("anthropic")` → `generateBody({ providerId: "anthropic", ... })` against a fake server returning a success shape | The full chain succeeds end-to-end; `generateBody`'s result contains the expected generated text |
| TC-I2 | Same as TC-I1, but the fake server returns 401 on the `generateBody`'s underlying call | `generateBody` rejects with `RpcError("llm-auth", ...)`; immediately after, `checkProviderStatus({ providerId: "anthropic" })` against the same still-401-returning fake server resolves `{ reachable: false, errorCode: "auth" }` — confirms AC-6 ("status updates to disconnected on next check") |
| TC-I3 | `saveProviderKey` → restart the simulated daemon process (re-instantiate handlers/reload config from the same temp `SYMBION_CONFIG_DIR`, no in-memory state carried over) → `listProviders` | The previously saved key is still present (`configured: true`) — confirms AC-3 ("restarting daemon does not lose a previously entered key") without needing an actual process restart in the test harness |

## 7. Manual checklist (Tier D — live daemon + web, no automation tool)

Pre-req: `npm run build` (root), start daemon
(`node apps/daemon/dist/index.js`, headless via boot-menu), start
`npm run dev -w @symbion/web`.

| ID | Action | Expected |
|---|---|---|
| M1 | Load the web app at `/` | A new nav element (Settings link/icon) is visible and was NOT there before this feature |
| M2 | Click the Settings nav item | Navigates to `/settings`; page loads without console errors |
| M3 | On `/settings`, observe the Providers panel | Exactly 4 cards render: Ollama, OpenAI, Anthropic, Gemini, each with a distinct status indicator |
| M4 | Ollama's card | Shows the SAME guide-only setup copy/install-command block as the old `ConnectProviderPanel` (no regression in that content) — copy-to-clipboard button still works |
| M5 | Enter an obviously-fake key (e.g. `sk-fake-000`) into OpenAI's card, click Save | Card immediately shows a masked value (e.g. `sk-...-000` or similar), never the literal fake key string re-displayed in full after save |
| M6 | Open browser devtools Network tab, inspect the `saveProviderKey` RPC response body directly | The raw key string is absent from the response JSON — only a masked field is present (verifies AC-4 independent of the rendered UI) |
| M7 | Click "Kiểm tra kết nối" on OpenAI's card (fake key from M5) | Status flips to "disconnected"/"invalid" within a few seconds (bounded, visible spinner-then-result, not indefinite silence); if a REAL OpenAI key is available, repeat with a real key and confirm it flips to "connected" instead |
| M8 | Click "Xoá key" (clear) on OpenAI's card | Card reverts to "not configured" state; input field is empty again |
| M9 | Save a (fake or real) key for Anthropic, then click its "Đặt làm mặc định"/active radio | Anthropic's card shows "Đang hoạt động"; OpenAI/Gemini/Ollama no longer show active (if any was previously) |
| M10 | Reload the whole web page (hard refresh) | Anthropic is STILL shown as active, and any previously-saved (fake) key is STILL shown as configured/masked — confirms persistence across a web reload (daemon was not restarted, but this is still a meaningful persistence check) |
| M11 | Restart the daemon process entirely (kill + relaunch `node apps/daemon/dist/index.js`), reload the web app | Anthropic is still active, OpenAI's key (if not cleared in M8) is still configured — confirms AC-3 against a REAL daemon restart, not just a simulated one |
| M12 | Open the Agent Builder, create/edit an agent, observe the model picker + Generate Body button | They now resolve to "Anthropic" implicitly (not hardcoded "Ollama") — e.g. the model dropdown shows Anthropic's model list, not Ollama's |
| M13 | Click "✨ Tạo nội dung" with Anthropic active and a deliberately-wrong key saved | Inline error banner appears in the builder form (not a crash, not a silent no-op); message is provider-appropriate (not the old Ollama-specific wording verbatim if it doesn't apply) |
| M14 | After M13's failed generate, navigate to `/settings`, click "Kiểm tra kết nối" on Anthropic's card | Status now shows disconnected/invalid (confirms AC-6's "updates to disconnected on next check") |
| M15 | Clear Anthropic's key while it is the active provider (per M9), reload `/settings` | `activeProviderId` is now none/unset — NOT silently reverted to Ollama; some explicit "no provider selected" indication is shown |
| M16 | With no provider active (continuing from M15), go to the builder and click "✨ Tạo nội dung" | A clear, non-crashing message indicates no AI provider is configured/active, with a way to get to Settings — NOT a confusing generic error |
| M17 | With Ollama NOT running on this machine, set Ollama as the active provider, click "✨ Tạo nội dung" | Existing Ollama-not-running message/flow appears, unchanged from the prior `connect-providers` feature (regression check) |
| M18 | Delete (or hand-corrupt with invalid JSON) `~/.config/symbion/providers.json` directly on disk while the daemon is stopped, then restart the daemon and load `/settings` | Page loads cleanly showing all 4 providers as "not configured" — no crash, no error dialog, no daemon startup failure (confirms the fail-soft contract from a REAL corrupted file, not just the unit-test simulation) |
| M19 | Open `/settings` in two separate browser tabs; save a new key for Gemini in tab A; without reloading, check tab B | Tab B does NOT automatically reflect the new key (no shared cache/push) — reloading tab B then shows it. Confirms the documented no-shared-cache trade-off, not a bug |
| M20 | Confirm no "Test All" button exists anywhere on `/settings` | Absent — confirms the explicit out-of-scope decision was respected |
| M21 | `npm run build` (root) | Passes, no type errors |
| M22 | `npm run test` (root) | All existing + new tests pass, no regressions in `packages/core`'s 76 tests or the existing `connect-providers` daemon tests |
| M23 | `grep -rn "fs\.\|net\.\|node:fs\|node:net\|node:http" packages/core/src` | Zero matches (confirms AC-9: `packages/core` has zero new fs/net imports) |

## 8. QA verdict template

Record, per the prior loop's style:
- Build/test pass/fail summary with exact counts.
- Per-AC-1-through-10 pass/fail with method (live RPC exercise vs. code
  reading vs. manual click-test).
- Any deviation from this plan's literal steps (e.g. a TC was infeasible to
  automate and was downgraded to manual) — flag explicitly, same as the
  prior loop's BUILD/QA sections did, do not silently skip.
