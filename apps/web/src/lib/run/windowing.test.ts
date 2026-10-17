import { describe, expect, it } from "vitest";
import { computeOffsets, computeWindow } from "./windowing";

describe("windowing (W-9a)", () => {
  it("computeOffsets: uniform prefix sums, total at offsets[count]", () => {
    const o = computeOffsets(5, 20);
    expect([...o]).toEqual([0, 20, 40, 60, 80, 100]);
    expect([...computeOffsets(0, 20)]).toEqual([0]);
  });

  it("computeOffsets: measured overrides replace the default height; invalid measurements ignored", () => {
    const o = computeOffsets(4, 20, new Map([[1, 100], [2, 0], [3, Number.NaN]]));
    expect([...o]).toEqual([0, 20, 120, 140, 160]);
  });

  it("computeWindow: visible range + overscan, clamped at both ends", () => {
    const o = computeOffsets(100, 20);
    expect(computeWindow(o, 0, 100, 0)).toEqual({ start: 0, end: 5 });
    expect(computeWindow(o, 0, 100, 10)).toEqual({ start: 0, end: 15 });
    expect(computeWindow(o, 1000, 100, 10)).toEqual({ start: 40, end: 65 });
    expect(computeWindow(o, 1900, 100, 10)).toEqual({ start: 85, end: 100 });
    expect(computeWindow(o, 99_999, 100, 3)).toEqual({ start: 96, end: 100 });
    expect(computeWindow(computeOffsets(0, 20), 0, 100)).toEqual({ start: 0, end: 0 });
  });

  it("computeWindow respects measured rows", () => {
    const o = computeOffsets(10, 20, new Map([[0, 400]]));
    // rows 1.. start at 400
    expect(computeWindow(o, 410, 40, 0)).toEqual({ start: 1, end: 4 }); // rows 1..3 intersect [410, 450)
  });
});
