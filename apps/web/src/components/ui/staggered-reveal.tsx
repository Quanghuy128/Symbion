"use client";

import type { ReactNode } from "react";

export interface StaggeredRevealProps {
  children: ReactNode[];
  /** ms between each row's popIn — default 25ms per design doc §3.4. */
  staggerMs?: number;
  /** rows beyond this index render immediately, no stagger delay — default 12. */
  cap?: number;
}

/**
 * StaggeredReveal — generic stagger wrapper, used ONLY by PublishDiffView's
 * file-row list (design doc §4.1 — explicitly not reused in the Builder
 * List tab, which stays flat/immediate per the minimalist discipline).
 * Applies `animate-popIn` with an increasing `animation-delay` to the first
 * `cap` children; the rest render with no delay (a 60-file diff shouldn't
 * feel slow).
 */
export function StaggeredReveal({ children, staggerMs = 25, cap = 12 }: StaggeredRevealProps) {
  return (
    <>
      {children.map((child, i) => (
        <div
          key={i}
          className="animate-popIn"
          style={i < cap ? { animationDelay: `${i * staggerMs}ms` } : undefined}
        >
          {child}
        </div>
      ))}
    </>
  );
}
