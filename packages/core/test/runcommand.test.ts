import { describe, expect, it } from "vitest";
import { renderRunCommand } from "../src/runcommand/render.js";

describe("renderRunCommand", () => {
  it("renders the exact expected string with all fields present", () => {
    const out = renderRunCommand({
      command: "autoplan",
      requirements: "Add emoji reactions",
      model: "claude-opus-4-8",
      option: "--gate",
    });
    expect(out).toBe("/autoplan Add emoji reactions [claude-opus-4-8] [--gate]");
  });

  it("omits empty model/option cleanly", () => {
    const out = renderRunCommand({ command: "build", requirements: "Ship feature X" });
    expect(out).toBe("/build Ship feature X");
  });

  it("omits requirements when empty too", () => {
    const out = renderRunCommand({ command: "ship" });
    expect(out).toBe("/ship");
  });

  it("is pure: same input -> same output", () => {
    const input = { command: "qa", requirements: "test it", model: "m", option: "o" };
    expect(renderRunCommand(input)).toBe(renderRunCommand({ ...input }));
  });
});
