"use client";

import { useState } from "react";

export interface AuthorSkippedSummaryProps {
  items: Array<{ relPath: string; reason: string }>;
}

/** Collapse threshold above which the per-file list is hidden behind "Xem
 *  chi tiết" by default (design doc Interaction Notes — "above 3", an
 *  arbitrary placeholder number per Open Design Question 4, not researched). */
const COLLAPSE_THRESHOLD = 3;

/**
 * AuthorSkippedSummary — design doc §3.5 (A6 wireframe). Extends v1's
 * existing per-file skipped-item idiom (TemplateSection's inline warning
 * lines) to cover potentially much higher counts from a live-fetched
 * remote source — avoids "wall of warnings" by collapsing to one summary
 * line + an expandable detail list above the threshold.
 */
export function AuthorSkippedSummary({ items }: AuthorSkippedSummaryProps) {
  const [expanded, setExpanded] = useState(items.length <= COLLAPSE_THRESHOLD);

  if (items.length === 0) return null;

  return (
    <div className="text-xs text-amber-600">
      <div className="flex items-center gap-2">
        <span>
          ⚠ {items.length} templates failed to load → skipped
        </span>
        {items.length > COLLAPSE_THRESHOLD && (
          <button onClick={() => setExpanded((v) => !v)} className="underline hover:text-foreground">
            {expanded ? "Hide details" : "Show details"}
          </button>
        )}
      </div>
      {expanded && (
        <ul className="mt-1 space-y-0.5">
          {items.map((item) => (
            <li key={item.relPath}>
              {item.relPath} ({item.reason})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
