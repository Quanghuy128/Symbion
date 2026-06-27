/**
 * Canonical IR — the single source of truth for an authored agent/command.
 * Pure data types only. No fs/net/Node imports anywhere in this file.
 */

export type ArtifactKind = "agent" | "command";

export type TargetId = "claude" | "codex";

/**
 * Ordered key/value pair for "Nâng cao" (advanced) custom fields.
 * Modeled as an array (not Record) to guarantee byte-stable, order-preserving
 * render across save/reload cycles (STATE §2.1 note + §8 assumption #1).
 */
export interface CustomField {
  key: string;
  value: string;
}

export interface ArtifactMeta {
  /** version stamped at last publish, or "draft" if never published. */
  version: string;
  status: "draft" | "published" | "conflict";
  createdAt: string; // ISO
  updatedAt: string; // ISO
  sourceTemplateId?: string;
  /** content hash recorded at last successful publish, per target. */
  publishedHashes?: Partial<Record<TargetId, string>>;
}

export interface CanonicalArtifact {
  /** stable internal id (uuid) — survives renames; used in the managed marker. */
  id: string;
  kind: ArtifactKind;

  /** logical name. Agent -> .claude/agents/<name>.md ; Command -> /<name> + .claude/commands/<name>.md */
  name: string;
  /** maps to frontmatter `description:` for BOTH kinds. Required. */
  description: string;

  /** AGENT ONLY -> frontmatter `tools:` (CSV). undefined/empty for commands. */
  tools?: string[];
  /** COMMAND ONLY -> UI hint that body uses $ARGUMENTS. Does not render to frontmatter. */
  usesArguments?: boolean;

  /** the markdown system prompt / orchestration body (everything after frontmatter). */
  body: string;

  /** "Nâng cao" passthrough, ordered. Rendered verbatim + "(custom)" tag in UI. */
  customFields?: CustomField[];

  meta: ArtifactMeta;
}

export interface ProjectSettings {
  defaultTargets: TargetId[];
  /** "warn" = cảnh báo & hỏi ; "never-overwrite" = không bao giờ đè */
  conflictPolicy: "warn" | "never-overwrite";
  backupBeforeWrite: boolean;
  requireCleanGit: boolean;
  markerTemplate: string;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  defaultTargets: ["claude"],
  conflictPolicy: "warn",
  backupBeforeWrite: true,
  requireCleanGit: false,
  markerTemplate: "managed-by: symbion",
};

export interface ProjectStore {
  schemaVersion: 1;
  id: string;
  name: string;
  path: string;
  createdAt: string;
  artifacts: CanonicalArtifact[];
  settings: ProjectSettings;
}

export interface GlobalConfig {
  schemaVersion: 1;
  port: number;
  theme: "system" | "light" | "dark";
  lastProjectId?: string;
  builderDefaultTab: "form" | "markdown";
  /** registry of known projects, so the sidebar can list projects across repos. */
  projects: Array<{ id: string; name: string; path: string }>;
  /** Seam for the remote LLM provider's (future) provider-switch UI default, daemon-owned
   *  only. apps/web never reads or writes this field; it is never sent in any RPC response
   *  body. The remote API key itself is NOT stored here (or anywhere on disk) — it is read
   *  exclusively from the SYMBION_REMOTE_LLM_API_KEY env var at call time. v1 has no settings
   *  UI to populate this; it exists only so a future ticket doesn't need another schema
   *  migration. See docs/loops/auto-generate-body-STATE.md §10.4. */
  llm?: {
    activeProvider?: "ollama" | "remote";
  };
}

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  schemaVersion: 1,
  port: 20128,
  theme: "system",
  builderDefaultTab: "form",
  projects: [],
};

export interface PublishResult {
  target: TargetId;
  relPath: string;
  action: "created" | "updated" | "skipped-conflict" | "skipped-same" | "error";
  artifactId?: string;
  contentHash?: string;
  error?: string;
}

export interface PublishLogEntry {
  version: string;
  timestamp: string;
  targets: TargetId[];
  results: PublishResult[];
  backupDir: string;
}

export interface BackupRecord {
  version: string;
  timestamp: string;
  files: Array<{ relPath: string; existedBefore: boolean; backupRelPath: string }>;
}

export interface LintIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  artifactId?: string;
  field?: string;
}
