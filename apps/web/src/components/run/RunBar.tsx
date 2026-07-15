"use client";

import { useRunStore } from "@/lib/run/useRunStore";
import { CancelControl } from "./CancelControl";

function fmtElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const TERMINAL = new Set(["completed", "failed", "cancelled", "timedOut"]);

const STATUS_LABEL: Record<string, string> = {
  starting: "STARTING…",
  running: "RUNNING",
  cancelling: "CANCELLING…",
  completed: "FINISHED",
  failed: "FAILED",
  cancelled: "CANCELLED",
  timedOut: "STOPPED",
};

/**
 * RunBar — bottom-dock app-wide run bar (design §3.7 / R4). Shows a live run
 * (any screen) + is the reattach handle. Terminal-until-dismissed. P1: status +
 * elapsed + cancel (no token badges — that's P2).
 */
export function RunBar() {
  const run = useRunStore((s) => s.run);
  const elapsedMs = useRunStore((s) => s.elapsedMs);
  const connection = useRunStore((s) => s.connection);
  const cancelRun = useRunStore((s) => s.cancelRun);
  const detach = useRunStore((s) => s.detach);

  if (!run) return null;

  const terminal = TERMINAL.has(run.status);
  const active = !terminal;

  return (
    <div className="flex h-10 items-center justify-between border-t border-border-hairline bg-bg-menu px-4 text-xs">
      <span className="flex items-center gap-2">
        <span className={active ? "text-run-active" : run.status === "failed" ? "text-danger" : "text-text-muted"}>
          {active ? "◉" : run.status === "completed" ? "✓" : run.status === "failed" ? "✗" : "◼"}
        </span>
        <span className="font-semibold text-text-body">{STATUS_LABEL[run.status] ?? run.status}</span>
        <span className="text-text-body">/{run.commandName}</span>
        {connection === "reconnecting" && <span className="text-warning">⟳ RECONNECTING…</span>}
        <span className="font-mono tabular-nums text-text-muted">{fmtElapsed(elapsedMs)}</span>
      </span>
      <span className="flex items-center gap-2">
        {active && <CancelControl onConfirm={cancelRun} cancelling={run.status === "cancelling"} />}
        {terminal && (
          <button className="text-text-muted hover:text-text-body" onClick={detach} aria-label="Dismiss">
            ✕
          </button>
        )}
      </span>
    </div>
  );
}
