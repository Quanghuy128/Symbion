"use client";

import { useEffect, useState } from "react";

const STAGGER_MS = 40;
const STAGGER_CAP = 15;

export interface EdgeInteractionState {
  drawn: boolean;
  hovered: boolean;
  confirmingDelete: boolean;
  setConfirmingDelete: (v: boolean) => void;
  /** Shared hover-enter handler — wire to BOTH the SVG hit-area path (edge
   *  layer) AND the HTML badge/toolbar div (node layer) so hover state stays
   *  in sync across the two DOM trees the fix (STATE §12/§13) now splits
   *  `GraphEdgePath` into. */
  onHoverEnter: () => void;
  onHoverLeave: () => void;
}

/**
 * useEdgeInteraction — extracted so a single instance's state (draw-in,
 * hover, delete-confirm) can be shared between the SVG-only `<path>` layer
 * (`GraphEdgePath`, rendered inside `<svg><g>`) and the HTML badge/toolbar
 * layer (`GraphEdgeLabel`, rendered as a sibling of `<svg>` in `GraphCanvas`'s
 * node layer) — REVIEW round-1 blocker fix (STATE §12): the badge/toolbar
 * `<div>` must not live in the SVG namespace, so it moved to a separate
 * component instantiated by `GraphCanvas`, but both halves of one edge still
 * need synchronized hover/delete-confirm state. `GraphCanvas` calls this hook
 * ONCE per edge and passes the resulting state+handlers to both halves.
 */
export function useEdgeInteraction(id: string, drawIndex: number): EdgeInteractionState {
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

  return {
    drawn,
    hovered,
    confirmingDelete,
    setConfirmingDelete,
    onHoverEnter: () => setHovered(true),
    onHoverLeave: () => {
      setHovered(false);
      setConfirmingDelete(false);
    },
  };
}
