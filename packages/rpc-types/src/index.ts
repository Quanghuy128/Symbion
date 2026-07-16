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
  FourWay,
  PersistedRunEvent,
  ProjectRunConfig,
  ProjectSettings,
  ProjectStore,
  PublishResult,
  RenderedFile,
  RunInfo,
  RunListItem,
  RunState,
  RunStatus,
  RunSummary,
  TargetId,
  TemplateListItem,
  TimelineRow,
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

export interface RemoveProjectParams {
  id: string;
  /**
   * B3b (import-lifecycle-fixes PLAN §4): when true, the daemon ALSO safely
   * deletes the project's on-disk `.symbion/store.json` (+ publish-log.json)
   * via `safeDeleteProjectStore` — backup-before-delete, path-confined, never
   * touching foreign files or `.symbion/backups/`. Defaults to `false` (safe):
   * old callers keep the config-only removal with zero disk-write risk. Only
   * the rail's Delete button (after its confirm UI) passes `true`.
   */
  deleteStore?: boolean;
}
export interface RemoveProjectResult {
  /** The updated registry after removal, so the store can replace projects[]
   *  wholesale instead of re-fetching (mirrors listProjects' shape). */
  projects: Array<{ id: string; name: string; path: string }>;
  /** true if an entry was actually removed; false if `id` was unknown
   *  (idempotent no-op). Lets the UI avoid a misleading toast on a stale id. */
  removed: boolean;
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

/** One (kind,name) collision auto-resolved by dedupeImportNames (B1, PLAN §1). */
export interface ImportRename {
  /** the renamed artifact's id (preserved — only its `name` changed). */
  id: string;
  /** the original colliding name. */
  from: string;
  /** the free name it was bumped to (`from-2`, `from-3`, …). */
  to: string;
}

/** One artifact excluded from an import because it had a blocking lint issue
 *  (e.g. empty description). Block-one-not-all (PLAN §1.4): the rest still
 *  import; the UI surfaces these so the user fixes or deselects them. */
export interface ImportBlocked {
  id: string;
  name: string;
  /** human-readable blocking lint messages (e.g. "description is required."). */
  reasons: string[];
}

export interface ImportArtifactsResult {
  project: ProjectStore;
  /** present iff any name collision was auto-resolved (B1). Absent/empty
   *  otherwise -> back-compat with callers that ignore it. */
  renames?: ImportRename[];
  /** present iff any selected artifact was excluded for a blocking lint issue
   *  (block-one-not-all, PLAN §1.4). Absent/empty when everything imported. */
  blocked?: ImportBlocked[];
}

/**
 * createProjectAndImport — B3a (PLAN §3): ONE atomic daemon RPC that creates
 * (or adopts, per B2) a project AND imports the selected artifacts. Replaces
 * the two dialogs' non-atomic `createProject`-then-`importArtifacts` sequence
 * so a client crash/disconnect between the two legacy calls can no longer
 * orphan a half-created project. On a genuine failure AFTER a fresh CREATE the
 * daemon rolls back (drops the config entry + safe-deletes the just-created
 * store); if it ADOPTED a pre-existing store it does NOT delete (the store
 * pre-existed — deleting it would be data loss). The legacy standalone RPCs
 * remain for other callers/tests.
 */
export interface CreateProjectAndImportParams {
  name: string;
  path: string;
  selectedIds: string[];
  scanned: CanonicalArtifact[];
}
export interface CreateProjectAndImportResult {
  project: ProjectStore;
  renames?: ImportRename[];
  blocked?: ImportBlocked[];
}

/**
 * Manual file picker (docs/loops/manual-file-picker-STATE.md PLAN §3). Two
 * read-only RPCs backing the "Browse files manually" escape hatch:
 *
 *  - listTree        — EAGER metadata walk of the whole repo (dirs + files, NO
 *                      content), hard-capped daemon-side (§5). Fires ONLY when
 *                      the user clicks "Browse files manually" — never on a
 *                      normal scan (F1). Caps are daemon constants, NOT params.
 *  - readImportFile  — LAZY single-file read, called only when the user assigns
 *                      a non-ignore role to a picked/skipped file. Bounded size
 *                      + binary check. Confinement violations THROW; expected
 *                      outcomes (too-large/binary/not-found/denied) return a
 *                      soft discriminated result (T6).
 *
 * Neither RPC writes/creates/renames/deletes anything (READ-ONLY, §5.12). The
 * only mutation remains the unchanged `importArtifacts` (writes only the store).
 */
export interface ListTreeParams {
  /** absolute repo root (the project path). */
  root: string;
}
export interface ImportTreeNode {
  /** POSIX-style relPath from root, e.g. "prompts/ba.md.tmpl". */
  relPath: string;
  /** basename. */
  name: string;
  isDir: boolean;
  isSymlink: boolean;
  /** dirs only: true if this dir was pruned by the ignore-list (shown collapsed, not walked). */
  ignored?: boolean;
  /** files only: byte size (for the UI to grey out oversized ones pre-read). */
  size?: number;
  /** files only: true if the walker flagged it likely-binary by extension
   *  (defense-in-depth; the real check is on read in readImportFile). */
  likelyBinary?: boolean;
}
export interface ListTreeResult {
  /** realpath'd root actually walked. */
  root: string;
  /** flat list, parent-before-child order; the UI reconstructs the tree. */
  nodes: ImportTreeNode[];
  /** true if ANY cap tripped (depth/per-dir/total-node) — UI shows a
   *  "results truncated" banner. */
  truncated: boolean;
  /** which cap(s) tripped, for a precise message + /cso assertions. */
  truncatedReasons: Array<"depth" | "per-dir" | "total-node">;
}

export interface ReadImportFileParams {
  root: string;
  /** relative to root; daemon re-confines it — the client value is never trusted. */
  relPath: string;
}
export type ReadImportFileResult =
  | { ok: true; content: string }
  | {
      ok: false;
      reason: "too-large" | "binary" | "not-found" | "denied";
      message: string;
    };

/**
 * applyTemplate — stages ONE bundled template (from apps/web's static
 * template gallery) into a project's store as a new draft artifact, with
 * server-side auto-suffix collision resolution (never blocks, never
 * silently overwrites — docs/loops/templates-marketplace-STATE.md THINK #4).
 * Deliberately separate from `importArtifacts` (see PLAN §0(b)): that RPC's
 * contract is shaped for "N pre-scanned artifacts the user already reviewed
 * and picked," and its `validateAllArtifacts` duplicate-name check BLOCKS
 * rather than auto-suffixes — overloading it would change behavior for its
 * existing caller (ImportDialog/CreateProjectDialog's import-from-disk flow).
 *
 * Writes ONLY `.symbion/store.json` for the target project — never the real
 * repo's `.claude/`/`AGENTS.md` files. The existing publish/diff/confirm/
 * backup pipeline (render -> computeDiff -> write) is untouched and remains
 * the only path that ever writes to disk for a template-derived artifact.
 */
export interface ApplyTemplateParams {
  projectId: string;
  /** the parsed template content — sent from web, NOT re-fetched server-side
   *  (templates live in the web bundle, not on the daemon's filesystem). The
   *  daemon re-validates shape (kind/name/description non-empty) as
   *  defense-in-depth, same "never trust the client" posture as every other
   *  mutating RPC, but trusts the content bytes (no remote/foreign-input
   *  trust boundary — this is the web app's own bundled, build-time,
   *  reviewed content, not arbitrary external input). */
  template: {
    sourceTemplateId: string;
    /** Skills never reach this RPC (Apply disabled client-side) — typed as
     *  the 2-valued union so a "skill" value is a compile error at the call
     *  site, with a runtime guard server-side as a second line of defense. */
    kind: "agent" | "command";
    name: string;
    description: string;
    tools?: string[];
    body: string;
    /**
     * templates-authors PLAN §P6: the item's author id (looked up against
     * AUTHOR_REGISTRY server-side to determine isThirdParty — the daemon
     * does NOT trust a client-asserted boolean about WHETHER the license
     * gate applies, only the client's assertion that it was acknowledged
     * once shown). Absent/undefined is treated as "symbion" (old-client
     * compat — zero behavior change for Symbion-authored items, PLAN §P6).
     */
    authorId?: string;
    /**
     * templates-authors PLAN §P6: required truthy for any non-"symbion"
     * (third-party / GitHub-backed) author — server-side defense-in-depth
     * mirror of the client-side license/attribution acknowledgment gate in
     * TemplatePreviewModal's "license" step. Ignored (no guard triggered)
     * for Symbion-authored items.
     */
    acknowledgedThirdParty?: boolean;
  };
}
export interface ApplyTemplateResult {
  /** the full merged store, same convention as importArtifacts/saveArtifact. */
  project: ProjectStore;
  /** the newly applied artifact's id, so the UI can highlight/locate it. */
  appliedArtifactId: string;
  /** name actually used after auto-suffix (== template.name if no collision). */
  finalName: string;
  /** finalName !== template.name */
  wasRenamed: boolean;
}

/**
 * fetchAuthorTemplates — templates-authors v2 extension (PLAN §P2). Given a
 * GitHub-backed author id (looked up in AUTHOR_REGISTRY server-side, never a
 * client-suppliable owner/repo), fetches that author's repo content LIVE via
 * GitHub's tree API (1 api.github.com call, counts against the 60/hr
 * unauthenticated budget) + per-file raw.githubusercontent.com fetches
 * (confirmed NOT rate-limited the same way, PLAN §P3). Read-only — makes
 * outbound network calls but never writes to disk (added to the daemon's
 * READ_ONLY_METHODS set alongside listModels/checkProviderStatus).
 *
 * Fetched content is held only in daemon/web process memory for the
 * session — never written into Symbion's own source tree (AC7), never
 * cached server-side (in-session caching is a client-side-only concern,
 * THINK #3 / PLAN §P4 — this RPC always performs a real fetch when called).
 */
export interface FetchAuthorTemplatesParams {
  /** looked up in AUTHOR_REGISTRY server-side, not trusted as a free-form
   *  repo descriptor — a hand-crafted request sending extra owner/repo
   *  fields is ignored (PLAN §P8 SSRF finding #1(a)). */
  authorId: string;
}

export type FetchAuthorTemplatesOutcome =
  | { status: "success"; items: TemplateListItem[]; skipped: Array<{ relPath: string; reason: string }> }
  | {
      status: "error";
      kind: "network" | "rate-limit" | "not-found";
      message: string;
      /** epoch ms — present iff kind === "rate-limit" and GitHub's
       *  X-RateLimit-Reset header was present (converted from seconds). */
      resetAt?: number;
    };

export interface FetchAuthorTemplatesResult {
  outcome: FetchAuthorTemplatesOutcome;
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

// ─────────────────────────────────────────────────────────────────────────
// Run Engine v2 (graph-execution-realtime PLAN §8.3). SSE control stays on
// POST /rpc; the live channel is GET /run-events (see the SSE wire types below).
// ─────────────────────────────────────────────────────────────────────────

/** One preflight check row rendered in the RunDialog's PreflightStrip. */
export interface PreflightCheck {
  id: string;
  severity: "ok" | "warn" | "block";
  label: string;
  action?: { label: string; kind: "publish" | "install" | "recheck" | "settings" };
}

export interface RunPreflightParams {
  projectId: string;
  artifactId: string;
}
export interface RunPreflightResult {
  checks: PreflightCheck[];
  /** true iff any check is severity "block" — Execute is disabled + no nonce. */
  blocked: boolean;
  needsFirstRunAck: boolean;
  /** exact command line echoed read-only in the dialog. */
  invocationEcho: string;
  /** verbatim-stable consent copy source, generated from ProjectRunConfig. */
  permissionSummary: {
    mode: string;
    cwd: string;
    ceilings: { wallClockMs: number; tokenCap: number };
    /** the full plain-language consent sentence (single source of the disclosure). */
    sentence: string;
  };
  lastRun?: {
    status: RunStatus;
    durationMs: number | null;
    costUsd: number | null;
    endedAt: string | null;
    /** the requirement text of the last terminal run — pre-fills+selects RunDialog's
     *  requirement field (design §1B/§3.2 L3). null if unavailable (e.g. legacy run.json). */
    requirement: string | null;
  };
  /** present iff !blocked — the daemon-minted single-use consent nonce (Flaw F1). */
  consentNonce?: string;
}

export interface StartRunParams {
  projectId: string;
  artifactId: string;
  requirement: string;
  model?: string;
  /** the nonce returned by runPreflight; consumed single-use by startRun. */
  nonce: string;
  /** when true, the daemon persists firstRunAck (computing the hash itself). */
  ackFirstRun?: boolean;
}
export interface StartRunResult {
  runId: string;
  run: RunInfo;
}

export interface CancelRunParams {
  projectId: string;
  runId: string;
}
export interface CancelRunResult {
  status: RunStatus;
  /** present iff the process was NOT confirmed dead (ER-6) — surfaced for a manual kill. */
  pid?: number;
}

export interface ListRunsParams {
  projectId: string;
}
export interface ListRunsResult {
  runs: RunListItem[];
  activeRunId?: string;
}

export interface GetRunEventsParams {
  projectId: string;
  runId: string;
  afterSeq: number;
}
export interface GetRunEventsResult {
  events: PersistedRunEvent[];
  run: RunInfo;
  /** true iff the run is terminal AND all events up to lastSeq were returned. */
  done: boolean;
}

/** SSE `event: run` frame payload (batched events, id = last seq in batch). */
export interface RunSseEventsFrame {
  runId: string;
  events: PersistedRunEvent[];
}
/** SSE `event: state` frame payload (lifecycle transitions). */
export interface RunSseStateFrame extends RunInfo {}

export type RpcMethod =
  | "ping"
  | "browseFolder"
  | "validatePath"
  | "listDir"
  | "makeDir"
  | "listProjects"
  | "createProject"
  | "removeProject"
  | "loadProject"
  | "saveArtifact"
  | "deleteArtifact"
  | "updateSettings"
  | "scanClaudeDir"
  | "listTree"
  | "readImportFile"
  | "importArtifacts"
  | "createProjectAndImport"
  | "applyTemplate"
  | "fetchAuthorTemplates"
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
  | "setActiveProvider"
  | "runPreflight"
  | "startRun"
  | "cancelRun"
  | "listRuns"
  | "getRunEvents";

export interface RpcRequest<M extends RpcMethod = RpcMethod, P = unknown> {
  method: M;
  params: P;
}

export interface RpcErrorBody {
  error: { code: string; message: string };
}

// Re-exported for convenience so consumers of @symbion/rpc-types don't also
// need a separate import from @symbion/core for the IR types referenced above.
export type {
  CanonicalArtifact,
  DiffFile,
  FourWay,
  PersistedRunEvent,
  ProjectRunConfig,
  ProjectSettings,
  ProjectStore,
  PublishResult,
  RenderedFile,
  RunInfo,
  RunListItem,
  RunState,
  RunStatus,
  RunSummary,
  TargetId,
  TemplateListItem,
  TimelineRow,
};
