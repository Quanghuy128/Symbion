import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { handlers, RpcError } from "../src/rpc/handlers.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "symbion-listdir-"));
});

afterEach(() => {
  // restore perms before recursive rm in case a test left a dir locked down
  try {
    chmodSync(tmpRoot, 0o755);
  } catch {
    /* ignore */
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

const isRoot = !!process.getuid && process.getuid() === 0;

describe("listDir — happy path", () => {
  it("TC-LD1: lists subdirs only, excludes files", () => {
    mkdirSync(join(tmpRoot, "a"));
    mkdirSync(join(tmpRoot, "b"));
    writeFileSync(join(tmpRoot, "c.txt"), "hello");

    const result = handlers.listDir({ path: tmpRoot });
    expect(result.denied).toBe(false);
    expect(result.entries.map((e) => e.name).sort()).toEqual(["a", "b"]);
  });

  it("TC-LD2: sorted alphabetically, case-insensitive", () => {
    mkdirSync(join(tmpRoot, "Banana"));
    mkdirSync(join(tmpRoot, "apple"));
    mkdirSync(join(tmpRoot, "Cherry"));

    const result = handlers.listDir({ path: tmpRoot });
    expect(result.entries.map((e) => e.name)).toEqual(["apple", "Banana", "Cherry"]);
  });

  it("TC-LD3: parentPath = dirname(target); filesystem root -> parentPath undefined", () => {
    const result = handlers.listDir({ path: tmpRoot });
    expect(result.parentPath).toBe(dirname(tmpRoot));

    const rootResult = handlers.listDir({ path: "/" });
    expect(rootResult.parentPath).toBeUndefined();
  });

  it("TC-LD4: omitted path resolves to os.homedir()", () => {
    const result = handlers.listDir({});
    expect(result.path).toBe(homedir());
  });

  it("TC-LD5: dotdirs included", () => {
    mkdirSync(join(tmpRoot, ".hidden"));
    const result = handlers.listDir({ path: tmpRoot });
    expect(result.entries.some((e) => e.name === ".hidden")).toBe(true);
  });
});

describe("listDir — error / edge cases", () => {
  it("TC-LD6: non-absolute path -> invalid-params", () => {
    expect(() => handlers.listDir({ path: "relative/path" })).toThrow(RpcError);
    try {
      handlers.listDir({ path: "relative/path" });
    } catch (err) {
      expect((err as RpcError).code).toBe("invalid-params");
    }
  });

  it("TC-LD7: nonexistent path -> invalid-path", () => {
    expect(() => handlers.listDir({ path: join(tmpRoot, "does-not-exist") })).toThrow(RpcError);
    try {
      handlers.listDir({ path: join(tmpRoot, "does-not-exist") });
    } catch (err) {
      expect((err as RpcError).code).toBe("invalid-path");
    }
  });

  it("TC-LD8: path is a file, not a dir -> invalid-path", () => {
    const filePath = join(tmpRoot, "a-file.txt");
    writeFileSync(filePath, "x");
    try {
      handlers.listDir({ path: filePath });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as RpcError).code).toBe("invalid-path");
    }
  });

  it.skipIf(isRoot)("TC-LD9: permission-denied dir -> {denied:true, entries:[]}, does not throw", () => {
    const deniedDir = join(tmpRoot, "denied");
    mkdirSync(deniedDir);
    chmodSync(deniedDir, 0o000);
    try {
      const result = handlers.listDir({ path: deniedDir });
      expect(result.denied).toBe(true);
      expect(result.entries).toEqual([]);
    } finally {
      chmodSync(deniedDir, 0o755);
    }
  });

  it.skipIf(isRoot)("TC-LD10: per-entry unreadable doesn't fail the whole call", () => {
    mkdirSync(join(tmpRoot, "ok"));
    const lockedDir = join(tmpRoot, "locked");
    mkdirSync(lockedDir);
    chmodSync(tmpRoot, 0o555); // prevent stat from following through fully on some platforms — restore after
    chmodSync(tmpRoot, 0o755);
    chmodSync(lockedDir, 0o000);
    try {
      const result = handlers.listDir({ path: tmpRoot });
      expect(() => result).not.toThrow();
      const names = result.entries.map((e) => e.name).sort();
      expect(names).toContain("ok");
      expect(names).toContain("locked");
    } finally {
      chmodSync(lockedDir, 0o755);
    }
  });

  it("TC-LD11: symlink to dir included with isSymlink+isDir true", () => {
    mkdirSync(join(tmpRoot, "real"));
    symlinkSync(join(tmpRoot, "real"), join(tmpRoot, "link"));
    const result = handlers.listDir({ path: tmpRoot });
    const link = result.entries.find((e) => e.name === "link");
    expect(link).toBeDefined();
    expect(link!.isSymlink).toBe(true);
    expect(link!.isDir).toBe(true);
  });

  it("TC-LD12: broken symlink excluded entirely", () => {
    symlinkSync(join(tmpRoot, "does-not-exist-target"), join(tmpRoot, "broken"));
    const result = handlers.listDir({ path: tmpRoot });
    expect(result.entries.some((e) => e.name === "broken")).toBe(false);
  });

  it("TC-LD13: symlink to a file excluded entirely", () => {
    const filePath = join(tmpRoot, "real-file.txt");
    writeFileSync(filePath, "x");
    symlinkSync(filePath, join(tmpRoot, "linkToFile"));
    const result = handlers.listDir({ path: tmpRoot });
    expect(result.entries.some((e) => e.name === "linkToFile")).toBe(false);
  });
});

describe("makeDir — happy path", () => {
  it("TC-MD1: creates a not-yet-existing dir", () => {
    const target = join(tmpRoot, "new-project");
    const result = handlers.makeDir({ path: target });
    expect(result).toEqual({ path: target, created: true });
    expect(existsSync(target)).toBe(true);
  });

  it("TC-MD2: mkdir -p creates missing intermediate dirs", () => {
    const target = join(tmpRoot, "a", "b", "c");
    const result = handlers.makeDir({ path: target });
    expect(result.created).toBe(true);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(join(tmpRoot, "a", "b"))).toBe(true);
  });

  it("TC-MD3: idempotent — second call on same path returns created:false, no error", () => {
    const target = join(tmpRoot, "idempotent-dir");
    const first = handlers.makeDir({ path: target });
    expect(first.created).toBe(true);
    const second = handlers.makeDir({ path: target });
    expect(second.created).toBe(false);
  });
});

describe("makeDir — error / edge cases", () => {
  it("TC-MD4: non-absolute path -> invalid-params", () => {
    try {
      handlers.makeDir({ path: "relative/path" });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as RpcError).code).toBe("invalid-params");
    }
  });

  it("TC-MD5: literal '..' segment -> invalid-params (rejected before any fs call)", () => {
    // node:path's join() normalizes away ".." segments, so build the literal
    // string by hand to exercise the raw-segment check the handler performs.
    const pathWithDotDot = `${tmpRoot}/../escape`;
    try {
      handlers.makeDir({ path: pathWithDotDot });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as RpcError).code).toBe("invalid-params");
    }
  });

  it("TC-MD-NEW-1: Windows-style backslash '..' segment -> invalid-params (parity with TC-MD5)", () => {
    const pathWithDotDot = `${tmpRoot}/..\\escape`;
    try {
      handlers.makeDir({ path: pathWithDotDot });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as RpcError).code).toBe("invalid-params");
    }
  });

  it("TC-MD6: path exists as a file -> path-is-file", () => {
    const blocker = join(tmpRoot, "blocker");
    writeFileSync(blocker, "x");
    try {
      handlers.makeDir({ path: blocker });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as RpcError).code).toBe("path-is-file");
    }
  });

  it("TC-MD7: ancestor segment is a file (ENOTDIR) -> mkdir-failed", () => {
    const blocker = join(tmpRoot, "blocker");
    writeFileSync(blocker, "x");
    try {
      handlers.makeDir({ path: join(blocker, "child") });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as RpcError).code).toBe("mkdir-failed");
    }
  });

  it.skipIf(isRoot)("TC-MD8: no write permission on parent -> mkdir-failed", () => {
    const readonlyDir = join(tmpRoot, "readonly");
    mkdirSync(readonlyDir);
    chmodSync(readonlyDir, 0o555);
    try {
      handlers.makeDir({ path: join(readonlyDir, "child") });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as RpcError).code).toBe("mkdir-failed");
    } finally {
      chmodSync(readonlyDir, 0o755);
    }
  });
});

describe("RPC contract / server wiring", () => {
  it("TC-RPC6: makeDir then validatePath on same path reports exists+isDir true, nothing else true", () => {
    const target = join(tmpRoot, "fresh-project");
    handlers.makeDir({ path: target });
    const validation = handlers.validatePath({ path: target });
    expect(validation).toEqual({
      exists: true,
      isDir: true,
      isGitRepo: false,
      hasClaudeDir: false,
      hasAgentsMd: false,
      writable: true,
    });
  });

  it("TC-RPC7: makeDir then createProject on the same path succeeds (no regression to defense-in-depth check)", async () => {
    const target = join(tmpRoot, "fresh-project-2");
    handlers.makeDir({ path: target });
    const ctx = { port: 20128, version: "0.1.0" };
    process.env["SYMBION_CONFIG_DIR"] = mkdtempSync(join(tmpdir(), "symbion-config-"));
    try {
      const result = await handlers.createProject({ name: "demo", path: target }, ctx);
      expect(result.project.schemaVersion).toBe(1);
    } finally {
      delete process.env["SYMBION_CONFIG_DIR"];
    }
  });
});
