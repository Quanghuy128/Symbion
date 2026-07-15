"use client";

import { useEffect, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import { Tooltip } from "@/components/ui/tooltip";

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
  /** @xyflow/react v12's `EdgeProps<Edge<T>>` requires `data` to satisfy
   *  `Record<string, unknown>` — an index signature, no shape change. */
  [key: string]: unknown;
}

const STAGGER_MS = 40;
const STAGGER_CAP = 15;

/**
 * AnimatedEdge — React Flow custom edge. Keeps the existing capped staggered
 * draw-in + hover highlight/dim contract, and adds (interactive-graph):
 *  - a midpoint badge (×N pill / goal dot) via EdgeLabelRenderer (always visible when decorated),
 *  - a +/× toolbar shown on hover OR when selected (design §3.3 #4/#5, taste-call §9.8),
 *  - an inline delete-confirm replacing the toolbar on ×,
 *  - a pending ghost (dashed faint + spinner) during a save (design §5 Q).
 * Missing edges NEVER get +/× (can't decorate a phantom).
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
}: EdgeProps<Edge<AnimatedEdgeData>>) {
  const [edgePath, labelX, labelY] = getBezierPath({
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
  const [hovered, setHovered] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!withinStaggerCap) return;
    const timer = window.setTimeout(() => setDrawn(true), drawIndex * STAGGER_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const pending = data?.pending ?? false;
  const baseColor = pending
    ? "#565c68"
    : data?.missing
      ? "#f87171"
      : "#565c68";
  const color = data?.highlighted ? "#c7d2fe" : baseColor;
  const strokeWidth = data?.highlighted ? 2.5 : 1.5;
  const opacity = data?.dimmed ? 0.35 : drawn ? 1 : 0;

  const decorated = !data?.missing && (Boolean(data?.goal) || (data?.count ?? 0) > 1);
  const interactive = Boolean(data?.interactive);
  const toolbarVisible = interactive && (hovered || Boolean(data?.selected));

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: color,
          strokeWidth,
          strokeDasharray: data?.missing || pending ? "6 4" : undefined,
          opacity,
          transition: "opacity 0.2s cubic-bezier(.2,.8,.2,1), stroke 0.12s ease, stroke-width 0.12s ease",
        }}
      />

      {/* Fix A — wide transparent hover hit-area (interactive-graph QA fix).
          The visible edge is ~1.5px; without this an undecorated edge has no
          hittable area, so hovering the line never fired onMouseEnter (the
          EdgeLabelRenderer div collapses to a 0×0 point when nothing is drawn).
          A 20px transparent stroke makes the whole line a hover target that
          reveals the +/× toolbar. Only interactive (non-missing, non-pending)
          edges get it — missing edges must stay toolbar-less (design §3.3 #3),
          and pointerEvents="stroke" means it only reacts on the line itself so
          it never blocks node interactions or panning. */}
      {interactive && !pending && (
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={20}
          style={{ pointerEvents: "stroke", cursor: "pointer" }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => {
            setHovered(false);
            setConfirmingDelete(false);
          }}
        />
      )}

      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => {
            setHovered(false);
            setConfirmingDelete(false);
          }}
        >
          {/* Pending ghost spinner (design §5 Q). */}
          {pending && (
            <span
              aria-label="Saving…"
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-faint border-t-transparent"
            />
          )}

          {/* Badge (always visible when decorated, design §3.3 #2) — hidden while confirming delete. */}
          {!pending && decorated && !confirmingDelete && (
            <Tooltip content={data?.goal || (data?.count ? `×${data.count}` : "")}>
              {(data?.count ?? 0) > 1 ? (
                <span className="inline-flex items-center rounded-pill bg-bg-menu px-1.5 py-0.5 text-[11px] font-medium text-accent-text">
                  ×{data!.count}
                </span>
              ) : (
                <span
                  aria-label="Has a goal"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: "#a78bfa" }}
                />
              )}
            </Tooltip>
          )}

          {/* +/× toolbar (design §3.3 #4/#5) — non-missing + interactive only. */}
          {!pending && toolbarVisible && !confirmingDelete && (
            <span className="ml-1 inline-flex gap-1 align-middle">
              <button
                type="button"
                aria-label="Edit relationship"
                onClick={() => data?.onOpenModal?.()}
                className="flex h-5 w-5 items-center justify-center rounded-full border border-border-menu bg-bg-menu text-accent-text hover:text-accent-text-hi"
              >
                +
              </button>
              <button
                type="button"
                aria-label="Unlink"
                onClick={() => setConfirmingDelete(true)}
                className="flex h-5 w-5 items-center justify-center rounded-full border border-border-menu bg-bg-menu text-text-faint hover:text-danger"
              >
                ×
              </button>
            </span>
          )}

          {/* Inline delete-confirm (design §3.2 M). */}
          {!pending && confirmingDelete && (
            <span className="inline-flex items-center gap-1 rounded-sm border border-border-menu bg-bg-menu px-1.5 py-0.5 text-[11px] text-text-body">
              Delete?
              <button
                type="button"
                aria-label="Confirm unlink"
                onClick={() => {
                  setConfirmingDelete(false);
                  data?.onDelete?.();
                }}
                className="text-success hover:opacity-80"
              >
                ✓
              </button>
              <button
                type="button"
                aria-label="Cancel"
                onClick={() => setConfirmingDelete(false)}
                className="text-text-faint hover:text-text-body"
              >
                ✗
              </button>
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
