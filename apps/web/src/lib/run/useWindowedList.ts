"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { computeOffsets, computeWindow } from "./windowing";

/** Distance from the bottom (px) beyond which a live list stops following (AC-5). */
export const FOLLOW_PAUSE_PX = 24;
/** Within this distance from the bottom a paused list resumes following. */
const FOLLOW_RESUME_PX = 4;
/** Used when the container reports no height (e.g. jsdom, pre-layout). */
const FALLBACK_VIEWPORT_PX = 400;

export interface WindowedListOptions {
  count: number;
  rowH: number;
  /** live = follow on by default, pause/pill semantics active. */
  live: boolean;
  /** index -> measured height (expanded rows only). */
  measured?: ReadonlyMap<number, number>;
  overscan?: number;
}

export interface WindowedList {
  containerRef: (el: HTMLDivElement | null) => void;
  onScroll: () => void;
  offsets: Float64Array;
  total: number;
  range: { start: number; end: number };
  following: boolean;
  /** rows appended since follow paused (0 while following / not live). */
  newCount: number;
  pause: () => void;
  jumpToLatest: () => void;
  scrollToIndex: (index: number) => void;
}

/**
 * useWindowedList — scroll-container hook for the hand-rolled virtual lists
 * (D-6): window math via `windowing.ts`, plus the live follow / pause /
 * new-count behaviour (plan §10.5). While paused, appends never touch
 * `scrollTop`; only following (or an explicit jump) does.
 */
export function useWindowedList({ count, rowH, live, measured, overscan = 10 }: WindowedListOptions): WindowedList {
  const elRef = useRef<HTMLDivElement | null>(null);
  const [viewportH, setViewportH] = useState(FALLBACK_VIEWPORT_PX);
  const [scrollTop, setScrollTop] = useState(0);
  const [following, setFollowing] = useState(live);
  const [rowsAtPause, setRowsAtPause] = useState(0);
  const followingRef = useRef(following);
  followingRef.current = following;

  const offsets = useMemo(() => computeOffsets(count, rowH, measured), [count, rowH, measured]);
  const total = offsets[offsets.length - 1] ?? 0;
  const totalRef = useRef(total);
  totalRef.current = total;
  const viewportRef = useRef(viewportH);
  viewportRef.current = viewportH;

  const readViewport = useCallback(() => {
    const el = elRef.current;
    const h = el?.clientHeight ?? 0;
    const next = h > 0 ? h : FALLBACK_VIEWPORT_PX;
    if (next !== viewportRef.current) setViewportH(next);
    return next;
  }, []);

  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const containerRef = useCallback(
    (el: HTMLDivElement | null) => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      elRef.current = el;
      if (!el) return;
      readViewport();
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => readViewport());
        ro.observe(el);
        resizeObserverRef.current = ro;
      }
    },
    [readViewport]
  );
  useEffect(() => () => resizeObserverRef.current?.disconnect(), []);

  const scrollToBottom = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const vh = readViewport();
    const target = Math.max(0, totalRef.current - vh);
    el.scrollTop = target;
    setScrollTop(target);
  }, [readViewport]);

  // Follow: keep pinned to the bottom as rows arrive (live only).
  useLayoutEffect(() => {
    if (live && following) scrollToBottom();
  }, [live, following, total, scrollToBottom]);

  // A list that stops being live keeps its position but drops follow state.
  useEffect(() => {
    if (!live) setFollowing(false);
  }, [live]);

  const onScroll = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const st = el.scrollTop;
    setScrollTop(st);
    if (!live) return;
    const dist = totalRef.current - st - viewportRef.current;
    if (followingRef.current && dist > FOLLOW_PAUSE_PX) {
      setFollowing(false);
      setRowsAtPause(count);
    } else if (!followingRef.current && dist <= FOLLOW_RESUME_PX) {
      setFollowing(true);
    }
  }, [live, count]);

  const pause = useCallback(() => {
    if (!live || !followingRef.current) return;
    setFollowing(false);
    setRowsAtPause(count);
  }, [live, count]);

  const jumpToLatest = useCallback(() => {
    if (live) setFollowing(true);
    scrollToBottom();
  }, [live, scrollToBottom]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = elRef.current;
      if (!el) return;
      const i = Math.max(0, Math.min(count - 1, index));
      const vh = readViewport();
      const top = offsets[i] ?? 0;
      const target = Math.max(0, top - vh / 3);
      if (live && followingRef.current) {
        setFollowing(false);
        setRowsAtPause(count);
      }
      el.scrollTop = target;
      setScrollTop(target);
    },
    [count, offsets, live, readViewport]
  );

  const range = useMemo(() => computeWindow(offsets, scrollTop, viewportH, overscan), [offsets, scrollTop, viewportH, overscan]);
  const newCount = live && !following ? Math.max(0, count - rowsAtPause) : 0;

  return { containerRef, onScroll, offsets, total, range, following: live && following, newCount, pause, jumpToLatest, scrollToIndex };
}
