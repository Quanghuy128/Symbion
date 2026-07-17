import { existsSync, statSync } from "node:fs";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import {
  AUTHOR_REGISTRY,
  computeDiff as coreComputeDiff,
  dedupeImportNames,
  extractAgentMentions,
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
import { fetchAuthorTemplatesFromGithub } from "../templates/githubFetch.js";
import {
  createProjectStore,
  loadGlobalConfig,
  loadProjectStore,
  projectStoreExists,
  safeDeleteProjectStore,
  saveGlobalConfig,
  saveProjectStore,
} from "../store/store.js";
import { appendPublishLogEntry } from "../store/publishLog.js";
import { gitStatus as coreGitStatus } from "../git/status.js";
import { browseFolder as nativeBrowseFolder } from "../fs/folderPick.js";
import { listDir as listDirImpl, makeDir as makeDirImpl } from "../fs/listDir.js";
import { walkImportTree, readImportFile } from "../fs/importTree.js";
import {
  extractForeignAgentsMdContent,
  readAgentsMd,
  readClaudeDirFilemap,
  readTargetFiles,
} from "../fs/readTargetFiles.js";
import { writeFiles, type WriteFileTask } from "../fs/writeFiles.js";
import { buildBodyGenerationPrompt } from "@symbion/core";
import { getProvider, listProviderDescriptors } from "../llm/registry.js";
import { LlmError, type LlmErrorCode } from "../llm/types.js";
import {
  checkApiKeyProviderReachable,
  checkOllamaReachable,
  resolveOllamaBaseUrlForStatusCheck,
} from "../llm/providerStatus.js";
import { detectHostEnvironment, getOllamaInstallInstructions } from "../llm/installInstructions.js";
import {
  clearProviderKey as secretsClearProviderKey,
  loadProvidersConfig,
  maskKey,
  ProviderNotConfiguredError,
  setActiveProvider as secretsSetActiveProvider,
  setProviderKey as secretsSetProviderKey,
  type ApiKeyProviderId,
  type ProviderId as SecretsProviderId,
} from "../llm/secrets.js";
import { RpcError } from "./rpcError.js";
import { isUncPath } from "./pathStyle.js";
import { runManager } from "../run/runManager.js";
import { runPreflight as computePreflight } from "../run/preflight.js";
import { buildArgv, resolveClaudeBin } from "../run/cliDriver.js";
import { nonceStore } from "../run/nonces.js";
import { resolveRunConfig, configHash, ackSettingsHash, validateRunConfig } from "../run/runConfig.js";
import { getRunCliVersion } from "../run/cliVersion.js";
import { listRuns as storeListRuns, readEvents, readRunJson, reconcile, prune } from "../run/runStore.js";
import type * as contract from "./contract.js";

export { RpcError };

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
    throw new Error(`Project not found: ${projectId}`);
  }
  return entry.path;
}

/**
 * createOrAdoptProject — the shared create/adopt control flow behind both the
 * standalone `createProject` RPC and the combined `createProjectAndImport`
 * (import-lifecycle-fixes PLAN §2 / B2). Returns whether this call CREATED a
 * fresh store (branch #6 — eligible for rollback) or ADOPTED a pre-existing
 * orphan store (branch #5 — NEVER rolled back / deleted, the store pre-existed).
 *
 * Branches (PLAN §2):
 *   1. path missing / not a dir            -> RpcError("invalid-path")
 *   2. inConfig && onDisk                  -> RpcError("already-a-project")
 *   3. inConfig && !onDisk (ghost)         -> RpcError("already-a-project")
 *   4. !inConfig && onDisk (orphan)        -> ADOPT: reuse id + artifacts,
 *                                              refresh config `name` from param,
 *                                              store.json NOT rewritten.
 *   5. !inConfig && !onDisk                -> CREATE: mint id, write store.json.
 */
function createOrAdoptProject(
  name: string,
  path: string
): { project: ProjectStore; justCreated: boolean } {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new RpcError("invalid-path", "Path does not exist or is not a directory.");
  }

  const config = loadGlobalConfig();
  const inConfig = config.projects.some((p) => p.path === path);
  const onDisk = projectStoreExists(path);

  if (inConfig) {
    // Both the AND-on-disk and the ghost (config-only, store gone) cases stay a
    // throw — adopt applies ONLY to the config-absent-but-disk-present orphan.
    // The ghost case is surfaced to the user via loadProject's project-missing.
    throw new RpcError("already-a-project", "This folder is already a Symbion project.");
  }

  if (onDisk) {
    // B2 ADOPT: reuse the existing store's id + artifacts (never lose data);
    // refresh the config-registered `name` from the param (the sidebar label the
    // user just typed). The on-disk store.name is left untouched — adopt is a
    // read-only-on-the-store operation (no store.json write).
    const existing = loadProjectStore(path);
    config.projects.push({ id: existing.id, name, path });
    config.lastProjectId = existing.id;
    saveGlobalConfig(config);
    return { project: existing, justCreated: false };
  }

  // CREATE: fresh happy path.
  const id = randomId();
  const project = createProjectStore(path, name, id);
  config.projects.push({ id, name, path });
  config.lastProjectId = id;
  saveGlobalConfig(config);
  return { project, justCreated: true };
}

/**
 * importIntoStore — the shared import logic behind both the standalone
 * `importArtifacts` RPC and the combined `createProjectAndImport` (PLAN §1).
 * Reads a fresh store (server-authoritative / TOCTOU-free), dedupes incoming
 * names (B1), partitions blocking-lint artifacts out (block-one-not-all, §1.4),
 * persists the importable remainder, and returns the merged store plus the
 * `renames`/`blocked` audit lists. NEVER throws on a lint issue — it filters.
 */
function importIntoStore(
  projectPath: string,
  selectedIds: string[],
  scanned: CanonicalArtifact[]
): contract.ImportArtifactsResult {
  const store = loadProjectStore(projectPath);
  const selected = scanned.filter((a) => selectedIds.includes(a.id));

  // E19: seed `existingOthers` with the store MINUS the selected ids, so a plain
  // re-import of an already-stored artifact does NOT see its own stored name as a
  // collision and wrongly bump ba -> ba-2. This is the single most important
  // wiring detail of §1.2.
  const existingOthers = store.artifacts.filter((a) => !selected.some((s) => s.id === a.id));

  // B1: server-authoritative auto-suffix dedup over the fresh store + within the
  // incoming batch itself (the .md/.md.tmpl twins are BOTH new).
  const { deduped, renames } = dedupeImportNames(existingOthers, selected);

  // Validate the resulting merged set; block-one-not-all (§1.4): collect blocking
  // (error-level) issues per deduped artifact, then partition.
  const merged = [...existingOthers, ...deduped];
  const issues = validateAllArtifacts(merged);
  const dedupedIds = new Set(deduped.map((a) => a.id));
  const blockingByArtifact = new Map<string, string[]>();
  for (const issue of issues) {
    if (issue.level !== "error" || !issue.artifactId || !dedupedIds.has(issue.artifactId)) continue;
    const list = blockingByArtifact.get(issue.artifactId) ?? [];
    list.push(issue.message);
    blockingByArtifact.set(issue.artifactId, list);
  }

  const importable: CanonicalArtifact[] = [];
  const blocked: contract.ImportBlocked[] = [];
  for (const art of deduped) {
    const reasons = blockingByArtifact.get(art.id);
    if (reasons && reasons.length > 0) {
      blocked.push({ id: art.id, name: art.name, reasons });
    } else {
      importable.push(art);
    }
  }

  // Persist ONLY importable (upsert-in-place by id). Skip the write entirely when
  // nothing is importable so an all-blocked import leaves the store byte-unchanged.
  if (importable.length > 0) {
    for (const artifact of importable) {
      const idx = store.artifacts.findIndex((a) => a.id === artifact.id);
      if (idx >= 0) {
        store.artifacts[idx] = artifact;
      } else {
        store.artifacts.push(artifact);
      }
    }
    saveProjectStore(projectPath, store);
  }

  const result: contract.ImportArtifactsResult = { project: store };
  if (renames.length > 0) result.renames = renames;
  if (blocked.length > 0) result.blocked = blocked;
  return result;
}

/**
 * Runtime guards for the LLM RPC surface (generateBody/listModels). TypeScript's
 * `"agent" | "command"` / the 4-id provider unions give zero enforcement once
 * JSON is parsed off the wire — an unrecognized value must fail cleanly with
 * RpcError("invalid-params", ...) BEFORE reaching the prompt builder or provider
 * registry, never fall through to the generic 500/internal-error catch-all (see
 * docs/loops/auto-generate-body-STATE.md §13, MEDIUM finding).
 */
const VALID_KINDS = new Set(["agent", "command"]);
const VALID_PROVIDER_IDS = new Set(["ollama", "openai", "anthropic", "gemini"]);
const VALID_API_KEY_PROVIDER_IDS = new Set(["openai", "anthropic", "gemini"]);

function assertValidKind(kind: unknown): asserts kind is "agent" | "command" {
  if (typeof kind !== "string" || !VALID_KINDS.has(kind)) {
    throw new RpcError("invalid-params", `Invalid "kind" parameter: must be "agent" or "command".`);
  }
}

function assertValidProviderId(providerId: unknown): asserts providerId is contract.ProviderId {
  if (typeof providerId !== "string" || !VALID_PROVIDER_IDS.has(providerId)) {
    throw new RpcError(
      "invalid-params",
      `Invalid "providerId" parameter: must be one of "ollama", "openai", "anthropic", "gemini".`
    );
  }
}

function assertValidApiKeyProviderId(providerId: unknown): asserts providerId is ApiKeyProviderId {
  if (typeof providerId !== "string" || !VALID_API_KEY_PROVIDER_IDS.has(providerId)) {
    throw new RpcError(
      "invalid-params",
      `Invalid "providerId" parameter: must be one of "openai", "anthropic", "gemini".`
    );
  }
}

const PROVIDER_LABELS: Record<contract.ProviderId, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

/**
 * buildProviderDescriptors — projects the daemon-internal ProvidersConfig
 * (raw apiKey, never crosses the RPC boundary) into the masked
 * `ProviderDescriptor[]` shape every provider-settings RPC returns. Single
 * call site for this projection so `maskKey()` is applied exactly once, in
 * exactly one place, never as an afterthought filter on an already-built
 * response object (STATE §3.2's `listProviders` handler note + §9 security note).
 */
function buildProviderDescriptors(): contract.ProviderDescriptor[] {
  const config = loadProvidersConfig();
  return listProviderDescriptors().map((descriptor) => {
    if (descriptor.kind === "local") {
      return {
        id: descriptor.id,
        label: descriptor.id === "ollama" ? "Ollama" : PROVIDER_LABELS[descriptor.id],
        kind: descriptor.kind,
        configured: true, // ollama needs no key — always "configured" in the sense of "usable"
        active: config.activeProviderId === descriptor.id,
      };
    }
    const stored = config.providers[descriptor.id as ApiKeyProviderId];
    return {
      id: descriptor.id,
      label: PROVIDER_LABELS[descriptor.id],
      kind: descriptor.kind,
      configured: Boolean(stored),
      active: config.activeProviderId === descriptor.id,
      maskedKey: stored ? maskKey(stored.apiKey) : undefined,
      model: stored?.model,
    };
  });
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

    if (isUncPath(path)) {
      return {
        exists: false,
        isDir: false,
        isGitRepo: false,
        hasClaudeDir: false,
        hasAgentsMd: false,
        writable: false,
        reason: "unc-unsupported",
      };
    }

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

  listDir(params: contract.ListDirParams): contract.ListDirResult {
    return listDirImpl(params.path);
  },

  makeDir(params: contract.MakeDirParams): contract.MakeDirResult {
    return makeDirImpl(params.path);
  },

  listProjects(_params: contract.ListProjectsParams): contract.ListProjectsResult {
    const config = loadGlobalConfig();
    return { projects: config.projects };
  },

  /**
   * createProject — B2 adopt-orphan (PLAN §2). Delegates to the shared
   * create-or-adopt control flow: a `.symbion/store.json` that exists on disk
   * but is absent from global config is ADOPTED (re-registered, reusing its id +
   * artifacts) instead of throwing `already-a-project`. A folder already in
   * config (with or without an on-disk store) still throws.
   */
  createProject(params: contract.CreateProjectParams): contract.CreateProjectResult {
    const { project } = createOrAdoptProject(params.name, params.path);
    return { project };
  },

  removeProject(params: contract.RemoveProjectParams): contract.RemoveProjectResult {
    const { id, deleteStore } = params;
    const config = loadGlobalConfig();
    // Capture the removed project's path BEFORE filtering it out (PLAN §4
    // ordering) — else we lose the path needed for safeDeleteProjectStore.
    const entry = config.projects.find((p) => p.id === id);

    // B3b fail-closed ordering (PLAN §4 / T8): do the disk delete FIRST. If the
    // store can't be safely deleted (symlink .symbion, backup write failure,
    // confinement violation) the delete throws and we NEVER drop the config
    // entry — the project stays visible + retryable rather than orphaning the
    // store on disk (which is exactly B3's original bug).
    if (deleteStore && entry) {
      safeDeleteProjectStore(entry.path);
    }

    const before = config.projects.length;
    config.projects = config.projects.filter((p) => p.id !== id);
    const removed = config.projects.length < before;
    // Clear lastProjectId if it pointed at the removed project so a future
    // boot/auto-open doesn't try to re-open a forgotten project.
    if (config.lastProjectId === id) {
      config.lastProjectId = undefined;
    }
    // Only write when something actually changed — re-remove of an unknown/
    // already-removed id is a pure no-op (idempotent; no throw, no needless write).
    if (removed || config.lastProjectId === undefined) {
      saveGlobalConfig(config);
    }
    return { projects: config.projects, removed };
  },

  loadProject(params: contract.LoadProjectParams): contract.LoadProjectResult {
    const path = findProjectPath(params.id);
    // "Ghost project" guard: the folder is still in the global config but its
    // `.symbion/store.json` is gone (moved/deleted on disk). Detect it and
    // throw a typed RpcError instead of letting loadProjectStore surface a raw
    // ENOENT — the web side can then show a meaningful toast, and the rail's
    // per-project "Remove project" affordance lets the user forget the ghost.
    if (!projectStoreExists(path)) {
      throw new RpcError(
        "project-missing",
        `Project store not found at ${path}. The folder may have been moved or deleted.`
      );
    }
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
        `Cannot save — lint violations: ${blocking.map((i) => i.message).join("; ")}`
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
      // Server-side validation of the run-engine settings (STATE §20 review
      // fix — 🟡 medium): the RunSettingsSection.tsx client clamps are UX-only
      // and do not protect the daemon RPC boundary. Reject out-of-contract
      // values rather than silently persisting them.
      let validatedRun;
      try {
        validatedRun = validateRunConfig(params.settings.run);
      } catch (err) {
        throw new RpcError("invalid-params", err instanceof Error ? err.message : "Invalid run settings.");
      }
      const path = findProjectPath(params.projectId);
      const store = loadProjectStore(path);
      store.settings = { ...params.settings, run: validatedRun ?? undefined };
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

  /**
   * listTree — manual-file-picker escape hatch (PLAN §3). READ-ONLY eager
   * metadata walk of the repo root (dirs + files, NO content), hard-capped
   * daemon-side (importTree.ts constants). Fires ONLY when the user clicks
   * "Browse files manually" (F1) — never on a normal scan. Thin delegate;
   * all confinement + caps live in walkImportTree.
   */
  listTree(params: contract.ListTreeParams): contract.ListTreeResult {
    return walkImportTree((params as { root?: unknown } | null)?.root);
  },

  /**
   * readImportFile — lazy single-file read for a picked/skipped file (PLAN §3).
   * READ-ONLY. Confinement violations (`..`/absolute/symlink-escape) THROW a
   * loud RpcError (T6/S17); expected outcomes (too-large/binary/not-found/
   * denied) return a soft discriminated result. Thin delegate; the guard +
   * size/binary caps live in readImportFile (importTree.ts).
   */
  readImportFile(params: contract.ReadImportFileParams): contract.ReadImportFileResult {
    const p = (params as { root?: unknown; relPath?: unknown } | null) ?? {};
    return readImportFile(p.root, p.relPath);
  },

  /**
   * importArtifacts — B1 (PLAN §1). Delegates to the shared `importIntoStore`:
   *   - name-collision auto-suffix via the pure `dedupeImportNames` (server-
   *     authoritative, over a fresh store read) — twins land as `x` + `x-2`,
   *     reported in `renames`.
   *   - block-one-not-all (§1.4): an artifact with a blocking lint issue (e.g.
   *     empty description) is EXCLUDED and reported in `blocked`; the rest still
   *     import. No wholesale reject/throw — that was what made B1 catastrophic.
   */
  importArtifacts(params: contract.ImportArtifactsParams): contract.ImportArtifactsResult {
    const path = findProjectPath(params.projectId);
    return importIntoStore(path, params.selectedIds, params.scanned);
  },

  /**
   * createProjectAndImport — B3a (PLAN §3). ONE atomic RPC: create-or-adopt the
   * project, then import. If import fails (genuine I/O error only — B1's
   * block-one-not-all means lint never throws) AND this call CREATED a fresh
   * project, roll back: drop the just-added config entry + safe-delete the
   * just-created store. If it ADOPTED a pre-existing orphan, do NOT delete (the
   * store pre-existed — deleting it would be data loss) and leave the config
   * entry registered (user can retry import). Makes create+import atomic from
   * the client's view even across a mid-flow client disconnect.
   */
  createProjectAndImport(
    params: contract.CreateProjectAndImportParams
  ): contract.CreateProjectAndImportResult {
    const { name, path, selectedIds, scanned } = params;
    const { project, justCreated } = createOrAdoptProject(name, path);

    try {
      const imported = importIntoStore(path, selectedIds, scanned);
      const result: contract.CreateProjectAndImportResult = { project: imported.project };
      if (imported.renames) result.renames = imported.renames;
      if (imported.blocked) result.blocked = imported.blocked;
      return result;
    } catch (err) {
      // Rollback ONLY when THIS call created the project (never an adopted one).
      if (justCreated) {
        try {
          const config = loadGlobalConfig();
          config.projects = config.projects.filter((p) => p.id !== project.id);
          if (config.lastProjectId === project.id) {
            config.lastProjectId = undefined;
          }
          saveGlobalConfig(config);
          safeDeleteProjectStore(path);
        } catch {
          // Best-effort rollback: if cleanup itself fails, still surface the
          // ORIGINAL import error (below) rather than mask it with a cleanup error.
        }
      }
      throw err;
    }
  },

  /**
   * applyTemplate — stages one bundled template (apps/web's static gallery)
   * into a project's store as a new draft artifact, with server-side
   * auto-suffix collision resolution. See packages/rpc-types's
   * ApplyTemplateParams doc comment + docs/loops/templates-marketplace-STATE.md
   * PLAN §0(b)/§2 for the full rationale (new RPC vs. extending
   * importArtifacts; TOCTOU; never-block-never-overwrite collision policy).
   *
   * Defense-in-depth shape re-validation: the daemon never trusts the
   * client's `template.kind`/`name`/`description` even though this content
   * originates from the web app's own bundled, build-time-reviewed data
   * (not arbitrary external input) — same posture as every other mutating
   * handler in this file (see saveArtifact/importArtifacts comments above).
   */
  applyTemplate(params: contract.ApplyTemplateParams): contract.ApplyTemplateResult {
    const { projectId, template } = params;

    if (!template || (template.kind !== "agent" && template.kind !== "command")) {
      throw new RpcError("invalid-kind", "Only Agent/Command support Apply.");
    }
    if (typeof template.name !== "string" || template.name.trim().length === 0) {
      throw new RpcError("invalid-template", "Template is missing name.");
    }
    if (typeof template.description !== "string" || template.description.trim().length === 0) {
      throw new RpcError("invalid-template", "Template is missing description.");
    }
    if (typeof template.body !== "string" || template.body.trim().length === 0) {
      throw new RpcError("invalid-template", "Template is missing content (body).");
    }
    if (typeof template.sourceTemplateId !== "string" || template.sourceTemplateId.trim().length === 0) {
      throw new RpcError("invalid-template", "Template is missing sourceTemplateId.");
    }

    // templates-authors PLAN §P6: server-side defense-in-depth mirror of the
    // client-side license/attribution acknowledgment gate. The daemon looks
    // up authorId in AUTHOR_REGISTRY itself (never trusts a client-asserted
    // boolean about WHETHER the gate applies) — only an unrecognized/absent
    // authorId or one whose registry entry is kind:"bundled" (Symbion) is
    // treated as not-third-party, matching "never trust the client" posture.
    const authorId = template.authorId ?? "symbion";
    const author = AUTHOR_REGISTRY.find((a) => a.id === authorId);
    // Conservative default: unknown authorId → treat as third-party (requires
    // acknowledgment). A known "bundled" (Symbion) entry is the ONLY exempt case.
    // This ensures "never trust the client about WHETHER the gate applies" even if a
    // future registry entry is misspelled or a hand-crafted RPC sends an unrecognized id.
    const isThirdParty = author === undefined || author.kind === "github";
    if (isThirdParty && template.acknowledgedThirdParty !== true) {
      throw new RpcError(
        "license-not-acknowledged",
        "You must acknowledge the notice about other authors' content copyright before applying."
      );
    }

    const path = findProjectPath(projectId);
    const store = loadProjectStore(path); // fresh read — closes the TOCTOU gap a client-side calc would have

    // Auto-suffix algorithm (THINK #4): first free "<name>", "<name>-2", "<name>-3", ...
    // scoped to (kind, name) pairs, matching validate.ts's own duplicate rule
    // (same kind + same name) so the suffix algorithm and the lint rule it's
    // dodging stay in lockstep by construction.
    const existingNames = new Set(
      store.artifacts.filter((a) => a.kind === template.kind).map((a) => a.name)
    );
    let finalName = template.name;
    let n = 2;
    while (existingNames.has(finalName)) {
      finalName = `${template.name}-${n}`;
      n++;
    }
    const wasRenamed = finalName !== template.name;

    const now = new Date().toISOString();
    const artifact: CanonicalArtifact = {
      id: randomId(),
      kind: template.kind,
      name: finalName,
      description: template.description,
      tools: template.tools,
      body: template.body,
      meta: {
        version: "draft",
        status: "draft",
        createdAt: now,
        updatedAt: now,
        sourceTemplateId: template.sourceTemplateId,
      },
    };

    // Defense-in-depth: re-validate the FULL resulting set, same posture as
    // importArtifacts/saveArtifact. Should never actually fail given the
    // auto-suffix loop above already guarantees no name collision, but keeps
    // the same "never trust, always re-check before persist" invariant as
    // every other write path (a real safety net if e.g. FILENAME_SAFE_RE
    // rejects a name with a space/slash the bundle author typo'd).
    const merged = [...store.artifacts, artifact];
    const issues = validateAllArtifacts(merged);
    const blocking = issues.filter((i) => i.level === "error" && i.artifactId === artifact.id);
    if (blocking.length > 0) {
      throw new RpcError(
        "validation-failed",
        `Cannot apply — lint violations: ${blocking.map((i) => i.message).join("; ")}`
      );
    }

    store.artifacts.push(artifact);
    saveProjectStore(path, store);

    return { project: store, appliedArtifactId: artifact.id, finalName, wasRenamed };
  },

  /**
   * fetchAuthorTemplates — templates-authors v2 extension (PLAN §P2). Looks
   * up `authorId` in AUTHOR_REGISTRY (packages/core) server-side — never
   * trusts/reads any client-supplied owner/repo fields, even if a
   * hand-crafted request sends them (PLAN §P8 SSRF finding #1(a)). An
   * unknown authorId, or one resolving to a `kind: "bundled"` entry (e.g.
   * "symbion" — the bundled author can't be routed through the network-fetch
   * path), is a programming/client-bug error -> thrown RpcError, NOT a
   * well-formed outcome. A known `kind: "github"` author always resolves
   * (never throws) to a `FetchAuthorTemplatesOutcome` — every external
   * failure mode (network/rate-limit/not-found/per-file/parse) is a
   * well-formed, expected-to-sometimes-fail result, not a daemon bug.
   */
  async fetchAuthorTemplates(params: contract.FetchAuthorTemplatesParams): Promise<contract.FetchAuthorTemplatesResult> {
    if (typeof params?.authorId !== "string" || params.authorId.trim().length === 0) {
      throw new RpcError("invalid-author", "Missing authorId.");
    }
    const author = AUTHOR_REGISTRY.find((a) => a.id === params.authorId);
    if (!author || author.kind !== "github") {
      throw new RpcError("invalid-author", `Invalid authorId or not a GitHub source: "${params.authorId}".`);
    }

    const outcome = await fetchAuthorTemplatesFromGithub(author);
    return { outcome };
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

  /**
   * listModels — single source of truth for a provider's model list, so apps/web
   * never hand-duplicates it (resolves STATE §10.7 Risk R1 per the user's
   * amendment). For the 3 cloud providers this is still a static, hardcoded,
   * zero-network-call list (unchanged, AC5). For Ollama, this now performs a real
   * `GET /api/tags` network call against the local Ollama instance (per
   * docs/loops/ollama-dynamic-models-STATE.md §6.2/§6.4) — bounded by a 3000ms
   * timeout, never hangs indefinitely (AC6).
   *
   * Three resolved outcomes (never a thrown RpcError for these, since both are
   * well-formed, expected facts about a reachable Ollama, not daemon bugs):
   * - `{models, outcome:"ok"}` — non-empty list (cloud providers always land here).
   * - `{models:[], outcome:"empty"}` — Ollama reachable, zero models pulled.
   * - `{models:[], outcome:"fetch-failed", errorMessage}` — Ollama reachable but
   *   `/api/tags` itself failed (malformed JSON / non-2xx / missing `models` field).
   *
   * `provider-not-running` (Ollama unreachable) is the ONE case that still THROWS
   * `RpcError("llm-provider-not-running", ...)` — unchanged shape, AC4.
   */
  async listModels(params: contract.ListModelsParams): Promise<contract.ListModelsResult> {
    assertValidProviderId(params.providerId);
    const provider = getProvider(params.providerId);
    try {
      const models = await provider.listModels();
      return { models, outcome: models.length === 0 ? "empty" : "ok" };
    } catch (err) {
      if (err instanceof LlmError) {
        if (err.code === "provider-not-running") {
          // unchanged existing path — Ollama unreachable still throws, AC4.
          throw new RpcError(`llm-${err.code}`, humanMessageForLlmError(err));
        }
        // invalid-response (malformed JSON / non-2xx from /api/tags), or any other
        // LlmError code reaching here — resolve with outcome:"fetch-failed" rather
        // than throw, so the web layer can render a distinct, non-generic message.
        return { models: [], outcome: "fetch-failed", errorMessage: humanMessageForLlmError(err) };
      }
      throw new RpcError("llm-unknown", "Unknown error while fetching the model list.");
    }
  },

  /**
   * generateBody — the first async, slow, externally-fallible RPC handler in the
   * codebase (STATE §10.1/§10.2). Touches neither disk nor git: pure inference in,
   * text out. Deliberately does NOT call findProjectPath/loadProjectStore — the
   * request already carries all needed context inline (STATE §10.2).
   */
  async generateBody(params: contract.GenerateBodyParams): Promise<contract.GenerateBodyResult> {
    // Runtime-validate the two "TS union, zero runtime enforcement" fields BEFORE
    // touching the prompt builder or provider registry (STATE §13 MEDIUM finding) —
    // an unrecognized kind/providerId must fail as a clean invalid-params RpcError,
    // not a bare Error that falls through to the generic 500/internal-error path.
    assertValidKind(params.kind);
    assertValidProviderId(params.providerId);

    // Defensive input-size cap (no daemon crash / runaway prompt on malformed/huge input —
    // there is no pre-existing size-cap precedent elsewhere in the RPC surface to match,
    // so this is a new, narrowly-scoped guard for this handler only).
    const MAX_FIELD_LEN = 50_000;
    for (const field of ["name", "description", "existingBody"] as const) {
      const value = params[field];
      if (typeof value !== "string" || value.length > MAX_FIELD_LEN) {
        throw new RpcError("invalid-params", `Field "${field}" is invalid or too large.`);
      }
    }
    if (typeof params.modelId !== "string" || params.modelId.length === 0 || params.modelId.length > 200) {
      throw new RpcError("invalid-params", "Invalid modelId.");
    }

    const { system, user } = buildBodyGenerationPrompt({
      kind: params.kind,
      name: params.name,
      description: params.description,
      existingBody: params.existingBody,
    });
    try {
      // getProvider/the provider constructor can itself throw an LlmError (e.g. an
      // env-var-sourced Ollama base URL that fails the loopback check — STATE §13 HIGH
      // finding) — kept inside this try so any LlmError, whether thrown at construction
      // time or during generate(), maps through the same clean RpcError taxonomy below
      // instead of leaking via the generic 500/internal-error path.
      const provider = getProvider(params.providerId);
      const result = await provider.generate({
        systemPrompt: system,
        userPrompt: user,
        model: params.modelId,
        timeoutMs: 45_000,
      });
      return { body: result.text };
    } catch (err) {
      if (err instanceof LlmError) {
        throw new RpcError(`llm-${err.code}`, humanMessageForLlmError(err));
      }
      throw new RpcError("llm-unknown", "Unknown error while calling the AI model.");
    }
  },

  /**
   * checkProviderStatus — read-only liveness/auth check, widened per
   * docs/loops/multi-provider-settings-STATE.md §3.2/§4b from the literal
   * "ollama" to the 4-id union. Ollama keeps its exact existing path
   * (checkOllamaReachable, unchanged). The 3 api-key providers: first check
   * secrets.ts has a stored key (if not, short-circuit to
   * { reachable:false, errorCode:"not-configured" } with ZERO network calls —
   * never attempt a guaranteed-auth-failure round-trip); if a key exists,
   * construct the provider (reads its own key internally) and perform ONE
   * cheap authenticated call via checkApiKeyProviderReachable. Never throws
   * on "not reachable" — that is a valid resolved result, not a server error.
   */
  async checkProviderStatus(params: contract.CheckProviderStatusParams): Promise<contract.CheckProviderStatusResult> {
    assertValidProviderId((params as { providerId?: unknown } | null)?.providerId);
    const { providerId } = params;

    if (providerId === "ollama") {
      const baseUrl = resolveOllamaBaseUrlForStatusCheck();
      const reachable = await checkOllamaReachable(baseUrl, 3000);
      const install = getOllamaInstallInstructions(detectHostEnvironment());
      return { reachable, checkedBaseUrl: baseUrl, install, kind: "local" };
    }

    const config = loadProvidersConfig();
    const hasKey = Boolean(config.providers[providerId as ApiKeyProviderId]);
    if (!hasKey) {
      return { reachable: false, errorCode: "not-configured", kind: "api-key" };
    }

    const provider = getProvider(providerId);
    const result = await checkApiKeyProviderReachable(provider, 3000);
    return { reachable: result.reachable, errorCode: result.errorCode, kind: "api-key" };
  },

  /**
   * listProviders — returns all 4 providers' static descriptor + current
   * persisted state (masked key, model, configured/active) in one call,
   * backing the Settings page's initial render and useActiveProvider()'s
   * one-call-per-mount resolution (STATE §3.2/§4a/§4d).
   */
  listProviders(_params: contract.ListProvidersParams): contract.ListProvidersResult {
    return { providers: buildProviderDescriptors() };
  },

  /**
   * saveProviderKey — validates providerId against the 3 api-key ids (ollama
   * never has a stored key) and apiKey under a size cap (mirrors
   * generateBody's MAX_FIELD_LEN pattern), then upserts via secrets.ts.
   * Returns the masked descriptors — apiKey is NEVER serialized raw.
   */
  saveProviderKey(params: contract.SaveProviderKeyParams): contract.SaveProviderKeyResult {
    const providerIdRaw = (params as { providerId?: unknown } | null)?.providerId;
    assertValidApiKeyProviderId(providerIdRaw);
    const providerId: ApiKeyProviderId = providerIdRaw;
    const model = params.model;

    const MAX_API_KEY_LEN = 4000;
    const apiKey = params.apiKey;
    if (typeof apiKey !== "string" || apiKey.trim().length === 0 || apiKey.length > MAX_API_KEY_LEN) {
      throw new RpcError("invalid-params", `Invalid "apiKey" parameter or too large.`);
    }
    if (model !== undefined && (typeof model !== "string" || model.length > 200)) {
      throw new RpcError("invalid-params", `Invalid "model" parameter.`);
    }

    secretsSetProviderKey(providerId, apiKey, model ?? "");
    return { providers: buildProviderDescriptors() };
  },

  /** clearProviderKey — removes one provider's stored key/model. If it was active,
   * activeProviderId resets to null (no automatic fallback to ollama). */
  clearProviderKey(params: contract.ClearProviderKeyParams): contract.ClearProviderKeyResult {
    const providerIdRaw = (params as { providerId?: unknown } | null)?.providerId;
    assertValidApiKeyProviderId(providerIdRaw);
    const providerId: ApiKeyProviderId = providerIdRaw;
    secretsClearProviderKey(providerId);
    return { providers: buildProviderDescriptors() };
  },

  /** setActiveProvider — rejects (invalid-params) if the target api-key provider has no
   * stored key; ollama always succeeds (needs none). Never a silent no-op. */
  setActiveProvider(params: contract.SetActiveProviderParams): contract.SetActiveProviderResult {
    assertValidProviderId((params as { providerId?: unknown } | null)?.providerId);
    try {
      secretsSetActiveProvider(params.providerId as SecretsProviderId);
    } catch (err) {
      if (err instanceof ProviderNotConfiguredError) {
        throw new RpcError("invalid-params", "No API key configured for this provider.");
      }
      throw err;
    }
    return { providers: buildProviderDescriptors() };
  },

  // ───────────────────────────────────────────────────────────────────────
  // Run Engine v2 (graph-execution-realtime PLAN §8.3). The ONLY spawn-capable
  // RPC surface; formally supersedes symbion-STATE §8 assumption #7 for run/.
  // ───────────────────────────────────────────────────────────────────────

  /**
   * runPreflight — parallel gate checks + the DAEMON-minted consent nonce
   * (Flaw F1). Writes NOTHING (nonce is memory-only). A draft/blocked artifact
   * gets NO consentNonce (AC-RUN-13 server side).
   */
  async runPreflight(params: contract.RunPreflightParams): Promise<contract.RunPreflightResult> {
    const { projectId, artifactId } = params ?? ({} as contract.RunPreflightParams);
    if (typeof projectId !== "string" || typeof artifactId !== "string") {
      throw new RpcError("invalid-params", "runPreflight requires projectId and artifactId.");
    }
    const path = findProjectPath(projectId);
    // Lazy reconcile on project touch (ER-10 pull-forward): orphaned running → failed.
    reconcile(path, runManager.liveRunIds());
    const store = loadProjectStore(path);
    return computePreflight({
      projectId,
      projectRoot: path,
      artifactId,
      store,
      hasActiveRun: runManager.hasActive(projectId),
    });
  },

  /**
   * startRun — consumes the nonce, RE-VALIDATES everything server-side (the
   * dialog's preflight rendering is UX, not the boundary), then spawns. cwd is
   * resolved from the registered project path — a client can NEVER supply it
   * (§8.5.2). Injection-safe: the requirement is one argv element (§8.5.1).
   */
  async startRun(params: contract.StartRunParams): Promise<contract.StartRunResult> {
    const p = params ?? ({} as contract.StartRunParams);
    const { projectId, artifactId, requirement, model, nonce, ackFirstRun } = p;

    if (typeof projectId !== "string" || typeof artifactId !== "string") {
      throw new RpcError("invalid-params", "startRun requires projectId and artifactId.");
    }
    if (typeof requirement !== "string" || requirement.length === 0 || requirement.length > 10_000) {
      throw new RpcError("invalid-params", "requirement must be a non-empty string ≤ 10000 chars.");
    }
    if (model !== undefined && (typeof model !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(model))) {
      throw new RpcError("invalid-params", "Invalid model override.");
    }

    const path = findProjectPath(projectId);
    const store = loadProjectStore(path);
    const artifact = store.artifacts.find((a) => a.id === artifactId);
    if (!artifact) throw new RpcError("invalid-params", "Command not found.");
    if (artifact.meta.status !== "published") {
      // Draft is a hard block — nothing on disk to run (AC-RUN-13).
      throw new RpcError("run-draft-blocked", "This command is a draft — publish it first.");
    }
    // Reservation IS the lock (TOCTOU fix): this must be the LAST synchronous
    // check before the first `await` in this handler. `runManager.reserve()`
    // does an atomic check-and-set on the Map — two concurrent startRun calls
    // for the same project race here, but only one `reserve()` call can win;
    // the loser fails immediately with run-active, before either has spawned
    // anything or touched the filesystem. Every exit path after this point
    // MUST either call `runManager.start()` (success) or
    // `runManager.releaseReservation()` (any failure) so a legitimate retry
    // is never permanently blocked by an abandoned reservation.
    if (!runManager.reserve(projectId)) {
      throw new RpcError("run-active", "A run is already active in this project (1 per project).");
    }

    try {
      const config = resolveRunConfig(store.settings);
      const hash = configHash(config);

      // Nonce gate (AC-RUN-10): daemon-minted, single-use, bound to
      // {projectId, artifactId, configHash}. A missing/expired/mismatched
      // nonce (incl. a config change since preflight) rejects before any spawn.
      if (typeof nonce !== "string" || nonce.length === 0) {
        throw new RpcError("run-consent-required", "A valid consent nonce is required to start a run.");
      }
      const ok = nonceStore.consume(nonce, { projectId, artifactId, configHash: hash });
      if (!ok) {
        throw new RpcError("run-consent-required", "Consent nonce is invalid, expired, or does not match.");
      }

      // Persist firstRunAck server-side (the daemon computes the hash — never
      // trusts a client hash) when the UI relayed the acknowledgment.
      if (ackFirstRun === true) {
        config.firstRunAck = { settingsHash: ackSettingsHash(config), ackedAt: new Date().toISOString() };
        store.settings.run = config;
        saveProjectStore(path, store);
      }

      const bin = resolveClaudeBin();
      const cliVersion = await getRunCliVersion(bin);
      const argv = buildArgv({
        commandName: artifact.name,
        requirement,
        model,
        permissionMode: config.permissionMode,
        allowedTools: config.allowedTools,
      });

      // P2: agent names reachable from this artifact (by @mention) — same
      // traversal preflight already does for missingReferencedAgents; reused
      // by runManager for the token-cap rollup + terminal runSummary (one
      // graph walk, no daemon-side reimplementation of aggregate's roll-up).
      const agentSubagentNames = new Set(extractAgentMentions(artifact.body));

      const run = runManager.start({
        projectId,
        projectRoot: path,
        artifactId,
        commandName: artifact.name,
        requirement,
        modelOverride: model ?? null,
        bin,
        argv,
        permissionMode: config.permissionMode,
        allowedTools: config.allowedTools,
        ceilings: config.ceilings,
        cliVersion,
        agentSubagentNames,
      });

      return { runId: run.runId, run };
    } catch (err) {
      // Any failure between reserve() and a successful start() must release
      // the slot — otherwise the project is permanently stuck "active".
      runManager.releaseReservation(projectId);
      throw err;
    }
  },

  /**
   * cancelRun — two-step kill on the process GROUP, liveness-verified (ER-6).
   * Returns { status, pid? } — pid present iff not confirmed dead.
   */
  cancelRun(params: contract.CancelRunParams): contract.CancelRunResult {
    const p = params ?? ({} as contract.CancelRunParams);
    if (typeof p.projectId !== "string" || typeof p.runId !== "string") {
      throw new RpcError("invalid-params", "cancelRun requires projectId and runId.");
    }
    return runManager.cancel(p.projectId, p.runId);
  },

  /** listRuns — reads; lazy reconcile + prune. Returns runs + activeRunId. */
  listRuns(params: contract.ListRunsParams): contract.ListRunsResult {
    const p = params ?? ({} as contract.ListRunsParams);
    if (typeof p.projectId !== "string") {
      throw new RpcError("invalid-params", "listRuns requires projectId.");
    }
    const path = findProjectPath(p.projectId);
    reconcile(path, runManager.liveRunIds());
    prune(path, undefined, runManager.liveRunIds());
    const runs = storeListRuns(path);
    const activeRunId = runManager.activeRunIdForProject(p.projectId);
    return activeRunId ? { runs, activeRunId } : { runs };
  },

  /**
   * getRunEvents — polling fallback + history replay. Reads events with
   * seq > afterSeq (batch ≤500) + the run metadata; `done` iff terminal and
   * all events up to lastSeq were returned.
   */
  getRunEvents(params: contract.GetRunEventsParams): contract.GetRunEventsResult {
    const p = params ?? ({} as contract.GetRunEventsParams);
    if (typeof p.projectId !== "string" || typeof p.runId !== "string") {
      throw new RpcError("invalid-params", "getRunEvents requires projectId and runId.");
    }
    const afterSeq = typeof p.afterSeq === "number" && p.afterSeq >= 0 ? p.afterSeq : 0;
    const path = findProjectPath(p.projectId);
    const run = readRunJson(path, p.runId);
    if (!run) throw new RpcError("not-found", "Run not found.");
    const events = readEvents(path, p.runId, afterSeq);
    const terminal = !["starting", "running", "cancelling"].includes(run.status);
    const lastReturned = events.length > 0 ? events[events.length - 1]!.seq : afterSeq;
    const done = terminal && lastReturned >= run.lastSeq;
    return { events, run, done };
  },
};

/**
 * EC-4's exact error-code -> human-readable-Vietnamese-message taxonomy (STATE §10.5).
 *
 * Per-code fallback strings are used when `err.message` is empty, or for codes
 * ("provider-not-running" / "timeout" / "auth" / "rate-limit" / "not-configured")
 * whose throw sites across all 4 provider adapters (ollamaProvider.ts,
 * openaiProvider.ts, anthropicProvider.ts, geminiProvider.ts) already construct a
 * message that says exactly what the fallback says (provider name aside) — no extra
 * detail to preserve there.
 *
 * For "invalid-response" and "network", the throw sites DO carry extra,
 * user-relevant detail the generic fallback would otherwise discard (e.g. a 404
 * "model not pulled" message naming the missing model) — confirmed root cause of
 * the Generate Body 404 loop (docs/learnings.md). For those codes (and "unknown"),
 * prefer the original `err.message` when present.
 */
function humanMessageForLlmError(err: LlmError): string {
  const code: LlmErrorCode = err.code;
  switch (code) {
    case "provider-not-running":
      return "Cannot connect to Ollama — make sure Ollama is running on your machine.";
    case "timeout":
      return "Request timed out (45s) — try again.";
    case "auth":
      return "Missing or invalid API key for the AI provider.";
    case "rate-limit":
      return "Rate-limited — try again later.";
    case "not-configured":
      return "No AI provider configured — go to Settings to add one.";
    case "invalid-response":
      return err.message || "Invalid response from the model.";
    case "network":
    case "unknown":
    default:
      return err.message || "Unknown error, please try again.";
  }
}

export { validateAllArtifacts };
