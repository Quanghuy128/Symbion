"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: LucideIcon;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onValueChange: (v: T) => void;
  "aria-label": string;
  size?: "sm" | "default";
}

/** Two-or-more mutually exclusive modes. radiogroup / radio, roving tabindex, arrow keys. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  size = "default",
  ...rest
}: SegmentedControlProps<T>) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
    if (next < 0) return;
    e.preventDefault();
    onValueChange(options[next]!.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={rest["aria-label"]}
      className="inline-flex items-center gap-0.5 rounded-md bg-sidebar p-0.5"
    >
      {options.map((opt, i) => {
        const checked = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onValueChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-3 text-label transition-colors",
              size === "sm" ? "h-7" : "h-8",
              checked ? "bg-surface-active text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {Icon ? <Icon size={14} strokeWidth={1.6} aria-hidden /> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
