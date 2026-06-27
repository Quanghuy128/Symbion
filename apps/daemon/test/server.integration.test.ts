import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createFakeOllamaServer, type Server as HttpServer } from "node:http";
import { startServer, type DaemonServerHandle } from "../src/server.js";

let handle: DaemonServerHandle;
let configDir: string;
let fakeOllama: HttpServer | undefined;
const originalOllamaUrl = process.env["SYMBION_OLLAMA_BASE_URL"];

beforeEach(async () => {
  configDir = mkdtempSync(join(tmpdir(), "symbion-config-"));
  process.env["SYMBION_CONFIG_DIR"] = configDir;
  // pick a high, unlikely-to-collide port per test run
  const port = 21000 + Math.floor(Math.random() * 4000);
  handle = await startServer({ port, version: "0.1.0" });
});

afterEach(async () => {
  await handle.close();
  rmSync(configDir, { recursive: true, force: true });
  delete process.env["SYMBION_CONFIG_DIR"];
  if (fakeOllama) {
    await new Promise<void>((resolve) => fakeOllama!.close(() => resolve()));
    fakeOllama = undefined;
  }
  if (originalOllamaUrl === undefined) {
    delete process.env["SYMBION_OLLAMA_BASE_URL"];
  } else {
    process.env["SYMBION_OLLAMA_BASE_URL"] = originalOllamaUrl;
  }
});

function startFakeOllama(): Promise<string> {
  return new Promise((resolve) => {
    const s = createFakeOllamaServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ response: "fake generated body" }));
    });
    fakeOllama = s;
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

async function rpc(method: string, params: unknown, opts: { token?: string; host?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token !== undefined) headers["x-symbion-token"] = opts.token;
  if (opts.host !== undefined) headers["Host"] = opts.host;

  const res = await fetch(`http://127.0.0.1:${handle.port}/rpc`, {
    method: "POST",
    headers: opts.origin !== undefined ? { ...headers, Origin: opts.origin } : headers,
    body: JSON.stringify({ method, params }),
  });
  return { status: res.status, body: await res.json() };
}

describe("T15 security", () => {
  it("server binds 127.0.0.1 (ping succeeds against 127.0.0.1)", async () => {
    const res = await rpc("ping", {});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.port).toBe(handle.port);
  });

  it("missing token on a non-ping method -> 401", async () => {
    const res = await rpc("listProjects", {});
    expect(res.status).toBe(401);
  });

  it("wrong token on a non-ping method -> 401", async () => {
    const res = await rpc("listProjects", {}, { token: "wrong-token" });
    expect(res.status).toBe(401);
  });

  it("correct token -> 200", async () => {
    const res = await rpc("listProjects", {}, { token: handle.token });
    expect(res.status).toBe(200);
  });

  it("rejects request with a foreign Origin header", async () => {
    const res = await rpc("listProjects", {}, { token: handle.token, origin: "http://evil.example.com" });
    expect(res.status).toBe(403);
  });

  it("legitimate request (correct Host implicitly set by fetch) succeeds", async () => {
    // fetch() always sets Host to the actual target (127.0.0.1:<port>), exercising
    // the allow-path of the Host allowlist check on every other test in this file.
    const res = await rpc("listProjects", {}, { token: handle.token });
    expect(res.status).toBe(200);
  });
});

describe("T15 security — raw socket request with spoofed Host header", () => {
  it("rejects a request whose Host header does not match 127.0.0.1:<port>", async () => {
    // fetch()/undici do not allow overriding the Host header from JS, so we open a
    // raw TCP socket and hand-craft the HTTP request line + headers to simulate a
    // DNS-rebinding attempt presenting a foreign Host header.
    const net = await import("node:net");
    const body = JSON.stringify({ method: "listProjects", params: {} });
    const request =
      `POST /rpc HTTP/1.1\r\n` +
      `Host: evil.example.com\r\n` +
      `Content-Type: application/json\r\n` +
      `x-symbion-token: ${handle.token}\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `Connection: close\r\n\r\n${body}`;

    const responseText: string = await new Promise((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port: handle.port }, () => {
        socket.write(request);
      });
      let data = "";
      socket.on("data", (chunk) => (data += chunk.toString()));
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
    });

    expect(responseText).toMatch(/^HTTP\/1\.1 403/);
  });
});

describe("generateBody transport (TC-S1..TC-S4)", () => {
  it("TC-S1: POST /rpc generateBody with a valid token -> 200 with the generated body", async () => {
    const baseUrl = await startFakeOllama();
    process.env["SYMBION_OLLAMA_BASE_URL"] = baseUrl;

    const res = await rpc(
      "generateBody",
      { kind: "agent", name: "x", description: "", existingBody: "", modelId: "m", providerId: "ollama" },
      { token: handle.token }
    );
    expect(res.status).toBe(200);
    expect(res.body.body).toBe("fake generated body");
  });

  it("TC-S2: POST /rpc generateBody with no token -> 401 (not added to any no-auth allowlist)", async () => {
    const res = await rpc("generateBody", {
      kind: "agent",
      name: "x",
      description: "",
      existingBody: "",
      modelId: "m",
      providerId: "ollama",
    });
    expect(res.status).toBe(401);
  });

  it("TC-S3: POST /rpc generateBody with a disallowed Origin -> 403 (same DNS-rebinding defense, no special-casing)", async () => {
    const res = await rpc(
      "generateBody",
      { kind: "agent", name: "x", description: "", existingBody: "", modelId: "m", providerId: "ollama" },
      { token: handle.token, origin: "http://evil.example.com" }
    );
    expect(res.status).toBe(403);
  });

  it("TC-S4: two back-to-back generateBody POSTs are both independently processed (no daemon-side concurrency guard)", async () => {
    const baseUrl = await startFakeOllama();
    process.env["SYMBION_OLLAMA_BASE_URL"] = baseUrl;

    const params = { kind: "agent", name: "x", description: "", existingBody: "", modelId: "m", providerId: "ollama" };
    const [res1, res2] = await Promise.all([
      rpc("generateBody", params, { token: handle.token }),
      rpc("generateBody", params, { token: handle.token }),
    ]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});

describe("listDir / makeDir transport (TC-RPC1..TC-RPC9)", () => {
  it("TC-RPC1: listDir without a token -> 401 (no free pass for read-only methods)", async () => {
    const res = await rpc("listDir", {});
    expect(res.status).toBe(401);
  });

  it("TC-RPC3: listDir with a valid token -> 200 with the expected ListDirResult shape", async () => {
    const dir = mkdtempSync(join(tmpdir(), "symbion-listdir-rpc-"));
    try {
      const res = await rpc("listDir", { path: dir }, { token: handle.token });
      expect(res.status).toBe(200);
      expect(res.body.path).toBe(dir);
      expect(Array.isArray(res.body.entries)).toBe(true);
      expect(res.body.denied).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TC-RPC4: makeDir with a valid token -> 200, dir created on disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "symbion-makedir-rpc-"));
    try {
      const target = join(dir, "x");
      const res = await rpc("makeDir", { path: target }, { token: handle.token });
      expect(res.status).toBe(200);
      expect(res.body.created).toBe(true);
      expect(existsSync(target)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TC-RPC5: malformed makeDir params (path missing) -> 400 invalid-params", async () => {
    const res = await rpc("makeDir", {}, { token: handle.token });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid-params");
  });

  it("TC-RPC8: makeDir with no `params` key at all in the request body -> 400 invalid-params (not 500)", async () => {
    // JSON.stringify drops an `undefined` property entirely, so passing
    // `undefined` here reproduces a client that omits `params` from the JSON
    // body altogether (distinct from TC-RPC5's `params: {}`, which still has
    // an empty-but-present params object).
    const res = await rpc("makeDir", undefined, { token: handle.token });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid-params");
  });

  it("TC-RPC9: listDir with no `params` key at all in the request body -> 400/200, never 500", async () => {
    // listDir treats a missing path as "default to homedir()", so the absent
    // `params` key alone should NOT crash into a 500 internal-error; the
    // dispatch-layer `body.params ?? {}` default means handlers.listDir
    // receives `{}` (path undefined) just like an explicit `params: {}` would,
    // which is a valid, successful call (lists the daemon's home directory).
    const res = await rpc("listDir", undefined, { token: handle.token });
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  it("makeDir without a token -> 401 (mutating method, not read-only)", async () => {
    const res = await rpc("makeDir", { path: "/tmp/whatever" });
    expect(res.status).toBe(401);
  });
});

describe("listModels transport", () => {
  it("POST /rpc listModels with a valid token -> 200 with 3 models", async () => {
    const res = await rpc("listModels", { providerId: "ollama" }, { token: handle.token });
    expect(res.status).toBe(200);
    expect(res.body.models).toHaveLength(3);
  });

  it("POST /rpc listModels with no token -> 401", async () => {
    const res = await rpc("listModels", { providerId: "ollama" });
    expect(res.status).toBe(401);
  });
});
