"use client";

import type { ScanClaudeDirResult } from "@/lib/rpc/types";
import type { PickedEntry, PickedRole } from "@/components/importPickerShared";

export interface ImportReviewStepProps {
  scanned: ScanClaudeDirResult["parsed"];
  selected: Set<string>;
  onToggle: (id: string) => void;
  /** picked-map for the skipped-file reclassify + tree picker, owned by the
   *  parent dialog (same ownership rule as `selected`). Keyed by relPath. */
  picked: Map<string, PickedEntry>;
  /** parent handler: readImportFile → classifyPickedFile for a skipped row
   *  (PLAN §4 correction B — on-demand read, no scan re-slurp). */
  onReclassify: (relPath: string, role: PickedRole) => void;
  /** parent handler: fire listTree + mount the tree picker ("Browse files
   *  manually →"). */
  onBrowseManually: () => void;
}

/**
 * Presentational review block: agents/commands counts, the checkbox list, plus
 * (manual-file-picker) per-skipped-file reclassify controls and the "Browse
 * files manually →" entry point. No RPC calls of its own — every side effect
 * (reclassify read, listTree) funnels through the parent dialog's handlers,
 * which own the picked-map state (design §4).
 */
export function ImportReviewStep({
  scanned,
  selected,
  onToggle,
  picked,
  onReclassify,
  onBrowseManually,
}: ImportReviewStepProps) {
  return (
    <div className="space-y-2 text-sm text-text-body">
      <p className="text-success">✓ {scanned.agents.length} agents</p>
      <p className="text-success">✓ {scanned.commands.length} commands</p>

      {scanned.skipped.length > 0 && (
        <div className="max-h-48 space-y-1.5 overflow-y-auto">
          {scanned.skipped.map((s) => {
            const entry = picked.get(s.relPath);
            const role: PickedRole = entry?.role ?? "ignore";
            return (
              <div key={s.relPath} className="rounded-sm border border-warning/30 bg-warning/5 p-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-warning">
                    ⚠ {s.relPath} — {s.reason}
                  </span>
                  {entry?.warning && (
                    <span className="shrink-0 text-warning" title={entry.warning}>
                      ⚠
                    </span>
                  )}
                  {entry?.readError && (
                    <span className="shrink-0 text-danger" title={entry.readError}>
                      ✗
                    </span>
                  )}
                  <select
                    className="shrink-0 rounded-sm border border-border-input bg-bg-input px-1 py-0.5 text-xs"
                    value={role}
                    onChange={(e) => onReclassify(s.relPath, e.target.value as PickedRole)}
                  >
                    <option value="ignore">Ignore</option>
                    <option value="agent">Agent</option>
                    <option value="command">Command</option>
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="max-h-48 space-y-1 overflow-y-auto">
        {[...scanned.agents, ...scanned.commands].map((a) => (
          <label key={a.id} className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={selected.has(a.id)} onChange={() => onToggle(a.id)} />
            {a.kind === "agent" ? a.name : `/${a.name}`}
          </label>
        ))}
      </div>

      <button
        type="button"
        className="text-xs text-brand-accent underline-offset-2 hover:underline"
        onClick={onBrowseManually}
      >
        Didn&apos;t find what you expected? Browse files manually →
      </button>
    </div>
  );
}
