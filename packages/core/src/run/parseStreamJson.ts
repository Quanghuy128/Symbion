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
 */
import {
  PREVIEW_CAP,
  RAW_CAP,
  type ContentPart,
  type FourWay,
  type ModelUsageEntry,
  type RunEvent,
} from "./events.js";

// Re-export the caps so callers importing the parser get the constants too
// (tests + the daemon import them from here).
export { PREVIEW_CAP, RAW_CAP };
export type { RunEvent };

function truncate(s: string, cap: number): string {
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

function readContentParts(content: unknown): ContentPart[] {
  if (!Array.isArray(content)) return [];
  const parts: ContentPart[] = [];
  for (const raw of content) {
    if (!isRecord(raw)) continue;
    const type = asString(raw["type"]);
    if (type === "text") {
      parts.push({ kind: "text", textPreview: truncate(asString(raw["text"]), PREVIEW_CAP) });
    } else if (type === "tool_use") {
      const input = raw["input"];
      const inputStr = input === undefined ? "" : safeStringify(input);
      const tool = asString(raw["name"]);
      const part: ContentPart & { kind: "tool_use" } = {
        kind: "tool_use",
        toolUseId: asString(raw["id"]),
        tool,
        inputPreview: truncate(inputStr, PREVIEW_CAP),
      };
      // A Task dispatch names its subagent in input.subagent_type.
      const subagent = isRecord(input) ? input["subagent_type"] : undefined;
      if (typeof subagent === "string" && subagent.length > 0) {
        part.subagentType = subagent;
      }
      parts.push(part);
    } else if (type === "tool_result") {
      const resultContent = raw["content"];
      parts.push({
        kind: "tool_result",
        toolUseId: raw["tool_use_id"] !== undefined ? asString(raw["tool_use_id"]) : undefined,
        resultPreview: truncate(
          typeof resultContent === "string" ? resultContent : safeStringify(resultContent),
          PREVIEW_CAP
        ),
      });
    }
    // other content-part types are dropped (not fatal).
  }
  return parts;
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
  const raw = line;
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return { kind: "parse-error", rawTruncated: truncate(raw, RAW_CAP) };
  }

  if (!isRecord(obj)) {
    return { kind: "parse-error", rawTruncated: truncate(raw, RAW_CAP) };
  }

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
    return {
      kind: "message",
      messageId: asString(message["id"]),
      parentToolUseId:
        typeof obj["parent_tool_use_id"] === "string" ? (obj["parent_tool_use_id"] as string) : null,
      model: asString(message["model"]),
      usage: readUsage(message["usage"]),
      parts: readContentParts(message["content"]),
    };
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

  // Recognized JSON, unrecognized type (e.g. the undocumented rate_limit_event).
  return { kind: "unknown", type, rawTruncated: truncate(raw, RAW_CAP) };
}
