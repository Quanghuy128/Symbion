/**
 * sse — the live run-events channel on the EXISTING node:http server
 * (GET /run-events?runId&afterSeq). Routed BEFORE serveStaticFile, same
 * isAllowedHost Origin/Host gate as /rpc (PLAN §8.1 sse.ts / §8.5.4).
 *
 * Protocol (Flaw F2 — one ordered channel, no client-side race):
 *   1. backfill persisted events with seq > afterSeq from events.jsonl,
 *   2. then attach to the live broadcaster.
 * Frames: `event: run` / `id: <lastSeqInBatch>` / data = RunSseEventsFrame,
 * batched ≤4 flushes/s (250 ms). `event: state` on lifecycle transitions.
 * `:hb` comment every 15 s. Honors Last-Event-ID as the effective afterSeq.
 */
import type { ServerResponse } from "node:http";
import type { PersistedRunEvent, RunInfo } from "../rpc/contract.js";

const BATCH_MS = 250;
const HEARTBEAT_MS = 15_000;

interface Subscriber {
  res: ServerResponse;
  pending: PersistedRunEvent[];
  flushTimer: NodeJS.Timeout | null;
  heartbeat: NodeJS.Timeout;
}

/**
 * RunBroadcaster — one per active run, owned by runManager. The HTTP handler
 * subscribes; the runManager calls `emit`/`emitState`/`close`. Live-only: the
 * backfill-from-disk half is done by the HTTP handler before subscribing.
 */
export class RunBroadcaster {
  private subscribers = new Set<Subscriber>();

  constructor(private readonly runId: string) {}

  emit(ev: PersistedRunEvent): void {
    for (const sub of this.subscribers) {
      sub.pending.push(ev);
      this.scheduleFlush(sub);
    }
  }

  emitState(run: RunInfo): void {
    for (const sub of this.subscribers) {
      // Flush any pending events first so state never races ahead of its events.
      this.flush(sub);
      writeFrame(sub.res, "state", run.lastSeq, run);
    }
  }

  subscribe(res: ServerResponse): Subscriber {
    const sub: Subscriber = {
      res,
      pending: [],
      flushTimer: null,
      heartbeat: setInterval(() => {
        try {
          res.write(":hb\n\n");
        } catch {
          this.remove(sub);
        }
      }, HEARTBEAT_MS),
    };
    this.subscribers.add(sub);
    res.on("close", () => this.remove(sub));
    return sub;
  }

  /** Close all subscriber connections (terminal run). */
  close(): void {
    for (const sub of [...this.subscribers]) {
      this.flush(sub);
      try {
        sub.res.end();
      } catch {
        // ignore
      }
      this.remove(sub);
    }
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  private scheduleFlush(sub: Subscriber): void {
    if (sub.flushTimer) return;
    sub.flushTimer = setTimeout(() => this.flush(sub), BATCH_MS);
  }

  private flush(sub: Subscriber): void {
    if (sub.flushTimer) {
      clearTimeout(sub.flushTimer);
      sub.flushTimer = null;
    }
    if (sub.pending.length === 0) return;
    const batch = sub.pending;
    sub.pending = [];
    const lastSeq = batch[batch.length - 1]!.seq;
    try {
      writeFrame(sub.res, "run", lastSeq, { runId: this.runId, events: batch });
    } catch {
      this.remove(sub);
    }
  }

  private remove(sub: Subscriber): void {
    if (!this.subscribers.has(sub)) return;
    if (sub.flushTimer) clearTimeout(sub.flushTimer);
    clearInterval(sub.heartbeat);
    this.subscribers.delete(sub);
  }
}

/** Write the SSE response headers (called once per accepted connection). */
export function writeSseHead(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

/** Write a single backfill batch as a `run` frame. */
export function writeBackfillFrame(res: ServerResponse, runId: string, events: PersistedRunEvent[]): void {
  if (events.length === 0) return;
  const lastSeq = events[events.length - 1]!.seq;
  writeFrame(res, "run", lastSeq, { runId, events });
}

/** Write a state frame (used for terminal-run backfill close). */
export function writeStateFrame(res: ServerResponse, run: RunInfo): void {
  writeFrame(res, "state", run.lastSeq, run);
}

function writeFrame(res: ServerResponse, event: string, id: number, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`id: ${id}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
