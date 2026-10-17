/**
 * Run Engine v2 — pure event model (PLAN §8.1).
 *
 * This module is PURE (no fs/net/Node imports — AC-RUN-11). It owns the
 * provider-agnostic `RunEvent` discriminated union plus the persisted wrapper
 * and the shared view/run shapes that the daemon persists and the web
 * UI renders. The daemon assigns `seq` (monotonic from 1) — it is the single
 * ordering + dedup key across SSE, events.jsonl, and getRunEvents.
 */

/** Truncation caps — CORE CONSTANTS (PLAN §8.1). Every content-part preview is
 *  capped at PREVIEW_CAP; retained raw (unknown / parse-error) at RAW_CAP. */
export const PREVIEW_CAP = 2_000;
export const RAW_CAP = 8_192;

/** The 4-way token shape. Fresh = input + output (cacheRead/cacheWrite excluded
 *  from headline numbers per locked §6.6; present here for the hover card). */
export interface FourWay {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Whitelisted scalar fields of a tool_use input (workflow-agent-run D-1),
 *  read from the FULL input before truncation. Strings capped at
 *  TOOL_FIELD_CAP. Never contains `prompt` (no large-content duplication). */
export type ToolFields = Record<string, string | number | boolean>;

/** Per-string cap for `ToolFields` values (D-1). */
export const TOOL_FIELD_CAP = 300;

/** The `tool_result` content part — produced from `type:"user"` lines (D-1). */
export interface ToolResultPart {
  kind: "tool_result";
  toolUseId?: string;
  resultPreview: string;
  /** present (true) iff the CLI marked the result `is_error: true`. */
  isError?: true;
  /** present (true) iff the result is an async launch acknowledgement
   *  (`tool_use_result.isAsync` / `status === "async_launched"`) — NOT a completion. */
  async?: true;
  /** set ONLY by `upgradeLegacyEvent` when a pre-upgrade raw line was cut by
   *  RAW_CAP and the result text is not recoverable (D-3). Never persisted. */
  legacyTruncated?: true;
}

/** A single content part of an assistant `message` event. Previews truncated. */
export type ContentPart =
  | { kind: "text"; textPreview: string }
  /** D-1: assistant `thinking` block (capped at PREVIEW_CAP, signature dropped);
   *  `redacted_thinking` yields `textPreview: ""`. */
  | { kind: "thinking"; textPreview: string }
  | {
      kind: "tool_use";
      toolUseId: string;
      tool: string;
      inputPreview: string;
      /** present iff this is a Task dispatch that names a subagent. */
      subagentType?: string;
      /** D-1: present iff `input.run_in_background === true` (computed pre-truncation). */
      background?: true;
      /** D-1: whitelisted scalar input fields (computed pre-truncation). */
      fields?: ToolFields;
    }
  | ToolResultPart;

/** One entry from `result.modelUsage` (hidden background models included). */
export interface ModelUsageEntry {
  model: string;
  usage: FourWay;
  costUsd?: number;
}

/** The provider-agnostic run-event union. `kind` is the discriminant. */
export type RunEvent =
  | {
      kind: "init";
      sessionId: string;
      model: string;
      permissionMode: string;
      cliVersion: string;
      slashCommands: string[];
    }
  | {
      kind: "message";
      messageId: string;
      /** null = main agent; a toolUseId = inside that Task/Agent dispatch. */
      parentToolUseId: string | null;
      model: string;
      usage: FourWay;
      parts: ContentPart[];
      /** P2 (real fixture, STATE §13): the CLI reports the dispatched
       *  subagent's name as a TOP-LEVEL field on the assistant event itself
       *  (sibling of parent_tool_use_id) for messages produced INSIDE that
       *  dispatch — present only on non-main-actor messages in practice. */
      topLevelSubagentType?: string;
    }
  | {
      kind: "result";
      subtype: string;
      isError: boolean;
      totalCostUsd?: number;
      durationMs?: number;
      numTurns?: number;
      usage: FourWay;
      modelUsage: ModelUsageEntry[];
      permissionDenials: unknown[];
    }
  | {
      kind: "unknown";
      /** the original `type` field (best-effort), or "" if unreadable. */
      type: string;
      /** raw line retained, truncated to RAW_CAP. */
      rawTruncated: string;
    }
  | {
      kind: "parse-error";
      /** raw line retained, truncated to RAW_CAP. */
      rawTruncated: string;
    }
  /** D-1: a `type:"user"` line — tool results flowing back to the agent that
   *  owns `parentToolUseId` (null = main agent). `parts` is `[]` when the
   *  content carried no tool_result (e.g. a replayed prompt). */
  | {
      kind: "tool-results";
      parentToolUseId: string | null;
      parts: ToolResultPart[];
    }
  /** D-1: a `type:"system"` line whose subtype starts with `task_`
   *  (task_started / task_updated / task_notification / …). */
  | {
      kind: "task";
      subtype: string;
      taskId: string;
      toolUseId?: string;
      status?: string;
      taskType?: string;
      subagentType?: string;
      description?: string;
      promptPreview?: string;
      summary?: string;
    };

/** The discriminant literals of RunEvent — useful for tests/assertions. */
export type RunEventKind = RunEvent["kind"];

/** The persisted wrapper — one per line in events.jsonl. `seq` is daemon-assigned,
 *  monotonic from 1; `ts` is epoch ms at ingest. */
export interface PersistedRunEvent {
  seq: number;
  ts: number;
  ev: RunEvent;
}

/** Lifecycle status of a run. Terminal = completed|failed|cancelled|timedOut. */
export type RunStatus =
  | "starting"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "timedOut";

/** Why a run stopped short of natural completion (ceilings). */
export type StopReason = "wallClock" | "tokenCap";

/** Persisted per-run metadata (mirrors `.symbion/runs/<id>/run.json`, PLAN §8.2).
 *  Kept here (pure) so daemon + web share ONE shape with no drift. */
export interface RunInfo {
  schemaVersion: number;
  runId: string;
  projectId: string;
  artifactId: string;
  commandName: string;
  requirement: string;
  modelOverride: string | null;
  argv: string[];
  bin: string;
  cwd: string;
  permissionMode: string;
  allowedTools: string[];
  ceilings: { wallClockMs: number; tokenCap: number };
  cliVersion: string;
  sessionId: string | null;
  startedAt: string;
  endedAt: string | null;
  status: RunStatus;
  exitCode: number | null;
  stopReason: StopReason | null;
  errorMessage: string | null;
  gitBefore: { isRepo: boolean; clean: boolean; changedFiles: string[] };
  /** terminal-only (P2): array of file deltas or the string "unavailable". */
  filesChanged: FileChange[] | "unavailable" | null;
  lastSeq: number;
  /** terminal-only (P2): frozen totals snapshot for cheap history rows. */
  totals: RunTotals | null;
}

export interface FileChange {
  path: string;
  status: "A" | "M" | "D";
  plus?: number;
  minus?: number;
  preDirty?: boolean;
}

/** Frozen terminal totals snapshot (P2). */
export interface RunTotals {
  fresh: number;
  costUsd?: number;
  perNode: Array<{
    nodeId: string | null;
    label: string;
    ownFresh: number;
    totalFresh: number;
    costUsd?: number;
    unrecognized?: boolean;
  }>;
}

/** A compact list row for the history popover (P3). */
export interface RunListItem {
  runId: string;
  commandName: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  freshTokens: number | null;
  costUsd: number | null;
}

/** The compact live snapshot the RunBar / status strip render (design §4). */
export interface RunView {
  runId: string;
  command: string;
  project: string;
  status: RunStatus;
  elapsedMs: number;
  freshTokens: number;
  costUsd: number | null;
  degraded: boolean;
  connection: "live" | "reconnecting" | "polling";
}
