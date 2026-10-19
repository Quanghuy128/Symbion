import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { handlers } from "../src/rpc/handlers.js";
import { loadProjectStore } from "../src/store/store.js";
import { COMMIT, COMMIT2, json, mockGithub, SYN_AGENT, SYN_COMMAND, SYN_SKILL, standardRoutes, text, type Route } from "./githubMock.js";

const ctx = { port: 20128, version: "0.1.0" };
let configDir: string;
let projectRoot: string;
const cfgPath = () => join(configDir, "config.json");

const entry = (over: Record<string, unknown> = {}) => ({
  id: "u-0123456789",
  displayName: "Seeded",
  owner: "acme",
  repo: "tools",
  ref: null,
  rootPath: "",
  folders: [
    { bucket: "agent", path: "agents" },
    { bucket: "command", path: "commands" },
    { bucket: "skill", path: "skills" },
  ],
  addedAt: "2026-10-19T10:00:00.000Z",
  ...over,
});
function seed(entries: unknown[]) {
  writeFileSync(cfgPath(), JSON.stringify({ schemaVersion: 1, port: 12802, theme: "system", builderDefaultTab: "form", projects: [], templateSources: entries }, null, 2));
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "symbion-tf-"));
  projectRoot = mkdtempSync(join(tmpdir(), "symbion-tfp-"));
  process.env["SYMBION_CONFIG_DIR"] = configDir;
  seed([entry()]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(configDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  delete process.env["SYMBION_CONFIG_DIR"];
});

async function fetchSource(f: ReturnType<typeof mockGithub>, authorId = "u-0123456789", extra: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", f);
  return (await handlers.fetchAuthorTemplates({ authorId, ...extra } as never, ctx)).outcome;
}

describe("fetchAuthorTemplates with user sources (D-F*)", () => {
  it("D-F1 commit -> tree by sha -> raw by sha", async () => {
    const f = mockGithub(standardRoutes());
    const o = await fetchSource(f);
    if (o.status !== "success") throw new Error(JSON.stringify(o));
    expect(f.calls[0]!.url).toBe("https://api.github.com/repos/acme/tools/commits/HEAD");
    expect(f.calls[1]!.url).toBe(`https://api.github.com/repos/acme/tools/git/trees/${COMMIT}?recursive=1`);
    const raws = f.calls.slice(2).map((c) => c.url);
    expect(raws).toHaveLength(3);
    for (const u of raws) expect(u.startsWith(`https://raw.githubusercontent.com/acme/tools/${COMMIT}/`)).toBe(true);
    expect(o.items).toHaveLength(3);
    for (const i of o.items) {
      expect(i.authorOrigin).toBe("user");
      expect(i.id.startsWith("u-0123456789:")).toBe(true);
    }
    expect(o.commitSha).toBe(COMMIT);
    expect(o.refLabel).toBe("default branch");
    expect(o.truncated).toBe(false);
  });

  it("D-F2 SSRF: client-sent fields never reach the network", async () => {
    const f = mockGithub(standardRoutes());
    await fetchSource(f, "u-0123456789", { owner: "evil", repo: "x", ref: "y", url: "https://evil.example" });
    expect(f.calls.length).toBeGreaterThan(0);
    for (const c of f.calls) {
      expect(["api.github.com", "raw.githubusercontent.com"]).toContain(new URL(c.url).hostname);
      expect(c.url).toContain("/acme/tools");
      expect(c.url).not.toContain("evil");
    }
  });

  it("D-F3 bad ids -> invalid-author, no fetch", async () => {
    const f = mockGithub([]);
    vi.stubGlobal("fetch", f);
    for (const id of ["u-0000000000", "constructor", "__proto__", "toString", "../ecc", "", 123, undefined]) {
      await expect(handlers.fetchAuthorTemplates({ authorId: id } as never, ctx), String(id)).rejects.toMatchObject({ code: "invalid-author" });
    }
    await expect(handlers.fetchAuthorTemplates({ authorId: "u-0000000000" }, ctx)).rejects.toThrow(/not found/);
    expect(f.calls).toHaveLength(0);
  });

  it("D-F4 hand-edited invalid stored entry is refused", async () => {
    for (const bad of [{ owner: "evil.com/x" }, { ref: "../.." }]) {
      seed([entry(bad)]);
      const f = mockGithub(standardRoutes());
      vi.stubGlobal("fetch", f);
      await expect(handlers.fetchAuthorTemplates({ authorId: "u-0123456789" }, ctx)).rejects.toThrow(/invalid/);
      expect(f.calls).toHaveLength(0);
    }
  });

  it("D-F5 malicious tree paths are skipped; special chars are encoded", async () => {
    const tree = [
      { path: "agents/../../../x.md", type: "blob" },
      { path: "agents/a\\b.md", type: "blob" },
      { path: "agents/a#b.md", type: "blob" },
    ];
    const f = mockGithub(standardRoutes({ tree, files: { "agents/a#b.md": SYN_AGENT } }));
    const o = await fetchSource(f);
    if (o.status !== "success") throw new Error("x");
    // `agents/../../../x.md` never even matches the one-segment-below-folder pattern (so it is
    // never a candidate); the backslash path matches textually and is skipped as unsafe.
    expect(o.skipped.filter((s) => s.reason === "Unsafe path")).toHaveLength(1);
    expect(f.calls.some((c) => c.url.includes(".."))).toBe(false);
    const raws = f.calls.filter((c) => c.url.includes("raw.githubusercontent.com")).map((c) => c.url);
    expect(raws).toEqual([`https://raw.githubusercontent.com/acme/tools/${COMMIT}/agents/a%23b.md`]);
    expect(o.items).toHaveLength(1);
  });

  it("D-F6 root path with '.' mapping", async () => {
    seed([entry({ rootPath: "plugins/backend", folders: [{ bucket: "agent", path: "." }] })]);
    const tree = [
      { path: "plugins/backend/x.md", type: "blob" },
      { path: "plugins/backend/sub/y.md", type: "blob" },
      { path: "plugins/other/z.md", type: "blob" },
      { path: "top.md", type: "blob" },
    ];
    const f = mockGithub(standardRoutes({ tree, files: { "plugins/backend/x.md": SYN_AGENT } }));
    const o = await fetchSource(f);
    if (o.status !== "success") throw new Error("x");
    expect(f.calls.filter((c) => c.url.includes("raw.")).map((c) => c.url)).toEqual([`https://raw.githubusercontent.com/acme/tools/${COMMIT}/plugins/backend/x.md`]);
    expect(o.items).toHaveLength(1);
  });

  it("D-F7 per-file 429 / 404 / oversize", async () => {
    const big = "a".repeat(2 * 1024 * 1024 + 10);
    const routes: Route[] = [
      [/commits\//, () => text(COMMIT)],
      [/git\/trees\//, () => json({ tree: [{ path: "agents/a.md", type: "blob" }, { path: "agents/b.md", type: "blob" }, { path: "agents/c.md", type: "blob" }] })],
      [/agents\/a\.md$/, () => text("", { status: 429 })],
      [/agents\/b\.md$/, () => text("", { status: 404 })],
      [/agents\/c\.md$/, () => text(big)],
    ];
    const o = await fetchSource(mockGithub(routes));
    if (o.status !== "success") throw new Error("x");
    const reason = (p: string) => o.skipped.find((s) => s.relPath === p)!.reason;
    expect(reason("agents/a.md")).toMatch(/429/);
    expect(reason("agents/b.md")).toMatch(/HTTP 404/);
    expect(reason("agents/c.md")).toMatch(/too large/);
  });

  it("D-F8 CRLF files parse", async () => {
    const crlf = SYN_AGENT.replace(/\n/g, "\r\n");
    const o = await fetchSource(mockGithub(standardRoutes({ tree: [{ path: "agents/a.md", type: "blob" }], files: { "agents/a.md": crlf } })));
    if (o.status !== "success") throw new Error("x");
    expect(o.items).toHaveLength(1);
    expect(o.items[0]!.raw).not.toContain("\r");
  });

  it("D-F9 truncated + D-F10 zero matches", async () => {
    const o = await fetchSource(mockGithub(standardRoutes({ truncated: true })));
    expect(o).toMatchObject({ status: "success", truncated: true });
    const empty = await fetchSource(mockGithub(standardRoutes({ tree: [{ path: "docs/x.md", type: "blob" }] })));
    expect(empty).toMatchObject({ status: "success", items: [], skipped: [] });
  });

  it("D-F11 each load uses its own commit consistently", async () => {
    const f1 = mockGithub(standardRoutes({ commit: COMMIT }));
    const f2 = mockGithub(standardRoutes({ commit: COMMIT2 }));
    for (const [f, sha] of [[f1, COMMIT], [f2, COMMIT2]] as const) {
      const o = await fetchSource(f);
      if (o.status !== "success") throw new Error("x");
      expect(o.commitSha).toBe(sha);
      const urls = f.calls.slice(1).map((c) => c.url);
      expect(urls.every((u) => u.includes(sha))).toBe(true);
      expect(urls.some((u) => u.includes(sha === COMMIT ? COMMIT2 : COMMIT))).toBe(false);
    }
  });

  it("D-F12 ECC regression: 1 API call, by ref, builtin origin", async () => {
    const tree = [{ path: "agents/a.md", type: "blob" }, { path: "commands/c.md", type: "blob" }, { path: "skills/s/SKILL.md", type: "blob" }];
    const f = mockGithub([
      [/git\/trees\/main\?recursive=1$/, () => json({ tree, truncated: false })],
      [/raw\.githubusercontent\.com\/affaan-m\/ecc\/main\/agents\/a\.md$/, () => text(SYN_AGENT)],
      [/raw\.githubusercontent\.com\/affaan-m\/ecc\/main\/commands\/c\.md$/, () => text(SYN_COMMAND)],
      [/raw\.githubusercontent\.com\/affaan-m\/ecc\/main\/skills\/s\/SKILL\.md$/, () => text(SYN_SKILL)],
    ]);
    const o = await fetchSource(f, "ecc");
    if (o.status !== "success") throw new Error(JSON.stringify(o));
    expect(f.calls.filter((c) => c.url.includes("api.github.com"))).toHaveLength(1);
    expect(o.items).toHaveLength(3);
    expect(o.items.every((i) => i.authorOrigin === "builtin")).toBe(true);
    expect(o.commitSha).toBeUndefined();
  });

  it("D-F13 static: no fs writes and fetch only in githubHttp.ts", () => {
    const dir = join(__dirname, "..", "src", "templates");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), "utf-8");
      expect(/writeFile/.test(src), `${f} writeFile`).toBe(false);
      if (f !== "githubHttp.ts") expect(/[^\w.]fetch\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), `${f} fetch(`).toBe(false);
    }
  });
});

describe("applyTemplate with user sources (D-A*)", () => {
  const baseTemplate = {
    sourceTemplateId: "u-0123456789:agents/a.md",
    kind: "agent" as const,
    name: "syn-agent",
    description: "d",
    body: "body",
    authorId: "u-0123456789",
  };

  it("D-A1 requires acknowledgement for a user source", async () => {
    const { project } = await handlers.createProject({ name: "p", path: projectRoot }, ctx);
    expect(() => handlers.applyTemplate({ projectId: project.id, template: baseTemplate }, ctx)).toThrow(
      expect.objectContaining({ code: "license-not-acknowledged" })
    );
    const ok = await handlers.applyTemplate({ projectId: project.id, template: { ...baseTemplate, acknowledgedThirdParty: true } }, ctx);
    expect(ok.project.artifacts.find((a) => a.id === ok.appliedArtifactId)?.meta.sourceTemplateId).toBe("u-0123456789:agents/a.md");
  });

  it("D-A2 extra keys on the template are never stored; D-A3 only .symbion/store.json written", async () => {
    execSync("git init -q", { cwd: projectRoot });
    const { project } = await handlers.createProject({ name: "p", path: projectRoot }, ctx);
    const res = await handlers.applyTemplate(
      {
        projectId: project.id,
        template: {
          ...baseTemplate,
          acknowledgedThirdParty: true,
          permissionMode: "bypassPermissions",
          allowedTools: ["Bash"],
          customFields: [{ key: "permissionMode", value: "bypassPermissions" }],
          hooks: { PreToolUse: "x" },
        } as never,
      },
      ctx
    );
    const art = loadProjectStore(projectRoot).artifacts.find((a) => a.id === res.appliedArtifactId)!;
    const json = JSON.stringify(art);
    expect(json).not.toMatch(/bypassPermissions|allowedTools|hooks|PreToolUse/);
    expect(art.customFields ?? []).toEqual([]);
    const files = readdirSync(projectRoot, { recursive: true }) as string[];
    expect(files.filter((p) => String(p).startsWith(".claude"))).toEqual([]);
    expect(files.some((p) => String(p) === "AGENTS.md")).toBe(false);
  });
});
