import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderArtifacts } from "../src/render/render.js";
import { parseClaudeFile } from "../src/parse/scan.js";
import type { CanonicalArtifact } from "../src/ir/types.js";

const FIXTURES_DIR = fileURLToPath(new URL("./fixtures/claude", import.meta.url));

function readFixture(relPath: string): string {
  return readFileSync(join(FIXTURES_DIR, relPath), "utf-8");
}

function makeArtifact(overrides: Partial<CanonicalArtifact>): CanonicalArtifact {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    kind: "agent",
    name: "x",
    description: "x",
    body: "x",
    meta: { version: "draft", status: "draft", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    ...overrides,
  };
}

describe("render round-trip — Claude", () => {
  it("renders code-reviewer agent to .claude/agents/<name>.md with frontmatter matching the fixture", () => {
    const artifact = makeArtifact({
      kind: "agent",
      name: "code-reviewer",
      description: "Independent reviewer — checks Maker output against the plan, never self-reviews",
      tools: ["Read", "Grep", "Glob"],
      body: [
        "You are the independent code reviewer. You did not write this code.",
        "",
        "Check:",
        "- matches the plan/spec",
        "- no silent disk writes",
        "- edge cases covered",
        "- tests present and meaningful",
        "",
        "Report findings as a numbered list. Do not fix issues yourself — flag them.",
      ].join("\n"),
    });

    const [file] = renderArtifacts([artifact], "claude", { version: "v0.1.0" });
    expect(file!.relPath).toBe(".claude/agents/code-reviewer.md");

    const fixture = readFixture("agents/code-reviewer.md");
    // byte-equal modulo trailing managed marker: rendered content starts with the fixture's content.
    expect(file!.content.startsWith(fixture.trimEnd())).toBe(true);
    expect(file!.content).toMatch(/<!-- managed-by: symbion id=.+ kind=agent v=v0\.1\.0 hash=.+ -->/);
  });

  it("parses fixture ba.md -> IR -> renders -> re-parses -> IR equal (idempotent round trip)", () => {
    const raw = readFixture("agents/ba.md");
    const ir1 = parseClaudeFile(raw, { name: "ba", kind: "agent" });

    const [rendered] = renderArtifacts([ir1], "claude", { version: "v0.1.0" });
    const ir2 = parseClaudeFile(rendered!.content, { name: "ba", kind: "agent", id: ir1.id });

    expect(ir2.name).toBe(ir1.name);
    expect(ir2.description).toBe(ir1.description);
    expect(ir2.tools).toEqual(ir1.tools);
    expect(ir2.body).toBe(ir1.body);
  });

  it("agent path = .claude/agents/<name>.md; command path = .claude/commands/<name>.md", () => {
    const agent = makeArtifact({ kind: "agent", name: "ba" });
    const command = makeArtifact({ kind: "command", name: "analyze" });
    const [agentFile] = renderArtifacts([agent], "claude", { version: "v0.1.0" });
    const [commandFile] = renderArtifacts([command], "claude", { version: "v0.1.0" });
    expect(agentFile!.relPath).toBe(".claude/agents/ba.md");
    expect(commandFile!.relPath).toBe(".claude/commands/analyze.md");
  });

  it("custom fields render verbatim into frontmatter and reparse into customFields", () => {
    const artifact = makeArtifact({
      kind: "agent",
      name: "ba",
      customFields: [{ key: "model", value: "claude-opus-4" }],
    });
    const [file] = renderArtifacts([artifact], "claude", { version: "v0.1.0" });
    expect(file!.content).toContain("model: claude-opus-4");

    const reparsed = parseClaudeFile(file!.content, { name: "ba", kind: "agent" });
    expect(reparsed.customFields).toEqual([{ key: "model", value: "claude-opus-4" }]);
  });

  it("command frontmatter omits name and tools", () => {
    const command = makeArtifact({ kind: "command", name: "analyze", description: "step" });
    const [file] = renderArtifacts([command], "claude", { version: "v0.1.0" });
    expect(file!.content).not.toMatch(/^name:/m);
    expect(file!.content).not.toMatch(/^tools:/m);
  });
});
