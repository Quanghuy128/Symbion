"use client";

import { Handle, Position, type NodeProps } from "reactflow";

export interface AgentNodeData {
  label: string;
  highlighted?: boolean;
  dimmed?: boolean;
}

/** AgentNode — React Flow custom node for agent artifacts (design doc §3.2:
 * violet #a78bfa, right column). Presentational/dumb, same contract as
 * CommandNode. */
export function AgentNode({ data }: NodeProps<AgentNodeData>) {
  return (
    <div
      className="rounded-nav-item px-3 py-2 text-[12.5px] font-medium text-white transition-opacity"
      style={{
        background: "#a78bfa",
        opacity: data.dimmed ? 0.35 : 1,
        boxShadow: data.highlighted ? "0 0 0 2px #e9d5ff" : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-agent" />
      {data.label}
    </div>
  );
}
