"use client";

import { usePathname } from "next/navigation";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { NavItem } from "./rail/NavItem";
import { DaemonStatusBadge } from "./DaemonStatusBadge";

export interface AppRailProps {
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
}

const PRIMARY_NAV = [
  { href: "/", label: "Builder" },
  { href: "/templates", label: "Templates" },
  { href: "/settings", label: "Settings" },
];

/**
 * AppRail — fixed 236px left rail replacing AppNav (top bar) + ProjectSidebar
 * (project list), per docs/loops/symbion-dark-redesign-STATE.md §1.2 (the
 * single largest structural change in this redesign) and design doc §3.0.
 * Reads only `useArtifactStore`'s `projects`/`currentProject` and
 * `usePathname()` — zero coupling to Builder List/Graph internals, so it can
 * wrap still-unstyled inner views (design doc's migration note).
 *
 * The vestigial "⌘K" hint and "CẤU HÌNH / ⚙ Cài đặt chung" row from the old
 * ProjectSidebar are deliberately dropped here (Q8) — both had no `onClick`
 * in the as-built code, so there is no working behavior being removed.
 */
export function AppRail({ onCreateProject, onSelectProject }: AppRailProps) {
  const pathname = usePathname();
  const projects = useArtifactStore((s) => s.projects);
  const currentProject = useArtifactStore((s) => s.currentProject);

  return (
    <aside className="flex h-full w-[236px] shrink-0 flex-col border-r border-border-hairline bg-bg-rail">
      {/* Brand block */}
      <div className="flex items-center gap-2 px-4 pb-[14px] pt-[18px]">
        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-nav-item bg-brand-accent text-sm font-bold text-white">
          S
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13.5px] font-semibold text-text-strong">Symbion</span>
          <span className="truncate font-mono text-[10.5px] text-text-faint">v0.3.0 · daemon</span>
        </span>
      </div>

      {/* Primary nav */}
      <nav className="flex flex-col gap-0.5 border-t border-border-hairline px-2 py-2">
        {PRIMARY_NAV.map((item) => (
          <NavItem key={item.href} href={item.href} label={item.label} active={pathname === item.href} variant="nav" />
        ))}
      </nav>

      {/* Projects section */}
      <div className="flex min-h-0 flex-1 flex-col border-t border-border-hairline px-2 py-2">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-[10.5px] font-bold uppercase tracking-[.11em] text-text-faint">Projects</span>
          <button
            type="button"
            onClick={onCreateProject}
            aria-label="Tạo dự án mới"
            className="flex h-5 w-5 items-center justify-center rounded-sm text-text-faint hover:bg-white/[.06] hover:text-text-dim"
          >
            +
          </button>
        </div>

        {projects.length === 0 && (
          <p className="px-1 py-1 text-xs text-text-faint">∅ chưa có dự án</p>
        )}

        <ul className="flex-1 space-y-0.5 overflow-y-auto">
          {projects.map((p) => (
            <li key={p.id}>
              <NavItem
                variant="project"
                label={p.name}
                sublabel={p.path}
                title={p.path}
                active={currentProject?.id === p.id}
                onClick={() => onSelectProject(p.id)}
              />
            </li>
          ))}
        </ul>
      </div>

      {/* Daemon status footer */}
      <div className="mt-auto border-t border-border-hairline">
        <DaemonStatusBadge />
      </div>
    </aside>
  );
}
