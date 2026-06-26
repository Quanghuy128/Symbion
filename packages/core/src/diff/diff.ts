import type { RenderedFile } from "../adapters/types.js";
import { computeContentHash, parseMarker, parseRegionMarker, truncateHash } from "../render/marker.js";
import { classify, type ConflictClass } from "./conflict.js";

export type DiffStatus = "new" | "update" | "same" | "conflict";

export interface DiffFile {
  relPath: string;
  status: DiffStatus;
  /** undefined when the file doesn't exist on disk yet. */
  onDiskContent?: string;
  renderedContent: string;
  onDiskHash?: string; // truncated 12-char marker hash found on disk, if any
  managedMarkerOk: boolean; // true if marker present and matches (or file is new)
  conflictClass: ConflictClass;
  /**
   * true exactly when this is the resolved STATE §3.4 ambiguity case: a
   * merged/lossy target's single file (e.g. AGENTS.md) already exists on
   * disk with foreign (non-Symbion-marked) content and is being modified
   * by Symbion for the first time. Distinct from a regular `conflict` —
   * this is treated as a normal new/update, but the UI should show a
   * dedicated one-time notice (separate from the Codex-lossy "Tôi hiểu"
   * acknowledgment) since the user's pre-existing file is about to gain a
   * managed region for the first time.
   */
  firstPublishIntoForeignMergedFile: boolean;
}

export interface OnDiskFile {
  relPath: string;
  /** undefined => file does not exist. */
  content?: string;
  /**
   * true for merged/lossy targets' single file (e.g. AGENTS.md) where the render
   * pass has ALREADY folded any pre-existing foreign content into `renderedContent`
   * (STATE §3.3 splice). An unmarked on-disk file at this relPath is therefore the
   * expected first-publish case, not a name-collision conflict — treated as
   * new/update rather than the defensive "foreign" conflict block.
   */
  isMergedTarget?: boolean;
}

/** Strip the trailing per-file marker comment from content, returning the marker-less body. */
function stripFileMarker(content: string): string {
  return content.replace(/\n*<!--\s*managed-by:\s*symbion\s+id=[\s\S]*?-->\s*$/, "");
}

/** Strip the region fence (start+body+end) leaving foreign content + the bare region body for rehash. */
function stripRegionMarkerForHash(content: string): { body: string } | null {
  const startMatch = /<!--\s*managed-by:\s*symbion\s+region-start\s+v=\S+\s+hash=\S+\s*-->\n?/.exec(
    content
  );
  const endMatch = /\n?<!--\s*managed-by:\s*symbion\s+region-end\s*-->/.exec(content);
  if (!startMatch || !endMatch) return null;
  const bodyStart = startMatch.index + startMatch[0].length;
  const bodyEnd = endMatch.index;
  if (bodyEnd < bodyStart) return null;
  return { body: content.slice(bodyStart, bodyEnd) };
}

/**
 * recomputeOnDiskHash — given on-disk content, find its marker (per-file or region)
 * and recompute the truncated hash over the marker-stripped canonical body to compare
 * against the hash stored in the marker.
 */
function recomputeOnDiskHash(content: string): { markerHash?: string; recomputedHash?: string } {
  const fileMarker = parseMarker(content);
  if (fileMarker) {
    const stripped = stripFileMarker(content).replace(/\n+$/, "");
    const recomputed = truncateHash(computeContentHash(stripped));
    return { markerHash: fileMarker.hash, recomputedHash: recomputed };
  }

  const regionMarker = parseRegionMarker(content);
  if (regionMarker) {
    const stripped = stripRegionMarkerForHash(content);
    if (stripped) {
      const recomputed = truncateHash(computeContentHash(stripped.body));
      return { markerHash: regionMarker.hash, recomputedHash: recomputed };
    }
  }

  return {};
}

/**
 * computeDiff — pure: compare freshly rendered files against on-disk files, classify
 * each into new|update|same|conflict. Files on disk with no corresponding rendered
 * file and no marker ("foreign") are simply absent from this list (never touched).
 */
export function computeDiff(rendered: RenderedFile[], onDisk: OnDiskFile[]): DiffFile[] {
  const onDiskByPath = new Map(onDisk.map((f) => [f.relPath, f]));

  return rendered.map((file): DiffFile => {
    const onDiskFile = onDiskByPath.get(file.relPath);
    const existing = onDiskFile?.content;

    if (existing === undefined) {
      return {
        relPath: file.relPath,
        status: "new",
        renderedContent: file.content,
        managedMarkerOk: true,
        conflictClass: "foreign", // semantically irrelevant for "new"; no on-disk file to classify
        firstPublishIntoForeignMergedFile: false,
      };
    }

    const { markerHash, recomputedHash } = recomputeOnDiskHash(existing);
    const conflictClass = classify({ onDiskMarkerHash: markerHash, onDiskRecomputedHash: recomputedHash });

    if (conflictClass === "foreign") {
      if (onDiskFile?.isMergedTarget) {
        // First publish of a merged target (e.g. AGENTS.md): render already spliced
        // any pre-existing foreign content in, so this is an expected update, not a
        // name-collision conflict.
        const sameContent = existing === file.content;
        return {
          relPath: file.relPath,
          status: sameContent ? "same" : "update",
          onDiskContent: existing,
          renderedContent: file.content,
          managedMarkerOk: true,
          conflictClass: "clean",
          // STATE §3.4: first-ever Symbion modification of a pre-existing,
          // non-Symbion-marked merged-target file (e.g. AGENTS.md). Only
          // relevant (and only worth flagging) when the file actually
          // changes — a "same" result here would mean the existing file
          // byte-matches what Symbion would render, which doesn't happen
          // on a true first publish since there's no marker yet.
          firstPublishIntoForeignMergedFile: !sameContent,
        };
      }
      // Should not normally happen (we only diff against rendered relPaths the daemon
      // is about to manage), but guard defensively: never overwrite — treat as conflict
      // so it surfaces rather than silently writing over an unmarked file.
      return {
        relPath: file.relPath,
        status: "conflict",
        onDiskContent: existing,
        renderedContent: file.content,
        managedMarkerOk: false,
        conflictClass: "foreign",
        firstPublishIntoForeignMergedFile: false,
      };
    }

    if (conflictClass === "conflict") {
      return {
        relPath: file.relPath,
        status: "conflict",
        onDiskContent: existing,
        renderedContent: file.content,
        onDiskHash: markerHash,
        managedMarkerOk: false,
        conflictClass: "conflict",
        firstPublishIntoForeignMergedFile: false,
      };
    }

    // clean: safe to compare rendered vs on-disk for same/update
    const sameContent = existing === file.content;
    return {
      relPath: file.relPath,
      status: sameContent ? "same" : "update",
      onDiskContent: existing,
      renderedContent: file.content,
      onDiskHash: markerHash,
      managedMarkerOk: true,
      conflictClass: "clean",
      firstPublishIntoForeignMergedFile: false,
    };
  });
}
