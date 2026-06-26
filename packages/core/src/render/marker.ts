import { sha256Hex } from "../util/sha256.js";
import type { ArtifactKind } from "../ir/types.js";

export interface ManagedMarker {
  id: string;
  kind: ArtifactKind;
  version: string;
  hash: string; // truncated 12-hex-char hash as stored in the marker
}

export interface RegionMarker {
  region: true;
  version: string;
  hash: string;
}

const MARKER_RE =
  /<!--\s*managed-by:\s*symbion\s+id=(\S+)\s+kind=(\S+)\s+v=(\S+)\s+hash=(\S+)\s*-->/;

const REGION_START_RE = /<!--\s*managed-by:\s*symbion\s+region-start\s+v=(\S+)\s+hash=(\S+)\s*-->/;
const REGION_END_RE = /<!--\s*managed-by:\s*symbion\s+region-end\s*-->/;

/** Truncate a full sha256 hex digest to the 12-char form stored in markers. */
export function truncateHash(fullHash: string): string {
  return fullHash.slice(0, 12);
}

/** Build the trailing per-file managed marker comment (single-file targets: Claude). */
export function buildMarker(id: string, kind: ArtifactKind, version: string, hash: string): string {
  return `<!-- managed-by: symbion id=${id} kind=${kind} v=${version} hash=${truncateHash(hash)} -->`;
}

/** Parse a per-file managed marker out of file content. Returns null if absent (foreign file). */
export function parseMarker(content: string): ManagedMarker | null {
  const match = MARKER_RE.exec(content);
  if (!match) return null;
  const [, id, kind, version, hash] = match;
  if (kind !== "agent" && kind !== "command") return null;
  return { id: id!, kind, version: version!, hash: hash! };
}

/** Build the region-fence start marker (merged targets: Codex/AGENTS.md). */
export function buildRegionStart(version: string, hash: string): string {
  return `<!-- managed-by: symbion region-start v=${version} hash=${truncateHash(hash)} -->`;
}

export function buildRegionEnd(): string {
  return `<!-- managed-by: symbion region-end -->`;
}

/** Parse the region-fence markers out of file content. Returns null if no fence found. */
export function parseRegionMarker(content: string): RegionMarker | null {
  const match = REGION_START_RE.exec(content);
  if (!match) return null;
  const [, version, hash] = match;
  if (!REGION_END_RE.test(content)) return null;
  return { region: true, version: version!, hash: hash! };
}

/**
 * computeContentHash — sha256 over canonical content EXCLUDING the hash token itself.
 * Caller passes the content with the hash placeholder already stripped/blanked
 * (e.g. render the marker with hash="" first, hash that, then rebuild marker with real hash).
 */
export function computeContentHash(canonicalContentWithoutHash: string): string {
  return sha256Hex(canonicalContentWithoutHash);
}
