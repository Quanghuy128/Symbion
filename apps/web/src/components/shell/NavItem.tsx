"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface NavItemProps {
  active: boolean;
  icon?: ReactNode;
  label: string;
  sublabel?: string;
  /** "nav" = primary-nav row; "project" = project row (with path sublabel). */
  variant: "nav" | "project";
  href?: string;
  onClick?: () => void;
  title?: string;
  /** Optional right-aligned action rendered OUTSIDE the clickable row so it is
   *  never nested inside the row's <button>/<Link>. */
  trailing?: ReactNode;
}

/**
 * NavItem — selectable sidebar row. Selected = `surface-hover` ground + `ink`
 * text (and `aria-current`). Renders a <Link> when `href` is given (route
 * nav), else a <button> (project rows are client-state selection).
 */
export function NavItem({ active, icon, label, sublabel, variant, href, onClick, title, trailing }: NavItemProps) {
  const content = (
    <>
      {icon ? <span className="shrink-0 text-ink-muted">{icon}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate text-ui", active ? "font-medium text-ink" : "text-ink-2")}>{label}</span>
        {sublabel && <span className="truncate font-mono text-code-sm text-ink-muted">{sublabel}</span>}
      </span>
    </>
  );

  const rowClass = cn(
    "relative flex w-full items-center gap-3 rounded-md px-3 text-left transition-colors",
    variant === "project" ? "min-h-control-md py-1.5" : "h-control-md",
    active ? "bg-surface-hover" : "hover:bg-surface-hover",
  );

  const row = href ? (
    <Link href={href} className={rowClass} title={title} aria-current={active ? "page" : undefined}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={rowClass} title={title} aria-current={active ? "true" : undefined}>
      {content}
    </button>
  );

  if (!trailing) return row;

  // The trailing action sits in its own always-visible slot (flex sibling, not
  // an overlay) so the row label shortens with an ellipsis instead of running
  // under it.
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">{row}</div>
      <div className="shrink-0">{trailing}</div>
    </div>
  );
}
