import type { GithubFolderMapping, TemplateBucket } from "./authorSource.js";
import { matchAuthorFolders, type GithubTreeEntry } from "./matchAuthorFolders.js";
import { folderPatternForBucket, type SourceFolder } from "./userSource.js";

/**
 * detectFolders.ts — pure folder auto-detection over a GitHub recursive tree
 * (docs/loops/templates-repo-url-STATE.md PLAN §8.5).
 */

/** The "this folder itself" pseudo-path (root-relative). */
export const ROOT_FOLDER = ".";
export const MAX_ROOT_DIRS = 200;

export interface DetectedFolder extends SourceFolder {
  /** number of files the bucket's pattern matches in that folder. */
  count: number;
}

export interface RootDirInfo {
  path: string;
  mdFiles: number;
  skillFiles: number;
}

export interface FolderDetection {
  /** false when rootPath is set but no `type:"tree"` entry has exactly that path. */
  rootExists: boolean;
  detected: DetectedFolder[];
  /** "." first, then sorted direct child dirs (max MAX_ROOT_DIRS). */
  rootDirs: RootDirInfo[];
}

const BUCKET_FOLDER_NAMES: ReadonlyArray<{ bucket: TemplateBucket; name: string }> = [
  { bucket: "agent", name: "agents" },
  { bucket: "command", name: "commands" },
  { bucket: "skill", name: "skills" },
];

export function detectTemplateFolders(tree: GithubTreeEntry[], rootPath: string): FolderDetection {
  let entries: GithubTreeEntry[];
  if (rootPath === "") {
    entries = tree;
  } else {
    const exists = tree.some((e) => e.type === "tree" && e.path === rootPath);
    if (!exists) return { rootExists: false, detected: [], rootDirs: [] };
    const prefix = `${rootPath}/`;
    entries = [];
    for (const e of tree) {
      if (e.path.startsWith(prefix) && e.path.length > prefix.length) {
        entries.push({ path: e.path.slice(prefix.length), type: e.type });
      }
    }
  }

  const detected: DetectedFolder[] = [];
  for (const { bucket, name } of BUCKET_FOLDER_NAMES) {
    const pattern = folderPatternForBucket(bucket);
    const rootCount = matchAuthorFolders(entries, [{ bucket, path: name, filePattern: pattern }]).length;
    if (rootCount > 0) {
      detected.push({ bucket, path: name, count: rootCount });
      continue; // root-level wins over .claude/, never both
    }
    const claudePath = `.claude/${name}`;
    const claudeCount = matchAuthorFolders(entries, [{ bucket, path: claudePath, filePattern: pattern }]).length;
    if (claudeCount > 0) detected.push({ bucket, path: claudePath, count: claudeCount });
  }

  // rootDirs — single pass over the entries.
  const stats = new Map<string, { mdFiles: number; skillFiles: number }>();
  const rootStats = { mdFiles: 0, skillFiles: 0 };
  for (const e of entries) {
    const slash = e.path.indexOf("/");
    if (e.type === "tree" && slash === -1) {
      if (!stats.has(e.path)) stats.set(e.path, { mdFiles: 0, skillFiles: 0 });
      continue;
    }
    if (slash === 0) continue;
    if (slash === -1) {
      if (e.type === "blob" && e.path.endsWith(".md")) rootStats.mdFiles++;
      continue;
    }
    const dir = e.path.slice(0, slash);
    let st = stats.get(dir);
    if (!st) {
      st = { mdFiles: 0, skillFiles: 0 };
      stats.set(dir, st);
    }
    if (e.type !== "blob") continue;
    const rest = e.path.slice(slash + 1);
    if (rest.endsWith(".md") && !rest.includes("/")) st.mdFiles++;
    if (rest.endsWith("/SKILL.md")) {
      const seg = rest.slice(0, -"/SKILL.md".length);
      if (seg.length > 0 && !seg.includes("/")) st.skillFiles++;
    }
  }
  // "." skillFiles = `*/SKILL.md` directly one level below the root (= dir/SKILL.md).
  for (const e of entries) {
    if (e.type === "blob" && e.path.endsWith("/SKILL.md")) {
      const seg = e.path.slice(0, -"/SKILL.md".length);
      if (seg.length > 0 && !seg.includes("/")) rootStats.skillFiles++;
    }
  }
  stats.delete(".git");
  const sortedDirs = [...stats.keys()].sort().slice(0, MAX_ROOT_DIRS);
  const rootDirs: RootDirInfo[] = [{ path: ROOT_FOLDER, ...rootStats }];
  for (const d of sortedDirs) rootDirs.push({ path: d, ...stats.get(d)! });

  return { rootExists: true, detected, rootDirs };
}

/** Root-relative folders -> repo-relative GithubFolderMappings ("." -> the root itself). */
export function toRepoRelativeFolders(
  rootPath: string,
  folders: Array<{ bucket: TemplateBucket; path: string; filePattern?: GithubFolderMapping["filePattern"] }>,
): GithubFolderMapping[] {
  return folders.map((f) => ({
    bucket: f.bucket,
    path: f.path === ROOT_FOLDER ? rootPath : rootPath ? `${rootPath}/${f.path}` : f.path,
    filePattern: f.filePattern ?? folderPatternForBucket(f.bucket),
  }));
}
