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
  /** user-added source — adds an extra "not reviewed" line. Built-ins render exactly as before. */
  unverified?: boolean;
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
  unverified,
}: LicenseAcknowledgmentStepProps) {
  return (
    <>
      <div className="space-y-3">
        <p className="text-ui font-medium text-warning">⚠ Content by another author</p>
        <p className="text-ui">
          This template belongs to {authorDisplayName} ({authorRepo}) — you are responsible for reusing
          this content.
        </p>
        <p className="text-caption text-ink-muted">
          Symbion only displays this content directly from GitHub and does not store or own the author's content{" "}
          {authorDisplayName}.
        </p>

        {unverified && (
          <p className="text-caption text-warning">This source is unverified — Symbion has not reviewed it.</p>
        )}

        <label className="flex cursor-pointer items-start gap-2 text-ui">
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
          className="inline-block text-caption text-ink-muted underline hover:text-ink"
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
