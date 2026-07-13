/**
 * Integration tests for the import-lifecycle-fixes cluster (B1/B2/B3a).
 * Testplan §2 (D1–D18). Temp repo root + temp SYMBION_CONFIG_DIR only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactKind, CanonicalArtifact } from "@symbion/core";

// D15 rollback needs a DETERMINISTIC import-failure AFTER a fresh create. Under
// ESM, spying on a re-exported binding won't rebind the copy handlers.ts already
// imported — so we vi.mock the store module with a real passthrough plus a
// toggleable `failNextSave` flag that throws inside importIntoStore's
// saveProjectStore. createOrAdoptProject's createProjectStore uses the REAL save
// (module-internal), so only the IMPORT save is failed. See D15.
let failNextSave = false;
vi.mock("../src/store/store.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/store.js")>("../src/store/store.js");
  return {
    ...actual,
    saveProjectStore(root: string, store: unknown) {
      if (failNextSave) {
        failNextSave = false;
        throw new Error("simulated disk failure during import save");
      }
      return actual.saveProjectStore(root, store as never);
    },
  };
});

import { handlers, RpcError } from "../src/rpc/handlers.js";
import { loadProjectStore } from "../src/store/store.js";

afterEach(() => {
  failNextSave = false;
  vi.restoreAllMocks();
});

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

function art(id: string, kind: ArtifactKind, name: string, description = "desc"): CanonicalArtifact {
  return {
    id,
    kind,
    name,
    description,
    body: "body",
    meta: {
      version: "draft",
      status: "draft",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    },
  };
}

/** Seed an orphan store on disk (NOT registered in global config). */
function writeOrphanStore(root: string, id: string, name: string, artifacts: CanonicalArtifact[]): void {
  mkdirSync(join(root, ".symbion"), { recursive: true });
  const store = {
    schemaVersion: 1,
    id,
    name,
    path: root,
    createdAt: "2026-07-12T00:00:00.000Z",
    artifacts,
    settings: {
      defaultTargets: ["claude"],
      conflictPolicy: "warn",
      backupBeforeWrite: true,
      requireCleanGit: false,
    },
  };
  writeFileSync(join(root, ".symbion", "store.json"), JSON.stringify(store, null, 2), "utf-8");
}

// ── 2a. B1 — importArtifacts dedup + block-one ───────────────────────────────

describe("B1 importArtifacts (D1–D7)", () => {
  it("D1 twin `ba` agents (both new) -> ba + ba-2; 1 rename; no throw", async () => {
    await handlers.createProject({ name: "p", path: projectRoot }, ctx);
    const id = (await handlers.listProjects({}, ctx)).projects[0]!.id;
    const scanned = [art("a1", "agent", "ba"), art("a2", "agent", "ba")];
    const res = handlers.importArtifacts(
      { projectId: id, selectedIds: ["a1", "a2"], scanned },
      ctx
    );
    const names = res.project.artifacts.filter((a) => a.kind === "agent").map((a) => a.name).sort();
    expect(names).toEqual(["ba", "ba-2"]);
    expect(res.renames).toEqual([{ id: "a2", from: "ba", to: "ba-2" }]);
    expect(res.blocked).toBeUndefined();
  });

  it("D2 one empty-description artifact -> good ones persisted, blocked lists it, no throw", async () => {
    await handlers.createProject({ name: "p", path: projectRoot }, ctx);
    const id = (await handlers.listProjects({}, ctx)).projects[0]!.id;
    const scanned = [art("good", "agent", "ba"), art("bad", "agent", "architect", "")];
    const res = handlers.importArtifacts(
      { projectId: id, selectedIds: ["good", "bad"], scanned },
      ctx
    );
    expect(res.project.artifacts.map((a) => a.id)).toEqual(["good"]);
    expect(res.blocked).toHaveLength(1);
    expect(res.blocked![0]!.id).toBe("bad");
    expect(res.blocked![0]!.reasons.join(" ")).toMatch(/description is required/i);
  });

  it("D3 ALL selected blocked -> store unchanged, blocked=all, returns normally", async () => {
    await handlers.createProject({ name: "p", path: projectRoot }, ctx);
    const id = (await handlers.listProjects({}, ctx)).projects[0]!.id;
    const scanned = [art("b1", "agent", "x", ""), art("b2", "command", "y", "")];
    const res = handlers.importArtifacts(
      { projectId: id, selectedIds: ["b1", "b2"], scanned },
      ctx
    );
    expect(res.project.artifacts).toHaveLength(0);
    expect(res.blocked).toHaveLength(2);
  });

  it("D4 re-import an already-stored artifact (same id) -> name NOT bumped (E19); renames empty", async () => {
    await handlers.createProject({ name: "p", path: projectRoot }, ctx);
    const id = (await handlers.listProjects({}, ctx)).projects[0]!.id;
    const scanned = [art("ba-id", "agent", "ba")];
    handlers.importArtifacts({ projectId: id, selectedIds: ["ba-id"], scanned }, ctx);
    // re-import the same artifact
    const res = handlers.importArtifacts({ projectId: id, selectedIds: ["ba-id"], scanned }, ctx);
    expect(res.project.artifacts.filter((a) => a.name === "ba")).toHaveLength(1);
    expect(res.renames).toBeUndefined();
  });

  it("D5 incoming collides with a DIFFERENT existing artifact -> incoming bumped, existing untouched", async () => {
    await handlers.createProject({ name: "p", path: projectRoot }, ctx);
    const id = (await handlers.listProjects({}, ctx)).projects[0]!.id;
    handlers.importArtifacts({ projectId: id, selectedIds: ["e1"], scanned: [art("e1", "agent", "ba")] }, ctx);
    const res = handlers.importArtifacts(
      { projectId: id, selectedIds: ["i1"], scanned: [art("i1", "agent", "ba")] },
      ctx
    );
    const names = res.project.artifacts.filter((a) => a.kind === "agent").map((a) => a.name).sort();
    expect(names).toEqual(["ba", "ba-2"]);
    expect(res.renames).toEqual([{ id: "i1", from: "ba", to: "ba-2" }]);
  });

  it("D6 server-authoritative: two `ba` with no client suffix still get suffixed daemon-side", async () => {
    await handlers.createProject({ name: "p", path: projectRoot }, ctx);
    const id = (await handlers.listProjects({}, ctx)).projects[0]!.id;
    const res = handlers.importArtifacts(
      { projectId: id, selectedIds: ["c1", "c2"], scanned: [art("c1", "command", "run"), art("c2", "command", "run")] },
      ctx
    );
    const names = res.project.artifacts.map((a) => a.name).sort();
    expect(names).toEqual(["run", "run-2"]);
  });

  it("D7 renames/blocked absent when nothing renamed/blocked", async () => {
    await handlers.createProject({ name: "p", path: projectRoot }, ctx);
    const id = (await handlers.listProjects({}, ctx)).projects[0]!.id;
    const res = handlers.importArtifacts(
      { projectId: id, selectedIds: ["z1"], scanned: [art("z1", "agent", "solo")] },
      ctx
    );
    expect(res.renames).toBeUndefined();
    expect(res.blocked).toBeUndefined();
  });
});

// ── 2b. B2 — createProject adopt-orphan ──────────────────────────────────────

describe("B2 createProject adopt-orphan (D8–D13)", () => {
  it("D8 orphan store on disk, folder NOT in config -> ADOPT: id + artifacts preserved, config name=param, store.json unchanged", async () => {
    const artifacts = [art("x1", "agent", "a1"), art("x2", "command", "c1")];
    writeOrphanStore(projectRoot, "orphan-id", "old-name", artifacts);
    const storePath = join(projectRoot, ".symbion", "store.json");
    const before = readFileSync(storePath, "utf-8");

    const res = handlers.createProject({ name: "new-name", path: projectRoot }, ctx);
    expect(res.project.id).toBe("orphan-id");
    expect(res.project.artifacts.map((a) => a.id).sort()).toEqual(["x1", "x2"]);

    const cfg = (await handlers.listProjects({}, ctx)).projects;
    expect(cfg).toHaveLength(1);
    expect(cfg[0]!.id).toBe("orphan-id");
    expect(cfg[0]!.name).toBe("new-name");

    // store.json byte-unchanged (adopt is store-read-only)
    expect(readFileSync(storePath, "utf-8")).toBe(before);
  });

  it("D9 adopt refreshes config name; on-disk store.name unchanged", () => {
    writeOrphanStore(projectRoot, "oid", "disk-name", []);
    handlers.createProject({ name: "param-name", path: projectRoot }, ctx);
    const onDisk = loadProjectStore(projectRoot);
    expect(onDisk.name).toBe("disk-name");
  });

  it("D10 folder in config AND on disk -> already-a-project", () => {
    handlers.createProject({ name: "p", path: projectRoot }, ctx);
    expect(() => handlers.createProject({ name: "p2", path: projectRoot }, ctx)).toThrow(RpcError);
  });

  it("D11 folder in config, store gone (ghost) -> already-a-project (NOT recreated)", () => {
    handlers.createProject({ name: "p", path: projectRoot }, ctx);
    rmSync(join(projectRoot, ".symbion", "store.json"));
    expect(() => handlers.createProject({ name: "p2", path: projectRoot }, ctx)).toThrow(/already a Symbion project/i);
    expect(existsSync(join(projectRoot, ".symbion", "store.json"))).toBe(false);
  });

  it("D12 fresh folder (neither) -> normal CREATE; new id; store.json written", () => {
    const res = handlers.createProject({ name: "p", path: projectRoot }, ctx);
    expect(res.project.artifacts).toHaveLength(0);
    expect(existsSync(join(projectRoot, ".symbion", "store.json"))).toBe(true);
  });

  it("D13 two folders same basename, different abs paths -> two independent creates", () => {
    const a = mkdtempSync(join(tmpdir(), "symbion-a-"));
    const b = mkdtempSync(join(tmpdir(), "symbion-b-"));
    try {
      const r1 = handlers.createProject({ name: "vpo", path: a }, ctx);
      const r2 = handlers.createProject({ name: "vpo", path: b }, ctx);
      expect(r1.project.id).not.toBe(r2.project.id);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});

// ── 2c. B3a — createProjectAndImport atomicity ───────────────────────────────

describe("B3a createProjectAndImport (D14–D18)", () => {
  it("D14 happy path -> project created, artifacts imported, renames propagated", () => {
    const res = handlers.createProjectAndImport(
      { name: "p", path: projectRoot, selectedIds: ["a1"], scanned: [art("a1", "agent", "ba")] },
      ctx
    );
    expect(res.project.artifacts.map((a) => a.name)).toEqual(["ba"]);
    expect(existsSync(join(projectRoot, ".symbion", "store.json"))).toBe(true);
  });

  it("D15 import throws AFTER a fresh create -> rollback: config entry removed AND store.json deleted; backup exists; no orphan", async () => {
    // Fail the import's saveProjectStore (fresh create's own store write already
    // happened via the real module-internal save). createProjectAndImport must
    // roll back: drop the config entry + safeDelete the just-created store.
    failNextSave = true;
    expect(() =>
      handlers.createProjectAndImport(
        { name: "p", path: projectRoot, selectedIds: ["a1"], scanned: [art("a1", "agent", "ba")] },
        ctx
      )
    ).toThrow(/simulated disk failure/);

    // config entry removed
    const projects = (await handlers.listProjects({}, ctx)).projects;
    expect(projects).toHaveLength(0);
    // on-disk store deleted (rollback via safeDelete)
    expect(existsSync(join(projectRoot, ".symbion", "store.json"))).toBe(false);
    // a backup of the just-created store exists under .symbion/backups/removed-*
    const backupsRoot = join(projectRoot, ".symbion", "backups");
    const removedDirs = existsSync(backupsRoot)
      ? readdirSync(backupsRoot).filter((d) => d.startsWith("removed-"))
      : [];
    expect(removedDirs.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(backupsRoot, removedDirs[0]!, "store.json"))).toBe(true);
  });

  it("D16 adopt-then-import fails -> NO delete, NO config removal (E12); orphan-adopted project stays registered", async () => {
    writeOrphanStore(projectRoot, "oid", "disk", [art("kept", "agent", "keep")]);
    const storePath = join(projectRoot, ".symbion", "store.json");
    failNextSave = true; // fail the import save AFTER adopt registered the project
    expect(() =>
      handlers.createProjectAndImport(
        { name: "n", path: projectRoot, selectedIds: ["new1"], scanned: [art("new1", "command", "run")] },
        ctx
      )
    ).toThrow(/simulated disk failure/);

    // adopted config entry RETAINED (not rolled back — the store pre-existed)
    const projects = (await handlers.listProjects({}, ctx)).projects;
    expect(projects.map((p) => p.id)).toEqual(["oid"]);
    // pre-existing store NOT deleted
    expect(existsSync(storePath)).toBe(true);
    expect(loadProjectStore(projectRoot).id).toBe("oid");
  });

  it("D16b adopt-then-import happy path: adopted id preserved; pre-existing + imported present", () => {
    writeOrphanStore(projectRoot, "oid", "disk", [art("kept", "agent", "keep")]);
    const res = handlers.createProjectAndImport(
      { name: "n", path: projectRoot, selectedIds: ["new1"], scanned: [art("new1", "command", "run")] },
      ctx
    );
    expect(res.project.id).toBe("oid");
    expect(res.project.artifacts.map((a) => a.name).sort()).toEqual(["keep", "run"]);
  });

  it("D17 combined RPC on fresh folder with a colliding batch -> create + dedupe in one call", () => {
    const res = handlers.createProjectAndImport(
      { name: "p", path: projectRoot, selectedIds: ["t1", "t2"], scanned: [art("t1", "agent", "ba"), art("t2", "agent", "ba")] },
      ctx
    );
    expect(res.project.artifacts.map((a) => a.name).sort()).toEqual(["ba", "ba-2"]);
    expect(res.renames).toHaveLength(1);
  });

  it("D18 legacy standalone createProject + importArtifacts still work", async () => {
    handlers.createProject({ name: "p", path: projectRoot }, ctx);
    const id = (await handlers.listProjects({}, ctx)).projects[0]!.id;
    const res = handlers.importArtifacts(
      { projectId: id, selectedIds: ["a1"], scanned: [art("a1", "agent", "solo")] },
      ctx
    );
    expect(res.project.artifacts.map((a) => a.name)).toEqual(["solo"]);
  });
});
