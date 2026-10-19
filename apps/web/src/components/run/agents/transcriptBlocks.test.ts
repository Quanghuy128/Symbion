import { describe, expect, it } from "vitest";
import type { AgentNode, TranscriptRow } from "@symbion/core";
import {
  blockIndexOfRow,
  buildTranscriptBlocks,
  displayToolName,
  editDiff,
  indexBlocks,
  lastTextMarkdown,
  runErrorLabel,
  stabilizeBlocks,
  type TranscriptBlock,
} from "./transcriptBlocks";

let seq = 0;
function row(kind: TranscriptRow["kind"], extra: Partial<TranscriptRow> = {}): TranscriptRow {
  seq += 1;
  return { id: `${seq}:0`, seq, ts: 1_000 + seq * 1_000, atMs: seq * 1_000, agentId: "root", kind, status: "ok", label: kind, ...extra };
}

function tool(name: string, label: string, extra: Partial<TranscriptRow> = {}): TranscriptRow {
  return row("tool", { tool: name, label, preview: { truncated: false, isError: false, output: "out" }, ...extra });
}

const agent = (extra: Partial<AgentNode> = {}): AgentNode =>
  ({
    id: "root",
    parentId: null,
    kind: "root",
    agentType: "/analyze",
    graphKey: "main",
    status: "done",
    startedAtMs: 1_000,
    endedAtMs: 9_000,
    freshTokens: 100,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    toolCount: 0,
    errorCount: 0,
    children: [],
    mode: "foreground",
    spawnedBy: null,
    depth: 0,
    ...extra,
  }) as AgentNode;

const kinds = (bs: TranscriptBlock[]) => bs.map((b) => b.kind);

describe("buildTranscriptBlocks", () => {
  it("prompt first; system / unknown rows are dropped (raw log only)", () => {
    const blocks = buildTranscriptBlocks(
      agent({ prompt: "hi bạn là ai" }),
      [
        row("system", { label: "init session · opus" }),
        row("unknown", { label: "unrecognized event (rate_limit_event)" }),
        row("text", { preview: { output: "**Chào bạn!**", truncated: false, isError: false } }),
        row("system", { label: "result · success" }),
      ],
      false
    );
    expect(kinds(blocks)).toEqual(["prompt", "text"]);
    expect(blocks[0]).toMatchObject({ kind: "prompt", text: "hi bạn là ai" });
    expect(blocks[1]).toMatchObject({ kind: "text", markdown: "**Chào bạn!**" });
  });

  it("thinking duration = gap since the previous step (a thinking block arrives once complete)", () => {
    const first = row("text", { preview: { output: "reading", truncated: false, isError: false } });
    const t = row("thinking", { ts: first.ts + 12_000, preview: { output: "hmm", truncated: false, isError: false } });
    const blocks = buildTranscriptBlocks(agent({ startedAtMs: first.ts - 5_000 }), [first, t], false);
    expect(blocks[1]).toMatchObject({ kind: "thinking", text: "hmm", durationMs: 12_000 });
    // first step: measured from the agent's start
    const [only] = buildTranscriptBlocks(agent({ startedAtMs: t.ts - 3_000 }), [t], false);
    expect(only).toMatchObject({ kind: "thinking", durationMs: 3_000 });
  });

  it("error results and parse errors stay visible as notices; other system rows are dropped", () => {
    const blocks = buildTranscriptBlocks(
      agent(),
      [
        row("system", { label: "init session · opus", status: "neutral" }),
        row("system", { label: "result · error_max_turns (error)", status: "error" }),
        row("unknown", { label: "parse-error", status: "neutral" }),
      ],
      false
    );
    expect(blocks).toMatchObject([
      { kind: "notice", tone: "error", text: "result · error_max_turns (error)" },
      { kind: "notice", tone: "neutral" },
    ]);
    expect(runErrorLabel([row("system", { label: "result · error_max_turns (error)", status: "error" })])).toBe(
      "result · error_max_turns (error)"
    );
  });

  it("groups ≥2 consecutive read-only tools; an error or a non-read tool breaks the group", () => {
    const blocks = buildTranscriptBlocks(
      agent(),
      [
        tool("Read", "Read a.ts"),
        tool("Grep", "Grep useLocation"),
        tool("Glob", "Glob **/*.ts"),
        tool("Bash", "Bash pnpm test"),
        tool("Read", "Read b.ts"),
        tool("Read", "Read c.ts", { status: "error" }),
      ],
      false
    );
    expect(kinds(blocks)).toEqual(["toolGroup", "tool", "tool", "tool"]);
    expect(blocks[0]!.kind === "toolGroup" && blocks[0]!.tools.map((t) => t.name)).toEqual(["Read", "Grep", "Glob"]);
  });

  it("pending tools spin while live and read 'interrupted' once the run is over", () => {
    const pending = tool("Bash", "Bash sleep", { status: "pending" });
    expect(buildTranscriptBlocks(agent(), [pending], true)[0]).toMatchObject({ kind: "tool", status: "running" });
    expect(buildTranscriptBlocks(agent(), [pending], false)[0]).toMatchObject({ kind: "tool", status: "interrupted" });
  });

  it("Edit with a full input becomes a diff; a truncated input falls back to a tool row", () => {
    const input = JSON.stringify({ file_path: "src/share.ts", old_string: "const ttl = null", new_string: "const ttl = 60\nexport { ttl }" });
    const [edit] = buildTranscriptBlocks(agent(), [tool("Edit", "Edit share.ts", { preview: { input, truncated: false, isError: false } })], false);
    expect(edit).toMatchObject({ kind: "edit", filePath: "src/share.ts" });
    expect(edit!.kind === "edit" && edit!.lines).toEqual([
      { sign: "-", text: "const ttl = null" },
      { sign: "+", text: "const ttl = 60" },
      { sign: "+", text: "export { ttl }" },
    ]);
    const [cut] = buildTranscriptBlocks(
      agent(),
      [tool("Edit", "Edit share.ts", { preview: { input: input.slice(0, 20), inputTruncated: true, truncated: false, isError: false } })],
      false
    );
    expect(cut!.kind).toBe("tool");
  });

  it("a failed TodoWrite keeps the list; an unreadable newer one retires it", () => {
    const todo = (extra: Partial<TranscriptRow>) =>
      tool("TodoWrite", "TodoWrite", {
        preview: { input: JSON.stringify({ todos: [{ content: "a", status: "pending" }] }), truncated: false, isError: false },
        ...extra,
      });
    expect(kinds(buildTranscriptBlocks(agent(), [todo({}), todo({ status: "error" })], false))).toEqual(["todo", "tool"]);
    const cut = todo({ preview: { input: '{"todos":[{"content":"a', inputTruncated: true, truncated: false, isError: false } });
    expect(kinds(buildTranscriptBlocks(agent(), [todo({}), cut], false))).toEqual(["tool"]);
  });

  it("only the latest TodoWrite list is shown", () => {
    const todo = (items: string[]) =>
      tool("TodoWrite", "TodoWrite", {
        preview: { input: JSON.stringify({ todos: items.map((content) => ({ content, status: "pending" })) }), truncated: false, isError: false },
      });
    const blocks = buildTranscriptBlocks(agent(), [todo(["a"]), row("text", { preview: { output: "x", truncated: false, isError: false } }), todo(["a", "b"])], false);
    expect(kinds(blocks)).toEqual(["text", "todo"]);
    expect(blocks[1]!.kind === "todo" && blocks[1]!.todos.map((t) => t.content)).toEqual(["a", "b"]);
  });

  it("appends the agent result only when it isn't already the last text", () => {
    const text = row("text", { preview: { output: "final  answer", truncated: false, isError: false } });
    const same = buildTranscriptBlocks(agent({ result: { text: "final answer", truncated: false, isError: false } }), [text], false);
    expect(kinds(same)).toEqual(["text"]);
    const other = buildTranscriptBlocks(agent({ result: { text: "subagent summary", truncated: false, isError: false } }), [text], false);
    expect(kinds(other)).toEqual(["text", "text"]);
    expect(lastTextMarkdown(other)).toBe("subagent summary");
  });

  it("spawn rows become subagent rows", () => {
    const [b] = buildTranscriptBlocks(agent(), [row("spawn", { label: 'Agent ba "Solutions"', childAgentId: "toolu_B", status: "pending" })], true);
    expect(b).toMatchObject({ kind: "spawn", childAgentId: "toolu_B", status: "running" });
  });
});

describe("stabilizeBlocks", () => {
  it("reuses unchanged block objects (and grouped tools) across rebuilds; changed ones are new", () => {
    const rows = [tool("Read", "Read a.ts"), tool("Grep", "Grep x"), row("text", { preview: { output: "hi", truncated: false, isError: false } })];
    const first = stabilizeBlocks(new Map(), buildTranscriptBlocks(agent(), rows, true));
    const again = stabilizeBlocks(indexBlocks(first), buildTranscriptBlocks(agent(), rows.map((r) => ({ ...r })), true));
    expect(again[0]).toBe(first[0]);
    expect(again[1]).toBe(first[1]);
    const changed = rows.map((r, i) => (i === 1 ? { ...r, status: "error" as const } : { ...r }));
    const third = stabilizeBlocks(indexBlocks(again), buildTranscriptBlocks(agent(), changed, true));
    expect(third[2]).toBe(again[1]); // the text block is untouched
    expect(third[0]).not.toBe(again[0]);
  });

  it("blockIndexOfRow finds a tool inside a group", () => {
    const blocks = buildTranscriptBlocks(agent(), [tool("Read", "Read a.ts", { id: "r1" }), tool("Grep", "Grep x", { id: "r2" })], false);
    expect(blockIndexOfRow(blocks, "r2")).toBe(0);
    expect(blockIndexOfRow(blocks, "nope")).toBe(-1);
  });
});

describe("helpers", () => {
  it("displayToolName shortens MCP tool names", () => {
    expect(displayToolName("mcp__github__create_pr")).toBe("github · create_pr");
    expect(displayToolName("Read")).toBe("Read");
  });

  it("editDiff handles Write and MultiEdit; rejects inputs without a path", () => {
    expect(editDiff("Write", { file_path: "a.ts", content: "x\ny\n" })?.lines).toEqual([
      { sign: "+", text: "x" },
      { sign: "+", text: "y" },
    ]);
    expect(
      editDiff("MultiEdit", { file_path: "a.ts", edits: [{ old_string: "a", new_string: "b" }] })?.lines
    ).toEqual([
      { sign: "-", text: "a" },
      { sign: "+", text: "b" },
    ]);
    expect(editDiff("Edit", { old_string: "a", new_string: "b" })).toBeNull();
  });
});
