"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ADAPTERS,
  extractAgentMentions,
  parseAgentBlock,
  removeAgentRef,
  upsertAgentRef,
  type AgentRef,
  type CanonicalArtifact,
} from "@symbion/core";
import { mergeLayoutPositions, type LayoutOverrideEntry } from "@symbion/core";
import { CommandNode } from "./graph/CommandNode";
import { AgentNode } from "./graph/AgentNode";
import { MissingAgentNode } from "./graph/MissingAgentNode";
import { GraphCanvas, type GraphCanvasEdge, type GraphCanvasHandle, type GraphCanvasNode } from "./graph/GraphCanvas";
import { computeLayout } from "./graph/computeLayout";
import { callRpc } from "@/lib/rpc/client";
import type {
  GetNodeLayoutParams,
  GetNodeLayoutResult,
  SetNodeLayoutParams,
  SetNodeLayoutResult,
} from "@symbion/rpc-types";
import { GraphStatusChips } from "./graph/GraphStatusChips";
import { GraphToolbar } from "./graph/GraphToolbar";
import { GraphCanvasMenu } from "./graph/GraphCanvasMenu";
import { GraphLegend } from "./graph/GraphLegend";
import { GraphHintBar } from "./graph/GraphHintBar";
import { DaemonRibbon } from "./graph/DaemonRibbon";
import { NodeDeleteConfirm } from "./graph/NodeDeleteConfirm";
import { EdgeRelationModal } from "./graph/EdgeRelationModal";
import { CopyRunCommandDialog } from "./CopyRunCommandDialog";
import { RunDialog } from "./run/RunDialog";
import { MissionStatusStrip } from "./run/MissionStatusStrip";
import { RunTimelinePanel, type TimelineMode } from "./run/RunTimelinePanel";
import { RunHistoryPopover } from "./run/RunHistoryPopover";
import { PastRunBanner } from "./run/PastRunBanner";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { useRunStore } from "@/lib/run/useRunStore";
import { newArtifact } from "@/lib/newArtifact";
import { hasSeenGraphHint, markGraphHintSeen } from "@/lib/graphHintSeen";

export interface DependencyGraphProps {
  artifacts: CanonicalArtifact[];
  /** ProjectView passes `setEditing` — opens the shared BuilderDrawer for add / edit / create-agent. */
  onEditArtifact: (artifact: CanonicalArtifact) => void;
  /** run engine v1 (P1): current project id/name for Execute + the preflight/consent copy. */
  projectId: string;
  projectName: string;
  /** opens the project's Publish flow (AC-RUN-13's "Publish first →" action). */
  onPublish?: () => void;
  /** bumps whenever the (sibling-owned) Publish dialog closes — RunDialog
   *  re-runs its preflight on change (Defect 3 fix / QA J7). */
  publishDialogClosedSignal?: number;
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled", "timedOut"]);

/**
 * P3 (STATE §18.1): maps a REPLAYED historical run's terminal RunStatus to
 * CommandNode's static ring variant. History mode never renders "active"/
 * "starting" (nothing is live) — only the frozen final state.
 */
function historyTerminalStatusToRingStatus(
  status: string
): "done" | "error" | "cancelled" | undefined {
  switch (status) {
    case "completed":
      return "done";
    case "failed":
    case "timedOut":
      return "error";
    case "cancelled":
      return "cancelled";
    default:
      return undefined;
  }
}

/**
 * setNodeLayout retry enhancement (STATE "PLAN — setNodeLayout retry",
 * 2026-07-19): a small, bounded, fixed-backoff retry wrapper around a single
 * `setNodeLayout` RPC call. No new file/package/dependency — inline helper
 * proportionate to this narrow client-side resilience patch (this codebase
 * has no existing retry utility). Aborts early if `isStillConnected()`
 * reports the daemon as disconnected before a retry attempt, rather than
 * burning remaining attempts against a known-disconnected daemon.
 */
async function retrySetNodeLayout<T>(
  fn: () => Promise<T>,
  attempts: number,
  delaysMs: number[],
  isStillConnected: () => boolean
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    // Checked immediately before EVERY attempt (not just right after a
    // failure) — the daemon can transition from connected to disconnected
    // during the backoff delay between attempts, and a stale connectivity
    // read taken only right after the previous failure would miss that
    // transition, wasting an attempt (and delaying the failure toast) on a
    // daemon that's already known to be down by the time this attempt
    // would fire.
    if (i > 0 && !isStillConnected()) {
      throw lastErr;
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLastAttempt = i === attempts - 1;
      if (isLastAttempt) throw err;
      await new Promise((resolve) => setTimeout(resolve, delaysMs[i] ?? delaysMs.at(-1) ?? 500));
    }
  }
  throw lastErr;
}

// Fixed-estimate node dimensions fed into dagre's layout (PLAN §4.1 decision
// (a)): all three node components are auto-sizing divs with no fixed
// width/height, so these are conservative constants, not measured values.
// command/agent labels are short in practice (`/${name}` / agent name);
// missingAgent gets a wider estimate for its longer `⚠ … (does not exist)` label.
const NODE_WIDTH = 160;
const NODE_HEIGHT = 40;
const MISSING_AGENT_NODE_WIDTH = 200;

const nodeTypes = {
  command: CommandNode,
  agent: AgentNode,
  missingAgent: MissingAgentNode,
};

interface ModalTarget {
  commandId: string;
  agentName: string;
  initial?: AgentRef;
}

/**
 * Plain node/edge data-bag shapes (self-coded-graph-migration PLAN §9.2) —
 * structurally identical to the pre-migration xyflow `Node`/`Edge` types
 * minus xyflow-specific fields (`sourcePosition`/`targetPosition`, which are
 * now computed at render time by `graphGeometry.ts`'s anchor helpers instead
 * of being data-bag fields). `data` stays an untyped `Record<string, unknown>`
 * here — each node/edge's concrete data shape is still enforced by
 * `CommandNodeData`/`AgentNodeData`/`MissingAgentNodeData`/`AnimatedEdgeData`
 * at the leaf-component boundary, unchanged.
 */
interface InternalNode {
  id: string;
  type: "command" | "agent" | "missingAgent";
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

/** Phase (c)-merged node — adds the fixed-estimate `width`/`height` GraphCanvas needs. */
interface LaidOutNode extends InternalNode {
  width: number;
  height: number;
}

interface InternalEdge {
  id: string;
  source: string;
  target: string;
  data?: Record<string, unknown>;
}

/**
 * S6 — dependency graph (self-coded `GraphCanvas`, migrated off
 * `@xyflow/react` — self-coded-graph-migration). Interactive authoring
 * surface (interactive-graph feature): drag command→agent to link (`@name`),
 * `+` edge modal for count/goal, edge delete, add/edit/delete nodes,
 * missing-agent → create. Nodes/edges stay DERIVED from `artifacts` (E10 —
 * never mirrored into local state); only ephemeral UI + the pending-ghost
 * edge are component-local. Layout stays auto (nodes never draggable, D1
 * deferred; `computeLayout.ts`/dagre unchanged by this migration).
 */
export function DependencyGraph({
  artifacts,
  onEditArtifact,
  projectId,
  projectName,
  onPublish,
  publishDialogClosedSignal,
}: DependencyGraphProps) {
  const canvasRef = useRef<GraphCanvasHandle>(null);
  const fitView = useCallback(() => canvasRef.current?.fitView(), []);
  const saveArtifact = useArtifactStore((s) => s.saveArtifact);
  const deleteArtifact = useArtifactStore((s) => s.deleteArtifact);
  const daemonConnected = useArtifactStore((s) => s.daemonConnected);
  const showToast = useArtifactStore((s) => s.showToast);
  const pingNow = useArtifactStore((s) => s.pingNow);

  // --- run engine v1 (P1) / P2 (structured telemetry), additive over the graph ---
  const run = useRunStore((s) => s.run);
  const elapsedMs = useRunStore((s) => s.elapsedMs);
  const connection = useRunStore((s) => s.connection);
  const rawTail = useRunStore((s) => s.rawTail);
  const activeArtifactId = useRunStore((s) => s.activeArtifactId);
  const cancelRunAction = useRunStore((s) => s.cancelRun);
  const attachIfActive = useRunStore((s) => s.attachIfActive);
  const setAgentSubagentNames = useRunStore((s) => s.setAgentSubagentNames);
  // P2: aggregation-derived state (folded via core.fold, never computed here).
  const nodeRunData = useRunStore((s) => s.nodeRunData);
  const timeline = useRunStore((s) => s.timeline);
  const summary = useRunStore((s) => s.summary);
  const degraded = useRunStore((s) => s.degraded);
  const degradedReason = useRunStore((s) => s.degradedReason);
  const [runDialogFor, setRunDialogFor] = useState<CanonicalArtifact | null>(null);
  const [panelMode, setPanelMode] = useState<TimelineMode>("feed");
  const [panelFilterId, setPanelFilterId] = useState<string | null>(null);
  const [pulseNodeId, setPulseNodeId] = useState<string | null>(null);
  const [pulseKey, setPulseKey] = useState(0);

  // --- P3: history (STATE §18.1) — 🕘 popover + read-only past-run overlay ---
  const historyRunId = useRunStore((s) => s.historyRunId);
  const historyLoading = useRunStore((s) => s.historyLoading);
  const historyRun = useRunStore((s) => s.historyRun);
  const historyNodeRunData = useRunStore((s) => s.historyNodeRunData);
  const historyTimeline = useRunStore((s) => s.historyTimeline);
  const historySummary = useRunStore((s) => s.historySummary);
  const openHistoryRun = useRunStore((s) => s.openHistoryRun);
  const exitHistory = useRunStore((s) => s.exitHistory);
  const reconciledNotice = useRunStore((s) => s.reconciledNotice);
  const dismissReconciledNotice = useRunStore((s) => s.dismissReconciledNotice);
  const consumePendingExecute = useRunStore((s) => s.consumePendingExecute);
  const consumePendingOpenHistory = useRunStore((s) => s.consumePendingOpenHistory);
  const [historyPopoverOpen, setHistoryPopoverOpen] = useState(false);
  const [runCount, setRunCount] = useState(0);
  const viewingHistory = historyRunId !== null;

  // F5-reattach: on mount, check for an already-active run in this project and
  // attach (bar + mission overlay resume) — the store owns the SSE lifecycle.
  // agentSubagentNames is resolved lazily by a SEPARATE effect below (once
  // `run`/`activeArtifactId` populate post-attach, since on a cold F5 load the
  // executing artifact isn't known until the reattached run.json arrives).
  useEffect(() => {
    void attachIfActive(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const missionActive = run !== null && !TERMINAL_RUN_STATUSES.has(run.status);
  // Authoring suspends for the whole graph while a run is active OR while
  // browsing history read-only (design §0/§5, STATE §18.1) — resumes
  // immediately once the run leaves the non-terminal set / history is exited.
  const authoringSuspended = missionActive || viewingHistory;

  // EDGE-2/A21 (STATE §18.1/§18.5): "live always wins" — if a NEW live run
  // starts while browsing history, the live overlay takes over automatically,
  // a toast explains why, and history is exited. Checked on every render via
  // an effect keyed on missionActive so it fires exactly once per transition.
  useEffect(() => {
    if (missionActive && viewingHistory) {
      exitHistory();
      showToast("A new run started — exited run history", "warning");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionActive, viewingHistory]);

  // Refresh the 🕘 history count whenever the panel isn't already open and a
  // run just went terminal (design's "hidden at 0 runs" empty-state rule —
  // the count only needs to be roughly current, not live-ticking).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await useRunStore.getState().listRunsForHistory(projectId);
        if (!cancelled) setRunCount(result.runs.length);
      } catch {
        /* best-effort — toolbar simply keeps its last known count. */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, missionActive]);

  // Auto-morph the panel to Summary on terminal transition, unless the user is
  // mid-scroll (approximated here by "already looking at Feed/Raw" — a full
  // scroll-position check lives inside RunTimelinePanel's own follow/pause
  // state, which is intentionally NOT overridden by this effect once the user
  // has taken an action; this effect only fires ONCE per run's terminal edge).
  const wasMissionActiveRef = useRef(false);
  useEffect(() => {
    if (missionActive) {
      wasMissionActiveRef.current = true;
      return;
    }
    if (wasMissionActiveRef.current && summary) {
      wasMissionActiveRef.current = false;
      setPanelMode("summary");
    }
  }, [missionActive, summary]);

  // --- ephemeral UI state (E10) ---
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);
  const [runCommandFor, setRunCommandFor] = useState<CanonicalArtifact | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  // Click-to-pin an edge's +/× toolbar (Fix B — second reveal path, design §3.3 #5).
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);
  // Non-optimistic ghost edge (E6/E8/Q): purely local, NEVER written to store.
  const [pendingConnection, setPendingConnection] = useState<{ source: string; target: string } | null>(null);
  // Node delete-confirm machine (mirrors ProjectView).
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // free-node-dragging (PLAN §4): the layout-override map is a CACHE of
  // server state (`.symbion/<project>/layout.json`, fetched via
  // `getNodeLayout` on mount/projectId-change, reconciled after every
  // successful `setNodeLayout`) — not client-invented state, exactly like
  // `nodeRunData`/`timeline` already cache server-derived run state
  // (PLAN §4's E10-compliance note). Keyed by the same id string a
  // `GraphCanvasNode.id` carries (real artifact uuid or synthetic
  // `missing-<name>`).
  const [layoutOverrides, setLayoutOverrides] = useState<Record<string, LayoutOverrideEntry>>({});

  // setNodeLayout retry enhancement (STATE "PLAN — setNodeLayout retry",
  // 2026-07-19): per-nodeId generation token, gates whether an async retry
  // chain's eventual outcome (success reconcile or failure toast) is still
  // allowed to affect visible state. A newer drag commit for the same
  // nodeId bumps the token, silently superseding any still-in-flight
  // retry chain from an older commit for that same node.
  const dragCommitTokenRef = useRef(new Map<string, number>());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await callRpc<GetNodeLayoutParams, GetNodeLayoutResult>("getNodeLayout", { projectId });
        if (!cancelled) setLayoutOverrides(result.positions);
      } catch {
        // AC-4 proxy at the component level: a thrown/rejected getNodeLayout
        // (e.g. daemon offline at mount) falls back to treating overrides as
        // empty — full dagre auto-layout for every node, no crash.
        if (!cancelled) setLayoutOverrides({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleNodeDragCommit = useCallback(
    (nodeId: string, position: { x: number; y: number }) => {
      // (a) optimistic: apply locally immediately — no visible snap-back
      // waiting on the RPC round-trip (PLAN §4 step 3a).
      setLayoutOverrides((prev) => ({ ...prev, [nodeId]: position }));

      // Bump this node's generation token — this commit is now the latest
      // for `nodeId`; any still-in-flight retry chain from a PRIOR commit
      // for this same nodeId becomes stale and must not affect state.
      const myToken = (dragCommitTokenRef.current.get(nodeId) ?? 0) + 1;
      dragCommitTokenRef.current.set(nodeId, myToken);

      // (b) fire-and-forget-but-tracked persist, wrapped in a small bounded
      // retry (setNodeLayout retry enhancement, 2026-07-19): 3 total
      // attempts, fixed short backoff, aborted early if the daemon is known
      // disconnected. Silent throughout — only the terminal outcome
      // (silent reconcile, or the existing failure toast) is user-visible,
      // and only for the LATEST commit for this nodeId (supersession guard).
      void (async () => {
        try {
          const result = await retrySetNodeLayout(
            () =>
              callRpc<SetNodeLayoutParams, SetNodeLayoutResult>("setNodeLayout", {
                projectId,
                nodeId,
                position,
              }),
            3,
            [250, 750],
            // Read the LIVE store value, not the `daemonConnected` closed
            // over at commit-time — the daemon can transition from
            // connected to disconnected mid-retry-sequence (up to ~1s
            // later), and this check must observe that transition, not a
            // stale snapshot from when the drag was first committed.
            () => useArtifactStore.getState().daemonConnected
          );
          // Reconcile with the server's full returned map (defends against a
          // rare read-modify-write race from a second tab, last-write-wins).
          // Only if this is still the latest commit for this nodeId —
          // otherwise a stale/superseded success is silently dropped.
          if (dragCommitTokenRef.current.get(nodeId) === myToken) {
            setLayoutOverrides(result.positions);
          }
        } catch {
          // Only show the toast for the latest commit for this nodeId — a
          // superseded (stale) failure is silently dropped, since the newer
          // drag's own outcome is authoritative and a toast about an old,
          // already-moved-away-from position would be confusing.
          if (dragCommitTokenRef.current.get(nodeId) === myToken) {
            showToast("Position not saved — try again.", "error");
          }
          // Deliberate simplicity choice (PLAN §4/§9 item 5): the local
          // optimistic position is LEFT AS-IS for this session — no retry
          // queue, no local-storage fallback. It simply won't survive a
          // reload, which the toast communicates.
        }
      })();
    },
    [projectId, showToast]
  );

  const handleNodeDragDaemonDisconnected = useCallback(
    (nodeId: string, position: { x: number; y: number }) => {
      // Daemon disconnect mid-drag (PLAN §7 edge case #7): apply the local
      // optimistic position (harmless UI-only) but skip the RPC entirely —
      // no point firing a call that will fail.
      setLayoutOverrides((prev) => ({ ...prev, [nodeId]: position }));
      showToast("Daemon offline — position won't be saved until reconnected.", "warning");
    },
    [showToast]
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const agents = useMemo(() => artifacts.filter((a) => a.kind === "agent"), [artifacts]);
  const commands = useMemo(() => artifacts.filter((a) => a.kind === "command"), [artifacts]);
  const agentByName = useMemo(() => new Map(agents.map((a) => [a.name, a])), [agents]);
  const agentNames = useMemo(() => new Set(agents.map((a) => a.name)), [agents]);
  const commandById = useMemo(() => new Map(commands.map((c) => [c.id, c])), [commands]);
  const artifactById = useMemo(() => new Map(artifacts.map((a) => [a.id, a])), [artifacts]);

  // F8 (RunCommandPalette): consume a pending Execute/history request left by
  // the palette (possibly from a different route) the moment this project's
  // Graph view mounts (STATE §18.1's "auto-switches to the Graph tab").
  useEffect(() => {
    const pendingArtifactId = consumePendingExecute();
    if (pendingArtifactId) {
      const cmd = commandById.get(pendingArtifactId);
      if (cmd) setRunDialogFor(cmd);
    }
    if (consumePendingOpenHistory()) {
      setHistoryPopoverOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandById]);

  // F5-reattach's agentSubagentNames follow-up (P2): startRun's caller
  // (RunDialog) already passes agentSubagentNames at run-start time — this
  // effect ONLY covers the cold-reload/reattach path, where activeArtifactId
  // becomes known asynchronously (after the reattached run.json loads) and no
  // RunDialog session exists to have supplied the set up front.
  useEffect(() => {
    if (!activeArtifactId) return;
    const activeCommand = commandById.get(activeArtifactId);
    if (!activeCommand) return;
    setAgentSubagentNames(new Set(extractAgentMentions(activeCommand.body)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArtifactId, commandById]);

  // First-run hint bar (design §5 N): show once per user when there's something on the canvas.
  useEffect(() => {
    if (artifacts.length > 0 && !hasSeenGraphHint()) setShowHint(true);
  }, [artifacts.length]);

  function dismissHint() {
    markGraphHintSeen();
    setShowHint(false);
  }

  // Auto-fade the just-added ring after ~1.6s.
  useEffect(() => {
    if (!justAddedId) return;
    const t = window.setTimeout(() => setJustAddedId(null), 1600);
    return () => window.clearTimeout(t);
  }, [justAddedId]);

  // Just-landed ring for ANY newly-created node (design §4 I / §3.1): drawer
  // Add-workflow / Add-agent / missing-agent→create all funnel through
  // saveArtifact, which re-derives the graph from `artifacts`. Detect an id
  // that appears AFTER the first render and ring it (the drag path already
  // sets justAddedId itself; this generalises to the drawer/create paths).
  // A ref (not state) holds the previous id set so this never re-fires on its
  // own update, and the first render only seeds the baseline (no flash on mount).
  const prevIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const currentIds = new Set(artifacts.map((a) => a.id));
    const prev = prevIdsRef.current;
    prevIdsRef.current = currentIds;
    if (prev === null) return; // first render: seed baseline only, no ring.
    for (const id of currentIds) {
      if (!prev.has(id)) {
        setJustAddedId(id);
        break; // one new node per save in practice; ring the first found.
      }
    }
  }, [artifacts]);

  // ---------------------------------------------------------------------------
  // Mutations (all non-optimistic — canvas re-derives only after the RPC resolves).
  // ---------------------------------------------------------------------------

  const onConnect = useCallback(
    async (sourceId: string, targetId: string) => {
      const command = commandById.get(sourceId);
      const target = artifactById.get(targetId);
      // Backstop guard (E1) — isValidConnection is the live feedback.
      if (!command || command.kind !== "command" || !target || target.kind !== "agent") {
        showToast("Only /command → agent can be linked.", "error");
        return;
      }
      const agent = target;
      // Duplicate (E2): idempotent no-op.
      if (extractAgentMentions(command.body).includes(agent.name)) {
        showToast("Already linked.");
        return;
      }
      setPendingConnection({ source: command.id, target: agent.id });
      try {
        await saveArtifact({ ...command, body: upsertAgentRef(command.body, { name: agent.name }) });
        showToast(`Linked /${command.name} → ${agent.name}`, "success");
        setJustAddedId(agent.id);
        if (showHint) dismissHint();
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Save failed. Try again.", "error");
      } finally {
        setPendingConnection(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commandById, artifactById, saveArtifact, showToast, showHint]
  );

  const isValidConnection = useCallback(
    (sourceId: string, targetId: string) => {
      if (!sourceId || !targetId || sourceId === targetId) return false;
      const src = artifactById.get(sourceId);
      const tgt = artifactById.get(targetId);
      return src?.kind === "command" && tgt?.kind === "agent";
    },
    [artifactById]
  );

  const handleModalSave = useCallback(
    async (ref: AgentRef) => {
      if (!modalTarget) return;
      const command = commandById.get(modalTarget.commandId);
      if (!command) throw new Error("Workflow not found.");
      await saveArtifact({ ...command, body: upsertAgentRef(command.body, ref) });
      showToast(`Updated link for ${modalTarget.agentName}.`, "success");
    },
    [modalTarget, commandById, saveArtifact, showToast]
  );

  const handleEdgeDelete = useCallback(
    async (commandId: string, agentName: string) => {
      const command = commandById.get(commandId);
      if (!command) return;
      try {
        await saveArtifact({ ...command, body: removeAgentRef(command.body, agentName) });
        showToast(`Unlinked ${agentName}.`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Save failed. Try again.", "error");
      }
    },
    [commandById, saveArtifact, showToast]
  );

  function requestDelete(id: string) {
    setConfirmDeleteId(id);
    setDeleteError(null);
  }

  // Commands whose body @mentions the given agent name (E4 warning + toast).
  const referencingCommandsFor = useCallback(
    (agentName: string) =>
      commands.filter((c) => extractAgentMentions(c.body).includes(agentName)).map((c) => c.name),
    [commands]
  );

  async function confirmDeleteNode(artifact: CanonicalArtifact) {
    setDeletingId(artifact.id);
    setDeleteError(null);
    const refs = artifact.kind === "agent" ? referencingCommandsFor(artifact.name) : [];
    try {
      await deleteArtifact(artifact.id);
      setConfirmDeleteId(null);
      showToast("Deleted.");
      if (artifact.kind === "agent" && refs.length > 0) {
        showToast(`${refs.length} workflow(s) still reference ${artifact.name}.`, "warning");
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed — reason unknown.");
    } finally {
      setDeletingId(null);
    }
  }

  function handleAdd(kind: "agent" | "command") {
    onEditArtifact(newArtifact(kind));
  }

  function handleCreateAgent(name: string) {
    onEditArtifact(newArtifact("agent", name));
  }

  function handleRetry() {
    // Fire an immediate ping (independent of the heartbeat interval, which is
    // still live during a disconnect — startHeartbeat() would early-return and
    // do nothing observable). pingNow flips daemonConnected on the result.
    void pingNow();
  }

  // ---------------------------------------------------------------------------
  // Derivation (E10): nodes/edges are a pure function of artifacts + callbacks.
  // ---------------------------------------------------------------------------

  // P3 (STATE §18.1): while viewing a past run read-only, the node/edge memo
  // sources from `historyNodeRunData`/`historyRun` INSTEAD OF the live
  // `nodeRunData`/`activeArtifactId` — a selector-level branch over the SAME
  // memo below, not a duplicated derivation. `viewingHistory` and
  // `missionActive` are mutually exclusive by construction (EDGE-2/A21: "live
  // always wins" exits history the instant a live mission starts).
  const effectiveActiveArtifactId = viewingHistory ? historyRun?.artifactId ?? null : activeArtifactId;
  const effectiveNodeRunData = viewingHistory ? historyNodeRunData : nodeRunData;
  const effectiveDegraded = viewingHistory ? false : degraded;
  // "Participating" is true for BOTH an active live mission and a viewed
  // historical run (both need the dim/non-dim split); pulse/flow animation is
  // gated separately below by `missionActive` alone (history rings are always
  // final/static, never pulsing — design's "no pulse/flow" contract).
  const missionLike = missionActive || viewingHistory;

  // Run-engine participant set (design §3.4/§4): the executing command + its
  // reachable agents (by @mention) glow/stay full-opacity; everything else
  // dims to 35%. Empty when no run is active — additive, zero-cost otherwise.
  const runParticipantAgentNames = useMemo(() => {
    if (!missionLike || !effectiveActiveArtifactId) return new Set<string>();
    const activeCommand = commands.find((c) => c.id === effectiveActiveArtifactId);
    return activeCommand ? new Set(extractAgentMentions(activeCommand.body)) : new Set<string>();
  }, [missionLike, effectiveActiveArtifactId, commands]);

  const { baseNodes, baseEdges, missingAgentMentions } = useMemo(() => {
    // Phase (a) BUILD SHAPE — same data-bag construction as before; `position`
    // is a placeholder here and gets overwritten in Phase (c) MERGE below
    // (PLAN §3). Every other field is untouched.
    const nodes: InternalNode[] = [
      ...commands.map((c) => {
        // Unlinked heuristic (design §5 O, taste-call §9.14, conservative):
        // 0 @name mentions AND a backtick token matching an existing agent name.
        const mentions = extractAgentMentions(c.body);
        const backtickNames = [...c.body.matchAll(/`([A-Za-z0-9_-]+)`/g)].map((m) => m[1] ?? "");
        const unlinked = mentions.length === 0 && backtickNames.some((n) => agentNames.has(n));

        // Run engine v1 (P1) — additive data-bag only (design §4's CommandNodeData
        // diff): runStatus/runParticipant/onExecute/executeDisabledReason.
        // P3 (STATE §18.1): while viewing history, `isRunning` sources from
        // the REPLAYED run's artifactId — final "done"/"error"/"cancelled"
        // rings only, never "active" (no pulse — EDGE-2's "no pulse/flow").
        const isRunning = c.id === effectiveActiveArtifactId;
        const runStatus = missionActive
          ? isRunning
            ? "active"
            : undefined
          : viewingHistory && isRunning && historyRun
            ? historyTerminalStatusToRingStatus(historyRun.status)
            : undefined;
        const runParticipant = missionLike ? isRunning : true;
        // EDGE-2/A21: Execute stays reachable while browsing history (only a
        // LIVE active run disables it — browsing history is explicitly NOT
        // "a run is active"); the palette/⋯ menu path is identical either way.
        const executeDisabledReason = !daemonConnected
          ? "Daemon offline"
          : missionActive
            ? "A run is already active — view the running command"
            : undefined;

        // P2/P3: the command's roll-up badge (own + Σ agents) — sourced from
        // `effectiveNodeRunData`'s "main" bucket (live OR replayed history).
        const mainData = isRunning ? effectiveNodeRunData.get("main") : undefined;
        const badge = mainData
          ? {
              fresh: mainData.totalFresh,
              costUsd: mainData.costUsd,
              breakdown: mainData.breakdown,
              live: missionActive,
              degraded: effectiveDegraded,
            }
          : undefined;

        return {
          id: c.id,
          type: "command",
          position: { x: 0, y: 0 },
          data: {
            label: `/${c.name}`,
            connectable: daemonConnected && !authoringSuspended,
            daemonConnected,
            unlinked,
            justAdded: c.id === justAddedId,
            onEdit: authoringSuspended ? undefined : () => onEditArtifact(c),
            onEditBody: authoringSuspended ? undefined : () => onEditArtifact(c),
            onDelete: authoringSuspended ? undefined : () => requestDelete(c.id),
            onCopyRun: authoringSuspended ? undefined : () => setRunCommandFor(c),
            onExecute: executeDisabledReason ? undefined : () => setRunDialogFor(c),
            executeDisabledReason,
            runStatus,
            runParticipant,
            badge,
            runPulseKey: pulseNodeId === "main" ? pulseKey : undefined,
          },
        } satisfies InternalNode;
      }),
      ...agents.map((a) => {
        const runParticipant = missionLike ? runParticipantAgentNames.has(a.name) : true;
        const dispatched = missionLike && runParticipant;
        const agentData = dispatched ? effectiveNodeRunData.get(a.name) : undefined;
        // "working" while the run is active and this agent has been dispatched
        // (its bucket exists in nodeRunData with >0 own tokens, or the run is
        // still streaming — before any tokens arrive the badge simply shows
        // "—" per NodeTokenBadge's own pre-first-event contract); "settled"
        // once the mission ends (terminal) for a participant that DID run —
        // history mode ALWAYS renders "settled" (final state only, no "working").
        const agentRunStatus: "idle" | "working" | "settled" | "error" | undefined = !dispatched
          ? undefined
          : missionActive
            ? agentData
              ? "working"
              : undefined
            : agentData
              ? "settled"
              : undefined;
        const badge = agentData
          ? {
              fresh: agentData.totalFresh,
              costUsd: agentData.costUsd,
              breakdown: agentData.breakdown,
              live: missionActive,
              degraded: effectiveDegraded,
            }
          : undefined;
        return {
          id: a.id,
          type: "agent",
          position: { x: 0, y: 0 },
          data: {
            label: a.name,
            connectable: daemonConnected && !authoringSuspended,
            daemonConnected,
            justAdded: a.id === justAddedId,
            onEdit: authoringSuspended ? undefined : () => onEditArtifact(a),
            onDelete: authoringSuspended ? undefined : () => requestDelete(a.id),
            runParticipant,
            runStatus: agentRunStatus,
            badge,
            runPulseKey: pulseNodeId === a.name ? pulseKey : undefined,
          },
        } satisfies InternalNode;
      }),
    ];

    const edges: InternalEdge[] = [];
    const missingNodes = new Map<string, InternalNode>();
    const missingMentions = new Set<string>();
    let drawIndex = 0;
    for (const command of commands) {
      // parseAgentBlock decorates matching edges with count/goal (additive, §6.0).
      const refByName = new Map(parseAgentBlock(command.body).map((r) => [r.name, r]));
      for (const mention of extractAgentMentions(command.body)) {
        const targetAgent = agentByName.get(mention);
        const missingId = `missing-${mention}`;
        if (!targetAgent) {
          missingMentions.add(mention);
          if (!missingNodes.has(missingId)) {
            missingNodes.set(missingId, {
              id: missingId,
              type: "missingAgent",
              position: { x: 0, y: 0 },
              data: {
                label: `⚠ ${mention} (does not exist)`,
                name: mention,
                onCreateAgent: handleCreateAgent,
                daemonConnected,
              },
            });
          }
        }
        const ref = refByName.get(mention);
        edges.push({
          id: `${command.id}->${mention}`,
          source: command.id,
          target: targetAgent?.id ?? missingId,
          data: {
            drawIndex: drawIndex++,
            missing: !targetAgent,
            count: ref?.count,
            goal: ref?.goal,
            // Missing edges are never interactive (can't decorate a phantom).
            interactive: Boolean(targetAgent) && daemonConnected,
            onOpenModal: () =>
              setModalTarget({ commandId: command.id, agentName: mention, initial: ref }),
            onDelete: () => handleEdgeDelete(command.id, mention),
          },
        });
      }
    }

    const allNodes = [...nodes, ...missingNodes.values()];
    const dimensionById = new Map(
      allNodes.map((n) => [
        n.id,
        { width: n.type === "missingAgent" ? MISSING_AGENT_NODE_WIDTH : NODE_WIDTH, height: NODE_HEIGHT },
      ])
    );

    // Phase (b)/(c) LAYOUT+MERGE (free-node-dragging PLAN §5): dagre only
    // ever lays out the UNPINNED subset (ids with no saved override) — a
    // manually-dragged node's position is never recomputed. Edges passed
    // into the unpinned-subset dagre call are ALSO filtered to only those
    // whose source AND target are both unpinned (an edge touching a pinned
    // node is omitted — dagre never needs to know it exists, since it isn't
    // positioning that endpoint). `computeLayout.ts`/dagre itself is
    // UNCHANGED — this filtering + the pin/merge split live entirely in
    // `packages/core`'s pure `mergeLayoutPositions`.
    const allNodeIds = allNodes.map((n) => n.id);
    const positions = mergeLayoutPositions({
      nodeIds: allNodeIds,
      overrides: layoutOverrides,
      computeDagre: (unpinnedIds) => {
        const unpinnedSet = new Set(unpinnedIds);
        const dimensions = unpinnedIds.map((id) => ({ id, ...(dimensionById.get(id) ?? { width: NODE_WIDTH, height: NODE_HEIGHT }) }));
        const edgePairs = edges
          .filter((e) => unpinnedSet.has(e.source) && unpinnedSet.has(e.target))
          .map((e) => ({ source: e.source, target: e.target }));
        return computeLayout(dimensions, edgePairs);
      },
    });

    // `position` is replaced and `width`/`height` are attached (the
    // self-coded `GraphCanvas`/`graphGeometry.ts` need these on the node
    // object itself for anchor/hit-testing math — PLAN §9.1.2 — whereas
    // xyflow derived them internally from `nodeTypes`' rendered DOM). Every
    // other field (the whole `data` bag) is preserved exactly as built in
    // Phase (a).
    const laidOutNodes = allNodes.map((n) => ({
      ...n,
      position: positions.get(n.id) ?? n.position,
      width: n.type === "missingAgent" ? MISSING_AGENT_NODE_WIDTH : NODE_WIDTH,
      height: NODE_HEIGHT,
    }));

    return {
      baseNodes: laidOutNodes,
      baseEdges: edges,
      missingAgentMentions: [...missingMentions],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    commands,
    agents,
    agentByName,
    agentNames,
    daemonConnected,
    justAddedId,
    layoutOverrides,
    onEditArtifact,
    handleEdgeDelete,
    authoringSuspended,
    missionActive,
    missionLike,
    viewingHistory,
    historyRun,
    effectiveActiveArtifactId,
    runParticipantAgentNames,
    effectiveNodeRunData,
    effectiveDegraded,
    pulseNodeId,
    pulseKey,
  ]);

  // Hover-driven highlight/dim (kept from the read-only original). Suspended
  // during a mission — participant/non-participant dim (design §3.4) is the
  // only dim signal while a run is active; hover authoring cues stay off.
  const nodes = useMemo(
    () =>
      baseNodes.map((n) => {
        if (missionLike) {
          const participant = (n.data as { runParticipant?: boolean }).runParticipant ?? true;
          return { ...n, data: { ...n.data, highlighted: false, dimmed: !participant } };
        }
        if (!hoveredId) return n;
        const connected =
          n.id === hoveredId ||
          baseEdges.some(
            (e) => (e.source === hoveredId && e.target === n.id) || (e.target === hoveredId && e.source === n.id)
          );
        return { ...n, data: { ...n.data, highlighted: n.id === hoveredId, dimmed: !connected } };
      }),
    [baseNodes, baseEdges, hoveredId, missionLike]
  );

  const edges = useMemo(() => {
    const decorated = baseEdges.map((e) => {
      // Mission mode (P1 glow-only, design §2 R3): edges lose their authoring
      // interactivity (+/× toolbar) and adopt the participant dim, matching
      // the node treatment above. Dash-flow animation is P2 (design §3.5).
      if (missionActive) {
        const targetAgentName = agents.find((a) => a.id === e.target)?.name ?? "";
        const targetParticipant = runParticipantAgentNames.has(targetAgentName);
        const sourceIsActive = e.source === activeArtifactId;
        // P2 (STATE §13.1): a THIRD edge state — "settled" once the target
        // agent's bucket has usage (dispatched) but the run has moved past
        // active dispatch for it (approximated here as "has nodeRunData but
        // the run itself is terminal" is handled by missionActive=false
        // falling to the else-branch below; WITHIN an active mission, an
        // agent that's already accumulated usage but the command is no
        // longer the active edge's live target still counts as flowing while
        // the mission is active — "settled" mid-run per-agent needs the
        // store's own dispatch-close tracking, which this data bag doesn't
        // carry yet; edges settle definitively once the mission ends).
        const runFlow: "off" | "flowing" | "settled" =
          sourceIsActive && targetParticipant ? "flowing" : "off";
        return {
          ...e,
          data: { ...e.data, highlighted: false, dimmed: !(sourceIsActive && targetParticipant), interactive: false, runFlow },
        };
      }
      // Just-ended mission (run terminal, still showing the final tableau
      // until Close) OR a viewed historical run (P3, ALWAYS a static final
      // tableau — no pulse/flow, design's explicit "no pulse/flow" contract):
      // tint edges that participated as "settled" rather than snapping back
      // to the plain authoring dim (design §3.5's "flow stops, stroke stays
      // tinted 60% until run end").
      if (
        ((run && TERMINAL_RUN_STATUSES.has(run.status) && activeArtifactId) || viewingHistory) &&
        effectiveActiveArtifactId
      ) {
        const targetAgentName = agents.find((a) => a.id === e.target)?.name ?? "";
        const wasParticipant = e.source === effectiveActiveArtifactId && runParticipantAgentNames.has(targetAgentName);
        if (wasParticipant) {
          return { ...e, data: { ...e.data, highlighted: false, dimmed: false, interactive: false, runFlow: "settled" as const } };
        }
      }
      const selected = e.id === selectedEdgeId;
      if (!hoveredId) return selected ? { ...e, data: { ...e.data, selected } } : e;
      const connected = e.source === hoveredId || e.target === hoveredId;
      return { ...e, data: { ...e.data, highlighted: connected, dimmed: !connected, selected } };
    });
    // Ephemeral ghost edge during a pending save (Q) — local only, never in store.
    if (pendingConnection && !authoringSuspended) {
      decorated.push({
        id: `pending-${pendingConnection.source}->${pendingConnection.target}`,
        source: pendingConnection.source,
        target: pendingConnection.target,
        data: { pending: true },
      });
    }
    return decorated;
  }, [
    baseEdges,
    hoveredId,
    pendingConnection,
    selectedEdgeId,
    missionActive,
    activeArtifactId,
    effectiveActiveArtifactId,
    viewingHistory,
    runParticipantAgentNames,
    agents,
    authoringSuspended,
    run,
  ]);

  const confirmTarget = confirmDeleteId ? artifactById.get(confirmDeleteId) : null;

  return (
    <div>
      <GraphStatusChips
        claudeLossy={ADAPTERS.claude.capability.lossy}
        codexLossy={ADAPTERS.codex.capability.lossy}
        missingAgentMentions={missingAgentMentions}
      />

      {!daemonConnected && <DaemonRibbon onRetry={handleRetry} />}
      {showHint && daemonConnected && <GraphHintBar onDismiss={dismissHint} />}

      {/* ER-10 (§18.3 item 1): a run this tab was tracking was reconciled
       *  failed(daemon-restarted) while the tab was away — danger toast with
       *  a [View summary] action that opens the SAME read-only replay path
       *  history uses (a reconciled run IS a completed historical run). */}
      {reconciledNotice && (
        <div className="mb-2 flex items-center justify-between rounded-panel border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          <span>
            Run /{reconciledNotice.commandName} marked failed — daemon restarted.
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="underline decoration-dotted hover:text-danger/80"
              onClick={() => {
                void openHistoryRun(projectId, reconciledNotice.runId);
                dismissReconciledNotice();
              }}
            >
              [View summary]
            </button>
            <button type="button" className="text-danger/70 hover:text-danger" onClick={dismissReconciledNotice}>
              ✕
            </button>
          </span>
        </div>
      )}

      {viewingHistory && historyLoading && !historyRun && (
        <div className="border-b border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          🕘 loading past run…
        </div>
      )}

      {viewingHistory && historyRun && (
        <PastRunBanner
          run={historyRun}
          onExit={exitHistory}
          onRerun={() => {
            const cmd = historyRun.artifactId ? commandById.get(historyRun.artifactId) : undefined;
            if (cmd) {
              exitHistory();
              setRunDialogFor(cmd);
            }
          }}
        />
      )}

      {missionActive && run && (
        <MissionStatusStrip
          run={run}
          elapsedMs={elapsedMs}
          connection={connection}
          onCancel={() => void cancelRunAction()}
        />
      )}

      <div
        style={{ height: 480 }}
        className="relative flex rounded-panel border border-border-hairline bg-bg-panel"
      >
        <div className="relative flex-1">
          <GraphToolbar
            onAdd={handleAdd}
            onFitView={fitView}
            onToggleLegend={() => setLegendOpen((o) => !o)}
            disabled={!daemonConnected || authoringSuspended}
            fitDisabled={artifacts.length === 0}
          />
          {/* 🕘 history (design §3.10 R6, STATE §18.1) — hidden at 0 runs (the
           *  empty-state rule: absence is the cleanest empty state). */}
          {runCount > 0 && (
            <button
              type="button"
              onClick={() => setHistoryPopoverOpen((o) => !o)}
              className="absolute left-3 top-12 z-10 flex h-7 items-center gap-1 rounded-pill border border-border-menu bg-bg-menu px-2.5 text-[12.5px] font-medium text-text-body shadow-dropdown hover:bg-white/[.06]"
            >
              🕘 runs {runCount}
            </button>
          )}
          {historyPopoverOpen && (
            <RunHistoryPopover
              projectId={projectId}
              onSelect={(runId) => {
                setHistoryPopoverOpen(false);
                void openHistoryRun(projectId, runId);
              }}
              onClose={() => setHistoryPopoverOpen(false)}
            />
          )}
          <GraphLegend open={legendOpen} onOpenChange={setLegendOpen} />

          <GraphCanvas
            ref={canvasRef}
            nodes={nodes as GraphCanvasNode[]}
            edges={edges as GraphCanvasEdge[]}
            nodeTypes={nodeTypes}
            disabled={authoringSuspended}
            daemonConnected={daemonConnected}
            isValidConnection={authoringSuspended ? () => false : isValidConnection}
            onConnectAttempt={authoringSuspended ? () => {} : (sourceId, targetId) => void onConnect(sourceId, targetId)}
            onNodeDragCommit={authoringSuspended ? undefined : handleNodeDragCommit}
            onNodeDragDaemonDisconnected={authoringSuspended ? undefined : handleNodeDragDaemonDisconnected}
            onNodeHover={(id) => {
              if (authoringSuspended) return;
              setHoveredId(id);
            }}
            onEdgeClick={(id) => {
              if (authoringSuspended) return;
              setSelectedEdgeId(id);
            }}
            onNodeClick={
              missionLike
                ? (id) => {
                    // P2/P3 (design §3.4): node click filters the Feed/History
                    // panel to that actor. Command node maps to the "main"
                    // actor key; agent nodes filter by their own name (the
                    // rollup key) — sources from effectiveActiveArtifactId so
                    // this works identically while browsing history.
                    const isCommandNode = id === effectiveActiveArtifactId;
                    const agentMatch = agents.find((a) => a.id === id);
                    const key = isCommandNode ? "main" : (agentMatch?.name ?? null);
                    if (!key) return;
                    setPanelFilterId((prev) => (prev === key ? null : key));
                  }
                : undefined
            }
            onPaneClick={() => {
              setContextMenu(null);
              setSelectedEdgeId(null);
            }}
            onPaneContextMenu={(x, y) => {
              if (authoringSuspended) return;
              setContextMenu({ x, y });
            }}
          />

          {contextMenu && !authoringSuspended && (
            <GraphCanvasMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onClose={() => setContextMenu(null)}
              onAdd={handleAdd}
              onFitView={fitView}
              disabled={!daemonConnected}
            />
          )}

          {confirmTarget && !authoringSuspended && (confirmTarget.kind === "command" || confirmTarget.kind === "agent") && (
            <div className="absolute right-3 top-3">
              <NodeDeleteConfirm
                artifactName={confirmTarget.name}
                kind={confirmTarget.kind}
                referencingCommands={
                  confirmTarget.kind === "agent" ? referencingCommandsFor(confirmTarget.name) : []
                }
                deleting={deletingId === confirmTarget.id}
                error={deleteError}
                onCancel={() => setConfirmDeleteId(null)}
                onConfirm={() => confirmDeleteNode(confirmTarget)}
              />
            </div>
          )}
        </div>

        {/* Timeline panel (P2: Feed/Raw/Summary tabs — design §3.4/§4/§5;
            RunLogTail's content lives on unchanged as the Raw tab's body).
            P3: while viewing history, sources from historyTimeline/
            historySummary instead — same panel, different input map. */}
        {(missionActive || (run && TERMINAL_RUN_STATUSES.has(run.status) && summary) || viewingHistory) && (
          <div className="w-[320px] shrink-0 border-l border-border-hairline">
            <RunTimelinePanel
              rows={viewingHistory ? historyTimeline : timeline}
              rawLines={rawTail}
              mode={viewingHistory ? (panelMode === "feed" ? "history" : panelMode) : panelMode}
              onModeChange={setPanelMode}
              summary={viewingHistory ? historySummary : summary}
              waiting={!viewingHistory && rawTail.length === 0}
              degraded={viewingHistory ? false : degraded}
              degradedReason={viewingHistory ? null : degradedReason}
              projectId={projectId}
              historyMode={viewingHistory}
              filterOptions={[
                {
                  id: "main",
                  label: effectiveActiveArtifactId
                    ? `/${commandById.get(effectiveActiveArtifactId)?.name ?? "command"}`
                    : "command",
                },
                ...[...runParticipantAgentNames].map((name) => ({ id: name, label: name })),
              ]}
              filterNodeId={panelFilterId}
              onFilter={setPanelFilterId}
              onRowClick={(actor) => {
                if (!actor) return;
                const nodeKey = actor === "main" ? "main" : actor;
                setPulseNodeId(nodeKey);
                setPulseKey((k) => k + 1);
              }}
              onRerun={() => {
                const cmd = effectiveActiveArtifactId ? commandById.get(effectiveActiveArtifactId) : undefined;
                if (cmd) {
                  if (viewingHistory) exitHistory();
                  setRunDialogFor(cmd);
                }
              }}
              onClose={() => setPanelMode(viewingHistory ? "history" : "feed")}
            />
          </div>
        )}
      </div>

      {modalTarget && (
        <EdgeRelationModal
          commandName={commandById.get(modalTarget.commandId)?.name ?? ""}
          agentName={modalTarget.agentName}
          initial={modalTarget.initial}
          onSave={handleModalSave}
          onClose={() => setModalTarget(null)}
        />
      )}

      {runCommandFor && (
        <CopyRunCommandDialog command={runCommandFor} onClose={() => setRunCommandFor(null)} />
      )}

      {runDialogFor && (
        <RunDialog
          command={runDialogFor}
          projectId={projectId}
          projectName={projectName}
          onClose={() => setRunDialogFor(null)}
          onStarted={() => setRunDialogFor(null)}
          onPublish={onPublish}
          publishDialogClosedSignal={publishDialogClosedSignal}
        />
      )}
    </div>
  );
}
