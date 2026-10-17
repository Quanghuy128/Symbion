"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ApplyResultPanelProps {
  projectName: string;
  finalName: string;
  wasRenamed: boolean;
  onOpenProject: () => void;
  onClose: () => void;
}

/** ApplyResultPanel — T4 success confirmation, the only feedback mechanism
 * for the auto-suffix collision policy (no separate overwrite-confirmation
 * dialog, per templates-marketplace THINK #4). */
export function ApplyResultPanel({ projectName, finalName, wasRenamed, onOpenProject, onClose }: ApplyResultPanelProps) {
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-ui text-success">
        <Check size={16} strokeWidth={1.6} aria-hidden /> Applied
      </p>
      {wasRenamed ? (
        <p className="text-ui">
          Added to project &quot;{projectName}&quot; as &quot;{finalName}&quot; (name collided with an existing
          one, so it was auto-renamed to avoid overwriting).
        </p>
      ) : (
        <p className="text-ui">
          &quot;{finalName}&quot; was added to project &quot;{projectName}&quot; as a draft.
        </p>
      )}
      <p className="text-caption text-ink-muted">Status: draft — nothing written to the repo yet.</p>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button onClick={onOpenProject}>Open project →</Button>
      </div>
    </div>
  );
}
