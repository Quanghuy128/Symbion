"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export interface LicenseAcknowledgmentStepProps {
  authorDisplayName: string;
  authorRepo: string;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
  onBack: () => void;
  onContinue: () => void;
}

/**
 * LicenseAcknowledgmentStep — design doc §3.7 (T3-license). Pure
 * presentational, same spirit as ProjectPickerStep — no RPC calls, caller
 * (TemplatePreviewModal) owns the step transition. Inserted between the
 * preview step and the project-picker step for any non-Symbion-authored
 * item (THINK #5: required acknowledgment for third-party content).
 */
export function LicenseAcknowledgmentStep({
  authorDisplayName,
  authorRepo,
  acknowledged,
  onAcknowledgedChange,
  onBack,
  onContinue,
}: LicenseAcknowledgmentStepProps) {
  return (
    <>
      <div className="space-y-3">
        <p className="text-sm font-medium text-amber-700">⚠ Content by another author</p>
        <p className="text-sm">
          This template belongs to {authorDisplayName} ({authorRepo}) — you are responsible for reusing
          this content.
        </p>
        <p className="text-xs text-muted-foreground">
          Symbion only displays this content directly from GitHub and does not store or own the author's content{" "}
          {authorDisplayName}.
        </p>

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox
            checked={acknowledged}
            onChange={(e) => onAcknowledgedChange(e.target.checked)}
            className="mt-0.5"
          />
          <span>I have read this and accept responsibility for applying this template to my project.</span>
        </label>

        <a
          href={`https://github.com/${authorRepo}`}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-xs text-muted-foreground underline hover:text-foreground"
        >
          View source repo: github.com/{authorRepo} ↗
        </a>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button disabled={!acknowledged} onClick={onContinue}>
          Continue
        </Button>
      </div>
    </>
  );
}
