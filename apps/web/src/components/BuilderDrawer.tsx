"use client";

import { useState } from "react";
import type { CanonicalArtifact } from "@symbion/core";
import { validateArtifact } from "@symbion/core";
import { Button } from "@/components/ui/button";
import { AgentForm } from "./AgentForm";
import { WorkflowForm } from "./WorkflowForm";
import { MarkdownTab } from "./MarkdownTab";
import { LivePreviewPane } from "./LivePreviewPane";
import { useArtifactStore } from "@/lib/store/useArtifactStore";

export interface BuilderDrawerProps {
  artifact: CanonicalArtifact;
  allArtifacts: CanonicalArtifact[];
  onClose: () => void;
}

/** S7/S8 — right Sheet/drawer: 2 tabs (Theo mô tả / Theo markdown) + live preview, per design. */
export function BuilderDrawer({ artifact: initial, allArtifacts, onClose }: BuilderDrawerProps) {
  const [artifact, setArtifact] = useState<CanonicalArtifact>(initial);
  const [tab, setTab] = useState<"form" | "markdown">("form");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveArtifact = useArtifactStore((s) => s.saveArtifact);
  const daemonConnected = useArtifactStore((s) => s.daemonConnected);

  const otherArtifacts = allArtifacts.filter((a) => a.id !== artifact.id);
  const issues = validateArtifact(artifact, { allArtifacts: [...otherArtifacts, artifact] });
  const blockingErrors = issues.filter((i) => i.level === "error");

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await saveArtifact(artifact);
      onClose();
    } catch (err) {
      // E9: surface the failure instead of silently swallowing it — the
      // user needs to know Save did not happen (e.g. daemon disconnected
      // mid-edit, or a validation/IO error on the daemon side).
      const message = err instanceof Error ? err.message : "Lưu thất bại — không rõ lý do.";
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-[860px] border-l border-border bg-background shadow-xl">
      <div className="flex w-1/2 flex-col p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {artifact.kind === "agent" ? "Agent builder" : "Workflow builder"}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>

        <div className="mb-4 flex gap-1 border-b border-border">
          <button
            className={`px-3 py-2 text-sm ${tab === "form" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
            onClick={() => setTab("form")}
          >
            Theo mô tả
          </button>
          <button
            className={`px-3 py-2 text-sm ${tab === "markdown" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
            onClick={() => setTab("markdown")}
          >
            Theo markdown
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === "form" ? (
            artifact.kind === "agent" ? (
              <AgentForm artifact={artifact} onChange={setArtifact} />
            ) : (
              <WorkflowForm artifact={artifact} allArtifacts={otherArtifacts} onChange={setArtifact} />
            )
          ) : (
            <MarkdownTab artifact={artifact} onChange={setArtifact} />
          )}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <div className="text-xs text-destructive">
            {blockingErrors.map((e, i) => (
              <div key={i}>✗ {e.message}</div>
            ))}
            {!daemonConnected && <div>⚠ Mất kết nối daemon — không thể lưu.</div>}
            {saveError && <div>✗ Lưu thất bại: {saveError}</div>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Hủy
            </Button>
            <Button disabled={blockingErrors.length > 0 || saving || !daemonConnected} onClick={handleSave}>
              {saving ? "Đang lưu…" : "Lưu"}
            </Button>
          </div>
        </div>
      </div>

      <div className="w-1/2">
        <LivePreviewPane artifact={artifact} allArtifacts={[...otherArtifacts, artifact]} />
      </div>
    </div>
  );
}
