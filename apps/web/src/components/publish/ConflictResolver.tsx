"use client";

import { useRef } from "react";
import type { DiffFile } from "@symbion/core";
import { Button } from "@/components/ui/button";

export interface ConflictResolverProps {
  file: DiffFile;
  resolution?: "overwrite" | "keep";
  onResolve: (resolution: "overwrite" | "keep") => void;
}

/**
 * Per-conflict-file resolver row: Giữ bản trên đĩa (default, safest) / Ghi đè.
 * `hasRevealedRef` guards the popIn expand animation to first-mount only —
 * per PLAN §6.4/§6.9 step 4b, re-toggling Keep/Overwrite must not replay it.
 * A ref (not state) is deliberate: reading/flipping it must not itself
 * trigger a re-render, and the flag only needs to be correct for the CURRENT
 * render's className decision, computed once per mount via lazy init.
 */
export function ConflictResolver({ file, resolution, onResolve }: ConflictResolverProps) {
  const hasRevealedRef = useRef(false);
  const shouldAnimate = !hasRevealedRef.current;
  hasRevealedRef.current = true;

  return (
    <div
      className={`rounded-panel border border-danger/40 bg-danger/5 p-2 text-xs ${
        shouldAnimate ? "animate-popIn" : ""
      }`}
    >
      <p className="mb-1 font-medium text-danger">! XUNG ĐỘT — {file.relPath}</p>
      <p className="mb-2 text-text-muted">File đã bị sửa tay sau lần xuất bản gần nhất.</p>
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
          className={resolution === "overwrite" ? "bg-overwrite-btn hover:opacity-90" : undefined}
          onClick={() => onResolve("overwrite")}
        >
          Ghi đè
        </Button>
      </div>
    </div>
  );
}
