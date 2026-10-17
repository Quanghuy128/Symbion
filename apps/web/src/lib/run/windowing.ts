/**
 * windowing — pure virtualization math for the transcript / raw lists
 * (workflow-agent-run D-6: no virtualization dependency).
 *
 * Rows are uniform (`rowH`) except a handful of expanded ones whose measured
 * height overrides the default. `computeOffsets` builds prefix sums
 * (offsets[i] = top of row i, offsets[count] = total height) in O(n);
 * `computeWindow` binary-searches the visible range plus overscan.
 */

/** offsets.length === count + 1; offsets[count] is the total height. */
export function computeOffsets(count: number, rowH: number, measured?: ReadonlyMap<number, number>): Float64Array {
  const n = Math.max(0, Math.floor(count));
  const offsets = new Float64Array(n + 1);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    offsets[i] = acc;
    const m = measured?.get(i);
    acc += m !== undefined && Number.isFinite(m) && m > 0 ? m : rowH;
  }
  offsets[n] = acc;
  return offsets;
}

/** index of the row containing pixel `y` (clamped to [0, count-1]). */
function rowAt(offsets: Float64Array, y: number): number {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Visible half-open range [start, end) including `overscan` rows each side. */
export function computeWindow(
  offsets: Float64Array,
  scrollTop: number,
  viewportH: number,
  overscan = 10
): { start: number; end: number } {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0 };
  const top = Math.max(0, scrollTop);
  const bottom = top + Math.max(0, viewportH);
  const first = rowAt(offsets, top);
  const last = rowAt(offsets, Math.max(top, bottom - 0.5));
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, last + 1 + overscan),
  };
}
