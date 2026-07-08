"use client";

import { Handle, Position, type NodeProps } from "reactflow";

export interface MissingAgentNodeData {
  label: string;
  dimmed?: boolean;
}

/**
 * MissingAgentNode — placeholder node for a dangling `@mention` with no
 * matching agent (unchanged detection logic from DependencyGraph's existing
 * `missingNodes` map — only presentation is new). Dashed danger border, not
 * interactive beyond a tooltip (design doc §3.2), no hover-highlight state
 * (only real nodes participate in the highlight/dim treatment).
 */
export function MissingAgentNode({ data }: NodeProps<MissingAgentNodeData>) {
  return (
    <div
      title={data.label}
      className="rounded-nav-item border border-dashed border-danger bg-danger/10 px-3 py-2 text-[12.5px] font-medium text-danger-hi transition-opacity"
      style={{ opacity: data.dimmed ? 0.35 : 1 }}
    >
      <Handle type="target" position={Position.Left} className="!bg-danger" />
      {data.label}
    </div>
  );
}
