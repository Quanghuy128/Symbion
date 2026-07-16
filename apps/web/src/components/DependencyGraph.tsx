"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ADAPTERS,
  extractAgentMentions,
  parseAgentBlock,
  removeAgentRef,
  upsertAgentRef,
  type AgentRef,
  type CanonicalArtifact,
} from "@symbion/core";
import { CommandNode } from "./graph/CommandNode";
import { AgentNode } from "./graph/AgentNode";
import { MissingAgentNode } from "./graph/MissingAgentNode";
import { AnimatedEdge } from "./graph/AnimatedEdge";
import { computeLayout } from "./graph/computeLayout";
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

const edgeTypes = {
  animated: AnimatedEdge,
};

interface ModalTarget {
  commandId: string;
  agentName: string;
  initial?: AgentRef;
}

/**
 * S6 — dependency graph (React Flow). Interactive authoring surface
 * (interactive-graph feature): drag command→agent to link (`@name`), `+` edge
 * modal for count/goal, edge delete, add/edit/delete nodes, missing-agent →
 * create. Nodes/edges stay DERIVED from `artifacts` (E10 — never mirrored into
 * useNodesState/useEdgesState); only ephemeral UI + the pending-ghost edge are
 * component-local. Layout stays auto (nodesDraggable=false, D1 deferred).
 */
function DependencyGraphInner({
  artifacts,
  onEditArtifact,
  projectId,
  projectName,
  onPublish,
  publishDialogClosedSignal,
}: DependencyGraphProps) {
  const { fitView } = useReactFlow();
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
  // Authoring suspends for the whole graph while a run is active (design §0/§5) —
  // resumes immediately once the run leaves the non-terminal set.
  const authoringSuspended = missionActive;

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
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const agents = useMemo(() => artifacts.filter((a) => a.kind === "agent"), [artifacts]);
  const commands = useMemo(() => artifacts.filter((a) => a.kind === "command"), [artifacts]);
  const agentByName = useMemo(() => new Map(agents.map((a) => [a.name, a])), [agents]);
  const agentNames = useMemo(() => new Set(agents.map((a) => a.name)), [agents]);
  const commandById = useMemo(() => new Map(commands.map((c) => [c.id, c])), [commands]);
  const artifactById = useMemo(() => new Map(artifacts.map((a) => [a.id, a])), [artifacts]);

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
    async (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      const command = commandById.get(conn.source);
      const target = artifactById.get(conn.target);
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

  // @xyflow/react v12 widened isValidConnection's param type to `Edge | Connection`
  // (previously `Connection` only) — both shapes carry `.source`/`.target` as the
  // fields this callback actually reads, so the check logic itself is unchanged.
  const isValidConnection = useCallback(
    (conn: Edge | Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return false;
      const src = artifactById.get(conn.source);
      const tgt = artifactById.get(conn.target);
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

  // Run-engine participant set (design §3.4/§4): the executing command + its
  // reachable agents (by @mention) glow/stay full-opacity; everything else
  // dims to 35%. Empty when no run is active — additive, zero-cost otherwise.
  const runParticipantAgentNames = useMemo(() => {
    if (!missionActive || !activeArtifactId) return new Set<string>();
    const activeCommand = commands.find((c) => c.id === activeArtifactId);
    return activeCommand ? new Set(extractAgentMentions(activeCommand.body)) : new Set<string>();
  }, [missionActive, activeArtifactId, commands]);

  const { baseNodes, baseEdges, missingAgentMentions } = useMemo(() => {
    // Phase (a) BUILD SHAPE — same data-bag construction as before; `position`
    // is a placeholder here and gets overwritten in Phase (c) MERGE below
    // (PLAN §3). Every other field is untouched.
    const nodes: Node[] = [
      ...commands.map((c) => {
        // Unlinked heuristic (design §5 O, taste-call §9.14, conservative):
        // 0 @name mentions AND a backtick token matching an existing agent name.
        const mentions = extractAgentMentions(c.body);
        const backtickNames = [...c.body.matchAll(/`([A-Za-z0-9_-]+)`/g)].map((m) => m[1] ?? "");
        const unlinked = mentions.length === 0 && backtickNames.some((n) => agentNames.has(n));

        // Run engine v1 (P1) — additive data-bag only (design §4's CommandNodeData
        // diff): runStatus/runParticipant/onExecute/executeDisabledReason.
        const isRunning = c.id === activeArtifactId;
        const runStatus = missionActive ? (isRunning ? "active" : undefined) : undefined;
        const runParticipant = missionActive ? isRunning : true;
        const executeDisabledReason = !daemonConnected
          ? "Daemon offline"
          : missionActive
            ? "A run is already active — view the running command"
            : undefined;

        // P2: the command's roll-up badge (own + Σ agents) — nodeRunData's
        // "main" bucket. Only present while this command is the executing one.
        const mainData = isRunning ? nodeRunData.get("main") : undefined;
        const badge = mainData
          ? {
              fresh: mainData.totalFresh,
              costUsd: mainData.costUsd,
              breakdown: mainData.breakdown,
              live: missionActive,
              degraded,
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
        } satisfies Node;
      }),
      ...agents.map((a) => {
        const runParticipant = missionActive ? runParticipantAgentNames.has(a.name) : true;
        const dispatched = missionActive && runParticipant;
        const agentData = dispatched ? nodeRunData.get(a.name) : undefined;
        // "working" while the run is active and this agent has been dispatched
        // (its bucket exists in nodeRunData with >0 own tokens, or the run is
        // still streaming — before any tokens arrive the badge simply shows
        // "—" per NodeTokenBadge's own pre-first-event contract); "settled"
        // once the mission ends (terminal) for a participant that DID run.
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
              degraded,
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
        } satisfies Node;
      }),
    ];

    const edges: Edge[] = [];
    const missingNodes = new Map<string, Node>();
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
          type: "animated",
          animated: !targetAgent,
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

    // Phase (b) LAYOUT — synchronous dagre call over fixed-estimate node
    // dimensions (PLAN §4.1: real components auto-size, so a conservative
    // constant estimate feeds dagre without a second measure-then-relayout
    // pass, which would break the E10 pure-derivation invariant).
    const dimensions = allNodes.map((n) => ({
      id: n.id,
      width: n.type === "missingAgent" ? MISSING_AGENT_NODE_WIDTH : NODE_WIDTH,
      height: NODE_HEIGHT,
    }));
    const edgePairs = edges.map((e) => ({ source: e.source, target: e.target }));
    const positions = computeLayout(dimensions, edgePairs);

    // Phase (c) MERGE — only `position` is replaced; every other field
    // (the whole `data` bag) is preserved exactly as built in Phase (a).
    const laidOutNodes = allNodes.map((n) => ({
      ...n,
      position: positions.get(n.id) ?? n.position,
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
    onEditArtifact,
    handleEdgeDelete,
    authoringSuspended,
    missionActive,
    activeArtifactId,
    runParticipantAgentNames,
    nodeRunData,
    degraded,
    pulseNodeId,
    pulseKey,
  ]);

  // Hover-driven highlight/dim (kept from the read-only original). Suspended
  // during a mission — participant/non-participant dim (design §3.4) is the
  // only dim signal while a run is active; hover authoring cues stay off.
  const nodes = useMemo(
    () =>
      baseNodes.map((n) => {
        if (missionActive) {
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
    [baseNodes, baseEdges, hoveredId, missionActive]
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
      // until Close): tint edges that participated as "settled" rather than
      // snapping back to the plain authoring dim (design §3.5's "flow stops,
      // stroke stays tinted 60% until run end").
      if (run && TERMINAL_RUN_STATUSES.has(run.status) && activeArtifactId) {
        const targetAgentName = agents.find((a) => a.id === e.target)?.name ?? "";
        const wasParticipant = e.source === activeArtifactId && runParticipantAgentNames.has(targetAgentName);
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
        type: "animated",
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
            onFitView={() => fitView({ duration: 250 })}
            onToggleLegend={() => setLegendOpen((o) => !o)}
            disabled={!daemonConnected || authoringSuspended}
            fitDisabled={artifacts.length === 0}
          />
          <GraphLegend open={legendOpen} onOpenChange={setLegendOpen} />

          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={daemonConnected && !authoringSuspended}
            isValidConnection={authoringSuspended ? () => false : isValidConnection}
            onConnect={authoringSuspended ? undefined : onConnect}
            fitView
            onNodeMouseEnter={authoringSuspended ? undefined : (_, node) => setHoveredId(node.id)}
            onNodeMouseLeave={authoringSuspended ? undefined : () => setHoveredId(null)}
            onEdgeClick={authoringSuspended ? undefined : (_, edge) => setSelectedEdgeId(edge.id)}
            onNodeClick={
              missionActive
                ? (_, node) => {
                    // P2 (design §3.4): node click filters the Feed panel to
                    // that actor. Command node maps to the "main" actor key;
                    // agent nodes filter by their own name (the rollup key).
                    const isCommandNode = node.id === activeArtifactId;
                    const agentMatch = agents.find((a) => a.id === node.id);
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
            onPaneContextMenu={(e) => {
              e.preventDefault();
              if (authoringSuspended) return;
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setContextMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            }}
          >
            <Background variant={BackgroundVariant.Dots} />
          </ReactFlow>

          {contextMenu && !authoringSuspended && (
            <GraphCanvasMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onClose={() => setContextMenu(null)}
              onAdd={handleAdd}
              onFitView={() => fitView({ duration: 250 })}
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
            RunLogTail's content lives on unchanged as the Raw tab's body). */}
        {(missionActive || (run && TERMINAL_RUN_STATUSES.has(run.status) && summary)) && (
          <div className="w-[320px] shrink-0 border-l border-border-hairline">
            <RunTimelinePanel
              rows={timeline}
              rawLines={rawTail}
              mode={panelMode}
              onModeChange={setPanelMode}
              summary={summary}
              waiting={rawTail.length === 0}
              degraded={degraded}
              degradedReason={degradedReason}
              filterOptions={[
                { id: "main", label: activeArtifactId ? `/${commandById.get(activeArtifactId)?.name ?? "command"}` : "command" },
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
                const cmd = activeArtifactId ? commandById.get(activeArtifactId) : undefined;
                if (cmd) setRunDialogFor(cmd);
              }}
              onClose={() => setPanelMode("feed")}
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

export function DependencyGraph(props: DependencyGraphProps) {
  return (
    <ReactFlowProvider>
      <DependencyGraphInner {...props} />
    </ReactFlowProvider>
  );
}
