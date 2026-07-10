"use client";

import { Button } from "@/components/ui/button";

export interface WorkflowDetectionPanelProps {
  hasClaudeDir: boolean;
  hasAgentsMd: boolean;
  /**
   * True once the eager scanClaudeDir result is known to contain something
   * importable (agents+commands+skipped > 0). Drives whether the
   * "Có, nhập vào" action renders at all. importAvailable = hasClaudeDir
   * (only set true by the caller once the eager scan has confirmed content).
   */
  importAvailable: boolean;
  onConfirm: () => void;
  onDecline: () => void;
}

/**
 * Pure presentational "existing workflow detected" panel (design §3
 * wireframes (b)/(c)/(e)). No RPC calls, no internal state.
 */
export function WorkflowDetectionPanel({
  hasClaudeDir,
  hasAgentsMd,
  importAvailable,
  onConfirm,
  onDecline,
}: WorkflowDetectionPanelProps) {
  const foundParts: string[] = [];
  if (hasClaudeDir) foundParts.push(".claude/");
  if (hasAgentsMd) foundParts.push("AGENTS.md (Codex)");

  // Codex-only, informational case (Q5): no import action available.
  if (!importAvailable) {
    return (
      <div className="space-y-2 rounded-panel border border-border-hairline bg-white/[.03] p-3 text-sm">
        <p className="font-medium text-text-body">⚠ Existing workflow detected</p>
        <p className="text-xs text-text-muted">Found: {foundParts.join(", ")}</p>
        <p className="text-xs text-text-muted">
          Symbion does not support importing from AGENTS.md in this version yet. This file will not be affected.
        </p>
        <div className="flex justify-end">
          <Button size="sm" onClick={onDecline}>
            Got it, create empty
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-panel border border-border-hairline bg-white/[.03] p-3 text-sm">
      <p className="font-medium text-text-body">⚠ Existing workflow detected</p>
      <p className="text-xs text-text-muted">
        Found: {foundParts.join(", ")}
        {hasAgentsMd && hasClaudeDir ? " (display only, import not supported yet)" : ""}
      </p>
      <p className="text-xs text-text-muted">
        Do you want to import the existing agents/commands into this project? The original files in the repo will NOT be modified.
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onDecline}>
          No, create empty
        </Button>
        <Button size="sm" onClick={onConfirm}>
          Yes, import
        </Button>
      </div>
    </div>
  );
}
