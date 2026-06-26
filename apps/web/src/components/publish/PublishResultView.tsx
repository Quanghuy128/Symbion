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
    <Dialog open onClose={onDone} className="w-[520px]">
      <DialogHeader>
        <DialogTitle>Kết quả xuất bản {version}</DialogTitle>
      </DialogHeader>

      <p className="text-sm">
        {created} file tạo mới · {updated} file cập nhật · {errors.length} lỗi
      </p>
      <p className="mt-1 text-xs text-muted-foreground">Sao lưu: {result.backupDir}</p>

      {errors.length > 0 && (
        <ul className="mt-3 space-y-1">
          {errors.map((e) => (
            <li key={e.relPath} className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {e.relPath}: {e.error}
            </li>
          ))}
        </ul>
      )}

      <DialogFooter>
        {errors.length > 0 && <Button variant="outline">Thử lại các file lỗi</Button>}
        <Button onClick={onDone}>Xong</Button>
      </DialogFooter>
    </Dialog>
  );
}
