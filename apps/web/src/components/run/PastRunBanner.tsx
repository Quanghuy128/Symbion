"use client";

import type { RunInfo } from "@symbion/rpc-types";

export interface PastRunBannerProps {
  run: RunInfo;
  /** 1-based position in the project's run history (newest = highest number),
   *  or undefined if not resolved yet — omitted from the label in that case. */
  index?: number;
  onExit: () => void;
  onRerun: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  starting: "starting",
  running: "running",
  cancelling: "cancelling",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  timedOut: "stopped",
};

function fmtDuration(run: RunInfo): string | null {
  if (!run.endedAt) return null;
  const ms = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * PastRunBanner — shown above the mission chrome while browsing a historical
 * run read-only (design §3.10 R6). The ONLY new visual element for history
 * mode — everything else (graph re-lighting, timeline panel) is the EXISTING
 * mission-mode rendering path, fed frozen/replayed data (STATE §18.1). Warning-
 * tinted so "am I live?" is never ambiguous.
 */
export function PastRunBanner({ run, index, onExit, onRerun }: PastRunBannerProps) {
  const duration = fmtDuration(run);
  const dateLabel = new Date(run.startedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex items-center justify-between border-b border-warning/40 bg-warning/10 px-3 py-2 text-xs">
      <span className="flex items-center gap-2 text-warning">
        <span>🕘 VIEWING PAST RUN{index !== undefined ? ` · #${index}` : ""} · {dateLabel}</span>
        <span className="text-text-body">
          {STATUS_LABEL[run.status] ?? run.status}
          {duration ? ` · ${duration}` : ""}
        </span>
        <span className="font-semibold">· read-only</span>
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-sm px-2 py-1 text-text-body hover:bg-white/[.06]"
          onClick={onRerun}
        >
          ▶ Run again
        </button>
        <button
          type="button"
          className="rounded-sm px-2 py-1 text-text-body hover:bg-white/[.06]"
          onClick={onExit}
        >
          Exit history
        </button>
      </span>
    </div>
  );
}
