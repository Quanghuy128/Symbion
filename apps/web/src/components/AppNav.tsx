"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * AppNav — top-level nav. Started as 2 links (Builder + Settings) per
 * docs/loops/multi-provider-settings-STATE.md §3.2's explicit "don't build a
 * generic settings-app-shell framework" framing; gained a 3rd link (Templates)
 * for docs/loops/templates-marketplace-STATE.md — still a small, fixed list,
 * not a generic multi-section nav system.
 */
export function AppNav() {
  const pathname = usePathname();

  const linkClass = (href: string) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${
      pathname === href ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
    }`;

  return (
    <nav className="flex items-center gap-1 border-b border-border px-3 py-2">
      <Link href="/" className={linkClass("/")}>
        Builder
      </Link>
      <Link href="/templates" className={linkClass("/templates")}>
        Templates
      </Link>
      <Link href="/settings" className={linkClass("/settings")}>
        Cài đặt
      </Link>
    </nav>
  );
}
