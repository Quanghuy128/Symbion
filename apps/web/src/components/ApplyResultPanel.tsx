"use client";

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
      <p className="text-sm text-green-600">✓ Applied</p>
      {wasRenamed ? (
        <p className="text-sm">
          Added to project &quot;{projectName}&quot; as &quot;{finalName}&quot; (name collided with an existing
          one, so it was auto-renamed to avoid overwriting).
        </p>
      ) : (
        <p className="text-sm">
          &quot;{finalName}&quot; was added to project &quot;{projectName}&quot; as a draft.
        </p>
      )}
      <p className="text-xs text-muted-foreground">Status: draft — nothing written to the repo yet.</p>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={onOpenProject}>Open project →</Button>
      </div>
    </div>
  );
}
