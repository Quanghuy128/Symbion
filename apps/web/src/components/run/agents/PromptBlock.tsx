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
    <div className="border-b border-border-hairline px-3 py-1.5 text-[11px]" data-testid="prompt-block">
      <div className="mb-0.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[.05em] text-text-faint">
        <span>{label}</span>
        <CopyButton text={text} label={`Copy ${label.toLowerCase()}`} />
      </div>
      {text.trim().length === 0 ? (
        <p className="text-text-faint">—</p>
      ) : (
        <p className={`whitespace-pre-wrap break-words text-text-body ${open ? "max-h-60 overflow-auto" : "line-clamp-3"}`}>{text}</p>
      )}
      {(long || truncated) && (
        <div className="mt-0.5 flex items-center justify-between">
          {truncated && open ? <span className="text-[10px] text-warning">{TRUNCATION_NOTE}</span> : <span />}
          {long && (
            <button type="button" className="text-[10.5px] text-text-muted hover:text-text-body" onClick={() => setOpen((o) => !o)}>
              {open ? "Show less ▾" : "Show more ▸"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
