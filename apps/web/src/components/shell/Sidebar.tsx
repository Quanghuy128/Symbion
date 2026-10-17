"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Folder,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import { DaemonStatusBadge } from "@/components/DaemonStatusBadge";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";
import { NavItem } from "./NavItem";

export interface SidebarProps {
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
}

export const RAIL_WIDTH_STORAGE_KEY = "symbion:rail-width";
export const RAIL_COLLAPSED_STORAGE_KEY = "symbion:rail-collapsed";
const DEFAULT_RAIL_WIDTH = 288;
const MIN_RAIL_WIDTH = 240;
const MAX_RAIL_WIDTH = 400;
/** Below this viewport width the sidebar is forced to the 56px icon rail. */
const WIDE_QUERY = "(min-width: 1100px)";

function clampRailWidth(width: number): number {
  return Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, width));
}

function readStoredRailWidth(): number {
  try {
    const raw = window.localStorage.getItem(RAIL_WIDTH_STORAGE_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? clampRailWidth(parsed) : DEFAULT_RAIL_WIDTH;
  } catch {
    return DEFAULT_RAIL_WIDTH;
  }
}

function readStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(RAIL_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

const PRIMARY_NAV: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/templates", label: "Templates", icon: LayoutGrid },
  { href: "/settings", label: "Settings", icon: Settings },
];

/**
 * Sidebar — the app's left navigation. Shows only data that exists: logo,
 * primary nav (Project, Templates, Settings), the project list and the
 * daemon status row.
 *
 * Width: drag-to-resize between 240-400px (default 288), persisted under
 * "symbion:rail-width". Collapse: a toggle button (persisted under
 * "symbion:rail-collapsed") folds it to a 56px icon rail; viewports narrower
 * than 1100px are forced to the icon rail. All state is local UI preference —
 * nothing here touches the artifact store, the daemon or the filesystem.
 */
export function Sidebar({ onCreateProject, onSelectProject }: SidebarProps) {
  const pathname = usePathname();
  const projects = useArtifactStore((s) => s.projects);
  const currentProject = useArtifactStore((s) => s.currentProject);
  const removeProject = useArtifactStore((s) => s.removeProject);
  const showToast = useArtifactStore((s) => s.showToast);

  // Forget a project directly from the sidebar via its delete icon — reachable
  // WITHOUT opening it, so "ghost projects" (folder gone, un-openable) are
  // still removable. Mirrors ProjectView.handleRemoveProject's confirm + toast.
  const handleRemoveProject = useCallback(
    async (id: string, name: string) => {
      if (
        !window.confirm(
          `Remove "${name}" from Symbion? This only forgets it from the list — no files on disk are deleted.`,
        )
      ) {
        return;
      }
      try {
        await removeProject(id);
        showToast("Project removed from list.", "success");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Remove failed — reason unknown.";
        showToast(message, "error");
      }
    },
    [removeProject, showToast],
  );

  const wide = useMediaQuery(WIDE_QUERY, true);
  const [userCollapsed, setUserCollapsed] = useState(false);
  const collapsed = !wide || userCollapsed;

  const [railWidth, setRailWidth] = useState(DEFAULT_RAIL_WIDTH);
  const isResizingRef = useRef(false);

  useEffect(() => {
    setRailWidth(readStoredRailWidth());
    setUserCollapsed(readStoredCollapsed());
  }, []);

  const toggleCollapsed = useCallback(() => {
    setUserCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(RAIL_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable — keep in-memory state only */
      }
      return next;
    });
  }, []);

  const handlePointerMove = useCallback((e: MouseEvent) => {
    if (!isResizingRef.current) return;
    setRailWidth(clampRailWidth(e.clientX));
  }, []);

  const handlePointerUp = useCallback(() => {
    if (!isResizingRef.current) return;
    isResizingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setRailWidth((current) => {
      try {
        window.localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, String(current));
      } catch {
        /* storage unavailable */
      }
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
    [handlePointerMove, handlePointerUp],
  );

  // Cleanup listeners on unmount in case a drag is interrupted (e.g. route change).
  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  const toggleButton = (
    <IconButton
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      icon={collapsed ? PanelLeftOpen : PanelLeftClose}
      size="sm"
      onClick={toggleCollapsed}
    />
  );

  if (collapsed) {
    return (
      <aside
        data-collapsed="true"
        className="relative z-rail flex h-full w-rail shrink-0 flex-col items-center border-r border-line bg-sidebar"
      >
        <div className="flex flex-col items-center gap-2 pb-3 pt-4">
          <Logo wordmark={false} />
          {wide && toggleButton}
        </div>

        <nav aria-label="Primary" className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto border-t border-line px-2 py-3">
          <RailLink href="/" label="Project" icon={Folder} active={pathname === "/"} />
          <IconButton aria-label="New project" icon={Plus} size="sm" onClick={onCreateProject} />
          {PRIMARY_NAV.map((item) => (
            <RailLink key={item.href} href={item.href} label={item.label} icon={item.icon} active={pathname === item.href} />
          ))}
          {projects.length > 0 && <div role="separator" className="my-1 h-px w-6 bg-line" />}
          {projects.map((p) => {
            const active = currentProject?.id === p.id;
            return (
              <Tooltip key={p.id} content={p.name} side="right">
                <button
                  type="button"
                  aria-label={p.name}
                  aria-current={active ? "true" : undefined}
                  title={p.path}
                  onClick={() => onSelectProject(p.id)}
                  className={cn(
                    "flex h-control-md w-control-md items-center justify-center rounded-md text-label uppercase transition-colors",
                    active ? "bg-surface-hover text-ink" : "text-ink-muted hover:bg-surface-hover hover:text-ink",
                  )}
                >
                  {p.name.charAt(0)}
                </button>
              </Tooltip>
            );
          })}
        </nav>

        <div className="mt-auto w-full border-t border-line">
          <DaemonStatusBadge compact />
        </div>
      </aside>
    );
  }

  return (
    <aside
      data-collapsed="false"
      className="relative z-rail flex h-full shrink-0 flex-col border-r border-line bg-sidebar"
      style={{ width: railWidth }}
    >
      <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-4">
        <Logo />
        {toggleButton}
      </div>

      <nav aria-label="Primary" className="flex min-h-0 flex-1 flex-col gap-0.5 border-t border-line px-2 py-3">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <NavItem variant="nav" href="/" label="Project" icon={<Folder size={16} strokeWidth={1.6} aria-hidden />} active={pathname === "/"} />
          </div>
          <IconButton aria-label="New project" icon={Plus} size="sm" onClick={onCreateProject} />
        </div>

        <div className="min-h-0 overflow-y-auto">
          {projects.length === 0 ? (
            <p className="px-3 py-1.5 text-caption text-ink-muted">No projects yet</p>
          ) : (
            <>
              <p className="px-3 pb-1 pt-2 text-overline uppercase text-ink-muted">Projects</p>
              <ul className="space-y-0.5">
                {projects.map((p) => (
                  <li key={p.id}>
                    <NavItem
                      variant="project"
                      label={p.name}
                      sublabel={p.path}
                      title={p.path}
                      active={currentProject?.id === p.id}
                      onClick={() => onSelectProject(p.id)}
                      trailing={
                        <IconButton
                          aria-label={`Remove ${p.name}`}
                          title={`Remove "${p.name}" from Symbion`}
                          icon={Trash2}
                          size="sm"
                          tooltip={false}
                          onClick={() => handleRemoveProject(p.id, p.name)}
                          className="hover:bg-danger-soft hover:text-danger-text"
                        />
                      }
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="mt-1 space-y-0.5">
          {PRIMARY_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={<Icon size={16} strokeWidth={1.6} aria-hidden />}
                active={pathname === item.href}
                variant="nav"
              />
            );
          })}
        </div>
      </nav>

      <div className="mt-auto border-t border-line">
        <DaemonStatusBadge />
      </div>

      {/* Resize handle — drag to resize the sidebar, persisted to localStorage. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize rail"
        onMouseDown={handleResizeStart}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-line-strong active:bg-line-strong"
      />
    </aside>
  );
}

function RailLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
}) {
  return (
    <Tooltip content={label} side="right">
      <Link
        href={href}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-control-md w-control-md items-center justify-center rounded-md transition-colors",
          active ? "bg-surface-hover text-ink" : "text-ink-muted hover:bg-surface-hover hover:text-ink",
        )}
      >
        <Icon size={18} strokeWidth={1.6} aria-hidden />
      </Link>
    </Tooltip>
  );
}
