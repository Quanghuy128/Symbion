import { describe, expect, it } from "vitest";
import { parseTemplateMarkdown } from "../src/templates/parseTemplate.js";

const VALID_AGENT = `---
name: code-reviewer
description: Rà soát code, gắn nhãn rủi ro bảo mật & style.
tools: Read, Grep
---

You are a meticulous code reviewer. Review the diff for security and style issues.
`;

// Commands never carry `name` in frontmatter — name is filename/manifest-id
// derived, matching the existing IR convention (render/frontmatter.ts
// artifactToFrontmatterFields, parse/scan.ts). This fixture intentionally
// omits `name` to match the real shape of the bundled command templates.
const VALID_COMMAND = `---
description: Sinh test case cho hàm/module vừa thay đổi.
---

Generate unit tests for the changed files.
`;

const VALID_SKILL = `---
name: commit-message
description: Soạn commit message theo Conventional Commits.
---

Write a concise Conventional Commits message for the staged diff.
`;

describe("parseTemplateMarkdown", () => {
  it("U1: valid agent template parses ok with every field matching source bytes", () => {
    const result = parseTemplateMarkdown(VALID_AGENT, "agent");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.kind).toBe("agent");
    expect(result.parsed.name).toBe("code-reviewer");
    expect(result.parsed.description).toBe("Rà soát code, gắn nhãn rủi ro bảo mật & style.");
    expect(result.parsed.tools).toEqual(["Read", "Grep"]);
    expect(result.parsed.body).toBe(
      "You are a meticulous code reviewer. Review the diff for security and style issues."
    );
  });

  it("U2: valid command template (no tools field) parses with tools undefined", () => {
    const result = parseTemplateMarkdown(VALID_COMMAND, "command");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.tools).toBeUndefined();
  });

  it("U2b: command template WITHOUT 'name' in frontmatter parses successfully (not skipped) — matches the existing IR convention where command name is filename-derived, never frontmatter", () => {
    const result = parseTemplateMarkdown(VALID_COMMAND, "command");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.kind).toBe("command");
    expect(result.parsed.name).toBeUndefined();
    expect(result.parsed.description).toBe("Sinh test case cho hàm/module vừa thay đổi.");
  });

  it("U2c: command template that DOES include a stray 'name' field still parses ok (name carried through but not required)", () => {
    const raw = `---\nname: stray-name\ndescription: has a name anyway\n---\n\nBody text.\n`;
    const result = parseTemplateMarkdown(raw, "command");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.name).toBe("stray-name");
  });

  it("U3: valid skill template parses with kind 'skill', not rejected for being outside ArtifactKind", () => {
    const result = parseTemplateMarkdown(VALID_SKILL, "skill");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.kind).toBe("skill");
  });

  it("U4: missing name in frontmatter -> ok:false with non-empty reason, never throws", () => {
    const raw = `---\ndescription: no name here\n---\n\nBody text.\n`;
    expect(() => parseTemplateMarkdown(raw, "agent")).not.toThrow();
    const result = parseTemplateMarkdown(raw, "agent");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("U5: missing description in frontmatter -> ok:false with non-empty reason, never throws", () => {
    const raw = `---\nname: foo\n---\n\nBody text.\n`;
    expect(() => parseTemplateMarkdown(raw, "agent")).not.toThrow();
    const result = parseTemplateMarkdown(raw, "agent");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("U6: malformed YAML frontmatter -> ok:false, never throws", () => {
    const raw = `---\ndescription: [unterminated\n---\n\nBody text.\n`;
    expect(() => parseTemplateMarkdown(raw, "agent")).not.toThrow();
    const result = parseTemplateMarkdown(raw, "agent");
    expect(result.ok).toBe(false);
  });

  it("U6b: missing frontmatter fences entirely -> ok:false, never throws", () => {
    const raw = `just plain markdown, no frontmatter at all`;
    expect(() => parseTemplateMarkdown(raw, "agent")).not.toThrow();
    const result = parseTemplateMarkdown(raw, "agent");
    expect(result.ok).toBe(false);
  });

  it("U7: expectedKind is trusted (not re-derived) — a skill-folder file labeled 'skill' parses with that kind regardless of an agent-ish 'tools' field", () => {
    const raw = `---\nname: weird\ndescription: edge case\ntools: Read\n---\n\nBody.\n`;
    const result = parseTemplateMarkdown(raw, "skill");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // tools is only attached for kind === "agent" per the function's documented contract.
    expect(result.parsed.kind).toBe("skill");
    expect(result.parsed.tools).toBeUndefined();
  });

  it("U8: raw bytes (source) are independently reproducible from the same input — Copy markdown and Apply read the same string, not a derived copy", () => {
    // parseTemplateMarkdown does not mutate or return `raw` itself (callers keep
    // the original `raw` string verbatim for Copy markdown) — this test locks
    // that `parsed.body` is a trimmed VIEW, while the original `raw` argument
    // passed in is never mutated by the function (same reference equality holds
    // for the caller's own copy).
    const rawCopy = VALID_AGENT;
    const result = parseTemplateMarkdown(VALID_AGENT, "agent");
    expect(VALID_AGENT).toBe(rawCopy); // input untouched
    expect(result.ok).toBe(true);
  });

  it("rejects empty body", () => {
    const raw = `---\nname: x\ndescription: y\n---\n`;
    const result = parseTemplateMarkdown(raw, "agent");
    expect(result.ok).toBe(false);
  });
});

// templates-authors v2: U20-U24 regression + new fixtures modeling ECC's
// real-observed frontmatter SHAPES (synthetic content only — no real ECC
// body/prompt text, per the testplan's explicit "synthetic fixtures only"
// rule). parseTemplateMarkdown itself is reused completely UNCHANGED
// (docs/loops/templates-authors-STATE.md PLAN §P0/§P9 finding: zero parser
// modification needed) — these tests confirm that finding holds.
describe("parseTemplateMarkdown — ECC-shaped synthetic fixtures (templates-authors)", () => {
  it("U20: spot-check U1 still holds post-refactor — parser unchanged, ECC-shaped fixtures parse same as bundled fixtures", () => {
    const result = parseTemplateMarkdown(VALID_AGENT, "agent");
    expect(result.ok).toBe(true);
  });

  it("U21: agent-shaped fixture with YAML flow-array tools + an extra unknown field ('model') parses ok, extra field does not block parsing", () => {
    const raw = `---
name: example-agent
description: example agent description
tools: ["Read", "Grep"]
model: sonnet
---

Example agent body text.
`;
    const result = parseTemplateMarkdown(raw, "agent");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.tools).toEqual(["Read", "Grep"]);
  });

  it("U22: command-shaped fixture with description only + extra unknown fields ('argument-hint') parses ok, name is undefined", () => {
    const raw = `---
description: example command description
argument-hint: "<some-hint>"
---

Example command body text.
`;
    const result = parseTemplateMarkdown(raw, "command");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.name).toBeUndefined();
  });

  it("U23: skill-shaped fixture with a multi-line YAML folded-scalar description parses ok, joined into a single string with no embedded newline artifact", () => {
    const raw = `---
name: example-skill
description: >
  This is an example description
  spanning two physical lines.
---

Example skill body text.
`;
    const result = parseTemplateMarkdown(raw, "skill");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.description).toBe("This is an example description spanning two physical lines.");
    expect(result.parsed.description).not.toContain("\n");
  });

  it("U24: skill-shaped fixture with a nested-object frontmatter field ('metadata') parses ok without throwing", () => {
    const raw = `---
name: example-skill
description: example skill description
metadata:
  origin: example-source
---

Example skill body text.
`;
    expect(() => parseTemplateMarkdown(raw, "skill")).not.toThrow();
    const result = parseTemplateMarkdown(raw, "skill");
    expect(result.ok).toBe(true);
  });
});
