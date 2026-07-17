/**
 * graphGeometry — pure anchor-point + bounding-box helpers (self-coded-graph-
 * migration PLAN §9.1 row 8). No DOM reads: every function derives its answer
 * from the same plain `{id, position, width, height}` node shape already
 * flowing through `DependencyGraph.tsx`'s `useMemo` chain (PLAN §9.1.2's
 * "node-rect registry derived from layout data, never DOM-measured").
 */

export interface Point {
  x: number;
  y: number;
}

export interface GeometryNode {
  id: string;
  position: Point;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Source (right-mid) anchor — matches xyflow's `Position.Right` handle
 * placement used by today's `CommandNode`'s source `<Handle>`.
 */
export function sourceAnchor(node: GeometryNode): Point {
  return { x: node.position.x + node.width, y: node.position.y + node.height / 2 };
}

/**
 * Target (left-mid) anchor — matches xyflow's `Position.Left` handle
 * placement used by today's `AgentNode`/`MissingAgentNode`'s target `<Handle>`.
 */
export function targetAnchor(node: GeometryNode): Point {
  return { x: node.position.x, y: node.position.y + node.height / 2 };
}

/** node -> its full rect, for the connect-drag hit-testing registry (PLAN §9.1.2). */
export function nodeRect(node: GeometryNode): Rect {
  return { x: node.position.x, y: node.position.y, width: node.width, height: node.height };
}

/** Point-in-rect test used by `useConnectDrag`'s mouseup handler. */
export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * fitView bounding-box math (PLAN §9.1 row 8 / §9.3 Q1's "scroll-to-fit"
 * replacement for a transform-based fitView). Empty input returns a sane
 * zero-sized default (no NaN/Infinity) — matches today's `fitDisabled` gating
 * at 0 artifacts (`GraphToolbar`'s `fitDisabled={artifacts.length === 0}`),
 * so callers should already be gating the empty case upstream; this is a
 * defensive fallback, not the primary empty-graph guard.
 */
export function boundingBox(nodes: GeometryNode[]): BoundingBox {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + n.width);
    maxY = Math.max(maxY, n.position.y + n.height);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
