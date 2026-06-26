import { describe, expect, it } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "../src/render/frontmatter.js";

describe("frontmatter serialize/parse", () => {
  it("emits stable key order: name, description, tools, then custom fields", () => {
    const out = serializeFrontmatter({
      name: "code-reviewer",
      description: "Independent reviewer",
      tools: ["Read", "Grep", "Glob"],
      customFields: [{ key: "model", value: "claude-opus-4" }],
    });
    expect(out).toBe(
      "name: code-reviewer\ndescription: Independent reviewer\ntools: Read, Grep, Glob\nmodel: claude-opus-4"
    );
  });

  it("tools CSV byte format matches comma+space", () => {
    const out = serializeFrontmatter({ description: "x", tools: ["Read", "Grep", "Glob"] });
    expect(out).toContain("tools: Read, Grep, Glob");
  });

  it("command frontmatter contains only description, no name/tools", () => {
    const out = serializeFrontmatter({ description: "3 BA agents research requirements" });
    expect(out).toBe("description: 3 BA agents research requirements");
  });

  it("round-trips agent frontmatter (parse(serialize(x)) preserves fields)", () => {
    const serialized = serializeFrontmatter({
      name: "ba",
      description: "Business analyst",
      tools: ["Read", "Grep"],
    });
    const parsed = parseFrontmatter(serialized);
    expect(parsed.name).toBe("ba");
    expect(parsed.description).toBe("Business analyst");
    expect(parsed.tools).toEqual(["Read", "Grep"]);
    expect(parsed.customFields).toEqual([]);
  });

  it("round-trips command frontmatter (description only)", () => {
    const serialized = serializeFrontmatter({ description: "analyze step" });
    const parsed = parseFrontmatter(serialized);
    expect(parsed.name).toBeUndefined();
    expect(parsed.tools).toBeUndefined();
    expect(parsed.description).toBe("analyze step");
  });

  it("preserves custom field order through parse", () => {
    const serialized = serializeFrontmatter({
      description: "x",
      customFields: [
        { key: "model", value: "claude-opus-4" },
        { key: "temperature", value: "0.2" },
      ],
    });
    const parsed = parseFrontmatter(serialized);
    expect(parsed.customFields).toEqual([
      { key: "model", value: "claude-opus-4" },
      { key: "temperature", value: "0.2" },
    ]);
  });

  it("throws on missing description", () => {
    expect(() => parseFrontmatter("name: foo")).toThrow();
  });

  it("throws on invalid YAML", () => {
    expect(() => parseFrontmatter("description: [unterminated")).toThrow();
  });
});
