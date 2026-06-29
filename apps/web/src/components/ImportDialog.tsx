"use client";

import { useState } from "react";
import type { CanonicalArtifact } from "@symbion/core";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImportReviewStep } from "@/components/ImportReviewStep";
import { callRpc } from "@/lib/rpc/client";
import type { ScanClaudeDirResult } from "@/lib/rpc/types";
import { useArtifactStore } from "@/lib/store/useArtifactStore";

export interface ImportDialogProps {
  onClose: () => void;
}

/** S4 — Import .claude/ from a repo: path + scan preview, unparseable files unchecked-by-default. */
export function ImportDialog({ onClose }: ImportDialogProps) {
  const [path, setPath] = useState("");
  const [scanned, setScanned] = useState<ScanClaudeDirResult["parsed"] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [projectName, setProjectName] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createProject = useArtifactStore((s) => s.createProject);
  const importArtifacts = useArtifactStore((s) => s.importArtifacts);
  const loadProjects = useArtifactStore((s) => s.loadProjects);

  async function handleScan() {
    const result = await callRpc<{ path: string }, ScanClaudeDirResult>("scanClaudeDir", { path });
    setScanned(result.parsed);
    setSelected(new Set([...result.parsed.agents, ...result.parsed.commands].map((a) => a.id)));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleImport() {
    if (!scanned) return;
    setImporting(true);
    setError(null);
    let createdProjectName: string | null = null;
    try {
      const project = await createProject(projectName || path.split("/").filter(Boolean).pop() || "imported", path);
      createdProjectName = project.name;
      const all: CanonicalArtifact[] = [...scanned.agents, ...scanned.commands];
      await importArtifacts({
        projectId: project.id,
        selectedIds: Array.from(selected),
        scanned: all,
      });
      await loadProjects();
      onClose();
    } catch (err) {
      const message = (err as Error).message;
      // Partial-failure UX (review §🟡): if createProject already succeeded
      // before importArtifacts threw, the project genuinely exists now —
      // tell the user that instead of letting them retry blindly into
      // "already-a-project".
      setError(
        createdProjectName
          ? `Dự án "${createdProjectName}" đã được tạo nhưng nhập thất bại: ${message}. Mở dự án "${createdProjectName}" trong danh sách bên trái để nhập lại.`
          : message
      );
    } finally {
      setImporting(false);
    }
  }

  const totalSelected = selected.size;

  return (
    <Dialog open onClose={onClose} className="w-[560px]">
      <DialogHeader>
        <DialogTitle>Import .claude/ từ repo</DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        <div className="flex gap-2">
          <Input placeholder="/home/me/code/geochat" value={path} onChange={(e) => setPath(e.target.value)} />
          <Button variant="outline" onClick={handleScan}>
            Quét
          </Button>
        </div>
        <Input placeholder="Tên dự án (tùy chọn)" value={projectName} onChange={(e) => setProjectName(e.target.value)} />

        {scanned && <ImportReviewStep scanned={scanned} selected={selected} onToggle={toggle} />}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Hủy
        </Button>
        <Button disabled={!scanned || totalSelected === 0 || importing} onClick={handleImport}>
          Nhập {totalSelected} mục đã chọn
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
