/**
 * pricing — model pricing table + cost estimation (P2, STATE §13.1 pricing.ts /
 * Flaw F4). PURE — no Node imports (AC-RUN-11).
 *
 * `estimateCostUsd` returns `undefined` for an unrecognized model (F4's
 * "$ —", never `$0.00`/`NaN`). Model strings carry date suffixes (e.g.
 * `claude-haiku-4-5-20251001`) — matched by family+tier PREFIX, not exact
 * string, so a dated release of a known family still prices (Risk R1/A14:
 * accepted staleness trade — a genuinely NEW family still returns undefined).
 */
import type { FourWay } from "./events.js";

export interface ModelRate {
  inputPerMtok: number;
  outputPerMtok: number;
  cacheReadPerMtok: number;
  cacheWritePerMtok: number;
}

/**
 * Keyed by a family+tier PREFIX (checked via `startsWith`, longest-prefix-first
 * at lookup time — see `resolveRate`). Seeded from the two models observed in
 * the real fixtures (`fixture-simple.ndjson`'s `claude-fable-5` main model +
 * `claude-haiku-4-5-20251001` background model, `fixture-subagent.ndjson`'s
 * `claude-sonnet-4-6`) plus the publicly documented Claude pricing tiers
 * (Opus/Sonnet/Haiku family rates, per-mtok, USD) so common real-world models
 * resolve without a fixture round-trip. Rates are approximate publicly-listed
 * list prices — NOT a live pricing feed; this is an estimate, always `~$`-
 * prefixed in the UI, reconciled to `result.totalCostUsd` at terminal.
 */
export const MODEL_PRICING: Record<string, ModelRate> = {
  // Opus tier.
  "claude-opus-4": { inputPerMtok: 15, outputPerMtok: 75, cacheReadPerMtok: 1.5, cacheWritePerMtok: 18.75 },
  "claude-3-opus": { inputPerMtok: 15, outputPerMtok: 75, cacheReadPerMtok: 1.5, cacheWritePerMtok: 18.75 },
  // Sonnet tier (includes the real fixture's claude-sonnet-4-6 and claude-fable-5,
  // an internal/codename build of the same main-model tier observed in
  // fixture-simple.ndjson — priced at the sonnet tier since its fixture cost
  // reconciles closest to that rate).
  "claude-sonnet-4": { inputPerMtok: 3, outputPerMtok: 15, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 },
  "claude-3-5-sonnet": { inputPerMtok: 3, outputPerMtok: 15, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 },
  "claude-3-7-sonnet": { inputPerMtok: 3, outputPerMtok: 15, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 },
  "claude-fable": { inputPerMtok: 3, outputPerMtok: 15, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 },
  // Haiku tier.
  "claude-haiku-4": { inputPerMtok: 1, outputPerMtok: 5, cacheReadPerMtok: 0.1, cacheWritePerMtok: 1.25 },
  "claude-3-5-haiku": { inputPerMtok: 0.8, outputPerMtok: 4, cacheReadPerMtok: 0.08, cacheWritePerMtok: 1 },
  "claude-3-haiku": { inputPerMtok: 0.25, outputPerMtok: 1.25, cacheReadPerMtok: 0.03, cacheWritePerMtok: 0.3 },
};

/** Longest-prefix-first match so e.g. `claude-3-5-haiku` doesn't accidentally
 *  match a shorter, wrong `claude-3-haiku` prefix. */
function resolveRate(model: string): ModelRate | undefined {
  if (!model) return undefined;
  let best: { prefix: string; rate: ModelRate } | undefined;
  for (const [prefix, rate] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) {
      best = { prefix, rate };
    }
  }
  return best?.rate;
}

/** true iff any pricing entry's prefix matches `model` (F4's "$ —" gate). */
export function hasKnownPricing(model: string): boolean {
  return resolveRate(model) !== undefined;
}

/** Estimate cost in USD for a FourWay usage block under `model`. `undefined`
 *  for an unrecognized model (F4) — the caller renders `$ —`, never `$0.00`. */
export function estimateCostUsd(usage: FourWay, model: string): number | undefined {
  const rate = resolveRate(model);
  if (!rate) return undefined;
  const mtok = 1_000_000;
  return (
    (usage.input / mtok) * rate.inputPerMtok +
    (usage.output / mtok) * rate.outputPerMtok +
    (usage.cacheRead / mtok) * rate.cacheReadPerMtok +
    (usage.cacheWrite / mtok) * rate.cacheWritePerMtok
  );
}

/**
 * reconcileToTotal — proportionally rescale per-node cost ESTIMATES so their
 * sum equals `totalCostUsd` (which alone accounts for hidden background
 * models via `result.total_cost_usd` — F4/F6's single reconciliation point).
 *
 * Degenerate case: if every estimate is 0/undefined-turned-0 but
 * `totalCostUsd > 0` (e.g. every actor's model was unrecognized), falls back
 * to a pro-rata-by-FRESH-TOKEN-SHARE split so the run still gets a sane
 * terminal split instead of a divide-by-zero / all-zero result.
 */
export function reconcileToTotal<K>(
  perNodeEstimates: Map<K, number>,
  totalCostUsd: number,
  freshTokenShares?: Map<K, number>
): Map<K, number> {
  const out = new Map<K, number>();
  if (perNodeEstimates.size === 0) return out;

  const sumEstimates = [...perNodeEstimates.values()].reduce((a, b) => a + b, 0);

  if (sumEstimates > 0) {
    for (const [key, est] of perNodeEstimates) {
      out.set(key, (est / sumEstimates) * totalCostUsd);
    }
    return out;
  }

  // Degenerate: no usable $ estimates at all. Fall back to fresh-token share
  // if provided; else split evenly (last-resort, avoids NaN/Infinity).
  if (totalCostUsd <= 0) {
    for (const key of perNodeEstimates.keys()) out.set(key, 0);
    return out;
  }
  const shares = freshTokenShares ?? new Map<K, number>();
  const sumShares = [...perNodeEstimates.keys()].reduce((a, k) => a + (shares.get(k) ?? 0), 0);
  if (sumShares > 0) {
    for (const key of perNodeEstimates.keys()) {
      out.set(key, ((shares.get(key) ?? 0) / sumShares) * totalCostUsd);
    }
  } else {
    const even = totalCostUsd / perNodeEstimates.size;
    for (const key of perNodeEstimates.keys()) out.set(key, even);
  }
  return out;
}
