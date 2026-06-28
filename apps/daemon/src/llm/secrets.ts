/**
 * secrets.ts — owns the on-disk `providers.json` file (API keys + active
 * provider selection) under the user-level config dir, per
 * docs/loops/multi-provider-settings-STATE.md §3.2/§3.3.
 *
 * Daemon-only. Never imported by packages/core or apps/web. Plaintext-at-rest
 * is the locked v1 decision (flagged to /cso, see STATE §9) — this module
 * adds only an OS file-permission guard (0o600) on top of that, no encryption.
 *
 * `maskKey()` is the ONLY function in this codebase permitted to touch a raw
 * key for display purposes — every RPC result shape must pass keys through
 * it before crossing into JSON (handlers.ts never serializes a raw apiKey).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { globalConfigDir, atomicWriteJson } from "../store/store.js";

export const CURRENT_PROVIDERS_SCHEMA_VERSION = 1 as const;

export type ApiKeyProviderId = "openai" | "anthropic" | "gemini";
export type ProviderId = "ollama" | ApiKeyProviderId;

export interface ProvidersConfig {
  schemaVersion: 1;
  /** null = no active provider selected yet (fresh install / all keys cleared). */
  activeProviderId: ProviderId | null;
  providers: Partial<Record<ApiKeyProviderId, { apiKey: string; model: string }>>;
}

const DEFAULT_PROVIDERS_CONFIG: ProvidersConfig = {
  schemaVersion: CURRENT_PROVIDERS_SCHEMA_VERSION,
  activeProviderId: null,
  providers: {},
};

function defaultConfig(): ProvidersConfig {
  // Fresh object each call — callers mutate the returned config freely.
  return { schemaVersion: CURRENT_PROVIDERS_SCHEMA_VERSION, activeProviderId: null, providers: {} };
}

export function providersConfigPath(): string {
  return join(globalConfigDir(), "providers.json");
}

const API_KEY_PROVIDER_IDS: ReadonlySet<string> = new Set(["openai", "anthropic", "gemini"]);

function isApiKeyProviderId(id: string): id is ApiKeyProviderId {
  return API_KEY_PROVIDER_IDS.has(id);
}

function isValidProviderId(id: unknown): id is ProviderId {
  return typeof id === "string" && (id === "ollama" || isApiKeyProviderId(id));
}

/**
 * loadProvidersConfig — read + parse + validate. Fail-soft contract per
 * STATE §3.3: missing file, corrupt JSON, missing/wrong schemaVersion, or a
 * future (greater than current) schemaVersion ALL resolve to the default
 * empty config — NEVER throws, NEVER crashes the daemon. Does NOT eagerly
 * create the file on a missing-file read (deliberate departure from
 * loadGlobalConfig()'s eager-write behavior — see STATE §3.3 rationale).
 */
export function loadProvidersConfig(): ProvidersConfig {
  const absPath = providersConfigPath();
  if (!existsSync(absPath)) {
    return defaultConfig();
  }

  let rawText: string;
  try {
    rawText = readFileSync(absPath, "utf-8");
  } catch (err) {
    console.warn(`[symbion] providers.json không thể đọc được, dùng cấu hình rỗng mặc định: ${(err as Error).message}`);
    return defaultConfig();
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    console.warn("[symbion] providers.json chứa JSON không hợp lệ — dùng cấu hình rỗng mặc định.");
    return defaultConfig();
  }

  if (typeof raw !== "object" || raw === null) {
    console.warn("[symbion] providers.json có cấu trúc không hợp lệ — dùng cấu hình rỗng mặc định.");
    return defaultConfig();
  }

  const record = raw as Record<string, unknown>;
  const schemaVersion = record["schemaVersion"];
  if (typeof schemaVersion !== "number") {
    console.warn("[symbion] providers.json thiếu schemaVersion — dùng cấu hình rỗng mặc định.");
    return defaultConfig();
  }
  if (schemaVersion > CURRENT_PROVIDERS_SCHEMA_VERSION) {
    // Distinguishable warning from the "corrupt" cases above, per STATE §3.3 case 4 —
    // written by a future Symbion version; refuse to silently downgrade-interpret it.
    console.warn(
      `[symbion] providers.json có schemaVersion=${schemaVersion} (mới hơn phiên bản hiện tại) — dùng cấu hình rỗng mặc định.`
    );
    return defaultConfig();
  }

  const activeProviderIdRaw = record["activeProviderId"];
  const activeProviderId =
    activeProviderIdRaw === null
      ? null
      : isValidProviderId(activeProviderIdRaw)
        ? activeProviderIdRaw
        : null;

  const providersRaw = record["providers"];
  const providers: ProvidersConfig["providers"] = {};
  if (typeof providersRaw === "object" && providersRaw !== null) {
    for (const [id, value] of Object.entries(providersRaw as Record<string, unknown>)) {
      if (!isApiKeyProviderId(id)) continue;
      if (typeof value !== "object" || value === null) continue;
      const entry = value as Record<string, unknown>;
      if (typeof entry["apiKey"] !== "string" || typeof entry["model"] !== "string") continue;
      providers[id] = { apiKey: entry["apiKey"], model: entry["model"] };
    }
  }

  return { schemaVersion: CURRENT_PROVIDERS_SCHEMA_VERSION, activeProviderId, providers };
}

/**
 * saveProvidersConfig — atomic temp->rename write (reuses store.ts's exact
 * primitive), with 0o600 file permissions (owner read/write only).
 */
export function saveProvidersConfig(config: ProvidersConfig): void {
  atomicWriteJson(providersConfigPath(), config, { mode: 0o600, dirMode: 0o700 });
}

export class ProviderNotConfiguredError extends Error {
  constructor(providerId: string) {
    super(`Chưa cấu hình API key cho nhà cung cấp này: ${providerId}`);
    this.name = "ProviderNotConfiguredError";
  }
}

/** setProviderKey — upserts one provider's entry. Never logs `apiKey`. */
export function setProviderKey(providerId: ApiKeyProviderId, apiKey: string, model: string): ProvidersConfig {
  const config = loadProvidersConfig();
  config.providers[providerId] = { apiKey, model };
  saveProvidersConfig(config);
  return config;
}

/**
 * clearProviderKey — removes one provider's stored key/model. If it was
 * active, resets activeProviderId to null (NOT a fallback to ollama — STATE
 * §5's explicit "no automatic fallback" rule extends here).
 */
export function clearProviderKey(providerId: ApiKeyProviderId): ProvidersConfig {
  const config = loadProvidersConfig();
  delete config.providers[providerId];
  if (config.activeProviderId === providerId) {
    config.activeProviderId = null;
  }
  saveProvidersConfig(config);
  return config;
}

/**
 * setActiveProvider — validates the provider has a stored key (or is
 * "ollama", which needs none) before accepting; throws
 * ProviderNotConfiguredError otherwise (surfaced as RPC invalid-params by the
 * handler, not a silent no-op).
 */
export function setActiveProvider(providerId: ProviderId): ProvidersConfig {
  const config = loadProvidersConfig();
  if (providerId !== "ollama" && !config.providers[providerId]) {
    throw new ProviderNotConfiguredError(providerId);
  }
  config.activeProviderId = providerId;
  saveProvidersConfig(config);
  return config;
}

/**
 * maskKey — "sk-...ab12" style masking (last 4 chars only, fixed prefix
 * ellipsis). The ONLY function permitted to touch a raw key for display.
 * Never throws; never returns the raw string unmasked, even for very short
 * inputs (TC-S7).
 */
export function maskKey(apiKey: string): string {
  if (apiKey.length <= 4) {
    return "*".repeat(apiKey.length);
  }
  const last4 = apiKey.slice(-4);
  return `...${last4}`;
}

export { DEFAULT_PROVIDERS_CONFIG };
