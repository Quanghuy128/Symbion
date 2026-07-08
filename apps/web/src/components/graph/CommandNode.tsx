"use client";

import { Handle, Position, type NodeProps } from "reactflow";

export interface CommandNodeData {
  label: string;
  highlighted?: boolean;
  dimmed?: boolean;
}

/**
 * CommandNode — React Flow custom node for /command artifacts (design doc
 * §3.2: indigo #818cf8, left column). Presentational/dumb — hover-highlight
 * state (`highlighted`/`dimmed`) is computed in DependencyGraph, not here.
 * No node scale/lift on hover (Q9's explicit "no" list) — only opacity.
 */
export function CommandNode({ data }: NodeProps<CommandNodeData>) {
  return (
    <div
      className="rounded-nav-item px-3 py-2 text-[12.5px] font-medium text-white transition-opacity"
      style={{
        background: "#818cf8",
        opacity: data.dimmed ? 0.35 : 1,
        boxShadow: data.highlighted ? "0 0 0 2px #c7d2fe" : undefined,
      }}
    >
      <Handle type="source" position={Position.Right} className="!bg-command" />
      {data.label}
    </div>
  );
}
