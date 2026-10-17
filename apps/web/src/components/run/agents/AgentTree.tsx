"use client";

import { memo, useState } from "react";
import type { AgentNode } from "@symbion/core";
import { useThrottledValue } from "@/lib/run/useNow";
import { StatusGlyph } from "@/components/ui/status-glyph";
import { LiveDuration } from "./LiveDuration";
import { TokenBreakdownCard } from "../TokenBreakdownCard";
import { fmtTok } from "./format";

/** Visual indent cap (design S2: +12px/level, cap 3 then "↳ +n"). */
export const MAX_INDENT_DEPTH = 3;

export interface AgentTreeRowProps {
  agent: AgentNode;
  depth: number;
  selected: boolean;
  focused: boolean;
  live: boolean;
  isNew: boolean;
  nowMs: number;
  /** "stopping…" state: glyphs static. */
  cancelling?: boolean;
  onOpen: (id: string) => void;
  onHover: (id: string | null) => void;
  onFocusRow?: (id: string) => void;
}

function statusLine(agent: AgentNode): { text: string; errors: boolean } | null {
  if (agent.status === "interrupted") return { text: "interrupted", errors: false };
  if (agent.status === "running" || agent.status === "starting") return null;
  const tools = `${agent.toolCount} tool${agent.toolCount === 1 ? "" : "s"}`;
  return { text: tools, errors: agent.errorCount > 0 };
}

export const AgentTreeRow = memo(function AgentTreeRow({
  agent,
  depth,
  selected,
  focused,
  live,
  isNew,
  nowMs,
  cancelling,
  onOpen,
  onHover,
  onFocusRow,
}: AgentTreeRowProps) {
  const [tokHover, setTokHover] = useState(false);
  const running = agent.status === "running" || agent.status === "starting";
  const nowDoing = useThrottledValue(running && live ? agent.nowDoing ?? (agent.status === "starting" ? "starting…" : undefined) : undefined, 250);
  const indentLevels = Math.min(depth, MAX_INDENT_DEPTH);
  const overflow = depth - MAX_INDENT_DEPTH;
  const isRoot = agent.kind === "root";
  const notOnGraph = agent.kind === "subagent" && agent.graphKey === null;
  const sl = statusLine(agent);
  const ticking = live && running && !cancelling;

  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-level={depth + 1}
      data-agent-id={agent.id}
      className={`relative cursor-pointer border-l-2 px-2 py-1 text-caption ${
 selected ? "border-l-mint bg-mint-soft" : "border-l-transparent hover:bg-surface-hover"
 } ${focused ? "outline outline-1 outline-focus-ring" : ""} ${isNew ? "motion-safe:animate-fadeIn" : ""}`}
      style={{ paddingLeft: 8 + indentLevels * 12 }}
      onClick={() => onOpen(agent.id)}
      onMouseEnter={() => {
        onFocusRow?.(agent.id);
        // Not-on-graph agents have no node to light up (W-13).
        if (agent.graphKey !== null) onHover(agent.id);
      }}
      onMouseLeave={() => {
        if (agent.graphKey !== null) onHover(null);
      }}
    >
      <div className="flex items-center gap-1.5">
        {overflow > 0 && <span className="shrink-0 text-overline text-ink-muted">↳ +{overflow}</span>}
        <StatusGlyph status={agent.status} live={live && !cancelling} size="md" />
        {isRoot ? (
          <>
            <span className="truncate font-semibold text-workflow">{agent.agentType}</span>
            {agent.model && <span className="shrink-0 truncate text-overline text-ink-muted">{agent.model}</span>}
          </>
        ) : (
          <>
            <span className={`shrink-0 font-semibold ${agent.kind === "unattributed" ? "text-warning" : "text-agent"}`}>{agent.agentType}</span>
            {agent.description && (
              <span className="min-w-0 truncate text-ink" title={agent.description}>
                {agent.description}
              </span>
            )}
            {notOnGraph && (
              <span className="shrink-0 rounded-pill bg-surface-hover px-1.5 text-overline text-ink-muted">not on graph</span>
            )}
          </>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-overline text-ink-muted">
          <LiveDuration startedAtMs={agent.startedAtMs} endedAtMs={agent.endedAtMs} nowMs={nowMs} ticking={ticking} />
          <span
            className="relative font-mono tabular-nums text-ink"
            onMouseEnter={() => setTokHover(true)}
            onMouseLeave={() => setTokHover(false)}
          >
            {agent.status === "starting" && agent.freshTokens === 0 ? "—" : fmtTok(agent.freshTokens)}
            {tokHover && agent.freshTokens > 0 && (
              <span className="absolute right-0 top-full z-30">
                <TokenBreakdownCard label={isRoot ? agent.agentType : agent.description ?? agent.agentType} live={live} own={agent.usage} />
              </span>
            )}
          </span>
        </span>
      </div>
      {(nowDoing || sl) && (
        <div className="mt-0.5 truncate pl-5 text-overline text-ink-muted" title={nowDoing ?? undefined}>
          {nowDoing ? (
            nowDoing
          ) : sl ? (
            <>
              {sl.text}
              {sl.errors && (
                <span className="text-danger-text">
                  {" "}
                  · {agent.errorCount} error{agent.errorCount === 1 ? "" : "s"}
                </span>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
});

export interface AgentTreeProps {
  root: AgentNode;
  selectedAgentId: string | null;
  focusedAgentId: string | null;
  live: boolean;
  nowMs: number;
  cancelling?: boolean;
  /** ids rendered in a previous frame (for live fade-in of new rows). */
  newIds?: ReadonlySet<string>;
  onOpen: (id: string) => void;
  onHover: (id: string | null) => void;
  onFocusRow?: (id: string) => void;
}

/** Depth-first order of the visible tree rows (keyboard ↑/↓). */
export function flattenTree(root: AgentNode): Array<{ agent: AgentNode; depth: number }> {
  const out: Array<{ agent: AgentNode; depth: number }> = [];
  const walk = (n: AgentNode, depth: number) => {
    out.push({ agent: n, depth });
    for (const c of n.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return out;
}

/** S1–S3 tree: root, then subagents recursively in spawn order (never re-sorted). */
export function AgentTree({ root, selectedAgentId, focusedAgentId, live, nowMs, cancelling, newIds, onOpen, onHover, onFocusRow }: AgentTreeProps) {
  const rows = flattenTree(root);
  return (
    <div role="tree" aria-label="Agents">
      {rows.map(({ agent, depth }) => (
        <AgentTreeRow
          key={agent.id}
          agent={agent}
          depth={depth}
          selected={agent.id === selectedAgentId}
          focused={agent.id === focusedAgentId}
          live={live}
          isNew={newIds?.has(agent.id) ?? false}
          nowMs={nowMs}
          cancelling={cancelling}
          onOpen={onOpen}
          onHover={onHover}
          onFocusRow={onFocusRow}
        />
      ))}
      {root.status === "starting" && root.children.length === 0 && (
        <p className="px-3 py-2 text-caption text-ink-muted motion-safe:animate-pulse">Waiting for the CLI to start streaming…</p>
      )}
      {root.status !== "starting" && root.children.length === 0 && (
        <p className="px-3 py-1.5 text-caption text-ink-muted">No subagents spawned.</p>
      )}
    </div>
  );
}
