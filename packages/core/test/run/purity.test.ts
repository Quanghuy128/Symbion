import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const runSrcDir = join(here, "..", "..", "src", "run");

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...collectFiles(abs));
    else if (name.endsWith(".ts")) out.push(abs);
  }
  return out;
}

describe("core purity — AC-RUN-11 (§1.6)", () => {
  const files = collectFiles(runSrcDir);

  it("packages/core/src/run has .ts files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no node: imports, no fs/require in packages/core/src/run", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf-8");
      expect(src, `${file} imports node:`).not.toMatch(/node:/);
      expect(src, `${file} imports fs`).not.toMatch(/from\s+["']fs["']/);
      expect(src, `${file} uses require(`).not.toMatch(/\brequire\s*\(/);
      expect(src, `${file} imports child_process`).not.toMatch(/child_process/);
    }
  });
});
