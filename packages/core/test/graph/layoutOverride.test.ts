import { describe, expect, it, vi } from "vitest";
import { mergeLayoutPositions, parseLayoutOverrideFile } from "../../src/graph/layoutOverride.js";

describe("parseLayoutOverrideFile", () => {
  it("T-2.1.1: valid shape returns positions unchanged", () => {
    const result = parseLayoutOverrideFile({
      schemaVersion: 1,
      positions: { "id-1": { x: 10, y: 20 } },
    });
    expect(result).toEqual({ "id-1": { x: 10, y: 20 } });
  });

  it("T-2.1.2: undefined input returns {}", () => {
    expect(parseLayoutOverrideFile(undefined)).toEqual({});
  });

  it("T-2.1.3: non-object parsed values return {} (string/number/null/array)", () => {
    expect(parseLayoutOverrideFile("not an object")).toEqual({});
    expect(parseLayoutOverrideFile(42)).toEqual({});
    expect(parseLayoutOverrideFile(null)).toEqual({});
    expect(parseLayoutOverrideFile([])).toEqual({});
  });

  it("T-2.1.4: object missing `positions` key returns {}", () => {
    expect(parseLayoutOverrideFile({ schemaVersion: 1 })).toEqual({});
  });

  it("T-2.1.5: wrong schemaVersion returns {} (2, \"1\", missing)", () => {
    expect(parseLayoutOverrideFile({ schemaVersion: 2, positions: { a: { x: 1, y: 2 } } })).toEqual({});
    expect(parseLayoutOverrideFile({ schemaVersion: "1", positions: { a: { x: 1, y: 2 } } })).toEqual({});
    expect(parseLayoutOverrideFile({ positions: { a: { x: 1, y: 2 } } })).toEqual({});
  });

  it("T-2.1.6: one bad entry among valid entries — only the good one survives", () => {
    const result = parseLayoutOverrideFile({
      schemaVersion: 1,
      positions: {
        good: { x: 1, y: 2 },
        bad: { x: "nope", y: 2 },
        bad2: { x: 1 },
        bad3: "not-an-object",
      },
    });
    expect(result).toEqual({ good: { x: 1, y: 2 } });
  });

  it("T-2.1.7: NaN/Infinity/-Infinity entries are dropped", () => {
    const result = parseLayoutOverrideFile({
      schemaVersion: 1,
      positions: {
        nanX: { x: NaN, y: 1 },
        infX: { x: Infinity, y: 1 },
        negInfY: { x: 1, y: -Infinity },
        ok: { x: 1, y: 2 },
      },
    });
    expect(result).toEqual({ ok: { x: 1, y: 2 } });
  });

  it("T-2.1.8: extra unexpected keys alongside valid x/y are kept (extra key ignored)", () => {
    const result = parseLayoutOverrideFile({
      schemaVersion: 1,
      positions: { a: { x: 1, y: 2, z: 3 } },
    });
    expect(result).toEqual({ a: { x: 1, y: 2 } });
  });

  it("T-2.1.9: empty positions returns {}", () => {
    expect(parseLayoutOverrideFile({ schemaVersion: 1, positions: {} })).toEqual({});
  });
});

describe("mergeLayoutPositions", () => {
  it("T-2.2.1: no overrides — every id is unpinned, computeDagre called with the full list", () => {
    const computeDagre = vi.fn((ids: string[]) => new Map(ids.map((id) => [id, { x: 1, y: 1 }])));
    const result = mergeLayoutPositions({
      nodeIds: ["a", "b", "c"],
      overrides: {},
      computeDagre,
    });
    expect(computeDagre).toHaveBeenCalledWith(["a", "b", "c"]);
    expect(result).toEqual(
      new Map([
        ["a", { x: 1, y: 1 }],
        ["b", { x: 1, y: 1 }],
        ["c", { x: 1, y: 1 }],
      ])
    );
  });

  it("T-2.2.2: all ids overridden — computeDagre called with [], never consulted for positions", () => {
    const computeDagre = vi.fn((ids: string[]) => new Map(ids.map((id) => [id, { x: 999, y: 999 }])));
    const overrides = { a: { x: 10, y: 20 }, b: { x: 30, y: 40 } };
    const result = mergeLayoutPositions({
      nodeIds: ["a", "b"],
      overrides,
      computeDagre,
    });
    expect(computeDagre).toHaveBeenCalledWith([]);
    expect(result).toEqual(
      new Map([
        ["a", { x: 10, y: 20 }],
        ["b", { x: 30, y: 40 }],
      ])
    );
  });

  it("T-2.2.3: mixed pinned/unpinned — pinned positions untouched, unpinned from computeDagre, computeDagre called with ONLY unpinned ids", () => {
    const computeDagre = vi.fn((ids: string[]) => new Map(ids.map((id) => [id, { x: 100, y: 100 }])));
    const overrides = { a: { x: 5, y: 5 } };
    const result = mergeLayoutPositions({
      nodeIds: ["a", "b", "c"],
      overrides,
      computeDagre,
    });
    expect(computeDagre).toHaveBeenCalledWith(["b", "c"]);
    expect(result.get("a")).toEqual({ x: 5, y: 5 });
    expect(result.get("b")).toEqual({ x: 100, y: 100 });
    expect(result.get("c")).toEqual({ x: 100, y: 100 });
  });

  it("T-2.2.4: an override key absent from nodeIds (orphaned/deleted artifact) is ignored", () => {
    const computeDagre = vi.fn((ids: string[]) => new Map(ids.map((id) => [id, { x: 1, y: 1 }])));
    const overrides = { deleted: { x: 999, y: 999 }, a: { x: 5, y: 5 } };
    const result = mergeLayoutPositions({
      nodeIds: ["a", "b"],
      overrides,
      computeDagre,
    });
    expect(result.has("deleted")).toBe(false);
    expect([...result.keys()].sort()).toEqual(["a", "b"]);
    expect(computeDagre).toHaveBeenCalledWith(["b"]);
  });

  it("T-2.2.5: computeDagre missing an entry for an unpinned id — that id is simply omitted, no throw", () => {
    const computeDagre = vi.fn(() => new Map<string, { x: number; y: number }>());
    expect(() =>
      mergeLayoutPositions({
        nodeIds: ["a", "b"],
        overrides: {},
        computeDagre,
      })
    ).not.toThrow();
    const result = mergeLayoutPositions({
      nodeIds: ["a", "b"],
      overrides: {},
      computeDagre,
    });
    expect(result.size).toBe(0);
  });

  it("T-2.2.6: empty nodeIds — returns empty map, computeDagre called with []", () => {
    const computeDagre = vi.fn(() => new Map<string, { x: number; y: number }>());
    const result = mergeLayoutPositions({ nodeIds: [], overrides: {}, computeDagre });
    expect(result.size).toBe(0);
    expect(computeDagre).toHaveBeenCalledWith([]);
  });

  it("T-2.2.7: determinism — same inputs produce identical output across two calls", () => {
    const computeDagre = (ids: string[]) => new Map(ids.map((id, i) => [id, { x: i, y: i * 2 }]));
    const input = {
      nodeIds: ["a", "b", "c"],
      overrides: { a: { x: 1, y: 1 } },
      computeDagre,
    };
    const r1 = mergeLayoutPositions(input);
    const r2 = mergeLayoutPositions(input);
    expect(r1).toEqual(r2);
  });
});
