"use client";

import type { ReactNode } from "react";

export interface GraphNodeProps {
  id: string;
  position: { x: number; y: number };
  width: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  children: ReactNode;
}

/**
 * GraphNode — thin absolute-positioned wrapper (PLAN §9.1 row 2 / design
 * §4.2). `CommandNode`/`AgentNode`/`MissingAgentNode` already own their own
 * hover/menu/pulse state internally (STATE §9.0.1) — this wrapper only
 * supplies position + mouse-event passthrough, exactly as the design doc's
 * "GraphNode is a thin positioning wrapper" reading requires. Height is
 * intentionally NOT fixed here (the real node `<div>`s auto-size); only
 * `left`/`top`/`width` come from the dagre-computed layout estimate.
 */
export function GraphNode({
  id,
  position,
  width,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onContextMenu,
  children,
}: GraphNodeProps) {
  return (
    <div
      data-node-id={id}
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => {
        // ALWAYS stop propagation, even when no `onClick` callback is wired
        // (e.g. outside mission mode, where node click has no handler today)
        // — xyflow distinguished node-vs-pane targets internally, so a plain
        // node click never reached `onPaneClick` even without an
        // `onNodeClick` prop. The self-coded version must replicate that
        // node-click-never-bubbles-to-pane behavior explicitly (regression
        // caught by GraphCanvas.test.tsx's T-5.3).
        e.stopPropagation();
        onClick?.();
      }}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.stopPropagation();
              onContextMenu(e);
            }
          : (e) => e.stopPropagation()
      }
    >
      {children}
    </div>
  );
}
