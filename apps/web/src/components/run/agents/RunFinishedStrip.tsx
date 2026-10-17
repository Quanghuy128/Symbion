"use client";

import type { RunStatus } from "@symbion/core";

export interface RunFinishedStripProps {
  status: RunStatus;
  onViewSummary?: () => void;
  onDismiss: () => void;
}

const WORD: Partial<Record<RunStatus, string>> = {
  completed: "✓ completed",
  failed: "✗ failed",
  cancelled: "◼ cancelled",
  timedOut: "⚠ stopped",
};

/** S4c — shown when the run ends while the user is inside an agent detail (no auto-navigation). */
export function RunFinishedStrip({ status, onViewSummary, onDismiss }: RunFinishedStripProps) {
  return (
    <div className="flex items-center justify-between border-t border-border-hairline bg-bg-menu px-2 py-1 text-[11px]" data-testid="run-finished-strip">
      <span className="text-text-body">Run finished — {WORD[status] ?? status}</span>
      <span className="flex items-center gap-2">
        {onViewSummary && (
          <button type="button" className="text-text-body underline decoration-dotted" onClick={onViewSummary}>
            View summary
          </button>
        )}
        <button type="button" aria-label="Dismiss" className="text-text-faint hover:text-text-body" onClick={onDismiss}>
          ✕
        </button>
      </span>
    </div>
  );
}
