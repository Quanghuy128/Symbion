"use client";

import { useState } from "react";
import type { CanonicalArtifact } from "@symbion/core";
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImportReviewStep } from "@/components/ImportReviewStep";
import { FileTreePicker, type PickedEntry, type PickedRole } from "@/components/FileTreePicker";
import { applyPickedRole, basenameOf, surfaceImportOutcome } from "@/components/importPickerShared";
import { callRpc } from "@/lib/rpc/client";
import type { ImportTreeNode, ListTreeResult, ScanClaudeDirResult } from "@/lib/rpc/types";
import { useArtifactStore } from "@/lib/store/useArtifactStore";

export interface ImportDialogProps {
  onClose: () => void;
}

/** S4 — Import .claude/ from a repo: path + scan preview, unparseable files unchecked-by-default.
 *  Now also hosts the manual file-picker escape hatch (skipped-file reclassify + full tree). */
export function ImportDialog({ onClose }: ImportDialogProps) {
  const [path, setPath] = useState("");
  const [scanned, setScanned] = useState<ScanClaudeDirResult["parsed"] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [projectName, setProjectName] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual-file-picker state (transient — discarded on close, PLAN §6). Owned
  // here, same rule as `selected`. Keyed by relPath.
  const [picked, setPicked] = useState<Map<string, PickedEntry>>(new Map());
  // Keyed by relPath (NOT artifactId) so a role change on the same row replaces
  // its prior artifact in ONE functional update — no stale-closure read of the
  // old `picked` map (resolves /review BLOCKING: stale-closure artifact leak).
  const [pickedArtifacts, setPickedArtifacts] = useState<Map<string, CanonicalArtifact>>(new Map());
  const [tree, setTree] = useState<ListTreeResult | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);

  const createProjectAndImport = useArtifactStore((s) => s.createProjectAndImport);
  const loadProjects = useArtifactStore((s) => s.loadProjects);
  const showToast = useArtifactStore((s) => s.showToast);

  async function handleScan() {
    const result = await callRpc<{ path: string }, ScanClaudeDirResult>("scanClaudeDir", { path });
    setScanned(result.parsed);
    setSelected(new Set([...result.parsed.agents, ...result.parsed.commands].map((a) => a.id)));
    // reset any prior manual-pick state on a fresh scan.
    setPicked(new Map());
    setPickedArtifacts(new Map());
    setTree(null);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Assign a role to a file (either a skipped-scan row or a tree node). Runs
   *  the shared read→classify path and stashes the artifact + warning. */
  async function assignRole(relPath: string, basename: string, role: PickedRole) {
    const trimmedPath = path.trim();
    const { entry, artifact } = await applyPickedRole(trimmedPath, relPath, basename, role);

    setPicked((prev) => {
      const next = new Map(prev);
      if (role === "ignore") next.delete(relPath);
      else next.set(relPath, entry);
      return next;
    });
    setPickedArtifacts((prev) => {
      const next = new Map(prev);
      // Map is keyed by relPath, so setting/deleting this relPath fully replaces
      // any prior artifact for the SAME row — no read of the (possibly stale)
      // `picked` closure. Fixes the rapid Agent→Command→Agent leak.
      if (artifact) next.set(relPath, artifact);
      else next.delete(relPath);
      return next;
    });
  }

  function reclassifySkipped(relPath: string, role: PickedRole) {
    void assignRole(relPath, basenameOf(relPath), role);
  }

  function onTreeRoleChange(node: ImportTreeNode, role: PickedRole) {
    void assignRole(node.relPath, node.name, role);
  }

  async function handleBrowseManually() {
    const trimmedPath = path.trim();
    if (!trimmedPath) return;
    setTreeLoading(true);
    setError(null);
    try {
      const result = await callRpc<{ root: string }, ListTreeResult>("listTree", { root: trimmedPath });
      setTree(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTreeLoading(false);
    }
  }

  async function handleImport() {
    if (!scanned) return;
    setImporting(true);
    setError(null);
    try {
      const picks = [...pickedArtifacts.values()];
      const all: CanonicalArtifact[] = [...scanned.agents, ...scanned.commands, ...picks];
      const pickedIds = picks.map((a) => a.id);
      // B3a: ONE atomic create-or-adopt + import RPC. A mid-flow failure leaves
      // NO half-created project (daemon rolls back a freshly-created one), so the
      // old "project was created but import failed, open it to retry" copy is gone
      // — a failure now means nothing was left behind.
      const result = await createProjectAndImport({
        name: projectName || path.split("/").filter(Boolean).pop() || "imported",
        path,
        selectedIds: [...Array.from(selected), ...pickedIds],
        scanned: all,
      });
      await loadProjects();
      surfaceImportOutcome(result.renames, result.blocked, showToast);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  const totalSelected = selected.size + pickedArtifacts.size;

  return (
    <Dialog open onClose={onClose} className="w-[560px]">
      <DialogHeader>
        <DialogTitle>Import .claude/ from a repo</DialogTitle>
      </DialogHeader>

      <DialogBody className="space-y-3">
        <div className="flex gap-2">
          <Input placeholder="/home/me/code/geochat" value={path} onChange={(e) => setPath(e.target.value)} />
          <Button variant="outline" onClick={handleScan}>
            Scan
          </Button>
        </div>
        <Input placeholder="Project name (optional)" value={projectName} onChange={(e) => setProjectName(e.target.value)} />

        {scanned && (
          <ImportReviewStep
            scanned={scanned}
            selected={selected}
            onToggle={toggle}
            picked={picked}
            onReclassify={reclassifySkipped}
            onBrowseManually={handleBrowseManually}
          />
        )}

        {treeLoading && <p className="text-xs text-text-muted">Scanning folder tree…</p>}
        {tree && <FileTreePicker tree={tree} picked={picked} onRoleChange={onTreeRoleChange} />}

        {error && <p className="text-xs text-danger">{error}</p>}
      </DialogBody>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!scanned || totalSelected === 0 || importing} onClick={handleImport}>
          Import {totalSelected} selected
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
