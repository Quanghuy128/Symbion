import { describe, expect, it, vi } from "vitest";
import { githubGet } from "../src/templates/githubHttp.js";
import { json, mockGithub, text } from "./githubMock.js";

const OPTS = { timeoutMs: 2000, maxBytes: 2 * 1024 * 1024 };
const U = "https://api.github.com/repos/a/b/commits/HEAD";

describe("githubHttp (D-H*)", () => {
  it("D-H1 every request uses redirect:manual", async () => {
    const f = mockGithub([["api.github.com", () => text("x")]]);
    await githubGet(f, U, OPTS);
    expect(f.calls.every((c) => c.redirect === "manual")).toBe(true);
  });

  it("D-H2 same-host 301 is followed", async () => {
    const f = mockGithub([
      ["/repos/a/b/commits/HEAD", () => new Response(null, { status: 301, headers: { location: "https://api.github.com/repositories/1/commits/HEAD" } })],
      ["/repositories/1/commits/HEAD", () => text("ok")],
    ]);
    const r = await githubGet(f, U, OPTS);
    expect(r.kind).toBe("ok");
    expect(f.calls).toHaveLength(2);
  });

  it("D-H3 off-host / downgrade / port redirects are never fetched", async () => {
    for (const loc of ["https://evil.example/x", "http://api.github.com/x", "https://api.github.com:444/x", "https://user@api.github.com/x"]) {
      const f = mockGithub([["api.github.com/repos", () => new Response(null, { status: 302, headers: { location: loc } })]]);
      const r = await githubGet(f, U, OPTS);
      expect(r.kind).toBe("error");
      if (r.kind === "error") expect(r.outcome.kind).toBe("network");
      expect(f.calls).toHaveLength(1);
      expect(f.calls.some((c) => c.url.includes("evil.example"))).toBe(false);
    }
  });

  it("D-H4 redirect loop stops after 3 followed hops (4 requests)", async () => {
    const f = mockGithub([["api.github.com", () => new Response(null, { status: 307, headers: { location: U } })]]);
    const r = await githubGet(f, U, OPTS);
    expect(r.kind).toBe("error");
    expect(f.calls).toHaveLength(4);
  });

  it("D-H5 direct call with a disallowed URL throws", async () => {
    const f = mockGithub([]);
    await expect(githubGet(f, "https://example.com/x", OPTS)).rejects.toThrow();
    await expect(githubGet(f, "http://api.github.com/x", OPTS)).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });

  it("D-H6 byte cap counts bytes, cancels the reader, ignores missing content-length", async () => {
    const cancel = vi.fn();
    const big = new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel,
      })
    );
    const f = mockGithub([["api.github.com", () => big]]);
    const r = await githubGet(f, U, OPTS);
    expect(r.kind).toBe("too-large");
    expect(cancel).toHaveBeenCalled();

    const multi = mockGithub([["api.github.com", () => text("é".repeat(1_500_000))]]);
    expect((await githubGet(multi, U, OPTS)).kind).toBe("too-large");

    const small = mockGithub([["api.github.com", () => text("é".repeat(1000))]]);
    const ok = await githubGet(small, U, OPTS);
    expect(ok.kind === "ok" && ok.body).toBe("é".repeat(1000));
  });

  it("D-H7 status mapping", async () => {
    const run = async (res: () => Response) => {
      const r = await githubGet(mockGithub([["api.github.com", res]]), U, { ...OPTS, notFoundMessage: "nf", unprocessableMessage: "ref" });
      if (r.kind !== "error") throw new Error("expected error");
      return r.outcome;
    };
    expect(await run(() => text("", { status: 404 }))).toMatchObject({ kind: "not-found", message: "nf" });
    expect(await run(() => text("", { status: 422 }))).toMatchObject({ kind: "not-found", message: "ref" });
    expect(await run(() => text("", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1900000000" } }))).toMatchObject({
      kind: "rate-limit",
      resetAt: 1_900_000_000_000,
    });
    const before = Date.now();
    const o = await run(() => text("", { status: 429, headers: { "retry-after": "30" } }));
    expect(o.kind).toBe("rate-limit");
    expect(o.resetAt!).toBeGreaterThanOrEqual(before + 29_000);
    expect(o.resetAt!).toBeLessThan(before + 40_000);
    expect((await run(() => text("", { status: 403 }))).kind).toBe("network");
    expect((await run(() => text("", { status: 500 }))).kind).toBe("network");

    const throwing = async () => {
      throw new Error("dns");
    };
    const r1 = await githubGet(throwing as never, U, OPTS);
    expect(r1.kind === "error" && r1.outcome.kind).toBe("network");

    const hang = (async (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("abort"))))) as never;
    const r2 = await githubGet(hang, U, { ...OPTS, timeoutMs: 30 });
    expect(r2.kind === "error" && r2.outcome.kind).toBe("network");
    void json;
  });
});
