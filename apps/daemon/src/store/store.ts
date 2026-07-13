import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_PROJECT_SETTINGS,
  type GlobalConfig,
  type ProjectStore,
} from "@symbion/core";
import { resolveConfinedPath, PathConfinementError } from "../rpc/guard.js";
import { RpcError } from "../rpc/rpcError.js";

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

/**
 * safeDeleteProjectStore — reversibly delete a project's Symbion store files.
 * DESTRUCTIVE write path (docs/loops/import-lifecycle-fixes-STATE.md PLAN §4 /
 * B3b). Deletes ONLY `.symbion/store.json` (+ `.symbion/publish-log.json` if
 * present). NEVER deletes `.symbion/backups/` (the reversibility guarantee lives
 * there) and NEVER touches any file outside `.symbion/`. Backup-before-delete:
 * copies each target into `.symbion/backups/removed-<ISO>/` BEFORE unlinking, so
 * removal is reversible exactly like a publish overwrite.
 *
 * The analog of "no DROP without WHERE" — guards G1–G7 (PLAN §4):
 *   G1 path-confine every target via resolveConfinedPath.
 *   G2 refuse if `.symbion` itself is a symlink (loud, specific error).
 *   G3 backup-before-delete, fail-closed (backup write fails -> throw, no unlink).
 *   G4 never touch foreign files — only literal store.json/publish-log.json.
 *   G5 backups/ survives (excluded from the delete list; no readdir/glob).
 *   G6 idempotent — a missing target is skipped silently.
 *   G7 the removed-<ISO>/ backup dir is itself confined under .symbion/backups/.
 */
export function safeDeleteProjectStore(
  projectRoot: string
): { backupDir: string; deleted: string[] } {
  // The two — and ONLY two — files this function is ever allowed to target.
  // Literal names, no glob / readdir-and-delete (G4/G5/S10).
  const TARGET_REL_NAMES = [".symbion/store.json", ".symbion/publish-log.json"] as const;

  // G2: refuse to operate through a symlinked `.symbion` directory. lstat (does
  // NOT follow) so a symlink is detected as itself, never followed. If `.symbion`
  // does not exist there is nothing to delete — idempotent no-op (G6).
  const symbionDir = join(projectRoot, ".symbion");
  if (existsSync(symbionDir)) {
    let dirStat;
    try {
      dirStat = lstatSync(symbionDir);
    } catch {
      // Race/permission — fail closed with a loud typed error rather than proceed.
      throw new RpcError("unsafe-store", `Cannot inspect .symbion at ${projectRoot}.`);
    }
    if (dirStat.isSymbolicLink()) {
      throw new RpcError(
        "unsafe-store",
        `.symbion is a symlink at ${projectRoot}; refusing to delete through it.`
      );
    }
  } else {
    // No .symbion at all -> nothing to delete. Still return a (confined) backupDir
    // path for shape stability, but create nothing.
    return { backupDir: "", deleted: [] };
  }

  // G7: the backup dir is confined under .symbion/backups/. Timestamp is
  // filename-safe (ISO with ':'/'.' replaced) so it's a single path segment.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let backupDirAbs: string;
  try {
    backupDirAbs = resolveConfinedPath(projectRoot, join(".symbion", "backups", `removed-${stamp}`));
  } catch (err) {
    if (err instanceof PathConfinementError) {
      throw new RpcError("path-confinement", err.message);
    }
    throw err;
  }

  // Resolve + confine every candidate target FIRST (G1). A confinement violation
  // (e.g. an intermediate symlink escaping root) throws BEFORE anything is
  // deleted or backed up (fail-closed).
  const targets: Array<{ abs: string; name: string }> = [];
  for (const rel of TARGET_REL_NAMES) {
    let abs: string;
    try {
      abs = resolveConfinedPath(projectRoot, rel);
    } catch (err) {
      if (err instanceof PathConfinementError) {
        throw new RpcError("path-confinement", err.message);
      }
      throw err;
    }
    // G6 idempotent: skip a target that is not present.
    if (!existsSync(abs)) continue;
    // G4: only regular files are ever unlinked here. A symlink or dir at this
    // literal path is refused (never followed, never rm -rf'd).
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue; // vanished between existsSync and lstat — treat as already gone (G6).
    }
    if (st.isSymbolicLink()) {
      throw new RpcError(
        "unsafe-store",
        `${rel} is a symlink; refusing to delete through it.`
      );
    }
    if (!st.isFile()) {
      throw new RpcError("unsafe-store", `${rel} is not a regular file; refusing to delete.`);
    }
    targets.push({ abs, name: rel.slice(".symbion/".length) });
  }

  // Nothing present -> idempotent no-op (G6). Do NOT create an empty backup dir.
  if (targets.length === 0) {
    return { backupDir: "", deleted: [] };
  }

  // G3: backup-before-delete, fail-closed. Create the confined backup dir, copy
  // EVERY target into it FIRST; only if all copies succeed do we unlink. A
  // backup-dir-create OR copy failure throws and NOTHING is unlinked.
  try {
    mkdirSync(backupDirAbs, { recursive: true });
  } catch (err) {
    throw new RpcError(
      "backup-failed",
      `Failed to create the backup directory before delete: ${(err as Error).message}. Nothing was deleted.`
    );
  }
  for (const t of targets) {
    const dest = join(backupDirAbs, t.name);
    try {
      copyFileSync(t.abs, dest);
    } catch (err) {
      throw new RpcError(
        "backup-failed",
        `Failed to back up ${t.name} before delete: ${(err as Error).message}. Nothing was deleted.`
      );
    }
  }

  const deleted: string[] = [];
  for (const t of targets) {
    unlinkSync(t.abs);
    deleted.push(t.name);
  }

  return { backupDir: backupDirAbs, deleted };
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
