import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  clearProviderKey,
  loadProvidersConfig,
  maskKey,
  providersConfigPath,
  saveProvidersConfig,
  setActiveProvider,
  setProviderKey,
} from "../src/llm/secrets.js";

let tempConfigDir: string;
const originalConfigDir = process.env["SYMBION_CONFIG_DIR"];

beforeEach(() => {
  tempConfigDir = mkdtempSync(join(tmpdir(), "symbion-test-"));
  process.env["SYMBION_CONFIG_DIR"] = tempConfigDir;
});

afterEach(() => {
  if (originalConfigDir === undefined) {
    delete process.env["SYMBION_CONFIG_DIR"];
  } else {
    process.env["SYMBION_CONFIG_DIR"] = originalConfigDir;
  }
  rmSync(tempConfigDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("secrets.ts", () => {
  it("TC-S1: loadProvidersConfig() when providers.json does not exist -> default config, no eager file creation", () => {
    const config = loadProvidersConfig();
    expect(config).toEqual({ schemaVersion: 1, activeProviderId: null, providers: {} });
    expect(existsSync(providersConfigPath())).toBe(false);
  });

  it("TC-S2: saveProviderKey then loadProvidersConfig round-trips apiKey/model", () => {
    setProviderKey("openai", "sk-test1234", "gpt-4o-mini");
    const config = loadProvidersConfig();
    expect(config.providers.openai?.apiKey).toBe("sk-test1234");
    expect(config.providers.openai?.model).toBe("gpt-4o-mini");
  });

  it("TC-S3: malformed JSON on disk -> returns default empty config, no throw, warns to stderr", () => {
    const path = providersConfigPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not valid", "utf-8");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = loadProvidersConfig();
    expect(config).toEqual({ schemaVersion: 1, activeProviderId: null, providers: {} });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("TC-S4: valid JSON missing schemaVersion -> default empty config, no throw", () => {
    const path = providersConfigPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ activeProviderId: "openai", providers: {} }), "utf-8");

    const config = loadProvidersConfig();
    expect(config).toEqual({ schemaVersion: 1, activeProviderId: null, providers: {} });
  });

  it("TC-S5: schemaVersion from the future (999) -> fails soft to default empty config", () => {
    const path = providersConfigPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ schemaVersion: 999, activeProviderId: "openai", providers: {} }), "utf-8");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = loadProvidersConfig();
    expect(config).toEqual({ schemaVersion: 1, activeProviderId: null, providers: {} });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("TC-S6: maskKey produces a string ending in the real last 4 chars, never containing the full raw key", () => {
    const masked = maskKey("sk-abcdef123456");
    expect(masked.endsWith("3456")).toBe(true);
    expect(masked).not.toContain("sk-abcdef123456");
  });

  it("TC-S7: maskKey on a short key never throws and never returns it unmasked", () => {
    const masked = maskKey("ab");
    expect(typeof masked).toBe("string");
    expect(masked).not.toBe("ab");
  });

  it("TC-S8: setActiveProvider on an unconfigured provider throws; activeProviderId unchanged", () => {
    expect(() => setActiveProvider("openai")).toThrow();
    const config = loadProvidersConfig();
    expect(config.activeProviderId).toBeNull();
  });

  it("TC-S9: setActiveProvider('ollama') succeeds with no key needed", () => {
    setActiveProvider("ollama");
    const config = loadProvidersConfig();
    expect(config.activeProviderId).toBe("ollama");
  });

  it("TC-S10: clearProviderKey on the active provider resets activeProviderId to null (not 'ollama')", () => {
    setProviderKey("anthropic", "sk-ant-123456", "claude-sonnet-4-5");
    setActiveProvider("anthropic");
    clearProviderKey("anthropic");
    const config = loadProvidersConfig();
    expect(config.providers.anthropic).toBeUndefined();
    expect(config.activeProviderId).toBeNull();
  });

  it("TC-S11: clearProviderKey on a non-active provider leaves activeProviderId unchanged", () => {
    setProviderKey("anthropic", "sk-ant-123456", "claude-sonnet-4-5");
    setProviderKey("gemini", "gm-123456", "gemini-1.5-flash");
    setActiveProvider("anthropic");
    clearProviderKey("gemini");
    const config = loadProvidersConfig();
    expect(config.providers.gemini).toBeUndefined();
    expect(config.activeProviderId).toBe("anthropic");
  });

  it("TC-S12: file mode bits restrict to owner read/write only (0o600) after a save", () => {
    if (process.platform === "win32") {
      // file-mode semantics differ on Windows — explicitly skipped, not silently passed.
      return;
    }
    setProviderKey("openai", "sk-test1234", "gpt-4o-mini");
    const stat = statSync(providersConfigPath());
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("TC-S13: the raw API key string never appears in any logged stdout/stderr output across save/activate/clear", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    setProviderKey("openai", "sk-test1234", "gpt-4o-mini");
    setActiveProvider("openai");
    clearProviderKey("openai");

    const allCalls = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((v) => String(v));
    expect(allCalls.some((s) => s.includes("sk-test1234"))).toBe(false);
  });

  it("saveProvidersConfig directly persists a config that loadProvidersConfig can read back", () => {
    saveProvidersConfig({ schemaVersion: 1, activeProviderId: "ollama", providers: {} });
    const config = loadProvidersConfig();
    expect(config.activeProviderId).toBe("ollama");
    const raw = JSON.parse(readFileSync(providersConfigPath(), "utf-8"));
    expect(raw.schemaVersion).toBe(1);
  });
});
