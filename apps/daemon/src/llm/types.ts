/**
 * LlmProvider — the seam every model-inference call in apps/daemon goes through.
 * No fs/network code lives in packages/core; this interface and its concrete
 * adapters (ollamaProvider.ts, remoteProvider.ts) are daemon-only, per
 * docs/loops/auto-generate-body-STATE.md §10.1.
 */

export interface LlmGenerateRequest {
  systemPrompt: string;
  userPrompt: string;
  /** provider-specific model id. */
  model: string;
  /** budget for the whole request, enforced via AbortController (not setTimeout-only). */
  timeoutMs: number;
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
  tier: "fast" | "balanced" | "best";
}

export interface LlmProvider {
  id: "ollama" | "remote";
  /** static, hardcoded per STATE §9 — no dynamic fetch in v1 (EC-9). */
  listModels(): LlmModelOption[];
  generate(req: LlmGenerateRequest): Promise<LlmGenerateResult>;
}
