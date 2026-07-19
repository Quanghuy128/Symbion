"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Point } from "./graphGeometry";

export interface NodeDragState {
  nodeId: string;
  /** live cursor-following position, in the same canvas-local coordinate
   *  space GraphNode's `position` prop already uses. */
  position: Point;
}

export interface UseNodeDragOptions {
  /** authoringSuspended passthrough (mission-active / viewing-history) —
   *  mirrors `useConnectDrag`'s `disabled` prop exactly: mousedown must not
   *  start a drag at all. */
  disabled: boolean;
  /** daemon-disconnect-mid-drag (PLAN §7 edge case #7): the local optimistic
   *  position is still applied on mouseup (harmless UI-only), but the
   *  persist callback is skipped — no point firing an RPC that will fail. */
  daemonConnected: boolean;
  /** the canvas root, for converting client coordinates to canvas-relative
   *  coordinates (same coordinate space as node positions). */
  containerRef: React.RefObject<HTMLElement | null>;
  /** fired once a drag settles (mouseup past the threshold) AND the daemon
   *  is connected — the caller persists via `setNodeLayout`. NOT fired for a
   *  below-threshold "click", and NOT fired when `daemonConnected` is false
   *  at mouseup time (still receives the local position via the drag state
   *  before it's cleared — see `onDaemonDisconnectedCommit`). */
  onCommitPosition: (nodeId: string, position: Point) => void;
  /** fired instead of `onCommitPosition` when the drag settles past the
   *  threshold but the daemon is disconnected at mouseup time — lets the
   *  caller still apply the optimistic local position (UI-only, won't
   *  survive a reload) without firing an RPC call that would only fail. */
  onDaemonDisconnectedCommit?: (nodeId: string, position: Point) => void;
}

/** Minimum total mouse movement (px) since mousedown before a gesture is
 *  treated as a drag rather than a plain click (PLAN §6 / §9 item 3 — a
 *  tunable, not a locked spec value). Below this, `mouseup` fires nothing:
 *  no `onCommitPosition`, letting the existing plain-click behavior
 *  (edit-drawer open / mission-mode filter) proceed via the node's own
 *  `onClick`, which the mousedown-capture boundary does not intercept. */
const DRAG_THRESHOLD_PX = 4;

/**
 * useNodeDrag — node-body-drag-to-reposition gesture (free-node-dragging PLAN
 * §1/§6), structurally parallel to `useConnectDrag`: rAF-throttled
 * `mousemove`, `mouseup`-commits, `Escape`-cancels. Drives POSITION updates
 * (not a connect ghost-edge). Disambiguated from `useConnectDrag` at the
 * mousedown-origin level in `GraphCanvas.tsx` — this hook's `startDrag` is
 * only ever called for a mousedown that did NOT originate on a connect
 * handle or a `data-no-node-drag` leaf control.
 */
export function useNodeDrag({
  disabled,
  daemonConnected,
  containerRef,
  onCommitPosition,
  onDaemonDisconnectedCommit,
}: UseNodeDragOptions) {
  const [dragState, setDragState] = useState<NodeDragState | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingCursorRef = useRef<Point | null>(null);
  const dragStateRef = useRef<NodeDragState | null>(null);
  dragStateRef.current = dragState;

  // Tracks whether total movement since mousedown has exceeded the
  // drag-vs-click threshold — a plain click never enters `dragState` at all
  // visually-distinct rendering, but we still need this to decide on mouseup
  // whether to fire onCommitPosition.
  const startPointRef = useRef<Point | null>(null);
  const startClientRef = useRef<Point | null>(null);
  const movedPastThresholdRef = useRef(false);

  const toLocalPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: clientX, y: clientY };
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [containerRef]
  );

  const startDrag = useCallback(
    (nodeId: string, startPosition: Point, clientX: number, clientY: number) => {
      if (disabled) return;
      startPointRef.current = startPosition;
      startClientRef.current = { x: clientX, y: clientY };
      movedPastThresholdRef.current = false;
      setDragState({ nodeId, position: startPosition });
    },
    [disabled]
  );

  const cancelDrag = useCallback(() => {
    setDragState(null);
    pendingCursorRef.current = null;
    startPointRef.current = null;
    startClientRef.current = null;
    movedPastThresholdRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!dragState) return undefined;

    function scheduleUpdate() {
      if (rafRef.current !== null) return;
      let handled = false;
      const id = requestAnimationFrame(() => {
        handled = true;
        rafRef.current = null;
        const cursor = pendingCursorRef.current;
        if (cursor) {
          setDragState((prev) => (prev ? { ...prev, position: cursor } : prev));
        }
      });
      if (!handled) rafRef.current = id;
    }

    function onMouseMove(e: MouseEvent) {
      const start = startClientRef.current;
      if (start) {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
          movedPastThresholdRef.current = true;
        }
      }
      const base = startPointRef.current;
      const startClient = startClientRef.current;
      if (!base || !startClient) return;
      // Position tracks the DELTA from the drag's start client point, applied
      // to the node's own starting canvas position — not a raw
      // toLocalPoint(e), which would snap the node's top-left to the cursor.
      pendingCursorRef.current = {
        x: base.x + (e.clientX - startClient.x),
        y: base.y + (e.clientY - startClient.y),
      };
      scheduleUpdate();
    }

    function onMouseUp() {
      const current = dragStateRef.current;
      const wasDrag = movedPastThresholdRef.current;
      const finalPosition = current?.position;
      cancelDrag();
      if (!current || !wasDrag || !finalPosition) return; // plain click — no commit.
      if (!daemonConnected) {
        onDaemonDisconnectedCommit?.(current.nodeId, finalPosition);
        return;
      }
      onCommitPosition(current.nodeId, finalPosition);
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
  }, [dragState !== null, daemonConnected, onCommitPosition, onDaemonDisconnectedCommit, cancelDrag, toLocalPoint]);

  return { dragState, startDrag, cancelDrag };
}
