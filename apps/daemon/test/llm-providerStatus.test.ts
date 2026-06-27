import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { checkOllamaReachable } from "../src/llm/providerStatus.js";

let server: Server | undefined;

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
});

describe("checkOllamaReachable (Tier A — fake HTTP server)", () => {
  it("TC-D1: 200 'Ollama is running' on GET / -> resolves true", async () => {
    const { server: s, baseUrl } = await listenEphemeral((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Ollama is running");
    });
    server = s;

    await expect(checkOllamaReachable(baseUrl, 3000)).resolves.toBe(true);
  });

  it("TC-D2: 404 on GET / -> resolves true (any HTTP response counts as reachable, not gated on status code)", async () => {
    const { server: s, baseUrl } = await listenEphemeral((_req, res) => {
      res.writeHead(404);
      res.end("not found");
    });
    server = s;

    await expect(checkOllamaReachable(baseUrl, 3000)).resolves.toBe(true);
  });

  it("TC-D3: nothing listening -> resolves false (connection refused)", async () => {
    await expect(checkOllamaReachable("http://127.0.0.1:1", 3000)).resolves.toBe(false);
  });

  it("TC-D4: server never responds -> resolves false within the bounded timeout, not indefinitely", async () => {
    const { server: s, baseUrl } = await listenEphemeral((_req, _res) => {
      // never respond — simulate a hang
    });
    server = s;

    const start = Date.now();
    const result = await checkOllamaReachable(baseUrl, 50);
    const elapsed = Date.now() - start;

    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(1000); // generous upper bound, still proves it's bounded not indefinite
  });

  it("TC-D5: server resets the connection before any HTTP response is sent -> resolves false, not thrown unhandled", async () => {
    const { server: s, baseUrl } = await listenEphemeral((_req, res) => {
      // Destroy the underlying socket with a reset BEFORE writing any HTTP response —
      // this is a connection-level failure (ECONNRESET), not a parseable HTTP response,
      // so fetch must reject (caught -> resolves false), unlike TC-D2's "real but
      // non-2xx response" case where fetch resolves successfully.
      res.socket?.resetAndDestroy?.() ?? res.socket?.destroy();
    });
    server = s;

    await expect(checkOllamaReachable(baseUrl, 3000)).resolves.toBe(false);
  });
});
