"use client";

import { Plus } from "lucide-react";
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
 * NOT a connect target (isConnectable=false, E5). Hover reveals a "Create this agent"
 * which turns the phantom into a real agent draft (P7).
 */
export function MissingAgentNode({ data }: MissingAgentNodeProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative flex min-h-10 items-center rounded-lg border-[1.5px] border-dashed border-line-strong bg-transparent px-2.5 text-label text-ink-muted transition-opacity"
      style={{ opacity: data.dimmed ? 0.35 : 1 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <NodeHandle role="target" connectable={false} className="!bg-danger" />
      <span>{data.label}</span>

      {hovered && (
        <button
          type="button"
          data-no-node-drag
          disabled={!data.daemonConnected}
          onClick={(e) => {
            e.stopPropagation();
            data.onCreateAgent?.(data.name);
          }}
          className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded-sm bg-mint-soft px-2 py-1 text-caption font-medium text-mint-text hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
          title={!data.daemonConnected ? "Daemon connection required." : undefined}
        >
          <Plus size={14} strokeWidth={1.6} aria-hidden className="mr-1 inline-block" />
          Create this agent
        </button>
      )}
    </div>
  );
}
