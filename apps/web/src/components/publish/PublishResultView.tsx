"use client";

import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
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

      <DialogBody>
        <p className="flex items-center gap-2 text-ui text-ink">
          <Check size={16} strokeWidth={1.6} aria-hidden className="text-success" /> {created} created · {updated} updated · {errors.length}{" "}
          error(s)
        </p>
        <p className="mt-1 font-mono text-code-sm text-ink-muted">Backup: {result.backupDir}</p>

        {errors.length > 0 && (
          <ul className="mt-3 space-y-2">
            {errors.map((e) => (
              <li key={e.relPath}>
                <Banner tone="danger" icon={null}>
                  {e.relPath}: {e.error}
                </Banner>
              </li>
            ))}
          </ul>
        )}
      </DialogBody>

      <DialogFooter>
        {errors.length > 0 && <Button variant="outline">Retry failed files</Button>}
        <Button onClick={onDone}>Xong</Button>
      </DialogFooter>
    </Dialog>
  );
}
