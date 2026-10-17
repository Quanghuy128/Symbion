import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLine, RAW_CAP } from "../../src/run/parseStreamJson.js";
import { upgradeLegacyEvent } from "../../src/run/legacyEvents.js";
import { fold, initRunState, rollup } from "../../src/run/aggregate.js";
import { deriveAgentTree, type AgentViewContext } from "../../src/run/agentTree.js";
import type { PersistedRunEvent, RunEvent } from "../../src/run/events.js";

/** workflow-agent-run testplan §1.2 (U-L1…U-L5) — D-3 legacy upgrade. */
const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "..", "fixtures", "run");
const subLines = readFileSync(join(fixtureDir, "fixture-subagent.ndjson"), "utf-8").trimEnd().split("\n");

/** Mimic the PRE-D-1 parser's persisted shape exactly. */
function legacyCap(s: string, cap: number): string {
  return s.length <= cap ? s : `${s.slice(0, cap)}…[truncated ${s.length - cap} chars]`;
}
function legacyParse(line: string): RunEvent {
  const ev = parseLine(line);
  const obj = JSON.parse(line) as Record<string, unknown>;
  if (ev.kind === "tool-results" || ev.kind === "task") {
    return { kind: "unknown", type: String(obj["type"]), rawTruncated: legacyCap(line, RAW_CAP) };
  }
  if (ev.kind === "message") {
    // the old parser dropped thinking parts (and new tool_use extras)
    return {
      ...ev,
      parts: ev.parts
        .filter((p) => p.kind !== "thinking")
        .map((p) => {
          if (p.kind !== "tool_use") return p;
          const { background: _b, fields: _f, ...rest } = p;
          return rest;
        }),
    };
  }
  return ev;
}

describe("upgradeLegacyEvent (U-L*)", () => {
  it("U-L1: legacy unknown{type:user} with full raw deep-equals parseLine(raw)", () => {
    const raw = subLines.find((l) => l.startsWith('{"type":"user"'))!;
    const legacy = legacyParse(raw);
    expect(legacy.kind).toBe("unknown");
    expect(upgradeLegacyEvent(legacy)).toEqual(parseLine(raw));
  });

  it("U-L2: legacy unknown{type:system} task_started -> the task event", () => {
    const raw = subLines.find((l) => l.includes('"subtype":"task_started"'))!;
    const up = upgradeLegacyEvent(legacyParse(raw));
    expect(up).toEqual(parseLine(raw));
    expect(up.kind).toBe("task");
  });

  it("U-L3: truncated legacy user raw -> salvaged toolUseId + isError + legacyTruncated, empty preview", () => {
    const big = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ tool_use_id: "toolu_SALVAGE1", type: "tool_result", is_error: true, content: "E".repeat(20_000) }],
      },
      parent_tool_use_id: "toolu_PARENT",
    });
    const legacy: RunEvent = { kind: "unknown", type: "user", rawTruncated: legacyCap(big, RAW_CAP) };
    const up = upgradeLegacyEvent(legacy);
    expect(up.kind).toBe("tool-results");
    if (up.kind !== "tool-results") return;
    expect(up.parts).toEqual([
      { kind: "tool_result", toolUseId: "toolu_SALVAGE1", resultPreview: "", legacyTruncated: true, isError: true },
    ]);
    // parent_tool_use_id sat after the cut -> unknown owner (pairing is by id, not owner)
    expect(up.parentToolUseId).toBeNull();
  });

  it("U-L4: rate_limit_event / parse-error / message / thinking_tokens pass through by reference", () => {
    const evs: RunEvent[] = [
      { kind: "unknown", type: "rate_limit_event", rawTruncated: "{}" },
      { kind: "parse-error", rawTruncated: "not json" },
      { kind: "message", messageId: "m", parentToolUseId: null, model: "x", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, parts: [] },
      legacyParse(subLines.find((l) => l.includes('"subtype":"thinking_tokens"'))!),
      { kind: "unknown", type: "system", rawTruncated: "{not json" },
      { kind: "unknown", type: "user", rawTruncated: "garbage without marker" },
    ];
    for (const ev of evs) expect(upgradeLegacyEvent(ev)).toBe(ev);
  });

  it("U-L5: legacy replay vs new-parser replay through deriveAgentTree — same agents/statuses/prompts/tokens/pairing", () => {
    const mk = (parse: (l: string) => RunEvent): PersistedRunEvent[] =>
      subLines.map((l, i) => ({ seq: i + 1, ts: 1_000 + i * 100, ev: parse(l) }));
    const ctx: AgentViewContext = {
      runStatus: "completed",
      runStartedAtMs: 1_000,
      runEndedAtMs: 1_000 + subLines.length * 100,
      commandName: "probe",
      requirement: "ping",
      model: null,
      agentNames: new Set(["general-purpose"]),
    };
    const views = [mk(parseLine), mk(legacyParse)].map((events) => {
      let st = initRunState();
      for (const e of events) st = fold(st, e);
      return { view: deriveAgentTree(events, st, ctx), st };
    });
    const [fresh, legacy] = views as [(typeof views)[0], (typeof views)[0]];
    expect(rollup(legacy.st, ctx.agentNames)).toEqual(rollup(fresh.st, ctx.agentNames));
    const strip = (v: typeof fresh.view) =>
      [...v.agentsById.values()].map((a) => ({
        id: a.id,
        status: a.status,
        agentType: a.agentType,
        prompt: a.prompt,
        description: a.description,
        freshTokens: a.freshTokens,
        toolCount: a.toolCount,
        mode: a.mode,
        result: a.result?.text,
      }));
    expect(strip(legacy.view)).toEqual(strip(fresh.view));
    const rowsSig = (v: typeof fresh.view) =>
      [...v.rowsByAgent.entries()].map(([id, rows]) => [id, rows.map((r) => [r.kind, r.status, r.label, r.resultLabel])]);
    expect(rowsSig(legacy.view)).toEqual(rowsSig(fresh.view));
    // the only difference: the Thinking row has no preview in the legacy replay
    const thinkFresh = fresh.view.rowsByAgent.get("root")!.find((r) => r.kind === "thinking")!;
    const thinkLegacy = legacy.view.rowsByAgent.get("root")!.find((r) => r.kind === "thinking")!;
    expect(thinkFresh.preview?.output).toContain("The user wants me");
    expect(thinkLegacy.preview).toBeUndefined();
  });
});
