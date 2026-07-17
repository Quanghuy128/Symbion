/**
 * runStore — `.symbion/runs/<runId>/{run.json, events.jsonl}` persistence
 * (PLAN §8.1 runStore.ts / §8.2). run.json is atomic (temp→rename via
 * atomicWriteJson); events.jsonl is append-only (open fd per active run).
 * ALL paths go through resolveConfinedPath — Symbion owns `.symbion/`, and the
 * `.symbion/runs/.gitignore` (`*`) is a self-ignoring dir (transcripts can hold
 * secrets), NOT a foreign-file write.
 */
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { selectPruneTargets } from "@symbion/core";
import type { PersistedRunEvent, RunInfo, RunListItem } from "../rpc/contract.js";
import { atomicWriteJson } from "../store/store.js";
import { resolveConfinedPath, PathConfinementError } from "../rpc/guard.js";
import { RpcError } from "../rpc/rpcError.js";

const RUNS_DIR = join(".symbion", "runs");
const EVENTS_CAP = 500;
const DEFAULT_KEEP = 50;

/** uuid v4 shape — the ONLY dir names prune/read will treat as runs. */
const RUNID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function runsDirAbs(projectRoot: string): string {
  return resolveConfined(projectRoot, RUNS_DIR);
}

function runDirAbs(projectRoot: string, runId: string): string {
  if (!RUNID_RE.test(runId)) {
    throw new RpcError("invalid-params", `Invalid runId: ${runId}`);
  }
  return resolveConfined(projectRoot, join(RUNS_DIR, runId));
}

function resolveConfined(projectRoot: string, rel: string): string {
  try {
    return resolveConfinedPath(projectRoot, rel);
  } catch (err) {
    if (err instanceof PathConfinementError) throw new RpcError("path-confinement", err.message);
    throw err;
  }
}

/** Ensure `.symbion/runs/` exists + write the self-ignoring `.gitignore` once. */
export function ensureRunsDir(projectRoot: string): void {
  const dir = runsDirAbs(projectRoot);
  mkdirSync(dir, { recursive: true });
  const gitignore = join(dir, ".gitignore");
  if (!existsSync(gitignore)) {
    // one path segment, confined dir already created above.
    atomicWriteJsonRaw(gitignore, "*\n");
  }
}

function atomicWriteJsonRaw(absPath: string, content: string): void {
  // small helper for the .gitignore (not JSON) — reuse temp→rename semantics.
  const tmp = `${absPath}.symbion-tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, absPath);
}

export function writeRunJson(projectRoot: string, run: RunInfo): void {
  const dir = runDirAbs(projectRoot, run.runId);
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(join(dir, "run.json"), run);
}

export function readRunJson(projectRoot: string, runId: string): RunInfo | null {
  const dir = runDirAbs(projectRoot, runId);
  const file = join(dir, "run.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as RunInfo;
  } catch {
    return null;
  }
}

/** Open the events.jsonl append fd for a run (creates the dir if needed). */
export function openEventsFd(projectRoot: string, runId: string): number {
  const dir = runDirAbs(projectRoot, runId);
  mkdirSync(dir, { recursive: true });
  return openSync(join(dir, "events.jsonl"), "a");
}

export function appendEvent(fd: number, ev: PersistedRunEvent): void {
  writeSync(fd, `${JSON.stringify(ev)}\n`);
}

export function closeEventsFd(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // ignore
  }
}

/**
 * readEvents — read persisted events with seq > afterSeq, capped at `cap`
 * (default 500). Used by SSE backfill + getRunEvents (polling / history replay).
 */
export function readEvents(
  projectRoot: string,
  runId: string,
  afterSeq: number,
  cap = EVENTS_CAP
): PersistedRunEvent[] {
  const dir = runDirAbs(projectRoot, runId);
  const file = join(dir, "events.jsonl");
  if (!existsSync(file)) return [];
  const out: PersistedRunEvent[] = [];
  const lines = readFileSync(file, "utf-8").split("\n");
  for (const line of lines) {
    if (line.length === 0) continue;
    let ev: PersistedRunEvent;
    try {
      ev = JSON.parse(line) as PersistedRunEvent;
    } catch {
      continue;
    }
    if (typeof ev.seq === "number" && ev.seq > afterSeq) {
      out.push(ev);
      if (out.length >= cap) break;
    }
  }
  return out;
}

function toListItem(run: RunInfo): RunListItem {
  const durationMs =
    run.endedAt && run.startedAt ? new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime() : null;
  return {
    runId: run.runId,
    commandName: run.commandName,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs,
    freshTokens: run.totals?.fresh ?? null,
    costUsd: run.totals?.costUsd ?? null,
  };
}

/** List all persisted runs (newest first by startedAt). */
export function listRuns(projectRoot: string): RunListItem[] {
  const dir = runsDirAbs(projectRoot);
  if (!existsSync(dir)) return [];
  const runs: RunInfo[] = [];
  for (const name of readdirSync(dir)) {
    if (!RUNID_RE.test(name)) continue; // ignore foreign files/dirs (.gitignore, notes.txt, etc.)
    const run = readRunJson(projectRoot, name);
    if (run) runs.push(run);
  }
  runs.sort((a, b) => (b.startedAt < a.startedAt ? -1 : b.startedAt > a.startedAt ? 1 : 0));
  return runs.map(toListItem);
}

/** Read all persisted RunInfo (used internally by reconcile/prune). */
function readAllRuns(projectRoot: string): RunInfo[] {
  const dir = runsDirAbs(projectRoot);
  if (!existsSync(dir)) return [];
  const runs: RunInfo[] = [];
  for (const name of readdirSync(dir)) {
    if (!RUNID_RE.test(name)) continue;
    const run = readRunJson(projectRoot, name);
    if (run) runs.push(run);
  }
  return runs;
}

const NON_TERMINAL = new Set(["starting", "running", "cancelling"]);

/**
 * reconcile — any persisted run in starting|running|cancelling whose runId is
 * NOT live in runManager is rewritten failed(daemon-restarted) (ER-10). Pulled
 * forward into P1 (~20 lines) so no zombie "running" row renders during QA.
 */
export function reconcile(projectRoot: string, liveRunIds: Set<string>): void {
  for (const run of readAllRuns(projectRoot)) {
    if (!NON_TERMINAL.has(run.status)) continue;
    if (liveRunIds.has(run.runId)) continue;
    run.status = "failed";
    run.errorMessage = "daemon-restarted";
    run.endedAt = run.endedAt ?? new Date().toISOString();
    writeRunJson(projectRoot, run);
  }
}

/**
 * prune — keep the newest `keep` runs by startedAt; delete the rest. Only
 * deletes dirs directly under `.symbion/runs/` whose name matches RUNID_RE;
 * lstat-refuses symlinked dirs (same G-guard posture as safeDeleteProjectStore).
 *
 * The SORT+SELECT step delegates to `core.selectPruneTargets` (STATE §18.1 P3
 * — a pure, unit-tested extraction of what used to be this function's inline
 * sort-and-slice; behavior-preserving, not new pruning logic). Everything else
 * (lstat/rmSync/symlink-refusal/re-confinement) is inherently fs work and
 * stays here.
 *
 * `liveRunIds` (STATE §20 review fix — 🟠 High): any currently-active/starting/
 * cancelling run tracked in-memory by `runManager` is EXCLUDED from deletion
 * candidacy regardless of its `startedAt` age, mirroring `reconcile()`'s
 * existing `liveRunIds.has(run.runId)` exemption immediately above. Without
 * this, a long-running active run (its run.json is written synchronously at
 * `start()`, long before it finishes) could be the "oldest" candidate if
 * enough other runs for the same project complete with newer `startedAt`
 * timestamps while it's still executing — pruning would then delete its
 * still-in-flight directory out from under it.
 */
export function prune(projectRoot: string, keep = DEFAULT_KEEP, liveRunIds: Set<string> = new Set()): void {
  const dir = runsDirAbs(projectRoot);
  if (!existsSync(dir)) return;
  const candidates: Array<{ name: string; startedAt: string }> = [];
  for (const name of readdirSync(dir)) {
    if (!RUNID_RE.test(name)) continue; // never touch foreign files/dirs
    if (liveRunIds.has(name)) continue; // never a prune candidate while live
    const abs = join(dir, name);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (st.isSymbolicLink() || !st.isDirectory()) continue; // refuse symlinks; only real dirs
    const run = readRunJson(projectRoot, name);
    candidates.push({ name, startedAt: run?.startedAt ?? "" });
  }
  const toDeleteNames = new Set(
    selectPruneTargets(
      candidates.map((c) => ({ runId: c.name, startedAt: c.startedAt })),
      keep
    )
  );
  for (const name of toDeleteNames) {
    // re-confine before delete (belt-and-braces).
    const abs = runDirAbs(projectRoot, name);
    // lstat guard again immediately before removal (TOCTOU-narrow).
    try {
      if (lstatSync(abs).isSymbolicLink()) continue;
    } catch {
      continue;
    }
    rmSync(abs, { recursive: true, force: true });
  }
}
