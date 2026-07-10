"use client";

import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { WriteResult } from "@/lib/rpc/types";

export interface PublishResultViewProps {
  result: WriteResult;
  version: string;
  onDone: () => void;
}

/** S12 — Publish result: created/updated/skipped/errors + backupDir. Retry-failed for E10. */
export function PublishResultView({ result, version, onDone }: PublishResultViewProps) {
  const created = result.results.filter((r) => r.action === "created").length;
  const updated = result.results.filter((r) => r.action === "updated").length;
  const errors = result.results.filter((r) => r.action === "error");

  return (
    <Dialog open onClose={onDone} className="w-[500px]">
      <DialogHeader>
        <DialogTitle>Publish result {version}</DialogTitle>
      </DialogHeader>

      <p className="text-sm text-text-body">
        <span className="text-success">✓</span> {created} created · {updated} updated · {errors.length}{" "}
        error(s)
      </p>
      <p className="mt-1 font-mono text-xs text-text-faint">Backup: {result.backupDir}</p>

      {errors.length > 0 && (
        <ul className="mt-3 space-y-1">
          {errors.map((e) => (
            <li key={e.relPath} className="rounded-panel bg-danger/10 px-2 py-1 text-xs text-danger">
              {e.relPath}: {e.error}
            </li>
          ))}
        </ul>
      )}

      <DialogFooter>
        {errors.length > 0 && <Button variant="outline">Retry failed files</Button>}
        <Button onClick={onDone}>Xong</Button>
      </DialogFooter>
    </Dialog>
  );
}
