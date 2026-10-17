/**
 * toolInput — pure helpers that read a tool_use part's input back out of what
 * was persisted (workflow-agent-run D-4). PURE — no Node imports.
 *
 * New runs carry `part.fields` (whitelisted scalars computed by the parser
 * from the FULL input — D-1). Runs persisted before D-1 only have
 * `inputPreview` (JSON, cut at PREVIEW_CAP), so `readToolInput` falls back to a
 * tolerant parse of it. Nothing here ever throws.
 */
import { TOOL_FIELD_CAP, type ContentPart, type ToolFields } from "./events.js";

/** The marker `parseStreamJson` appends when a preview / raw line is capped. */
const TRUNCATION_MARKER_RE = /…\[truncated \d+ chars\]$/;

/** true iff `s` ends with the parser's `…[truncated N chars]` cap marker. */
export function isTruncatedPreview(s: string | undefined | null): boolean {
  return typeof s === "string" && TRUNCATION_MARKER_RE.test(s);
}

/** Strip a trailing cap marker (for display text such as a prompt). */
export function stripTruncationMarker(s: string): string {
  return s.replace(TRUNCATION_MARKER_RE, "");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function capField(s: string): string {
  return s.length <= TOOL_FIELD_CAP ? s : `${s.slice(0, TOOL_FIELD_CAP - 1)}…`;
}

/** Keys never copied (large content already shown elsewhere). */
const EXCLUDED_KEYS = new Set(["prompt", "content", "new_string", "old_string", "edits", "todos"]);

function scalarsOf(obj: Record<string, unknown>): ToolFields {
  const out: ToolFields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (EXCLUDED_KEYS.has(k)) continue;
    if (typeof v === "string") out[k] = capField(v);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** Best-effort scalar extraction from a JSON object text that was cut mid-way. */
function salvageScalars(text: string): ToolFields {
  const out: ToolFields = {};
  // "key":"value" (value may be cut at the end — then it is skipped)
  const strRe = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of text.matchAll(strRe)) {
    const key = m[1]!;
    if (EXCLUDED_KEYS.has(key) || key in out) continue;
    out[key] = capField(unescapeJsonString(m[2]!));
  }
  const scalarRe = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*(-?\d+(?:\.\d+)?|true|false)\b/g;
  for (const m of text.matchAll(scalarRe)) {
    const key = m[1]!;
    if (EXCLUDED_KEYS.has(key) || key in out) continue;
    const raw = m[2]!;
    out[key] = raw === "true" ? true : raw === "false" ? false : Number(raw);
  }
  return out;
}

function unescapeJsonString(body: string): string {
  try {
    const v: unknown = JSON.parse(`"${body}"`);
    return typeof v === "string" ? v : body;
  } catch {
    return body;
  }
}

/** Tolerant parse of a tool_use `inputPreview` into scalar fields. Never throws;
 *  returns `{}` when nothing is recoverable. */
export function parseInputPreview(inputPreview: string): ToolFields {
  if (typeof inputPreview !== "string" || inputPreview.length === 0) return {};
  try {
    const v: unknown = JSON.parse(inputPreview);
    return isRecord(v) ? scalarsOf(v) : {};
  } catch {
    try {
      return salvageScalars(inputPreview);
    } catch {
      return {};
    }
  }
}

/** `part.fields ?? tolerantParse(part.inputPreview)` (D-4). */
export function readToolInput(part: Extract<ContentPart, { kind: "tool_use" }>): ToolFields {
  if (part.fields && isRecord(part.fields)) return part.fields;
  return parseInputPreview(part.inputPreview);
}

/**
 * Extract the `prompt` string of an Agent/Task dispatch from its inputPreview
 * (D-5 rule 3 fallback when no `task_started.promptPreview` exists). Returns
 * null when absent. `truncated` is true when the preview was capped (the
 * prompt is then partial). Never returns raw JSON.
 */
export function extractPromptFromPreview(inputPreview: string): { text: string; truncated: boolean } | null {
  if (typeof inputPreview !== "string" || inputPreview.length === 0) return null;
  try {
    const v: unknown = JSON.parse(inputPreview);
    if (isRecord(v) && typeof v["prompt"] === "string") return { text: v["prompt"], truncated: false };
    return null;
  } catch {
    /* fall through to the tolerant path */
  }
  const idx = inputPreview.search(/"prompt"\s*:\s*"/);
  if (idx < 0) return null;
  const start = inputPreview.indexOf('"', inputPreview.indexOf(":", idx) + 1) + 1;
  const body = stripTruncationMarker(inputPreview.slice(start));
  // Walk the JSON string body until an unescaped quote (complete) or the end (cut).
  let out = "";
  let i = 0;
  let complete = false;
  while (i < body.length) {
    const ch = body[i]!;
    if (ch === "\\") {
      if (i + 1 >= body.length) break; // dangling escape at the cut
      const next = body[i + 1]!;
      if (next === "u") {
        const hex = body.slice(i + 2, i + 6);
        if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };
      out += map[next] ?? next;
      i += 2;
      continue;
    }
    if (ch === '"') {
      complete = true;
      break;
    }
    out += ch;
    i++;
  }
  return { text: out, truncated: !complete || isTruncatedPreview(inputPreview) };
}
