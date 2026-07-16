/**
 * derive — pure projections from a folded RunState into the UI-facing view
 * models (P2, STATE §13.1 derive.ts). PURE — no Node imports (AC-RUN-11).
 *
 * `timelineRows` and `runSummary` are pure functions over
 * (events, RunState[, meta]) — no streaming/incremental-diff optimization
 * (A12/NEW-5, a deliberate deferral pending a demonstrated perf problem).
 */
import { estimateCostUsd, reconcileToTotal } from "./pricing.js";
import { freshOf, rollup, type RunState } from "./aggregate.js";
import type { FileChange, FourWay, PersistedRunEvent, RunEvent, RunInfo, TimelineRow } from "./events.js";

const MAIN_ACTOR = "main";

/** ±1-token-per-model tolerance band for the F6 degraded-check (Risk R3 —
 *  a GUESS, not yet independently verified across CLI versions; see STATE
 *  §13.8's explicit flag). */
const BACKGROUND_RECONCILE_TOLERANCE = 1;

function zeroFourWay(): FourWay {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

/**
 * timelineRows — pure projection of the full persisted event list (+ the
 * folded state, for actor/dispatch lookups) into rendered timeline rows
 * (design §5's row grammar: time · glyph · label(actor) · +Δtok, dispatch
 * cards, actor-suffixed depth:1 rows under their dispatch).
 */
export function timelineRows(events: PersistedRunEvent[], state: RunState): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const firstTs = events[0]?.ts ?? 0;
  // dispatch toolUseId -> subagentType/actor label, discovered as we walk
  // (mirrors state.dispatches, but we also want ANY dispatch even if its
  // subagentType wasn't recognized by the graph — the label still names it).
  const seenDispatchLabel = new Map<string, string>();

  for (const persisted of events) {
    const { seq, ts, ev } = persisted;
    const atMs = ts - firstTs;

    if (ev.kind === "init") {
      rows.push({ seq, atMs, icon: "⚙", label: `init session · ${ev.model}`, depth: 0 });
      continue;
    }

    if (ev.kind === "message") {
      const actorKey = ev.parentToolUseId ?? MAIN_ACTOR;
      const depth: 0 | 1 = actorKey === MAIN_ACTOR ? 0 : 1;
      const actorSuffix =
        actorKey !== MAIN_ACTOR
          ? ` (${seenDispatchLabel.get(actorKey) ?? ev.topLevelSubagentType ?? actorKey})`
          : "";
      const fresh = freshOf(ev.usage);

      for (const part of ev.parts) {
        if (part.kind === "text") {
          if (part.textPreview.trim().length === 0) continue;
          rows.push({
            seq,
            atMs,
            icon: "💬",
            label: `${part.textPreview}${actorSuffix}`,
            actor: actorKey,
            tokenDelta: fresh,
            depth,
          });
        } else if (part.kind === "tool_use") {
          const isDispatch = part.tool === "Task" || part.tool === "Agent";
          const subagentLabel = part.subagentType ?? ev.topLevelSubagentType;
          if (isDispatch) {
            const label = `Task → ${subagentLabel ?? "subagent"}`;
            if (subagentLabel) seenDispatchLabel.set(part.toolUseId, subagentLabel);
            rows.push({
              seq,
              atMs,
              icon: "🤖",
              label,
              actor: actorKey,
              depth: 0,
              expandable: { tool: part.tool, input: part.inputPreview, stepTokens: ev.usage },
            });
          } else {
            rows.push({
              seq,
              atMs,
              icon: "⚙",
              label: `${part.tool}${actorSuffix}`,
              actor: actorKey,
              tokenDelta: fresh,
              depth,
              expandable: { tool: part.tool, input: part.inputPreview, stepTokens: ev.usage },
            });
          }
        } else if (part.kind === "tool_result") {
          rows.push({
            seq,
            atMs,
            icon: "↩",
            label: `result${actorSuffix}`,
            actor: actorKey,
            depth,
          });
        }
      }
      continue;
    }

    if (ev.kind === "result") {
      // Terminal settle rows — one per actor bucket that closed. derive only
      // computes these for the TERMINAL batch (a streaming "just settled" row
      // mid-run is a useRunStore-derived transition comparing successive
      // rollup() snapshots, not something this pure function needs to know).
      for (const [actorKey, actor] of state.actors) {
        if (actorKey === MAIN_ACTOR) continue;
        const label = seenDispatchLabel.get(actorKey) ?? state.dispatches.get(actorKey)?.subagentType ?? actorKey;
        rows.push({
          seq,
          atMs,
          icon: "✓",
          label: `${label} settled  Σ ${freshOf(actor.usage)}`,
          actor: actorKey,
          depth: 1,
        });
      }
      rows.push({
        seq,
        atMs,
        icon: ev.isError ? "✗" : "✓",
        label: `result · ${ev.subtype}${ev.isError ? " (error)" : ""}`,
        depth: 0,
      });
      continue;
    }

    if (ev.kind === "unknown") {
      rows.push({ seq, atMs, icon: "?", label: `unknown(${ev.type})`, depth: 0, raw: true });
      continue;
    }

    // parse-error
    rows.push({ seq, atMs, icon: "⚠", label: "parse-error", depth: 0, raw: true });
  }

  return rows;
}

export interface RunSummary {
  status: RunInfo["status"];
  exitCode: number | null;
  durationMs: number | null;
  startedAt: string;
  totals: FourWay & { fresh: number; costUsd?: number };
  perNode: Array<{
    nodeId: string | null;
    label: string;
    ownFresh: number;
    totalFresh: number;
    costUsd?: number;
    unrecognized?: boolean;
  }>;
  filesChanged: FileChange[] | "unavailable";
  finalMessage?: string;
  stderrTail?: string;
  stopReason?: "wallClock" | "tokenCap";
  degraded: boolean;
}

/**
 * runSummary — pure projection matching the design's RunSummary contract.
 * `perNode` built directly from `rollup()`'s command/byAgent/unrecognized;
 * `finalMessage` from the last main-actor text part before `result`; cost
 * reconciled via `pricing.reconcileToTotal` (the ONE call site — F4/F6).
 *
 * Degraded-telemetry detection (F6): compares fold's own fresh-tokens-
 * attributable-to-the-main-model against `result.usage` (main-model-only),
 * via `expectedBackgroundDelta` computed from `modelUsage` entries whose
 * model isn't the main model — a mismatch BEYOND that expected delta (± the
 * tolerance band) sets `degraded: true`. NEVER re-bases the fold's own
 * numbers — they remain authoritative and unchanged (F6's explicit resolution).
 */
export function runSummary(
  state: RunState,
  meta: {
    run: RunInfo;
    agentSubagentNames: Set<string>;
    agentLabelByName?: Map<string, string>;
    /** full persisted event list — used ONLY to extract `finalMessage` (the
     *  last main-actor text part before `result`); everything else in this
     *  projection is derived from `state` alone. */
    events?: PersistedRunEvent[];
  },
  filesChanged: FileChange[] | "unavailable"
): RunSummary {
  const { run, agentSubagentNames } = meta;
  const rolled = rollup(state, agentSubagentNames);

  const totalFreshUsage = [...state.actors.values()].reduce((acc, a) => ({
    input: acc.input + a.usage.input,
    output: acc.output + a.usage.output,
    cacheRead: acc.cacheRead + a.usage.cacheRead,
    cacheWrite: acc.cacheWrite + a.usage.cacheWrite,
  }), zeroFourWay());

  // Cost estimates per bucket (F4), reconciled to result.totalCostUsd (F6)
  // when present — the terminal reconciliation point.
  const estimates = new Map<string, number>();
  const freshShares = new Map<string, number>();
  const mainModel = state.init?.model ?? "";
  estimates.set(MAIN_ACTOR, estimateCostUsd(zeroFourWayFor(state, MAIN_ACTOR), mainModel) ?? 0);
  freshShares.set(MAIN_ACTOR, rolled.command.ownFresh);
  for (const [name, bucket] of rolled.byAgent) {
    // Best-effort: agent buckets don't carry their own model string in the
    // rollup (aggregate.ts doesn't track per-actor model) — reuse mainModel
    // as the estimate basis; this is a KNOWN approximation, corrected at
    // terminal by reconcileToTotal against the authoritative total.
    estimates.set(name, estimateCostUsd({ input: bucket.ownFresh, output: 0, cacheRead: 0, cacheWrite: 0 }, mainModel) ?? 0);
    freshShares.set(name, bucket.ownFresh);
  }
  if (rolled.unrecognized.fresh > 0) {
    estimates.set("__unrecognized", estimateCostUsd({ input: rolled.unrecognized.fresh, output: 0, cacheRead: 0, cacheWrite: 0 }, mainModel) ?? 0);
    freshShares.set("__unrecognized", rolled.unrecognized.fresh);
  }

  let reconciled: Map<string, number> | undefined;
  if (state.result?.totalCostUsd !== undefined) {
    reconciled = reconcileToTotal(estimates, state.result.totalCostUsd, freshShares);
  }

  const perNode: RunSummary["perNode"] = [
    {
      nodeId: null,
      label: `/${run.commandName}`,
      ownFresh: rolled.command.ownFresh,
      totalFresh: rolled.command.totalFresh,
      costUsd: reconciled?.get(MAIN_ACTOR),
    },
    ...[...rolled.byAgent.entries()].map(([name, bucket]) => ({
      nodeId: null,
      label: meta.agentLabelByName?.get(name) ?? name,
      ownFresh: bucket.ownFresh,
      totalFresh: bucket.totalFresh,
      costUsd: reconciled?.get(name),
    })),
  ];
  if (rolled.unrecognized.fresh > 0) {
    perNode.push({
      nodeId: null,
      label: "unrecognized subagent",
      ownFresh: rolled.unrecognized.fresh,
      totalFresh: rolled.unrecognized.fresh,
      costUsd: reconciled?.get("__unrecognized"),
      unrecognized: true,
    });
  }

  // Final message: last main-actor text part before/at result (extracted from
  // the raw event list — `state.actors` only retains aggregated usage, not text).
  let finalMessage: string | undefined;
  if (meta.events) {
    for (const persisted of meta.events) {
      const ev = persisted.ev;
      if (ev.kind !== "message" || (ev.parentToolUseId ?? MAIN_ACTOR) !== MAIN_ACTOR) continue;
      const lastText = [...ev.parts].reverse().find((p) => p.kind === "text");
      if (lastText && lastText.kind === "text" && lastText.textPreview.trim().length > 0) {
        finalMessage = lastText.textPreview;
      }
    }
  }

  const degraded = computeDegraded(state);

  const summary: RunSummary = {
    status: run.status,
    exitCode: run.exitCode,
    durationMs: run.endedAt ? new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime() : null,
    startedAt: run.startedAt,
    totals: { ...totalFreshUsage, fresh: freshOf(totalFreshUsage), costUsd: state.result?.totalCostUsd },
    perNode,
    filesChanged,
    finalMessage,
    stderrTail: run.status === "failed" && run.errorMessage ? run.errorMessage : undefined,
    stopReason: run.stopReason ?? undefined,
    degraded,
  };
  return summary;
}

function zeroFourWayFor(state: RunState, actorKey: string): FourWay {
  return state.actors.get(actorKey)?.usage ?? zeroFourWay();
}

/**
 * computeDegraded (F6) — parse errors always degrade; additionally, if a
 * terminal `result` is present, cross-check the fold's own main-actor-scoped
 * fresh total against `result.usage`. `result.usage` is main-model-only
 * (F6's ground truth, STATE §8.0) and — because background-model token usage
 * NEVER appears inside any `assistant` event's own `usage` block (it is only
 * ever visible via `result.modelUsage`, per the verified real fixture) — the
 * fold's own main-actor bucket should match `result.usage` almost exactly on
 * a healthy run; `expectedBackgroundDelta` (computed from `modelUsage` entries
 * whose model isn't the main model) exists here as the EXPLANATORY quantity a
 * Checker/QA can inspect for why a mismatch occurred, not as a term to
 * subtract from the fold — subtracting it would be double-counting, since
 * that background usage was never added to the fold's main bucket in the
 * first place. A mismatch beyond BACKGROUND_RECONCILE_TOLERANCE (in EITHER
 * input or output) flags degraded. This NEVER changes state's own numbers —
 * cross-check only (F6).
 */
function computeDegraded(state: RunState): boolean {
  if (state.parseErrors > 0) return true;
  const result = state.result;
  if (!result) return false;

  const mainActorUsage = state.actors.get(MAIN_ACTOR)?.usage ?? zeroFourWay();

  const mismatchInput = Math.abs(mainActorUsage.input - result.usage.input);
  const mismatchOutput = Math.abs(mainActorUsage.output - result.usage.output);

  return (
    mismatchInput > BACKGROUND_RECONCILE_TOLERANCE || mismatchOutput > BACKGROUND_RECONCILE_TOLERANCE
  );
}
