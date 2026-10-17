import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLine } from "../../src/run/parseStreamJson.js";
import { fold, freshOf, initRunState, rollup, type RunState } from "../../src/run/aggregate.js";
import {
  deriveAgentTree,
  foldAgentTree,
  foldAgentTreeBatch,
  initAgentTree,
  selectAgentView,
  type AgentView,
  type AgentViewContext,
} from "../../src/run/agentTree.js";
import type { PersistedRunEvent, RunEvent, RunStatus } from "../../src/run/events.js";
import { bigRunLines } from "./helpers/bigRun.js";

/** workflow-agent-run testplan §1.4 (U-T1…U-T20) — D-5. */
const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "..", "fixtures", "run");
const readLines = (name: string) => readFileSync(join(fixtureDir, name), "utf-8").trimEnd().split("\n");

const T0 = 1_000_000;
function toEvents(lines: string[]): PersistedRunEvent[] {
  return lines.map((l, i) => ({ seq: i + 1, ts: T0 + i * 100, ev: parseLine(l) }));
}
function foldRun(events: readonly PersistedRunEvent[]): RunState {
  let s = initRunState();
  for (const e of events) s = fold(s, e);
  return s;
}
function ctxFor(status: RunStatus, extra?: Partial<AgentViewContext>): AgentViewContext {
  return {
    runStatus: status,
    runStartedAtMs: T0,
    runEndedAtMs: T0 + 10_000,
    commandName: "analyze",
    requirement: "add run diff",
    model: null,
    agentNames: new Set(["ba", "Explore"]),
    ...extra,
  };
}
function view(events: readonly PersistedRunEvent[], status: RunStatus = "completed", extra?: Partial<AgentViewContext>): AgentView {
  return deriveAgentTree(events, foldRun(events), ctxFor(status, extra));
}

const SUB_ID = "toolu_01DHEMvEreddZCGDShSNn9E7";
const A = "toolu_A_requirements";
const B = "toolu_B_solutions";
const C = "toolu_C_explore";
const O = "toolu_ORPHAN";

const subEvents = toEvents(readLines("fixture-subagent.ndjson"));
const synLines = readLines("fixture-agents-synthetic.ndjson");
const synEvents = toEvents(synLines);
const seqOf = (pred: (l: string) => boolean) => synLines.findIndex(pred) + 1;

function allRows(v: AgentView) {
  return [...v.rowsByAgent.values()].flat();
}
function totalRows(state: ReturnType<typeof initAgentTree>): number {
  let n = 0;
  for (const rec of state.agents.values()) n += rec.rows.length;
  return n;
}

describe("agentTree (U-T*)", () => {
  it("U-T1 (AC-1 real): fixture-subagent child fields, async completion, tokens = fold", () => {
    const st = foldRun(subEvents);
    const v = deriveAgentTree(subEvents, st, ctxFor("completed", { agentNames: new Set(["general-purpose"]) }));
    expect(v.root.children.map((c) => c.id)).toEqual([SUB_ID]);
    const child = v.agentsById.get(SUB_ID)!;
    expect(child.agentType).toBe("general-purpose");
    expect(child.description).toBe("Trivial ping task");
    expect(child.prompt).toBe('Reply with the single word "pong".');
    expect(child.status).toBe("done");
    expect(child.mode).toBe("background");
    expect(child.toolCount).toBe(0);
    expect(child.result?.text).toBe("pong");
    expect(child.freshTokens).toBe(freshOf(st.actors.get(SUB_ID)!.usage));
    expect(child.freshTokens).toBe(4);
    expect(v.root.freshTokens).toBe(rollup(st, new Set(["general-purpose"])).command.totalFresh);
    expect(v.root.freshTokens).toBe(20);
    // completion came from the task event, not the async tool_result
    const asyncAckSeq = subEvents.find((e) => e.ev.kind === "tool-results")!.seq;
    expect(child.endedAtMs).toBeGreaterThan(subEvents[asyncAckSeq - 1]!.ts);
  });

  it("U-T2 (AC-1 synthetic): Σ instances per name == rollup().byAgent; others + unattributed == unrecognized", () => {
    const st = foldRun(synEvents);
    const names = new Set(["ba", "Explore"]);
    const v = deriveAgentTree(synEvents, st, ctxFor("completed", { agentNames: names }));
    const r = rollup(st, names);
    const byName = new Map<string, number>();
    let other = 0;
    for (const n of v.agentsById.values()) {
      if (n.kind !== "subagent") continue;
      expect(n.freshTokens).toBe(freshOf(st.actors.get(n.id)?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }));
      const t = st.dispatches.get(n.id)?.subagentType;
      if (t && names.has(t)) byName.set(t, (byName.get(t) ?? 0) + n.freshTokens);
      else other += n.freshTokens;
    }
    other += v.unattributed?.freshTokens ?? 0;
    expect(byName).toEqual(new Map([...r.byAgent].map(([k, b]) => [k, b.ownFresh])));
    expect(other).toBe(r.unrecognized.fresh);
    expect(v.root.freshTokens).toBe(r.command.totalFresh);
  });

  it("U-T3: async agent before its completion -> running; spawn row pending", () => {
    const upTo = subEvents.findIndex((e) => e.ev.kind === "message" && e.ev.parts.some((p) => p.kind === "text" && p.textPreview.startsWith("Agent launched")));
    const prefix = subEvents.slice(0, upTo + 1);
    const v = view(prefix, "running");
    const child = v.agentsById.get(SUB_ID)!;
    expect(child.status).toBe("running");
    expect(child.mode).toBe("background");
    const spawn = v.rowsByAgent.get("root")!.find((r) => r.kind === "spawn")!;
    expect(spawn.childAgentId).toBe(SUB_ID);
    expect(spawn.status).toBe("pending");
  });

  it("U-T4: two init/result pairs; root status follows run status", () => {
    const v = view(subEvents, "running");
    expect(v.root.status).toBe("running");
    const rows = v.rowsByAgent.get("root")!;
    const inits = rows.filter((r) => r.kind === "system" && r.label.startsWith("init session"));
    const results = rows.filter((r) => r.kind === "system" && r.label.startsWith("result ·"));
    expect(inits).toHaveLength(2);
    expect(results).toHaveLength(2);
    const seqs = rows.map((r) => r.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it("U-T5: nesting — C under B; root children [A, B, O] in spawn order", () => {
    const v = view(synEvents);
    const c = v.agentsById.get(C)!;
    expect(c.parentId).toBe(B);
    expect(v.agentsById.get(B)!.children[0]).toBe(c);
    expect(v.root.children.map((x) => x.id)).toEqual([A, B, O]);
    expect(c.depth).toBe(2);
  });

  it("U-T6: B's result before A's — both done; order kept; endedAtMs = own result ts", () => {
    const v = view(synEvents);
    const a = v.agentsById.get(A)!;
    const b = v.agentsById.get(B)!;
    expect(a.status).toBe("done");
    expect(b.status).toBe("done");
    const bSeq = seqOf((l) => l.startsWith('{"type":"user"') && l.includes(`"tool_use_id":"${B}"`));
    const aSeq = seqOf((l) => l.startsWith('{"type":"user"') && l.includes(`"tool_use_id":"${A}"`));
    expect(bSeq).toBeLessThan(aSeq);
    expect(b.endedAtMs).toBe(T0 + (bSeq - 1) * 100);
    expect(a.endedAtMs).toBe(T0 + (aSeq - 1) * 100);
    expect(a.result?.text).toBe("Requirements gathered: 12 items.");
  });

  const dispatchOSeq = seqOf((l) => l.includes(`"id":"${O}"`));

  it("U-T7: orphan rows before the dispatch land in unattributed", () => {
    const v = view(synEvents.slice(0, dispatchOSeq - 1), "running");
    expect(v.unattributed).not.toBeNull();
    expect(v.rowsByAgent.get("unattributed")!.length).toBeGreaterThanOrEqual(1);
    expect(v.rowsByAgent.get("unattributed")!.every((r) => r.orphanOf === O)).toBe(true);
  });

  it("U-T8: dispatch promotes orphan rows (seq order), unattributed -> null, no row lost", () => {
    const before = foldAgentTreeBatch(initAgentTree(), synEvents.slice(0, dispatchOSeq - 1));
    const after = foldAgentTree(before, synEvents[dispatchOSeq - 1]!);
    expect(totalRows(after)).toBe(totalRows(before) + 1); // + the spawn row
    const v = selectAgentView(after, foldRun(synEvents.slice(0, dispatchOSeq)), ctxFor("running"));
    expect(v.unattributed).toBeNull();
    const oRows = v.rowsByAgent.get(O)!;
    expect(oRows.length).toBe(2);
    expect(oRows.map((r) => r.seq)).toEqual([...oRows.map((r) => r.seq)].sort((x, y) => x - y));
    expect(oRows.every((r) => r.agentId === O && r.orphanOf === undefined)).toBe(true);
    const o = v.agentsById.get(O)!;
    expect(o.toolCount).toBe(1);
    expect(o.agentType).toBe("general-purpose");
  });

  it("U-T9: A's Bash is_error -> row error, A.errorCount 1, A itself done", () => {
    const v = view(synEvents);
    const bash = v.rowsByAgent.get(A)!.find((r) => r.tool === "Bash")!;
    expect(bash.status).toBe("error");
    expect(bash.resultLabel).toBe("error");
    expect(bash.preview?.isError).toBe(true);
    const a = v.agentsById.get(A)!;
    expect(a.errorCount).toBe(1);
    expect(a.status).toBe("done");
    expect(a.toolCount).toBe(4);
  });

  it("U-T10 (AC-7): terminal mapping — cancelled / completed / failed / cancelling", () => {
    const T = T0 + 99_000;
    const cancelled = view(synEvents, "cancelled", { runEndedAtMs: T });
    for (const n of cancelled.agentsById.values()) expect(["running", "starting"]).not.toContain(n.status);
    const c = cancelled.agentsById.get(C)!;
    expect(c.status).toBe("interrupted");
    expect(c.endedAtMs).toBe(T);
    expect(cancelled.rowsByAgent.get(C)![0]!.status).toBe("interrupted");
    for (const rows of cancelled.rowsByAgent.values()) for (const r of rows) expect(r.status).not.toBe("pending");
    expect(cancelled.background).toHaveLength(1);
    expect(cancelled.background[0]!.shellId).toBe("bash_1");
    expect(cancelled.background[0]!.status).toBe("interrupted");
    expect(cancelled.root.status).toBe("interrupted");
    // spawn row of C (in B) mirrors interrupted
    expect(cancelled.rowsByAgent.get(B)!.find((r) => r.kind === "spawn")!.status).toBe("interrupted");

    const completed = view(synEvents, "completed");
    expect(completed.background[0]!.status).toBe("unknown");
    expect(completed.root.status).toBe("done");
    expect(view(synEvents, "failed").root.status).toBe("error");
    expect(view(synEvents, "timedOut").root.status).toBe("interrupted");

    const cancelling = view(synEvents, "cancelling");
    expect(cancelling.root.status).toBe("running");
    expect(cancelling.agentsById.get(C)!.status).toBe("running");
    expect(cancelling.background[0]!.status).toBe("running");
  });

  it("U-T11 (AC-6 / I1+I2): every prefix — sequential fold == batch folds in chunks of 1/7/500", () => {
    for (let k = 0; k <= synEvents.length; k++) {
      const prefix = synEvents.slice(0, k);
      let seqState = initAgentTree();
      for (const e of prefix) seqState = foldAgentTree(seqState, e);
      const st = foldRun(prefix);
      const ctx = ctxFor("running");
      const expected = selectAgentView(seqState, st, ctx);
      for (const chunk of [1, 7, 500]) {
        let s = initAgentTree();
        for (let i = 0; i < prefix.length; i += chunk) s = foldAgentTreeBatch(s, prefix.slice(i, i + chunk));
        expect(s).toEqual(seqState);
        expect(selectAgentView(s, st, ctx)).toEqual(expected);
      }
    }
  });

  it("U-T12: seq guard — refold returns the same reference; duplicates in a batch are ignored", () => {
    const s = foldAgentTreeBatch(initAgentTree(), synEvents);
    expect(foldAgentTree(s, synEvents[3]!)).toBe(s);
    expect(foldAgentTreeBatch(s, synEvents.slice(0, 5))).toBe(s);
    const withDupes = foldAgentTreeBatch(initAgentTree(), [...synEvents.slice(0, 10), ...synEvents.slice(5, 15), ...synEvents.slice(10)]);
    expect(withDupes).toEqual(s);
  });

  it("U-T13 (AC-10): 2,500-event run — fast batch fold, identity for untouched agents, per-event perf", () => {
    const big = toEvents(bigRunLines(2_500));
    expect(big).toHaveLength(2_500);
    const t0 = performance.now();
    const tree = foldAgentTreeBatch(initAgentTree(), big.slice(0, 2_400));
    const batchMs = performance.now() - t0;
    expect(batchMs).toBeLessThan(150);

    // (b) fold one more event touching a single leaf agent X (S6, depth 3).
    const st = foldRun(big.slice(0, 2_400));
    const ctx = ctxFor("running", { agentNames: new Set(["ba", "Explore", "architect"]) });
    const v1 = selectAgentView(tree, st, ctx);
    const extra: PersistedRunEvent = {
      seq: 2_401,
      ts: T0 + 2_400 * 100,
      ev: parseLine(
        JSON.stringify({
          type: "assistant",
          message: { id: "msg_extra", model: "m", content: [{ type: "text", text: "extra" }], usage: { input_tokens: 1, output_tokens: 1 } },
          parent_tool_use_id: "toolu_S6",
        })
      ),
    };
    const tree2 = foldAgentTree(tree, extra);
    const v2 = selectAgentView(tree2, fold(st, extra), ctx);
    const touched = new Set(["toolu_S6", "toolu_S5", "toolu_S1", "root"]); // X + ancestors
    for (const id of v1.agentsById.keys()) {
      if (touched.has(id)) continue;
      expect(v2.agentsById.get(id)).toBe(v1.agentsById.get(id));
      expect(v2.rowsByAgent.get(id)).toBe(v1.rowsByAgent.get(id));
    }
    expect(v2.agentsById.get("toolu_S6")).not.toBe(v1.agentsById.get("toolu_S6"));
    // rows of S5/S1 untouched even though their nodes changed (ancestor)
    expect(v2.rowsByAgent.get("toolu_S5")).toBe(v1.rowsByAgent.get("toolu_S5"));

    // (c) fold + foldAgentTree per event over 5,000 events (R-1 measurement)
    const big5k = toEvents(bigRunLines(5_000));
    const t1 = performance.now();
    let rs = initRunState();
    let ts = initAgentTree();
    for (const e of big5k) {
      rs = fold(rs, e);
      ts = foldAgentTree(ts, e);
    }
    const perEventMs = performance.now() - t1;
    // eslint-disable-next-line no-console
    console.log(`[U-T13] batch(2400)=${batchMs.toFixed(1)}ms; fold+foldAgentTree per event (5000)=${perEventMs.toFixed(1)}ms`);
    expect(perEventMs).toBeLessThan(500);
    const v5 = selectAgentView(ts, rs, ctx);
    expect(v5.agentCount).toBe(6);
  });

  it("U-T14 (I4): garbage fixture + every kind with empty/missing fields never throws", () => {
    const garbage = toEvents(readLines("fixture-garbage.ndjson"));
    const v = view(garbage, "running");
    const rows = v.rowsByAgent.get("root")!;
    expect(rows.some((r) => r.kind === "unknown" && r.status === "neutral")).toBe(true);
    expect(rows.some((r) => r.label === "parse-error")).toBe(true);

    const weird: RunEvent[] = [
      { kind: "init", sessionId: "", model: "", permissionMode: "", cliVersion: "", slashCommands: [] },
      { kind: "message", messageId: "", parentToolUseId: null, model: "", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, parts: [] },
      {
        kind: "message",
        messageId: "x",
        parentToolUseId: "toolu_nobody",
        model: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        parts: [
          { kind: "tool_use", toolUseId: "", tool: "", inputPreview: "" },
          { kind: "tool_use", toolUseId: "", tool: "Agent", inputPreview: "{" },
          { kind: "tool_result", resultPreview: "" },
          { kind: "text", textPreview: "" },
          { kind: "thinking", textPreview: "" },
        ],
      },
      { kind: "tool-results", parentToolUseId: null, parts: [] },
      { kind: "tool-results", parentToolUseId: "toolu_zz", parts: [{ kind: "tool_result", resultPreview: "" }] },
      { kind: "task", subtype: "", taskId: "" },
      { kind: "task", subtype: "task_notification", taskId: "nope", status: "completed" },
      { kind: "result", subtype: "", isError: true, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, modelUsage: [], permissionDenials: [] },
      { kind: "unknown", type: "", rawTruncated: "" },
      { kind: "unknown", type: "user", rawTruncated: "{bad…[truncated 3 chars]" },
      { kind: "parse-error", rawTruncated: "" },
    ];
    const evs = weird.map((ev, i) => ({ seq: i + 1, ts: T0 + i, ev }));
    expect(() => view(evs, "running")).not.toThrow();
    expect(() => view(evs, "cancelled")).not.toThrow();
    // structurally invalid events (core `fold` is not asked to survive these,
    // but the tree fold must): unknown kind, null ev.
    const hostile = [
      ...evs,
      { seq: evs.length + 1, ts: T0, ev: { kind: "bogus" } as unknown as RunEvent },
      { seq: evs.length + 2, ts: T0, ev: null as unknown as RunEvent },
    ];
    expect(() => selectAgentView(foldAgentTreeBatch(initAgentTree(), hostile), foldRun(evs), ctxFor("running"))).not.toThrow();
    expect(() => foldAgentTreeBatch(initAgentTree(), [null, undefined, 3, { seq: "x" }] as unknown as PersistedRunEvent[])).not.toThrow();
  });

  it("U-T15 (I3): every non-tool-results synthetic event adds ≥1 row; thinking_tokens adds none but sets nowDoing", () => {
    let s = initAgentTree();
    for (const e of synEvents) {
      const before = totalRows(s);
      s = foldAgentTree(s, e);
      if (e.ev.kind !== "tool-results") expect(totalRows(s), `seq ${e.seq} (${e.ev.kind})`).toBeGreaterThanOrEqual(before + 1);
    }
    const tt: PersistedRunEvent = {
      seq: 999,
      ts: T0 + 999,
      ev: parseLine('{"type":"system","subtype":"thinking_tokens","estimated_tokens":3}'),
    };
    const live = foldAgentTreeBatch(initAgentTree(), synEvents.slice(0, 2));
    const after = foldAgentTree(live, { ...tt, seq: 3 });
    expect(totalRows(after)).toBe(totalRows(live));
    const v = selectAgentView(after, foldRun(synEvents.slice(0, 2)), ctxFor("running"));
    expect(v.root.nowDoing).toBe("Thinking…");
  });

  it("U-T16: atMs relative to runStartedAtMs (fallback first ts); ids unique", () => {
    const v = view(synEvents, "running", { runStartedAtMs: T0 - 5_000 });
    const rows = allRows(v);
    for (const r of rows) expect(r.atMs).toBe(r.ts - (T0 - 5_000));
    const fallback = view(synEvents, "running", { runStartedAtMs: null });
    for (const r of allRows(fallback)) expect(r.atMs).toBe(r.ts - T0);
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of rows) expect(r.id).toMatch(/^\d+:\d+$/);
  });

  it("U-T17: duplicate tool_result ignored; unknown id -> standalone unmatched row", () => {
    const readResultSeq = seqOf((l) => l.includes('"tool_use_id":"toolu_A_read"'));
    const dup: PersistedRunEvent = {
      seq: synEvents.length + 1,
      ts: T0 + 50_000,
      ev: parseLine(
        JSON.stringify({
          type: "user",
          message: { content: [{ type: "tool_result", tool_use_id: "toolu_A_read", content: "DIFFERENT", is_error: true }] },
          parent_tool_use_id: A,
        })
      ),
    };
    const unknownId: PersistedRunEvent = {
      seq: synEvents.length + 2,
      ts: T0 + 50_100,
      ev: parseLine(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_never", content: "x" }] } })),
    };
    const evs = [...synEvents, dup, unknownId];
    const v = view(evs, "running");
    const read = v.rowsByAgent.get(A)!.find((r) => r.tool === "Read")!;
    expect(read.status).toBe("ok");
    expect(read.resultLabel).toBe("150 lines");
    expect(read.preview?.output).not.toBe("DIFFERENT");
    expect(read.seq).toBeLessThan(readResultSeq);
    expect(v.agentsById.get(A)!.errorCount).toBe(1);
    const unmatched = v.rowsByAgent.get("root")!.filter((r) => r.label === "result (unmatched)");
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]!.status).toBe("neutral");
  });

  it("U-T18: A's 2,500-char prompt (no task_started) -> promptTruncated, tolerant extract (never raw JSON)", () => {
    const a = view(synEvents).agentsById.get(A)!;
    expect(a.promptTruncated).toBe(true);
    expect(a.prompt!.startsWith("You are the requirements analyst.")).toBe(true);
    expect(a.prompt).not.toContain('"subagent_type"');
    expect(a.prompt).not.toContain("…[truncated");
  });

  it("U-T19 (migrated derive #1/#5): spawn row precedes the child's rows; child rows not in root", () => {
    const v = view(synEvents);
    const root = v.rowsByAgent.get("root")!;
    const spawnA = root.find((r) => r.kind === "spawn" && r.childAgentId === A)!;
    const firstA = v.rowsByAgent.get(A)![0]!;
    expect(spawnA.seq).toBeLessThan(firstA.seq);
    const childSeqs = new Set(v.rowsByAgent.get(A)!.map((r) => r.id));
    expect(root.some((r) => childSeqs.has(r.id))).toBe(false);
    expect(root.every((r) => r.agentId === "root")).toBe(true);
  });

  it("U-T20: instancesByType", () => {
    const v = view(synEvents);
    expect(v.instancesByType.get("ba")).toEqual([A, B]);
    expect(v.instancesByType.get("Explore")).toEqual([C]);
    expect(v.instancesByType.get("general-purpose")).toEqual([O]);
    expect([...v.instancesByType.values()].flat()).not.toContain("root");
    expect(v.agentCount).toBe(4);
  });

  describe("review fixes (§12 #2–#4, #8)", () => {
    const msg = (seq: number, parent: string | null, parts: unknown[], usage: Record<string, number>, id = `msg_${seq}`): PersistedRunEvent => ({
      seq,
      ts: T0 + seq * 100,
      ev: parseLine(
        JSON.stringify({ type: "assistant", message: { id, model: "m", content: parts, usage }, parent_tool_use_id: parent })
      ),
    });
    const u = (i: number, o: number, cr = 0) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr });

    it("#2: a background task launched by an orphan moves to the promoted agent", () => {
      const evs = [
        msg(1, "toolu_LATE", [{ type: "tool_use", id: "toolu_bgO", name: "Bash", input: { command: "sleep 9", run_in_background: true } }], u(1, 1)),
        msg(2, null, [{ type: "tool_use", id: "toolu_LATE", name: "Agent", input: { subagent_type: "ba", description: "late" } }], u(1, 1)),
      ];
      const before = deriveAgentTree(evs.slice(0, 1), foldRun(evs.slice(0, 1)), ctxFor("running"));
      expect(before.background[0]!.ownerAgentId).toBe("unattributed");
      const after = deriveAgentTree(evs, foldRun(evs), ctxFor("running"));
      expect(after.background[0]!.ownerAgentId).toBe("toolu_LATE");
      expect(after.rowsByAgent.get("toolu_LATE")!.some((r) => r.id === after.background[0]!.rowId)).toBe(true);
    });

    it("#3: unattributed usage refreshes when only cache tokens change (no new row)", () => {
      const e1 = msg(1, "toolu_ORPH", [{ type: "text", text: "hi" }], u(1, 1));
      const e2 = msg(2, "toolu_ORPH", [{ type: "text", text: "" }], u(0, 0, 50)); // no row, usage only
      const tree1 = foldAgentTreeBatch(initAgentTree(), [e1]);
      const v1 = selectAgentView(tree1, foldRun([e1]), ctxFor("running"));
      const tree2 = foldAgentTree(tree1, e2);
      expect(tree2.agents.get("unattributed")!.rows).toBe(tree1.agents.get("unattributed")!.rows);
      const v2 = selectAgentView(tree2, foldRun([e1, e2]), ctxFor("running"));
      expect(v1.unattributed!.usage.cacheRead).toBe(0);
      expect(v2.unattributed!.usage.cacheRead).toBe(50);
    });

    it("#4: an actor literally keyed 'unattributed'/'root' is summed into the unattributed node", () => {
      const evs = [msg(1, "unattributed", [{ type: "text", text: "a" }], u(3, 4)), msg(2, "root", [{ type: "text", text: "b" }], u(5, 6))];
      const st = foldRun(evs);
      const v = deriveAgentTree(evs, st, ctxFor("running"));
      expect(v.unattributed!.freshTokens).toBe(18);
      expect(v.unattributed!.freshTokens).toBe(rollup(st, new Set()).unrecognized.fresh);
    });
  });

  it("labels: the synthetic fixture renders extension-style one-liners (J2 pre-check)", () => {
    const v = view(synEvents);
    const aLabels = v.rowsByAgent.get(A)!.map((r) => [r.label, r.resultLabel]);
    expect(aLabels).toContainEqual(["Read STATE.md (40–189)", "150 lines"]);
    expect(aLabels).toContainEqual(['Glob "docs/loops/*.md"', "41 files"]);
    expect(aLabels).toContainEqual(['Grep "parent_tool_use_id" (in packages)', "3 matches"]);
    expect(aLabels).toContainEqual(["Bash npm test", "error"]);
    const root = v.rowsByAgent.get("root")!;
    expect(root.find((r) => r.kind === "spawn" && r.childAgentId === B)!.label).toBe('Agent ba "Solutions angle"');
    const bg = root.find((r) => r.background)!;
    expect([bg.label, bg.resultLabel]).toEqual(["Bash npm run dev", "background"]);
    expect(root.some((r) => r.kind === "unknown" && r.label === "unrecognized event (totally_new_event)")).toBe(true);
    expect(v.root.result?.text).toBe("All three angles returned. Synthesis ready.");
    expect(v.root.prompt).toBe("add run diff");
    expect(v.root.model).toBe("claude-sonnet-4-6");
    expect(v.agentsById.get(B)!.spawnedBy).toBe("root");
    expect(v.agentsById.get(C)!.spawnedBy).toBe(B);
    expect(v.agentsById.get(A)!.graphKey).toBe("ba");
    expect(v.agentsById.get(O)!.graphKey).toBeNull();
    expect(v.root.graphKey).toBe("main");
  });
});
