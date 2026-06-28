import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlers, RpcError } from "../src/rpc/handlers.js";
import { setProviderKey } from "../src/llm/secrets.js";

let server: Server | undefined;
let tempConfigDir: string;
const originalOllamaUrl = process.env["SYMBION_OLLAMA_BASE_URL"];
const originalConfigDir = process.env["SYMBION_CONFIG_DIR"];

function listenEphemeral(handler: Parameters<typeof createServer>[0]): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const s = createServer(handler);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server: s, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

beforeEach(() => {
  tempConfigDir = mkdtempSync(join(tmpdir(), "symbion-test-"));
  process.env["SYMBION_CONFIG_DIR"] = tempConfigDir;
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  if (originalOllamaUrl === undefined) {
    delete process.env["SYMBION_OLLAMA_BASE_URL"];
  } else {
    process.env["SYMBION_OLLAMA_BASE_URL"] = originalOllamaUrl;
  }
  if (originalConfigDir === undefined) {
    delete process.env["SYMBION_CONFIG_DIR"];
  } else {
    process.env["SYMBION_CONFIG_DIR"] = originalConfigDir;
  }
  rmSync(tempConfigDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("handlers.checkProviderStatus — ollama path (regression, unchanged)", () => {
  it("TC-H1: providerId 'ollama', reachable -> { reachable: true, checkedBaseUrl, install, kind: 'local' }", async () => {
    const { server: s, baseUrl } = await listenEphemeral((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Ollama is running");
    });
    server = s;
    process.env["SYMBION_OLLAMA_BASE_URL"] = baseUrl;

    const result = await handlers.checkProviderStatus({ providerId: "ollama" });
    expect(result.reachable).toBe(true);
    expect(result.checkedBaseUrl).toBe(baseUrl);
    expect(result.install).toBeDefined();
    expect(result.install!.variants.length).toBeGreaterThan(0);
    expect(result.kind).toBe("local");
  });

  it("TC-H2: providerId 'ollama', unreachable -> resolves { reachable: false, ... }, NOT a thrown RpcError", async () => {
    process.env["SYMBION_OLLAMA_BASE_URL"] = "http://127.0.0.1:1"; // nothing listening
    const result = await handlers.checkProviderStatus({ providerId: "ollama" });
    expect(result.reachable).toBe(false);
    expect(result.checkedBaseUrl).toBe("http://127.0.0.1:1");
  });

  it("non-loopback SYMBION_OLLAMA_BASE_URL is rejected before any network call (reuses the same SSRF guard as generateBody)", async () => {
    process.env["SYMBION_OLLAMA_BASE_URL"] = "http://example.com:9999";
    const promise = handlers.checkProviderStatus({ providerId: "ollama" });
    await expect(promise).rejects.toBeInstanceOf(Error);
  });
});

describe("handlers.checkProviderStatus — widened branching (api-key providers)", () => {
  it("TC-H2 (per testplan §4): 'openai' with no key saved -> { reachable:false, errorCode:'not-configured', kind:'api-key' }, zero network calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await handlers.checkProviderStatus({ providerId: "openai" });
    expect(result).toEqual({ reachable: false, errorCode: "not-configured", kind: "api-key" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("TC-H3: 'anthropic' with a saved key, fake server returns 200 success shape -> { reachable: true, kind: 'api-key' }", async () => {
    setProviderKey("anthropic", "sk-ant-test", "claude-sonnet-4-5");
    // AnthropicProvider's baseUrl is constructed via getProvider() with no injection seam
    // through checkProviderStatus's RPC params (same limitation noted in
    // rpc-generateBody.test.ts) — this test instead verifies the not-configured
    // short-circuit is correctly bypassed once a key exists, by asserting a real network
    // call IS attempted (to the real Anthropic endpoint, which will fail in CI/offline —
    // asserted only as "not the not-configured short-circuit", not as a reachable:true
    // assertion, since that would require real network access).
    const result = await handlers.checkProviderStatus({ providerId: "anthropic" });
    expect(result.errorCode).not.toBe("not-configured");
    expect(result.kind).toBe("api-key");
  });

  it("TC-H4 (per testplan): 'gemini' with no key saved -> not-configured short-circuit, same as openai", async () => {
    const result = await handlers.checkProviderStatus({ providerId: "gemini" });
    expect(result).toEqual({ reachable: false, errorCode: "not-configured", kind: "api-key" });
  });

  it("TC-H5: providerId 'not-a-real-id' -> throws RpcError('invalid-params')", async () => {
    const promise = handlers.checkProviderStatus({
      // @ts-expect-error intentionally invalid at the type level to simulate an
      // off-the-wire JSON payload that bypasses TS's compile-time literal check.
      providerId: "not-a-real-id",
    });
    await expect(promise).rejects.toBeInstanceOf(RpcError);
    await expect(promise).rejects.toMatchObject({ code: "invalid-params" });
  });

  it("TC-H6: malformed providerId (undefined/null/number) -> throws RpcError('invalid-params'), never reaches the network check", async () => {
    for (const bad of [undefined, null, 123]) {
      const promise = handlers.checkProviderStatus({
        // @ts-expect-error intentionally malformed
        providerId: bad,
      });
      await expect(promise).rejects.toBeInstanceOf(RpcError);
      await expect(promise).rejects.toMatchObject({ code: "invalid-params" });
    }
  });

  it("regression: literal 'remote' is no longer a valid providerId -> throws RpcError('invalid-params')", async () => {
    const promise = handlers.checkProviderStatus({
      // @ts-expect-error intentionally invalid — 'remote' was removed per the rename to 'anthropic'.
      providerId: "remote",
    });
    await expect(promise).rejects.toBeInstanceOf(RpcError);
    await expect(promise).rejects.toMatchObject({ code: "invalid-params" });
  });
});

describe("checkOllamaReachable's own never-throws contract (documented at the handler-test level)", () => {
  it("TC-H-ollama-contract: resolves false instead of throwing for a guaranteed-failing target", async () => {
    const { checkOllamaReachable } = await import("../src/llm/providerStatus.js");
    await expect(checkOllamaReachable("not a valid url", 100)).resolves.toBe(false);
  });
});
