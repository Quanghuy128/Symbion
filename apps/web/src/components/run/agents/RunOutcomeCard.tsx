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
        ? { glyph: "✗", word: `Failed — exit ${exitCode ?? "?"}`, cls: "text-danger" }
        : status === "cancelled"
          ? { glyph: "◼", word: "Cancelled by you", cls: "text-text-muted" }
          : { glyph: "⚠", word: `Stopped — ${stopReason === "tokenCap" ? "token cap" : "time ceiling"}`, cls: "text-warning" };
  const bits = [fmtDurationWords(durationMs), `${fmtTok(freshTokens)} tok`];
  const cost = fmtCost(costUsd);
  if (cost) bits.push(cost);
  if (filesChanged !== null) bits.push(`${filesChanged} file${filesChanged === 1 ? "" : "s"}`);

  return (
    <div className="mx-2 my-2 rounded-panel border border-border-hairline bg-bg-surface px-3 py-2 text-[11.5px]" data-testid="run-outcome-card">
      <p>
        <span className={`font-semibold ${head.cls}`}>
          {head.glyph} {head.word}
        </span>
        <span className="text-text-body"> · {bits.join(" · ")}</span>
      </p>
      {status === "cancelled" && <p className="mt-0.5 text-[10.5px] text-text-muted">Files already written stay written.</p>}
      <div className="mt-1 flex items-center justify-end gap-2">
        {status === "timedOut" && adjustCeilingsHref && (
          <a href={adjustCeilingsHref} className="text-[11px] text-warning underline decoration-dotted">
            Adjust ceilings ›
          </a>
        )}
        {onViewSummary && (
          <button
            type="button"
            className="rounded-sm border border-border-menu px-2 py-0.5 text-[11px] text-text-body hover:bg-white/[.06]"
            onClick={onViewSummary}
          >
            View summary
          </button>
        )}
      </div>
    </div>
  );
}
