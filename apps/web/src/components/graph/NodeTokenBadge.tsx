"use client";

import { useState } from "react";
import type { FourWay } from "@symbion/core";
import { TokenBreakdownCard } from "../run/TokenBreakdownCard";

export interface NodeTokenBadgeProps {
  /** fresh tokens (input+output, cache excluded) — the headline number (§6.6). */
  fresh: number;
  costUsd?: number;
  /** own breakdown; `agents` present only on command nodes (roll-up). */
  breakdown: FourWay & { agents?: FourWay };
  /** true while the run is still active (LIVE tag on the hover card). */
  live: boolean;
  degraded?: boolean;
  /** command nodes show "own + agents" in the hover card label; agent nodes omit it. */
  label?: string;
}

function fmtTok(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function fmtCost(costUsd: number | undefined): string {
  if (costUsd === undefined) return "$ —";
  return `~$${costUsd.toFixed(2)}`;
}

/**
 * NodeTokenBadge — the in-node token/cost ticker (design §3.5/§4). Fixed-width
 * mono tabular-nums from first render (nodes never resize mid-run); `—`
 * pre-first-event; hover (150ms) reveals the 4-way breakdown card (§3.6).
 */
export function NodeTokenBadge({ fresh, costUsd, breakdown, live, degraded, label }: NodeTokenBadgeProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <span
      className="relative mt-0.5 block w-full font-mono text-[11px] tabular-nums text-white/90"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {fresh > 0 ? `${fmtTok(fresh)} tok · ${fmtCost(costUsd)}` : "— tok"}
      {degraded && <span className="ml-1 text-warning" aria-label="telemetry degraded">⚠</span>}

      {hovered && (
        <div className="absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2">
          <TokenBreakdownCard
            label={label ?? ""}
            live={live}
            own={breakdown}
            agents={breakdown.agents}
            costUsd={costUsd}
          />
        </div>
      )}
    </span>
  );
}
