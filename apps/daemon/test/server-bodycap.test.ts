import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_RPC_BODY_BYTES, PayloadTooLargeError, readBody, startServer, type DaemonServerHandle } from "../src/server.js";
import { b64, pngOfSize } from "./attachmentFixtures.js";
import { clearFakeCli, setupRunEnv, useFakeCli, type RunTestEnv } from "./runHelpers.js";

let handle: DaemonServerHandle;
let env: RunTestEnv;

beforeEach(async () => {
  useFakeCli();
  env = await setupRunEnv();
  handle = await startServer({ port: 25000 + Math.floor(Math.random() * 3000), version: "0.1.0" });
});
afterEach(async () => {
  await handle.close();
  env.cleanup();
  clearFakeCli();
});

const fakeReq = (chunks: Buffer[], headers: Record<string, string> = {}): IncomingMessage =>
  Object.assign(Readable.from(chunks), { headers }) as unknown as IncomingMessage;

async function ping(): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${handle.port}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "ping", params: {} }),
  });
  return res.status;
}

async function rpc(method: string, params: unknown) {
  const res = await fetch(`http://127.0.0.1:${handle.port}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  return { status: res.status, body: await res.json() };
}

/** POST /rpc via http.request so Content-Length / chunked framing is under our control. */
function rawPost(opts: { contentLength?: number; chunks: () => Iterable<Buffer> }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = { "Content-Type": "application/json" };
    if (opts.contentLength !== undefined) headers["Content-Length"] = opts.contentLength;
    const req = httpRequest({ host: "127.0.0.1", port: handle.port, path: "/rpc", method: "POST", headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", (e) => {
      // the server may drop the connection after replying 413; a reset is acceptable once we have a status.
      if ((e as NodeJS.ErrnoException).code === "ECONNRESET" || (e as NodeJS.ErrnoException).code === "EPIPE") return;
      reject(e);
    });
    (async () => {
      for (const c of opts.chunks()) {
        if (req.destroyed) return;
        if (!req.write(c)) await new Promise((r) => req.once("drain", r));
      }
      req.end();
    })().catch(() => undefined);
  });
}

describe("readBody (DI17 unit)", () => {
  it("decodes a multi-byte char split across chunks exactly once", async () => {
    const whole = Buffer.from("ả", "utf-8");
    expect(whole.length).toBeGreaterThan(1);
    const out = await readBody(fakeReq([whole.subarray(0, 1), whole.subarray(1)]));
    expect(out).toBe("ả");
  });
  it("rejects by streamed size and by declared Content-Length", async () => {
    await expect(readBody(fakeReq([Buffer.alloc(10), Buffer.alloc(10)]), 15)).rejects.toBeInstanceOf(PayloadTooLargeError);
    await expect(readBody(fakeReq([], { "content-length": "100" }), 15)).rejects.toBeInstanceOf(PayloadTooLargeError);
    await expect(readBody(fakeReq([Buffer.alloc(15)]), 15)).resolves.toHaveLength(15);
  });
});

describe("RPC body cap (DI15-DI18, AC-3 transport)", () => {
  it("DI15 declared Content-Length over the cap -> 413 without reading the body; next request fine", async () => {
    const r = await rawPost({ contentLength: MAX_RPC_BODY_BYTES + 1, chunks: () => [] });
    expect(r.status).toBe(413);
    expect(JSON.parse(r.body).error.code).toBe("payload-too-large");
    expect(await ping()).toBe(200);
  });

  it("DI16 chunked body streaming past the cap -> 413; daemon keeps serving", async () => {
    const piece = Buffer.alloc(1024 * 1024, "a");
    const r = await rawPost({
      chunks: function* () {
        for (let i = 0; i < 31; i++) yield piece;
        yield Buffer.alloc(1, "a");
      },
    });
    expect(r.status).toBe(413);
    expect(JSON.parse(r.body).error.code).toBe("payload-too-large");
    expect(await ping()).toBe(200);
  });

  it("DI18 a body of exactly the cap is NOT 413 (invalid JSON -> 400 bad-json)", async () => {
    const piece = Buffer.alloc(1024 * 1024, "a");
    const r = await rawPost({
      contentLength: MAX_RPC_BODY_BYTES,
      chunks: function* () {
        for (let i = 0; i < 30; i++) yield piece;
      },
    });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error.code).toBe("bad-json");
  });

  it("DI17 a legitimate ~28 MB body (4 x 5 MiB images + 10k non-ASCII chars + non-ASCII name) is accepted intact", async () => {
    const images = Array.from({ length: 4 }, () => pngOfSize(5 * 1024 * 1024));
    const requirement = "ảnh chụp màn hình 😀 ".repeat(1000).slice(0, 10_000);
    const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
    const pre = await rpc("runPreflight", {
      projectId: env.projectId,
      artifactId: "cmd-analyze-id",
      attachments: images.map((b) => ({ sha256: sha(b), size: b.length, mediaType: "image/png" })),
    });
    expect(pre.status).toBe(200);
    const started = await rpc("startRun", {
      projectId: env.projectId,
      artifactId: "cmd-analyze-id",
      requirement,
      nonce: pre.body.consentNonce,
      ackFirstRun: true,
      attachments: images.map((b) => ({ name: "ảnh chụp màn hình.png", mediaType: "image/png", data: b64(b) })),
    });
    expect(started.status).toBe(200);
    const runJson = JSON.parse(
      readFileSync(join(env.projectRoot, ".symbion", "runs", started.body.runId, "run.json"), "utf-8")
    );
    expect(runJson.requirement).toBe(requirement);
    expect(runJson.attachments[0].name).toBe("ảnh chụp màn hình.png");
    // wait for the fake CLI to finish so the project dir can be cleaned up safely.
    for (let i = 0; i < 100; i++) {
      const r = await rpc("listRuns", { projectId: env.projectId });
      if (r.body.runs[0].endedAt) break;
      await new Promise((res) => setTimeout(res, 100));
    }
  }, 60_000);
});
