"use client";

import { useState } from "react";
import type { ProjectStore, TargetId } from "@symbion/core";
import { bump, compareVersions } from "@symbion/core";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Square, SquareCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input } from "@/components/ui/input";
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
        <DialogTitle>Publish</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <Field label="Version" htmlFor="publish-version">
          <Input id="publish-version" value={version} onChange={(e) => setVersion(e.target.value)} />
        </Field>

        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              aria-pressed={targets.includes("claude")}
              onClick={() => toggleTarget("claude")}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-ui transition-colors ${
 targets.includes("claude")
 ? "border-mint bg-mint-soft text-ink"
 : "border-line-strong text-ink-muted hover:bg-surface-hover"
 }`}
            >
              {targets.includes("claude") ? <SquareCheck size={16} strokeWidth={1.6} aria-hidden className="shrink-0 text-mint-text" /> : <Square size={16} strokeWidth={1.6} aria-hidden className="shrink-0" />}
              <span className="font-medium">Claude</span>
            </button>
            <button
              type="button"
              aria-pressed={targets.includes("codex")}
              onClick={() => toggleTarget("codex")}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-ui transition-colors ${
 targets.includes("codex")
 ? "border-mint bg-mint-soft text-ink"
 : "border-line-strong text-ink-muted hover:bg-surface-hover"
 }`}
            >
              {targets.includes("codex") ? <SquareCheck size={16} strokeWidth={1.6} aria-hidden className="shrink-0 text-mint-text" /> : <Square size={16} strokeWidth={1.6} aria-hidden className="shrink-0" />}
              <span className="font-medium">Codex</span>
              <span className="ml-1 text-caption text-warning">(merged into AGENTS.md · lossy)</span>
            </button>
          </div>
          {targets.includes("codex") && (
            <Checkbox
              className="ml-1 text-caption text-ink-muted"
              checked={codexAcknowledged}
              onChange={(e) => setCodexAcknowledged(e.target.checked)}
              label="I understand — commands will be merged/flattened into AGENTS.md (loses per-file separation)"
            />
          )}
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="lg" disabled={!canProceed} onClick={() => setStep("diff")}>
          Preview changes
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
