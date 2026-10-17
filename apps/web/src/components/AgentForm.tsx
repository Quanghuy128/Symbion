"use client";

import { useState } from "react";
import type { CanonicalArtifact, CustomField } from "@symbion/core";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { Input, Textarea } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { GenerateBodyButton } from "@/components/GenerateBodyButton";
import { ModelPicker } from "@/components/ModelPicker";
import { GenerateBodyDisclosure } from "@/components/GenerateBodyDisclosure";
import { useActiveProvider } from "@/lib/hooks/useActiveProvider";

const KNOWN_TOOLS = ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "WebFetch", "WebSearch", "Task"];

export interface AgentFormProps {
  artifact: CanonicalArtifact;
  onChange: (next: CanonicalArtifact) => void;
}

/** S7 — Agent builder form tab: only required fields shown by default; "Nâng cao" collapsed (S9). */
export function AgentForm({ artifact, onChange }: AgentFormProps) {
  const [advancedOpen, setAdvancedOpen] = useState((artifact.customFields?.length ?? 0) > 0);
  const [bodyModelId, setBodyModelId] = useState("");
  const { activeProviderId } = useActiveProvider();

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
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-label text-ink-2">name *</label>
        <Input value={artifact.name} onChange={(e) => update("name", e.target.value)} placeholder="code-reviewer" />
      </div>

      <div>
        <label className="mb-1.5 block text-label text-ink-2">description *</label>
        <Input
          value={artifact.description}
          onChange={(e) => update("description", e.target.value)}
          placeholder="Independent reviewer…"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-label text-ink-2">tools</label>
        <div className="flex flex-wrap gap-2">
          {KNOWN_TOOLS.map((tool) => (
            <button
              key={tool}
              type="button"
              onClick={() => toggleTool(tool)}
              className={`h-control-sm rounded-pill border px-3 text-label transition-colors ${
 (artifact.tools ?? []).includes(tool)
 ? "border-mint bg-mint-soft text-mint-text"
 : "border-line-strong text-ink-muted hover:text-ink"
 }`}
            >
              {tool}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-label text-ink-2">Content</label>
          <div className="flex items-center gap-2">
            <ModelPicker providerId={activeProviderId} value={bodyModelId} onChange={setBodyModelId} />
            <GenerateBodyButton
              kind="agent"
              name={artifact.name}
              description={artifact.description}
              currentBody={artifact.body}
              modelId={bodyModelId}
              providerId={activeProviderId}
              onApply={(value) => update("body", value)}
            />
          </div>
        </div>
        <Textarea
          className="h-40 py-2 font-mono text-code"
          value={artifact.body}
          onChange={(e) => update("body", e.target.value)}
        />
        <GenerateBodyDisclosure providerId={activeProviderId} />
      </div>

      <div>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-label text-ink-muted hover:text-ink"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? <ChevronDown size={16} strokeWidth={1.6} aria-hidden /> : <ChevronRight size={16} strokeWidth={1.6} aria-hidden />}
          Advanced
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
                <IconButton aria-label="Remove field" icon={X} size="sm" onClick={() => removeCustomField(idx)} />
              </div>
            ))}
            <Button variant="outline" size="sm" icon={Plus} onClick={addCustomField}>
              Add field
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
