"use client";

import { useEffect, useRef, useState } from "react";

/**
 * useNow — ONE shared clock for the Agents panel (plan §10.5): ticks every
 * `intervalMs` only while `enabled` (live). History / terminal views get a
 * frozen value, so nothing re-renders on a timer there.
 */
export function useNow(intervalMs = 1_000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}

/**
 * useThrottledValue — returns `value`, updated at most once per `ms` (the
 * now-doing line's ≤4 updates/s rule). The latest value always lands.
 */
export function useThrottledValue<T>(value: T, ms = 250): T {
  const [shown, setShown] = useState(value);
  const lastRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const now = Date.now();
    const wait = lastRef.current + ms - now;
    if (wait <= 0) {
      lastRef.current = now;
      setShown(value);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastRef.current = Date.now();
      setShown(value);
      timerRef.current = null;
    }, wait);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, ms]);
  return shown;
}

/** prefers-reduced-motion (false when matchMedia is unavailable, e.g. jsdom). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}
