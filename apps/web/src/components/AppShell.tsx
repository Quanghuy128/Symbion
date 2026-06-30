"use client";

import { useEffect, useState } from "react";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { initDaemonSession } from "@/lib/rpc/client";
import { AppNav } from "./AppNav";
import { ProjectSidebar } from "./ProjectSidebar";
import { EmptyState } from "./EmptyState";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { ImportDialog } from "./ImportDialog";
import { ProjectView } from "./ProjectView";

/** S1 — App shell: sidebar + main area. Single SPA-ish shell, all state client-side. */
export function AppShell() {
  const projects = useArtifactStore((s) => s.projects);
  const currentProject = useArtifactStore((s) => s.currentProject);
  const loadProjects = useArtifactStore((s) => s.loadProjects);
  const loadProject = useArtifactStore((s) => s.loadProject);
  const startHeartbeat = useArtifactStore((s) => s.startHeartbeat);

  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("t");
    const port = Number(window.location.port) || 12802;
    if (token) {
      initDaemonSession(token, port);
    }
    loadProjects().catch(() => {
      useArtifactStore.getState().setDaemonConnected(false);
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
    if (openProjectId || createProjectRequested) {
      const url = new URL(window.location.href);
      url.searchParams.delete("openProject");
      url.searchParams.delete("createProject");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
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
    <div className="flex h-screen flex-col">
      <AppNav />
      <div className="flex flex-1 overflow-hidden">
        <ProjectSidebar onCreateProject={() => setCreateOpen(true)} onSelectProject={(id) => loadProject(id)} />

        <main className="flex-1 overflow-auto">
          {currentProject ? (
            <ProjectView project={currentProject} />
          ) : projects.length === 0 ? (
            <EmptyState onCreateProject={() => setCreateOpen(true)} onImport={() => setImportOpen(true)} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Chọn một dự án ở thanh bên.
            </div>
          )}
        </main>
      </div>

      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}
