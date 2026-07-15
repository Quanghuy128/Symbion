import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handlers } from "../src/rpc/handlers.js";
import {
  awaitTerminal,
  clearFakeCli,
  ctx,
  setupRunEnv,
  startTestRun,
  useFakeCli,
  type RunTestEnv,
} from "./runHelpers.js";

let env: RunTestEnv;

beforeEach(async () => {
  useFakeCli();
  env = await setupRunEnv();
});

afterEach(() => {
  env.cleanup();
  clearFakeCli();
});

describe("§3.1 run-happyPath (P1)", () => {
  it("#1 startRun creates run.json with schemaVersion, status, cwd, cliVersion, gitBefore", async () => {
    const { runId } = await startTestRun(env, "add rate limiting");
    const runJsonPath = join(env.projectRoot, ".symbion", "runs", runId, "run.json");
    expect(existsSync(runJsonPath)).toBe(true);
    const run = JSON.parse(readFileSync(runJsonPath, "utf-8"));
    expect(run.schemaVersion).toBe(1);
    expect(["starting", "running", "completed"]).toContain(run.status);
    expect(run.cwd).toBe(env.projectRoot);
    expect(run.cliVersion).toBe("2.1.187");
    expect(run.gitBefore).toBeDefined();
    await awaitTerminal(env, runId);
  });

  it("#2 at terminal: completed, exit 0, endedAt set, lastSeq === 4", async () => {
    const { runId } = await startTestRun(env, "add rate limiting");
    const status = await awaitTerminal(env, runId);
    expect(status).toBe("completed");
    const run = JSON.parse(readFileSync(join(env.projectRoot, ".symbion", "runs", runId, "run.json"), "utf-8"));
    expect(run.exitCode).toBe(0);
    expect(run.endedAt).not.toBeNull();
    expect(run.lastSeq).toBe(4);
  });

  it("#3 events.jsonl has 4 lines, seq strictly monotonic 1..4", async () => {
    const { runId } = await startTestRun(env, "add rate limiting");
    await awaitTerminal(env, runId);
    const lines = readFileSync(join(env.projectRoot, ".symbion", "runs", runId, "events.jsonl"), "utf-8")
      .trimEnd()
      .split("\n");
    expect(lines).toHaveLength(4);
    const seqs = lines.map((l) => JSON.parse(l).seq);
    expect(seqs).toEqual([1, 2, 3, 4]);
    for (const l of lines) {
      const ev = JSON.parse(l);
      expect(typeof ev.ts).toBe("number");
      expect(ev.ev.kind).toBeDefined();
    }
  });

  it("#4 .symbion/runs/.gitignore exists with content '*'", async () => {
    const { runId } = await startTestRun(env, "add rate limiting");
    await awaitTerminal(env, runId);
    const gitignore = join(env.projectRoot, ".symbion", "runs", ".gitignore");
    expect(existsSync(gitignore)).toBe(true);
    expect(readFileSync(gitignore, "utf-8").trim()).toBe("*");
  });

  it("#5 re-running after completion succeeds (slot released)", async () => {
    const first = await startTestRun(env, "first");
    await awaitTerminal(env, first.runId);
    const second = await startTestRun(env, "second");
    const status = await awaitTerminal(env, second.runId);
    expect(status).toBe("completed");
    const active = handlers.listRuns({ projectId: env.projectId }, ctx);
    expect(active.activeRunId).toBeUndefined();
  });
});
