import { parse as parseYaml } from "yaml";
import type { CanonicalArtifact, CustomField } from "../ir/types.js";

export interface FrontmatterFields {
  name?: string;
  description: string;
  tools?: string[];
  customFields?: CustomField[];
}

/**
 * serializeFrontmatter — deterministic stable key order:
 * `name`? -> `description` -> `tools`? -> custom fields (insertion order).
 * Returns the frontmatter block WITHOUT the surrounding `---` fences (caller wraps).
 */
export function serializeFrontmatter(fields: FrontmatterFields): string {
  const lines: string[] = [];

  if (fields.name !== undefined) {
    lines.push(`name: ${fields.name}`);
  }
  lines.push(`description: ${fields.description}`);
  if (fields.tools && fields.tools.length > 0) {
    lines.push(`tools: ${fields.tools.join(", ")}`);
  }
  for (const cf of fields.customFields ?? []) {
    lines.push(`${cf.key}: ${cf.value}`);
  }

  return lines.join("\n");
}

export interface ParsedFrontmatter {
  name?: string;
  description: string;
  tools?: string[];
  /** all keys outside the known set (name/description/tools), in source order. */
  customFields: CustomField[];
}

const KNOWN_KEYS = new Set(["name", "description", "tools"]);

/**
 * parseFrontmatter — parse a YAML frontmatter block (no fences) into structured fields.
 * Preserves unknown-key order for round-trip fidelity (customFields).
 * Throws on invalid YAML — caller (scan/markdown-tab) catches and surfaces E3.
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const parsed = parseYaml(raw) as Record<string, unknown> | null;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Frontmatter must be a YAML object.");
  }

  const description = parsed["description"];
  if (typeof description !== "string") {
    throw new Error("Frontmatter is missing the `description` key (string).");
  }

  let name: string | undefined;
  if (parsed["name"] !== undefined) {
    if (typeof parsed["name"] !== "string") {
      throw new Error("`name` must be a string.");
    }
    name = parsed["name"];
  }

  let tools: string[] | undefined;
  if (parsed["tools"] !== undefined) {
    const raw_ = parsed["tools"];
    if (typeof raw_ === "string") {
      tools = raw_
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else if (Array.isArray(raw_)) {
      tools = raw_.map((t) => String(t));
    } else {
      throw new Error("`tools` must be a CSV string or an array.");
    }
  }

  // Preserve order of unknown keys by re-scanning raw lines (YAML parse loses
  // original key order for some parsers; we rebuild order from the raw text).
  const customFields: CustomField[] = [];
  const orderedKeys = extractTopLevelKeyOrder(raw);
  for (const key of orderedKeys) {
    if (KNOWN_KEYS.has(key)) continue;
    const value = parsed[key];
    if (value === undefined) continue;
    customFields.push({ key, value: String(value) });
  }

  return { name, description, tools, customFields };
}

/** Extract top-level YAML mapping keys in source order (simple line scan, sufficient for our flat schema). */
function extractTopLevelKeyOrder(raw: string): string[] {
  const keys: string[] = [];
  for (const line of raw.split("\n")) {
    const match = /^([A-Za-z0-9_-]+):/.exec(line);
    if (match) {
      keys.push(match[1]!);
    }
  }
  return keys;
}

/** Build the FrontmatterFields view from a CanonicalArtifact (agent includes name+tools; command omits both). */
export function artifactToFrontmatterFields(artifact: CanonicalArtifact): FrontmatterFields {
  if (artifact.kind === "agent") {
    return {
      name: artifact.name,
      description: artifact.description,
      tools: artifact.tools,
      customFields: artifact.customFields,
    };
  }
  return {
    description: artifact.description,
    customFields: artifact.customFields,
  };
}
