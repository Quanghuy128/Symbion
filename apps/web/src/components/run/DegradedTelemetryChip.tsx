"use client";

import { Tooltip } from "@/components/ui/tooltip";

export type DegradedReason = "parse-error" | "reconcile-mismatch";

export interface DegradedTelemetryChipProps {
  reason: DegradedReason;
}

/**
 * DegradedTelemetryChip — amber chip (ER-4 / Flaw F6, P2). Renders when
 * useRunStore's `degraded` is true. TWO distinct trigger copies, never
 * conflated (STATE §13.1's explicit requirement): a parser-tolerance signal
 * (ER-4, "is my parser choking") vs a background-model reconciliation signal
 * (F6, "is my CLI/network flaky") — same visual treatment, different root
 * cause, different hover copy.
 */
export function DegradedTelemetryChip({ reason }: DegradedTelemetryChipProps) {
  const copy =
    reason === "parse-error"
      ? "Some stream-json lines couldn't be parsed. Counts may be incomplete; the raw log is kept — see the Raw tab."
      : "Background-model usage couldn't be fully reconciled with the CLI's final totals. Totals may be slightly off; the raw log is kept.";

  return (
    <Tooltip content={copy}>
      <span className="inline-flex items-center gap-1 rounded-pill bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[.05em] text-warning">
        ⚠ telemetry degraded
      </span>
    </Tooltip>
  );
}
