"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProjectRunConfig, ProjectStore } from "@symbion/core";
import { callRpc, initDaemonSession } from "@/lib/rpc/client";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { AppRail } from "./AppRail";
import { Toaster } from "./ui/toast";
import { ProvidersPanel } from "./ProvidersPanel";
import { RunSettingsSection } from "./run/RunSettingsSection";

/**
 * SettingsShell — the /settings route's interactive content. Mirrors AppShell's
 * session-bootstrap pattern (token + port from the query string, daemon heartbeat) since
 * this is a separate top-level route, not a child of AppShell — each route that talks to
 * the daemon must independently establish its session (STATE §3.2's "first real second
 * route in apps/web/src/app/").
 *
 * P3 (F7, STATE §18.1/§18.8 F-P3-3): gains project-scoping via `?project=<id>`
 * — the smallest viable "R7 needs a destination" fix, NOT a redesigned
 * per-project settings IA (a fuller one is out of scope, flagged for later).
 * `RunSettingsSection` reads/writes THIS project's `ProjectRunConfig` via the
 * EXISTING `updateSettings` RPC (whole-object read-modify-write, unchanged
 * since P1 — no new RPC). Deliberately does NOT reuse `useArtifactStore`'s
 * shared `currentProject` (that would clobber the main app shell's state
 * across routes) — fetches its own local `ProjectStore` copy via a direct
 * `loadProject` RPC call instead.
 */
export function SettingsShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const startHeartbeat = useArtifactStore((s) => s.startHeartbeat);
  const projects = useArtifactStore((s) => s.projects);
  const loadProjects = useArtifactStore((s) => s.loadProjects);
  const showToast = useArtifactStore((s) => s.showToast);

  const projectId = searchParams.get("project");
  const [project, setProject] = useState<ProjectStore | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const port = Number(window.location.port) || 12802;
    initDaemonSession(port);
    // tokenless-daemon: no `?t=` session token anymore (it broke on F5). Clear a
    // leftover `?t=` from an old bookmarked URL for a clean URL bar — it's ignored
    // either way.
    if (params.has("t")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("t");
      window.history.replaceState(null, "", url.pathname + (url.search !== "?" ? url.search : "") + url.hash);
    }
  }, []);

  useEffect(() => {
    const stop = startHeartbeat();
    return stop;
  }, [startHeartbeat]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const reloadProject = useCallback(async (id: string) => {
    setLoadError(null);
    try {
      const result = await callRpc<{ id: string }, { project: ProjectStore }>("loadProject", { id });
      setProject(result.project);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load project.");
      setProject(null);
    }
  }, []);

  useEffect(() => {
    if (projectId) void reloadProject(projectId);
    else setProject(null);
  }, [projectId, reloadProject]);

  async function handleSaveRunConfig(config: ProjectRunConfig) {
    if (!project) return;
    const nextSettings = { ...project.settings, run: config };
    await callRpc<{ projectId: string; settings: typeof nextSettings }, { project?: ProjectStore }>(
      "updateSettings",
      { projectId: project.id, settings: nextSettings }
    );
    showToast("Execution settings saved.", "success");
    await reloadProject(project.id);
  }

  return (
    <div className="flex h-screen bg-bg-app text-text-body">
      <AppRail
        onCreateProject={() => router.push("/?createProject=1")}
        onSelectProject={(id) => router.push(`/?openProject=${encodeURIComponent(id)}`)}
      />
      <main className="flex-1 overflow-auto p-6">
        <h1 className="mb-4 text-lg font-semibold text-text-strong">AI providers</h1>
        <ProvidersPanel />

        <div className="mt-8">
          <h1 className="mb-3 text-lg font-semibold text-text-strong">Project settings</h1>

          <div className="mb-3">
            <label className="mb-1 block text-xs text-text-muted">Project</label>
            <select
              className="h-9 w-full max-w-xs rounded-sm border border-border-input bg-bg-input px-2 text-sm text-text-body"
              value={projectId ?? ""}
              onChange={(e) => {
                const id = e.target.value;
                router.push(id ? `/settings?project=${encodeURIComponent(id)}` : "/settings");
              }}
            >
              <option value="">Select a project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {loadError && <p className="text-xs text-danger">{loadError}</p>}

          {project && (
            <RunSettingsSection config={project.settings.run} onSave={handleSaveRunConfig} />
          )}
        </div>
      </main>
      <Toaster />
    </div>
  );
}
