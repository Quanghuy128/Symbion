import { describe, expect, it, vi } from "vitest";
import { handlers, RpcError } from "../src/rpc/handlers.js";
import { fetchAuthorTemplatesFromGithub, type FetchLike } from "../src/templates/githubFetch.js";
import { AUTHOR_REGISTRY, type AuthorSource } from "@symbion/core";

const ctx = { port: 20128, version: "0.1.0" };

const ECC_AUTHOR = AUTHOR_REGISTRY.find((a) => a.id === "ecc") as Extract<AuthorSource, { kind: "github" }>;

/** Synthetic, clearly-fictional fixture content — NEVER real ECC body text
 *  (templates-authors testplan: "fixtures use synthetic frontmatter/body
 *  text only, even when modeling ECC's real structural shape"). */
const SYNTHETIC_AGENT = `---
name: example-agent
description: example agent description
tools: ["Read", "Grep"]
model: sonnet
---

Example agent body text.
`;

const SYNTHETIC_COMMAND = `---
description: example command description
---

Example command body text.
`;

const SYNTHETIC_SKILL = `---
name: example-skill
description: example skill description
---

Example skill body text.
`;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function textResponse(body: string, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "text/plain", ...(init.headers ?? {}) },
  });
}

/** Small synthetic tree: 2 agents, 1 command, 1 skill, plus 2 non-matching paths. */
const SMALL_TREE = [
  { path: "agents/a.md", type: "blob" },
  { path: "agents/b.md", type: "blob" },
  { path: "commands/c.md", type: "blob" },
  { path: "skills/d/SKILL.md", type: "blob" },
  { path: "docs/readme.md", type: "blob" },
  { path: ".claude/settings.json", type: "blob" },
];

function makeFetchMock(handlersMap: {
  tree?: () => Response | Promise<Response>;
  files?: Record<string, () => Response | Promise<Response>>;
}): FetchLike {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("api.github.com")) {
      if (!handlersMap.tree) throw new Error("unexpected tree fetch");
      return handlersMap.tree();
    }
    if (u.includes("raw.githubusercontent.com")) {
      const matchedKey = Object.keys(handlersMap.files ?? {}).find((k) => u.includes(k));
      if (!matchedKey) throw new Error(`unexpected file fetch: ${u}`);
      return handlersMap.files![matchedKey]!();
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as unknown as FetchLike;
}

describe("fetchAuthorTemplatesFromGithub (templates-authors)", () => {
  it("D10: valid tree + valid per-file content -> success, 4 items, all stamped with author identity", async () => {
    const fetchMock = makeFetchMock({
      tree: () => jsonResponse({ tree: SMALL_TREE, truncated: false }),
      files: {
        "agents/a.md": () => textResponse(SYNTHETIC_AGENT),
        "agents/b.md": () => textResponse(SYNTHETIC_AGENT),
        "commands/c.md": () => textResponse(SYNTHETIC_COMMAND),
        "skills/d/SKILL.md": () => textResponse(SYNTHETIC_SKILL),
      },
    });

    const outcome = await fetchAuthorTemplatesFromGithub(ECC_AUTHOR, fetchMock);
    expect(outcome.status).toBe("success");
    if (outcome.status !== "success") return;
    expect(outcome.items).toHaveLength(4);
    expect(outcome.skipped).toHaveLength(0);
    for (const item of outcome.items) {
      expect(item.authorId).toBe("ecc");
      expect(item.authorDisplayName).toBe("ECC");
      expect(item.authorRepoLabel).toBe("affaan-m/ecc");
    }
  });

  it("D13: tree fetch 404 -> outcome.kind 'not-found'", async () => {
    const fetchMock = makeFetchMock({ tree: () => textResponse("Not Found", { status: 404 }) });
    const outcome = await fetchAuthorTemplatesFromGithub(ECC_AUTHOR, fetchMock);
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.kind).toBe("not-found");
  });

  it("D14: tree fetch 403 + x-ratelimit-remaining:0 -> outcome.kind 'rate-limit', resetAt in ms", async () => {
    const resetSeconds = 1_900_000_000;
    const fetchMock = makeFetchMock({
      tree: () =>
        textResponse("rate limited", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetSeconds) },
        }),
    });
    const outcome = await fetchAuthorTemplatesFromGithub(ECC_AUTHOR, fetchMock);
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.kind).toBe("rate-limit");
    expect(outcome.resetAt).toBe(resetSeconds * 1000);
  });

  it("D15: tree fetch 403 WITHOUT rate-limit header -> outcome.kind 'network' (not falsely 'rate-limit')", async () => {
    const fetchMock = makeFetchMock({ tree: () => textResponse("forbidden", { status: 403 }) });
    const outcome = await fetchAuthorTemplatesFromGithub(ECC_AUTHOR, fetchMock);
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.kind).toBe("network");
  });

  it("D16: tree fetch throws (simulated network/DNS failure) -> outcome.kind 'network', no crash", async () => {
    const fetchMock: FetchLike = vi.fn(async () => {
      throw new Error("simulated DNS failure");
    }) as unknown as FetchLike;
    const outcome = await fetchAuthorTemplatesFromGithub(ECC_AUTHOR, fetchMock);
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.kind).toBe("network");
  });

  it("D17: tree fetch times out (exceeds the configured AbortController timeout) -> outcome.kind 'network', resolves (does not hang)", async () => {
    const neverRespondingFetch: FetchLike = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }) as unknown as FetchLike;
    // Use a short injectable timeout override (test-only) instead of waiting out
    // the real 10s production default — exercises the same AbortController path.
    const outcome = await fetchAuthorTemplatesFromGithub(ECC_AUTHOR, neverRespondingFetch, {
      treeTimeoutMs: 50,
    });
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.kind).toBe("network");
  });

  it("D18: one of N per-file fetches 500s -> that file skipped with reason, others still appear in items", async () => {
    const fetchMock = makeFetchMock({
      tree: () => jsonResponse({ tree: SMALL_TREE, truncated: false }),
      files: {
        "agents/a.md": () => textResponse(SYNTHETIC_AGENT),
        "agents/b.md": () => textResponse("Internal Server Error", { status: 500 }),
        "commands/c.md": () => textResponse(SYNTHETIC_COMMAND),
        "skills/d/SKILL.md": () => textResponse(SYNTHETIC_SKILL),
      },
    });
    const outcome = await fetchAuthorTemplatesFromGithub(ECC_AUTHOR, fetchMock);
    expect(outcome.status).toBe("success");
    if (outcome.status !== "success") return;
    expect(outcome.items).toHaveLength(3);
    expect(outcome.skipped).toHaveLength(1);
    expect(outcome.skipped[0]!.relPath).toBe("agents/b.md");
    expect(outcome.skipped[0]!.reason.length).toBeGreaterThan(0);
  });

  it("D19: tree succeeds, all per-file fetches succeed but ALL fail parseTemplateMarkdown -> success with items:[] (NOT an error outcome)", async () => {
    const fetchMock = makeFetchMock({
      tree: () => jsonResponse({ tree: SMALL_TREE, truncated: false }),
      files: {
        "agents/a.md": () => textResponse("not frontmatter at all"),
        "agents/b.md": () => textResponse("not frontmatter at all"),
        "commands/c.md": () => textResponse("not frontmatter at all"),
        "skills/d/SKILL.md": () => textResponse("not frontmatter at all"),
      },
    });
    const outcome = await fetchAuthorTemplatesFromGithub(ECC_AUTHOR, fetchMock);
    expect(outcome.status).toBe("success");
    if (outcome.status !== "success") return;
    expect(outcome.items).toHaveLength(0);
    expect(outcome.skipped).toHaveLength(4);
  });

  it("D20: tree response truncated:true -> does NOT throw/error, processes whatever entries are present", async () => {
    const fetchMock = makeFetchMock({
      tree: () => jsonResponse({ tree: SMALL_TREE, truncated: true }),
      files: {
        "agents/a.md": () => textResponse(SYNTHETIC_AGENT),
        "agents/b.md": () => textResponse(SYNTHETIC_AGENT),
        "commands/c.md": () => textResponse(SYNTHETIC_COMMAND),
        "skills/d/SKILL.md": () => textResponse(SYNTHETIC_SKILL),
      },
    });
    const outcome = await fetchAuthorTemplatesFromGithub(ECC_AUTHOR, fetchMock);
    expect(outcome.status).toBe("success");
    if (outcome.status !== "success") return;
    expect(outcome.items.length).toBeGreaterThan(0);
  });
});

describe("fetchAuthorTemplates RPC handler (templates-authors)", () => {
  it("D11: authorId not present in AUTHOR_REGISTRY -> throws RpcError('invalid-author'), no fetch attempted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      handlers.fetchAuthorTemplates({ authorId: "nonexistent" }, ctx)
    ).rejects.toThrow(RpcError);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("D12: authorId 'symbion' (kind:'bundled') -> throws RpcError('invalid-author')", async () => {
    await expect(handlers.fetchAuthorTemplates({ authorId: "symbion" }, ctx)).rejects.toThrow(RpcError);
  });

  it("D21: fetchAuthorTemplates is present in the daemon's read-only methods set", async () => {
    const serverSource = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../src/server.ts", import.meta.url), "utf-8")
    );
    // Mechanical check matching the daemon's own READ_ONLY_METHODS literal array.
    const setMatch = /READ_ONLY_METHODS = new Set<RpcMethod>\(\[([\s\S]*?)\]\)/.exec(serverSource);
    expect(setMatch).toBeTruthy();
    expect(setMatch![1]).toContain('"fetchAuthorTemplates"');
  });

  it("D22: hand-crafted extra fields (owner/repo) are ignored — only the registry-resolved owner/repo is used", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      expect(u).toContain("affaan-m/ecc");
      expect(u).not.toContain("attacker/evil");
      if (u.includes("api.github.com")) {
        return jsonResponse({ tree: [], truncated: false });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await handlers.fetchAuthorTemplates(
        { authorId: "ecc", owner: "attacker", repo: "evil" } as never,
        ctx
      );
      expect(result.outcome.status).toBe("success");
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
