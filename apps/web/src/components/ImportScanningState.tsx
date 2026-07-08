"use client";

export interface ImportScanningStateProps {
  /** Unused this iteration per design doc's autopilot decision #4 — included
   * in the type for forward compat, not wired to a button. */
  onCancel?: () => void;
}

/** S3 — transient loading row shown while scanClaudeDir is in flight. */
export function ImportScanningState(_props: ImportScanningStateProps) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-panel border border-border-hairline bg-white/[.03] p-6 text-sm text-text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-text-muted border-t-transparent" />
      Đang quét .claude/…
    </div>
  );
}
