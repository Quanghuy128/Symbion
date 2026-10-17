/**
 * run-nodeLayout.test.ts — free-node-dragging testplan §2. Real tmp-dir
 * filesystem, no mocking of `fs` — exercises the real `resolveConfinedPath` +
 * `atomicWriteJson` code paths via the daemon's `getNodeLayout`/`setNodeLayout`
 * RPC handlers.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handlers, RpcError } from "../src/rpc/handlers.js";
import { ctx, setupRunEnv, type RunTestEnv } from "./runHelpers.js";

describe("getNodeLayout/setNodeLayout (free-node-dragging testplan §2)", () => {
  let env: RunTestEnv;

  beforeEach(async () => {
    env = await setupRunEnv({ publishedCommand: false });
  });

  afterEach(() => {
    env.cleanup();
  });

  it("T-3.1: happy path round-trip — fresh project has no layout.json, upsert persists, re-read sees it", () => {
    const initial = handlers.getNodeLayout({ projectId: env.projectId }, ctx);
    expect(initial).toEqual({ positions: {} });

    const afterSet = handlers.setNodeLayout(
      { projectId: env.projectId, nodeId: "a", position: { x: 1, y: 2 } },
      ctx
    );
    expect(afterSet.positions).toEqual({ a: { x: 1, y: 2 } });

    const reread = handlers.getNodeLayout({ projectId: env.projectId }, ctx);
    expect(reread.positions).toEqual({ a: { x: 1, y: 2 } });
  });

  it("T-3.2: upsert, not replace — a second node id's write keeps the first", () => {
    handlers.setNodeLayout({ projectId: env.projectId, nodeId: "a", position: { x: 1, y: 2 } }, ctx);
    const afterB = handlers.setNodeLayout(
      { projectId: env.projectId, nodeId: "b", position: { x: 3, y: 4 } },
      ctx
    );
    expect(afterB.positions).toEqual({ a: { x: 1, y: 2 }, b: { x: 3, y: 4 } });
  });

  it("T-3.3: overwrite same id — last write wins for that key", () => {
    handlers.setNodeLayout({ projectId: env.projectId, nodeId: "a", position: { x: 1, y: 2 } }, ctx);
    const second = handlers.setNodeLayout(
      { projectId: env.projectId, nodeId: "a", position: { x: 99, y: 100 } },
      ctx
    );
    expect(second.positions).toEqual({ a: { x: 99, y: 100 } });
  });

  it("T-3.4: missing file entirely — getNodeLayout returns {} without throwing", () => {
    const symbionDir = join(env.projectRoot, ".symbion");
    expect(existsSync(symbionDir)).toBe(true);
    expect(existsSync(join(symbionDir, "layout.json"))).toBe(false);
    expect(() => handlers.getNodeLayout({ projectId: env.projectId }, ctx)).not.toThrow();
    expect(handlers.getNodeLayout({ projectId: env.projectId }, ctx)).toEqual({ positions: {} });
  });

  it("T-3.5: corrupt file (invalid JSON) — getNodeLayout returns {} without throwing", () => {
    const layoutPath = join(env.projectRoot, ".symbion", "layout.json");
    writeFileSync(layoutPath, "{not valid json", "utf-8");
    expect(() => handlers.getNodeLayout({ projectId: env.projectId }, ctx)).not.toThrow();
    expect(handlers.getNodeLayout({ projectId: env.projectId }, ctx)).toEqual({ positions: {} });
  });

  it("T-3.6: corrupt file — setNodeLayout still succeeds, produces a fresh valid file with only the new entry", () => {
    const layoutPath = join(env.projectRoot, ".symbion", "layout.json");
    writeFileSync(layoutPath, "{not valid json", "utf-8");
    const result = handlers.setNodeLayout(
      { projectId: env.projectId, nodeId: "fresh", position: { x: 5, y: 6 } },
      ctx
    );
    expect(result.positions).toEqual({ fresh: { x: 5, y: 6 } });
    const onDisk = JSON.parse(readFileSync(layoutPath, "utf-8"));
    expect(onDisk).toEqual({ schemaVersion: 1, positions: { fresh: { x: 5, y: 6 } } });
  });

  it("T-3.7: atomic write — no leftover temp file after a successful setNodeLayout", () => {
    handlers.setNodeLayout({ projectId: env.projectId, nodeId: "a", position: { x: 1, y: 2 } }, ctx);
    const symbionDir = join(env.projectRoot, ".symbion");
    const leftovers = readdirSync(symbionDir).filter((f) => f.includes(".symbion-tmp-"));
    expect(leftovers).toEqual([]);
  });

  it("T-3.8: path confinement — unknown projectId surfaces an error, not a crash", () => {
    expect(() => handlers.getNodeLayout({ projectId: "does-not-exist" }, ctx)).toThrow();
    expect(() =>
      handlers.setNodeLayout({ projectId: "does-not-exist", nodeId: "a", position: { x: 1, y: 2 } }, ctx)
    ).toThrow();
  });

  it("T-3.9: invalid-params — missing nodeId or non-finite position throws RpcError, no file written", () => {
    expect(() =>
      // @ts-expect-error deliberately omitting nodeId to test the runtime guard
      handlers.setNodeLayout({ projectId: env.projectId, position: { x: 1, y: 2 } }, ctx)
    ).toThrow(RpcError);
    expect(() =>
      handlers.setNodeLayout({ projectId: env.projectId, nodeId: "a", position: { x: NaN, y: 2 } }, ctx)
    ).toThrow(RpcError);
    expect(() =>
      handlers.setNodeLayout({ projectId: env.projectId, nodeId: "a", position: { x: Infinity, y: 2 } }, ctx)
    ).toThrow(RpcError);
    expect(() =>
      // @ts-expect-error deliberately passing a string x to test the runtime guard
      handlers.setNodeLayout({ projectId: env.projectId, nodeId: "a", position: { x: "1", y: 2 } }, ctx)
    ).toThrow(RpcError);
    expect(existsSync(join(env.projectRoot, ".symbion", "layout.json"))).toBe(false);
  });

  it("T-3.10: never touches other .symbion/ content (store.json, runs/)", () => {
    const storeJsonPath = join(env.projectRoot, ".symbion", "store.json");
    const beforeStore = readFileSync(storeJsonPath, "utf-8");

    const runsDir = join(env.projectRoot, ".symbion", "runs");
    const runJsonPath = join(runsDir, "fake-run.json");
    // seed a fake runs/ dir with a file (doesn't need to be a real uuid dir
    // for this byte-identical-content assertion).
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(runJsonPath, '{"fake":true}', "utf-8");
    const beforeRunJson = readFileSync(runJsonPath, "utf-8");

    handlers.setNodeLayout({ projectId: env.projectId, nodeId: "a", position: { x: 1, y: 2 } }, ctx);

    const afterStore = readFileSync(storeJsonPath, "utf-8");
    const afterRunJson = readFileSync(runJsonPath, "utf-8");
    expect(afterStore).toBe(beforeStore);
    expect(afterRunJson).toBe(beforeRunJson);
  });

  it("T-3.11: fresh project with no .symbion/ dir at all — setNodeLayout mkdir-recursive succeeds", async () => {
    // A second, independently-registered project whose .symbion/ dir this
    // test deliberately removes before calling setNodeLayout, simulating a
    // never-before-persisted-anything project (edge case #8).
    const second = await setupRunEnv({ publishedCommand: false, configDir: env.configDir });
    rmSync(join(second.projectRoot, ".symbion"), { recursive: true, force: true });
    expect(existsSync(join(second.projectRoot, ".symbion"))).toBe(false);

    expect(() =>
      handlers.setNodeLayout({ projectId: second.projectId, nodeId: "a", position: { x: 7, y: 8 } }, ctx)
    ).not.toThrow();
    const onDisk = JSON.parse(readFileSync(join(second.projectRoot, ".symbion", "layout.json"), "utf-8"));
    expect(onDisk).toEqual({ schemaVersion: 1, positions: { a: { x: 7, y: 8 } } });
    second.cleanup();
  });
});
