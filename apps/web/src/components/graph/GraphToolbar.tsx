"use client";

import { useEffect, useRef, useState } from "react";

export interface GraphToolbarProps {
  onAdd: (kind: "agent" | "command") => void;
  onFitView: () => void;
  onToggleLegend: () => void;
  /** disable add / fit when daemon down or canvas empty (design §5 R / §4 H). */
  disabled?: boolean;
  fitDisabled?: boolean;
}

/**
 * GraphToolbar (design §4 A / surface A) — floating top-left pill:
 * `＋ Thêm ▾` (opens an add dropdown), `⤢ Vừa khung` (fitView), `?` (legend).
 */
export function GraphToolbar({ onAdd, onFitView, onToggleLegend, disabled, fitDisabled }: GraphToolbarProps) {
  const [addOpen, setAddOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addOpen) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAddOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setAddOpen(false);
    }
    window.addEventListener("mousedown", onOutside);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onOutside);
      window.removeEventListener("keydown", onEsc);
    };
  }, [addOpen]);

  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-pill border border-border-menu bg-bg-menu px-1.5 py-1 shadow-dropdown">
      <div ref={ref} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setAddOpen((o) => !o)}
          title={disabled ? "Cần kết nối daemon." : undefined}
          className="flex h-7 items-center gap-1 rounded-pill px-2.5 text-[12.5px] font-medium text-text-body hover:bg-white/[.06] disabled:cursor-not-allowed disabled:opacity-40"
        >
          ＋ Thêm ▾
        </button>
        {addOpen && (
          <div
            role="menu"
            className="absolute left-0 top-full z-30 mt-1 w-44 animate-popIn rounded-panel border border-border-menu bg-bg-menu py-1 shadow-dropdown"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAddOpen(false);
                onAdd("command");
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-text-body hover:bg-white/[.06]"
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#818cf8" }} />
              Thêm workflow
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAddOpen(false);
                onAdd("agent");
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-text-body hover:bg-white/[.06]"
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#a78bfa" }} />
              Thêm agent
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={fitDisabled}
        onClick={onFitView}
        className="flex h-7 items-center gap-1 rounded-pill px-2.5 text-[12.5px] font-medium text-text-body hover:bg-white/[.06] disabled:cursor-not-allowed disabled:opacity-40"
      >
        ⤢ Vừa khung
      </button>

      <button
        type="button"
        aria-label="Chú thích"
        onClick={onToggleLegend}
        className="flex h-7 w-7 items-center justify-center rounded-pill text-[13px] font-medium text-text-body hover:bg-white/[.06]"
      >
        ?
      </button>
    </div>
  );
}
