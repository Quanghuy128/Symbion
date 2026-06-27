/**
 * OllamaProvider — calls a local Ollama instance over HTTP using Node's native
 * fetch + AbortController. No API key. The v1 default provider (STATE §9).
 *
 * Model ids below are real, currently-pullable Ollama tags chosen as
 * placeholders for the fast/balanced/best tiers (R2 in STATE §10.7 — a
 * dev-time content decision, not an architecture decision; Checker should
 * independently verify these tags are still valid/pullable at review time).
 */
import { LlmError, type LlmGenerateRequest, type LlmGenerateResult, type LlmModelOption, type LlmProvider } from "./types.js";

export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434";

const OLLAMA_MODELS: LlmModelOption[] = [
  { id: "llama3.2:1b", label: "Llama 3.2 1B (nhanh)", tier: "fast" },
  { id: "llama3.1:8b", label: "Llama 3.1 8B (cân bằng)", tier: "balanced" },
  { id: "llama3.1:70b", label: "Llama 3.1 70B (tốt nhất)", tier: "best" },
];

export interface OllamaProviderOptions {
  /** injectable for tests (Tier A fake-provider, per testplan §0); defaults to the real local Ollama. */
  baseUrl?: string;
}

interface OllamaGenerateResponse {
  response?: string;
  [key: string]: unknown;
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * isLoopbackUrl — true iff `value` parses as a URL whose hostname is one of
 * 127.0.0.1 / localhost / ::1 (case-insensitive). Used to confine the
 * env-var-sourced Ollama base URL to loopback only, since that path is
 * influenceable by anything that can set the daemon process's environment
 * (see docs/loops/auto-generate-body-STATE.md §13 — SSRF finding).
 */
function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return LOOPBACK_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}

/**
 * resolveOllamaBaseUrl — the env-var/loopback-guard/default resolution logic that used to
 * live inline in `OllamaProvider`'s constructor (extracted per
 * docs/loops/connect-providers-STATE.md §10.3, a structure-only refactor, no behavior
 * change). Exported so `providerStatus.ts`'s reachability check reuses the exact same
 * SSRF-guarded resolution instead of re-implementing it — one implementation, not two.
 *
 * Throws `LlmError("provider-not-running", ...)` if `SYMBION_OLLAMA_BASE_URL` is set to a
 * non-loopback host (see `isLoopbackUrl` doc comment for the threat this guards against).
 */
export function resolveOllamaBaseUrl(): string {
  // Env override (SYMBION_OLLAMA_BASE_URL) lets tests/dev tooling point this at a fake
  // server without needing to thread a constructor param through the registry factory.
  // Because this path is influenceable by anything that can set the daemon process's
  // environment (poisoned .env, malicious postinstall, misconfigured deploy), it MUST be
  // restricted to loopback hosts — never silently fall back to OLLAMA_DEFAULT_BASE_URL,
  // since that would mask a misconfiguration as "everything's fine, just using localhost."
  const envBaseUrl = process.env["SYMBION_OLLAMA_BASE_URL"];
  if (envBaseUrl !== undefined) {
    if (!isLoopbackUrl(envBaseUrl)) {
      throw new LlmError(
        "provider-not-running",
        `SYMBION_OLLAMA_BASE_URL phải là một địa chỉ loopback (127.0.0.1/localhost/::1); giá trị hiện tại không hợp lệ và bị từ chối: "${envBaseUrl}".`
      );
    }
    return envBaseUrl;
  }

  return OLLAMA_DEFAULT_BASE_URL;
}

export class OllamaProvider implements LlmProvider {
  readonly id = "ollama" as const;
  private readonly baseUrl: string;

  constructor(opts: OllamaProviderOptions = {}) {
    // An explicit constructor `baseUrl` (only ever set by trusted code, e.g. test
    // fixtures) always wins and is NOT subject to the loopback check below — it is
    // not reachable by an external actor.
    if (opts.baseUrl !== undefined) {
      this.baseUrl = opts.baseUrl;
      return;
    }

    this.baseUrl = resolveOllamaBaseUrl();
  }

  listModels(): LlmModelOption[] {
    return OLLAMA_MODELS;
  }

  async generate(req: LlmGenerateRequest): Promise<LlmGenerateResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);

    try {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: req.model,
            prompt: req.userPrompt,
            system: req.systemPrompt,
            stream: false,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          throw new LlmError("timeout", `Quá thời gian chờ (${req.timeoutMs}ms) khi gọi Ollama.`);
        }
        throw new LlmError(
          "provider-not-running",
          "Không thể kết nối tới Ollama — đảm bảo Ollama đang chạy trên máy."
        );
      }

      if (res.status === 404) {
        throw new LlmError("invalid-response", `Mô hình "${req.model}" không tồn tại trên Ollama (404).`);
      }
      if (!res.ok) {
        throw new LlmError("invalid-response", `Ollama trả về lỗi HTTP ${res.status}.`);
      }

      let json: OllamaGenerateResponse;
      try {
        json = (await res.json()) as OllamaGenerateResponse;
      } catch {
        throw new LlmError("invalid-response", "Phản hồi không hợp lệ từ Ollama (không phải JSON).");
      }

      if (typeof json.response !== "string") {
        throw new LlmError("invalid-response", "Phản hồi không hợp lệ từ Ollama (thiếu trường response).");
      }

      return { text: json.response };
    } finally {
      clearTimeout(timer);
    }
  }
}
