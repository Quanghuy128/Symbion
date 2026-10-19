import { describe, expect, it } from "vitest";
import { detectTemplateFolders, matchAuthorFolders, toRepoRelativeFolders } from "../src/index.js";

const blob = (path: string) => ({ path, type: "blob" });
const tree = (path: string) => ({ path, type: "tree" });

describe("detectTemplateFolders (RU20-RU27)", () => {
  it("RU20 standard layout", () => {
    const d = detectTemplateFolders([blob("agents/a.md"), blob("commands/c.md"), blob("skills/s/SKILL.md")], "");
    expect(d.rootExists).toBe(true);
    expect(d.detected).toEqual([
      { bucket: "agent", path: "agents", count: 1 },
      { bucket: "command", path: "commands", count: 1 },
      { bucket: "skill", path: "skills", count: 1 },
    ]);
  });

  it("RU21 .claude layout", () => {
    const d = detectTemplateFolders([blob(".claude/agents/a.md"), blob(".claude/commands/c.md")], "");
    expect(d.detected.map((x) => x.path)).toEqual([".claude/agents", ".claude/commands"]);
  });

  it("RU22 root-level wins over .claude", () => {
    const d = detectTemplateFolders([blob("agents/a.md"), blob(".claude/agents/b.md")], "");
    expect(d.detected).toEqual([{ bucket: "agent", path: "agents", count: 1 }]);
  });

  it("RU23 zero matching files is not detected", () => {
    const d = detectTemplateFolders([blob("agents/README.txt"), blob("skills/x/notes.md")], "");
    expect(d.detected).toEqual([]);
  });

  it("RU24 root path re-bases", () => {
    const d = detectTemplateFolders(
      [tree("plugins"), tree("plugins/backend"), blob("plugins/backend/agents/a.md"), blob("plugins/other/agents/z.md")],
      "plugins/backend",
    );
    expect(d.detected).toEqual([{ bucket: "agent", path: "agents", count: 1 }]);
  });

  it("RU25 missing root / blob root", () => {
    expect(detectTemplateFolders([blob("a.md")], "nope").rootExists).toBe(false);
    expect(detectTemplateFolders([blob("plugins")], "plugins").rootExists).toBe(false);
  });

  it("RU26 rootDirs", () => {
    const d = detectTemplateFolders(
      [blob("x.md"), blob("s/SKILL.md"), tree(".git"), blob(".git/y.md"), tree("zeta"), tree("alpha"), blob("alpha/a.md"), blob("alpha/b/SKILL.md")],
      "",
    );
    expect(d.rootDirs[0]).toEqual({ path: ".", mdFiles: 1, skillFiles: 1 });
    expect(d.rootDirs.map((x) => x.path)).toEqual([".", "alpha", "s", "zeta"]);
    expect(d.rootDirs.find((x) => x.path === "alpha")).toEqual({ path: "alpha", mdFiles: 1, skillFiles: 1 });
    const big = Array.from({ length: 300 }, (_, i) => tree(`d${String(i).padStart(3, "0")}`));
    expect(detectTemplateFolders(big, "").rootDirs).toHaveLength(201);
  });

  it("RU27 toRepoRelativeFolders and root bucket", () => {
    expect(toRepoRelativeFolders("x/y", [{ bucket: "agent", path: "." }])[0]!.path).toBe("x/y");
    expect(toRepoRelativeFolders("", [{ bucket: "agent", path: "." }])[0]!.path).toBe("");
    expect(toRepoRelativeFolders("x", [{ bucket: "skill", path: "skills" }])[0]).toEqual({
      bucket: "skill",
      path: "x/skills",
      filePattern: "*/SKILL.md",
    });
    const m = matchAuthorFolders([blob("a.md"), blob("sub/a.md")], [{ bucket: "agent", path: "", filePattern: "*.md" }]);
    expect(m.map((c) => c.relPath)).toEqual(["a.md"]);
  });
});
