"use client";

import { forwardRef, type ReactNode } from "react";
import type { AgentNode, TranscriptRow } from "@symbion/core";
import { AgentDetailHeader } from "./AgentDetailHeader";
import { PromptBlock } from "./PromptBlock";
import { ResultCard } from "./ResultCard";
import { TranscriptList, type TranscriptListHandle } from "./TranscriptList";
import { StatusGlyph } from "./StatusGlyph";
import { fmtDurationWords, fmtTok } from "./format";

export interface BreadcrumbSegment {
  id: string;
  label: string;
}

export interface AgentDetailViewProps {
  agent: AgentNode;
  rows: readonly TranscriptRow[];
  breadcrumb: BreadcrumbSegment[];
  spawnedByLabel: string | null;
  /** streaming: drives follow / pill. */
  live: boolean;
  /** pulses + tickers (false while reconnecting); defaults to `live`. */
  pulsesLive?: boolean;
  readOnly: boolean;
  animate: boolean;
  cancelling?: boolean;
  nowMs: number;
  scrollToRowId?: string | null;
  onBack: () => void;
  onNavigate: (agentId: string) => void;
  /** root only: ≡ → Raw log (S5). */
  onRaw?: () => void;
  /** S4c strip, rendered at the bottom when present. */
  finishedStrip?: ReactNode;
}

/** S4 — one agent's detail: breadcrumb, sticky header, prompt, transcript, result. */
export const AgentDetailView = forwardRef<TranscriptListHandle, AgentDetailViewProps>(function AgentDetailView(
  { agent, rows, breadcrumb, spawnedByLabel, live, pulsesLive, readOnly, animate, cancelling, nowMs, scrollToRowId, onBack, onNavigate, onRaw, finishedStrip },
  ref
) {
  const running = agent.status === "running" || agent.status === "starting";
  const isRoot = agent.kind === "root";
  const settled = !running;
  const durationMs = agent.startedAtMs !== null && agent.endedAtMs !== undefined ? agent.endedAtMs - agent.startedAtMs : null;
  const emptyText = live && running ? "No tool calls yet." : "No tool calls recorded.";

  return (
    <div className="flex h-full min-h-0 flex-col motion-safe:animate-slideIn" data-testid="agent-detail" data-agent-id={agent.id}>
      <div className="flex items-center gap-1 border-b border-border-hairline px-2 py-1 text-[11px] text-text-muted">
        <button type="button" className="shrink-0 rounded-sm px-1 hover:bg-white/[.06] hover:text-text-body" onClick={onBack}>
          ← Agents
        </button>
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 truncate">
          {breadcrumb.map((seg, i) => (
            <span key={seg.id} className="flex min-w-0 items-center gap-1">
              {i > 0 && <span className="text-text-faint">›</span>}
              {i === breadcrumb.length - 1 ? (
                <span className="truncate text-text-body">{seg.label}</span>
              ) : (
                <button type="button" className="truncate hover:text-text-body" onClick={() => onNavigate(seg.id)}>
                  {seg.label}
                </button>
              )}
            </span>
          ))}
        </nav>
        {isRoot && onRaw && (
          <button type="button" aria-label="Raw log" title="Raw log" className="shrink-0 px-1 hover:text-text-body" onClick={onRaw}>
            ≡
          </button>
        )}
      </div>
      <AgentDetailHeader
        agent={agent}
        spawnedByLabel={spawnedByLabel}
        live={pulsesLive ?? live}
        cancelling={cancelling}
        nowMs={nowMs}
        onNavigate={onNavigate}
      />
      <PromptBlock label={isRoot ? "Requirement" : "Prompt"} text={agent.prompt} truncated={agent.promptTruncated} />
      <TranscriptList
        ref={ref}
        rows={rows}
        live={live && running}
        readOnly={readOnly}
        animate={animate}
        onOpenAgent={onNavigate}
        scrollToRowId={scrollToRowId}
        emptyText={emptyText}
        footer={
          settled ? (
            <div className="border-t border-border-hairline">
              <ResultCard result={agent.result} agentErrored={agent.status === "error"} />
              <p className="flex items-center gap-1 px-3 pb-1 text-[10.5px] text-text-muted">
                <StatusGlyph status={agent.status} />
                {agent.status === "done" ? "done" : agent.status} in {fmtDurationWords(durationMs)} · {fmtTok(agent.freshTokens)} tok
              </p>
            </div>
          ) : null
        }
      />
      {finishedStrip}
    </div>
  );
});
