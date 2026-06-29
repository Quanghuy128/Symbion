import { describe, expect, it } from "vitest";
import {
  isUncPath,
  isWindowsDriveAbsolute,
  isWindowsStyleAbsolute,
  normalizeWindowsPath,
} from "../src/rpc/pathStyle.js";

describe("isWindowsDriveAbsolute", () => {
  it("recognizes backslash drive-absolute paths", () => {
    expect(isWindowsDriveAbsolute("C:\\Users\\me\\repo")).toBe(true);
  });

  it("recognizes forward-slash drive-absolute paths", () => {
    expect(isWindowsDriveAbsolute("C:/Users/me/repo")).toBe(true);
  });

  it("recognizes lowercase drive letters", () => {
    expect(isWindowsDriveAbsolute("c:\\Users\\me\\repo")).toBe(true);
  });

  it("does not match a Unix-style absolute path", () => {
    expect(isWindowsDriveAbsolute("/home/me/repo")).toBe(false);
  });

  it("does not match a relative path", () => {
    expect(isWindowsDriveAbsolute("repo/sub")).toBe(false);
  });

  it("does not match the drive-relative Windows syntax (C:foo)", () => {
    expect(isWindowsDriveAbsolute("C:foo")).toBe(false);
  });
});

describe("isUncPath", () => {
  it("recognizes a well-formed UNC path", () => {
    expect(isUncPath("\\\\fileserver\\teams\\my-service")).toBe(true);
  });

  it("rejects an incomplete UNC prefix with no server name", () => {
    expect(isUncPath("\\\\")).toBe(false);
  });

  it("rejects a UNC-looking prefix with no trailing separator after the server name", () => {
    expect(isUncPath("\\\\server")).toBe(false);
  });

  it("does not classify a drive-absolute path as UNC", () => {
    expect(isUncPath("C:\\Users\\me")).toBe(false);
  });
});

describe("isWindowsStyleAbsolute", () => {
  it("is true for drive-absolute paths", () => {
    expect(isWindowsStyleAbsolute("C:\\Users\\me\\repo")).toBe(true);
  });

  it("is true for UNC paths", () => {
    expect(isWindowsStyleAbsolute("\\\\fileserver\\teams\\my-service")).toBe(true);
  });

  it("is false for Unix-absolute paths", () => {
    expect(isWindowsStyleAbsolute("/etc/passwd")).toBe(false);
  });

  it("is false for relative paths", () => {
    expect(isWindowsStyleAbsolute("repo/sub")).toBe(false);
  });
});

describe("normalizeWindowsPath", () => {
  it("normalizes mixed separators and lowercase drive letter", () => {
    expect(normalizeWindowsPath("c:\\Users\\me/code\\my-service")).toBe("C:/Users/me/code/my-service");
  });
});
