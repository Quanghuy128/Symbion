import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { handlers, RpcError } from "../src/rpc/handlers.js";

let server: Server | undefined;
const originalOllamaUrl = process.env["SYMBION_OLLAMA_BASE_URL"];

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
  vi.restoreAllMocks();
});

describe("handlers.checkProviderStatus", () => {
  it("TC-H1: providerId 'ollama', reachable -> { reachable: true, checkedBaseUrl, install }", async () => {
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
    expect(result.install.variants.length).toBeGreaterThan(0);
  });

  it("TC-H2: providerId 'ollama', unreachable -> resolves { reachable: false, ... }, NOT a thrown RpcError", async () => {
    process.env["SYMBION_OLLAMA_BASE_URL"] = "http://127.0.0.1:1"; // nothing listening
    const result = await handlers.checkProviderStatus({ providerId: "ollama" });
    expect(result.reachable).toBe(false);
    expect(result.checkedBaseUrl).toBe("http://127.0.0.1:1");
  });

  it("TC-H3: providerId is a non-'ollama' string ('remote') -> throws RpcError('invalid-params')", async () => {
    const promise = handlers.checkProviderStatus({
      // @ts-expect-error intentionally invalid at the type level to simulate an
      // off-the-wire JSON payload that bypasses TS's compile-time literal check.
      providerId: "remote",
    });
    await expect(promise).rejects.toBeInstanceOf(RpcError);
    await expect(promise).rejects.toMatchObject({ code: "invalid-params" });
  });

  it("TC-H4: malformed providerId (undefined/null/number) -> throws RpcError('invalid-params'), never reaches the network check", async () => {
    for (const bad of [undefined, null, 123]) {
      const promise = handlers.checkProviderStatus({
        // @ts-expect-error intentionally malformed
        providerId: bad,
      });
      await expect(promise).rejects.toBeInstanceOf(RpcError);
      await expect(promise).rejects.toMatchObject({ code: "invalid-params" });
    }
  });

  it("TC-H6: happy path response shape has all 3 top-level fields (reachable, checkedBaseUrl, install)", async () => {
    const { server: s, baseUrl } = await listenEphemeral((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    server = s;
    process.env["SYMBION_OLLAMA_BASE_URL"] = baseUrl;

    const result = await handlers.checkProviderStatus({ providerId: "ollama" });
    expect(Object.keys(result).sort()).toEqual(["checkedBaseUrl", "install", "reachable"]);
  });

  it("TC-H5: checkOllamaReachable's own contract guarantees it never throws (resolves false instead) -- documented explicitly per testplan TC-H5", async () => {
    // providerStatus.ts's checkOllamaReachable wraps its fetch in try/catch and always
    // resolves a boolean, never rejects -- asserted directly against a guaranteed-failing
    // target (invalid URL) so this handler-level test documents the contract rather than
    // leaving it as undefined/untested behavior.
    const { checkOllamaReachable } = await import("../src/llm/providerStatus.js");
    await expect(checkOllamaReachable("not a valid url", 100)).resolves.toBe(false);
  });

  it("non-loopback SYMBION_OLLAMA_BASE_URL is rejected before any network call (reuses the same SSRF guard as generateBody)", async () => {
    process.env["SYMBION_OLLAMA_BASE_URL"] = "http://example.com:9999";
    const promise = handlers.checkProviderStatus({ providerId: "ollama" });
    await expect(promise).rejects.toBeInstanceOf(Error);
  });
});
