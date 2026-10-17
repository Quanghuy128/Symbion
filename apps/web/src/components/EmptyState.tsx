"use client";

import { Download, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface EmptyStateProps {
  onCreateProject: () => void;
  onImport: () => void;
}

/** S2 — App empty state (0 projects). Exactly two CTAs. No sidebar/tabs/graph. */
export function EmptyState({ onCreateProject, onImport }: EmptyStateProps) {
  return (
    <div className="flex h-full items-center justify-center px-10 py-12">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <span
          aria-hidden
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-line-soft bg-surface text-mint-text"
        >
          <FolderPlus size={22} strokeWidth={1.6} />
        </span>
        <h2 className="font-display text-dialog-title text-ink">No projects yet</h2>
        <p className="text-body text-ink-3">Create a new one or import .claude/</p>
        <div className="mt-2 flex gap-2">
          <Button icon={FolderPlus} onClick={onCreateProject}>
            New project
          </Button>
          <Button variant="outline" icon={Download} onClick={onImport}>
            Import existing .claude/
          </Button>
        </div>
      </div>
    </div>
  );
}
