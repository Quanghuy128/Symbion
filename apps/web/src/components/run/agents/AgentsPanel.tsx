"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AgentNode, AgentView, BackgroundTask, PersistedRunEvent, RunInfo, RunStatus, RunSummary } from "@symbion/core";
import { useNow, useReducedMotion } from "@/lib/run/useNow";
import { readAgentsPanelSession, writeAgentsPanelSession } from "@/lib/run/agentsPanelSession";
import { DegradedTelemetryChip, type DegradedReason } from "../DegradedTelemetryChip";
import { RunSummarySection } from "../RunSummarySection";
import { AgentTree, flattenTree } from "./AgentTree";
import { BackgroundGroup, UnattributedGroup } from "./AgentGroups";
import { AgentDetailView, type BreadcrumbSegment, type TranscriptListHandle } from "./AgentDetailView";
import { RawEventLog } from "./RawEventLog";
import { RunOutcomeCard } from "./RunOutcomeCard";
import { RunFinishedStrip } from "./RunFinishedStrip";

const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>(["completed", "failed", "cancelled", "timedOut"]);

type Frame =
  | { kind: "tree" }
  | { kind: "agent"; agentId: string; scrollToRowId?: string }
  | { kind: "summary" }
  | { kind: "raw" };

export interface AgentsPanelProps {
  view: AgentView;
  /** session-restore key (AC-6). */
  runId: string | null;
  runStatus: RunStatus;
  /** streaming right now (mission active, not history) — follow / pill semantics. */
  live: boolean;
  /** false while the SSE link is reconnecting / polling: pulses + tickers freeze
   *  (design §5 "pulses freeze to static cyan"), follow state is kept. */
  connectionLive?: boolean;
  /** viewing a past run (history). */
  readOnly: boolean;
  /** history fetch / F5 replay in flight -> S8 skeleton. */
  loading: boolean;
  /** every event of the run being shown — the Raw view (S5). */
  events: readonly PersistedRunEvent[];
  runStartedAtMs: number | null;
  runInfo: Pick<RunInfo, "exitCode" | "stopReason" | "startedAt" | "endedAt" | "filesChanged" | "lastSeq" | "totals"> | null;
  summary?: RunSummary;
  degradedReason: DegradedReason | null;
  /** size of the last accepted batch (motion only when ≤5). */
  batchSize: number;
  /** graph node click → open this agent (nonce re-triggers the same id). */
  openRequest?: { agentId: string; nonce: number } | null;
  /** the agent whose detail is open (null = none) — drives the graph halo. */
  onSelectAgent: (agentId: string | null) => void;
  /** hover a tree row → soft halo on its graph node. */
  onHoverAgent: (agentId: string | null) => void;
  onRerun: () => void;
  onClose: () => void;
  projectId?: string;
}

function agentLabel(a: AgentNode): string {
  if (a.kind === "root") return a.agentType;
  if (a.kind === "unattributed") return "unattributed";
  return a.description ? `${a.agentType} · ${a.description}` : a.agentType;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

function isButtonTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && t.closest("button") !== null;
}

/**
 * AgentsPanel — replaces the old timeline panel (design §4). One view stack:
 * Tree → Agent → Summary / Raw. Keyboard only while focus is inside the
 * panel; Esc / Backspace collapse-then-pop and NEVER stop the run.
 */
export function AgentsPanel({
  view,
  runId,
  runStatus,
  live,
  connectionLive = true,
  readOnly,
  loading,
  events,
  runStartedAtMs,
  runInfo,
  summary,
  degradedReason,
  batchSize,
  openRequest,
  onSelectAgent,
  onHoverAgent,
  onRerun,
  onClose,
  projectId,
}: AgentsPanelProps) {
  const [stack, setStack] = useState<Frame[]>([{ kind: "tree" }]);
  const [treeFocus, setTreeFocus] = useState<string | null>(null);
  const [finishedStrip, setFinishedStrip] = useState(false);
  const listRef = useRef<TranscriptListHandle>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const savedTreeScroll = useRef(0);
  const reducedMotion = useReducedMotion();
  // motion / ticking only while streaming over a healthy connection
  const animLive = live && connectionLive;
  const nowMs = useNow(1_000, animLive);
  const terminal = TERMINAL.has(runStatus);
  const cancelling = runStatus === "cancelling";
  const animate = animLive && batchSize <= 5 && !reducedMotion;
  const top = stack[stack.length - 1]!;

  // Reset when the run being shown changes.
  const restoredRef = useRef(false);
  useEffect(() => {
    setStack([{ kind: "tree" }]);
    setFinishedStrip(false);
    restoredRef.current = false;
  }, [runId]);

  // AC-6: restore the previous view once the agent exists in the (replayed) view.
  useEffect(() => {
    if (restoredRef.current || loading) return;
    const saved = readAgentsPanelSession(runId);
    if (!saved || saved.view === "tree") {
      restoredRef.current = true;
      return;
    }
    if (saved.agentId && view.agentsById.has(saved.agentId)) {
      restoredRef.current = true;
      setStack([{ kind: "tree" }, { kind: "agent", agentId: saved.agentId }]);
      return;
    }
    // Review fix #5: only give up once the replay is COMPLETE — F5 backfill
    // arrives in 500-event chunks, so a full chunk (or a non-live connection)
    // means more may follow.
    const lastSeq = runInfo?.lastSeq ?? 0;
    const caughtUp = view.eventCount >= lastSeq;
    const streamDone = readOnly || terminal ? caughtUp : connectionLive && batchSize < 500 && caughtUp;
    if (streamDone) restoredRef.current = true; // the agent never appeared -> stay on the tree
  }, [runId, view, loading, terminal, readOnly, runInfo, connectionLive, batchSize]);

  // Persist the current view (tree / agent) per run.
  const selectedAgentId = top.kind === "agent" ? top.agentId : null;
  useEffect(() => {
    if (!restoredRef.current) return;
    writeAgentsPanelSession(runId, selectedAgentId ? { view: "agent", agentId: selectedAgentId } : { view: "tree" });
  }, [runId, selectedAgentId]);

  // Graph halo follows the open detail. Fired ONLY when the open agent
  // changes (the callback identity may change on every batch upstream).
  const onSelectRef = useRef(onSelectAgent);
  onSelectRef.current = onSelectAgent;
  useEffect(() => {
    onSelectRef.current(selectedAgentId);
  }, [selectedAgentId]);

  const pushAgent = useCallback(
    (agentId: string, scrollToRowId?: string) => {
      restoredRef.current = true; // the user navigated: stop auto-restoring
      setStack((s) => {
        const t = s[s.length - 1]!;
        if (t.kind === "tree" && treeScrollRef.current) savedTreeScroll.current = treeScrollRef.current.scrollTop;
        if (t.kind === "agent" && t.agentId === agentId && !scrollToRowId) return s;
        return [...s, { kind: "agent", agentId, scrollToRowId }];
      });
    },
    []
  );

  const pop = useCallback(() => {
    restoredRef.current = true;
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const backToTree = useCallback(() => setStack([{ kind: "tree" }]), []);

  // Graph-side open requests (node click / instance picker).
  const lastNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!openRequest || openRequest.nonce === lastNonce.current) return;
    lastNonce.current = openRequest.nonce;
    if (view.agentsById.has(openRequest.agentId)) {
      restoredRef.current = true;
      pushAgent(openRequest.agentId);
    }
  }, [openRequest, view, pushAgent]);

  // Restore the tree's scroll position on return.
  useLayoutEffect(() => {
    if (top.kind === "tree" && treeScrollRef.current) treeScrollRef.current.scrollTop = savedTreeScroll.current;
  }, [top.kind]);

  // S4c: the run ended while a detail was open -> inline strip, no auto-navigation (Q3).
  const prevTerminal = useRef(terminal);
  useEffect(() => {
    if (!prevTerminal.current && terminal && !readOnly && top.kind === "agent") setFinishedStrip(true);
    prevTerminal.current = terminal;
  }, [terminal, readOnly, top.kind]);

  // Live fade-in of newly spawned tree rows (never on replay / history / reduced motion).
  const seenIds = useRef<Set<string> | null>(null);
  const flat = useMemo(() => flattenTree(view.root), [view.root]);
  const newIds = useMemo(() => {
    const out = new Set<string>();
    if (animate && seenIds.current) for (const r of flat) if (!seenIds.current.has(r.agent.id)) out.add(r.agent.id);
    return out;
  }, [flat, animate]);
  useEffect(() => {
    seenIds.current = new Set(flat.map((r) => r.agent.id));
  }, [flat]);

  const treeOrder = useMemo(() => {
    const ids = flat.map((r) => r.agent.id);
    if (view.unattributed) ids.push(view.unattributed.id);
    return ids;
  }, [flat, view.unattributed]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingTarget(e.target)) return;
    const onButton = isButtonTarget(e.target);
    if (top.kind === "tree") {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = treeFocus ? treeOrder.indexOf(treeFocus) : -1;
        const next = e.key === "ArrowDown" ? Math.min(treeOrder.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
        setTreeFocus(treeOrder[next] ?? null);
        return;
      }
      if (e.key === "Enter" && !onButton && treeFocus) {
        e.preventDefault();
        pushAgent(treeFocus);
        return;
      }
    }
    if (top.kind === "agent") {
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        listRef.current?.moveFocus(e.key === "j" ? 1 : -1);
        return;
      }
      if (e.key === " " && !onButton) {
        e.preventDefault();
        listRef.current?.toggleFocused();
        return;
      }
      if (e.key === "Enter" && !onButton) {
        e.preventDefault();
        listRef.current?.activateFocused();
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        listRef.current?.jumpToLatest();
        return;
      }
    }
    if (e.key === "Escape") {
      // Esc NEVER cancels a run: collapse first, then go back.
      e.preventDefault();
      if (top.kind === "agent" && listRef.current?.collapseAll()) return;
      pop();
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      pop();
    }
  };

  const agentFor = (id: string) => view.agentsById.get(id);
  const breadcrumbFor = (agent: AgentNode): BreadcrumbSegment[] => {
    const chain: BreadcrumbSegment[] = [];
    let cur: AgentNode | undefined = agent;
    let guard = 0;
    while (cur && guard++ < 64) {
      chain.unshift({ id: cur.id, label: agentLabel(cur) });
      cur = cur.parentId ? agentFor(cur.parentId) : undefined;
    }
    if (agent.kind !== "root" && chain[0]?.id !== view.root.id) chain.unshift({ id: view.root.id, label: agentLabel(view.root) });
    return chain;
  };

  // Background row › -> the owner's transcript, scrolled to the launching row.
  const openBackground = (t: BackgroundTask) => {
    const owner = view.agentsById.has(t.ownerAgentId) ? t.ownerAgentId : view.root.id;
    pushAgent(owner, t.rowId);
  };

  const transcriptUnavailable = readOnly && !loading && view.eventCount === 0 && (runInfo?.lastSeq ?? 0) > 0;
  const durationMs =
    runInfo?.endedAt && runInfo.startedAt ? Date.parse(runInfo.endedAt) - Date.parse(runInfo.startedAt) : summary?.durationMs ?? null;
  const filesChanged = runInfo && Array.isArray(runInfo.filesChanged) ? runInfo.filesChanged.length : null;
  const viewSummary = summary ? () => setStack((s) => [...s, { kind: "summary" }]) : undefined;
  const unattributedEvents = view.unattributed ? (view.rowsByAgent.get(view.unattributed.id)?.length ?? 0) : 0;

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div className="space-y-2 p-3" data-testid="agents-skeleton">
        <div className="h-3 w-4/5 rounded-sm bg-surface-hover" />
        <div className="ml-3 h-3 w-3/5 rounded-sm bg-surface-hover" />
        <div className="ml-3 h-3 w-2/3 rounded-sm bg-surface-hover" />
        <p className="pt-1 text-overline text-ink-muted">rebuilding agents… {view.eventCount.toLocaleString("en-US")} ev</p>
      </div>
    );
  } else if (transcriptUnavailable) {
    body = (
      <div className="p-3 text-caption text-ink-muted">
        <p>Transcript unavailable for this run.</p>
        {runInfo?.totals && viewSummary && (
          <button type="button" className="mt-2 rounded-sm border border-line-soft px-2 py-0.5 text-caption text-ink" onClick={viewSummary}>
            View summary
          </button>
        )}
      </div>
    );
  } else if (top.kind === "summary" && summary) {
    body = (
      <RunSummarySection
        summary={summary}
        onRerun={onRerun}
        onBack={pop}
        onClose={onClose}
        projectId={projectId}
        onOpenAgent={(label) => {
          const id =
            label === view.root.agentType ? view.root.id : (view.instancesByType.get(label)?.[0] ?? null);
          if (id) pushAgent(id);
        }}
      />
    );
  } else if (top.kind === "raw") {
    body = <RawEventLog events={events} originMs={runStartedAtMs} live={live} onBack={pop} />;
  } else if (top.kind === "agent" && agentFor(top.agentId)) {
    const agent = agentFor(top.agentId)!;
    const parent = agent.spawnedBy ? agentFor(agent.spawnedBy) : undefined;
    body = (
      <AgentDetailView
        key={agent.id}
        ref={listRef}
        agent={agent}
        rows={view.rowsByAgent.get(agent.id) ?? []}
        breadcrumb={breadcrumbFor(agent)}
        spawnedByLabel={parent ? agentLabel(parent) : null}
        live={live}
        readOnly={readOnly}
        cancelling={cancelling}
        pulsesLive={animLive}
        nowMs={nowMs}
        scrollToRowId={top.scrollToRowId}
        onBack={backToTree}
        onNavigate={(id) => pushAgent(id)}
        onRaw={agent.kind === "root" ? () => setStack((s) => [...s, { kind: "raw" }]) : undefined}
        onRerun={agent.kind === "root" && terminal ? onRerun : undefined}
        filesChanged={agent.kind === "root" ? filesChanged : undefined}
        costUsd={agent.kind === "root" ? summary?.totals.costUsd : undefined}
        finishedStrip={
          finishedStrip ? <RunFinishedStrip status={runStatus} onViewSummary={viewSummary} onDismiss={() => setFinishedStrip(false)} /> : null
        }
      />
    );
  } else {
    body = (
      <div ref={treeScrollRef} className="min-h-0 flex-1 overflow-auto py-1">
        {terminal && (
          <RunOutcomeCard
            status={runStatus}
            exitCode={runInfo?.exitCode ?? null}
            stopReason={runInfo?.stopReason ?? null}
            durationMs={durationMs}
            freshTokens={view.root.freshTokens}
            costUsd={summary?.totals.costUsd}
            filesChanged={filesChanged}
            onViewSummary={viewSummary}
            adjustCeilingsHref={projectId ? `/settings?project=${encodeURIComponent(projectId)}#execution` : undefined}
          />
        )}
        {degradedReason && (
          <p className="mx-2 mb-1 rounded-sm bg-warning-soft px-2 py-1 text-overline text-warning" data-testid="degraded-note">
            Subagent attribution unavailable — all activity is in the root transcript.
          </p>
        )}
        <AgentTree
          root={view.root}
          selectedAgentId={selectedAgentId}
          focusedAgentId={treeFocus}
          live={live}
          nowMs={nowMs}
          cancelling={cancelling || !connectionLive}
          newIds={newIds}
          onOpen={(id) => pushAgent(id)}
          onHover={onHoverAgent}
        />
        <BackgroundGroup tasks={view.background} live={animLive} terminal={terminal} nowMs={nowMs} onOpen={openBackground} />
        <UnattributedGroup node={view.unattributed} eventCount={unattributedEvents} onOpen={() => view.unattributed && pushAgent(view.unattributed.id)} />
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col focus-visible:outline-0"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-testid="agents-panel"
      aria-label="Agents panel"
      role="region"
    >
      {(top.kind === "tree" || loading || transcriptUnavailable) && (
        <div className="flex items-center justify-between border-b border-line px-2 py-1 text-caption font-semibold uppercase text-ink-muted">
          <span>
            Agents{view.agentCount > 0 ? ` · ${view.agentCount}` : ""}
          </span>
          {degradedReason && <DegradedTelemetryChip reason={degradedReason} />}
        </div>
      )}
      {body}
      {top.kind === "tree" && live && !loading && (
        <div className="border-t border-line px-2 py-0.5 text-overline text-ink-muted">↑↓ select · ↵ open</div>
      )}
    </div>
  );
}
