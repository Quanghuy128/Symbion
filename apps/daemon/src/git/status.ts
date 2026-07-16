import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FileChange } from "@symbion/core";

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
    // BUGFIX (found during P2's gitNumstat work, STATE §13 BUILD notes): the
    // porcelain format's first TWO columns can include a leading space (e.g.
    // " M README.md" for a modified-not-staged file) — trimming the WHOLE
    // line before slicing off 3 chars ate part of the filename for any
    // single-char status code (`.trim()` removed the leading space, so
    // `.slice(3)` then cut into "M R" instead of the intended 3-char status
    // prefix). Fixed by filtering blank lines on the RAW line (only a
    // trailing split artifact can be truly empty) and slicing the raw,
    // untrimmed line — porcelain's status+separator is ALWAYS exactly 3
    // chars regardless of leading space. Only P1's `gitStatus()`-consuming
    // test ever exercised an untracked ("?? file", no leading space) row,
    // which happened to still work under the old (buggy) trim-then-slice —
    // this masked the bug until P2's `preDirty` cross-reference needed exact
    // paths for MODIFIED (leading-space) rows too.
    const changedFiles = out
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => l.slice(3).trim());
    return { isRepo: true, clean: changedFiles.length === 0, changedFiles };
  } catch {
    // git binary missing or command failed — treat as non-repo (advisory, never blocks).
    return { isRepo: false, clean: true, changedFiles: [] };
  }
}

/** first two porcelain status columns -> a coarse A/M/D classification. */
function classifyPorcelain(code: string): "A" | "M" | "D" {
  if (code.includes("A") || code.includes("?")) return "A";
  if (code.includes("D")) return "D";
  return "M";
}

/**
 * gitNumstat — read-only `git diff --numstat HEAD` (P2, STATE §13.1/NEW-2).
 * Never throws, never blocks run finalization: on ANY failure (git missing,
 * command throws/times out, not a repo) returns the literal "unavailable"
 * (F4/F6-style "degrade, don't die" applied to this new subsystem).
 *
 * Untracked new files (`??` in `git status --porcelain`) get a `status:"A"`
 * row with NO plus/minus counts (numstat alone doesn't report line counts for
 * untracked files without `--no-index` gymnastics that risk walking outside
 * the tracked tree — deliberately not attempted, matches the design mock's
 * own `A docs/loops/....md` row with no ± shown, Risk R4).
 *
 * `preDirty` is left for the caller to set (cross-referenced against the
 * run's persisted `gitBefore.changedFiles` — this function has no run context).
 */
export function gitNumstat(repoPath: string): FileChange[] | "unavailable" {
  const isRepo = existsSync(join(repoPath, ".git"));
  if (!isRepo) return "unavailable";

  try {
    const porcelainOut = execFileSync("git", ["status", "--porcelain"], {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 10_000,
    });
    const statusByPath = new Map<string, "A" | "M" | "D">();
    const untracked = new Set<string>();
    for (const raw of porcelainOut.split("\n")) {
      if (raw.length === 0) continue;
      const code = raw.slice(0, 2);
      const path = raw.slice(3).trim();
      if (path.length === 0) continue;
      if (code.includes("?")) untracked.add(path);
      statusByPath.set(path, classifyPorcelain(code));
    }

    const numstatOut = execFileSync("git", ["diff", "--numstat", "HEAD"], {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 10_000,
    });

    const out: FileChange[] = [];
    const seen = new Set<string>();
    for (const raw of numstatOut.split("\n")) {
      if (raw.length === 0) continue;
      const parts = raw.split("\t");
      if (parts.length < 3) continue;
      const [plusStr, minusStr, path] = parts;
      if (!path) continue;
      seen.add(path);
      const plus = plusStr === "-" ? undefined : Number(plusStr);
      const minus = minusStr === "-" ? undefined : Number(minusStr);
      out.push({
        path,
        status: statusByPath.get(path) ?? "M",
        plus: Number.isFinite(plus) ? plus : undefined,
        minus: Number.isFinite(minus) ? minus : undefined,
      });
    }

    // Untracked files never show up in `git diff --numstat HEAD` (they're not
    // tracked yet) — merge them in as status "A" with no ± counts.
    for (const path of untracked) {
      if (seen.has(path)) continue;
      out.push({ path, status: "A" });
    }

    return out;
  } catch {
    return "unavailable";
  }
}
