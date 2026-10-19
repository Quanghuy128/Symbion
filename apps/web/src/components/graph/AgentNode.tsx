"use client";

import { useEffect, useRef, useState } from "react";
import { NodeHandle } from "./NodeHandle";
import { NodeMenu } from "./NodeMenu";
import { NodeTokenBadge, type NodeTokenBadgeProps } from "./NodeTokenBadge";
import { Kind } from "@/components/ui/kind";
import { agentRing } from "./nodeRings";

export interface AgentNodeData {
  label: string;
  highlighted?: boolean;
  /** Also reused for the run-engine v1 (P1) participant dim: DependencyGraph
   *  sets `dimmed: !runParticipant` during a mission (design §3.4's "everything
   *  else 35% opacity") — no separate field needed, same visual treatment. */
  dimmed?: boolean;
  /** gates the target handle (design §5 R). */
  connectable?: boolean;
  /** transient accent ring after a successful add (design §4 I). */
  justAdded?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  daemonConnected?: boolean;
  /** P2 (design §3.5): "working" while dispatched-and-streaming; "settled"
   *  once the run/that actor's bucket closed. */
  runStatus?: "idle" | "working" | "settled" | "error";
  /** P2 (design §3.5/§4): roll-up token badge (no agents column). */
  badge?: NodeTokenBadgeProps;
  /** P2 (design §3.7): live ×N dispatch counter — populated from foldState's dispatches. */
  invocations?: { done: number; total?: number };
  /** P2: bumped by DependencyGraph on a timeline feed-row click for this
   *  agent's actor — re-keying replays the one-shot pulse once. */
  runPulseKey?: number;
  /** workflow-agent-run (design §5 / G1): run-panel selection halo, drawn as
   *  a SECOND ring OUTSIDE the status ring so selection never hides status.
   *  "hover" = soft white, "selected" = mint ring. */
  runHalo?: "hover" | "selected";
  /** plain data-bag index signature (unchanged shape from the xyflow-era
   *  `NodeProps<Node<T>>` requirement). */
  [key: string]: unknown;
}

export interface AgentNodeProps {
  data: AgentNodeData;
}

/** AgentNode — agent node (Kind tile carries the kind). Dumb, same contract as CommandNode. */
export function AgentNode({ data }: AgentNodeProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const connectable = data.connectable ?? false;

  const isWorking = data.runStatus === "working";
  const isSettled = data.runStatus === "settled";
  const isError = data.runStatus === "error";

  // P2: one-shot lock-in flash on working -> settled (mirrors CommandNode).
  const wasWorkingRef = useRef(false);
  const [lockIn, setLockIn] = useState(false);
  useEffect(() => {
    if (isWorking) {
      wasWorkingRef.current = true;
    } else if (isSettled && wasWorkingRef.current) {
      wasWorkingRef.current = false;
      setLockIn(true);
      const t = window.setTimeout(() => setLockIn(false), 300);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [isWorking, isSettled]);

  // P2: feed-row-click -> node pulse (design §5), mirrors CommandNode.
  const [rowPulse, setRowPulse] = useState(false);
  const lastPulseKeyRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (data.runPulseKey === undefined || data.runPulseKey === lastPulseKeyRef.current) return;
    lastPulseKeyRef.current = data.runPulseKey;
    setRowPulse(true);
    const t = window.setTimeout(() => setRowPulse(false), 900);
    return () => window.clearTimeout(t);
  }, [data.runPulseKey]);

  return (
    <div
      className={`group relative flex min-h-10 flex-col justify-center rounded-lg border border-line-soft bg-surface px-2.5 text-label text-ink transition-opacity ${
 isWorking ? "animate-glowPulse" : lockIn || rowPulse ? "animate-countLockIn" : ""
 }`}
      style={{
        opacity: data.dimmed ? 0.35 : 1,
        boxShadow: agentRing({
          working: isWorking,
          settled: isSettled,
          error: isError,
          justAdded: data.justAdded,
          highlighted: data.highlighted,
        }),
        transition: "box-shadow .3s ease, opacity .12s ease",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {data.runHalo && (
        <span
          aria-hidden
          data-run-halo={data.runHalo}
          className={`pointer-events-none absolute -inset-[6px] rounded-[20px] border-2 transition-colors duration-100 ${
 data.runHalo === "selected" ? "border-mint" : "border-line-strong"
 }`}
        />
      )}
      <NodeHandle
        role="target"
        connectable={connectable}
        className={connectable ? "!bg-agent" : "!bg-transparent !border !border-line-strong"}
      />

      <span className="flex items-center gap-2 pr-4">
        <Kind kind="agent" size="sm" />
        <span className="min-w-0 truncate">{data.label}</span>
        {data.invocations && data.invocations.total !== undefined && data.invocations.total > 1 && (
          <span className="ml-1 text-overline tabular-nums text-ink-muted">
            {data.invocations.done < data.invocations.total
              ? `${data.invocations.done}/${data.invocations.total}`
              : `✓${data.invocations.total}`}
          </span>
        )}
      </span>

      {data.badge && <NodeTokenBadge {...data.badge} label={data.label} />}

      {(hovered || menuOpen) && (
        <div className="absolute right-1.5 top-1 z-10">
          <NodeMenu
            kind="agent"
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onEdit={() => data.onEdit?.()}
            onDelete={() => data.onDelete?.()}
            deleteDisabled={!data.daemonConnected}
          />
        </div>
      )}
    </div>
  );
}
