/**
 * inspectSource.ts — `inspectTemplateSourceUrl`: parse a pasted GitHub link,
 * resolve the ref + commit, list the tree, detect template folders and mint a
 * single-use token (docs/loops/templates-repo-url-STATE.md PLAN §8.4/§8.8).
 *
 * This is the ONLY path where user-typed components reach the network, and
 * only AFTER parseGithubSourceUrl succeeded; everything downstream uses the
 * parser's validated output, never the raw `url` string.
 */
import {
  AUTHOR_REGISTRY,
  COMMIT_SHA_RE,
  defaultSourceDisplayName,
  detectTemplateFolders,
  findDuplicateSource,
  githubMatchingRefsUrl,
  isSafeRepoRelPath,
  isValidRefName,
  parseGithubSourceUrl,
  resolveRefFromCandidates,
  type UserTemplateSource,
} from "@symbion/core";
import { RpcError } from "../rpc/rpcError.js";
import type * as contract from "../rpc/contract.js";
import { fetchGithubTree, REPO_NOT_FOUND, resolveCommitSha } from "./githubFetch.js";
import { githubGet, type FetchLike, type GithubErrorOutcome } from "./githubHttp.js";
import type { InspectTokenStore } from "./inspectTokens.js";

const TIMEOUT_MS = 10_000;
const MAX_MATCHING_REFS_BYTES = 1024 * 1024;
const MAX_MATCHING_REFS = 2000;

export interface InspectDeps {
  fetchImpl: FetchLike;
  tokens: InspectTokenStore;
  /** lazily read AFTER the URL was accepted + the network inspection succeeded. */
  existing: () => UserTemplateSource[];
  timeoutMs?: number;
}

interface MatchingRef {
  name: string;
  sha: string;
  type: string;
}

async function listMatchingRefs(
  fetchImpl: FetchLike,
  owner: string,
  repo: string,
  kind: "heads" | "tags",
  prefix: string,
  timeoutMs: number
): Promise<{ ok: true; refs: MatchingRef[] } | { ok: false; outcome: GithubErrorOutcome }> {
  const r = await githubGet(fetchImpl, githubMatchingRefsUrl(owner, repo, kind, prefix), {
    timeoutMs,
    maxBytes: MAX_MATCHING_REFS_BYTES,
    notFoundMessage: REPO_NOT_FOUND(owner, repo),
  });
  if (r.kind === "error") return { ok: false, outcome: r.outcome };
  const bad: GithubErrorOutcome = { status: "error", kind: "network", message: "Invalid response from GitHub." };
  if (r.kind === "too-large") return { ok: false, outcome: bad };
  let json: unknown;
  try {
    json = JSON.parse(r.body);
  } catch {
    return { ok: false, outcome: bad };
  }
  if (!Array.isArray(json)) return { ok: false, outcome: bad };
  if (json.length > MAX_MATCHING_REFS) {
    return {
      ok: false,
      outcome: { status: "error", kind: "network", message: "Too many branches or tags match that name." },
    };
  }
  const strip = kind === "heads" ? "refs/heads/" : "refs/tags/";
  const refs: MatchingRef[] = [];
  for (const e of json) {
    const ref = (e as { ref?: unknown })?.ref;
    const obj = (e as { object?: { sha?: unknown; type?: unknown } })?.object;
    if (typeof ref !== "string" || !ref.startsWith(strip)) continue;
    refs.push({
      name: ref.slice(strip.length),
      sha: typeof obj?.sha === "string" ? obj.sha : "",
      type: typeof obj?.type === "string" ? obj.type : "",
    });
  }
  return { ok: true, refs };
}

export async function inspectGithubSourceUrl(
  url: unknown,
  deps: InspectDeps
): Promise<contract.InspectTemplateSourceUrlOutcome> {
  if (typeof url !== "string") throw new RpcError("invalid-url", "Paste a github.com repository or folder link.");
  const parsed = parseGithubSourceUrl(url);
  if (!parsed.ok) throw new RpcError("invalid-url", parsed.message);

  const { owner, repo, refSegments } = parsed;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const { fetchImpl } = deps;

  // ---- 1. resolve ref / rootPath / commit ---------------------------------
  let ref: string | null = null;
  let rootSegments: string[] = [];
  let commitSha: string | null = null;

  if (refSegments.length === 0) {
    ref = null;
  } else if (refSegments.length === 1) {
    ref = refSegments[0]!;
  } else if (COMMIT_SHA_RE.test(refSegments[0]!)) {
    ref = refSegments[0]!;
    rootSegments = refSegments.slice(1);
  } else {
    const first = refSegments[0]!;
    let resolved: { ref: string; rootSegments: string[] } | null = null;
    let headCommit: string | null = null;

    const heads = await listMatchingRefs(fetchImpl, owner, repo, "heads", first, timeoutMs);
    if (!heads.ok) return heads.outcome;
    resolved = resolveRefFromCandidates(
      refSegments,
      heads.refs.map((r) => ({ name: r.name, kind: "branch" as const }))
    );
    if (resolved) {
      const hit = heads.refs.find((r) => r.name === resolved!.ref);
      if (hit && hit.type === "commit" && COMMIT_SHA_RE.test(hit.sha)) headCommit = hit.sha;
    } else {
      const tags = await listMatchingRefs(fetchImpl, owner, repo, "tags", first, timeoutMs);
      if (!tags.ok) return tags.outcome;
      resolved = resolveRefFromCandidates(
        refSegments,
        tags.refs.map((r) => ({ name: r.name, kind: "tag" as const }))
      );
    }
    if (!resolved) {
      return { status: "error", kind: "not-found", message: `Branch or tag not found in ${owner}/${repo}.` };
    }
    if (!isValidRefName(resolved.ref)) {
      throw new RpcError("invalid-url", "The branch or tag name contains characters that are not supported.");
    }
    ref = resolved.ref;
    rootSegments = resolved.rootSegments;
    commitSha = headCommit;
  }

  const rootPath = rootSegments.join("/");
  if (rootPath !== "" && !isSafeRepoRelPath(rootPath)) {
    throw new RpcError("invalid-url", "The folder path is not valid.");
  }
  const refLabel = ref ?? "default branch";

  if (commitSha === null) {
    const c = await resolveCommitSha(fetchImpl, owner, repo, ref ?? "HEAD", timeoutMs);
    if (!c.ok) return c.outcome;
    commitSha = c.sha;
  }

  // ---- 2. tree + detection --------------------------------------------------
  const treeRes = await fetchGithubTree(fetchImpl, owner, repo, commitSha, timeoutMs, REPO_NOT_FOUND(owner, repo));
  if (!treeRes.ok) return treeRes.outcome;

  const detection = detectTemplateFolders(treeRes.tree, rootPath);
  if (!detection.rootExists) {
    return {
      status: "error",
      kind: "not-found",
      message: treeRes.truncated
        ? "Repository is too large to list completely; the folder may exist but could not be listed."
        : `Folder '${rootPath}' not found at ${refLabel}.`,
    };
  }

  const duplicateOf = findDuplicateSource({ owner, repo, ref, rootPath }, deps.existing(), AUTHOR_REGISTRY);

  const inspectToken = deps.tokens.mint({
    owner,
    repo,
    ref,
    rootPath,
    commitSha,
    rootDirPaths: detection.rootDirs.map((d) => d.path),
    detected: detection.detected.map((d) => ({ bucket: d.bucket, path: d.path })),
  });

  return {
    status: "success",
    inspectToken,
    owner,
    repo,
    ref,
    refLabel,
    rootPath,
    commitSha,
    truncated: treeRes.truncated,
    detected: detection.detected,
    rootDirs: detection.rootDirs,
    suggestedDisplayName: defaultSourceDisplayName(owner, repo, ref, rootPath),
    ...(duplicateOf ? { duplicateOf } : {}),
  };
}
