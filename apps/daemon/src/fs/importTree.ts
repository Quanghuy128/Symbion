/**
 * importTree.ts — the ONLY disk toucher for the manual file picker
 * (docs/loops/manual-file-picker-STATE.md PLAN §1/§5). Two READ-ONLY functions:
 *
 *  - walkImportTree(root)     — eager, metadata-only recursive walk (dirs +
 *                               files, NO content), hard-capped per §5. Flat
 *                               node list, parent-before-child order.
 *  - readImportFile(root, rel)— lazy single-file read: confine → size cap →
 *                               bounded read → binary check → soft result.
 *
 * SAFETY (the /cso checklist, §5): path confinement, `..`/absolute rejection,
 * symlink-escape rejection, symlink-cycle-by-construction (never follow dir
 * symlinks), depth/per-dir/total-node caps, max-file-size on read, binary
 * rejection, an ignore-list, and a hard read-only guarantee (NO write/create/
 * rename/delete/chmod verbs appear in this file). Caps are constants, not
 * client params, so a crafted client cannot raise them.
 */
import {
  accessSync,
  constants,
  lstatSync,
  openSync,
  readSync,
  closeSync,
  opendirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, relative } from "node:path";
import { isProbablyBinary } from "@symbion/core";
import { resolveConfinedPath, rejectTraversalSegments, PathConfinementError } from "../rpc/guard.js";
import { isWindowsStyleAbsolute } from "../rpc/pathStyle.js";
import { RpcError } from "../rpc/rpcError.js";
import type {
  ImportTreeNode,
  ListTreeResult,
  ReadImportFileResult,
} from "../rpc/contract.js";

// ── Safety caps (§5). Daemon-side CONSTANTS — never client-overridable. ──────
export const MAX_DEPTH = 8;
export const MAX_ENTRIES_PER_DIR = 500;
export const MAX_TOTAL_NODES = 5000;
export const MAX_FILE_BYTES = 512 * 1024; // 512 KiB
/** Bounded prefix read for the binary heuristic (never reads the whole file for the check). */
export const BINARY_SNIFF_BYTES = 8 * 1024;

/** Directory names pruned (never descended) at any depth (§5.11). Shown in the
 *  tree as collapsed `ignored:true` markers so the user sees why something is
 *  missing, but their contents are never walked. */
export const IGNORE_DIR_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  "out",
  ".turbo",
  ".cache",
  ".symbion",
  ".venv",
  "vendor",
  "target",
]);

/** File extensions the walker flags as likely-binary (defense-in-depth; the
 *  authoritative check is isProbablyBinary on read). Lowercased, with dot. */
const LIKELY_BINARY_EXTS: ReadonlySet<string> = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff",
  ".pdf", ".zip", ".gz", ".tar", ".tgz", ".7z", ".rar",
  ".wasm", ".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".a",
  ".mp3", ".mp4", ".mov", ".avi", ".wav", ".ogg", ".flac",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".class", ".jar", ".pyc", ".node",
]);

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot).toLowerCase();
}

interface WalkState {
  nodes: ImportTreeNode[];
  reasons: Set<"depth" | "per-dir" | "total-node">;
  realRoot: string;
}

/**
 * walkImportTree — eager metadata walk of `root`. Validates `root` (must exist,
 * be a directory, be readable) then recurses, enforcing every cap in §5. Never
 * follows directory symlinks (cycle-proof by construction, §5.5). Never reads
 * file content.
 */
export function walkImportTree(root: unknown): ListTreeResult {
  if (typeof root !== "string" || root.length === 0 || !isAbsolute(root)) {
    throw new RpcError("invalid-params", "root must be an absolute path.");
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    throw new RpcError("invalid-path", "root does not exist or is not a directory.");
  }

  let rootStat;
  try {
    rootStat = statSync(realRoot);
  } catch {
    throw new RpcError("invalid-path", "root does not exist or is not a directory.");
  }
  if (!rootStat.isDirectory()) {
    throw new RpcError("invalid-path", "root does not exist or is not a directory.");
  }

  const state: WalkState = {
    nodes: [],
    reasons: new Set(),
    realRoot,
  };

  walkDir(realRoot, "", 0, state);

  return {
    root: realRoot,
    nodes: state.nodes,
    truncated: state.reasons.size > 0,
    truncatedReasons: [...state.reasons],
  };
}

/**
 * walkDir — recurse into `absDir` (which lives at `relDir` below root, at depth
 * `depth`). `relDir` is "" for the root. Emits a node for each child in
 * parent-before-child order. Returns early once the total-node cap is reached.
 */
function walkDir(absDir: string, relDir: string, depth: number, state: WalkState): void {
  if (state.nodes.length >= MAX_TOTAL_NODES) {
    state.reasons.add("total-node");
    return;
  }

  // F2 fix: bound BOTH readdir + sort work, not just the emitted-node count.
  // We iterate an opendir handle and stop after reading MAX_ENTRIES_PER_DIR+1
  // dirents, so a pathological 1e6-entry dir costs O(cap), not O(N)+O(N log N).
  // The +1 sentinel lets us detect that the dir had more entries than the cap
  // (→ mark "per-dir" truncated). Only the bounded slice is sorted afterwards.
  // Trade-off: the kept entries are the first `cap` in FILESYSTEM order (then
  // name-sorted for display), not the alphabetically-first `cap` of the whole
  // dir — an acceptable change for a DoS-capped browse (documented in STATE F2).
  const dirents: Array<{ name: string; isSymbolicLink: boolean; isDirectory: boolean; isFile: boolean }> = [];
  let hadMore = false;
  let dir;
  try {
    // R_OK gate first so an ACL'd dir is tolerated (§5, E8) rather than throwing.
    accessSync(absDir, constants.R_OK);
    dir = opendirSync(absDir);
  } catch {
    // Permission-denied / race — tolerate, like listDir. The dir node itself was
    // already emitted by the caller; we simply don't descend.
    return;
  }
  try {
    let entry;
    while ((entry = dir.readSync()) !== null) {
      if (dirents.length >= MAX_ENTRIES_PER_DIR) {
        hadMore = true; // at least one more entry exists beyond the cap.
        break;
      }
      dirents.push({
        name: entry.name,
        isSymbolicLink: entry.isSymbolicLink(),
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      });
    }
  } catch {
    // Read error mid-iteration — tolerate; keep whatever we already collected.
  } finally {
    try {
      dir.closeSync();
    } catch {
      /* ignore */
    }
  }

  if (hadMore) {
    // The dir has more than MAX_ENTRIES_PER_DIR entries — remaining ones dropped (§5.7).
    state.reasons.add("per-dir");
  }

  // Deterministic display order over the bounded slice (≤ cap entries) so the
  // tree renders stably. Sorting only the capped slice keeps this O(cap log cap).
  dirents.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  for (const dirent of dirents) {
    if (state.nodes.length >= MAX_TOTAL_NODES) {
      state.reasons.add("total-node");
      return;
    }

    const name = dirent.name;
    const relPath = relDir === "" ? name : `${relDir}/${name}`;
    const absPath = `${absDir}/${name}`;

    // Classify the entry. We use lstat semantics (do not follow symlinks) so a
    // symlinked dir is treated as a leaf, never descended (§5.5 cycle-proofing).
    const isSymlink = dirent.isSymbolicLink;

    if (isSymlink) {
      // Determine whether the symlink points at a dir or a file (for display),
      // WITHOUT following it into the walk. A symlink whose realpath escapes the
      // root is excluded entirely (§5.4 / S7).
      let targetIsDir = false;
      let targetSize: number | undefined;
      let escapes = false;
      try {
        const real = realpathSync(absPath);
        const rel = relative(state.realRoot, real);
        if (rel.startsWith("..") || isAbsolute(rel)) {
          escapes = true;
        } else {
          const st = statSync(absPath); // follows the link, but only to read type/size for display
          targetIsDir = st.isDirectory();
          if (!targetIsDir) targetSize = st.size;
        }
      } catch {
        // broken symlink → exclude entirely (nothing to import/browse).
        continue;
      }
      if (escapes) continue; // §5.4: escaping symlink is never emitted.

      if (targetIsDir) {
        // Emitted as a leaf: isDir true so the UI shows it as a folder, but we
        // never descend (no children emitted) → cycle-proof (§5.5).
        state.nodes.push({ relPath, name, isDir: true, isSymlink: true });
      } else {
        state.nodes.push({
          relPath,
          name,
          isDir: false,
          isSymlink: true,
          size: targetSize,
          likelyBinary: LIKELY_BINARY_EXTS.has(extOf(name)),
        });
      }
      continue;
    }

    if (dirent.isDirectory) {
      if (IGNORE_DIR_NAMES.has(name)) {
        // Ignored dir: emit a collapsed marker, never descend (§5.11).
        state.nodes.push({ relPath, name, isDir: true, isSymlink: false, ignored: true });
        continue;
      }
      state.nodes.push({ relPath, name, isDir: true, isSymlink: false });

      // `depth` here is the depth of the CURRENT dir (root = 0); this child dir
      // sits at `depth + 1` levels below root (its relPath has `depth + 1`
      // segments). We only descend when the child is shallower than MAX_DEPTH,
      // so the deepest node ever emitted has exactly MAX_DEPTH segments (§5.6).
      const childDepth = depth + 1;
      if (childDepth >= MAX_DEPTH) {
        // Descending would emit grandchildren at MAX_DEPTH + 1 — cap here.
        state.reasons.add("depth");
        continue;
      }
      walkDir(absPath, relPath, childDepth, state);
      continue;
    }

    if (dirent.isFile) {
      let size: number | undefined;
      try {
        size = lstatSync(absPath).size;
      } catch {
        size = undefined;
      }
      state.nodes.push({
        relPath,
        name,
        isDir: false,
        isSymlink: false,
        size,
        likelyBinary: LIKELY_BINARY_EXTS.has(extOf(name)),
      });
      continue;
    }

    // Sockets / FIFOs / devices etc. — not browsable, skip silently.
  }
}

/**
 * readImportFile — lazy single-file read for a picked/skipped file (§5.9/§5.10).
 * `resolveConfinedPath` enforces confinement + `..`/absolute/symlink-escape and
 * THROWS PathConfinementError on any violation (mapped to an RpcError so it
 * surfaces LOUD, not a soft skip — T6/S17). Expected outcomes
 * (too-large/binary/not-found/denied) return a soft discriminated result.
 */
export function readImportFile(root: unknown, relPath: unknown): ReadImportFileResult {
  if (typeof root !== "string" || root.length === 0 || !isAbsolute(root)) {
    throw new RpcError("invalid-params", "root must be an absolute path.");
  }
  if (typeof relPath !== "string" || relPath.length === 0) {
    throw new RpcError("invalid-params", "relPath must be a non-empty relative path.");
  }
  // Reject absolute relPath (POSIX + Windows) and `..` segments up front, LOUD
  // (S4/S5/S1–S3) — resolveConfinedPath also enforces these, but we surface a
  // precise RpcError rather than leaking the internal PathConfinementError name.
  if (isAbsolute(relPath) || isWindowsStyleAbsolute(relPath)) {
    throw new RpcError("path-confinement", `Absolute paths are not allowed: ${relPath}`);
  }

  let absPath: string;
  try {
    rejectTraversalSegments(relPath);
    absPath = resolveConfinedPath(root, relPath);
  } catch (err) {
    if (err instanceof PathConfinementError) {
      // Confinement violation is an attack/bug, not an expected outcome → THROW.
      throw new RpcError("path-confinement", err.message);
    }
    throw err;
  }

  // Defense-in-depth FINAL-TARGET check (F1 fix): confirm the fully-resolved
  // real path of `absPath` is still inside `root` BEFORE any stat/open follows
  // a symlink. resolveConfinedPath now also checks the leaf, but we re-assert it
  // here so this reader is self-protecting regardless of guard internals — a
  // leaf-file symlink (e.g. root/hostname → /etc/hostname) MUST throw loud
  // (S6 leaf-case), never be read. A not-yet-resolvable path (ENOENT — the file
  // or a broken symlink target does not exist) falls through to the soft
  // not-found result below, not a hard throw.
  try {
    const realRoot = realpathSync(root);
    const realTarget = realpathSync(absPath);
    const relTarget = relative(realRoot, realTarget);
    if (relTarget.startsWith("..") || isAbsolute(relTarget)) {
      throw new RpcError("path-confinement", `Path escapes the project root: ${relPath}`);
    }
  } catch (err) {
    if (err instanceof RpcError) throw err; // confinement violation → stays loud.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return { ok: false, reason: "denied", message: "Permission denied reading this file." };
    }
    // ENOENT / broken symlink / target gone → soft not-found (not a throw).
    return { ok: false, reason: "not-found", message: "File not found." };
  }

  // Stat (follows symlinks): both resolveConfinedPath's leaf check and the
  // final-target realpath check above have already rejected any symlink pointing
  // outside root, so a follow here is safe. We just classify + size-cap.
  let st;
  try {
    st = statSync(absPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return { ok: false, reason: "denied", message: "Permission denied reading this file." };
    }
    return { ok: false, reason: "not-found", message: "File not found." };
  }

  if (!st.isFile()) {
    return { ok: false, reason: "not-found", message: "Not a regular file." };
  }
  if (st.size > MAX_FILE_BYTES) {
    // §5.9: never read an unbounded file into memory — reject on the stat size.
    return {
      ok: false,
      reason: "too-large",
      message: `File is larger than ${Math.round(MAX_FILE_BYTES / 1024)} KiB and cannot be imported.`,
    };
  }

  // Read a bounded prefix for the binary heuristic (§5.10) — never the whole
  // file for the check. If it looks binary, reject before reading the rest.
  const fd = openSync(absPath, "r");
  try {
    const sniffLen = Math.min(BINARY_SNIFF_BYTES, st.size);
    const sniff = Buffer.allocUnsafe(sniffLen);
    let read = 0;
    if (sniffLen > 0) {
      read = readSync(fd, sniff, 0, sniffLen, 0);
    }
    if (isProbablyBinary(sniff.subarray(0, read))) {
      return { ok: false, reason: "binary", message: "File appears to be binary and cannot be imported." };
    }

    // Passed the sniff — read the full (already size-capped) file.
    const buf = Buffer.allocUnsafe(st.size);
    let total = 0;
    while (total < st.size) {
      const n = readSync(fd, buf, total, st.size - total, total);
      if (n <= 0) break;
      total += n;
    }
    return { ok: true, content: buf.subarray(0, total).toString("utf-8") };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return { ok: false, reason: "denied", message: "Permission denied reading this file." };
    }
    return { ok: false, reason: "not-found", message: "File could not be read." };
  } finally {
    closeSync(fd);
  }
}
