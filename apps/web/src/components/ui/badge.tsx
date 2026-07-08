"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "draft" | "default";
}

/** Small presentational status badge (design doc §7 typography.badge: "9.5-10px/700
 * uppercase, .05em tracking"). Replaces the raw styled `<span>` used for the
 * `·draft` label in ProjectView's row list. */
export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[.05em]",
        variant === "draft" && "bg-warning/15 text-warning",
        variant === "default" && "bg-white/[.06] text-text-dim",
        className
      )}
      {...props}
    />
  );
}
