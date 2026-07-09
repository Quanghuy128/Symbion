"use client";

import { useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { NodeMenu } from "./NodeMenu";
import { Tooltip } from "@/components/ui/tooltip";

export interface CommandNodeData {
  label: string;
  highlighted?: boolean;
  dimmed?: boolean;
  /** interactive-graph: gates the source handle (design §5 R: hollow + non-connectable when daemon down). */
  connectable?: boolean;
  /** design §5 O: command references an agent by backtick but has 0 @name edges (conservative). */
  unlinked?: boolean;
  /** design §4 I: transient accent ring after a successful add. */
  justAdded?: boolean;
  /** node menu callbacks — supplied by DependencyGraph. */
  onEdit?: () => void;
  onDelete?: () => void;
  onCopyRun?: () => void;
  /** design §5 O: open the drawer on the unlinked-chip "Sửa body" action. */
  onEditBody?: () => void;
  /** true while daemon connected — gates the destructive menu item like the list. */
  daemonConnected?: boolean;
}

/**
 * CommandNode — /command node (design §3.2: indigo #818cf8). Stays dumb: all
 * derived state (highlighted/dimmed/unlinked/justAdded/connectable) is computed
 * in DependencyGraph. Local state is ONLY ephemeral UI (menu open, handle hover).
 */
export function CommandNode({ data }: NodeProps<CommandNodeData>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  // one-shot pulse: re-key the handle each time hover begins so the .9s animation replays once.
  const [pulseKey, setPulseKey] = useState(0);
  const connectable = data.connectable ?? false;

  return (
    <div
      className="group relative rounded-nav-item px-3 py-2 text-[12.5px] font-medium text-white transition-opacity"
      style={{
        background: "#818cf8",
        opacity: data.dimmed ? 0.35 : 1,
        boxShadow: data.justAdded
          ? "0 0 0 3px #6366f1"
          : data.highlighted
            ? "0 0 0 2px #c7d2fe"
            : undefined,
        transition: "box-shadow .3s ease, opacity .12s ease",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle
        key={pulseKey}
        type="source"
        position={Position.Right}
        isConnectable={connectable}
        onMouseEnter={() => connectable && setPulseKey((k) => k + 1)}
        className={connectable ? "!bg-command animate-pulse" : "!bg-transparent !border !border-white/40"}
      />

      <span className="pr-4">{data.label}</span>

      {/* Unlinked-command chip (design §5 O) — warning, never danger. */}
      {data.unlinked && (
        <Tooltip content="Lệnh này nhắc agent bằng backtick — dùng @tên hoặc kéo cạnh để hiện liên kết.">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onEditBody?.();
            }}
            className="ml-1 inline-flex items-center rounded-pill bg-warning/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[.05em] text-warning"
          >
            chưa liên kết
          </button>
        </Tooltip>
      )}

      {/* Hover-revealed ⋯ menu (design §4 D). */}
      {(hovered || menuOpen) && (
        <div className="absolute -right-1 -top-1 z-10">
          <NodeMenu
            kind="command"
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onEdit={() => data.onEdit?.()}
            onCopyRun={() => data.onCopyRun?.()}
            onDelete={() => data.onDelete?.()}
            deleteDisabled={!data.daemonConnected}
          />
        </div>
      )}
    </div>
  );
}
