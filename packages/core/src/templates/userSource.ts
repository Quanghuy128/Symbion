import type { GithubAuthorSource, AuthorSource, TemplateBucket } from "./authorSource.js";
import {
  GITHUB_OWNER_RE,
  GITHUB_REPO_RE,
  isSafeRepoRelPath,
  isValidRefName,
} from "./githubUrl.js";

/**
 * userSource.ts — the persisted shape + validation of user-added template
 * sources (docs/loops/templates-repo-url-STATE.md PLAN §8.3). Pure.
 *
 * Stored in the user-level config as `templateSources: UserTemplateSource[]`.
 * The stored array is UNTRUSTED on read (hand-editable file): every entry is
 * re-validated here before it may be used to build a URL.
 */

export const USER_SOURCE_ID_RE = /^u-[0-9a-f]{10}$/;
export const MAX_USER_TEMPLATE_SOURCES = 20;
export const MAX_DISPLAY_NAME_LENGTH = 60;

export interface SourceFolder {
  bucket: TemplateBucket;
  /** root-relative folder path; "." = the root itself. */
  path: string;
}

export interface UserTemplateSource {
  id: string;
  displayName: string;
  owner: string;
  repo: string;
  /** null => follow the default branch (fetched via "HEAD"). */
  ref: string | null;
  /** "" or a validated "a/b". */
  rootPath: string;
  folders: SourceFolder[];
  addedAt: string;
}

const BUCKETS: readonly TemplateBucket[] = ["agent", "command", "skill"];
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x1f\x7f]/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

/** The file pattern is ALWAYS derived from the bucket — never client/config chosen. */
export function folderPatternForBucket(bucket: TemplateBucket): "*.md" | "*/SKILL.md" {
  return bucket === "skill" ? "*/SKILL.md" : "*.md";
}

export function isTemplateBucket(x: unknown): x is TemplateBucket {
  return typeof x === "string" && (BUCKETS as readonly string[]).includes(x);
}

export type DisplayNameResult = { ok: true; value: string } | { ok: false; reason: string };

export function validateSourceDisplayName(s: unknown): DisplayNameResult {
  if (typeof s !== "string") return { ok: false, reason: "Display name must be text." };
  const t = s.trim();
  if (t.length < 1 || t.length > MAX_DISPLAY_NAME_LENGTH) {
    return { ok: false, reason: `Display name must be 1-${MAX_DISPLAY_NAME_LENGTH} characters.` };
  }
  if (CONTROL_RE.test(t)) return { ok: false, reason: "Display name must not contain control characters." };
  return { ok: true, value: t };
}

export function defaultSourceDisplayName(
  owner: string,
  repo: string,
  ref: string | null,
  rootPath: string,
): string {
  let name = `${owner}/${repo}`;
  if (rootPath) name += `/${rootPath}`;
  if (ref) name += ` @${ref}`;
  return name.length > MAX_DISPLAY_NAME_LENGTH ? name.slice(0, MAX_DISPLAY_NAME_LENGTH) : name;
}

export type ValidateFoldersResult = { ok: true; folders: SourceFolder[] } | { ok: false; reason: string };

/** Shared by validateUserTemplateSource and the daemon's addTemplateSource. */
export function validateSourceFolders(x: unknown): ValidateFoldersResult {
  if (!Array.isArray(x)) return { ok: false, reason: "folders must be an array." };
  if (x.length < 1 || x.length > BUCKETS.length) return { ok: false, reason: "folders must have 1-3 entries." };
  const out: SourceFolder[] = [];
  const seen = new Set<string>();
  for (const f of x) {
    if (typeof f !== "object" || f === null) return { ok: false, reason: "Invalid folder entry." };
    const { bucket, path } = f as Record<string, unknown>;
    if (!isTemplateBucket(bucket)) return { ok: false, reason: "Unknown bucket." };
    if (seen.has(bucket)) return { ok: false, reason: "Only one folder per bucket is allowed." };
    seen.add(bucket);
    if (typeof path !== "string" || (path !== "." && !isSafeRepoRelPath(path))) {
      return { ok: false, reason: "Invalid folder path." };
    }
    out.push({ bucket, path });
  }
  return { ok: true, folders: out };
}

export type ValidateUserSourceResult =
  | { ok: true; source: UserTemplateSource }
  | { ok: false; reason: string };

/** Strict re-validation of one stored entry. Returns a NORMALISED copy (unknown keys dropped). */
export function validateUserTemplateSource(x: unknown): ValidateUserSourceResult {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return { ok: false, reason: "Not an object." };
  const o = x as Record<string, unknown>;

  if (typeof o["id"] !== "string" || !USER_SOURCE_ID_RE.test(o["id"])) return { ok: false, reason: "Bad id." };
  if (typeof o["owner"] !== "string" || !GITHUB_OWNER_RE.test(o["owner"])) return { ok: false, reason: "Bad owner." };
  const repo = o["repo"];
  if (typeof repo !== "string" || repo === "." || repo === ".." || !GITHUB_REPO_RE.test(repo)) {
    return { ok: false, reason: "Bad repo." };
  }
  const ref = o["ref"];
  if (ref !== null && (typeof ref !== "string" || !isValidRefName(ref))) return { ok: false, reason: "Bad ref." };
  const rootPath = o["rootPath"];
  if (typeof rootPath !== "string" || (rootPath !== "" && !isSafeRepoRelPath(rootPath))) {
    return { ok: false, reason: "Bad rootPath." };
  }
  const nameRes = validateSourceDisplayName(o["displayName"]);
  if (!nameRes.ok) return { ok: false, reason: nameRes.reason };
  const folders = validateSourceFolders(o["folders"]);
  if (!folders.ok) return { ok: false, reason: folders.reason };
  const addedAt = o["addedAt"];
  if (typeof addedAt !== "string" || !ISO_RE.test(addedAt) || Number.isNaN(Date.parse(addedAt))) {
    return { ok: false, reason: "Bad addedAt." };
  }

  return {
    ok: true,
    source: {
      id: o["id"],
      displayName: nameRes.value,
      owner: o["owner"],
      repo,
      ref: ref === null ? null : (ref as string),
      rootPath,
      folders: folders.folders,
      addedAt,
    },
  };
}

/** Read-time normalisation of `config.templateSources` (the "migration"): absent/non-array -> empty. */
export function parseStoredTemplateSources(raw: unknown): { valid: UserTemplateSource[]; invalidCount: number } {
  if (!Array.isArray(raw)) return { valid: [], invalidCount: 0 };
  const valid: UserTemplateSource[] = [];
  let invalidCount = 0;
  for (const entry of raw) {
    const r = validateUserTemplateSource(entry);
    if (r.ok) valid.push(r.source);
    else invalidCount++;
  }
  return { valid, invalidCount };
}

export function userSourceDedupeKey(s: { owner: string; repo: string; ref: string | null; rootPath: string }): string {
  return `${s.owner.toLowerCase()}/${s.repo.toLowerCase()}@${s.ref ?? "HEAD"}#${s.rootPath}`;
}

/** Duplicate of an already-saved user source, or of a built-in github source (e.g. ECC). */
export function findDuplicateSource(
  candidate: { owner: string; repo: string; ref: string | null; rootPath: string },
  users: UserTemplateSource[],
  builtins: AuthorSource[],
): { id: string; displayName: string } | null {
  const key = userSourceDedupeKey(candidate);
  for (const u of users) {
    if (userSourceDedupeKey(u) === key) return { id: u.id, displayName: u.displayName };
  }
  for (const b of builtins) {
    if (b.kind !== "github") continue;
    if (
      b.owner.toLowerCase() === candidate.owner.toLowerCase() &&
      b.repo.toLowerCase() === candidate.repo.toLowerCase() &&
      candidate.rootPath === b.rootPath &&
      (candidate.ref === null || candidate.ref === b.ref)
    ) {
      return { id: b.id, displayName: b.displayName };
    }
  }
  return null;
}

export function userSourceToAuthorSource(s: UserTemplateSource): GithubAuthorSource {
  return {
    id: s.id,
    displayName: s.displayName,
    kind: "github",
    owner: s.owner,
    repo: s.repo,
    ref: s.ref ?? "HEAD",
    folders: s.folders.map((f) => ({ bucket: f.bucket, path: f.path, filePattern: folderPatternForBucket(f.bucket) })),
    repoLabel: `${s.owner}/${s.repo}`,
    origin: "user",
    rootPath: s.rootPath,
  };
}
