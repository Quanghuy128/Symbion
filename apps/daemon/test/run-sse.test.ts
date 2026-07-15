import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, type DaemonServerHandle } from "../src/server.js";
import { handlers } from "../src/rpc/handlers.js";
import type { CanonicalArtifact, PersistedRunEvent, RunInfo } from "@symbion/core";
import { loadProjectStore, saveProjectStore } from "../src/store/store.js";
import { clearFakeCli, ctx, useFakeCli } from "./runHelpers.js";

let handle: DaemonServerHandle;
let configDir: string;
let projectRoot: string;
let projectId: string;
let port: number;

beforeEach(async () => {
  useFakeCli();
  configDir = mkdtempSync(join(tmpdir(), "symbion-sse-config-"));
  process.env["SYMBION_CONFIG_DIR"] = configDir;
  projectRoot = mkdtempSync(join(tmpdir(), "symbion-sse-project-"));
  try {
    execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
  } catch {
    /* git optional */
  }
  const created = await handlers.createProject({ name: "sse-proj", path: projectRoot }, ctx);
  projectId = created.project.id;
  const store = loadProjectStore(projectRoot);
  const now = new Date().toISOString();
  const cmd: CanonicalArtifact = {
    id: "cmd-analyze-id",
    kind: "command",
    name: "analyze",
    description: "A",
    body: "x",
    meta: { version: "0.1.0", status: "published", createdAt: now, updatedAt: now, publishedHashes: { claude: "x" } },
  };
  store.artifacts.push(cmd);
  saveProjectStore(projectRoot, store);

  port = 22000 + Math.floor(Math.random() * 3000);
  handle = await startServer({ port, version: "0.1.0" });
});

afterEach(async () => {
  await handle.close();
  rmSync(configDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  delete process.env["SYMBION_CONFIG_DIR"];
  clearFakeCli();
});

/** Seed a terminal run with N synthetic events on disk. */
function seedRun(n: number, status: RunInfo["status"] = "completed"): string {
  const runId = randomUUID();
  const dir = join(projectRoot, ".symbion", "runs", runId);
  mkdirSync(dir, { recursive: true });
  const run: Partial<RunInfo> = {
    schemaVersion: 1,
    runId,
    projectId,
    artifactId: "cmd-analyze-id",
    commandName: "analyze",
    requirement: "seed",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    status,
    exitCode: 0,
    lastSeq: n,
  };
  writeFileSync(join(dir, "run.json"), JSON.stringify(run));
  const lines: string[] = [];
  for (let i = 1; i <= n; i++) {
    const ev: PersistedRunEvent = { seq: i, ts: Date.now(), ev: { kind: "unknown", type: "x", rawTruncated: "" } };
    lines.push(JSON.stringify(ev));
  }
  writeFileSync(join(dir, "events.jsonl"), lines.join("\n") + "\n");
  return runId;
}

/** Read an SSE response body fully (terminal runs close the stream). */
async function readSseAll(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { headers });
  if (!res.ok || !res.body) return { status: res.status, body: await res.text().catch(() => "") };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    body += decoder.decode(value, { stream: true });
  }
  return { status: res.status, body };
}

/** Parse `data:` frames from an SSE body into flat PersistedRunEvent[]. */
function parseSseEvents(body: string): PersistedRunEvent[] {
  const events: PersistedRunEvent[] = [];
  for (const block of body.split("\n\n")) {
    const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
    if (!dataLine) continue;
    try {
      const payload = JSON.parse(dataLine.slice("data: ".length));
      if (Array.isArray(payload.events)) events.push(...payload.events);
    } catch {
      /* state frames etc. */
    }
  }
  return events;
}

describe("§3.6 run-sse (P1)", () => {
  it("#1 valid Host, no Origin -> 200 text/event-stream; seq 1..N once, in order (terminal backfill)", async () => {
    const runId = seedRun(5);
    const url = `http://127.0.0.1:${port}/run-events?projectId=${projectId}&runId=${runId}&afterSeq=0`;
    const res = await fetch(url, { headers: { Host: `127.0.0.1:${port}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    const seqs = parseSseEvents(body).map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
  });

  it("#2 spoofed Host -> 403 (raw socket); Origin evil.com -> 403 (fetch)", async () => {
    const runId = seedRun(1);
    // fetch()/undici forbid overriding Host — use a raw socket for the Host case
    // (same technique as server.integration.test.ts T15).
    const net = await import("node:net");
    const request =
      `GET /run-events?projectId=${projectId}&runId=${runId}&afterSeq=0 HTTP/1.1\r\n` +
      `Host: evil.example.com\r\n` +
      `Connection: close\r\n\r\n`;
    const responseText: string = await new Promise((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port }, () => socket.write(request));
      let data = "";
      socket.on("data", (chunk) => (data += chunk.toString()));
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
    });
    expect(responseText).toMatch(/^HTTP\/1\.1 403/);

    // Origin override IS allowed by fetch.
    const base = `http://127.0.0.1:${port}/run-events?projectId=${projectId}&runId=${runId}&afterSeq=0`;
    const badOrigin = await fetch(base, { headers: { Origin: "http://evil.com" } });
    expect(badOrigin.status).toBe(403);
  });

  it("#3 unknown runId -> 404", async () => {
    const url = `http://127.0.0.1:${port}/run-events?projectId=${projectId}&runId=${randomUUID()}&afterSeq=0`;
    const res = await fetch(url, { headers: { Host: `127.0.0.1:${port}` } });
    expect(res.status).toBe(404);
  });

  it("#4 attach with afterSeq=2 on a terminal run -> receives 3..N only (no dup/gap)", async () => {
    const runId = seedRun(6);
    const url = `http://127.0.0.1:${port}/run-events?projectId=${projectId}&runId=${runId}&afterSeq=2`;
    const { body } = await readSseAll(url, { Host: `127.0.0.1:${port}` });
    const seqs = parseSseEvents(body).map((e) => e.seq);
    expect(seqs).toEqual([3, 4, 5, 6]);
  });

  it("#5 200-event burst -> Σ events == 200 (transport coalesced, data intact)", async () => {
    const runId = seedRun(200);
    const url = `http://127.0.0.1:${port}/run-events?projectId=${projectId}&runId=${runId}&afterSeq=0`;
    const { body } = await readSseAll(url, { Host: `127.0.0.1:${port}` });
    const seqs = parseSseEvents(body).map((e) => e.seq);
    expect(seqs).toHaveLength(200);
    expect(seqs).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
  });

  it("#6 GET /run-events does NOT fall through to static-file handler", async () => {
    // No webStaticRoot configured; the route is handled by the SSE branch. A
    // missing runId still returns a 404 JSON error, never a static 200/HTML.
    const url = `http://127.0.0.1:${port}/run-events?projectId=${projectId}&runId=${randomUUID()}`;
    const res = await fetch(url, { headers: { Host: `127.0.0.1:${port}` } });
    expect(res.status).toBe(404);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).not.toContain("text/html");
  });
});
