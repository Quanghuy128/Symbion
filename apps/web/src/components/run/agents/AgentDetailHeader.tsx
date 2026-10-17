"use client";

import type { AgentNode } from "@symbion/core";
import { StatusGlyph } from "@/components/ui/status-glyph";
import { LiveDuration } from "./LiveDuration";
import { fmtTok } from "./format";

export interface AgentDetailHeaderProps {
  agent: AgentNode;
  /** display label of the parent agent (null for root / unattributed). */
  spawnedByLabel: string | null;
  live: boolean;
  cancelling?: boolean;
  nowMs: number;
  onNavigate: (agentId: string) => void;
}

const STATUS_WORD: Record<AgentNode["status"], string> = {
  starting: "starting",
  running: "running",
  done: "done",
  error: "error",
  interrupted: "interrupted",
};

/**
 * Sticky agent meta + tickers (design S4). Deliberately has NO stop / cancel
 * affordance (AC-8): the only stop is "■ Stop run" in the status strip / RunBar.
 */
export function AgentDetailHeader({ agent, spawnedByLabel, live, cancelling, nowMs, onNavigate }: AgentDetailHeaderProps) {
  const running = agent.status === "running" || agent.status === "starting";
  const statusWord = cancelling && running ? "stopping…" : STATUS_WORD[agent.status];
  const meta = [agent.agentType, agent.model].filter(Boolean) as string[];
  if (agent.kind === "subagent") meta.push(agent.mode);

  return (
    <div className="sticky top-0 z-10 border-b border-line bg-app px-3 py-1.5 text-caption" data-testid="agent-detail-header">
      <p className="flex items-center gap-1.5">
        <StatusGlyph status={agent.status} live={live && !cancelling} size="md" />
        <span className="font-semibold text-ink">{statusWord}</span>
        {meta.map((m, i) => (
          <span key={i} className={i === 0 ? (agent.kind === "root" ? "text-workflow" : "text-agent") : "text-ink-muted"}>
            · {m}
          </span>
        ))}
      </p>
      <p className="mt-0.5 font-mono tabular-nums text-ink-muted">
        ⏱ <LiveDuration startedAtMs={agent.startedAtMs} endedAtMs={agent.endedAtMs} nowMs={nowMs} ticking={live && running && !cancelling} /> ·{" "}
        <span
          className="text-ink"
          title={`own: in ${agent.usage.input} · out ${agent.usage.output} · cache read ${agent.usage.cacheRead} · cache write ${agent.usage.cacheWrite}`}
        >
          {fmtTok(agent.freshTokens)} tok
        </span>{" "}
        · {agent.toolCount} tool{agent.toolCount === 1 ? "" : "s"}
        {agent.errorCount > 0 && (
          <span className="text-danger-text">
            {" "}
            · {agent.errorCount} error{agent.errorCount === 1 ? "" : "s"}
          </span>
        )}
      </p>
      {agent.spawnedBy && spawnedByLabel && (
        <p className="mt-0.5 text-ink-muted">
          spawned by{" "}
          <button type="button" className="text-ink underline decoration-dotted hover:text-ink" onClick={() => onNavigate(agent.spawnedBy!)}>
            {spawnedByLabel} ›
          </button>
        </p>
      )}
    </div>
  );
}
