import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handlers } from "../src/rpc/handlers.js";
import { ackSettingsHash, configHash } from "../src/run/runConfig.js";
import { DEFAULT_RUN_CONFIG } from "@symbion/core";
import { awaitTerminal, clearFakeCli, ctx, setupRunEnv, startTestRun, useFakeCli, type RunTestEnv } from "./runHelpers.js";

let env: RunTestEnv;

beforeEach(async () => {
  useFakeCli();
  env = await setupRunEnv();
});

afterEach(() => {
  env.cleanup();
  clearFakeCli();
});

/**
 * Regression coverage for QA Defect 1 (graph-execution-realtime P1 fix pass,
 * STATE §10.4): preflight.ts compared the persisted `ackSettingsHash` against a
 * freshly computed `configHash` — two DIFFERENT digests over different field
 * sets — so `needsFirstRunAck` could never become false after a real ack.
 */
describe("§3.2 first-run-ack hashing — QA Defect 1 fix (P1)", () => {
  it("#0 sanity: configHash and ackSettingsHash differ for the same config (proves the bug was possible)", () => {
    expect(configHash(DEFAULT_RUN_CONFIG)).not.toBe(ackSettingsHash(DEFAULT_RUN_CONFIG));
  });

  it("#1 first preflight on a fresh project needs the ack", async () => {
    const pre = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    expect(pre.needsFirstRunAck).toBe(true);
  });

  it("#2 after a run with ackFirstRun:true, a LATER preflight no longer needs the ack", async () => {
    const { runId } = await startTestRun(env, "first run", { ackFirstRun: true });
    await awaitTerminal(env, runId);

    const pre = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    expect(pre.needsFirstRunAck).toBe(false);
  });

  it("#3 the persisted firstRunAck.settingsHash matches ackSettingsHash, not configHash", async () => {
    const { runId } = await startTestRun(env, "first run", { ackFirstRun: true });
    await awaitTerminal(env, runId);

    const { loadProjectStore } = await import("../src/store/store.js");
    const store = loadProjectStore(env.projectRoot);
    const config = store.settings.run ?? DEFAULT_RUN_CONFIG;
    expect(config.firstRunAck?.settingsHash).toBe(ackSettingsHash(config));
    expect(config.firstRunAck?.settingsHash).not.toBe(configHash(config));
  });

  it("#4 changing permissionMode after ack re-triggers needsFirstRunAck (ackSettingsHash covers it)", async () => {
    const { runId } = await startTestRun(env, "first run", { ackFirstRun: true });
    await awaitTerminal(env, runId);

    const { loadProjectStore, saveProjectStore } = await import("../src/store/store.js");
    const store = loadProjectStore(env.projectRoot);
    store.settings.run = { ...(store.settings.run ?? DEFAULT_RUN_CONFIG), permissionMode: "plan" };
    saveProjectStore(env.projectRoot, store);

    const pre = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    expect(pre.needsFirstRunAck).toBe(true);
  });

  it("#5 changing only ceilings after ack does NOT re-trigger needsFirstRunAck (design §0: ceilings excluded)", async () => {
    const { runId } = await startTestRun(env, "first run", { ackFirstRun: true });
    await awaitTerminal(env, runId);

    const { loadProjectStore, saveProjectStore } = await import("../src/store/store.js");
    const store = loadProjectStore(env.projectRoot);
    store.settings.run = {
      ...(store.settings.run ?? DEFAULT_RUN_CONFIG),
      ceilings: { wallClockMs: 60_000, tokenCap: 1000 },
    };
    saveProjectStore(env.projectRoot, store);

    const pre = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    expect(pre.needsFirstRunAck).toBe(false);
  });
});

describe("§3.2 lastRun.requirement — QA Defect 2 fix (P1)", () => {
  it("#1 preflight after a terminal run surfaces the exact requirement text", async () => {
    const { runId } = await startTestRun(env, "the exact requirement text", { ackFirstRun: true });
    await awaitTerminal(env, runId);

    const pre = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    expect(pre.lastRun?.requirement).toBe("the exact requirement text");
  });

  it("#2 preflight on a fresh project (no prior runs) has no lastRun", async () => {
    const pre = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    expect(pre.lastRun).toBeUndefined();
  });
});
