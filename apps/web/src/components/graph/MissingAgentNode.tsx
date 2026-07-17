"use client";

import { useState } from "react";
import { NodeHandle } from "./NodeHandle";

export interface MissingAgentNodeData {
  label: string;
  /** the dangling mention name (used to pre-name the created agent, P7). */
  name: string;
  dimmed?: boolean;
  /** create-agent action (design §4 G) — supplied by DependencyGraph. */
  onCreateAgent?: (name: string) => void;
  /** disable the create action when daemon is down (design §5 R). */
  daemonConnected?: boolean;
  /** plain data-bag index signature (unchanged shape from the xyflow-era
   *  `NodeProps<Node<T>>` requirement). */
  [key: string]: unknown;
}

export interface MissingAgentNodeProps {
  data: MissingAgentNodeData;
}

/**
 * MissingAgentNode — placeholder for a dangling `@mention` (design §3.2 state 3).
 * NOT a connect target (isConnectable=false, E5). Hover reveals "＋ Create this agent"
 * which turns the phantom into a real agent draft (P7).
 */
export function MissingAgentNode({ data }: MissingAgentNodeProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative rounded-nav-item border border-dashed border-danger bg-danger/10 px-3 py-2 text-[12.5px] font-medium text-danger-hi transition-opacity"
      style={{ opacity: data.dimmed ? 0.35 : 1 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <NodeHandle role="target" connectable={false} className="!bg-danger" />
      <span>{data.label}</span>

      {hovered && (
        <button
          type="button"
          disabled={!data.daemonConnected}
          onClick={(e) => {
            e.stopPropagation();
            data.onCreateAgent?.(data.name);
          }}
          className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded-sm bg-brand-accent-soft px-2 py-1 text-[11px] font-medium text-accent-text hover:bg-brand-accent-soft/80 disabled:cursor-not-allowed disabled:opacity-40"
          title={!data.daemonConnected ? "Daemon connection required." : undefined}
        >
          ＋ Create this agent
        </button>
      )}
    </div>
  );
}
