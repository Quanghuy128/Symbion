"use client";

import { useState, type ReactNode } from "react";

export interface TooltipProps {
  /** Tooltip body content. Can include markup (e.g. a `<code>` snippet). */
  content: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Tooltip — minimal hover/focus-triggered tooltip, no Radix dependency
 * (consistent with the dark redesign's "no new Radix" discipline). Positioned
 * directly below the trigger; styled with the same bg-menu/border-menu/
 * shadow-dropdown tokens used by row-menu.tsx and toast.tsx so it matches the
 * established dark-redesign menu/popover look.
 *
 * Triggered on hover AND focus (keyboard accessibility) via onFocus/onBlur on
 * the wrapping span, which also picks up focus-within from a nested
 * interactive child (e.g. a <select>).
 */
export function Tooltip({ content, children, className }: TooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className={`relative inline-flex ${className ?? ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open ? (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-1.5 w-max max-w-xs animate-fadeIn rounded-sm border border-border-menu bg-bg-menu px-2.5 py-1.5 text-xs text-text-body shadow-dropdown"
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
