"use client";

import { useEffect, useState } from "react";
import type { AgentNode, BackgroundTask } from "@symbion/core";
import { StatusGlyph } from "./StatusGlyph";
import { LiveDuration } from "./LiveDuration";

export interface BackgroundGroupProps {
  tasks: readonly BackgroundTask[];
  live: boolean;
  terminal: boolean;
  nowMs: number;
  onOpen: (task: BackgroundTask) => void;
}

/** BACKGROUND · N — absent when empty; auto-collapsed at terminal (design S2/S3). */
export function BackgroundGroup({ tasks, live, terminal, nowMs, onOpen }: BackgroundGroupProps) {
  const [open, setOpen] = useState(!terminal);
  useEffect(() => {
    if (terminal) setOpen(false);
  }, [terminal]);
  if (tasks.length === 0) return null;
  return (
    <div className="mt-2 border-t border-border-hairline pt-1" data-testid="background-group">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center justify-between px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.05em] text-text-muted"
        onClick={() => setOpen((o) => !o)}
      >
        <span>Background · {tasks.length}</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open &&
        tasks.map((t) => (
          <button
            key={t.toolUseId}
            type="button"
            className="flex w-full items-center gap-1.5 px-2 py-0.5 pl-4 text-left text-[11px] hover:bg-white/[.04]"
            onClick={() => onOpen(t)}
          >
            <StatusGlyph status={t.status} live={live} />
            <span className="min-w-0 flex-1 truncate font-mono text-text-body" title={t.command ?? t.label}>
              $ {t.command ?? t.label}
            </span>
            <LiveDuration
              startedAtMs={t.startedAtMs}
              endedAtMs={t.endedAtMs}
              nowMs={nowMs}
              ticking={live && t.status === "running"}
              className="text-[10.5px] text-text-muted"
            />
            <span className="text-text-muted">›</span>
          </button>
        ))}
    </div>
  );
}

export interface UnattributedGroupProps {
  node: AgentNode | null;
  eventCount: number;
  onOpen: () => void;
}

/** UNATTRIBUTED · N events ⚠ › — absent when empty. */
export function UnattributedGroup({ node, eventCount, onOpen }: UnattributedGroupProps) {
  if (!node || eventCount === 0) return null;
  return (
    <button
      type="button"
      className="mt-1 flex w-full items-center justify-between border-t border-border-hairline px-2 py-1 text-[10px] font-semibold uppercase tracking-[.05em] text-warning hover:bg-white/[.04]"
      onClick={onOpen}
      data-testid="unattributed-group"
    >
      <span>
        Unattributed · {eventCount} event{eventCount === 1 ? "" : "s"} ⚠
      </span>
      <span>›</span>
    </button>
  );
}
