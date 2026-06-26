import { describe, expect, it } from "vitest";
import { renderArtifacts } from "../src/render/render.js";
import { codexAdapter } from "../src/adapters/codex.js";
import type { CanonicalArtifact } from "../src/ir/types.js";

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

describe("render round-trip — Codex (lossy merge)", () => {
  const ba = makeArtifact({ id: "a1", kind: "agent", name: "ba", description: "BA", body: "You are BA.", tools: ["Read"] });
  const reviewer = makeArtifact({ id: "a2", kind: "agent", name: "code-reviewer", description: "Reviewer", body: "You review." });
  const analyze = makeArtifact({ id: "c1", kind: "command", name: "analyze", description: "analyze step", body: "Request: $ARGUMENTS" });

  it("produces exactly ONE RenderedFile at AGENTS.md", () => {
    const files = renderArtifacts([ba, reviewer, analyze], "codex", { version: "v0.1.0" });
    expect(files).toHaveLength(1);
    expect(files[0]!.relPath).toBe("AGENTS.md");
  });

  it("contains ## Agent: <name> for each agent and ## Command: /<name> for each command", () => {
    const [file] = renderArtifacts([ba, reviewer, analyze], "codex", { version: "v0.1.0" });
    expect(file!.content).toContain("## Agent: ba");
    expect(file!.content).toContain("## Agent: code-reviewer");
    expect(file!.content).toContain("## Command: /analyze");
  });

  it("sections deterministically ordered (agents by name, then commands by name) regardless of input order", () => {
    const order1 = renderArtifacts([reviewer, ba, analyze], "codex", { version: "v0.1.0" });
    const order2 = renderArtifacts([analyze, ba, reviewer], "codex", { version: "v0.1.0" });
    expect(order1[0]!.content).toBe(order2[0]!.content);

    const baIdx = order1[0]!.content.indexOf("## Agent: ba");
    const reviewerIdx = order1[0]!.content.indexOf("## Agent: code-reviewer");
    expect(baIdx).toBeLessThan(reviewerIdx);
  });

  it("includes region fence markers", () => {
    const [file] = renderArtifacts([ba], "codex", { version: "v0.1.0" });
    expect(file!.content).toMatch(/<!-- managed-by: symbion region-start v=v0\.1\.0 hash=.+ -->/);
    expect(file!.content).toContain("<!-- managed-by: symbion region-end -->");
  });

  it("preserves foreign content verbatim around the fence", () => {
    const [file] = renderArtifacts([ba], "codex", {
      version: "v0.1.0",
      existingForeignContent: "# My repo notes\n\nSome hand-written context.",
    });
    expect(file!.content.startsWith("# My repo notes")).toBe(true);
    expect(file!.content).toContain("region-start");
  });

  it("capability flags: lossy=true, supportsCommands=false, supportsPerAgentFile=false", () => {
    expect(codexAdapter.capability.lossy).toBe(true);
    expect(codexAdapter.capability.supportsCommands).toBe(false);
    expect(codexAdapter.capability.supportsPerAgentFile).toBe(false);
  });
});
