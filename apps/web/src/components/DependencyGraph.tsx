"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
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
import { GraphStatusChips } from "./graph/GraphStatusChips";
import { GraphToolbar } from "./graph/GraphToolbar";
import { GraphCanvasMenu } from "./graph/GraphCanvasMenu";
import { GraphLegend } from "./graph/GraphLegend";
import { GraphHintBar } from "./graph/GraphHintBar";
import { DaemonRibbon } from "./graph/DaemonRibbon";
import { NodeDeleteConfirm } from "./graph/NodeDeleteConfirm";
import { EdgeRelationModal } from "./graph/EdgeRelationModal";
import { CopyRunCommandDialog } from "./CopyRunCommandDialog";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { newArtifact } from "@/lib/newArtifact";
import { hasSeenGraphHint, markGraphHintSeen } from "@/lib/graphHintSeen";

export interface DependencyGraphProps {
  artifacts: CanonicalArtifact[];
  /** ProjectView passes `setEditing` — opens the shared BuilderDrawer for add / edit / create-agent. */
  onEditArtifact: (artifact: CanonicalArtifact) => void;
}

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
function DependencyGraphInner({ artifacts, onEditArtifact }: DependencyGraphProps) {
  const { fitView } = useReactFlow();
  const saveArtifact = useArtifactStore((s) => s.saveArtifact);
  const deleteArtifact = useArtifactStore((s) => s.deleteArtifact);
  const daemonConnected = useArtifactStore((s) => s.daemonConnected);
  const showToast = useArtifactStore((s) => s.showToast);
  const pingNow = useArtifactStore((s) => s.pingNow);

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

  const isValidConnection = useCallback(
    (conn: Connection) => {
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

  const { baseNodes, baseEdges, missingAgentMentions } = useMemo(() => {
    const nodes: Node[] = [
      ...commands.map((c, i) => {
        // Unlinked heuristic (design §5 O, taste-call §9.14, conservative):
        // 0 @name mentions AND a backtick token matching an existing agent name.
        const mentions = extractAgentMentions(c.body);
        const backtickNames = [...c.body.matchAll(/`([A-Za-z0-9_-]+)`/g)].map((m) => m[1] ?? "");
        const unlinked = mentions.length === 0 && backtickNames.some((n) => agentNames.has(n));
        return {
          id: c.id,
          type: "command",
          position: { x: 0, y: i * 80 },
          data: {
            label: `/${c.name}`,
            connectable: daemonConnected,
            daemonConnected,
            unlinked,
            justAdded: c.id === justAddedId,
            onEdit: () => onEditArtifact(c),
            onEditBody: () => onEditArtifact(c),
            onDelete: () => requestDelete(c.id),
            onCopyRun: () => setRunCommandFor(c),
          },
        } satisfies Node;
      }),
      ...agents.map((a, i) => ({
        id: a.id,
        type: "agent",
        position: { x: 320, y: i * 80 },
        data: {
          label: a.name,
          connectable: daemonConnected,
          daemonConnected,
          justAdded: a.id === justAddedId,
          onEdit: () => onEditArtifact(a),
          onDelete: () => requestDelete(a.id),
        },
      })) satisfies Node[],
    ];

    const edges: Edge[] = [];
    const missingNodes = new Map<string, Node>();
    const missingMentions = new Set<string>();
    let missingIndex = 0;
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
              position: { x: 320, y: (agents.length + missingIndex) * 80 },
              data: {
                label: `⚠ ${mention} (does not exist)`,
                name: mention,
                onCreateAgent: handleCreateAgent,
                daemonConnected,
              },
            });
            missingIndex += 1;
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

    return {
      baseNodes: [...nodes, ...missingNodes.values()],
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
  ]);

  // Hover-driven highlight/dim (kept from the read-only original).
  const nodes = useMemo(
    () =>
      baseNodes.map((n) => {
        if (!hoveredId) return n;
        const connected =
          n.id === hoveredId ||
          baseEdges.some(
            (e) => (e.source === hoveredId && e.target === n.id) || (e.target === hoveredId && e.source === n.id)
          );
        return { ...n, data: { ...n.data, highlighted: n.id === hoveredId, dimmed: !connected } };
      }),
    [baseNodes, baseEdges, hoveredId]
  );

  const edges = useMemo(() => {
    const decorated = baseEdges.map((e) => {
      const selected = e.id === selectedEdgeId;
      if (!hoveredId) return selected ? { ...e, data: { ...e.data, selected } } : e;
      const connected = e.source === hoveredId || e.target === hoveredId;
      return { ...e, data: { ...e.data, highlighted: connected, dimmed: !connected, selected } };
    });
    // Ephemeral ghost edge during a pending save (Q) — local only, never in store.
    if (pendingConnection) {
      decorated.push({
        id: `pending-${pendingConnection.source}->${pendingConnection.target}`,
        source: pendingConnection.source,
        target: pendingConnection.target,
        type: "animated",
        data: { pending: true },
      });
    }
    return decorated;
  }, [baseEdges, hoveredId, pendingConnection, selectedEdgeId]);

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

      <div
        style={{ height: 480 }}
        className="relative rounded-panel border border-border-hairline bg-bg-panel"
      >
        <GraphToolbar
          onAdd={handleAdd}
          onFitView={() => fitView({ duration: 250 })}
          onToggleLegend={() => setLegendOpen((o) => !o)}
          disabled={!daemonConnected}
          fitDisabled={artifacts.length === 0}
        />
        <GraphLegend open={legendOpen} onOpenChange={setLegendOpen} />

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={daemonConnected}
          isValidConnection={isValidConnection}
          onConnect={onConnect}
          fitView
          onNodeMouseEnter={(_, node) => setHoveredId(node.id)}
          onNodeMouseLeave={() => setHoveredId(null)}
          onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
          onPaneClick={() => {
            setContextMenu(null);
            setSelectedEdgeId(null);
          }}
          onPaneContextMenu={(e) => {
            e.preventDefault();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setContextMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          }}
        >
          <Background variant={BackgroundVariant.Dots} />
        </ReactFlow>

        {contextMenu && (
          <GraphCanvasMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onAdd={handleAdd}
            onFitView={() => fitView({ duration: 250 })}
            disabled={!daemonConnected}
          />
        )}

        {confirmTarget && (confirmTarget.kind === "command" || confirmTarget.kind === "agent") && (
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
