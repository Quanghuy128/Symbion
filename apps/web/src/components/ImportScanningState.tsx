"use client";

export interface ImportScanningStateProps {
  /** Unused this iteration per design doc's autopilot decision #4 — included
   * in the type for forward compat, not wired to a button. */
  onCancel?: () => void;
}

/** S3 — transient loading row shown while scanClaudeDir is in flight. */
export function ImportScanningState(_props: ImportScanningStateProps) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-line bg-surface-hover p-6 text-ui text-ink-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-muted border-t-transparent" />
      Scanning .claude/…
    </div>
  );
}
