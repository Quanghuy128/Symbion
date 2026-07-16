import { describe, expect, it } from "vitest";
import { estimateCostUsd, hasKnownPricing, reconcileToTotal } from "../../src/run/pricing.js";
import type { FourWay } from "../../src/run/events.js";

describe("pricing — Flaw F4 (§1.4)", () => {
  it("#1 known model estimate is > 0; cache-heavy usage costs more than fresh-only", () => {
    const freshOnly: FourWay = { input: 2655, output: 4, cacheRead: 0, cacheWrite: 0 };
    const withCache: FourWay = { input: 2655, output: 4, cacheRead: 0, cacheWrite: 9980 };
    const model = "claude-sonnet-4-6";
    expect(hasKnownPricing(model)).toBe(true);
    const freshCost = estimateCostUsd(freshOnly, model)!;
    const cacheCost = estimateCostUsd(withCache, model)!;
    expect(freshCost).toBeGreaterThan(0);
    expect(cacheCost).toBeGreaterThan(freshCost);
  });

  it("#2 unknown model returns undefined -> UI renders '—', never NaN/0", () => {
    const usage: FourWay = { input: 100, output: 100, cacheRead: 0, cacheWrite: 0 };
    expect(estimateCostUsd(usage, "some-totally-unknown-model-xyz")).toBeUndefined();
    expect(hasKnownPricing("some-totally-unknown-model-xyz")).toBe(false);
  });

  it("#3 terminal reconciliation: per-node estimates scaled so Σ === totalCostUsd ± 0.005", () => {
    const estimates = new Map<string, number>([
      ["main", 0.1],
      ["ba", 0.05],
    ]);
    const total = 0.2269;
    const reconciled = reconcileToTotal(estimates, total);
    const sum = [...reconciled.values()].reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - total)).toBeLessThanOrEqual(0.005);
  });

  it("#4 dated suffix of a KNOWN family resolves to the same rates as the family entry", () => {
    const usage: FourWay = { input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 };
    const known = estimateCostUsd(usage, "claude-haiku-4-5-20251001");
    const family = estimateCostUsd(usage, "claude-haiku-4");
    expect(known).toBeDefined();
    expect(known).toBe(family);
  });

  it("#5 every actor's model unknown, but totalCostUsd > 0 -> pro-rata-by-fresh-token-share fallback, no divide-by-zero", () => {
    const estimates = new Map<string, number>([
      ["main", 0],
      ["ba", 0],
    ]);
    const freshShares = new Map<string, number>([
      ["main", 100_000],
      ["ba", 30_000],
    ]);
    const reconciled = reconcileToTotal(estimates, 1.0, freshShares);
    expect(reconciled.get("main")).toBeCloseTo(1.0 * (100_000 / 130_000), 5);
    expect(reconciled.get("ba")).toBeCloseTo(1.0 * (30_000 / 130_000), 5);
    const sum = [...reconciled.values()].reduce((a, b) => a + b, 0);
    expect(Number.isFinite(sum)).toBe(true);
  });

  it("#6 zero-usage run (cancelled before any assistant message): no NaN/Infinity", () => {
    const zero: FourWay = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const cost = estimateCostUsd(zero, "claude-sonnet-4-6");
    expect(cost).toBe(0);
    expect(Number.isNaN(cost)).toBe(false);

    // all-zero estimates, totalCostUsd = 0 -> reconcileToTotal must not divide by zero.
    const estimates = new Map<string, number>([["main", 0]]);
    const reconciled = reconcileToTotal(estimates, 0);
    expect(reconciled.get("main")).toBe(0);
    expect(Number.isNaN(reconciled.get("main"))).toBe(false);
  });
});
