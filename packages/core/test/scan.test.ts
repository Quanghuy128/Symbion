import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseClaudeDir, parseClaudeFile, type ClaudeDirFileMap } from "../src/parse/scan.js";
import { renderArtifacts } from "../src/render/render.js";
import { setAgentBlock, hasAgentBlock, parseAgentBlock } from "../src/ir/agentBlock.js";
import type { CanonicalArtifact } from "../src/ir/types.js";

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

  it("U28 agents block survives render -> parseClaudeFile intact (NOT stripped like the managed marker)", () => {
    const body = setAgentBlock("Orchestrate the pipeline.", [
      { name: "feature-builder", count: 2, goal: "Implement the feature per the plan" },
      { name: "code-reviewer", goal: "Independent review of the diff" },
      { name: "qa" },
    ]);
    const cmd: CanonicalArtifact = {
      id: "00000000-0000-4000-8000-000000000001",
      kind: "command",
      name: "build",
      description: "Build step",
      body,
      meta: {
        version: "draft",
        status: "draft",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const [file] = renderArtifacts([cmd], "claude", { version: "v0.1.0" });
    const reparsed = parseClaudeFile(file!.content, { name: "build", kind: "command", id: cmd.id });
    // The block is part of body — NOT stripped like the trailing managed-by marker.
    expect(hasAgentBlock(reparsed.body)).toBe(true);
    expect(reparsed.body).toBe(body);
    expect(parseAgentBlock(reparsed.body).map((r) => r.name)).toEqual([
      "feature-builder",
      "code-reviewer",
      "qa",
    ]);
    // And the managed marker itself is gone from body (proving strip is marker-only).
    expect(reparsed.body).not.toContain("managed-by: symbion");
  });
});
