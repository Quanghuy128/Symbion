"use client";

import { Tooltip } from "@/components/ui/tooltip";
import { bezierPath, type Point } from "./bezierPath";
import type { AnimatedEdgeData } from "./GraphEdgePath";
import type { EdgeInteractionState } from "./useEdgeInteraction";

export interface GraphEdgeLabelProps {
  sourcePoint: Point;
  targetPoint: Point;
  data?: AnimatedEdgeData;
  interaction: EdgeInteractionState;
}

/**
 * GraphEdgeLabel — the ×N count / goal-dot badge, hover-revealed +/×
 * toolbar, inline "Delete? ✓ ✗" confirm, and pending-save spinner for one
 * edge. Plain HTML, rendered by `GraphCanvas` as a sibling of the `<svg>`
 * edge layer (inside the existing absolute-positioned HTML node layer), NOT
 * inside `<svg><g>` — this is the REVIEW round-1 blocker fix (STATE §12): a
 * `<div>` nested under an `<svg>` ancestor is created in the SVG namespace
 * and never receives `position`/Tailwind/box-model layout in a real browser.
 *
 * Positioned via `labelX`/`labelY` from `bezierPath` (PLAN §9.1.1's original
 * intent — no portal needed, the HTML node layer is already a plain sibling
 * of the SVG edge layer in `GraphCanvas`).
 *
 * Shares `hovered`/`confirmingDelete`/`drawn` state with the SVG-only
 * `GraphEdgePath` via the SAME `useEdgeInteraction` instance, passed in as
 * `interaction` by `GraphCanvas` (instantiated once per edge, not per
 * component) so hovering the 20px SVG hit-area and hovering this div reveal/
 * hide the toolbar in sync.
 */
export function GraphEdgeLabel({ sourcePoint, targetPoint, data, interaction }: GraphEdgeLabelProps) {
  const { labelX, labelY } = bezierPath(sourcePoint, targetPoint);
  const { hovered, confirmingDelete, setConfirmingDelete, onHoverEnter, onHoverLeave } = interaction;

  const pending = data?.pending ?? false;
  const decorated = !data?.missing && (Boolean(data?.goal) || (data?.count ?? 0) > 1);
  const interactive = Boolean(data?.interactive);
  const toolbarVisible = interactive && (hovered || Boolean(data?.selected));

  if (pending) {
    return (
      <div
        className="nodrag nopan absolute"
        style={{
          left: 0,
          top: 0,
          transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          pointerEvents: "all",
        }}
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
      >
        <span
          aria-label="Saving…"
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-muted border-t-transparent"
        />
      </div>
    );
  }

  if (!decorated && !toolbarVisible && !confirmingDelete) {
    // Nothing to render, but keep the hover surface alive so re-entering the
    // (still-existing) badge/toolbar area after it appears keeps working —
    // matches the prior behavior where the wrapper div always existed.
    return (
      <div
        className="nodrag nopan absolute"
        style={{
          left: 0,
          top: 0,
          transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          pointerEvents: interactive ? "all" : "none",
        }}
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
      />
    );
  }

  return (
    <div
      className="nodrag nopan absolute"
      style={{
        left: 0,
        top: 0,
        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
        pointerEvents: "all",
      }}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
    >
      {decorated && !confirmingDelete && (
        <Tooltip content={data?.goal || (data?.count ? `×${data.count}` : "")}>
          {(data?.count ?? 0) > 1 ? (
            <span className="inline-flex items-center rounded-pill bg-surface px-1.5 py-0.5 text-caption font-medium text-mint-text">
              ×{data!.count}
            </span>
          ) : (
            <span
              aria-label="Has a goal"
              className="inline-block h-2 w-2 rounded-full bg-agent"
            />
          )}
        </Tooltip>
      )}

      {toolbarVisible && !confirmingDelete && (
        <span className="ml-1 inline-flex gap-1 align-middle">
          <button
            type="button"
            aria-label="Edit relationship"
            onClick={() => data?.onOpenModal?.()}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-line-soft bg-surface text-mint-text hover:text-mint-hover"
          >
            +
          </button>
          <button
            type="button"
            aria-label="Unlink"
            onClick={() => setConfirmingDelete(true)}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-line-soft bg-surface text-ink-muted hover:text-danger-text"
          >
            ×
          </button>
        </span>
      )}

      {confirmingDelete && (
        <span className="inline-flex items-center gap-1 rounded-sm border border-line-soft bg-surface px-1.5 py-0.5 text-caption text-ink">
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
            className="text-ink-muted hover:text-ink"
          >
            ✗
          </button>
        </span>
      )}
    </div>
  );
}
