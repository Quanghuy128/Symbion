import { existsSync, statSync } from "node:fs";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import {
  computeDiff as coreComputeDiff,
  parseClaudeDir,
  renderArtifacts,
  renderRunCommand as coreRenderRunCommand,
  validateAllArtifacts,
  type CanonicalArtifact,
  type DiffFile,
  type ProjectStore,
  type RenderedFile,
  type TargetId,
} from "@symbion/core";
import {
  createProjectStore,
  loadGlobalConfig,
  loadProjectStore,
  projectStoreExists,
  saveGlobalConfig,
  saveProjectStore,
} from "../store/store.js";
import { appendPublishLogEntry } from "../store/publishLog.js";
import { gitStatus as coreGitStatus } from "../git/status.js";
import { browseFolder as nativeBrowseFolder } from "../fs/folderPick.js";
import {
  extractForeignAgentsMdContent,
  readAgentsMd,
  readClaudeDirFilemap,
  readTargetFiles,
} from "../fs/readTargetFiles.js";
import { writeFiles, type WriteFileTask } from "../fs/writeFiles.js";
import type * as contract from "./contract.js";

function randomId(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const tpl = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return tpl.replace(/[xy]/g, (c) =>
    c === "y" ? ((Math.floor(Math.random() * 4) + 8) % 16).toString(16) : hex()
  );
}

function findProjectPath(projectId: string): string {
  const config = loadGlobalConfig();
  const entry = config.projects.find((p) => p.id === projectId);
  if (!entry) {
    throw new Error(`Không tìm thấy project: ${projectId}`);
  }
  return entry.path;
}

export class RpcError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export const handlers = {
  ping(_params: contract.PingParams, ctx: { port: number; version: string }): contract.PingResult {
    return { ok: true, version: ctx.version, port: ctx.port };
  },

  async browseFolder(params: contract.BrowseFolderParams): Promise<contract.BrowseFolderResult> {
    const result = await nativeBrowseFolder(params.startPath);
    if (result.cancelled || !result.path) return { cancelled: true };
    return { path: result.path };
  },

  validatePath(params: contract.ValidatePathParams): contract.ValidatePathResult {
    const { path } = params;
    const exists = existsSync(path);
    let isDir = false;
    let writable = false;
    if (exists) {
      const stat = statSync(path);
      isDir = stat.isDirectory();
      try {
        accessSync(path, constants.W_OK);
        writable = true;
      } catch {
        writable = false;
      }
    }
    const isGitRepo = exists && isDir && existsSync(join(path, ".git"));
    const hasClaudeDir = exists && isDir && existsSync(join(path, ".claude"));
    const hasAgentsMd = exists && isDir && existsSync(join(path, "AGENTS.md"));

    return { exists, isDir, isGitRepo, hasClaudeDir, hasAgentsMd, writable };
  },

  listProjects(_params: contract.ListProjectsParams): contract.ListProjectsResult {
    const config = loadGlobalConfig();
    return { projects: config.projects };
  },

  createProject(params: contract.CreateProjectParams): contract.CreateProjectResult {
    const { name, path } = params;
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      throw new RpcError("invalid-path", "Đường dẫn không tồn tại hoặc không phải thư mục.");
    }
    if (projectStoreExists(path)) {
      throw new RpcError("already-a-project", "Thư mục này đã là một dự án Symbion.");
    }

    const id = randomId();
    const project = createProjectStore(path, name, id);

    const config = loadGlobalConfig();
    config.projects.push({ id, name, path });
    config.lastProjectId = id;
    saveGlobalConfig(config);

    return { project };
  },

  loadProject(params: contract.LoadProjectParams): contract.LoadProjectResult {
    const path = findProjectPath(params.id);
    return { project: loadProjectStore(path) };
  },

  saveArtifact(params: contract.SaveArtifactParams): contract.SaveArtifactResult {
    const path = findProjectPath(params.projectId);
    const store = loadProjectStore(path);
    const idx = store.artifacts.findIndex((a) => a.id === params.artifact.id);
    const now = new Date().toISOString();
    const artifact: CanonicalArtifact = {
      ...params.artifact,
      meta: { ...params.artifact.meta, updatedAt: now },
    };

    // Server-side validation (defense in depth — never trust the client).
    // Validate against the *would-be* full artifact set (siblings + this
    // artifact updated/inserted) so duplicate-name etc. checks are accurate.
    const candidateSiblings = store.artifacts.filter((a) => a.id !== artifact.id);
    const issues = validateAllArtifacts([...candidateSiblings, artifact]);
    const blocking = issues.filter((i) => i.level === "error" && i.artifactId === artifact.id);
    if (blocking.length > 0) {
      throw new RpcError(
        "validation-failed",
        `Không thể lưu — vi phạm lint: ${blocking.map((i) => i.message).join("; ")}`
      );
    }

    if (idx >= 0) {
      store.artifacts[idx] = artifact;
    } else {
      store.artifacts.push(artifact);
    }
    saveProjectStore(path, store);
    return { project: store };
  },

  deleteArtifact(params: contract.DeleteArtifactParams): contract.DeleteArtifactResult {
    const path = findProjectPath(params.projectId);
    const store = loadProjectStore(path);
    // v1: removing an artifact in Studio does NOT delete its on-disk file silently
    // (STATE §7B) — this only removes it from the in-app store.
    store.artifacts = store.artifacts.filter((a) => a.id !== params.artifactId);
    saveProjectStore(path, store);
    return { project: store };
  },

  updateSettings(params: contract.UpdateSettingsParams): contract.UpdateSettingsResult {
    if (params.projectId && params.settings) {
      const path = findProjectPath(params.projectId);
      const store = loadProjectStore(path);
      store.settings = params.settings;
      saveProjectStore(path, store);
      return { project: store };
    }
    if (params.globalConfig) {
      const config = loadGlobalConfig();
      Object.assign(config, params.globalConfig);
      saveGlobalConfig(config);
    }
    return {};
  },

  scanClaudeDir(params: contract.ScanClaudeDirParams): contract.ScanClaudeDirResult {
    const filemap = readClaudeDirFilemap(params.path);
    const parsed = parseClaudeDir(filemap);
    return { parsed };
  },

  importArtifacts(params: contract.ImportArtifactsParams): contract.ImportArtifactsResult {
    const path = findProjectPath(params.projectId);
    const store = loadProjectStore(path);
    const selected = params.scanned.filter((a) => params.selectedIds.includes(a.id));

    // Server-side validation (defense in depth) over the resulting merged
    // artifact set. Imported artifacts that would create blocking lint
    // errors (e.g. duplicate name, missing required fields) are rejected
    // wholesale rather than silently persisted invalid.
    const existingOthers = store.artifacts.filter(
      (a) => !selected.some((s) => s.id === a.id)
    );
    const merged = [...existingOthers, ...selected];
    const issues = validateAllArtifacts(merged);
    const selectedIds = new Set(selected.map((a) => a.id));
    const blocking = issues.filter((i) => i.level === "error" && i.artifactId && selectedIds.has(i.artifactId));
    if (blocking.length > 0) {
      throw new RpcError(
        "validation-failed",
        `Không thể nhập — vi phạm lint: ${blocking.map((i) => i.message).join("; ")}`
      );
    }

    for (const artifact of selected) {
      const idx = store.artifacts.findIndex((a) => a.id === artifact.id);
      if (idx >= 0) {
        store.artifacts[idx] = artifact;
      } else {
        store.artifacts.push(artifact);
      }
    }
    saveProjectStore(path, store);
    return { project: store };
  },

  render(params: contract.RenderParams): contract.RenderResult {
    const path = findProjectPath(params.projectId);
    const store = loadProjectStore(path);
    const files: RenderedFile[] = [];
    for (const target of params.targets) {
      const existingForeignContent =
        target === "codex" ? extractForeignAgentsMdContent(readAgentsMd(path)) : undefined;
      files.push(
        ...renderArtifacts(store.artifacts, target, { version: params.version, existingForeignContent })
      );
    }
    return { files };
  },

  computeDiff(params: contract.ComputeDiffParams): contract.ComputeDiffResult {
    const path = findProjectPath(params.projectId);
    const store = loadProjectStore(path);
    const allFiles: DiffFile[] = [];

    for (const target of params.targets) {
      const existingForeignContent =
        target === "codex" ? extractForeignAgentsMdContent(readAgentsMd(path)) : undefined;
      const rendered = renderArtifacts(store.artifacts, target, {
        version: params.version,
        existingForeignContent,
      });
      const mergedTargetRelPaths = target === "codex" ? new Set(rendered.map((f) => f.relPath)) : new Set<string>();
      const onDisk = readTargetFiles(path, rendered.map((f) => f.relPath), mergedTargetRelPaths);
      allFiles.push(...coreComputeDiff(rendered, onDisk));
    }

    const conflicts = allFiles.filter((f) => f.status === "conflict").length;
    return { files: allFiles, conflicts };
  },

  write(params: contract.WriteParams): contract.WriteResult {
    const path = findProjectPath(params.projectId);
    const store = loadProjectStore(path);

    const diffResult = handlers.computeDiff({
      projectId: params.projectId,
      targets: params.targets,
      version: params.version,
    });

    const selectionByPath = new Map(params.files.map((f) => [f.relPath, f.resolution]));

    const renderedByPath = new Map<string, { content: string; contentHash: string; artifactIds: string[] }>();
    for (const target of params.targets) {
      const existingForeignContent =
        target === "codex" ? extractForeignAgentsMdContent(readAgentsMd(path)) : undefined;
      for (const file of renderArtifacts(store.artifacts, target, {
        version: params.version,
        existingForeignContent,
      })) {
        renderedByPath.set(file.relPath, file);
      }
    }

    const tasks: WriteFileTask[] = [];
    for (const diffFile of diffResult.files) {
      if (!selectionByPath.has(diffFile.relPath)) continue; // not selected by user -> skip
      const rendered = renderedByPath.get(diffFile.relPath);
      if (!rendered) continue;

      // Determine which target this relPath belongs to (best-effort: Claude paths are
      // .claude/...; everything else (AGENTS.md) is codex).
      const target: TargetId = diffFile.relPath.startsWith(".claude/") ? "claude" : "codex";

      tasks.push({
        target,
        relPath: diffFile.relPath,
        content: rendered.content,
        contentHash: rendered.contentHash,
        artifactId: rendered.artifactIds[0],
        resolution: selectionByPath.get(diffFile.relPath),
        isSame: diffFile.status === "same",
        isUnresolvedConflict: diffFile.status === "conflict",
      });
    }

    const outcome = writeFiles(tasks, {
      projectRoot: path,
      version: params.version,
      backupBeforeWrite: store.settings.backupBeforeWrite,
    });

    appendPublishLogEntry(path, {
      version: params.version,
      timestamp: new Date().toISOString(),
      targets: params.targets,
      results: outcome.results,
      backupDir: outcome.backupDir,
    });

    // update meta.publishedHashes + status for artifacts that were successfully written
    for (const result of outcome.results) {
      if (result.action !== "created" && result.action !== "updated") continue;
      if (!result.artifactId) continue;
      const artifact = store.artifacts.find((a) => a.id === result.artifactId);
      if (!artifact) continue;
      artifact.meta.publishedHashes = {
        ...artifact.meta.publishedHashes,
        [result.target]: result.contentHash,
      };
      artifact.meta.status = "published";
      artifact.meta.version = params.version;
    }
    saveProjectStore(path, store);

    return { results: outcome.results, backupDir: outcome.backupDir, logEntryWritten: true };
  },

  gitStatus(params: contract.GitStatusParams): contract.GitStatusResult {
    return coreGitStatus(params.path);
  },

  renderRunCommand(params: contract.RenderRunCommandParams): contract.RenderRunCommandResult {
    return { prompt: coreRenderRunCommand(params) };
  },
};

export { validateAllArtifacts };
