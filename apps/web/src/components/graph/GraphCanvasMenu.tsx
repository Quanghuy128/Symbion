"use client";

import { useEffect, useRef } from "react";
import { Bot, Maximize2, Slash } from "lucide-react";
import { MenuDivider, MenuItem, menuSurfaceClass } from "@/components/ui/row-menu";
import { cn } from "@/lib/utils";

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
      className={cn("absolute w-44 animate-popIn", menuSurfaceClass)}
      style={{ left: x, top: y }}
    >
      <MenuItem
        label="Add workflow"
        icon={Slash}
        disabled={disabled}
        onSelect={() => {
          onClose();
          onAdd("command");
        }}
      />
      <MenuItem
        label="Add agent"
        icon={Bot}
        disabled={disabled}
        onSelect={() => {
          onClose();
          onAdd("agent");
        }}
      />
      <MenuDivider />
      <MenuItem
        label="Fit to view"
        icon={Maximize2}
        onSelect={() => {
          onClose();
          onFitView();
        }}
      />
    </div>
  );
}
