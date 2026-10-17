import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * W-19 (AC-9 guard): the old timeline surface is fully gone from source.
 * The identifiers are assembled at runtime so this file never matches itself.
 */
const ROOT = path.resolve(__dirname, "../../..");
const SCAN_DIRS = ["apps", "packages"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "out", "coverage", "test-results", "playwright-report"]);
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const FORBIDDEN = [["RunTimeline", "Panel"], ["timeline", "Rows"], ["Timeline", "Row"], ["panelFilter", "Id"]].map((p) => p.join(""));

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = path.join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else if (EXTENSIONS.has(path.extname(name))) out.push(abs);
  }
}

describe("AC-9 parity guard (W-19)", () => {
  it("no source file outside docs/ references the removed timeline surface", () => {
    const files: string[] = [];
    for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
    expect(files.length).toBeGreaterThan(50);
    const hits: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      for (const word of FORBIDDEN) if (src.includes(word)) hits.push(`${path.relative(ROOT, f)}: ${word}`);
    }
    expect(hits).toEqual([]);
  });
});
