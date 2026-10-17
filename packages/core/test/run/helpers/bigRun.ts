/**
 * bigRun — deterministic generator of a large stream-json run (testplan §0.1):
 * root + 6 subagents (2 of them nested), each doing Read / Grep / Bash calls
 * paired with their results. Used by U-T13 (AC-10) and emitted as the QA
 * fixture `apps/daemon/test/fixtures/fixture-big-2500.ndjson`.
 */
const S = "sess-big";

function usage(i: number, o: number) {
  return { input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
}

function assistant(id: string, content: unknown[], parent: string | null, subagentType?: string, u = usage(10, 2)): string {
  const o: Record<string, unknown> = {
    type: "assistant",
    message: { model: "claude-sonnet-4-6", id, type: "message", role: "assistant", content, usage: u },
    parent_tool_use_id: parent,
    session_id: S,
  };
  if (subagentType) o["subagent_type"] = subagentType;
  return JSON.stringify(o);
}

function user(toolUseId: string, content: string, parent: string | null, isError = false): string {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ tool_use_id: toolUseId, type: "tool_result", content, ...(isError ? { is_error: true } : {}) }] },
    parent_tool_use_id: parent,
    session_id: S,
  });
}

export interface BigRunAgent {
  id: string;
  parent: string | null;
  type: string;
}

/** The 6 subagents: 4 under root, S5 under S1, S6 under S5 (depth 3). */
export const BIG_RUN_AGENTS: BigRunAgent[] = [
  { id: "toolu_S1", parent: null, type: "ba" },
  { id: "toolu_S2", parent: null, type: "ba" },
  { id: "toolu_S3", parent: null, type: "architect" },
  { id: "toolu_S4", parent: null, type: "Explore" },
  { id: "toolu_S5", parent: "toolu_S1", type: "Explore" },
  { id: "toolu_S6", parent: "toolu_S5", type: "general-purpose" },
];

/** Exactly `n` lines (n ≥ 20). Deterministic. */
export function bigRunLines(n = 2_500): string[] {
  const lines: string[] = [];
  lines.push(JSON.stringify({ type: "system", subtype: "init", session_id: S, model: "claude-sonnet-4-6", permissionMode: "acceptEdits", claude_code_version: "2.1.187", slash_commands: [] }));
  for (const a of BIG_RUN_AGENTS) {
    lines.push(
      assistant(
        `msg_dispatch_${a.id}`,
        [{ type: "tool_use", id: a.id, name: "Agent", input: { subagent_type: a.type, description: `work ${a.id}`, prompt: `Do the ${a.id} work.` } }],
        a.parent,
        a.parent ? BIG_RUN_AGENTS.find((x) => x.id === a.parent)!.type : undefined
      )
    );
  }
  const actors: Array<{ parent: string | null; type?: string }> = [
    { parent: null },
    ...BIG_RUN_AGENTS.map((a) => ({ parent: a.id, type: a.type })),
  ];
  // closing lines: results for the 6 dispatches (deepest first), a final text, result
  const closing = BIG_RUN_AGENTS.length + 2;
  let i = 0;
  while (lines.length + 2 <= n - closing) {
    const actor = actors[i % actors.length]!;
    const tool = ["Read", "Grep", "Bash"][i % 3]!;
    const id = `toolu_big_${i}`;
    const input =
      tool === "Read"
        ? { file_path: `/repo/src/file${i % 50}.ts`, offset: 1 + (i % 30), limit: 40 }
        : tool === "Grep"
          ? { pattern: `sym${i % 17}`, path: "src" }
          : { command: `npm run task-${i % 9}` };
    lines.push(assistant(`msg_big_${i}`, [{ type: "tool_use", id, name: tool, input }], actor.parent, actor.type));
    const body = Array.from({ length: 1 + (i % 12) }, (_, k) => `out ${i}.${k}`).join("\n");
    lines.push(user(id, body, actor.parent, tool === "Bash" && i % 37 === 0));
    i++;
  }
  while (lines.length < n - closing) {
    lines.push(assistant(`msg_pad_${lines.length}`, [{ type: "text", text: `note ${lines.length}` }], null));
  }
  for (const a of [...BIG_RUN_AGENTS].reverse()) lines.push(user(a.id, `done ${a.id}`, a.parent));
  lines.push(assistant("msg_final", [{ type: "text", text: "All work finished." }], null));
  lines.push(JSON.stringify({ type: "result", subtype: "success", is_error: false, usage: usage(0, 0), modelUsage: {}, permission_denials: [] }));
  return lines;
}
