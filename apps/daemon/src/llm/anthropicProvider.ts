/**
 * AnthropicProvider — renamed from RemoteProvider per
 * docs/loops/multi-provider-settings-STATE.md §3.1: it already speaks the
 * Anthropic Messages API shape (`x-api-key` header, `anthropic-version`,
 * `/v1/messages` body shape, Claude model ids), so this is a rename + a
 * change in key source (secrets.ts instead of process.env), not new business
 * logic — the HTTP call shape is unchanged.
 *
 * The API key is read from the secrets store (apps/daemon/src/llm/secrets.ts)
 * at construction time — never persisted by this class, never accepted as a
 * request param, never read from apps/web. If unset, generate() throws
 * LlmError("not-configured", ...) immediately, with NO network call attempted.
 */
import { LlmError, type LlmGenerateRequest, type LlmGenerateResult, type LlmModelOption, type LlmProvider } from "./types.js";
import { loadProvidersConfig } from "./secrets.js";

const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1/messages";

const ANTHROPIC_MODELS: LlmModelOption[] = [
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (nhanh)", tier: "fast" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (balanced)", tier: "balanced" },
  { id: "claude-opus-4-1", label: "Claude Opus 4.1 (best)", tier: "best" },
];

export interface AnthropicProviderOptions {
  /** injectable for tests; defaults to the real Anthropic Messages endpoint. */
  baseUrl?: string;
}

export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic" as const;
  private readonly baseUrl: string;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.baseUrl = opts.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL;
  }

  async listModels(): Promise<LlmModelOption[]> {
    return ANTHROPIC_MODELS;
  }

  async generate(req: LlmGenerateRequest): Promise<LlmGenerateResult> {
    const apiKey = loadProvidersConfig().providers.anthropic?.apiKey;
    if (!apiKey) {
      throw new LlmError("not-configured", "No API key configured for Anthropic.");
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
            max_tokens: req.maxTokens ?? 4096,
            messages: [{ role: "user", content: req.userPrompt }],
          }),
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          throw new LlmError("timeout", `Request timed out (${req.timeoutMs}ms) while calling Anthropic.`);
        }
        throw new LlmError("network", "Network error while calling Anthropic.");
      }

      if (res.status === 401 || res.status === 403) {
        throw new LlmError("auth", "Missing or invalid API key for Anthropic.");
      }
      if (res.status === 429) {
        throw new LlmError("rate-limit", "Rate-limited — try again later.");
      }
      if (!res.ok) {
        throw new LlmError("invalid-response", `Anthropic returned HTTP error ${res.status}.`);
      }

      let json: { content?: Array<{ text?: string }> };
      try {
        json = (await res.json()) as { content?: Array<{ text?: string }> };
      } catch {
        throw new LlmError("invalid-response", "Invalid response from Anthropic (not JSON).");
      }

      const text = json.content?.[0]?.text;
      if (typeof text !== "string") {
        throw new LlmError("invalid-response", "Invalid response from Anthropic.");
      }

      return { text };
    } finally {
      clearTimeout(timer);
    }
  }
}
