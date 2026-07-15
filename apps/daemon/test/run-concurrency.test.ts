import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handlers } from "../src/rpc/handlers.js";
import { runManager } from "../src/run/runManager.js";
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

describe("§3.5 run-concurrency — ER-9 (P1)", () => {
  it("#1 second startRun (fresh nonce) while a hang run is active -> run-active", async () => {
    useFakeCli("hang");
    env = await setupRunEnv();
    const first = await startTestRun(env, "hang");
    await new Promise((r) => setTimeout(r, 150));

    const pre = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    // preflight itself blocks (active-run) -> no nonce; but even a forced call rejects.
    expect(pre.blocked).toBe(true);
    expect(pre.consentNonce).toBeUndefined();

    await expect(
      handlers.startRun(
        { projectId: env.projectId, artifactId: "cmd-analyze-id", requirement: "second", nonce: "whatever" },
        ctx
      )
    ).rejects.toMatchObject({ code: expect.stringMatching(/run-consent-required|run-active/) });

    // first run unaffected — cancel to clean up.
    handlers.cancelRun({ projectId: env.projectId, runId: first.runId }, ctx);
    await awaitTerminal(env, first.runId, 8_000);
  }, 12_000);

  it("#1b TRUE race: two startRun calls fired with NO await between them (same project, two distinct valid nonces) -> exactly one wins, loser rejected with run-active, no orphaned process/run-dir", async () => {
    useFakeCli();
    env = await setupRunEnv();

    // Independently obtain two valid, distinct nonces (mirrors two tabs /
    // double-click, each having called runPreflight for itself).
    const preA = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    const preB = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    expect(preA.consentNonce).toBeTruthy();
    expect(preB.consentNonce).toBeTruthy();
    expect(preA.consentNonce).not.toBe(preB.consentNonce);

    // Fire BOTH startRun calls without any await/delay between them — both
    // race through the async cliVersion probe concurrently. If the Map slot
    // were reserved only after that await (the bug), both would pass the
    // pre-await hasActive-style check and the second start() would silently
    // clobber the first's Map entry.
    const callA = handlers.startRun(
      { projectId: env.projectId, artifactId: "cmd-analyze-id", requirement: "race-a", nonce: preA.consentNonce! },
      ctx
    );
    const callB = handlers.startRun(
      { projectId: env.projectId, artifactId: "cmd-analyze-id", requirement: "race-b", nonce: preB.consentNonce! },
      ctx
    );

    const [resA, resB] = await Promise.allSettled([callA, callB]);
    const results = [resA, resB];
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "run-active" });

    // No orphan: the Map holds exactly the winner's run, not a clobbered/lost
    // reference, and the daemon's own bookkeeping agrees with it.
    expect(runManager.hasActive(env.projectId)).toBe(true);
    const winnerRunId = (fulfilled[0] as PromiseFulfilledResult<Awaited<typeof callA>>).value.runId;
    expect(runManager.activeRunIdForProject(env.projectId)).toBe(winnerRunId);

    // The loser's nonce was consumed but never resulted in a spawned process
    // or a run directory — listRuns must show exactly ONE run for this project.
    await awaitTerminal(env, winnerRunId, 8_000);
    const { runs } = handlers.listRuns({ projectId: env.projectId }, ctx);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.runId).toBe(winnerRunId);

    // The reservation is fully released after the winner terminates — a
    // legitimate retry is not permanently blocked.
    expect(runManager.hasActive(env.projectId)).toBe(false);
  });

  it("#2 simultaneous runs in TWO different projects both succeed (per-project limit)", async () => {
    useFakeCli();
    env = await setupRunEnv();
    // Register the 2nd project in the SAME config registry (shared daemon).
    const env2 = await setupRunEnv({ configDir: env.configDir });
    try {
      const r1 = await startTestRun(env, "one");
      const r2 = await startTestRun(env2, "two");
      expect(await awaitTerminal(env, r1.runId)).toBe("completed");
      expect(await awaitTerminal(env2, r2.runId)).toBe("completed");
    } finally {
      // Only remove env2's project dir — the shared config is cleaned by env.cleanup().
      const { rmSync } = await import("node:fs");
      rmSync(env2.projectRoot, { recursive: true, force: true });
    }
  });
});
