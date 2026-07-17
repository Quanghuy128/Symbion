"use client";

import { bezierPath, type Point } from "./bezierPath";
import type { EdgeInteractionState } from "./useEdgeInteraction";

export interface AnimatedEdgeData {
  drawIndex?: number;
  /** Missing-agent dangling-mention edge — dashed danger + built-in `animated`. No +/× (design §3.3 #3). */
  missing?: boolean;
  highlighted?: boolean;
  dimmed?: boolean;
  /** interactive-graph: relationship metadata decorating this edge (from parseAgentBlock). */
  count?: number;
  goal?: string;
  /** true when the edge supports +/× (non-missing AND daemon connected). */
  interactive?: boolean;
  /** clicked/selected edge → toolbar pinned (design §3.3 #5). */
  selected?: boolean;
  /** in-flight ghost during a pending save (design §5 Q) — dashed faint + spinner, no toolbar. */
  pending?: boolean;
  onOpenModal?: () => void;
  onDelete?: () => void;
  /** P2 (design §3.5): edge current state. "off" = not flowing (pre-dispatch
   *  or non-participant); "flowing" = an active dispatch is streaming;
   *  "settled" = that dispatch's actor bucket closed — flow stops, stroke
   *  stays tinted 60% until run end. */
  runFlow?: "off" | "flowing" | "settled";
  [key: string]: unknown;
}

export interface GraphEdgePathProps {
  id: string;
  sourcePoint: Point;
  targetPoint: Point;
  data?: AnimatedEdgeData;
  interaction: EdgeInteractionState;
}

/**
 * GraphEdgePath — self-coded replacement for `AnimatedEdge.tsx` (PLAN §9.1
 * row 3 / §4.1). **SVG-ONLY**: returns exclusively `<path>` elements, valid
 * as a JSX child of `<svg><g>`.
 *
 * REVIEW round-1 blocker fix (STATE §12/§13): the badge/toolbar/delete-
 * confirm `<div>` previously rendered here as a sibling of these `<path>`
 * elements, which put it under an `<svg>` ancestor and created it in the SVG
 * XML namespace (not HTML) — `position: absolute`/Tailwind classes/box-model
 * layout never applied in a real browser. That HTML content now lives in
 * `GraphEdgeLabel.tsx`, rendered by `GraphCanvas` as a plain sibling of the
 * `<svg>` edge layer (the existing HTML node layer), positioned via the same
 * `labelX`/`labelY` values `bezierPath` returns here. Hover/delete-confirm/
 * draw-in state is shared between the two halves via `useEdgeInteraction`,
 * instantiated ONCE per edge by `GraphCanvas` and passed to both as the
 * `interaction` prop — this component does not own that state itself
 * anymore (moved out so the same instance can be read by `GraphEdgeLabel`).
 */
export function GraphEdgePath({ id, sourcePoint, targetPoint, data, interaction }: GraphEdgePathProps) {
  const { path: edgePath } = bezierPath(sourcePoint, targetPoint);

  const { drawn, onHoverEnter, onHoverLeave } = interaction;

  const pending = data?.pending ?? false;
  const runFlow = data?.runFlow;
  const isFlowing = runFlow === "flowing";
  const isSettled = runFlow === "settled";
  const baseColor = pending
    ? "#565c68"
    : data?.missing
      ? "#f87171"
      : isFlowing || isSettled
        ? "#22d3ee"
        : "#565c68";
  const color = data?.highlighted ? "#c7d2fe" : baseColor;
  const strokeWidth = data?.highlighted || isFlowing ? 2.5 : 1.5;
  const opacity = data?.dimmed ? 0.35 : isSettled ? 0.6 : drawn ? 1 : 0;

  const interactive = Boolean(data?.interactive);

  return (
    <>
      {/* No `markerEnd`/arrowhead: today's `DependencyGraph.tsx` never sets
          `data.markerEnd`/`MarkerType` on any edge (confirmed by grep — the
          xyflow edge objects built in the useMemo chain never include a
          `markerEnd` field), so the pre-migration render has NO arrowhead
          decoration. Adding one here would be a net-new visual element,
          which FR-1/FR-3's "preserve bit-for-bit" mandate does not permit. */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        className={isFlowing ? "animate-dashFlow" : undefined}
        style={{
          stroke: color,
          strokeWidth,
          strokeDasharray: data?.missing || pending ? "6 4" : isFlowing ? "6 4" : undefined,
          opacity,
          transition: "opacity 0.2s cubic-bezier(.2,.8,.2,1), stroke 0.12s ease, stroke-width 0.12s ease",
        }}
      />

      {/* Fix A — wide transparent hover hit-area (interactive-graph QA fix,
          ported verbatim). Only interactive (non-missing, non-pending) edges
          get it; pointerEvents="stroke" so it never blocks node clicks. */}
      {interactive && !pending && (
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={20}
          style={{ pointerEvents: "stroke", cursor: "pointer" }}
          onMouseEnter={onHoverEnter}
          onMouseLeave={onHoverLeave}
        />
      )}
    </>
  );
}
