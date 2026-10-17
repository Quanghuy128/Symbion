"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant =
  | "neutral"
  | "workflow"
  | "agent"
  | "skill"
  | "success"
  | "running"
  | "warning"
  | "danger"
  | "plain"
  /** alias of neutral */
  | "default"
  /** alias of neutral (draft is a normal state, not a warning) */
  | "draft";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

// Full literal class strings (Tailwind JIT cannot see concatenated names).
const TONE: Record<BadgeVariant, { box: string; dot: string }> = {
  neutral: { box: "bg-surface-hover text-ink-3", dot: "bg-ink-muted" },
  default: { box: "bg-surface-hover text-ink-3", dot: "bg-ink-muted" },
  draft: { box: "bg-surface-hover text-ink-3", dot: "bg-ink-muted" },
  workflow: { box: "bg-workflow-soft text-workflow", dot: "bg-workflow" },
  agent: { box: "bg-agent-soft text-agent", dot: "bg-agent" },
  skill: { box: "bg-skill-soft text-skill", dot: "bg-skill" },
  success: { box: "bg-success-soft text-success", dot: "bg-success" },
  running: { box: "bg-running-soft text-running", dot: "bg-running" },
  warning: { box: "bg-warning-soft text-warning", dot: "bg-warning" },
  danger: { box: "bg-danger-soft text-danger-text", dot: "bg-danger" },
  plain: { box: "border border-line-strong text-ink-3", dot: "" },
};

/** Status / kind badge: 22px pill, overline text, leading dot (except `plain`). */
export function Badge({ className, variant = "neutral", children, ...props }: BadgeProps) {
  const tone = TONE[variant];
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-pill px-2 text-overline uppercase",
        tone.box,
        className,
      )}
      {...props}
    >
      {variant !== "plain" && <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />}
      {children}
    </span>
  );
}
