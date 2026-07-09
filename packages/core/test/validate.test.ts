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

  it("U24 malformed `- @` line inside block -> warning (not error), Save not blocked", () => {
    // `- @a garbage` looks like an agent line but fails grammar.
    const body =
      "<!-- symbion:agents -->\n## Agents\n\n- @a some garbage tail\n<!-- /symbion:agents -->";
    const cmd = makeArtifact({ id: "c1", kind: "command", body });
    const issues = validateArtifact(cmd, { allArtifacts: [cmd] });
    const w = issues.find((i) => i.code === "agentblock-malformed");
    expect(w?.level).toBe("warning");
    expect(issues.some((i) => i.level === "error")).toBe(false);
  });

  it("U25 ×0 / non-integer count -> agentref-count-invalid warning", () => {
    const zero =
      "<!-- symbion:agents -->\n## Agents\n\n- @a ×0\n<!-- /symbion:agents -->";
    const cmdZero = makeArtifact({ id: "c1", kind: "command", body: zero });
    expect(
      validateArtifact(cmdZero, { allArtifacts: [cmdZero] }).some(
        (i) => i.code === "agentref-count-invalid" && i.level === "warning"
      )
    ).toBe(true);

    const bad =
      "<!-- symbion:agents -->\n## Agents\n\n- @a ×abc\n<!-- /symbion:agents -->";
    const cmdBad = makeArtifact({ id: "c2", kind: "command", body: bad });
    expect(
      validateArtifact(cmdBad, { allArtifacts: [cmdBad] }).some(
        (i) => i.code === "agentref-count-invalid" && i.level === "warning"
      )
    ).toBe(true);
  });

  it("U26 mention-missing-agent still fires for a block ref whose agent doesn't exist", () => {
    const body =
      "<!-- symbion:agents -->\n## Agents\n\n- @ghost\n<!-- /symbion:agents -->";
    const cmd = makeArtifact({ id: "c1", kind: "command", body });
    const issues = validateArtifact(cmd, { allArtifacts: [cmd] });
    expect(issues.some((i) => i.code === "mention-missing-agent" && i.level === "warning")).toBe(true);
  });

  it("U27 adding a valid ref introduces no new error", () => {
    const agent = makeArtifact({ id: "a1", kind: "agent", name: "qa" });
    const body =
      "Do work.\n\n<!-- symbion:agents -->\n## Agents\n\n- @qa ×2 — Test it\n<!-- /symbion:agents -->";
    const cmd = makeArtifact({ id: "c1", kind: "command", name: "build", description: "d", body });
    const issues = validateArtifact(cmd, { allArtifacts: [agent, cmd] });
    expect(issues.some((i) => i.level === "error")).toBe(false);
  });
});
