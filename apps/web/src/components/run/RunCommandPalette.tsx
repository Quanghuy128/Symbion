"use client";

import { History, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CanonicalArtifact } from "@symbion/core";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { useRunStore } from "@/lib/run/useRunStore";

export interface RunCommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/**
 * RunCommandPalette — the minimal ⌘K palette (F8, STATE §18.1). Two sections
 * ONLY (F8's explicit, non-negotiable scope limit — EDGE-4): "Execute" (one
 * row per PUBLISHED command in the CURRENTLY OPEN project — selecting one
 * opens the SAME RunDialog the node ⋯ menu opens, no parallel Execute path)
 * and "Run history" (one row, reuses the same history mechanism the toolbar
 * 🕘 icon opens). Hand-rolled, no `cmdk`/fuzzy-match dependency (A22, matches
 * A8's precedent). Typing filters Execute by substring only.
 *
 * Explicitly NOT included (scope-creep guard, testplan §7.3 J42): no agent
 * execution, no settings navigation, no project switching, no generic
 * "go to" navigation, no recent-files, no fuzzy scoring. If a future change
 * adds any of these here, that is scope creep against F8's letter.
 */
export function RunCommandPalette({ open, onClose }: RunCommandPaletteProps) {
  const router = useRouter();
  const currentProject = useArtifactStore((s) => s.currentProject);
  const requestExecute = useRunStore((s) => s.requestExecute);
  const requestOpenHistory = useRunStore((s) => s.requestOpenHistory);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const commands = useMemo<CanonicalArtifact[]>(() => {
    if (!currentProject) return [];
    return currentProject.artifacts.filter((a) => a.kind === "command" && a.meta.status === "published");
  }, [currentProject]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return commands;
    return commands.filter((c) => c.name.toLowerCase().includes(q));
  }, [commands, query]);

  if (!open) return null;

  function selectExecute(artifactId: string) {
    requestExecute(artifactId);
    // Auto-switch to the Graph tab if elsewhere (design §5's keyboard note) —
    // DependencyGraph/ProjectView consume `pendingExecuteArtifactId` on mount.
    router.push("/");
    onClose();
  }

  function selectHistory() {
    requestOpenHistory();
    router.push("/");
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-dialog flex items-start justify-center bg-overlay pt-[15vh]"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-[480px] animate-popIn overflow-hidden rounded-xl bg-surface shadow-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <input
          autoFocus
          placeholder={currentProject ? `Execute /<name>… or "history"` : "Open a project to execute a command"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full border-b border-line bg-transparent px-4 py-3 text-ui text-ink placeholder:text-ink-faint focus-visible:outline-0"
        />

        <div className="max-h-[320px] overflow-y-auto py-1">
          {currentProject && filtered.length > 0 && (
            <>
              <p className="px-3 py-1 text-overline uppercase text-ink-muted">Execute</p>
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-ui text-ink hover:bg-surface-hover"
                  onClick={() => selectExecute(c.id)}
                >
                  <Play size={16} strokeWidth={1.6} aria-hidden className="shrink-0 text-ink-muted" />
                  Execute /{c.name}…
                </button>
              ))}
            </>
          )}

          {currentProject && filtered.length === 0 && (
            <p className="px-4 py-2 text-caption text-ink-muted">No published commands match &quot;{query}&quot;.</p>
          )}

          <p className="px-3 py-1 text-overline uppercase text-ink-muted">Run history</p>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-ui text-ink hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
            onClick={selectHistory}
            disabled={!currentProject}
          >
            <History size={16} strokeWidth={1.6} aria-hidden className="shrink-0 text-ink-muted" />
            Run history
          </button>
        </div>
      </div>
    </div>
  );
}
