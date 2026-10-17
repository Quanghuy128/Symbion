import { describe, expect, it } from "vitest";
import { summarizeToolCall, LABEL_CAP } from "../../src/run/summarizeToolCall.js";
import { isTruncatedPreview, readToolInput, extractPromptFromPreview } from "../../src/run/toolInput.js";

/** workflow-agent-run testplan §1.3 (U-S1…U-S11) — D-4, AC-2. */
const ok = (text: string, truncated = false) => ({ text, isError: false, truncated });
const nLines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");

describe("summarizeToolCall (U-S*)", () => {
  it("U-S1: Read with offset/limit + 150-line result", () => {
    expect(summarizeToolCall("Read", { file_path: "/a/b/runManager.ts", offset: 40, limit: 150 }, ok(nLines(150)))).toEqual({
      label: "Read runManager.ts (40–189)",
      resultLabel: "150 lines",
    });
  });

  it("U-S2: Read without range / with only offset", () => {
    expect(summarizeToolCall("Read", { file_path: "x.ts" }).label).toBe("Read x.ts");
    expect(summarizeToolCall("Read", { file_path: "/p/x.ts", offset: 40 }).label).toBe("Read x.ts (from 40)");
  });

  it("U-S3: Glob with results / no files", () => {
    expect(summarizeToolCall("Glob", { pattern: "docs/loops/*.md" }, ok(nLines(41)))).toEqual({
      label: 'Glob "docs/loops/*.md"',
      resultLabel: "41 files",
    });
    expect(summarizeToolCall("Glob", { pattern: "*.x" }, ok("No files found")).resultLabel).toBe("No files");
    expect(summarizeToolCall("Glob", { pattern: "*.x", path: "src" }).label).toBe('Glob "*.x" (in src)');
  });

  it("U-S4: Grep with path", () => {
    expect(summarizeToolCall("Grep", { pattern: "parent_tool_use_id", path: "packages" }, ok(nLines(7)))).toEqual({
      label: 'Grep "parent_tool_use_id" (in packages)',
      resultLabel: "7 matches",
    });
    expect(summarizeToolCall("Grep", { pattern: "zzz" }, ok("No matches found")).resultLabel).toBe("No matches");
    expect(summarizeToolCall("Grep", { pattern: "x", glob: "*.ts" }).label).toBe('Grep "x" (in *.ts)');
  });

  it("U-S5: Bash first line ≤80; error; background", () => {
    const long = "npm run " + "x".repeat(200) + "\nsecond line";
    const s = summarizeToolCall("Bash", { command: long }, ok(nLines(3)));
    expect(s.label.startsWith("Bash npm run x")).toBe(true);
    expect(s.label.length).toBeLessThanOrEqual("Bash ".length + 80);
    expect(s.label).not.toContain("second line");
    expect(s.resultLabel).toBe("3 lines of output");
    expect(summarizeToolCall("Bash", { command: "npm test" }, { text: "FAIL", isError: true, truncated: false }).resultLabel).toBe("error");
    expect(
      summarizeToolCall("Bash", { command: "npm run dev", run_in_background: true }, ok("Command running in background with ID: bash_1")).resultLabel
    ).toBe("background");
  });

  it("U-S6: Edit / Write / MultiEdit / NotebookEdit", () => {
    expect(summarizeToolCall("Edit", { file_path: "/x/sender.ts" }).label).toBe("Edit sender.ts");
    expect(summarizeToolCall("Write", { file_path: "a/x.md" }).label).toBe("Write x.md");
    expect(summarizeToolCall("MultiEdit", { file_path: "y.ts" }).label).toBe("MultiEdit y.ts");
    expect(summarizeToolCall("NotebookEdit", { notebook_path: "/n/b.ipynb" }).label).toBe("NotebookEdit b.ipynb");
    expect(summarizeToolCall("Edit", { file_path: "y.ts" }, { text: "no", isError: true, truncated: false }).resultLabel).toBe("error");
    expect(summarizeToolCall("Edit", { file_path: "y.ts" }, ok("done")).resultLabel).toBeUndefined();
  });

  it("U-S7: Agent / Task", () => {
    expect(summarizeToolCall("Agent", { subagent_type: "ba", description: "Ideas angle" })).toEqual({ label: 'Agent ba "Ideas angle"' });
    expect(summarizeToolCall("Task", { description: "Trivial ping task" }).label).toBe('Task subagent "Trivial ping task"');
  });

  it("U-S8: WebFetch / WebSearch / mcp", () => {
    expect(summarizeToolCall("WebFetch", { url: "https://docs.x.com/a/b?q=1" }).label).toBe("WebFetch docs.x.com/a/b");
    expect(summarizeToolCall("WebSearch", { query: "q" }).label).toBe('WebSearch "q"');
    expect(summarizeToolCall("mcp__github__create_issue", { title: "t" }).label).toBe("github · create_issue");
    expect(summarizeToolCall("TodoWrite", null).label).toBe("TodoWrite");
  });

  it("U-S9: capped result -> N+ lines; isTruncatedPreview", () => {
    const text = `${nLines(12)}…[truncated 120 chars]`;
    expect(isTruncatedPreview(text)).toBe(true);
    expect(isTruncatedPreview("plain")).toBe(false);
    expect(summarizeToolCall("Read", { file_path: "a.ts" }, ok(text, true)).resultLabel).toBe("12+ lines");
  });

  it("U-S10: unknown tool fallback; null input; label cap", () => {
    expect(summarizeToolCall("Frobnicate", { target: "x" }).label).toBe("Frobnicate x");
    expect(summarizeToolCall("Frobnicate", null).label).toBe("Frobnicate");
    expect(summarizeToolCall("Frobnicate", null, ok(nLines(2))).resultLabel).toBe("2 lines");
    const longLabel = summarizeToolCall("Glob", { pattern: "p".repeat(500) }).label;
    expect(longLabel.length).toBeLessThanOrEqual(LABEL_CAP);
    expect(summarizeToolCall("", null).label).toBe("tool");
  });

  it("U-S11: readToolInput — legacy part without fields: valid JSON / cut JSON", () => {
    const valid = readToolInput({ kind: "tool_use", toolUseId: "t", tool: "Read", inputPreview: '{"file_path":"/a/x.ts","offset":3}' });
    expect(valid).toEqual({ file_path: "/a/x.ts", offset: 3 });
    const cut = readToolInput({
      kind: "tool_use",
      toolUseId: "t",
      tool: "Bash",
      inputPreview: '{"description":"run it","command":"echo aaaaaaaa…[truncated 50 chars]',
    });
    expect(cut).toEqual({ description: "run it" });
    expect(readToolInput({ kind: "tool_use", toolUseId: "t", tool: "X", inputPreview: "%%%" })).toEqual({});
    const withFields = readToolInput({ kind: "tool_use", toolUseId: "t", tool: "X", inputPreview: "{}", fields: { a: 1 } });
    expect(withFields).toEqual({ a: 1 });
  });

  it("extractPromptFromPreview: complete JSON / cut JSON / none", () => {
    expect(extractPromptFromPreview('{"prompt":"Say \\"hi\\"","description":"d"}')).toEqual({ text: 'Say "hi"', truncated: false });
    const cut = extractPromptFromPreview('{"description":"d","prompt":"line one\\nline two and…[truncated 99 chars]');
    expect(cut).toEqual({ text: "line one\nline two and", truncated: true });
    expect(extractPromptFromPreview('{"description":"d"}')).toBeNull();
    expect(extractPromptFromPreview("")).toBeNull();
  });
});
