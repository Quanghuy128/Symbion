/**
 * parseStreamJson — pure, tolerant parser for Claude Code `--output-format
 * stream-json` newline-delimited events (PLAN §8.1).
 *
 * Contract (the whole point of shipping this in P1): `parseLine` NEVER throws.
 *  - non-JSON line          -> { kind: "parse-error", rawTruncated }
 *  - unrecognized `type`     -> { kind: "unknown", type, rawTruncated }
 *  - recognized types        -> tolerate missing/extra fields (every field
 *                               access is defensive; a deleted `usage` yields a
 *                               zeroed FourWay, not a throw).
 *
 * Recorded event types (verified against CLI 2.1.187 — STATE §8.0):
 *  system/init · assistant · result · (undocumented) rate_limit_event -> unknown.
 *
 * workflow-agent-run D-1 (additive): `user` -> tool-results (tool_result parts
 * with isError/async), `system/task_*` -> task, assistant `thinking` /
 * `redacted_thinking` parts -> thinking (signature dropped), and tool_use parts
 * gain `background` + whitelisted `fields`, both computed from the FULL input
 * before the preview cap is applied. Every other system subtype (e.g.
 * thinking_tokens) and rate_limit_event stay `unknown`, unchanged. Caps unchanged.
 */
import {
  PREVIEW_CAP,
  RAW_CAP,
  TOOL_FIELD_CAP,
  type ContentPart,
  type FourWay,
  type ModelUsageEntry,
  type RunEvent,
  type ToolFields,
  type ToolResultPart,
} from "./events.js";

// Re-export the caps so callers importing the parser get the constants too
// (tests + the daemon import them from here).
export { PREVIEW_CAP, RAW_CAP };
export type { RunEvent };

function capWithMarker(s: string, cap: number): string {
  if (s.length <= cap) return s;
  return `${s.slice(0, cap)}…[truncated ${s.length - cap} chars]`;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Extract a FourWay from a stream-json `usage` block, tolerant of shape.
 *  cache_creation_input_tokens -> cacheWrite; cache_read_input_tokens -> cacheRead. */
function readUsage(usage: unknown): FourWay {
  if (!isRecord(usage)) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return {
    input: asNumber(usage["input_tokens"]),
    output: asNumber(usage["output_tokens"]),
    cacheRead: asNumber(usage["cache_read_input_tokens"]),
    cacheWrite: asNumber(usage["cache_creation_input_tokens"]),
  };
}

/** D-1 whitelist of scalar tool_use input keys copied into `fields`. `prompt`
 *  is deliberately absent (it lives in inputPreview / task.promptPreview). */
const TOOL_FIELD_KEYS = [
  "file_path",
  "path",
  "offset",
  "limit",
  "pattern",
  "glob",
  "output_mode",
  "command",
  "description",
  "run_in_background",
  "subagent_type",
  "url",
  "query",
  "shell_id",
  "bash_id",
  "notebook_path",
] as const;

function capField(s: string): string {
  return s.length <= TOOL_FIELD_CAP ? s : `${s.slice(0, TOOL_FIELD_CAP - 1)}…`;
}

function readToolFields(input: unknown): ToolFields | undefined {
  if (!isRecord(input)) return undefined;
  const out: ToolFields = {};
  let any = false;
  for (const key of TOOL_FIELD_KEYS) {
    const v = input[key];
    if (typeof v === "string") {
      out[key] = capField(v);
      any = true;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      out[key] = v;
      any = true;
    } else if (typeof v === "boolean") {
      out[key] = v;
      any = true;
    }
  }
  return any ? out : undefined;
}

/** Flatten a tool_result `content` (string | content-block array | other) to text. */
function readToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const chunks: string[] = [];
    for (const block of content) {
      if (typeof block === "string") {
        chunks.push(block);
      } else if (isRecord(block)) {
        if (block["type"] === "text" && typeof block["text"] === "string") chunks.push(block["text"]);
        else if (block["type"] === "image") chunks.push("[image]");
        else chunks.push(safeStringify(block));
      }
    }
    return chunks.join("\n");
  }
  if (content === undefined || content === null) return "";
  return safeStringify(content);
}

function readToolResultPart(raw: Record<string, unknown>): ToolResultPart {
  const part: ToolResultPart = {
    kind: "tool_result",
    toolUseId: optId(raw["tool_use_id"]),
    resultPreview: capWithMarker(readToolResultText(raw["content"]), PREVIEW_CAP),
  };
  if (raw["is_error"] === true) part.isError = true;
  return part;
}

function readContentParts(content: unknown): ContentPart[] {
  if (!Array.isArray(content)) return [];
  const parts: ContentPart[] = [];
  for (const raw of content) {
    if (!isRecord(raw)) continue;
    const type = asString(raw["type"]);
    if (type === "text") {
      parts.push({ kind: "text", textPreview: capWithMarker(asString(raw["text"]), PREVIEW_CAP) });
    } else if (type === "thinking") {
      // `signature` is intentionally dropped (opaque, large, useless to show).
      parts.push({ kind: "thinking", textPreview: capWithMarker(asString(raw["thinking"]), PREVIEW_CAP) });
    } else if (type === "redacted_thinking") {
      parts.push({ kind: "thinking", textPreview: "" });
    } else if (type === "tool_use") {
      const input = raw["input"];
      const inputStr = input === undefined ? "" : safeStringify(input);
      const tool = capField(asString(raw["name"]));
      const part: ContentPart & { kind: "tool_use" } = {
        kind: "tool_use",
        toolUseId: capField(asString(raw["id"])),
        tool,
        inputPreview: capWithMarker(inputStr, PREVIEW_CAP),
      };
      // A Task dispatch names its subagent in input.subagent_type.
      const subagent = isRecord(input) ? input["subagent_type"] : undefined;
      if (typeof subagent === "string" && subagent.length > 0) {
        part.subagentType = capField(subagent);
      }
      // D-1: computed from the FULL input, before the inputPreview cap.
      if (isRecord(input) && input["run_in_background"] === true) part.background = true;
      const fields = readToolFields(input);
      if (fields) part.fields = fields;
      parts.push(part);
    } else if (type === "tool_result") {
      parts.push(readToolResultPart(raw));
    }
    // other content-part types are dropped (not fatal).
  }
  return parts;
}

/** D-1: a `type:"user"` line -> tool-results. Only tool_result blocks are kept. */
function readUserToolResults(obj: Record<string, unknown>): RunEvent {
  const message = isRecord(obj["message"]) ? (obj["message"] as Record<string, unknown>) : {};
  const content = message["content"];
  const parts: ToolResultPart[] = [];
  if (Array.isArray(content)) {
    for (const raw of content) {
      if (isRecord(raw) && raw["type"] === "tool_result") parts.push(readToolResultPart(raw));
    }
  }
  // The async-launch acknowledgement is reported on the line's top-level
  // `tool_use_result` (one result per user line in practice). Only applied
  // when the line carries exactly one tool_result, so it can never be
  // attributed to the wrong part.
  const tur = obj["tool_use_result"];
  if (parts.length === 1 && isRecord(tur) && (tur["isAsync"] === true || tur["status"] === "async_launched")) {
    parts[0]!.async = true;
  }
  return {
    kind: "tool-results",
    parentToolUseId: optId(obj["parent_tool_use_id"]) ?? null,
    parts,
  };
}

/** Id-like strings (tool_use ids, parent ids) are HARD-capped at
 *  TOOL_FIELD_CAP (review fix #1): real values are ~30 chars; hostile ones must
 *  not bloat the persisted event. No marker, so a capped id stays ≤ the cap. */
function optId(v: unknown): string | undefined {
  return typeof v === "string" ? capField(v) : undefined;
}

function optString(v: unknown, cap: number): string | undefined {
  return typeof v === "string" ? capWithMarker(v, cap) : undefined;
}

/** D-1: a `type:"system"` line with a `task_*` subtype -> task. */
function readTask(obj: Record<string, unknown>, subtype: string): RunEvent {
  const ev: Extract<RunEvent, { kind: "task" }> = {
    kind: "task",
    subtype: capWithMarker(subtype, TOOL_FIELD_CAP),
    taskId: optId(obj["task_id"]) ?? "",
  };
  const toolUseId = optId(obj["tool_use_id"]);
  if (toolUseId !== undefined) ev.toolUseId = toolUseId;
  const patch = isRecord(obj["patch"]) ? (obj["patch"] as Record<string, unknown>) : undefined;
  const status = optString(obj["status"], TOOL_FIELD_CAP) ?? optString(patch?.["status"], TOOL_FIELD_CAP);
  if (status !== undefined) ev.status = status;
  const taskType = optString(obj["task_type"], TOOL_FIELD_CAP);
  if (taskType !== undefined) ev.taskType = taskType;
  const subagentType = optString(obj["subagent_type"], TOOL_FIELD_CAP);
  if (subagentType !== undefined) ev.subagentType = subagentType;
  const description = optString(obj["description"], PREVIEW_CAP);
  if (description !== undefined) ev.description = description;
  const prompt = optString(obj["prompt"], PREVIEW_CAP);
  if (prompt !== undefined) ev.promptPreview = prompt;
  const summary = optString(obj["summary"], PREVIEW_CAP);
  if (summary !== undefined) ev.summary = summary;
  return ev;
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function readModelUsage(modelUsage: unknown): ModelUsageEntry[] {
  if (!isRecord(modelUsage)) return [];
  const out: ModelUsageEntry[] = [];
  for (const [model, raw] of Object.entries(modelUsage)) {
    if (!isRecord(raw)) {
      out.push({ model, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
      continue;
    }
    const usage: FourWay = {
      input: asNumber(raw["inputTokens"]),
      output: asNumber(raw["outputTokens"]),
      cacheRead: asNumber(raw["cacheReadInputTokens"]),
      cacheWrite: asNumber(raw["cacheCreationInputTokens"]),
    };
    const entry: ModelUsageEntry = { model, usage };
    if (typeof raw["costUSD"] === "number") entry.costUsd = raw["costUSD"] as number;
    out.push(entry);
  }
  return out;
}

/**
 * parseLine — the sole entry point. Accepts one raw NDJSON line (no trailing
 * newline required). NEVER throws.
 */
export function parseLine(line: string): RunEvent {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return { kind: "parse-error", rawTruncated: capWithMarker(line, RAW_CAP) };
  }

  if (!isRecord(obj)) {
    return { kind: "parse-error", rawTruncated: capWithMarker(line, RAW_CAP) };
  }
  return parseStreamJsonRecord(obj, line);
}

/**
 * parseStreamJsonRecord — the shared object-level branch of `parseLine`
 * (D-3: `upgradeLegacyEvent` re-runs it over a legacy `unknown.rawTruncated`,
 * so there is exactly one interpretation of each stream-json shape). `raw` is
 * the original line, retained (capped) on `unknown`. NEVER throws: every field
 * access is defensive, and any unexpected exception degrades to `unknown`.
 */
export function parseStreamJsonRecord(obj: Record<string, unknown>, raw: string): RunEvent {
  try {
    return parseRecordUnsafe(obj, raw);
  } catch {
    let type = "";
    try {
      type = asString(obj["type"]);
    } catch {
      /* hostile getter — keep "" */
    }
    return { kind: "unknown", type, rawTruncated: capWithMarker(String(raw), RAW_CAP) };
  }
}

function parseRecordUnsafe(obj: Record<string, unknown>, raw: string): RunEvent {
  const type = asString(obj["type"]);
  const subtype = asString(obj["subtype"]);

  if (type === "system" && subtype === "init") {
    const slash = obj["slash_commands"];
    return {
      kind: "init",
      sessionId: asString(obj["session_id"]),
      model: asString(obj["model"]),
      permissionMode: asString(obj["permissionMode"]),
      cliVersion: asString(obj["claude_code_version"]),
      slashCommands: Array.isArray(slash) ? slash.filter((s): s is string => typeof s === "string") : [],
    };
  }

  if (type === "assistant") {
    const message = isRecord(obj["message"]) ? (obj["message"] as Record<string, unknown>) : {};
    const ev: RunEvent = {
      kind: "message",
      messageId: capField(asString(message["id"])),
      parentToolUseId: optId(obj["parent_tool_use_id"]) ?? null,
      model: capField(asString(message["model"])),
      usage: readUsage(message["usage"]),
      parts: readContentParts(message["content"]),
    };
    // P2 real-fixture finding (STATE §13 BUILD notes): the CLI reports the
    // dispatched subagent's name as a TOP-LEVEL `subagent_type` field on the
    // assistant event itself (sibling of parent_tool_use_id) — NOT nested
    // inside the dispatching tool_use's `input.subagent_type` as originally
    // assumed pre-recording. Both shapes are captured defensively: this
    // top-level field is the verified-real one; readContentParts still reads
    // an input.subagent_type if a future/legacy shape nests it there instead.
    if (typeof obj["subagent_type"] === "string" && obj["subagent_type"].length > 0) {
      (ev as Extract<RunEvent, { kind: "message" }>).topLevelSubagentType = capField(obj["subagent_type"]);
    }
    return ev;
  }

  if (type === "result") {
    return {
      kind: "result",
      subtype,
      isError: obj["is_error"] === true,
      totalCostUsd: typeof obj["total_cost_usd"] === "number" ? (obj["total_cost_usd"] as number) : undefined,
      durationMs: typeof obj["duration_ms"] === "number" ? (obj["duration_ms"] as number) : undefined,
      numTurns: typeof obj["num_turns"] === "number" ? (obj["num_turns"] as number) : undefined,
      usage: readUsage(obj["usage"]),
      modelUsage: readModelUsage(obj["modelUsage"]),
      permissionDenials: Array.isArray(obj["permission_denials"]) ? (obj["permission_denials"] as unknown[]) : [],
    };
  }

  if (type === "user") {
    return readUserToolResults(obj);
  }

  if (type === "system" && subtype.startsWith("task_")) {
    return readTask(obj, subtype);
  }

  // Recognized JSON, unrecognized type (e.g. the undocumented rate_limit_event,
  // or system/thinking_tokens).
  return { kind: "unknown", type, rawTruncated: capWithMarker(raw, RAW_CAP) };
}
