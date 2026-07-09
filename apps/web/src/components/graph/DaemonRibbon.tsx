"use client";

export interface DaemonRibbonProps {
  onRetry: () => void;
}

/**
 * DaemonRibbon (design §5 R, surface R) — top ribbon shown when the daemon
 * connection is lost. The graph stays viewable (pan/zoom/hover); only mutation
 * is gated (handled by the parent disabling affordances). `warning` tint. z-10.
 */
export function DaemonRibbon({ onRetry }: DaemonRibbonProps) {
  return (
    <div className="relative z-10 mb-2 flex items-center justify-between gap-3 rounded-panel border border-warning/30 bg-warning/10 px-4 py-2.5 text-[12.5px] text-warning">
      <span>⦿ Daemon disconnected — the graph is read-only.</span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-sm border border-warning/40 px-2.5 py-1 text-[12px] font-medium text-warning hover:bg-warning/10"
      >
        Retry
      </button>
    </div>
  );
}
