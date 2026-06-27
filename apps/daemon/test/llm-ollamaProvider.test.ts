import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { OLLAMA_DEFAULT_BASE_URL, OllamaProvider, resolveOllamaBaseUrl } from "../src/llm/ollamaProvider.js";
import { LlmError } from "../src/llm/types.js";

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

describe("OllamaProvider (Tier A — fake HTTP server)", () => {
  it("TC-D1: happy path resolves with the fake server's content; sends model/prompt/content-type", async () => {
    let receivedBody: any;
    let receivedContentType: string | undefined;
    const { server: s, baseUrl } = await listenEphemeral((req, res) => {
      receivedContentType = req.headers["content-type"];
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        receivedBody = JSON.parse(raw);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ response: "Generated content here." }));
      });
    });
    server = s;

    const provider = new OllamaProvider({ baseUrl });
    const result = await provider.generate({
      systemPrompt: "sys",
      userPrompt: "user prompt text",
      model: "llama3.1:8b",
      timeoutMs: 5000,
    });

    expect(result).toEqual({ text: "Generated content here." });
    expect(receivedContentType).toContain("application/json");
    expect(receivedBody.model).toBe("llama3.1:8b");
    expect(receivedBody.prompt).toBe("user prompt text");
    expect(receivedBody.system).toBe("sys");
  });

  it("TC-D2: nothing listening at all -> provider-not-running", async () => {
    const provider = new OllamaProvider({ baseUrl: "http://127.0.0.1:1" });
    await expect(
      provider.generate({ systemPrompt: "s", userPrompt: "u", model: "m", timeoutMs: 2000 })
    ).rejects.toMatchObject({ code: "provider-not-running" });
  });

  it("TC-D3: server delays beyond timeout -> timeout, and the underlying request is actually aborted", async () => {
    let aborted = false;
    const { server: s, baseUrl } = await listenEphemeral((req, res) => {
      req.on("aborted", () => {
        aborted = true;
      });
      // Never respond — simulate a hang.
      setTimeout(() => {
        try {
          res.writeHead(200);
          res.end(JSON.stringify({ response: "too late" }));
        } catch {
          // connection already closed
        }
      }, 2000);
    });
    server = s;

    const provider = new OllamaProvider({ baseUrl });
    await expect(
      provider.generate({ systemPrompt: "s", userPrompt: "u", model: "m", timeoutMs: 50 })
    ).rejects.toMatchObject({ code: "timeout" });

    // give the server a tick to observe the abort
    await new Promise((r) => setTimeout(r, 100));
    expect(aborted).toBe(true);
  });

  it("TC-D4: HTTP 200 with malformed/non-JSON body -> invalid-response", async () => {
    const { server: s, baseUrl } = await listenEphemeral((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("not json at all {{{");
    });
    server = s;

    const provider = new OllamaProvider({ baseUrl });
    await expect(
      provider.generate({ systemPrompt: "s", userPrompt: "u", model: "m", timeoutMs: 2000 })
    ).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("TC-D5: HTTP 404 (model not found) -> rejects with an LlmError, never resolves with garbage text", async () => {
    const { server: s, baseUrl } = await listenEphemeral((_req, res) => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "model not found" }));
    });
    server = s;

    const provider = new OllamaProvider({ baseUrl });
    const promise = provider.generate({ systemPrompt: "s", userPrompt: "u", model: "nonexistent", timeoutMs: 2000 });
    await expect(promise).rejects.toBeInstanceOf(LlmError);
  });

  it("TC-D7: SYMBION_OLLAMA_BASE_URL pointing at a non-loopback host is rejected at construction time, never fetched", async () => {
    const original = process.env["SYMBION_OLLAMA_BASE_URL"];
    process.env["SYMBION_OLLAMA_BASE_URL"] = "http://example.com:9999";
    try {
      expect(() => new OllamaProvider()).toThrow(LlmError);
      try {
        new OllamaProvider();
        expect.unreachable("constructor should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(LlmError);
        expect((err as LlmError).code).toBe("provider-not-running");
      }
    } finally {
      if (original === undefined) delete process.env["SYMBION_OLLAMA_BASE_URL"];
      else process.env["SYMBION_OLLAMA_BASE_URL"] = original;
    }
  });

  it("TC-D8: SYMBION_OLLAMA_BASE_URL set to a loopback host (127.0.0.1/localhost/::1) is accepted", () => {
    const original = process.env["SYMBION_OLLAMA_BASE_URL"];
    try {
      for (const host of ["http://127.0.0.1:11434", "http://localhost:11434", "http://[::1]:11434"]) {
        process.env["SYMBION_OLLAMA_BASE_URL"] = host;
        expect(() => new OllamaProvider()).not.toThrow();
      }
    } finally {
      if (original === undefined) delete process.env["SYMBION_OLLAMA_BASE_URL"];
      else process.env["SYMBION_OLLAMA_BASE_URL"] = original;
    }
  });

  it("TC-D9: an explicit constructor baseUrl bypasses the loopback check (trusted test-fixture path only)", () => {
    // Constructor-injected baseUrl is only ever set by trusted code (tests), never by an
    // external actor via env, so it intentionally does not go through isLoopbackUrl().
    expect(() => new OllamaProvider({ baseUrl: "http://example.com:9999" })).not.toThrow();
  });

  it("TC-D10: resolveOllamaBaseUrl() default (no env override) returns OLLAMA_DEFAULT_BASE_URL, same as the constructor's default path", () => {
    const original = process.env["SYMBION_OLLAMA_BASE_URL"];
    delete process.env["SYMBION_OLLAMA_BASE_URL"];
    try {
      expect(resolveOllamaBaseUrl()).toBe(OLLAMA_DEFAULT_BASE_URL);
    } finally {
      if (original === undefined) delete process.env["SYMBION_OLLAMA_BASE_URL"];
      else process.env["SYMBION_OLLAMA_BASE_URL"] = original;
    }
  });

  it("TC-D11 (regression guard): the extraction of resolveOllamaBaseUrl() did not change OllamaProvider's loopback-guard behavior — TC-D7/TC-D8/TC-D9 still pass (re-asserted here explicitly)", () => {
    const original = process.env["SYMBION_OLLAMA_BASE_URL"];
    try {
      // non-loopback -> rejected at construction time, same as resolveOllamaBaseUrl() itself throwing
      process.env["SYMBION_OLLAMA_BASE_URL"] = "http://example.com:9999";
      expect(() => resolveOllamaBaseUrl()).toThrow(LlmError);
      expect(() => new OllamaProvider()).toThrow(LlmError);

      // loopback hosts -> accepted by both the standalone resolver and the constructor
      for (const host of ["http://127.0.0.1:11434", "http://localhost:11434", "http://[::1]:11434"]) {
        process.env["SYMBION_OLLAMA_BASE_URL"] = host;
        expect(resolveOllamaBaseUrl()).toBe(host);
        expect(() => new OllamaProvider()).not.toThrow();
      }
    } finally {
      if (original === undefined) delete process.env["SYMBION_OLLAMA_BASE_URL"];
      else process.env["SYMBION_OLLAMA_BASE_URL"] = original;
    }
  });

  it("TC-D6: listModels() returns exactly 3 entries with all 3 tiers represented exactly once", () => {
    const provider = new OllamaProvider();
    const models = provider.listModels();
    expect(models).toHaveLength(3);
    for (const m of models) {
      expect(m.id).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(["fast", "balanced", "best"]).toContain(m.tier);
    }
    const tiers = models.map((m) => m.tier).sort();
    expect(tiers).toEqual(["balanced", "best", "fast"]);
  });
});
