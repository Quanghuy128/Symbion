/**
 * githubFetch.ts — the GitHub tree-listing + bounded-concurrency per-file
 * content fetch + error-mapping layer backing the `fetchAuthorTemplates` RPC
 * (docs/loops/templates-authors-STATE.md PLAN §P2; generalised to user-added
 * sources by docs/loops/templates-repo-url-STATE.md PLAN §8).
 *
 * ALL network access goes through githubHttp.githubGet (host allowlist,
 * manual redirects, streamed byte caps). URLs are built ONLY by the pure core
 * builders from the resolved AuthorSource fields — never from client input.
 *
 * AC7 / PLAN §P8 finding #5: this module contains ZERO fs write calls —
 * fetched content is only ever held in memory and returned to the caller.
 */
import {
  COMMIT_SHA_RE,
  githubCommitShaUrl,
  githubRawFileUrl,
  githubTreeUrl,
  isSafeRepoRelPath,
  matchAuthorFolders,
  parseTemplateMarkdown,
  toRepoRelativeFolders,
  type GithubAuthorSource,
  type GithubTreeEntry,
  type TemplateListItem,
} from "@symbion/core";
import { githubGet, type FetchLike, type GithubErrorOutcome } from "./githubHttp.js";

export type { GithubAuthorSource };
export type { FetchLike };

const TREE_FETCH_TIMEOUT_MS = 10_000;
const PER_FILE_FETCH_TIMEOUT_MS = 8_000;
const CONCURRENCY = 8;
/** Defensive ceiling per PLAN §P8 finding #2 — now enforced on streamed BYTES. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Tree JSON cap (PLAN §8.2.3 #7). */
const MAX_TREE_BYTES = 16 * 1024 * 1024;
const MAX_COMMIT_SHA_BYTES = 64;
/** Cap on total candidates fetched per call — prevents unbounded memory on a very large or bloated repo. */
const MAX_CANDIDATES = 150;

export type FetchAuthorTemplatesOutcome =
  | {
      status: "success";
      items: TemplateListItem[];
      skipped: Array<{ relPath: string; reason: string }>;
      commitSha?: string;
      refLabel?: string;
      truncated?: boolean;
    }
  | GithubErrorOutcome;

interface GithubTreeResponse {
  tree?: GithubTreeEntry[];
  truncated?: boolean;
  [key: string]: unknown;
}

export const REPO_NOT_FOUND = (owner: string, repo: string): string =>
  `Repository ${owner}/${repo} not found, or it is private (only public repos are supported).`;

/**
 * resolveCommitSha — `GET commits/{ref}` with the sha media type -> the 40-hex
 * COMMIT sha (the tree response's own `sha` is a TREE sha — PLAN F1).
 */
export async function resolveCommitSha(
  fetchImpl: FetchLike,
  owner: string,
  repo: string,
  ref: string,
  timeoutMs: number = TREE_FETCH_TIMEOUT_MS
): Promise<{ ok: true; sha: string } | { ok: false; outcome: GithubErrorOutcome }> {
  const r = await githubGet(fetchImpl, githubCommitShaUrl(owner, repo, ref), {
    timeoutMs,
    accept: "application/vnd.github.sha",
    maxBytes: MAX_COMMIT_SHA_BYTES,
    notFoundMessage: REPO_NOT_FOUND(owner, repo),
    unprocessableMessage: `Branch or tag '${ref}' not found.`,
  });
  if (r.kind === "error") return { ok: false, outcome: r.outcome };
  const sha = r.kind === "ok" ? r.body.trim() : "";
  if (!COMMIT_SHA_RE.test(sha)) {
    return { ok: false, outcome: { status: "error", kind: "network", message: "Invalid response from GitHub." } };
  }
  return { ok: true, sha };
}

/** fetchTree — recursive tree listing for a branch/tag/commit sha. */
export async function fetchGithubTree(
  fetchImpl: FetchLike,
  owner: string,
  repo: string,
  treeish: string,
  timeoutMs: number,
  notFoundMessage: string
): Promise<{ ok: true; tree: GithubTreeEntry[]; truncated: boolean } | { ok: false; outcome: GithubErrorOutcome }> {
  const r = await githubGet(fetchImpl, githubTreeUrl(owner, repo, treeish), {
    timeoutMs,
    maxBytes: MAX_TREE_BYTES,
    notFoundMessage,
  });
  if (r.kind === "error") return { ok: false, outcome: r.outcome };
  if (r.kind === "too-large") {
    return { ok: false, outcome: { status: "error", kind: "network", message: "The repository listing is too large." } };
  }
  let json: GithubTreeResponse;
  try {
    json = JSON.parse(r.body) as GithubTreeResponse;
  } catch {
    return { ok: false, outcome: { status: "error", kind: "network", message: "Invalid response from GitHub." } };
  }
  if (!json || !Array.isArray(json.tree)) {
    return { ok: false, outcome: { status: "error", kind: "network", message: "Invalid response from GitHub." } };
  }
  // truncated:true is handled by proceeding with the partial tree (PLAN §P2 step 2).
  return { ok: true, tree: json.tree, truncated: json.truncated === true };
}

/**
 * runWithConcurrency — a small bounded-concurrency worker pool. Runs `task`
 * for every item in `items`, never more than `limit` in flight at once.
 * Results are returned in the same order as `items`. A single task's
 * rejection does NOT abort the others (each `task` is expected to catch its
 * own errors and return a value, not throw — see callers below).
 */
async function runWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await task(items[index] as T);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * fetchAuthorTemplatesFromGithub — the full fetch pipeline for one
 * GitHub-backed AuthorSource: [commit resolution for user sources] -> tree
 * listing -> matchAuthorFolders filter -> bounded-concurrency per-file
 * content fetch -> parseTemplateMarkdown (unmodified, packages/core) ->
 * TemplateListItem[] / skipped[].
 *
 * User sources (origin "user") are fetched by COMMIT SHA end to end (one
 * consistent snapshot, no raw-CDN branch staleness); builtin ECC keeps its
 * by-ref path (1 API call, unchanged).
 *
 * Never throws for external failures — every failure mode resolves to a
 * well-formed FetchAuthorTemplatesOutcome.
 */
export interface FetchAuthorTemplatesOptions {
  /** injectable for tests only — defaults to the real 10s/8s/8 production values. */
  treeTimeoutMs?: number;
  perFileTimeoutMs?: number;
  concurrency?: number;
}

export async function fetchAuthorTemplatesFromGithub(
  author: GithubAuthorSource,
  fetchImpl: FetchLike = fetch,
  options: FetchAuthorTemplatesOptions = {}
): Promise<FetchAuthorTemplatesOutcome> {
  const treeTimeoutMs = options.treeTimeoutMs ?? TREE_FETCH_TIMEOUT_MS;
  const perFileTimeoutMs = options.perFileTimeoutMs ?? PER_FILE_FETCH_TIMEOUT_MS;
  const concurrency = options.concurrency ?? CONCURRENCY;

  const isUser = author.origin === "user";
  let treeish = author.ref;
  let commitSha: string | undefined;
  let refLabel: string | undefined;
  if (isUser) {
    const commit = await resolveCommitSha(fetchImpl, author.owner, author.repo, author.ref, treeTimeoutMs);
    if (!commit.ok) return commit.outcome;
    commitSha = commit.sha;
    treeish = commit.sha;
    refLabel = author.ref === "HEAD" ? "default branch" : author.ref;
  }

  const treeRes = await fetchGithubTree(
    fetchImpl,
    author.owner,
    author.repo,
    treeish,
    treeTimeoutMs,
    isUser
      ? REPO_NOT_FOUND(author.owner, author.repo)
      : `Repo ${author.owner}/${author.repo} (branch ${author.ref}) not found — it may have been renamed or made private.`
  );
  if (!treeRes.ok) return treeRes.outcome;

  const allMatches = matchAuthorFolders(treeRes.tree, toRepoRelativeFolders(author.rootPath, author.folders));
  // Defence in depth against a malicious tree: never build a URL from an unsafe path.
  const unsafeSkipped: Array<{ relPath: string; reason: string }> = [];
  const allCandidates = allMatches.filter((c) => {
    if (isSafeRepoRelPath(c.relPath)) return true;
    unsafeSkipped.push({ relPath: c.relPath, reason: "Unsafe path" });
    return false;
  });
  // Hard cap: if a repo has far more matching files than expected, slice to
  // MAX_CANDIDATES to bound memory and wall-clock time. The extra items are
  // reported as skipped so the UI can surface a warning rather than silently drop them.
  const candidates = allCandidates.slice(0, MAX_CANDIDATES);
  const cappedSkipped: Array<{ relPath: string; reason: string }> =
    allCandidates.length > MAX_CANDIDATES
      ? allCandidates.slice(MAX_CANDIDATES).map((c) => ({ relPath: c.relPath, reason: "Exceeded the maximum number of files." }))
      : [];

  const items: TemplateListItem[] = [];
  const skipped: Array<{ relPath: string; reason: string }> = [];

  await runWithConcurrency(candidates, concurrency, async (candidate) => {
    const rawUrl = githubRawFileUrl(author.owner, author.repo, treeish, candidate.relPath);
    const file = await githubGet(fetchImpl, rawUrl, { timeoutMs: perFileTimeoutMs, maxBytes: MAX_FILE_BYTES });
    if (file.kind === "too-large") {
      skipped.push({ relPath: candidate.relPath, reason: "File too large, skipped." });
      return;
    }
    if (file.kind === "error") {
      if (file.httpStatus === null) {
        skipped.push({ relPath: candidate.relPath, reason: "Network error while downloading the file." });
      } else if (file.httpStatus === 429) {
        skipped.push({ relPath: candidate.relPath, reason: "GitHub is rate-limiting file downloads (HTTP 429)." });
      } else {
        skipped.push({ relPath: candidate.relPath, reason: `Could not download file content (HTTP ${file.httpStatus}).` });
      }
      return;
    }

    const raw = file.body.replace(/\r\n/g, "\n");
    const parsed = parseTemplateMarkdown(raw, candidate.bucket);
    if (!parsed.ok) {
      skipped.push({ relPath: candidate.relPath, reason: parsed.reason });
      return;
    }

    // For "*/SKILL.md" paths the meaningful name is the parent folder slug
    // (e.g. "accessibility" from "skills/accessibility/SKILL.md"), not the
    // fixed filename "SKILL". For all other "*.md" paths, the filename stem is correct.
    const pathParts = candidate.relPath.split("/");
    const filenameStem = pathParts.at(-1)?.replace(/\.md$/, "") ?? "";
    const folderSlug = filenameStem === "SKILL" ? (pathParts.at(-2) ?? filenameStem) : filenameStem;
    const name = parsed.parsed.name ?? folderSlug ?? candidate.relPath;
    items.push({
      id: `${author.id}:${candidate.relPath}`,
      kind: parsed.parsed.kind,
      name,
      description: parsed.parsed.description,
      tools: parsed.parsed.tools,
      raw,
      authorId: author.id,
      authorDisplayName: author.displayName,
      authorRepoLabel: author.repoLabel,
      authorOrigin: author.origin,
    });
  });

  return {
    status: "success",
    items,
    skipped: [...unsafeSkipped, ...cappedSkipped, ...skipped],
    ...(commitSha !== undefined ? { commitSha } : {}),
    ...(refLabel !== undefined ? { refLabel } : {}),
    truncated: treeRes.truncated,
  };
}
