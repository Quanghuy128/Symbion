import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseClaudeDir, type ClaudeDirFileMap } from "../src/parse/scan.js";

const FIXTURES_DIR = fileURLToPath(new URL("./fixtures/claude", import.meta.url));

function loadFixtureFilemap(): ClaudeDirFileMap {
  return {
    ".claude/agents/ba.md": readFileSync(join(FIXTURES_DIR, "agents/ba.md"), "utf-8"),
    ".claude/agents/code-reviewer.md": readFileSync(join(FIXTURES_DIR, "agents/code-reviewer.md"), "utf-8"),
    ".claude/agents/broken.md": readFileSync(join(FIXTURES_DIR, "agents/broken.md"), "utf-8"),
    ".claude/commands/analyze.md": readFileSync(join(FIXTURES_DIR, "commands/analyze.md"), "utf-8"),
    ".claude/settings.json": readFileSync(join(FIXTURES_DIR, "settings.json"), "utf-8"),
  };
}

describe("parseClaudeDir", () => {
  it("parses 2 agents, 1 command, settings; skips broken.md with a reason", () => {
    const result = parseClaudeDir(loadFixtureFilemap());
    expect(result.agents).toHaveLength(2);
    expect(result.commands).toHaveLength(1);
    expect(result.settings?.relPath).toBe(".claude/settings.json");
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.relPath).toBe(".claude/agents/broken.md");
    expect(result.skipped[0]!.reason.length).toBeGreaterThan(0);
  });

  it("derives kind+name from path", () => {
    const result = parseClaudeDir(loadFixtureFilemap());
    const ba = result.agents.find((a) => a.name === "ba");
    expect(ba?.kind).toBe("agent");
    const analyze = result.commands.find((c) => c.name === "analyze");
    expect(analyze?.kind).toBe("command");
  });
});
