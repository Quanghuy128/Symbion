/**
 * providerStatus — lightweight Ollama reachability check for the new `checkProviderStatus`
 * RPC (docs/loops/connect-providers-STATE.md §10.3). Deliberately does NOT go through
 * `getProvider("ollama")`/`OllamaProvider.generate()` — a real `generate()` call loads a
 * model and can take seconds-to-minutes, the wrong shape for "is anything listening."
 * Instead: a single `GET {baseUrl}/` with a short AbortController timeout.
 *
 * Reuses `resolveOllamaBaseUrl()` exported from `ollamaProvider.ts` — the same
 * env-var/loopback-guarded resolution `OllamaProvider`'s constructor uses — so the
 * SSRF/loopback discipline has exactly one implementation, not two independently
 * maintained copies.
 */
import { resolveOllamaBaseUrl } from "./ollamaProvider.js";

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
