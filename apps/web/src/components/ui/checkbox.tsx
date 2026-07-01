"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Minimal checkbox primitive (shadcn-style), same spirit as ui/input.tsx —
 *  a plain native control with the project's standard focus-ring/border
 *  treatment, no external Radix dependency for this small v1 surface.
 *  New for templates-authors (PLAN/design: "if apps/web/src/components/ui/
 *  has no Checkbox yet, this is a new shadcn primitive to add"). */
export const Checkbox = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "h-4 w-4 shrink-0 rounded border border-border accent-primary outline-none focus-visible:ring-1 focus-visible:ring-primary",
        className
      )}
      {...props}
    />
  )
);
Checkbox.displayName = "Checkbox";
