"use client";

import { useState } from "react";

export interface NodeHandleProps {
  role: "source" | "target";
  /** gates connect-drag start (source) / drop eligibility (target) — same
   *  contract as xyflow's `isConnectable` (PLAN §9.1 row 4). */
  connectable: boolean;
  /** fired on mousedown for a source handle — starts `useConnectDrag`. */
  onDragStart?: () => void;
  className?: string;
}

/**
 * NodeHandle — self-coded replacement for xyflow's `<Handle>` (PLAN §9.1 row
 * 4). Absolute-positioned dot; source handles sit at the node's right edge,
 * target handles at the left edge (CSS-positioned by the caller via
 * `className`/inline style exactly as `CommandNode`/`AgentNode`/
 * `MissingAgentNode` already do — this component itself stays position-
 * agnostic, matching how xyflow's own `<Handle position={Position.Right}>`
 * only supplied the dot, not the node-relative placement).
 *
 * Ported verbatim from today's `Handle` usage: `!bg-command`/`!bg-agent`/
 * `!bg-danger` classes (source vs. target vs. missing-agent) and the hollow
 * `!bg-transparent !border !border-white/40` non-connectable treatment are
 * passed in via `className` by the caller, unchanged.
 *
 * The one-shot hover "pulse" (design §5's "re-key the handle to force
 * remount" note) is reproduced here via a local `pulseKey` re-keyed span —
 * CSS animations don't replay on a prop change alone, so remounting the
 * inner element on each new hover is the same trick `CommandNode` used with
 * xyflow's `<Handle key={pulseKey}>`.
 */
export function NodeHandle({ role, connectable, onDragStart, className }: NodeHandleProps) {
  const [pulseKey, setPulseKey] = useState(0);

  return (
    <div
      key={pulseKey}
      role="presentation"
      data-handle-role={role}
      onMouseDown={(e) => {
        if (role !== "source" || !connectable) return;
        e.stopPropagation();
        onDragStart?.();
      }}
      onMouseEnter={() => {
        if (role === "source" && connectable) setPulseKey((k) => k + 1);
      }}
      className={
        className ??
        (connectable
          ? role === "source"
            ? "!bg-command animate-pulse"
            : "!bg-agent"
          : "!bg-transparent !border !border-white/40")
      }
      style={{
        position: "absolute",
        width: 8,
        height: 8,
        borderRadius: "50%",
        top: "50%",
        right: role === "source" ? -4 : undefined,
        left: role === "target" ? -4 : undefined,
        transform: "translateY(-50%)",
        cursor: role === "source" && connectable ? "crosshair" : undefined,
      }}
    />
  );
}
