import { describe, expect, it } from "vitest";
import { matchAuthorFolders, type GithubTreeEntry } from "../src/templates/matchAuthorFolders.js";
import { AUTHOR_REGISTRY, type AuthorSource } from "../src/templates/authorSource.js";

const ECC_AUTHOR = AUTHOR_REGISTRY.find((a) => a.id === "ecc") as Extract<AuthorSource, { kind: "github" }>;

describe("matchAuthorFolders", () => {
  it("U13: flat '*.md' pattern — matches direct child, excludes nested/wrong-ext/substring-prefix paths", () => {
    const entries: GithubTreeEntry[] = [
      { path: "agents/foo.md", type: "blob" },
      { path: "agents/sub/foo.md", type: "blob" },
      { path: "agents/foo.txt", type: "blob" },
      { path: "agents-extra/foo.md", type: "blob" },
    ];
    const result = matchAuthorFolders(entries, [{ bucket: "agent", path: "agents", filePattern: "*.md" }]);
    expect(result).toEqual([{ bucket: "agent", relPath: "agents/foo.md" }]);
  });

  it("U14: folder-per-item '*/SKILL.md' pattern — matches, excludes helper files / missing subfolder / 2-level nesting", () => {
    const entries: GithubTreeEntry[] = [
      { path: "skills/foo/SKILL.md", type: "blob" },
      { path: "skills/foo/examples/bar.md", type: "blob" },
      { path: "skills/SKILL.md", type: "blob" },
      { path: "skills/foo/bar/SKILL.md", type: "blob" },
    ];
    const result = matchAuthorFolders(entries, [{ bucket: "skill", path: "skills", filePattern: "*/SKILL.md" }]);
    expect(result).toEqual([{ bucket: "skill", relPath: "skills/foo/SKILL.md" }]);
  });

  it("U15: synthetic tree shaped like ECC's real layout, run through ECC_AUTHOR.folders, returns exactly the 4 candidates and excludes the other 3", () => {
    const entries: GithubTreeEntry[] = [
      { path: "agents/a.md", type: "blob" },
      { path: "agents/b.md", type: "blob" },
      { path: "commands/c.md", type: "blob" },
      { path: "skills/d/SKILL.md", type: "blob" },
      { path: "skills/d/examples/e.md", type: "blob" },
      { path: "docs/f.md", type: "blob" },
      { path: ".claude/g.md", type: "blob" },
    ];
    const result = matchAuthorFolders(entries, ECC_AUTHOR.folders);
    expect(result).toEqual(
      expect.arrayContaining([
        { bucket: "agent", relPath: "agents/a.md" },
        { bucket: "agent", relPath: "agents/b.md" },
        { bucket: "command", relPath: "commands/c.md" },
        { bucket: "skill", relPath: "skills/d/SKILL.md" },
      ])
    );
    expect(result).toHaveLength(4);
    const relPaths = result.map((r) => r.relPath);
    expect(relPaths).not.toContain("skills/d/examples/e.md");
    expect(relPaths).not.toContain("docs/f.md");
    expect(relPaths).not.toContain(".claude/g.md");
  });

  it("U16: empty folders array returns an empty candidate list, never throws", () => {
    const entries: GithubTreeEntry[] = [{ path: "agents/a.md", type: "blob" }];
    expect(() => matchAuthorFolders(entries, [])).not.toThrow();
    expect(matchAuthorFolders(entries, [])).toEqual([]);
  });

  it("U17: type:'tree' entries (directories) are never returned as candidates, even if path matches textually", () => {
    const entries: GithubTreeEntry[] = [{ path: "agents/foo.md", type: "tree" }];
    const result = matchAuthorFolders(entries, [{ bucket: "agent", path: "agents", filePattern: "*.md" }]);
    expect(result).toEqual([]);
  });
});

describe("AUTHOR_REGISTRY / AuthorSource", () => {
  it("U18: contains exactly one kind:'bundled' entry id:'symbion' and at least one kind:'github' entry id:'ecc' owner:'affaan-m' repo:'ecc'", () => {
    const bundled = AUTHOR_REGISTRY.filter((a) => a.kind === "bundled");
    expect(bundled).toHaveLength(1);
    expect(bundled[0]!.id).toBe("symbion");

    const ecc = AUTHOR_REGISTRY.find((a) => a.id === "ecc");
    expect(ecc).toBeDefined();
    expect(ecc!.kind).toBe("github");
    if (ecc!.kind === "github") {
      expect(ecc!.owner).toBe("affaan-m");
      expect(ecc!.repo).toBe("ecc");
    }
  });

  it("U19: every kind:'github' entry's folders array is non-empty, every folders[].path has no leading/trailing slash", () => {
    for (const author of AUTHOR_REGISTRY) {
      if (author.kind !== "github") continue;
      expect(author.folders.length).toBeGreaterThan(0);
      for (const folder of author.folders) {
        expect(folder.path.length).toBeGreaterThan(0);
        expect(folder.path.startsWith("/")).toBe(false);
        expect(folder.path.endsWith("/")).toBe(false);
      }
    }
  });
});
