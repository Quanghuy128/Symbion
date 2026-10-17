"use client";

import { X } from "lucide-react";
import { useRunStore } from "@/lib/run/useRunStore";
import { IconButton } from "@/components/ui/icon-button";
import { StatusGlyph, type GlyphStatus } from "@/components/ui/status-glyph";
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

/** Run status -> StatusGlyph status (the single glyph/colour source). */
function glyphFor(status: string): GlyphStatus {
  if (status === "completed") return "done";
  if (status === "failed") return "error";
  if (status === "cancelled" || status === "timedOut") return "interrupted";
  return "running";
}

/**
 * RunBar — in-flow dock card for the app-wide run bar (design §3.7 / R4). Shows
 * a live run (any screen) + is the reattach handle. Terminal-until-dismissed.
 * Status + elapsed + cancel only (no progress/token data exists for it).
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
    <div className="relative z-runbar m-3 flex h-12 items-center justify-between rounded-lg border border-line-soft bg-surface px-4 text-caption shadow-toast">
      <span className="flex items-center gap-2">
        <StatusGlyph status={glyphFor(run.status)} live={active} size="md" />
        <span className="font-semibold text-ink">{STATUS_LABEL[run.status] ?? run.status}</span>
        <span className="font-mono text-code text-ink">/{run.commandName}</span>
        {connection === "reconnecting" && <span className="text-warning">⟳ RECONNECTING…</span>}
        <span className="font-mono tabular-nums text-ink-muted">{fmtElapsed(elapsedMs)}</span>
      </span>
      <span className="flex items-center gap-2">
        {active && <CancelControl onConfirm={cancelRun} cancelling={run.status === "cancelling"} />}
        {terminal && <IconButton aria-label="Dismiss" icon={X} size="sm" onClick={detach} />}
      </span>
    </div>
  );
}
