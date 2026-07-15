"use client";

/**
 * useRunStore — Run Engine v2 client store (zustand, mirrors useArtifactStore).
 * Owns the EventSource, seq-dedup, connection state, F5 attach-on-mount, and
 * client-side elapsed ticks from startedAt.
 *
 * P1 scope: NO token math (aggregate is P2). The store tracks lifecycle
 * (RunInfo), the raw event tail (for the P1 log panel), the set of run-active
 * node ids (glow), and connection state.
 */
import { create } from "zustand";
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

interface RunStoreState {
  /** The project the store is currently attached to. */
  projectId: string | null;
  /** Live run metadata (null when no run active/attached). */
  run: RunInfo | null;
  /** Raw event tail for the P1 log panel (capped). */
  rawTail: RawTailLine[];
  connection: RunConnection;
  /** highest seq folded — the dedup key. */
  lastSeq: number;
  /** client-side elapsed ms, ticked every 1s from run.startedAt. */
  elapsedMs: number;
  /** the artifact id whose command node should glow while active. */
  activeArtifactId: string | null;

  // actions
  preflight: (projectId: string, artifactId: string) => Promise<RunPreflightResult>;
  startRun: (params: StartRunParams) => Promise<StartRunResult>;
  cancelRun: () => Promise<void>;
  /** attach to a run (SSE backfill-then-live). F5-reattach owner. */
  attach: (projectId: string, runId: string, afterSeq?: number) => void;
  /** on mount: listRuns → auto-attach if a run is active. */
  attachIfActive: (projectId: string) => Promise<void>;
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

  async preflight(projectId, artifactId) {
    return callRpc<{ projectId: string; artifactId: string }, RunPreflightResult>("runPreflight", {
      projectId,
      artifactId,
    });
  },

  async startRun(params) {
    const result = await callRpc<StartRunParams, StartRunResult>("startRun", params);
    // Attach to the fresh run immediately (backfill + live).
    set({
      projectId: params.projectId,
      run: result.run,
      rawTail: [],
      lastSeq: 0,
      elapsedMs: 0,
      activeArtifactId: params.artifactId,
    });
    get().attach(params.projectId, result.runId, 0);
    startElapsed(set, get);
    return result;
  },

  async cancelRun() {
    const { projectId, run } = get();
    if (!projectId || !run) return;
    await callRpc("cancelRun", { projectId, runId: run.runId });
  },

  attach(projectId, runId, afterSeq = 0) {
    stopEventSource();
    stopPolling();
    set({ projectId, connection: "reconnecting", lastSeq: afterSeq });
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

  async attachIfActive(projectId) {
    const { runs, activeRunId } = await callRpc<{ projectId: string }, { runs: unknown[]; activeRunId?: string }>(
      "listRuns",
      { projectId }
    );
    void runs;
    if (activeRunId) {
      // Pull run.json + attach from seq 0 (backfill fast-forwards).
      set({ projectId, activeArtifactId: null });
      get().attach(projectId, activeRunId, 0);
      startElapsed(set, get);
    }
  },

  detach() {
    stopEventSource();
    stopPolling();
    stopElapsed();
    set({ run: null, rawTail: [], connection: "idle", lastSeq: 0, elapsedMs: 0, activeArtifactId: null });
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
  for (const ev of events) {
    if (ev.seq <= lastSeq) continue; // seq-dedup (belt-and-braces over one channel)
    lastSeq = ev.seq;
    additions.push(eventToTail(ev));
  }
  if (additions.length === 0) return;
  const rawTail = [...state.rawTail, ...additions].slice(-RAW_TAIL_CAP);
  set({ rawTail, lastSeq });
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
