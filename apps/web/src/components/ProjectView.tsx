"use client";

import { useEffect, useState } from "react";
import type { CanonicalArtifact, ProjectStore } from "@symbion/core";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Kind } from "@/components/ui/kind";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { RowMenu, ROW_MENU_DIVIDER } from "@/components/ui/row-menu";
import { BuilderDrawer } from "./BuilderDrawer";
import { DependencyGraph } from "./DependencyGraph";
import { PublishDialog } from "./publish/PublishDialog";
import { CopyRunCommandDialog } from "./CopyRunCommandDialog";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { useRunStore } from "@/lib/run/useRunStore";
import { newArtifact } from "@/lib/newArtifact";

export interface ProjectViewProps {
  project: ProjectStore;
}

/** S5 — Project view: Danh sách (list) + Sơ đồ (graph) tabs, publish entry point. */
export function ProjectView({ project }: ProjectViewProps) {
  const [tab, setTab] = useState<"list" | "graph">("list");
  // F8 (RunCommandPalette, STATE §18/§19.2 assumption #3): a palette Execute/
  // history selection targets THIS project but the user may currently be on
  // the List tab — auto-switch to Graph so the mission overlay/history
  // popover DependencyGraph is about to fire is actually visible (design §5's
  // "auto-switches to the Graph tab"). Peeks at the pending flags WITHOUT
  // consuming them — DependencyGraph (mounted only once `tab==="graph"`) is
  // still the sole consumer/clearer of both flags.
  const pendingExecuteArtifactId = useRunStore((s) => s.pendingExecuteArtifactId);
  const pendingOpenHistory = useRunStore((s) => s.pendingOpenHistory);
  useEffect(() => {
    if (tab === "graph") return;
    const targetsThisProject =
      (pendingExecuteArtifactId !== null && project.artifacts.some((a) => a.id === pendingExecuteArtifactId)) ||
      pendingOpenHistory;
    if (targetsThisProject) setTab("graph");
  }, [pendingExecuteArtifactId, pendingOpenHistory, project.artifacts, tab]);
  const [editing, setEditing] = useState<CanonicalArtifact | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [runCommandFor, setRunCommandFor] = useState<CanonicalArtifact | null>(null);
  // Bumped every time the Publish dialog closes — RunDialog watches this to
  // re-run its preflight (Defect 3 fix, QA J7's "Publish first" auto-unblock).
  const [publishClosedSignal, setPublishClosedSignal] = useState(0);
  const daemonConnected = useArtifactStore((s) => s.daemonConnected);
  const deleteArtifact = useArtifactStore((s) => s.deleteArtifact);
  const removeProject = useArtifactStore((s) => s.removeProject);
  const showToast = useArtifactStore((s) => s.showToast);

  // PLAN §6.4/§6.6: kept component-local, deliberately NOT in useArtifactStore —
  // ephemeral per-view UI state with no cross-component/cross-route consumer.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Second-click-to-confirm delete step (PLAN §6.4/§6.7) — id of the row
  // currently showing "Xác nhận xoá?" instead of its normal content.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteErrorId, setDeleteErrorId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const agents = project.artifacts.filter((a) => a.kind === "agent");
  const commands = project.artifacts.filter((a) => a.kind === "command");
  const isEmpty = project.artifacts.length === 0;

  async function handleRemoveProject() {
    if (!window.confirm(`Remove "${project.name}" from Symbion? This forgets the project from the list only — no files on disk are deleted. You can re-add the folder anytime.`)) {
      return;
    }
    setRemoving(true);
    try {
      await removeProject(project.id);
      showToast("Project removed from list.", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Remove failed — reason unknown.";
      showToast(message, "error");
    } finally {
      setRemoving(false);
    }
  }

  function requestDelete(id: string) {
    setConfirmDeleteId(id);
    setDeleteErrorId(null);
    setDeleteError(null);
  }

  function cancelDelete() {
    setConfirmDeleteId(null);
  }

  async function confirmDelete(artifact: CanonicalArtifact) {
    setDeletingId(artifact.id);
    setDeleteErrorId(null);
    setDeleteError(null);
    try {
      await deleteArtifact(artifact.id);
      setConfirmDeleteId(null);
      showToast("Deleted.", "success");
    } catch (err) {
      // Never fail silently (CLAUDE.md "never write silently", extended to
      // deletes per PLAN §6.7) — surface inline near the row, same
      // saveError-style local pattern as BuilderDrawer.tsx. Row is NOT
      // removed from the list on failure.
      const message = err instanceof Error ? err.message : "Delete failed — reason unknown.";
      setDeleteErrorId(artifact.id);
      setDeleteError(message);
    } finally {
      setDeletingId(null);
    }
  }

  /** One list row (Kind tile, name, description, draft Badge, row menu) with the
   *  inline second-click delete confirm. Logic is unchanged — presentation only. */
  function renderRow(a: CanonicalArtifact, kind: "workflow" | "agent") {
    const isWorkflow = kind === "workflow";
    const label = isWorkflow ? `/${a.name}` : a.name;
    const secondary = isWorkflow ? a.description : (a.tools ?? []).join(", ");
    return (
      <li key={a.id} className="border-b border-line last:border-b-0">
        {confirmDeleteId === a.id ? (
          <div className="flex items-center justify-between gap-3 px-3 py-3 text-ui">
            <span className="text-ink">
              Confirm delete {isWorkflow ? "/" : ""}
              {a.name}?
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={cancelDelete}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={deletingId === a.id}
                onClick={() => confirmDelete(a)}
              >
                {deletingId === a.id ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-md px-3 transition-colors hover:bg-surface-hover">
            <button className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left" onClick={() => setEditing(a)}>
              <Kind kind={kind} />
              <span className="min-w-0 flex-1">
                <span className={isWorkflow ? "block truncate font-mono text-code text-ink" : "block truncate text-ui text-ink"}>
                  {label}
                </span>
                {secondary ? <span className="block truncate text-caption text-ink-muted">{secondary}</span> : null}
              </span>
              {a.meta.status === "draft" && <Badge variant="draft">draft</Badge>}
            </button>
            <RowMenu
              open={openMenuId === a.id}
              onOpenChange={(open) => setOpenMenuId(open ? a.id : null)}
              items={
                isWorkflow
                  ? [
                      { label: "Edit", onSelect: () => setEditing(a) },
                      { label: "Copy run command", onSelect: () => setRunCommandFor(a) },
                      ROW_MENU_DIVIDER,
                      {
                        label: "Delete",
                        danger: true,
                        disabled: !daemonConnected,
                        onSelect: () => requestDelete(a.id),
                      },
                    ]
                  : [
                      { label: "Edit", onSelect: () => setEditing(a) },
                      ROW_MENU_DIVIDER,
                      {
                        label: "Delete",
                        danger: true,
                        disabled: !daemonConnected,
                        onSelect: () => requestDelete(a.id),
                      },
                    ]
              }
            />
          </div>
        )}
        {deleteErrorId === a.id && deleteError && (
          <p className="px-3 pb-3 text-caption text-danger-text">✗ Delete failed: {deleteError}</p>
        )}
      </li>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-line px-10 py-6">
        <div className="min-w-0">
          <h1 className="truncate font-display text-page-title text-ink">{project.name}</h1>
          <p className="truncate font-mono text-code-sm text-ink-muted">{project.path}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="danger-outline"
            size="sm"
            disabled={!daemonConnected || removing}
            onClick={handleRemoveProject}
          >
            {removing ? "Deleting…" : "Delete"}
          </Button>
          <SegmentedControl
            aria-label="View"
            size="sm"
            value={tab}
            onValueChange={setTab}
            options={[
              { value: "list", label: "List" },
              { value: "graph", label: "Graph" },
            ]}
          />
          <Button size="sm" icon={Upload} disabled={!daemonConnected} onClick={() => setPublishing(true)}>
            Publish
          </Button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-content-wide flex-1 overflow-y-auto px-10 py-10">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center gap-2">
            <Button icon={Plus} onClick={() => setEditing(newArtifact("command"))}>
              Add workflow
            </Button>
            <Button variant="outline" icon={Plus} onClick={() => setEditing(newArtifact("agent"))}>
              Add agent
            </Button>
          </div>
        ) : tab === "graph" ? (
          <DependencyGraph
            artifacts={project.artifacts}
            onEditArtifact={setEditing}
            projectId={project.id}
            projectName={project.name}
            onPublish={() => setPublishing(true)}
            publishDialogClosedSignal={publishClosedSignal}
          />
        ) : (
          <div className="space-y-10">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-overline uppercase text-ink-muted">Workflows / Commands ({commands.length})</h2>
                <Button size="sm" variant="outline" icon={Plus} onClick={() => setEditing(newArtifact("command"))}>
                  Add workflow
                </Button>
              </div>
              <ul className="border-t border-line">{commands.map((c) => renderRow(c, "workflow"))}</ul>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-overline uppercase text-ink-muted">Agents ({agents.length})</h2>
                <Button size="sm" variant="outline" icon={Plus} onClick={() => setEditing(newArtifact("agent"))}>
                  Add agent
                </Button>
              </div>
              <ul className="border-t border-line">{agents.map((a) => renderRow(a, "agent"))}</ul>
            </section>
          </div>
        )}
      </div>

      {editing && (
        <BuilderDrawer artifact={editing} allArtifacts={project.artifacts} onClose={() => setEditing(null)} />
      )}
      {publishing && (
        <PublishDialog
          project={project}
          onClose={() => {
            setPublishing(false);
            // Bumps a signal RunDialog watches to re-run preflight (Defect 3 /
            // QA J7 — the inline "Publish first" sub-flow left the dialog's
            // preflight frozen at its stale pre-publish blocked state).
            // Re-fetching on plain Cancel too is harmless (idempotent read-only
            // RPC) and simpler than threading a separate success-only signal.
            setPublishClosedSignal((n) => n + 1);
          }}
        />
      )}
      {runCommandFor && (
        <CopyRunCommandDialog command={runCommandFor} onClose={() => setRunCommandFor(null)} />
      )}
    </div>
  );
}
