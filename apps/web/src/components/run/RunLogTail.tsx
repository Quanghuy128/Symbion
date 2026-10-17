"use client";

import { useEffect, useRef } from "react";
import type { RawTailLine } from "@/lib/run/useRunStore";

export interface RunLogTailProps {
  lines: RawTailLine[];
  /** shimmer waiting row before the first event. */
  waiting: boolean;
}

function fmtTs(ts: number, first: number): string {
  const s = Math.max(0, Math.floor((ts - first) / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * RunLogTail — the P1 timeline panel: a raw log-tail (last 200 lines). The
 * structured timeline is P2 (design §5: "[≡ Raw] … this IS the P1 panel").
 * Auto-follows the tail.
 */
export function RunLogTail({ lines, waiting }: RunLogTailProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const first = lines[0]?.ts ?? Date.now();

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-2 py-1 text-caption text-ink-muted">
        <span>TIMELINE</span>
        <span>≡ Raw</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto p-2 font-mono text-code-sm leading-relaxed">
        {waiting && lines.length === 0 && (
          <div className="animate-pulse text-ink-muted">waiting for the CLI to start streaming…</div>
        )}
        {lines.map((l) => (
          <div key={l.seq} className="flex gap-2 text-ink">
            <span className="shrink-0 tabular-nums text-ink-muted">{fmtTs(l.ts, first)}</span>
            <span className="break-all">{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
