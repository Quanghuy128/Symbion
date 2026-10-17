/**
 * agentTree — the incremental agent-tree fold + pure view projection
 * (workflow-agent-run D-2 / D-5). PURE — no Node imports.
 *
 *   state = foldAgentTreeBatch(initAgentTree(), events)    // O(batch), copy-on-write
 *   view  = selectAgentView(state, runState, ctx)          // memoized by reference
 *
 * Invariants (unit-tested): I1 the fold is a pure function of the seq-ordered
 * prefix (replay == live); I2 foldAgentTreeBatch(s, es) deep-equals folding es
 * one by one; I3 no event is dropped — every non-`tool-results` event yields
 * ≥1 row except the documented suppressions (system/thinking_tokens, a
 * duplicate dispatch, a message whose parts are all empty text); I4 never
 * throws on any RunEvent.
 *
 * Tokens are NEVER summed here (D-5): selectAgentView reads every number from
 * the SAME `RunState` (`fold`) the graph badges use, so they cannot drift.
 *
 * Copy-on-write: inside one fold call (single event or a whole batch) a
 * `Draft` clones each touched container at most once; untouched agents keep
 * the same record and the same `rows` array reference across folds, which
 * lets selectAgentView (and React) skip them.
 */
import { freshOf, rollup, type RunState } from "./aggregate.js";
import type { ContentPart, FourWay, PersistedRunEvent, RunEvent, RunStatus, ToolFields } from "./events.js";
import { upgradeLegacyEvent } from "./legacyEvents.js";
import { summarizeToolCall, LABEL_CAP } from "./summarizeToolCall.js";
import { extractPromptFromPreview, isTruncatedPreview, readToolInput, stripTruncationMarker } from "./toolInput.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public view-model types (design §4, plus the plan's additive fields)
// ─────────────────────────────────────────────────────────────────────────────

export type AgentStatus = "starting" | "running" | "done" | "error" | "interrupted";
export type RowStatus = "ok" | "error" | "pending" | "interrupted" | "neutral";
export type BackgroundStatus = "running" | "done" | "error" | "unknown" | "interrupted";

export const ROOT_AGENT_ID = "root";
export const UNATTRIBUTED_AGENT_ID = "unattributed";

export interface TranscriptRowPreview {
  input?: string;
  output?: string;
  /** the OUTPUT preview was capped (ends with the parser's marker). */
  truncated: boolean;
  /** the INPUT preview was capped. */
  inputTruncated?: boolean;
  isError: boolean;
  stepTokens?: { input: number; output: number };
}

export interface TranscriptRow {
  /** `${seq}:${partIndex}` — stable across live/replay. */
  id: string;
  seq: number;
  /** epoch ms at daemon ingest. */
  ts: number;
  /** ms since run start (ts − runStartedAtMs, falling back to the first event's ts). */
  atMs: number;
  agentId: string;
  kind: "thinking" | "tool" | "spawn" | "text" | "result" | "system" | "unknown";
  status: RowStatus;
  label: string;
  resultLabel?: string;
  /** tool name for tool/spawn rows. */
  tool?: string;
  childAgentId?: string;
  background?: boolean;
  /** result text was lost in a pre-upgrade run (D-3). */
  legacyTruncated?: boolean;
  /** set while the row sits in the unattributed bucket: the unseen dispatch id. */
  orphanOf?: string;
  preview?: TranscriptRowPreview;
}

export interface AgentResult {
  text: string;
  truncated: boolean;
  isError: boolean;
}

export interface AgentNode {
  id: string;
  parentId: string | null;
  kind: "root" | "subagent" | "unattributed";
  agentType: string;
  description?: string;
  model?: string;
  /** key into the graph's run data: "main" for the root, the agent name for a
   *  subagent whose agentType is a graph agent, else null ("not on graph"). */
  graphKey: string | null;
  status: AgentStatus;
  /** epoch ms. */
  startedAtMs: number | null;
  endedAtMs?: number;
  /** root: rollup().command.totalFresh (= the command badge); others: own fresh. */
  freshTokens: number;
  /** this agent's own FourWay (from RunState.actors). */
  usage: FourWay;
  toolCount: number;
  errorCount: number;
  nowDoing?: string;
  prompt?: string;
  promptTruncated?: boolean;
  result?: AgentResult;
  children: AgentNode[];
  mode: "foreground" | "background";
  /** the parent agent's id (null for root / unattributed). */
  spawnedBy: string | null;
  depth: number;
}

export interface BackgroundTask {
  toolUseId: string;
  /** the transcript row of the launching tool_use (in the owner's transcript). */
  rowId: string;
  ownerAgentId: string;
  label: string;
  /** first line of the command, for the `$ …` rendering. */
  command?: string;
  shellId?: string;
  status: BackgroundStatus;
  startedAtMs: number | null;
  endedAtMs?: number;
}

export interface AgentViewContext {
  runStatus: RunStatus;
  runStartedAtMs: number | null;
  runEndedAtMs: number | null;
  commandName: string;
  requirement: string;
  model: string | null;
  agentNames: ReadonlySet<string>;
}

export interface AgentView {
  root: AgentNode;
  unattributed: AgentNode | null;
  background: BackgroundTask[];
  agentsById: ReadonlyMap<string, AgentNode>;
  rowsByAgent: ReadonlyMap<string, readonly TranscriptRow[]>;
  /** agentType -> subagent instance ids in spawn order (root excluded). */
  instancesByType: ReadonlyMap<string, readonly string[]>;
  /** number of subagents (root and unattributed excluded). */
  agentCount: number;
  /** number of events folded (for "rebuilding agents… N ev"). */
  eventCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal state
// ─────────────────────────────────────────────────────────────────────────────

interface AgentRecord {
  readonly id: string;
  readonly kind: "root" | "subagent" | "unattributed";
  parentId: string | null;
  /** owner key of the dispatching message (parentToolUseId ?? "root"). */
  parentKey: string | null;
  agentType?: string;
  description?: string;
  model?: string;
  prompt?: string;
  promptTruncated?: boolean;
  promptFromTask?: boolean;
  startTs: number | null;
  endTs?: number;
  status: "running" | "done" | "error" | "interrupted";
  mode: "foreground" | "background";
  result?: AgentResult;
  lastText?: { text: string; truncated: boolean };
  rows: TranscriptRow[];
  childIds: string[];
  toolCount: number;
  errorCount: number;
  nowDoing?: string;
  spawnRowId?: string;
  spawnOwnerKey?: string;
}

interface ToolIndexEntry {
  ownerKey: string;
  rowId: string;
  tool: string;
  input: ToolFields;
}

const BUCKETS = 64;
type Buckets<V> = ReadonlyArray<ReadonlyMap<string, V> | undefined>;

function bucketOf(k: string): number {
  let h = 2166136261;
  for (let i = 0; i < k.length; i++) {
    h ^= k.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % BUCKETS;
}

export interface AgentTreeState {
  readonly lastSeq: number;
  readonly eventCount: number;
  readonly firstTs: number | null;
  readonly agents: ReadonlyMap<string, AgentRecord>;
  /** subagent ids in creation order. */
  readonly order: readonly string[];
  readonly toolIndex: Buckets<ToolIndexEntry>;
  /** taskId -> toolUseId (learned from task_started). */
  readonly taskToTool: ReadonlyMap<string, string>;
  /** orphan parent ids currently held in the unattributed bucket -> first-seen meta. */
  readonly orphans: ReadonlyMap<string, { subagentType?: string; model?: string }>;
  readonly background: readonly BackgroundTask[];
}

function newRecord(id: string, kind: AgentRecord["kind"], parentId: string | null, parentKey: string | null, startTs: number | null): AgentRecord {
  return {
    id,
    kind,
    parentId,
    parentKey,
    startTs,
    status: "running",
    mode: "foreground",
    rows: [],
    childIds: [],
    toolCount: 0,
    errorCount: 0,
  };
}

export function initAgentTree(): AgentTreeState {
  return {
    lastSeq: 0,
    eventCount: 0,
    firstTs: null,
    agents: new Map([[ROOT_AGENT_ID, newRecord(ROOT_AGENT_ID, "root", null, null, null)]]),
    order: [],
    toolIndex: Array.from({ length: BUCKETS }, () => undefined),
    taskToTool: new Map(),
    orphans: new Map(),
    background: [],
  };
}

/** One mutable working copy per fold call; clones every container at most once. */
class Draft {
  lastSeq: number;
  eventCount: number;
  firstTs: number | null;
  agents: Map<string, AgentRecord> | null = null;
  order: string[] | null = null;
  toolIndex: Array<Map<string, ToolIndexEntry> | ReadonlyMap<string, ToolIndexEntry> | undefined> | null = null;
  taskToTool: Map<string, string> | null = null;
  orphans: Map<string, { subagentType?: string; model?: string }> | null = null;
  background: BackgroundTask[] | null = null;
  private clonedRecords = new Set<string>();
  private clonedRows = new Set<string>();
  private clonedBuckets = new Set<number>();

  constructor(readonly base: AgentTreeState) {
    this.lastSeq = base.lastSeq;
    this.eventCount = base.eventCount;
    this.firstTs = base.firstTs;
  }

  getAgent(id: string): AgentRecord | undefined {
    return (this.agents ?? this.base.agents).get(id);
  }
  hasAgent(id: string): boolean {
    return (this.agents ?? this.base.agents).has(id);
  }
  /** a writable record (cloned once per draft). */
  writeAgent(id: string): AgentRecord {
    if (!this.agents) this.agents = new Map(this.base.agents);
    const rec = this.agents.get(id);
    if (!rec) throw new Error(`agentTree: unknown agent ${id}`);
    if (this.clonedRecords.has(id)) return rec;
    const copy: AgentRecord = { ...rec };
    this.agents.set(id, copy);
    this.clonedRecords.add(id);
    return copy;
  }
  /** a writable rows array of a writable record (cloned once per draft). */
  writeRows(id: string): TranscriptRow[] {
    const rec = this.writeAgent(id);
    if (!this.clonedRows.has(id)) {
      rec.rows = rec.rows.slice();
      this.clonedRows.add(id);
    }
    return rec.rows;
  }
  addAgent(rec: AgentRecord): void {
    if (!this.agents) this.agents = new Map(this.base.agents);
    this.agents.set(rec.id, rec);
    this.clonedRecords.add(rec.id);
    this.clonedRows.add(rec.id);
    if (rec.kind === "subagent") {
      if (!this.order) this.order = this.base.order.slice();
      this.order.push(rec.id);
    }
  }
  toolGet(k: string): ToolIndexEntry | undefined {
    return (this.toolIndex ?? this.base.toolIndex)[bucketOf(k)]?.get(k);
  }
  toolSet(k: string, v: ToolIndexEntry): void {
    if (!this.toolIndex) this.toolIndex = this.base.toolIndex.slice();
    const b = bucketOf(k);
    if (!this.clonedBuckets.has(b)) {
      this.toolIndex[b] = new Map(this.toolIndex[b] ?? []);
      this.clonedBuckets.add(b);
    }
    (this.toolIndex[b] as Map<string, ToolIndexEntry>).set(k, v);
  }
  getTaskTool(taskId: string): string | undefined {
    return (this.taskToTool ?? this.base.taskToTool).get(taskId);
  }
  setTaskTool(taskId: string, toolUseId: string): void {
    if (!this.taskToTool) this.taskToTool = new Map(this.base.taskToTool);
    this.taskToTool.set(taskId, toolUseId);
  }
  getOrphans(): ReadonlyMap<string, { subagentType?: string; model?: string }> {
    return this.orphans ?? this.base.orphans;
  }
  writeOrphans(): Map<string, { subagentType?: string; model?: string }> {
    if (!this.orphans) this.orphans = new Map(this.base.orphans);
    return this.orphans;
  }
  getBackground(): readonly BackgroundTask[] {
    return this.background ?? this.base.background;
  }
  writeBackground(): BackgroundTask[] {
    if (!this.background) this.background = this.base.background.slice();
    return this.background;
  }

  finish(): AgentTreeState {
    return {
      lastSeq: this.lastSeq,
      eventCount: this.eventCount,
      firstTs: this.firstTs,
      agents: this.agents ?? this.base.agents,
      order: this.order ?? this.base.order,
      toolIndex: (this.toolIndex as Buckets<ToolIndexEntry> | null) ?? this.base.toolIndex,
      taskToTool: this.taskToTool ?? this.base.taskToTool,
      orphans: this.orphans ?? this.base.orphans,
      background: this.background ?? this.base.background,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fold
// ─────────────────────────────────────────────────────────────────────────────

const DISPATCH_TOOLS = new Set(["Task", "Agent"]);
const KILL_TOOLS = new Set(["KillShell", "KillBash"]);
const OUTPUT_TOOLS = new Set(["BashOutput", "TaskOutput"]);

function clipLabel(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= LABEL_CAP ? one : `${one.slice(0, LABEL_CAP - 1)}…`;
}

function firstLine(s: string): string {
  return (s.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "").trim();
}

/** resolve a message's owner key to the agent that currently holds its rows. */
function resolveOwner(d: Draft, ownerKey: string): string {
  if (ownerKey === ROOT_AGENT_ID) return ROOT_AGENT_ID;
  if (d.hasAgent(ownerKey)) {
    const rec = d.getAgent(ownerKey)!;
    if (rec.kind === "subagent") return ownerKey;
  }
  return UNATTRIBUTED_AGENT_ID;
}

/** ensure the owner exists (creating the unattributed bucket lazily) and note orphans. */
function ownerFor(d: Draft, parentToolUseId: string | null, meta?: { subagentType?: string; model?: string }): { agentId: string; ownerKey: string } {
  const ownerKey = parentToolUseId ?? ROOT_AGENT_ID;
  const agentId = resolveOwner(d, ownerKey);
  if (agentId === UNATTRIBUTED_AGENT_ID) {
    if (!d.hasAgent(UNATTRIBUTED_AGENT_ID)) {
      d.addAgent(newRecord(UNATTRIBUTED_AGENT_ID, "unattributed", null, null, null));
    }
    if (!d.getOrphans().has(ownerKey)) d.writeOrphans().set(ownerKey, { ...meta });
  }
  return { agentId, ownerKey };
}

function pushRow(d: Draft, agentId: string, row: TranscriptRow): void {
  d.writeRows(agentId).push(row);
}

function findRowIndex(rows: readonly TranscriptRow[], rowId: string): number {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.id === rowId) return i;
  return -1;
}

function updateRow(d: Draft, agentId: string, rowId: string, patch: (r: TranscriptRow) => TranscriptRow): boolean {
  const rec = d.getAgent(agentId);
  if (!rec) return false;
  const idx = findRowIndex(rec.rows, rowId);
  if (idx < 0) return false;
  const rows = d.writeRows(agentId);
  rows[idx] = patch(rows[idx]!);
  return true;
}

function setNowDoing(d: Draft, agentId: string, label: string): void {
  const rec = d.getAgent(agentId);
  if (!rec || rec.nowDoing === label) return;
  d.writeAgent(agentId).nowDoing = label;
}

function spawnStatusOf(status: AgentRecord["status"]): RowStatus {
  return status === "running" ? "pending" : status === "done" ? "ok" : status === "error" ? "error" : "interrupted";
}

/** complete a subagent (idempotent: only from running). Syncs its spawn row. */
function completeAgent(d: Draft, agentId: string, status: "done" | "error" | "interrupted", ts: number, result?: AgentResult): void {
  const rec = d.getAgent(agentId);
  if (!rec || rec.kind !== "subagent" || rec.status !== "running") return;
  const w = d.writeAgent(agentId);
  w.status = status;
  w.endTs = ts;
  w.nowDoing = undefined;
  const res = result ?? (w.lastText ? { text: w.lastText.text, truncated: w.lastText.truncated, isError: status === "error" } : undefined);
  if (res) w.result = res;
  if (w.spawnRowId && w.spawnOwnerKey) {
    const owner = resolveOwner(d, w.spawnOwnerKey);
    const rowId = w.spawnRowId;
    updateRow(d, owner, rowId, (r) => ({ ...r, status: spawnStatusOf(status) }));
  }
}

function mapTaskStatus(status: string | undefined): "done" | "error" | "interrupted" | null {
  switch ((status ?? "").toLowerCase()) {
    case "completed":
    case "complete":
    case "success":
    case "succeeded":
      return "done";
    case "failed":
    case "error":
    case "errored":
      return "error";
    case "killed":
    case "stopped":
    case "cancelled":
    case "canceled":
    case "interrupted":
      return "interrupted";
    default:
      return null;
  }
}

function setBackgroundStatus(d: Draft, pred: (t: BackgroundTask) => boolean, status: BackgroundStatus, ts: number, patch?: Partial<BackgroundTask>): void {
  const list = d.getBackground();
  const idx = list.findIndex((t) => pred(t) && t.status === "running");
  if (idx < 0) {
    if (patch) {
      const j = list.findIndex(pred);
      if (j >= 0) d.writeBackground()[j] = { ...list[j]!, ...patch };
    }
    return;
  }
  const next: BackgroundTask = { ...list[idx]!, ...patch };
  if (status !== "running") {
    next.status = status;
    next.endedAtMs = ts;
  }
  d.writeBackground()[idx] = next;
}

/** promote orphan rows/children once the dispatch `childId` is seen (rule 7). */
function promoteOrphans(d: Draft, childId: string): void {
  if (!d.getOrphans().has(childId)) return;
  const meta = d.getOrphans().get(childId)!;
  d.writeOrphans().delete(childId);
  const un = d.getAgent(UNATTRIBUTED_AGENT_ID);
  if (!un) return;
  const moving = un.rows.filter((r) => r.orphanOf === childId);
  const child = d.writeAgent(childId);
  if (!child.agentType && meta.subagentType) child.agentType = meta.subagentType;
  if (!child.model && meta.model) child.model = meta.model;
  if (moving.length > 0) {
    const unw = d.writeAgent(UNATTRIBUTED_AGENT_ID);
    unw.rows = un.rows.filter((r) => r.orphanOf !== childId);
    let tools = 0;
    let errors = 0;
    for (const r of moving) {
      if (r.kind === "tool") {
        tools++;
        if (r.status === "error") errors++;
      }
    }
    unw.toolCount -= tools;
    unw.errorCount -= errors;
    const rows = d.writeRows(childId);
    for (const r of moving) {
      const { orphanOf: _o, ...rest } = r;
      rows.push({ ...rest, agentId: childId });
    }
    rows.sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
    const cw = d.writeAgent(childId);
    cw.toolCount += tools;
    cw.errorCount += errors;
    // review fix #2: background tasks launched from a moved row now belong to the child.
    const movedIds = new Set(moving.map((r) => r.id));
    const bg = d.getBackground();
    bg.forEach((t, i) => {
      if (t.ownerAgentId === UNATTRIBUTED_AGENT_ID && movedIds.has(t.rowId)) {
        d.writeBackground()[i] = { ...t, ownerAgentId: childId };
      }
    });
    const lastText = [...moving].reverse().find((r) => r.kind === "text");
    if (lastText && !cw.lastText) {
      cw.lastText = { text: lastText.preview?.output ?? lastText.label, truncated: lastText.preview?.truncated ?? false };
    }
  }
  // re-parent nested dispatches made from inside the orphan.
  const unNow = d.getAgent(UNATTRIBUTED_AGENT_ID)!;
  const reparent = unNow.childIds.filter((cid) => d.getAgent(cid)?.parentKey === childId);
  if (reparent.length > 0) {
    d.writeAgent(UNATTRIBUTED_AGENT_ID).childIds = unNow.childIds.filter((cid) => !reparent.includes(cid));
    const cw = d.writeAgent(childId);
    cw.childIds = [...cw.childIds, ...reparent];
    for (const cid of reparent) d.writeAgent(cid).parentId = childId;
  }
}

function foldMessage(d: Draft, p: PersistedRunEvent, ev: Extract<RunEvent, { kind: "message" }>): void {
  const { agentId, ownerKey } = ownerFor(d, ev.parentToolUseId, { subagentType: ev.topLevelSubagentType, model: ev.model || undefined });
  const owner = d.getAgent(agentId)!;
  if (owner.kind === "subagent") {
    if ((!owner.model && ev.model) || (!owner.agentType && ev.topLevelSubagentType)) {
      const w = d.writeAgent(agentId);
      if (!w.model && ev.model) w.model = ev.model;
      if (!w.agentType && ev.topLevelSubagentType) w.agentType = ev.topLevelSubagentType;
    }
  }
  const orphanOf = agentId === UNATTRIBUTED_AGENT_ID ? ownerKey : undefined;
  const atMs = p.ts - (d.firstTs ?? p.ts);
  const stepTokens = { input: ev.usage.input, output: ev.usage.output };
  const base = (i: number) => ({
    id: `${p.seq}:${i}`,
    seq: p.seq,
    ts: p.ts,
    atMs,
    agentId,
    ...(orphanOf ? { orphanOf } : {}),
  });

  if (ev.parts.length === 0) {
    // Pre-upgrade runs persisted a thinking-only assistant event as parts:[]
    // (Q-a) — rendered as a non-expandable Thinking row.
    pushRow(d, agentId, { ...base(0), kind: "thinking", status: "neutral", label: "Thinking" });
    setNowDoing(d, agentId, "Thinking…");
    return;
  }

  ev.parts.forEach((part: ContentPart, i) => {
    switch (part.kind) {
      case "thinking": {
        const row: TranscriptRow = { ...base(i), kind: "thinking", status: "neutral", label: "Thinking" };
        if (part.textPreview.length > 0) {
          row.preview = { output: part.textPreview, truncated: isTruncatedPreview(part.textPreview), isError: false };
        }
        pushRow(d, agentId, row);
        setNowDoing(d, agentId, "Thinking…");
        return;
      }
      case "text": {
        if (part.textPreview.trim().length === 0) return;
        const label = clipLabel(stripTruncationMarker(part.textPreview));
        pushRow(d, agentId, {
          ...base(i),
          kind: "text",
          status: "neutral",
          label,
          preview: { output: part.textPreview, truncated: isTruncatedPreview(part.textPreview), isError: false, stepTokens },
        });
        const w = d.writeAgent(agentId);
        w.lastText = { text: part.textPreview, truncated: isTruncatedPreview(part.textPreview) };
        w.nowDoing = label;
        return;
      }
      case "tool_use": {
        const input = readToolInput(part);
        const { label } = summarizeToolCall(part.tool, input);
        const preview: TranscriptRowPreview = {
          input: part.inputPreview,
          truncated: false,
          inputTruncated: isTruncatedPreview(part.inputPreview),
          isError: false,
          stepTokens,
        };
        if (DISPATCH_TOOLS.has(part.tool) && part.toolUseId) {
          if (d.hasAgent(part.toolUseId)) return; // duplicate dispatch id — ignored (rule 1)
          const childId = part.toolUseId;
          const rowId = `${p.seq}:${i}`;
          const child = newRecord(childId, "subagent", agentId, ownerKey, p.ts);
          const st = part.subagentType ?? (typeof input["subagent_type"] === "string" ? (input["subagent_type"] as string) : undefined);
          if (st) child.agentType = st;
          if (typeof input["description"] === "string") child.description = input["description"] as string;
          const prompt = extractPromptFromPreview(part.inputPreview);
          if (prompt) {
            child.prompt = prompt.text;
            child.promptTruncated = prompt.truncated;
          }
          child.spawnRowId = rowId;
          child.spawnOwnerKey = ownerKey;
          d.addAgent(child);
          const pw = d.writeAgent(agentId);
          pw.childIds = [...pw.childIds, childId];
          pushRow(d, agentId, { ...base(i), kind: "spawn", status: "pending", label, tool: part.tool, childAgentId: childId, preview });
          d.toolSet(childId, { ownerKey, rowId, tool: part.tool, input });
          setNowDoing(d, agentId, label);
          promoteOrphans(d, childId);
          return;
        }
        const row: TranscriptRow = { ...base(i), kind: "tool", status: "pending", label, tool: part.tool, preview };
        if (part.background) row.background = true;
        pushRow(d, agentId, row);
        const w = d.writeAgent(agentId);
        w.toolCount += 1;
        w.nowDoing = label;
        if (part.toolUseId) d.toolSet(part.toolUseId, { ownerKey, rowId: row.id, tool: part.tool, input });
        if (part.background && part.toolUseId) {
          const command = typeof input["command"] === "string" ? firstLine(input["command"] as string) : undefined;
          d.writeBackground().push({
            toolUseId: part.toolUseId,
            rowId: row.id,
            ownerAgentId: agentId,
            label,
            ...(command ? { command } : {}),
            status: "running",
            startedAtMs: p.ts,
          });
        }
        if (KILL_TOOLS.has(part.tool)) {
          const shell = input["shell_id"] ?? input["bash_id"];
          if (typeof shell === "string") setBackgroundStatus(d, (t) => t.shellId === shell, "interrupted", p.ts);
        }
        return;
      }
      case "tool_result": {
        foldToolResult(d, p, part, ev.parentToolUseId, i);
        return;
      }
    }
  });
}

const BG_ID_RE = /ID:\s*([A-Za-z0-9_.:-]+)/;
const BG_STATUS_RE = /<status>\s*(running|completed|failed|killed)\s*<\/status>|\bstatus:\s*(running|completed|failed|killed)\b/i;
const BG_EXIT_RE = /exit[_ ]code[>:\s]*(-?\d+)/i;

function foldToolResult(
  d: Draft,
  p: PersistedRunEvent,
  part: Extract<ContentPart, { kind: "tool_result" }>,
  parentToolUseId: string | null,
  partIndex: number
): void {
  const entry = part.toolUseId ? d.toolGet(part.toolUseId) : undefined;
  const ownerAgent = entry ? resolveOwner(d, entry.ownerKey) : undefined;
  const isError = part.isError === true;
  const text = typeof part.resultPreview === "string" ? part.resultPreview : "";
  const truncated = isTruncatedPreview(text);
  const legacy = part.legacyTruncated === true;

  if (!entry || !ownerAgent || !d.getAgent(ownerAgent) || findRowIndex(d.getAgent(ownerAgent)!.rows, entry.rowId) < 0) {
    // Result for an unknown id -> standalone neutral row in the event's owner.
    const { agentId, ownerKey } = ownerFor(d, parentToolUseId);
    const row: TranscriptRow = {
      id: `${p.seq}:${partIndex}`,
      seq: p.seq,
      ts: p.ts,
      atMs: p.ts - (d.firstTs ?? p.ts),
      agentId,
      kind: "tool",
      status: "neutral",
      label: "result (unmatched)",
      ...(agentId === UNATTRIBUTED_AGENT_ID ? { orphanOf: ownerKey } : {}),
      preview: { output: text, truncated, isError },
      ...(legacy ? { legacyTruncated: true } : {}),
    };
    pushRow(d, agentId, row);
    return;
  }

  const rec = d.getAgent(ownerAgent)!;
  const current = rec.rows[findRowIndex(rec.rows, entry.rowId)]!;
  // tool rows leave "pending" only by pairing; spawn rows track their own
  // status (mirrors the child), so "paired" = an OUTPUT has been recorded.
  const alreadyPaired = current.kind === "spawn" ? current.preview?.output !== undefined : current.status !== "pending";
  if (alreadyPaired) return; // second result for the same id — idempotent

  if (current.kind === "spawn") {
    const isAsync = part.async === true || /^Async agent launched/.test(text);
    updateRow(d, ownerAgent, entry.rowId, (r) => ({
      ...r,
      ...(legacy ? { legacyTruncated: true } : {}),
      preview: { ...(r.preview ?? { truncated: false, isError: false }), output: text, truncated, isError },
    }));
    const childId = current.childAgentId!;
    if (isAsync) {
      const child = d.getAgent(childId);
      if (child && child.mode !== "background") d.writeAgent(childId).mode = "background";
      return;
    }
    completeAgent(d, childId, isError ? "error" : "done", p.ts, legacy && text === "" ? undefined : { text, truncated, isError });
    return;
  }

  const summary = summarizeToolCall(entry.tool, entry.input, { text, isError, truncated });
  const resultLabel = legacy ? (isError ? "error" : undefined) : summary.resultLabel;
  updateRow(d, ownerAgent, entry.rowId, (r) => {
    const next: TranscriptRow = {
      ...r,
      status: isError ? "error" : "ok",
      preview: { ...(r.preview ?? { truncated: false, isError: false }), output: text, truncated, isError },
    };
    if (resultLabel !== undefined) next.resultLabel = resultLabel;
    if (legacy) next.legacyTruncated = true;
    return next;
  });
  if (isError) d.writeAgent(ownerAgent).errorCount += 1;

  // Background bookkeeping (rule 8, best effort — A-2).
  if (current.background && part.toolUseId) {
    const m = BG_ID_RE.exec(text);
    if (m) setBackgroundStatus(d, (t) => t.toolUseId === part.toolUseId, "running", p.ts, { shellId: m[1]! });
  }
  if (OUTPUT_TOOLS.has(entry.tool)) {
    const shell = entry.input["shell_id"] ?? entry.input["bash_id"] ?? entry.input["task_id"];
    const sm = BG_STATUS_RE.exec(text);
    const s = (sm?.[1] ?? sm?.[2] ?? "").toLowerCase();
    if (typeof shell === "string" && s && s !== "running") {
      const exit = BG_EXIT_RE.exec(text);
      const status: BackgroundStatus =
        s === "killed" ? "interrupted" : s === "failed" || (exit && exit[1] !== "0") ? "error" : "done";
      setBackgroundStatus(d, (t) => t.shellId === shell || t.toolUseId === shell, status, p.ts);
    }
  }
}

function foldTask(d: Draft, p: PersistedRunEvent, ev: Extract<RunEvent, { kind: "task" }>): void {
  if (ev.toolUseId && ev.taskId && !d.getTaskTool(ev.taskId)) d.setTaskTool(ev.taskId, ev.toolUseId);
  const toolUseId = ev.toolUseId ?? (ev.taskId ? d.getTaskTool(ev.taskId) : undefined);
  const mapped = mapTaskStatus(ev.status);

  if (toolUseId && d.getAgent(toolUseId)?.kind === "subagent") {
    const rec = d.getAgent(toolUseId)!;
    const needType = !rec.agentType && ev.subagentType;
    const needDesc = !rec.description && ev.description;
    const needPrompt = ev.promptPreview !== undefined && !rec.promptFromTask;
    if (needType || needDesc || needPrompt) {
      const w = d.writeAgent(toolUseId);
      if (needType) w.agentType = ev.subagentType;
      if (needDesc) w.description = ev.description;
      if (needPrompt) {
        w.prompt = stripTruncationMarker(ev.promptPreview!);
        w.promptTruncated = isTruncatedPreview(ev.promptPreview!);
        w.promptFromTask = true;
      }
    }
    if (mapped) completeAgent(d, toolUseId, mapped, p.ts);
  } else if (toolUseId && mapped) {
    const bgStatus: BackgroundStatus = mapped;
    setBackgroundStatus(d, (t) => t.toolUseId === toolUseId, bgStatus, p.ts);
  }

  const bits = [ev.subtype || "task"];
  if (ev.status) bits.push(ev.status);
  if (ev.description) bits.push(ev.description);
  pushRow(d, ROOT_AGENT_ID, {
    id: `${p.seq}:0`,
    seq: p.seq,
    ts: p.ts,
    atMs: p.ts - (d.firstTs ?? p.ts),
    agentId: ROOT_AGENT_ID,
    kind: "system",
    status: "neutral",
    label: clipLabel(`task · ${bits.join(" · ")}`),
    ...(ev.summary ? { preview: { output: ev.summary, truncated: isTruncatedPreview(ev.summary), isError: false } } : {}),
  });
}

const SUBTYPE_RE = /"subtype"\s*:\s*"([^"\\]{1,80})"/;
const PARENT_RE = /"parent_tool_use_id"\s*:\s*"([^"\\]{1,200})"/;

function rootRow(d: Draft, p: PersistedRunEvent, kind: TranscriptRow["kind"], status: RowStatus, label: string, preview?: TranscriptRowPreview): void {
  pushRow(d, ROOT_AGENT_ID, {
    id: `${p.seq}:0`,
    seq: p.seq,
    ts: p.ts,
    atMs: p.ts - (d.firstTs ?? p.ts),
    agentId: ROOT_AGENT_ID,
    kind,
    status,
    label: clipLabel(label),
    ...(preview ? { preview } : {}),
  });
}

function foldOne(d: Draft, p: PersistedRunEvent): void {
  if (d.firstTs === null) d.firstTs = p.ts;
  d.lastSeq = p.seq;
  d.eventCount += 1;
  const root = d.getAgent(ROOT_AGENT_ID)!;
  if (root.startTs === null) d.writeAgent(ROOT_AGENT_ID).startTs = p.ts;

  const ev = upgradeLegacyEvent(p.ev);
  switch (ev.kind) {
    case "init": {
      if (!root.model && ev.model) d.writeAgent(ROOT_AGENT_ID).model = ev.model;
      rootRow(d, p, "system", "neutral", `init session · ${ev.model || "unknown model"}`);
      return;
    }
    case "message":
      foldMessage(d, p, ev);
      return;
    case "tool-results":
      ev.parts.forEach((part, i) => foldToolResult(d, p, part, ev.parentToolUseId, i));
      return;
    case "task":
      foldTask(d, p, ev);
      return;
    case "result":
      rootRow(d, p, "system", ev.isError ? "error" : "ok", `result · ${ev.subtype || "unknown"}${ev.isError ? " (error)" : ""}`);
      return;
    case "unknown": {
      const raw = typeof ev.rawTruncated === "string" ? ev.rawTruncated : "";
      const subtype = ev.type === "system" ? SUBTYPE_RE.exec(raw)?.[1] : undefined;
      if (ev.type === "system" && subtype === "thinking_tokens") {
        const parent = PARENT_RE.exec(raw)?.[1] ?? null;
        const agentId = parent ? resolveOwner(d, parent) : ROOT_AGENT_ID;
        if (d.hasAgent(agentId)) setNowDoing(d, agentId, "Thinking…");
        return; // documented suppression (I3) — the Raw log keeps it
      }
      const what = subtype ? `${ev.type}/${subtype}` : ev.type || "?";
      rootRow(d, p, "unknown", "neutral", `unrecognized event (${what})`, { output: raw, truncated: isTruncatedPreview(raw), isError: false });
      return;
    }
    case "parse-error": {
      const raw = typeof ev.rawTruncated === "string" ? ev.rawTruncated : "";
      rootRow(d, p, "unknown", "neutral", "parse-error", { output: raw, truncated: isTruncatedPreview(raw), isError: false });
      return;
    }
    default:
      rootRow(d, p, "unknown", "neutral", "unrecognized event");
  }
}

function safeFoldOne(d: Draft, p: PersistedRunEvent): void {
  try {
    foldOne(d, p);
  } catch {
    // I4 belt-and-braces: a structurally impossible event must never take the
    // panel down. The event still counts (seq advanced) and gets a neutral row.
    try {
      rootRow(d, p, "unknown", "neutral", "unrenderable event");
    } catch {
      /* give up on this event */
    }
  }
}

function isPersisted(e: unknown): e is PersistedRunEvent {
  return typeof e === "object" && e !== null && typeof (e as PersistedRunEvent).seq === "number" && typeof (e as PersistedRunEvent).ts === "number" && typeof (e as PersistedRunEvent).ev === "object" && (e as PersistedRunEvent).ev !== null;
}

/** Fold ONE event. Seq guard: `e.seq <= lastSeq` returns the same reference. */
export function foldAgentTree(s: AgentTreeState, e: PersistedRunEvent): AgentTreeState {
  if (!isPersisted(e) || e.seq <= s.lastSeq) return s;
  const d = new Draft(s);
  safeFoldOne(d, e);
  return d.finish();
}

/** Fold a batch (one copy-on-write pass). Deep-equals folding one by one (I2). */
export function foldAgentTreeBatch(s: AgentTreeState, es: readonly PersistedRunEvent[]): AgentTreeState {
  let d: Draft | null = null;
  for (const e of es) {
    if (!isPersisted(e)) continue;
    if (e.seq <= (d ? d.lastSeq : s.lastSeq)) continue;
    if (!d) d = new Draft(s);
    safeFoldOne(d, e);
  }
  return d ? d.finish() : s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Select (pure projection, memoized by reference)
// ─────────────────────────────────────────────────────────────────────────────

const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>(["completed", "failed", "cancelled", "timedOut"]);
const ZERO: FourWay = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

interface RowsMemo {
  origin: number;
  terminal: boolean;
  out: readonly TranscriptRow[];
}
const rowsMemo = new WeakMap<readonly TranscriptRow[], RowsMemo>();

function projectRows(rows: readonly TranscriptRow[], origin: number, firstTs: number, terminal: boolean): readonly TranscriptRow[] {
  const offsetZero = origin === firstTs;
  if (offsetZero && !terminal) return rows;
  const memo = rowsMemo.get(rows);
  if (memo && memo.origin === origin && memo.terminal === terminal) return memo.out;
  const out = rows.map((r) => {
    const atMs = r.ts - origin;
    const status: RowStatus = terminal && r.status === "pending" ? "interrupted" : r.status;
    return atMs === r.atMs && status === r.status ? r : { ...r, atMs, status };
  });
  rowsMemo.set(rows, { origin, terminal, out });
  return out;
}

interface NodeMemo {
  deps: readonly unknown[];
  out: AgentNode;
}
const nodeMemo = new WeakMap<AgentRecord, NodeMemo>();

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

export function selectAgentView(tree: AgentTreeState, run: RunState, ctx: AgentViewContext): AgentView {
  const terminal = TERMINAL.has(ctx.runStatus);
  const firstTs = tree.firstTs ?? 0;
  const origin = ctx.runStartedAtMs ?? tree.firstTs ?? 0;
  const endTs = ctx.runEndedAtMs;
  const agentsById = new Map<string, AgentNode>();
  const rowsByAgent = new Map<string, readonly TranscriptRow[]>();
  const instancesByType = new Map<string, string[]>();

  const rowsOf = (rec: AgentRecord) => projectRows(rec.rows, origin, firstTs, terminal);

  const typeOf = (rec: AgentRecord): string => {
    if (rec.kind === "root") return `/${ctx.commandName}`;
    if (rec.kind === "unattributed") return "unattributed";
    return run.dispatches.get(rec.id)?.subagentType ?? rec.agentType ?? "subagent";
  };

  const build = (id: string, depth: number): AgentNode | null => {
    const rec = tree.agents.get(id);
    if (!rec) return null;
    const children: AgentNode[] = [];
    for (const cid of rec.childIds) {
      const c = build(cid, depth + 1);
      if (c) children.push(c);
    }
    const rows = rowsOf(rec);
    const actorKey = rec.kind === "root" ? "main" : rec.id;
    const actor = run.actors.get(actorKey);
    const agentType = typeOf(rec);
    let freshTokens = actor ? freshOf(actor.usage) : 0;
    let usage = actor?.usage ?? ZERO;
    let rootStatusKey: string = "";
    if (rec.kind === "root") {
      freshTokens = rollup(run, ctx.agentNames as Set<string>).command.totalFresh;
      rootStatusKey = `${ctx.runStatus}:${tree.lastSeq === 0 ? 0 : 1}`;
    } else if (rec.kind === "unattributed") {
      let sum = { ...ZERO };
      let fresh = 0;
      for (const [k, a] of run.actors) {
        // review fix #4: skip only the main actor and REAL subagents — an actor
        // literally keyed "root"/"unattributed" is still an orphan bucket.
        if (k === "main" || tree.agents.get(k)?.kind === "subagent") continue;
        fresh += freshOf(a.usage);
        sum = {
          input: sum.input + a.usage.input,
          output: sum.output + a.usage.output,
          cacheRead: sum.cacheRead + a.usage.cacheRead,
          cacheWrite: sum.cacheWrite + a.usage.cacheWrite,
        };
      }
      freshTokens = fresh;
      usage = sum;
    }
    const deps: unknown[] = [
      rows,
      actor,
      // review fix #3: the unattributed node's usage is a fresh sum — compare by value
      usage.input,
      usage.output,
      usage.cacheRead,
      usage.cacheWrite,
      terminal,
      endTs,
      agentType,
      depth,
      freshTokens,
      rootStatusKey,
      ctx.agentNames,
      ctx.requirement,
      ctx.model,
      ...children,
    ];
    const memo = nodeMemo.get(rec);
    let out: AgentNode;
    if (memo && sameDeps(memo.deps, deps)) {
      out = memo.out;
    } else {
      out = toNode(rec, { children, rows, agentType, depth, freshTokens, usage, terminal, ctx, tree });
      nodeMemo.set(rec, { deps, out });
    }
    agentsById.set(id, out);
    rowsByAgent.set(id, rows);
    if (rec.kind === "subagent") {
      const list = instancesByType.get(agentType);
      if (list) list.push(id);
      else instancesByType.set(agentType, [id]);
    }
    return out;
  };

  const root = build(ROOT_AGENT_ID, 0)!;
  const unRec = tree.agents.get(UNATTRIBUTED_AGENT_ID);
  const unattributed =
    unRec && (unRec.rows.length > 0 || unRec.childIds.length > 0) ? build(UNATTRIBUTED_AGENT_ID, 0) : null;
  // keep instance order = spawn order regardless of tree nesting
  // review fix #8: O(n) index map instead of indexOf inside the comparator
  const orderIndex = new Map<string, number>();
  tree.order.forEach((id, i) => orderIndex.set(id, i));
  for (const [k, ids] of instancesByType) {
    ids.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
    instancesByType.set(k, ids);
  }

  const background = tree.background.map((t) => {
    if (!terminal || t.status !== "running") return t;
    return {
      ...t,
      status: (ctx.runStatus === "completed" ? "unknown" : "interrupted") as BackgroundStatus,
      ...(endTs !== null ? { endedAtMs: endTs } : {}),
    };
  });

  let agentCount = 0;
  for (const n of agentsById.values()) if (n.kind === "subagent") agentCount++;

  return { root, unattributed, background, agentsById, rowsByAgent, instancesByType, agentCount, eventCount: tree.eventCount };
}

function toNode(
  rec: AgentRecord,
  x: {
    children: AgentNode[];
    rows: readonly TranscriptRow[];
    agentType: string;
    depth: number;
    freshTokens: number;
    usage: FourWay;
    terminal: boolean;
    ctx: AgentViewContext;
    tree: AgentTreeState;
  }
): AgentNode {
  const { ctx, terminal } = x;
  let status: AgentStatus;
  let endedAtMs = rec.endTs;
  let result = rec.result;
  if (rec.kind === "root" || rec.kind === "unattributed") {
    if (terminal) {
      status = ctx.runStatus === "completed" ? "done" : ctx.runStatus === "failed" ? "error" : "interrupted";
      endedAtMs = ctx.runEndedAtMs ?? undefined;
    } else {
      status = x.tree.lastSeq === 0 ? "starting" : "running";
    }
    if (rec.kind === "root" && rec.lastText) {
      result = { text: rec.lastText.text, truncated: rec.lastText.truncated, isError: ctx.runStatus === "failed" };
    }
  } else if (terminal && rec.status === "running") {
    status = "interrupted";
    endedAtMs = ctx.runEndedAtMs ?? undefined;
  } else {
    status = rec.status;
  }
  if (rec.kind === "subagent" && !result && status !== "running" && rec.lastText) {
    result = { text: rec.lastText.text, truncated: rec.lastText.truncated, isError: status === "error" };
  }

  const out: AgentNode = {
    id: rec.id,
    parentId: rec.parentId,
    kind: rec.kind,
    agentType: x.agentType,
    graphKey: rec.kind === "root" ? "main" : rec.kind === "subagent" && ctx.agentNames.has(x.agentType) ? x.agentType : null,
    status,
    startedAtMs: rec.kind === "root" ? ctx.runStartedAtMs ?? rec.startTs : rec.startTs,
    freshTokens: x.freshTokens,
    usage: x.usage,
    toolCount: rec.toolCount,
    errorCount: rec.errorCount,
    children: x.children,
    mode: rec.mode,
    spawnedBy: rec.kind === "subagent" ? rec.parentId : null,
    depth: x.depth,
  };
  if (rec.description !== undefined) out.description = rec.description;
  const model = rec.kind === "root" ? rec.model || ctx.model || undefined : rec.model;
  if (model) out.model = model;
  if (endedAtMs !== undefined) out.endedAtMs = endedAtMs;
  if ((status === "running" || status === "starting") && rec.nowDoing) out.nowDoing = rec.nowDoing;
  if (rec.kind === "root") {
    out.prompt = ctx.requirement;
  } else if (rec.prompt !== undefined) {
    out.prompt = rec.prompt;
    if (rec.promptTruncated) out.promptTruncated = true;
  }
  if (result) out.result = result;
  return out;
}

/** One-shot convenience (tests / history): fold all events then select (D-2). */
export function deriveAgentTree(events: readonly PersistedRunEvent[], run: RunState, ctx: AgentViewContext): AgentView {
  return selectAgentView(foldAgentTreeBatch(initAgentTree(), events), run, ctx);
}
