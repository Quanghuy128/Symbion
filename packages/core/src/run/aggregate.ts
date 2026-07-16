/**
 * aggregate — the roll-up/fold reducer (P2, STATE §13.1 aggregate.ts). PURE —
 * no Node imports (AC-RUN-11). Daemon and web call `fold`/`rollup` identically
 * (the "one reducer, numbers cannot drift" invariant, A2/A11) over the SAME
 * ordered `PersistedRunEvent` stream (seq-numbered, backfill-then-live,
 * already proven gap/dup-free by P1's `run-sse.test.ts`).
 *
 * Locked fresh formula (§6.6): fresh = usage.input + usage.output.
 * cacheRead/cacheWrite NEVER enter a headline number, only the FourWay
 * breakdown.
 *
 * Dedup (Flaw F5): stream-json can emit one `assistant` event per content
 * block, all sharing one `message.id`/usage — naive summing double-counts.
 * `fold` tracks each actor's seen `messageId`s and adds usage only once per id.
 *
 * Seq guard: `fold` is a no-op (same object reference returned) if
 * `persisted.seq <= state.lastSeq` — the belt-and-braces client dedup
 * contract (Flaw F2/A2); P2 is the first caller to rely on it for token math.
 */
import type { FourWay, PersistedRunEvent, RunEvent } from "./events.js";

export interface ActorUsage {
  usage: FourWay;
  messageIds: Set<string>;
}

export interface RunState {
  lastSeq: number;
  init?: {
    sessionId: string;
    model: string;
    permissionMode: string;
    cliVersion: string;
    slashCommands: string[];
  };
  actors: Map<string, ActorUsage>;
  dispatches: Map<string, { subagentType?: string; atSeq: number }>;
  result?: Extract<RunEvent, { kind: "result" }>;
  parseErrors: number;
  unknownEvents: number;
}

const MAIN_ACTOR = "main";

function zeroFourWay(): FourWay {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function addFourWay(a: FourWay, b: FourWay): FourWay {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

export function initRunState(): RunState {
  return {
    lastSeq: 0,
    actors: new Map(),
    dispatches: new Map(),
    parseErrors: 0,
    unknownEvents: 0,
  };
}

/** fresh = input + output (locked §6.6) — the ONLY headline-number formula. */
export function freshOf(usage: FourWay): number {
  return usage.input + usage.output;
}

/**
 * fold — the pure reducer. Returns a NEW RunState (never mutates `state`),
 * except the seq-guard no-op path which returns `state` unchanged (same
 * object reference — callers can `===`-check to skip a re-render).
 */
export function fold(state: RunState, persisted: PersistedRunEvent): RunState {
  if (persisted.seq <= state.lastSeq) return state; // seq-guard no-op (belt-and-braces dedup).

  const ev = persisted.ev;
  const next: RunState = {
    ...state,
    lastSeq: persisted.seq,
    actors: new Map(state.actors),
    dispatches: new Map(state.dispatches),
  };

  switch (ev.kind) {
    case "init": {
      next.init = {
        sessionId: ev.sessionId,
        model: ev.model,
        permissionMode: ev.permissionMode,
        cliVersion: ev.cliVersion,
        slashCommands: ev.slashCommands,
      };
      break;
    }
    case "message": {
      const actorKey = ev.parentToolUseId ?? MAIN_ACTOR;
      const existing = state.actors.get(actorKey);
      const messageIds = new Set(existing?.messageIds ?? []);
      let usage = existing?.usage ?? zeroFourWay();
      // F5 dedup: only add usage the FIRST time this actor sees this messageId.
      if (ev.messageId && !messageIds.has(ev.messageId)) {
        messageIds.add(ev.messageId);
        usage = addFourWay(usage, ev.usage);
      } else if (!ev.messageId) {
        // No messageId at all (defensive/legacy shape) — always count, can't dedup.
        usage = addFourWay(usage, ev.usage);
      }
      next.actors.set(actorKey, { usage, messageIds });

      // Record any Task/Agent-tool dispatch seen in this message's content —
      // keyed by the tool_use's own id, which becomes the CHILD actor's
      // parentToolUseId in subsequent messages.
      for (const part of ev.parts) {
        if (part.kind === "tool_use" && (part.tool === "Task" || part.tool === "Agent")) {
          if (!next.dispatches.has(part.toolUseId)) {
            next.dispatches.set(part.toolUseId, {
              subagentType: part.subagentType,
              atSeq: persisted.seq,
            });
          }
        }
      }
      // The real-fixture-verified shape (STATE §13 BUILD notes): the CLI also
      // reports the subagent name as a TOP-LEVEL field on messages produced
      // INSIDE the dispatch (sibling of parent_tool_use_id), not only nested
      // in the dispatching tool_use's input. If we haven't recorded a
      // subagentType for this actor's dispatch yet, backfill it here.
      if (ev.parentToolUseId && ev.topLevelSubagentType) {
        const existingDispatch = next.dispatches.get(ev.parentToolUseId);
        if (existingDispatch && !existingDispatch.subagentType) {
          next.dispatches.set(ev.parentToolUseId, {
            ...existingDispatch,
            subagentType: ev.topLevelSubagentType,
          });
        } else if (!existingDispatch) {
          // The dispatching tool_use message hasn't been folded (out of
          // order / not observed) — still record enough to resolve rollup.
          next.dispatches.set(ev.parentToolUseId, {
            subagentType: ev.topLevelSubagentType,
            atSeq: persisted.seq,
          });
        }
      }
      break;
    }
    case "result": {
      next.result = ev;
      break;
    }
    case "unknown": {
      next.unknownEvents = state.unknownEvents + 1;
      break;
    }
    case "parse-error": {
      next.parseErrors = state.parseErrors + 1;
      break;
    }
  }

  return next;
}

export interface RollupBucket {
  ownFresh: number;
  totalFresh: number;
  ownUsd?: number;
  totalUsd?: number;
}

export interface RollupResult {
  command: RollupBucket;
  byAgent: Map<string, RollupBucket>;
  unrecognized: { fresh: number; usd?: number };
}

/**
 * rollup — derive the roll-up view from a RunState. `agentSubagentNames` is
 * the set of agent names reachable from the executing command (resolved by
 * the caller from the graph). Attribution keys OFF `parentToolUseId` alone —
 * order-independent by construction (folding events in any permutation
 * yields identical output, since actor buckets don't depend on fold order).
 *
 * Never throws on an empty/unrelated `agentSubagentNames` — a dispatch whose
 * subagentType doesn't match falls into `unrecognized` (NEW-1, never dropped).
 */
export function rollup(state: RunState, agentSubagentNames: Set<string>): RollupResult {
  let commandOwnFresh = 0;
  const byAgent = new Map<string, number>();
  let unrecognizedFresh = 0;

  for (const [actorKey, actor] of state.actors) {
    const fresh = freshOf(actor.usage);
    if (actorKey === MAIN_ACTOR) {
      commandOwnFresh += fresh;
      continue;
    }
    const dispatch = state.dispatches.get(actorKey);
    const subagentType = dispatch?.subagentType;
    if (subagentType && agentSubagentNames.has(subagentType)) {
      byAgent.set(subagentType, (byAgent.get(subagentType) ?? 0) + fresh);
    } else {
      // Either no dispatch record resolved, or the name doesn't match any
      // agent in this graph — unattributable, flagged, NEVER dropped.
      unrecognizedFresh += fresh;
    }
  }

  const totalAgentFresh = [...byAgent.values()].reduce((a, b) => a + b, 0);

  const byAgentBuckets = new Map<string, RollupBucket>();
  for (const [name, fresh] of byAgent) {
    byAgentBuckets.set(name, { ownFresh: fresh, totalFresh: fresh });
  }

  return {
    command: {
      ownFresh: commandOwnFresh,
      totalFresh: commandOwnFresh + totalAgentFresh + unrecognizedFresh,
    },
    byAgent: byAgentBuckets,
    unrecognized: { fresh: unrecognizedFresh },
  };
}
