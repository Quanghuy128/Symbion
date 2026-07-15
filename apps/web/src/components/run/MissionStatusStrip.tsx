"use client";

import type { RunInfo } from "@symbion/rpc-types";
import { CancelControl } from "./CancelControl";

export interface MissionStatusStripProps {
  run: RunInfo;
  elapsedMs: number;
  connection: string;
  onCancel: () => void;
}

function fmtElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

/** MissionStatusStrip — the status bar above the graph in mission mode (design §3.4). */
export function MissionStatusStrip({ run, elapsedMs, connection, onCancel }: MissionStatusStripProps) {
  const active = run.status === "running" || run.status === "starting" || run.status === "cancelling";
  const label =
    run.status === "running" || run.status === "starting"
      ? "RUNNING"
      : run.status === "cancelling"
        ? "CANCELLING"
        : run.status.toUpperCase();

  return (
    <div className="flex items-center justify-between border-b border-border-hairline bg-bg-menu px-3 py-2 text-xs">
      <span className="flex items-center gap-2">
        <span className={active ? "text-run-active" : "text-text-muted"}>{STATUS_GLYPH[run.status] ?? "◉"}</span>
        <span className="font-semibold text-text-body">{label}</span>
        <span className="text-text-body">/{run.commandName}</span>
        <span className="max-w-[280px] truncate text-text-muted">— &quot;{run.requirement}&quot;</span>
        {connection === "reconnecting" && <span className="text-warning">⟳ reconnecting…</span>}
      </span>
      <span className="flex items-center gap-3">
        <span className="font-mono tabular-nums text-text-body">⏱ {fmtElapsed(elapsedMs)}</span>
        {active && <CancelControl onConfirm={onCancel} cancelling={run.status === "cancelling"} />}
      </span>
    </div>
  );
}
