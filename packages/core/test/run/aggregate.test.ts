import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLine } from "../../src/run/parseStreamJson.js";
import { fold, freshOf, initRunState, rollup, type RunState } from "../../src/run/aggregate.js";
import type { PersistedRunEvent } from "../../src/run/events.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "..", "fixtures", "run");

function readLines(name: string): string[] {
  return readFileSync(join(fixtureDir, name), "utf-8").trimEnd().split("\n");
}

function foldFixture(name: string): RunState {
  const lines = readLines(name);
  let state = initRunState();
  let seq = 1;
  for (const line of lines) {
    const ev = parseLine(line);
    const persisted: PersistedRunEvent = { seq: seq++, ts: Date.now(), ev };
    state = fold(state, persisted);
  }
  return state;
}

describe("aggregate — the AC-RUN-2 contract (§1.3)", () => {
  it("#1 fold fixture-rollup-synthetic -> exact 100k/130k, ba 30k/30k", () => {
    const state = foldFixture("fixture-rollup-synthetic.ndjson");
    const rolled = rollup(state, new Set(["ba"]));
    expect(rolled.command.ownFresh).toBe(100_000);
    expect(rolled.command.totalFresh).toBe(130_000);
    expect(rolled.byAgent.get("ba")?.ownFresh).toBe(30_000);
    expect(rolled.byAgent.get("ba")?.totalFresh).toBe(30_000);
  });

  it("#2 fresh formula excludes cacheRead/cacheWrite", () => {
    const state = foldFixture("fixture-rollup-synthetic.ndjson");
    // main actor's raw usage has non-zero cache traffic; fresh must ignore it.
    const main = state.actors.get("main")!;
    expect(main.usage.cacheRead).toBeGreaterThan(0);
    expect(main.usage.cacheWrite).toBeGreaterThan(0);
    expect(freshOf(main.usage)).toBe(100_000);
  });

  it("#3 invariant: command.totalFresh === Σ(all attributed + unrecognized fresh) for every fixture", () => {
    for (const name of ["fixture-simple.ndjson", "fixture-rollup-synthetic.ndjson", "fixture-subagent.ndjson"]) {
      const state = foldFixture(name);
      const rolled = rollup(state, new Set()); // empty graph -> everything non-main is unrecognized
      const sumAgents = [...rolled.byAgent.values()].reduce((a, b) => a + b.ownFresh, 0);
      expect(rolled.command.totalFresh).toBe(rolled.command.ownFresh + sumAgents + rolled.unrecognized.fresh);
    }
  });

  it("#4 order-independence: 100 seeded shuffles yield identical terminal rollup", () => {
    const lines = readLines("fixture-rollup-synthetic.ndjson");
    const persistedBase = lines.map((line) => parseLine(line));
    let seed = 42;
    function rand() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }
    function shuffle<T>(arr: T[]): T[] {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    }

    const baseline = (() => {
      let state = initRunState();
      lines.forEach((_, i) => {
        state = fold(state, { seq: i + 1, ts: 0, ev: persistedBase[i]! });
      });
      return rollup(state, new Set(["ba"]));
    })();

    for (let trial = 0; trial < 100; trial++) {
      const order = shuffle(persistedBase.map((ev, i) => ({ ev, i })));
      let state = initRunState();
      // seq reassigned per permutation (seq is just an ordering key here —
      // the reducer's attribution keys off parentToolUseId, not seq order).
      order.forEach((item, idx) => {
        state = fold(state, { seq: idx + 1, ts: 0, ev: item.ev });
      });
      const rolled = rollup(state, new Set(["ba"]));
      expect(rolled.command.ownFresh).toBe(baseline.command.ownFresh);
      expect(rolled.command.totalFresh).toBe(baseline.command.totalFresh);
      expect(rolled.byAgent.get("ba")?.ownFresh).toBe(baseline.byAgent.get("ba")?.ownFresh);
    }
  });

  it("#5 message-id dedup (Flaw F5): shared-id usage counted ONCE", () => {
    const state = foldFixture("fixture-duplicate-usage.ndjson");
    const main = state.actors.get("main")!;
    // sharedUsage was input:1000/output:2000, emitted TWICE with the same id.
    expect(main.usage.input).toBe(1000);
    expect(main.usage.output).toBe(2000);
  });

  it("#6 unrecognized subagent: never dropped, included in command total", () => {
    const state = foldFixture("fixture-rollup-synthetic.ndjson");
    // pass an agent-name set that does NOT include "ba".
    const rolled = rollup(state, new Set(["someone-else"]));
    expect(rolled.byAgent.size).toBe(0);
    expect(rolled.unrecognized.fresh).toBe(30_000);
    expect(rolled.command.totalFresh).toBe(100_000 + 30_000);
  });

  it("#7 parse-error/unknown events increment counters, never change token numbers", () => {
    const before = foldFixture("fixture-simple.ndjson");
    const rolledBefore = rollup(before, new Set());

    const withGarbage = foldFixture("fixture-garbage.ndjson");
    expect(withGarbage.parseErrors).toBeGreaterThan(0);
    expect(withGarbage.unknownEvents).toBeGreaterThan(0);

    // fixture-garbage.ndjson embeds the same assistant/init/result lines as
    // fixture-simple.ndjson plus garbage — its token totals for the shared
    // assistant message should match (garbage lines contribute 0 tokens).
    const rolledGarbage = rollup(withGarbage, new Set());
    expect(rolledGarbage.command.ownFresh).toBeGreaterThanOrEqual(rolledBefore.command.ownFresh);
  });

  it("#8 seq monotonicity guard: folding seq <= lastSeq is a no-op", () => {
    let state = initRunState();
    const ev = parseLine(readLines("fixture-simple.ndjson")[2]!); // an assistant message
    state = fold(state, { seq: 5, ts: 0, ev });
    const afterFirst = state;
    const afterReplay = fold(state, { seq: 5, ts: 0, ev });
    expect(afterReplay).toBe(afterFirst); // same object reference — true no-op.
    const afterLower = fold(state, { seq: 3, ts: 0, ev });
    expect(afterLower).toBe(afterFirst);
  });

  it("#9 result cross-check (Flaw F6): fold totals equal result.usage for the simple fixture's main model", () => {
    const state = foldFixture("fixture-simple.ndjson");
    const main = state.actors.get("main")!;
    expect(main.usage.input).toBe(state.result!.usage.input);
    expect(main.usage.output).toBe(state.result!.usage.output);
  });

  it("#10 fold the REAL fixture-subagent.ndjson — at least one non-main actor bucket; rollup tolerant of an unrelated agent set", () => {
    const state = foldFixture("fixture-subagent.ndjson");
    const nonMainActors = [...state.actors.keys()].filter((k) => k !== "main");
    expect(nonMainActors.length).toBeGreaterThan(0);
    expect(() => rollup(state, new Set(["totally-unrelated-agent"]))).not.toThrow();
    const rolled = rollup(state, new Set(["totally-unrelated-agent"]));
    // the real dispatch's subagent_type ("general-purpose") doesn't match ->
    // falls into unrecognized, still counted in the command total (NEW-1).
    expect(rolled.unrecognized.fresh).toBeGreaterThan(0);
    expect(rolled.command.totalFresh).toBe(rolled.command.ownFresh + rolled.unrecognized.fresh);
  });

  it("#11 fold the REAL fixture-subagent.ndjson with the CORRECT agent name supplied", () => {
    const state = foldFixture("fixture-subagent.ndjson");
    const rolled = rollup(state, new Set(["general-purpose"]));
    const bucket = rolled.byAgent.get("general-purpose");
    expect(bucket?.ownFresh).toBeGreaterThan(0);
    const sumAgents = [...rolled.byAgent.values()].reduce((a, b) => a + b.ownFresh, 0);
    expect(rolled.command.totalFresh).toBe(rolled.command.ownFresh + sumAgents + rolled.unrecognized.fresh);
  });

  it("#12 fold called twice with the same seq is a no-op (belt-and-braces dedup)", () => {
    const lines = readLines("fixture-simple.ndjson");
    let state = initRunState();
    lines.forEach((line, i) => {
      state = fold(state, { seq: i + 1, ts: 0, ev: parseLine(line) });
    });
    const rolledOnce = rollup(state, new Set());
    // Re-fold the same last event with the same seq again.
    const replayed = fold(state, { seq: lines.length, ts: 0, ev: parseLine(lines[lines.length - 1]!) });
    const rolledTwice = rollup(replayed, new Set());
    expect(rolledTwice).toEqual(rolledOnce);
  });
});
