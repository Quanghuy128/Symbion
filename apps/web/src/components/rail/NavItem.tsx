"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface NavItemProps {
  active: boolean;
  icon?: ReactNode;
  label: string;
  sublabel?: string;
  /** "nav" = primary-nav row (16px tick); "project" = project row (14px tick). */
  variant: "nav" | "project";
  href?: string;
  onClick?: () => void;
  title?: string;
}

/**
 * NavItem — the accent-spine row shared by AppRail's primary nav and its
 * PROJECTS list (design doc §7 "NavItem" component / Do's-and-Don'ts: "use
 * the accent-spine tick pattern for any list of selectable rows representing
 * a navigable identity ... don't invent a second selection-indicator style").
 * Renders a <Link> when `href` is given (real route nav), else a <button>
 * (project rows are client-state selection, not routes).
 */
export function NavItem({ active, icon, label, sublabel, variant, href, onClick, title }: NavItemProps) {
  const tickHeight = variant === "nav" ? "h-4" : "h-3.5"; // 16px / 14px per design doc §3.0
  const content = (
    <>
      <span
        className={cn(
          "absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-[3px] transition-colors",
          tickHeight,
          active ? "bg-brand-accent" : "bg-transparent"
        )}
        aria-hidden
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "flex items-center gap-2 truncate text-[13px]",
            active ? "font-semibold text-text-strong" : "font-medium text-text-dim"
          )}
        >
          {icon}
          {label}
        </span>
        {sublabel && <span className="truncate font-mono text-[10.5px] text-text-faint">{sublabel}</span>}
      </span>
    </>
  );

  const rowClass = cn(
    "relative flex w-full items-center gap-2 rounded-nav-item px-3 py-2 text-left transition-colors",
    active ? "bg-white/[.055]" : "hover:bg-white/[.03]"
  );

  if (href) {
    return (
      <Link href={href} className={rowClass} title={title}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={rowClass} title={title}>
      {content}
    </button>
  );
}
