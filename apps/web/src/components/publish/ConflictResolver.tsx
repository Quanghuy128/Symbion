"use client";

import type { DiffFile } from "@symbion/core";
import { Button } from "@/components/ui/button";

export interface ConflictResolverProps {
  file: DiffFile;
  resolution?: "overwrite" | "keep";
  onResolve: (resolution: "overwrite" | "keep") => void;
}

/** Per-conflict-file resolver row: Giữ bản trên đĩa (default, safest) / Ghi đè / Xem diff. */
export function ConflictResolver({ file, resolution, onResolve }: ConflictResolverProps) {
  return (
    <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs">
      <p className="mb-1 font-medium text-destructive">! XUNG ĐỘT — {file.relPath}</p>
      <p className="mb-2 text-muted-foreground">File đã bị sửa tay sau lần xuất bản gần nhất.</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={resolution !== "overwrite" ? "default" : "outline"}
          onClick={() => onResolve("keep")}
        >
          Giữ bản trên đĩa
        </Button>
        <Button
          size="sm"
          variant={resolution === "overwrite" ? "default" : "outline"}
          onClick={() => onResolve("overwrite")}
        >
          Ghi đè
        </Button>
      </div>
    </div>
  );
}
