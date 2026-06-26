"use client";

import { useMemo } from "react";
import ReactFlow, { Background, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import { extractAgentMentions, type CanonicalArtifact } from "@symbion/core";

export interface DependencyGraphProps {
  artifacts: CanonicalArtifact[];
}

/** S6 — read-only dependency graph (React Flow). No node creation / edge dragging (locked decision). */
export function DependencyGraph({ artifacts }: DependencyGraphProps) {
  const { nodes, edges } = useMemo(() => {
    const agents = artifacts.filter((a) => a.kind === "agent");
    const commands = artifacts.filter((a) => a.kind === "command");

    const nodes: Node[] = [
      ...commands.map((c, i) => ({
        id: c.id,
        position: { x: 0, y: i * 80 },
        data: { label: `/${c.name}` },
        style: { background: "#6366f1", color: "white", borderRadius: 8 },
      })),
      ...agents.map((a, i) => ({
        id: a.id,
        position: { x: 320, y: i * 80 },
        data: { label: a.name },
        style: { background: "#8b5cf6", color: "white", borderRadius: 8 },
      })),
    ];

    const agentByName = new Map(agents.map((a) => [a.name, a]));
    const edges: Edge[] = [];
    // Track missing-agent placeholder nodes so dangling-mention edges (E7)
    // actually have a target node to render against — React Flow silently
    // drops edges whose target id has no matching node.
    const missingNodes = new Map<string, Node>();
    let missingIndex = 0;
    for (const command of commands) {
      for (const mention of extractAgentMentions(command.body)) {
        const target = agentByName.get(mention);
        const missingId = `missing-${mention}`;
        if (!target && !missingNodes.has(missingId)) {
          missingNodes.set(missingId, {
            id: missingId,
            position: { x: 320, y: (agents.length + missingIndex) * 80 },
            data: { label: `⚠ ${mention} (không tồn tại)` },
            style: {
              background: "#fee2e2",
              color: "#991b1b",
              border: "1px dashed #ef4444",
              borderRadius: 8,
            },
          });
          missingIndex += 1;
        }
        edges.push({
          id: `${command.id}->${mention}`,
          source: command.id,
          target: target?.id ?? missingId,
          label: target ? undefined : `⚠ ${mention} (không tồn tại)`,
          style: target ? undefined : { stroke: "#ef4444" },
          animated: !target,
        });
      }
    }

    return { nodes: [...nodes, ...missingNodes.values()], edges };
  }, [artifacts]);

  return (
    <div style={{ height: 480 }} className="rounded border border-border">
      <ReactFlow nodes={nodes} edges={edges} nodesDraggable={false} nodesConnectable={false} fitView>
        <Background />
      </ReactFlow>
    </div>
  );
}
