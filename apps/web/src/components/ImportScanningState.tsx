"use client";

export interface ImportScanningStateProps {
  /** Unused this iteration per design doc's autopilot decision #4 — included
   * in the type for forward compat, not wired to a button. */
  onCancel?: () => void;
}

/** S3 — transient loading row shown while scanClaudeDir is in flight. */
export function ImportScanningState(_props: ImportScanningStateProps) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-muted/40 p-6 text-sm text-muted-foreground">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      Đang quét .claude/…
    </div>
  );
}
