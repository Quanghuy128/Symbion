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
  /**
   * Present ONLY when validation short-circuited before a normal exists/isDir
   * check could mean anything useful — e.g. a UNC path, which is structurally
   * unsupported regardless of whether anything happens to exist at that string.
   * Absent (undefined) for every other result, including "well-formed but
   * does not exist yet" (that case is `exists: false` with NO reason — the
   * web layer's existing ternary already handles it as today's 5b state).
   * Extensible: a future unsupported-shape (e.g. a path exceeding Windows'
   * MAX_PATH, EC-3.5, explicitly deferred this loop) would add a new literal
   * to this union rather than a new boolean field.
   */
  reason?: "unc-unsupported";
}

export interface ListDirParams {
  /** absolute path to list; if omitted, daemon defaults to os.homedir(). */
  path?: string;
}
export interface ListDirEntry {
  name: string;
  /** absolute path of this entry — what the UI sends back as the next listDir/createProject path. */
  path: string;
  /** true only for entries the daemon classifies as navigable (real dir or dir-like symlink target). */
  isDir: boolean;
  /** true if this entry is a symlink (dir or not) — UI may show a distinct icon; still navigable if isDir. */
  isSymlink: boolean;
  /** true if a permission/stat error means we know nothing more than the readdir name (not navigable). */
  unreadable: boolean;
}
export interface ListDirResult {
  /** resolved absolute path that was actually listed (after symlink/realpath resolution of `path` itself). */
  path: string;
  /** absolute path of the parent dir, or undefined if `path` is filesystem root ("/"). Lets UI render "Up". */
  parentPath?: string;
  /** subdirectories only (files are never returned — this RPC is a directory PICKER, not a file browser). */
  entries: ListDirEntry[];
  /** true if `path` itself could be stat'd but readdir failed (e.g. permission denied) — entries is []. */
  denied: boolean;
}

export interface MakeDirParams {
  path: string;
}
export interface MakeDirResult {
  path: string;
  /** false if it already existed as a dir (idempotent no-op), true if newly created. */
  created: boolean;
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

/** A model choice for a given LLM provider. For the 3 cloud providers (openai/anthropic/
 * gemini), this is still one of a fixed, hardcoded list (no dynamic fetch, STATE §10.7 Risk
 * R1, unchanged). For Ollama, this is now dynamically discovered from the local Ollama's
 * `GET /api/tags` (docs/loops/ollama-dynamic-models-STATE.md §6.2/§6.3) — source of truth is
 * apps/daemon (see apps/daemon/src/llm/*Provider.ts); apps/web fetches this list via the
 * `listModels` RPC instead of hand-duplicating it. */
export interface LlmModelOption {
  id: string;
  label: string;
  /** Optional — dynamically-discovered Ollama models with no confidently-parseable
   *  parameter-count hint in their tag name have no tier (STATE §6.3). The 3 cloud
   *  providers' static entries always set this. */
  tier?: "fast" | "balanced" | "best";
}

/** The 4-id provider union, widened from "ollama" | "remote" per
 * docs/loops/multi-provider-settings-STATE.md §3.1/§3.2. "remote" is removed —
 * folded into "anthropic" (rename, not a 5th id). */
export type ProviderId = "ollama" | "openai" | "anthropic" | "gemini";

/** Mirrors apps/daemon/src/llm/types.ts's LlmErrorCode — re-exported here so
 * apps/web can use the "not-configured" value for messaging without a
 * separate hand-duplicated string union. */
export type LlmErrorCode =
  | "timeout"
  | "network"
  | "auth"
  | "rate-limit"
  | "invalid-response"
  | "provider-not-running"
  | "not-configured"
  | "unknown";

export interface ListModelsParams {
  providerId: ProviderId;
}

/** Distinguishes "Ollama reachable but zero models pulled" (the exact bug reported in
 *  docs/loops/ollama-dynamic-models-STATE.md §0) from "fetch itself failed" (malformed
 *  JSON / non-2xx from /api/tags) — both resolve the RPC call (neither is surfaced as a
 *  thrown RpcError), because both are well-formed, expected outcomes for a
 *  reachable-but-empty-or-misbehaving Ollama, not daemon bugs. Cloud providers always
 *  return "ok" (their listModels() never fails). */
export type ListModelsOutcome = "ok" | "empty" | "fetch-failed";

export interface ListModelsResult {
  models: LlmModelOption[];
  outcome: ListModelsOutcome;
  /** present iff outcome === "fetch-failed" — human-readable detail from the daemon
   *  (e.g. "Ollama trả về lỗi HTTP 500..."), for a non-generic error message. */
  errorMessage?: string;
}

export interface GenerateBodyParams {
  kind: "agent" | "command";
  name: string;
  description: string;
  existingBody: string;
  /** which of the fixed model ids the user picked this click; required, no server default guess. */
  modelId: string;
  /** the caller (apps/web) is responsible for passing the currently-active provider id
   *  (read from `listProviders`'s result) — the daemon never silently substitutes it. */
  providerId: ProviderId;
}
export interface GenerateBodyResult {
  body: string;
}

/** Daemon-detected host environment, for selecting OS-specific install commands (EC-3). */
export interface HostEnvironment {
  kind: "wsl" | "linux" | "macos" | "windows" | "unknown";
  /** short human label shown verbatim in the panel's "phát hiện: …" line. */
  label: string;
}

export interface InstallInstructions {
  env: HostEnvironment;
  /** true only when detection is confident enough to show ONE command block. */
  confident: boolean;
  /** one entry per OS variant to show. Length 1 when confident===true; length 4 (all
   *  known variants, labeled) when confident===false. */
  variants: Array<{ label: string; command: string }>;
}

export interface CheckProviderStatusParams {
  /** widened from the literal "ollama" to the 4-id union per
   *  docs/loops/multi-provider-settings-STATE.md §3.2. */
  providerId: ProviderId;
}
export interface CheckProviderStatusResult {
  reachable: boolean;
  /** present iff providerId==="ollama"; informational only, not for branching logic in the UI. */
  checkedBaseUrl?: string;
  /** present iff reachable===false; mirrors the daemon's LlmErrorCode taxonomy, plus the
   *  new "not-configured" value for "active provider has no key/never configured." */
  errorCode?: LlmErrorCode;
  /** present iff providerId==="ollama" — the guided-setup install instructions. */
  install?: InstallInstructions;
  /** "local" (ollama) vs "api-key" (openai/anthropic/gemini) — lets the web panel render
   *  the right UI without a second RPC round-trip. */
  kind: "local" | "api-key";
}

/** One entry per provider — what `listProviders` returns. Never carries a raw apiKey;
 * `maskedKey` is always pre-masked by secrets.ts's `maskKey()` before crossing into JSON. */
export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  kind: "local" | "api-key";
  configured: boolean;
  active: boolean;
  maskedKey?: string;
  model?: string;
}

export interface ListProvidersParams {}
export interface ListProvidersResult {
  providers: ProviderDescriptor[];
}

export interface SaveProviderKeyParams {
  providerId: ProviderId;
  apiKey: string;
  model?: string;
}
export interface SaveProviderKeyResult {
  providers: ProviderDescriptor[];
}

export interface ClearProviderKeyParams {
  providerId: ProviderId;
}
export interface ClearProviderKeyResult {
  providers: ProviderDescriptor[];
}

export interface SetActiveProviderParams {
  providerId: ProviderId;
}
export interface SetActiveProviderResult {
  providers: ProviderDescriptor[];
}

export type RpcMethod =
  | "ping"
  | "browseFolder"
  | "validatePath"
  | "listDir"
  | "makeDir"
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
  | "renderRunCommand"
  | "listModels"
  | "generateBody"
  | "checkProviderStatus"
  | "listProviders"
  | "saveProviderKey"
  | "clearProviderKey"
  | "setActiveProvider";

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
