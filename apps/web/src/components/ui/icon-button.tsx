"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./tooltip";

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Required: an icon-only control has no visible name. */
  "aria-label": string;
  icon: LucideIcon;
  size?: "default" | "sm";
  /** `send` = composer only (unused this pass). */
  variant?: "ghost" | "send";
  /** Wrap in a Tooltip showing the aria-label (default true). */
  tooltip?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, size = "default", variant = "ghost", tooltip = true, className, type = "button", ...props }, ref) => {
    const button = (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-45",
          size === "sm" ? "h-control-sm w-control-sm rounded-sm" : "h-control-md w-control-md",
          variant === "send"
            ? "bg-mint text-on-mint hover:bg-mint-strong"
            : "text-ink-muted hover:bg-surface-hover hover:text-ink",
          className,
        )}
        {...props}
      >
        <Icon size={size === "sm" ? 16 : 18} strokeWidth={1.6} aria-hidden />
      </button>
    );
    return tooltip ? <Tooltip content={props["aria-label"]}>{button}</Tooltip> : button;
  },
);
IconButton.displayName = "IconButton";
