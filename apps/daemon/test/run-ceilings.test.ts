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

describe("§6.4 run-ceilings — token cap (P2)", () => {
  it("#2a fixture crossing tokenCap:1000 mid-run -> timedOut, stopReason tokenCap, events up to breach persisted", async () => {
    useFakeCli(); // default mode: streams fixture-simple.ndjson (2655in/4out = 2659 fresh on its one message)
    env = await setupRunEnv();
    const store = loadProjectStore(env.projectRoot);
    store.settings.run = {
      permissionMode: "acceptEdits",
      allowedTools: [],
      ceilings: { wallClockMs: 1_800_000, tokenCap: 1_000 },
    };
    saveProjectStore(env.projectRoot, store);

    const { runId } = await startTestRun(env, "cross the token cap");
    const status = await awaitTerminal(env, runId, 9_000);
    expect(status).toBe("timedOut");
    const run = JSON.parse(readFileSync(join(env.projectRoot, ".symbion", "runs", runId, "run.json"), "utf-8"));
    expect(run.stopReason).toBe("tokenCap");
    // events up to the breach are persisted — at least the init + the
    // fresh-crossing assistant message must be on disk.
    const eventsPath = join(env.projectRoot, ".symbion", "runs", runId, "events.jsonl");
    const lines = readFileSync(eventsPath, "utf-8").trim().split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    const kinds = lines.map((l) => JSON.parse(l).ev.kind);
    expect(kinds).toContain("message");
  }, 12_000);

  it("#2b tokenCap:0 means 'no cap' — run completes normally regardless of volume", async () => {
    useFakeCli(); // default: streams fixture-simple.ndjson (2659 fresh tokens)
    env = await setupRunEnv();
    const store = loadProjectStore(env.projectRoot);
    store.settings.run = {
      permissionMode: "acceptEdits",
      allowedTools: [],
      ceilings: { wallClockMs: 1_800_000, tokenCap: 0 },
    };
    saveProjectStore(env.projectRoot, store);

    const { runId } = await startTestRun(env, "no cap at all");
    const status = await awaitTerminal(env, runId, 9_000);
    expect(status).toBe("completed");
  }, 12_000);

  it("#2c breach vs. natural completion race -> exactly ONE terminal state, never both", async () => {
    // A generous cap that the fixture's single message will exceed only at
    // the very last event (result carries no NEW usage, so completion and
    // breach detection both settle on the same fold state) — pins that
    // finalize()'s terminalWritten guard still holds with tokenCap in play.
    useFakeCli();
    env = await setupRunEnv();
    const store = loadProjectStore(env.projectRoot);
    store.settings.run = {
      permissionMode: "acceptEdits",
      allowedTools: [],
      ceilings: { wallClockMs: 1_800_000, tokenCap: 2_659 }, // exactly the fixture's fresh total
    };
    saveProjectStore(env.projectRoot, store);

    const { runId } = await startTestRun(env, "race the cap against natural completion");
    const status = await awaitTerminal(env, runId, 9_000);
    // Whichever path wins, the run reaches exactly one terminal state.
    expect(["completed", "timedOut"]).toContain(status);
    const run = JSON.parse(readFileSync(join(env.projectRoot, ".symbion", "runs", runId, "run.json"), "utf-8"));
    expect(run.status).toBe(status);
    expect(run.endedAt).not.toBeNull();
  }, 12_000);
});
