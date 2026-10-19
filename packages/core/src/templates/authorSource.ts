import type { TemplateKind } from "./parseTemplate.js";

/**
 * authorSource.ts — the AuthorSource/AUTHOR_REGISTRY abstraction
 * (docs/loops/templates-authors-STATE.md PLAN §P1). Pure data, zero fs/net —
 * lives in packages/core so both apps/web (renders the Authors sub-nav
 * labels) and apps/daemon (the fetchAuthorTemplates RPC handler) import the
 * exact same registry, with no hand-duplication / drift risk.
 *
 * THINK #2 (templates-authors-STATE.md): AUTHOR_REGISTRY stays a short,
 * manually-reviewed, hardcoded list. templates-repo-url REVERSED the "no
 * self-service" part: user-added GitHub sources now exist, but they live in
 * the user-level config (`templateSources`, see userSource.ts) — NEVER in this
 * registry — and are marked `origin: "user"` ("Unverified" in the UI).
 */

/** Re-export under a more domain-specific name for this file's call sites —
 *  identical to TemplateKind (PLAN §P1: "== TemplateKind, reused not duplicated"). */
export type TemplateBucket = TemplateKind;

export interface GithubFolderMapping {
  bucket: TemplateBucket;
  /** folder path, e.g. "agents" — no leading/trailing slash. Relative to the
   *  source's `rootPath` on an AuthorSource ("." = the root itself, user
   *  sources only); repo-relative once passed through toRepoRelativeFolders
   *  ("" = the repo root, which matchAuthorFolders supports). */
  path: string;
  /**
   * "star.md" (i.e. "*.md") = flat files directly under `path` (e.g.
   * agents/<slug>.md). "star-slash-SKILL.md" (i.e. "*\/SKILL.md") = one
   * level of subfolder then a fixed filename (e.g. skills/<slug>/SKILL.md).
   * These are the only two shapes ECC's real, verified structure requires
   * (PLAN §P0/§P10.4) — a future author needing a genuinely different shape
   * requires a small, reviewed code change to this union + matchAuthorFolders,
   * not just a registry edit (PLAN §P10.4's explicitly-flagged AC8 limitation).
   */
  filePattern: "*.md" | "*/SKILL.md";
}

export type AuthorSource =
  | { id: string; displayName: string; kind: "bundled" }
  | {
      id: string;
      displayName: string;
      kind: "github";
      owner: string;
      repo: string;
      /** branch/tag, e.g. "main" — builtin: pinned per author. user: the saved
       *  ref, or "HEAD" when the source follows the default branch. */
      ref: string;
      folders: GithubFolderMapping[];
      /** shown in UI attribution/license-step copy, e.g. "affaan-m/ecc". */
      repoLabel: string;
      /** "builtin" = reviewed AUTHOR_REGISTRY entry; "user" = added via link
       *  (drives the "Unverified" label). Set daemon-side only. */
      origin: "builtin" | "user";
      /** folder inside the repo used as the root for `folders` ("" = repo root).
       *  Never appears in a URL — only a prefix filter over tree entries. */
      rootPath: string;
    };

export type GithubAuthorSource = Extract<AuthorSource, { kind: "github" }>;

/**
 * AUTHOR_REGISTRY — the hardcoded, reviewed author list (PLAN §P1).
 * "symbion" = the existing bundled gallery (zero network, THINK #1: kept,
 * not replaced). "ecc" = the first GitHub-backed author, folder mapping
 * verified against the real repo's tree during PLAN (PLAN §P0).
 */
export const AUTHOR_REGISTRY: AuthorSource[] = [
  { id: "symbion", displayName: "Symbion", kind: "bundled" },
  {
    id: "ecc",
    displayName: "ECC",
    kind: "github",
    owner: "affaan-m",
    repo: "ecc",
    ref: "main",
    repoLabel: "affaan-m/ecc",
    origin: "builtin",
    rootPath: "",
    folders: [
      { bucket: "agent", path: "agents", filePattern: "*.md" },
      { bucket: "command", path: "commands", filePattern: "*.md" },
      { bucket: "skill", path: "skills", filePattern: "*/SKILL.md" },
    ],
  },
];
