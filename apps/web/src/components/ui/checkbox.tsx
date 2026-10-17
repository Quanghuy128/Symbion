"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type ControlProps = React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode };

/**
 * Checkbox — native input restyled (appearance-none) so state, keyboard and
 * form semantics stay native. Unchecked border is `ink-muted` (non-text
 * contrast >= 3:1), not line-strong. A `label` makes the whole row clickable.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, ControlProps>(
  ({ className, label, ...props }, ref) => {
    const control = (
      <span className={cn("relative inline-flex h-[18px] w-[18px] shrink-0", label ? "" : className)}>
        <input
          ref={ref}
          type="checkbox"
          className="peer h-[18px] w-[18px] shrink-0 cursor-pointer appearance-none rounded-xs border border-ink-muted bg-transparent transition-colors checked:border-mint checked:bg-mint disabled:cursor-not-allowed disabled:opacity-45"
          {...props}
        />
        <Check
          size={14}
          strokeWidth={2.2}
          aria-hidden
          className="pointer-events-none absolute left-0.5 top-0.5 hidden text-on-mint peer-checked:block"
        />
      </span>
    );
    if (!label) return control;
    return (
      <label className={cn("inline-flex cursor-pointer items-center gap-2 text-ui text-ink-2", className)}>
        {control}
        {label}
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";

export const Radio = React.forwardRef<HTMLInputElement, ControlProps>(({ className, label, ...props }, ref) => {
  const control = (
    <span className={cn("relative inline-flex h-[18px] w-[18px] shrink-0", label ? "" : className)}>
      <input
        ref={ref}
        type="radio"
        className="peer h-[18px] w-[18px] shrink-0 cursor-pointer appearance-none rounded-full border border-ink-muted bg-transparent transition-colors checked:border-mint disabled:cursor-not-allowed disabled:opacity-45"
        {...props}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 hidden h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-mint peer-checked:block"
      />
    </span>
  );
  if (!label) return control;
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-ui text-ink-2", className)}>
      {control}
      {label}
    </label>
  );
});
Radio.displayName = "Radio";
