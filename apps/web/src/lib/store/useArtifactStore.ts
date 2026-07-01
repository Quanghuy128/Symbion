"use client";

import { create } from "zustand";
import type { CanonicalArtifact, ProjectStore } from "@symbion/core";
import { callRpc } from "../rpc/client";
import type {
  ApplyTemplateParams,
  ApplyTemplateResult,
  CreateProjectResult,
  DeleteArtifactResult,
  FetchAuthorTemplatesParams,
  FetchAuthorTemplatesResult,
  ImportArtifactsParams,
  ImportArtifactsResult,
  ListProjectsResult,
  LoadProjectResult,
  PingResult,
  SaveArtifactResult,
} from "../rpc/types";

/** Heartbeat cadence (ms) for the E9 daemon-disconnect detector. */
const HEARTBEAT_INTERVAL_MS = 4000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

interface ArtifactStoreState {
  projects: Array<{ id: string; name: string; path: string }>;
  currentProject: ProjectStore | null;
  daemonConnected: boolean;

  loadProjects: () => Promise<void>;
  createProject: (name: string, path: string) => Promise<ProjectStore>;
  loadProject: (id: string) => Promise<void>;
  saveArtifact: (artifact: CanonicalArtifact) => Promise<void>;
  deleteArtifact: (artifactId: string) => Promise<void>;
  /** Calls the `importArtifacts` RPC and applies its returned (merged)
   *  `project` back onto `currentProject`, mirroring the saveArtifact/
   *  deleteArtifact pattern. Fixes the stale-currentProject-after-import bug
   *  (GitHub Issue #8 review finding): without this, callers that invoke
   *  `createProject` then `importArtifacts` directly via `callRpc` would
   *  render the empty just-created store instead of the merged result. */
  importArtifacts: (params: ImportArtifactsParams) => Promise<ProjectStore>;
  /** Calls the `applyTemplate` RPC (Templates feature). Deliberately does NOT
   *  mutate `currentProject` — Apply targets an arbitrary project, not
   *  necessarily the currently-loaded one (the /templates route has no
   *  "current project" concept at all, per templates-marketplace THINK #6).
   *  Caller (TemplatePreviewModal) reads the full ApplyTemplateResult
   *  directly to render the result panel. */
  applyTemplate: (params: ApplyTemplateParams) => Promise<ApplyTemplateResult>;
  /** Calls the `fetchAuthorTemplates` RPC (templates-authors v2). No caching
   *  here — the in-session cache (THINK #3) lives in TemplatesView's own
   *  state (PLAN §P4: daemon/store stays stateless, always performs a real
   *  fetch when called). This is a thin RPC wrapper, mirroring applyTemplate's
   *  "no currentProject mutation" shape (this RPC doesn't touch any project
   *  at all). */
  fetchAuthorTemplates: (params: FetchAuthorTemplatesParams) => Promise<FetchAuthorTemplatesResult>;
  setDaemonConnected: (connected: boolean) => void;
  /** Starts the periodic `ping` heartbeat that flips daemonConnected on
   *  failure/success (E9). Idempotent — calling twice does not start a
   *  second interval. Returns a stop function. */
  startHeartbeat: () => () => void;
  /** local-only mutation, used by the BuilderDrawer for live preview before Save. */
  upsertLocalArtifact: (artifact: CanonicalArtifact) => void;
}

export const useArtifactStore = create<ArtifactStoreState>((set, get) => ({
  projects: [],
  currentProject: null,
  daemonConnected: true,

  async loadProjects() {
    const result = await callRpc<{}, ListProjectsResult>("listProjects", {});
    set({ projects: result.projects });
  },

  async createProject(name, path) {
    const result = await callRpc<{ name: string; path: string }, CreateProjectResult>("createProject", {
      name,
      path,
    });
    set((state) => ({
      currentProject: result.project,
      projects: [...state.projects, { id: result.project.id, name: result.project.name, path: result.project.path }],
    }));
    return result.project;
  },

  async loadProject(id) {
    const result = await callRpc<{ id: string }, LoadProjectResult>("loadProject", { id });
    set({ currentProject: result.project });
  },

  async saveArtifact(artifact) {
    const project = get().currentProject;
    if (!project) throw new Error("Chưa chọn dự án.");
    const result = await callRpc<{ projectId: string; artifact: CanonicalArtifact }, SaveArtifactResult>(
      "saveArtifact",
      { projectId: project.id, artifact }
    );
    set({ currentProject: result.project });
  },

  async deleteArtifact(artifactId) {
    const project = get().currentProject;
    if (!project) throw new Error("Chưa chọn dự án.");
    const result = await callRpc<{ projectId: string; artifactId: string }, DeleteArtifactResult>(
      "deleteArtifact",
      { projectId: project.id, artifactId }
    );
    set({ currentProject: result.project });
  },

  async importArtifacts(params) {
    const result = await callRpc<ImportArtifactsParams, ImportArtifactsResult>("importArtifacts", params);
    set({ currentProject: result.project });
    return result.project;
  },

  async applyTemplate(params) {
    const result = await callRpc<ApplyTemplateParams, ApplyTemplateResult>("applyTemplate", params);
    // No currentProject mutation on purpose — see interface doc comment above.
    // If the applied-to project happens to already be loaded as currentProject,
    // sync it too so an open Builder view reflects the new draft immediately.
    const current = get().currentProject;
    if (current && current.id === params.projectId) {
      set({ currentProject: result.project });
    }
    return result;
  },

  async fetchAuthorTemplates(params) {
    return callRpc<FetchAuthorTemplatesParams, FetchAuthorTemplatesResult>("fetchAuthorTemplates", params);
  },

  setDaemonConnected(connected) {
    set({ daemonConnected: connected });
  },

  startHeartbeat() {
    if (heartbeatTimer) {
      return () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };
    }
    const tick = async () => {
      try {
        await callRpc<{}, PingResult>("ping", {});
        get().setDaemonConnected(true);
      } catch {
        get().setDaemonConnected(false);
      }
    };
    // Fire immediately so a disconnect is detected without waiting a full interval.
    void tick();
    heartbeatTimer = setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };
  },

  upsertLocalArtifact(artifact) {
    set((state) => {
      if (!state.currentProject) return state;
      const idx = state.currentProject.artifacts.findIndex((a) => a.id === artifact.id);
      const artifacts = [...state.currentProject.artifacts];
      if (idx >= 0) {
        artifacts[idx] = artifact;
      } else {
        artifacts.push(artifact);
      }
      return { currentProject: { ...state.currentProject, artifacts } };
    });
  },
}));
