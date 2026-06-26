import { describe, expect, it } from "vitest";
import { bump, compareVersions, parseVersion, validateVersion } from "../src/version/semver.js";

describe("semver", () => {
  it("bumps patch/minor/major correctly", () => {
    expect(bump("v0.2.0", "patch")).toBe("v0.2.1");
    expect(bump("v0.2.0", "minor")).toBe("v0.3.0");
    expect(bump("v0.2.0", "major")).toBe("v1.0.0");
  });

  it("resets lower components on minor/major bump", () => {
    expect(bump("v1.2.3", "minor")).toBe("v1.3.0");
    expect(bump("v1.2.3", "major")).toBe("v2.0.0");
  });

  it("rejects malformed version strings", () => {
    expect(() => bump("0.2.0", "patch")).toThrow();
    expect(() => bump("v0.2", "patch")).toThrow();
    expect(() => bump("not-a-version", "patch")).toThrow();
  });

  it("validateVersion", () => {
    expect(validateVersion("v0.1.0")).toBe(true);
    expect(validateVersion("0.1.0")).toBe(false);
    expect(validateVersion("v1.0")).toBe(false);
  });

  it("parseVersion extracts the numeric tuple, or null on malformed input", () => {
    expect(parseVersion("v0.10.0")).toEqual({ major: 0, minor: 10, patch: 0 });
    expect(parseVersion("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion("not-a-version")).toBeNull();
  });

  it("compareVersions compares numerically, not lexicographically (the PublishDialog bug)", () => {
    // "v0.10.0" > "v0.2.0" numerically, even though it sorts lower as a plain string.
    expect(compareVersions("v0.10.0", "v0.2.0")).toBeGreaterThan(0);
    expect("v0.10.0" > "v0.2.0").toBe(false); // documents the naive-string-compare bug this guards against
    expect(compareVersions("v1.0.0", "v1.0.0")).toBe(0);
    expect(compareVersions("v1.0.0", "v1.0.1")).toBeLessThan(0);
    expect(compareVersions("v2.0.0", "v1.99.99")).toBeGreaterThan(0);
  });
});
