"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TemplateMarkdownViewer } from "./TemplateMarkdownViewer";
import { ProjectPickerStep } from "./ProjectPickerStep";
import { LicenseAcknowledgmentStep } from "./LicenseAcknowledgmentStep";
import { ApplyResultPanel } from "./ApplyResultPanel";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import type { TemplateListItem } from "@/data/templates/manifest";

export interface TemplatePreviewModalProps {
  template: TemplateListItem;
  onClose: () => void;
}

type Step = "preview" | "license" | "apply" | "result";

const KIND_LABEL: Record<TemplateListItem["kind"], string> = {
  agent: "Agent",
  command: "Command",
  skill: "Skill",
};

/**
 * TemplatePreviewModal — the single multi-step dialog backing T2 (preview) ->
 * T3/T5 (apply / project-picker, incl. zero-projects + daemon-down variants)
 * -> T4 (result). Step type literally modeled like CreateProjectDialog's
 * `Step` precedent, scoped to this modal only.
 */
export function TemplatePreviewModal({ template, onClose }: TemplatePreviewModalProps) {
  const [step, setStep] = useState<Step>("preview");
  const [copied, setCopied] = useState(false);
  const [clipboardBlocked, setClipboardBlocked] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{
    projectName: string;
    finalName: string;
    wasRenamed: boolean;
  } | null>(null);
  // templates-authors PLAN §P6 / design doc §3.7: reset whenever a new
  // `template` prop is passed in — never remembered across items, even
  // within the same session (design doc Interaction Notes).
  const [licenseAcknowledged, setLicenseAcknowledged] = useState(false);

  const selectAllRef = useRef<(() => void) | null>(null);
  const router = useRouter();

  const isThirdPartyAuthor = template.authorId !== "symbion";

  useEffect(() => {
    setLicenseAcknowledged(false);
  }, [template.id]);

  const projects = useArtifactStore((s) => s.projects);
  const daemonConnected = useArtifactStore((s) => s.daemonConnected);
  const loadProjects = useArtifactStore((s) => s.loadProjects);
  const applyTemplate = useArtifactStore((s) => s.applyTemplate);

  // No project list re-fetch assumption: if the user navigates directly to
  // /templates without visiting "/" first, TemplatesView already calls
  // loadProjects() on mount (see TemplatesView.tsx) — but defensively
  // re-attempt here too in case this modal mounts before that resolves.
  useEffect(() => {
    if (projects.length === 0) {
      loadProjects().catch(() => {
        useArtifactStore.getState().setDaemonConnected(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(template.raw);
      setCopied(true);
      setClipboardBlocked(false);
    } catch {
      setClipboardBlocked(true);
      setCopied(false);
      selectAllRef.current?.();
    }
  }

  function handleOpenApplyStep() {
    setApplyError(null);
    // design doc §1 step 8 / FR: a non-Symbion-authored item inserts the new
    // license/attribution acknowledgment step BEFORE the project picker;
    // a Symbion-authored item goes straight to "apply" — pixel-identical to v1.
    setStep(isThirdPartyAuthor ? "license" : "apply");
  }

  function handleContinueFromLicense() {
    setStep("apply");
  }

  async function handleConfirmApply() {
    if (!selectedProjectId || template.kind === "skill") return;
    // Defense in depth (design doc): the button should already be
    // unreachable for an un-acknowledged third-party item, but the gate is
    // enforced at the data layer too, not just via disabled-button UI.
    if (isThirdPartyAuthor && !licenseAcknowledged) return;
    setApplying(true);
    setApplyError(null);
    try {
      const project = projects.find((p) => p.id === selectedProjectId);
      const result = await applyTemplate({
        projectId: selectedProjectId,
        template: {
          sourceTemplateId: template.id,
          kind: template.kind,
          name: template.name,
          description: template.description,
          tools: template.tools,
          body: extractBody(template.raw),
          authorId: template.authorId,
          acknowledgedThirdParty: isThirdPartyAuthor ? licenseAcknowledged : undefined,
        },
      });
      setApplyResult({
        projectName: project?.name ?? "?",
        finalName: result.finalName,
        wasRenamed: result.wasRenamed,
      });
      setStep("result");
    } catch (err) {
      setApplyError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  function handleOpenProject() {
    if (!selectedProjectId) return;
    router.push(`/?openProject=${encodeURIComponent(selectedProjectId)}`);
  }

  function handleCreateProjectRequested() {
    router.push("/?createProject=1");
  }

  return (
    <Dialog open onClose={onClose} className="w-[560px]">
      {step === "preview" && (
        <>
          <DialogHeader>
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle>{template.kind === "command" ? `/${template.name}` : template.name}</DialogTitle>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {KIND_LABEL[template.kind]}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>
              {isThirdPartyAuthor && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Source: {template.authorDisplayName}
                  {template.authorRepoLabel ? ` (${template.authorRepoLabel})` : ""}{" "}
                  {template.authorRepoLabel && (
                    <a
                      href={`https://github.com/${template.authorRepoLabel}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-foreground"
                    >
                      ↗
                    </a>
                  )}
                </p>
              )}
            </div>
          </DialogHeader>

          <DialogBody className="space-y-2">
            <TemplateMarkdownViewer content={template.raw} selectAllRef={selectAllRef} />

            {template.kind === "skill" && (
              <p className="text-xs text-muted-foreground">
                ℹ Skills don't support Apply yet — coming soon. You can still copy the markdown and paste it manually into
                .claude/skills/.
              </p>
            )}

            {clipboardBlocked && (
              <p className="text-xs text-amber-600">
                ⚠ Cannot access the clipboard — the text above is pre-selected, use Ctrl+C / ⌘C to copy manually.
              </p>
            )}
            {copied && <p className="text-xs text-green-600">Copied to clipboard.</p>}
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button variant="outline" onClick={handleCopy}>
              Copy markdown
            </Button>
            <Button onClick={handleOpenApplyStep} disabled={template.kind === "skill"}>
              Apply
            </Button>
          </DialogFooter>
        </>
      )}

      {step === "license" && (
        <>
          <DialogHeader>
            <DialogTitle>Apply &quot;{template.name}&quot;</DialogTitle>
          </DialogHeader>
          <LicenseAcknowledgmentStep
            authorDisplayName={template.authorDisplayName}
            authorRepo={template.authorRepoLabel ?? template.authorDisplayName}
            acknowledged={licenseAcknowledged}
            onAcknowledgedChange={setLicenseAcknowledged}
            onBack={() => setStep("preview")}
            onContinue={handleContinueFromLicense}
          />
        </>
      )}

      {step === "apply" && (
        <>
          <DialogHeader>
            <DialogTitle>Apply &quot;{template.name}&quot; to which project?</DialogTitle>
          </DialogHeader>

          <ProjectPickerStep
            projects={projects}
            selectedId={selectedProjectId}
            onSelect={setSelectedProjectId}
            search={projectSearch}
            onSearchChange={setProjectSearch}
            daemonConnected={daemonConnected}
            onCreateProjectRequested={handleCreateProjectRequested}
          />

          {applyError && <p className="mt-2 text-xs text-destructive">{applyError}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setStep(isThirdPartyAuthor ? "license" : "preview")}>
              Back
            </Button>
            {projects.length > 0 && (
              <Button
                disabled={
                  !selectedProjectId ||
                  !daemonConnected ||
                  applying ||
                  (isThirdPartyAuthor && !licenseAcknowledged)
                }
                onClick={handleConfirmApply}
              >
                {applying ? "Applying…" : "Confirm apply"}
              </Button>
            )}
          </DialogFooter>
        </>
      )}

      {step === "result" && applyResult && (
        <>
          <DialogHeader>
            <DialogTitle>Result</DialogTitle>
          </DialogHeader>
          <ApplyResultPanel
            projectName={applyResult.projectName}
            finalName={applyResult.finalName}
            wasRenamed={applyResult.wasRenamed}
            onOpenProject={handleOpenProject}
            onClose={onClose}
          />
        </>
      )}
    </Dialog>
  );
}

/** Strips the frontmatter block, leaving only the body — what
 * CanonicalArtifact.body expects (same convention parseClaudeFile/
 * parseTemplateMarkdown use). Applied client-side here so the daemon never
 * needs to re-parse the raw template text itself (PLAN §5 assumption #2). */
function extractBody(raw: string): string {
  const match = /^---\n[\s\S]*?\n---\n?([\s\S]*)$/.exec(raw);
  const body = match ? (match[1] ?? "") : raw;
  return body.replace(/\n+$/, "").replace(/^\n+/, "");
}
