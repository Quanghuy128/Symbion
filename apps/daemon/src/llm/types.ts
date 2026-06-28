/**
 * LlmProvider — the seam every model-inference call in apps/daemon goes through.
 * No fs/network code lives in packages/core; this interface and its concrete
 * adapters (ollamaProvider.ts, anthropicProvider.ts, openaiProvider.ts,
 * geminiProvider.ts) are daemon-only, per docs/loops/auto-generate-body-STATE.md
 * §10.1 and widened per docs/loops/multi-provider-settings-STATE.md §3.2.
 */

export interface LlmGenerateRequest {
  systemPrompt: string;
  userPrompt: string;
  /** provider-specific model id. */
  model: string;
  /** budget for the whole request, enforced via AbortController (not setTimeout-only). */
  timeoutMs: number;
  /** caps output tokens when set — used by status-check pings to bound cost; omitted means provider default. */
  maxTokens?: number;
}

export interface LlmGenerateResult {
  text: string;
}

export type LlmErrorCode =
  | "timeout"
  | "network"
  | "auth"
  | "rate-limit"
  | "invalid-response"
  | "provider-not-running"
  /** active provider has no key/never configured — distinct from "auth" (key present but
   *  rejected by the provider). New in docs/loops/multi-provider-settings-STATE.md §3.2. */
  | "not-configured"
  | "unknown";

export class LlmError extends Error {
  code: LlmErrorCode;
  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "LlmError";
  }
}

export interface LlmModelOption {
  id: string;
  label: string;
  /** Optional — per docs/loops/ollama-dynamic-models-STATE.md §6.3, dynamically-discovered
   *  Ollama models with no confidently-parseable parameter-count hint in their tag name have
   *  no tier (honest "unknown" rather than a guessed default). The 3 cloud providers' static
   *  entries always set this. */
  tier?: "fast" | "balanced" | "best";
}

export interface LlmProvider {
  id: "ollama" | "openai" | "anthropic" | "gemini";
  /**
   * Static/hardcoded for the 3 cloud providers (openai/anthropic/gemini) — per STATE §9 of
   * multi-provider-settings-STATE.md, unchanged. For Ollama, this now performs a real
   * `GET /api/tags` network call against the local Ollama instance (per
   * docs/loops/ollama-dynamic-models-STATE.md §6.1/§6.2) — async for ALL 4 providers so the
   * interface has one shape, no special-casing by provider id at any call site.
   */
  listModels(): Promise<LlmModelOption[]>;
  generate(req: LlmGenerateRequest): Promise<LlmGenerateResult>;
}
