"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TranscriptRow } from "@symbion/core";
import { useWindowedList } from "@/lib/run/useWindowedList";
import { JumpToLatestPill } from "./JumpToLatestPill";
import { ROW_H, RowErrorBoundary, TranscriptRowView } from "./TranscriptRowView";

/** Height assumed for an expanded row until it is measured (jsdom / first paint). */
const EXPANDED_ESTIMATE_PX = 160;

export interface TranscriptListHandle {
  /** collapse every expanded row; true if anything was expanded (Esc step 1). */
  collapseAll: () => boolean;
  jumpToLatest: () => void;
  moveFocus: (delta: number) => void;
  toggleFocused: () => void;
  /** Enter: drill into a spawn row / toggle any other. */
  activateFocused: () => void;
}

export interface TranscriptListProps {
  rows: readonly TranscriptRow[];
  /** streaming: follow / pause / pill. */
  live: boolean;
  /** history: no follow, no pill, no motion. */
  readOnly: boolean;
  /** live && small batch && !reducedMotion. */
  animate: boolean;
  onOpenAgent: (agentId: string) => void;
  /** scroll to (and focus) this row once on mount (Background group → row). */
  scrollToRowId?: string | null;
  emptyText?: string;
  /** rendered under the list when not following (e.g. the terminal footer). */
  footer?: ReactNode;
}

/**
 * TranscriptList — the windowed transcript (D-6, AC-5, AC-10). Collapsed rows
 * are ROW_H tall; only expanded rows are measured. While live, the list
 * follows the bottom; scrolling up > 24px (or expanding a row) pauses it and
 * the Jump pill counts new rows; the pill / End / scrolling back down resume.
 */
export const TranscriptList = forwardRef<TranscriptListHandle, TranscriptListProps>(function TranscriptList(
  { rows, live, readOnly, animate, onOpenAgent, scrollToRowId, emptyText, footer },
  ref
) {
  const followLive = live && !readOnly;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [focusIdx, setFocusIdx] = useState<number>(-1);
  const [measuredById, setMeasuredById] = useState<ReadonlyMap<string, number>>(() => new Map());

  const measured = useMemo(() => {
    const m = new Map<number, number>();
    if (expanded.size === 0) return m;
    rows.forEach((r, i) => {
      if (expanded.has(r.id)) {
        const h = measuredById.get(r.id);
        m.set(i, h && h > 0 ? h : EXPANDED_ESTIMATE_PX);
      }
    });
    return m;
  }, [rows, expanded, measuredById]);

  const wl = useWindowedList({ count: rows.length, rowH: ROW_H, live: followLive, measured });

  // Motion: only rows appended after the first render, and only when animate.
  const seenRef = useRef(rows.length);
  const prevSeen = seenRef.current;
  useEffect(() => {
    seenRef.current = rows.length;
  }, [rows.length]);

  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const toggle = useCallback(
    (id: string) => {
      const opening = !expandedRef.current.has(id);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      // expanding pauses follow so the row doesn't scroll away (review fix #7:
      // side effect kept OUT of the state updater)
      if (opening) wl.pause();
    },
    [wl]
  );

  const scrolledToRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!scrollToRowId || scrolledToRef.current === scrollToRowId) return;
    const idx = rows.findIndex((r) => r.id === scrollToRowId);
    if (idx < 0) return;
    scrolledToRef.current = scrollToRowId;
    setFocusIdx(idx);
    wl.scrollToIndex(idx);
  }, [scrollToRowId, rows, wl]);

  useImperativeHandle(
    ref,
    () => ({
      collapseAll: () => {
        if (expanded.size === 0) return false;
        setExpanded(new Set());
        return true;
      },
      jumpToLatest: () => wl.jumpToLatest(),
      moveFocus: (delta: number) => {
        if (rows.length === 0) return;
        const next = Math.max(0, Math.min(rows.length - 1, (focusIdx < 0 ? (delta > 0 ? -1 : rows.length) : focusIdx) + delta));
        setFocusIdx(next);
        // keep the focused row inside the rendered window
        if (next < wl.range.start + 2 || next > wl.range.end - 3) wl.scrollToIndex(next);
      },
      toggleFocused: () => {
        const row = rows[focusIdx];
        if (row && row.kind !== "spawn") toggle(row.id);
      },
      activateFocused: () => {
        const row = rows[focusIdx];
        if (!row) return;
        if (row.kind === "spawn" && row.childAgentId) onOpenAgent(row.childAgentId);
        else toggle(row.id);
      },
    }),
    [expanded, rows, focusIdx, toggle, onOpenAgent, wl]
  );

  const onHeight = useCallback((id: string, h: number) => {
    setMeasuredById((prev) => (prev.get(id) === h ? prev : new Map(prev).set(id, h)));
  }, []);

  const items: ReactNode[] = [];
  for (let i = wl.range.start; i < wl.range.end; i++) {
    const row = rows[i];
    if (!row) continue;
    const isExpanded = expanded.has(row.id);
    items.push(
      <PositionedRow key={row.id} id={row.id} index={i} top={wl.offsets[i] ?? 0} measure={isExpanded} onHeight={onHeight}>
        <RowErrorBoundary>
          <TranscriptRowView
            row={row}
            expanded={isExpanded}
            focused={i === focusIdx}
            isNew={animate && i >= prevSeen}
            live={followLive}
            onToggle={toggle}
            onOpenAgent={onOpenAgent}
          />
        </RowErrorBoundary>
      </PositionedRow>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={wl.containerRef}
          onScroll={wl.onScroll}
          className="h-full overflow-auto py-1"
          data-testid="transcript-scroll"
          role="list"
          aria-label="Transcript"
        >
          {rows.length === 0 && emptyText ? (
            <p className="px-3 py-2 text-caption text-ink-muted">{emptyText}</p>
          ) : (
            <div style={{ position: "relative", height: wl.total }} data-testid="transcript-spacer">
              {items}
            </div>
          )}
        </div>
        {followLive && <JumpToLatestPill count={wl.newCount} onJump={wl.jumpToLatest} />}
      </div>
      {followLive && wl.following && (
        <div className="border-t border-line px-2 py-0.5 text-overline text-ink-muted">▼ following</div>
      )}
      {followLive && !wl.following && wl.newCount === 0 && (
        <div className="border-t border-line px-2 py-0.5 text-overline text-ink-muted">⏸ paused — End to resume</div>
      )}
      {!followLive && footer}
    </div>
  );
});

/** Absolutely positioned row; measures its height (ResizeObserver) only while expanded. */
function PositionedRow({
  id,
  index,
  top,
  measure,
  onHeight,
  children,
}: {
  id: string;
  index: number;
  top: number;
  measure: boolean;
  onHeight: (id: string, h: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!measure || !el) return;
    const read = () => {
      const h = el.offsetHeight;
      if (h > 0) onHeight(id, h);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, measure, onHeight]);
  return (
    <div ref={ref} style={{ position: "absolute", top, left: 0, right: 0 }} data-index={index}>
      {children}
    </div>
  );
}
