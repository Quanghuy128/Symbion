import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_PROJECT_SETTINGS,
  type GlobalConfig,
  type ProjectStore,
} from "@symbion/core";

const CURRENT_SCHEMA_VERSION = 1 as const;

export class UnsupportedSchemaVersionError extends Error {
  constructor(found: number) {
    super(`store.json was created by a newer version of Symbion (schemaVersion=${found}). Refusing to overwrite.`);
    this.name = "UnsupportedSchemaVersionError";
  }
}

/**
 * atomicWriteJson — mkdir-recursive + temp-file write + rename. Exported (not
 * just module-local) so other daemon-only modules that own their own JSON
 * file under globalConfigDir() (e.g. llm/secrets.ts's providers.json) reuse
 * this exact primitive instead of re-implementing temp->rename semantics —
 * one write-primitive, not two (docs/loops/multi-provider-settings-STATE.md §3.2).
 *
 * `mode` (optional) chmods the temp file BEFORE the rename so the final file
 * never has a window where it's readable by more than the intended mode
 * (e.g. 0o600 for secrets) — chmod-after-rename would leave a brief window
 * with default (typically 0o644) permissions.
 *
 * `dirMode` (optional) additionally chmods the containing directory — used
 * by secrets.ts so `~/.config/symbion/` itself isn't left world-readable
 * (0o755 from the process umask) even though the secrets file inside it is
 * 0o600, per the /cso review's directory-permissions finding.
 */
export function atomicWriteJson(
  absPath: string,
  data: unknown,
  opts?: { mode?: number; dirMode?: number }
): void {
  const dir = dirname(absPath);
  mkdirSync(dir, { recursive: true });
  if (opts?.dirMode !== undefined) {
    chmodSync(dir, opts.dirMode);
  }
  const tempPath = `${absPath}.symbion-tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  if (opts?.mode !== undefined) {
    chmodSync(tempPath, opts.mode);
  }
  renameSync(tempPath, absPath);
}

function backupBeforeMigrate(absPath: string, raw: string): void {
  const backupPath = `${absPath}.bak-pre-migrate-${Date.now()}`;
  writeFileSync(backupPath, raw, "utf-8");
}

// ---------- Per-project store ----------

export function projectStorePath(projectRoot: string): string {
  return join(projectRoot, ".symbion", "store.json");
}

export function projectStoreExists(projectRoot: string): boolean {
  return existsSync(projectStorePath(projectRoot));
}

function migrateProjectStore(raw: Record<string, unknown>, absPath: string, rawText: string): ProjectStore {
  const schemaVersion = raw["schemaVersion"];
  if (typeof schemaVersion !== "number") {
    throw new Error("store.json is missing schemaVersion.");
  }
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(schemaVersion);
  }
  if (schemaVersion < CURRENT_SCHEMA_VERSION) {
    backupBeforeMigrate(absPath, rawText);
    // No migrate_v(n->n+1) transforms defined yet (schemaVersion is still 1 in v1) —
    // chain point reserved here for future schema bumps.
  }
  return raw as unknown as ProjectStore;
}

export function loadProjectStore(projectRoot: string): ProjectStore {
  const absPath = projectStorePath(projectRoot);
  const rawText = readFileSync(absPath, "utf-8");
  const raw = JSON.parse(rawText) as Record<string, unknown>;
  return migrateProjectStore(raw, absPath, rawText);
}

export function saveProjectStore(projectRoot: string, store: ProjectStore): void {
  atomicWriteJson(projectStorePath(projectRoot), store);
}

export function createProjectStore(projectRoot: string, name: string, id: string): ProjectStore {
  const store: ProjectStore = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id,
    name,
    path: projectRoot,
    createdAt: new Date().toISOString(),
    artifacts: [],
    settings: { ...DEFAULT_PROJECT_SETTINGS },
  };
  saveProjectStore(projectRoot, store);
  return store;
}

// ---------- User-level global config ----------

export function globalConfigDir(): string {
  // SYMBION_CONFIG_DIR override exists solely for test isolation (Vitest integration
  // tests run against temp dirs, never the real ~/.config/symbion).
  if (process.env["SYMBION_CONFIG_DIR"]) {
    return process.env["SYMBION_CONFIG_DIR"]!;
  }
  return join(homedir(), ".config", "symbion");
}

export function globalConfigPath(): string {
  return join(globalConfigDir(), "config.json");
}

function migrateGlobalConfig(raw: Record<string, unknown>, absPath: string, rawText: string): GlobalConfig {
  const schemaVersion = raw["schemaVersion"];
  if (typeof schemaVersion !== "number") {
    throw new Error("config.json is missing schemaVersion.");
  }
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(schemaVersion);
  }
  if (schemaVersion < CURRENT_SCHEMA_VERSION) {
    backupBeforeMigrate(absPath, rawText);
  }
  return raw as unknown as GlobalConfig;
}

export function loadGlobalConfig(): GlobalConfig {
  const absPath = globalConfigPath();
  if (!existsSync(absPath)) {
    const fresh: GlobalConfig = { ...DEFAULT_GLOBAL_CONFIG, projects: [] };
    atomicWriteJson(absPath, fresh);
    return fresh;
  }
  const rawText = readFileSync(absPath, "utf-8");
  const raw = JSON.parse(rawText) as Record<string, unknown>;
  return migrateGlobalConfig(raw, absPath, rawText);
}

export function saveGlobalConfig(config: GlobalConfig): void {
  atomicWriteJson(globalConfigPath(), config);
}
