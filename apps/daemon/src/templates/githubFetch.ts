/**
 * githubFetch.ts — the GitHub tree-listing + bounded-concurrency per-file
 * content fetch + error-mapping layer backing the `fetchAuthorTemplates` RPC
 * (docs/loops/templates-authors-STATE.md PLAN §P2). Built on the same
 * `fetch()` + `AbortController` + try/catch error-mapping convention already
 * established by OllamaProvider (apps/daemon/src/llm/ollamaProvider.ts) — a
 * GitHub-specific sibling, not a generalized "any provider" abstraction.
 *
 * AC7 / PLAN §P8 finding #5: this module contains ZERO fs.writeFile /
 * fs.promises.writeFile / writeFileSync calls — fetched content is only ever
 * held in memory and returned to the caller.
 */
import {
  matchAuthorFolders,
  parseTemplateMarkdown,
  type AuthorSource,
  type GithubTreeEntry,
  type TemplateListItem,
} from "@symbion/core";

const TREE_FETCH_TIMEOUT_MS = 10_000;
const PER_FILE_FETCH_TIMEOUT_MS = 8_000;
const CONCURRENCY = 8;
/** Defensive ceiling per PLAN §P8 finding #2 — reject/skip any single file body over this size. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Cap on total candidates fetched per call — prevents unbounded memory on a very large or bloated repo. */
const MAX_CANDIDATES = 150;

export type GithubAuthorSource = Extract<AuthorSource, { kind: "github" }>;

export type FetchAuthorTemplatesOutcome =
  | { status: "success"; items: TemplateListItem[]; skipped: Array<{ relPath: string; reason: string }> }
  | { status: "error"; kind: "network" | "rate-limit" | "not-found"; message: string; resetAt?: number };

interface GithubTreeResponse {
  tree?: GithubTreeEntry[];
  truncated?: boolean;
  [key: string]: unknown;
}

/** Injectable fetch for tests (same pattern as OllamaProviderOptions.baseUrl) — defaults to global fetch. */
export type FetchLike = typeof fetch;

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number
): Promise<{ res: Response } | { errored: true; aborted: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    return { res };
  } catch {
    return { errored: true, aborted: controller.signal.aborted };
  } finally {
    clearTimeout(timer);
  }
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
 * GitHub-backed AuthorSource: tree listing -> matchAuthorFolders filter ->
 * bounded-concurrency per-file content fetch -> parseTemplateMarkdown
 * (unmodified, packages/core) -> TemplateListItem[] / skipped[].
 *
 * Never throws — every failure mode (tree-fetch network/404/403-rate-limit,
 * per-file fetch failure, parse failure, oversized file) resolves to a
 * well-formed FetchAuthorTemplatesOutcome (PLAN §P2 steps 2-6).
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

  const treeUrl = `https://api.github.com/repos/${author.owner}/${author.repo}/git/trees/${author.ref}?recursive=1`;

  const treeAttempt = await fetchWithTimeout(fetchImpl, treeUrl, treeTimeoutMs);
  if ("errored" in treeAttempt) {
    return { status: "error", kind: "network", message: "Không thể kết nối tới GitHub. Kiểm tra kết nối mạng rồi thử lại." };
  }
  const res = treeAttempt.res;

  if (res.status === 404) {
    return {
      status: "error",
      kind: "not-found",
      message: `Không tìm thấy repo ${author.owner}/${author.repo} (nhánh ${author.ref}) — có thể đã đổi tên hoặc chuyển sang riêng tư.`,
    };
  }

  if (res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      const resetHeader = res.headers.get("x-ratelimit-reset");
      const resetAt = resetHeader ? Number(resetHeader) * 1000 : undefined;
      return {
        status: "error",
        kind: "rate-limit",
        message: "Đã vượt giới hạn GitHub API (chế độ chưa xác thực, 60 lượt/giờ). Thử lại sau.",
        ...(resetAt !== undefined && Number.isFinite(resetAt) ? { resetAt } : {}),
      };
    }
    return { status: "error", kind: "network", message: "GitHub từ chối yêu cầu (403)." };
  }

  if (!res.ok) {
    return { status: "error", kind: "network", message: `GitHub trả về lỗi HTTP ${res.status}.` };
  }

  let json: GithubTreeResponse;
  try {
    json = (await res.json()) as GithubTreeResponse;
  } catch {
    return { status: "error", kind: "network", message: "Phản hồi không hợp lệ từ GitHub." };
  }

  if (!Array.isArray(json.tree)) {
    return { status: "error", kind: "network", message: "Phản hồi không hợp lệ từ GitHub." };
  }
  // truncated:true is defensively handled — proceed with the partial tree as-is
  // (PLAN §P2 step 2's last bullet) rather than erroring outright.

  const allCandidates = matchAuthorFolders(json.tree, author.folders);
  // Hard cap: if a repo has far more matching files than expected, slice to
  // MAX_CANDIDATES to bound memory and wall-clock time. The extra items are
  // reported as skipped so the UI can surface a warning rather than silently drop them.
  const candidates = allCandidates.slice(0, MAX_CANDIDATES);
  const cappedSkipped: Array<{ relPath: string; reason: string }> =
    allCandidates.length > MAX_CANDIDATES
      ? allCandidates.slice(MAX_CANDIDATES).map((c) => ({ relPath: c.relPath, reason: "Vượt giới hạn số tệp tối đa." }))
      : [];

  const items: TemplateListItem[] = [];
  const skipped: Array<{ relPath: string; reason: string }> = [];

  await runWithConcurrency(candidates, concurrency, async (candidate) => {
    const rawUrl = `https://raw.githubusercontent.com/${author.owner}/${author.repo}/${author.ref}/${candidate.relPath}`;
    const fileAttempt = await fetchWithTimeout(fetchImpl, rawUrl, perFileTimeoutMs);
    if ("errored" in fileAttempt) {
      skipped.push({ relPath: candidate.relPath, reason: "Lỗi mạng khi tải tệp." });
      return;
    }
    const fileRes = fileAttempt.res;
    if (!fileRes.ok) {
      skipped.push({ relPath: candidate.relPath, reason: `Không tải được nội dung tệp (HTTP ${fileRes.status}).` });
      return;
    }

    const contentLengthHeader = fileRes.headers.get("content-length");
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_FILE_BYTES) {
      skipped.push({ relPath: candidate.relPath, reason: "Tệp quá lớn, đã bỏ qua." });
      return;
    }

    let raw: string;
    try {
      raw = await fileRes.text();
    } catch {
      skipped.push({ relPath: candidate.relPath, reason: "Lỗi mạng khi tải tệp." });
      return;
    }
    if (raw.length > MAX_FILE_BYTES) {
      skipped.push({ relPath: candidate.relPath, reason: "Tệp quá lớn, đã bỏ qua." });
      return;
    }

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
    });
  });

  return { status: "success", items, skipped: [...cappedSkipped, ...skipped] };
}
