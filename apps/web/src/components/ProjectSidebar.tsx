"use client";

import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { DaemonStatusBadge } from "./DaemonStatusBadge";

export interface ProjectSidebarProps {
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
}

/** S1 persistent sidebar: project list (QUY TRÌNH/DỰ ÁN) + CONFIGURATION + daemon status footer. */
export function ProjectSidebar({ onCreateProject, onSelectProject }: ProjectSidebarProps) {
  const projects = useArtifactStore((s) => s.projects);
  const currentProject = useArtifactStore((s) => s.currentProject);

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-semibold">Symbion</span>
        <span className="text-xs text-muted-foreground">⌘K</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground">WORKFLOWS / PROJECTS</span>
          <button onClick={onCreateProject} className="text-xs text-muted-foreground hover:text-foreground">
            +
          </button>
        </div>

        {projects.length === 0 && (
          <p className="text-xs text-muted-foreground">∅ no projects yet</p>
        )}

        <ul className="space-y-1">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => onSelectProject(p.id)}
                className={`block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-muted ${
                  currentProject?.id === p.id ? "bg-muted font-medium" : ""
                }`}
                title={p.path}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>

        <div className="my-3 border-t border-border" />
        <span className="text-xs font-semibold text-muted-foreground">CONFIGURATION</span>
        <button className="mt-1 block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted">
          ⚙ General settings
        </button>
      </div>

      <DaemonStatusBadge />
    </aside>
  );
}
