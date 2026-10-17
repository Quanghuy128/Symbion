"use client";

import { fmtClock } from "./format";

export interface LiveDurationProps {
  startedAtMs: number | null | undefined;
  endedAtMs?: number | null;
  /** the panel's single shared clock (useNow). */
  nowMs: number;
  /** false = frozen (history / terminal). The panel's clock does not tick
   *  then, so an unfinished duration renders a stable m:ss. */
  ticking: boolean;
  className?: string;
}

/** m:ss duration driven by the panel's ONE clock (plan §10.5) — no own timer. */
export function LiveDuration({ startedAtMs, endedAtMs, nowMs, ticking, className }: LiveDurationProps) {
  if (startedAtMs === null || startedAtMs === undefined) {
    return <span className={`font-mono tabular-nums ${className ?? ""}`}>—</span>;
  }
  const end = endedAtMs ?? nowMs;
  return (
    <span data-ticking={ticking && endedAtMs == null ? "true" : undefined} className={`font-mono tabular-nums ${className ?? ""}`}>
      {fmtClock(end - startedAtMs)}
    </span>
  );
}
