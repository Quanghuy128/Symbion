"use client";

import { create } from "zustand";
import type { CanonicalArtifact, ProjectStore } from "@symbion/core";
import { callRpc, DaemonRpcError, hasSession } from "../rpc/client";
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

/** Symbion dark left-rail redesign (Q4): minimal single-slot toast state —
 *  not a queue/list, matches README's "one confirm-toast per action" usage
 *  pattern (docs/loops/symbion-dark-redesign-STATE.md §6.2 Q4). */
/** Toast variant union. interactive-graph (design §5/§7) adds `warning` (⚠) and
 *  `neutral` (plain) alongside the pre-existing `success` (✓) / `error` (✕).
 *  This extends the showToast SIGNATURE only — NOT the store's data shape (A2). */
export type ToastVariant = "success" | "error" | "warning" | "neutral";

export interface ToastState {
  id: string;
  message: string;
  variant?: ToastVariant;
}

interface ArtifactStoreState {
  projects: Array<{ id: string; name: string; path: string }>;
  currentProject: ProjectStore | null;
  /** Derived from (daemonReachable && sessionValid) — kept for the ~11
   *  existing consumers gating Save/Publish/Generate buttons on "is the
   *  daemon fully usable right now," which is exactly this combination
   *  regardless of *which* sub-condition failed. Never set directly by
   *  callers anymore — see reportConnectionOk/reportConnectionError below
   *  (boot-terminal-ux PLAN §P1). */
  daemonConnected: boolean;
  /** True once the daemon process itself has answered the last `ping`
   *  (tokenless liveness probe). False means the daemon is genuinely
   *  unreachable (process down, network error) — distinct from a merely
   *  invalid/expired session (see sessionValid below). */
  daemonReachable: boolean;
  /** True once the last authenticated RPC call (e.g. `listProjects`)
   *  actually succeeded. False while `daemonReachable` is true means: the
   *  daemon process is up, but this browser tab's session token is
   *  missing/stale/foreign — e.g. after an F5 refresh that lost the
   *  in-memory token, or a tab left open across a daemon restart
   *  (boot-terminal-ux FR-A.2/A.2b). */
  sessionValid: boolean;
  /** Q4: the only store-shape addition in this feature. Single-slot — a new
   *  showToast() call replaces whatever toast is currently showing rather
   *  than queuing. null = no toast visible. */
  toast: ToastState | null;

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
  /** @deprecated kept only as a thin wrapper for any lingering direct callers;
   *  prefer reportConnectionOk/reportConnectionError, which correctly derive
   *  daemonReachable/sessionValid instead of guessing a single boolean. */
  setDaemonConnected: (connected: boolean) => void;
  /** Call after any authenticated RPC call succeeds — marks the daemon as
   *  fully reachable and the session as valid (boot-terminal-ux PLAN §P1). */
  reportConnectionOk: () => void;
  /** Call after any RPC call fails — classifies the failure so the UI can
   *  distinguish "daemon is down" from "session token is stale/invalid"
   *  (FR-A.2/A.2b). A `DaemonRpcError` with code `"unauthorized"` means the
   *  daemon answered but rejected the token (daemonReachable stays true,
   *  sessionValid becomes false). Any other error (network throw, timeout,
   *  non-401 error) fails closed: both flags become false — an unknown
   *  failure mode must never be silently upgraded to "connected." */
  reportConnectionError: (err: unknown) => void;
  /** Q4: shows a single toast, replacing any currently-visible one. */
  showToast: (message: string, variant?: ToastVariant) => void;
  /** Q4: dismisses the current toast (auto-dismiss timer or manual close). */
  dismissToast: () => void;
  /** Starts the periodic `ping` heartbeat that classifies daemonReachable/
   *  sessionValid (and the derived daemonConnected) on every tick (E9,
   *  extended per FR-A.2b). Idempotent — calling twice does not start a
   *  second interval. Returns a stop function. */
  startHeartbeat: () => () => void;
  /** Performs an immediate `ping` RPC and updates `daemonConnected` from the
   *  result, independent of the heartbeat interval. Used by the DaemonRibbon
   *  "Thử lại" (retry) button so the user gets an instant reconnect check
   *  instead of waiting up to a full HEARTBEAT_INTERVAL_MS (code-reviewer #2).
   *  Reuses the same `ping` RPC the heartbeat tick uses — no new daemon RPC. */
  pingNow: () => Promise<boolean>;
  /** local-only mutation, used by the BuilderDrawer for live preview before Save. */
  upsertLocalArtifact: (artifact: CanonicalArtifact) => void;
}

export const useArtifactStore = create<ArtifactStoreState>((set, get) => ({
  projects: [],
  currentProject: null,
  daemonConnected: true,
  daemonReachable: true,
  sessionValid: true,
  toast: null,

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
    if (connected) {
      get().reportConnectionOk();
    } else {
      set({ daemonReachable: false, sessionValid: false, daemonConnected: false });
    }
  },

  reportConnectionOk() {
    set({ daemonReachable: true, sessionValid: true, daemonConnected: true });
  },

  reportConnectionError(err) {
    if (err instanceof DaemonRpcError && err.code === "unauthorized") {
      // Daemon answered (it's up) but rejected the token: stale/foreign
      // session, not a dead daemon (FR-A.2/EC-A.1/EC-A.5).
      set({ daemonReachable: true, sessionValid: false, daemonConnected: false });
      return;
    }
    // Fail closed: network throw, timeout, or any other unrecognized error
    // shape is treated as "not usable" — never silently upgraded to connected.
    set({ daemonReachable: false, sessionValid: false, daemonConnected: false });
  },

  showToast(message, variant) {
    set({ toast: { id: crypto.randomUUID(), message, variant } });
  },

  dismissToast() {
    set({ toast: null });
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
      // Step 1: tokenless liveness probe — the ONLY thing that answers "is
      // the daemon process even alive," independent of session state.
      try {
        await callRpc<{}, PingResult>("ping", {});
      } catch (err) {
        get().reportConnectionError(err);
        return;
      }

      // Step 2: purely client-side check, no network call needed. After an
      // F5 refresh, cachedToken is genuinely null (module reinitializes) —
      // this is the exact EC-A.5 trigger. Short-circuits before wasting a
      // network round-trip on a call we already know will 401.
      if (!hasSession()) {
        set({ daemonReachable: true, sessionValid: false, daemonConnected: false });
        return;
      }

      // Step 3: probe an authenticated call. Reuses the same existing
      // `listProjects` read used elsewhere — no new RPC method. A 401 here
      // with a valid-looking session (stale/foreign token, EC-A.1) lands in
      // reportConnectionError via the same messaging path as step 2.
      try {
        await callRpc<{}, ListProjectsResult>("listProjects", {});
        get().reportConnectionOk();
      } catch (err) {
        get().reportConnectionError(err);
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

  async pingNow() {
    try {
      await callRpc<{}, PingResult>("ping", {});
      get().setDaemonConnected(true);
      return true;
    } catch {
      get().setDaemonConnected(false);
      return false;
    }
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
