import dagre from "@dagrejs/dagre";

export interface LayoutNodeInput {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdgeInput {
  source: string;
  target: string;
}

export interface LayoutPosition {
  x: number;
  y: number;
}

/**
 * computeLayout — pure wrapper around `@dagrejs/dagre`'s synchronous layered
 * (Sugiyama) layout. Deliberately React/React-Flow-agnostic (plain object
 * in/out) so it's unit-testable without any DOM/React Flow types — see
 * graph-lib-v12-and-layout-upgrade-STATE.md PLAN §1.2/§3.
 *
 * `rankdir: "LR"` gives commands-left / agents-right, matching the existing
 * two-column mental model (just with real cross-minimization instead of the
 * previous naive `i*80` vertical stack).
 */
export function computeLayout(
  nodes: LayoutNodeInput[],
  edges: LayoutEdgeInput[]
): Map<string, LayoutPosition> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 120, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: node.width, height: node.height });
  }
  for (const edge of edges) {
    // Guard against edges referencing an id not present in `nodes` — dagre
    // throws on setEdge for an unregistered node, defensively skip (should
    // never happen since callers always include every referenced node/synthetic
    // missing-agent node, per PLAN §4.3).
    if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positions = new Map<string, LayoutPosition>();
  for (const node of nodes) {
    const laidOut = g.node(node.id);
    positions.set(node.id, laidOut ? { x: laidOut.x, y: laidOut.y } : { x: 0, y: 0 });
  }
  return positions;
}
