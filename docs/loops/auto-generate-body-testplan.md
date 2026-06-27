# Auto-generate "Nội dung" (body) via real AI — Test Plan

> Companion to `docs/loops/auto-generate-body-STATE.md` §10 (PLAN). Executed by `/qa`. Every case below
> traces back to an FR/AC/EC number in the STATE doc — do not add cases that test behavior not specified
> there, and do not skip a locked AC/EC without flagging it back to the architect/PM.
>
> Stack: Vitest for unit (packages/core, apps/daemon) + integration (apps/daemon, real fetch against a
> local Ollama if available / a fake HTTP server standing in for Ollama otherwise — see "Ollama
> availability in CI" below) + Playwright (or the project's existing chrome-devtools e2e harness — confirm
> with dev which is wired up) for the apps/web journey.

## 0. Ollama availability in CI / dev machine — test infra note

Real Ollama may not be installed in CI. Tests are split into two tiers:
- **Tier A — fake-provider tests (run everywhere, every CI run).** A minimal Node `http.createServer`
  stand-in bound to an ephemeral localhost port, monkey-patched in as the Ollama base URL via an
  injectable constructor param/env var on `OllamaProvider` (e.g. `new OllamaProvider({ baseUrl })`) —
  NOT a global `fetch` mock, so the real HTTP/JSON/timeout code paths in `OllamaProvider` are genuinely
  exercised end-to-end against a real (if fake) server. This satisfies AC-2's "must reach a real
  endpoint/process" intent at the daemon-unit level without requiring real Ollama.
- **Tier B — real-Ollama tests (skipped/marked `it.skipIf(!ollamaAvailable)` if Ollama isn't reachable
  on 11434 at test-run time).** A small number of true end-to-end smoke tests that hit a genuinely
  running local Ollama, to catch protocol drift the fake server can't (e.g. Ollama's actual JSON
  response shape changing). Document in the PR which CI environment, if any, has real Ollama installed;
  if none does, Tier B only runs in a developer's local `npm test` and must degrade to "skipped," never
  "fails because Ollama isn't installed."

---

## 1. Unit tests — `packages/core` (Vitest)

| ID | Case | Assertion |
|---|---|---|
| TC-C1 | `buildBodyGenerationPrompt` with all 4 fields populated (kind=agent) | Returns `{ system, user }`; `user` string contains the `name`, `description`, and `existingBody` values verbatim (substring match); `system` is non-empty and does not contain literal `undefined`/`null`. |
| TC-C2 | `buildBodyGenerationPrompt` with `kind: "command"` | Prompt text differs meaningfully from the agent-kind prompt (e.g. references "slash command" / "lệnh" framing, not "agent system prompt" framing) — assert the two outputs are not identical strings for otherwise-identical input except `kind`. |
| TC-C3 | `buildBodyGenerationPrompt` with `description: ""` and `existingBody: ""` (EC-1, name-only) | Does not throw; `user` prompt is still well-formed (no dangling "Description: " label with nothing after it that would confuse a model — assert it either omits the empty fields or labels them explicitly as "(none provided)"). |
| TC-C4 | `buildBodyGenerationPrompt` is pure/deterministic | Same input object (deep-equal, called twice) -> identical `{ system, user }` output both times. |
| TC-C5 | `buildBodyGenerationPrompt` does not import anything from `node:*` | Static check: grep the compiled output or source file for `from "node:` / `from "fs"` / `from "net"` — must be zero matches (enforces the "packages/core stays pure" architecture rule for this new file specifically). |
| TC-C6 (regression) | `generateDescription()` (existing, untouched) | Still exists, still exported from `@symbion/core`, still passes its pre-existing test suite unmodified — proves §9 Q6 "leave as dead code, don't delete" was honored at the type/export level, not just informally. |

## 2. Unit tests — `apps/daemon/src/llm/*` (Vitest, Tier A fake-provider unless noted)

| ID | Case | Assertion |
|---|---|---|
| TC-D1 | `OllamaProvider.generate()` happy path against fake server returning a valid completion | Resolves with `{ text: "<the fake server's content>" }`; the actual HTTP request sent to the fake server has the expected model id, prompt content, and JSON content-type header. |
| TC-D2 | `OllamaProvider.generate()` when fake server is not listening at all (port never bound) | Rejects with `LlmError` whose `.code === "provider-not-running"`. |
| TC-D3 | `OllamaProvider.generate()` when fake server delays its response beyond 45s (use a short test-only timeout override, e.g. construct with `timeoutMs: 50` against a deliberately-slow fake server, to keep the test fast) | Rejects with `LlmError` whose `.code === "timeout"`; verify (via a flag set by the fake server) that the underlying request was actually aborted, not silently left dangling. |
| TC-D4 | `OllamaProvider.generate()` when fake server returns HTTP 200 with malformed/non-JSON body | Rejects with `LlmError` whose `.code === "invalid-response"`. |
| TC-D5 | `OllamaProvider.generate()` when fake server returns HTTP 404 (simulating "model not found") | Rejects with an `LlmError` (code per dev's mapping choice per R2/EC-9 — at minimum must not silently resolve with empty/garbage text). |
| TC-D6 | `OllamaProvider.listModels()` | Returns exactly 3 entries; each has a non-empty `id`, `label`, and `tier` is one of `"fast" \| "balanced" \| "best"`, all three tiers represented exactly once. |
| TC-D7 | `RemoteProvider.generate()` with no API key configured (env var unset) | Rejects with `LlmError` whose `.code === "auth"`, and asserts (via a spy/mock on global `fetch`) that **no network call was attempted** — confirms "seam exists but fails closed without a key," not "silently falls back to Ollama" or "silently no-ops." |
| TC-D8 | `RemoteProvider.generate()` with a (fake/dummy) API key env var set, against a fake HTTP server standing in for the remote API | Resolves with `{ text }` on a 200 response; sends the configured key in the expected auth header, never in the URL/query string (defense-in-depth: keys in URLs end up in server logs). |
| TC-D9 | `getProvider("ollama")` / `getProvider("remote")` factory | Returns an object satisfying the `LlmProvider` interface for both ids; an unrecognized id throws synchronously (not silently defaulting to Ollama). |

## 3. Unit/integration tests — `apps/daemon/src/rpc/handlers.ts` `generateBody` (Vitest, against the real `handlers` object, fake-provider injected)

| ID | Case | Assertion |
|---|---|---|
| TC-H1 | `generateBody({ kind:"agent", name, description, existingBody, modelId, providerId:"ollama" })` happy path | Resolves `{ body: "<text>" }`; no `.symbion/store.json` file is touched (assert the project store's `mtime`/content is unchanged before/after the call) — proves the "no disk writes" design claim in §10.3. |
| TC-H2 | `generateBody` does not require/accept a `projectId` field for it to function | Calling without any `projectId` in params still succeeds (confirms the deliberate decoupling from `findProjectPath`/`loadProjectStore` documented in §10.2). |
| TC-H3 | Provider throws `LlmError("timeout", …)` | Handler rejects with `RpcError` whose `.code === "llm-timeout"`. |
| TC-H4 | Provider throws `LlmError("provider-not-running", …)` | Handler rejects with `RpcError` whose `.code === "llm-provider-not-running"`. |
| TC-H5 | Provider throws a non-`LlmError` (unexpected exception) | Handler still rejects with a well-formed `RpcError` (`llm-unknown` or similar) — never lets a raw unhandled exception escape to crash the request (consistent with `server.ts`'s generic 500 catch, but the handler itself should normalize to a `RpcError` per §10.2's snippet). |
| TC-H6 | `providerId: "remote"` end-to-end through the handler with no key configured | Rejects with `RpcError` code `llm-auth` (exercises the full handler->registry->RemoteProvider seam, confirming it's wired even though no UI control reaches it yet — this is the concrete proof point for "the seam exists" per §9). |

## 4. Server/transport tests — `apps/daemon` (existing `server.integration.test.ts` pattern)

| ID | Case | Assertion |
|---|---|---|
| TC-S1 | POST `/rpc` with `method: "generateBody"` and a valid token | Returns 200 with the generated body (using the fake-provider injection point at the server-construction level, or a daemon-level env var that points `OllamaProvider`'s base URL at the test's fake server). |
| TC-S2 | POST `/rpc` with `method: "generateBody"` and **no** `x-symbion-token` header | Returns 401, exactly like every other non-`ping` method today (regression check — confirms `generateBody` did not accidentally get added to any "no-auth" allowlist). |
| TC-S3 | POST `/rpc` with `method: "generateBody"` and a disallowed `Origin` header | Returns 403, same as existing methods (regression check on the DNS-rebinding defense — confirms no special-casing was introduced for this method). |
| TC-S4 | Two back-to-back `generateBody` POSTs from the same client while the first is artificially slow (fake server delay) | Both requests are independently processed by the daemon (the daemon itself does not need a server-side concurrency guard per §10.1 — confirm this is intentional and not a bug: the *client* is solely responsible for not double-firing, per §9's re-entrancy design). This test exists to document/lock that decision, not to assert a daemon-side lock exists. |

## 5. Component/unit tests — `apps/web` (Vitest + React Testing Library, or whatever the existing component test harness is — confirm with dev; if none exists yet for components, these become Playwright-level instead)

| ID | Case | Assertion |
|---|---|---|
| TC-W1 (AC-1 regression) | Render `AgentForm` | No `GenerateDescriptionButton`/sparkle icon appears adjacent to the `description` `<Input>`; a generate affordance (`GenerateBodyButton`) appears adjacent to the "Nội dung" `<textarea>`. |
| TC-W2 (AC-1 regression) | Render `WorkflowForm` | Same assertion as TC-W1 for the command form. |
| TC-W3 | Click `GenerateBodyButton` when Nội dung is empty | No confirm dialog renders; `callRpc("generateBody", …)` is invoked directly (mock the rpc client) with `existingBody: ""`. |
| TC-W4 (EC-2/AC-5) | Type custom text into Nội dung, then click `GenerateBodyButton` | Confirm dialog renders; `callRpc` is **not** yet invoked; original Nội dung text is still present and unchanged in the textarea. |
| TC-W5 (EC-2/AC-5 continued) | From the TC-W4 state, click "Hủy" (cancel) in the confirm dialog | Dialog closes; `callRpc` was never invoked; Nội dung textarea value is unchanged from the original custom text. |
| TC-W6 (EC-2/AC-5 continued) | From the TC-W4 state, click "Thay thế"/confirm | `callRpc("generateBody", …)` is invoked exactly once with `existingBody` equal to the original custom text (proves the confirm-before-call sequencing from §10.5 EC-2, not generate-then-ask). |
| TC-W7 (AC-4/EC-5) | Click generate, then click again before the mocked RPC promise resolves | `callRpc` is invoked exactly once; button has `disabled` attribute for the duration. |
| TC-W8 (EC-5/§9 Q12 cooldown) | Mocked RPC resolves; immediately attempt to click generate again within the cooldown window | Button remains disabled until the cooldown timer elapses (use fake timers to assert the exact transition at t=cooldown-1ms still disabled, t=cooldown+1ms enabled). |
| TC-W9 (AC-6/EC-4) | Mocked RPC rejects with `DaemonRpcError{ code: "llm-provider-not-running" }` | Inline error message rendered matching the EC-4 mapping table; Nội dung textarea value is unchanged from before the click; a `Save`/`Publish` button elsewhere in the page (if present in the test harness) remains enabled/unaffected. |
| TC-W10 (EC-3 retry) | Mocked RPC rejects with `DaemonRpcError{ code: "llm-timeout" }` | Inline "timed out" message + a visible Retry action; clicking Retry calls `callRpc("generateBody", …)` again with the identical params as the original attempt. |
| TC-W11 (EC-8) | Render `GenerateBodyButton` with the artifact store's `daemonConnected` mocked to `false` | Button renders `disabled`, mirroring how Save/Publish already behave (cross-check against the existing Save button's disabled-state test, if one exists, for parity). |
| TC-W12 (AC-3) | Render `ModelPicker` | Exactly 3 selectable options are present; selecting a different option changes the value passed as `modelId` in the next `callRpc` call. |
| TC-W13 (EC-7/§9 Q11, Ollama path) | First-ever render in a fresh `localStorage` (flag unset), `providerId` resolved to `"ollama"` | One-time disclosure dialog appears; its copy does NOT contain "leaves your machine"/"third-party"/equivalent remote-egress language; persistent micro-copy is visible regardless of dialog state. |
| TC-W14 (EC-7, remote path — contract-level only, no UI control reaches this in v1) | Render `GenerateBodyDisclosure` directly with a `providerId="remote"` prop (unit-level, bypassing the fact that no real UI control sets this in v1) | Copy DOES contain explicit "leaves your machine"/third-party-provider language — proves the conditional-copy logic itself is correct and ready for when the provider-switch UI ships, even though no end-to-end path reaches it today. |
| TC-W15 (EC-7 persistence) | Dismiss the one-time dialog, then re-render the component (simulating a page reload) | Dialog does not reappear (localStorage flag persisted); persistent micro-copy still visible. |
| TC-W16 (EC-6 regression) | Generate into Nội dung, then edit `name` field afterward | No new RPC call fires automatically; Nội dung value is unaffected by the `name` edit. |
| TC-W17 (AC-8) | After a successful generate, type additional characters directly into the Nội dung textarea | Edit succeeds exactly as on any normal textarea (no special "generated" state blocks editing; no `wasGenerated` flag exists anywhere in the artifact shape sent to `saveArtifact`). |
| TC-M1 (R1 tripwire — manual model-list sync) | Compare the static model-id list in `apps/web/src/lib/llmModels.ts` against `OllamaProvider.listModels()`'s hardcoded ids (cross-package test, e.g. a small script/test in `apps/daemon` or a root-level script that imports both and diffs) | Fails loudly if the two lists ever drift — the explicit guard against the R1 risk called out in §10.7. |

## 6. End-to-end tests (Playwright / chrome-devtools harness — confirm exact tool with dev before `/qa`)

> Tier B (requires a real local Ollama running with the 3 chosen model tags actually pulled) unless noted "(fake transport)". If Ollama is not available in the `/qa` execution environment, these are the cases to run manually once, documented as such, rather than silently skipped without a note in the QA report.

| ID | Case | Steps | Expected |
|---|---|---|---|
| TC-E1 (AC-1, AC-2 happy path) | Full generate flow on AgentForm | Open Agent Builder -> fill `name`="code-reviewer", `description`="Reviews PRs for bugs" -> Nội dung empty -> select a model in `ModelPicker` -> click generate -> wait | Within ~45s, Nội dung textarea is populated with non-empty generated markdown text relevant to a code-review agent system prompt; button returns to idle/enabled state (post-cooldown). |
| TC-E2 (AC-2 network-level proof) | Repeat TC-E1 with browser devtools/network tab (or Playwright's request interception) open, watching daemon-bound traffic | Capture the outbound `POST http://127.0.0.1:<port>/rpc` body for `generateBody`, AND (if observable, e.g. via daemon-side logging or a network proxy in front of 11434) confirm a *second*, real outbound request from the daemon process to `127.0.0.1:11434`. This is the literal AC-2 acceptance check: "verified by intercepting the actual outbound request and confirming it reaches a real LLM endpoint/process." |
| TC-E3 (FR-1/AC-1 regression, both forms) | Visually inspect AgentForm and WorkflowForm | Confirm sparkle/generate icon is gone from beside `description` on both, present beside Nội dung on both. |
| TC-E4 (AC-5/EC-2 full journey) | Type custom Nội dung text -> click generate -> confirm dialog appears -> click "Hủy" | Original text still present, untouched. Re-click generate -> confirm "Thay thế" -> wait for real completion | Nội dung is replaced with generated text only after the explicit confirm. |
| TC-E5 (AC-6/EC-4, real failure induced) | Stop/kill local Ollama (or point `OLLAMA` env override, if dev added one for e2e, at an unreachable port) -> click generate | Inline error appears within a few seconds (provider-not-running is fast-failing, not a 45s wait); Nội dung unchanged; Save button still clickable and an actual save still succeeds. |
| TC-E6 (AC-4) | Click generate, then immediately attempt to click it again (rapid double-click, real timing not mocked) | Network tab shows exactly one `generateBody` request fired, not two. |
| TC-E7 (EC-8) | Kill the daemon process entirely (or simulate via dev tooling) -> observe `DaemonStatusBadge` turn red -> attempt to click generate | Generate button is disabled, consistent with Save/Publish also being disabled in this state. |
| TC-E8 (EC-7) | Fresh browser profile (clear localStorage) -> open AgentForm -> click generate for the first time | One-time disclosure dialog appears before (or as part of) the first click's flow, with Ollama-appropriate ("local, doesn't leave your machine") copy; persistent micro-copy is visible on the page at all times near the button, independent of the dialog. |
| TC-E9 (cooldown, real timing) | After a successful generate completes, immediately try clicking again | Button stays visibly disabled for the cooldown window (a few seconds) even though no request is in flight; becomes clickable again after. |
| TC-E10 (AC-3) | Open `ModelPicker`, select each of the 3 models in turn across 3 separate generate clicks | All 3 succeed independently (or fail informatively per EC-9 if a tag isn't actually pulled locally) — confirms more than one real model is genuinely reachable, not a single hardcoded id with a cosmetic dropdown. |
| TC-E11 (regression — Save/Publish pipeline untouched) | After a successful AI-generated Nội dung, complete a full Save -> Publish (render/diff/write) cycle | Publish pipeline behaves identically to pre-feature behavior — generated content renders into the `.md` file with the same marker/hash machinery as hand-typed content; no special-casing, no AC-2/AC-8 violation. |

## 7. Security-reviewer handoff checklist (run `/cso` given this touches RPC + a new network egress path)

- [ ] Confirm `RemoteProvider`'s API key is never included in any RPC **response** body under any code path (success or error) — grep the handler/provider error messages for accidental key interpolation.
- [ ] Confirm the key is read from `process.env` only, never written back to `~/.config/symbion/config.json` by any code path.
- [ ] Confirm `generateBody`'s request validation rejects non-string/oversized `name`/`description`/`existingBody` fields gracefully (no daemon crash on malformed/huge input) — add a defensive size cap if none exists elsewhere in the codebase's RPC input handling (check existing precedent in `saveArtifact`/`render` first; match that precedent, don't invent a new pattern).
- [ ] Confirm the 45s timeout truly aborts the underlying socket (`AbortController` wired to `fetch`'s `signal`) rather than just abandoning the promise while the TCP connection (and Ollama's GPU/CPU work) continues in the background — resource-exhaustion concern under repeated timeouts.
- [ ] Confirm `Origin`/`Host` allowlisting (existing DNS-rebinding defense) is unaffected/untouched by this change (TC-S3 covers this functionally; security review should also read the diff directly).
