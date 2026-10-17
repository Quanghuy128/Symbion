"use client";

import { useEffect, useState } from "react";
import type { DiffFile } from "@symbion/core";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";

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
    <Banner
      tone="danger"
      icon={null}
      title={`CONFLICT — ${file.relPath}`}
      className={shouldAnimate ? "animate-popIn" : undefined}
    >
      <p className="mb-2 text-ink-3">The file was hand-edited after the last publish.</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-pressed={resolution !== "overwrite"}
          className={resolution !== "overwrite" ? "bg-surface-active" : undefined}
          onClick={() => onResolve("keep")}
        >
          Keep the on-disk version
        </Button>
        <Button
          size="sm"
          variant={resolution === "overwrite" ? "danger" : "danger-outline"}
          aria-pressed={resolution === "overwrite"}
          onClick={() => onResolve("overwrite")}
        >
          Overwrite
        </Button>
      </div>
    </Banner>
  );
}
