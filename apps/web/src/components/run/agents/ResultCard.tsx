"use client";

import { stripTruncationMarker, type AgentResult } from "@symbion/core";
import { CopyButton } from "./StepPreview";
import { TRUNCATION_NOTE } from "./format";

export interface ResultCardProps {
  result: AgentResult | undefined;
  /** the agent itself ended in error -> danger left bar. */
  agentErrored: boolean;
}

/** Final result text of an agent (design §3 "RESULT" card). Plain text only. */
export function ResultCard({ result, agentErrored }: ResultCardProps) {
  return (
    <div
      className={`mx-2 my-1 overflow-hidden rounded-sm border border-border-hairline border-l-2 bg-bg-surface ${
        agentErrored ? "border-l-danger" : "border-l-success"
      }`}
      data-testid="result-card"
    >
      <div className="flex items-center justify-between px-2 py-0.5 text-[10px] uppercase tracking-[.05em] text-text-faint">
        <span>Result</span>
        {result && <CopyButton text={result.text} label="Copy result" />}
      </div>
      {result && result.text.trim().length > 0 ? (
        <>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words px-2 pb-1 font-sans text-[11px] text-text-body">
            {stripTruncationMarker(result.text)}
          </pre>
          {result.truncated && <p className="px-2 pb-1 text-[10px] text-warning">{TRUNCATION_NOTE}</p>}
        </>
      ) : (
        <p className="px-2 pb-1 text-[11px] text-text-faint">No final message</p>
      )}
    </div>
  );
}
