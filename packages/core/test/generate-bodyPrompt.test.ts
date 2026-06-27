import { describe, expect, it } from "vitest";
import { buildBodyGenerationPrompt, type BodyPromptInput } from "../src/generate/bodyPrompt.js";

const AGENT_FULL: BodyPromptInput = {
  kind: "agent",
  name: "code-reviewer",
  description: "Reviews PRs for bugs",
  existingBody: "You are a careful reviewer.",
};

const COMMAND_FULL: BodyPromptInput = {
  kind: "command",
  name: "analyze",
  description: "Runs BA agents",
  existingBody: "Step 1: ...",
};

describe("buildBodyGenerationPrompt", () => {
  it("TC-C1: all 4 fields populated (agent) -> user contains name/description/existingBody verbatim", () => {
    const { system, user } = buildBodyGenerationPrompt(AGENT_FULL);
    expect(user).toContain(AGENT_FULL.name);
    expect(user).toContain(AGENT_FULL.description);
    expect(user).toContain(AGENT_FULL.existingBody);
    expect(system.length).toBeGreaterThan(0);
    expect(system).not.toContain("undefined");
    expect(system).not.toContain("null");
    expect(user).not.toContain("undefined");
    expect(user).not.toContain("null");
  });

  it("TC-C2: kind=command prompt differs meaningfully from kind=agent prompt for otherwise-identical input", () => {
    const base = { name: "x", description: "y", existingBody: "z" };
    const agentPrompt = buildBodyGenerationPrompt({ kind: "agent", ...base });
    const commandPrompt = buildBodyGenerationPrompt({ kind: "command", ...base });
    expect(agentPrompt.system).not.toBe(commandPrompt.system);
    expect(agentPrompt.user).not.toBe(commandPrompt.user);
    expect(commandPrompt.system.toLowerCase()).toMatch(/command|lệnh/);
    expect(agentPrompt.system.toLowerCase()).toMatch(/agent/);
  });

  it("TC-C3 (EC-1): description and existingBody empty (name-only) does not throw and is well-formed", () => {
    const input: BodyPromptInput = { kind: "agent", name: "foo", description: "", existingBody: "" };
    expect(() => buildBodyGenerationPrompt(input)).not.toThrow();
    const { user } = buildBodyGenerationPrompt(input);
    expect(user).toContain("foo");
    // empty fields must be explicitly labeled, not left as a dangling "Label: " with nothing after it
    expect(user).toMatch(/Mô tả ngắn: \(chưa có\)/);
    expect(user).toMatch(/Nội dung hiện tại[^:]*: \(chưa có\)/);
  });

  it("TC-C3b (EC-1): fully empty (name also empty) still produces a coherent prompt, never throws", () => {
    const input: BodyPromptInput = { kind: "command", name: "", description: "", existingBody: "" };
    expect(() => buildBodyGenerationPrompt(input)).not.toThrow();
    const { system, user } = buildBodyGenerationPrompt(input);
    expect(system.length).toBeGreaterThan(0);
    expect(user.length).toBeGreaterThan(0);
  });

  it("TC-C4: pure/deterministic — same input twice -> identical output", () => {
    const out1 = buildBodyGenerationPrompt(COMMAND_FULL);
    const out2 = buildBodyGenerationPrompt({ ...COMMAND_FULL });
    expect(out1).toEqual(out2);
  });

  it("TC-C5: source file does not import any node:*/fs/net module", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/generate/bodyPrompt.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/from\s+["']node:/);
    expect(src).not.toMatch(/from\s+["']fs["']/);
    expect(src).not.toMatch(/from\s+["']net["']/);
  });
});
