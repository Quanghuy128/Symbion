"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  id: string;
  label: React.ReactNode;
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onValueChange: (id: string) => void;
  "aria-label": string;
  idPrefix?: string;
}

export function tabPanelProps(idPrefix: string, id: string) {
  return {
    role: "tabpanel" as const,
    id: `${idPrefix}-panel-${id}`,
    "aria-labelledby": `${idPrefix}-tab-${id}`,
  };
}

/** Underline tabs. role=tablist/tab, roving tabindex, left/right/Home/End keys. */
export function Tabs({ items, value, onValueChange, idPrefix = "tabs", ...rest }: TabsProps) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onValueChange(items[next]!.id);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={rest["aria-label"]} className="flex gap-1 border-b border-line">
      {items.map((item, i) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(item.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "-mb-px inline-flex h-control-md items-center gap-2 border-b-2 px-3 text-label transition-colors",
              selected ? "border-mint text-ink" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {item.label}
            {item.count != null && (
              <span className="rounded-pill bg-surface-hover px-1.5 text-overline text-ink-3">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
