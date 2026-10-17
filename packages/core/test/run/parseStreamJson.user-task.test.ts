import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLine, PREVIEW_CAP } from "../../src/run/parseStreamJson.js";
import { fold, initRunState, rollup, type RunState } from "../../src/run/aggregate.js";
import type { PersistedRunEvent, RunEvent, RunEventKind } from "../../src/run/events.js";

/**
 * workflow-agent-run testplan §1.1 (U-P1…U-P16) — D-1 parser extension.
 * Note: the testplan's fixture "line N" numbers are off by one from the real
 * file (it omits one thinking_tokens line); lines are located by content here.
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "..", "fixtures", "run");

function readLines(name: string): string[] {
  return readFileSync(join(fixtureDir, name), "utf-8").trimEnd().split("\n");
}

const subLines = readLines("fixture-subagent.ndjson");
function lineWhere(pred: (o: Record<string, unknown>) => boolean): string {
  const l = subLines.find((x) => {
    try {
      return pred(JSON.parse(x) as Record<string, unknown>);
    } catch {
      return false;
    }
  });
  if (!l) throw new Error("fixture line not found");
  return l;
}

const userLine = lineWhere((o) => o["type"] === "user");
const taskStartedLine = lineWhere((o) => o["subtype"] === "task_started");
const taskUpdatedLine = lineWhere((o) => o["subtype"] === "task_updated");
const taskNotificationLine = lineWhere((o) => o["subtype"] === "task_notification");
const thinkingLine = subLines.find((l) => l.includes('"type":"thinking"'))!;

const ALL_KINDS: RunEventKind[] = ["init", "message", "result", "unknown", "parse-error", "tool-results", "task"];

function assistantWith(content: unknown[]): string {
  return JSON.stringify({
    type: "assistant",
    message: { id: "msg_t", model: "m", content, usage: { input_tokens: 1, output_tokens: 1 } },
    parent_tool_use_id: null,
  });
}

describe("parseStreamJson — D-1 user / task / thinking (U-P*)", () => {
  it("U-P1: fixture user line -> tool-results with async part", () => {
    const ev = parseLine(userLine);
    expect(ev.kind).toBe("tool-results");
    if (ev.kind !== "tool-results") return;
    expect(ev.parentToolUseId).toBeNull();
    expect(ev.parts).toHaveLength(1);
    const p = ev.parts[0]!;
    expect(p.kind).toBe("tool_result");
    expect(p.toolUseId).toBe("toolu_01DHEMvEreddZCGDShSNn9E7");
    expect(p.async).toBe(true);
    expect(p.resultPreview.startsWith("Async agent launched")).toBe(true);
    expect("isError" in p).toBe(false);
  });

  it("U-P2: is_error true -> isError true; false/missing -> key absent", () => {
    const mk = (isErr: unknown) =>
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_x", content: "boom", ...(isErr === undefined ? {} : { is_error: isErr }) }] },
        parent_tool_use_id: "toolu_parent",
      });
    const err = parseLine(mk(true));
    expect(err.kind === "tool-results" && err.parts[0]!.isError).toBe(true);
    expect(err.kind === "tool-results" && err.parentToolUseId).toBe("toolu_parent");
    for (const v of [false, undefined]) {
      const ok = parseLine(mk(v));
      expect(ok.kind).toBe("tool-results");
      if (ok.kind === "tool-results") expect("isError" in ok.parts[0]!).toBe(false);
    }
  });

  it("U-P3: task_started -> task with prompt/description/subagentType/toolUseId", () => {
    const ev = parseLine(taskStartedLine);
    expect(ev).toEqual({
      kind: "task",
      subtype: "task_started",
      taskId: "ad84ba941854fb18d",
      toolUseId: "toolu_01DHEMvEreddZCGDShSNn9E7",
      subagentType: "general-purpose",
      description: "Trivial ping task",
      promptPreview: 'Reply with the single word "pong".',
      taskType: "local_agent",
    });
  });

  it("U-P4: task_updated reads patch.status; toolUseId undefined", () => {
    const ev = parseLine(taskUpdatedLine);
    expect(ev.kind).toBe("task");
    if (ev.kind !== "task") return;
    expect(ev.status).toBe("completed");
    expect(ev.toolUseId).toBeUndefined();
    expect(ev.taskId).toBe("ad84ba941854fb18d");
  });

  it("U-P5: task_notification -> status + summary", () => {
    const ev = parseLine(taskNotificationLine);
    expect(ev.kind).toBe("task");
    if (ev.kind !== "task") return;
    expect(ev.status).toBe("completed");
    expect(ev.summary).toBe('Agent "Trivial ping task" finished');
    expect(ev.toolUseId).toBe("toolu_01DHEMvEreddZCGDShSNn9E7");
  });

  it("U-P6: thinking part captured, signature dropped", () => {
    const ev = parseLine(thinkingLine);
    expect(ev.kind).toBe("message");
    if (ev.kind !== "message") return;
    expect(ev.parts).toHaveLength(1);
    expect(ev.parts[0]!.kind).toBe("thinking");
    expect(ev.parts[0]!.kind === "thinking" && ev.parts[0]!.textPreview.startsWith("The user wants me")).toBe(true);
    expect(JSON.stringify(ev)).not.toContain("signature");
    expect(JSON.stringify(ev)).not.toContain("EtQCCosB");
  });

  it("U-P7: redacted_thinking -> thinking with empty text", () => {
    const ev = parseLine(assistantWith([{ type: "redacted_thinking", data: "xyz" }]));
    expect(ev.kind === "message" && ev.parts).toEqual([{ kind: "thinking", textPreview: "" }]);
  });

  it("U-P8: Bash run_in_background with a 5,000-char command -> background true, fields.command <= 300", () => {
    const command = "echo " + "x".repeat(5_000);
    const ev = parseLine(
      assistantWith([{ type: "tool_use", id: "toolu_bg", name: "Bash", input: { command, run_in_background: true } }])
    );
    expect(ev.kind).toBe("message");
    if (ev.kind !== "message") return;
    const p = ev.parts[0]!;
    expect(p.kind).toBe("tool_use");
    if (p.kind !== "tool_use") return;
    expect(p.background).toBe(true);
    expect(p.inputPreview).toContain("…[truncated");
    expect(String(p.fields!["command"]).length).toBeLessThanOrEqual(300);
    expect(p.fields!["run_in_background"]).toBe(true);
  });

  it("U-P9: Read fields whitelist only; no prompt, no foo", () => {
    const ev = parseLine(
      assistantWith([
        {
          type: "tool_use",
          id: "toolu_r",
          name: "Read",
          input: { file_path: "/a/b.ts", offset: 40, limit: 150, foo: "bar", prompt: "secret", nested: { a: 1 } },
        },
      ])
    );
    if (ev.kind !== "message" || ev.parts[0]!.kind !== "tool_use") throw new Error("shape");
    expect(ev.parts[0]!.fields).toEqual({ file_path: "/a/b.ts", offset: 40, limit: 150 });
    expect("background" in ev.parts[0]!).toBe(false);
  });

  it("U-P10: 3,000-char thinking is capped at PREVIEW_CAP with the marker", () => {
    const ev = parseLine(assistantWith([{ type: "thinking", thinking: "t".repeat(3_000), signature: "sig" }]));
    if (ev.kind !== "message" || ev.parts[0]!.kind !== "thinking") throw new Error("shape");
    const text = ev.parts[0]!.textPreview;
    expect(text.startsWith("t".repeat(PREVIEW_CAP))).toBe(true);
    expect(text).toContain("…[truncated 1000 chars]");
  });

  it("U-P11: system/thinking_tokens and rate_limit_event stay unknown", () => {
    const tt = parseLine(lineWhere((o) => o["subtype"] === "thinking_tokens"));
    expect(tt.kind).toBe("unknown");
    expect(tt.kind === "unknown" && tt.type).toBe("system");
    const rl = parseLine(lineWhere((o) => o["type"] === "rate_limit_event"));
    expect(rl.kind === "unknown" && rl.type).toBe("rate_limit_event");
  });

  it("U-P12: user with string content / no tool_result -> tool-results with []", () => {
    for (const content of ["hello", [{ type: "text", text: "hi" }], undefined, 42]) {
      const ev = parseLine(JSON.stringify({ type: "user", message: { role: "user", content } }));
      expect(ev).toEqual({ kind: "tool-results", parentToolUseId: null, parts: [] });
    }
    expect(parseLine(JSON.stringify({ type: "user" }))).toEqual({ kind: "tool-results", parentToolUseId: null, parts: [] });
  });

  it("U-P13: fuzz — 200 random mutations of user/task lines never throw and yield a valid kind", () => {
    let seed = 1234567;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const junk = (): unknown => {
      const r = rnd();
      if (r < 0.15) return null;
      if (r < 0.3) return 42;
      if (r < 0.45) return "str";
      if (r < 0.6) return [1, "a", null, { type: "tool_result" }];
      if (r < 0.75) return { type: "text" };
      if (r < 0.9) return true;
      return undefined;
    };
    const mutate = (v: unknown, depth: number): unknown => {
      if (depth > 4 || typeof v !== "object" || v === null) return rnd() < 0.3 ? junk() : v;
      if (Array.isArray(v)) return v.map((x) => mutate(x, depth + 1));
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        const r = rnd();
        if (r < 0.15) continue; // delete
        out[k] = r < 0.35 ? junk() : mutate(val, depth + 1);
      }
      return out;
    };
    const bases = [userLine, taskStartedLine, taskUpdatedLine, taskNotificationLine, thinkingLine].map(
      (l) => JSON.parse(l) as unknown
    );
    for (let i = 0; i < 200; i++) {
      const base = bases[i % bases.length];
      const mutated = mutate(base, 0);
      // keep the discriminating type most of the time so the new branches are hit
      if (typeof mutated === "object" && mutated !== null && !Array.isArray(mutated) && rnd() < 0.8) {
        (mutated as Record<string, unknown>)["type"] = (base as Record<string, unknown>)["type"];
      }
      const line = JSON.stringify(mutated) ?? "null";
      let ev: RunEvent | undefined;
      expect(() => {
        ev = parseLine(line);
      }).not.toThrow();
      expect(ALL_KINDS).toContain(ev!.kind);
    }
  });

  it("U-P13b (review fix #1): huge ids / names on user + assistant lines are capped — event stays small", () => {
    const huge = "toolu_" + "x".repeat(5_000_000);
    const hugeParent = "toolu_" + "p".repeat(1_000_000);
    const user = parseLine(
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: huge, content: "ok" }] },
        parent_tool_use_id: hugeParent,
      })
    );
    expect(user.kind).toBe("tool-results");
    expect(JSON.stringify(user).length).toBeLessThan(1_000);
    const asst = parseLine(
      JSON.stringify({
        type: "assistant",
        message: {
          id: huge,
          model: huge,
          content: [{ type: "tool_use", id: huge, name: huge, input: { subagent_type: huge } }],
        },
        parent_tool_use_id: hugeParent,
        subagent_type: huge,
      })
    );
    expect(asst.kind).toBe("message");
    // inputPreview stays at PREVIEW_CAP (+marker); every id/name/type ≤ 300 (+marker)
    if (asst.kind !== "message" || asst.parts[0]!.kind !== "tool_use") throw new Error("shape");
    const p = asst.parts[0]!;
    for (const s of [asst.messageId, asst.model, asst.parentToolUseId!, asst.topLevelSubagentType!, p.toolUseId, p.tool, p.subagentType!]) {
      expect(s.length).toBeLessThanOrEqual(300);
    }
    expect(p.inputPreview.length).toBeLessThanOrEqual(PREVIEW_CAP + 40);
    expect(JSON.stringify(asst).length).toBeLessThan(6_000);
  });

  it("U-P14: fold over the new kinds is a no-op for tokens/actors/dispatches and does not count unknownEvents", () => {
    let withNew: RunState = initRunState();
    let without: RunState = initRunState();
    let seq = 1;
    let seqWithout = 1;
    for (const line of subLines) {
      const ev = parseLine(line);
      withNew = fold(withNew, { seq: seq++, ts: seq, ev });
      if (ev.kind !== "tool-results" && ev.kind !== "task") without = fold(without, { seq: seqWithout++, ts: seq, ev });
    }
    expect(withNew.actors).toEqual(without.actors);
    expect(withNew.dispatches).toEqual(without.dispatches);
    expect(withNew.unknownEvents).toBe(without.unknownEvents);
    // thinking_tokens x4 + rate_limit_event x1 are the only unknowns left.
    expect(withNew.unknownEvents).toBe(5);
  });

  it("U-P15: rollup(fold(fixture-subagent)) identical to the pre-S1 snapshot (master values)", () => {
    let state = initRunState();
    subLines.forEach((line, i) => {
      const p: PersistedRunEvent = { seq: i + 1, ts: i, ev: parseLine(line) };
      state = fold(state, p);
    });
    const none = rollup(state, new Set());
    expect(none.command).toEqual({ ownFresh: 16, totalFresh: 20 });
    expect([...none.byAgent]).toEqual([]);
    expect(none.unrecognized).toEqual({ fresh: 4 });
    const gp = rollup(state, new Set(["general-purpose"]));
    expect(gp.command).toEqual({ ownFresh: 16, totalFresh: 20 });
    expect([...gp.byAgent]).toEqual([["general-purpose", { ownFresh: 4, totalFresh: 4 }]]);
    expect(gp.unrecognized).toEqual({ fresh: 0 });
  });
});
