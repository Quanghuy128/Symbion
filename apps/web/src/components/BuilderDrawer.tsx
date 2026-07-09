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
import { useResizableSplit } from "@/lib/hooks/useResizableSplit";
import { useResizableWidth } from "@/lib/hooks/useResizableWidth";

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
  const showToast = useArtifactStore((s) => s.showToast);
  const { containerRef, leftPct, onDragStart } = useResizableSplit("symbion.builderDrawer.split", 50);
  const { width: drawerWidth, onDragStart: onWidthDragStart } = useResizableWidth(
    "symbion.builderDrawer.width",
    880,
    560,
    1400,
  );

  const otherArtifacts = allArtifacts.filter((a) => a.id !== artifact.id);
  const issues = validateArtifact(artifact, { allArtifacts: [...otherArtifacts, artifact] });
  const blockingErrors = issues.filter((i) => i.level === "error");

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await saveArtifact(artifact);
      showToast("Saved.", "success");
      onClose();
    } catch (err) {
      // E9: surface the failure instead of silently swallowing it — the
      // user needs to know Save did not happen (e.g. daemon disconnected
      // mid-edit, or a validation/IO error on the daemon side).
      const message = err instanceof Error ? err.message : "Save failed — reason unknown.";
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Backdrop — net-new (today's drawer had none). fadeIn + click-outside-to-close. */}
      <div className="fixed inset-0 z-40 animate-fadeIn bg-black/50" onClick={onClose} />

      <div
        ref={containerRef}
        className="fixed inset-y-0 right-0 z-40 flex max-w-[96vw] animate-slideIn border-l border-border-hairline bg-bg-panel shadow-drawer"
        style={{ width: `${drawerWidth}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left-edge handle — drag to resize the whole drawer's width. */}
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onWidthDragStart}
          className="group absolute inset-y-0 left-0 z-20 w-1.5 -translate-x-1/2 cursor-col-resize"
          title="Drag to resize width"
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-brand-accent opacity-0 transition-opacity group-hover:opacity-100" />
        </div>

        <div className="flex min-w-0 flex-col p-3" style={{ width: `${leftPct}%` }}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-text-strong">
              {artifact.kind === "agent" ? "Agent builder" : "Workflow builder"}
            </h2>
            <Button variant="ghost" size="sm" onClick={onClose}>
              ✕
            </Button>
          </div>

          <div className="mb-3 flex gap-1 border-b border-border-hairline">
            <button
              className={`px-3 py-2 text-sm ${tab === "form" ? "border-b-2 border-brand-accent font-medium text-text-strong" : "text-text-dim"}`}
              onClick={() => setTab("form")}
            >
              By description
            </button>
            <button
              className={`px-3 py-2 text-sm ${tab === "markdown" ? "border-b-2 border-brand-accent font-medium text-text-strong" : "text-text-dim"}`}
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

          <div className="mt-3 flex items-center justify-between border-t border-border-hairline pt-3">
            <div className="text-xs text-danger">
              {blockingErrors.map((e, i) => (
                <div key={i}>✗ {e.message}</div>
              ))}
              {!daemonConnected && <div>⚠ Daemon disconnected — cannot save.</div>}
              {saveError && <div>✗ Save failed: {saveError}</div>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={blockingErrors.length > 0 || saving || !daemonConnected} onClick={handleSave}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>

        {/* Draggable divider — resizes the form ↔ preview split. */}
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onDragStart}
          className="group relative w-px shrink-0 cursor-col-resize bg-border-hairline"
        >
          {/* Widened invisible hit area so the 1px divider is easy to grab. */}
          <div className="absolute inset-y-0 -left-1.5 -right-1.5 z-10" />
          <div className="absolute inset-y-0 left-0 w-px bg-brand-accent opacity-0 transition-opacity group-hover:opacity-100" />
        </div>

        <div className="min-w-0" style={{ width: `${100 - leftPct}%` }}>
          <LivePreviewPane artifact={artifact} allArtifacts={[...otherArtifacts, artifact]} />
        </div>
      </div>
    </>
  );
}
