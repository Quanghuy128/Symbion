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
      className="text-text-faint hover:text-text-body"
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
    <div className={`overflow-hidden rounded-sm border border-border-hairline ${error ? "bg-danger/10" : "bg-bg-code"}`}>
      <div className="flex items-center justify-between border-b border-border-hairline px-2 py-0.5 text-[10px] uppercase tracking-[.05em] text-text-faint">
        <span>
          {title}
          {error && <span className="text-danger"> · error</span>}
        </span>
        <CopyButton text={text} label={`Copy ${title.toLowerCase()}`} />
      </div>
      {/* Plain text only — CLI output is untrusted (no markdown / HTML). */}
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all px-2 py-1 font-mono text-[10.5px] leading-snug text-text-body">
        {stripTruncationMarker(text)}
      </pre>
      {truncated && <p className="px-2 pb-1 text-[10px] text-warning">{TRUNCATION_NOTE}</p>}
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
      {legacyTruncated && <p className="text-[10px] text-text-muted">result not recoverable (pre-upgrade run)</p>}
      {pending && !interrupted && <p className="text-[10px] text-text-muted">waiting for result…</p>}
      {interrupted && <p className="text-[10px] text-text-faint">◼ interrupted — no result recorded</p>}
      {preview?.stepTokens && (kind === "tool" || kind === "spawn" || kind === "text") && (
        <p className="font-mono text-[10px] tabular-nums text-text-faint">
          step tokens  in {preview.stepTokens.input.toLocaleString("en-US")} · out {preview.stepTokens.output.toLocaleString("en-US")}
        </p>
      )}
    </div>
  );
}
