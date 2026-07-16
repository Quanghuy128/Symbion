import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLine } from "../../src/run/parseStreamJson.js";
import { fold, initRunState, type RunState } from "../../src/run/aggregate.js";
import { runSummary, timelineRows } from "../../src/run/derive.js";
import type { PersistedRunEvent, RunInfo } from "../../src/run/events.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "..", "fixtures", "run");

function readLines(name: string): string[] {
  return readFileSync(join(fixtureDir, name), "utf-8").trimEnd().split("\n");
}

function foldFixture(name: string): { state: RunState; events: PersistedRunEvent[] } {
  const lines = readLines(name);
  let state = initRunState();
  const events: PersistedRunEvent[] = [];
  let seq = 1;
  for (const line of lines) {
    const ev = parseLine(line);
    const persisted: PersistedRunEvent = { seq: seq++, ts: Date.now() + seq * 10, ev };
    events.push(persisted);
    state = fold(state, persisted);
  }
  return { state, events };
}

function baseRunInfo(overrides?: Partial<RunInfo>): RunInfo {
  return {
    schemaVersion: 1,
    runId: "run-1",
    projectId: "proj-1",
    artifactId: "art-1",
    commandName: "analyze",
    requirement: "test",
    modelOverride: null,
    argv: [],
    bin: "claude",
    cwd: "/tmp/x",
    permissionMode: "acceptEdits",
    allowedTools: [],
    ceilings: { wallClockMs: 1_800_000, tokenCap: 200_000 },
    cliVersion: "2.1.187",
    sessionId: null,
    startedAt: new Date(0).toISOString(),
    endedAt: new Date(10_000).toISOString(),
    status: "completed",
    exitCode: 0,
    stopReason: null,
    errorMessage: null,
    gitBefore: { isRepo: true, clean: true, changedFiles: [] },
    filesChanged: null,
    lastSeq: 0,
    totals: null,
    ...overrides,
  };
}

describe("derive.timelineRows (§1.5)", () => {
  it("#1 dispatch row precedes actor-suffixed subagent rows; rows carry seq + tokenDelta", () => {
    const { state, events } = foldFixture("fixture-subagent.ndjson");
    const rows = timelineRows(events, state);
    const dispatchIdx = rows.findIndex((r) => r.label.startsWith("Task →"));
    expect(dispatchIdx).toBeGreaterThanOrEqual(0);
    const subagentRowIdx = rows.findIndex((r, i) => i > dispatchIdx && r.depth === 1);
    expect(subagentRowIdx).toBeGreaterThan(dispatchIdx);
    expect(rows.every((r) => typeof r.seq === "number")).toBe(true);
  });

  it("#5 dispatch row appears BEFORE any row whose actor matches the dispatch's parentToolUseId bucket; subagent rows carry depth 1", () => {
    const { state, events } = foldFixture("fixture-subagent.ndjson");
    const rows = timelineRows(events, state);
    const depth1Rows = rows.filter((r) => r.depth === 1);
    expect(depth1Rows.length).toBeGreaterThan(0);
    const dispatchSeq = rows.find((r) => r.label.startsWith("Task →"))!.seq;
    for (const row of depth1Rows) {
      expect(row.seq).toBeGreaterThanOrEqual(dispatchSeq);
    }
  });
});

describe("derive.runSummary (§1.5 / §6.3)", () => {
  it("#2 runSummary statuses: stopReason timed-out / exitCode 1 failed / unrecognized bucket flagged", () => {
    const { state, events } = foldFixture("fixture-rollup-synthetic.ndjson");

    const timedOut = runSummary(
      state,
      { run: baseRunInfo({ status: "timedOut", stopReason: "tokenCap" }), agentSubagentNames: new Set(["ba"]), events },
      "unavailable"
    );
    expect(timedOut.stopReason).toBe("tokenCap");

    const failed = runSummary(
      state,
      {
        run: baseRunInfo({ status: "failed", exitCode: 1, errorMessage: "boom\nstack" }),
        agentSubagentNames: new Set(["ba"]),
        events,
      },
      "unavailable"
    );
    expect(failed.exitCode).toBe(1);
    expect(failed.stderrTail).toBe("boom\nstack");

    // unrecognized bucket flagged when the agent set doesn't include "ba".
    const withUnrecognized = runSummary(
      state,
      { run: baseRunInfo(), agentSubagentNames: new Set(), events },
      "unavailable"
    );
    const unrecognizedRow = withUnrecognized.perNode.find((r) => r.unrecognized);
    expect(unrecognizedRow).toBeDefined();
    expect(unrecognizedRow!.ownFresh).toBe(30_000);
  });

  it("#3 fixture-simple.ndjson: degraded is false (the haiku background delta reconciles within tolerance)", () => {
    const { state, events } = foldFixture("fixture-simple.ndjson");
    const summary = runSummary(
      state,
      { run: baseRunInfo({ commandName: "run" }), agentSubagentNames: new Set(), events },
      "unavailable"
    );
    expect(summary.degraded).toBe(false);
  });

  it("#4 hand-doctored result.usage inflated by +500 beyond the background delta -> degraded true; fold totals unchanged", () => {
    const { state: baseline } = foldFixture("fixture-simple.ndjson");
    const doctoredResultEvent = parseLine(readLines("fixture-simple.ndjson")[3]!);
    expect(doctoredResultEvent.kind).toBe("result");
    if (doctoredResultEvent.kind !== "result") throw new Error("unreachable");

    let state = initRunState();
    const lines = readLines("fixture-simple.ndjson");
    const events: PersistedRunEvent[] = [];
    lines.forEach((line, i) => {
      const isResultLine = i === 3;
      const ev = isResultLine
        ? { ...doctoredResultEvent, usage: { ...doctoredResultEvent.usage, input: doctoredResultEvent.usage.input + 500 } }
        : parseLine(line);
      const persisted: PersistedRunEvent = { seq: i + 1, ts: i * 10, ev };
      events.push(persisted);
      state = fold(state, persisted);
    });

    const summary = runSummary(
      state,
      { run: baseRunInfo({ commandName: "run" }), agentSubagentNames: new Set(), events },
      "unavailable"
    );
    expect(summary.degraded).toBe(true);
    // fold's own totals (perNode main bucket) are UNCHANGED from the non-doctored case.
    const mainRow = summary.perNode.find((r) => r.label === "/run");
    const baselineMain = baseline.actors.get("main")!;
    expect(mainRow!.ownFresh).toBe(baselineMain.usage.input + baselineMain.usage.output);
  });
});
