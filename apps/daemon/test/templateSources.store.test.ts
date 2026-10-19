import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlers } from "../src/rpc/handlers.js";
import { InspectTokenStore } from "../src/templates/inspectTokens.js";
import { loadGlobalConfig, saveGlobalConfig, loadProjectStore } from "../src/store/store.js";
import { mockGithub, standardRoutes } from "./githubMock.js";

const ctx = { port: 20128, version: "0.1.0" };
let configDir: string;
let projectRoot: string;

const baseConfig = { schemaVersion: 1, port: 12802, theme: "system", builderDefaultTab: "form", projects: [] as unknown[] };
const cfgPath = () => join(configDir, "config.json");
const readCfg = () => JSON.parse(readFileSync(cfgPath(), "utf-8")) as Record<string, unknown> & { templateSources?: unknown[] };
const writeCfg = (extra: Record<string, unknown> = {}) => writeFileSync(cfgPath(), JSON.stringify({ ...baseConfig, ...extra }, null, 2));

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "symbion-ts-"));
  projectRoot = mkdtempSync(join(tmpdir(), "symbion-tsp-"));
  process.env["SYMBION_CONFIG_DIR"] = configDir;
  writeCfg();
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(configDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  delete process.env["SYMBION_CONFIG_DIR"];
});

async function inspectToken(url = "https://github.com/acme/tools", tree?: unknown[]) {
  vi.stubGlobal("fetch", mockGithub(standardRoutes(tree ? { tree } : {})));
  const r = await handlers.inspectTemplateSourceUrl({ url }, ctx);
  if (r.outcome.status !== "success") throw new Error("inspect failed");
  return r.outcome;
}
const DETECTED = [{ bucket: "agent" as const, path: "agents" }];

const validEntry = (over: Record<string, unknown> = {}) => ({
  id: "u-0123456789",
  displayName: "Seeded",
  owner: "seed",
  repo: "repo",
  ref: null,
  rootPath: "",
  folders: [{ bucket: "agent", path: "agents" }],
  addedAt: "2026-10-19T10:00:00.000Z",
  ...over,
});

describe("add/list/remove (D-S*)", () => {
  it("D-S1 + D-S2 add stores token values, zero network, extra params ignored", async () => {
    const o = await inspectToken();
    const spy = mockGithub([]);
    vi.stubGlobal("fetch", spy);
    const res = await handlers.addTemplateSource(
      { inspectToken: o.inspectToken, folders: DETECTED, owner: "evil", repo: "x", ref: "y" } as never,
      ctx
    );
    expect(spy.calls).toHaveLength(0);
    expect(res.source.id).toMatch(/^u-[0-9a-f]{10}$/);
    const stored = readCfg().templateSources as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ owner: "acme", repo: "tools", ref: null, rootPath: "", displayName: "acme/tools" });
    expect(typeof stored[0]!["addedAt"]).toBe("string");
    const list = await handlers.listTemplateSources({}, ctx);
    expect(list.sources).toHaveLength(1);
    expect(list.maxSources).toBe(20);
  });

  it("D-S3 token single-use, random, expired; failed add does not burn it", async () => {
    const o = await inspectToken();
    await expect(handlers.addTemplateSource({ inspectToken: o.inspectToken, folders: [] }, ctx)).rejects.toMatchObject({ code: "no-folders" });
    await handlers.addTemplateSource({ inspectToken: o.inspectToken, folders: DETECTED }, ctx);
    await expect(handlers.addTemplateSource({ inspectToken: o.inspectToken, folders: DETECTED }, ctx)).rejects.toMatchObject({ code: "inspect-expired" });
    await expect(handlers.addTemplateSource({ inspectToken: "0".repeat(32), folders: DETECTED }, ctx)).rejects.toMatchObject({ code: "inspect-expired" });
    await expect(handlers.addTemplateSource({ inspectToken: 5 as never, folders: DETECTED }, ctx)).rejects.toMatchObject({ code: "inspect-expired" });

    let t = 1000;
    const store = new InspectTokenStore({ ttlMs: 100, now: () => t });
    const tok = store.mint({ owner: "a", repo: "b", ref: null, rootPath: "", commitSha: "c".repeat(40), rootDirPaths: ["."], detected: [] });
    expect(store.peek(tok)).not.toBeNull();
    t += 101;
    expect(store.peek(tok)).toBeNull();
    const many: string[] = [];
    for (let i = 0; i < 40; i++) many.push(store.mint({ owner: "a", repo: "b", ref: null, rootPath: "", commitSha: "c".repeat(40), rootDirPaths: ["."], detected: [] }));
    expect(store.size).toBeLessThanOrEqual(32);
    expect(store.peek(many[0])).toBeNull();
  });

  it("D-S4 folders validation", async () => {
    const o = await inspectToken();
    const t = o.inspectToken;
    const tryAdd = (folders: unknown) => handlers.addTemplateSource({ inspectToken: t, folders: folders as never }, ctx);
    await expect(tryAdd([])).rejects.toMatchObject({ code: "no-folders" });
    await expect(tryAdd([{ bucket: "agent", path: "src" }])).rejects.toMatchObject({ code: "invalid-folders" });
    await expect(tryAdd([{ bucket: "agent", path: "../x" }])).rejects.toMatchObject({ code: "invalid-folders" });
    await expect(tryAdd([{ bucket: "agent", path: "agents" }, { bucket: "agent", path: "docs" }])).rejects.toMatchObject({ code: "invalid-folders" });
    await expect(tryAdd([{ bucket: "hook", path: "agents" }])).rejects.toMatchObject({ code: "invalid-folders" });
    const ok = await tryAdd([{ bucket: "command", path: "." }]);
    expect(ok.source.folders).toEqual([{ bucket: "command", path: "." }]);
  });

  it("D-S5 display name", async () => {
    const o = await inspectToken();
    await expect(handlers.addTemplateSource({ inspectToken: o.inspectToken, folders: DETECTED, displayName: "x".repeat(61) }, ctx)).rejects.toMatchObject({ code: "invalid-display-name" });
    await expect(handlers.addTemplateSource({ inspectToken: o.inspectToken, folders: DETECTED, displayName: "a\u0007b" }, ctx)).rejects.toMatchObject({ code: "invalid-display-name" });
    const ok = await handlers.addTemplateSource({ inspectToken: o.inspectToken, folders: DETECTED, displayName: "  Mine " }, ctx);
    expect(ok.source.displayName).toBe("Mine");
  });

  it("D-S6 duplicates (saved + ECC)", async () => {
    const a = await inspectToken();
    await handlers.addTemplateSource({ inspectToken: a.inspectToken, folders: DETECTED }, ctx);
    const b = await inspectToken("https://github.com/ACME/Tools/");
    expect(b.duplicateOf?.displayName).toBe("acme/tools");
    await expect(handlers.addTemplateSource({ inspectToken: b.inspectToken, folders: DETECTED }, ctx)).rejects.toMatchObject({ code: "duplicate-source" });
    const e = await inspectToken("https://github.com/affaan-m/ecc");
    await expect(handlers.addTemplateSource({ inspectToken: e.inspectToken, folders: DETECTED }, ctx)).rejects.toMatchObject({ code: "duplicate-source" });
  });

  it("D-S7 limit counts invalid entries too", async () => {
    const seeded = Array.from({ length: 19 }, (_, i) => validEntry({ id: `u-${String(i).padStart(10, "0")}`, repo: `r${i}` }));
    seeded.push({ owner: "evil.com" } as never);
    writeCfg({ templateSources: seeded });
    const o = await inspectToken();
    await expect(handlers.addTemplateSource({ inspectToken: o.inspectToken, folders: DETECTED }, ctx)).rejects.toMatchObject({ code: "source-limit" });
  });

  it("D-S8 non-array templateSources: list empty, add refused, file untouched", async () => {
    writeCfg({ templateSources: { oops: 1 } });
    const before = readFileSync(cfgPath(), "utf-8");
    expect((await handlers.listTemplateSources({}, ctx)).sources).toEqual([]);
    const o = await inspectToken();
    await expect(handlers.addTemplateSource({ inspectToken: o.inspectToken, folders: DETECTED }, ctx)).rejects.toMatchObject({ code: "invalid-config" });
    expect(readFileSync(cfgPath(), "utf-8")).toBe(before);
  });

  it("D-S9 invalid entries survive add and remove byte-for-byte", async () => {
    const invalid = validEntry({ id: "u-aaaaaaaaaa", owner: "evil.com" });
    writeCfg({ templateSources: [invalid, validEntry()] });
    const list = await handlers.listTemplateSources({}, ctx);
    expect(list.sources).toHaveLength(1);
    expect(list.invalidCount).toBe(1);
    const o = await inspectToken();
    await handlers.addTemplateSource({ inspectToken: o.inspectToken, folders: DETECTED }, ctx);
    expect((readCfg().templateSources as unknown[])[0]).toEqual(invalid);
    await handlers.removeTemplateSource({ id: "u-0123456789" }, ctx);
    const after = readCfg().templateSources as Array<{ id: string }>;
    expect(after[0]).toEqual(invalid);
    expect(after.map((e) => e.id)).not.toContain("u-0123456789");
  });

  it("D-S10 remove semantics keep other config fields", async () => {
    writeCfg({ templateSources: [validEntry()], lastProjectId: "p1", theme: "dark", port: 4242 });
    expect(await handlers.removeTemplateSource({ id: "u-0123456789" }, ctx)).toEqual({ removed: true });
    const c = readCfg();
    expect(c.templateSources).toEqual([]);
    expect(c).toMatchObject({ lastProjectId: "p1", theme: "dark", port: 4242, projects: [] });
    expect(await handlers.removeTemplateSource({ id: "u-0123456789" }, ctx)).toEqual({ removed: false });
    for (const id of ["ecc", "symbion", "__proto__", "u-../x", 5 as never]) {
      await expect(handlers.removeTemplateSource({ id }, ctx), String(id)).rejects.toMatchObject({ code: "invalid-source" });
    }
  });

  it("D-S11 persists across a fresh module instance; old tokens are dead", async () => {
    const o = await inspectToken();
    await handlers.addTemplateSource({ inspectToken: o.inspectToken, folders: DETECTED }, ctx);
    const o2 = await inspectToken("https://github.com/acme/other");
    vi.resetModules();
    const fresh = await import("../src/rpc/handlers.js");
    expect((await fresh.handlers.listTemplateSources({}, ctx)).sources).toHaveLength(1);
    await expect(fresh.handlers.addTemplateSource({ inspectToken: o2.inspectToken, folders: DETECTED }, ctx)).rejects.toMatchObject({ code: "inspect-expired" });
  });

  it("D-S12 no temp files remain", async () => {
    const o = await inspectToken();
    const s = await handlers.addTemplateSource({ inspectToken: o.inspectToken, folders: DETECTED }, ctx);
    await handlers.removeTemplateSource({ id: s.source.id }, ctx);
    expect(readdirSync(configDir).filter((f) => f.includes("tmp"))).toEqual([]);
  });
});

describe("config compatibility (D-M*)", () => {
  it("D-M1 old config loads, list/fetch do not rewrite it", async () => {
    const before = readFileSync(cfgPath(), "utf-8");
    const mtime = statSync(cfgPath()).mtimeMs;
    expect(loadGlobalConfig().templateSources).toBeUndefined();
    expect((await handlers.listTemplateSources({}, ctx)).sources).toEqual([]);
    vi.stubGlobal("fetch", mockGithub(standardRoutes()));
    await handlers.fetchAuthorTemplates({ authorId: "ecc" }, ctx);
    expect(readFileSync(cfgPath(), "utf-8")).toBe(before);
    expect(statSync(cfgPath()).mtimeMs).toBe(mtime);
  });

  it("D-M2 schemaVersion stays 1 after add", async () => {
    const o = await inspectToken();
    await handlers.addTemplateSource({ inspectToken: o.inspectToken, folders: DETECTED }, ctx);
    expect(readCfg().schemaVersion).toBe(1);
  });

  it("D-M3 other writers preserve templateSources", async () => {
    writeCfg({ templateSources: [validEntry()] });
    const snapshot = JSON.stringify(readCfg().templateSources);
    const created = await handlers.createProject({ name: "p", path: projectRoot }, ctx);
    expect(JSON.stringify(readCfg().templateSources)).toBe(snapshot);
    saveGlobalConfig({ ...loadGlobalConfig(), port: 9999 });
    expect(JSON.stringify(readCfg().templateSources)).toBe(snapshot);
    await handlers.removeProject({ id: created.project.id }, ctx);
    expect(JSON.stringify(readCfg().templateSources)).toBe(snapshot);
  });

  it("D-M4 pre-feature migrateGlobalConfig logic accepts the post-feature file", async () => {
    const o = await inspectToken();
    await handlers.addTemplateSource({ inspectToken: o.inspectToken, folders: DETECTED }, ctx);
    const CURRENT_SCHEMA_VERSION = 1;
    const old = (raw: Record<string, unknown>) => {
      if (typeof raw["schemaVersion"] !== "number") throw new Error("missing");
      if ((raw["schemaVersion"] as number) > CURRENT_SCHEMA_VERSION) throw new Error("unsupported");
      return raw;
    };
    expect(() => old(readCfg())).not.toThrow();
  });

  it("D-M5 project stores still get schemaVersion 1", async () => {
    await handlers.createProject({ name: "p", path: projectRoot }, ctx);
    expect(loadProjectStore(projectRoot).schemaVersion).toBe(1);
  });
});
