"use client";

import { Button } from "@/components/ui/button";

export interface EmptyStateProps {
  onCreateProject: () => void;
  onImport: () => void;
}

/** S2 — App empty state (0 projects). Exactly two CTAs. No sidebar/tabs/graph. */
export function EmptyState({ onCreateProject, onImport }: EmptyStateProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-4 rounded-panel border border-border-hairline bg-bg-panel p-8">
        <p className="text-sm text-text-muted">No projects yet</p>
        <p className="text-sm text-text-body">Create a new one or import .claude/</p>
        <div className="flex gap-2">
          <Button onClick={onCreateProject}>+ New project</Button>
          <Button variant="outline" onClick={onImport}>
            ↧ Import existing .claude/
          </Button>
        </div>
      </div>
    </div>
  );
}
