/**
 * Test-only helpers for the Agents panel suites (not imported by app code).
 * Builds real `AgentView`s from the core synthetic fixture so web tests
 * exercise the same fold the app uses.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  deriveAgentTree,
  fold,
  initRunState,
  parseLine,
  type AgentView,
  type AgentViewContext,
  type PersistedRunEvent,
  type RunState,
  type RunStatus,
} from "@symbion/core";

export const T0 = 1_000_000;
export const A = "toolu_A_requirements";
export const B = "toolu_B_solutions";
export const C = "toolu_C_explore";
export const O = "toolu_ORPHAN";

const FIXTURE = path.resolve(__dirname, "../../../../../../packages/core/test/fixtures/run/fixture-agents-synthetic.ndjson");

export function syntheticLines(): string[] {
  return readFileSync(FIXTURE, "utf-8").trimEnd().split("\n");
}

export function toEvents(lines: string[], t0 = T0): PersistedRunEvent[] {
  return lines.map((l, i) => ({ seq: i + 1, ts: t0 + i * 100, ev: parseLine(l) }));
}

export function foldAll(events: readonly PersistedRunEvent[]): RunState {
  let s = initRunState();
  for (const e of events) s = fold(s, e);
  return s;
}

export function ctx(status: RunStatus, extra?: Partial<AgentViewContext>): AgentViewContext {
  return {
    runStatus: status,
    runStartedAtMs: T0,
    runEndedAtMs: status === "running" || status === "starting" || status === "cancelling" ? null : T0 + 30_000,
    commandName: "analyze",
    requirement: "add run diff",
    model: null,
    agentNames: new Set(["ba"]),
    ...extra,
  };
}

export function syntheticView(status: RunStatus = "running", count?: number, extra?: Partial<AgentViewContext>): { view: AgentView; events: PersistedRunEvent[] } {
  const all = toEvents(syntheticLines());
  const events = count === undefined ? all : all.slice(0, count);
  return { view: deriveAgentTree(events, foldAll(events), ctx(status, extra)), events };
}

/** n simple root text events (for paging / raw-log tests). */
export function textEvents(n: number, t0 = T0): PersistedRunEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    ts: t0 + i,
    ev: {
      kind: "message" as const,
      messageId: `m${i}`,
      parentToolUseId: null,
      model: "m",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      parts: [{ kind: "text" as const, textPreview: `line ${i}` }],
    },
  }));
}
