import { describe, expect, it } from "vitest";
import { parseLine, PREVIEW_CAP } from "../../src/run/parseStreamJson.js";

describe("parseStreamJson truncation (§1.2)", () => {
  const bigInput = { path: "x".repeat(100_000) };
  const line = JSON.stringify({
    type: "assistant",
    message: {
      id: "msg_big",
      model: "m",
      content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: bigInput }],
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    parent_tool_use_id: null,
  });

  it("#1 tool_use inputPreview <= PREVIEW_CAP with a truncation marker", () => {
    const ev = parseLine(line);
    expect(ev.kind).toBe("message");
    if (ev.kind !== "message") return;
    const toolUse = ev.parts.find((p) => p.kind === "tool_use");
    expect(toolUse).toBeDefined();
    if (!toolUse || toolUse.kind !== "tool_use") return;
    expect(toolUse.inputPreview.length).toBeLessThanOrEqual(PREVIEW_CAP + 64);
    expect(toolUse.inputPreview).toContain("truncated");
  });

  it("#2 serialized RunEvent stays within the persistence bound (~12 KB)", () => {
    const ev = parseLine(line);
    const serialized = JSON.stringify(ev);
    expect(serialized.length).toBeLessThanOrEqual(12_000);
  });
});
