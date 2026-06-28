/**
 * OllamaProvider — calls a local Ollama instance over HTTP using Node's native
 * fetch + AbortController. No API key. The v1 default provider (STATE §9).
 *
 * listModels() queries the real local Ollama's `GET /api/tags` per
 * docs/loops/ollama-dynamic-models-STATE.md §6.2 — the old hardcoded 3-entry
 * placeholder constant has been removed entirely (no fallback to it on any
 * failure path, per that STATE's §3 "never silently fail" constraint).
 */
import { LlmError, type LlmGenerateRequest, type LlmGenerateResult, type LlmModelOption, type LlmProvider } from "./types.js";

export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434";

/** Same 3000ms convention as `checkOllamaReachable` (providerStatus.ts) — this is a
 *  cheap "what's there" probe, not a generate() call, per STATE §6.1/§6.2. */
const OLLAMA_LIST_MODELS_TIMEOUT_MS = 3000;

/** Matches a parameter-count hint at the end of an Ollama tag, e.g. "8b", "1b", "70b",
 *  "3.8b", "0.5b" — case-insensitive. Per STATE §6.3. */
const PARAM_SIZE_RE = /(\d+(?:\.\d+)?)\s*b\b/i;

/**
 * inferTierFromTag — infers a coarse speed/capability tier from an Ollama tag's
 * parameter-count hint when one is confidently parseable; otherwise returns
 * `undefined` rather than guessing (STATE §6.3 — "omit tier" over "invent a default").
 * Thresholds: <=3b fast, <=13b balanced, >13b best.
 */
function inferTierFromTag(tag: string): LlmModelOption["tier"] {
  const match = tag.match(PARAM_SIZE_RE);
  if (!match) return undefined;
  const billions = parseFloat(match[1]!);
  if (Number.isNaN(billions)) return undefined;
  if (billions <= 3) return "fast";
  if (billions <= 13) return "balanced";
  return "best";
}

/** Maps a raw Ollama tag string (e.g. "llama3.1:8b") to an `LlmModelOption` — label is
 *  the raw tag itself (no attempt at vendor-name prettification, STATE §6.3). */
function ollamaTagToModelOption(tag: string): LlmModelOption {
  return { id: tag, label: tag, tier: inferTierFromTag(tag) };
}

interface OllamaTagsResponseModel {
  name?: string; // e.g. "llama3.1:8b"
  model?: string; // Ollama duplicates `name` here in real responses; tolerate either
  size?: number;
  [key: string]: unknown;
}
interface OllamaTagsResponse {
  models?: OllamaTagsResponseModel[];
  [key: string]: unknown;
}

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

  /**
   * listModels — queries Ollama's real `GET /api/tags` (per
   * docs/loops/ollama-dynamic-models-STATE.md §6.2), bounded by a 3000ms
   * AbortController timeout (same convention as `checkOllamaReachable`). Uses
   * `this.baseUrl`, already resolved through the SAME loopback-guarded
   * `resolveOllamaBaseUrl()` the constructor uses — no second SSRF-guard
   * implementation.
   *
   * Error mapping:
   * - connection-refused / DNS failure / our own abort-on-timeout all collapse to
   *   `LlmError("provider-not-running", ...)` — both mean "ModelPicker cannot get a
   *   model list from Ollama right now," and AC4 only requires the existing
   *   "unreachable" shape be unregressed, not a distinct timeout code (STATE §9.1).
   * - non-2xx HTTP status -> `LlmError("invalid-response", ...)`.
   * - non-JSON body -> `LlmError("invalid-response", ...)`.
   * - missing/wrong-type `models` field on an otherwise-200 response ->
   *   `LlmError("invalid-response", ...)` — distinct from "genuinely zero models,"
   *   which is a well-formed `{ models: [] }` that resolves normally (empty array,
   *   no throw) per STATE §3's "never silently fail ... not an empty array
   *   indistinguishable from genuinely zero" constraint.
   */
  async listModels(): Promise<LlmModelOption[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OLLAMA_LIST_MODELS_TIMEOUT_MS);
    try {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      } catch {
        throw new LlmError(
          "provider-not-running",
          "Không thể kết nối tới Ollama — đảm bảo Ollama đang chạy trên máy."
        );
      }
      if (!res.ok) {
        throw new LlmError("invalid-response", `Ollama trả về lỗi HTTP ${res.status} khi lấy danh sách mô hình.`);
      }
      let json: OllamaTagsResponse;
      try {
        json = (await res.json()) as OllamaTagsResponse;
      } catch {
        throw new LlmError(
          "invalid-response",
          "Phản hồi không hợp lệ từ Ollama (không phải JSON) khi lấy danh sách mô hình."
        );
      }
      if (!Array.isArray(json.models)) {
        throw new LlmError(
          "invalid-response",
          "Phản hồi không hợp lệ từ Ollama (thiếu trường models) khi lấy danh sách mô hình."
        );
      }
      return json.models
        .map((m) => m.name ?? m.model)
        .filter((name): name is string => typeof name === "string" && name.length > 0)
        .map(ollamaTagToModelOption);
    } finally {
      clearTimeout(timer);
    }
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
