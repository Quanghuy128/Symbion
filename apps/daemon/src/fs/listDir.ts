/**
 * listDir / makeDir — the "browse/prepare a not-yet-a-project directory" pair
 * (docs/loops/create-project-folder-browser-STATE.md §1.1/§1.2). Both are plain
 * Node fs logic; they live in apps/daemon (never packages/core, which stays
 * fs-free) and are intentionally NOT in writeFiles.ts, which is the
 * render→diff→write pipeline for *managed* .claude/AGENTS.md files inside an
 * *already-registered* project. listDir/makeDir operate upstream of all of
 * that, before any project root exists.
 */
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute } from "node:path";
import { RpcError } from "../rpc/rpcError.js";
import { splitAnySeparator } from "../rpc/pathStyle.js";
import type { ListDirEntry, ListDirResult, MakeDirResult } from "../rpc/contract.js";

/**
 * listDir — read-only directory PICKER listing (subdirectories only, never files).
 * See STATE §1.1 for the full behavior contract.
 */
export function listDir(inputPath?: unknown): ListDirResult {
  if (inputPath !== undefined && typeof inputPath !== "string") {
    throw new RpcError("invalid-params", "Path must be an absolute path.");
  }
  const target = inputPath ?? homedir();

  if (!isAbsolute(target)) {
    throw new RpcError("invalid-params", "Path must be an absolute path.");
  }

  let resolved: string;
  try {
    resolved = realpathSync(target);
  } catch {
    throw new RpcError("invalid-path", "Path does not exist or is not a directory.");
  }

  let stat;
  try {
    stat = statSync(resolved);
  } catch {
    throw new RpcError("invalid-path", "Path does not exist or is not a directory.");
  }
  if (!stat.isDirectory()) {
    throw new RpcError("invalid-path", "Path does not exist or is not a directory.");
  }

  const parentCandidate = dirname(resolved);
  const parentPath = parentCandidate === resolved ? undefined : parentCandidate;

  try {
    accessSync(resolved, constants.R_OK);
  } catch {
    return { path: resolved, parentPath, entries: [], denied: true };
  }

  let dirents;
  try {
    dirents = readdirSync(resolved, { withFileTypes: true });
  } catch {
    // readdir itself failed despite passing accessSync (e.g. a race, or an ACL
    // accessSync doesn't fully model) — treat the same as a denied listing.
    return { path: resolved, parentPath, entries: [], denied: true };
  }

  const entries: ListDirEntry[] = [];
  for (const dirent of dirents) {
    const entryPath = `${resolved === "/" ? "" : resolved}/${dirent.name}`;

    if (dirent.isSymbolicLink()) {
      // Only include a symlink if its resolved target is itself a directory.
      // Broken symlinks and symlinks-to-files are excluded entirely.
      try {
        const targetStat = statSync(entryPath);
        if (!targetStat.isDirectory()) continue;
        entries.push({ name: dirent.name, path: entryPath, isDir: true, isSymlink: true, unreadable: false });
      } catch {
        // broken symlink -> exclude entirely (not a directory).
        continue;
      }
      continue;
    }

    if (!dirent.isDirectory()) continue; // files are never shown

    try {
      // Per-entry stat to tolerate a single ACL'd child without failing the call.
      statSync(entryPath);
      entries.push({ name: dirent.name, path: entryPath, isDir: true, isSymlink: false, unreadable: false });
    } catch {
      entries.push({ name: dirent.name, path: entryPath, isDir: false, isSymlink: false, unreadable: true });
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return { path: resolved, parentPath, entries, denied: false };
}

/**
 * makeDir — create-folder-if-missing (mkdir -p semantics). See STATE §1.2 /
 * Edge Cases §3.4 for why no resolveConfinedPath/project-root confinement
 * applies here: there is no project root yet to confine to.
 */
export function makeDir(path: unknown): MakeDirResult {
  if (typeof path !== "string" || path.length === 0 || !isAbsolute(path)) {
    throw new RpcError("invalid-params", "Path must be an absolute path.");
  }

  const segments = splitAnySeparator(path);
  if (segments.includes("..")) {
    throw new RpcError("invalid-params", `Paths containing ".." are not allowed: ${path}`);
  }

  if (existsSync(path)) {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return { path, created: false };
    }
    throw new RpcError("path-is-file", "Path already exists but is not a directory.");
  }

  try {
    mkdirSync(path, { recursive: true });
  } catch (err) {
    throw new RpcError("mkdir-failed", `Could not create directory: ${(err as Error).message}`);
  }

  return { path, created: true };
}
