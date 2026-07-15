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

/**
 * Per-project Run Engine v2 config (graph-execution-realtime PLAN §8.2).
 * OPTIONAL on ProjectSettings — absent => DEFAULT_RUN_CONFIG (additive; store
 * schemaVersion stays 1, no migration). Permission posture is surfaced in the
 * run-consent UI, never a silent permissive default (locked §6.1: acceptEdits).
 */
export interface ProjectRunConfig {
  permissionMode: "plan" | "acceptEdits" | "bypassPermissions";
  allowedTools: string[];
  ceilings: { wallClockMs: number; tokenCap: number };
  /** first-run acknowledgment, keyed to a hash of {permissionMode, allowedTools}
   *  so a mode/tools change forces a re-ask (design §0). Written server-side by
   *  startRun (the daemon computes the hash — never trusts a client hash). */
  firstRunAck?: { settingsHash: string; ackedAt: string };
}

export const DEFAULT_RUN_CONFIG: ProjectRunConfig = {
  permissionMode: "acceptEdits",
  allowedTools: [],
  ceilings: { wallClockMs: 1_800_000, tokenCap: 200_000 },
};

export interface ProjectSettings {
  defaultTargets: TargetId[];
  /** "warn" = cảnh báo & hỏi ; "never-overwrite" = không bao giờ đè */
  conflictPolicy: "warn" | "never-overwrite";
  backupBeforeWrite: boolean;
  requireCleanGit: boolean;
  markerTemplate: string;
  /** Run Engine v2 config (optional, additive). */
  run?: ProjectRunConfig;
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
}

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  schemaVersion: 1,
  port: 12802,
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
