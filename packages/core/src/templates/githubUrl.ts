/**
 * githubUrl.ts — strict, hand-written GitHub link parser + URL-string builders
 * (docs/loops/templates-repo-url-STATE.md PLAN §8.2.4 / §8.4).
 *
 * Pure: no fs/net, and deliberately NO use of the WHATWG `URL` global (not
 * available to core's lib, and it silently normalises `\` -> `/`, strips
 * tab/newline and folds `%2e%2e` -> `..` — we want those REJECTED).
 *
 * Security: this is the ONLY place user-typed owner/repo/ref/path text is
 * turned into something that can reach the network. Every builder below
 * hard-codes `https://api.github.com` / `https://raw.githubusercontent.com`.
 */

/** The only hosts the daemon may ever fetch from. */
export const GITHUB_FETCH_HOSTS = ["api.github.com", "raw.githubusercontent.com"] as const;

export const GITHUB_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
export const GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
export const REF_SEGMENT_RE = /^[A-Za-z0-9_+@=,!-][A-Za-z0-9._+@=,!-]{0,254}$/;
export const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

const MAX_INPUT_LENGTH = 2048;
const MAX_SEGMENTS = 32;
const MAX_TOTAL_SEGMENT_CHARS = 1024;
const MAX_SEGMENT_LENGTH = 255;
const MAX_REL_PATH_LENGTH = 4096;

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x1f\x7f]/;

/** One path/ref segment is safe iff non-empty, not "."/"..", and free of "/", "\\" and control chars. */
export function isSafePathSegment(seg: string): boolean {
  if (typeof seg !== "string") return false;
  if (seg.length === 0 || seg.length > MAX_SEGMENT_LENGTH) return false;
  if (seg === "." || seg === "..") return false;
  if (seg.includes("/") || seg.includes("\\")) return false;
  if (CONTROL_RE.test(seg)) return false;
  return true;
}

/** A repo-relative file/folder path: "/"-separated, every segment safe, no leading "/", no empty segment. */
export function isSafeRepoRelPath(path: string): boolean {
  if (typeof path !== "string") return false;
  if (path.length === 0 || path.length > MAX_REL_PATH_LENGTH) return false;
  return path.split("/").every(isSafePathSegment);
}

/** Per-segment encodeURIComponent, "/" kept literal. Caller must have validated `path` first. */
export function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Ref name rule (§8.2.4 step 10): each "/" segment matches REF_SEGMENT_RE, no ".lock" suffix, no "..", ≤ 255. */
export function isValidRefName(ref: string): boolean {
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 255) return false;
  if (ref.includes("..")) return false;
  const segs = ref.split("/");
  return segs.every((s) => REF_SEGMENT_RE.test(s) && !s.endsWith(".lock"));
}

export type ParseGithubSourceUrlResult =
  | {
      ok: true;
      owner: string;
      repo: string;
      /** always null at parse time — the real ref is resolved by the daemon from `refSegments` (§8.4.2). */
      ref: null;
      /** decoded + validated segments after `/tree/`; [] = default branch. */
      refSegments: string[];
    }
  | { ok: false; message: string };

function fail(message: string): ParseGithubSourceUrlResult {
  return { ok: false, message };
}

/**
 * parseGithubSourceUrl — see PLAN §8.2.4 for the grammar. Never throws.
 * The ONLY scheme normalisation is accepting a bare `github.com/…`.
 */
export function parseGithubSourceUrl(input: string): ParseGithubSourceUrlResult {
  try {
    return parseInner(input);
  } catch {
    return fail("That link could not be read. Paste a github.com repository or folder link.");
  }
}

function parseInner(input: string): ParseGithubSourceUrlResult {
  if (typeof input !== "string") return fail("Paste a github.com repository or folder link.");
  let s = input.trim();
  if (s.length === 0) return fail("Paste a github.com repository or folder link.");
  if (s.length > MAX_INPUT_LENGTH) return fail("That link is too long.");
  if (s.includes("\\")) return fail("Backslashes are not allowed in the link.");
  if (/[\x00-\x20\x7f]/.test(s)) return fail("The link must not contain spaces or control characters.");

  // Scheme.
  const lower = s.toLowerCase();
  if (lower.startsWith("http://")) return fail("Use https:// (http is not allowed).");
  if (lower.startsWith("https://")) s = s.slice("https://".length);

  // Drop fragment, then query.
  const hash = s.indexOf("#");
  if (hash !== -1) s = s.slice(0, hash);
  const q = s.indexOf("?");
  if (q !== -1) s = s.slice(0, q);

  // Authority.
  const firstSlash = s.indexOf("/");
  const authority = firstSlash === -1 ? s : s.slice(0, firstSlash);
  const authorityLower = authority.toLowerCase();
  if (authorityLower !== "github.com" && authorityLower !== "www.github.com") {
    return fail("Only https://github.com links are supported.");
  }
  const pathPart = firstSlash === -1 ? "" : s.slice(firstSlash + 1);

  // Path segments: drop trailing empties only.
  const segs = pathPart.length === 0 ? [] : pathPart.split("/");
  while (segs.length > 0 && segs[segs.length - 1] === "") segs.pop();
  if (segs.some((x) => x === "")) return fail("The link contains an empty path segment ('//').");
  if (segs.length < 2) return fail("Paste a repository link, e.g. https://github.com/owner/repo.");

  const owner = segs[0]!;
  let repo = segs[1]!;
  if (!GITHUB_OWNER_RE.test(owner)) return fail("Owner name is not a valid GitHub user/org name.");
  if (segs.length === 2 && repo.endsWith(".git")) repo = repo.slice(0, -4);
  if (repo === "." || repo === ".." || !GITHUB_REPO_RE.test(repo)) {
    return fail("Repository name is not a valid GitHub repository name.");
  }

  if (segs.length === 2) return { ok: true, owner, repo, ref: null, refSegments: [] };

  const kind = segs[2]!;
  if (kind === "blob") {
    return fail(
      "Paste a repository or folder link (…/tree/<branch>/<folder>) — file (blob) links are not supported.",
    );
  }
  if (kind !== "tree") {
    return fail("Paste a repository link or a folder link (…/tree/<branch>/<folder>).");
  }
  if (segs.length < 4) return fail("The folder link has no branch or tag (…/tree/<branch>).");

  const rawRefSegs = segs.slice(3);
  if (rawRefSegs.length > MAX_SEGMENTS) return fail("The link has too many path segments.");
  const refSegments: string[] = [];
  let total = 0;
  for (const raw of rawRefSegs) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return fail("The link contains an invalid percent-encoding.");
    }
    if (decoded === "..") return fail("'..' is not allowed in the branch or folder.");
    if (decoded.includes("\\")) return fail("Backslashes are not allowed in the branch or folder.");
    if (decoded.includes("/")) return fail("An encoded '/' is not allowed inside a branch or folder segment.");
    if (CONTROL_RE.test(decoded)) return fail("Control characters are not allowed in the branch or folder.");
    if (!isSafePathSegment(decoded)) return fail("The branch or folder contains an unsupported segment.");
    total += decoded.length;
    if (total > MAX_TOTAL_SEGMENT_CHARS) return fail("The branch or folder path is too long.");
    refSegments.push(decoded);
  }
  // The first segment is always (the start of) the ref name, so it must pass the ref charset.
  const first = refSegments[0]!;
  if (!REF_SEGMENT_RE.test(first) || first.endsWith(".lock") || first.includes("..")) {
    return fail("The branch or tag name contains characters that are not supported.");
  }
  if (refSegments.length === 1 && !isValidRefName(first)) {
    return fail("The branch or tag name contains characters that are not supported.");
  }

  return { ok: true, owner, repo, ref: null, refSegments };
}

// --- URL builders (only ever produce the two allowed hosts) -----------------

function assertOwnerRepo(owner: string, repo: string): void {
  if (!GITHUB_OWNER_RE.test(owner) || !GITHUB_REPO_RE.test(repo) || repo === "." || repo === "..") {
    throw new Error("Invalid GitHub owner/repo.");
  }
}

function assertTreeish(treeish: string): void {
  if (!isSafeRepoRelPath(treeish)) throw new Error("Invalid ref.");
}

/** `GET /repos/{o}/{r}/commits/{ref}` (Accept: application/vnd.github.sha -> 40-hex commit sha). */
export function githubCommitShaUrl(owner: string, repo: string, ref: string): string {
  assertOwnerRepo(owner, repo);
  assertTreeish(ref);
  return `https://api.github.com/repos/${owner}/${repo}/commits/${encodePathSegments(ref)}`;
}

/** `GET /repos/{o}/{r}/git/trees/{treeish}?recursive=1` (treeish = branch/tag/commit sha). */
export function githubTreeUrl(owner: string, repo: string, treeish: string): string {
  assertOwnerRepo(owner, repo);
  assertTreeish(treeish);
  return `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodePathSegments(treeish)}?recursive=1`;
}

/** `GET /repos/{o}/{r}/git/matching-refs/{heads|tags}/{prefix}` */
export function githubMatchingRefsUrl(
  owner: string,
  repo: string,
  kind: "heads" | "tags",
  prefix: string,
): string {
  assertOwnerRepo(owner, repo);
  assertTreeish(prefix);
  if (kind !== "heads" && kind !== "tags") throw new Error("Invalid ref kind.");
  return `https://api.github.com/repos/${owner}/${repo}/git/matching-refs/${kind}/${encodePathSegments(prefix)}`;
}

/** `https://raw.githubusercontent.com/{o}/{r}/{treeish}/{relPath}` — relPath encoded per segment. */
export function githubRawFileUrl(owner: string, repo: string, treeish: string, relPath: string): string {
  assertOwnerRepo(owner, repo);
  assertTreeish(treeish);
  if (!isSafeRepoRelPath(relPath)) throw new Error("Invalid file path.");
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodePathSegments(treeish)}/${encodePathSegments(relPath)}`;
}

// --- Ref resolution ----------------------------------------------------------

/**
 * resolveRefFromCandidates — `tree/<a>/<b>/<c>` is ambiguous when branch names
 * contain "/". Given the URL segments and the ref names GitHub reports, keep
 * those whose "/"-split segments are an exact segment-prefix of `segments`
 * (string-only prefix hits such as `maint/x` for `ma` are discarded), pick the
 * longest, tie-break branch over tag (§8.4.2).
 */
export function resolveRefFromCandidates(
  segments: string[],
  refNames: Array<{ name: string; kind: "branch" | "tag" }>,
): { ref: string; rootSegments: string[] } | null {
  let best: { name: string; n: number; kind: "branch" | "tag" } | null = null;
  for (const cand of refNames) {
    const parts = cand.name.split("/");
    if (parts.length > segments.length) continue;
    if (!parts.every((p, i) => p === segments[i])) continue;
    if (
      best === null ||
      parts.length > best.n ||
      (parts.length === best.n && cand.kind === "branch" && best.kind === "tag")
    ) {
      best = { name: cand.name, n: parts.length, kind: cand.kind };
    }
  }
  if (!best) return null;
  return { ref: best.name, rootSegments: segments.slice(best.n) };
}
