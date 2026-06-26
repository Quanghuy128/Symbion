import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
    super(`store.json được tạo bởi phiên bản Symbion mới hơn (schemaVersion=${found}). Từ chối ghi đè.`);
    this.name = "UnsupportedSchemaVersionError";
  }
}

function atomicWriteJson(absPath: string, data: unknown): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const tempPath = `${absPath}.symbion-tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
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
    throw new Error("store.json thiếu schemaVersion.");
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
    throw new Error("config.json thiếu schemaVersion.");
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
