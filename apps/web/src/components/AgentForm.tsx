"use client";

import { useState } from "react";
import type { CanonicalArtifact, CustomField } from "@symbion/core";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GenerateBodyButton } from "@/components/GenerateBodyButton";
import { ModelPicker } from "@/components/ModelPicker";
import { GenerateBodyDisclosure } from "@/components/GenerateBodyDisclosure";

const KNOWN_TOOLS = ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "WebFetch", "WebSearch", "Task"];

export interface AgentFormProps {
  artifact: CanonicalArtifact;
  onChange: (next: CanonicalArtifact) => void;
}

/** S7 — Agent builder form tab: only required fields shown by default; "Nâng cao" collapsed (S9). */
export function AgentForm({ artifact, onChange }: AgentFormProps) {
  const [advancedOpen, setAdvancedOpen] = useState((artifact.customFields?.length ?? 0) > 0);
  const [bodyModelId, setBodyModelId] = useState("");

  function update<K extends keyof CanonicalArtifact>(key: K, value: CanonicalArtifact[K]) {
    onChange({ ...artifact, [key]: value });
  }

  function toggleTool(tool: string) {
    const tools = artifact.tools ?? [];
    update("tools", tools.includes(tool) ? tools.filter((t) => t !== tool) : [...tools, tool]);
  }

  function updateCustomField(idx: number, field: Partial<CustomField>) {
    const next = [...(artifact.customFields ?? [])];
    next[idx] = { ...next[idx]!, ...field };
    update("customFields", next);
  }

  function addCustomField() {
    update("customFields", [...(artifact.customFields ?? []), { key: "", value: "" }]);
  }

  function removeCustomField(idx: number) {
    update("customFields", (artifact.customFields ?? []).filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium">name *</label>
        <Input value={artifact.name} onChange={(e) => update("name", e.target.value)} placeholder="code-reviewer" />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">description *</label>
        <Input
          value={artifact.description}
          onChange={(e) => update("description", e.target.value)}
          placeholder="Independent reviewer…"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">tools</label>
        <div className="flex flex-wrap gap-2">
          {KNOWN_TOOLS.map((tool) => (
            <button
              key={tool}
              type="button"
              onClick={() => toggleTool(tool)}
              className={`rounded border px-2 py-1 text-xs ${
                (artifact.tools ?? []).includes(tool)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border"
              }`}
            >
              {tool}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-medium">Nội dung</label>
          <div className="flex items-center gap-2">
            <ModelPicker providerId="ollama" value={bodyModelId} onChange={setBodyModelId} />
            <GenerateBodyButton
              kind="agent"
              name={artifact.name}
              description={artifact.description}
              currentBody={artifact.body}
              modelId={bodyModelId}
              providerId="ollama"
              onApply={(value) => update("body", value)}
            />
          </div>
        </div>
        <textarea
          className="h-40 w-full rounded-md border border-border bg-background p-2 text-sm"
          value={artifact.body}
          onChange={(e) => update("body", e.target.value)}
        />
        <GenerateBodyDisclosure providerId="ollama" />
      </div>

      <div>
        <button
          type="button"
          className="text-sm font-medium text-muted-foreground"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? "▾" : "▸"} Nâng cao
        </button>
        {advancedOpen && (
          <div className="mt-2 space-y-2">
            {(artifact.customFields ?? []).map((cf, idx) => (
              <div key={idx} className="flex gap-2">
                <Input
                  className="w-1/3"
                  placeholder="model"
                  value={cf.key}
                  onChange={(e) => updateCustomField(idx, { key: e.target.value })}
                />
                <Input
                  className="flex-1"
                  placeholder="claude-opus-4"
                  value={cf.value}
                  onChange={(e) => updateCustomField(idx, { value: e.target.value })}
                />
                <Button variant="ghost" size="sm" onClick={() => removeCustomField(idx)}>
                  ✕
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addCustomField}>
              + Thêm field
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
