/**
 * pathStyle.ts — Windows-style path-string detection, used by validatePath
 * and the path-confinement guard to recognize drive-letter/backslash/UNC
 * path shapes regardless of which OS/path-mode Node itself is running in.
 * Pure string logic — does not touch the filesystem.
 */

/** Drive-letter absolute: C:\... or C:/... or c:\... (case-insensitive). */
const WINDOWS_DRIVE_ABSOLUTE_RE = /^[A-Za-z]:[\\/]/;

/** UNC: \\server\share\... (exactly two leading backslashes, then a host segment). */
const UNC_RE = /^\\\\[^\\/]+[\\/]/;

export function isWindowsDriveAbsolute(p: string): boolean {
  return WINDOWS_DRIVE_ABSOLUTE_RE.test(p);
}

export function isUncPath(p: string): boolean {
  return UNC_RE.test(p);
}

/** True for ANY Windows-style absolute shape (drive-letter OR UNC) — used to decide
 *  "should this be treated as absolute" before any node:path call, since node:path's
 *  own isAbsolute() is POSIX-mode and blind to both shapes on a Linux/WSL process. */
export function isWindowsStyleAbsolute(p: string): boolean {
  return isWindowsDriveAbsolute(p) || isUncPath(p);
}

/**
 * Splits a path string on BOTH separators (\ and /), for traversal-segment
 * checking and mixed-separator normalization. Does not collapse empty
 * segments from a leading drive-prefix or UNC double-backslash — callers
 * that need that behavior strip the prefix first (see normalizeWindowsPath).
 */
export function splitAnySeparator(p: string): string[] {
  return p.split(/[\\/]+/);
}

/**
 * normalizeWindowsPath — for a confirmed drive-absolute path, rewrites to a
 * canonical forward-slash form with an UPPERCASE drive letter, so
 * `c:\Users\me` and `C:/Users/me` compare/resolve identically (EC-3.2).
 * Caller must have already confirmed isWindowsDriveAbsolute(p) is true.
 */
export function normalizeWindowsPath(p: string): string {
  const drive = (p[0] ?? "").toUpperCase();
  const rest = p.slice(2).replace(/\\/g, "/").replace(/\/+/g, "/");
  return `${drive}:${rest.startsWith("/") ? rest : "/" + rest}`;
}
