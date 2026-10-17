"use client";

import { Play } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RunSummary } from "@symbion/core";
import { Button } from "@/components/ui/button";
import { TokenBreakdownCard } from "./TokenBreakdownCard";

export interface RunSummarySectionProps {
  summary: RunSummary;
  onRerun: () => void;
  /** workflow-agent-run: "← Agents" — pops back to the Agents panel. */
  onBack: () => void;
  onClose: () => void;
  /** optional: a cost-by-node row opens that agent's detail (label = row label). */
  onOpenAgent?: (label: string) => void;
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
export function RunSummarySection({ summary, onRerun, onBack, onClose, projectId, onOpenAgent }: RunSummarySectionProps) {
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
    summary.status === "failed" ? "text-danger-text" : summary.status === "timedOut" ? "text-warning" : "text-ink";

  return (
    <div className="flex h-full flex-col overflow-auto p-3 text-caption">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" className="shrink-0 text-ink-muted hover:text-ink" onClick={onBack}>
          ← Agents
        </button>
        <span className={`truncate font-semibold ${headerColor}`}>Summary — {headerLabel}</span>
      </div>

      <p className="mb-1 text-ink">{fmtDuration(summary.durationMs)} · started {new Date(summary.startedAt).toLocaleTimeString()}</p>

      <div className="my-2 border-t border-line" />

      <p className="mb-1 font-semibold text-ink-muted">COST BY NODE</p>
      <div className="space-y-1">
        {summary.perNode.map((row) => {
          const key = row.label;
          return (
            <div key={key} className="relative">
              <button
                type="button"
                className={`flex w-full items-center justify-between rounded-sm px-1 py-0.5 hover:bg-app ${row.unrecognized ? "text-warning" : "text-ink"}`}
                onMouseEnter={() => setExpandedRow(key)}
                onMouseLeave={() => setExpandedRow((k) => (k === key ? null : k))}
                onClick={onOpenAgent && !row.unrecognized ? () => onOpenAgent(row.label) : undefined}
              >
                <span>
                  {row.unrecognized ? "⚠ unrecognized subagent" : row.label}
                  {onOpenAgent && !row.unrecognized && <span className="text-ink-muted"> ›</span>}
                </span>
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
        <div className="flex items-center justify-between border-t border-line pt-1 font-semibold text-ink">
          <span>total</span>
          <span className="tabular-nums">
            {fmtTok(summary.totals.fresh)} tok · {fmtCost(summary.totals.costUsd)}
          </span>
        </div>
      </div>

      <div className="my-2 border-t border-line" />

      <p className="mb-1 font-semibold text-ink-muted">FILES CHANGED (git)</p>
      {summary.filesChanged === "unavailable" ? (
        <p className="text-ink-muted">unavailable</p>
      ) : summary.filesChanged.length === 0 ? (
        <p className="text-ink-muted">no files changed</p>
      ) : (
        <div className="space-y-0.5">
          {summary.filesChanged.map((f) => (
            <div key={f.path} className="flex items-center justify-between text-ink">
              <span>
                {f.status} {f.path}
              </span>
              {(f.plus !== undefined || f.minus !== undefined) && (
                <span className="tabular-nums text-ink-muted">
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
          <div className="my-2 border-t border-line" />
          <button
            type="button"
            className="mb-1 font-semibold text-danger-text"
            onClick={() => setStderrExpanded((v) => !v)}
          >
            STDERR (last 20 lines) {stderrExpanded ? "▾" : "▸"}
          </button>
          {stderrExpanded && (
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-deep p-2 font-mono text-code-sm text-danger-text">
              {summary.stderrTail}
            </pre>
          )}
        </>
      )}

      {summary.finalMessage && (
        <>
          <div className="my-2 border-t border-line" />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-ink-muted">FINAL MESSAGE</p>
            <button type="button" className="text-ink-muted hover:text-ink" onClick={() => setFinalExpanded((v) => !v)}>
              [{finalExpanded ? "collapse" : "expand"} ▾]
            </button>
          </div>
          <p className={`text-ink ${finalExpanded ? "" : "truncate"}`}>{summary.finalMessage}</p>
        </>
      )}

      {summary.stopReason && (
        <p className="mt-2 text-warning">
          {/* F7 (P3): wired to the Settings→Execution section for this project
           *  (STATE §18.1 — previously inert). */}
          <button
            type="button"
            className="underline decoration-dotted hover:text-warning disabled:cursor-default disabled:opacity-70"
            disabled={!projectId}
            onClick={() => {
              if (projectId) router.push(`/settings?project=${encodeURIComponent(projectId)}#execution`);
            }}
          >
            [Adjust ceilings]
          </button>
        </p>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-line pt-2">
        <Button variant="outline" icon={Play} onClick={onRerun}>
          Run again
        </Button>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
