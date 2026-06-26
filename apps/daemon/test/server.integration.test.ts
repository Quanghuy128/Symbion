import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type DaemonServerHandle } from "../src/server.js";

let handle: DaemonServerHandle;
let configDir: string;

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
});

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
