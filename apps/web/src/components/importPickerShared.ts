/**
 * importPickerShared.ts — shared helpers for the manual file picker escape
 * hatch (docs/loops/manual-file-picker-STATE.md PLAN §4), reused by
 * FileTreePicker, ImportReviewStep, ImportDialog and CreateProjectDialog so the
 * on-demand read→classify flow and the picked-map shape live in ONE place.
 *
 * The picked-map (`Map<relPath, PickedEntry>`) is owned by each dialog — the
 * same ownership rule as today's `selected` set — but the transition logic
 * (readImportFile → classifyPickedFile → stash artifact + warning) is here so
 * both dialogs share exactly one code path (and the same code path is reused for
 * reclassifying `skipped[]` rows, PLAN §4 correction B).
 */
import { classifyPickedFile, deriveArtifactName, type CanonicalArtifact } from "@symbion/core";
import { callRpc, DaemonRpcError } from "@/lib/rpc/client";
import type { ImportBlocked, ImportRename, ReadImportFileResult } from "@/lib/rpc/types";
import type { PickedRole, PickedEntry } from "@/components/FileTreePicker";
import type { ToastVariant } from "@/lib/store/useArtifactStore";

/** Must match apps/daemon/src/fs/importTree.ts's MAX_FILE_BYTES (512 KiB). Used
 *  UI-side only to grey out oversized rows pre-read; the daemon is authoritative. */
export const MAX_FILE_KIB = 512;

export type { PickedRole, PickedEntry };

export interface ApplyRoleResult {
  entry: PickedEntry;
  /** the classified artifact, present only when role !== "ignore" AND the read
   *  succeeded. Callers stash it so importArtifacts gets the picked artifacts. */
  artifact?: CanonicalArtifact;
}

/**
 * applyPickedRole — the ONE transition for assigning a role to a picked/skipped
 * file. On "ignore" it returns a plain ignore entry (no read). On agent/command
 * it calls readImportFile(root, relPath) on demand (PLAN §4 B — no scan
 * re-slurp), then classifyPickedFile (core, pure) to build the artifact +
 * optional warning. A soft read failure (too-large/binary/not-found/denied)
 * comes back as `entry.readError` with no artifact; a confinement violation
 * throws (loud) from the RPC and propagates to the caller.
 *
 * `basename` is the file's basename (last path segment) — the artifact name is
 * derived from it via deriveArtifactName (F5).
 */
export async function applyPickedRole(
  root: string,
  relPath: string,
  basename: string,
  role: PickedRole
): Promise<ApplyRoleResult> {
  if (role === "ignore") {
    return { entry: { role: "ignore" } };
  }

  let read: ReadImportFileResult;
  try {
    read = await callRpc<{ root: string; relPath: string }, ReadImportFileResult>("readImportFile", {
      root,
      relPath,
    });
  } catch (err) {
    // Confinement violations surface as a DaemonRpcError (loud, T6/S17). Keep the
    // row selectable-but-errored so the user sees what happened.
    const message = err instanceof DaemonRpcError ? err.message : (err as Error).message;
    return { entry: { role, readError: message } };
  }

  if (!read.ok) {
    return { entry: { role, readError: read.message } };
  }

  const name = deriveArtifactName(basename);
  const { artifact, warning } = classifyPickedFile(read.content, { kind: role, name });

  return {
    entry: { role, artifactId: artifact.id, warning },
    artifact,
  };
}

/** basename of a POSIX relPath (last `/`-delimited segment). */
export function basenameOf(relPath: string): string {
  const slash = relPath.lastIndexOf("/");
  return slash < 0 ? relPath : relPath.slice(slash + 1);
}

/**
 * surfaceImportOutcome — shared toast policy for the B1/B3a import result's
 * `renames` (auto-suffixed name collisions, E20) and `blocked` (block-one-not-all
 * empty-description / lint failures, §1.4 / E5-E6). Both dialogs call this after a
 * successful createProjectAndImport so the "renamed N duplicate(s)" / "N blocked"
 * messaging lives in ONE place. Non-blocking, single-slot toast — a `blocked`
 * warning takes precedence over a plain `renames` success when both are present.
 */
export function surfaceImportOutcome(
  renames: ImportRename[] | undefined,
  blocked: ImportBlocked[] | undefined,
  showToast: (message: string, variant?: ToastVariant) => void
): void {
  const renamedCount = renames?.length ?? 0;
  const blockedCount = blocked?.length ?? 0;

  if (blockedCount > 0) {
    const names = blocked!.map((b) => b.name).join(", ");
    const renamedNote = renamedCount > 0 ? ` (renamed ${renamedCount} duplicate${renamedCount === 1 ? "" : "s"})` : "";
    showToast(
      `${blockedCount} artifact${blockedCount === 1 ? "" : "s"} not imported: ${names} — fix in Studio or deselect${renamedNote}.`,
      "warning"
    );
    return;
  }

  if (renamedCount > 0) {
    const detail = renames!.map((r) => `${r.from} → ${r.to}`).join(", ");
    showToast(`Renamed ${renamedCount} duplicate${renamedCount === 1 ? "" : "s"}: ${detail}.`, "success");
  }
}
