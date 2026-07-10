"use client";

import { useEffect, useRef } from "react";

export interface GraphLegendProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * GraphLegend (design §5 `?` legend / surface A) — the permanent, non-nagging
 * discoverability anchor once the first-run hint bar is gone. Explains edge
 * styles, the draggable handle, the ⋯ menu, and the "chưa liên kết" state.
 * Outside-click + Esc close. z-30 (menu layer).
 */
export function GraphLegend({ open, onOpenChange }: GraphLegendProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("mousedown", onOutside);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onOutside);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Graph legend"
      className="absolute left-3 top-14 z-30 w-[300px] animate-popIn rounded-panel border border-border-menu bg-bg-menu p-4 text-[12.5px] shadow-dropdown"
    >
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-text-faint">Legend</h3>
      <ul className="space-y-2 text-text-body">
        <li className="flex items-start gap-2">
          <span className="mt-0.5 font-mono text-command">●──▶</span>
          <span>/command linked to an agent.</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 font-mono text-danger">●╌╌▶</span>
          <span>agent does not exist (missing) — drag/create an agent to fix.</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 inline-block h-2.5 w-2.5 rounded-full bg-command" />
          <span>Dot ● on the right of a /command — drag to an agent to link.</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 font-mono text-text-faint">⋯</span>
          <span>Node menu: Edit · Delete · Copy run.</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 rounded-pill bg-warning/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[.05em] text-warning">
            not linked
          </span>
          <span>Command references an agent with backticks — use @name to show the link.</span>
        </li>
      </ul>
    </div>
  );
}
