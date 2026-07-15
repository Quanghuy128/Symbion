import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handlers } from "../src/rpc/handlers.js";
import { loadProjectStore, saveProjectStore } from "../src/store/store.js";
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

describe("§3.9 run-ceilings — AC-RUN-8 wall-clock (P1)", () => {
  it("#1 MODE=hang with wallClockMs:500 -> timedOut, stopReason wallClock, process dead", async () => {
    useFakeCli("hang");
    env = await setupRunEnv();
    // set a tiny wall-clock ceiling.
    const store = loadProjectStore(env.projectRoot);
    store.settings.run = {
      permissionMode: "acceptEdits",
      allowedTools: [],
      ceilings: { wallClockMs: 500, tokenCap: 200_000 },
    };
    saveProjectStore(env.projectRoot, store);

    const { runId } = await startTestRun(env, "hang forever");
    const status = await awaitTerminal(env, runId, 9_000);
    expect(status).toBe("timedOut");
    const run = JSON.parse(readFileSync(join(env.projectRoot, ".symbion", "runs", runId, "run.json"), "utf-8"));
    expect(run.stopReason).toBe("wallClock");
  }, 12_000);
});
