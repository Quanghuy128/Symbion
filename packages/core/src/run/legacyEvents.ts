/**
 * legacyEvents — re-interpret events persisted by the PRE-D-1 parser
 * (workflow-agent-run D-3). PURE — no Node imports. Applied inside
 * `foldAgentTree` only; the result is never re-persisted.
 *
 * Before D-1, every `type:"user"` line (tool results) and every
 * `system/task_*` line was stored as `{kind:"unknown", type, rawTruncated}`
 * with the raw line capped at RAW_CAP. `upgradeLegacyEvent` re-runs the SAME
 * object-level parser branch (`parseStreamJsonRecord`) over that raw line, so
 * there is no duplicated interpretation logic. When the raw was cut (so the
 * JSON no longer parses) and it was a `user` line, the tool_use ids and the
 * error flag are salvaged by regex and the result text is flagged
 * `legacyTruncated` ("result not recoverable (pre-upgrade run)").
 */
import type { RunEvent, ToolResultPart } from "./events.js";
import { parseStreamJsonRecord } from "./parseStreamJson.js";
import { isTruncatedPreview } from "./toolInput.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const TOOL_USE_ID_RE = /"tool_use_id"\s*:\s*"(toolu_[^"\\]+)"/g;
const IS_ERROR_RE = /"is_error"\s*:\s*true/;
const PARENT_RE = /"parent_tool_use_id"\s*:\s*"([^"\\]+)"/;
const ASYNC_RE = /Async agent launched|"isAsync"\s*:\s*true|"status"\s*:\s*"async_launched"/;

function salvageUserLine(raw: string): RunEvent | null {
  const ids: string[] = [];
  for (const m of raw.matchAll(TOOL_USE_ID_RE)) {
    const id = m[1]!;
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return null;
  const single = ids.length === 1;
  const parts: ToolResultPart[] = ids.map((toolUseId) => {
    const part: ToolResultPart = { kind: "tool_result", toolUseId, resultPreview: "", legacyTruncated: true };
    if (single && IS_ERROR_RE.test(raw)) part.isError = true;
    if (single && ASYNC_RE.test(raw)) part.async = true;
    return part;
  });
  const parent = PARENT_RE.exec(raw);
  return { kind: "tool-results", parentToolUseId: parent ? parent[1]! : null, parts };
}

/**
 * upgradeLegacyEvent — returns the D-1 interpretation of a pre-upgrade
 * `unknown` user/system event, or `ev` itself (same reference) when there is
 * nothing to upgrade. NEVER throws.
 */
export function upgradeLegacyEvent(ev: RunEvent): RunEvent {
  if (ev.kind !== "unknown") return ev;
  if (ev.type !== "user" && ev.type !== "system") return ev;
  const raw = typeof ev.rawTruncated === "string" ? ev.rawTruncated : "";
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    if (ev.type === "user" && isTruncatedPreview(raw)) {
      try {
        return salvageUserLine(raw) ?? ev;
      } catch {
        return ev;
      }
    }
    return ev;
  }
  if (!isRecord(obj)) return ev;
  const upgraded = parseStreamJsonRecord(obj, raw);
  // Still unknown (e.g. system/thinking_tokens) -> keep the original reference.
  return upgraded.kind === "unknown" ? ev : upgraded;
}
