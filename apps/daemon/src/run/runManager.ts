/**
 * runManager — the ONLY place that spawns/holds child handles (PLAN §8.1).
 *
 *  - In-memory Map<projectId, ActiveRun> IS the 1-run-per-project lock (single-
 *    process daemon → no TOCTOU, ER-9).
 *  - spawn(bin, argv, {cwd: registeredProjectPath, detached:true,
 *    stdio:["ignore","pipe","pipe"], env: process.env}) — env verbatim; Symbion
 *    never injects its own LLM keys.
 *  - line-buffer stdout → parseLine → seq-stamp → append events.jsonl + SSE
 *    broadcast; stderr tail (last 20 lines).
 *  - wall-clock ceiling (token cap is P2 — needs aggregate).
 *  - cancel() = SIGTERM(-pgid) → 5 s → SIGKILL(-pgid) → liveness verify
 *    (ER-6 honest fallback: never claim dead while alive).
 *  - exit handler writes the terminal run.json.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { PersistedRunEvent, RunInfo, RunStatus } from "../rpc/contract.js";
import type { RunState, StopReason } from "@symbion/core";
import { fold, initRunState, parseLine, rollup, runSummary } from "@symbion/core";
import { LineBuffer } from "./lineBuffer.js";
import { RunBroadcaster } from "./sse.js";
import { appendEvent, closeEventsFd, ensureRunsDir, openEventsFd, prune, readEvents, writeRunJson } from "./runStore.js";
import { gitStatus, gitNumstat } from "../git/status.js";

const STDERR_TAIL_LINES = 20;
const SIGKILL_GRACE_MS = 5_000;

export interface ActiveRun {
  runId: string;
  projectId: string;
  projectRoot: string;
  run: RunInfo;
  child: ChildProcess;
  broadcaster: RunBroadcaster;
  eventsFd: number;
  stderrTail: string[];
  wallClockTimer: NodeJS.Timeout | null;
  cancelKillTimer: NodeJS.Timeout | null;
  terminalWritten: boolean;
  /** P2: daemon-side fold, kept per-run purely to drive the token-cap ceiling
   *  check via the SAME pure core.fold/core.rollup the web store uses (A2) —
   *  never a second source of aggregation logic. */
  foldState: RunState;
  /** the agent names reachable from this artifact (by @mention), resolved
   *  ONCE at start() time — reused for the token-cap rollup AND the terminal
   *  runSummary(), matching preflight's own missingReferencedAgents traversal
   *  (no second graph walk). */
  agentSubagentNames: Set<string>;
}

export interface StartRunInput {
  projectId: string;
  projectRoot: string;
  artifactId: string;
  commandName: string;
  requirement: string;
  modelOverride: string | null;
  bin: string;
  argv: string[];
  permissionMode: string;
  allowedTools: string[];
  ceilings: { wallClockMs: number; tokenCap: number };
  cliVersion: string;
  /** P2: agent names reachable from this artifact — resolved by the caller
   *  (startRun handler) the same way preflight's missingReferencedAgents is,
   *  reused for the token-cap rollup + terminal runSummary. */
  agentSubagentNames: Set<string>;
}

/** Sentinel marker used to reserve a project's Map slot BEFORE any async work
 *  runs (the TOCTOU fix). `start()` swaps this out for the real ActiveRun once
 *  spawn succeeds; `releaseReservation()` removes it if setup fails. */
const RESERVED = Symbol("reserved");

export class RunManager {
  private active = new Map<string, ActiveRun | typeof RESERVED>();

  /** The set of live runIds — used by reconcile to skip in-flight runs. */
  liveRunIds(): Set<string> {
    return new Set(
      [...this.active.values()].filter((r): r is ActiveRun => r !== RESERVED).map((r) => r.runId)
    );
  }

  activeRunIdForProject(projectId: string): string | undefined {
    const r = this.active.get(projectId);
    return r && r !== RESERVED ? r.runId : undefined;
  }

  hasActive(projectId: string): boolean {
    return this.active.has(projectId);
  }

  getByRunId(runId: string): ActiveRun | undefined {
    for (const r of this.active.values()) {
      if (r !== RESERVED && r.runId === runId) return r;
    }
    return undefined;
  }

  /**
   * reserve — the ACTUAL lock-acquisition point (TOCTOU fix). Synchronous,
   * single atomic check-and-set: returns true iff no run (active OR reserved)
   * already occupies this project's slot, in which case the slot is now held
   * by a `RESERVED` placeholder. Callers MUST call `start()` (success) or
   * `releaseReservation()` (failure) exactly once afterward — never leave a
   * reservation dangling across an await without one of those two follow-ups.
   */
  reserve(projectId: string): boolean {
    if (this.active.has(projectId)) return false;
    this.active.set(projectId, RESERVED);
    return true;
  }

  /** Release a reservation that did not make it to `start()` (e.g. cliVersion
   *  probe or later setup threw). No-op if the slot moved on to a real run. */
  releaseReservation(projectId: string): void {
    if (this.active.get(projectId) === RESERVED) {
      this.active.delete(projectId);
    }
  }

  /**
   * Start a run. The caller MUST have already synchronously called
   * `reserve(input.projectId)` (and it must have returned true) before any
   * async work (e.g. the cliVersion probe) ran — `reserve` IS the lock
   * acquisition; this method only fills in the reserved slot.
   */
  start(input: StartRunInput): RunInfo {
    if (this.active.get(input.projectId) !== RESERVED) {
      // Defense-in-depth: a caller that skipped reserve() (or whose
      // reservation was lost/expired) must not silently clobber another run.
      const err = new Error("run-active");
      err.name = "RunActiveError";
      throw err;
    }

    const runId = randomUUID();
    const now = new Date().toISOString();
    const gitBefore = gitStatus(input.projectRoot);

    const run: RunInfo = {
      schemaVersion: 1,
      runId,
      projectId: input.projectId,
      artifactId: input.artifactId,
      commandName: input.commandName,
      requirement: input.requirement,
      modelOverride: input.modelOverride,
      argv: input.argv,
      bin: input.bin,
      cwd: input.projectRoot,
      permissionMode: input.permissionMode,
      allowedTools: input.allowedTools,
      ceilings: input.ceilings,
      cliVersion: input.cliVersion,
      sessionId: null,
      startedAt: now,
      endedAt: null,
      status: "starting",
      exitCode: null,
      stopReason: null,
      errorMessage: null,
      gitBefore: { isRepo: gitBefore.isRepo, clean: gitBefore.clean, changedFiles: gitBefore.changedFiles },
      filesChanged: null,
      lastSeq: 0,
      totals: null,
    };

    ensureRunsDir(input.projectRoot);
    writeRunJson(input.projectRoot, run);
    const eventsFd = openEventsFd(input.projectRoot, runId);

    const child = spawn(input.bin, input.argv, {
      cwd: input.projectRoot,
      detached: true, // own process group → cancel can kill the tree via -pgid
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env, // verbatim — never inject Symbion's own LLM keys
    });

    const broadcaster = new RunBroadcaster(runId);

    const activeRun: ActiveRun = {
      runId,
      projectId: input.projectId,
      projectRoot: input.projectRoot,
      run,
      child,
      broadcaster,
      eventsFd,
      stderrTail: [],
      wallClockTimer: null,
      cancelKillTimer: null,
      terminalWritten: false,
      foldState: initRunState(),
      agentSubagentNames: input.agentSubagentNames,
    };
    this.active.set(input.projectId, activeRun);

    // Transition to running as soon as the child is spawned.
    run.status = "running";
    writeRunJson(input.projectRoot, run);
    broadcaster.emitState(run);

    this.wireStreams(activeRun);
    this.armWallClock(activeRun);

    return run;
  }

  private wireStreams(ar: ActiveRun): void {
    const stdoutBuf = new LineBuffer();
    const stderrBuf = new LineBuffer();

    ar.child.stdout?.setEncoding("utf-8");
    ar.child.stderr?.setEncoding("utf-8");

    ar.child.stdout?.on("data", (chunk: string) => {
      for (const line of stdoutBuf.push(chunk)) this.ingestLine(ar, line);
    });

    ar.child.stderr?.on("data", (chunk: string) => {
      for (const line of stderrBuf.push(chunk)) this.pushStderr(ar, line);
    });

    ar.child.on("error", (err) => {
      // spawn failure (e.g. ENOENT) — treat as a failed run.
      this.finalize(ar, { status: "failed", exitCode: null, errorMessage: err.message });
    });

    ar.child.on("close", (code, signal) => {
      for (const line of stdoutBuf.flush()) this.ingestLine(ar, line);
      for (const line of stderrBuf.flush()) this.pushStderr(ar, line);

      // If a cancel/ceiling already set a pending terminal reason, respect it.
      const pending = this.pendingTerminal.get(ar.runId);
      if (pending) {
        this.pendingTerminal.delete(ar.runId);
        this.finalize(ar, { status: pending.status, exitCode: code, stopReason: pending.stopReason });
        return;
      }
      if (code === 0) {
        this.finalize(ar, { status: "completed", exitCode: 0 });
      } else {
        // Prefer the stderr tail (ER-3) as the error message; fall back to a
        // generic exit/signal string only when stderr was empty.
        const errorMessage =
          ar.stderrTail.length > 0
            ? ar.stderrTail.join("\n")
            : signal
              ? `terminated by ${signal}`
              : `exit ${code}`;
        this.finalize(ar, { status: "failed", exitCode: code, errorMessage });
      }
    });
  }

  private ingestLine(ar: ActiveRun, line: string): void {
    if (ar.terminalWritten) return;
    const ev = parseLine(line);
    const seq = ar.run.lastSeq + 1;
    ar.run.lastSeq = seq;
    const persisted: PersistedRunEvent = { seq, ts: Date.now(), ev };
    // Append + broadcast FIRST (unchanged P1 ordering — run-sse.test.ts/
    // run-happyPath.test.ts assert on this byte-for-byte); the fold below is
    // purely an ADDITIONAL daemon-local consumer of the same event, never a
    // gate on persistence/delivery.
    appendEvent(ar.eventsFd, persisted);
    // Capture sessionId from the init event.
    if (ev.kind === "init" && ev.sessionId) {
      ar.run.sessionId = ev.sessionId;
    }
    ar.broadcaster.emit(persisted);

    // P2: fold for the token-cap ceiling check — the SAME pure core.fold/
    // core.rollup the web store uses (A2). tokenCap:0 means "no cap" (§6.4#2b).
    ar.foldState = fold(ar.foldState, persisted);
    const tokenCap = ar.run.ceilings.tokenCap;
    if (Number.isFinite(tokenCap) && tokenCap > 0) {
      const totalFresh = rollup(ar.foldState, ar.agentSubagentNames).command.totalFresh;
      if (totalFresh > tokenCap && !this.pendingTerminal.has(ar.runId)) {
        this.pendingTerminal.set(ar.runId, { status: "timedOut", stopReason: "tokenCap" });
        this.killGroup(ar);
      }
    }
  }

  private pushStderr(ar: ActiveRun, line: string): void {
    ar.stderrTail.push(line);
    if (ar.stderrTail.length > STDERR_TAIL_LINES) {
      ar.stderrTail.splice(0, ar.stderrTail.length - STDERR_TAIL_LINES);
    }
  }

  private armWallClock(ar: ActiveRun): void {
    const ms = ar.run.ceilings.wallClockMs;
    if (!Number.isFinite(ms) || ms <= 0) return;
    ar.wallClockTimer = setTimeout(() => {
      this.pendingTerminal.set(ar.runId, { status: "timedOut", stopReason: "wallClock" });
      this.killGroup(ar);
    }, ms);
  }

  /** Terminal reason set by cancel/ceiling BEFORE the process actually exits. */
  private pendingTerminal = new Map<string, { status: RunStatus; stopReason?: StopReason }>();

  /**
   * cancel — two-phase SIGTERM→SIGKILL on the process GROUP, then liveness
   * verify. Returns immediately after arming SIGTERM; the terminal state lands
   * via the `close` handler (or the ER-6 stuck-cancelling fallback).
   */
  cancel(projectId: string, runId: string): { status: RunStatus; pid?: number } {
    const ar = this.active.get(projectId);
    if (!ar || ar === RESERVED || ar.runId !== runId) {
      // Already terminal / unknown / still-reserved (not yet spawned) —
      // idempotent no-op.
      return { status: "cancelled" };
    }
    if (ar.run.status === "cancelling") {
      return { status: "cancelling", pid: ar.child.pid };
    }
    this.pendingTerminal.set(ar.runId, { status: "cancelled" });
    ar.run.status = "cancelling";
    writeRunJson(ar.projectRoot, ar.run);
    ar.broadcaster.emitState(ar.run);
    this.killGroup(ar);
    return { status: "cancelling", pid: ar.child.pid };
  }

  private killGroup(ar: ActiveRun): void {
    const pid = ar.child.pid;
    if (pid === undefined) return;
    this.signalGroup(pid, "SIGTERM");
    ar.cancelKillTimer = setTimeout(() => {
      // Escalate to SIGKILL if still alive.
      if (this.isAlive(pid)) {
        this.signalGroup(pid, "SIGKILL");
      }
      // Liveness re-verify shortly after SIGKILL (ER-6).
      setTimeout(() => {
        if (this.isAlive(pid) && !ar.terminalWritten) {
          // Never claim dead while alive: stuck cancelling + pid surfaced.
          ar.run.status = "cancelling";
          ar.run.errorMessage = `process not confirmed dead (pid ${pid})`;
          writeRunJson(ar.projectRoot, ar.run);
          ar.broadcaster.emitState(ar.run);
        }
      }, 500);
    }, SIGKILL_GRACE_MS);
  }

  private signalGroup(pid: number, signal: NodeJS.Signals): void {
    try {
      // Negative pid → the whole process group (detached spawn made the child a
      // group leader). Falls back to the single pid if group-kill is unsupported.
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // already dead / no permission — ignore.
      }
    }
  }

  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private finalize(
    ar: ActiveRun,
    outcome: { status: RunStatus; exitCode?: number | null; stopReason?: StopReason; errorMessage?: string }
  ): void {
    if (ar.terminalWritten) return;
    ar.terminalWritten = true;

    if (ar.wallClockTimer) clearTimeout(ar.wallClockTimer);
    if (ar.cancelKillTimer) clearTimeout(ar.cancelKillTimer);
    this.pendingTerminal.delete(ar.runId);

    ar.run.status = outcome.status;
    ar.run.endedAt = new Date().toISOString();
    ar.run.exitCode = outcome.exitCode ?? null;
    if (outcome.stopReason) ar.run.stopReason = outcome.stopReason;
    if (outcome.errorMessage) ar.run.errorMessage = outcome.errorMessage;

    // stderr tail as a diagnostic on failure (persisted via errorMessage stays
    // short; the full tail rides the run.json errorMessage only when present).
    if (outcome.status === "failed" && ar.stderrTail.length > 0 && !ar.run.errorMessage) {
      ar.run.errorMessage = ar.stderrTail.join("\n");
    }

    // P2: populate filesChanged/totals at terminal (STATE §13.1 finalize()
    // entry) — the ONLY place gitNumstat is invoked (never mid-run, A13).
    // Wrapped in its own try/catch (NEW-2): a numstat/runSummary failure must
    // NEVER block writing the terminal run.json — the run's own completion is
    // independent of the summary's files-changed section.
    try {
      const filesChangedRaw = gitNumstat(ar.projectRoot);
      const filesChanged =
        filesChangedRaw === "unavailable"
          ? "unavailable"
          : filesChangedRaw.map((f) => ({
              ...f,
              preDirty: ar.run.gitBefore.changedFiles.includes(f.path) || undefined,
            }));
      ar.run.filesChanged = filesChanged;

      // finalMessage needs the raw event list (state only retains aggregated
      // usage, not text) — read back events.jsonl (already fsync'd by the
      // closeEventsFd() call above... actually closeEventsFd happens AFTER
      // this block, so the fd is still open; readEvents opens its own fd via
      // readFileSync, which sees everything written so far regardless).
      const allEvents = readEvents(ar.projectRoot, ar.runId, 0, Number.MAX_SAFE_INTEGER);
      const summary = runSummary(
        ar.foldState,
        { run: ar.run, agentSubagentNames: ar.agentSubagentNames, events: allEvents },
        filesChanged
      );
      ar.run.totals = {
        fresh: summary.totals.fresh,
        costUsd: summary.totals.costUsd,
        perNode: summary.perNode.map((n) => ({
          nodeId: n.nodeId,
          label: n.label,
          ownFresh: n.ownFresh,
          totalFresh: n.totalFresh,
          costUsd: n.costUsd,
          unrecognized: n.unrecognized,
        })),
      };
    } catch {
      // Degrade, don't die (NEW-2): the run's own terminal status/exitCode
      // above is already committed to ar.run — a summary-computation failure
      // never unwinds that.
      ar.run.filesChanged = "unavailable";
    }

    closeEventsFd(ar.eventsFd);
    writeRunJson(ar.projectRoot, ar.run);
    ar.broadcaster.emitState(ar.run);
    ar.broadcaster.close();

    this.active.delete(ar.projectId);

    // Retention: prune oldest at terminal (best-effort, never throws the run).
    // Pass liveRunIds() defensively (STATE §20 review fix) even though this
    // project's own slot was just cleared above — mirrors listRuns' call and
    // protects any other in-flight run's dir from ever being miscounted.
    try {
      prune(ar.projectRoot, undefined, this.liveRunIds());
    } catch {
      // ignore prune failures — they never affect the run outcome.
    }
  }
}

/** The daemon-wide singleton. */
export const runManager = new RunManager();
