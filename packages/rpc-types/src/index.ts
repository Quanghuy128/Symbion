/**
 * @symbion/rpc-types — the single source of truth for the localhost RPC
 * request/response shapes shared between apps/daemon (server) and apps/web
 * (client). Type-only, no runtime code, no Node/browser dependency beyond
 * the pure @symbion/core IR types it re-exports for convenience.
 *
 * apps/daemon/src/rpc/contract.ts re-exports everything from here (it IS
 * this package's content from the daemon's perspective). apps/web imports
 * directly from "@symbion/rpc-types". Neither side hand-mirrors the other.
 */
import type {
  CanonicalArtifact,
  DiffFile,
  ProjectSettings,
  ProjectStore,
  PublishResult,
  RenderedFile,
  TargetId,
} from "@symbion/core";

export interface PingParams {}
export interface PingResult {
  ok: true;
  version: string;
  port: number;
}

export interface BrowseFolderParams {
  startPath?: string;
}
export type BrowseFolderResult = { path: string } | { cancelled: true };

export interface ValidatePathParams {
  path: string;
}
export interface ValidatePathResult {
  exists: boolean;
  isDir: boolean;
  isGitRepo: boolean;
  hasClaudeDir: boolean;
  hasAgentsMd: boolean;
  writable: boolean;
}

export interface ListProjectsParams {}
export interface ListProjectsResult {
  projects: Array<{ id: string; name: string; path: string }>;
}

export interface CreateProjectParams {
  name: string;
  path: string;
}
export interface CreateProjectResult {
  project: ProjectStore;
}

export interface LoadProjectParams {
  id: string;
}
export interface LoadProjectResult {
  project: ProjectStore;
}

export interface SaveArtifactParams {
  projectId: string;
  artifact: CanonicalArtifact;
}
export interface SaveArtifactResult {
  project: ProjectStore;
}

export interface DeleteArtifactParams {
  projectId: string;
  artifactId: string;
}
export interface DeleteArtifactResult {
  project: ProjectStore;
}

export interface UpdateSettingsParams {
  projectId?: string;
  settings?: ProjectSettings;
  globalConfig?: Record<string, unknown>;
}
export interface UpdateSettingsResult {
  project?: ProjectStore;
}

export interface ScanClaudeDirParams {
  path: string;
}
export interface ScanClaudeDirResult {
  parsed: {
    agents: CanonicalArtifact[];
    commands: CanonicalArtifact[];
    hooks: Array<{ relPath: string; content: string }>;
    settings?: { relPath: string; content: string };
    skipped: Array<{ relPath: string; reason: string }>;
  };
}

export interface ImportArtifactsParams {
  projectId: string;
  selectedIds: string[];
  scanned: CanonicalArtifact[];
}
export interface ImportArtifactsResult {
  project: ProjectStore;
}

export interface RenderParams {
  projectId: string;
  targets: TargetId[];
  version: string;
}
export interface RenderResult {
  files: RenderedFile[];
}

export interface ComputeDiffParams {
  projectId: string;
  targets: TargetId[];
  version: string;
}
export interface ComputeDiffResult {
  files: DiffFile[];
  conflicts: number;
}

export interface WriteFileSelection {
  relPath: string;
  resolution?: "overwrite" | "keep";
}
export interface WriteParams {
  projectId: string;
  version: string;
  targets: TargetId[];
  files: WriteFileSelection[];
}
export interface WriteResult {
  results: PublishResult[];
  backupDir: string;
  logEntryWritten: true;
}

export interface GitStatusParams {
  path: string;
}
export interface GitStatusResult {
  isRepo: boolean;
  clean: boolean;
  changedFiles: string[];
}

export interface RenderRunCommandParams {
  command: string;
  requirements?: string;
  model?: string;
  option?: string;
}
export interface RenderRunCommandResult {
  prompt: string;
}

export type RpcMethod =
  | "ping"
  | "browseFolder"
  | "validatePath"
  | "listProjects"
  | "createProject"
  | "loadProject"
  | "saveArtifact"
  | "deleteArtifact"
  | "updateSettings"
  | "scanClaudeDir"
  | "importArtifacts"
  | "render"
  | "computeDiff"
  | "write"
  | "gitStatus"
  | "renderRunCommand";

export interface RpcRequest<M extends RpcMethod = RpcMethod, P = unknown> {
  method: M;
  params: P;
}

export interface RpcErrorBody {
  error: { code: string; message: string };
}

// Re-exported for convenience so consumers of @symbion/rpc-types don't also
// need a separate import from @symbion/core for the IR types referenced above.
export type { CanonicalArtifact, DiffFile, ProjectSettings, ProjectStore, PublishResult, RenderedFile, TargetId };
