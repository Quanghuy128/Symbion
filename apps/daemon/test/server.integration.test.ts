import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

async function rpc(method: string, params: unknown, opts: { host?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
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

  // tokenless-daemon: the per-request session token was removed (it broke on F5
  // refresh). Non-ping methods no longer require a token — the trust boundary is
  // the loopback-only bind + Origin/Host allowlist below.
  it("non-ping method with no token -> 200 (token gate removed)", async () => {
    const res = await rpc("listProjects", {});
    expect(res.status).toBe(200);
  });

  it("rejects request with a foreign Origin header", async () => {
    const res = await rpc("listProjects", {}, { origin: "http://evil.example.com" });
    expect(res.status).toBe(403);
  });

  it("legitimate request (correct Host implicitly set by fetch) succeeds", async () => {
    // fetch() always sets Host to the actual target (127.0.0.1:<port>), exercising
    // the allow-path of the Host allowlist check on every other test in this file.
    const res = await rpc("listProjects", {});
    expect(res.status).toBe(200);
  });

  // applyTemplate reaches its handler with no token now; the assertion is that a
  // foreign Origin is still rejected before the handler runs (DNS-rebinding gate).
  it("applyTemplate with a foreign Origin -> 403 (Origin gate fires before the handler)", async () => {
    const res = await rpc(
      "applyTemplate",
      {
        projectId: "does-not-exist",
        template: { sourceTemplateId: "agent:x", kind: "agent", name: "x", description: "y", body: "z" },
      },
      { origin: "http://evil.example.com" }
    );
    expect(res.status).toBe(403);
  });

  it("applyTemplate with an allowed Origin, unknown projectId -> reaches handler, fails with a handler-level error (not 403)", async () => {
    const res = await rpc("applyTemplate", {
      projectId: "does-not-exist",
      template: { sourceTemplateId: "agent:x", kind: "agent", name: "x", description: "y", body: "z" },
    });
    expect(res.status).not.toBe(403);
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
  it("TC-S1: POST /rpc generateBody -> 200 with the generated body", async () => {
    const baseUrl = await startFakeOllama();
    process.env["SYMBION_OLLAMA_BASE_URL"] = baseUrl;

    const res = await rpc("generateBody", {
      kind: "agent",
      name: "x",
      description: "",
      existingBody: "",
      modelId: "m",
      providerId: "ollama",
    });
    expect(res.status).toBe(200);
    expect(res.body.body).toBe("fake generated body");
  });

  it("TC-S3: POST /rpc generateBody with a disallowed Origin -> 403 (DNS-rebinding defense)", async () => {
    const res = await rpc(
      "generateBody",
      { kind: "agent", name: "x", description: "", existingBody: "", modelId: "m", providerId: "ollama" },
      { origin: "http://evil.example.com" }
    );
    expect(res.status).toBe(403);
  });

  it("TC-S4: two back-to-back generateBody POSTs are both independently processed (no daemon-side concurrency guard)", async () => {
    const baseUrl = await startFakeOllama();
    process.env["SYMBION_OLLAMA_BASE_URL"] = baseUrl;

    const params = { kind: "agent", name: "x", description: "", existingBody: "", modelId: "m", providerId: "ollama" };
    const [res1, res2] = await Promise.all([rpc("generateBody", params), rpc("generateBody", params)]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});

describe("listDir / makeDir transport (TC-RPC3..TC-RPC9)", () => {
  it("TC-RPC3: listDir -> 200 with the expected ListDirResult shape", async () => {
    const dir = mkdtempSync(join(tmpdir(), "symbion-listdir-rpc-"));
    try {
      const res = await rpc("listDir", { path: dir });
      expect(res.status).toBe(200);
      expect(res.body.path).toBe(dir);
      expect(Array.isArray(res.body.entries)).toBe(true);
      expect(res.body.denied).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TC-RPC4: makeDir -> 200, dir created on disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "symbion-makedir-rpc-"));
    try {
      const target = join(dir, "x");
      const res = await rpc("makeDir", { path: target });
      expect(res.status).toBe(200);
      expect(res.body.created).toBe(true);
      expect(existsSync(target)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TC-RPC5: malformed makeDir params (path missing) -> 400 invalid-params", async () => {
    const res = await rpc("makeDir", {});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid-params");
  });

  it("TC-RPC8: makeDir with no `params` key at all in the request body -> 400 invalid-params (not 500)", async () => {
    // JSON.stringify drops an `undefined` property entirely, so passing
    // `undefined` here reproduces a client that omits `params` from the JSON
    // body altogether (distinct from TC-RPC5's `params: {}`, which still has
    // an empty-but-present params object).
    const res = await rpc("makeDir", undefined);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid-params");
  });

  it("TC-RPC9: listDir with no `params` key at all in the request body -> 400/200, never 500", async () => {
    // listDir treats a missing path as "default to homedir()", so the absent
    // `params` key alone should NOT crash into a 500 internal-error; the
    // dispatch-layer `body.params ?? {}` default means handlers.listDir
    // receives `{}` (path undefined) just like an explicit `params: {}` would,
    // which is a valid, successful call (lists the daemon's home directory).
    const res = await rpc("listDir", undefined);
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });
});

describe("listModels transport", () => {
  it("POST /rpc listModels -> 200 with 3 models (static cloud provider, unaffected by this machine's Ollama state)", async () => {
    const res = await rpc("listModels", { providerId: "anthropic" });
    expect(res.status).toBe(200);
    expect(res.body.models).toHaveLength(3);
    expect(res.body.outcome).toBe("ok");
  });

  it("POST /rpc listModels for ollama, reachable fake server -> 200 with outcome 'ok'", async () => {
    const { createServer } = await import("node:http");
    const fakeServer = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
    });
    await new Promise<void>((resolve) => fakeServer.listen(0, "127.0.0.1", () => resolve()));
    const addr = fakeServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    process.env["SYMBION_OLLAMA_BASE_URL"] = `http://127.0.0.1:${port}`;
    try {
      const res = await rpc("listModels", { providerId: "ollama" });
      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe("ok");
      expect(res.body.models.length).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
    }
  });
});

describe("static file serving — extensionless route resolution (pre-existing bug, fixed during templates-marketplace QA)", () => {
  // Reproduces a real Next.js static export (`output: "export"`) layout: one
  // .html file per route plus an index.html app-shell fallback. A direct
  // request for an extensionless route path (e.g. `/templates`, no trailing
  // `.html`) must resolve to that route's own .html file, not silently fall
  // through to index.html (which previously made `/templates` and `/settings`
  // serve the Builder/`/` bundle instead of their own).
  let webRoot: string;
  let staticHandle: DaemonServerHandle;

  beforeEach(async () => {
    webRoot = mkdtempSync(join(tmpdir(), "symbion-webroot-"));
    writeFileSync(join(webRoot, "index.html"), '<script src="/_next/static/chunks/app/page-BUILDER.js"></script>');
    writeFileSync(
      join(webRoot, "templates.html"),
      '<script src="/_next/static/chunks/app/templates/page-TEMPLATES.js"></script>'
    );
    writeFileSync(
      join(webRoot, "settings.html"),
      '<script src="/_next/static/chunks/app/settings/page-SETTINGS.js"></script>'
    );
    const port = 21000 + Math.floor(Math.random() * 4000);
    staticHandle = await startServer({ port, version: "0.1.0", webStaticRoot: webRoot });
  });

  afterEach(async () => {
    await staticHandle.close();
    rmSync(webRoot, { recursive: true, force: true });
  });

  it("GET /templates resolves templates.html, not index.html's Builder bundle", async () => {
    const res = await fetch(`http://127.0.0.1:${staticHandle.port}/templates`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("templates/page-TEMPLATES.js");
    expect(text).not.toContain("page-BUILDER.js");
  });

  it("GET /settings resolves settings.html, not index.html's Builder bundle", async () => {
    const res = await fetch(`http://127.0.0.1:${staticHandle.port}/settings`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("settings/page-SETTINGS.js");
    expect(text).not.toContain("page-BUILDER.js");
  });

  it("GET / still resolves index.html (Builder bundle) unaffected by the fix", async () => {
    const res = await fetch(`http://127.0.0.1:${staticHandle.port}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("page-BUILDER.js");
  });

  it("GET /templates.html (explicit extension) still resolves directly, unaffected", async () => {
    const res = await fetch(`http://127.0.0.1:${staticHandle.port}/templates.html`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("templates/page-TEMPLATES.js");
  });

  it("GET /does-not-exist-anywhere falls back to index.html (no matching .html, no matching directory)", async () => {
    const res = await fetch(`http://127.0.0.1:${staticHandle.port}/does-not-exist-anywhere`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("page-BUILDER.js");
  });
});
