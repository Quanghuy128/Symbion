"use client";

import { useEffect, useState } from "react";
import type { DiffFile, ProjectStore, TargetId } from "@symbion/core";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Checkbox } from "@/components/ui/checkbox";
import { callRpc } from "@/lib/rpc/client";
import type { ComputeDiffResult, WriteResult } from "@/lib/rpc/types";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { ConflictResolver } from "./ConflictResolver";
import { PublishResultView } from "./PublishResultView";
import { StaggeredReveal } from "@/components/ui/staggered-reveal";

export interface PublishDiffViewProps {
  project: ProjectStore;
  targets: TargetId[];
  version: string;
  onBack: () => void;
  onClose: () => void;
}

// State words (not glyphs) carry each file's status — colour is never the only signal.
const STATUS_BADGE: Record<DiffFile["status"], { label: string; variant: BadgeVariant }> = {
  new: { label: "New", variant: "success" },
  update: { label: "Updated", variant: "warning" },
  same: { label: "Unchanged", variant: "plain" },
  conflict: { label: "Conflict", variant: "danger" },
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
      <Dialog open onClose={onClose} className="w-[640px]">
        <p className="text-ui text-ink-muted">Computing diff…</p>
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
      const message = err instanceof Error ? err.message : "Writing to disk failed — reason unknown.";
      setWriteError(message);
    } finally {
      setWriting(false);
    }
  }

  const rows = [
    ...writableFiles.map((file) =>
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
        <label
          key={file.relPath}
          className="flex items-center gap-3 rounded-md border border-line px-3 py-2 text-ui text-ink"
        >
          <Checkbox checked={selected.has(file.relPath)} onChange={() => toggle(file.relPath)} />
          <span className="min-w-0 flex-1 truncate font-mono text-code">{file.relPath}</span>
          <Badge variant={STATUS_BADGE[file.status].variant}>{STATUS_BADGE[file.status].label}</Badge>
        </label>
      )
    ),
    ...diff.files
      .filter((f) => f.status === "same")
      .map((file) => (
        <div key={file.relPath} className="flex items-center gap-3 px-3 py-2 text-ui text-ink-muted">
          <span className="min-w-0 flex-1 truncate font-mono text-code">{file.relPath}</span>
          <Badge variant={STATUS_BADGE.same.variant}>{STATUS_BADGE.same.label}</Badge>
        </div>
      )),
  ];

  return (
    <Dialog open onClose={onClose} className="w-[640px]">
      <DialogHeader>
        <DialogTitle>Preview changes · {version}</DialogTitle>
      </DialogHeader>

      {hasInitOnNonExisting && (
        <p className="mb-2 text-caption text-ink-muted">Will initialize .claude/</p>
      )}

      {firstForeignMergeFiles.length > 0 && (
        <Banner tone="warning" className="mb-2">
          {firstForeignMergeFiles.map((f) => f.relPath).join(", ")} already exist and will be edited by Symbion
          for the first time (existing content is kept outside the managed region).
        </Banner>
      )}

      <div className="max-h-96 space-y-2 overflow-y-auto">
        <StaggeredReveal>{rows}</StaggeredReveal>
      </div>

      {!daemonConnected && (
        <Banner tone="danger" className="mt-3">
          Daemon disconnected — cannot write to disk.
        </Banner>
      )}
      {writeError && (
        <Banner tone="danger" className="mt-3">
          Write failed: {writeError}
        </Banner>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="lg"
          disabled={nothingToWrite || selected.size === 0 || writing || !daemonConnected}
          onClick={handleWrite}
        >
          {nothingToWrite ? "Nothing to write" : "Write to disk"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
