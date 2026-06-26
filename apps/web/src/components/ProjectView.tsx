"use client";

import { useState } from "react";
import type { CanonicalArtifact, ProjectStore } from "@symbion/core";
import { Button } from "@/components/ui/button";
import { BuilderDrawer } from "./BuilderDrawer";
import { DependencyGraph } from "./DependencyGraph";
import { PublishDialog } from "./publish/PublishDialog";
import { CopyRunCommandDialog } from "./CopyRunCommandDialog";
import { useArtifactStore } from "@/lib/store/useArtifactStore";

function newArtifact(kind: "agent" | "command"): CanonicalArtifact {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind,
    name: "",
    description: "",
    body: "",
    meta: { version: "draft", status: "draft", createdAt: now, updatedAt: now },
  };
}

export interface ProjectViewProps {
  project: ProjectStore;
}

/** S5 — Project view: Danh sách (list) + Sơ đồ (graph) tabs, publish entry point. */
export function ProjectView({ project }: ProjectViewProps) {
  const [tab, setTab] = useState<"list" | "graph">("list");
  const [editing, setEditing] = useState<CanonicalArtifact | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [runCommandFor, setRunCommandFor] = useState<CanonicalArtifact | null>(null);
  const daemonConnected = useArtifactStore((s) => s.daemonConnected);

  const agents = project.artifacts.filter((a) => a.kind === "agent");
  const commands = project.artifacts.filter((a) => a.kind === "command");
  const isEmpty = project.artifacts.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div>
          <h1 className="font-semibold">{project.name}</h1>
          <p className="text-xs text-muted-foreground">{project.path}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setTab(tab === "list" ? "graph" : "list")}>
            {tab === "list" ? "Sơ đồ" : "Danh sách"}
          </Button>
          <Button size="sm" disabled={!daemonConnected} onClick={() => setPublishing(true)}>
            Xuất bản ▸
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center gap-2">
            <Button onClick={() => setEditing(newArtifact("agent"))}>+ Thêm agent</Button>
            <Button onClick={() => setEditing(newArtifact("command"))}>+ Thêm workflow</Button>
          </div>
        ) : tab === "graph" ? (
          <DependencyGraph artifacts={project.artifacts} />
        ) : (
          <div className="space-y-6">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold">WORKFLOWS / COMMANDS ({commands.length})</h2>
                <Button size="sm" variant="outline" onClick={() => setEditing(newArtifact("command"))}>
                  + Thêm workflow
                </Button>
              </div>
              <ul className="space-y-1">
                {commands.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded border border-border px-3 py-2 text-sm"
                  >
                    <button className="flex-1 text-left" onClick={() => setEditing(c)}>
                      <span>{c.meta.status === "draft" ? "○" : "●"} /{c.name}</span>{" "}
                      <span className="text-muted-foreground">{c.description}</span>
                      {c.meta.status === "draft" && <span className="ml-2 text-xs text-amber-600">·draft</span>}
                    </button>
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setRunCommandFor(c)}
                    >
                      ⋯
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold">AGENTS ({agents.length})</h2>
                <Button size="sm" variant="outline" onClick={() => setEditing(newArtifact("agent"))}>
                  + Thêm agent
                </Button>
              </div>
              <ul className="space-y-1">
                {agents.map((a) => (
                  <li key={a.id} className="rounded border border-border px-3 py-2 text-sm">
                    <button className="w-full text-left" onClick={() => setEditing(a)}>
                      <span>{a.meta.status === "draft" ? "○" : "●"} {a.name}</span>{" "}
                      <span className="text-muted-foreground">{(a.tools ?? []).join(",")}</span>
                      {a.meta.status === "draft" && <span className="ml-2 text-xs text-amber-600">·draft</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>

      {editing && (
        <BuilderDrawer artifact={editing} allArtifacts={project.artifacts} onClose={() => setEditing(null)} />
      )}
      {publishing && <PublishDialog project={project} onClose={() => setPublishing(false)} />}
      {runCommandFor && (
        <CopyRunCommandDialog command={runCommandFor} onClose={() => setRunCommandFor(null)} />
      )}
    </div>
  );
}
