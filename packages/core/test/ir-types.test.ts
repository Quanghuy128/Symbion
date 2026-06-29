import { describe, expect, it } from "vitest";
import { DEFAULT_GLOBAL_CONFIG } from "../src/ir/types.js";

describe("DEFAULT_GLOBAL_CONFIG", () => {
  it("TC-PORT-1: default port is 12802", () => {
    expect(DEFAULT_GLOBAL_CONFIG.port).toBe(12802);
  });
});
