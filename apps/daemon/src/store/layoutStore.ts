/**
 * layoutStore — `.symbion/<project>/layout.json` persistence for the
 * free-node-dragging feature (docs/loops/free-node-dragging-STATE.md PLAN
 * §2/§3/§8). Mirrors `runStore.ts`'s established path-confinement + atomic
 * write conventions:
 *
 *  - every path goes through `resolveConfinedPath` (never a hand-rolled join)
 *  - the write is mkdir-recursive + atomic temp-then-rename via the SAME
 *    shared `atomicWriteJson` primitive `store.json`/`run.json` already use
 *    (one write-primitive, not two)
 *  - a missing or corrupt `layout.json` is treated as "no overrides exist
 *    yet" ({}) on BOTH the read path and the read-half of a read-modify-write
 *    — never throws for this case (AC-4)
 *
 * Deliberate deviation from CLAUDE.md's literal backup-before-write rule
 * (PLAN §8, flagged for `/cso` to explicitly confirm or override): unlike
 * `writeFiles.ts`'s managed-file overwrite path, `layout.json` is NOT
 * backed up before each write. Justification: this file holds zero canonical
 * IR content (commands/agents are untouched) — worst-case loss from an
 * unbacked-up overwrite is "some manually-dragged nodes revert to dagre
 * auto-layout," not data loss of authored content. This mirrors the existing
 * precedent that `store.json`'s own routine `saveProjectStore` calls (every
 * artifact save) do NOT back up either — only the explicit delete path does.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLayoutOverrideFile, type LayoutOverrideEntry, type LayoutOverrideFile } from "@symbion/core";
import { atomicWriteJson } from "./store.js";
import { resolveConfinedPath, PathConfinementError } from "../rpc/guard.js";
import { RpcError } from "../rpc/rpcError.js";

const LAYOUT_REL_PATH = join(".symbion", "layout.json");

function layoutPathAbs(projectRoot: string): string {
  try {
    return resolveConfinedPath(projectRoot, LAYOUT_REL_PATH);
  } catch (err) {
    if (err instanceof PathConfinementError) throw new RpcError("path-confinement", err.message);
    throw err;
  }
}

/**
 * readLayout — reads + validates `.symbion/<project>/layout.json`. Missing
 * file, unparsable JSON, or a `parseLayoutOverrideFile`-rejected top-level
 * shape all resolve to `{}` — never throws (AC-4). A path-confinement
 * violation (defense-in-depth; not reachable via a normal `projectId`-scoped
 * call) still throws.
 */
export function readLayout(projectRoot: string): Record<string, LayoutOverrideEntry> {
  const abs = layoutPathAbs(projectRoot);
  if (!existsSync(abs)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, "utf-8"));
  } catch {
    return {}; // corrupt JSON — treated as "no overrides exist yet".
  }
  return parseLayoutOverrideFile(raw);
}

/**
 * writeLayoutEntry — single-node upsert (not a bulk replace). Reads the
 * current file (tolerating corruption exactly like `readLayout` — a corrupt
 * existing file is treated as `{}`, NOT an error that blocks the write),
 * sets/overwrites the one `nodeId` entry, and atomically writes the whole
 * file back. Returns the full updated map.
 *
 * `nodeId` is never used to construct a filesystem path (unlike `runId` in
 * runStore.ts) — it is only ever a JSON object key inside this one, fixed-name
 * file, so there is no path-injection surface for it at all.
 */
export function writeLayoutEntry(
  projectRoot: string,
  nodeId: string,
  position: LayoutOverrideEntry
): Record<string, LayoutOverrideEntry> {
  const abs = layoutPathAbs(projectRoot);
  const current = readLayout(projectRoot);
  const updated: Record<string, LayoutOverrideEntry> = { ...current, [nodeId]: position };

  // mkdir-recursive before the write — a never-before-persisted-anything
  // project has no `.symbion/` dir yet (edge case #8); atomicWriteJson's own
  // mkdirSync(dir, {recursive:true}) already covers this, kept explicit here
  // via the shared primitive rather than a second mkdir call.
  const file: LayoutOverrideFile = { schemaVersion: 1, positions: updated };
  atomicWriteJson(abs, file);
  return updated;
}

// Note: a never-before-persisted-anything project (no `.symbion/` dir yet,
// edge case #8) is handled by `atomicWriteJson`'s own
// `mkdirSync(dirname(absPath), {recursive:true})` — no separate mkdir/ensure-
// dir helper is needed here (unlike runStore.ts's `ensureRunsDir`, which also
// writes a self-ignoring `.gitignore`; `layout.json` needs no such sibling file).
