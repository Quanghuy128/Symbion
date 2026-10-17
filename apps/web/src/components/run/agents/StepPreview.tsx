"use client";

import { useState } from "react";
import { isTruncatedPreview, stripTruncationMarker, type TranscriptRowPreview } from "@symbion/core";
import { TRUNCATION_NOTE } from "./format";

/** ⧉ copy — copies the STORED preview exactly (never more, never reformatted). */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="text-ink-muted hover:text-ink"
      onClick={(e) => {
        e.stopPropagation();
        try {
          void navigator.clipboard?.writeText(text)?.catch(() => undefined);
        } catch {
          /* clipboard unavailable */
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_200);
      }}
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

function PreviewBlock({ title, text, error }: { title: string; text: string; error?: boolean }) {
  const truncated = isTruncatedPreview(text);
  return (
    <div className={`overflow-hidden rounded-sm border border-line ${error ? "bg-danger-soft" : "bg-sidebar"}`}>
      <div className="flex items-center justify-between border-b border-line px-2 py-0.5 text-overline uppercase text-ink-muted">
        <span>
          {title}
          {error && <span className="text-danger-text"> · error</span>}
        </span>
        <CopyButton text={text} label={`Copy ${title.toLowerCase()}`} />
      </div>
      {/* Plain text only — CLI output is untrusted (no markdown / HTML). */}
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all px-2 py-1 font-mono text-code-sm leading-snug text-ink">
        {stripTruncationMarker(text)}
      </pre>
      {truncated && <p className="px-2 pb-1 text-overline text-warning">{TRUNCATION_NOTE}</p>}
    </div>
  );
}

export interface StepPreviewProps {
  preview: TranscriptRowPreview | undefined;
  /** the row has no result yet. */
  pending: boolean;
  /** the run ended with this row still waiting. */
  interrupted: boolean;
  legacyTruncated?: boolean;
  /** the row kind decides the section titles. */
  kind: "thinking" | "tool" | "spawn" | "text" | "result" | "system" | "unknown";
}

/** S4a — the inline INPUT / OUTPUT expansion of one transcript step. */
export function StepPreview({ preview, pending, interrupted, legacyTruncated, kind }: StepPreviewProps) {
  const outputTitle = kind === "thinking" ? "Thinking" : kind === "text" ? "Text" : kind === "unknown" ? "Raw" : "Output";
  return (
    <div className="space-y-1 py-1 pl-10 pr-2" data-testid="step-preview">
      {preview?.input !== undefined && preview.input.length > 0 && <PreviewBlock title="Input" text={preview.input} />}
      {preview?.output !== undefined && preview.output.length > 0 && (
        <PreviewBlock title={outputTitle} text={preview.output} error={preview.isError} />
      )}
      {legacyTruncated && <p className="text-overline text-ink-muted">result not recoverable (pre-upgrade run)</p>}
      {pending && !interrupted && <p className="text-overline text-ink-muted">waiting for result…</p>}
      {interrupted && <p className="text-overline text-ink-muted">◼ interrupted — no result recorded</p>}
      {preview?.stepTokens && (kind === "tool" || kind === "spawn" || kind === "text") && (
        <p className="font-mono text-code-sm tabular-nums text-ink-muted">
          step tokens  in {preview.stepTokens.input.toLocaleString("en-US")} · out {preview.stepTokens.output.toLocaleString("en-US")}
        </p>
      )}
    </div>
  );
}
