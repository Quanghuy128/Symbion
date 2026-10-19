import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlers, RpcError } from "../src/rpc/handlers.js";
import { COMMIT, json, mockGithub, standardRoutes, STD_TREE, text, TREE_SHA } from "./githubMock.js";

const ctx = { port: 20128, version: "0.1.0" };
let configDir: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "symbion-ts-"));
  process.env["SYMBION_CONFIG_DIR"] = configDir;
  writeFileSync(
    join(configDir, "config.json"),
    JSON.stringify({ schemaVersion: 1, port: 12802, theme: "system", builderDefaultTab: "form", projects: [] }, null, 2)
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(configDir, { recursive: true, force: true });
  delete process.env["SYMBION_CONFIG_DIR"];
});

const snapshotDir = () => readdirSync(configDir).sort().map((f) => [f, readFileSync(join(configDir, f), "utf-8")]);

async function inspect(url: string, fetchMock = mockGithub(standardRoutes())) {
  vi.stubGlobal("fetch", fetchMock);
  const res = await handlers.inspectTemplateSourceUrl({ url }, ctx);
  return { res, fetchMock };
}

describe("inspectTemplateSourceUrl (D-I*)", () => {
  it("D-I1 root URL: 2 calls, commit sha (not tree sha), detection, token", async () => {
    const { res, fetchMock } = await inspect("https://github.com/acme/tools");
    expect(fetchMock.calls.map((c) => c.url)).toEqual([
      "https://api.github.com/repos/acme/tools/commits/HEAD",
      `https://api.github.com/repos/acme/tools/git/trees/${COMMIT}?recursive=1`,
    ]);
    expect(fetchMock.calls[0]!.accept).toBe("application/vnd.github.sha");
    const o = res.outcome;
    if (o.status !== "success") throw new Error("expected success");
    expect(o.commitSha).toBe(COMMIT);
    expect(o.commitSha).not.toBe(TREE_SHA);
    expect(o.detected.map((d) => d.path)).toEqual(["agents", "commands", "skills"]);
    expect(o.rootDirs[0]!.path).toBe(".");
    expect(o.suggestedDisplayName).toBe("acme/tools");
    expect(o.inspectToken).toMatch(/^[0-9a-f]{32}$/);
    expect(o.ref).toBeNull();
    expect(o.refLabel).toBe("default branch");
  });

  it("D-I2 tree/main/<path>: matching-refs resolves the branch; root never reaches the network", async () => {
    const tree = [{ path: "plugins", type: "tree" }, { path: "plugins/backend", type: "tree" }, { path: "plugins/backend/agents/a.md", type: "blob" }];
    const f = mockGithub([
      [/git\/matching-refs\/heads\/main$/, () => json([{ ref: "refs/heads/main", object: { sha: COMMIT, type: "commit" } }])],
      ...standardRoutes({ tree }),
    ]);
    const { res } = await inspect("https://github.com/acme/tools/tree/main/plugins/backend", f);
    expect(f.calls).toHaveLength(2);
    expect(f.calls.some((c) => c.url.includes("plugins"))).toBe(false);
    const o = res.outcome;
    if (o.status !== "success") throw new Error("x");
    expect(o.ref).toBe("main");
    expect(o.rootPath).toBe("plugins/backend");
    expect(o.detected).toEqual([{ bucket: "agent", path: "agents", count: 1 }]);
  });

  it("D-I2b single-segment ref: no matching-refs call", async () => {
    const f = mockGithub(standardRoutes());
    const { res } = await inspect("https://github.com/acme/tools/tree/main", f);
    expect(f.calls.some((c) => c.url.includes("matching-refs"))).toBe(false);
    expect(res.outcome.status).toBe("success");
    expect(f.calls[0]!.url).toContain("/commits/main");
  });

  it("D-I3 slashy branch via matching-refs; commit taken from the ref object", async () => {
    const tree = [{ path: "docs", type: "tree" }, { path: "docs/commands/c.md", type: "blob" }];
    const f = mockGithub([
      [/matching-refs\/heads\/feature$/, () => json([{ ref: "refs/heads/feature/x", object: { sha: COMMIT, type: "commit" } }, { ref: "refs/heads/feature-y", object: { sha: "1".repeat(40), type: "commit" } }])],
      ...standardRoutes({ tree }),
    ]);
    const { res } = await inspect("https://github.com/acme/tools/tree/feature/x/docs", f);
    expect(f.calls.some((c) => c.url.includes("/commits/"))).toBe(false);
    const o = res.outcome;
    if (o.status !== "success") throw new Error("x");
    expect(o.ref).toBe("feature/x");
    expect(o.rootPath).toBe("docs");
  });

  it("D-I4 tag fallback performs a commits call", async () => {
    const tree = [{ path: "agents/a.md", type: "blob" }];
    const f = mockGithub([
      [/matching-refs\/heads\//, () => json([])],
      [/matching-refs\/tags\/v1$/, () => json([{ ref: "refs/tags/v1/rc", object: { sha: "2".repeat(40), type: "tag" } }])],
      ...standardRoutes({ tree }),
    ]);
    const { res } = await inspect("https://github.com/acme/tools/tree/v1/rc", f);
    const o = res.outcome;
    if (o.status !== "success") throw new Error("x");
    expect(o.ref).toBe("v1/rc");
    expect(f.calls.some((c) => c.url.endsWith("/commits/v1/rc"))).toBe(true);
  });

  it("D-I5 invalid URLs -> RpcError(invalid-url) and zero fetch calls", async () => {
    const f = mockGithub(standardRoutes());
    vi.stubGlobal("fetch", f);
    for (const url of [
      "http://github.com/a/b",
      "https://gitlab.com/a/b",
      "https://github.com.evil.com/a/b",
      "https://github.com@evil.com/a/b",
      "https://github.com/a/b/tree/main/%2e%2e/x",
      "https://github.com/a/b/tree/main/../x",
      "https://github.com/a/b/blob/main/x.md",
      "not a url",
      "https://github.com/a/b/tree/main/x%00y",
    ]) {
      await expect(handlers.inspectTemplateSourceUrl({ url }, ctx), url).rejects.toMatchObject({ code: "invalid-url" });
    }
    await expect(handlers.inspectTemplateSourceUrl({ url: 123 as never }, ctx)).rejects.toBeInstanceOf(RpcError);
    expect(f.calls).toHaveLength(0);
  });

  it("D-I6 error outcomes", async () => {
    const o404 = await inspect("https://github.com/acme/tools", mockGithub([["commits/", () => text("", { status: 404 })]]));
    expect(o404.res.outcome).toMatchObject({ status: "error", kind: "not-found" });
    expect((o404.res.outcome as { message: string }).message).toMatch(/private/);
    const o422 = await inspect("https://github.com/acme/tools/tree/nope", mockGithub([["commits/", () => text("", { status: 422 })]]));
    expect(o422.res.outcome).toMatchObject({ kind: "not-found" });
    const missingRoot = await inspect(
      "https://github.com/acme/tools/tree/main/gone",
      mockGithub([[/matching-refs/, () => json([{ ref: "refs/heads/main", object: { sha: COMMIT, type: "commit" } }])], ...standardRoutes()])
    );
    expect(missingRoot.res.outcome).toMatchObject({ kind: "not-found" });
    expect((missingRoot.res.outcome as { message: string }).message).toMatch(/Folder 'gone' not found/);
    const trunc = await inspect(
      "https://github.com/acme/tools/tree/main/gone",
      mockGithub([[/matching-refs/, () => json([{ ref: "refs/heads/main", object: { sha: COMMIT, type: "commit" } }])], ...standardRoutes({ truncated: true })])
    );
    expect((trunc.res.outcome as { message: string }).message).toMatch(/too large/);
    const rl = await inspect(
      "https://github.com/acme/tools",
      mockGithub([["commits/", () => text("", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1900000000" } })]])
    );
    expect(rl.res.outcome).toMatchObject({ kind: "rate-limit", resetAt: 1_900_000_000_000 });
    const nomatch = await inspect(
      "https://github.com/acme/tools/tree/zzz/yyy",
      mockGithub([[/matching-refs/, () => json([])]])
    );
    expect(nomatch.res.outcome).toMatchObject({ kind: "not-found" });
  });

  it("D-I7 no standard folders -> success with detected [] and rootDirs", async () => {
    const { res } = await inspect("https://github.com/acme/tools", mockGithub(standardRoutes({ tree: [{ path: "docs", type: "tree" }, { path: "docs/a.md", type: "blob" }] })));
    const o = res.outcome;
    if (o.status !== "success") throw new Error("x");
    expect(o.detected).toEqual([]);
    expect(o.rootDirs.map((d) => d.path)).toEqual([".", "docs"]);
  });

  it("D-I8 duplicate of a built-in", async () => {
    const { res } = await inspect("https://github.com/affaan-m/ecc", mockGithub(standardRoutes()));
    const o = res.outcome;
    if (o.status !== "success") throw new Error("x");
    expect(o.duplicateOf?.id).toBe("ecc");
  });

  it("D-I9 inspect writes nothing to disk", async () => {
    const before = snapshotDir();
    await inspect("https://github.com/acme/tools");
    expect(snapshotDir()).toEqual(before);
  });

  it("D-I10 extra params are ignored", async () => {
    vi.stubGlobal("fetch", mockGithub(standardRoutes()));
    const f = mockGithub(standardRoutes());
    vi.stubGlobal("fetch", f);
    await handlers.inspectTemplateSourceUrl({ url: "https://github.com/acme/tools", owner: "evil", host: "evil.example" } as never, ctx);
    for (const c of f.calls) {
      const host = new URL(c.url).hostname;
      expect(["api.github.com", "raw.githubusercontent.com"]).toContain(host);
      expect(c.url).not.toContain("evil");
    }
  });
});

void STD_TREE;
