"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RunSummary } from "@symbion/core";
import { Button } from "@/components/ui/button";
import { TokenBreakdownCard } from "./TokenBreakdownCard";

export interface RunSummarySectionProps {
  summary: RunSummary;
  onRerun: () => void;
  onViewFeed: () => void;
  onClose: () => void;
  /** P3 (F7, STATE §18.1): the project this run belongs to — destination for
   *  the [Adjust ceilings] link (`/settings?project=<id>#execution`). Absent
   *  in any context that predates F7's wiring keeps the link inert (never a
   *  broken navigation to an empty query param). */
  projectId?: string;
}

function fmtTok(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function fmtCost(costUsd: number | undefined): string {
  return costUsd !== undefined ? `~$${costUsd.toFixed(2)}` : "—";
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * RunSummarySection — the post-run Summary tab (design §3.9): cost-by-node
 * table, FILES CHANGED via git, FINAL MESSAGE, STDERR tail (failed only),
 * [Adjust ceilings]/[change] links rendered INERT (F7 — P3 wires them).
 */
export function RunSummarySection({ summary, onRerun, onViewFeed, onClose, projectId }: RunSummarySectionProps) {
  const router = useRouter();
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [finalExpanded, setFinalExpanded] = useState(false);
  const [stderrExpanded, setStderrExpanded] = useState(false);

  const headerLabel =
    summary.status === "completed"
      ? "✓ completed"
      : summary.status === "failed"
        ? `✗ FAILED — exit ${summary.exitCode ?? "?"}`
        : summary.status === "cancelled"
          ? "◼ CANCELLED"
          : summary.status === "timedOut"
            ? `⚠ STOPPED — ${summary.stopReason === "tokenCap" ? "token cap" : "30 min ceiling"} reached`
            : summary.status;

  const headerColor =
    summary.status === "failed" ? "text-danger" : summary.status === "timedOut" ? "text-warning" : "text-text-body";

  return (
    <div className="flex h-full flex-col overflow-auto p-3 text-[11px]">
      <div className="mb-2 flex items-center justify-between">
        <span className={`font-semibold ${headerColor}`}>SUMMARY — {headerLabel}</span>
        <button type="button" className="text-text-muted hover:text-text-body" onClick={onViewFeed}>
          [Feed]
        </button>
      </div>

      <p className="mb-1 text-text-body">{fmtDuration(summary.durationMs)} · started {new Date(summary.startedAt).toLocaleTimeString()}</p>

      <div className="my-2 border-t border-border-hairline" />

      <p className="mb-1 font-semibold text-text-muted">COST BY NODE</p>
      <div className="space-y-1">
        {summary.perNode.map((row) => {
          const key = row.label;
          return (
            <div key={key} className="relative">
              <button
                type="button"
                className={`flex w-full items-center justify-between rounded-sm px-1 py-0.5 hover:bg-bg-panel ${row.unrecognized ? "text-warning" : "text-text-body"}`}
                onMouseEnter={() => setExpandedRow(key)}
                onMouseLeave={() => setExpandedRow((k) => (k === key ? null : k))}
              >
                <span>{row.unrecognized ? "⚠ unrecognized subagent" : row.label}</span>
                <span className="tabular-nums">
                  {fmtTok(row.ownFresh)} / {fmtTok(row.totalFresh)} · {fmtCost(row.costUsd)}
                </span>
              </button>
              {expandedRow === key && (
                <div className="absolute left-1/2 top-full z-20 -translate-x-1/2">
                  <TokenBreakdownCard
                    label={row.label}
                    live={false}
                    own={{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }}
                    costUsd={row.costUsd}
                  />
                </div>
              )}
            </div>
          );
        })}
        <div className="flex items-center justify-between border-t border-border-hairline pt-1 font-semibold text-text-strong">
          <span>total</span>
          <span className="tabular-nums">
            {fmtTok(summary.totals.fresh)} tok · {fmtCost(summary.totals.costUsd)}
          </span>
        </div>
      </div>

      <div className="my-2 border-t border-border-hairline" />

      <p className="mb-1 font-semibold text-text-muted">FILES CHANGED (git)</p>
      {summary.filesChanged === "unavailable" ? (
        <p className="text-text-faint">unavailable</p>
      ) : summary.filesChanged.length === 0 ? (
        <p className="text-text-faint">no files changed</p>
      ) : (
        <div className="space-y-0.5">
          {summary.filesChanged.map((f) => (
            <div key={f.path} className="flex items-center justify-between text-text-body">
              <span>
                {f.status} {f.path}
              </span>
              {(f.plus !== undefined || f.minus !== undefined) && (
                <span className="tabular-nums text-text-muted">
                  +{f.plus ?? 0} −{f.minus ?? 0}
                </span>
              )}
            </div>
          ))}
          {summary.filesChanged.some((f) => f.preDirty) && (
            <p className="mt-1 text-warning">
              ⚠ includes {summary.filesChanged.filter((f) => f.preDirty).length} file(s) dirty before the run
              (the agent&apos;s writes, not Symbion&apos;s — review before you commit)
            </p>
          )}
        </div>
      )}

      {summary.status === "failed" && summary.stderrTail && (
        <>
          <div className="my-2 border-t border-border-hairline" />
          <button
            type="button"
            className="mb-1 font-semibold text-danger"
            onClick={() => setStderrExpanded((v) => !v)}
          >
            STDERR (last 20 lines) {stderrExpanded ? "▾" : "▸"}
          </button>
          {stderrExpanded && (
            <pre className="whitespace-pre-wrap break-all rounded-panel bg-bg-code p-2 text-[10px] text-danger">
              {summary.stderrTail}
            </pre>
          )}
        </>
      )}

      {summary.finalMessage && (
        <>
          <div className="my-2 border-t border-border-hairline" />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-text-muted">FINAL MESSAGE</p>
            <button type="button" className="text-text-muted hover:text-text-body" onClick={() => setFinalExpanded((v) => !v)}>
              [{finalExpanded ? "collapse" : "expand"} ▾]
            </button>
          </div>
          <p className={`text-text-body ${finalExpanded ? "" : "truncate"}`}>{summary.finalMessage}</p>
        </>
      )}

      {summary.stopReason && (
        <p className="mt-2 text-warning">
          {/* F7 (P3): wired to the Settings→Execution section for this project
           *  (STATE §18.1 — previously inert). */}
          <button
            type="button"
            className="underline decoration-dotted hover:text-warning/80 disabled:cursor-default disabled:opacity-70"
            disabled={!projectId}
            onClick={() => {
              if (projectId) router.push(`/settings?project=${encodeURIComponent(projectId)}#execution`);
            }}
          >
            [Adjust ceilings]
          </button>
        </p>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-border-hairline pt-2">
        <Button variant="outline" onClick={onRerun}>
          ▶ Run again
        </Button>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
