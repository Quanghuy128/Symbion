"use client";

import { useEffect, useState } from "react";
import type { DiffFile, ProjectStore, TargetId } from "@symbion/core";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { callRpc } from "@/lib/rpc/client";
import type { ComputeDiffResult, WriteResult } from "@/lib/rpc/types";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { ConflictResolver } from "./ConflictResolver";
import { PublishResultView } from "./PublishResultView";

export interface PublishDiffViewProps {
  project: ProjectStore;
  targets: TargetId[];
  version: string;
  onBack: () => void;
  onClose: () => void;
}

const STATUS_GLYPH: Record<DiffFile["status"], string> = {
  new: "+",
  update: "~",
  same: "=",
  conflict: "!",
};

/** S11 — Publish diff preview + conflict resolve. Conflicts unchecked, block write until resolved. */
export function PublishDiffView({ project, targets, version, onBack, onClose }: PublishDiffViewProps) {
  const [diff, setDiff] = useState<ComputeDiffResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resolutions, setResolutions] = useState<Record<string, "overwrite" | "keep">>({});
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [result, setResult] = useState<WriteResult | null>(null);
  const [loading, setLoading] = useState(true);
  const daemonConnected = useArtifactStore((s) => s.daemonConnected);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await callRpc<{ projectId: string; targets: TargetId[]; version: string }, ComputeDiffResult>(
        "computeDiff",
        { projectId: project.id, targets, version }
      );
      setDiff(res);
      setSelected(
        new Set(res.files.filter((f) => f.status !== "conflict" && f.status !== "same").map((f) => f.relPath))
      );
      setLoading(false);
    })();
  }, [project.id, targets, version]);

  if (result) {
    return <PublishResultView result={result} version={version} onDone={onClose} />;
  }

  if (loading || !diff) {
    return (
      <Dialog open onClose={onClose} className="w-[720px]">
        <p className="text-sm text-muted-foreground">Đang tính diff…</p>
      </Dialog>
    );
  }

  const hasInitOnNonExisting = diff.files.some((f) => f.status === "new" && f.relPath.startsWith(".claude/"));
  const writableFiles = diff.files.filter((f) => f.status !== "same");
  const nothingToWrite = diff.files.every((f) => f.status === "same");
  // STATE §3.4: first-ever Symbion write into a pre-existing, non-Symbion AGENTS.md.
  const firstForeignMergeFiles = diff.files.filter((f) => f.firstPublishIntoForeignMergedFile);

  function toggle(relPath: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  }

  async function handleWrite() {
    setWriting(true);
    setWriteError(null);
    try {
      const writeResult = await callRpc<
        { projectId: string; version: string; targets: TargetId[]; files: Array<{ relPath: string; resolution?: "overwrite" | "keep" }> },
        WriteResult
      >("write", {
        projectId: project.id,
        version,
        targets,
        files: Array.from(selected).map((relPath) => ({ relPath, resolution: resolutions[relPath] })),
      });
      setResult(writeResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ghi xuống đĩa thất bại — không rõ lý do.";
      setWriteError(message);
    } finally {
      setWriting(false);
    }
  }

  return (
    <Dialog open onClose={onClose} className="w-[720px]">
      <DialogHeader>
        <DialogTitle>Xem trước thay đổi · {version}</DialogTitle>
      </DialogHeader>

      {hasInitOnNonExisting && (
        <p className="mb-2 text-xs text-muted-foreground">Sẽ khởi tạo .claude/</p>
      )}

      {firstForeignMergeFiles.length > 0 && (
        <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
          ℹ {firstForeignMergeFiles.map((f) => f.relPath).join(", ")} đã tồn tại và sẽ được Symbion chỉnh sửa
          lần đầu tiên (nội dung hiện có sẽ được giữ lại bên ngoài vùng quản lý).
        </p>
      )}

      <div className="max-h-96 space-y-2 overflow-y-auto">
        {writableFiles.map((file) =>
          file.status === "conflict" ? (
            <ConflictResolver
              key={file.relPath}
              file={file}
              resolution={resolutions[file.relPath]}
              onResolve={(resolution) => {
                setResolutions((prev) => ({ ...prev, [file.relPath]: resolution }));
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (resolution === "overwrite") next.add(file.relPath);
                  else next.delete(file.relPath);
                  return next;
                });
              }}
            />
          ) : (
            <label key={file.relPath} className="flex items-center gap-2 rounded border border-border px-2 py-1 text-sm">
              <input type="checkbox" checked={selected.has(file.relPath)} onChange={() => toggle(file.relPath)} />
              <span className="font-mono text-xs">{STATUS_GLYPH[file.status]}</span>
              <span>{file.relPath}</span>
            </label>
          )
        )}
        {diff.files
          .filter((f) => f.status === "same")
          .map((file) => (
            <div key={file.relPath} className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground">
              <span className="font-mono text-xs">=</span>
              <span>{file.relPath}</span>
            </div>
          ))}
      </div>

      {!daemonConnected && (
        <p className="mb-2 text-xs text-destructive">⚠ Mất kết nối daemon — không thể ghi xuống đĩa.</p>
      )}
      {writeError && <p className="mb-2 text-xs text-destructive">✗ Ghi thất bại: {writeError}</p>}

      <DialogFooter>
        <Button variant="outline" onClick={onBack}>
          Quay lại
        </Button>
        <Button variant="outline" onClick={onClose}>
          Hủy
        </Button>
        <Button
          disabled={nothingToWrite || selected.size === 0 || writing || !daemonConnected}
          onClick={handleWrite}
        >
          {nothingToWrite ? "Không có gì để ghi" : "Ghi xuống đĩa"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
