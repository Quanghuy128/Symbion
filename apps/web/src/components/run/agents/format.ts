/** Shared formatting for the Agents panel (plain strings only). */

export function fmtTok(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return n === 0 ? "0" : "—";
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

/** m:ss (or h:mm:ss) for a non-negative duration in ms. */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** 4m12s / 38s style. */
export function fmtDurationWords(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

export function fmtCost(costUsd: number | undefined | null): string | null {
  return costUsd === undefined || costUsd === null ? null : `~$${costUsd.toFixed(2)}`;
}

export const TRUNCATION_NOTE = "⋯ truncated — preview capped at 2,000 chars";
