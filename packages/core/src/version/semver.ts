const VERSION_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

export type BumpKind = "patch" | "minor" | "major";

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export function validateVersion(version: string): boolean {
  return VERSION_RE.test(version);
}

/** Parses "vMAJOR.MINOR.PATCH" into a numeric tuple, or null if malformed.
 *  Shared by daemon/web/core so version comparisons never degrade into
 *  naive string comparison (e.g. "v0.10.0" < "v0.2.0" lexicographically
 *  but not numerically). */
export function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_RE.exec(version);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Numeric comparison: negative if a < b, 0 if equal, positive if a > b.
 *  Malformed versions sort as lower than any valid version. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  return pa.patch - pb.patch;
}

/** bump("v0.2.0","patch"|"minor"|"major") -> "v0.2.1" / "v0.3.0" / "v1.0.0". Throws on malformed input. */
export function bump(version: string, kind: BumpKind): string {
  const match = VERSION_RE.exec(version);
  if (!match) {
    throw new Error(`Phiên bản không hợp lệ: "${version}" (cần dạng vMAJOR.MINOR.PATCH).`);
  }
  let [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];

  if (kind === "patch") {
    patch += 1;
  } else if (kind === "minor") {
    minor += 1;
    patch = 0;
  } else {
    major += 1;
    minor = 0;
    patch = 0;
  }

  return `v${major}.${minor}.${patch}`;
}
