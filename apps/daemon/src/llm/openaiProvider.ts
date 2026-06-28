/**
 * OpenAiProvider — LlmProvider implementation for OpenAI, per
 * docs/loops/multi-provider-settings-STATE.md §3.2. Reads its API key from
 * the secrets store (apps/daemon/src/llm/secrets.ts) at construction time —
 * never from process.env, never persisted by this class. Calls the
 * `/v1/chat/completions` endpoint with `Authorization: Bearer <key>` (dev's
 * call on exact endpoint per STATE §3.2 — not an architecture decision).
 *
 * Model ids below are placeholder/dev-time content decisions (same framing
 * as ollamaProvider.ts's model list) — Checker should independently verify
 * these are reasonable current OpenAI model ids at review time.
 */
import { LlmError, type LlmGenerateRequest, type LlmGenerateResult, type LlmModelOption, type LlmProvider } from "./types.js";
import { loadProvidersConfig } from "./secrets.js";

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1/chat/completions";

const OPENAI_MODELS: LlmModelOption[] = [
  { id: "gpt-4o-mini", label: "GPT-4o mini (nhanh)", tier: "fast" },
  { id: "gpt-4o", label: "GPT-4o (cân bằng)", tier: "balanced" },
  { id: "gpt-4.1", label: "GPT-4.1 (tốt nhất)", tier: "best" },
];

export interface OpenAiProviderOptions {
  /** injectable for tests; defaults to the real OpenAI chat-completions endpoint. */
  baseUrl?: string;
}

export class OpenAiProvider implements LlmProvider {
  readonly id = "openai" as const;
  private readonly baseUrl: string;

  constructor(opts: OpenAiProviderOptions = {}) {
    this.baseUrl = opts.baseUrl ?? OPENAI_DEFAULT_BASE_URL;
  }

  async listModels(): Promise<LlmModelOption[]> {
    return OPENAI_MODELS;
  }

  async generate(req: LlmGenerateRequest): Promise<LlmGenerateResult> {
    const apiKey = loadProvidersConfig().providers.openai?.apiKey;
    if (!apiKey) {
      throw new LlmError("not-configured", "Chưa cấu hình API key cho OpenAI.");
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
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: req.model,
            messages: [
              { role: "system", content: req.systemPrompt },
              { role: "user", content: req.userPrompt },
            ],
            ...(req.maxTokens != null ? { max_tokens: req.maxTokens } : {}),
          }),
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          throw new LlmError("timeout", `Quá thời gian chờ (${req.timeoutMs}ms) khi gọi OpenAI.`);
        }
        throw new LlmError("network", "Lỗi mạng khi gọi OpenAI.");
      }

      if (res.status === 401 || res.status === 403) {
        throw new LlmError("auth", "Thiếu hoặc sai cấu hình API key cho OpenAI.");
      }
      if (res.status === 429) {
        throw new LlmError("rate-limit", "Bị giới hạn tần suất gọi — thử lại sau.");
      }
      if (!res.ok) {
        throw new LlmError("invalid-response", `OpenAI trả về lỗi HTTP ${res.status}.`);
      }

      let json: { choices?: Array<{ message?: { content?: string } }> };
      try {
        json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      } catch {
        throw new LlmError("invalid-response", "Phản hồi không hợp lệ từ OpenAI (không phải JSON).");
      }

      const text = json.choices?.[0]?.message?.content;
      if (typeof text !== "string") {
        throw new LlmError("invalid-response", "Phản hồi không hợp lệ từ OpenAI.");
      }

      return { text };
    } finally {
      clearTimeout(timer);
    }
  }
}
