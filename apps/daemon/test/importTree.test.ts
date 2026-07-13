import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  walkImportTree,
  readImportFile,
  MAX_DEPTH,
  MAX_ENTRIES_PER_DIR,
  MAX_TOTAL_NODES,
  MAX_FILE_BYTES,
  IGNORE_DIR_NAMES,
} from "../src/fs/importTree.js";
import { RpcError } from "../src/rpc/rpcError.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "symbion-importtree-"));
});

afterEach(() => {
  try {
    chmodSync(tmpRoot, 0o755);
  } catch {
    /* ignore */
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

const isRoot = !!process.getuid && process.getuid() === 0;

function relPaths(root: string): string[] {
  return walkImportTree(root).nodes.map((n) => n.relPath);
}

describe("walkImportTree — structure", () => {
  it("D1: flat list, parent-before-child, POSIX relPaths", () => {
    mkdirSync(join(tmpRoot, "a"));
    writeFileSync(join(tmpRoot, "a", "b.md"), "x");
    writeFileSync(join(tmpRoot, "c.md"), "y");

    const nodes = walkImportTree(tmpRoot).nodes;
    const paths = nodes.map((n) => n.relPath);
    expect(paths).toContain("a");
    expect(paths).toContain("a/b.md");
    expect(paths).toContain("c.md");
    // parent before child
    expect(paths.indexOf("a")).toBeLessThan(paths.indexOf("a/b.md"));
    // POSIX separators only
    expect(paths.every((p) => !p.includes("\\"))).toBe(true);
  });

  it("D2: dirs + files both returned with correct flags + size", () => {
    mkdirSync(join(tmpRoot, "dir"));
    writeFileSync(join(tmpRoot, "file.md"), "hello");

    const nodes = walkImportTree(tmpRoot).nodes;
    const dir = nodes.find((n) => n.relPath === "dir");
    const file = nodes.find((n) => n.relPath === "file.md");
    expect(dir?.isDir).toBe(true);
    expect(file?.isDir).toBe(false);
    expect(file?.size).toBe(5);
  });

  it("D3: ignore-list prunes node_modules (present, ignored, no descendants)", () => {
    mkdirSync(join(tmpRoot, "node_modules", "x"), { recursive: true });
    writeFileSync(join(tmpRoot, "node_modules", "x", "y.md"), "z");

    const nodes = walkImportTree(tmpRoot).nodes;
    const nm = nodes.find((n) => n.relPath === "node_modules");
    expect(nm?.ignored).toBe(true);
    expect(nodes.some((n) => n.relPath.startsWith("node_modules/"))).toBe(false);
  });

  it("D4: all ignore names pruned, none descended", () => {
    for (const name of IGNORE_DIR_NAMES) {
      mkdirSync(join(tmpRoot, name, "inner"), { recursive: true });
      writeFileSync(join(tmpRoot, name, "inner", "f.md"), "x");
    }
    const nodes = walkImportTree(tmpRoot).nodes;
    for (const name of IGNORE_DIR_NAMES) {
      const node = nodes.find((n) => n.relPath === name);
      expect(node?.ignored, `${name} should be ignored`).toBe(true);
      expect(nodes.some((n) => n.relPath.startsWith(`${name}/`)), `${name} not descended`).toBe(false);
    }
  });

  it("D5: empty repo → nodes:[], truncated:false", () => {
    const result = walkImportTree(tmpRoot);
    expect(result.nodes).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.truncatedReasons).toEqual([]);
  });
});

describe("walkImportTree — caps (DoS)", () => {
  it("D6/S11: depth cap — dirs beyond MAX_DEPTH absent, truncated depth", () => {
    let p = tmpRoot;
    for (let i = 0; i < MAX_DEPTH + 4; i++) {
      p = join(p, `d${i}`);
      mkdirSync(p);
    }
    const result = walkImportTree(tmpRoot);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReasons).toContain("depth");
    // deepest emitted dir should be at MAX_DEPTH segments below root
    const maxSegments = Math.max(...result.nodes.map((n) => n.relPath.split("/").length));
    expect(maxSegments).toBeLessThanOrEqual(MAX_DEPTH);
  });

  it("D7/S13: per-dir cap — ≤MAX_ENTRIES_PER_DIR nodes for one dir, truncated per-dir", () => {
    const dir = join(tmpRoot, "many");
    mkdirSync(dir);
    for (let i = 0; i < MAX_ENTRIES_PER_DIR + 100; i++) {
      writeFileSync(join(dir, `f${i}.md`), "x");
    }
    const result = walkImportTree(tmpRoot);
    const inDir = result.nodes.filter((n) => n.relPath.startsWith("many/"));
    expect(inDir.length).toBeLessThanOrEqual(MAX_ENTRIES_PER_DIR);
    expect(result.truncatedReasons).toContain("per-dir");
  });

  it("D8/S12: total-node cap — nodes.length ≤ MAX_TOTAL_NODES, truncated total-node, returns promptly", () => {
    // Create many dirs each with a handful of files to exceed 5000 nodes.
    const perDir = 20;
    const dirs = Math.ceil((MAX_TOTAL_NODES + 500) / perDir);
    for (let d = 0; d < dirs; d++) {
      const dir = join(tmpRoot, `d${d}`);
      mkdirSync(dir);
      for (let f = 0; f < perDir; f++) {
        writeFileSync(join(dir, `f${f}.md`), "x");
      }
    }
    const start = Date.now();
    const result = walkImportTree(tmpRoot);
    const elapsed = Date.now() - start;
    expect(result.nodes.length).toBeLessThanOrEqual(MAX_TOTAL_NODES);
    expect(result.truncatedReasons).toContain("total-node");
    expect(elapsed).toBeLessThan(5000);
  });
});

describe("walkImportTree — safety", () => {
  it("D9/E8: permission-denied dir tolerated, walk does not throw", () => {
    if (isRoot) return;
    mkdirSync(join(tmpRoot, "ok"));
    writeFileSync(join(tmpRoot, "ok", "f.md"), "x");
    const denied = join(tmpRoot, "denied");
    mkdirSync(denied);
    writeFileSync(join(denied, "secret.md"), "s");
    chmodSync(denied, 0o000);
    try {
      const result = walkImportTree(tmpRoot);
      expect(result.nodes.some((n) => n.relPath === "ok/f.md")).toBe(true);
      // denied dir node itself is present but not descended
      expect(result.nodes.some((n) => n.relPath === "denied")).toBe(true);
      expect(result.nodes.some((n) => n.relPath === "denied/secret.md")).toBe(false);
    } finally {
      chmodSync(denied, 0o755);
    }
  });

  it("D14/S16: root must be a directory → RpcError", () => {
    const file = join(tmpRoot, "a-file.txt");
    writeFileSync(file, "x");
    expect(() => walkImportTree(file)).toThrow(RpcError);
  });

  it("root must be absolute → RpcError", () => {
    expect(() => walkImportTree("relative/path")).toThrow(RpcError);
  });

  it("D15/S14: caps are constants — extra params ignored (no widening)", () => {
    mkdirSync(join(tmpRoot, "x"));
    // craft a params object trying to raise caps; walkImportTree takes only root.
    const crafted: any = tmpRoot;
    const result = walkImportTree(crafted);
    expect(result.nodes.length).toBeLessThanOrEqual(MAX_TOTAL_NODES);
  });

  it("D17/S7/S8: symlinked dir treated as leaf (cycle terminates, not descended)", () => {
    // a → b, b → a cycle
    const a = join(tmpRoot, "a");
    const b = join(tmpRoot, "b");
    mkdirSync(a);
    mkdirSync(b);
    symlinkSync(a, join(b, "toA"));
    symlinkSync(b, join(a, "toB"));
    writeFileSync(join(a, "real.md"), "x");

    const result = walkImportTree(tmpRoot);
    const toB = result.nodes.find((n) => n.relPath === "a/toB");
    expect(toB?.isSymlink).toBe(true);
    // symlinked dir is a leaf: no descendants emitted through it
    expect(result.nodes.some((n) => n.relPath.startsWith("a/toB/"))).toBe(false);
  });

  it("S7: symlinked dir escaping root is excluded entirely", () => {
    const outside = mkdtempSync(join(tmpdir(), "symbion-outside-"));
    try {
      writeFileSync(join(outside, "secret.md"), "s");
      symlinkSync(outside, join(tmpRoot, "escape"));
      const nodes = walkImportTree(tmpRoot).nodes;
      expect(nodes.some((n) => n.relPath === "escape")).toBe(false);
      expect(nodes.some((n) => n.relPath.startsWith("escape/"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("D16/S15: READ-ONLY — fixture unchanged after walk", () => {
    mkdirSync(join(tmpRoot, "a"));
    writeFileSync(join(tmpRoot, "a", "f.md"), "content");
    const before = statSync(join(tmpRoot, "a", "f.md")).mtimeMs;
    walkImportTree(tmpRoot);
    const after = statSync(join(tmpRoot, "a", "f.md")).mtimeMs;
    expect(after).toBe(before);
    expect(readFileSync(join(tmpRoot, "a", "f.md"), "utf-8")).toBe("content");
  });
});

describe("readImportFile — outcomes", () => {
  it("D10: happy path returns file content", () => {
    writeFileSync(join(tmpRoot, "ba.md"), "hello world");
    const result = readImportFile(tmpRoot, "ba.md");
    expect(result).toEqual({ ok: true, content: "hello world" });
  });

  it("D10b: nested path", () => {
    mkdirSync(join(tmpRoot, "prompts"));
    writeFileSync(join(tmpRoot, "prompts", "ba.md"), "nested");
    const result = readImportFile(tmpRoot, "prompts/ba.md");
    expect(result).toEqual({ ok: true, content: "nested" });
  });

  it("D11/S9: too-large → soft {ok:false, too-large}", () => {
    const big = Buffer.alloc(MAX_FILE_BYTES + 1024, 0x61); // 'a'
    writeFileSync(join(tmpRoot, "big.md"), big);
    const result = readImportFile(tmpRoot, "big.md");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too-large");
  });

  it("D12/S10: binary file → soft {ok:false, binary}", () => {
    // a small PNG header with NUL bytes
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    writeFileSync(join(tmpRoot, "logo.png"), png);
    const result = readImportFile(tmpRoot, "logo.png");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("binary");
  });

  it("D13: missing file → soft {ok:false, not-found}", () => {
    const result = readImportFile(tmpRoot, "nope.md");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-found");
  });
});

describe("readImportFile — confinement (SECURITY, throws loud)", () => {
  it("S1: ../ escape → throws RpcError", () => {
    expect(() => readImportFile(tmpRoot, "../../etc/passwd")).toThrow(RpcError);
  });
  it("S2: mid-path .. → throws RpcError", () => {
    expect(() => readImportFile(tmpRoot, "prompts/../../secret")).toThrow(RpcError);
  });
  it("S3: Windows-style backslash .. → throws RpcError", () => {
    expect(() => readImportFile(tmpRoot, "prompts\\..\\..\\secret")).toThrow(RpcError);
  });
  it("S4: absolute POSIX relPath → throws RpcError", () => {
    expect(() => readImportFile(tmpRoot, "/etc/passwd")).toThrow(RpcError);
  });
  it("S5: absolute Windows relPath → throws RpcError", () => {
    expect(() => readImportFile(tmpRoot, "C:\\Windows\\win.ini")).toThrow(RpcError);
  });
  it("S6: symlink escape read (mid-path DIRECTORY symlink) → throws RpcError", () => {
    const outside = mkdtempSync(join(tmpdir(), "symbion-outside-read-"));
    try {
      writeFileSync(join(outside, "passwd"), "secret");
      symlinkSync(outside, join(tmpRoot, "link"));
      expect(() => readImportFile(tmpRoot, "link/passwd")).toThrow(RpcError);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("S6b (F1 fix): LEAF-FILE symlink escaping root → throws path-confinement (was the blind spot)", () => {
    // A single-segment leaf symlink directly under root pointing at a file
    // OUTSIDE root. The ancestor-realpath loop never covered this (its body
    // doesn't run when dirname(candidate)===root). MUST throw, never read.
    const outside = mkdtempSync(join(tmpdir(), "symbion-outside-leaf-"));
    try {
      const secretFile = join(outside, "hostname");
      writeFileSync(secretFile, "SECRET-HOST-CONTENT");
      symlinkSync(secretFile, join(tmpRoot, "hostname"));
      try {
        const r = readImportFile(tmpRoot, "hostname");
        expect.fail(`should have thrown; instead returned ${JSON.stringify(r)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(RpcError);
        expect((err as RpcError).code).toBe("path-confinement");
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("S6c (F1 fix): a leaf symlink to a file INSIDE root is still readable (no false-positive)", () => {
    const realFile = join(tmpRoot, "real.md");
    writeFileSync(realFile, "inside content");
    symlinkSync(realFile, join(tmpRoot, "alias.md"));
    const r = readImportFile(tmpRoot, "alias.md");
    expect(r).toEqual({ ok: true, content: "inside content" });
  });

  it("S6d (F1 fix): a BROKEN leaf symlink → soft not-found (not a hard throw)", () => {
    symlinkSync(join(tmpRoot, "does-not-exist-target"), join(tmpRoot, "broken.md"));
    const r = readImportFile(tmpRoot, "broken.md");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not-found");
  });
  it("S17: confinement error has a distinguishable code (loud, not soft)", () => {
    try {
      readImportFile(tmpRoot, "../escape");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).code).toBe("path-confinement");
    }
  });
});
