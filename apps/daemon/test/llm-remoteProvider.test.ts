import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { RemoteProvider, REMOTE_API_KEY_ENV_VAR } from "../src/llm/remoteProvider.js";

let server: Server | undefined;
const originalEnv = process.env[REMOTE_API_KEY_ENV_VAR];

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
  delete process.env[REMOTE_API_KEY_ENV_VAR];
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  if (originalEnv === undefined) {
    delete process.env[REMOTE_API_KEY_ENV_VAR];
  } else {
    process.env[REMOTE_API_KEY_ENV_VAR] = originalEnv;
  }
  vi.restoreAllMocks();
});

describe("RemoteProvider", () => {
  it("TC-D7: no API key configured -> rejects with auth, and attempts NO network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = new RemoteProvider();
    await expect(
      provider.generate({ systemPrompt: "s", userPrompt: "u", model: "claude-sonnet-4-5", timeoutMs: 2000 })
    ).rejects.toMatchObject({ code: "auth" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("TC-D8: dummy key set, fake server responds 200 -> resolves with text; key sent in header, not URL", async () => {
    process.env[REMOTE_API_KEY_ENV_VAR] = "dummy-test-key";
    let receivedHeaderKey: string | undefined;
    let receivedUrl: string | undefined;
    const { server: s, baseUrl } = await listenEphemeral((req, res) => {
      receivedHeaderKey = req.headers["x-api-key"] as string | undefined;
      receivedUrl = req.url;
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ content: [{ text: "Remote-generated text." }] }));
      });
    });
    server = s;

    const provider = new RemoteProvider({ baseUrl });
    const result = await provider.generate({
      systemPrompt: "s",
      userPrompt: "u",
      model: "claude-sonnet-4-5",
      timeoutMs: 2000,
    });

    expect(result).toEqual({ text: "Remote-generated text." });
    expect(receivedHeaderKey).toBe("dummy-test-key");
    expect(receivedUrl ?? "").not.toContain("dummy-test-key");
  });
});
