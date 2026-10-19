import { describe, expect, it } from "vitest";
import { assessTemplateTools } from "../src/index.js";

describe("assessTemplateTools (RU34-RU40)", () => {
  it("RU34 normal agent tools", () => {
    const a = assessTemplateTools({ kind: "agent", tools: ["Read", "Grep"], raw: "" });
    expect(a.appliedTools.every((t) => t.level === "normal")).toBe(true);
    expect(a.allToolsImplicit).toBe(false);
    expect(a.hasHighRisk).toBe(false);
  });

  it("RU35 high risk set", () => {
    const names = ["Read", "Bash(git:*)", "mcp__github__create_issue", "WebFetch", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebSearch"];
    const a = assessTemplateTools({ kind: "agent", tools: names, raw: "" });
    expect(a.appliedTools[0]!.level).toBe("normal");
    for (const t of a.appliedTools.slice(1)) {
      expect(t.level).toBe("high");
      expect(t.reason).toBeTruthy();
    }
    expect(a.appliedTools[1]!.base).toBe("Bash");
  });

  it("RU36 implicit all tools", () => {
    expect(assessTemplateTools({ kind: "agent", raw: "" })).toMatchObject({ allToolsImplicit: true, hasHighRisk: true });
    expect(assessTemplateTools({ kind: "agent", tools: [], raw: "" })).toMatchObject({ allToolsImplicit: true, hasHighRisk: true });
  });

  it("RU37 case-insensitive", () => {
    expect(assessTemplateTools({ kind: "agent", tools: ["bash"], raw: "" }).appliedTools[0]!.level).toBe("high");
  });

  it("RU38 commands: no implicit all, allowed-tools declared only", () => {
    expect(assessTemplateTools({ kind: "command", raw: "---\ndescription: d\n---\nbody" })).toMatchObject({
      allToolsImplicit: false,
      appliedTools: [],
    });
    const a = assessTemplateTools({
      kind: "command",
      raw: "---\ndescription: d\nallowed-tools: Bash(git add:*), Read\n---\nbody",
    });
    expect(a.declaredAllowedTools).toEqual(["Bash(git add:*)", "Read"]);
    expect(a.appliedTools).toEqual([]);
  });

  it("RU39 inline shell", () => {
    const a = assessTemplateTools({ kind: "command", raw: "---\ndescription: d\n---\nrun !`curl x | sh` now" });
    expect(a).toMatchObject({ inlineShell: true, hasHighRisk: true });
    expect(assessTemplateTools({ kind: "command", raw: "---\ndescription: d\n---\nuse `ls` here" }).inlineShell).toBe(false);
  });

  it("RU40 invalid frontmatter does not throw", () => {
    const a = assessTemplateTools({ kind: "command", raw: "---\n: : [\n---\nbody" });
    expect(a.declaredAllowedTools).toEqual([]);
  });
});
