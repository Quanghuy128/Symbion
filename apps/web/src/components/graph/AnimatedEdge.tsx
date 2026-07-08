"use client";

import { useEffect, useState } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "reactflow";

export interface AnimatedEdgeData {
  /** Index of this edge among the edges drawn in on the current graph mount —
   * used to compute the stagger delay. Edges beyond the cap (design doc §3.2:
   * first 15) render immediately, no stagger. */
  drawIndex?: number;
  /** Missing-agent dangling-mention edge — recolored danger + reuses React
   * Flow's built-in `animated` (dashed marching-ants) prop, not a new effect. */
  missing?: boolean;
  highlighted?: boolean;
  dimmed?: boolean;
}

const STAGGER_MS = 40;
const STAGGER_CAP = 15;

/**
 * AnimatedEdge — React Flow custom edge (design doc §4.1). Capped staggered
 * draw-in on mount (first 15 edges, ~40ms/edge, same cubic-bezier family as
 * `slideIn` — see tailwind.config.ts's `animation.slideIn`), reusing a CSS
 * `stroke-dashoffset` draw-in rather than inventing a 4th motion token.
 * `prefers-reduced-motion` is handled by the SAME global media-query block in
 * globals.css (which collapses all `animation-duration`s to ~0) — no
 * per-component reduced-motion branch needed.
 *
 * Hover highlight/dim (design doc §3.2 richness ceiling): plain ~120ms CSS
 * opacity/stroke transition driven by `data.highlighted`/`data.dimmed`,
 * computed by the parent (DependencyGraph) from node-hover state — this
 * component stays presentational/dumb, matching CommandNode/AgentNode's
 * contract.
 */
export function AnimatedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps<AnimatedEdgeData>) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const drawIndex = data?.drawIndex ?? 0;
  const withinStaggerCap = drawIndex < STAGGER_CAP;
  const [drawn, setDrawn] = useState(!withinStaggerCap);

  useEffect(() => {
    if (!withinStaggerCap) return;
    const timer = window.setTimeout(() => setDrawn(true), drawIndex * STAGGER_MS);
    return () => window.clearTimeout(timer);
    // Mount-only stagger — id is stable per edge, drawIndex/withinStaggerCap
    // don't change after mount for a given graph render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const baseColor = data?.missing ? "#f87171" /* danger */ : "#565c68" /* text-faint, default edge */;
  const color = data?.highlighted ? "#c7d2fe" /* accent-text-hi */ : baseColor;
  const strokeWidth = data?.highlighted ? 2.5 : 1.5;
  const opacity = data?.dimmed ? 0.35 : drawn ? 1 : 0;

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        ...style,
        stroke: color,
        strokeWidth,
        strokeDasharray: data?.missing ? "6 4" : undefined,
        opacity,
        transition: "opacity 0.2s cubic-bezier(.2,.8,.2,1), stroke 0.12s ease, stroke-width 0.12s ease",
      }}
    />
  );
}
