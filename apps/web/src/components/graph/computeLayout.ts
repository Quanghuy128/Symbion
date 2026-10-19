import dagre from "@dagrejs/dagre";

export interface LayoutNodeInput {
  id: string;
  width: number;
  height: number;
  /** Column for an edge-less node: `left` = commands, `right` = agents. Without
   *  it an isolated node goes through dagre, which stacks every edge-less node
   *  in rank 0 — one single column. */
  column?: "left" | "right";
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
const NODESEP = 40;
const RANKSEP = 120;
const MARGIN = 20;

export function computeLayout(
  nodes: LayoutNodeInput[],
  edges: LayoutEdgeInput[]
): Map<string, LayoutPosition> {
  const ids = new Set(nodes.map((n) => n.id));
  const linked = new Set<string>();
  for (const edge of edges) {
    if (ids.has(edge.source) && ids.has(edge.target)) {
      linked.add(edge.source);
      linked.add(edge.target);
    }
  }
  // Edge-less nodes with a column skip dagre and are stacked two-column
  // (commands left, agents right) below the linked part — see placeIsolated.
  const isolated = nodes.filter((n) => n.column && !linked.has(n.id));
  const isolatedIds = new Set(isolated.map((n) => n.id));
  const dagreNodes = nodes.filter((n) => !isolatedIds.has(n.id));

  const positions = layoutWithDagre(dagreNodes, edges);
  placeIsolated(isolated, dagreNodes, positions);
  return positions;
}

function layoutWithDagre(nodes: LayoutNodeInput[], edges: LayoutEdgeInput[]): Map<string, LayoutPosition> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: NODESEP, ranksep: RANKSEP, marginx: MARGIN, marginy: MARGIN });
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

/**
 * Stack edge-less nodes in two columns (left = commands, right = agents),
 * row by row from the top, below whatever dagre already placed. Positions are
 * node centers, same convention as dagre's output.
 */
function placeIsolated(
  isolated: LayoutNodeInput[],
  laidOut: LayoutNodeInput[],
  positions: Map<string, LayoutPosition>
): void {
  if (isolated.length === 0) return;

  const left = isolated.filter((n) => n.column === "left");
  const right = isolated.filter((n) => n.column === "right");
  const leftWidth = Math.max(0, ...left.map((n) => n.width));
  const rightWidth = Math.max(0, ...right.map((n) => n.width));

  // Align the left column with dagre's first rank when there is one.
  let leftX = MARGIN + leftWidth / 2;
  let startY = MARGIN;
  if (laidOut.length > 0) {
    let minLeft = Infinity;
    let maxBottom = -Infinity;
    for (const n of laidOut) {
      const pos = positions.get(n.id);
      if (!pos) continue;
      minLeft = Math.min(minLeft, pos.x - n.width / 2);
      maxBottom = Math.max(maxBottom, pos.y + n.height / 2);
    }
    if (Number.isFinite(minLeft)) {
      leftX = minLeft + leftWidth / 2;
      startY = maxBottom + NODESEP * 2;
    }
  }
  const rightX = leftX + leftWidth / 2 + RANKSEP + rightWidth / 2;

  for (const [column, x] of [
    [left, leftX],
    [right, rightX],
  ] as const) {
    let y = startY;
    for (const n of column) {
      positions.set(n.id, { x, y: y + n.height / 2 });
      y += n.height + NODESEP;
    }
  }
}
