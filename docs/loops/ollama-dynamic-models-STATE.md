# ollama-dynamic-models — STATE

**Phase: DONE — shipped (manual /qa explicitly skipped by user request, see §16)**

## 0. Origin

Follow-up to `/investigate`'s "Generate Body 404 loop" finding
(`docs/learnings.md`): the user's local Ollama has zero models pulled.
Symbion's `ModelPicker` only ever offers 3 hardcoded tags
(`llama3.2:1b`/`llama3.1:8b`/`llama3.1:70b`) for Ollama — **all 3** 404
because none are pulled on this machine. The user asked directly: "UI only
lets you pick 3 Ollama model options, but no matter which one you pick it's
the same 404 — how do we actually solve this?"

This explicitly **reopens** a decision locked across 3 prior loops:
- `auto-generate-body-STATE.md` §9: "No dynamic model-list fetch."
- `connect-providers-STATE.md` §"out of scope": "Auto-fetching the live
  model list from Ollama's `/api/tags`... is currently static... out of
  scope."
- `multi-provider-settings-STATE.md` §2 out-of-scope: "Per-model
  discovery/listing from cloud providers... v1 uses a static, hardcoded
  model list per provider."

The user was asked directly (not guessed) whether to reopen this, given the
size of the change, and explicitly chose **"fetch real model list from
Ollama"** over the two more conservative alternatives (keep hardcoded +
warn, or just improve the error message — which was already shipped as a
smaller, separate fix per the immediately-prior `/investigate` turn).

## 1. Problem (user story)

> As a Symbion user with Ollama installed but with a different set of
> models pulled than Symbion's 3 hardcoded placeholder tags (or none pulled
> at all), I want the model picker to show models that actually exist on my
> machine, so that clicking Generate doesn't always 404 regardless of which
> option I pick.

## 2. Scope

### In scope
- **Ollama only.** This reopens the lock specifically for Ollama, NOT for
  the 3 cloud providers (OpenAI/Anthropic/Gemini) added in
  `multi-provider-settings`. Rationale: Ollama's available models are a
  genuine per-machine, per-install fact (what the user happened to `ollama
  pull`) — this is exactly the kind of "discovery, not vendor catalog"
  fetch the prior locks' own R1 risk-note anticipated reopening eventually.
  Cloud providers' model catalogs are vendor-fixed and don't vary by
  install, so the "static hardcoded list" decision for OpenAI/Anthropic/
  Gemini stands, unchanged, not reopened here.
- `listModels({ providerId: "ollama" })`'s daemon-side implementation
  changes from "synchronously return a hardcoded constant, zero network
  calls" to "query Ollama's `GET /api/tags` (the existing reachability
  pattern's sibling endpoint, same loopback-guarded `resolveOllamaBaseUrl`)
  and map the response into `LlmModelOption[]`." This is now a genuinely
  async, network-touching RPC for the Ollama case (cloud providers'
  `listModels` stays synchronous/static, unchanged).
- **Empty-list handling**: if Ollama is reachable but `/api/tags` returns
  zero models (this user's exact case), `ModelPicker`/`GenerateBodyButton`
  must show a clear, actionable empty-state — NOT an empty dropdown, NOT a
  generic error. Exact copy/UX is the architect's/designer's call, but the
  state must name the fix ("chưa có model nào được tải — chạy `ollama pull
  <tên model>`" or similular, ideally with a copy-to-clipboard affordance
  consistent with the existing install-instructions pattern in
  `installInstructions.ts`/`ConnectProviderPanel`-derived `ProvidersPanel`).
- **Ollama unreachable** (daemon can't connect at all) keeps its existing,
  unchanged `provider-not-running` error path — this feature does not touch
  that case, only the "reachable but model list differs from the old
  hardcoded 3" and "reachable but empty" cases.
- Architect should decide: does `listModels` for ollama need a timeout/
  AbortController budget (yes, almost certainly — reuse the existing 3000ms
  convention from `checkOllamaReachable`, since this is the same kind of
  "is anything there" probe, not a generate() call)? Does the result need
  any caching/memoization within a single web-session, or is "one call per
  `ModelPicker` mount" (matching the existing `useActiveProvider` precedent)
  sufficient?

### Out of scope (explicitly)
- Cloud providers' (`openai`/`anthropic`/`gemini`) `listModels` — stays
  static/hardcoded, this lock is not reopened for them.
- Auto-pulling a model on the user's behalf (`ollama pull` executed by the
  daemon) — this is the same "daemon spawning install/pull commands" trust
  boundary explicitly deferred in `connect-providers-STATE.md`'s out-of-scope
  list; still deferred here, not reopened by this loop. The fix is "show the
  user the command to run themselves," not "run it for them."
- Per-model metadata beyond what `/api/tags` already returns cheaply (no
  fetching per-model capability/context-window details, etc.) — `id`/
  `label`/`tier` derived from what `/api/tags` gives for free, nothing
  requiring an extra round-trip per model.
- Changing `LlmProvider`'s interface shape beyond what's needed for Ollama's
  `listModels()` to become genuinely async (if it currently isn't already —
  architect to confirm the current interface signature and whether `Promise`
  needs adding, and the blast radius of that on the other 3 providers' synchronous
  implementations, which should NOT be forced to become async just because
  Ollama now needs to be).

## 3. Constraints carried over from prior locked decisions (still binding)
- No daemon-spawned install/pull processes (`connect-providers` lock,
  unchanged).
- `packages/core` stays pure — this is 100% a daemon+web change.
- `listModels` for Ollama must use the SAME loopback-guarded
  `resolveOllamaBaseUrl()` as the existing reachability check — one
  implementation of the SSRF guard, not a second one (per the established
  `connect-providers` precedent and the `auto-generate-body-STATE.md` §13
  SSRF finding's lesson).
- Never silently fail — if `/api/tags` itself errors (network/timeout/bad
  JSON), `listModels` must surface a clear error, not an empty array
  indistinguishable from "genuinely zero models pulled."

## 4. Acceptance criteria (for Checker)
1. With at least one model pulled on a real local Ollama, `ModelPicker`
   shows that model (and only models actually present — no stale hardcoded
   options that aren't pulled).
2. With zero models pulled (this user's exact reported case), `ModelPicker`/
   the Generate button area shows a clear, actionable "no models pulled yet"
   state with a runnable `ollama pull <tag>` suggestion — not an empty
   dropdown, not the old generic 404 message.
3. Clicking Generate with a model selected from the now-dynamic list
   succeeds against a real pulled model (no regression of the happy path).
4. Ollama unreachable (daemon down) still shows the existing, unchanged
   `provider-not-running` message — this case is not regressed by the
   listModels change.
5. OpenAI/Anthropic/Gemini's `listModels` behavior is byte-for-byte
   unchanged (still static, still synchronous, still zero network calls) —
   this reopening is Ollama-only.
6. `listModels({ providerId: "ollama" })` is bounded by a short timeout
   (does not hang indefinitely if Ollama is slow/half-responsive).
7. `packages/core` has zero new fs/net imports.
8. `npm run build` and `npm run test` pass with no regressions.

## 5. Next step

Scope is locked (Ollama-only dynamic fetch, no auto-pull, clear empty-state
required). Proceed to `/plan` — architect designs the exact RPC/interface
change (sync→async boundary for `listModels`, `/api/tags` response mapping,
timeout budget, empty-state data shape) and writes the test plan.

---

## 6. PLAN — Architecture

### 6.1 Decision: `listModels()` interface — async for ALL 4 providers, one signature

`LlmProvider.listModels()` changes from `LlmModelOption[]` to
`Promise<LlmModelOption[]>` **for all 4 providers**, not just Ollama.

**Reasoning:**
- The alternative (keep Ollama's `listModels()` synchronous-looking but
  special-case it, or give it a second method name like
  `listModelsAsync()`) creates a permanent split in the `LlmProvider`
  interface that every future caller (`handlers.ts`, `providerStatus.ts`,
  any future adapter) has to remember and branch on. That is exactly the
  kind of "inconsistent interface" the prior locks warned about, and it is
  strictly worse than the one-line mechanical cost below.
- The mechanical cost of making the 3 static providers async is trivial and
  bounded: `listModels(): LlmModelOption[] { return X; }` becomes
  `async listModels(): Promise<LlmModelOption[]> { return X; }` (or even
  `listModels(): Promise<LlmModelOption[]> { return Promise.resolve(X); }` —
  dev's call, both are one-line diffs). No behavior change, no new failure
  mode — a `Promise.resolve()`-wrapped static array still resolves
  synchronously on the same microtask tick; callers that already `await`
  (every caller does, see below) see no observable difference.
- Every existing call site of `listModels()` is already inside an `async`
  function or can trivially become one:
  - `handlers.ts`'s `listModels` RPC handler — currently a sync function;
    becomes `async listModels(...): Promise<contract.ListModelsResult>` and
    `await`s the provider call. The RPC transport layer (`server.ts`)
    already uniformly awaits all handler results (it has to, since
    `generateBody`/`checkProviderStatus` are already async) — confirmed by
    reading `server.ts`'s dispatch code path, no transport change needed.
  - `providerStatus.ts`'s `checkApiKeyProviderReachable` — currently calls
    `provider.listModels()` synchronously to get `models[0]?.id`. This
    becomes `await provider.listModels()`. This function is already
    `async` (it awaits `provider.generate()` two lines later), so this is a
    zero-cost, zero-risk change — just add `await`.
- This keeps **one** `LlmProvider` interface shape, one mental model
  ("listModels is always awaitable, always may fail, always may be slow for
  ollama specifically"), and zero special-casing in any caller based on
  `provider.id === "ollama"`.

**Files affected by this signature change:**
- `apps/daemon/src/llm/types.ts` — `listModels(): LlmModelOption[]` →
  `listModels(): Promise<LlmModelOption[]>`.
- `apps/daemon/src/llm/openaiProvider.ts`,
  `apps/daemon/src/llm/anthropicProvider.ts`,
  `apps/daemon/src/llm/geminiProvider.ts` — mechanical: `listModels()` body
  unchanged, return type/keyword becomes `async listModels(): Promise<LlmModelOption[]>`.
  **Behavior is byte-for-byte unchanged** (same static array, same order,
  same content) — satisfies AC5.
- `apps/daemon/src/llm/ollamaProvider.ts` — real change, see §6.2.
- `apps/daemon/src/llm/providerStatus.ts` — `checkApiKeyProviderReachable`:
  `const models = provider.listModels();` → `const models = await provider.listModels();`.
- `apps/daemon/src/rpc/handlers.ts` — `listModels` handler becomes `async`
  and `await`s; also gains the new error-mapping for Ollama's new failure
  modes (see §6.4).

### 6.2 `OllamaProvider.listModels()` — real implementation

New module-level pure function (co-located in `ollamaProvider.ts`, no new
file needed — it's a sibling of `generate()`, same class, same SSRF-guard
dependency):

```ts
// apps/daemon/src/llm/ollamaProvider.ts

interface OllamaTagsResponseModel {
  name?: string;       // e.g. "llama3.1:8b"
  model?: string;      // Ollama duplicates `name` here in real responses; tolerate either
  size?: number;
  [key: string]: unknown;
}
interface OllamaTagsResponse {
  models?: OllamaTagsResponseModel[];
  [key: string]: unknown;
}

const OLLAMA_LIST_MODELS_TIMEOUT_MS = 3000; // same convention as checkOllamaReachable

async listModels(): Promise<LlmModelOption[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_LIST_MODELS_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
    } catch {
      // connection-refused, DNS failure, or our own abort — all collapse to the SAME
      // existing "provider-not-running" code AC4 requires be unchanged/unregressed.
      // (Abort-vs-refused is not distinguished here because BOTH outcomes mean
      // "ModelPicker cannot get a model list from Ollama right now," and AC4 only
      // requires "unreachable" to look like the existing path — it does not require
      // a distinct "listModels specifically timed out" UI state.)
      throw new LlmError(
        "provider-not-running",
        "Không thể kết nối tới Ollama — đảm bảo Ollama đang chạy trên máy."
      );
    }
    if (!res.ok) {
      throw new LlmError("invalid-response", `Ollama trả về lỗi HTTP ${res.status} khi lấy danh sách mô hình.`);
    }
    let json: OllamaTagsResponse;
    try {
      json = (await res.json()) as OllamaTagsResponse;
    } catch {
      throw new LlmError("invalid-response", "Phản hồi không hợp lệ từ Ollama (không phải JSON) khi lấy danh sách mô hình.");
    }
    if (!Array.isArray(json.models)) {
      // malformed-but-200 case: object present, but `models` key missing/wrong type.
      // Treated as invalid-response, NOT as "zero models" — those are different facts
      // (genuinely-zero is a valid, well-formed `{ "models": [] }`).
      throw new LlmError("invalid-response", "Phản hồi không hợp lệ từ Ollama (thiếu trường models) khi lấy danh sách mô hình.");
    }
    return json.models
      .map((m) => m.name ?? m.model)
      .filter((name): name is string => typeof name === "string" && name.length > 0)
      .map(ollamaTagToModelOption);
  } finally {
    clearTimeout(timer);
  }
}
```

`OLLAMA_MODELS` (the old hardcoded 3-entry constant) is **deleted** —
no fallback to it on any failure path (per STATE §3's "never silently fail
... must surface a clear error, not an empty array indistinguishable from
genuinely zero").

### 6.3 Tier mapping heuristic: `ollamaTagToModelOption`

Decision: **infer tier from a parameter-count hint in the tag name** when
one is confidently parseable (e.g. `1b`, `8b`, `70b`, `405b`); otherwise
**omit tier** rather than guessing. This requires widening `LlmModelOption.tier`
to optional:

```ts
// apps/daemon/src/llm/types.ts
export interface LlmModelOption {
  id: string;
  label: string;
  tier?: "fast" | "balanced" | "best"; // now optional — dynamically-discovered
                                        // Ollama models may have no confident tier
}
```

```ts
// apps/daemon/src/llm/ollamaProvider.ts
const PARAM_SIZE_RE = /(\d+(?:\.\d+)?)\s*b\b/i; // matches "8b", "1b", "70b", "3.8b" etc.

function inferTierFromTag(tag: string): LlmModelOption["tier"] {
  const match = tag.match(PARAM_SIZE_RE);
  if (!match) return undefined;
  const billions = parseFloat(match[1]!);
  if (Number.isNaN(billions)) return undefined;
  if (billions <= 3) return "fast";
  if (billions <= 13) return "balanced";
  return "best";
}

function ollamaTagToModelOption(tag: string): LlmModelOption {
  return { id: tag, label: tag, tier: inferTierFromTag(tag) };
}
```

**Reasoning:**
- `/api/tags` gives no capability/speed metadata — only name, size-in-bytes
  (disk size, not parameter count), and timestamps. Parameter-count is the
  ONLY signal in the tag name itself that has any real correlation to
  "fast vs best," and Ollama's own naming convention (`llama3.1:8b`,
  `qwen2.5:0.5b`, `llama3.1:70b`) makes this a legitimate, low-effort
  heuristic — not a guess pulled from nowhere.
- It must degrade gracefully: many real tags carry no parameter hint at all
  (`mistral:latest`, a user's own fine-tuned/renamed model). For those,
  `tier: undefined` is honest; inventing a tier (e.g. defaulting everyone to
  `"balanced"`) would be actively misleading.
- `label` is just the raw tag (`"llama3.1:8b"`) — no attempt to prettify
  into Vietnamese parenthetical tier names like the old hardcoded constants
  had (`"Llama 3.2 1B (nhanh)"`), because we don't reliably know the model's
  identity/marketing name, just its tag string. This is a UX simplification
  the dev/Checker should treat as intentional, not an oversight.
- `ModelPicker.tsx` must render the tier label only when `tier` is present
  (see §6.6) — `TIER_LABEL[m.tier]` indexing would throw/render `"undefined"`
  today if fed `tier: undefined`.

### 6.4 RPC surface — extend `ListModelsResult`, do not add a new method

`listModels` is kept as the one RPC method (no new method) per the prompt's
"prefer extending the existing method if it fits" — it fits cleanly because
the only new information is "did the call succeed, and if zero models, why."

**Before** (`packages/rpc-types/src/index.ts`):
```ts
export interface ListModelsParams {
  providerId: ProviderId;
}
export interface ListModelsResult {
  models: LlmModelOption[];
}
```

**After:**
```ts
export interface ListModelsParams {
  providerId: ProviderId;
}

/** Distinguishes "Ollama reachable but zero models pulled" (AC2's exact bug)
 *  from "fetch itself failed" (malformed JSON / non-2xx from /api/tags) — both
 *  resolve the RPC call (HTTP 200 from the daemon's own RPC transport), neither
 *  is surfaced as a thrown RpcError, because both are well-formed, expected
 *  outcomes for a reachable-but-empty-or-misbehaving Ollama, not daemon bugs.
 *  Cloud providers always return "ok" (their listModels() never fails). */
export type ListModelsOutcome = "ok" | "empty" | "fetch-failed";

export interface ListModelsResult {
  models: LlmModelOption[];
  outcome: ListModelsOutcome;
  /** present iff outcome === "fetch-failed" — human-readable detail from the
   *  daemon (e.g. "Ollama trả về lỗi HTTP 500..."), for a non-generic error message. */
  errorMessage?: string;
}
```

Why **not** throw `RpcError` for the empty/malformed cases: an `RpcError`
collapses to a single generic error banner in `ModelPicker`'s existing
`.catch()` (today: "Không thể tải danh sách mô hình.") — exactly the
generic-error UX STATE §3 explicitly says the empty-list case must NOT get
("not a generic error"). Resolving the RPC call with a typed `outcome` field
lets `ModelPicker` branch into 3 distinct renders (§6.6) without inventing a
4th transport-level error code.

`provider-not-running` (Ollama unreachable) is the ONE case that still
**throws** (`RpcError("llm-provider-not-running", ...)`), unchanged from
today — because that is a pre-existing, already-correctly-handled failure
mode (AC4 requires zero regression here), and `ModelPicker` doesn't
currently distinguish "unreachable" from "other RPC failure" today anyway —
no new requirement to make it do so now. (See trade-off note in §9.)

**`handlers.ts`'s `listModels` handler — after:**
```ts
async listModels(params: contract.ListModelsParams): Promise<contract.ListModelsResult> {
  assertValidProviderId(params.providerId);
  const provider = getProvider(params.providerId);
  try {
    const models = await provider.listModels();
    return { models, outcome: models.length === 0 ? "empty" : "ok" };
  } catch (err) {
    if (err instanceof LlmError) {
      if (err.code === "provider-not-running") {
        // unchanged existing path — Ollama unreachable still throws, AC4.
        throw new RpcError(`llm-${err.code}`, humanMessageForLlmError(err));
      }
      // invalid-response (malformed JSON / non-2xx from /api/tags), or any other
      // LlmError code reaching here — resolve with outcome:"fetch-failed" rather
      // than throw, so the web layer can render a distinct, non-generic message.
      return { models: [], outcome: "fetch-failed", errorMessage: humanMessageForLlmError(err) };
    }
    throw new RpcError("llm-unknown", "Lỗi không xác định khi lấy danh sách mô hình.");
  }
},
```

Cloud providers' code path is unaffected: their `listModels()` never throws
and never returns `[]`, so they always resolve `{ models, outcome: "ok" }` —
byte-for-byte the same data they always returned, just wrapped with one new
field. AC5 holds.

### 6.5 `server.ts` — no change needed

`listModels` stays in `READ_ONLY_METHODS` (still "no fs mutation," still a
read-only-in-spirit call) — its outbound-network-call nature is exactly the
same conceptual category `checkProviderStatus`/`generateBody` already
occupy in that set's comments ("read-only" = no fs mutation, not "free" or
"local-only"). One comment update to `server.ts`'s existing
`listModels`-membership note, replacing "synchronous, zero network calls,
instant response" with an accurate description — a doc-comment-only diff,
no logic change.

### 6.6 `apps/web` — `ModelPicker.tsx`

`ModelPicker` must render 3 distinct states instead of today's 2
(populated dropdown / generic load error):

```ts
// apps/web/src/components/ModelPicker.tsx (sketch — dev implements exact JSX/styling)

const [outcome, setOutcome] = useState<"ok" | "empty" | "fetch-failed" | null>(null);
const [errorDetail, setErrorDetail] = useState<string | null>(null);

// inside the existing useEffect, replacing the current .then/.catch:
callRpc<ListModelsParams, ListModelsResult>("listModels", { providerId })
  .then((result) => {
    if (cancelled) return;
    setModels(result.models);
    setOutcome(result.outcome);
    setErrorDetail(result.errorMessage ?? null);
    setLoadError(null);
    if (!value && result.models.length > 0) {
      onChange(result.models[0]!.id);
    }
  })
  .catch((err) => {
    if (cancelled) return;
    // unchanged: covers provider-not-running (thrown RpcError) and any other
    // transport-level failure — same generic message as today, AC4 unregressed.
    setLoadError(
      err instanceof DaemonRpcError ? err.message || "Không thể tải danh sách mô hình." : "Không thể tải danh sách mô hình."
    );
  });
```

Render branches (replacing the current single `loadError`-vs-`<select>` branch):
1. `loadError` set (unreachable / thrown RpcError, AC4 path) → existing
   destructive-text render, **unchanged**.
2. `outcome === "fetch-failed"` → new destructive-text render showing
   `errorDetail` (e.g. "Ollama trả về lỗi HTTP 500... khi lấy danh sách mô
   hình") — visually similar to (1) but a DIFFERENT message (no
   "Ollama isn't running" framing, since it IS running, the tags call just
   failed) and NO disabled `<select>` underneath.
3. `outcome === "empty"` (only possible for the local/ollama path; cloud
   providers' static lists are never empty) → the new actionable empty-state:
   a short message + a `code`-styled `ollama pull <tag>` suggestion +
   "Copy" button (reusing the exact `navigator.clipboard.writeText` pattern
   already in `CopyRunCommandDialog.tsx`/`ProvidersPanel.tsx` — no new
   clipboard implementation). Suggested tag: a single hardcoded fallback
   (`llama3.2:1b` — small, fast-to-pull, broadly available) purely as
   **example copy text**, NOT re-introducing the old "3 hardcoded options as
   real choices" pattern — this string is never offered as a selectable
   `<option>`, only shown inside the suggested shell command. Example:
   ```
   Chưa có model nào được tải trên Ollama. Chạy lệnh sau rồi quay lại đây:
   [ollama pull llama3.2:1b]  [Copy]
   ```
4. `outcome === "ok"` → existing `<select>` render, **unchanged** structurally,
   except: `{m.tier ? \`(${TIER_LABEL[m.tier]})\` : ""}` guard added so an
   `undefined` tier (dynamically-discovered model with no parseable size
   hint, §6.3) renders the bare label with no parenthetical, instead of
   `"(undefined)"` or a runtime crash on `TIER_LABEL[undefined]`.

`GenerateBodyButton.tsx` needs **no changes** — it only consumes `modelId`
(a string `ModelPicker` already produces via `onChange`) and `providerId`;
it has no knowledge of how that id was sourced (static array vs. live
`/api/tags` fetch) and no new error code reaches it (the "unreachable"
905-style 404 represented by `llm-provider-not-running`/`llm-invalid-response`
from `generateBody` itself is unchanged — this loop only changes
`listModels`, not `generateBody`). The prompt's instruction to evaluate
whether `GenerateBodyButton` needs to react is answered: **no** — confirmed
by reading its source, it has zero `listModels`-shaped logic in it today.

### 6.7 No app-wide caching

`ModelPicker`'s existing "one `listModels` call per mount, re-fired only
when `providerId` changes" behavior is kept as-is — no new caching layer,
no shared model-list store. Rationale: this matches the existing
`useActiveProvider`/`ProviderStatusPill` "check once on mount, no polling"
precedent, and STATE doesn't request cross-mount caching. A user who
`ollama pull`s a new model in a terminal while Symbion is open will see it
after remounting `ModelPicker` (switching kind/navigating back), which is an
acceptable, pre-existing UX shape (`checkProviderStatus`/`listProviders`
have the identical "stale until remount" property already) — not a
regression introduced by this change.

## 7. Data flow (step by step)

**(a) Real models present, happy path:**
1. `ModelPicker` mounts with `providerId="ollama"`.
2. `callRpc("listModels", { providerId: "ollama" })` → daemon `handlers.listModels`.
3. `assertValidProviderId` passes → `getProvider("ollama")` constructs `OllamaProvider`
   (resolves `baseUrl` via `resolveOllamaBaseUrl()` — unchanged SSRF guard).
4. `provider.listModels()` → `fetch(`${baseUrl}/api/tags`)` with a 3000ms
   AbortController budget.
5. Ollama responds 200 with `{ "models": [{ "name": "llama3.1:8b", ... }, ...] }`.
6. Mapped to `LlmModelOption[]` via `ollamaTagToModelOption` (tier inferred
   or omitted per §6.3).
7. Handler returns `{ models: [...], outcome: "ok" }`.
8. `ModelPicker` sets `models`, `outcome="ok"`; renders populated `<select>`;
   auto-selects `models[0]` if nothing selected yet (unchanged default-pick
   behavior).
9. User picks a model → `GenerateBodyButton` fires `generateBody` with that
   `modelId` → succeeds (AC3) since the id is guaranteed to be one Ollama
   actually has pulled.

**(b) Reachable, zero models (the user's reported bug):**
1–5. Same as (a), except Ollama responds 200 with `{ "models": [] }`.
6. `json.models` is `[]` (a valid array, zero entries) → mapping produces `[]`.
7. Handler: `models.length === 0` → returns `{ models: [], outcome: "empty" }`.
8. `ModelPicker` renders the actionable empty-state (§6.6 case 3) — `ollama
   pull <tag>` suggestion + copy button, no dropdown, no generic error, no
   stale hardcoded options.
9. `GenerateBodyButton`'s model dropdown has nothing valid to submit — user
   is steered to run `ollama pull` first, exactly resolving AC2.

**(c) Ollama unreachable (daemon down) — unchanged path:**
1–3. Same as (a).
4. `fetch` rejects (`ECONNREFUSED`/DNS failure) before any response.
5. `OllamaProvider.listModels()`'s catch block throws
   `LlmError("provider-not-running", ...)` (same message text as the
   existing `generate()` failure path, deliberately reused verbatim).
6. Handler's catch: `err.code === "provider-not-running"` → re-throws as
   `RpcError("llm-provider-not-running", ...)` — **same shape `listModels`
   already throws today** (no behavior change for this case, confirmed by
   reading the current handler, which already throws nothing currently —
   wait: today's handler has NO try/catch at all and is fully synchronous;
   if Ollama were unreachable today, this code path is simply never
   exercised today, since `listModels()` never made a network call before
   this feature. This is a NEW failure mode for `listModels` specifically,
   but it reuses the EXACT existing `RpcError("llm-provider-not-running", ...)`
   shape `generateBody` already throws, so `ModelPicker`'s `.catch()` block
   (which already exists, unchanged) handles it via the same generic
   `loadError` render — no new UI code needed for this branch, just correct
   propagation.) AC4 is satisfied by shape-reuse, not by "this exact case
   pre-existed."
7. `ModelPicker`'s `.catch()` sets `loadError` → existing destructive-text
   render. (Today this render says "Không thể tải danh sách mô hình."; dev
   may optionally surface `err.message` instead for a more specific Vietnamese
   string per the `DaemonRpcError`-message-preferred convention already used
   in `GenerateBodyButton` — architect recommends this small improvement but
   it is not required for AC4, which only requires "the unreachable case
   still shows AN appropriate not-running-style message," not byte-identical
   copy.)

**(d) `/api/tags` returns malformed/unexpected JSON:**
1–4. Same as (a), but Ollama (or something else listening on that port)
   responds 200 with a body that is either not valid JSON, or valid JSON
   missing/mistyped the `models` key.
5. `res.json()` throws (not valid JSON) → `LlmError("invalid-response", ...)`,
   OR `Array.isArray(json.models)` is false → `LlmError("invalid-response", ...)`.
6. Handler's catch: code is `"invalid-response"`, not `"provider-not-running"`
   → returns `{ models: [], outcome: "fetch-failed", errorMessage: "..." }`
   (does NOT throw).
7. `ModelPicker` renders case 2 from §6.6 — a distinct "fetch failed" message,
   never confused with case (b)'s "genuinely zero models" empty-state, and
   never confused with case (c)'s "Ollama not running" message.

## 8. Edge cases — exhaustive table

| Scenario | `OllamaProvider.listModels()` outcome | RPC result | `ModelPicker` render |
|---|---|---|---|
| 200, `{models:[{name:"llama3.1:8b"}, ...]}` | resolves `LlmModelOption[]` (len > 0) | `{models, outcome:"ok"}` | populated dropdown |
| 200, `{models:[]}` (zero pulled) | resolves `[]` | `{models:[], outcome:"empty"}` | actionable empty-state, `ollama pull` suggestion |
| 200, garbage (not JSON, e.g. HTML error page) | throws `invalid-response` | `{models:[], outcome:"fetch-failed", errorMessage}` | distinct "fetch failed" message |
| 200, valid JSON but no `models` key / wrong type | throws `invalid-response` | `{models:[], outcome:"fetch-failed", errorMessage}` | distinct "fetch failed" message |
| 200, `models` entries with no parseable `name`/`model` field | filtered out of the mapped array (not an error) | `{models:[], outcome:"empty"}` if all entries are unusable, else `{models: <usable subset>, outcome:"ok"}` | empty-state or partial dropdown, never a crash |
| non-2xx HTTP status (e.g. 500) | throws `invalid-response` | `{models:[], outcome:"fetch-failed", errorMessage}` | distinct "fetch failed" message |
| connection refused (nothing listening) | throws `provider-not-running` | thrown `RpcError("llm-provider-not-running", ...)` | existing generic unreachable message (AC4, unchanged shape) |
| timeout (no response within 3000ms) | throws `provider-not-running` (collapsed, see §6.2's rationale) | thrown `RpcError("llm-provider-not-running", ...)` | same as connection-refused — AC6 satisfied (bounded, does not hang) |
| `SYMBION_OLLAMA_BASE_URL` set to non-loopback host | `resolveOllamaBaseUrl()` throws `provider-not-running` BEFORE any fetch (existing guard, untouched) | thrown `RpcError("llm-provider-not-running", ...)` | same as connection-refused |
| OpenAI/Anthropic/Gemini, any state | unchanged static array, wrapped `Promise.resolve` | `{models: <static 3>, outcome:"ok"}` always | unchanged dropdown (AC5) |

## 9. Trade-off decisions + assumptions (for dev/Checker to track)

1. **Timeout-vs-refused collapse**: §6.2 deliberately does NOT distinguish
   "Ollama is slow/half-responsive" from "Ollama isn't running" — both map
   to `provider-not-running`. This matches `generate()`'s existing
   precedent of using a dedicated `"timeout"` code there, so a Checker may
   flag the inconsistency; architect's call is that for a `listModels`
   probe (not a real generation request), the UI treatment is identical
   either way (AC6 only requires "bounded," not "distinguishable"), so the
   simpler collapse is preferred. Dev MAY choose to thread a distinct
   `"timeout"` code through instead if it's a trivial change at
   implementation time — not blocking, but document the choice made.
2. **`tier` becomes optional on `LlmModelOption`** — this is a breaking
   shape change for any code indexing `TIER_LABEL[m.tier]` without a guard.
   Confirmed only one call site exists (`ModelPicker.tsx`) and it is updated
   in this same change (§6.6). Checker should grep for any other consumer
   of `.tier` that might not have been caught.
2a. The 3 cloud providers' static `LlmModelOption` entries keep their
   existing non-optional `tier` values (`fast`/`balanced`/`best`) — making
   the field optional on the type does not change what they emit; this is
   purely a widening, not a removal, of guarantees for the static providers.
3. **No retry/backoff on `/api/tags`** — a single attempt, bounded by the
   3000ms budget; consistent with `checkOllamaReachable`'s existing
   no-retry convention, not introducing a new pattern.
4. **`errorMessage` on `ListModelsResult` carries daemon-internal text
   straight to the UI** (same convention `RpcError.message` already uses
   end-to-end) — no new sanitization concern since it's the same trust
   boundary (daemon is the user's own local process) already crossed by
   every other RPC error message in the codebase.
5. **Hardcoded `ollama pull llama3.2:1b` example tag in the empty-state
   copy** is example text, not a real recommendation engine — if `llama3.2:1b`
   is ever deprecated/renamed upstream, this is a content fix, not an
   architecture change (same category of risk the prior `OLLAMA_MODELS`
   constant already carried, called out in its own doc-comment as "R2 ...
   a dev-time content decision, not an architecture decision").
6. **`packages/core` is untouched** — confirmed no part of this design
   touches `packages/core`; all changes are `apps/daemon` + `apps/web` +
   `packages/rpc-types` (AC7 holds by construction, not by post-hoc check).

## 10. Files to create/modify (summary)

- `apps/daemon/src/llm/types.ts` — `listModels()` → async; `tier` → optional.
- `apps/daemon/src/llm/ollamaProvider.ts` — real `/api/tags` implementation,
  `inferTierFromTag`/`ollamaTagToModelOption` helpers, delete `OLLAMA_MODELS`.
- `apps/daemon/src/llm/openaiProvider.ts`,
  `apps/daemon/src/llm/anthropicProvider.ts`,
  `apps/daemon/src/llm/geminiProvider.ts` — `listModels()` → `async`, same
  static array, no content change.
- `apps/daemon/src/llm/providerStatus.ts` — `checkApiKeyProviderReachable`
  adds one `await`.
- `apps/daemon/src/rpc/handlers.ts` — `listModels` handler becomes `async`
  with the try/catch mapping in §6.4.
- `apps/daemon/src/server.ts` — doc-comment-only update on the
  `READ_ONLY_METHODS` `listModels` entry.
- `packages/rpc-types/src/index.ts` — `ListModelsOutcome` new type,
  `ListModelsResult` gains `outcome`/`errorMessage`, `LlmModelOption.tier`
  becomes optional.
- `apps/web/src/components/ModelPicker.tsx` — 3-way outcome branching,
  empty-state UI with copy-to-clipboard `ollama pull` suggestion, optional-tier
  render guard.
- `apps/web/src/components/GenerateBodyButton.tsx` — **no change** (confirmed,
  §6.6).
- No `packages/core` changes.

## 11. Test plan

See `docs/loops/ollama-dynamic-models-testplan.md`.

## 12. Next step

Architecture, RPC surface, data flow, edge cases, and test plan are locked.
Hand off to `/build` — `feature-builder`/`dev` implements exactly the files
in §10 against this design. `code-reviewer` uses §6-§9 as the acceptance
standard; `security-reviewer` should specifically re-verify the loopback
guard is still the single `resolveOllamaBaseUrl()` call site (§6.2 adds no
second implementation) and that no new fs/net import lands in
`packages/core`.

---

## 13. BUILD — implementation report

All files in §10 were implemented exactly per the plan, with the test-file
updates listed below (old assertions tested removed/changed behavior, not a
regression — updated per the BUILD prompt's instruction).

### 13.1 Files changed

- `apps/daemon/src/llm/types.ts` — `LlmProvider.listModels()` →
  `Promise<LlmModelOption[]>`; `LlmModelOption.tier` → optional.
- `apps/daemon/src/llm/ollamaProvider.ts` — real `GET {baseUrl}/api/tags`
  implementation (3000ms `AbortController` timeout, reuses `this.baseUrl`
  from the existing `resolveOllamaBaseUrl()`-resolved constructor field, no
  second SSRF-guard implementation), `inferTierFromTag`/
  `ollamaTagToModelOption` helpers exactly per §6.3's regex/threshold,
  `OLLAMA_MODELS` constant deleted entirely (confirmed zero remaining
  references via grep).
- `apps/daemon/src/llm/openaiProvider.ts`, `anthropicProvider.ts`,
  `geminiProvider.ts` — `listModels()` → `async`, same static array,
  byte-for-byte unchanged content/order.
- `apps/daemon/src/llm/providerStatus.ts` — `checkApiKeyProviderReachable`
  now `await`s `provider.listModels()`.
- `apps/daemon/src/rpc/handlers.ts` — `listModels` handler is now `async`
  with the exact try/catch mapping from §6.4: `{models, outcome:"ok"}` on
  success, `{models:[], outcome:"empty"}` on a genuinely-empty array,
  `{models:[], outcome:"fetch-failed", errorMessage}` for `invalid-response`/
  other non-`provider-not-running` `LlmError` codes (resolved, not thrown),
  and a **thrown** `RpcError("llm-provider-not-running", ...)` for the
  `provider-not-running` case only (AC4, unchanged shape).
- `apps/daemon/src/server.ts` — doc-comment-only update on the
  `READ_ONLY_METHODS` `listModels` entry (no logic change) — old "synchronous,
  zero network calls" comment replaced with accurate text describing the new
  timeout-bounded network call for Ollama.
- `packages/rpc-types/src/index.ts` — added `ListModelsOutcome` (`"ok" |
  "empty" | "fetch-failed"`), widened `ListModelsResult` with
  `outcome`/optional `errorMessage`, widened `LlmModelOption.tier` to
  optional.
- `apps/daemon/src/rpc/contract.ts` and `apps/web/src/lib/rpc/types.ts` —
  added `ListModelsOutcome` to their existing re-export lists (confirmed both
  files already re-export the shared `@symbion/rpc-types` definitions
  verbatim — single source of truth, no hand-duplication; this was the one
  place the plan didn't spell out explicitly but followed directly from
  reading the existing re-export pattern).
- `apps/web/src/components/ModelPicker.tsx` — full rewrite implementing the
  4-branch render (loadError / fetch-failed / empty-state with `ollama pull
  llama3.2:1b` + Copy button reusing `CopyRunCommandDialog.tsx`'s exact
  `navigator.clipboard.writeText` pattern / populated dropdown), optional-tier
  guard (`m.tier ? \` (${TIER_LABEL[m.tier]})\` : ""`).
- `apps/web/src/components/GenerateBodyButton.tsx` — **confirmed unchanged**
  by reading its source: it only consumes `modelId`/`providerId` strings via
  props, has zero `listModels`-shaped logic, and no new error code reaches it
  (this loop only changes `listModels`, not `generateBody`). Plan's claim
  verified correct, not just trusted.
- No `packages/core` changes — confirmed by
  `grep -rnE "require\(['\"](fs|net|http)['\"]\)|from ['\"]node:(fs|net|http)|from ['\"](fs|net|http)['\"]" packages/core/src`
  returning zero matches (a looser substring grep of `fs.`/`net.` produced 2
  false-positive hits on the unrelated filename `refs.js`/identifier
  `extractAgentMentions`, not real fs/net imports — verified by reading the
  matched lines).

### 13.2 Test files updated (old assertions tested removed/changed behavior)

- `apps/daemon/test/llm-ollamaProvider.test.ts` — TC-D6 (asserted exactly 3
  hardcoded entries) replaced with TC-LM-A1/A2/A3/A4/A5/A6/A7/A8/A9/A10/A11
  per the test plan's Tier A table, using the same `listenEphemeral()`
  fake-HTTP-server helper already in this file.
- `apps/daemon/test/llm-anthropicProvider.test.ts`,
  `llm-openaiProvider.test.ts`, `llm-geminiProvider.test.ts` — their existing
  "listModels() returns a non-empty static array..." test made `async` with
  an `await` added; assertions themselves are unchanged (AC5 regression
  guard, not weakened).
- `apps/daemon/test/rpc-generateBody.test.ts` — `handlers.listModels`
  describe block: the ollama case now uses `SYMBION_OLLAMA_BASE_URL` +
  `listenEphemeral()` to test the new outcome-branching contract
  (TC-RPC-A1/A2/A3/A4); anthropic/openai/gemini cases made `async`/`await`ed
  with an added `outcome === "ok"` assertion; TC-H9 (invalid providerId) made
  `async`/`rejects`-based since the handler is now async and
  `assertValidProviderId` now throws inside an async function (still resolves
  to the same `RpcError("invalid-params", ...)`, just via a rejected promise
  instead of a synchronous throw).
- `apps/daemon/test/server.integration.test.ts` — the "200 with 3 models"
  transport smoke test switched from `providerId: "ollama"` (which would now
  depend on this machine's real Ollama state, an unwanted test-environment
  dependency for a pure transport-layer check) to `providerId: "anthropic"`
  (static, unaffected by local Ollama state); added a new dedicated case
  exercising the ollama path against a request-scoped fake HTTP server via
  the same `SYMBION_OLLAMA_BASE_URL` env-override seam.

### 13.3 Assumptions / judgment calls (for Checker to verify)

1. **Timeout-vs-refused collapse (§9.1)**: kept the collapse — both
   connection-refused and our own abort-on-timeout map to
   `LlmError("provider-not-running", ...)`, exactly as the plan's primary
   recommendation states. Did NOT thread a separate `"timeout"` code through,
   since the plan flagged this as optional/non-blocking and the simpler
   collapse keeps `listModels`'s error surface identical to `generate()`'s
   `provider-not-running` path that `ModelPicker`'s existing `.catch()`
   already handles.
2. **`ListModelsOutcome` re-export wiring**: the plan's §10 file list didn't
   explicitly call out `apps/daemon/src/rpc/contract.ts` or confirm
   `apps/web/src/lib/rpc/types.ts` needed a new named re-export — I verified
   by reading both files that they re-export the shared `@symbion/rpc-types`
   barrel by name (not `export *`), so the new `ListModelsOutcome` type
   needed to be added to both re-export lists to be consumable. Treated this
   as a mechanical consequence of the plan's §6.4 type addition, not a
   deviation from it.
3. **Test-file rewrites for ollama's old TC-D6 / `rpc-generateBody.test.ts` /
   `server.integration.test.ts`**: the plan's testplan.md describes the new
   Tier A/RPC test IDs in detail but doesn't hand me exact replacement code
   for the *existing* tests that asserted the old hardcoded-3 sync contract.
   I wrote replacements that (a) preserve the same descriptive intent where
   still valid (e.g. cloud providers' "exactly 3 entries" assertion is
   unchanged, just awaited) and (b) for the ollama-specific assertions,
   follow the exact Tier A / Tier RPC test-ID table in
   `ollama-dynamic-models-testplan.md` (TC-LM-A1 through A11, TC-RPC-A1
   through A4). I did not invent new assertions beyond what STATE/testplan
   specify.
4. **`server.integration.test.ts`'s smoke-test provider switch (ollama ->
   anthropic)**: judgment call, not explicitly specified by the plan. Kept
   the *original test's intent* ("transport-layer happy path returns 200
   with a non-empty model list") by picking a provider whose `listModels()`
   is guaranteed not to depend on this machine's local Ollama install state,
   then added a *new*, separate ollama-specific case using the fake-server
   env-override seam so ollama's transport path is still exercised.
5. **TC-LM-A5 timeout-margin loosened from `< 4000ms` (testplan's literal
   suggestion) to `< 6000ms`**: observed one flaky failure at ~4427ms under
   local machine load with the 4000ms bound; widened the margin since AC6
   only requires "bounded, does not hang indefinitely," not a tight latency
   SLA, and the underlying 3000ms `AbortController` budget itself is
   unchanged — only the test's assertion margin was loosened.
6. **No deviation from the plan's §6.2/§6.3/§6.4 code sketches** — the actual
   `listModels()` implementation, `inferTierFromTag`/`ollamaTagToModelOption`
   helpers, and the RPC handler's try/catch mapping were transcribed directly
   from the plan's sketches (Vietnamese error-message strings included
   verbatim), not re-derived.

### 13.4 Build/test confirmation

- `npm run build` (root): **passes**, zero TypeScript errors across
  `packages/core`, `packages/rpc-types`, `apps/daemon`, `apps/web` (Next.js
  build also compiles/type-checks/generates static pages successfully).
- `npm run test` (root, vitest, all workspaces): **272 tests passed, 0
  failed, 28/28 test files passed** (after the test-file updates in §13.2;
  before those updates, 10 tests failed across 6 files, all due to the old
  sync/hardcoded-shape assertions described above — confirmed each failure
  was an expected consequence of this change, not an unrelated regression,
  before editing each one).
- `grep -rnE "require\(['\"](fs|net|http)['\"]\)|from ['\"]node:(fs|net|http)|from ['\"](fs|net|http)['\"]" packages/core/src`
  → zero matches (AC7).
- `grep -n "OLLAMA_MODELS" -r apps/daemon/src` → zero matches (old constant
  fully removed).

### 13.5 Not yet verified by me (Checker/QA scope)

- Tier C (Playwright/chrome-devtools e2e) and Tier D (manual, real local
  Ollama) test cases from the test plan were **not** executed in this BUILD
  pass — those require a running web+daemon session and/or a real Ollama
  install, which is QA's phase, not BUILD's. AC1/AC2/AC3 (real models shown /
  actionable empty-state / Generate succeeds) are covered by Tier A/RPC fake-
  server tests at the daemon level in this pass, but the actual UI rendering
  (`ModelPicker`'s 4 branches, the Copy button's clipboard behavior) has only
  been verified by code-reading + TypeScript type-checking + a successful
  Next.js production build — not by an actual browser/e2e run.

## 14. REVIEW — code-reviewer + architect (parallel, independent)

Both checkers returned **PASS**. Scope note: both reviewers were explicitly
directed to review only files touched by THIS feature, since the working
tree also carries the separate, already-reviewed `multi-provider-settings`
feature uncommitted underneath — neither re-reviewed that prior work.

**code-reviewer verdict: PASS.** All 8 STATE §4 acceptance criteria
independently verified against actual code (not just the Maker's report):
real-models/empty-state/unreachable/fetch-failed outcomes correctly
distinguished; cloud providers' `listModels()` output confirmed byte-for-
byte unchanged; `packages/core` purity re-confirmed via grep;
`OllamaProvider.listModels()` confirmed to reuse `this.baseUrl` (no second
SSRF-guard implementation); `errorMessage` confirmed to never leak secrets/
stack traces (only hardcoded Vietnamese strings + an HTTP status code).
Independently re-ran `npm run build` + `npm run test` — 272/272, matching
the Maker's reported count. Two 🟢 nits, neither blocking:
- `inferTierFromTag`'s regex could theoretically mis-tag a hypothetical
  `"model-8bit:latest"`-style tag — acknowledged as unlikely given Ollama's
  real naming conventions, not fixed (matches the plan's own "good enough,
  not exhaustive" framing for this heuristic).
- A stale test description string said "elapsed < 4000ms" while the actual
  assertion checked `< 6000ms` (the margin was loosened post-flakiness, the
  docstring wasn't updated to match). **Fixed**: updated the description
  string in `apps/daemon/test/llm-ollamaProvider.test.ts` to say `< 6000ms`,
  matching the real assertion. Re-ran that test file: 21/21 pass.

**architect verdict: PASS.** Confirmed faithful conformance to §6's design:
the "one interface, async for all 4 providers" decision (§6.1) was followed
with zero special-casing by provider id at any call site; the RPC surface
was genuinely extended (not replaced with a new method) and the
`provider-not-running`-throws vs. other-codes-resolve-with-`outcome`
distinction (§6.4's crux) is implemented correctly; `ModelPicker.tsx`'s 4
render states are visually/textually distinct, never conflated; no scope
creep (cloud providers stay static, no auto-pull, no new RPC method).
Independently re-ran build + daemon test suite (196/196 daemon tests) and
confirmed clean. One 🟢 nit (the same stale docstring code-reviewer found),
fixed as above.

## 15. Next step (superseded by §16 — see below)

~~Both `/review` checkers PASS, the one nit fixed, build+test reconfirmed
green. Proceed to `/qa` — execute the test plan's Tier A/B/C (re-run/
confirm) and Tier D manual checklist (live daemon + browser, ideally
against a real local Ollama with at least one model pulled and, separately,
zero models pulled, to literally exercise the user's originally-reported
scenario) per `ollama-dynamic-models-testplan.md`. Then `/ship`.~~

## 16. SHIP

**`/qa`'s Tier D manual checklist (live daemon + browser) was explicitly
skipped at the user's direction**, not silently omitted. When `/ship` was
invoked, it noted `/qa` had not yet run (only `/review` had passed) and
asked the user directly whether to run `/qa` first or ship without it. The
user chose to skip it and ship anyway. This is recorded here so the gap is
traceable, not silently glossed over.

**What IS independently verified before shipping** (Tier A/B/C — automated,
not manual):
- Full build (`npm run build`) — clean, zero TS errors, Next.js production
  build succeeds, re-run immediately before this commit.
- Full test suite (`npm run test`) — **272/272 passing**, re-run immediately
  before this commit, matching both independent reviewers' counts exactly.
- Both `/review` checkers (code-reviewer + architect) independently PASS,
  each having re-run build+test themselves and verified all 8 STATE §4
  acceptance criteria against actual code, not just the Maker's claims.

**What is NOT verified** (the actual gap left by skipping `/qa`):
- The live, end-to-end UX of `ModelPicker`'s 4 render branches in a real
  browser — populated dropdown, empty-state with the `ollama pull` copy
  button, the distinct fetch-failed message, and the unchanged-unreachable
  message — has only been verified by code-reading, type-checking, and a
  successful production build. No screenshot, no live click-through.
- The user's own originally-reported scenario (clicking Generate in the
  Workflow Builder with their real local Ollama, which has zero models
  pulled) was never re-exercised live after this fix — the root cause was
  confirmed via `curl` during `/investigate` (before this feature existed),
  but the NEW empty-state UI this feature adds was never shown to a real
  browser pointed at that exact machine state.
- Tier C/D test plan items in `ollama-dynamic-models-testplan.md` remain
  unexecuted — flagged here as known, deliberately-accepted residual risk,
  not unknown risk.

**Recommendation for a fast follow-up** (not blocking, since the user chose
to ship without it): the next time this user opens Symbion's Workflow/Agent
builder with Ollama running and zero models pulled, that IS the live Tier D
verification — worth a quick visual confirmation then that the empty-state
renders as designed, since it's the literal scenario that triggered this
entire investigation→plan→build→review→ship loop.
