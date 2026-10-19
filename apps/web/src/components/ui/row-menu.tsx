"use client";

import { useEffect, useRef } from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";

export interface RowMenuAction {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  shortcut?: string;
}

/** Divider sentinel — push this between two RowMenuAction entries. */
export const ROW_MENU_DIVIDER = "divider" as const;
export type RowMenuItem = RowMenuAction | typeof ROW_MENU_DIVIDER;

/** Shared surface classes for every popover / menu (row menus, graph menus, palettes). */
export const menuSurfaceClass = "z-menu rounded-md bg-surface p-[5px] shadow-menu";

export function MenuDivider() {
  return <div role="separator" className="my-1 border-t border-line" />;
}

export function MenuItem({ label, onSelect, danger, disabled, icon: Icon, shortcut }: RowMenuAction) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex h-control-sm w-full items-center gap-2 rounded-sm px-2.5 text-left text-label disabled:cursor-not-allowed disabled:opacity-45",
        danger ? "text-danger-text hover:bg-danger-soft" : "text-ink-2 hover:bg-surface-hover hover:text-ink",
      )}
    >
      {Icon ? <Icon size={16} strokeWidth={1.6} aria-hidden className="shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? <span className="font-mono text-code-sm text-ink-muted">{shortcut}</span> : null}
    </button>
  );
}

export interface RowMenuProps {
  items: RowMenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** aria-label for the trigger button; defaults to "Options". */
  triggerLabel?: string;
  /** `bare` = a small icon-only glyph with no box/hover background, for tight
   *  spots like graph nodes where the boxed button covers content. */
  triggerVariant?: "button" | "bare";
}

/**
 * RowMenu — hand-rolled dropdown: useState open/closed + an outside-click
 * listener (no Radix, matching ui/dialog.tsx). Escape closes.
 */
export function RowMenu({ items, open, onOpenChange, triggerLabel = "Options", triggerVariant = "button" }: RowMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open, onOpenChange]);

  return (
    // data-no-node-drag: free-node-dragging's NodeInteractionBoundary uses
    // this marker to exclude interactive leaf controls (the trigger + its popup
    // items) from starting a node-body-drag when rendered inside a graph node —
    // a harmless no-op attribute for RowMenu's other call sites.
    <div ref={containerRef} className="relative" data-no-node-drag>
      {triggerVariant === "bare" ? (
        <button
          type="button"
          aria-label={triggerLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className="flex items-center text-ink-muted hover:text-ink aria-expanded:text-ink"
        >
          <MoreHorizontal size={14} strokeWidth={1.8} aria-hidden />
        </button>
      ) : (
        <IconButton
          aria-label={triggerLabel}
          icon={MoreHorizontal}
          size="sm"
          tooltip={false}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
        />
      )}

      {open && (
        <div role="menu" className={cn("absolute right-0 top-full mt-1 w-52 animate-popIn", menuSurfaceClass)}>
          {items.map((item, i) =>
            item === ROW_MENU_DIVIDER ? (
              <MenuDivider key={`divider-${i}`} />
            ) : (
              <MenuItem
                key={item.label}
                {...item}
                onSelect={() => {
                  onOpenChange(false);
                  item.onSelect();
                }}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
