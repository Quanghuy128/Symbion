/**
 * layoutOverride — pure logic for the free-node-dragging feature
 * (docs/loops/free-node-dragging-STATE.md PLAN §1/§5). PURE — no fs/Node
 * import. Owns two things:
 *
 *  - `parseLayoutOverrideFile` — validates/sanitizes the on-disk
 *    `layout.json` shape (already JSON.parse'd by the daemon). Any
 *    top-level shape failure (not an object, missing `positions`, wrong
 *    `schemaVersion`) returns `{}` — "no overrides exist yet" (AC-4). A
 *    single malformed per-entry value is dropped; the rest of a valid file
 *    is honored (edge case #5). This is the SINGLE source of "what counts
 *    as a valid entry" — the daemon never duplicates this validation.
 *
 *  - `mergeLayoutPositions` — the pinned/unpinned split + merge (PLAN §5).
 *    Takes a caller-supplied `computeDagre` callback so this function has
 *    zero dependency on `@dagrejs/dagre` (a web-only dependency today) while
 *    still being fully unit-testable with a fake/deterministic layout stub.
 */

export interface LayoutOverrideEntry {
  x: number;
  y: number;
}

export interface LayoutOverrideFile {
  schemaVersion: 1;
  positions: Record<string, LayoutOverrideEntry>;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isValidEntry(v: unknown): v is LayoutOverrideEntry {
  if (typeof v !== "object" || v === null) return false;
  const rec = v as Record<string, unknown>;
  return isFiniteNumber(rec["x"]) && isFiniteNumber(rec["y"]);
}

/**
 * parseLayoutOverrideFile — given arbitrary parsed JSON (or `undefined` for
 * a missing file), returns a clean `Record<string, {x,y}>`. Never throws.
 *
 * Top-level shape failures (not an object / missing `positions` / wrong
 * `schemaVersion`) return `{}` wholesale — an unknown/future schema is
 * treated as unreadable, not partially trusted (forward-compat, per PLAN §2).
 * Per-entry validation only runs once the top-level shape is confirmed valid;
 * a single bad entry is dropped, the rest of a valid file is kept (edge case #5).
 */
export function parseLayoutOverrideFile(raw: unknown): Record<string, LayoutOverrideEntry> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const rec = raw as Record<string, unknown>;
  if (rec["schemaVersion"] !== 1) return {};
  const positionsRaw = rec["positions"];
  if (typeof positionsRaw !== "object" || positionsRaw === null || Array.isArray(positionsRaw)) return {};

  // Object.create(null): a node id equal to "__proto__" must never reassign
  // the returned record's own prototype (security-reviewer finding, /review
  // round 1) — a plain `{}` literal is vulnerable to this via bracket
  // assignment; a null-prototype object has no prototype to hijack.
  const out: Record<string, LayoutOverrideEntry> = Object.create(null);
  for (const [id, value] of Object.entries(positionsRaw as Record<string, unknown>)) {
    if (!isValidEntry(value)) continue;
    out[id] = { x: value.x, y: value.y };
  }
  return out;
}

export interface MergeLayoutPositionsInput {
  nodeIds: string[];
  overrides: Record<string, LayoutOverrideEntry>;
  computeDagre: (unpinnedIds: string[]) => Map<string, LayoutOverrideEntry>;
}

/**
 * mergeLayoutPositions — split `nodeIds` into pinned (has a valid override)
 * and unpinned (everything else) sets. `computeDagre` is called ONLY with the
 * unpinned subset (PLAN §5's "as if manually-positioned nodes weren't there"
 * resolution of STATE edge case #2) — pinned nodes are structurally
 * incapable of moving as a result of this call.
 *
 * Contract for edge cases (pinned per testplan §1.2):
 *  - An override key present in `overrides` but ABSENT from `nodeIds` (a
 *    deleted artifact's orphaned entry) is silently ignored — it never
 *    appears in the result and never affects `computeDagre`'s input.
 *  - If `computeDagre` returns a Map missing an entry for one of the
 *    unpinned ids it was asked about, that id is simply omitted from the
 *    result (never a thrown error, never a synthesized `{x:0,y:0}`) — the
 *    caller/leaf position-merge logic already has its own fallback for a
 *    missing position (`positions.get(id) ?? n.position` in
 *    DependencyGraph.tsx), so this function does not invent one.
 *  - Empty `nodeIds` → empty result; `computeDagre` is still called with `[]`
 *    (uniform behavior, no special-cased early return).
 */
export function mergeLayoutPositions({
  nodeIds,
  overrides,
  computeDagre,
}: MergeLayoutPositionsInput): Map<string, LayoutOverrideEntry> {
  const pinnedIds: string[] = [];
  const unpinnedIds: string[] = [];
  for (const id of nodeIds) {
    if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      pinnedIds.push(id);
    } else {
      unpinnedIds.push(id);
    }
  }

  const dagrePositions = computeDagre(unpinnedIds);

  const result = new Map<string, LayoutOverrideEntry>();
  for (const id of pinnedIds) {
    const override = overrides[id];
    if (override) result.set(id, override);
  }
  for (const id of unpinnedIds) {
    const pos = dagrePositions.get(id);
    if (pos) result.set(id, pos);
  }
  return result;
}
