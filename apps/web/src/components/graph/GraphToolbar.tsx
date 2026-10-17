"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, HelpCircle, Maximize2, Plus, Slash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { MenuItem, menuSurfaceClass } from "@/components/ui/row-menu";
import { cn } from "@/lib/utils";

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
 * `＋ Add ▾` (opens an add dropdown), `⤢ Fit to view` (fitView), `?` (legend).
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
    <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-pill border border-line-soft bg-surface px-1.5 py-1 shadow-menu">
      <div ref={ref} className="relative">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={Plus}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={addOpen}
          onClick={() => setAddOpen((o) => !o)}
          title={disabled ? "Daemon connection required." : undefined}
          className="rounded-pill"
        >
          Add
          <ChevronDown size={14} strokeWidth={1.6} aria-hidden />
        </Button>
        {addOpen && (
          <div role="menu" className={cn("absolute left-0 top-full mt-1 w-44 animate-popIn", menuSurfaceClass)}>
            <MenuItem
              label="Add workflow"
              icon={Slash}
              onSelect={() => {
                setAddOpen(false);
                onAdd("command");
              }}
            />
            <MenuItem
              label="Add agent"
              icon={Bot}
              onSelect={() => {
                setAddOpen(false);
                onAdd("agent");
              }}
            />
          </div>
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon={Maximize2}
        disabled={fitDisabled}
        onClick={onFitView}
        className="rounded-pill"
      >
        Fit to view
      </Button>

      <IconButton aria-label="Legend" icon={HelpCircle} size="sm" onClick={onToggleLegend} className="rounded-pill" />
    </div>
  );
}
