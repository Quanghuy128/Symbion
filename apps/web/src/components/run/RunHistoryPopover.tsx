"use client";

import { useEffect, useRef, useState } from "react";
import type { RunListItem } from "@symbion/rpc-types";
import { useRunStore } from "@/lib/run/useRunStore";

export interface RunHistoryPopoverProps {
  projectId: string;
  onSelect: (runId: string) => void;
  onClose: () => void;
}

const STATUS_GLYPH: Record<string, string> = {
  starting: "◌",
  running: "◉",
  cancelling: "◐",
  completed: "✓",
  failed: "✗",
  cancelled: "◼",
  timedOut: "◼",
};

function fmtTok(n: number | null): string {
  if (n === null) return "—";
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`;
}

function fmtCost(n: number | null): string {
  return n === null ? "—" : `$${n.toFixed(2)}`;
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * RunHistoryPopover — the 🕘 history popover (design §3.10 R6, STATE §18.1).
 * Lazy `listRuns` RPC call on open (no new RPC — the existing method already
 * returns every persisted run newest-first). One row per run: glyph / command
 * / duration / fresh-tok / $ / relative time. No delete/search in v1 (locked).
 */
export function RunHistoryPopover({ projectId, onSelect, onClose }: RunHistoryPopoverProps) {
  const [runs, setRuns] = useState<RunListItem[] | "loading">("loading");
  const [activeRunId, setActiveRunId] = useState<string | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await useRunStore.getState().listRunsForHistory(projectId);
        if (cancelled) return;
        setRuns(result.runs);
        setActiveRunId(result.activeRunId);
      } catch {
        if (!cancelled) setRuns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", onOutside);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onOutside);
      window.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Run history"
      className="absolute left-3 top-12 z-30 w-[360px] animate-popIn rounded-panel border border-border-menu bg-bg-menu p-2 shadow-dropdown"
    >
      <p className="mb-1 px-1 text-[11px] font-semibold text-text-muted">RUNS (last 50)</p>

      {runs === "loading" && <p className="px-1 py-2 text-xs text-text-muted">Loading…</p>}

      {runs !== "loading" && runs.length === 0 && (
        <p className="px-1 py-2 text-xs text-text-faint">No runs yet — hit ▶ Execute on a command node.</p>
      )}

      {runs !== "loading" && runs.length > 0 && (
        <ul className="max-h-[320px] space-y-0.5 overflow-y-auto">
          {runs.map((r) => (
            <li key={r.runId}>
              <button
                type="button"
                onClick={() => onSelect(r.runId)}
                className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-[11.5px] hover:bg-white/[.06]"
              >
                <span className={r.runId === activeRunId ? "text-run-active" : r.status === "failed" ? "text-danger" : "text-text-muted"}>
                  {STATUS_GLYPH[r.status] ?? "◉"}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-body">/{r.commandName}</span>
                <span className="shrink-0 tabular-nums text-text-muted">{fmtDuration(r.durationMs)}</span>
                <span className="shrink-0 tabular-nums text-text-muted">{fmtTok(r.freshTokens)}</span>
                <span className="shrink-0 tabular-nums text-text-muted">{fmtCost(r.costUsd)}</span>
                <span className="shrink-0 text-text-faint">{fmtRelative(r.startedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-1 border-t border-border-hairline px-1 pt-1 text-[10px] text-text-faint">
        Runs live in .symbion/runs/ (gitignored).
      </p>
    </div>
  );
}
