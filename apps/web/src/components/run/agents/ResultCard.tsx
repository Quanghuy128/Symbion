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
      className={`mx-2 my-1 overflow-hidden rounded-sm border border-line border-l-2 bg-surface ${
 agentErrored ? "border-l-danger" : "border-l-success"
 }`}
      data-testid="result-card"
    >
      <div className="flex items-center justify-between px-2 py-0.5 text-overline uppercase text-ink-muted">
        <span>Result</span>
        {result && <CopyButton text={result.text} label="Copy result" />}
      </div>
      {result && result.text.trim().length > 0 ? (
        <>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words px-2 pb-1 font-sans text-caption text-ink">
            {stripTruncationMarker(result.text)}
          </pre>
          {result.truncated && <p className="px-2 pb-1 text-overline text-warning">{TRUNCATION_NOTE}</p>}
        </>
      ) : (
        <p className="px-2 pb-1 text-caption text-ink-muted">No final message</p>
      )}
    </div>
  );
}
