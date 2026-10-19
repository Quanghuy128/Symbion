/**
 * githubHttp.ts — the ONLY place in the daemon that calls `fetch` for the
 * Templates feature (docs/loops/templates-repo-url-STATE.md PLAN §8.1/§8.2.3).
 *
 * Guarantees:
 *  - every request URL (and every redirect hop) is asserted to be https on
 *    api.github.com / raw.githubusercontent.com, no userinfo, no port;
 *  - `redirect: "manual"`: Node's fetch follows redirects to ANY host by
 *    default, so we follow only same-allowlist hops, at most 3. A redirect to
 *    any other host is never fetched;
 *  - response bodies are read through a byte-counting stream reader with a
 *    hard cap (content-length is a pre-check only — it can lie or be absent);
 *  - zero fs writes (fetched content is only ever held in memory).
 */
import { GITHUB_FETCH_HOSTS } from "@symbion/core";

/** Injectable fetch for tests — defaults to global fetch. */
export type FetchLike = typeof fetch;

export type GithubErrorKind = "network" | "rate-limit" | "not-found";
export interface GithubErrorOutcome {
  status: "error";
  kind: GithubErrorKind;
  message: string;
  resetAt?: number;
}

export type GithubGetResult =
  | { kind: "ok"; status: number; headers: Headers; body: string }
  | { kind: "too-large" }
  | {
      kind: "error";
      /** HTTP status when GitHub answered; null for transport failures/redirect refusals. */
      httpStatus: number | null;
      outcome: GithubErrorOutcome;
    };

export interface GithubGetOptions {
  timeoutMs: number;
  /** Accept header (e.g. application/vnd.github.sha). */
  accept?: string;
  /** hard cap on body BYTES. */
  maxBytes: number;
  /** message for 404 (and 422 unless `unprocessableMessage`). */
  notFoundMessage?: string;
  unprocessableMessage?: string;
}

const MAX_REDIRECT_HOPS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);

/** Programming guard — throws (never user-reachable: URLs come from the core builders). */
export function assertAllowedGithubUrl(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("githubHttp: only https is allowed.");
  if (!(GITHUB_FETCH_HOSTS as readonly string[]).includes(u.hostname)) {
    throw new Error(`githubHttp: host not allowed: ${u.hostname}`);
  }
  if (u.username || u.password || u.port) throw new Error("githubHttp: userinfo/port not allowed.");
  return u;
}

function isAllowedGithubUrl(url: string): boolean {
  try {
    assertAllowedGithubUrl(url);
    return true;
  } catch {
    return false;
  }
}

export function mapGithubError(res: Response, ctx: Pick<GithubGetOptions, "notFoundMessage" | "unprocessableMessage">): GithubErrorOutcome {
  const status = res.status;
  if (status === 404) {
    return { status: "error", kind: "not-found", message: ctx.notFoundMessage ?? "Not found." };
  }
  if (status === 422) {
    return {
      status: "error",
      kind: "not-found",
      message: ctx.unprocessableMessage ?? ctx.notFoundMessage ?? "Not found.",
    };
  }
  const retryAfter = res.headers.get("retry-after");
  if (status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    const resetHeader = res.headers.get("x-ratelimit-reset");
    const resetAt = resetHeader ? Number(resetHeader) * 1000 : undefined;
    return {
      status: "error",
      kind: "rate-limit",
      message: "GitHub API rate limit exceeded (unauthenticated mode, 60 requests/hour). Try again later.",
      ...(resetAt !== undefined && Number.isFinite(resetAt) ? { resetAt } : {}),
    };
  }
  if (status === 429 || (status === 403 && retryAfter !== null)) {
    const secs = retryAfter !== null ? Number(retryAfter) : NaN;
    let resetAt: number | undefined;
    if (Number.isFinite(secs) && secs >= 0) resetAt = Date.now() + secs * 1000;
    else {
      const resetHeader = res.headers.get("x-ratelimit-reset");
      const r = resetHeader ? Number(resetHeader) * 1000 : NaN;
      if (Number.isFinite(r)) resetAt = r;
    }
    return {
      status: "error",
      kind: "rate-limit",
      message: "GitHub is rate-limiting requests. Try again later.",
      ...(resetAt !== undefined ? { resetAt } : {}),
    };
  }
  if (status === 403) return { status: "error", kind: "network", message: "GitHub rejected the request (403)." };
  return { status: "error", kind: "network", message: `GitHub returned HTTP error ${status}.` };
}

function networkError(message: string): GithubGetResult {
  return { kind: "error", httpStatus: null, outcome: { status: "error", kind: "network", message } };
}

async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* ignore */
  }
}

export async function githubGet(fetchImpl: FetchLike, url: string, opts: GithubGetOptions): Promise<GithubGetResult> {
  assertAllowedGithubUrl(url); // throws on programmer error
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const CONNECT_MSG = "Cannot connect to GitHub. Check your network connection and try again.";
  try {
    let current = url;
    let hops = 0;
    for (;;) {
      let res: Response;
      try {
        res = await fetchImpl(current, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            ...(opts.accept ? { Accept: opts.accept } : {}),
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "symbion",
          },
        });
      } catch {
        return networkError(CONNECT_MSG);
      }

      if (REDIRECT_STATUSES.has(res.status)) {
        const loc = res.headers.get("location");
        await discard(res);
        if (!loc || hops >= MAX_REDIRECT_HOPS) return networkError("GitHub redirected too many times.");
        let next: string;
        try {
          next = new URL(loc, current).toString();
        } catch {
          return networkError("GitHub redirected to an unexpected host.");
        }
        if (!isAllowedGithubUrl(next)) return networkError("GitHub redirected to an unexpected host.");
        hops++;
        current = next;
        continue;
      }

      if (!res.ok) {
        await discard(res);
        return { kind: "error", httpStatus: res.status, outcome: mapGithubError(res, opts) };
      }

      const cl = res.headers.get("content-length");
      if (cl !== null && Number(cl) > opts.maxBytes) {
        await discard(res);
        return { kind: "too-large" };
      }

      const reader = res.body?.getReader();
      if (!reader) return { kind: "ok", status: res.status, headers: res.headers, body: "" };
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > opts.maxBytes) {
            try {
              await reader.cancel();
            } catch {
              /* ignore */
            }
            return { kind: "too-large" };
          }
          chunks.push(value);
        }
      } catch {
        return networkError(CONNECT_MSG);
      }
      const buf = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        buf.set(c, off);
        off += c.byteLength;
      }
      return { kind: "ok", status: res.status, headers: res.headers, body: new TextDecoder("utf-8").decode(buf) };
    }
  } finally {
    clearTimeout(timer);
  }
}
