import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLine, RAW_CAP, type RunEvent } from "../../src/run/parseStreamJson.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "..", "fixtures", "run");

function readLines(name: string): string[] {
  return readFileSync(join(fixtureDir, name), "utf-8").trimEnd().split("\n");
}

describe("parseStreamJson — real fixture (§1.1)", () => {
  const lines = readLines("fixture-simple.ndjson");
  const events = lines.map(parseLine);

  it("#1 kinds are exactly [init, unknown, message, result]", () => {
    expect(events.map((e) => e.kind)).toEqual(["init", "unknown", "message", "result"]);
  });

  it("#2 init fields", () => {
    const init = events[0];
    expect(init.kind).toBe("init");
    if (init.kind !== "init") return;
    expect(init.sessionId).toBe("51aa1c99-43bc-4a55-a632-629da44a9280");
    expect(init.cliVersion).toBe("2.1.187");
    expect(init.permissionMode).toBe("bypassPermissions");
    expect(init.slashCommands).toContain("run");
  });

  it("#3 rate_limit_event -> unknown with retained raw", () => {
    const ev = events[1];
    expect(ev.kind).toBe("unknown");
    if (ev.kind !== "unknown") return;
    expect(ev.type).toBe("rate_limit_event");
    expect(ev.rawTruncated.length).toBeLessThanOrEqual(RAW_CAP + 64);
    expect(ev.rawTruncated).toContain("rate_limit_event");
  });

  it("#4 assistant line", () => {
    const ev = events[2];
    expect(ev.kind).toBe("message");
    if (ev.kind !== "message") return;
    expect(ev.messageId).toBe("msg_011Cd23QyssXLp41L4TVH3Ki");
    expect(ev.parentToolUseId).toBeNull();
    expect(ev.usage).toEqual({ input: 2655, output: 4, cacheWrite: 9980, cacheRead: 0 });
  });

  it("#5 result line", () => {
    const ev = events[3];
    expect(ev.kind).toBe("result");
    if (ev.kind !== "result") return;
    expect(ev.totalCostUsd).toBe(0.22691);
    expect(ev.durationMs).toBe(6216);
    expect(ev.numTurns).toBe(1);
    expect(ev.modelUsage).toHaveLength(2);
    expect(ev.permissionDenials).toEqual([]);
  });
});

describe("parseStreamJson — real subagent fixture (§1.1 #8, P2, STATE §13.3)", () => {
  const lines = readLines("fixture-subagent.ndjson");
  const events = lines.map(parseLine);

  it("parses every line without throwing", () => {
    for (const line of lines) expect(() => parseLine(line)).not.toThrow();
  });

  it("has a Task/Agent-family tool_use part naming a subagent", () => {
    const dispatchParts = events
      .filter((e): e is Extract<RunEvent, { kind: "message" }> => e.kind === "message")
      .flatMap((e) => e.parts)
      .filter((p): p is Extract<typeof p, { kind: "tool_use" }> => p.kind === "tool_use")
      .filter((p) => p.tool === "Task" || p.tool === "Agent");
    expect(dispatchParts.length).toBeGreaterThan(0);
  });

  it("has at least one message with a non-null parentToolUseId AND a top-level subagentType", () => {
    const messages = events.filter((e): e is Extract<RunEvent, { kind: "message" }> => e.kind === "message");
    const dispatched = messages.filter((e) => e.parentToolUseId !== null);
    expect(dispatched.length).toBeGreaterThan(0);
    expect(dispatched.some((e) => e.topLevelSubagentType === "general-purpose")).toBe(true);
  });

  it("tolerates the new event types this longer transcript revealed (NEW-3): system/thinking_tokens, system/task_started, system/task_updated, system/task_notification, a second system/init", () => {
    // parseLine only recognizes system/init as a distinct kind; every other
    // system/* subtype (thinking_tokens, task_started, task_updated,
    // task_notification) falls through to "unknown" — already-covered by the
    // P1 unknown-type contract, no parser change required for this fixture.
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("init");
    expect(kinds).toContain("unknown");
    expect(kinds).toContain("message");
    expect(kinds).toContain("result");
    // exactly two inits in this transcript (the async Agent dispatch's
    // completion re-emits an init frame) — both parse as "init", not a crash.
    expect(kinds.filter((k) => k === "init").length).toBe(2);
  });
});

describe("parseStreamJson — garbage fixture (§1.1 #6)", () => {
  const lines = readLines("fixture-garbage.ndjson");

  it("never throws on any line", () => {
    for (const line of lines) {
      expect(() => parseLine(line)).not.toThrow();
    }
  });

  it("non-JSON -> parse-error; invented type -> unknown; huge line raw truncated to RAW_CAP", () => {
    const events = lines.map(parseLine);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("parse-error");
    // invented type + rate_limit_event both -> unknown
    const unknowns = events.filter((e): e is Extract<RunEvent, { kind: "unknown" }> => e.kind === "unknown");
    expect(unknowns.some((e) => e.type === "totally_new_event")).toBe(true);
    for (const ev of events) {
      if (ev.kind === "unknown" || ev.kind === "parse-error") {
        expect(ev.rawTruncated.length).toBeLessThanOrEqual(RAW_CAP + 64);
      }
    }
  });
});

describe("parseStreamJson — tolerance (§1.1 #7)", () => {
  it("assistant with usage deleted -> message with zeroed usage, not a throw", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { id: "msg_x", model: "m", content: [{ type: "text", text: "hi" }] },
      parent_tool_use_id: null,
    });
    const ev = parseLine(line);
    expect(ev.kind).toBe("message");
    if (ev.kind !== "message") return;
    expect(ev.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it("empty string / whitespace -> parse-error, no throw", () => {
    expect(parseLine("").kind).toBe("parse-error");
    expect(parseLine("   ").kind).toBe("parse-error");
    expect(() => parseLine("null")).not.toThrow();
    expect(parseLine("null").kind).toBe("parse-error");
  });
});
