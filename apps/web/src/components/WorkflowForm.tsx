"use client";

import { useState } from "react";
import type { CanonicalArtifact } from "@symbion/core";
import { extractAgentMentions } from "@symbion/core";
import { Input } from "@/components/ui/input";
import { GenerateBodyButton } from "@/components/GenerateBodyButton";
import { ModelPicker } from "@/components/ModelPicker";
import { GenerateBodyDisclosure } from "@/components/GenerateBodyDisclosure";
import { useActiveProvider } from "@/lib/hooks/useActiveProvider";

export interface WorkflowFormProps {
  artifact: CanonicalArtifact;
  allArtifacts: CanonicalArtifact[];
  onChange: (next: CanonicalArtifact) => void;
}

/** S8 — Workflow (command) builder form tab. */
export function WorkflowForm({ artifact, allArtifacts, onChange }: WorkflowFormProps) {
  const [bodyModelId, setBodyModelId] = useState("");
  const { activeProviderId } = useActiveProvider();

  function update<K extends keyof CanonicalArtifact>(key: K, value: CanonicalArtifact[K]) {
    onChange({ ...artifact, [key]: value });
  }

  const mentions = extractAgentMentions(artifact.body);
  const agentNames = new Set(allArtifacts.filter((a) => a.kind === "agent").map((a) => a.name));

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-sm font-medium text-text-body">command name (→ /name)</label>
        <Input value={artifact.name} onChange={(e) => update("name", e.target.value)} placeholder="analyze" />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-text-body">description *</label>
        <Input
          value={artifact.description}
          onChange={(e) => update("description", e.target.value)}
          placeholder="3 BA agents research requirements, then synthesize"
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-medium text-text-body">Content</label>
          <div className="flex items-center gap-2">
            <ModelPicker providerId={activeProviderId} value={bodyModelId} onChange={setBodyModelId} />
            <GenerateBodyButton
              kind="command"
              name={artifact.name}
              description={artifact.description}
              currentBody={artifact.body}
              modelId={bodyModelId}
              providerId={activeProviderId}
              onApply={(value) => update("body", value)}
            />
          </div>
        </div>
        <textarea
          className="h-40 w-full rounded-sm border border-border-input bg-bg-input p-2 text-sm text-text-body"
          value={artifact.body}
          onChange={(e) => update("body", e.target.value)}
        />
        <GenerateBodyDisclosure providerId={activeProviderId} />
      </div>

      {mentions.length > 0 && (
        <div className="text-xs">
          <span className="text-text-muted">Referenced agents: </span>
          {mentions.map((m) => (
            <span key={m} className={agentNames.has(m) ? "text-success" : "text-warning"}>
              • {m} {agentNames.has(m) ? "✓" : "(does not exist)"}{" "}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
