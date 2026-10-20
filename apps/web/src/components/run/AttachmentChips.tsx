"use client";

import { ImagePlus, Loader2, X } from "lucide-react";
import { useRef } from "react";
import { RUN_ATTACHMENT_LIMITS, formatAttachmentBytes } from "@symbion/core";
import { Button } from "@/components/ui/button";
import type { AttachmentChip } from "./useAttachmentComposer";

export interface AttachmentChipsProps {
  chips: AttachmentChip[];
  errors: string[];
  hint: string | null;
  totalBytes: number;
  /** false → the attach button is disabled (old CLI); the reason is shown inline. */
  supported: boolean;
  unsupportedReason?: string;
  onPickFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
}

/**
 * AttachmentChips — the composer row under the requirement input: thumbnail chips
 * (name + size tooltip, remove ×), the "Attach image" picker button and the
 * count/size counter. Previews are object URLs of the user's own verified bytes.
 */
export function AttachmentChips({
  chips,
  errors,
  hint,
  totalBytes,
  supported,
  unsupportedReason,
  onPickFiles,
  onRemove,
}: AttachmentChipsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const L = RUN_ATTACHMENT_LIMITS;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <span
            key={c.id}
            title={`${c.name} · ${formatAttachmentBytes(c.size)}`}
            className="relative inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border border-line bg-sidebar"
            data-testid="attachment-chip"
          >
            {c.status === "encoding" || !c.previewUrl ? (
              <Loader2 size={14} aria-label="Encoding" className="animate-spin text-ink-muted" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL of the user's own bytes
              <img src={c.previewUrl} alt={c.name} className="h-full w-full object-cover" />
            )}
            <button
              type="button"
              aria-label={`Remove ${c.name}`}
              onClick={() => onRemove(c.id)}
              className="absolute right-0 top-0 inline-flex h-4 w-4 items-center justify-center rounded-bl-md bg-overlay text-ink hover:bg-danger hover:text-on-danger"
            >
              <X size={10} aria-hidden />
            </button>
          </span>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={ImagePlus}
          disabled={!supported || chips.length >= L.maxCount}
          aria-label="Attach images (PNG, JPEG, GIF, WebP)"
          onClick={() => inputRef.current?.click()}
        >
          Attach image
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          data-testid="attachment-file-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = ""; // let the same file be picked again
            onPickFiles(files);
          }}
        />
        <span className="text-caption text-ink-muted">
          {chips.length}/{L.maxCount} · {formatAttachmentBytes(totalBytes)} of {L.maxBytesTotal / (1024 * 1024)} MB
        </span>
      </div>
      <div aria-live="polite" className="space-y-0.5">
        {!supported && unsupportedReason && <p className="text-caption text-ink-muted">{unsupportedReason}</p>}
        {hint && <p className="text-caption text-ink-muted">{hint}</p>}
        {errors.map((m, i) => (
          <p key={`${i}-${m}`} className="text-caption text-danger-text">
            {m}
          </p>
        ))}
      </div>
    </div>
  );
}
