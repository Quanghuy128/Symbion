import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlers, RpcError } from "../src/rpc/handlers.js";

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
});

describe("handlers.listProviders", () => {
  it("TC-P1: fresh daemon (no providers.json) -> 4 descriptors, all configured:false, all active:false", () => {
    const result = handlers.listProviders({});
    expect(result.providers).toHaveLength(4);
    expect(result.providers.every((p) => p.configured === false || p.id === "ollama")).toBe(true);
    // ollama is always "configured" (needs no key) but never active by default
    const ollama = result.providers.find((p) => p.id === "ollama")!;
    expect(ollama.active).toBe(false);
    for (const p of result.providers) {
      if (p.id === "ollama") continue;
      expect(p.configured).toBe(false);
      expect(p.active).toBe(false);
      expect(p.maskedKey).toBeUndefined();
    }
  });
});

describe("handlers.saveProviderKey", () => {
  it("TC-P2: saves a key -> configured:true, maskedKey ends in the real last 4 chars, raw key absent from the response", () => {
    const result = handlers.saveProviderKey({ providerId: "openai", apiKey: "sk-abc123xyz999", model: "gpt-4o-mini" });
    const openai = result.providers.find((p) => p.id === "openai")!;
    expect(openai.configured).toBe(true);
    expect(openai.maskedKey).toMatch(/z999$/);
    const raw = JSON.stringify(result);
    expect(raw).not.toContain("sk-abc123xyz999");
  });

  it("TC-P3: empty apiKey -> RpcError('invalid-params'), no file write occurs", () => {
    expect(() => handlers.saveProviderKey({ providerId: "openai", apiKey: "" })).toThrow(RpcError);
    const after = handlers.listProviders({});
    expect(after.providers.find((p) => p.id === "openai")!.configured).toBe(false);
  });

  it("whitespace-only apiKey -> RpcError('invalid-params')", () => {
    expect(() => handlers.saveProviderKey({ providerId: "openai", apiKey: "   " })).toThrow(RpcError);
  });

  it("TC-P4: oversized apiKey -> RpcError('invalid-params')", () => {
    expect(() => handlers.saveProviderKey({ providerId: "openai", apiKey: "x".repeat(100_000) })).toThrow(RpcError);
  });

  it("TC-P5: invalid providerId -> RpcError('invalid-params')", () => {
    expect(() =>
      handlers.saveProviderKey({
        // @ts-expect-error intentionally invalid
        providerId: "not-a-real-id",
        apiKey: "abc",
      })
    ).toThrow(RpcError);
  });

  it("'ollama' is rejected as a saveProviderKey target (it never has a stored key)", () => {
    expect(() =>
      handlers.saveProviderKey({
        // @ts-expect-error intentionally invalid for this handler
        providerId: "ollama",
        apiKey: "abc",
      })
    ).toThrow(RpcError);
  });
});

describe("handlers.clearProviderKey", () => {
  it("TC-P6: clears a saved key -> configured:false; generateBody afterward fails with llm-not-configured", async () => {
    handlers.saveProviderKey({ providerId: "openai", apiKey: "sk-abc123xyz999", model: "gpt-4o-mini" });
    const result = handlers.clearProviderKey({ providerId: "openai" });
    expect(result.providers.find((p) => p.id === "openai")!.configured).toBe(false);

    await expect(
      handlers.generateBody({
        kind: "agent",
        name: "x",
        description: "",
        existingBody: "",
        modelId: "gpt-4o-mini",
        providerId: "openai",
      })
    ).rejects.toMatchObject({ code: "llm-not-configured" });
  });

  it("invalid providerId -> RpcError('invalid-params')", () => {
    expect(() =>
      handlers.clearProviderKey({
        // @ts-expect-error intentionally invalid
        providerId: "not-a-real-id",
      })
    ).toThrow(RpcError);
  });
});

describe("handlers.setActiveProvider", () => {
  it("TC-P7: activates a configured provider -> that provider active:true, all others active:false", () => {
    handlers.saveProviderKey({ providerId: "openai", apiKey: "sk-abc123xyz999", model: "gpt-4o-mini" });
    const result = handlers.setActiveProvider({ providerId: "openai" });
    for (const p of result.providers) {
      expect(p.active).toBe(p.id === "openai");
    }
  });

  it("TC-P8: activating an unconfigured provider -> RpcError('invalid-params'); activeProviderId unchanged", () => {
    expect(() => handlers.setActiveProvider({ providerId: "anthropic" })).toThrow(RpcError);
    const after = handlers.listProviders({});
    expect(after.providers.every((p) => p.active === false)).toBe(true);
  });

  it("TC-P9: 'ollama' always succeeds (needs no key)", () => {
    const result = handlers.setActiveProvider({ providerId: "ollama" });
    const ollama = result.providers.find((p) => p.id === "ollama")!;
    expect(ollama.active).toBe(true);
  });

  it("invalid providerId -> RpcError('invalid-params')", () => {
    expect(() =>
      handlers.setActiveProvider({
        // @ts-expect-error intentionally invalid
        providerId: "not-a-real-id",
      })
    ).toThrow(RpcError);
  });
});
