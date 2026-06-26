import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface GitStatusResult {
  isRepo: boolean;
  clean: boolean;
  changedFiles: string[];
}

/**
 * gitStatus — read-only `git status --porcelain` (git is advisory in v1: status only,
 * never commits/branches, per STATE §8 #4 / CLAUDE.md).
 */
export function gitStatus(repoPath: string): GitStatusResult {
  const isRepo = existsSync(join(repoPath, ".git"));
  if (!isRepo) {
    return { isRepo: false, clean: true, changedFiles: [] };
  }

  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd: repoPath,
      encoding: "utf-8",
    });
    const changedFiles = out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => l.slice(3));
    return { isRepo: true, clean: changedFiles.length === 0, changedFiles };
  } catch {
    // git binary missing or command failed — treat as non-repo (advisory, never blocks).
    return { isRepo: false, clean: true, changedFiles: [] };
  }
}
