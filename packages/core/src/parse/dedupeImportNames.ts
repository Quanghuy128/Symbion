/**
 * dedupeImportNames — PURE core fn (no fs/net/Node) that resolves (kind,name)
 * collisions in an import BATCH against the existing store AND within the batch
 * itself, using the same auto-suffix policy as applyTemplate (first free
 * `name`, `name-2`, `name-3`, …). Scoped per (kind, name) exactly like
 * validate.ts's `name-duplicate` rule, so the suffixing and the lint rule it
 * dodges stay in lockstep by construction.
 *
 * See docs/loops/import-lifecycle-fixes-STATE.md PLAN §1.1.
 */
import type { CanonicalArtifact } from "../ir/types.js";

export interface DedupeRename {
  /** id of the artifact that was renamed (preserved — only `name` changed). */
  id: string;
  /** the original (colliding) name. */
  from: string;
  /** the free name it was bumped to (`from-2`, `from-3`, …). */
  to: string;
}

export interface DedupeResult {
  /** incoming artifacts, with colliding names rewritten to name-2/-3/… (shallow
   *  clones — the input `incoming` array + its elements are never mutated). */
  deduped: CanonicalArtifact[];
  /** audit trail for the UI/log: which artifact ids were renamed and to what. */
  renames: DedupeRename[];
}

/**
 * dedupeImportNames — resolve (kind,name) collisions in an import batch.
 *
 * Order-determinism: `incoming` is processed in ARRAY ORDER. The FIRST artifact
 * to claim a given (kind,name) keeps the bare name; each later collision (from
 * the existing store OR an earlier batch member) is bumped to the next free
 * suffix. Names already present in `existing` are pre-seeded as claimed, so a
 * batch name never collides with a stored one either.
 *
 * IMPORTANT (E19 idempotent re-import): the caller MUST seed `existing` with the
 * store artifacts EXCLUDING the ids being (re-)imported, so a plain re-import of
 * an already-stored artifact does NOT see its own stored name as a collision and
 * wrongly bump `ba` → `ba-2`. See handlers.ts importArtifacts wiring.
 *
 * PURE — ids are preserved; only `name` may change, and only on a shallow clone.
 */
export function dedupeImportNames(
  existing: CanonicalArtifact[],
  incoming: CanonicalArtifact[]
): DedupeResult {
  // claimed: kind -> Set<name>. Seeded from the existing store.
  const claimed = new Map<string, Set<string>>();
  const claim = (kind: string, name: string): void => {
    let set = claimed.get(kind);
    if (!set) {
      set = new Set<string>();
      claimed.set(kind, set);
    }
    set.add(name);
  };
  const isClaimed = (kind: string, name: string): boolean =>
    claimed.get(kind)?.has(name) ?? false;

  for (const art of existing) {
    claim(art.kind, art.name);
  }

  const deduped: CanonicalArtifact[] = [];
  const renames: DedupeRename[] = [];

  for (const art of incoming) {
    const base = art.name;
    let final = base;
    let n = 2;
    // Suffix format matches applyTemplate (handlers.ts): `${base}-${n}` from n=2.
    while (isClaimed(art.kind, final)) {
      final = `${base}-${n}`;
      n++;
    }

    if (final !== base) {
      renames.push({ id: art.id, from: base, to: final });
      // Shallow clone — never mutate the caller's input artifact.
      deduped.push({ ...art, name: final });
    } else {
      deduped.push(art);
    }

    claim(art.kind, final);
  }

  return { deduped, renames };
}
