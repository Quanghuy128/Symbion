import { describe, expect, it } from "vitest";
import { bezierPath } from "./bezierPath";

describe("bezierPath", () => {
  it("T-1.1: horizontal pair, source right of target by 200px, same y — labelX/labelY at the midpoint", () => {
    const { path, labelX, labelY } = bezierPath({ x: 0, y: 20 }, { x: 200, y: 20 });
    expect(path.startsWith("M0,20 C")).toBe(true);
    expect(labelX).toBeCloseTo(100, 0);
    expect(labelY).toBeCloseTo(20, 0);
  });

  it("T-1.2: source above target (positive dy) — curve bows in the xyflow-matching direction (control offset scales with |dx|)", () => {
    const { path } = bezierPath({ x: 0, y: 0 }, { x: 150, y: 100 });
    // Ported control-point formula: sourceControlX = sourceX + 0.5*(targetX-sourceX)
    // for a positive (rightward) distance — first control point sits at the
    // horizontal midpoint, matching xyflow's `Position.Right` -> `Position.Left`
    // default curvature (0.25 is irrelevant here since distance >= 0 takes the
    // `0.5 * distance` branch, not the sqrt/curvature branch).
    expect(path).toContain("C75,0 75,100 150,100");
  });

  it("T-1.3: source and target very close (< 40px apart) — path does not degenerate, still a valid SVG path", () => {
    const { path } = bezierPath({ x: 0, y: 0 }, { x: 30, y: 5 });
    expect(path).toMatch(/^M[\d.-]+,[\d.-]+ C[\d.-]+,[\d.-]+ [\d.-]+,[\d.-]+ [\d.-]+,[\d.-]+$/);
  });

  it("T-1.4: zero-distance (same point, defensive) — does not throw, returns a degenerate but valid path", () => {
    expect(() => bezierPath({ x: 10, y: 10 }, { x: 10, y: 10 })).not.toThrow();
    const { path, labelX, labelY } = bezierPath({ x: 10, y: 10 }, { x: 10, y: 10 });
    expect(path).toMatch(/^M10,10 C/);
    expect(labelX).toBeCloseTo(10, 0);
    expect(labelY).toBeCloseTo(10, 0);
  });

  it("T-1.5: negative-distance (target LEFT of source, backward edge) uses the curvature*25*sqrt(-distance) branch, matching xyflow", () => {
    // distance = targetX - sourceX = -100 (target is to the left of source) —
    // xyflow's calculateControlOffset takes the `curvature * 25 * sqrt(-distance)`
    // branch here, default curvature 0.25: 0.25 * 25 * sqrt(100) = 62.5.
    const { path } = bezierPath({ x: 150, y: 0 }, { x: 50, y: 0 });
    // sourceControlX = 150 + 62.5 = 212.5 ; targetControlX = 50 - 62.5 = -12.5
    expect(path).toContain("C212.5,0 -12.5,0 50,0");
  });

  it("T-1.6: snapshot against 3 (dx,dy) pairs — tolerance ±1px (exact port, not an approximation)", () => {
    // Since this is a line-for-line port of xyflow's actual source (not a
    // re-derived curve), tolerance is effectively 0 for these fixed inputs —
    // documented here as the ±1px allowance for floating point only.
    const cases: Array<[{ x: number; y: number }, { x: number; y: number }, number, number]> = [
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, 50, 0],
      [{ x: 0, y: 0 }, { x: 100, y: 100 }, 50, 50],
      [{ x: 0, y: 40 }, { x: 300, y: 120 }, 150, 80],
    ];
    for (const [source, target, expectedLabelX, expectedLabelY] of cases) {
      const { labelX, labelY } = bezierPath(source, target);
      expect(labelX).toBeCloseTo(expectedLabelX, 0);
      expect(labelY).toBeCloseTo(expectedLabelY, 0);
    }
  });
});
