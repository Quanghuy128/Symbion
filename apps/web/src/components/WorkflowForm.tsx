"use client";

import type { CanonicalArtifact } from "@symbion/core";
import { extractAgentMentions } from "@symbion/core";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface WorkflowFormProps {
  artifact: CanonicalArtifact;
  allArtifacts: CanonicalArtifact[];
  onChange: (next: CanonicalArtifact) => void;
}

/** S8 — Workflow (command) builder form tab. */
export function WorkflowForm({ artifact, allArtifacts, onChange }: WorkflowFormProps) {
  function update<K extends keyof CanonicalArtifact>(key: K, value: CanonicalArtifact[K]) {
    onChange({ ...artifact, [key]: value });
  }

  function insertArguments() {
    const nextBody = `${artifact.body}${artifact.body.endsWith("\n") || artifact.body === "" ? "" : "\n"}$ARGUMENTS`;
    onChange({ ...artifact, body: nextBody, usesArguments: true });
  }

  const mentions = extractAgentMentions(artifact.body);
  const agentNames = new Set(allArtifacts.filter((a) => a.kind === "agent").map((a) => a.name));

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium">command name (→ /name)</label>
        <Input value={artifact.name} onChange={(e) => update("name", e.target.value)} placeholder="analyze" />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">description *</label>
        <Input
          value={artifact.description}
          onChange={(e) => update("description", e.target.value)}
          placeholder="3 BA agents research requirements, then synthesize"
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-medium">Nội dung</label>
          <Button variant="outline" size="sm" onClick={insertArguments}>
            [Chèn $ARGUMENTS]
          </Button>
        </div>
        <textarea
          className="h-40 w-full rounded-md border border-border bg-background p-2 text-sm"
          value={artifact.body}
          onChange={(e) => update("body", e.target.value)}
        />
      </div>

      {mentions.length > 0 && (
        <div className="text-xs">
          <span className="text-muted-foreground">Agents tham chiếu: </span>
          {mentions.map((m) => (
            <span key={m} className={agentNames.has(m) ? "text-green-600" : "text-amber-600"}>
              • {m} {agentNames.has(m) ? "✓" : "(không tồn tại)"}{" "}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
