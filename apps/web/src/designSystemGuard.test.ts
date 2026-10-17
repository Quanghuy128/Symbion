import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Source-level guard: the UI must draw from the design-system tokens only.
 * Scans every non-test .tsx under apps/web/src.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}
const files = walk(__dirname).map((f) => ({ f: path.relative(__dirname, f), src: fs.readFileSync(f, "utf8") }));

function hits(re: RegExp): string[] {
  const out: string[] = [];
  for (const { f, src } of files) {
    src.split("\n").forEach((line, i) => {
      if (re.test(line)) out.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return out;
}

describe("design-system guard", () => {
  it("U-G1 no hex colour literals in .tsx", () => {
    expect(hits(/#[0-9a-fA-F]{6}\b/)).toEqual([]);
  });
  it("U-G2 no opacity modifier on a token colour", () => {
    expect(
      hits(/(?<![\w-])(?:bg|text|border|ring|outline|fill|stroke)-(?:app|sidebar|deep|surface|line|ink|mint|workflow|agent|skill|running|success|warning|danger|diff|overlay|on-mint|on-danger|focus-ring)[\w-]*\/(?:\d|\[)/),
    ).toEqual([]);
  });
  it("U-G3 no arbitrary font sizes", () => {
    expect(hits(/(?<![\w-])text-\[\d/)).toEqual([]);
  });
  it("U-G4 no ad-hoc white/black translucency", () => {
    expect(hits(/(?<![\w-])(?:bg|border|text)-(?:white|black)(?![\w-])/)).toEqual([]);
  });
  it("U-G5 no light-theme palette leftovers", () => {
    expect(hits(/(?<![\w-])(?:text|bg|border)-(?:green|amber|red|gray|slate|zinc|indigo|violet)-\d/)).toEqual([]);
  });
  it("U-G5b no legacy token names", () => {
    expect(
      hits(/(?<![\w-])(?:bg-bg|text-text|border-border|brand-accent|accent-text|run-active|overwrite-btn|danger-hi|agent-hi|command-hi)-/),
    ).toEqual([]);
  });
  it("U-G6 no outline-none (global focus ring must apply)", () => {
    expect(hits(/(?<![\w-])outline-none(?![\w-])/)).toEqual([]);
  });
});
