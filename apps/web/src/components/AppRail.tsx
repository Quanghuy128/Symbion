"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { NavItem } from "./rail/NavItem";
import { DaemonStatusBadge } from "./DaemonStatusBadge";

export interface AppRailProps {
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
}

const RAIL_WIDTH_STORAGE_KEY = "symbion:rail-width";
const DEFAULT_RAIL_WIDTH = 236;
const MIN_RAIL_WIDTH = 180;
const MAX_RAIL_WIDTH = 400;

function clampRailWidth(width: number): number {
  return Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, width));
}

function readStoredRailWidth(): number {
  if (typeof window === "undefined") return DEFAULT_RAIL_WIDTH;
  const raw = window.localStorage.getItem(RAIL_WIDTH_STORAGE_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_RAIL_WIDTH;
  return clampRailWidth(parsed);
}

const PRIMARY_NAV = [
  { href: "/", label: "Builder" },
  { href: "/templates", label: "Templates" },
  { href: "/settings", label: "Settings" },
];

/**
 * AppRail — resizable left rail (236px default, drag-to-resize between
 * 180-400px, persisted to localStorage under "symbion:rail-width") replacing
 * AppNav (top bar) + ProjectSidebar (project list), per
 * docs/loops/symbion-dark-redesign-STATE.md §1.2 (the single largest
 * structural change in this redesign) and design doc §3.0. Reads only
 * `useArtifactStore`'s `projects`/`currentProject` and `usePathname()` — zero
 * coupling to Builder List/Graph internals, so it can wrap still-unstyled
 * inner views (design doc's migration note). Width is intentionally kept out
 * of `useArtifactStore` — it's a pure UI/layout preference, not app state.
 *
 * The vestigial "⌘K" hint and "CẤU HÌNH / ⚙ Cài đặt chung" row from the old
 * ProjectSidebar are deliberately dropped here (Q8) — both had no `onClick`
 * in the as-built code, so there is no working behavior being removed.
 */
export function AppRail({ onCreateProject, onSelectProject }: AppRailProps) {
  const pathname = usePathname();
  const projects = useArtifactStore((s) => s.projects);
  const currentProject = useArtifactStore((s) => s.currentProject);

  // Rail width is a pure UI/layout preference (not app state) — kept
  // component-local + persisted to localStorage, matching the pattern used
  // elsewhere in this redesign (e.g. ProjectView's openMenuId), rather than
  // being added to useArtifactStore.
  const [railWidth, setRailWidth] = useState(DEFAULT_RAIL_WIDTH);
  const isResizingRef = useRef(false);

  useEffect(() => {
    setRailWidth(readStoredRailWidth());
  }, []);

  const handlePointerMove = useCallback((e: MouseEvent) => {
    if (!isResizingRef.current) return;
    const next = clampRailWidth(e.clientX);
    setRailWidth(next);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (!isResizingRef.current) return;
    isResizingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setRailWidth((current) => {
      window.localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, String(current));
      return current;
    });
    window.removeEventListener("mousemove", handlePointerMove);
    window.removeEventListener("mouseup", handlePointerUp);
  }, [handlePointerMove]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      isResizingRef.current = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", handlePointerMove);
      window.addEventListener("mouseup", handlePointerUp);
    },
    [handlePointerMove, handlePointerUp]
  );

  // Cleanup listeners on unmount in case a drag is interrupted (e.g. route change).
  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-r border-border-hairline bg-bg-rail"
      style={{ width: railWidth }}
    >
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

      {/* Resize handle — drag to resize the rail, persisted to localStorage. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize rail"
        onMouseDown={handleResizeStart}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-border-hairline active:bg-border-hairline"
      />
    </aside>
  );
}
