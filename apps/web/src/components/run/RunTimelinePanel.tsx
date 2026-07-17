"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RunSummary, TimelineRow } from "@symbion/core";
import type { RawTailLine } from "@/lib/run/useRunStore";
import { RunLogTail } from "./RunLogTail";
import { RunSummarySection } from "./RunSummarySection";
import { DegradedTelemetryChip, type DegradedReason } from "./DegradedTelemetryChip";

export type TimelineMode = "feed" | "raw" | "summary" | "history";

export interface RunTimelinePanelProps {
  rows: TimelineRow[];
  rawLines: RawTailLine[];
  mode: TimelineMode;
  onModeChange: (mode: TimelineMode) => void;
  summary?: RunSummary;
  waiting: boolean;
  degraded: boolean;
  degradedReason: DegradedReason | null;
  /** node ids/agent-names participating — used to build filter chips. */
  filterOptions: Array<{ id: string; label: string }>;
  filterNodeId: string | null;
  onFilter: (id: string | null) => void;
  onRowClick?: (actor: string | undefined) => void;
  onRerun: () => void;
  onClose: () => void;
  /** F7 (P3) — the project id, threaded to RunSummarySection's [Adjust
   *  ceilings] link destination. */
  projectId?: string;
  /** P3 (STATE §18.1): true while viewing a read-only historical run —
   *  `mode:"history"` behaves exactly like a terminal run's Feed tab MINUS
   *  the live follow/pause toggle (nothing is streaming). Feed/Raw/Summary
   *  tabs remain switchable; the tab bar's active-tab label reads "History"
   *  instead of "Feed" while `mode==="history"`. */
  historyMode?: boolean;
}

function fmtAtMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * RunTimelinePanel — replaces RunLogTail as the mounted panel (P2, design
 * §3.4/§4). Feed (structured rows, filters, follow/pause, row expand) / Raw
 * (P1's RunLogTail, verbatim, demoted to a tab) / Summary (auto-shown on
 * terminal transition, per DependencyGraph's mode-switch logic).
 */
export function RunTimelinePanel({
  rows,
  rawLines,
  mode,
  onModeChange,
  summary,
  waiting,
  degraded,
  degradedReason,
  filterOptions,
  filterNodeId,
  onFilter,
  onRowClick,
  onRerun,
  onClose,
  projectId,
  historyMode = false,
}: RunTimelinePanelProps) {
  // History mode: nothing is streaming, so there is no "follow/pause" state
  // at all — `following` stays permanently false and the footer that
  // exposes it is hidden entirely (design's "no follow/pause toggle present").
  const [following, setFollowing] = useState(!historyMode);
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // `mode==="history"` renders the SAME row list as `"feed"` — history is
  // exactly like a terminal run's Feed tab, minus follow/pause (STATE §18.1).
  const showingRows = mode === "feed" || mode === "history";

  const filteredRows = useMemo(
    () => (filterNodeId ? rows.filter((r) => r.actor === filterNodeId) : rows),
    [rows, filterNodeId]
  );

  useEffect(() => {
    if (!following || historyMode) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filteredRows.length, following, historyMode]);

  function onScroll() {
    if (historyMode) return;
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (!atBottom && following) setFollowing(false);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border-hairline px-2 py-1 text-[11px] text-text-muted">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={mode === "feed" || mode === "history" ? "font-semibold text-text-body" : "hover:text-text-body"}
            onClick={() => onModeChange(historyMode ? "history" : "feed")}
          >
            {mode === "history" ? "History" : "Feed"}
          </button>
          <button
            type="button"
            className={mode === "raw" ? "font-semibold text-text-body" : "hover:text-text-body"}
            onClick={() => onModeChange("raw")}
          >
            [≡ Raw]
          </button>
          {summary && (
            <button
              type="button"
              className={mode === "summary" ? "font-semibold text-text-body" : "hover:text-text-body"}
              onClick={() => onModeChange("summary")}
            >
              Summary
            </button>
          )}
        </div>
        {degraded && degradedReason && <DegradedTelemetryChip reason={degradedReason} />}
      </div>

      {showingRows && (
        <>
          {filterOptions.length > 0 && (
            <div className="flex flex-wrap gap-1 border-b border-border-hairline px-2 py-1">
              <button
                type="button"
                className={`rounded-pill px-2 py-0.5 text-[10px] ${filterNodeId === null ? "bg-brand-accent text-white" : "bg-bg-panel text-text-muted"}`}
                onClick={() => onFilter(null)}
              >
                All
              </button>
              {filterOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`rounded-pill px-2 py-0.5 text-[10px] ${filterNodeId === opt.id ? "bg-brand-accent text-white" : "bg-bg-panel text-text-muted"}`}
                  onClick={() => onFilter(opt.id)}
                >
                  {opt.label} {filterNodeId === opt.id && "✕"}
                </button>
              ))}
            </div>
          )}

          <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed">
            {!historyMode && waiting && filteredRows.length === 0 && (
              <div className="animate-pulse text-text-muted">waiting for the CLI to start streaming…</div>
            )}
            {filteredRows.map((row) => (
              <div key={row.seq}>
                <button
                  type="button"
                  className={`flex w-full gap-2 rounded-sm px-1 text-left hover:bg-bg-panel ${row.depth === 1 ? "ml-4" : ""} ${row.unattributed ? "text-warning" : "text-text-body"}`}
                  onClick={() => {
                    setExpandedSeq((s) => (s === row.seq ? null : row.seq));
                    onRowClick?.(row.actor);
                  }}
                >
                  <span className="shrink-0 tabular-nums text-text-muted">{fmtAtMs(row.atMs)}</span>
                  <span>{row.icon}</span>
                  <span className="break-all">{row.label}</span>
                  {row.tokenDelta !== undefined && row.tokenDelta > 0 && (
                    <span className="ml-auto shrink-0 tabular-nums text-text-muted">+{row.tokenDelta}</span>
                  )}
                </button>
                {expandedSeq === row.seq && row.expandable && (
                  <div className="ml-8 mb-1 rounded-panel border border-border-hairline bg-bg-code p-2 text-[10px] text-text-muted">
                    <p>tool: {row.expandable.tool}</p>
                    <p className="break-all">input: {row.expandable.input}</p>
                    <p>
                      step tokens: in {row.expandable.stepTokens.input} / out {row.expandable.stepTokens.output}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* History mode: nothing is streaming — no follow/pause toggle
              (design's explicit "no follow/pause toggle present" contract). */}
          {!historyMode && (
            <div className="flex items-center justify-between border-t border-border-hairline px-2 py-1 text-[10px] text-text-muted">
              {following ? (
                <span>▼ following</span>
              ) : (
                <button
                  type="button"
                  className="text-text-body"
                  onClick={() => {
                    setFollowing(true);
                    const el = scrollRef.current;
                    if (el) el.scrollTop = el.scrollHeight;
                  }}
                >
                  ⏸ paused — click to resume
                </button>
              )}
            </div>
          )}
        </>
      )}

      {mode === "raw" && <RunLogTail lines={rawLines} waiting={waiting} />}

      {mode === "summary" && summary && (
        <RunSummarySection
          summary={summary}
          onRerun={onRerun}
          onViewFeed={() => onModeChange(historyMode ? "history" : "feed")}
          onClose={onClose}
          projectId={projectId}
        />
      )}
    </div>
  );
}
