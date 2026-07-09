import type { ArtifactKind, CanonicalArtifact } from "../ir/types.js";
import { parseFrontmatter } from "../render/frontmatter.js";
import { parseMarker } from "../render/marker.js";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export interface ParsedClaudeFile {
  artifact: CanonicalArtifact;
}

/**
 * parseClaudeFile — parse a single `.md` file's raw content into a CanonicalArtifact.
 * `name` and `kind` are derived from the file's relative path (filename = name; directory
 * (agents/ vs commands/) determines kind) per STATE §2.5 / E4 (filename always derived from name on render,
 * but on import the filename IS the source of truth for name).
 *
 * Throws on invalid frontmatter — caller (scanClaudeDir / markdown-tab sync) catches this for E3.
 */
export function parseClaudeFile(
  raw: string,
  opts: { name: string; kind: ArtifactKind; id?: string; nowIso?: string }
): CanonicalArtifact {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    throw new Error("File is missing frontmatter (--- ... ---).");
  }
  const [, fmRaw, bodyRaw] = match;

  const fm = parseFrontmatter(fmRaw!);

  // Strip any trailing managed marker from the body before storing as IR body.
  const marker = parseMarker(raw);
  let body = (bodyRaw ?? "").replace(/\n*<!--\s*managed-by:[\s\S]*?-->\s*$/, "");
  body = body.replace(/\n+$/, "").replace(/^\n+/, "");

  const now = opts.nowIso ?? new Date().toISOString();

  const artifact: CanonicalArtifact = {
    id: marker?.id ?? opts.id ?? cryptoRandomId(),
    kind: opts.kind,
    name: opts.name,
    description: fm.description,
    body,
    meta: {
      version: marker?.version ?? "draft",
      status: marker ? "published" : "draft",
      createdAt: now,
      updatedAt: now,
    },
  };

  if (opts.kind === "agent" && fm.tools) {
    artifact.tools = fm.tools;
  }
  if (opts.kind === "command") {
    artifact.usesArguments = body.includes("$ARGUMENTS");
  }
  if (fm.customFields.length > 0) {
    artifact.customFields = fm.customFields;
  }

  return artifact;
}

/** Minimal dependency-free random id generator (UUID v4-ish) — pure, no Node `crypto`. */
function cryptoRandomId(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const tpl = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  let i = 0;
  return tpl.replace(/[xy]/g, (c) => {
    i++;
    if (c === "y") {
      return ((Math.floor(Math.random() * 4) + 8) % 16).toString(16);
    }
    return hex();
  });
}

export interface SkippedFile {
  relPath: string;
  reason: string;
}

export interface ParsedClaudeDir {
  agents: CanonicalArtifact[];
  commands: CanonicalArtifact[];
  /** read-only in v1 — file contents passed through for display only. */
  hooks: Array<{ relPath: string; content: string }>;
  settings?: { relPath: string; content: string };
  skipped: SkippedFile[];
}

export interface ClaudeDirFileMap {
  /** relPath (e.g. ".claude/agents/ba.md") -> file content */
  [relPath: string]: string;
}

const AGENT_PATH_RE = /^\.claude\/agents\/([^/]+)\.md$/;
const COMMAND_PATH_RE = /^\.claude\/commands\/([^/]+)\.md$/;
const HOOK_PATH_RE = /^\.claude\/hooks\/(.+)$/;
const SETTINGS_PATH_RE = /^\.claude\/settings\.json$/;

/**
 * parseClaudeDir — pure: given a filemap of relPath -> content (daemon reads disk
 * and passes contents in), parse into IR. Unparseable files land in `skipped[]`
 * with a human reason (E3), never thrown.
 */
export function parseClaudeDir(filemap: ClaudeDirFileMap): ParsedClaudeDir {
  const agents: CanonicalArtifact[] = [];
  const commands: CanonicalArtifact[] = [];
  const hooks: Array<{ relPath: string; content: string }> = [];
  const skipped: SkippedFile[] = [];
  let settings: { relPath: string; content: string } | undefined;

  for (const [relPath, content] of Object.entries(filemap)) {
    const agentMatch = AGENT_PATH_RE.exec(relPath);
    const commandMatch = COMMAND_PATH_RE.exec(relPath);
    const hookMatch = HOOK_PATH_RE.exec(relPath);
    const settingsMatch = SETTINGS_PATH_RE.exec(relPath);

    if (agentMatch) {
      try {
        agents.push(parseClaudeFile(content, { name: agentMatch[1]!, kind: "agent" }));
      } catch (err) {
        skipped.push({ relPath, reason: (err as Error).message });
      }
    } else if (commandMatch) {
      try {
        commands.push(parseClaudeFile(content, { name: commandMatch[1]!, kind: "command" }));
      } catch (err) {
        skipped.push({ relPath, reason: (err as Error).message });
      }
    } else if (hookMatch) {
      hooks.push({ relPath, content });
    } else if (settingsMatch) {
      settings = { relPath, content };
    } else {
      skipped.push({ relPath, reason: "Could not recognize the file type." });
    }
  }

  return { agents, commands, hooks, settings, skipped };
}
