/**
 * retention — pure retention-pruning POLICY (STATE §18.1 P3 architecture).
 * PURE — no Node/fs imports (AC-RUN-11). `apps/daemon/src/run/runStore.ts`'s
 * `prune()` delegates the sort+select step to `selectPruneTargets`; the
 * actual `lstatSync`/`rmSync`/symlink-refusal/re-confinement stays daemon-side
 * (that's inherently fs work, not eligible for core).
 *
 * This is a behavior-preserving EXTRACTION of `prune()`'s existing inline
 * sort-and-slice — not new pruning behavior.
 */

export interface PruneCandidate {
  runId: string;
  startedAt: string;
}

/**
 * selectPruneTargets — given every persisted run's {runId, startedAt}, return
 * the runIds that should be DELETED to keep only the newest `keep` runs.
 *
 * - Sorts ascending by `startedAt` (oldest first); the runIds beyond the
 *   newest `keep` (i.e. the oldest `runs.length - keep`) are selected.
 * - Stable tie-break: a stable sort preserves each run's ORIGINAL INPUT-ARRAY
 *   ORDER among equal `startedAt` values — for two runs with an identical
 *   `startedAt`, the one appearing EARLIER in the input array is treated as
 *   "older" (deleted first when `keep` forces a choice). This is deterministic
 *   given the same input array order every call (testplan §7.1 #4).
 * - `runs.length <= keep` (including `keep` negative, per #6 — no clamping,
 *   intentional, the daemon-level caller enforces sane minimums, not this
 *   pure function) returns an empty array.
 * - `keep <= 0` selects every run for deletion (degenerate but valid).
 */
export function selectPruneTargets(runs: PruneCandidate[], keep: number): string[] {
  if (runs.length <= keep) return [];
  // Array.prototype.sort is a stable sort (ECMA-262 guarantee since ES2019) —
  // ties preserve original input-array order, which is exactly the tie-break
  // this function documents.
  const sorted = [...runs].sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  const deleteCount = sorted.length - keep;
  if (deleteCount <= 0) return [];
  return sorted.slice(0, deleteCount).map((r) => r.runId);
}
