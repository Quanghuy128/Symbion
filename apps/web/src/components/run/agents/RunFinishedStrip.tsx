"use client";

import { X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
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
    <div className="flex items-center justify-between border-t border-line bg-surface px-2 py-1 text-caption" data-testid="run-finished-strip">
      <span className="text-ink">Run finished — {WORD[status] ?? status}</span>
      <span className="flex items-center gap-2">
        {onViewSummary && (
          <button type="button" className="text-ink underline decoration-dotted" onClick={onViewSummary}>
            View summary
          </button>
        )}
        <IconButton aria-label="Dismiss" icon={X} size="sm" onClick={onDismiss} />
      </span>
    </div>
  );
}
