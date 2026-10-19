"use client";

import { useEffect, useRef, useState } from "react";
import { NodeHandle } from "./NodeHandle";
import { NodeMenu } from "./NodeMenu";
import { NodeTokenBadge, type NodeTokenBadgeProps } from "./NodeTokenBadge";
import { Kind } from "@/components/ui/kind";
import { commandRing } from "./nodeRings";

export interface CommandNodeData {
  label: string;
  highlighted?: boolean;
  dimmed?: boolean;
  /** interactive-graph: gates the source handle (design §5 R: hollow + non-connectable when daemon down). */
  connectable?: boolean;
  /** design §4 I: transient accent ring after a successful add. */
  justAdded?: boolean;
  /** node menu callbacks — supplied by DependencyGraph. */
  onEdit?: () => void;
  onDelete?: () => void;
  onCopyRun?: () => void;
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
  /** P2 (design §3.5/§4): roll-up token badge (own + Σ agents). Undefined
   *  outside a run OR before the first usage event. */
  badge?: NodeTokenBadgeProps;
  /** P2: bumped by DependencyGraph on a timeline feed-row click for this
   *  node's actor — re-keying replays the one-shot pulse once (design §5's
   *  "feed row click pulses the node"). */
  runPulseKey?: number;
  /** workflow-agent-run (design §5 / G1): run-panel selection halo, drawn as
   *  a SECOND ring OUTSIDE the status ring so selection never hides status.
   *  "hover" = soft white, "selected" = mint ring. */
  runHalo?: "hover" | "selected";

  /** plain data-bag index signature (unchanged shape from the xyflow-era
   *  `NodeProps<Node<T>>` requirement — no longer required by the self-coded
   *  `GraphNode`/`GraphCanvas` contract, kept for shape stability). */
  [key: string]: unknown;
}

export interface CommandNodeProps {
  data: CommandNodeData;
}

/**
 * CommandNode — /command node (Kind tile carries the kind). Stays dumb: all
 * derived state (highlighted/dimmed/justAdded/connectable) is computed
 * in DependencyGraph. Local state is ONLY ephemeral UI (menu open, handle hover).
 */
export function CommandNode({ data }: CommandNodeProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  // one-shot pulse-on-hover is now owned internally by NodeHandle (self-coded
  // remount-to-replay trick), replacing the xyflow-era local pulseKey state.
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

  // P2 (design §3.5): one-shot "lock-in" flash the instant this node
  // transitions from active -> done (was live, now settled) — the previous
  // runStatus is tracked in a ref so this only fires on the ACTIVE->DONE edge,
  // never on every render while done.
  const wasActiveRef = useRef(false);
  const [lockIn, setLockIn] = useState(false);
  useEffect(() => {
    if (isRunActive) {
      wasActiveRef.current = true;
    } else if (isRunDone && wasActiveRef.current) {
      wasActiveRef.current = false;
      setLockIn(true);
      const t = window.setTimeout(() => setLockIn(false), 300);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [isRunActive, isRunDone]);

  // P2: feed-row-click -> node pulse (design §5). Re-fires the one-shot
  // `pulse` keyframe whenever runPulseKey changes (a new key = a new click).
  const [rowPulse, setRowPulse] = useState(false);
  const lastPulseKeyRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (data.runPulseKey === undefined || data.runPulseKey === lastPulseKeyRef.current) return;
    lastPulseKeyRef.current = data.runPulseKey;
    setRowPulse(true);
    const t = window.setTimeout(() => setRowPulse(false), 900);
    return () => window.clearTimeout(t);
  }, [data.runPulseKey]);

  return (
    <div
      className={`group relative flex min-h-10 flex-col justify-center rounded-lg border border-line-soft bg-surface px-2.5 text-label text-ink transition-opacity ${
 isRunActive ? "animate-glowPulse" : lockIn || rowPulse ? "animate-countLockIn" : ""
 }`}
      style={{
        opacity: participantDim ? 0.35 : data.dimmed ? 0.35 : 1,
        boxShadow: commandRing({
          active: isRunActive,
          done: isRunDone,
          error: isRunError,
          cancelled: isRunCancelled,
          justAdded: data.justAdded,
          highlighted: data.highlighted,
        }),
        transition: "box-shadow .3s ease, opacity .12s ease",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {data.runHalo && (
        <span
          aria-hidden
          data-run-halo={data.runHalo}
          className={`pointer-events-none absolute -inset-[6px] rounded-[20px] border-2 transition-colors duration-100 ${
 data.runHalo === "selected" ? "border-mint" : "border-line-strong"
 }`}
        />
      )}
      <NodeHandle
        role="source"
        connectable={connectable}
        className={connectable ? "!bg-workflow animate-pulse" : "!bg-transparent !border !border-line-strong"}
      />

      <span className="flex items-center gap-2 pr-4">
        <Kind kind="workflow" size="sm" />
        <span className="min-w-0 truncate">{data.label}</span>
      </span>

      {data.badge && <NodeTokenBadge {...data.badge} label={data.label} />}

      {/* Hover-revealed ⋯ menu (design §4 D). */}
      {(hovered || menuOpen) && (
        <div className="absolute right-1.5 top-1 z-10">
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
