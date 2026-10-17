"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TooltipProps {
  /** Tooltip body content. Can include markup (e.g. a `<code>` snippet). */
  content: ReactNode;
  children: ReactNode;
  className?: string;
  side?: "bottom" | "top" | "right";
  /** Hover delay in ms (focus opens immediately). */
  delayMs?: number;
}

/**
 * Tooltip — minimal hover/focus-triggered tooltip, no Radix dependency.
 * Inverted style (ink ground, app-coloured text). Opens after a hover delay,
 * immediately on keyboard focus; picks up focus-within from a nested control.
 */
export function Tooltip({ content, children, className, side = "bottom", delayMs = 400 }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => {
        clear();
        timer.current = setTimeout(() => setOpen(true), delayMs);
      }}
      onMouseLeave={() => {
        clear();
        setOpen(false);
      }}
      onFocus={() => {
        clear();
        setOpen(true);
      }}
      onBlur={() => {
        clear();
        setOpen(false);
      }}
    >
      {children}
      {open ? (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-menu w-max max-w-[260px] animate-fadeIn rounded-sm bg-ink px-2.5 py-1.5 text-caption text-app shadow-menu",
            side === "right"
              ? "left-full top-1/2 ml-1.5 -translate-y-1/2"
              : side === "bottom"
                ? "left-1/2 top-full mt-1.5 -translate-x-1/2"
                : "bottom-full left-1/2 mb-1.5 -translate-x-1/2",
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
