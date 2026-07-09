import { realpathSync, existsSync } from "node:fs";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";
import { isWindowsStyleAbsolute } from "./pathStyle.js";

export class PathConfinementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathConfinementError";
  }
}

/**
 * resolveConfinedPath — the filesystem analogue of "no DELETE without WHERE".
 * Resolves `relPath` against `projectRoot` and guarantees the result stays
 * inside the project root. Rejects:
 *  - `..` traversal that escapes the root
 *  - absolute paths (relPath must be relative)
 *  - symlinks whose real target resolves outside the root (checked on the
 *    deepest EXISTING ancestor directory, since the leaf file may not exist yet)
 *
 * Throws PathConfinementError on any violation. Never returns a path outside root.
 */
export function resolveConfinedPath(projectRoot: string, relPath: string): string {
  // Closes the Windows-style-traversal gap unconditionally for every caller,
  // regardless of whether that caller also remembers to call
  // rejectTraversalSegments separately.
  rejectTraversalSegments(relPath);

  if (isAbsolute(relPath) || isWindowsStyleAbsolute(relPath)) {
    throw new PathConfinementError(`Absolute paths are not allowed: ${relPath}`);
  }

  const root = resolve(projectRoot);
  const candidate = resolve(root, relPath);
  const normalizedCandidate = normalize(candidate);

  // Must resolve to a location inside root (or equal to root, which we disallow for files).
  const rel = relative(root, normalizedCandidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new PathConfinementError(`Path escapes the project root: ${relPath}`);
  }
  if (rel === "") {
    throw new PathConfinementError(`Invalid path (points to the project root itself): ${relPath}`);
  }

  // Symlink-escape check: walk up from the deepest existing ancestor directory and
  // verify its realpath is still inside root's realpath. Catches the case where an
  // intermediate directory is a symlink pointing outside the project.
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    // project root itself doesn't exist (shouldn't normally happen) — fail closed.
    throw new PathConfinementError(`Project root does not exist: ${root}`);
  }

  let probe = dirname(normalizedCandidate);
  while (probe !== root && probe.length >= root.length) {
    if (existsSync(probe)) {
      const realProbe = realpathSync(probe);
      const relReal = relative(realRoot, realProbe);
      if (relReal.startsWith("..") || isAbsolute(relReal)) {
        throw new PathConfinementError(
          `Symlink points outside the project root: ${relPath}`
        );
      }
      break;
    }
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }

  return normalizedCandidate;
}

/** Defense-in-depth: ensure a candidate relPath does not contain raw `..` segments at all. */
export function rejectTraversalSegments(relPath: string): void {
  const segments = relPath.split(/[\\/]/);
  if (segments.includes("..")) {
    throw new PathConfinementError(`Paths containing ".." are not allowed: ${relPath}`);
  }
}
