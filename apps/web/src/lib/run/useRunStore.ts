"use client";

/**
 * useRunStore — Run Engine v2 client store (zustand, mirrors useArtifactStore).
 * Owns the EventSource, seq-dedup, connection state, F5 attach-on-mount, and
 * client-side elapsed ticks from startedAt.
 *
 * P1 scope: NO token math. P2 (STATE §13.1's useRunStore.ts entry) adds the
 * aggregation layer on top of the SAME event stream: folds every
 * PersistedRunEvent through `core.fold` (the SAME reducer the daemon uses for
 * its own token-cap check, A2/A11 — numbers cannot drift), derives
 * `nodeRunData` (roll-up per node), `timeline` (Feed tab rows), `summary`
 * (Summary tab, terminal-only), and `degraded`. Nothing here touches the SSE
 * wire protocol, the seq-dedup contract, or the poll-fallback logic P1 shipped.
 */
import { create } from "zustand";
import {
  fold,
  initRunState,
  rollup,
  runSummary as coreRunSummary,
  timelineRows as coreTimelineRows,
  type FourWay,
  type RunState,
  type RunSummary,
  type TimelineRow,
} from "@symbion/core";
import type {
  GetRunEventsParams,
  GetRunEventsResult,
  PersistedRunEvent,
  RunInfo,
  RunPreflightResult,
  StartRunParams,
  StartRunResult,
} from "@symbion/rpc-types";
import { callRpc } from "../rpc/client";
import { getDaemonOrigin } from "../rpc/client";

/** ER-5: after this long stuck in "reconnecting" with no successful SSE
 *  reconnect, fall back to 1s-interval `getRunEvents` polling. */
const POLL_FALLBACK_AFTER_MS = 10_000;
const POLL_INTERVAL_MS = 1_000;

export type RunConnection = "idle" | "live" | "reconnecting" | "polling";

/** A raw log-tail line (P1 panel — the structured timeline is P2). */
export interface RawTailLine {
  seq: number;
  ts: number;
  kind: string;
  text: string;
}

const RAW_TAIL_CAP = 200;

/** Per-node roll-up view (P2) — the source data for NodeTokenBadge/TokenBreakdownCard. */
export interface NodeRunData {
  runStatus?: "idle" | "starting" | "active" | "done" | "error" | "cancelled" | "working" | "settled";
  ownFresh: number;
  totalFresh: number;
  costUsd?: number;
  breakdown: FourWay & { agents?: FourWay };
}

interface RunStoreState {
  /** The project the store is currently attached to. */
  projectId: string | null;
  /** Live run metadata (null when no run active/attached). */
  run: RunInfo | null;
  /** Raw event tail for the P1 log panel (capped) — now the Raw tab's body. */
  rawTail: RawTailLine[];
  connection: RunConnection;
  /** highest seq folded — the dedup key. */
  lastSeq: number;
  /** client-side elapsed ms, ticked every 1s from run.startedAt. */
  elapsedMs: number;
  /** the artifact id whose command node should glow while active. */
  activeArtifactId: string | null;
  /** agent names reachable from the executing command (by @mention) — passed
   *  in by DependencyGraph at attach()/startRun() time (reuses the same Set
   *  already computed for runParticipantAgentNames, per STATE §13.1). */
  agentSubagentNames: Set<string>;

  // ── P2: aggregation state (folds the SAME event stream through core.fold) ──
  /** the folded reducer state (core.RunState) — SAME core.fold as the daemon
   *  (A2/A11); the store NEVER does token math itself. */
  foldState: RunState;
  /** every persisted event seen so far — kept for derive.timelineRows/runSummary
   *  (a full recompute per batch, A12 — deliberately NOT an incremental diff). */
  allEvents: PersistedRunEvent[];
  /** per-node roll-up, keyed by the AGENT NAME for agent nodes, "main" for
   *  the executing command (DependencyGraph maps "main" -> the active artifact id). */
  nodeRunData: Map<string, NodeRunData>;
  timeline: TimelineRow[];
  summary?: RunSummary;
  /** true once state.parseErrors > 0 (mid-run) OR the terminal F6 reconcile-
   *  mismatch check fires (only known at terminal, via `summary.degraded`). */
  degraded: boolean;
  degradedReason: "parse-error" | "reconcile-mismatch" | null;

  // actions
  preflight: (projectId: string, artifactId: string) => Promise<RunPreflightResult>;
  startRun: (params: StartRunParams, agentSubagentNames?: Set<string>) => Promise<StartRunResult>;
  cancelRun: () => Promise<void>;
  /** attach to a run (SSE backfill-then-live). F5-reattach owner. */
  attach: (projectId: string, runId: string, afterSeq?: number, agentSubagentNames?: Set<string>) => void;
  /** on mount: listRuns → auto-attach if a run is active. */
  attachIfActive: (projectId: string, agentSubagentNames?: Set<string>) => Promise<void>;
  /** update the agent-name set AFTER attach (F5 cold-load path: the executing
   *  artifact/its @mentions aren't known until the reattached run.json
   *  arrives) — re-derives nodeRunData from the ALREADY-folded state so a
   *  late-arriving agent set doesn't require re-folding any events. */
  setAgentSubagentNames: (names: Set<string>) => void;
  detach: () => void;
}

let eventSource: EventSource | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
/** ER-5 fallback timers — armed on "reconnecting", cleared on "live"/detach. */
let pollFallbackArmTimer: ReturnType<typeof setTimeout> | null = null;
let pollIntervalTimer: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;

function stopEventSource(): void {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function stopElapsed(): void {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

/** Clear BOTH the 10s arm-timer and any running 1s poll loop. */
function stopPolling(): void {
  if (pollFallbackArmTimer) {
    clearTimeout(pollFallbackArmTimer);
    pollFallbackArmTimer = null;
  }
  if (pollIntervalTimer) {
    clearInterval(pollIntervalTimer);
    pollIntervalTimer = null;
  }
  pollInFlight = false;
}

const TERMINAL = new Set(["completed", "failed", "cancelled", "timedOut"]);

function eventToTail(ev: PersistedRunEvent): RawTailLine {
  let text: string;
  const e = ev.ev;
  switch (e.kind) {
    case "init":
      text = `init session · ${e.model} · ${e.permissionMode}`;
      break;
    case "message":
      text = e.parts
        .map((p) =>
          p.kind === "text"
            ? p.textPreview
            : p.kind === "tool_use"
              ? `⚙ ${p.tool}${p.subagentType ? ` → ${p.subagentType}` : ""}`
              : "result"
        )
        .join(" ");
      break;
    case "result":
      text = `result · ${e.subtype}${e.isError ? " (error)" : ""}`;
      break;
    case "unknown":
      text = `unknown(${e.type})`;
      break;
    case "parse-error":
      text = `parse-error`;
      break;
  }
  return { seq: ev.seq, ts: ev.ts, kind: ev.ev.kind, text };
}

export const useRunStore = create<RunStoreState>((set, get) => ({
  projectId: null,
  run: null,
  rawTail: [],
  connection: "idle",
  lastSeq: 0,
  elapsedMs: 0,
  activeArtifactId: null,
  agentSubagentNames: new Set(),
  foldState: initRunState(),
  allEvents: [],
  nodeRunData: new Map(),
  timeline: [],
  summary: undefined,
  degraded: false,
  degradedReason: null,

  async preflight(projectId, artifactId) {
    return callRpc<{ projectId: string; artifactId: string }, RunPreflightResult>("runPreflight", {
      projectId,
      artifactId,
    });
  },

  async startRun(params, agentSubagentNames) {
    const result = await callRpc<StartRunParams, StartRunResult>("startRun", params);
    // Attach to the fresh run immediately (backfill + live).
    set({
      projectId: params.projectId,
      run: result.run,
      rawTail: [],
      lastSeq: 0,
      elapsedMs: 0,
      activeArtifactId: params.artifactId,
      foldState: initRunState(),
      allEvents: [],
      nodeRunData: new Map(),
      timeline: [],
      summary: undefined,
      degraded: false,
      degradedReason: null,
    });
    get().attach(params.projectId, result.runId, 0, agentSubagentNames);
    startElapsed(set, get);
    return result;
  },

  async cancelRun() {
    const { projectId, run } = get();
    if (!projectId || !run) return;
    await callRpc("cancelRun", { projectId, runId: run.runId });
  },

  attach(projectId, runId, afterSeq = 0, agentSubagentNames) {
    stopEventSource();
    stopPolling();
    // afterSeq > 0 => resuming an already-attached run (e.g. an SSE error
    // handler re-arming the same attach) — keep the existing foldState so a
    // reconnect never re-folds from scratch; afterSeq === 0 is a FRESH attach
    // (new run OR F5 reattach's full backfill) and resets fold/timeline/summary.
    const resetAggregation = afterSeq === 0;
    set({
      projectId,
      connection: "reconnecting",
      lastSeq: afterSeq,
      agentSubagentNames: agentSubagentNames ?? get().agentSubagentNames,
      ...(resetAggregation
        ? { foldState: initRunState(), allEvents: [], nodeRunData: new Map(), timeline: [], summary: undefined, degraded: false, degradedReason: null }
        : {}),
    });
    armPollFallback(set, get, projectId, runId);

    const url = `${getDaemonOrigin()}/run-events?projectId=${encodeURIComponent(projectId)}&runId=${encodeURIComponent(runId)}&afterSeq=${afterSeq}`;
    const es = new EventSource(url);
    eventSource = es;

    es.addEventListener("open", () => {
      // Live SSE recovered — cancel/undo any armed or running poll fallback.
      stopPolling();
      set({ connection: "live" });
    });

    es.addEventListener("run", (msg) => {
      try {
        const payload = JSON.parse((msg as MessageEvent).data) as { events: PersistedRunEvent[] };
        applyEvents(set, get, payload.events);
      } catch {
        /* ignore malformed frame */
      }
    });

    es.addEventListener("state", (msg) => {
      try {
        const info = JSON.parse((msg as MessageEvent).data) as RunInfo;
        set({ run: info });
        if (TERMINAL.has(info.status)) {
          stopEventSource();
          stopPolling();
          stopElapsed();
          set({ connection: "idle" });
          computeTerminalSummary(set, get, info);
        }
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("error", () => {
      // EventSource auto-reconnects on its own; reflect the transient state
      // and (re-)arm the ER-5 poll fallback in case native reconnect stalls
      // beyond POLL_FALLBACK_AFTER_MS.
      set({ connection: get().connection === "polling" ? "polling" : "reconnecting" });
      armPollFallback(set, get, projectId, runId);
    });
  },

  async attachIfActive(projectId, agentSubagentNames) {
    const { runs, activeRunId } = await callRpc<{ projectId: string }, { runs: unknown[]; activeRunId?: string }>(
      "listRuns",
      { projectId }
    );
    void runs;
    if (activeRunId) {
      // Pull run.json + attach from seq 0 (backfill fast-forwards).
      set({ projectId, activeArtifactId: null });
      get().attach(projectId, activeRunId, 0, agentSubagentNames);
      startElapsed(set, get);
    }
  },

  setAgentSubagentNames(names) {
    const state = get();
    // Re-derive nodeRunData from the ALREADY-folded state — no re-fold needed
    // (rollup() is a pure re-derivation over the same foldState).
    const rolled = rollup(state.foldState, names);
    const nodeRunData = new Map<string, NodeRunData>();
    nodeRunData.set("main", {
      ownFresh: rolled.command.ownFresh,
      totalFresh: rolled.command.totalFresh,
      breakdown: mainBreakdown(state.foldState, rolled),
    });
    for (const [name, bucket] of rolled.byAgent) {
      nodeRunData.set(name, {
        ownFresh: bucket.ownFresh,
        totalFresh: bucket.totalFresh,
        breakdown: agentBreakdown(state.foldState, name),
      });
    }
    set({ agentSubagentNames: names, nodeRunData });
  },

  detach() {
    stopEventSource();
    stopPolling();
    stopElapsed();
    set({
      run: null,
      rawTail: [],
      connection: "idle",
      lastSeq: 0,
      elapsedMs: 0,
      activeArtifactId: null,
      foldState: initRunState(),
      allEvents: [],
      nodeRunData: new Map(),
      timeline: [],
      summary: undefined,
      degraded: false,
      degradedReason: null,
    });
  },
}));

/**
 * ER-5 poll fallback (STATE §8.1/§8.6): if the connection is still
 * "reconnecting" (native EventSource auto-reconnect hasn't landed an "open")
 * after POLL_FALLBACK_AFTER_MS, switch to `getRunEvents{afterSeq}` polling at
 * POLL_INTERVAL_MS. Stops itself (via `stopPolling()`, called from `attach`'s
 * "open" handler) the moment a live SSE connection succeeds again.
 *
 * Idempotent: re-arming while a timer/interval is already running for the
 * SAME attach() call is harmless because `attach()`/`detach()` always
 * `stopPolling()` first — this only ever arms one live timer chain at a time.
 */
function armPollFallback(
  set: (partial: Partial<RunStoreState>) => void,
  get: () => RunStoreState,
  projectId: string,
  runId: string
): void {
  if (pollFallbackArmTimer || pollIntervalTimer) return; // already armed/running
  pollFallbackArmTimer = setTimeout(() => {
    pollFallbackArmTimer = null;
    // Only engage if we're still not live (a fast reconnect already
    // called stopPolling() from the "open" handler, so this is a no-op then).
    if (get().connection === "live") return;
    set({ connection: "polling" });
    startPollLoop(set, get, projectId, runId);
  }, POLL_FALLBACK_AFTER_MS);
}

function startPollLoop(
  set: (partial: Partial<RunStoreState>) => void,
  get: () => RunStoreState,
  projectId: string,
  runId: string
): void {
  const poll = async () => {
    if (pollInFlight) return; // never overlap requests
    pollInFlight = true;
    try {
      const afterSeq = get().lastSeq;
      const result = await callRpc<GetRunEventsParams, GetRunEventsResult>("getRunEvents", {
        projectId,
        runId,
        afterSeq,
      });
      applyEvents(set, get, result.events);
      set({ run: result.run });
      if (result.done || TERMINAL.has(result.run.status)) {
        stopPolling();
        stopElapsed();
        set({ connection: "idle" });
        computeTerminalSummary(set, get, result.run);
        return;
      }
    } catch {
      // Daemon still unreachable — keep polling; a future tick may recover.
    } finally {
      pollInFlight = false;
    }
  };
  void poll();
  pollIntervalTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
}

function applyEvents(
  set: (partial: Partial<RunStoreState>) => void,
  get: () => RunStoreState,
  events: PersistedRunEvent[]
): void {
  const state = get();
  let lastSeq = state.lastSeq;
  const additions: RawTailLine[] = [];
  const newEvents: PersistedRunEvent[] = [];
  let foldState = state.foldState;
  for (const ev of events) {
    if (ev.seq <= lastSeq) continue; // seq-dedup (belt-and-braces over one channel)
    lastSeq = ev.seq;
    additions.push(eventToTail(ev));
    newEvents.push(ev);
    // P2: fold every accepted event through the SAME core.fold the daemon
    // uses (A2/A11) — applied AFTER the seq-dedup check above, so raw-tail
    // and token accounting share exactly one dedup gate (STATE §13.1).
    foldState = fold(foldState, ev);
  }
  if (additions.length === 0) return;
  const rawTail = [...state.rawTail, ...additions].slice(-RAW_TAIL_CAP);
  const allEvents = [...state.allEvents, ...newEvents];

  const rolled = rollup(foldState, state.agentSubagentNames);
  const nodeRunData = new Map<string, NodeRunData>();
  nodeRunData.set("main", {
    ownFresh: rolled.command.ownFresh,
    totalFresh: rolled.command.totalFresh,
    breakdown: mainBreakdown(foldState, rolled),
  });
  for (const [name, bucket] of rolled.byAgent) {
    nodeRunData.set(name, {
      ownFresh: bucket.ownFresh,
      totalFresh: bucket.totalFresh,
      breakdown: agentBreakdown(foldState, name),
    });
  }

  // Mid-run degraded signal (ER-4): parseErrors > 0. The F6 reconcile-mismatch
  // trigger is terminal-only (needs `result`) — computed in computeTerminalSummary.
  const midRunDegraded = foldState.parseErrors > 0;

  set({
    rawTail,
    lastSeq,
    foldState,
    allEvents,
    nodeRunData,
    timeline: coreTimelineRows(allEvents, foldState),
    ...(midRunDegraded && !state.degraded ? { degraded: true, degradedReason: "parse-error" as const } : {}),
  });
}

/** Best-effort per-actor model lookup for the breakdown card — aggregate.ts
 *  doesn't track a per-actor model string, so this reads it off the LAST
 *  message seen for that actor in foldState's own bookkeeping is unavailable;
 *  fresh/cache breakdown is exact (comes straight from the actor's FourWay),
 *  only the $ estimate (not shown per-actor in the node badge, only in the
 *  terminal summary) would need a model — the live badge shows tokens only. */
function mainBreakdown(state: RunState, rolled: ReturnType<typeof rollup>): FourWay & { agents?: FourWay } {
  const main = state.actors.get("main")?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const agentsUsage = [...rolled.byAgent.keys()].reduce(
    (acc, name) => {
      const bucket = findAgentActorUsage(state, name);
      return {
        input: acc.input + bucket.input,
        output: acc.output + bucket.output,
        cacheRead: acc.cacheRead + bucket.cacheRead,
        cacheWrite: acc.cacheWrite + bucket.cacheWrite,
      };
    },
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  );
  return { ...main, agents: agentsUsage };
}

function agentBreakdown(state: RunState, subagentType: string): FourWay & { agents?: FourWay } {
  return findAgentActorUsage(state, subagentType);
}

function findAgentActorUsage(state: RunState, subagentType: string): FourWay {
  let usage: FourWay = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const [actorKey, actor] of state.actors) {
    if (actorKey === "main") continue;
    const dispatch = state.dispatches.get(actorKey);
    if (dispatch?.subagentType === subagentType) {
      usage = {
        input: usage.input + actor.usage.input,
        output: usage.output + actor.usage.output,
        cacheRead: usage.cacheRead + actor.usage.cacheRead,
        cacheWrite: usage.cacheWrite + actor.usage.cacheWrite,
      };
    }
  }
  return usage;
}

/** Terminal-only: compute the F6 degraded cross-check + the Summary tab via
 *  derive.runSummary — the F6 trigger inherently needs `result` (STATE §13.1). */
function computeTerminalSummary(
  set: (partial: Partial<RunStoreState>) => void,
  get: () => RunStoreState,
  run: RunInfo
): void {
  const { foldState, allEvents, agentSubagentNames, degraded, degradedReason } = get();
  const filesChanged = run.filesChanged ?? "unavailable";
  const summary = coreRunSummary(foldState, { run, agentSubagentNames, events: allEvents }, filesChanged);
  set({
    summary,
    // Only escalate to reconcile-mismatch if we weren't ALREADY flagged for
    // parse-error (never conflate the two triggers, per the DegradedTelemetryChip
    // contract) — a run can only show one chip; parse-error is discovered
    // first (mid-run) so it takes priority as the recorded reason.
    degraded: degraded || summary.degraded,
    degradedReason: degradedReason ?? (summary.degraded ? "reconcile-mismatch" : null),
  });
}

function startElapsed(
  set: (partial: Partial<RunStoreState>) => void,
  get: () => RunStoreState
): void {
  stopElapsed();
  const tick = () => {
    const run = get().run;
    if (!run) return;
    const started = new Date(run.startedAt).getTime();
    const end = run.endedAt ? new Date(run.endedAt).getTime() : Date.now();
    set({ elapsedMs: Math.max(0, end - started) });
  };
  tick();
  elapsedTimer = setInterval(tick, 1_000);
}
