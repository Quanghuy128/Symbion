/**
 * retention.test.ts — selectPruneTargets policy unit tests (STATE §18.1,
 * testplan §7.1). Pure function, no fs.
 */
import { describe, expect, it } from "vitest";
import { selectPruneTargets, type PruneCandidate } from "../../src/run/retention.js";

function run(runId: string, startedAt: string): PruneCandidate {
  return { runId, startedAt };
}

describe("selectPruneTargets", () => {
  it("#1 — 60 runs, keep=50 → returns exactly the 10 oldest by startedAt", () => {
    const runs: PruneCandidate[] = [];
    for (let i = 0; i < 60; i++) {
      // startedAt increases with i — i=0 is oldest.
      runs.push(run(`run-${i}`, `2026-07-${String(1 + Math.floor(i / 2)).padStart(2, "0")}T00:00:${String(i).padStart(2, "0")}Z`));
    }
    const targets = selectPruneTargets(runs, 50);
    expect(targets).toHaveLength(10);
    const oldest10 = runs.slice(0, 10).map((r) => r.runId);
    expect(new Set(targets)).toEqual(new Set(oldest10));
    // the 50 newest must NOT appear in the result.
    const newest50 = runs.slice(10).map((r) => r.runId);
    for (const id of newest50) {
      expect(targets).not.toContain(id);
    }
  });

  it("#2 — runs.length <= keep (30 runs, keep=50) → empty array", () => {
    const runs: PruneCandidate[] = [];
    for (let i = 0; i < 30; i++) runs.push(run(`run-${i}`, `2026-07-01T00:00:${String(i).padStart(2, "0")}Z`));
    expect(selectPruneTargets(runs, 50)).toEqual([]);
  });

  it("#3 — empty runs array → empty array, no throw", () => {
    expect(() => selectPruneTargets([], 50)).not.toThrow();
    expect(selectPruneTargets([], 50)).toEqual([]);
  });

  it("#4 — two runs with IDENTICAL startedAt, keep=1 → stable tie-break (earlier in input array = older)", () => {
    const a = run("run-a", "2026-07-01T00:00:00Z");
    const b = run("run-b", "2026-07-01T00:00:00Z");
    // a appears first in the input array — it is treated as "older" and
    // selected for deletion, deterministically, every call.
    expect(selectPruneTargets([a, b], 1)).toEqual(["run-a"]);
    // Reversing input order flips which one is "older" — still deterministic,
    // pinning that the rule is INPUT-ORDER-based, not runId/other tie-break.
    expect(selectPruneTargets([b, a], 1)).toEqual(["run-b"]);
  });

  it("#5 — keep=0 → every run is selected for deletion", () => {
    const runs = [run("run-a", "2026-07-01T00:00:00Z"), run("run-b", "2026-07-02T00:00:00Z")];
    const targets = selectPruneTargets(runs, 0);
    expect(new Set(targets)).toEqual(new Set(["run-a", "run-b"]));
  });

  it("#6 — negative keep is treated identically to keep=0 (no clamping)", () => {
    const runs = [run("run-a", "2026-07-01T00:00:00Z"), run("run-b", "2026-07-02T00:00:00Z")];
    expect(new Set(selectPruneTargets(runs, -5))).toEqual(new Set(selectPruneTargets(runs, 0)));
    expect(new Set(selectPruneTargets(runs, -5))).toEqual(new Set(["run-a", "run-b"]));
  });
});
