# ollama-dynamic-models — TEST PLAN

Companion to `docs/loops/ollama-dynamic-models-STATE.md` (phase PLAN, §6-§9).
Maps every STATE §4 acceptance criterion + every §8 edge case to a concrete,
verifiable test. Tier convention follows the existing codebase precedent
(see `apps/daemon/test/llm-ollamaProvider.test.ts`,
`apps/daemon/test/llm-providerStatus.test.ts`):

- **Tier A** — Vitest + a real `http.createServer` ephemeral fake-Ollama
  server (no mocking `fetch`, no real Ollama install required). This is the
  primary tier for daemon-side behavior; it exercises the real HTTP/JSON
  path end to end against `OllamaProvider`/the RPC handler.
- **Tier B** — Vitest, pure-function unit tests with no network (tier
  inference, response mapping) — fast, no server needed.
- **Tier C** — Playwright/chrome-devtools e2e against the built web app +
  daemon, using the SAME ephemeral fake-server trick (daemon reads
  `SYMBION_OLLAMA_BASE_URL` env override, already an existing test seam —
  see `resolveOllamaBaseUrl()`) to deterministically control what "Ollama"
  returns, without depending on a real local Ollama install in CI.
- **Tier D (manual, real Ollama)** — the literal repro from STATE §0;
  requires the QA runner's own machine with a real Ollama process. Used to
  validate AC1/AC2/AC3 against the real binary, not just the fake server.

---

## Tier A — `OllamaProvider.listModels()` (new file:
`apps/daemon/test/llm-ollamaProvider-listModels.test.ts`, or appended to the
existing `llm-ollamaProvider.test.ts` — dev's call, same fake-server helper
either way)

Reuses the existing `listenEphemeral()` helper pattern already in
`llm-ollamaProvider.test.ts`/`llm-providerStatus.test.ts` verbatim.

| ID | Setup | Assertion | Maps to |
|---|---|---|---|
| TC-LM-A1 | Fake server returns 200 `{"models":[{"name":"llama3.1:8b","model":"llama3.1:8b","size":123}]}` on `GET /api/tags` | `listModels()` resolves `[{id:"llama3.1:8b", label:"llama3.1:8b", tier:"balanced"}]` | AC1, §7(a) |
| TC-LM-A2 | Fake server returns 200 `{"models":[]}` | `listModels()` resolves `[]` (no throw) | AC2, §7(b) |
| TC-LM-A3 | Fake server returns 200 with multiple models, varied tags (`"llama3.2:1b"`, `"llama3.1:8b"`, `"llama3.1:70b"`, `"mistral:latest"`) | resolves 4 entries; tiers `fast`/`balanced`/`best`/`undefined` respectively, in input order | AC1, §6.3 |
| TC-LM-A4 | Nothing listening (`baseUrl: "http://127.0.0.1:1"`) | `listModels()` rejects with `LlmError` `code: "provider-not-running"` | AC4, §7(c) |
| TC-LM-A5 | Fake server never responds (hang) | `listModels()` rejects `code: "provider-not-running"` within ~3000ms budget (assert elapsed `< 4000ms`, mirroring TC-D4's bound style) | AC6, §8 |
| TC-LM-A6 | Fake server returns 200 with a non-JSON body (`"<html>not ollama</html>"`) | rejects `LlmError` `code: "invalid-response"` | §7(d), §8 |
| TC-LM-A7 | Fake server returns 200 with valid JSON missing the `models` key (`{"foo":"bar"}`) | rejects `code: "invalid-response"` | §7(d), §8 |
| TC-LM-A8 | Fake server returns 200 with `models` as a non-array (`{"models":"oops"}`) | rejects `code: "invalid-response"` | §8 |
| TC-LM-A9 | Fake server returns HTTP 500 | rejects `code: "invalid-response"` | §8 |
| TC-LM-A10 | Fake server returns 200 with one entry missing both `name` and `model` (`{"models":[{"size":1}]}`) mixed with one valid entry | resolves with only the valid entry mapped (length 1), no throw | §8 (unusable-entry row) |
| TC-LM-A11 | `SYMBION_OLLAMA_BASE_URL` env set to a non-loopback host (e.g. `"http://evil.example.com"`) before constructing `OllamaProvider` | `listModels()` rejects `code: "provider-not-running"` (same as `resolveOllamaBaseUrl()`'s existing guard — confirm it fires for `listModels()` too, not just `generate()`) | §6.2 SSRF-guard reuse, §9.6 |

## Tier B — pure-function unit tests (new file:
`apps/daemon/test/llm-ollamaTierInference.test.ts`, or co-located with
TC-LM tests)

| ID | Input tag | Expected tier |
|---|---|---|
| TC-TIER-B1 | `"llama3.2:1b"` | `"fast"` |
| TC-TIER-B2 | `"llama3.1:8b"` | `"balanced"` |
| TC-TIER-B3 | `"llama3.1:70b"` | `"best"` |
| TC-TIER-B4 | `"llama3.1:405b"` | `"best"` |
| TC-TIER-B5 | `"qwen2.5:0.5b"` | `"fast"` (0.5 ≤ 3) |
| TC-TIER-B6 | `"mistral:latest"` | `undefined` (no parameter hint) |
| TC-TIER-B7 | `"my-custom-finetune"` | `undefined` |
| TC-TIER-B8 | `"deepseek-r1:13b"` | `"balanced"` (boundary: exactly 13) |
| TC-TIER-B9 | `"model:14b"` | `"best"` (boundary: just above 13) |
| TC-TIER-B10 | `"model:3b"` | `"fast"` (boundary: exactly 3) |
| TC-TIER-B11 | `"model:3.1b"` | `"balanced"` (boundary: just above 3) |

## Tier A (cont.) — other 3 providers, regression-only (extend existing
`llm-openaiProvider.test.ts`/`llm-anthropicProvider.test.ts`/
`llm-geminiProvider.test.ts`, or a single new shared test)

| ID | Assertion | Maps to |
|---|---|---|
| TC-LM-A12 | `OpenAiProvider.listModels()` (now async) resolves the SAME 3-entry array, byte-for-byte, as before this change (snapshot or explicit array-equality against the hardcoded constant) | AC5 |
| TC-LM-A13 | Same for `AnthropicProvider.listModels()` | AC5 |
| TC-LM-A14 | Same for `GeminiProvider.listModels()` | AC5 |
| TC-LM-A15 | `checkApiKeyProviderReachable()` (in `providerStatus.ts`) still resolves correctly after its `listModels()` call gains an `await` — re-run the existing `llm-providerStatus.test.ts` API-key-provider cases unmodified; all must still pass | AC5, §6.1 regression guard |

## Tier A (cont.) — RPC handler (new file:
`apps/daemon/test/rpc-listModels.test.ts`, or extend an existing
`rpc-*` test file)

Use the daemon's `SYMBION_OLLAMA_BASE_URL` env-override seam pointed at an
ephemeral fake server (same pattern `rpc-checkProviderStatus.test.ts`
presumably already uses — confirm and reuse, don't reinvent).

| ID | Setup | Assertion | Maps to |
|---|---|---|---|
| TC-RPC-A1 | Fake server: populated `/api/tags` | `listModels({providerId:"ollama"})` resolves `{models: [...len>0], outcome:"ok"}` | AC1 |
| TC-RPC-A2 | Fake server: `{"models":[]}` | resolves `{models:[], outcome:"empty"}`, no `errorMessage` | AC2 |
| TC-RPC-A3 | Fake server: malformed JSON | resolves `{models:[], outcome:"fetch-failed", errorMessage: <non-empty string>}` — does NOT throw | §7(d) |
| TC-RPC-A4 | Nothing listening | the call **throws/rejects** `RpcError` (or its wire equivalent) with `code:"llm-provider-not-running"` | AC4 |
| TC-RPC-A5 | `providerId: "openai"` (with any state, no key needed since `listModels` doesn't call `generate`) | resolves `{models: [...3 static entries], outcome:"ok"}` | AC5 |
| TC-RPC-A6 | `providerId: "not-a-real-id"` (invalid) | throws `RpcError` `code:"invalid-params"` (existing `assertValidProviderId` guard, confirm untouched) | regression |
| TC-RPC-A7 | Slow/hanging fake server | call resolves/rejects within a bounded time (assert elapsed `< 4000ms`) | AC6 |

## Tier C — Playwright/chrome-devtools e2e (extend existing web e2e
journey, or new spec `model-picker-ollama.spec.ts`)

Daemon launched in test mode with `SYMBION_OLLAMA_BASE_URL` pointed at a
per-test ephemeral fake server (mirrors the Tier A env-override seam, now
exercised through the real web UI).

| ID | Setup | Steps | Assertion | Maps to |
|---|---|---|---|---|
| TC-E2E-1 | Fake server returns 2+ real-shaped models | Open builder, set provider to Ollama, open `ModelPicker` | Dropdown shows exactly the fake server's model tags, no stale `llama3.2:1b`/`llama3.1:8b`/`llama3.1:70b` placeholders unless the fake server actually returned them | AC1 |
| TC-E2E-2 | Fake server returns `{"models":[]}` | Same | Empty-state shown: visible text naming "no models," a `ollama pull <tag>` command block, and a working Copy button (assert clipboard content via Playwright's clipboard permission grant, or assert the visible "Đã copy" feedback per `CopyRunCommandDialog`'s existing pattern) — NOT an empty/disabled dropdown, NOT the old generic error text | AC2 |
| TC-E2E-3 | Fake server returns 1 model | Select it, click Generate (with fake server also answering `/api/generate` with a canned response) | Generate succeeds, content is applied — no 404 | AC3 |
| TC-E2E-4 | No fake server listening (or daemon's Ollama base URL points at a closed port) | Open `ModelPicker` | Existing unreachable-style message shown (same as pre-change behavior) | AC4 |
| TC-E2E-5 | Fake server returns malformed JSON | Open `ModelPicker` | A distinct "could not fetch model list" message shown, visually/textually different from TC-E2E-2's empty-state and TC-E2E-4's unreachable message | §7(d) |
| TC-E2E-6 | Switch active provider to OpenAI (key configured) | Open `ModelPicker` | Static 3-entry OpenAI dropdown, unchanged from pre-change screenshot/baseline | AC5 |

## Tier D — manual, real local Ollama (QA runner's machine)

| ID | Pre-condition | Steps | Expected |
|---|---|---|---|
| TC-MANUAL-1 | At least 1 model pulled (`ollama list` shows ≥1) | Open Symbion, Ollama as active provider, open `ModelPicker` on an agent/command body field | Dropdown shows exactly the pulled model(s), matching `ollama list`'s output | AC1 |
| TC-MANUAL-2 | Zero models pulled (`ollama list` empty) — the original reported bug | Same | Empty-state with `ollama pull <tag>` suggestion shown; Copy button copies a runnable command | AC2 |
| TC-MANUAL-3 | Continuing from TC-MANUAL-2: run the suggested `ollama pull` command in a terminal, then remount `ModelPicker` (navigate away/back, or switch kind and back) | Re-open `ModelPicker` | The newly-pulled model now appears in the dropdown (validates §6.7's "stale until remount" is acceptable and that a remount does pick up the new state) | AC1, §6.7 |
| TC-MANUAL-4 | Model selected from TC-MANUAL-1/3's live list | Click Generate | Succeeds, no 404 — the exact regression check for the original bug report | AC3 |
| TC-MANUAL-5 | Stop the local Ollama process entirely | Open `ModelPicker` | Existing unreachable message, unchanged from pre-feature behavior | AC4 |

## Build/regression gate

| ID | Command | Expected | Maps to |
|---|---|---|---|
| TC-BUILD-1 | `npm run build` (root) | succeeds, no TypeScript errors across `packages/core`, `apps/daemon`, `apps/web`, `packages/rpc-types` | AC8 |
| TC-BUILD-2 | `npm run test` (root, all workspaces) | all existing + new tests pass, zero regressions in `llm-openaiProvider.test.ts`/`llm-anthropicProvider.test.ts`/`llm-geminiProvider.test.ts`/`llm-providerStatus.test.ts`/`rpc-generateBody.test.ts`/`rpc-checkProviderStatus.test.ts` | AC5, AC8 |
| TC-BUILD-3 | `grep -rn "require(['\"]\(fs\|net\|http\)['\"]" packages/core/src` (or equivalent import-grep) | zero matches | AC7 |
| TC-BUILD-4 | `grep -n "OLLAMA_MODELS" -r apps/daemon/src` | zero matches (old hardcoded constant fully removed, not left as dead code/fallback) | §6.2 |

## Coverage cross-check against STATE §4 acceptance criteria

| AC | Covered by |
|---|---|
| AC1 (real models shown) | TC-LM-A1/A3, TC-RPC-A1, TC-E2E-1, TC-MANUAL-1/3 |
| AC2 (zero models → actionable empty-state) | TC-LM-A2, TC-RPC-A2, TC-E2E-2, TC-MANUAL-2 |
| AC3 (Generate succeeds on dynamic selection) | TC-E2E-3, TC-MANUAL-4 |
| AC4 (unreachable unchanged) | TC-LM-A4/A5, TC-RPC-A4, TC-E2E-4, TC-MANUAL-5 |
| AC5 (cloud providers unchanged) | TC-LM-A12/A13/A14/A15, TC-RPC-A5, TC-E2E-6 |
| AC6 (bounded timeout) | TC-LM-A5, TC-RPC-A7 |
| AC7 (`packages/core` untouched) | TC-BUILD-3 |
| AC8 (build + test pass) | TC-BUILD-1, TC-BUILD-2 |

New edge cases beyond STATE §4 (malformed JSON, partial-bad-entry, SSRF
env-guard) are covered by TC-LM-A6/A7/A8/A9/A10/A11 and TC-RPC-A3/TC-E2E-5.
