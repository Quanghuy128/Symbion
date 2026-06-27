import type { CustomField } from "../ir/types.js";

export interface GenerateDescriptionInput {
  kind: "agent" | "command";
  name: string;
  body: string;
  /** agent only; ignored/absent for command per Q5 lock (STATE §9). */
  tools?: string[];
  /** optional, present if non-empty. */
  customFields?: CustomField[];
}

const BODY_CLAUSE_CAP = 160;
const FINAL_CAP = 200;
const FALLBACK = "Mô tả tự động.";

/** Strip a leading markdown heading marker, e.g. "## Foo" -> "Foo". */
function stripHeading(line: string): string {
  return line.replace(/^#{1,6}\s+/, "");
}

/**
 * Strip a leading "You are..."/"Bạn là..." instruction-style preamble, once,
 * case-insensitively, only at the very start of the line. Returns whether a
 * strip occurred (so the caller can lowercase the new first character).
 */
function stripYouArePrefix(line: string): { text: string; stripped: boolean } {
  const re = /^(you are|bạn là)\s+/i;
  if (re.test(line)) {
    return { text: line.replace(re, ""), stripped: true };
  }
  return { text: line, stripped: false };
}

/** Cap a fragment at the first sentence boundary within `cap` chars, else hard-cap at a whitespace boundary. */
function capFragment(text: string, cap: number): string {
  const sentenceMatch = new RegExp(`^[^.!?\\n]{1,${cap}}[.!?]`).exec(text);
  if (sentenceMatch) {
    return sentenceMatch[0];
  }
  if (text.length <= cap) {
    return text;
  }
  const slice = text.slice(0, cap);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > 0) {
    return slice.slice(0, lastSpace);
  }
  return slice;
}

/** Step 1 — derive a "body clause" from `body`. Returns undefined if body is empty. */
function deriveBodyClause(body: string): string | undefined {
  const trimmed = body.trim();
  if (trimmed === "") return undefined;

  const lines = trimmed.split(/\r?\n/);
  const firstLine = lines.find((l) => l.trim() !== "");
  if (firstLine === undefined) return undefined;

  let line = firstLine.trim();
  line = stripHeading(line);
  const { text } = stripYouArePrefix(line);
  line = text;

  let fragment = capFragment(line, BODY_CLAUSE_CAP);

  // Lowercase the first character so the clause reads naturally mid-sentence
  // when spliced into the "Agent that ..."/"Command that ..." templates
  // (e.g. "...to review code changes" not "...to Review code changes").
  if (fragment.length > 0) {
    fragment = fragment.charAt(0).toLowerCase() + fragment.slice(1);
  }

  // Strip trailing period(s)/sentence punctuation — re-added once at final assembly.
  fragment = fragment.replace(/[.!?]+$/, "");

  fragment = fragment.trim();
  return fragment === "" ? undefined : fragment;
}

/** Step 2 — derive a "tools clause" (agent only). */
function deriveToolsClause(kind: "agent" | "command", tools?: string[]): string | undefined {
  if (kind !== "agent") return undefined;
  if (!tools || tools.length === 0) return undefined;
  return tools.join(", ");
}

/** Cap used for the `model` custom-field value so the "(model: ...)" parenthetical
 * spliced into the assembled string is always short and complete (never truncated
 * mid-parenthetical by the final 200-char hard cap). */
const MODEL_VALUE_CAP = 40;

/** Step 3 — derive a "custom fields clause" — only surfaces a `model` field, if present. */
function deriveCustomFieldsClause(customFields?: CustomField[]): string | undefined {
  if (!customFields || customFields.length === 0) return undefined;
  const modelField = customFields.find(
    (f) => f.key?.trim().toLowerCase() === "model" && (f.value?.trim() ?? "") !== ""
  );
  if (!modelField) return undefined;
  const value = (modelField.value ?? "").trim();
  if (value === "") return undefined;
  return capFragment(value, MODEL_VALUE_CAP);
}

/** Step 5 — final normalization pass: collapse whitespace/newlines, strip control chars, cap length. */
function normalize(input: string): string {
  let str = input;
  str = str.replace(/\s*\n\s*/g, " ");
  str = str.replace(/[ \t]{2,}/g, " ");
  str = str.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, "");
  str = str.trim();

  if (str.length > FINAL_CAP) {
    const slice = str.slice(0, FINAL_CAP);
    const lastSpace = slice.lastIndexOf(" ");
    let cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
    cut = cut.trimEnd();
    if (!cut.endsWith(".")) {
      cut = `${cut}.`;
    }
    str = cut;
  }

  if (str === "") {
    return FALLBACK;
  }
  return str;
}

/**
 * generateDescription — pure, deterministic, local heuristic. No fs/net/Node imports.
 * Same input (deep-equal) -> always the same output string. Never throws for any
 * well-formed GenerateDescriptionInput (Q6 lock: always produces *something*).
 * Output is already normalized: single line, trimmed, length-capped, YAML-safe.
 */
export function generateDescription(input: GenerateDescriptionInput): string {
  const kind = input?.kind === "command" ? "command" : "agent";
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const body = typeof input?.body === "string" ? input.body : "";
  const tools = Array.isArray(input?.tools) ? input.tools : undefined;
  const customFields = Array.isArray(input?.customFields) ? input.customFields : undefined;

  const bodyClause = deriveBodyClause(body);
  const toolsClause = deriveToolsClause(kind, tools);
  const customFieldsClause = deriveCustomFieldsClause(customFields);

  let assembled: string;

  if (kind === "agent") {
    if (toolsClause !== undefined && bodyClause !== undefined) {
      assembled = `Agent that uses ${toolsClause} to ${bodyClause}.`;
    } else if (toolsClause !== undefined) {
      assembled = `Agent that uses ${toolsClause}.`;
    } else if (bodyClause !== undefined) {
      assembled = `Agent that ${bodyClause}.`;
    } else if (name !== "") {
      assembled = `Mô tả cho ${name}.`;
    } else {
      assembled = FALLBACK;
    }

    if (customFieldsClause !== undefined) {
      // Splice the parenthetical in before the trailing period. The clause itself
      // is already bounded (MODEL_VALUE_CAP) so this parenthetical is always short
      // and complete; if the combined string is still over the final cap for some
      // unlikely combination, drop the parenthetical entirely below rather than let
      // normalize() truncate through it (never produce a syntactically broken `(...)`).
      const withClause = assembled.endsWith(".")
        ? `${assembled.slice(0, -1)} (model: ${customFieldsClause}).`
        : `${assembled} (model: ${customFieldsClause}).`;
      assembled = withClause.length > FINAL_CAP ? assembled : withClause;
    }
  } else {
    if (bodyClause !== undefined) {
      assembled = `Command that ${bodyClause}.`;
    } else if (name !== "") {
      assembled = `Mô tả cho /${name}.`;
    } else {
      assembled = FALLBACK;
    }
  }

  return normalize(assembled);
}
