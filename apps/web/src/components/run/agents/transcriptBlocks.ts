/**
 * transcriptBlocks — pure mapping from one agent's TranscriptRows (core
 * `agentTree`) to the blocks the chronological transcript renders. The block
 * KIND decides the component; text content is never sniffed to pick a layout.
 *
 *   thinking row          -> thinking (collapsed "Thought for Ns")
 *   text row              -> text (markdown)
 *   tool row              -> tool | edit (Edit/MultiEdit/Write) | todo (latest TodoWrite only)
 *   ≥2 consecutive read-only tools -> toolGroup
 *   spawn row             -> spawn (drills into the subagent)
 *   error result / parse-error rows -> notice (one line)
 *   other system / unknown rows -> dropped (the Raw log keeps every event)
 */
import { stripTruncationMarker, type AgentNode, type TranscriptRow } from "@symbion/core";

export type ToolBlockStatus = "running" | "ok" | "error" | "interrupted";

export interface ToolBlock {
  kind: "tool";
  id: string;
  /** tool name as the CLI reported it (e.g. "Read", "mcp__github__create_pr"). */
  name: string;
  /** one-line summary from core `summarizeToolCall` (e.g. "Read x.ts (40–189)"). */
  label: string;
  resultLabel?: string;
  status: ToolBlockStatus;
  /** raw input JSON preview (capped at 2,000 chars by the parser). */
  input?: string;
  output?: string;
  outputTruncated: boolean;
  background?: boolean;
}

export interface DiffLine {
  sign: "+" | "-";
  text: string;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export type TranscriptBlock =
  | { kind: "prompt"; id: string; text: string; truncated: boolean }
  | { kind: "thinking"; id: string; text: string; durationMs?: number }
  | { kind: "text"; id: string; markdown: string; truncated: boolean }
  | ToolBlock
  | { kind: "toolGroup"; id: string; tools: ToolBlock[] }
  | { kind: "edit"; id: string; tool: ToolBlock; filePath: string; lines: DiffLine[] }
  | { kind: "todo"; id: string; todos: TodoItem[] }
  | { kind: "spawn"; id: string; label: string; childAgentId: string; status: ToolBlockStatus }
  | { kind: "notice"; id: string; text: string; tone: "error" | "neutral" };

export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "WebFetch",
  "WebSearch",
  "NotebookRead",
]);

const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "MultiEdit", "Write"]);

/** "mcp__github__create_pr" -> "github · create_pr"; other names unchanged. */
export function displayToolName(name: string): string {
  if (!name.startsWith("mcp__")) return name;
  const [, server, ...rest] = name.split("__");
  return rest.length > 0 ? `${server} · ${rest.join("__")}` : name;
}

function toolStatus(row: TranscriptRow, live: boolean): ToolBlockStatus {
  if (row.status === "error") return "error";
  if (row.status === "interrupted") return "interrupted";
  if (row.status === "pending") return live ? "running" : "interrupted";
  return "ok";
}

function parseInput(row: TranscriptRow): Record<string, unknown> | null {
  const raw = row.preview?.input;
  if (!raw || row.preview?.inputTruncated) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function splitLines(s: string): string[] {
  if (s.length === 0) return [];
  return s.replace(/\n$/, "").split("\n");
}

/** Old lines as "-", new lines as "+" (per edit). Null when the input is not fully available. */
export function editDiff(name: string, input: Record<string, unknown> | null): { filePath: string; lines: DiffLine[] } | null {
  if (!input) return null;
  const filePath = str(input["file_path"]);
  if (!filePath) return null;
  const pairs: Array<[string, string]> = [];
  if (name === "Write") {
    if (typeof input["content"] !== "string") return null;
    pairs.push(["", input["content"]]);
  } else if (name === "MultiEdit") {
    const edits = input["edits"];
    if (!Array.isArray(edits)) return null;
    for (const e of edits) {
      if (typeof e !== "object" || e === null) return null;
      pairs.push([str((e as Record<string, unknown>)["old_string"]), str((e as Record<string, unknown>)["new_string"])]);
    }
  } else {
    if (typeof input["old_string"] !== "string" || typeof input["new_string"] !== "string") return null;
    pairs.push([input["old_string"], input["new_string"]]);
  }
  const lines: DiffLine[] = [];
  for (const [a, b] of pairs) {
    for (const t of splitLines(a)) lines.push({ sign: "-", text: t });
    for (const t of splitLines(b)) lines.push({ sign: "+", text: t });
  }
  return { filePath, lines };
}

const TODO_STATUSES = new Set(["pending", "in_progress", "completed"]);

function parseTodos(input: Record<string, unknown> | null): TodoItem[] | null {
  const todos = input?.["todos"];
  if (!Array.isArray(todos)) return null;
  const out: TodoItem[] = [];
  for (const t of todos) {
    if (typeof t !== "object" || t === null) continue;
    const content = str((t as Record<string, unknown>)["content"]);
    const status = str((t as Record<string, unknown>)["status"]);
    if (content) out.push({ content, status: TODO_STATUSES.has(status) ? (status as TodoItem["status"]) : "pending" });
  }
  return out;
}

function toToolBlock(row: TranscriptRow, live: boolean): ToolBlock {
  const output = row.preview?.output;
  return {
    kind: "tool",
    id: row.id,
    name: row.tool ?? "tool",
    label: row.label,
    ...(row.resultLabel ? { resultLabel: row.resultLabel } : {}),
    status: toolStatus(row, live),
    ...(row.preview?.input ? { input: row.preview.input } : {}),
    ...(output !== undefined ? { output: stripTruncationMarker(output) } : {}),
    outputTruncated: row.preview?.truncated ?? false,
    ...(row.background ? { background: true } : {}),
  };
}

/** Collapse ≥2 consecutive successful read-only tools into one group. */
function groupReadOnly(blocks: TranscriptBlock[]): TranscriptBlock[] {
  const out: TranscriptBlock[] = [];
  let run: ToolBlock[] = [];
  const flush = () => {
    if (run.length >= 2) out.push({ kind: "toolGroup", id: `g:${run[0]!.id}`, tools: run });
    else out.push(...run);
    run = [];
  };
  for (const b of blocks) {
    if (b.kind === "tool" && READ_ONLY_TOOLS.has(b.name) && b.status !== "error") run.push(b);
    else {
      flush();
      out.push(b);
    }
  }
  flush();
  return out;
}

const normalizeText = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Build the transcript for one agent. `live` = the run is still streaming
 * (pending tools spin instead of reading "interrupted").
 */
export function buildTranscriptBlocks(agent: AgentNode, rows: readonly TranscriptRow[], live: boolean): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  if (agent.prompt !== undefined && agent.prompt.trim().length > 0) {
    blocks.push({ kind: "prompt", id: "prompt", text: stripTruncationMarker(agent.prompt), truncated: agent.promptTruncated === true });
  }

  let todoIdx = -1;
  rows.forEach((row, i) => {
    switch (row.kind) {
      case "thinking": {
        // A thinking block is emitted once it is complete, so its duration is
        // the gap since the previous step (or the agent's start).
        const prevTs = i > 0 ? rows[i - 1]!.ts : agent.startedAtMs;
        const durationMs = prevTs !== null ? row.ts - prevTs : undefined;
        blocks.push({
          kind: "thinking",
          id: row.id,
          text: stripTruncationMarker(row.preview?.output ?? ""),
          ...(durationMs !== undefined && durationMs > 0 ? { durationMs } : {}),
        });
        return;
      }
      case "text": {
        const md = stripTruncationMarker(row.preview?.output ?? row.label);
        if (md.trim().length === 0) return;
        blocks.push({ kind: "text", id: row.id, markdown: md, truncated: row.preview?.truncated ?? false });
        return;
      }
      case "spawn": {
        if (!row.childAgentId) return;
        blocks.push({ kind: "spawn", id: row.id, label: row.label, childAgentId: row.childAgentId, status: toolStatus(row, live) });
        return;
      }
      case "tool": {
        const tool = toToolBlock(row, live);
        if (tool.name === "TodoWrite" && tool.status !== "error") {
          const todos = parseTodos(parseInput(row));
          // only the latest list is shown; an unreadable newer list retires the old one
          if (todoIdx >= 0) blocks.splice(todoIdx, 1);
          todoIdx = -1;
          if (todos) {
            blocks.push({ kind: "todo", id: row.id, todos });
            todoIdx = blocks.length - 1;
            return;
          }
        }
        if (EDIT_TOOLS.has(tool.name)) {
          const diff = editDiff(tool.name, parseInput(row));
          if (diff) {
            blocks.push({ kind: "edit", id: row.id, tool, filePath: diff.filePath, lines: diff.lines });
            return;
          }
        }
        blocks.push(tool);
        return;
      }
      case "system":
      case "unknown": {
        // Failures stay visible (e.g. "result · error_max_turns (error)", a line
        // the parser couldn't read); everything else is Raw-log only.
        if (row.status === "error") blocks.push({ kind: "notice", id: row.id, text: row.label, tone: "error" });
        else if (row.label === "parse-error" || row.label === "unrenderable event") {
          blocks.push({ kind: "notice", id: row.id, text: `${row.label} — see raw events`, tone: "neutral" });
        }
        return;
      }
      default:
        return;
    }
  });

  // The agent's final message is usually the last text row already; only add it
  // when it isn't (e.g. a subagent whose result arrived via its dispatch).
  const result = agent.result;
  if (result && result.text.trim().length > 0) {
    const resultText = stripTruncationMarker(result.text);
    const lastText = [...blocks].reverse().find((b) => b.kind === "text");
    if (!lastText || normalizeText(lastText.markdown) !== normalizeText(resultText)) {
      blocks.push({ kind: "text", id: "result", markdown: resultText, truncated: result.truncated });
    }
  }

  return groupReadOnly(blocks);
}

/** Markdown source of the last assistant text (for "Copy as markdown"). */
export function lastTextMarkdown(blocks: readonly TranscriptBlock[]): string | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]!;
    if (b.kind === "text") return b.markdown;
  }
  return null;
}

/** The run-level failure line ("result · error_max_turns (error)"), if any. */
export function runErrorLabel(rows: readonly TranscriptRow[]): string | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (r.kind === "system" && r.status === "error") return r.label;
  }
  return null;
}

function sameArray<T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean): boolean {
  return a.length === b.length && a.every((x, i) => eq(x, b[i]!));
}

function sameShallow(a: object, b: object): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

function sameBlock(a: TranscriptBlock, b: TranscriptBlock): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "toolGroup":
      return sameArray(a.tools, (b as typeof a).tools, (x, y) => x === y);
    case "edit": {
      const e = b as typeof a;
      return a.tool === e.tool && a.filePath === e.filePath && a.lines.length === e.lines.length;
    }
    case "todo":
      return sameArray(a.todos, (b as typeof a).todos, sameShallow);
    default:
      return sameShallow(a, b);
  }
}

/**
 * Reuse the previous batch's block objects when nothing in them changed, so
 * memoised block components skip re-rendering. Rebuilding is cheap; React
 * reconciliation of hundreds of markdown blocks per event batch is not.
 */
export function stabilizeBlocks(prev: ReadonlyMap<string, TranscriptBlock>, next: TranscriptBlock[]): TranscriptBlock[] {
  const reuseTool = (t: ToolBlock): ToolBlock => {
    const old = prev.get(t.id);
    return old && old.kind === "tool" && sameShallow(old, t) ? old : t;
  };
  return next.map((b) => {
    let cur: TranscriptBlock = b;
    if (b.kind === "toolGroup") cur = { ...b, tools: b.tools.map(reuseTool) };
    else if (b.kind === "edit") {
      const old = prev.get(b.id);
      const oldTool = old?.kind === "edit" ? old.tool : undefined;
      cur = { ...b, tool: oldTool && sameShallow(oldTool, b.tool) ? oldTool : b.tool };
    }
    const old = prev.get(cur.id);
    return old && sameBlock(old, cur) ? old : cur;
  });
}

/** Map every block (and every tool inside a group) by id, for stabilizeBlocks.
 *  An edit block shares its id with its tool, so only the block is indexed. */
export function indexBlocks(blocks: readonly TranscriptBlock[]): Map<string, TranscriptBlock> {
  const m = new Map<string, TranscriptBlock>();
  for (const b of blocks) {
    m.set(b.id, b);
    if (b.kind === "toolGroup") for (const t of b.tools) m.set(t.id, t);
  }
  return m;
}

/** Index of the block containing `rowId` (a tool inside a group counts), or -1. */
export function blockIndexOfRow(blocks: readonly TranscriptBlock[], rowId: string): number {
  return blocks.findIndex((b) => b.id === rowId || (b.kind === "toolGroup" && b.tools.some((t) => t.id === rowId)));
}
