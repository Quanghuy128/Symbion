"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

export interface NodeDeleteConfirmProps {
  artifactName: string;
  kind: "command" | "agent";
  /** command names whose body still @mentions this agent (E4) — empty for commands. */
  referencingCommands: string[];
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * NodeDeleteConfirm (design §4 F, surface F) — anchored confirm popover for a
 * node delete. Copies ProjectView's second-click-confirm ethos. When deleting an
 * agent that commands still reference, shows a `warning` line naming them (E4);
 * confirm is still allowed (no cascade scrub — dangling refs re-derive into
 * MissingAgent nodes). `Đang xoá…` while in-flight; inline error on failure.
 */
export function NodeDeleteConfirm({
  artifactName,
  kind,
  referencingCommands,
  deleting,
  error,
  onCancel,
  onConfirm,
}: NodeDeleteConfirmProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (deleting) return; // don't dismiss mid-delete
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleting) onCancel();
    }
    window.addEventListener("mousedown", onOutside);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onOutside);
      window.removeEventListener("keydown", onEsc);
    };
  }, [onCancel, deleting]);

  const showRefWarning = kind === "agent" && referencingCommands.length > 0;

  return (
    <div
      ref={ref}
      role="dialog"
      className="z-30 w-64 animate-popIn rounded-panel border border-border-menu bg-bg-menu p-3 shadow-dropdown"
    >
      <p className="text-[13px] text-text-body">
        Xoá {kind === "command" ? `/${artifactName}` : artifactName}?
      </p>

      {showRefWarning && (
        <p className="mt-2 text-[11.5px] leading-snug text-warning">
          ⚠ {referencingCommands.length} workflow vẫn tham chiếu {artifactName} —{" "}
          {referencingCommands.join(", ")} sẽ hiện liên kết đỏ.
        </p>
      )}

      {error && <p className="mt-2 text-[11.5px] text-danger">✗ {error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="outline" disabled={deleting} onClick={onCancel}>
          Hủy
        </Button>
        <Button size="sm" variant="destructive" disabled={deleting} onClick={onConfirm}>
          {deleting ? "Đang xoá…" : "Xoá"}
        </Button>
      </div>
    </div>
  );
}
