"use client";

import { useMemo, useState } from "react";
import ReactFlow, { Background, BackgroundVariant, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import { ADAPTERS, extractAgentMentions, type CanonicalArtifact } from "@symbion/core";
import { CommandNode } from "./graph/CommandNode";
import { AgentNode } from "./graph/AgentNode";
import { MissingAgentNode } from "./graph/MissingAgentNode";
import { AnimatedEdge } from "./graph/AnimatedEdge";
import { GraphStatusChips } from "./graph/GraphStatusChips";

export interface DependencyGraphProps {
  artifacts: CanonicalArtifact[];
}

const nodeTypes = {
  command: CommandNode,
  agent: AgentNode,
  missingAgent: MissingAgentNode,
};

const edgeTypes = {
  animated: AnimatedEdge,
};

/** S6 — read-only dependency graph (React Flow). No node creation / edge dragging (locked decision). */
export function DependencyGraph({ artifacts }: DependencyGraphProps) {
  // Hover state: id of the currently-hovered real node (commands/agents only —
  // missing-agent placeholders are not interactive per design doc §3.2).
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { nodes: baseNodes, edges: baseEdges, missingAgentMentions } = useMemo(() => {
    const agents = artifacts.filter((a) => a.kind === "agent");
    const commands = artifacts.filter((a) => a.kind === "command");

    const nodes: Node[] = [
      ...commands.map((c, i) => ({
        id: c.id,
        type: "command",
        position: { x: 0, y: i * 80 },
        data: { label: `/${c.name}` },
      })),
      ...agents.map((a, i) => ({
        id: a.id,
        type: "agent",
        position: { x: 320, y: i * 80 },
        data: { label: a.name },
      })),
    ];

    const agentByName = new Map(agents.map((a) => [a.name, a]));
    const edges: Edge[] = [];
    // Track missing-agent placeholder nodes so dangling-mention edges (E7)
    // actually have a target node to render against — React Flow silently
    // drops edges whose target id has no matching node.
    const missingNodes = new Map<string, Node>();
    const missingMentions = new Set<string>();
    let missingIndex = 0;
    let drawIndex = 0;
    for (const command of commands) {
      for (const mention of extractAgentMentions(command.body)) {
        const target = agentByName.get(mention);
        const missingId = `missing-${mention}`;
        if (!target) {
          missingMentions.add(mention);
          if (!missingNodes.has(missingId)) {
            missingNodes.set(missingId, {
              id: missingId,
              type: "missingAgent",
              position: { x: 320, y: (agents.length + missingIndex) * 80 },
              data: { label: `⚠ ${mention} (không tồn tại)` },
            });
            missingIndex += 1;
          }
        }
        edges.push({
          id: `${command.id}->${mention}`,
          source: command.id,
          target: target?.id ?? missingId,
          type: "animated",
          animated: !target,
          data: { drawIndex: drawIndex++, missing: !target },
        });
      }
    }

    return {
      nodes: [...nodes, ...missingNodes.values()],
      edges,
      missingAgentMentions: [...missingMentions],
    };
  }, [artifacts]);

  // Hover-driven highlight/dim (design doc §3.2 richness ceiling): hovering a
  // node highlights its connected edges (accent-text-hi, thicker stroke) and
  // dims unrelated edges to ~35% opacity. No node scale/lift/popovers — capped
  // deliberately, per Q9. Nodes themselves stay dumb/presentational; the
  // highlighted/dimmed flags are computed here and passed down as data.
  const nodes = useMemo(
    () =>
      baseNodes.map((n) => {
        if (!hoveredId) return n;
        const connected =
          n.id === hoveredId ||
          baseEdges.some(
            (e) => (e.source === hoveredId && e.target === n.id) || (e.target === hoveredId && e.source === n.id)
          );
        return { ...n, data: { ...n.data, highlighted: n.id === hoveredId, dimmed: !connected } };
      }),
    [baseNodes, baseEdges, hoveredId]
  );

  const edges = useMemo(
    () =>
      baseEdges.map((e) => {
        if (!hoveredId) return e;
        const connected = e.source === hoveredId || e.target === hoveredId;
        return { ...e, data: { ...e.data, highlighted: connected, dimmed: !connected } };
      }),
    [baseEdges, hoveredId]
  );

  return (
    <div>
      <GraphStatusChips
        claudeLossy={ADAPTERS.claude.capability.lossy}
        codexLossy={ADAPTERS.codex.capability.lossy}
        missingAgentMentions={missingAgentMentions}
      />
      <div style={{ height: 480 }} className="rounded-panel border border-border-hairline bg-bg-panel">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          fitView
          onNodeMouseEnter={(_, node) => setHoveredId(node.id)}
          onNodeMouseLeave={() => setHoveredId(null)}
        >
          <Background variant={BackgroundVariant.Dots} />
        </ReactFlow>
      </div>
    </div>
  );
}
