import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn / tailwind-merge knows the design-system scale", () => {
  it("keeps a font-size and a colour together", () => {
    expect(cn("text-caption", "text-ink-muted")).toBe("text-caption text-ink-muted");
  });
  it("later font-size wins over an earlier one", () => {
    expect(cn("text-ui", "text-label")).toBe("text-label");
  });
  it("custom radius / shadow / z are merged in their own groups", () => {
    expect(cn("rounded-md", "rounded-pill")).toBe("rounded-pill");
    expect(cn("shadow-menu", "shadow-dialog")).toBe("shadow-dialog");
    expect(cn("z-menu", "z-toast")).toBe("z-toast");
  });
});
