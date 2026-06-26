export type ConflictClass = "clean" | "conflict" | "foreign";

export interface ClassifyInput {
  /** marker found on the on-disk file's hash (truncated 12-char), or undefined if no marker. */
  onDiskMarkerHash?: string;
  /** recomputed truncated hash (12-char) of the on-disk content's marker-stripped body, compared against onDiskMarkerHash. */
  onDiskRecomputedHash?: string;
}

/**
 * classify — given an on-disk file's marker presence + hash comparison, determine
 * whether it's safe to update ("clean"), hand-edited since last publish ("conflict"),
 * or entirely unmanaged ("foreign").
 *
 * Rules (STATE §3.4):
 * - No marker -> "foreign".
 * - Marker present, recomputed hash == marker hash -> "clean" (untouched since Studio wrote it).
 * - Marker present, recomputed hash != marker hash -> "conflict" (hand-edited after last publish).
 */
export function classify(input: ClassifyInput): ConflictClass {
  if (input.onDiskMarkerHash === undefined) {
    return "foreign";
  }
  if (input.onDiskRecomputedHash === input.onDiskMarkerHash) {
    return "clean";
  }
  return "conflict";
}
