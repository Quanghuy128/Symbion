"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentNode } from "@symbion/core";
import { StatusGlyph } from "@/components/ui/status-glyph";
import { fmtClock, fmtTok } from "./format";

export interface AgentInstancePickerProps {
  /** viewport rect of the clicked graph node. */
  anchorRect: { left: number; bottom: number; top: number; width: number };
  agentName: string;
  instances: readonly AgentNode[];
  nowMs: number;
  onPick: (agentId: string) => void;
  onClose: () => void;
}

/** G2 — a graph node that ran 2+ times: pick the instance (↑↓ + Enter, Esc closes). */
export function AgentInstancePicker({ anchorRect, agentName, instances, nowMs, onPick, onClose }: AgentInstancePickerProps) {
  const [cursor, setCursor] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="listbox"
      tabIndex={-1}
      aria-label={`${agentName} instances`}
      className="fixed z-menu w-72 rounded-md border border-line-soft bg-surface py-1 text-caption shadow-menu focus-visible:outline-0 motion-safe:animate-popIn"
      style={{ left: anchorRect.left, top: anchorRect.bottom + 6 }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setCursor((c) => Math.min(instances.length - 1, c + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setCursor((c) => Math.max(0, c - 1));
        } else if (e.key === "Enter") {
          e.preventDefault();
          const pick = instances[cursor];
          if (pick) onPick(pick.id);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="px-3 pb-1 text-overline text-ink-muted">
        {agentName} ran {instances.length} times
      </p>
      {instances.map((a, i) => (
        <button
          key={a.id}
          type="button"
          role="option"
          aria-selected={i === cursor}
          className={`flex w-full items-center gap-1.5 px-3 py-1 text-left ${i === cursor ? "bg-surface-hover" : "hover:bg-surface-hover"}`}
          onMouseEnter={() => setCursor(i)}
          onClick={() => onPick(a.id)}
        >
          <StatusGlyph status={a.status} />
          <span className="min-w-0 flex-1 truncate text-ink">{a.description ?? a.id}</span>
          <span className="font-mono tabular-nums text-ink-muted">
            {a.startedAtMs !== null ? fmtClock((a.endedAtMs ?? nowMs) - a.startedAtMs) : "—"}
          </span>
          <span className="w-12 text-right font-mono tabular-nums text-ink">{fmtTok(a.freshTokens)}</span>
        </button>
      ))}
    </div>
  );
}
