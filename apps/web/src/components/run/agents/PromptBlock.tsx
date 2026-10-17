"use client";

import { useState } from "react";
import { CopyButton } from "./StepPreview";
import { TRUNCATION_NOTE } from "./format";

export interface PromptBlockProps {
  /** "Prompt" for subagents, "Requirement" for the root. */
  label: string;
  text: string | undefined;
  truncated?: boolean;
}

/** The prompt an agent was given — 3-line clamp, Show more, copy (plain text). */
export function PromptBlock({ label, text, truncated }: PromptBlockProps) {
  const [open, setOpen] = useState(false);
  if (text === undefined) return null;
  const long = text.length > 180 || text.split("\n").length > 3;
  return (
    <div className="border-b border-line px-3 py-1.5 text-caption" data-testid="prompt-block">
      <div className="mb-0.5 flex items-center justify-between text-overline font-semibold uppercase text-ink-muted">
        <span>{label}</span>
        <CopyButton text={text} label={`Copy ${label.toLowerCase()}`} />
      </div>
      {text.trim().length === 0 ? (
        <p className="text-ink-muted">—</p>
      ) : (
        <p className={`whitespace-pre-wrap break-words text-ink ${open ? "max-h-60 overflow-auto" : "line-clamp-3"}`}>{text}</p>
      )}
      {(long || truncated) && (
        <div className="mt-0.5 flex items-center justify-between">
          {truncated && open ? <span className="text-overline text-warning">{TRUNCATION_NOTE}</span> : <span />}
          {long && (
            <button type="button" className="text-overline text-ink-muted hover:text-ink" onClick={() => setOpen((o) => !o)}>
              {open ? "Show less ▾" : "Show more ▸"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
