"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pointInRect, type GeometryNode, type Point, type Rect } from "./graphGeometry";

export interface DragConnectState {
  sourceId: string;
  cursor: Point;
}

export interface UseConnectDragOptions {
  /** node-rect registry (PLAN §9.1.2) — derived via `useMemo` from the SAME
   *  `nodes` array already flowing through `GraphCanvas`'s props, never
   *  `getBoundingClientRect()`-measured. */
  nodeRects: Map<string, Rect>;
  isValidConnection: (sourceId: string, targetId: string) => boolean;
  onConnectAttempt: (sourceId: string, targetId: string) => void;
  /** authoringSuspended passthrough — mousedown must not start a drag at all. */
  disabled: boolean;
  /** daemon-disconnect-mid-drag edge case (PLAN §9.3): cancel in-progress
   *  drag on the next mouseup/mousemove tick rather than attempt a connect. */
  daemonConnected: boolean;
  /** the canvas root, for converting client coordinates to canvas-relative
   *  coordinates (same coordinate space as `nodeRects`/`GraphNode` positions). */
  containerRef: React.RefObject<HTMLElement | null>;
}

/**
 * useConnectDrag — self-coded replacement for xyflow's built-in connect-drag
 * gesture (PLAN §9.1 row 6). State machine: `idle -> dragging(sourceId,
 * cursor) -> commit-or-cancel`. `mousemove` is rAF-throttled (design §5 note
 * 3). `mouseup` does a point-in-rect scan over the node-rect registry — no
 * `getBoundingClientRect()` calls anywhere in this path (PLAN §9.1.2).
 */
export function useConnectDrag({
  nodeRects,
  isValidConnection,
  onConnectAttempt,
  disabled,
  daemonConnected,
  containerRef,
}: UseConnectDragOptions) {
  const [dragConnect, setDragConnect] = useState<DragConnectState | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingCursorRef = useRef<Point | null>(null);
  const dragConnectRef = useRef<DragConnectState | null>(null);
  dragConnectRef.current = dragConnect;

  const toLocalPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: clientX, y: clientY };
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [containerRef]
  );

  const startDrag = useCallback(
    (sourceId: string, clientX: number, clientY: number) => {
      if (disabled) return;
      setDragConnect({ sourceId, cursor: toLocalPoint(clientX, clientY) });
    },
    [disabled, toLocalPoint]
  );

  const cancelDrag = useCallback(() => {
    setDragConnect(null);
    pendingCursorRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!dragConnect) return undefined;

    function scheduleUpdate() {
      if (rafRef.current !== null) return;
      // Guard against a SYNCHRONOUS `requestAnimationFrame` (as used by some
      // test mocks / rAF polyfills): the callback may run BEFORE this
      // assignment completes, so `rafRef.current = null` inside the callback
      // would otherwise be clobbered by this line running immediately after.
      // Using a local `pending` sentinel + explicit ordering avoids the race
      // regardless of whether the platform's rAF is sync or async.
      let handled = false;
      const id = requestAnimationFrame(() => {
        handled = true;
        rafRef.current = null;
        const cursor = pendingCursorRef.current;
        if (cursor) {
          setDragConnect((prev) => (prev ? { ...prev, cursor } : prev));
        }
      });
      if (!handled) rafRef.current = id;
    }

    function onMouseMove(e: MouseEvent) {
      pendingCursorRef.current = toLocalPoint(e.clientX, e.clientY);
      scheduleUpdate();
    }

    function onMouseUp(e: MouseEvent) {
      const current = dragConnectRef.current;
      cancelDrag();
      if (!current) return;
      // Daemon disconnect mid-drag (PLAN §9.3 edge case): cancel rather than
      // attempt a connect that would be silently rejected server-side anyway.
      if (!daemonConnected) return;
      const point = toLocalPoint(e.clientX, e.clientY);
      for (const [targetId, rect] of nodeRects) {
        if (targetId === current.sourceId) continue;
        if (pointInRect(point, rect)) {
          if (isValidConnection(current.sourceId, targetId)) {
            onConnectAttempt(current.sourceId, targetId);
          }
          return;
        }
      }
      // dropped on empty canvas / invalid target: ghost snaps back, no call.
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") cancelDrag();
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragConnect !== null, daemonConnected, nodeRects, isValidConnection, onConnectAttempt, cancelDrag, toLocalPoint]);

  return { dragConnect, startDrag, cancelDrag };
}

// Re-exported for callers that need the plain geometry types alongside this hook.
export type { GeometryNode };
