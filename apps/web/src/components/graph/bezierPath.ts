/**
 * bezierPath — pure replacement for `@xyflow/react`'s `getBezierPath` /
 * `getBezierEdgeCenter` / `getControlWithCurvature` / `calculateControlOffset`
 * helpers (self-coded-graph-migration PLAN §9.1 row 7 / §9.3 Q5).
 *
 * Fidelity method (STATE §10, baseline SKIPPED — verified ANALYTICALLY, not by
 * screenshot diff): the control-point formula below is a line-for-line port of
 * `@xyflow/system`'s actual source, read directly from
 * `node_modules/@xyflow/system/dist/esm/index.js` (functions
 * `getBezierEdgeCenter`, `calculateControlOffset`, `getControlWithCurvature`,
 * `getBezierPath`, lines ~903-994 as of the installed `@xyflow/react ^12`
 * version), NOT reproduced from memory or the public docs. Every constant
 * (0.125/0.375 Bezier-center weights, the `0.5 * distance` / `curvature * 25 *
 * sqrt(-distance)` control-offset branches, default `curvature = 0.25`) is
 * copied verbatim.
 *
 * Symbion's graph only ever uses `Position.Right` (command source handle) →
 * `Position.Left` (agent/missing-agent target handle) — this file hard-codes
 * that fixed pair (matching `DependencyGraph.tsx`'s existing
 * `Position.Right`/`Position.Left` usage) rather than porting the full
 * 4-position switch, since no other combination is ever produced by
 * `graphGeometry.ts`'s anchor computation.
 */

export interface Point {
  x: number;
  y: number;
}

export interface BezierPathResult {
  /** SVG `<path>` `d` attribute — cubic bezier `M...C...`. */
  path: string;
  labelX: number;
  labelY: number;
}

const DEFAULT_CURVATURE = 0.25;

/** Ported verbatim from `@xyflow/system`'s `calculateControlOffset`. */
function calculateControlOffset(distance: number, curvature: number): number {
  if (distance >= 0) {
    return 0.5 * distance;
  }
  return curvature * 25 * Math.sqrt(-distance);
}

/**
 * bezierPath — source is always `Position.Right` of `sourcePoint`, target is
 * always `Position.Left` of `targetPoint` (Symbion's fixed layout direction,
 * `rankdir: "LR"` — see `computeLayout.ts` / `graphGeometry.ts`).
 */
export function bezierPath(
  sourcePoint: Point,
  targetPoint: Point,
  curvature: number = DEFAULT_CURVATURE
): BezierPathResult {
  const { x: sourceX, y: sourceY } = sourcePoint;
  const { x: targetX, y: targetY } = targetPoint;

  // getControlWithCurvature({ pos: Position.Right, x1: sourceX, y1: sourceY, x2: targetX, y2: targetY, c: curvature })
  const sourceControlX = sourceX + calculateControlOffset(targetX - sourceX, curvature);
  const sourceControlY = sourceY;

  // getControlWithCurvature({ pos: Position.Left, x1: targetX, y1: targetY, x2: sourceX, y2: sourceY, c: curvature })
  const targetControlX = targetX - calculateControlOffset(targetX - sourceX, curvature);
  const targetControlY = targetY;

  // getBezierEdgeCenter — cubic bezier t=0.5 point (not the true arc midpoint).
  const labelX =
    sourceX * 0.125 + sourceControlX * 0.375 + targetControlX * 0.375 + targetX * 0.125;
  const labelY =
    sourceY * 0.125 + sourceControlY * 0.375 + targetControlY * 0.375 + targetY * 0.125;

  const path = `M${sourceX},${sourceY} C${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetX},${targetY}`;

  return { path, labelX, labelY };
}
