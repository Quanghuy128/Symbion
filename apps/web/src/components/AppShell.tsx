"use client";

import { useEffect, useState } from "react";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { initDaemonSession } from "@/lib/rpc/client";
import { AppRail } from "./AppRail";
import { EmptyState } from "./EmptyState";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { ImportDialog } from "./ImportDialog";
import { ProjectView } from "./ProjectView";
import { Toaster } from "./ui/toast";

/** S1 — App shell: sidebar + main area. Single SPA-ish shell, all state client-side. */
export function AppShell() {
  const projects = useArtifactStore((s) => s.projects);
  const currentProject = useArtifactStore((s) => s.currentProject);
  const loadProjects = useArtifactStore((s) => s.loadProjects);
  const loadProject = useArtifactStore((s) => s.loadProject);
  const showToast = useArtifactStore((s) => s.showToast);
  const startHeartbeat = useArtifactStore((s) => s.startHeartbeat);

  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Open a project from the rail. loadProject rejects for "ghost projects"
  // (folder still listed but `.symbion/store.json` is gone) — previously the
  // rejection dangled and the click looked dead. Now we catch it and surface a
  // toast; the rail's per-project Remove affordance lets the user forget it.
  async function handleSelectProject(id: string) {
    try {
      await loadProject(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not open project.";
      showToast(message, "error");
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const port = Number(window.location.port) || 12802;
    initDaemonSession(port);
    loadProjects().catch((err) => {
      useArtifactStore.getState().reportConnectionError(err);
    });

    // Cross-route handoff from /templates (templates-marketplace PLAN §3): the
    // Apply-success panel's "Mở dự án" button and the zero-projects state's
    // "Tạo dự án trước" button both land here via query params, read ONCE on
    // mount, then stripped from the URL so a refresh doesn't re-trigger them.
    // Distinct param names from the existing `?t=` session token — they
    // coexist on the same URL with no collision.
    const openProjectId = params.get("openProject");
    const createProjectRequested = params.get("createProject") === "1";
    if (openProjectId) {
      loadProject(openProjectId).catch(() => {
        // best-effort — if the project no longer exists, AppShell falls back
        // to its normal "no current project" empty/list state, no crash.
      });
    }
    if (createProjectRequested) {
      setCreateOpen(true);
    }
    // Strip the transient cross-route handoff params from the URL so a refresh
    // doesn't re-trigger them. (There is no longer a `?t=` session token to strip
    // — tokenless-daemon.) A leftover `?t=` from an old bookmarked URL is simply
    // ignored, so it's harmless to leave, but we clear it too for a clean URL bar.
    if (openProjectId || createProjectRequested || params.has("t")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("t");
      url.searchParams.delete("openProject");
      url.searchParams.delete("createProject");
      window.history.replaceState(null, "", url.pathname + (url.search !== "?" ? url.search : "") + url.hash);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadProjects, loadProject]);

  // E9: periodic ping heartbeat flips daemonConnected on failure/success so
  // the red blocking banner (DaemonStatusBadge) + disabled Save/Publish
  // reflect real connectivity, not just the very first load.
  useEffect(() => {
    const stop = startHeartbeat();
    return stop;
  }, [startHeartbeat]);

  return (
    <div className="flex h-screen bg-bg-app text-text-body">
      <AppRail onCreateProject={() => setCreateOpen(true)} onSelectProject={handleSelectProject} />

      <main className="flex-1 overflow-auto">
        {currentProject ? (
          <ProjectView project={currentProject} />
        ) : projects.length === 0 ? (
          <EmptyState onCreateProject={() => setCreateOpen(true)} onImport={() => setImportOpen(true)} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            Select a project in the sidebar.
          </div>
        )}
      </main>

      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      <Toaster />
    </div>
  );
}
