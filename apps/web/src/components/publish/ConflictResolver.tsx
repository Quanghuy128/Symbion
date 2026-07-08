"use client";

import { useEffect, useState } from "react";
import type { DiffFile } from "@symbion/core";
import { Button } from "@/components/ui/button";

export interface ConflictResolverProps {
  file: DiffFile;
  resolution?: "overwrite" | "keep";
  onResolve: (resolution: "overwrite" | "keep") => void;
}

/**
 * Per-conflict-file resolver row: Giữ bản trên đĩa (default, safest) / Ghi đè.
 * `shouldAnimate` guards the popIn expand animation to first-mount only —
 * per PLAN §6.4/§6.9 step 4b, re-toggling Keep/Overwrite must not replay it.
 * Implemented as state (lazily initialized to `true`, flipped to `false` in
 * an effect after mount) rather than mutating a ref during the render body —
 * mutating a ref during render flips it on React 18 Strict Mode's dev-only
 * double-invocation before the real mount runs, silently skipping the
 * animation in dev (code-reviewer finding, /review pass).
 */
export function ConflictResolver({ file, resolution, onResolve }: ConflictResolverProps) {
  const [shouldAnimate, setShouldAnimate] = useState(() => true);
  useEffect(() => {
    setShouldAnimate(false);
  }, []);

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
