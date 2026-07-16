"use client";

import { useEffect, useRef, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { NodeMenu } from "./NodeMenu";
import { NodeTokenBadge, type NodeTokenBadgeProps } from "./NodeTokenBadge";

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
  /** @xyflow/react v12's `NodeProps<Node<T>>` requires `data` to satisfy
   *  `Record<string, unknown>` — an index signature, no shape change. */
  [key: string]: unknown;
}

/** AgentNode — agent node (design §3.2: violet #a78bfa). Dumb, same contract as CommandNode. */
export function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
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
      className={`group relative rounded-nav-item px-3 py-2 text-[12.5px] font-medium text-white transition-opacity ${
        isWorking ? "animate-glowPulse" : lockIn || rowPulse ? "animate-countLockIn" : ""
      }`}
      style={{
        background: "#a78bfa",
        opacity: data.dimmed ? 0.35 : 1,
        boxShadow: isWorking
          ? "0 0 0 2px #22d3ee"
          : isSettled
            ? "0 0 0 2px #4ade80"
            : isError
              ? "0 0 0 2px #f87171"
              : data.justAdded
                ? "0 0 0 3px #6366f1"
                : data.highlighted
                  ? "0 0 0 2px #e9d5ff"
                  : undefined,
        transition: "box-shadow .3s ease, opacity .12s ease",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={connectable}
        className={connectable ? "!bg-agent" : "!bg-transparent !border !border-white/40"}
      />

      <span className="pr-4">
        {data.label}
        {data.invocations && data.invocations.total !== undefined && data.invocations.total > 1 && (
          <span className="ml-1 text-[10px] tabular-nums text-white/70">
            {data.invocations.done < data.invocations.total
              ? `${data.invocations.done}/${data.invocations.total}`
              : `✓${data.invocations.total}`}
          </span>
        )}
      </span>

      {data.badge && <NodeTokenBadge {...data.badge} label={data.label} />}

      {(hovered || menuOpen) && (
        <div className="absolute -right-1 -top-1 z-10">
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
