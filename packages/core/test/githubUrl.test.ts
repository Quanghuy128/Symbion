import { describe, expect, it } from "vitest";
import {
  encodePathSegments,
  githubCommitShaUrl,
  githubMatchingRefsUrl,
  githubRawFileUrl,
  githubTreeUrl,
  isSafePathSegment,
  isSafeRepoRelPath,
  isValidRefName,
  parseGithubSourceUrl,
  resolveRefFromCandidates,
  GITHUB_OWNER_RE,
  GITHUB_REPO_RE,
} from "../src/index.js";

const ok = (url: string) => {
  const r = parseGithubSourceUrl(url);
  if (!r.ok) throw new Error(`expected ok for ${url}: ${r.message}`);
  return r;
};
const bad = (url: string) => {
  const r = parseGithubSourceUrl(url);
  expect(r.ok, url).toBe(false);
  if (r.ok) throw new Error("unreachable");
  expect(r.message.length).toBeGreaterThan(0);
  return r.message;
};

describe("parseGithubSourceUrl (RU1-RU14)", () => {
  it("RU1 plain repo", () => {
    expect(parseGithubSourceUrl("https://github.com/acme/tools")).toEqual({
      ok: true,
      owner: "acme",
      repo: "tools",
      ref: null,
      refSegments: [],
    });
  });

  it("RU2 normalisations all equal RU1", () => {
    const base = parseGithubSourceUrl("https://github.com/acme/tools");
    for (const u of [
      "https://github.com/acme/tools/",
      "https://github.com/acme/tools///".replace("///", "/"),
      "https://github.com/acme/tools.git",
      "https://github.com/acme/tools?tab=readme-ov-file",
      "https://github.com/acme/tools#readme",
      "https://www.github.com/acme/tools",
      "https://GitHub.COM/acme/tools",
      "github.com/acme/tools",
      "  https://github.com/acme/tools  ",
    ]) {
      expect(parseGithubSourceUrl(u), u).toEqual(base);
    }
  });

  it("RU3 tree refs", () => {
    expect(ok("https://github.com/acme/tools/tree/main").refSegments).toEqual(["main"]);
    expect(ok("https://github.com/acme/tools/tree/main/packages/agents").refSegments).toEqual([
      "main",
      "packages",
      "agents",
    ]);
  });

  it("RU4 percent-decoding; encoded slash rejected", () => {
    expect(ok("https://github.com/acme/tools/tree/main/my%20folder").refSegments).toEqual(["main", "my folder"]);
    bad("https://github.com/acme/tools/tree/feature%2Fx");
  });

  it("RU5 sha ref", () => {
    const sha = "a".repeat(40);
    expect(ok(`https://github.com/acme/tools/tree/${sha}`).refSegments).toEqual([sha]);
  });

  it("RU6 http rejected, mentions https", () => {
    expect(bad("http://github.com/acme/tools")).toMatch(/https/);
  });

  it("RU7 hosts", () => {
    for (const u of [
      "https://gitlab.com/a/b",
      "https://github.com.evil.com/a/b",
      "https://evil.com/github.com/a/b",
      "https://github.com@evil.com/a/b",
      "https://user:pw@github.com/a/b",
      "https://github.com:8443/a/b",
      "https://api.github.com/repos/a/b",
      "https://raw.githubusercontent.com/a/b/main/x",
      "https://gist.github.com/a/b",
    ]) {
      bad(u);
    }
  });

  it("RU8 schemes", () => {
    for (const u of [
      "git@github.com:a/b.git",
      "ssh://github.com/a/b",
      "ftp://github.com/a/b",
      "javascript:alert(1)",
      "file:///etc/passwd",
    ]) {
      bad(u);
    }
  });

  it("RU9 shape", () => {
    bad("https://github.com/acme");
    expect(bad("https://github.com/acme/tools/blob/main/x.md")).toMatch(/tree|folder/);
    bad("https://github.com/acme/tools/issues/1");
    bad("https://github.com/acme/tools/tree");
    bad("https://github.com/acme//tools");
  });

  it("RU10 traversal", () => {
    for (const u of [
      "https://github.com/a/b/tree/main/../secrets",
      "https://github.com/a/b/tree/main/%2e%2e/x",
      "https://github.com/a/b/tree/%2E%2E/x",
      "https://github.com/a/b/tree/main/./x",
      "https://github.com/a/b/tree/main\\x",
      "https://github.com/a/b/tree/main/a%5Cb",
    ]) {
      bad(u);
    }
  });

  it("RU11 control and whitespace", () => {
    for (const u of [
      "https://github.com/a/b/tree/main/x\ny",
      "https://github.com/a/b/tree/main/x\ty",
      "https://github.com/a/b/tree/main/x%00y",
      "https://github.com/a/b/tree/main/x%0Ay",
      "https://github.com/a/b/tree/main/x y",
    ]) {
      bad(u);
    }
  });

  it("RU12 owner/repo charset and length", () => {
    bad("https://github.com/-acme/tools");
    bad(`https://github.com/${"a".repeat(40)}/tools`);
    bad("https://github.com/ac_me/tools");
    bad("https://github.com/acme/..");
    bad("https://github.com/acme/.");
    bad(`https://github.com/acme/${"r".repeat(101)}`);
    bad("https://github.com/acme/a%20b");
  });

  it("RU13 limits and malformed encoding", () => {
    bad(`https://github.com/a/b/tree/main/${"x".repeat(2100)}`);
    bad(`https://github.com/a/b/tree/${Array.from({ length: 33 }, () => "s").join("/")}`);
    bad(`https://github.com/a/b/tree/main/${"y".repeat(256)}`);
    bad("https://github.com/a/b/tree/main/%E0%A4%A");
  });

  it("RU14 fuzz: never throws; ok results satisfy invariants", () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const alphabet = "abcXYZ019-._/%\\?#:@ \n\t..github.com/tree/blob/%2e%2E%5C%2F%00";
    for (let i = 0; i < 500; i++) {
      const len = rnd() % 80;
      let s = "";
      for (let j = 0; j < len; j++) s += alphabet[rnd() % alphabet.length];
      const variants = [s, `https://github.com/${s}`, `github.com/a/b/tree/${s}`];
      for (const v of variants) {
        const r = parseGithubSourceUrl(v);
        if (r.ok) {
          expect(GITHUB_OWNER_RE.test(r.owner)).toBe(true);
          expect(GITHUB_REPO_RE.test(r.repo)).toBe(true);
          for (const seg of r.refSegments) expect(isSafePathSegment(seg)).toBe(true);
        }
      }
    }
  });
});

describe("builders + path helpers (RU15-RU19)", () => {
  it("RU15 builders encode per segment and only emit allowed hosts", () => {
    expect(githubCommitShaUrl("acme", "tools", "feature/x")).toBe(
      "https://api.github.com/repos/acme/tools/commits/feature/x",
    );
    const sha = "b".repeat(40);
    const raw = githubRawFileUrl("acme", "tools", sha, "agents/a#b?.md");
    expect(raw).toBe(`https://raw.githubusercontent.com/acme/tools/${sha}/agents/a%23b%3F.md`);
    for (const u of [
      githubCommitShaUrl("acme", "tools", "main"),
      githubTreeUrl("acme", "tools", sha),
      githubMatchingRefsUrl("acme", "tools", "heads", "feature"),
      raw,
    ]) {
      expect(u.startsWith("https://api.github.com/") || u.startsWith("https://raw.githubusercontent.com/")).toBe(true);
    }
    expect(githubTreeUrl("acme", "tools", sha)).toBe(`https://api.github.com/repos/acme/tools/git/trees/${sha}?recursive=1`);
    expect(() => githubTreeUrl("evil.com/x", "tools", "main")).toThrow();
    expect(() => githubRawFileUrl("acme", "tools", "main", "../x")).toThrow();
    expect(encodePathSegments("a b/c")).toBe("a%20b/c");
  });

  it("RU16 isSafeRepoRelPath", () => {
    expect(isSafeRepoRelPath("agents/a.md")).toBe(true);
    for (const p of ["../a.md", "agents/../../x", "agents\\a.md", "a/\u0000.md", "", "/abs.md"]) {
      expect(isSafeRepoRelPath(p), p).toBe(false);
    }
  });

  it("RU17 ref name rules", () => {
    for (const r of ["main", "release-1.2", "v1.0.0", "feature/x", "user@fix"]) expect(isValidRefName(r), r).toBe(true);
    for (const r of ["foo.lock", "a..b", ".hidden", "ü", "a#b", "r".repeat(256)]) expect(isValidRefName(r), r).toBe(false);
  });

  it("RU18 longest segment-prefix wins", () => {
    expect(
      resolveRefFromCandidates(
        ["feature", "x", "docs"],
        [
          { name: "feature/x", kind: "branch" },
          { name: "feature", kind: "tag" },
          { name: "feature-y", kind: "branch" },
        ],
      ),
    ).toEqual({ ref: "feature/x", rootSegments: ["docs"] });
  });

  it("RU19 ties, none, too long", () => {
    expect(
      resolveRefFromCandidates(["v1", "docs"], [{ name: "v1", kind: "tag" }, { name: "v1", kind: "branch" }]),
    ).toEqual({ ref: "v1", rootSegments: ["docs"] });
    expect(resolveRefFromCandidates(["a"], [])).toBeNull();
    expect(resolveRefFromCandidates(["a"], [{ name: "a/b", kind: "branch" }])).toBeNull();
  });
});
