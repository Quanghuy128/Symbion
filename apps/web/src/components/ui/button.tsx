"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "lg";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-sm text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
          variant === "default" && "bg-brand-accent text-white hover:opacity-90",
          variant === "outline" && "border border-border-input bg-transparent text-text-body hover:bg-white/[.06]",
          variant === "ghost" && "text-text-body hover:bg-white/[.06]",
          variant === "destructive" && "bg-danger text-white hover:opacity-90",
          size === "default" && "h-9 px-4",
          size === "sm" && "h-8 px-3 text-xs",
          size === "lg" && "h-10 px-6",
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
