/**
 * sseRoute — the GET /run-events HTTP handler. Backfill-then-live on ONE
 * seq-ordered channel (Flaw F2): first stream persisted events with
 * seq > afterSeq from events.jsonl, THEN attach to the live broadcaster (if
 * the run is still active). Honors Last-Event-ID as the effective afterSeq.
 *
 * Query params: projectId, runId, afterSeq. The Origin/Host allowlist is
 * enforced by the caller in server.ts (same gate as /rpc).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadGlobalConfig } from "../store/store.js";
import { readEvents, readRunJson } from "./runStore.js";
import { runManager } from "./runManager.js";
import { writeBackfillFrame, writeSseHead, writeStateFrame } from "./sse.js";

const BACKFILL_CHUNK = 500;

export async function handleRunEventsSse(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const projectId = url.searchParams.get("projectId") ?? "";
  const runId = url.searchParams.get("runId") ?? "";

  // Last-Event-ID (EventSource auto-reconnect) is the effective afterSeq.
  const lastEventId = req.headers["last-event-id"];
  const afterSeqParam = url.searchParams.get("afterSeq");
  let afterSeq = 0;
  if (typeof lastEventId === "string" && /^\d+$/.test(lastEventId)) {
    afterSeq = Number(lastEventId);
  } else if (afterSeqParam && /^\d+$/.test(afterSeqParam)) {
    afterSeq = Number(afterSeqParam);
  }

  const projectRoot = resolveProjectRoot(projectId);
  if (!projectRoot) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "not-found", message: "Project not found." } }));
    return;
  }

  const run = readRunJson(projectRoot, runId);
  if (!run) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "not-found", message: "Run not found." } }));
    return;
  }

  writeSseHead(res);

  // 1. Backfill persisted events > afterSeq, in seq-ordered chunks.
  let cursor = afterSeq;
  for (;;) {
    const batch = readEvents(projectRoot, runId, cursor, BACKFILL_CHUNK);
    if (batch.length === 0) break;
    writeBackfillFrame(res, runId, batch);
    cursor = batch[batch.length - 1]!.seq;
    if (batch.length < BACKFILL_CHUNK) break;
  }

  // 2. Attach to the live broadcaster if still active; else emit terminal
  //    state + close (history replay).
  const active = runManager.getByRunId(runId);
  if (active && active.projectId === projectId) {
    active.broadcaster.subscribe(res);
    // A late subscriber may have missed events written between the backfill read
    // and the subscribe; replay any gap now (seq-dedup on the client covers the
    // rest).
    const gap = readEvents(projectRoot, runId, cursor, BACKFILL_CHUNK);
    if (gap.length > 0) writeBackfillFrame(res, runId, gap);
  } else {
    // Terminal / not-live — emit final state and close.
    writeStateFrame(res, run);
    res.end();
  }
}

function resolveProjectRoot(projectId: string): string | null {
  if (!projectId) return null;
  const config = loadGlobalConfig();
  const entry = config.projects.find((p) => p.id === projectId);
  return entry ? entry.path : null;
}
