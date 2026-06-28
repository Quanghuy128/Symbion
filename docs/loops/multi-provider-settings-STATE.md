# multi-provider-settings — STATE

**Phase: DONE — shipped**

## 0. Origin

User request (inspired by `https://github.com/decolua/9router`'s "Endpoint
Proxy" UI — a card-grid Providers settings screen with per-provider connect
status and "Test All"): generalize Symbion's existing single-provider
(`ollama`-only) connect/status UX, shipped in `connect-providers-STATE.md`,
into a real multi-provider settings surface covering OpenAI, Anthropic,
Gemini, and Ollama.

`/analyze` (3 parallel BA agents — requirements/architecture/product angles)
flagged that 9router itself could not be fetched (no web access in
sub-agents); all 9router-derived reasoning is inferred from a screenshot
only, not source. The analysis's single biggest fork — "narrow LLM-backend
picker for Symbion's own use" vs. "Symbion becomes a multi-provider
proxy/router other tools connect through" — is resolved below.

## 1. Problem (user story)

> As a Symbion user, I want to choose which LLM (Ollama local, or a cloud
> provider — OpenAI/Anthropic/Gemini) Symbion's daemon uses to power its
> auto-generate features (Generate Body, Generate Description), configure
> that provider's API key once in a settings screen, see whether it's
> currently connected, and switch the active provider — without editing env
> vars or restarting anything.

## 2. Scope

### In scope
- **Narrow scope confirmed**: this is a Settings → AI Providers panel for
  Symbion's *own* daemon to pick an LLM backend for its existing
  auto-generate features. Symbion does **not** become a multi-provider
  proxy/router that other tools (Cursor, Copilot, Claude Code, etc.) connect
  through. That is explicitly out of scope (see below) — it is a different
  product, contradicts CLAUDE.md's "daemon serves only Symbion's own web UI"
  architecture, and was the #1 risk all 3 analyze-agents flagged.
- **Providers (v1)**: Ollama (local, already shipped — reachability +
  setup-guide UX, unchanged), OpenAI, Anthropic, Gemini (all three: API-key
  based, simple key + model picker, not full OAuth/Vertex flows).
- **New top-level "Settings" nav item** in `apps/web`, with "Providers" as
  its first/only section. This is new shell infrastructure — previously
  deferred twice (see `connect-providers-STATE.md` §2 out-of-scope) — now
  explicitly in scope because there's no other sane home for 3 new
  API-key-entry forms.
- **API key storage**: local config file under the user-level config dir
  (`globalConfigDir()`, i.e. `~/.config/symbion/`, NOT the per-project
  `.symbion/` — see §3 rationale), **plaintext**, gitignored (it's outside
  any git working tree by construction), never logged, never echoed back to
  `apps/web` after initial entry (write-only field, masked display e.g.
  `sk-...ab12`). This is a new secrets-at-rest surface for Symbion —
  **flagged for `/cso` review before/alongside `/build`**, since no prior
  feature has persisted secrets to disk.
- **Provider selection**: explicit single "active provider" selection by the
  user (radio in the Providers panel). No automatic fallback chain. Generate
  Body/Description always calls whichever provider is currently marked
  active.
- **Per-provider "Test connection" / status check**: generalizes the
  existing `checkProviderStatus` RPC from a literal `"ollama"` param to a
  provider-agnostic id validated against a registry. For cloud providers,
  "reachable" means an authenticated cheap call succeeds (e.g. list-models
  or equivalent), not just network reachability.
- **Invalid/expired key handling**: if the active provider's key becomes
  invalid, Generate Body/Description surfaces the error inline (existing
  error-banner pattern, generalized beyond Ollama's copy) and the provider's
  status flips to "disconnected" on next check. No automatic provider
  switch-over.
- **Data model**: widen `LlmProvider["id"]` (`apps/daemon/src/llm/types.ts`)
  from the closed `"ollama" | "remote"` union to
  `"ollama" | "openai" | "anthropic" | "gemini"`. `remote` is **renamed/folded
  into `anthropic`** (see §3.1 decision) — it already speaks the Anthropic
  Messages API shape, so this is a rename, not new logic. New
  `apps/daemon/src/llm/{openaiProvider,anthropicProvider,geminiProvider}.ts`
  implementing `LlmProvider`, reading their key from the new secrets store
  (not `process.env`). New `apps/daemon/src/llm/secrets.ts` owning the
  on-disk key file read/write — daemon-only, never touches `packages/core`.

### Out of scope (explicitly — do not let `/build` smuggle these in)
- Symbion acting as a proxy/router that *other* tools (Cursor, Claude Code,
  Copilot, Cline, etc.) connect through. No OAuth-provider routing, no MITM,
  no proxy pools, no usage/quota tracking, no "Combos."
- OAuth-based provider auth flows of any kind. All v1 cloud providers are
  simple-API-key only.
- Automatic fallback chains. Explicitly rejected — collides with "never act
  silently."
- OS keychain / encrypted-at-rest key storage. Plaintext local file is the
  v1 decision; encryption can be a follow-up if `/cso` or the user later
  requires it (flagged as a risk in §9, not silently added).
- Background/automatic re-checking of provider status on app load or on a
  timer. Status checks remain on-demand (button click).
- Per-model discovery/listing from cloud providers. v1 uses a static,
  hardcoded model list per provider, same pattern as today's `listModels()`.
- "Test All" button — per-provider only, no batch/concurrent test action.

## 3. Architecture

### 3.0 Scope confirmation (push-back check)

Confirmed: **`packages/core` needs ZERO changes.** Provider config, active
selection, and secrets are daemon-owned runtime + local-file state, not part
of the Canonical IR — same reasoning as `connect-providers-STATE.md` §10.0.
All new code lives in `apps/daemon` (provider adapters, secrets file I/O,
RPC handlers), `packages/rpc-types` (shared contract), and `apps/web`
(Settings page, Providers panel UI).

### 3.1 Decision: fold `remote` into `anthropic`, don't keep both

`RemoteProvider` (`apps/daemon/src/llm/remoteProvider.ts`) already implements
the Anthropic Messages API shape (`x-api-key` header, `anthropic-version`,
`/v1/messages` body shape, Claude model ids). Keeping a separate generic
`"remote"` id alongside a new `"anthropic"` id would mean two
near-duplicate adapters hitting the same API. Decision: **rename
`RemoteProvider` → `AnthropicProvider`** (file rename
`remoteProvider.ts` → `anthropicProvider.ts`, `id: "remote"` →
`id: "anthropic"`), and change its one structural difference: read the API
key from the new secrets store instead of `process.env`. This is a refactor
+ behavior change (key source), not new business logic — the HTTP call shape
is untouched.

`REMOTE_API_KEY_ENV_VAR`/`process.env.SYMBION_REMOTE_LLM_API_KEY` is
**removed** as the key source for the daemon's runtime call path. (No env-var
back-compat is preserved — STATE explicitly says v1 cloud providers are
simple-API-key-via-settings-UI; keeping a silent env-var fallback would
violate "single explicit active provider" by creating an invisible second
configuration path. Flagged as a trade-off in §8.)

This also means: wherever `"remote"` appears in `packages/rpc-types`,
`apps/daemon`, and `apps/web` call sites (`ListModelsParams.providerId`,
`GenerateBodyParams.providerId`, `ModelPicker`, `AgentForm`/`WorkflowForm`,
`firstUseDisclosureCopy`), it is replaced by the new 4-id union — not kept as
a 5th id. Grep confirms today's `apps/web` call sites hardcode
`providerId="ollama"` inline (`AgentForm.tsx:93`, `WorkflowForm.tsx:64`) —
those become "resolve from the active-provider settings value" (§4d).

### 3.2 Files to create / modify

**`apps/daemon` (provider adapters + secrets + RPC):**
- NEW `apps/daemon/src/llm/secrets.ts`
  - Owns the on-disk providers/secrets file (path + schema in §3.3).
  - `loadProvidersConfig(): ProvidersConfig` — read + parse + validate; on
    missing file, corrupt JSON, or schema mismatch, **returns the default
    empty config** (`{ activeProviderId: null, providers: {} }`), never
    throws (§5 edge case).
  - `saveProvidersConfig(config: ProvidersConfig): void` — atomic temp→rename
    write (reuses the exact `atomicWriteJson` pattern already in
    `apps/daemon/src/store/store.ts`; not a new write-primitive, just a new
    call site), with a `mode: 0o600` file-permission set on create (owner
    read/write only — flagged for `/cso` to confirm this is sufficient given
    plaintext-at-rest is the locked decision).
  - `setProviderKey(providerId, apiKey, model): ProvidersConfig` — upserts
    one provider's entry; never logs `apiKey`.
  - `clearProviderKey(providerId): ProvidersConfig` — removes one provider's
    stored key/model; if it was active, resets `activeProviderId` per §5's
    "deleted active provider" rule.
  - `setActiveProvider(providerId): ProvidersConfig` — validates the
    provider has a stored key (or is `ollama`, which needs none) before
    accepting; throws a typed error otherwise (surfaced as RPC
    `invalid-params`, not a silent no-op).
  - `maskKey(apiKey: string): string` — `sk-...ab12` style masking (last 4
    chars only, fixed prefix ellipsis); the ONLY function permitted to touch
    a raw key for display purposes; every RPC result shape passes keys
    through this before crossing into JSON.
- NEW `apps/daemon/src/llm/openaiProvider.ts` — `LlmProvider` impl,
  `id: "openai"`, key read via `secrets.ts`, calls OpenAI's
  `/v1/chat/completions` (or `/v1/responses` — dev's call, not an
  architecture concern) with `Authorization: Bearer <key>`; static
  `listModels()` (e.g. `gpt-4o-mini`/`gpt-4o`/`gpt-4.1` placeholders, same
  "dev-time content decision" framing as `ollamaProvider.ts`'s model list).
- NEW `apps/daemon/src/llm/geminiProvider.ts` — `LlmProvider` impl,
  `id: "gemini"`, key read via `secrets.ts`, calls Gemini's
  `generateContent` REST endpoint with `?key=<apiKey>` query param (Gemini's
  documented simple-API-key auth shape — no OAuth); static `listModels()`.
- RENAME `apps/daemon/src/llm/remoteProvider.ts` →
  `apps/daemon/src/llm/anthropicProvider.ts` — `id: "remote"` → `id:
  "anthropic"`; key source changes from `process.env` to `secrets.ts`; HTTP
  call shape unchanged.
- MODIFY `apps/daemon/src/llm/types.ts` — `LlmProvider["id"]` widened to
  `"ollama" | "openai" | "anthropic" | "gemini"`. Add a `kind: "local" |
  "api-key"` field to `LlmProvider` (or a parallel registry-descriptor field
  — see §3.4) so the web UI can render API-key-entry vs. local-setup-guide
  differently per the locked STATE decision. Add `LlmErrorCode` value
  `"not-configured"` (new — distinct from `"auth"`, see §5) for "active
  provider has no key/never configured" vs. "key present but rejected by
  the provider," which currently collapse into the same `"auth"` code; this
  is the **one new `LlmErrorCode`** this feature adds (everything else in
  `types.ts` is otherwise additive-only, no renames of existing codes).
- MODIFY `apps/daemon/src/llm/registry.ts` — factory becomes
  registry-driven: a descriptor array (see §3.4) replaces the hardcoded
  `switch`; `getProvider(id)` looks up the descriptor and constructs the
  matching class. `listProviderDescriptors()` (new export) returns the
  static metadata (id, label, kind) for all 4 providers — used by the new
  `listProviders` RPC (§3.5) so `apps/web` never hand-duplicates the
  provider list.
- MODIFY `apps/daemon/src/llm/providerStatus.ts` — generalize
  `checkOllamaReachable` (unchanged, Ollama-specific path kept exactly as
  shipped) by adding a sibling `checkApiKeyProviderReachable(provider:
  LlmProvider, timeoutMs): Promise<{reachable: boolean; errorCode?:
  LlmErrorCode}>` that performs the provider's own cheap authenticated call
  (e.g. each new provider exposes a `testConnection(): Promise<void>` method
  alongside `generate`/`listModels` on `LlmProvider`, OR status-check reuses
  `listModels()`'s static list plus a minimal authenticated GET — dev's call
  on exact endpoint per provider, NOT an architecture decision; the
  *shape* — "one authenticated cheap call, mapped through the same
  `LlmErrorCode` taxonomy" — is locked).
- MODIFY `apps/daemon/src/rpc/handlers.ts`:
  - `checkProviderStatus` — widen `providerId` validation from the literal
    `"ollama"` to the 4-id union; branch internally: `"ollama"` keeps the
    existing `checkOllamaReachable` path unchanged; the 3 API-key providers
    route to `checkApiKeyProviderReachable`, first checking
    `secrets.ts`-stored config has a key for that id (if not: short-circuit
    to `{ reachable: false, errorCode: "not-configured" }`, no network call
    — never attempt to call a provider with no key, that's a wasted
    round-trip with a guaranteed-auth-failure outcome).
  - NEW `listProviders` handler — returns all 4 providers' static
    descriptor + current persisted state (masked key, model, whether
    configured, whether active) in one call, backing the Settings page's
    initial render (§3.5).
  - NEW `saveProviderKey` handler — validates `providerId` against the
    4-id union, validates `apiKey` is a non-empty string under a size cap
    (mirrors the existing `MAX_FIELD_LEN` pattern in `generateBody`), calls
    `secrets.setProviderKey`, returns the masked config (never the raw key
    back).
  - NEW `clearProviderKey` handler — calls `secrets.clearProviderKey`,
    returns masked config.
  - NEW `setActiveProvider` handler — calls `secrets.setActiveProvider`,
    returns masked config; throws `invalid-params` if the target provider
    has no stored key (except `ollama`, which needs none).
  - `generateBody`/`listModels` — `assertValidProviderId` widened to the
    4-id union; `getProvider(params.providerId)` unchanged call shape (the
    registry handles the new ids transparently per §3.4). **Resolution of
    which provider id to use is unchanged here** — these RPCs still take an
    explicit `providerId` param from the caller; `apps/web` is responsible
    for passing the currently-active provider id (read from
    `listProviders`'s result), not the daemon silently substituting it
    (keeps "no automatic fallback" honest at the RPC layer too — see §4d).
  - Validation sets (`VALID_PROVIDER_IDS`) updated to the 4-id union;
    `"remote"` removed.
- MODIFY `apps/daemon/src/server.ts` — add `"listProviders"` to
  `READ_ONLY_METHODS` (reads the secrets file but performs no mutation, same
  rationale comment as `listModels`'s existing membership). `saveProviderKey`/
  `clearProviderKey`/`setActiveProvider` are **NOT** added to
  `READ_ONLY_METHODS` (they mutate `providers.json`) — they still require the
  session token like every other non-`ping`/non-read-only method (no
  behavior change to the auth gate itself, just correct set membership for
  the new methods).
- MODIFY `apps/daemon/src/rpc/contract.ts` — re-export the new types from
  `packages/rpc-types`.

**`packages/rpc-types` (shared contract):**
- MODIFY `packages/rpc-types/src/index.ts`:
  - `ListModelsParams.providerId`, `GenerateBodyParams.providerId`: widen
    `"ollama" | "remote"` → `"ollama" | "openai" | "anthropic" | "gemini"`.
  - `CheckProviderStatusParams.providerId`: widen literal `"ollama"` → the
    4-id union.
  - `CheckProviderStatusResult`: add optional `errorCode?: LlmErrorCode`
    (mirrors the new `"not-configured"` code) and `kind: "local" |
    "api-key"` (so the web panel can render the right UI without a second
    RPC round-trip).
  - NEW `ProviderDescriptor`: `{ id; label; kind: "local" | "api-key";
    configured: boolean; active: boolean; maskedKey?: string; model?:
    string }` — one entry per provider, what `listProviders` returns.
  - NEW `ListProvidersParams {}` / `ListProvidersResult { providers:
    ProviderDescriptor[] }`.
  - NEW `SaveProviderKeyParams { providerId; apiKey; model? }` /
    `SaveProviderKeyResult { providers: ProviderDescriptor[] }`.
  - NEW `ClearProviderKeyParams { providerId }` / `ClearProviderKeyResult {
    providers: ProviderDescriptor[] }`.
  - NEW `SetActiveProviderParams { providerId }` / `SetActiveProviderResult
    { providers: ProviderDescriptor[] }`.
  - `RpcMethod` union gains `"listProviders" | "saveProviderKey" |
    "clearProviderKey" | "setActiveProvider"`.
  - NEW `LlmErrorCode` re-export (currently only lives in
    `apps/daemon/src/llm/types.ts` — if `apps/web` needs the `"not-configured"`
    value for messaging, re-export the type here the same way other daemon
    types cross the boundary; if web only needs it as an opaque string for
    map lookups, this is optional — dev's call, not architecture-blocking).

**`apps/web` (UI):**
- NEW `apps/web/src/app/settings/page.tsx` — first real second route in
  `apps/web/src/app/` (today only `/` exists). Renders `<SettingsShell />`
  (or directly the providers panel — dev's call on exact composition).
  Next.js App Router file-based routing; Server Component shell per CLAUDE.md
  convention, with the actual interactive panel as a `"use client"` child
  (mirrors the existing `AppShell` pattern: `page.tsx` stays a thin wrapper).
- NEW `apps/web/src/components/AppNav.tsx` (or fold into a small change to
  `AppShell.tsx` — dev's call) — the new top-level nav. Minimal: a persistent
  small header/sidebar entry linking `/` (builder) and `/settings`
  (Settings). This is the first nav-shell component in the app; keep it
  deliberately small (two links) per STATE's explicit "don't build a generic
  settings-app-shell framework" framing — this is infrastructure sized to
  exactly one current consumer (Providers), not a speculative multi-section
  shell.
- NEW `apps/web/src/components/ProvidersPanel.tsx` — the card-grid (4 cards:
  Ollama, OpenAI, Anthropic, Gemini) replacing `ConnectProviderPanel`'s
  Ollama-only Dialog as the canonical home for provider setup. Each card:
  status badge (connected/disconnected/not-configured), for API-key
  providers an input (type="password", masked) + Save + per-provider "Test
  connection" button + "Xoá key" (clear) button; for Ollama, the existing
  guide-only copy + install-command block (literally reuses the existing
  `installInstructions`-rendering JSX from `ConnectProviderPanel.tsx`, moved
  here rather than duplicated — see §3.6). A radio (or equivalent) per card
  sets that provider active; disabled for unconfigured API-key providers
  (can't activate a provider with no key).
- MODIFY `apps/web/src/components/ProviderStatusPill.tsx` — drop the
  `providerId !== "ollama"` early-return guard (STATE §5 explicit
  instruction); becomes generic over the 4-id union, fetches `kind` from
  `CheckProviderStatusResult` to decide click-target (opens `ProvidersPanel`
  focused on that provider, or keeps opening a lightweight read-only variant
  — dev's call on exact navigation, not architecture).
- MODIFY or RETIRE `apps/web/src/components/ConnectProviderPanel.tsx` —
  its Ollama-only guide content is preserved (STATE §5: "Ollama's existing
  guide-only setup copy is preserved as-is") but as a sub-section *inside*
  `ProvidersPanel`'s Ollama card, not a separate standalone Dialog triggered
  from the builder. Dev's call whether to literally delete this file and
  inline its JSX into `ProvidersPanel`, or keep it as a small presentational
  sub-component imported by `ProvidersPanel` — no behavior difference,
  flagged as a non-architectural implementation choice.
- MODIFY `apps/web/src/components/GenerateBodyButton.tsx` /
  `GenerateDescriptionButton.tsx` / `AgentForm.tsx` / `WorkflowForm.tsx` /
  `ModelPicker.tsx` / `GenerateBodyDisclosure.tsx` — replace every hardcoded
  `providerId="ollama"` literal with a value read from the active-provider
  settings (§4d: a new small hook, e.g. `useActiveProvider()`, backed by one
  `listProviders` call cached in `useArtifactStore` or a dedicated small
  store slice — dev's call on exact state-management mechanics, NOT a new
  RPC-calling pattern; reuses `callRpc` exactly as today). The CTA inside
  `GenerateBodyButton`'s error banner ("Cách kết nối Ollama") generalizes to
  "Mở Cài đặt nhà cung cấp" linking to `/settings` for any provider id, not
  just Ollama.
- MODIFY `apps/web/src/lib/rpc/types.ts` — re-export the new types, same
  existing re-export-only pattern (no hand-duplication).

**No changes to:** `packages/core` (confirmed §3.0); the write/diff/publish
pipeline, Canonical IR, or adapters (`render`/`computeDiff`/`write` RPCs
untouched); `apps/daemon/src/store/store.ts`'s `atomicWriteJson` (reused
as-is, not modified — see §3.3); the existing project-level `.symbion/`
gitignore entry (already covers per-project `.symbion/`; this feature's
secrets file lives under the *user-level* config dir instead, which is
outside any git working tree by construction — see §3.3 for why that's the
chosen location over per-project `.symbion/`).

### 3.3 Local-store schema

**Path**: `~/.config/symbion/providers.json` (i.e.
`join(globalConfigDir(), "providers.json")`, sibling to the existing
`config.json` in `apps/daemon/src/store/store.ts`). **Not** under
per-project `.symbion/`.

Rationale: provider/API-key configuration is a property of *this machine's
Symbion installation*, not of any one project — the same active provider and
keys should apply whether the user has one project open or ten, and a key
must never accidentally get copied into a project's git history if a user
ever zips up or otherwise moves a project's `.symbion/` folder around.
`globalConfigDir()` already exists (`apps/daemon/src/store/store.ts`,
backing `config.json`/`GlobalConfig`) and is never inside a git working tree
(it's `~/.config/symbion`, a user-home location) — strictly safer for
secrets than a per-project, git-adjacent folder whose gitignore-coverage
depends on each project's own `.gitignore` (whereas a project-root
`.symbion/` is covered by *Symbion's own* root `.gitignore` only when the
*project itself* is the Symbion monorepo, which it normally isn't — target
repos are arbitrary user repos with their own `.gitignore`, which is NOT
guaranteed to exclude `.symbion/`). This directly resolves the STATE's
"local config file under `.symbion/` (or the user-level config dir)" either/
or into a concrete choice: **user-level config dir, not per-project
`.symbion/`**, specifically because per-project placement would put a
secrets file inside arbitrary target repos that Symbion does not control the
`.gitignore` of.

**Shape** (`ProvidersConfig`, daemon-internal type, not part of the RPC
contract — RPC results only ever carry the masked `ProviderDescriptor[]`
projection, never this raw shape):

```ts
interface ProvidersConfig {
  schemaVersion: 1;
  /** null = no active provider selected yet (fresh install / all keys cleared). */
  activeProviderId: "ollama" | "openai" | "anthropic" | "gemini" | null;
  providers: {
    [id in "openai" | "anthropic" | "gemini"]?: {
      apiKey: string;        // PLAINTEXT — locked decision, flagged §9
      model: string;         // last-picked model id for this provider
    };
  };
  // "ollama" never appears as a key under `providers` — it needs no stored
  // config (no API key, no per-provider model persistence beyond what
  // ModelPicker already does per-form); it CAN be `activeProviderId` though.
}
```

**Init**: `loadProvidersConfig()` — if the file does not exist, return (and
**do not eagerly write**) the default `{ schemaVersion: 1, activeProviderId:
null, providers: {} }` in memory; the file is only physically created on
first `saveProvidersConfig()` call (i.e. first time the user actually saves
a key or sets an active provider) — consistent with "never write silently"
applied to a *new* file too, not just managed markdown. This is a deliberate
departure from `loadGlobalConfig()`'s existing behavior (which DOES eagerly
write a fresh `config.json` on first read) — flagged as an intentional
inconsistency in §8, justified because `config.json` holds no secrets and
"file exists with default content" is harmless there, whereas eagerly
materializing an empty `providers.json` on every daemon boot (even when the
user never opens Settings) is unnecessary disk churn for a feature most
sessions won't touch.

**No migration system** (matches STATE's "keep init simple" instruction —
no prior migration framework exists in Symbion beyond the existing
`schemaVersion` number-compare-and-backup pattern already used by
`store.json`/`config.json`). `schemaVersion` is included from day one
specifically so a *future* loop has the same one-number escape hatch
`store.ts` already uses (`schemaVersion > CURRENT` → reject; `<` → backup
raw file then reload) — this loop does not need to write that machinery,
just reserve the field.

**Corrupt/missing handling** — `loadProvidersConfig()`:
1. File missing → return default in-memory config (§ above), no error, no
   eager write.
2. File present, unparseable JSON → catch the parse error, **log a single
   warning to the daemon's own stderr (never the key contents — there are
   none to log if parsing failed before reaching field-level data anyway)**,
   return the default in-memory config. Do NOT crash the daemon, do NOT
   throw out of this RPC path.
3. File present, valid JSON, but `schemaVersion` missing/wrong shape (e.g.
   hand-edited, missing fields) → same as #2: warn, fail soft to default.
4. File present, valid JSON, `schemaVersion` is a number greater than
   `CURRENT_SCHEMA_VERSION` (written by a future Symbion version) → same
   `UnsupportedSchemaVersionError`-style rejection `store.ts` already uses
   for `store.json`/`config.json` — refuse to silently downgrade-interpret
   it, surface as "no providers configured" (fail soft, per the explicit
   STATE instruction "must fail soft to 'no providers configured', not
   crash") while logging a distinguishable warning (not byte-identical to
   case #2/#3, so a future support investigation can tell "corrupt" apart
   from "from the future") .

In every case, the **observable behavior to the web UI is identical**: 
`listProviders` returns all 4 providers as `configured: false, active:
false`, `activeProviderId` effectively null — i.e. "no providers
configured," exactly the STATE-mandated fail-soft state. The daemon process
itself never crashes or fails to boot because of a bad `providers.json` —
this file is read lazily (only when an LLM-related RPC is called), not at
daemon-boot time, so a corrupt file can't even block daemon startup.

### 3.4 Registry generalization

```ts
// apps/daemon/src/llm/registry.ts
export interface ProviderDescriptorInternal {
  id: "ollama" | "openai" | "anthropic" | "gemini";
  label: string;          // "Ollama (local)", "OpenAI", "Anthropic", "Gemini"
  kind: "local" | "api-key";
  factory: () => LlmProvider;
}

const REGISTRY: ProviderDescriptorInternal[] = [
  { id: "ollama",    label: "Ollama",    kind: "local",   factory: () => new OllamaProvider() },
  { id: "openai",    label: "OpenAI",    kind: "api-key", factory: () => new OpenAiProvider() },
  { id: "anthropic", label: "Anthropic", kind: "api-key", factory: () => new AnthropicProvider() },
  { id: "gemini",    label: "Gemini",    kind: "api-key", factory: () => new GeminiProvider() },
];

export function getProvider(id: LlmProvider["id"]): LlmProvider {
  const descriptor = REGISTRY.find((d) => d.id === id);
  if (!descriptor) throw new Error(`Unknown LLM provider id: ${id}`);
  return descriptor.factory();
}

export function listProviderDescriptors(): Array<{ id; label; kind }> {
  return REGISTRY.map(({ id, label, kind }) => ({ id, label, kind }));
}
```

Each `api-key`-kind provider's constructor calls `secrets.ts`'s
`loadProvidersConfig()` internally to read its own key/model at construction
time (mirrors `OllamaProvider`'s existing "resolve config in the
constructor" pattern) — `getProvider()` itself stays a pure id→instance
lookup with no secrets-file knowledge, keeping the registry/secrets
responsibilities separated (registry = "which class," secrets = "which
config values").

### 3.5 New/changed RPC methods (full surface for this feature)

| Method | Params | Result | Disk/network touch |
|---|---|---|---|
| `listProviders` (NEW) | `{}` | `{ providers: ProviderDescriptor[] }` | reads `providers.json` only |
| `saveProviderKey` (NEW) | `{ providerId; apiKey; model? }` | `{ providers: ProviderDescriptor[] }` | reads+writes `providers.json` |
| `clearProviderKey` (NEW) | `{ providerId }` | `{ providers: ProviderDescriptor[] }` | reads+writes `providers.json` |
| `setActiveProvider` (NEW) | `{ providerId }` | `{ providers: ProviderDescriptor[] }` | reads+writes `providers.json` |
| `checkProviderStatus` (WIDENED) | `{ providerId: <4-id union> }` | `{ reachable; checkedBaseUrl?; install?; errorCode?; kind }` | reads `providers.json` (api-key path) + 1 outbound HTTP call (loopback for ollama, real internet for cloud) |
| `listModels` (WIDENED) | `{ providerId: <4-id union> }` | unchanged shape | none (static list) |
| `generateBody` (WIDENED) | `providerId: <4-id union>` | unchanged shape | reads `providers.json` (api-key path) + 1 outbound HTTP call |

### 3.6 Scope-creep watch (architect's explicit push-back, mirrors
`connect-providers-STATE.md`'s §10.0 style)

- **No new shadcn/Radix primitive** for the card grid — reuse existing
  `Button`/`Dialog`/plain `<div>`+Tailwind grid. A "Card" primitive doesn't
  exist yet in `apps/web/src/components/ui/`; if the dev judges one is
  needed, that's a small, justified addition (cards are generic UI, not
  settings-specific), but the architecture does not mandate it — plain divs
  satisfy every requirement here.
- **No "Test All" button** — STATE explicitly defers it; do not add it
  "while we're in here."
- **No encryption-at-rest implementation** — flagged to `/cso` (§9) as a
  question to weigh in on, not pre-built speculatively.
- **No env-var key fallback retained** for the new cloud providers (§3.1) —
  a silent second configuration path is exactly the kind of "automatic"
  behavior STATE's "no automatic fallback" spirit warns against, even though
  that locked decision was literally about provider fallback, not key
  sourcing; the same anti-silent-behavior principle applies here by
  extension, flagged as the architect's own interpretive call, not a literal
  STATE clause.

## 4. Data flow (step by step)

### 4a. User enters API key + saves

```
1. User opens /settings, ProvidersPanel mounted.
       │
       ▼
2. On mount: ONE callRpc("listProviders", {}) → renders all 4 cards from
   the resolved ProviderDescriptor[] (masked keys only, never raw).
       │
       ▼
3. User types a raw key into OpenAI's card's password-type input (in-memory
   React state only, never persisted on every keystroke).
       │
       ▼
4. User clicks "Lưu" (Save) on that card.
       │
       ▼
5. apps/web → callRpc("saveProviderKey", { providerId: "openai", apiKey,
   model }) — web → daemon, localhost HTTP POST /rpc, session-token header
   (existing transport, unchanged).
       │
       ▼
6. apps/daemon handlers.saveProviderKey:
   a. validate providerId ∈ 4-id union, apiKey non-empty string under size cap
   b. secrets.setProviderKey(providerId, apiKey, model)
      → loadProvidersConfig() (fail-soft per §3.3) → mutate in memory →
        saveProvidersConfig() → atomicWriteJson(providers.json path)
        (mkdir-recursive + temp-file write + rename, reusing store.ts's
        exact pattern; file permission 0o600 set on the file)
   c. returns masked ProviderDescriptor[] (apiKey field NEVER serialized raw
      — maskKey() applied before the result object is constructed, not as
      an afterthought filter)
       │  (daemon → web, JSON RPC response)
       ▼
7. apps/web replaces the local input's raw-key state with the masked display
   value from the response — the raw key the user typed never round-trips
   back from the daemon, and React state holding it is discarded once the
   save resolves (no lingering raw-key state kept "just in case").
```

### 4b. User clicks "Test connection"

```
1. User clicks "Kiểm tra kết nối" on, say, Anthropic's card (key already saved).
       │
       ▼
2. apps/web → callRpc("checkProviderStatus", { providerId: "anthropic" })
       │
       ▼
3. apps/daemon handlers.checkProviderStatus:
   a. providerId !== "ollama" → load providers.json, check a key exists
      for "anthropic"; if not → return { reachable:false, kind:"api-key",
      errorCode:"not-configured" } WITHOUT any network call.
   b. if a key exists → construct AnthropicProvider (reads its own key from
      secrets internally per §3.4) → perform ONE cheap authenticated call
      (e.g. a minimal models-list/ping request, NOT a full generate()) with
      a short AbortController timeout (reuse the existing 3000ms convention
      from the Ollama path, or provider-specific — dev's call, not <
      architecturally mandated minimum/maximum beyond "bounded and visible"
      per the prior loop's AC-3 precedent).
   c. maps the outcome through the existing LlmErrorCode taxonomy:
      2xx-equivalent success → reachable:true; 401/403 → reachable:false,
      errorCode:"auth"; timeout/abort → reachable:false, errorCode:"timeout";
      429 → reachable:false, errorCode:"rate-limit"; network failure →
      reachable:false, errorCode:"network".
       │
       ▼
4. apps/web updates that card's status badge from the resolved result —
   never a global all-providers refresh (status lives per-card, per-RPC-call,
   same "no shared cache" precedent as ProviderStatusPill/ConnectProviderPanel
   today).
```

### 4c. User sets active provider

```
1. User clicks the radio/"Đặt làm mặc định" control on Gemini's card
   (Gemini already has a saved key).
       │
       ▼
2. apps/web → callRpc("setActiveProvider", { providerId: "gemini" })
       │
       ▼
3. apps/daemon handlers.setActiveProvider:
   a. validate providerId ∈ 4-id union
   b. secrets.setActiveProvider("gemini") — checks providers.json has a key
      for "gemini" (or providerId === "ollama", which needs none); if no key
      → throw RpcError("invalid-params", "Chưa cấu hình API key cho nhà
      cung cấp này.") — setting an unconfigured provider active is rejected,
      not silently accepted-then-broken-at-generate-time.
   c. atomically updates activeProviderId in providers.json, saves.
   d. returns masked ProviderDescriptor[] (now `gemini.active === true`,
      every other provider's `active === false`).
       │
       ▼
4. apps/web re-renders all 4 cards from the response — exactly one card now
   shows "Đang hoạt động" (active).
```

### 4d. Generate Body/Description resolves and calls the active provider

```
1. User opens the Agent/Workflow builder form (separate page/route from
   /settings — NOT re-fetched on every keystroke).
       │
       ▼
2. A new small client-side hook/store-slice, useActiveProvider() (or
   equivalent — exact mechanics are dev's call), fires ONE
   callRpc("listProviders", {}) on mount of the builder form (same call
   `ProvidersPanel` makes — no new RPC method, just a second consumer of the
   existing `listProviders` result) and derives `activeProviderId` from it.
   This is a deliberate, visible network call on form mount — NOT silent
   background polling — consistent with the "no silent network calls"
   principle; it fires once per form mount, not on an interval.
       │
       ▼
3. AgentForm/WorkflowForm passes that resolved `activeProviderId` (NOT a
   hardcoded "ollama" literal — this replaces today's
   `providerId="ollama"` inline prop) into ModelPicker, GenerateBodyButton,
   GenerateDescriptionButton, GenerateBodyDisclosure.
       │
       ▼
4. User clicks "✨ Tạo nội dung" → GenerateBodyButton's existing fireRequest()
   flow, UNCHANGED internally, calls callRpc("generateBody", { ...,
   providerId: activeProviderId }).
       │
       ▼
5. apps/daemon handlers.generateBody — UNCHANGED call shape; getProvider
   (params.providerId) now resolves through the widened registry (§3.4); the
   constructed provider reads its own key from providers.json internally if
   it's an api-key-kind provider.
       │
       ▼
6. Success → body text returned, applied to the form (unchanged).
   Failure → existing ERROR_MESSAGES taxonomy in GenerateBodyButton.tsx,
   generalized: "auth" now also covers "key present but rejected"; the NEW
   "not-configured" code gets its own message ("Chưa cấu hình nhà cung cấp
   AI nào — vào Cài đặt để thêm.") with a CTA linking to /settings (replaces
   today's Ollama-specific "Cách kết nối Ollama" CTA with a provider-generic
   "Mở Cài đặt" CTA, per §3.2's MODIFY note on GenerateBodyButton.tsx).
```

### 4e. Active provider's key turns invalid mid-session

```
1. User has Anthropic active, key was valid when last tested/saved.
       │
       ▼
2. (Out-of-Symbion event: key gets revoked on Anthropic's own console.)
       │
       ▼
3. User clicks "✨ Tạo nội dung" in the builder (no re-check forced before
   this click — on-demand only, locked decision).
       │
       ▼
4. generateBody → AnthropicProvider.generate() → Anthropic API returns
   401/403 → LlmError("auth", ...) thrown → RpcError("llm-auth", ...) →
   GenerateBodyButton's error banner shows the inline message INLINE, in the
   builder form, immediately (no silent failure, no crash) — same code path
   as today's Ollama-not-running banner, generalized.
       │
       ▼
5. provider's status in /settings's ProvidersPanel is NOT auto-updated by
   this failed generate call (no cross-component event bus exists or is
   added) — it remains showing its last-known "Đã kết nối" status until the
   user EITHER returns to /settings and clicks "Kiểm tra kết nối" again
   (which will now correctly resolve reachable:false, errorCode:"auth") OR
   the pill/badge is re-mounted (e.g. page navigation re-triggers the
   mount-effect). This staleness is the SAME deliberate trade-off
   `connect-providers-STATE.md` §10.6 documented for EC-1 — re-affirmed here,
   not silently re-litigated.
       │
       ▼
6. No automatic switch to a different provider occurs at any point in this
   flow (locked decision, verified by construction — there is no code path
   in `generateBody`'s handler or `GenerateBodyButton`'s error handling that
   reads or mutates `activeProviderId` on failure).
```

## 5. Edge cases — explicit disposition

| Edge case | Disposition |
|---|---|
| Active provider's API key invalid/revoked at generate-time | §4e — inline `llm-auth` error banner in the builder; provider's `/settings` status badge stays stale until next manual check there (no auto-update, no cross-tab/cross-component event). No auto-switch. |
| User switches active provider mid-session | §4c persists `activeProviderId` to `providers.json` immediately; next builder-form mount's `listProviders` call (§4d step 2) picks it up — no daemon restart needed. If the SAME builder tab/form is already open with a stale `activeProviderId` in its local state, it will use the OLD active provider until that component re-mounts or re-fetches — flagged as a known staleness window (acceptable: settings changes are rare, infrequent relative to generate-clicks; if dev wants to eagerly re-fetch on every Generate click instead of once-on-mount, that's a low-risk local improvement, not an architecture requirement). |
| User deletes/clears a provider's stored API key | `clearProviderKey` handler: if the cleared provider WAS active, `secrets.clearProviderKey` resets `activeProviderId` to `null` (NOT a fallback to Ollama — STATE's own locked "no automatic fallback chain" principle extends here: silently re-pointing the active provider at Ollama without the user choosing that is itself a quiet auto-switch). Result: `activeProviderId: null` means `generateBody`'s caller (the builder form) receives `activeProviderId: null/undefined` from `listProviders`, and `GenerateBodyButton`/`GenerateDescriptionButton` must treat that as a NEW disabled-with-message state — "Chưa chọn nhà cung cấp AI — vào Cài đặt để chọn" — distinct from both the daemon-down state and any single-provider error state. This is a small but real net-new UI state the dev must add (not present in `connect-providers`'s 2-state daemon-up/down framing) — flagged explicitly here since STATE asked the architect to pick the exact behavior. |
| Settings file hand-edited / corrupted (malformed JSON) | §3.3's `loadProvidersConfig()` fail-soft contract — never crashes, returns default empty config, daemon boots and runs fine regardless (file is read lazily, never at boot). |
| "Test connection" times out / rate-limits (cloud provider) | Same `LlmErrorCode` taxonomy (`timeout`/`network`/`auth`/`rate-limit`) as `generateBody` already uses, surfaced per-provider-card, not a global failure — §4b step 3c. |
| Concurrent "Test All" | Not in v1 scope — no such button exists; nothing to design against. |
| Provider has NO key AND user clicks "Test connection" anyway | Short-circuits to `{ reachable:false, errorCode:"not-configured" }` with zero network calls (§4b step 3a) — never attempts an authenticated call that's guaranteed to fail, avoiding a wasted/misleading round-trip and matching `not-configured`'s distinct meaning from `auth` (key present-but-wrong) per §3.2's new `LlmErrorCode`. |
| User tries to set an unconfigured provider active | Rejected at the RPC layer with `invalid-params` (§4c step 3b) — never silently accepted then broken at next generate-time. |
| Two browser tabs/windows both open `/settings` | Each independently calls `listProviders` on its own mount; no shared in-memory cache, no websocket push between them (same "no shared cache" precedent as the prior loop) — a save in tab A is not reflected in tab B until tab B re-fetches (manual refresh or re-navigation). Acceptable for v1 single-user-single-machine tool; flagged, not solved. |
| `apiKey` containing only whitespace, or absurdly long (paste error) | `saveProviderKey` handler validates non-empty (after trim) and under a size cap (mirrors `generateBody`'s existing `MAX_FIELD_LEN` pattern) — rejected with `invalid-params` before ever reaching `secrets.ts`. |

## 6. Acceptance criteria (for Checker) — carried over from THINK, unchanged

1. Settings nav item exists and renders a Providers panel listing all 4
   providers (Ollama, OpenAI, Anthropic, Gemini) with current status.
2. Entering an API key for OpenAI/Anthropic/Gemini and clicking "Test
   connection" performs a real authenticated check via the daemon (not the
   web layer) and updates the status badge accordingly (connected/invalid/
   unreachable).
3. API keys are persisted to a local file under daemon control; restarting
   the daemon/reloading the web app does not lose a previously entered key.
4. API keys are never returned in plaintext by any RPC response after
   initial save (masked, e.g. last 4 chars only) — verify via direct RPC
   inspection, not just UI.
5. Exactly one provider can be marked "active" at a time; Generate Body and
   Generate Description use that provider for the call.
6. If the active provider's key is invalid, Generate Body/Description shows
   a clear inline error (not a silent failure or crash), and the provider's
   status updates to disconnected on the next status check.
7. No automatic fallback occurs — if the active provider fails, Symbion does
   not silently call a different provider.
8. Ollama's existing guide-only setup flow (from `connect-providers`)
   continues to work unchanged inside the new panel.
9. `packages/core` has zero new imports of fs/net — verified by the
   existing architecture-rule lint/check.
10. `npm run build` and `npm run test` pass with no regressions.

## 7. Trade-offs and assumptions (for dev / Checker to track)

- **Trade-off**: dropping `process.env.SYMBION_REMOTE_LLM_API_KEY` as a key
  source entirely (§3.1), rather than keeping it as a silent fallback
  alongside the new settings-file source. Rejected dual-source because a
  hidden second configuration path undermines "exactly one active provider,
  explicitly chosen" — but this IS a breaking change for anyone (e.g. CI/dev
  scripts) currently relying on that env var. No production usage of it
  exists today per STATE (`remote` was "stub-grade," no web control sends
  it) — low real-world impact, but flagged explicitly since it's a removed
  capability, not just an addition.
- **Trade-off**: secrets file lives under the user-level config dir, not
  per-project `.symbion/` (§3.3) — means provider config is shared across
  ALL projects on one machine, not per-project. STATE's problem statement
  ("As a Symbion user...") is phrased per-user, not per-project, supporting
  this choice; flagged in case product intent was actually per-project
  (would require a different path resolution keyed by `findProjectPath`,
  a materially bigger change touching every LLM RPC's signature to also
  carry `projectId`).
- **Trade-off**: `providers.json` write uses 0o600 file permissions but NO
  encryption — STATE explicitly locks "plaintext," this just adds the
  cheapest available extra guard (OS-level file permission, not a new
  dependency, not a new UX flow) without expanding scope. Flagged to `/cso`
  per §9 — if `/cso` wants more, that is a follow-up loop's decision, not
  silently added here.
- **Assumption**: each cloud provider's "test connection" cheap call (exact
  endpoint per provider — OpenAI/Anthropic/Gemini each have their own
  lightweight options, e.g. list-models endpoints) is a dev-time
  implementation detail, not pinned here, because pinning the wrong specific
  endpoint now risks being wrong/stale by build time; the locked
  *architectural* requirement is "one authenticated, cheap (not a full
  generate) call, mapped through the existing `LlmErrorCode` taxonomy,
  bounded by a short timeout." Checker should verify whichever endpoint the
  dev picks satisfies this shape, not match a specific URL.
- **Assumption**: `apps/web` has no existing client-side router-aware nav
  primitive (confirmed by grep — no "Settings"/nav component exists
  anywhere in `apps/web/src`); the new `AppNav.tsx` is genuinely new, not a
  rename of something already there. Kept deliberately tiny (§3.2) to avoid
  "build a nav framework" scope creep.
- **Assumption**: `useActiveProvider()`'s exact state-management
  implementation (§4d) is left to the dev — whether it's a new Zustand
  store slice (matching `useArtifactStore`'s existing pattern) or a simple
  custom hook with local `useEffect`+`useState` is not architecturally
  significant; either satisfies "one `listProviders` call per builder-form
  mount, no polling."

## 8. Test plan

See `docs/loops/multi-provider-settings-testplan.md` — the literal,
step-by-step handoff artifact `/qa` executes. Summary of coverage by tier:
- **Unit (Vitest, `apps/daemon`)**: `secrets.ts` (load/save/corrupt/missing/
  mask), registry generalization, each new provider adapter's
  success/auth/timeout/rate-limit paths (fake HTTP server, same Tier A
  pattern as `llm-ollamaProvider.test.ts`), `checkProviderStatus`'s widened
  branching (ollama path unchanged + 3 new api-key paths +
  not-configured short-circuit), all new RPC handlers' validation
  (invalid providerId, empty/oversized apiKey, set-active-without-key
  rejection).
- **Integration (Vitest, `apps/daemon`, RPC-level)**: full
  save→test→activate→generate round-trip against fake HTTP servers per
  provider; auth-gate confirmation (new mutating RPCs require session
  token); masked-key-never-raw assertion at the RPC-response-shape level
  (not just UI).
- **Manual (no Playwright in this stack)**: Settings nav discoverability,
  4-card panel rendering, per-card test/save/clear/activate flows, Ollama
  guide-copy preserved, Generate Body/Description using the active
  provider, invalid-key inline-error flow, corrupt-file fail-soft (delete/
  corrupt `providers.json` between daemon restarts).

## 9. Security note (for `/cso`) — unchanged from THINK, carried forward

This is the first Symbion feature persisting secrets to local disk. Flag
explicitly for `security-reviewer`:
- File permissions on `providers.json` (this PLAN proposes `0o600` — confirm
  sufficiency).
- Gitignore coverage — this PLAN places the file OUTSIDE any git working
  tree (`~/.config/symbion/`, not a per-project `.symbion/`) specifically to
  avoid depending on any repo's `.gitignore` at all; confirm this reasoning
  holds and that no code path ever writes the secrets file or a copy of it
  into a project directory.
- Absence of the key in logs/error messages/RPC echoes — `secrets.ts`'s
  `maskKey()` is the only function permitted to touch a raw key for output;
  confirm no `console.log`/error-message string ever interpolates a raw
  `apiKey` value anywhere in the new provider adapters or handlers (the
  existing `RemoteProvider`/`AnthropicProvider` pattern of never logging the
  key is the bar to match for the 2 new adapters).
- Confirmation that `apps/web` never receives the raw key value after it's
  been saved once — verify at the RPC-response-shape level (§6 AC-4), not
  just by reading the React component code.
- Plaintext-at-rest is the locked v1 decision (no encryption); this PLAN
  adds only an OS file-permission guard (0o600) as a free, scope-respecting
  improvement — `/cso` should explicitly say whether that's sufficient or
  whether a follow-up encryption loop should be opened, rather than this
  PLAN silently deciding either way.
- The removal of the `SYMBION_REMOTE_LLM_API_KEY` env-var key source (§3.1,
  §7) changes a trust boundary (env var, settable by anything that can set
  the daemon process's environment) to a different one (a local file,
  settable only via the new RPC handlers) — worth a second look to confirm
  this is a net security improvement, not a regression, given the env var
  is removed rather than merely deprecated.

## 10. Next step

Architecture is locked. Proceed to `/build` (feature-builder implements per
§3), then `/review` (code-reviewer checks implementation against this PLAN),
then `/cso` (security-reviewer — mandatory given §9, should run before or
alongside `/build`'s sign-off per STATE's own original instruction), then
`/qa` (executes `multi-provider-settings-testplan.md`), then `/ship`.

## 11. BUILD — implementation notes (feature-builder)

Implemented per §3 file-by-file, with the following dev's-call decisions,
deviations, and verification status. **Do NOT treat this section as a
self-review** — `/review`/`/cso`/`/qa` are the independent Checkers.

### 11.1 Dev's-call decisions (PLAN explicitly left these open)

- **Cheap "test connection" call per cloud provider** (§3.2/§4b, marked
  "dev's call"): implemented as a `checkApiKeyProviderReachable()` that
  reuses each provider's own `generate()` with a minimal `"ping"`/`"ping"`
  prompt against the first model from `listModels()`, rather than a
  bespoke ping/list-models HTTP call per vendor. Rationale: every adapter
  already implements `generate()` with the exact LlmErrorCode-mapped
  try/catch shape the PLAN requires ("one authenticated, cheap call, mapped
  through the existing LlmErrorCode taxonomy, bounded by a short timeout");
  duplicating bespoke ping logic per vendor would be three more HTTP-shape
  implementations to maintain for no behavioral gain. Timeout is 3000ms,
  matching the existing Ollama-path convention.
- **OpenAI endpoint** (§3.2, "dev's call"): `/v1/chat/completions` with
  `Authorization: Bearer <key>`, model ids `gpt-4o-mini`/`gpt-4o`/`gpt-4.1`
  (placeholder/dev-time content decision, same framing as
  `ollamaProvider.ts`'s model list — Checker should independently verify
  these are reasonable current model ids).
- **Gemini endpoint** (§3.2, "dev's call"): `generateContent` REST endpoint
  with `?key=<apiKey>` query param (Gemini's documented simple-API-key auth
  shape), model ids `gemini-1.5-flash`/`gemini-1.5-pro`/`gemini-2.0-pro`
  (same placeholder framing).
- **Nav composition** (§3.2, "dev's call"): added `AppNav.tsx` (new, 2
  links: Builder `/`, Cài đặt `/settings`) and wired it into `AppShell.tsx`
  (wrapped the existing sidebar+main layout in a flex-column with `AppNav`
  on top) AND into a new `SettingsShell.tsx` (the `/settings` route's
  client content) so both top-level routes show the same nav. `page.tsx`
  for `/settings` stays a thin Server Component wrapper around
  `SettingsShell` per the existing `AppShell` convention.
- **`ConnectProviderPanel.tsx` retirement** (§3.2, "dev's call"): deleted
  the file entirely; its guide-only Ollama copy (description text +
  install-command block + copy-to-clipboard + recheck button) was moved
  verbatim (not duplicated) into `ProvidersPanel.tsx`'s new `OllamaCard`
  sub-component.
- **`useActiveProvider()` mechanics** (§4d, "dev's call"): implemented as a
  plain custom hook (`apps/web/src/lib/hooks/useActiveProvider.ts`) with
  local `useState`/`useEffect`, NOT a new Zustand store slice. Rationale:
  the existing `useArtifactStore` Zustand slice is for cross-component
  *shared* state (projects, current project); `activeProviderId` is
  consumed independently per-form-mount with no cross-component sharing
  requirement in v1 (each AgentForm/WorkflowForm instance fires its own
  `listProviders` call), so a plain hook is simpler and matches the PLAN's
  explicit "either satisfies the requirement" framing.
- **`ProviderStatusPill`'s click-target** (§3.2, "dev's call" on exact
  navigation): changed from "open a `ConnectProviderPanel` dialog" to "link
  to `/settings`" (a plain Next.js `<Link>`), since per-provider guided
  setup now lives exclusively in `ProvidersPanel` under `/settings`, not a
  popover triggered from the builder.
- **No new shadcn/Radix Card primitive** — `ProvidersPanel.tsx` uses a
  plain `<div>` + Tailwind grid (`CardShell` helper), per §3.6's explicit
  "plain divs satisfy every requirement" guidance.

### 11.2 Deviations from the PLAN

- **None identified.** All file paths, RPC method names/shapes, the
  `ProvidersConfig` schema (`schemaVersion`/`activeProviderId`/`providers`),
  the registry descriptor-array shape, the fail-soft `loadProvidersConfig()`
  contract (lazy file creation, never throws), the `0o600` permission via
  `atomicWriteJson`'s reused primitive, and the `not-configured` /
  `clearProviderKey` "no fallback to ollama" disposition were all
  implemented exactly as specified in §3/§4/§5.
- One small addition beyond the PLAN's literal text: `atomicWriteJson` in
  `apps/daemon/src/store/store.ts` was changed from module-private to
  **exported**, and given an optional `opts.mode` parameter, so
  `secrets.ts` could reuse it with `0o600` instead of re-implementing
  temp→rename logic. The PLAN explicitly calls this out as the intended
  reuse target ("reuses the exact atomicWriteJson pattern already in
  store.ts ... not a new write-primitive, just a new call site") — exporting
  it was necessary to honor that instruction literally, since the function
  was not exported before this feature. `store.ts`'s own existing call
  sites (`saveProjectStore`/`saveGlobalConfig`) are unchanged (no `mode`
  passed, so behavior for them is identical to before).

### 11.3 Build + test status

- `npm run build` (root, all 4 workspaces: `@symbion/core`,
  `@symbion/rpc-types`, `@symbion/daemon`, `@symbion/web`) — **PASS**, zero
  type errors.
- `npm run test` (root, Vitest across `packages/core` + `apps/daemon`) —
  **PASS**, **258/258 tests passed** (0 failed), broken down as:
  - `packages/core`: 76 tests passed (unchanged from before this feature —
    confirms zero regressions, and confirms §3.0's "packages/core needs
    ZERO changes" — no core files were touched).
  - `apps/daemon`: 182 tests passed, including:
    - 14 new tests in `llm-secrets.test.ts` (TC-S1–TC-S13 + 1 extra).
    - 6 new tests in `llm-registry.test.ts` (rewritten for the 4-id
      registry).
    - 6 tests each in the new `llm-openaiProvider.test.ts` and
      `llm-geminiProvider.test.ts`.
    - 6 tests in `llm-anthropicProvider.test.ts` (renamed/rewritten from
      `llm-remoteProvider.test.ts`).
    - 10 tests in the rewritten `rpc-checkProviderStatus.test.ts` (ollama
      regression path + widened api-key branching + invalid-id rejection).
    - 13 new tests in `rpc-providerSettings.test.ts`
      (`listProviders`/`saveProviderKey`/`clearProviderKey`/`setActiveProvider`
      validation + behavior).
    - 5 new tests in `rpc-providerSettings-roundtrip.test.ts` (auth-gate
      membership for the 4 new RPC methods over the real HTTP transport,
      plus a simulated-daemon-restart persistence check).
    - `rpc-generateBody.test.ts` updated for the 4-id union (no more
      `"remote"`/`REMOTE_API_KEY_ENV_VAR`).
- `apps/web` has no test files (confirmed pre-existing — Tier D in the
  testplan is manual-only for web); not a gap introduced by this feature.
- Manual/Tier D testplan items (M1–M23) were **NOT executed** by the Maker
  — those require a live daemon + browser session and are explicitly QA's
  responsibility per the testplan header ("Manual checklist ... run against
  a live daemon"). Flagging honestly rather than claiming verification that
  didn't happen.
- `packages/core` zero-fs/net-import check (AC-9): verified via
  `grep -rn "fs\.\|net\.\|node:fs\|node:net\|node:http" packages/core/src`
  — zero matches (the only `fs.js`-shaped hits are `.js` import-extension
  false positives from the grep pattern, not actual fs/net usage).
- `"remote"` literal grep (testplan TC-R6): zero remaining references in
  `apps/daemon/src`/`apps/web/src` as a provider id; the only 2 remaining
  hits are doc comments in `packages/rpc-types/src/index.ts` explicitly
  explaining the rename (allowed per TC-R6's own carve-out).

### 11.4 Points for the Checker to verify independently

- **Security (`/cso`, mandatory per §9)**: `0o600` permission enforcement
  on `providers.json` (tested in `llm-secrets.test.ts` TC-S12, skipped on
  win32); confirm no raw `apiKey` ever reaches a `console.*` call or an RPC
  response body (tested in TC-S13 + `rpc-providerSettings.test.ts`'s
  "raw key absent from the response" assertion, but Checker should
  independently grep/read the 3 new provider adapters + `handlers.ts` for
  any stray raw-key interpolation in error messages); confirm
  `providers.json`'s location (`~/.config/symbion/`, via `globalConfigDir()`)
  is never written into any project directory.
- **`checkApiKeyProviderReachable`'s reuse of `generate()`**: Checker
  should confirm this doesn't have an unintended side effect (e.g. token
  cost on the user's real account) beyond what a minimal `"ping"` prompt
  would incur — this was a dev's-call implementation choice, not literally
  specified by the PLAN, and trades "exactly matches generate()'s
  cost/behavior" for "no duplicated HTTP-shape code."
- **`ProvidersPanel.tsx`'s lack of optimistic UI / loading-state nuance**:
  each card's Save/Test/Clear/Activate buttons disable during their own
  in-flight call but there is no cross-card "any action in flight"
  global lock — Checker should confirm this matches the PLAN's "no shared
  cache, no global state" precedent rather than being an oversight.
- **`useActiveProvider()`'s one-call-per-mount + no-polling contract**:
  Checker should confirm `AgentForm`/`WorkflowForm` each independently
  mount their own `useActiveProvider()` instance (2 separate RPC calls if
  both are somehow mounted simultaneously — unlikely in this app's
  single-form-at-a-time UX, but worth confirming it's not a accidental
  N-times-per-render issue).
- Tier D manual checklist (M1–M23 in the testplan) — not run by the Maker,
  must be run by `/qa` against a live daemon + browser before `/ship`.

## 12. REVIEW — code-reviewer + architect (parallel, independent)

Both checkers returned **PASS**. Findings (both fixed before `/cso`):

- 🟡 **Token-cost risk**: `checkApiKeyProviderReachable` reused `generate()`
  for "Test connection" with no output-token cap — Anthropic's ping could
  generate up to 4096 output tokens, bounded only by a 3s timeout, not token
  count. **Fixed**: added `maxTokens?: number` to `LlmGenerateRequest`
  (`apps/daemon/src/llm/types.ts`), wired through all 3 cloud providers
  (Anthropic `max_tokens`, OpenAI `max_tokens`, Gemini
  `generationConfig.maxOutputTokens`), status-check ping now passes
  `maxTokens: 1` (`apps/daemon/src/llm/providerStatus.ts`).
- 🟡 **Orphaned dead field**: `packages/core/src/ir/types.ts` still declared
  `GlobalConfig.llm?.activeProvider?: "ollama" | "remote"` — an unused stub
  from the prior `auto-generate-body` loop, never read/written anywhere,
  never updated to the 4-id union. **Fixed**: deleted the field entirely
  (confirmed zero references via grep before removal).
- 🟢 Two cosmetic nits accepted as-is (unused `model` field on first save
  before a model is picked; `maskKey()` omits vendor key-prefix in its
  masked display) — functionally correct, no action needed.

Re-ran `npm run build` + `npm run test` after both fixes: build clean,
**258/258 tests pass**.

## 13. CSO — security-reviewer (independent)

**Verdict: PASS.** No critical or high findings. Audited: secrets-at-rest
permissions (file + directory), secrets-in-transit (RPC request/response
bodies), secrets-in-logs (no raw key ever logged/echoed), SSRF/outbound
trust boundary (all 3 cloud base URLs hardcoded constants, `baseUrl`
override only reachable from test code, never from `apps/web` or any RPC
param), RPC auth-gating (all 3 new mutating methods correctly require the
session token; `listProviders` correctly token-gated despite read-only
membership), input validation (size caps, no header/CRLF injection path),
DNS-rebinding/Origin hardening (unchanged, still intact), and path
confinement (`providers.json` lives under `~/.config/symbion/`, never
resolvable into a git working tree via any web/RPC-reachable input).

One 🟡 medium finding, fixed immediately: `~/.config/symbion/` directory
was `0755` (umask-inherited) while the file inside it was correctly `0600`
— filename/existence was disclosable to other local users on a shared
machine, though file *contents* remained protected. **Fixed**:
`atomicWriteJson` (`apps/daemon/src/store/store.ts`) gained an optional
`dirMode` param that chmods the containing directory; `secrets.ts` now
passes `dirMode: 0o700` alongside the existing `mode: 0o600`. Re-ran build
+ test after the fix: clean, 258/258 pass.

Two informational/low items noted, no action required: temp-file naming
uses PID+timestamp (not attacker-controlled, single-process daemon, no
collision risk in practice); `saveProviderKey` stores the apiKey untrimmed
after validating non-empty-after-trim (a UX nit — a key with stray
whitespace would silently fail at the vendor, not a security issue).

## 14. QA — verdict: PASS

**Environment note**: chrome-devtools (Chrome) was not reachable in this
sandbox (no browser process to connect to), so pixel-level UI checks (exact
card rendering, click-through flows) could not be visually verified.
Compensated by exercising the live daemon's RPC surface directly (curl,
real session token, real `~/.config/symbion/providers.json` on the actual
machine) plus re-running the automated Tier A/B/C suite, which already
covers the same behavior the manual checklist targets. Flagged explicitly
per this testplan's own §8 instruction to never silently downgrade — every
check below states its actual method.

| Check | Method | Result |
|---|---|---|
| M21 `npm run build` | Direct run | PASS — clean, `/settings` route present in Next.js output |
| M22 `npm run test` | Direct run | PASS — 258/258 |
| M23 `packages/core` zero fs/net | grep + manual inspection of the 2 matches | PASS — both are false positives (`refs.js` import, `extractAgentMentions`), not real fs/net usage |
| M1/M2 — Settings nav exists, `/settings` loads | `curl` both routes | PASS — both return HTTP 200; visual nav-link rendering NOT verified (no browser) |
| M3 / TC-P1 — 4 provider cards, fresh state | Live `listProviders` RPC call | PASS — exactly 4 entries (ollama/openai/anthropic/gemini), correct `kind`, ollama `configured: true` by design (needs no key) |
| M4 — Ollama guide content preserved | Code inspection (architect's prior review already confirmed; not re-clicked in browser) | PASS by code inspection, not re-verified visually |
| M5/M6 / TC-P2 — save key, masked in response | Live `saveProviderKey` RPC with a fake key string | PASS — response contains `maskedKey: "...1222"`, raw key string `grep`-confirmed absent from the full response body |
| TC-P3/TC-P4/TC-P5 — empty/oversized/invalid-id rejected | Live RPC calls | PASS — all 3 rejected with `invalid-params`, correct Vietnamese messages |
| M9 / TC-P7 — set active provider | Live `setActiveProvider` RPC | PASS — exactly one provider flips `active: true`, others stay `false` |
| TC-P8 — activate unconfigured provider rejected | Live RPC | PASS — `invalid-params`, "Chưa cấu hình API key..." |
| M8/M15 / TC-P6/TC-S10 — clear active provider's key | Live `clearProviderKey` RPC | PASS — `openai.active` flips to `false`, `ollama.active` stays `false` (no silent fallback to Ollama, no provider auto-activated) |
| M16 — generateBody with no provider configured | Live `generateBody` RPC against the cleared provider | PASS — clean `llm-not-configured` error, no crash |
| M13/M14/TC-I1/TC-I2 — generate success / auth-failure / status-flips-on-recheck | Re-ran the existing fake-server-backed Tier A/C automated suite (`rpc-providerSettings-roundtrip`, `rpc-checkProviderStatus`, all 3 new provider adapter test files) — the live daemon has no test hook to redirect its hardcoded real vendor URLs (confirmed safe/intentional by `/cso`), so the real-network-call scenario is exercised in-process instead | PASS — 33/33 tests green, covering the full save→activate→generate chain, 401→`llm-auth`, and "status check resolves disconnected after a failed generate" |
| TC-P10/TC-P11 — all 4 new RPC methods require session token | Live `curl` calls with NO `x-symbion-token` header against `saveProviderKey`/`clearProviderKey`/`setActiveProvider`/`listProviders` | PASS — all 4 return HTTP 401 `unauthorized` |
| M18 — corrupt `providers.json` fails soft | Actually corrupted the real on-disk file (`{not valid json...`), called `listProviders` without restarting (PASS — clean fail-soft response), then fully killed and restarted the real daemon process with the corrupt file still present | PASS — daemon boots cleanly with no crash; `listProviders` post-restart returns all-not-configured |
| M11 / TC-I3 — key persists across a real daemon restart | Saved a fake Gemini key via live RPC, confirmed `0600`/`0700` file/dir permissions on disk, fully killed + restarted the real daemon process, re-queried `listProviders` | PASS — `gemini.configured: true`, `maskedKey: "...9999"` survives the real process restart |
| File/dir permissions (`/cso`'s fix) | `stat` on the real file post-save | PASS — `providers.json` is `600`, `~/.config/symbion/` is `700` |
| M19 — two-tab no-shared-cache | NOT run (no browser available) | Not verified this session — low risk, architecturally guaranteed by construction (no shared cache/event bus exists in the code at all, confirmed in `/review`), but flagged as not independently exercised |
| M20 — no "Test All" button exists | Code inspection (confirmed absent in `ProvidersPanel.tsx` during `/review`) | PASS by code inspection, not re-verified visually |
| M7 (real cloud key) | NOT run — no real OpenAI/Anthropic/Gemini API key available in this environment, exactly the testplan's anticipated "mark not run, no key available" case (§0 precondition) | Not run — negative case (invalid key → auth error) is covered instead by the automated Tier A suite's `-auth` matrix entries for all 3 providers |
| M12 — model picker/Generate Body resolve active provider (not hardcoded Ollama) | Code inspection only (confirmed in `/review`'s architectural pass — `AgentForm`/`WorkflowForm` wired to `useActiveProvider()`, no hardcoded `"ollama"` literals remain) | PASS by code inspection, not re-clicked in browser |
| M17 — Ollama-not-running regression | NOT re-run live (no Ollama installed/running in this sandbox); behavior is unchanged code from the prior `connect-providers` loop, untouched by this feature's diff | Not run — no regression risk identified, path is byte-identical to the already-shipped prior feature |

**Cleanup performed**: all test data (fake OpenAI/Gemini keys) was cleared
from the user's real `~/.config/symbion/providers.json` before finishing;
the daemon and the web-dev-server processes started for this QA run were
stopped; the file was restored to its pre-QA empty state
(`{ schemaVersion: 1, activeProviderId: null, providers: {} }`).

**Verdict: PASS.** All criteria that could be exercised (live RPC, real
file I/O, real process restarts, automated test re-runs) passed with no
deviation from expected behavior. The handful of checks that strictly
require a real browser (M1/M2's visual nav rendering, M4/M12/M20's visual
confirmation, M19's two-tab check) or a real paid API key (M7's positive
case) were not independently re-verified this session — each is backed by
either code inspection during `/review` or an equivalent automated test,
and none represent new risk surfaces beyond what `/review`/`/cso` already
covered. Recommend a follow-up smoke-test in a real browser environment
before/shortly after `/ship` if one becomes available, but this is not a
blocker — no behavioral or security risk was left unverified by some
method.

## 15. Next step

QA PASS. Proceed to `/ship`.
