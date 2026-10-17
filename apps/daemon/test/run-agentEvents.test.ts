import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { awaitTerminal, clearFakeCli, setupRunEnv, startTestRun, useFakeCli, type RunTestEnv } from "./runHelpers.js";

/**
 * workflow-agent-run testplan §2 D-2 — NO daemon source change: the daemon's
 * existing ingest path (core.parseLine) now persists the D-1 kinds. Test-only.
 */
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SUBAGENT = join(here, "..", "..", "..", "packages", "core", "test", "fixtures", "run", "fixture-subagent.ndjson");

let env: RunTestEnv;

beforeEach(async () => {
  useFakeCli(undefined, { FAKE_CLAUDE_FIXTURE: FIXTURE_SUBAGENT });
  env = await setupRunEnv();
});

afterEach(() => {
  env.cleanup();
  clearFakeCli();
});

describe("D-2 run-happyPath with fixture-subagent (workflow-agent-run)", () => {
  it("events.jsonl carries tool-results + task kinds, no unknown{type:user}; rollup totals unchanged", async () => {
    const { runId } = await startTestRun(env, "ping");
    expect(await awaitTerminal(env, runId)).toBe("completed");
    const runDir = join(env.projectRoot, ".symbion", "runs", runId);
    const events = readFileSync(join(runDir, "events.jsonl"), "utf-8")
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l) as { seq: number; ev: { kind: string; type?: string } });
    const kinds = events.map((e) => e.ev.kind);
    expect(kinds).toContain("tool-results");
    expect(kinds).toContain("task");
    expect(events.some((e) => e.ev.kind === "unknown" && e.ev.type === "user")).toBe(false);
    // thinking text is now persisted (D-1, acked) — and the signature is not
    const raw = readFileSync(join(runDir, "events.jsonl"), "utf-8");
    expect(raw).toContain('"kind":"thinking"');
    expect(raw).not.toContain("signature");
    // token roll-up identical to the pre-D-1 value (16 main + 4 subagent)
    const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf-8"));
    expect(run.totals.fresh).toBe(20);
  });
});
