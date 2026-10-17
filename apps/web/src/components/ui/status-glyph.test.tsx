import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusGlyph, GLYPHS, type GlyphStatus } from "./status-glyph";

describe("StatusGlyph (W-1)", () => {
  const legend: Array<[GlyphStatus, string, string]> = [
    ["starting", "◌", "text-running"],
    ["running", "◉", "text-running"],
    ["done", "✓", "text-success"],
    ["ok", "✓", "text-success"],
    ["error", "✗", "text-danger"],
    ["interrupted", "◼", "text-ink-faint"],
    ["pending", "○", "text-ink-muted"],
    ["thinking", "·", "text-ink-faint"],
    ["neutral", "?", "text-ink-faint"],
    ["unknown", "?", "text-ink-faint"],
  ];
  for (const [status, glyph, cls] of legend) {
    for (const live of [true, false]) {
      it(`${status} live=${live}`, () => {
        render(<StatusGlyph status={status} live={live} />);
        const el = screen.getByRole("img", { name: GLYPHS[status].label });
        expect(el.textContent).toBe(glyph);
        expect(el.className).toContain(cls);
        const shouldPulse = live && (status === "running" || status === "starting");
        expect(el.getAttribute("data-pulse")).toBe(shouldPulse ? "true" : null);
        expect(el.className.includes("animate-livePulse")).toBe(shouldPulse);
      });
    }
  }
});
