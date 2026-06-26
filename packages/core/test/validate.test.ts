import { describe, expect, it } from "vitest";
import { validateArtifact } from "../src/ir/validate.js";
import type { CanonicalArtifact } from "../src/ir/types.js";

function makeArtifact(overrides: Partial<CanonicalArtifact>): CanonicalArtifact {
  return {
    id: "a1",
    kind: "agent",
    name: "ba",
    description: "BA",
    body: "body",
    meta: { version: "draft", status: "draft", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    ...overrides,
  };
}

describe("validateArtifact", () => {
  it("missing name -> error", () => {
    const issues = validateArtifact(makeArtifact({ name: "" }), { allArtifacts: [] });
    expect(issues.some((i) => i.code === "name-required" && i.level === "error")).toBe(true);
  });

  it("missing description -> error", () => {
    const issues = validateArtifact(makeArtifact({ description: "" }), { allArtifacts: [] });
    expect(issues.some((i) => i.code === "description-required" && i.level === "error")).toBe(true);
  });

  it("duplicate name same kind -> error", () => {
    const a = makeArtifact({ id: "a1", name: "ba", kind: "agent" });
    const b = makeArtifact({ id: "a2", name: "ba", kind: "agent" });
    const issues = validateArtifact(a, { allArtifacts: [a, b] });
    expect(issues.some((i) => i.code === "name-duplicate")).toBe(true);
  });

  it("different kind, same name -> no duplicate error", () => {
    const a = makeArtifact({ id: "a1", name: "analyze", kind: "agent" });
    const b = makeArtifact({ id: "a2", name: "analyze", kind: "command" });
    const issues = validateArtifact(a, { allArtifacts: [a, b] });
    expect(issues.some((i) => i.code === "name-duplicate")).toBe(false);
  });

  it("filename-unsafe name -> error", () => {
    const issues = validateArtifact(makeArtifact({ name: "ba/oops" }), { allArtifacts: [] });
    expect(issues.some((i) => i.code === "name-unsafe")).toBe(true);
  });

  it("unknown tool -> warning (allowed)", () => {
    const issues = validateArtifact(makeArtifact({ tools: ["TotallyMadeUpTool"] }), { allArtifacts: [] });
    const warning = issues.find((i) => i.code === "tool-unknown");
    expect(warning?.level).toBe("warning");
  });

  it("command body without $ARGUMENTS while usesArguments=true -> warning", () => {
    const cmd = makeArtifact({ kind: "command", usesArguments: true, body: "no placeholder here" });
    const issues = validateArtifact(cmd, { allArtifacts: [] });
    expect(issues.some((i) => i.code === "arguments-missing" && i.level === "warning")).toBe(true);
  });

  it("command @mentions agent not in set -> warning, does not block", () => {
    const cmd = makeArtifact({ kind: "command", body: "Dispatch @ghost to do the work." });
    const issues = validateArtifact(cmd, { allArtifacts: [cmd] });
    const warning = issues.find((i) => i.code === "mention-missing-agent");
    expect(warning?.level).toBe("warning");
  });

  it("command @mentions an existing agent -> no warning", () => {
    const agent = makeArtifact({ id: "a1", kind: "agent", name: "ba" });
    const cmd = makeArtifact({ id: "c1", kind: "command", body: "Dispatch @ba to do the work." });
    const issues = validateArtifact(cmd, { allArtifacts: [agent, cmd] });
    expect(issues.some((i) => i.code === "mention-missing-agent")).toBe(false);
  });
});
