import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAiProvider } from "../src/llm/openaiProvider.js";
import { setProviderKey } from "../src/llm/secrets.js";

let server: Server | undefined;
let tempConfigDir: string;
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
  if (originalConfigDir === undefined) {
    delete process.env["SYMBION_CONFIG_DIR"];
  } else {
    process.env["SYMBION_CONFIG_DIR"] = originalConfigDir;
  }
  rmSync(tempConfigDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("OpenAiProvider", () => {
  it("TC-A1: no API key configured -> rejects with not-configured, and attempts NO network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = new OpenAiProvider();
    await expect(
      provider.generate({ systemPrompt: "s", userPrompt: "u", model: "gpt-4o-mini", timeoutMs: 2000 })
    ).rejects.toMatchObject({ code: "not-configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("success: key saved, fake server responds 200 -> resolves with text; key sent via Authorization header", async () => {
    setProviderKey("openai", "dummy-test-key", "gpt-4o-mini");
    let receivedAuthHeader: string | undefined;
    const { server: s, baseUrl } = await listenEphemeral((req, res) => {
      receivedAuthHeader = req.headers["authorization"] as string | undefined;
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "OpenAI-generated text." } }] }));
      });
    });
    server = s;

    const provider = new OpenAiProvider({ baseUrl });
    const result = await provider.generate({
      systemPrompt: "s",
      userPrompt: "u",
      model: "gpt-4o-mini",
      timeoutMs: 2000,
    });

    expect(result).toEqual({ text: "OpenAI-generated text." });
    expect(receivedAuthHeader).toBe("Bearer dummy-test-key");
  });

  it("401 -> rejects with auth", async () => {
    setProviderKey("openai", "dummy-test-key", "gpt-4o-mini");
    const { server: s, baseUrl } = await listenEphemeral((_req, res) => {
      res.writeHead(401);
      res.end("unauthorized");
    });
    server = s;
    const provider = new OpenAiProvider({ baseUrl });
    await expect(
      provider.generate({ systemPrompt: "s", userPrompt: "u", model: "gpt-4o-mini", timeoutMs: 2000 })
    ).rejects.toMatchObject({ code: "auth" });
  });

  it("429 -> rejects with rate-limit", async () => {
    setProviderKey("openai", "dummy-test-key", "gpt-4o-mini");
    const { server: s, baseUrl } = await listenEphemeral((_req, res) => {
      res.writeHead(429);
      res.end("too many requests");
    });
    server = s;
    const provider = new OpenAiProvider({ baseUrl });
    await expect(
      provider.generate({ systemPrompt: "s", userPrompt: "u", model: "gpt-4o-mini", timeoutMs: 2000 })
    ).rejects.toMatchObject({ code: "rate-limit" });
  });

  it("hangs past timeout -> rejects with timeout, settles near the configured timeout", async () => {
    setProviderKey("openai", "dummy-test-key", "gpt-4o-mini");
    const { server: s, baseUrl } = await listenEphemeral((_req, _res) => {
      // never respond
    });
    server = s;
    const provider = new OpenAiProvider({ baseUrl });
    const start = Date.now();
    await expect(
      provider.generate({ systemPrompt: "s", userPrompt: "u", model: "gpt-4o-mini", timeoutMs: 100 })
    ).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("listModels() returns a non-empty static array with id/label/tier, no network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = new OpenAiProvider();
    const models = await provider.listModels();
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(typeof m.id).toBe("string");
      expect(typeof m.label).toBe("string");
      expect(["fast", "balanced", "best"]).toContain(m.tier);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
