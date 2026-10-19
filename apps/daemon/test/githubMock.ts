import type { FetchLike } from "../src/templates/githubHttp.js";

export interface RecordedCall {
  url: string;
  redirect?: string;
  accept?: string;
}

export type Route = [match: string | RegExp, respond: (url: string) => Response | Promise<Response>];

/** Hermetic GitHub: records every request, answers from `routes` (first match wins). Unmatched => throws (a loud test failure). */
export function mockGithub(routes: Route[]): FetchLike & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, redirect: init?.redirect, accept: headers["Accept"] });
    for (const [m, respond] of routes) {
      if (typeof m === "string" ? url.includes(m) : m.test(url)) return respond(url);
    }
    throw new Error(`mockGithub: unexpected request ${url}`);
  }) as unknown as FetchLike & { calls: RecordedCall[] };
  fn.calls = calls;
  return fn;
}

export const json = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });

export const text = (body: string, init: { status?: number; headers?: Record<string, string> } = {}): Response =>
  new Response(body, { status: init.status ?? 200, headers: { "content-type": "text/plain", ...(init.headers ?? {}) } });

export const COMMIT = "c".repeat(40);
export const COMMIT2 = "e".repeat(40);
export const TREE_SHA = "d".repeat(40);

export const SYN_AGENT = `---\nname: syn-agent\ndescription: synthetic agent\ntools: ["Read", "Bash"]\n---\n\nSynthetic agent body.\n`;
export const SYN_COMMAND = `---\ndescription: synthetic command\nallowed-tools: Bash(git:*)\n---\n\nSynthetic command body.\n`;
export const SYN_SKILL = `---\nname: syn-skill\ndescription: synthetic skill\n---\n\nSynthetic skill body.\n`;

export const STD_TREE = [
  { path: "agents", type: "tree" },
  { path: "agents/a.md", type: "blob" },
  { path: "commands", type: "tree" },
  { path: "commands/c.md", type: "blob" },
  { path: "skills", type: "tree" },
  { path: "skills/s/SKILL.md", type: "blob" },
  { path: "docs", type: "tree" },
  { path: "docs/readme.md", type: "blob" },
];

/** Standard routes for acme/tools: commits/<anything> -> COMMIT, tree by COMMIT, raw files by COMMIT. */
export function standardRoutes(opts: { tree?: unknown[]; truncated?: boolean; commit?: string; files?: Record<string, string> } = {}): Route[] {
  const commit = opts.commit ?? COMMIT;
  const files = opts.files ?? {
    "agents/a.md": SYN_AGENT,
    "commands/c.md": SYN_COMMAND,
    "skills/s/SKILL.md": SYN_SKILL,
  };
  return [
    [/api\.github\.com\/repos\/[^/]+\/[^/]+\/commits\//, () => text(commit)],
    [
      /api\.github\.com\/repos\/[^/]+\/[^/]+\/git\/trees\//,
      () => json({ sha: TREE_SHA, tree: opts.tree ?? STD_TREE, truncated: opts.truncated ?? false }),
    ],
    [
      /raw\.githubusercontent\.com\//,
      (url) => {
        const hit = Object.keys(files).find((k) => url.endsWith(`/${commit}/${k.split("/").map(encodeURIComponent).join("/")}`));
        return hit ? text(files[hit]!) : text("nope", { status: 404 });
      },
    ],
  ];
}
