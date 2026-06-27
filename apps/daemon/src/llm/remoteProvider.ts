/**
 * RemoteProvider — stub-grade in v1 per STATE §9 ("doesn't need a finished
 * provider-switch UI" but the interface/seam must be real, not a TODO).
 * Implements the same LlmProvider interface against Anthropic's Messages API
 * shape, as a concrete placeholder for "some remote vendor."
 *
 * The API key is read EXCLUSIVELY from process.env.SYMBION_REMOTE_LLM_API_KEY
 * at call time — never persisted to disk, never accepted as a request param,
 * never read from apps/web. If unset, generate() throws LlmError("auth", ...)
 * immediately, with NO network call attempted (TC-D7).
 */
import { LlmError, type LlmGenerateRequest, type LlmGenerateResult, type LlmModelOption, type LlmProvider } from "./types.js";

export const REMOTE_API_KEY_ENV_VAR = "SYMBION_REMOTE_LLM_API_KEY";

const REMOTE_DEFAULT_BASE_URL = "https://api.anthropic.com/v1/messages";

const REMOTE_MODELS: LlmModelOption[] = [
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (nhanh)", tier: "fast" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (cân bằng)", tier: "balanced" },
  { id: "claude-opus-4-1", label: "Claude Opus 4.1 (tốt nhất)", tier: "best" },
];

export interface RemoteProviderOptions {
  /** injectable for tests; defaults to the real Anthropic Messages endpoint. */
  baseUrl?: string;
}

export class RemoteProvider implements LlmProvider {
  readonly id = "remote" as const;
  private readonly baseUrl: string;

  constructor(opts: RemoteProviderOptions = {}) {
    this.baseUrl = opts.baseUrl ?? REMOTE_DEFAULT_BASE_URL;
  }

  listModels(): LlmModelOption[] {
    return REMOTE_MODELS;
  }

  async generate(req: LlmGenerateRequest): Promise<LlmGenerateResult> {
    const apiKey = process.env[REMOTE_API_KEY_ENV_VAR];
    if (!apiKey) {
      throw new LlmError("auth", "Thiếu hoặc sai cấu hình API key cho remote provider.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);

    try {
      let res: Response;
      try {
        res = await fetch(this.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: req.model,
            system: req.systemPrompt,
            max_tokens: 4096,
            messages: [{ role: "user", content: req.userPrompt }],
          }),
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          throw new LlmError("timeout", `Quá thời gian chờ (${req.timeoutMs}ms) khi gọi remote provider.`);
        }
        throw new LlmError("network", "Lỗi mạng khi gọi remote provider.");
      }

      if (res.status === 401 || res.status === 403) {
        throw new LlmError("auth", "Thiếu hoặc sai cấu hình API key cho remote provider.");
      }
      if (res.status === 429) {
        throw new LlmError("rate-limit", "Bị giới hạn tần suất gọi — thử lại sau.");
      }
      if (!res.ok) {
        throw new LlmError("invalid-response", `Remote provider trả về lỗi HTTP ${res.status}.`);
      }

      let json: { content?: Array<{ text?: string }> };
      try {
        json = (await res.json()) as { content?: Array<{ text?: string }> };
      } catch {
        throw new LlmError("invalid-response", "Phản hồi không hợp lệ từ remote provider (không phải JSON).");
      }

      const text = json.content?.[0]?.text;
      if (typeof text !== "string") {
        throw new LlmError("invalid-response", "Phản hồi không hợp lệ từ remote provider.");
      }

      return { text };
    } finally {
      clearTimeout(timer);
    }
  }
}
