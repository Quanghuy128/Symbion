/**
 * SECURITY tests (/cso gate) for B3b `safeDeleteProjectStore` + the §4 removeProject
 * ordering + B2 adopt content-trust. Testplan §3 (S1–S14). Every guard G1–G7 has a
 * test. Temp roots only — never the real ~/.config/symbion or a real repo.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlers, RpcError } from "../src/rpc/handlers.js";
import { safeDeleteProjectStore } from "../src/store/store.js";

let configDir: string;
let projectRoot: string;
const ctx = { port: 20128, version: "0.1.0" };

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "symbion-config-"));
  process.env["SYMBION_CONFIG_DIR"] = configDir;
  projectRoot = mkdtempSync(join(tmpdir(), "symbion-project-"));
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  delete process.env["SYMBION_CONFIG_DIR"];
});

/** Seed a minimal valid store.json in projectRoot/.symbion. */
function seedStore(root: string, extra?: { publishLog?: boolean }): void {
  mkdirSync(join(root, ".symbion"), { recursive: true });
  writeFileSync(
    join(root, ".symbion", "store.json"),
    JSON.stringify({ schemaVersion: 1, id: "x", name: "n", path: root, createdAt: "", artifacts: [], settings: {} }, null, 2),
    "utf-8"
  );
  if (extra?.publishLog) {
    writeFileSync(join(root, ".symbion", "publish-log.json"), JSON.stringify([{ version: "1.0.0" }]), "utf-8");
  }
}

function removedBackupDir(root: string): string | undefined {
  const backupsRoot = join(root, ".symbion", "backups");
  if (!existsSync(backupsRoot)) return undefined;
  const dirs = readdirSync(backupsRoot).filter((d) => d.startsWith("removed-"));
  return dirs.length ? join(backupsRoot, dirs[0]!) : undefined;
}

describe("B3b safeDeleteProjectStore guards (S1–S10)", () => {
  it("S1 G3 backup-before-delete: original store.json copied (identical bytes) then removed", () => {
    seedStore(projectRoot);
    const storePath = join(projectRoot, ".symbion", "store.json");
    const before = readFileSync(storePath, "utf-8");

    const res = safeDeleteProjectStore(projectRoot);
    expect(res.deleted).toContain("store.json");
    expect(existsSync(storePath)).toBe(false);

    const backupDir = removedBackupDir(projectRoot)!;
    expect(backupDir).toBeTruthy();
    expect(readFileSync(join(backupDir, "store.json"), "utf-8")).toBe(before);
  });

  it("S2 G3 fail-closed: backup copy failure -> store.json STILL EXISTS, nothing unlinked, throws", () => {
    seedStore(projectRoot);
    const storePath = join(projectRoot, ".symbion", "store.json");
    // Make the backups dir un-writable so copyFileSync throws. mkdir the parent
    // read-only so creating removed-<ISO>/ inside it fails.
    const backupsRoot = join(projectRoot, ".symbion", "backups");
    mkdirSync(backupsRoot, { recursive: true });
    chmodSync(backupsRoot, 0o500); // r-x: cannot create child dir
    try {
      expect(() => safeDeleteProjectStore(projectRoot)).toThrow(RpcError);
      // fail-closed: nothing deleted
      expect(existsSync(storePath)).toBe(true);
    } finally {
      chmodSync(backupsRoot, 0o700); // restore so afterEach cleanup works
    }
  });

  it("S1b G3 publish-log.json also backed up when present; absent -> skipped", () => {
    seedStore(projectRoot, { publishLog: true });
    const res = safeDeleteProjectStore(projectRoot);
    expect(res.deleted.sort()).toEqual(["publish-log.json", "store.json"]);
    const backupDir = removedBackupDir(projectRoot)!;
    expect(existsSync(join(backupDir, "publish-log.json"))).toBe(true);
    expect(existsSync(join(projectRoot, ".symbion", "publish-log.json"))).toBe(false);
  });

  it("S4 G2 `.symbion` is a symlink -> RpcError(unsafe-store); nothing deleted/followed", () => {
    // Real store lives in a sibling dir; projectRoot/.symbion is a symlink to it.
    const realSymbionHolder = mkdtempSync(join(tmpdir(), "symbion-foreign-"));
    try {
      mkdirSync(join(realSymbionHolder, "sym"));
      writeFileSync(join(realSymbionHolder, "sym", "store.json"), "{}", "utf-8");
      symlinkSync(join(realSymbionHolder, "sym"), join(projectRoot, ".symbion"));
      expect(() => safeDeleteProjectStore(projectRoot)).toThrow(/symlink/i);
      // the foreign target file is untouched
      expect(existsSync(join(realSymbionHolder, "sym", "store.json"))).toBe(true);
    } finally {
      rmSync(realSymbionHolder, { recursive: true, force: true });
    }
  });

  it("S5 G2 store.json is a symlink to a foreign file -> refused; foreign target NOT unlinked", () => {
    seedStore(projectRoot);
    const foreign = join(projectRoot, "..", `foreign-${Date.now()}.json`);
    writeFileSync(foreign, "SECRET", "utf-8");
    try {
      rmSync(join(projectRoot, ".symbion", "store.json"));
      symlinkSync(foreign, join(projectRoot, ".symbion", "store.json"));
      expect(() => safeDeleteProjectStore(projectRoot)).toThrow(RpcError);
      // foreign target preserved
      expect(existsSync(foreign)).toBe(true);
      expect(readFileSync(foreign, "utf-8")).toBe("SECRET");
    } finally {
      rmSync(foreign, { force: true });
    }
  });

  it("S5b G4 store.json is an in-root symlink -> refused by explicit lstat guard; target NOT unlinked", () => {
    // A symlink that stays INSIDE root passes resolveConfinedPath's leaf check,
    // so the explicit lstat(isSymbolicLink) guard (G4) is what refuses it.
    seedStore(projectRoot);
    writeFileSync(join(projectRoot, ".symbion", "real-target.json"), "keep", "utf-8");
    rmSync(join(projectRoot, ".symbion", "store.json"));
    symlinkSync(join(projectRoot, ".symbion", "real-target.json"), join(projectRoot, ".symbion", "store.json"));
    expect(() => safeDeleteProjectStore(projectRoot)).toThrow(RpcError);
    expect(existsSync(join(projectRoot, ".symbion", "real-target.json"))).toBe(true);
  });

  it("S6 G4 never-touch-foreign: other .symbion files + root siblings survive", () => {
    seedStore(projectRoot, { publishLog: true });
    writeFileSync(join(projectRoot, ".symbion", "other.txt"), "keep", "utf-8");
    writeFileSync(join(projectRoot, "README.md"), "keep", "utf-8");

    safeDeleteProjectStore(projectRoot);

    expect(existsSync(join(projectRoot, ".symbion", "other.txt"))).toBe(true);
    expect(existsSync(join(projectRoot, "README.md"))).toBe(true);
    expect(existsSync(join(projectRoot, ".symbion", "store.json"))).toBe(false);
    expect(existsSync(join(projectRoot, ".symbion", "publish-log.json"))).toBe(false);
  });

  it("S7 G5 backups/ survives: seed backups/v1/manifest.json -> still present after delete", () => {
    seedStore(projectRoot);
    mkdirSync(join(projectRoot, ".symbion", "backups", "v1"), { recursive: true });
    writeFileSync(join(projectRoot, ".symbion", "backups", "v1", "manifest.json"), "{}", "utf-8");

    safeDeleteProjectStore(projectRoot);

    expect(existsSync(join(projectRoot, ".symbion", "backups", "v1", "manifest.json"))).toBe(true);
  });

  it("S8 G6 idempotent: store.json already absent -> deleted:[], no throw; re-call is no-op", () => {
    mkdirSync(join(projectRoot, ".symbion"), { recursive: true });
    const res = safeDeleteProjectStore(projectRoot);
    expect(res.deleted).toEqual([]);
    // second call also fine
    expect(() => safeDeleteProjectStore(projectRoot)).not.toThrow();
  });

  it("S8b no .symbion dir at all -> no-op, no throw", () => {
    const res = safeDeleteProjectStore(projectRoot);
    expect(res.deleted).toEqual([]);
  });

  it("S9 G7 backup dir confined under .symbion/backups/", () => {
    seedStore(projectRoot);
    const res = safeDeleteProjectStore(projectRoot);
    const realBackups = statSync(join(projectRoot, ".symbion", "backups"));
    expect(realBackups.isDirectory()).toBe(true);
    expect(res.backupDir.startsWith(join(projectRoot, ".symbion", "backups"))).toBe(true);
  });

  it("S10 G4 no glob/readdir-delete: a rogue `store.json.bak` in .symbion is NOT deleted", () => {
    seedStore(projectRoot);
    writeFileSync(join(projectRoot, ".symbion", "store.json.bak"), "rogue", "utf-8");
    safeDeleteProjectStore(projectRoot);
    expect(existsSync(join(projectRoot, ".symbion", "store.json.bak"))).toBe(true);
  });
});

describe("B3b removeProject §4 ordering (S11, S14)", () => {
  it("S11 delete fails -> config entry RETAINED (fail-closed, T8)", () => {
    // Register a project, then make its store delete fail (symlinked .symbion).
    handlers.createProject({ name: "p", path: projectRoot }, ctx);
    const id = handlers.listProjects({}, ctx).projects[0]!.id;

    // Replace .symbion with a symlink so safeDeleteProjectStore refuses (G2).
    const holder = mkdtempSync(join(tmpdir(), "symbion-holder-"));
    try {
      rmSync(join(projectRoot, ".symbion"), { recursive: true, force: true });
      mkdirSync(join(holder, "sym"));
      symlinkSync(join(holder, "sym"), join(projectRoot, ".symbion"));

      expect(() => handlers.removeProject({ id, deleteStore: true }, ctx)).toThrow(RpcError);
      // config entry NOT dropped -> still listed, retryable
      expect(handlers.listProjects({}, ctx).projects.map((p) => p.id)).toContain(id);
    } finally {
      rmSync(join(projectRoot, ".symbion"), { recursive: true, force: true });
      rmSync(holder, { recursive: true, force: true });
    }
  });

  it("S11b deleteStore:false (default) -> config-only removal, store.json UNTOUCHED (E14)", () => {
    handlers.createProject({ name: "p", path: projectRoot }, ctx);
    const id = handlers.listProjects({}, ctx).projects[0]!.id;
    const res = handlers.removeProject({ id }, ctx); // no deleteStore
    expect(res.removed).toBe(true);
    expect(existsSync(join(projectRoot, ".symbion", "store.json"))).toBe(true);
  });

  it("E13 removeProject deleteStore:true when store already gone -> idempotent, config still dropped", () => {
    handlers.createProject({ name: "p", path: projectRoot }, ctx);
    const id = handlers.listProjects({}, ctx).projects[0]!.id;
    rmSync(join(projectRoot, ".symbion", "store.json"));
    const res = handlers.removeProject({ id, deleteStore: true }, ctx);
    expect(res.removed).toBe(true);
    expect(handlers.listProjects({}, ctx).projects).toHaveLength(0);
  });

  it("full delete happy path: store deleted + backup made + config dropped", () => {
    handlers.createProject({ name: "p", path: projectRoot }, ctx);
    const id = handlers.listProjects({}, ctx).projects[0]!.id;
    handlers.removeProject({ id, deleteStore: true }, ctx);
    expect(existsSync(join(projectRoot, ".symbion", "store.json"))).toBe(false);
    expect(removedBackupDir(projectRoot)).toBeTruthy();
    expect(handlers.listProjects({}, ctx).projects).toHaveLength(0);
  });
});

describe("B2 adopt content-trust (S12, S13)", () => {
  it("S12/S13 adopt performs ZERO disk write outside config; store.json unchanged (read-only-on-adopt)", () => {
    // Planted store with attacker-chosen id + artifacts.
    mkdirSync(join(projectRoot, ".symbion"), { recursive: true });
    const planted = {
      schemaVersion: 1,
      id: "attacker-id",
      name: "planted",
      path: projectRoot,
      createdAt: "2020-01-01T00:00:00.000Z",
      artifacts: [
        { id: "evil", kind: "agent", name: "evil", description: "d", body: "b", meta: { version: "draft", status: "draft", createdAt: "", updatedAt: "" } },
      ],
      settings: { defaultTargets: ["claude"], conflictPolicy: "warn", backupBeforeWrite: true, requireCleanGit: false },
    };
    const storePath = join(projectRoot, ".symbion", "store.json");
    writeFileSync(storePath, JSON.stringify(planted, null, 2), "utf-8");
    const before = readFileSync(storePath, "utf-8");

    const res = handlers.createProject({ name: "chosen", path: projectRoot }, ctx);
    // adopt succeeds (documented) with the planted id + artifacts
    expect(res.project.id).toBe("attacker-id");
    expect(res.project.artifacts.map((a) => a.id)).toEqual(["evil"]);
    // NO .claude/ was written; only the store was read
    expect(existsSync(join(projectRoot, ".claude"))).toBe(false);
    // store.json byte-unchanged (adopt is store-read-only)
    expect(readFileSync(storePath, "utf-8")).toBe(before);
  });
});
