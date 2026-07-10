"use client";

import type { ScanClaudeDirResult } from "@/lib/rpc/types";

export interface ImportReviewStepProps {
  scanned: ScanClaudeDirResult["parsed"];
  selected: Set<string>;
  onToggle: (id: string) => void;
}

/**
 * Pure presentational review-with-checkboxes block: agents/commands counts,
 * skipped-files-with-reasons, and the checkbox list. No RPC calls, no
 * name-field, no import-trigger button — those stay owned by each caller
 * (ImportDialog / CreateProjectDialog) per design §4.
 *
 * Extracted verbatim from ImportDialog.tsx's former inline `{scanned && (...)}`
 * block — no behavior change versus the pre-extraction JSX.
 */
export function ImportReviewStep({ scanned, selected, onToggle }: ImportReviewStepProps) {
  return (
    <div className="space-y-2 text-sm text-text-body">
      <p className="text-success">✓ {scanned.agents.length} agents</p>
      <p className="text-success">✓ {scanned.commands.length} commands</p>
      {scanned.skipped.map((s) => (
        <p key={s.relPath} className="text-xs text-warning">
          ⚠ {s.relPath} could not be parsed → skipped ({s.reason})
        </p>
      ))}
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {[...scanned.agents, ...scanned.commands].map((a) => (
          <label key={a.id} className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={selected.has(a.id)} onChange={() => onToggle(a.id)} />
            {a.kind === "agent" ? a.name : `/${a.name}`}
          </label>
        ))}
      </div>
    </div>
  );
}
