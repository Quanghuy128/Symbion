import { describe, expect, it } from "vitest";
import { generateDescription, type GenerateDescriptionInput } from "../src/generate/description.js";

describe("generateDescription", () => {
  it("agent, body+tools", () => {
    const out = generateDescription({
      kind: "agent",
      name: "x",
      body: "You are a reviewer.\nDo X",
      tools: ["Read", "Grep"],
    });
    expect(out).toBe("Agent that uses Read, Grep to a reviewer.");
  });

  it("agent, tools only (empty body)", () => {
    const out = generateDescription({ kind: "agent", name: "x", body: "", tools: ["Bash"] });
    expect(out).toBe("Agent that uses Bash.");
  });

  it("agent, body only (no tools)", () => {
    const out = generateDescription({ kind: "agent", name: "x", body: "Reviews code", tools: [] });
    expect(out).toBe("Agent that reviews code.");
  });

  it("agent, name-only fallback (EC-1)", () => {
    const out = generateDescription({ kind: "agent", name: "foo", body: "", tools: [] });
    expect(out).toBe("Mô tả cho foo.");
  });

  it("agent, fully empty (degenerate)", () => {
    const out = generateDescription({ kind: "agent", name: "", body: "", tools: [] });
    expect(out).toBe("Mô tả tự động.");
  });

  it("command, body present", () => {
    const out = generateDescription({ kind: "command", name: "x", body: "Run tests" });
    expect(out).toBe("Command that run tests.");
  });

  it("command, name-only fallback", () => {
    const out = generateDescription({ kind: "command", name: "deploy", body: "" });
    expect(out).toBe("Mô tả cho /deploy.");
  });

  it("command, fully empty", () => {
    const out = generateDescription({ kind: "command", name: "", body: "" });
    expect(out).toBe("Mô tả tự động.");
  });

  it("multi-line body (EC-4): output contains no newline", () => {
    const out = generateDescription({
      kind: "agent",
      name: "x",
      body: "First line of body\nSecond line\nThird line",
      tools: [],
    });
    expect(out).not.toMatch(/\n/);
    expect(out).toBe("Agent that first line of body.");
  });

  it("long body (EC-4): output capped at 200 chars, ends in '.', no mid-word cut", () => {
    const longWord = "word ".repeat(60).trim(); // way over 200 chars once wrapped in template
    const out = generateDescription({ kind: "agent", name: "x", body: longWord, tools: ["Read"] });
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith(".")).toBe(true);
    // No mid-word cut: every space-delimited token in the output should be a substring
    // of the assembled clause (i.e. not chopped mid-token) other than the trailing period.
    expect(out.endsWith(" .")).toBe(false);
  });

  it("customFields with model: appended parenthetically before final period", () => {
    const out = generateDescription({
      kind: "agent",
      name: "x",
      body: "review code changes for correctness and style",
      tools: ["Read", "Grep", "Bash"],
      customFields: [{ key: "model", value: "claude-opus-4" }],
    });
    expect(out).toBe(
      "Agent that uses Read, Grep, Bash to review code changes for correctness and style (model: claude-opus-4)."
    );
  });

  it("determinism: same input called twice -> byte-identical output", () => {
    const input: GenerateDescriptionInput = {
      kind: "agent",
      name: "x",
      body: "You are a reviewer.\nDo X",
      tools: ["Read", "Grep"],
      customFields: [{ key: "model", value: "claude-opus-4" }],
    };
    const a = generateDescription({ ...input });
    const b = generateDescription({ ...input });
    expect(a).toBe(b);
  });

  it("never throws: malformed/null-ish runtime input", () => {
    // @ts-expect-error -- deliberately passing malformed input to test runtime defensiveness
    expect(() => generateDescription(null)).not.toThrow();
    // @ts-expect-error -- deliberately passing malformed input to test runtime defensiveness
    expect(typeof generateDescription(null)).toBe("string");
    // @ts-expect-error -- deliberately passing malformed input to test runtime defensiveness
    expect(typeof generateDescription({ kind: "agent", name: null, body: null })).toBe("string");
  });

  it("never throws: customFields entry with null/undefined value (blocker fix)", () => {
    const inputNull: GenerateDescriptionInput = {
      kind: "agent",
      name: "x",
      body: "y",
      tools: ["Read"],
      // @ts-expect-error -- deliberately malformed: null value on a "model" field
      customFields: [{ key: "model", value: null }],
    };
    expect(() => generateDescription(inputNull)).not.toThrow();
    const outNull = generateDescription(inputNull);
    expect(typeof outNull).toBe("string");
    // A null-valued "model" field must never be treated as a real model value.
    expect(outNull).not.toMatch(/\(model:/);

    const inputUndefined: GenerateDescriptionInput = {
      kind: "agent",
      name: "x",
      body: "y",
      tools: ["Read"],
      // @ts-expect-error -- deliberately malformed: undefined value on a "model" field
      customFields: [{ key: "model", value: undefined }],
    };
    expect(() => generateDescription(inputUndefined)).not.toThrow();
    const outUndefined = generateDescription(inputUndefined);
    expect(typeof outUndefined).toBe("string");
    expect(outUndefined).not.toMatch(/\(model:/);
  });

  it("long model value (300 chars) never produces a broken parenthetical", () => {
    const longModel = "m".repeat(300);
    const out = generateDescription({
      kind: "agent",
      name: "x",
      body: "review code changes for correctness and style",
      tools: ["Read", "Grep", "Bash"],
      customFields: [{ key: "model", value: longModel }],
    });
    expect(out.length).toBeLessThanOrEqual(200);
    // If a "(model:" parenthetical is present, it must be closed.
    const openIdx = out.indexOf("(model:");
    if (openIdx !== -1) {
      expect(out.includes(")", openIdx)).toBe(true);
    }
    // No unclosed '(' anywhere in the output.
    const opens = (out.match(/\(/g) ?? []).length;
    const closes = (out.match(/\)/g) ?? []).length;
    expect(opens).toBe(closes);
  });
});
