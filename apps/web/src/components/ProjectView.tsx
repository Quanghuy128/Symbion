"use client";

import { useState } from "react";
import type { CanonicalArtifact, ProjectStore } from "@symbion/core";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RowMenu, ROW_MENU_DIVIDER } from "@/components/ui/row-menu";
import { BuilderDrawer } from "./BuilderDrawer";
import { DependencyGraph } from "./DependencyGraph";
import { PublishDialog } from "./publish/PublishDialog";
import { CopyRunCommandDialog } from "./CopyRunCommandDialog";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { newArtifact } from "@/lib/newArtifact";

export interface ProjectViewProps {
  project: ProjectStore;
}

/** S5 — Project view: Danh sách (list) + Sơ đồ (graph) tabs, publish entry point. */
export function ProjectView({ project }: ProjectViewProps) {
  const [tab, setTab] = useState<"list" | "graph">("list");
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border-hairline px-8 py-5">
        <div>
          <h1 className="text-[23px] font-bold tracking-[-.02em] text-text-strong">{project.name}</h1>
          <p className="font-mono text-[12.5px] text-text-faint">{project.path}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="destructive" size="sm" disabled={!daemonConnected || removing} onClick={handleRemoveProject}>
            {removing ? "Deleting…" : "Delete"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTab(tab === "list" ? "graph" : "list")}>
            {tab === "list" ? "Graph" : "List"}
          </Button>
          <Button size="sm" disabled={!daemonConnected} onClick={() => setPublishing(true)}>
            Publish ▸
          </Button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1000px] flex-1 overflow-y-auto px-8 py-8">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center gap-2">
            <Button onClick={() => setEditing(newArtifact("agent"))}>+ Add agent</Button>
            <Button onClick={() => setEditing(newArtifact("command"))}>+ Add workflow</Button>
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
          <div className="space-y-8">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[10.5px] font-bold uppercase tracking-[.09em] text-text-faint">
                  Workflows / Commands ({commands.length})
                </h2>
                <Button size="sm" variant="outline" onClick={() => setEditing(newArtifact("command"))}>
                  + Add workflow
                </Button>
              </div>
              <ul className="space-y-2">
                {commands.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-panel border border-border-hairline bg-bg-panel px-4 py-3 text-sm"
                  >
                    {confirmDeleteId === c.id ? (
                      <div className="flex items-center justify-between">
                        <span className="text-text-body">Confirm delete /{c.name}?</span>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={cancelDelete}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={deletingId === c.id}
                            onClick={() => confirmDelete(c)}
                          >
                            {deletingId === c.id ? "Deleting…" : "Delete"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(c)}>
                          <span className={c.meta.status === "draft" ? "text-command" : "text-command-hi"}>
                            {c.meta.status === "draft" ? "○" : "●"} /{c.name}
                          </span>{" "}
                          <span className="text-text-muted">{c.description}</span>
                          {c.meta.status === "draft" && (
                            <Badge variant="draft" className="ml-2">
                              draft
                            </Badge>
                          )}
                        </button>
                        <RowMenu
                          open={openMenuId === c.id}
                          onOpenChange={(open) => setOpenMenuId(open ? c.id : null)}
                          items={[
                            { label: "Edit", onSelect: () => setEditing(c) },
                            { label: "Copy run command", onSelect: () => setRunCommandFor(c) },
                            ROW_MENU_DIVIDER,
                            {
                              label: "Delete",
                              danger: true,
                              disabled: !daemonConnected,
                              onSelect: () => requestDelete(c.id),
                            },
                          ]}
                        />
                      </div>
                    )}
                    {deleteErrorId === c.id && deleteError && (
                      <p className="mt-2 text-xs text-danger">✗ Delete failed: {deleteError}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[10.5px] font-bold uppercase tracking-[.09em] text-text-faint">
                  Agents ({agents.length})
                </h2>
                <Button size="sm" variant="outline" onClick={() => setEditing(newArtifact("agent"))}>
                  + Add agent
                </Button>
              </div>
              <ul className="space-y-2">
                {agents.map((a) => (
                  <li key={a.id} className="rounded-panel border border-border-hairline bg-bg-panel px-4 py-3 text-sm">
                    {confirmDeleteId === a.id ? (
                      <div className="flex items-center justify-between">
                        <span className="text-text-body">Confirm delete {a.name}?</span>
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
                      <div className="flex items-center justify-between gap-2">
                        <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(a)}>
                          <span className={a.meta.status === "draft" ? "text-agent" : "text-agent-hi"}>
                            {a.meta.status === "draft" ? "○" : "●"} {a.name}
                          </span>{" "}
                          <span className="text-text-muted">{(a.tools ?? []).join(", ")}</span>
                          {a.meta.status === "draft" && (
                            <Badge variant="draft" className="ml-2">
                              draft
                            </Badge>
                          )}
                        </button>
                        <RowMenu
                          open={openMenuId === a.id}
                          onOpenChange={(open) => setOpenMenuId(open ? a.id : null)}
                          items={[
                            { label: "Edit", onSelect: () => setEditing(a) },
                            ROW_MENU_DIVIDER,
                            {
                              label: "Delete",
                              danger: true,
                              disabled: !daemonConnected,
                              onSelect: () => requestDelete(a.id),
                            },
                          ]}
                        />
                      </div>
                    )}
                    {deleteErrorId === a.id && deleteError && (
                      <p className="mt-2 text-xs text-danger">✗ Delete failed: {deleteError}</p>
                    )}
                  </li>
                ))}
              </ul>
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
