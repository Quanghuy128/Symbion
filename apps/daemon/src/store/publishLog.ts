import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PublishLogEntry } from "@symbion/core";

export function publishLogPath(projectRoot: string): string {
  return join(projectRoot, ".symbion", "publish-log.json");
}

export function readPublishLog(projectRoot: string): PublishLogEntry[] {
  const absPath = publishLogPath(projectRoot);
  if (!existsSync(absPath)) return [];
  try {
    return JSON.parse(readFileSync(absPath, "utf-8")) as PublishLogEntry[];
  } catch {
    return [];
  }
}

/** append-only: read existing log, push the new entry, atomic-write back. */
export function appendPublishLogEntry(projectRoot: string, entry: PublishLogEntry): void {
  const absPath = publishLogPath(projectRoot);
  const existing = readPublishLog(projectRoot);
  existing.push(entry);

  mkdirSync(dirname(absPath), { recursive: true });
  const tempPath = `${absPath}.symbion-tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(existing, null, 2), "utf-8");
  renameSync(tempPath, absPath);
}
