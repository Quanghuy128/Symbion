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
  }, [loadProjects]);

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
