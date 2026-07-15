import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handlers } from "../src/rpc/handlers.js";
import { runManager } from "../src/run/runManager.js";
import type { RunInfo } from "@symbion/core";
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

afterEach(() => {
  env.cleanup();
  clearFakeCli();
});

function writeOrphanRun(status: string): string {
  const runId = randomUUID();
  const dir = join(env.projectRoot, ".symbion", "runs", runId);
  mkdirSync(dir, { recursive: true });
  const run: Partial<RunInfo> = {
    schemaVersion: 1,
    runId,
    projectId: env.projectId,
    artifactId: "cmd-analyze-id",
    commandName: "analyze",
    requirement: "orphan",
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: status as RunInfo["status"],
    exitCode: null,
    lastSeq: 0,
  };
  writeFileSync(join(dir, "run.json"), JSON.stringify(run));
  return runId;
}

describe("§3.8 run-lifecycle + reconciliation — AC-RUN-9 (P1)", () => {
  it("#1 MODE=exit1 -> failed, exitCode 1, stderr persisted, partial events retained", async () => {
    useFakeCli("exit1");
    env = await setupRunEnv();
    const { runId } = await startTestRun(env, "will fail");
    const status = await awaitTerminal(env, runId);
    expect(status).toBe("failed");
    const run = JSON.parse(readFileSync(join(env.projectRoot, ".symbion", "runs", runId, "run.json"), "utf-8"));
    expect(run.exitCode).toBe(1);
    expect(run.errorMessage).toContain("simulated failure");
    const eventsPath = join(env.projectRoot, ".symbion", "runs", runId, "events.jsonl");
    if (existsSync(eventsPath)) {
      const lines = readFileSync(eventsPath, "utf-8").trimEnd().split("\n").filter((l) => l.length > 0);
      expect(lines.length).toBeGreaterThanOrEqual(1); // partial telemetry
    }
  });

  it("#2 orphaned running -> failed(daemon-restarted) on listRuns, file rewritten", async () => {
    useFakeCli();
    env = await setupRunEnv();
    const runId = writeOrphanRun("running");
    const { runs } = handlers.listRuns({ projectId: env.projectId }, ctx);
    const row = runs.find((r) => r.runId === runId);
    expect(row?.status).toBe("failed");
    const run = JSON.parse(readFileSync(join(env.projectRoot, ".symbion", "runs", runId, "run.json"), "utf-8"));
    expect(run.status).toBe("failed");
    expect(run.errorMessage).toBe("daemon-restarted");
    expect(run.endedAt).not.toBeNull();
  });

  it("#3 orphaned starting and cancelling also reconciled", async () => {
    useFakeCli();
    env = await setupRunEnv();
    const startingId = writeOrphanRun("starting");
    const cancellingId = writeOrphanRun("cancelling");
    const { runs } = handlers.listRuns({ projectId: env.projectId }, ctx);
    expect(runs.find((r) => r.runId === startingId)?.status).toBe("failed");
    expect(runs.find((r) => r.runId === cancellingId)?.status).toBe("failed");
  });

  it("#4 reconcile never touches a run that IS live", async () => {
    useFakeCli("hang");
    env = await setupRunEnv();
    const { runId } = await startTestRun(env, "hang");
    await new Promise((r) => setTimeout(r, 150));
    const { runs } = handlers.listRuns({ projectId: env.projectId }, ctx);
    const row = runs.find((r) => r.runId === runId);
    expect(row?.status).toBe("running");
    handlers.cancelRun({ projectId: env.projectId, runId }, ctx);
    await awaitTerminal(env, runId, 8_000);
    expect(runManager.hasActive(env.projectId)).toBe(false);
  }, 12_000);
});
