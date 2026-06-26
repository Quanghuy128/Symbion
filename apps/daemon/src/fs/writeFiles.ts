import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BackupRecord, PublishResult, TargetId } from "@symbion/core";
import { rejectTraversalSegments, resolveConfinedPath } from "../rpc/guard.js";

export interface WriteFileTask {
  target: TargetId;
  relPath: string;
  content: string;
  artifactId?: string;
  contentHash: string;
  /** "overwrite" required when the diff classified this file as a conflict. */
  resolution?: "overwrite" | "keep";
  /** true if computeDiff found this file already byte-identical on disk (skip silently). */
  isSame?: boolean;
  /** true if computeDiff found this file in conflict and no explicit resolution given. */
  isUnresolvedConflict?: boolean;
}

export interface WriteFilesOptions {
  projectRoot: string;
  version: string;
  backupBeforeWrite: boolean;
}

export interface WriteFilesOutcome {
  results: PublishResult[];
  backupDir: string;
  backupRecord: BackupRecord;
}

/**
 * writeFiles — backup-before-write + atomic temp->rename, per STATE §3.5/§3.7.
 * Each file is processed independently; a failure on one file does not abort the batch
 * (partial-failure handling, E10). Conflicts without an explicit "overwrite" resolution
 * are skipped (never silently clobbered, E1).
 */
export function writeFiles(tasks: WriteFileTask[], opts: WriteFilesOptions): WriteFilesOutcome {
  const backupDirRel = join(".symbion", "backups", opts.version);
  const backupDirAbs = resolveConfinedPath(opts.projectRoot, backupDirRel);
  if (opts.backupBeforeWrite) {
    mkdirSync(backupDirAbs, { recursive: true });
  }

  const results: PublishResult[] = [];
  const backupFiles: BackupRecord["files"] = [];

  for (const task of tasks) {
    try {
      rejectTraversalSegments(task.relPath);
      const absPath = resolveConfinedPath(opts.projectRoot, task.relPath);

      if (task.isSame) {
        results.push({
          target: task.target,
          relPath: task.relPath,
          action: "skipped-same",
          artifactId: task.artifactId,
          contentHash: task.contentHash,
        });
        continue;
      }

      if (task.isUnresolvedConflict && task.resolution !== "overwrite") {
        results.push({
          target: task.target,
          relPath: task.relPath,
          action: "skipped-conflict",
          artifactId: task.artifactId,
        });
        continue;
      }

      const existedBefore = existsSync(absPath);

      if (opts.backupBeforeWrite) {
        if (existedBefore) {
          const backupRelPath = task.relPath;
          const backupAbsPath = resolveConfinedPath(backupDirAbs, backupRelPath);
          mkdirSync(dirname(backupAbsPath), { recursive: true });
          writeFileSync(backupAbsPath, readFileSync(absPath));
          backupFiles.push({ relPath: task.relPath, existedBefore: true, backupRelPath });
        } else {
          backupFiles.push({ relPath: task.relPath, existedBefore: false, backupRelPath: task.relPath });
        }
      }

      mkdirSync(dirname(absPath), { recursive: true });

      // Atomic write: temp file in the same dir, then rename over the target.
      const tempPath = `${absPath}.symbion-tmp-${process.pid}-${Date.now()}`;
      writeFileSync(tempPath, task.content, "utf-8");
      renameSync(tempPath, absPath);

      results.push({
        target: task.target,
        relPath: task.relPath,
        action: existedBefore ? "updated" : "created",
        artifactId: task.artifactId,
        contentHash: task.contentHash,
      });
    } catch (err) {
      results.push({
        target: task.target,
        relPath: task.relPath,
        action: "error",
        artifactId: task.artifactId,
        error: (err as Error).message,
      });
    }
  }

  if (backupFiles.length > 0) {
    mkdirSync(backupDirAbs, { recursive: true });
    const manifest: BackupRecord = {
      version: opts.version,
      timestamp: new Date().toISOString(),
      files: backupFiles,
    };
    writeFileSync(join(backupDirAbs, "manifest.json"), JSON.stringify(manifest, null, 2));
    return { results, backupDir: backupDirRel, backupRecord: manifest };
  }

  return {
    results,
    backupDir: backupDirRel,
    backupRecord: { version: opts.version, timestamp: new Date().toISOString(), files: [] },
  };
}
