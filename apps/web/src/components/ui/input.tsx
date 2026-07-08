"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-sm border border-border-input bg-bg-input px-3 py-1 text-sm text-text-body outline-none placeholder:text-text-faint focus-visible:ring-1 focus-visible:ring-brand-accent",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
