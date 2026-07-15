import { existsSync, readFileSync, statSync } from "node:fs";
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

afterEach(() => {
  env.cleanup();
  clearFakeCli();
});

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("§3.4 run-cancel — AC-RUN-4 (P1)", () => {
  it("#1 MODE=hang then cancel -> cancelled ≤6s, process dead", async () => {
    useFakeCli("hang");
    env = await setupRunEnv();
    const { runId } = await startTestRun(env, "hang please");
    // let it spawn
    await new Promise((r) => setTimeout(r, 150));
    const res = handlers.cancelRun({ projectId: env.projectId, runId }, ctx);
    expect(["cancelling", "cancelled"]).toContain(res.status);
    const pid = res.pid;
    const status = await awaitTerminal(env, runId, 8_000);
    expect(status).toBe("cancelled");
    if (pid) {
      await new Promise((r) => setTimeout(r, 200));
      expect(pidAlive(pid)).toBe(false);
    }
  });

  it("#2 MODE=ignore-sigterm -> SIGKILL escalation, dead ≤~7s, cancelled", async () => {
    useFakeCli("ignore-sigterm");
    env = await setupRunEnv();
    const { runId } = await startTestRun(env, "stubborn");
    await new Promise((r) => setTimeout(r, 150));
    const res = handlers.cancelRun({ projectId: env.projectId, runId }, ctx);
    const pid = res.pid;
    const status = await awaitTerminal(env, runId, 9_000);
    expect(status).toBe("cancelled");
    if (pid) {
      await new Promise((r) => setTimeout(r, 300));
      expect(pidAlive(pid)).toBe(false);
    }
  }, 12_000);

  it("#3 MODE=spawn-child -> grandchild killed too (process-group kill)", async () => {
    const { tmpdir } = await import("node:os");
    const { mkdtempSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "symbion-childpid-"));
    const pidFile = join(dir, "childpid");
    useFakeCli("spawn-child", { FAKE_CLAUDE_CHILD_PID_OUT: pidFile });
    env = await setupRunEnv();
    const { runId } = await startTestRun(env, "spawn a child");
    // wait for the grandchild pid to be written
    for (let i = 0; i < 40 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(pidFile)).toBe(true);
    const grandchildPid = Number(readFileSync(pidFile, "utf-8").trim());
    handlers.cancelRun({ projectId: env.projectId, runId }, ctx);
    await awaitTerminal(env, runId, 9_000);
    await new Promise((r) => setTimeout(r, 400));
    expect(pidAlive(grandchildPid)).toBe(false);
  }, 12_000);

  it("#4 cancelRun on an already-terminal run -> idempotent no-op", async () => {
    useFakeCli();
    env = await setupRunEnv();
    const { runId } = await startTestRun(env, "quick");
    await awaitTerminal(env, runId);
    expect(() => handlers.cancelRun({ projectId: env.projectId, runId }, ctx)).not.toThrow();
  });

  it("#5 no write after terminal run.json (mtime stable)", async () => {
    useFakeCli();
    env = await setupRunEnv();
    const { runId } = await startTestRun(env, "quick");
    await awaitTerminal(env, runId);
    const runJson = join(env.projectRoot, ".symbion", "runs", runId, "run.json");
    const mtime1 = statSync(runJson).mtimeMs;
    await new Promise((r) => setTimeout(r, 300));
    handlers.cancelRun({ projectId: env.projectId, runId }, ctx); // idempotent, no write
    const mtime2 = statSync(runJson).mtimeMs;
    expect(mtime2).toBe(mtime1);
  });
});
