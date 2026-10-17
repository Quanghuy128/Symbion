"use client";

import type { RunStatus, StopReason } from "@symbion/core";
import { fmtCost, fmtDurationWords, fmtTok } from "./format";

export interface RunOutcomeCardProps {
  status: RunStatus;
  exitCode: number | null;
  stopReason: StopReason | null;
  durationMs: number | null;
  freshTokens: number;
  costUsd?: number;
  filesChanged: number | null;
  onViewSummary?: () => void;
  /** Settings → Execution for this project (timedOut only). A plain link: no router coupling. */
  adjustCeilingsHref?: string;
}

/** S3 — terminal Outcome card at the top of the tree (design §3 S3). */
export function RunOutcomeCard({
  status,
  exitCode,
  stopReason,
  durationMs,
  freshTokens,
  costUsd,
  filesChanged,
  onViewSummary,
  adjustCeilingsHref,
}: RunOutcomeCardProps) {
  const head =
    status === "completed"
      ? { glyph: "✓", word: "Completed", cls: "text-success" }
      : status === "failed"
        ? { glyph: "✗", word: `Failed — exit ${exitCode ?? "?"}`, cls: "text-danger-text" }
        : status === "cancelled"
          ? { glyph: "◼", word: "Cancelled by you", cls: "text-ink-muted" }
          : { glyph: "⚠", word: `Stopped — ${stopReason === "tokenCap" ? "token cap" : "time ceiling"}`, cls: "text-warning" };
  const bits = [fmtDurationWords(durationMs), `${fmtTok(freshTokens)} tok`];
  const cost = fmtCost(costUsd);
  if (cost) bits.push(cost);
  if (filesChanged !== null) bits.push(`${filesChanged} file${filesChanged === 1 ? "" : "s"}`);

  return (
    <div className="mx-2 my-2 rounded-lg border border-line bg-surface px-3 py-2 text-caption" data-testid="run-outcome-card">
      <p>
        <span className={`font-semibold ${head.cls}`}>
          {head.glyph} {head.word}
        </span>
        <span className="text-ink"> · {bits.join(" · ")}</span>
      </p>
      {status === "cancelled" && <p className="mt-0.5 text-overline text-ink-muted">Files already written stay written.</p>}
      <div className="mt-1 flex items-center justify-end gap-2">
        {status === "timedOut" && adjustCeilingsHref && (
          <a href={adjustCeilingsHref} className="text-caption text-warning underline decoration-dotted">
            Adjust ceilings ›
          </a>
        )}
        {onViewSummary && (
          <button
            type="button"
            className="rounded-sm border border-line-soft px-2 py-0.5 text-caption text-ink hover:bg-surface-hover"
            onClick={onViewSummary}
          >
            View summary
          </button>
        )}
      </div>
    </div>
  );
}
