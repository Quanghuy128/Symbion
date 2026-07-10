"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useResizableWidth — owns the total pixel width of a panel anchored to the RIGHT edge
 * of the viewport (e.g. a right-side drawer), resized by dragging a handle on its LEFT
 * edge. Persists the width to localStorage.
 *
 * Because the panel is right-anchored, width grows as the pointer moves left:
 * `width = window.innerWidth - clientX`. Clamped to [minPx, maxPx], where maxPx also
 * respects the viewport (never wider than `innerWidth - margin`).
 *
 * SSR-safe: initial render uses `defaultPx`; the stored value is read in an effect
 * after mount, so there is no hydration mismatch.
 */
export function useResizableWidth(
  storageKey: string,
  defaultPx: number,
  minPx: number,
  maxPx: number,
) {
  const [width, setWidth] = useState(defaultPx);
  const draggingRef = useRef(false);

  const clamp = useCallback(
    (px: number): number => {
      const viewportMax = typeof window !== "undefined" ? window.innerWidth - 32 : maxPx;
      return Math.min(Math.min(maxPx, viewportMax), Math.max(minPx, px));
    },
    [minPx, maxPx],
  );

  // Read persisted value after mount only (never during render → no SSR mismatch).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw == null) return;
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed)) setWidth(clamp(parsed));
    } catch {
      // localStorage unavailable — keep default.
    }
  }, [storageKey, clamp]);

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      let latest = width;

      const onMove = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        latest = clamp(window.innerWidth - ev.clientX);
        setWidth(latest);
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
          // ignore persistence failure — in-memory width still applies this session.
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [width, storageKey, clamp],
  );

  return { width, onDragStart };
}
