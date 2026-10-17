/**
 * summarizeToolCall — extension-style one-line labels for a tool call
 * (workflow-agent-run D-4, AC-2). PURE — no Node imports. Never throws.
 *
 *   summarizeToolCall("Read", {file_path:"/a/b/x.ts", offset:40, limit:150}, {text, isError, truncated})
 *     -> { label: "Read x.ts (40–189)", resultLabel: "150 lines" }
 *
 * `input` comes from `readToolInput(part)`. `label` is capped at LABEL_CAP; the
 * UI applies the visual ellipsis and shows the full label in a tooltip. Only
 * basenames appear in labels — the full path is visible in the expanded INPUT.
 */
import type { ToolFields } from "./events.js";
import { stripTruncationMarker } from "./toolInput.js";

export const LABEL_CAP = 200;

export interface ToolCallResultInput {
  text: string;
  isError: boolean;
  truncated: boolean;
}

export interface ToolCallSummary {
  label: string;
  resultLabel?: string;
}

function str(input: ToolFields | null, key: string): string | undefined {
  if (!input) return undefined;
  const v = input[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(input: ToolFields | null, key: string): number | undefined {
  if (!input) return undefined;
  const v = input[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return undefined;
}

function basename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) || trimmed : trimmed;
}

function clip(s: string, cap: number): string {
  return s.length <= cap ? s : `${s.slice(0, cap - 1)}…`;
}

function firstLine(s: string): string {
  const line = s.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return line.trim();
}

/** Count of content lines in a (possibly capped) result preview. */
export function countLines(text: string): number {
  const body = stripTruncationMarker(text).replace(/\s+$/, "");
  if (body.length === 0) return 0;
  return body.split(/\r?\n/).length;
}

function lines(result: ToolCallResultInput, noun: string): string {
  const n = countLines(result.text);
  return `${n}${result.truncated ? "+" : ""} ${noun}`;
}

function hostPath(url: string): string {
  const noScheme = url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  const noQuery = noScheme.replace(/[?#].*$/, "");
  return noQuery.replace(/\/+$/, "");
}

function summarizeUnsafe(tool: string, input: ToolFields | null, result?: ToolCallResultInput): ToolCallSummary {
  const name = tool && tool.length > 0 ? tool : "tool";
  const isError = result?.isError === true;
  const errorLabel = isError ? "error" : undefined;

  switch (name) {
    case "Read": {
      const file = str(input, "file_path") ?? str(input, "path");
      const offset = num(input, "offset");
      const limit = num(input, "limit");
      let label = file ? `Read ${basename(file)}` : "Read";
      if (offset !== undefined && limit !== undefined) label += ` (${offset}–${offset + limit - 1})`;
      else if (offset !== undefined) label += ` (from ${offset})`;
      else if (limit !== undefined) label += ` (1–${limit})`;
      return { label, resultLabel: errorLabel ?? (result ? lines(result, "lines") : undefined) };
    }
    case "Glob": {
      const pattern = str(input, "pattern") ?? str(input, "glob");
      const path = str(input, "path");
      let label = pattern ? `Glob "${pattern}"` : "Glob";
      if (path) label += ` (in ${path})`;
      let resultLabel = errorLabel;
      if (!resultLabel && result) {
        const body = stripTruncationMarker(result.text).trim();
        resultLabel = body.length === 0 || /^No files found/i.test(body) ? "No files" : lines(result, "files");
      }
      return { label, resultLabel };
    }
    case "Grep": {
      const pattern = str(input, "pattern");
      const where = str(input, "path") ?? str(input, "glob");
      let label = pattern ? `Grep "${pattern}"` : "Grep";
      if (where) label += ` (in ${where})`;
      let resultLabel = errorLabel;
      if (!resultLabel && result) {
        const body = stripTruncationMarker(result.text).trim();
        const found = /^Found (\d+) files?/i.exec(body);
        if (body.length === 0 || /^No (matches|files) found/i.test(body)) resultLabel = "No matches";
        else if (found) resultLabel = `${found[1]}${result.truncated ? "+" : ""} files`;
        else resultLabel = lines(result, "matches");
      }
      return { label, resultLabel };
    }
    case "Bash": {
      const command = str(input, "command");
      const label = command ? `Bash ${clip(firstLine(command), 80)}` : "Bash";
      const background = input?.["run_in_background"] === true;
      let resultLabel: string | undefined;
      if (isError) resultLabel = "error";
      else if (background) resultLabel = "background";
      else if (result) resultLabel = lines(result, "lines of output");
      return { label, resultLabel };
    }
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit": {
      const file = str(input, "file_path") ?? str(input, "notebook_path") ?? str(input, "path");
      return { label: file ? `${name} ${basename(file)}` : name, resultLabel: errorLabel };
    }
    case "Agent":
    case "Task": {
      const subagent = str(input, "subagent_type") ?? "subagent";
      const description = str(input, "description");
      return { label: description ? `${name} ${subagent} "${description}"` : `${name} ${subagent}` };
    }
    case "WebFetch": {
      const url = str(input, "url");
      return { label: url ? `WebFetch ${hostPath(url)}` : "WebFetch", resultLabel: errorLabel };
    }
    case "WebSearch": {
      const query = str(input, "query");
      return { label: query ? `WebSearch "${query}"` : "WebSearch", resultLabel: errorLabel };
    }
    case "TodoWrite":
      return { label: "TodoWrite" };
    default:
      break;
  }

  if (name.startsWith("mcp__")) {
    const rest = name.slice("mcp__".length);
    const sep = rest.indexOf("__");
    const label = sep > 0 ? `${rest.slice(0, sep)} · ${rest.slice(sep + 2)}` : rest || name;
    return { label, resultLabel: errorLabel };
  }

  // Generic fallback: `<Tool>` + the first string field (≤60).
  let firstString: string | undefined;
  if (input) {
    for (const v of Object.values(input)) {
      if (typeof v === "string" && v.trim().length > 0) {
        firstString = v;
        break;
      }
    }
  }
  const label = firstString ? `${name} ${clip(firstLine(firstString), 60)}` : name;
  return { label, resultLabel: errorLabel ?? (result ? lines(result, "lines") : undefined) };
}

/** See module doc. NEVER throws; `label` ≤ LABEL_CAP chars. */
export function summarizeToolCall(tool: string, input: ToolFields | null, result?: ToolCallResultInput): ToolCallSummary {
  let out: ToolCallSummary;
  try {
    out = summarizeUnsafe(typeof tool === "string" ? tool : "", input ?? null, result);
  } catch {
    out = { label: typeof tool === "string" && tool ? tool : "tool" };
  }
  const label = clip(out.label.replace(/\s+/g, " ").trim(), LABEL_CAP);
  return out.resultLabel === undefined ? { label } : { label, resultLabel: out.resultLabel };
}
