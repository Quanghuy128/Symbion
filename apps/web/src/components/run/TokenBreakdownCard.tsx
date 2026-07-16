"use client";

import type { FourWay } from "@symbion/core";

export interface TokenBreakdownCardProps {
  label: string;
  live: boolean;
  own: FourWay;
  /** absent on agent-node cards (design §3.6: "Agent-node variant drops the + agents column"). */
  agents?: FourWay;
  costUsd?: number;
}

function fmtTok(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(2)}k`;
}

function fresh(u: FourWay): number {
  return u.input + u.output;
}

function total(a: FourWay, b?: FourWay): FourWay {
  if (!b) return a;
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/**
 * TokenBreakdownCard — the hover portal (design §3.6): own / +agents / total
 * columns, fresh headline row bold, cache rows muted (cache detail ONLY lives
 * here — never in a headline number, locked §6.6).
 */
export function TokenBreakdownCard({ label, live, own, agents, costUsd }: TokenBreakdownCardProps) {
  const totalUsage = total(own, agents);
  const showAgentsColumn = agents !== undefined;

  return (
    <div className="w-[300px] rounded-panel border border-border-menu bg-bg-menu p-3 text-[11px] shadow-dropdown">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-text-body">{label} — token usage</span>
        {live && <span className="text-run-active">LIVE ⟳</span>}
      </div>

      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 tabular-nums">
        <span />
        <span className="text-right text-text-muted">own</span>
        {showAgentsColumn && <span className="text-right text-text-muted">+ agents</span>}
        <span className="text-right text-text-muted">total</span>

        <span className="text-text-muted">input</span>
        <span className="text-right text-text-body">{fmtTok(own.input)}</span>
        {showAgentsColumn && <span className="text-right text-text-body">{fmtTok(agents?.input ?? 0)}</span>}
        <span className="text-right text-text-body">{fmtTok(totalUsage.input)}</span>

        <span className="text-text-muted">output</span>
        <span className="text-right text-text-body">{fmtTok(own.output)}</span>
        {showAgentsColumn && <span className="text-right text-text-body">{fmtTok(agents?.output ?? 0)}</span>}
        <span className="text-right text-text-body">{fmtTok(totalUsage.output)}</span>
      </div>

      <div className="my-2 border-t border-border-hairline" />

      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 tabular-nums">
        <span className="font-semibold text-text-strong">fresh</span>
        <span className="text-right font-semibold text-text-strong">{fmtTok(fresh(own))}</span>
        {showAgentsColumn && (
          <span className="text-right font-semibold text-text-strong">{fmtTok(fresh(agents ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }))}</span>
        )}
        <span className="text-right font-semibold text-text-strong">{fmtTok(fresh(totalUsage))}</span>

        <span className="text-text-faint">cache read</span>
        <span className="text-right text-text-faint">{fmtTok(own.cacheRead)}</span>
        {showAgentsColumn && <span className="text-right text-text-faint">{fmtTok(agents?.cacheRead ?? 0)}</span>}
        <span className="text-right text-text-faint">{fmtTok(totalUsage.cacheRead)}</span>

        <span className="text-text-faint">cache write</span>
        <span className="text-right text-text-faint">{fmtTok(own.cacheWrite)}</span>
        {showAgentsColumn && <span className="text-right text-text-faint">{fmtTok(agents?.cacheWrite ?? 0)}</span>}
        <span className="text-right text-text-faint">{fmtTok(totalUsage.cacheWrite)}</span>
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-border-hairline pt-2">
        <span className="text-text-muted">cost</span>
        <span className="font-semibold text-text-strong">{costUsd !== undefined ? `~$${costUsd.toFixed(2)}` : "$ —"}</span>
      </div>

      <p className="mt-2 text-[10px] leading-snug text-text-faint">
        Headline counts fresh tokens only; cache traffic is included in the $ cost.
      </p>
    </div>
  );
}
