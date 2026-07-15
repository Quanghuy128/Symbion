"use client";

import { useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { NodeMenu } from "./NodeMenu";

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
}

/** AgentNode — agent node (design §3.2: violet #a78bfa). Dumb, same contract as CommandNode. */
export function AgentNode({ data }: NodeProps<AgentNodeData>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const connectable = data.connectable ?? false;

  return (
    <div
      className="group relative rounded-nav-item px-3 py-2 text-[12.5px] font-medium text-white transition-opacity"
      style={{
        background: "#a78bfa",
        opacity: data.dimmed ? 0.35 : 1,
        boxShadow: data.justAdded
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

      <span className="pr-4">{data.label}</span>

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
