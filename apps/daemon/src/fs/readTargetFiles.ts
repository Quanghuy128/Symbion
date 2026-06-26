import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolveConfinedPath } from "../rpc/guard.js";

export interface OnDiskFile {
  relPath: string;
  content?: string;
  isMergedTarget?: boolean;
}

/**
 * readTargetFiles — read the on-disk content of a fixed list of relPaths (the
 * relPaths a render pass is about to manage), for diffing. Absent files come
 * back with `content: undefined` (status "new" downstream). `mergedTargetRelPaths`
 * flags relPaths belonging to merged/lossy targets (e.g. AGENTS.md) whose render
 * already spliced in any pre-existing foreign content (STATE §3.3).
 */
export function readTargetFiles(
  projectRoot: string,
  relPaths: string[],
  mergedTargetRelPaths: Set<string> = new Set()
): OnDiskFile[] {
  return relPaths.map((relPath) => {
    const isMergedTarget = mergedTargetRelPaths.has(relPath);
    try {
      const absPath = resolveConfinedPath(projectRoot, relPath);
      if (!existsSync(absPath)) {
        return { relPath, isMergedTarget };
      }
      return { relPath, content: readFileSync(absPath, "utf-8"), isMergedTarget };
    } catch {
      return { relPath, isMergedTarget };
    }
  });
}

/** Read all files under `.claude/agents`, `.claude/commands`, `.claude/hooks`, `.claude/settings.json` for scanClaudeDir. */
export function readClaudeDirFilemap(projectRoot: string): Record<string, string> {
  const filemap: Record<string, string> = {};

  const readDir = (relDir: string) => {
    const absDir = resolveConfinedPath(projectRoot, relDir);
    if (!existsSync(absDir)) return;
    for (const entry of readdirSync(absDir)) {
      const relPath = `${relDir}/${entry}`;
      const absPath = resolveConfinedPath(projectRoot, relPath);
      if (statSync(absPath).isFile()) {
        filemap[relPath] = readFileSync(absPath, "utf-8");
      }
    }
  };

  readDir(".claude/agents");
  readDir(".claude/commands");
  readDir(".claude/hooks");

  const settingsRel = ".claude/settings.json";
  try {
    const absSettings = resolveConfinedPath(projectRoot, settingsRel);
    if (existsSync(absSettings)) {
      filemap[settingsRel] = readFileSync(absSettings, "utf-8");
    }
  } catch {
    // ignore
  }

  return filemap;
}

/** Read the existing AGENTS.md content (for Codex foreign-content preservation), or undefined if absent. */
export function readAgentsMd(projectRoot: string): string | undefined {
  try {
    const absPath = resolveConfinedPath(projectRoot, "AGENTS.md");
    if (!existsSync(absPath)) return undefined;
    return readFileSync(absPath, "utf-8");
  } catch {
    return undefined;
  }
}

/** Extract the foreign (non-managed-region) portion of an existing AGENTS.md, for splicing. */
export function extractForeignAgentsMdContent(content: string | undefined): string | undefined {
  if (!content) return undefined;
  const startIdx = content.indexOf("<!-- managed-by: symbion region-start");
  if (startIdx === -1) return content; // entire file is foreign (no prior managed region)
  return content.slice(0, startIdx).trimEnd();
}
