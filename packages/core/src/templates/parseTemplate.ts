import { parseFrontmatter } from "../render/frontmatter.js";

/** Three-valued kind for the template GALLERY only — deliberately separate from
 *  `ArtifactKind` ("agent" | "command"), which stays unchanged (PLAN §5 assumption #5).
 *  Do not conflate these two types: one is the persisted IR's artifact kind, the
 *  other is the template gallery's display/eligibility category. */
export type TemplateKind = "agent" | "command" | "skill";

export interface ParsedTemplateContent {
  kind: TemplateKind;
  /**
   * Frontmatter `name` for agent/skill templates. Deliberately ABSENT for
   * command templates — matching the existing IR convention (see
   * render/frontmatter.ts `artifactToFrontmatterFields` and parse/scan.ts's
   * documented contract): command name is always derived from the filename
   * (here: the manifest's template id slug), never frontmatter. Callers that
   * need a display name for a command template must derive it themselves
   * (the manifest loader does this from `source.mod.id`).
   */
  name?: string;
  description: string;
  tools?: string[];
  body: string;
}

export type ParseTemplateResult =
  | { ok: true; parsed: ParsedTemplateContent }
  | { ok: false; reason: string };

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/**
 * parseTemplateMarkdown — parses ONE bundled template file's raw text
 * (frontmatter + body) into a ParsedTemplateContent. Pure, throws never —
 * same "skip with reason" discipline as parseClaudeDir/parseClaudeFile.
 *
 * `expectedKind` comes from the template's manifest folder (skills/agents/commands),
 * not re-derived from content, so a misplaced file fails loudly via a mismatch
 * reason rather than silently filing under the wrong section.
 *
 * Reuses the existing `parseFrontmatter` primitive from render/frontmatter.ts —
 * no second YAML-ish parser invented for this smaller, marker-free shape.
 */
export function parseTemplateMarkdown(raw: string, expectedKind: TemplateKind): ParseTemplateResult {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return { ok: false, reason: "File is missing frontmatter (--- ... ---)." };
  }
  const [, fmRaw, bodyRaw] = match;

  let fm;
  try {
    fm = parseFrontmatter(fmRaw ?? "");
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  // Only agent (and skill) templates require frontmatter `name`. Command
  // templates never carry `name` in frontmatter — the command's name is
  // always derived from its filename/manifest id, per the existing IR
  // convention (render/frontmatter.ts, parse/scan.ts). Requiring it here for
  // commands would reject every correctly-authored command template.
  if (expectedKind === "agent" && (!fm.name || fm.name.trim().length === 0)) {
    return { ok: false, reason: "Frontmatter is missing 'name'." };
  }
  if (!fm.description || fm.description.trim().length === 0) {
    return { ok: false, reason: "Frontmatter is missing 'description'." };
  }

  const body = (bodyRaw ?? "").replace(/\n+$/, "").replace(/^\n+/, "");
  if (body.length === 0) {
    return { ok: false, reason: "Body (content after frontmatter) is empty." };
  }

  const parsed: ParsedTemplateContent = {
    kind: expectedKind,
    description: fm.description.trim(),
    body,
  };
  if (fm.name && fm.name.trim().length > 0) {
    parsed.name = fm.name.trim();
  }
  if (expectedKind === "agent" && fm.tools && fm.tools.length > 0) {
    parsed.tools = fm.tools;
  }

  return { ok: true, parsed };
}
