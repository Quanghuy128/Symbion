"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Button variants. `default` is an alias of `primary` and `destructive` of
 * `danger` so existing call sites keep working; prefer the DS names.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-ui font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: "bg-mint text-on-mint hover:bg-mint-strong",
        default: "bg-mint text-on-mint hover:bg-mint-strong",
        outline: "border border-line-strong bg-transparent text-ink hover:bg-surface-hover",
        ghost: "text-ink-2 hover:bg-surface-hover hover:text-ink",
        danger: "bg-danger text-on-danger hover:opacity-90",
        destructive: "bg-danger text-on-danger hover:opacity-90",
        "danger-outline": "border border-danger bg-transparent text-danger-text hover:bg-danger-soft",
      },
      size: {
        sm: "h-control-sm rounded-sm px-2.5 text-label",
        default: "h-control-md px-4",
        lg: "h-control-lg px-6",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Leading icon, 16px, stroke 1.6, decorative. */
  icon?: LucideIcon;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, icon: Icon, children, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {Icon ? <Icon size={16} strokeWidth={1.6} aria-hidden className="shrink-0" /> : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
