import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handlers } from "../src/rpc/handlers.js";
import type { PersistedRunEvent, RunInfo } from "@symbion/core";
import { clearFakeCli, ctx, setupRunEnv, useFakeCli, type RunTestEnv } from "./runHelpers.js";

let env: RunTestEnv;

afterEach(() => {
  env.cleanup();
  clearFakeCli();
});

/** Write a terminal run with N synthetic events on disk. */
function seedRun(n: number): string {
  const runId = randomUUID();
  const dir = join(env.projectRoot, ".symbion", "runs", runId);
  mkdirSync(dir, { recursive: true });
  const run: Partial<RunInfo> = {
    schemaVersion: 1,
    runId,
    projectId: env.projectId,
    artifactId: "cmd-analyze-id",
    commandName: "analyze",
    requirement: "seed",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    status: "completed",
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

describe("§3.7 run-getRunEvents (P1)", () => {
  it("#1 1200-event run -> 500+500+200 batches, done on last, seq 1..1200 exactly", async () => {
    useFakeCli();
    env = await setupRunEnv();
    const runId = seedRun(1200);
    const collected: number[] = [];
    let afterSeq = 0;
    let done = false;
    let calls = 0;
    const batchSizes: number[] = [];
    while (!done && calls < 10) {
      const res = handlers.getRunEvents({ projectId: env.projectId, runId, afterSeq }, ctx);
      batchSizes.push(res.events.length);
      for (const e of res.events) collected.push(e.seq);
      if (res.events.length > 0) afterSeq = res.events[res.events.length - 1]!.seq;
      done = res.done;
      calls++;
    }
    expect(batchSizes).toEqual([500, 500, 200]);
    expect(done).toBe(true);
    expect(collected).toEqual(Array.from({ length: 1200 }, (_, i) => i + 1));
  });

  it("#2 afterSeq mid-stream returns only the tail", async () => {
    useFakeCli();
    env = await setupRunEnv();
    const runId = seedRun(10);
    const res = handlers.getRunEvents({ projectId: env.projectId, runId, afterSeq: 7 }, ctx);
    expect(res.events.map((e) => e.seq)).toEqual([8, 9, 10]);
    expect(res.done).toBe(true);
  });
});
