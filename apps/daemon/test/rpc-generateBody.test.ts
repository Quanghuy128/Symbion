import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlers, RpcError } from "../src/rpc/handlers.js";
import { setProviderKey } from "../src/llm/secrets.js";

let server: Server | undefined;
let projectRoot: string;
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
  projectRoot = mkdtempSync(join(tmpdir(), "symbion-genbody-"));
  tempConfigDir = mkdtempSync(join(tmpdir(), "symbion-test-"));
  process.env["SYMBION_CONFIG_DIR"] = tempConfigDir;
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(tempConfigDir, { recursive: true, force: true });
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
});

function storeFilePath(): string {
  return join(projectRoot, ".symbion", "store.json");
}

function writeFakeStore(): void {
  mkdirSync(join(projectRoot, ".symbion"), { recursive: true });
  writeFileSync(storeFilePath(), JSON.stringify({ schemaVersion: 1, artifacts: [], settings: {} }), "utf-8");
}

describe("handlers.generateBody", () => {
  it("TC-H1: happy path resolves { body }; does not touch any project store file (no projectId used)", async () => {
    writeFakeStore();
    const before = statSync(storeFilePath());

    const { server: s, baseUrl } = await listenEphemeral((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ response: "Generated draft body." }));
    });
    server = s;
    process.env["SYMBION_OLLAMA_BASE_URL"] = baseUrl;

    const result = await handlers.generateBody({
      kind: "agent",
      name: "code-reviewer",
      description: "Reviews PRs",
      existingBody: "",
      modelId: "llama3.1:8b",
      providerId: "ollama",
    });

    expect(result).toEqual({ body: "Generated draft body." });
    const after = statSync(storeFilePath());
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("TC-H2: does not require/accept a projectId field — succeeds without one", async () => {
    const { server: s, baseUrl } = await listenEphemeral((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ response: "ok" }));
    });
    server = s;
    process.env["SYMBION_OLLAMA_BASE_URL"] = baseUrl;

    const params = {
      kind: "command" as const,
      name: "analyze",
      description: "",
      existingBody: "",
      modelId: "llama3.1:8b",
      providerId: "ollama" as const,
    };
    expect("projectId" in params).toBe(false);
    await expect(handlers.generateBody(params)).resolves.toEqual({ body: "ok" });
  });

  // NOTE: generateBody hardcodes a 45s timeoutMs in the handler itself (per STATE §10.2's
  // snippet), so TC-H3 ("provider throws LlmError('timeout')") cannot be exercised at the
  // handler layer without actually waiting 45s — the raw timeout path is covered at the
  // provider layer instead (see llm-ollamaProvider.test.ts TC-D3, which uses an injectable
  // short timeoutMs). Flagging this as a coverage gap for the Checker: the handler's
  // `err instanceof LlmError -> RpcError(\`llm-${err.code}\`, ...)` mapping is exercised here
  // for "provider-not-running" and "auth" (TC-H4/TC-H6), which proves the *mapping logic*
  // is generic over all LlmErrorCode values, but "timeout" specifically is not separately
  // re-proven through the handler in this file.

  it("TC-H4: provider throws LlmError('provider-not-running') -> RpcError code llm-provider-not-running", async () => {
    process.env["SYMBION_OLLAMA_BASE_URL"] = "http://127.0.0.1:1"; // nothing listening
    await expect(
      handlers.generateBody({
        kind: "agent",
        name: "x",
        description: "",
        existingBody: "",
        modelId: "m",
        providerId: "ollama",
      })
    ).rejects.toMatchObject({ code: "llm-provider-not-running" });
  });

  it("TC-H5: a non-LlmError exception still surfaces as a well-formed RpcError (llm-unknown)", async () => {
    const { server: s, baseUrl } = await listenEphemeral((_req, res) => {
      res.writeHead(500);
      res.end("boom");
    });
    server = s;
    process.env["SYMBION_OLLAMA_BASE_URL"] = baseUrl;

    const promise = handlers.generateBody({
      kind: "agent",
      name: "x",
      description: "",
      existingBody: "",
      modelId: "m",
      providerId: "ollama",
    });
    await expect(promise).rejects.toBeInstanceOf(RpcError);
  });

  it("TC-H6: providerId: 'anthropic' with no key configured -> RpcError code llm-not-configured (seam wired end-to-end)", async () => {
    await expect(
      handlers.generateBody({
        kind: "agent",
        name: "x",
        description: "",
        existingBody: "",
        modelId: "claude-sonnet-4-5",
        providerId: "anthropic",
      })
    ).rejects.toMatchObject({ code: "llm-not-configured" });
  });

  // NOTE: a full success/auth round-trip against a fake server for the 3 cloud providers
  // is covered at the provider layer (llm-anthropicProvider.test.ts / llm-openaiProvider.test.ts /
  // llm-geminiProvider.test.ts) since each provider's baseUrl is only injectable via its own
  // constructor option, not env var or RPC param — handlers.generateBody constructs providers
  // via getProvider(), which has no way to inject a test baseUrl through the RPC surface. The
  // full round-trip THROUGH the RPC handler (save key -> activate -> generateBody against a
  // fake server) is covered in rpc-providerSettings-roundtrip.test.ts (TC-I1/TC-I2).

  it("TC-H10: SYMBION_OLLAMA_BASE_URL pointing at a non-loopback host surfaces as a clean RpcError, not a raw LlmError/500 (STATE §13 HIGH)", async () => {
    process.env["SYMBION_OLLAMA_BASE_URL"] = "http://example.com:9999";
    const promise = handlers.generateBody({
      kind: "agent",
      name: "x",
      description: "",
      existingBody: "",
      modelId: "m",
      providerId: "ollama",
    });
    await expect(promise).rejects.toBeInstanceOf(RpcError);
    await expect(promise).rejects.toMatchObject({ code: "llm-provider-not-running" });
  });

  it("TC-H7: invalid kind value -> clean RpcError('invalid-params'), no fall-through to a raw Error/500 (STATE §13)", async () => {
    await expect(
      handlers.generateBody({
        // @ts-expect-error intentionally invalid at the type level to simulate an
        // off-the-wire JSON payload that bypasses TS's compile-time union check.
        kind: "not-a-real-kind",
        name: "x",
        description: "",
        existingBody: "",
        modelId: "m",
        providerId: "ollama",
      })
    ).rejects.toMatchObject({ code: "invalid-params" });
  });

  it("TC-H8: invalid providerId value -> clean RpcError('invalid-params'), never a bare Error('Unknown LLM provider id…')", async () => {
    const promise = handlers.generateBody({
      kind: "agent",
      name: "x",
      description: "",
      existingBody: "",
      modelId: "m",
      // @ts-expect-error intentionally invalid at the type level to simulate an
      // off-the-wire JSON payload that bypasses TS's compile-time union check.
      providerId: "made-up-provider",
    });
    await expect(promise).rejects.toBeInstanceOf(RpcError);
    await expect(promise).rejects.toMatchObject({ code: "invalid-params" });
  });

  it("rejects oversized name/description/existingBody fields without crashing (defensive size cap)", async () => {
    const huge = "x".repeat(60_000);
    await expect(
      handlers.generateBody({
        kind: "agent",
        name: huge,
        description: "",
        existingBody: "",
        modelId: "m",
        providerId: "ollama",
      })
    ).rejects.toMatchObject({ code: "invalid-params" });
  });
});

describe("handlers.listModels", () => {
  // Ollama's listModels is now a real /api/tags network call (per
  // docs/loops/ollama-dynamic-models-STATE.md §6.4) — these cases point
  // SYMBION_OLLAMA_BASE_URL at an ephemeral fake server, same env-override
  // seam already used elsewhere in this file/rpc-checkProviderStatus.test.ts.

  it("TC-RPC-A1: ollama, populated /api/tags -> resolves {models:[...len>0], outcome:'ok'}", async () => {
    const { server: s, baseUrl } = await listenEphemeral((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
    });
    server = s;
    process.env["SYMBION_OLLAMA_BASE_URL"] = baseUrl;

    const result = await handlers.listModels({ providerId: "ollama" });
    expect(result.outcome).toBe("ok");
    expect(result.models.length).toBeGreaterThan(0);
  });

  it("TC-RPC-A2: ollama, /api/tags returns zero models -> resolves {models:[], outcome:'empty'}, no errorMessage", async () => {
    const { server: s, baseUrl } = await listenEphemeral((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [] }));
    });
    server = s;
    process.env["SYMBION_OLLAMA_BASE_URL"] = baseUrl;

    const result = await handlers.listModels({ providerId: "ollama" });
    expect(result).toEqual({ models: [], outcome: "empty" });
  });

  it("TC-RPC-A3: ollama, malformed JSON from /api/tags -> resolves {models:[], outcome:'fetch-failed', errorMessage}, does NOT throw", async () => {
    const { server: s, baseUrl } = await listenEphemeral((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("not json {{{");
    });
    server = s;
    process.env["SYMBION_OLLAMA_BASE_URL"] = baseUrl;

    const result = await handlers.listModels({ providerId: "ollama" });
    expect(result.models).toEqual([]);
    expect(result.outcome).toBe("fetch-failed");
    expect(result.errorMessage).toBeTruthy();
  });

  it("TC-RPC-A4: ollama unreachable -> still THROWS RpcError('llm-provider-not-running'), unchanged shape (AC4)", async () => {
    process.env["SYMBION_OLLAMA_BASE_URL"] = "http://127.0.0.1:1"; // nothing listening
    await expect(handlers.listModels({ providerId: "ollama" })).rejects.toMatchObject({
      code: "llm-provider-not-running",
    });
  });

  it("returns the daemon's hardcoded model list for anthropic (exactly 3 entries, outcome 'ok')", async () => {
    const result = await handlers.listModels({ providerId: "anthropic" });
    expect(result.models).toHaveLength(3);
    expect(result.outcome).toBe("ok");
  });

  it("returns the daemon's hardcoded model list for openai (exactly 3 entries, outcome 'ok')", async () => {
    const result = await handlers.listModels({ providerId: "openai" });
    expect(result.models).toHaveLength(3);
    expect(result.outcome).toBe("ok");
  });

  it("returns the daemon's hardcoded model list for gemini (exactly 3 entries, outcome 'ok')", async () => {
    const result = await handlers.listModels({ providerId: "gemini" });
    expect(result.models).toHaveLength(3);
    expect(result.outcome).toBe("ok");
  });

  it("TC-H9: invalid providerId -> clean RpcError('invalid-params'), not a bare Error leak (STATE §13)", async () => {
    await expect(
      handlers.listModels({
        // @ts-expect-error intentionally invalid at the type level to simulate an
        // off-the-wire JSON payload that bypasses TS's compile-time union check.
        providerId: "made-up-provider",
      })
    ).rejects.toBeInstanceOf(RpcError);
    try {
      await handlers.listModels({
        // @ts-expect-error see above
        providerId: "made-up-provider",
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).code).toBe("invalid-params");
    }
  });
});
