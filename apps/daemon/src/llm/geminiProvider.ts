/**
 * GeminiProvider — LlmProvider implementation for Google Gemini, per
 * docs/loops/multi-provider-settings-STATE.md §3.2. Reads its API key from
 * the secrets store (apps/daemon/src/llm/secrets.ts) at construction time —
 * never from process.env, never persisted by this class. Calls Gemini's
 * documented simple-API-key `generateContent` REST endpoint with a `?key=`
 * query param (no OAuth) — dev's call on exact endpoint per STATE §3.2.
 *
 * Model ids below are placeholder/dev-time content decisions (same framing
 * as ollamaProvider.ts's model list) — Checker should independently verify
 * these are reasonable current Gemini model ids at review time.
 */
import { LlmError, type LlmGenerateRequest, type LlmGenerateResult, type LlmModelOption, type LlmProvider } from "./types.js";
import { loadProvidersConfig } from "./secrets.js";

const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const GEMINI_MODELS: LlmModelOption[] = [
  { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash (nhanh)", tier: "fast" },
  { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro (balanced)", tier: "balanced" },
  { id: "gemini-2.0-pro", label: "Gemini 2.0 Pro (best)", tier: "best" },
];

export interface GeminiProviderOptions {
  /** injectable for tests; defaults to the real Gemini generateContent endpoint base. */
  baseUrl?: string;
}

export class GeminiProvider implements LlmProvider {
  readonly id = "gemini" as const;
  private readonly baseUrl: string;

  constructor(opts: GeminiProviderOptions = {}) {
    this.baseUrl = opts.baseUrl ?? GEMINI_DEFAULT_BASE_URL;
  }

  async listModels(): Promise<LlmModelOption[]> {
    return GEMINI_MODELS;
  }

  async generate(req: LlmGenerateRequest): Promise<LlmGenerateResult> {
    const apiKey = loadProvidersConfig().providers.gemini?.apiKey;
    if (!apiKey) {
      throw new LlmError("not-configured", "No API key configured for Gemini.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);

    try {
      // Key in the query string is Gemini's documented simple-API-key auth shape — not a
      // Symbion choice, the vendor's own published REST contract.
      const url = `${this.baseUrl}/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: req.userPrompt }] }],
            ...(req.maxTokens != null
              ? { generationConfig: { maxOutputTokens: req.maxTokens } }
              : {}),
          }),
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          throw new LlmError("timeout", `Request timed out (${req.timeoutMs}ms) while calling Gemini.`);
        }
        throw new LlmError("network", "Network error while calling Gemini.");
      }

      if (res.status === 401 || res.status === 403) {
        throw new LlmError("auth", "Missing or invalid API key for Gemini.");
      }
      if (res.status === 429) {
        throw new LlmError("rate-limit", "Rate-limited — try again later.");
      }
      if (!res.ok) {
        throw new LlmError("invalid-response", `Gemini returned HTTP error ${res.status}.`);
      }

      let json: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      try {
        json = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
      } catch {
        throw new LlmError("invalid-response", "Invalid response from Gemini (not JSON).");
      }

      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== "string") {
        throw new LlmError("invalid-response", "Invalid response from Gemini.");
      }

      return { text };
    } finally {
      clearTimeout(timer);
    }
  }
}
