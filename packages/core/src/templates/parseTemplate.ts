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

const DESCRIPTION_CAP = 160;

/**
 * deriveCommandDescription — a one-line description for a command that has none,
 * taken from the body: the first heading (dropping a leading "/name -" so
 * "# /rank - Triage jobs" reads "Triage jobs"), else the first prose line.
 * Plain text, capped at DESCRIPTION_CAP chars; never empty.
 */
export function deriveCommandDescription(body: string): string {
  const clean = (s: string) => s.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
  let fenced = false;
  let heading: string | undefined;
  let prose: string | undefined;
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const t = line.trim();
    if (t.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced || t.length === 0 || /^[-*_]{3,}$/.test(t)) continue;
    const h = /^#{1,6}\s+(.+)$/.exec(t);
    if (h) {
      heading = clean(h[1]!);
      break;
    }
    prose ??= clean(t.replace(/^[>\-*+]\s+/, ""));
    if (prose) break;
  }
  let text = heading ?? prose ?? "";
  if (heading) {
    // "/rank - Triage…" / "/rank: Triage…" -> "Triage…" (keep it whole if nothing follows)
    const stripped = /^\/[\w:.-]+\s*[-–—:]\s+(.+)$/.exec(text)?.[1];
    if (stripped) text = stripped;
  }
  if (text.length === 0) text = "Command";
  return text.length > DESCRIPTION_CAP ? `${text.slice(0, DESCRIPTION_CAP - 1).trimEnd()}…` : text;
}

/** A command whose frontmatter/description is missing: the whole `rawBody` is the prompt, description derived. */
function commandFromBody(rawBody: string): ParseTemplateResult {
  const body = rawBody.replace(/\r\n/g, "\n").replace(/\n+$/, "").replace(/^\n+/, "");
  if (body.trim().length === 0) return { ok: false, reason: "Body (content after frontmatter) is empty." };
  return { ok: true, parsed: { kind: "command", description: deriveCommandDescription(body), body } };
}

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
    // Claude Code treats a command file as a plain prompt — frontmatter is
    // optional for commands (agents and skills require it).
    if (expectedKind === "command") return commandFromBody(raw);
    return { ok: false, reason: "File is missing frontmatter (--- ... ---)." };
  }
  const [, fmRaw, bodyRaw] = match;

  let fm;
  try {
    fm = parseFrontmatter(fmRaw ?? "");
  } catch (err) {
    // A command's `description` is optional in Claude Code (e.g. a file that only
    // sets `allowed-tools`): derive one from the body instead of skipping it.
    // Any OTHER frontmatter problem (bad YAML, wrong types) still skips the file.
    if (expectedKind === "command" && /missing the `description`/.test((err as Error).message)) {
      return commandFromBody(bodyRaw ?? "");
    }
    return { ok: false, reason: (err as Error).message };
  }
  if (expectedKind === "command" && (!fm.description || fm.description.trim().length === 0)) {
    return commandFromBody(bodyRaw ?? "");
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
