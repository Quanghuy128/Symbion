import type { TemplateKind } from "./parseTemplate.js";

/**
 * authorSource.ts — the AuthorSource/AUTHOR_REGISTRY abstraction
 * (docs/loops/templates-authors-STATE.md PLAN §P1). Pure data, zero fs/net —
 * lives in packages/core so both apps/web (renders the Authors sub-nav
 * labels) and apps/daemon (the fetchAuthorTemplates RPC handler) import the
 * exact same registry, with no hand-duplication / drift risk.
 *
 * THINK #2 (templates-authors-STATE.md): a short, manually-reviewed,
 * hardcoded list — NOT a user-facing "add any repo URL" self-service flow.
 * Adding a new author is a reviewed code change to AUTHOR_REGISTRY, not a
 * runtime/user action.
 */

/** Re-export under a more domain-specific name for this file's call sites —
 *  identical to TemplateKind (PLAN §P1: "== TemplateKind, reused not duplicated"). */
export type TemplateBucket = TemplateKind;

export interface GithubFolderMapping {
  bucket: TemplateBucket;
  /** repo-relative folder path, e.g. "agents" — no leading/trailing slash. */
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
      /** branch/tag, e.g. "main" — pinned per author, not user-supplied. */
      ref: string;
      folders: GithubFolderMapping[];
      /** shown in UI attribution/license-step copy, e.g. "affaan-m/ecc". */
      repoLabel: string;
    };

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
    folders: [
      { bucket: "agent", path: "agents", filePattern: "*.md" },
      { bucket: "command", path: "commands", filePattern: "*.md" },
      { bucket: "skill", path: "skills", filePattern: "*/SKILL.md" },
    ],
  },
];
