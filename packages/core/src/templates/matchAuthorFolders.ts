import type { GithubFolderMapping, TemplateBucket } from "./authorSource.js";

export interface GithubTreeEntry {
  path: string;
  type: "blob" | "tree" | string;
}

export interface AuthorFolderCandidate {
  bucket: TemplateBucket;
  relPath: string;
}

/**
 * matchAuthorFolders — pure filter/match helper (PLAN §P2a). Given a GitHub
 * repo's flattened tree listing + an author's `folders` mapping, returns the
 * exact set of `{ bucket, relPath }` candidates to fetch content for. Pure
 * data-in/data-out, fully unit-testable without any network call.
 *
 * Two supported shapes only (PLAN §P10.4 — not a generic glob engine):
 * - "*.md": exactly one path segment below `folder.path`, ending in ".md".
 *   Excludes any nested subfolder (e.g. `agents/sub/foo.md` does NOT match).
 * - "*\/SKILL.md": exactly one path segment between `folder.path` and the
 *   trailing literal filename "SKILL.md". Excludes helper files inside the
 *   same item folder (e.g. `skills/foo/examples/bar.md`) and excludes a
 *   missing/extra nesting level.
 *
 * Tree entries of `type !== "blob"` (directories) are never returned, even
 * if their `path` happens to match a pattern textually.
 */
export function matchAuthorFolders(
  treeEntries: GithubTreeEntry[],
  folders: GithubFolderMapping[]
): AuthorFolderCandidate[] {
  const candidates: AuthorFolderCandidate[] = [];

  for (const entry of treeEntries) {
    if (entry.type !== "blob") continue;

    for (const folder of folders) {
      const prefix = `${folder.path}/`;
      if (!entry.path.startsWith(prefix)) continue;
      const rest = entry.path.slice(prefix.length);
      if (rest.length === 0) continue;

      if (folder.filePattern === "*.md") {
        if (!rest.endsWith(".md")) continue;
        // Exactly one path segment below the folder — no further "/" in rest.
        if (rest.indexOf("/") !== -1) continue;
        candidates.push({ bucket: folder.bucket, relPath: entry.path });
      } else {
        // "*/SKILL.md": exactly one segment then the literal filename "SKILL.md".
        const SUFFIX = "/SKILL.md";
        if (!rest.endsWith(SUFFIX)) continue;
        const segment = rest.slice(0, rest.length - SUFFIX.length);
        if (segment.length === 0) continue; // skills/SKILL.md (missing subfolder)
        if (segment.indexOf("/") !== -1) continue; // skills/foo/bar/SKILL.md (nested 2 levels)
        candidates.push({ bucket: folder.bucket, relPath: entry.path });
      }
    }
  }

  return candidates;
}
