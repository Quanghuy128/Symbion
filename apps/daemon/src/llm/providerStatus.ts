/**
 * providerStatus — lightweight reachability checks backing the
 * `checkProviderStatus` RPC. Ollama path (docs/loops/connect-providers-STATE.md
 * §10.3) is unchanged: deliberately does NOT go through
 * `getProvider("ollama")`/`OllamaProvider.generate()` — a real `generate()` call loads a
 * model and can take seconds-to-minutes, the wrong shape for "is anything listening."
 * Instead: a single `GET {baseUrl}/` with a short AbortController timeout.
 *
 * Reuses `resolveOllamaBaseUrl()` exported from `ollamaProvider.ts` — the same
 * env-var/loopback-guarded resolution `OllamaProvider`'s constructor uses — so the
 * SSRF/loopback discipline has exactly one implementation, not two independently
 * maintained copies.
 *
 * `checkApiKeyProviderReachable` (new, docs/loops/multi-provider-settings-STATE.md §3.2/§4b)
 * is the sibling check for the 3 api-key-kind providers: ONE cheap authenticated call
 * (reuses `listModels()`'s static list plus a minimal authenticated POST — same
 * "generate" call shape but with a tiny prompt/short token budget, since none of the 3
 * vendors' SDKs expose a free no-op auth-check endpoint that doesn't also require picking
 * SOME model id; dev's call on exact endpoint per provider, not an architecture decision),
 * mapped through the same LlmErrorCode taxonomy generate() already uses.
 */
import { resolveOllamaBaseUrl } from "./ollamaProvider.js";
import { LlmError, type LlmErrorCode, type LlmProvider } from "./types.js";

export { resolveOllamaBaseUrl as resolveOllamaBaseUrlForStatusCheck };

/**
 * checkOllamaReachable — resolves `true` if `GET {baseUrl}/` returns ANY HTTP response
 * (200, 404, whatever — Ollama responding at all to the root path proves a process is
 * listening and speaking HTTP, which is the only claim this check makes; NOT gated on
 * status===200 specifically, since that risks a false "not reachable" if Ollama's
 * root-path response shape changes across versions).
 *
 * Resolves `false` (never throws) on connection-refused, DNS failure, abort/timeout, or
 * any other fetch rejection — a not-running/unreachable provider is an expected steady
 * state for this check, not an exceptional one.
 */
export async function checkOllamaReachable(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${baseUrl}/`, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface ApiKeyProviderReachability {
  reachable: boolean;
  errorCode?: LlmErrorCode;
}

/**
 * checkApiKeyProviderReachable — performs ONE cheap authenticated call against
 * an already-constructed api-key-kind LlmProvider (the caller is responsible
 * for first checking secrets.ts has a key for that provider — see handlers.ts's
 * `checkProviderStatus`, which short-circuits to `not-configured` WITHOUT
 * calling this function at all when no key is stored, per STATE §4b step 3a).
 *
 * Uses the provider's own `generate()` with a minimal prompt and the first
 * model from its `listModels()` — the smallest "real" authenticated call
 * every adapter already implements, instead of duplicating bespoke
 * ping/list-models HTTP logic per vendor. Maps the outcome through the exact
 * same LlmErrorCode taxonomy generate() already uses; never throws.
 *
 * `maxTokens: 1` caps output cost — this call only needs to observe whether
 * the request was accepted (auth/billing valid), not read the response text,
 * per the cost-risk finding raised in `/review` (a 401/403 check call should
 * not risk burning a full generate-call's worth of output tokens).
 */
export async function checkApiKeyProviderReachable(
  provider: LlmProvider,
  timeoutMs: number
): Promise<ApiKeyProviderReachability> {
  const models = await provider.listModels();
  const modelId = models[0]?.id ?? "";
  try {
    await provider.generate({
      systemPrompt: "ping",
      userPrompt: "ping",
      model: modelId,
      timeoutMs,
      maxTokens: 1,
    });
    return { reachable: true };
  } catch (err) {
    if (err instanceof LlmError) {
      return { reachable: false, errorCode: err.code };
    }
    return { reachable: false, errorCode: "unknown" };
  }
}
