"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface RowMenuAction {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Divider sentinel — push this between two RowMenuAction entries. */
export const ROW_MENU_DIVIDER = "divider" as const;
export type RowMenuItem = RowMenuAction | typeof ROW_MENU_DIVIDER;

export interface RowMenuProps {
  items: RowMenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** aria-label for the trigger button; defaults to "Tùy chọn". */
  triggerLabel?: string;
}

/**
 * RowMenu — hand-rolled `⋯` dropdown (Q1/Q5, PLAN §6.5): useState open/closed
 * + a useEffect outside-click listener, matching ui/dialog.tsx's existing
 * "no Radix" posture rather than introducing @radix-ui/react-dropdown-menu
 * as a second new Radix primitive in this PR. Kept small (~50 lines) —
 * not a generic shadcn-parity primitive.
 */
export function RowMenu({ items, open, onOpenChange, triggerLabel = "Options" }: RowMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    }
    window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, [open, onOpenChange]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={triggerLabel}
        onClick={() => onOpenChange(!open)}
        className="flex h-6 w-6 items-center justify-center rounded-sm text-text-faint hover:bg-white/[.06] hover:text-text-dim"
      >
        ⋯
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-52 animate-popIn rounded-panel border border-border-menu bg-bg-menu py-1 shadow-dropdown"
        >
          {items.map((item, i) =>
            item === ROW_MENU_DIVIDER ? (
              <div key={`divider-${i}`} className="my-1 border-t border-border-hairline" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  onOpenChange(false);
                  item.onSelect();
                }}
                className={cn(
                  "block w-full px-3 py-1.5 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-40",
                  item.danger ? "text-danger hover:bg-danger/10" : "text-text-body hover:bg-white/[.06]"
                )}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
