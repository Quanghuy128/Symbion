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

  // ── Run engine v1 (P1, graph-execution-realtime design §4 CommandNodeData diff) ──
  /** node ⋯ menu's "▶ Execute…" — the SOLE P1 entry point (Flaw F8: no list-row, no ⌘K yet). */
  onExecute?: () => void;
  /** present (and onExecute undefined) whenever Execute should render disabled + tooltip. */
  executeDisabledReason?: string;
  /** "active" while this command is the one currently running (glow ring, design §3.5). */
  runStatus?: "idle" | "starting" | "active" | "done" | "error" | "cancelled";
  /** false → 35% dim, no hover (non-participant during a mission). Defaults true (no run). */
  runParticipant?: boolean;
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
  // Run engine v1: runParticipant defaults true (no active run — zero visual
  // change to the existing authoring graph). Active glow takes priority over
  // the authoring highlight/justAdded rings (they never co-occur — authoring
  // suspends during a run).
  const participantDim = data.runParticipant === false;
  const isRunActive = data.runStatus === "active" || data.runStatus === "starting";
  const isRunDone = data.runStatus === "done";
  const isRunError = data.runStatus === "error";
  const isRunCancelled = data.runStatus === "cancelled";

  return (
    <div
      className={`group relative rounded-nav-item px-3 py-2 text-[12.5px] font-medium text-white transition-opacity ${
        isRunActive ? "animate-glowPulse" : ""
      }`}
      style={{
        background: "#818cf8",
        opacity: participantDim ? 0.35 : data.dimmed ? 0.35 : 1,
        boxShadow: isRunActive
          ? "0 0 0 2px #22d3ee"
          : isRunDone
            ? "0 0 0 2px #4ade80"
            : isRunError
              ? "0 0 0 2px #f87171"
              : isRunCancelled
                ? "0 0 0 2px rgba(255,255,255,.3)"
                : data.justAdded
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
        <Tooltip content="This command references an agent with backticks — use @name or drag an edge to show the link.">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onEditBody?.();
            }}
            className="ml-1 inline-flex items-center rounded-pill bg-warning/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[.05em] text-warning"
          >
            not linked
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
            onExecute={data.onExecute}
            executeDisabledReason={data.executeDisabledReason}
          />
        </div>
      )}
    </div>
  );
}
