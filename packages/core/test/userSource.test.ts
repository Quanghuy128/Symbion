import { describe, expect, it } from "vitest";
import {
  AUTHOR_REGISTRY,
  defaultSourceDisplayName,
  findDuplicateSource,
  parseStoredTemplateSources,
  userSourceToAuthorSource,
  validateSourceDisplayName,
  validateUserTemplateSource,
  type UserTemplateSource,
} from "../src/index.js";

const good = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "u-0123456789",
  displayName: "Acme tools",
  owner: "acme",
  repo: "tools",
  ref: null,
  rootPath: "",
  folders: [{ bucket: "agent", path: "agents" }],
  addedAt: "2026-10-19T10:00:00.000Z",
  ...over,
});

describe("userSource (RU29-RU33)", () => {
  it("RU29 validate", () => {
    expect(validateUserTemplateSource(good()).ok).toBe(true);
    const withPattern = validateUserTemplateSource(good({ folders: [{ bucket: "agent", path: "agents", filePattern: "**" }] }));
    expect(withPattern.ok).toBe(true);
    if (withPattern.ok) expect(withPattern.source.folders[0]).toEqual({ bucket: "agent", path: "agents" });
    const rejects: Array<Record<string, unknown>> = [
      { id: "ecc" },
      { id: "u-XYZ" },
      { id: "u-123" },
      { owner: "evil.com/x" },
      { repo: ".." },
      { ref: "a..b" },
      { rootPath: "../x" },
      { folders: [] },
      { folders: [{ bucket: "agent", path: "a" }, { bucket: "agent", path: "b" }] },
      { folders: [{ bucket: "hook", path: "a" }] },
      { folders: [{ bucket: "agent", path: "../x" }] },
      { displayName: "x".repeat(61) },
      { displayName: "a\u0007b" },
      { addedAt: "yesterday" },
    ];
    for (const r of rejects) expect(validateUserTemplateSource(good(r)).ok, JSON.stringify(r)).toBe(false);
    expect(validateUserTemplateSource(null).ok).toBe(false);
  });

  it("RU30 parseStoredTemplateSources", () => {
    expect(parseStoredTemplateSources(undefined)).toEqual({ valid: [], invalidCount: 0 });
    expect(parseStoredTemplateSources({ a: 1 })).toEqual({ valid: [], invalidCount: 0 });
    const r = parseStoredTemplateSources([good(), good({ id: "u-aaaaaaaaaa" }), good({ owner: "evil.com" })]);
    expect(r.valid).toHaveLength(2);
    expect(r.invalidCount).toBe(1);
  });

  it("RU31 findDuplicateSource", () => {
    const users = [validateUserTemplateSource(good()) as { ok: true; source: UserTemplateSource }].map((x) => x.source);
    expect(findDuplicateSource({ owner: "ACME", repo: "Tools", ref: null, rootPath: "" }, users, AUTHOR_REGISTRY)?.id).toBe("u-0123456789");
    expect(findDuplicateSource({ owner: "acme", repo: "tools", ref: "main", rootPath: "" }, users, AUTHOR_REGISTRY)).toBeNull();
    expect(findDuplicateSource({ owner: "affaan-m", repo: "ECC", ref: null, rootPath: "" }, [], AUTHOR_REGISTRY)?.id).toBe("ecc");
    expect(findDuplicateSource({ owner: "affaan-m", repo: "ecc", ref: null, rootPath: "agents" }, [], AUTHOR_REGISTRY)).toBeNull();
  });

  it("RU32 userSourceToAuthorSource", () => {
    const r = validateUserTemplateSource(good({ folders: [{ bucket: "skill", path: "skills" }, { bucket: "command", path: "." }] }));
    if (!r.ok) throw new Error("x");
    const a = userSourceToAuthorSource(r.source);
    expect(a.origin).toBe("user");
    expect(a.ref).toBe("HEAD");
    expect(a.repoLabel).toBe("acme/tools");
    expect(a.folders.map((f) => f.filePattern)).toEqual(["*/SKILL.md", "*.md"]);
  });

  it("RU33 display names", () => {
    expect(defaultSourceDisplayName("a", "b", null, "")).toBe("a/b");
    expect(defaultSourceDisplayName("a", "b", "main", "x/y")).toBe("a/b/x/y @main");
    expect(defaultSourceDisplayName("a", "b".repeat(70), null, "").length).toBe(60);
    expect(validateSourceDisplayName("  hi  ")).toEqual({ ok: true, value: "hi" });
    expect(validateSourceDisplayName("   ").ok).toBe(false);
  });

  it("RU41 ECC registry entry", () => {
    const ecc = AUTHOR_REGISTRY.find((a) => a.id === "ecc");
    expect(ecc).toMatchObject({ kind: "github", origin: "builtin", rootPath: "", owner: "affaan-m", repo: "ecc", ref: "main" });
    if (ecc?.kind === "github") expect(ecc.folders).toHaveLength(3);
  });
});
