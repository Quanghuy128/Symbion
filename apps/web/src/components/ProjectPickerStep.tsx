"use client";

import { useMemo } from "react";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Radio } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

export interface ProjectPickerStepProps {
  projects: Array<{ id: string; name: string; path: string }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  daemonConnected: boolean;
  onCreateProjectRequested: () => void;
}

/**
 * ProjectPickerStep — pure presentational radio-list / zero-projects empty
 * state / daemon-down dimmed state, used by TemplatePreviewModal's "apply"
 * step (T3/T5/T8 wireframes). Same spirit as ImportReviewStep: no RPC calls,
 * no submit button — the caller owns "Xác nhận áp dụng".
 */
export function ProjectPickerStep({
  projects,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  daemonConnected,
  onCreateProjectRequested,
}: ProjectPickerStepProps) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
  }, [projects, search]);

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="text-ui text-ink-muted">No projects yet — create one first</p>
        <Button icon={Plus} onClick={onCreateProjectRequested}>New project</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!daemonConnected && (
        <p className="text-caption font-medium text-danger-text">
          ⚠ daemon disconnected — cannot apply right now. Reconnecting…
        </p>
      )}

      <div className="relative">
        <Search size={16} strokeWidth={1.6} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
        <Input className="pl-9" placeholder="Search projects…" value={search} onChange={(e) => onSearchChange(e.target.value)} />
      </div>

      <div className="max-h-48 space-y-1 overflow-y-auto">
        {filtered.length === 0 && <p className="text-caption text-ink-muted">No matching projects found.</p>}
        {filtered.map((p) => (
          <label
            key={p.id}
            className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-ui hover:bg-surface-hover ${
 selectedId === p.id ? "bg-surface-hover" : ""
 } ${!daemonConnected ? "opacity-60" : ""}`}
          >
            <Radio
              name="template-apply-project"
              checked={selectedId === p.id}
              disabled={!daemonConnected}
              onChange={() => onSelect(p.id)}
            />
            <span className="flex-1 truncate font-medium">{p.name}</span>
            <span className="truncate text-caption text-ink-muted" title={p.path}>
              {p.path}
            </span>
          </label>
        ))}
      </div>

      <p className="text-caption text-ink-muted">
        The template will be saved to the selected project as a draft — nothing written to the repo yet. You still need to Publish later to write
        it to disk.
      </p>
    </div>
  );
}
