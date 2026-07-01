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
        <p className="text-sm font-medium text-amber-700">⚠ Nội dung của tác giả khác</p>
        <p className="text-sm">
          Mẫu này thuộc về tác giả {authorDisplayName} ({authorRepo}) — bạn tự chịu trách nhiệm về việc sử dụng lại
          nội dung này.
        </p>
        <p className="text-xs text-muted-foreground">
          Symbion chỉ hiển thị nội dung này trực tiếp từ GitHub và không lưu trữ hay sở hữu nội dung của tác giả{" "}
          {authorDisplayName}.
        </p>

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox
            checked={acknowledged}
            onChange={(e) => onAcknowledgedChange(e.target.checked)}
            className="mt-0.5"
          />
          <span>Tôi đã đọc và đồng ý chịu trách nhiệm khi áp dụng mẫu này vào dự án của tôi.</span>
        </label>

        <a
          href={`https://github.com/${authorRepo}`}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-xs text-muted-foreground underline hover:text-foreground"
        >
          Xem repo gốc: github.com/{authorRepo} ↗
        </a>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={onBack}>
          Quay lại
        </Button>
        <Button disabled={!acknowledged} onClick={onContinue}>
          Tiếp tục
        </Button>
      </div>
    </>
  );
}
