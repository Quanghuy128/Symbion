"use client";

import { useMemo } from "react";
import type { PersistedRunEvent } from "@symbion/core";
import { eventToTail } from "@/lib/run/useRunStore";
import { useWindowedList } from "@/lib/run/useWindowedList";
import { fmtClock } from "./format";

const RAW_ROW_H = 18;

export interface RawEventLogProps {
  /** ALL events of the run being shown (live: allEvents; history: historyEvents). */
  events: readonly PersistedRunEvent[];
  originMs: number | null;
  live: boolean;
  onBack: () => void;
}

/** S5 — the raw event log over the whole run, on the same windowed list (plain text). */
export function RawEventLog({ events, originMs, live, onBack }: RawEventLogProps) {
  const lines = useMemo(() => events.map(eventToTail), [events]);
  const origin = originMs ?? lines[0]?.ts ?? 0;
  const wl = useWindowedList({ count: lines.length, rowH: RAW_ROW_H, live });
  const items = [];
  for (let i = wl.range.start; i < wl.range.end; i++) {
    const l = lines[i];
    if (!l) continue;
    items.push(
      <div
        key={l.seq}
        className="absolute left-0 right-0 flex h-[18px] items-center gap-2 px-2 font-mono text-[10.5px]"
        style={{ top: wl.offsets[i] }}
        data-raw-seq={l.seq}
      >
        <span className="w-8 shrink-0 tabular-nums text-text-faint">{fmtClock(l.ts - origin)}</span>
        <span className="w-14 shrink-0 truncate text-text-faint">{l.kind}</span>
        <span className="min-w-0 flex-1 truncate text-text-body" title={l.text}>
          {l.text}
        </span>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="raw-event-log">
      <div className="flex items-center justify-between border-b border-border-hairline px-2 py-1 text-[11px] text-text-muted">
        <button type="button" className="hover:text-text-body" onClick={onBack}>
          ← back
        </button>
        <span>RAW · {lines.length} events</span>
      </div>
      <div ref={wl.containerRef} onScroll={wl.onScroll} className="min-h-0 flex-1 overflow-auto">
        <div style={{ position: "relative", height: wl.total }}>{items}</div>
      </div>
    </div>
  );
}
