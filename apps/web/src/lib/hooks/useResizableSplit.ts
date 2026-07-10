"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MIN_PCT = 25;
const MAX_PCT = 75;

function clamp(pct: number): number {
  return Math.min(MAX_PCT, Math.max(MIN_PCT, pct));
}

/**
 * useResizableSplit — owns the left-pane width (%) of a two-pane, side-by-side layout
 * driven by dragging a vertical divider. Persists the ratio to localStorage.
 *
 * SSR-safe: initial render always uses `defaultPct`; the stored value is only read in an
 * effect after mount, so there is no hydration mismatch.
 *
 * @param storageKey  localStorage key to persist the ratio under.
 * @param defaultPct  initial left-pane width in percent (used until storage is read).
 * @returns containerRef (attach to the flex row), leftPct, and onDragStart (divider handler).
 */
export function useResizableSplit(storageKey: string, defaultPct = 50) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [leftPct, setLeftPct] = useState(defaultPct);
  const draggingRef = useRef(false);

  // Read persisted value after mount only (never during render → no SSR mismatch).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw == null) return;
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed)) setLeftPct(clamp(parsed));
    } catch {
      // localStorage unavailable (private mode / disabled) — keep default.
    }
  }, [storageKey]);

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      draggingRef.current = true;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      let latest = leftPct;

      const onMove = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        const rect = container.getBoundingClientRect();
        if (rect.width === 0) return;
        latest = clamp(((ev.clientX - rect.left) / rect.width) * 100);
        setLeftPct(latest);
      };

      const onUp = () => {
        draggingRef.current = false;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        try {
          window.localStorage.setItem(storageKey, String(latest));
        } catch {
          // ignore persistence failure — the in-memory ratio still applies this session.
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [leftPct, storageKey],
  );

  return { containerRef, leftPct, onDragStart };
}
