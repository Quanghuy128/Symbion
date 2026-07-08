"use client";

import { useState } from "react";
import type { ProjectStore, TargetId } from "@symbion/core";
import { bump, compareVersions } from "@symbion/core";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PublishDiffView } from "./PublishDiffView";

export interface PublishDialogProps {
  project: ProjectStore;
  onClose: () => void;
}

/** S10 — Publish config: version (semver bump) + target selection. Codex shows lossy caption. */
export function PublishDialog({ project, onClose }: PublishDialogProps) {
  const lastVersion = project.artifacts.reduce((max, a) => {
    return a.meta.version !== "draft" && compareVersions(a.meta.version, max) > 0 ? a.meta.version : max;
  }, "v0.0.0");

  const [version, setVersion] = useState(() => bump(lastVersion === "v0.0.0" ? "v0.0.0" : lastVersion, "patch"));
  const [targets, setTargets] = useState<TargetId[]>(["claude"]);
  const [codexAcknowledged, setCodexAcknowledged] = useState(false);
  const [step, setStep] = useState<"config" | "diff">("config");

  function toggleTarget(target: TargetId) {
    setTargets((prev) => (prev.includes(target) ? prev.filter((t) => t !== target) : [...prev, target]));
  }

  const canProceed = targets.length > 0 && (!targets.includes("codex") || codexAcknowledged);

  if (step === "diff") {
    return (
      <PublishDiffView
        project={project}
        targets={targets}
        version={version}
        onBack={() => setStep("config")}
        onClose={onClose}
      />
    );
  }

  return (
    <Dialog open onClose={onClose} className="w-[500px]">
      <DialogHeader>
        <DialogTitle>Xuất bản</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-text-body">Phiên bản</label>
          <input
            className="h-9 w-full rounded-sm border border-border-input bg-bg-input px-3 text-sm text-text-body"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => toggleTarget("claude")}
              className={`rounded-panel border px-3 py-2.5 text-left text-sm transition-colors ${
                targets.includes("claude")
                  ? "border-brand-accent bg-brand-accent-soft text-text-strong"
                  : "border-border-input text-text-dim hover:bg-white/[.04]"
              }`}
            >
              <span className="font-medium">{targets.includes("claude") ? "☑" : "☐"} Claude</span>
            </button>
            <button
              type="button"
              onClick={() => toggleTarget("codex")}
              className={`rounded-panel border px-3 py-2.5 text-left text-sm transition-colors ${
                targets.includes("codex")
                  ? "border-brand-accent bg-brand-accent-soft text-text-strong"
                  : "border-border-input text-text-dim hover:bg-white/[.04]"
              }`}
            >
              <span className="font-medium">{targets.includes("codex") ? "☑" : "☐"} Codex</span>
              <span className="ml-1 text-xs text-warning">(gộp vào AGENTS.md · lossy)</span>
            </button>
          </div>
          {targets.includes("codex") && (
            <label className="ml-1 flex items-center gap-2 text-xs text-text-dim">
              <input
                type="checkbox"
                checked={codexAcknowledged}
                onChange={(e) => setCodexAcknowledged(e.target.checked)}
              />
              Tôi hiểu — commands sẽ gộp/flatten vào AGENTS.md (mất per-file separation)
            </label>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Hủy
        </Button>
        <Button disabled={!canProceed} onClick={() => setStep("diff")}>
          Xem trước thay đổi
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
