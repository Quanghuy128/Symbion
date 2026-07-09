"use client";

import { useEffect, useRef } from "react";

export interface GraphCanvasMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onAdd: (kind: "agent" | "command") => void;
  onFitView: () => void;
  disabled?: boolean;
}

/**
 * GraphCanvasMenu (design §4 C, surface C) — right-click empty-canvas context
 * menu. Positioned at the click point (relative to the canvas wrapper).
 * Add workflow / Add agent / Vừa khung. Closes on outside-click / Esc.
 */
export function GraphCanvasMenu({ x, y, onClose, onAdd, onFitView, disabled }: GraphCanvasMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", onOutside);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onOutside);
      window.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute z-30 w-44 animate-popIn rounded-panel border border-border-menu bg-bg-menu py-1 shadow-dropdown"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={() => {
          onClose();
          onAdd("command");
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-text-body hover:bg-white/[.06] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#818cf8" }} />
        Thêm workflow
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={() => {
          onClose();
          onAdd("agent");
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-text-body hover:bg-white/[.06] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#a78bfa" }} />
        Thêm agent
      </button>
      <div className="my-1 border-t border-border-hairline" />
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onFitView();
        }}
        className="block w-full px-3 py-1.5 text-left text-[13px] text-text-body hover:bg-white/[.06]"
      >
        ⤢ Vừa khung
      </button>
    </div>
  );
}
