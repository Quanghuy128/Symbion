"use client";

/**
 * GraphStatusChips — presentational status row above the Graph tab canvas
 * (design doc §3.2, PLAN §6.2 Q2). Pure presentation: data is computed by the
 * caller (`DependencyGraph`) from already-exported pure values
 * (`ADAPTERS.<target>.capability.lossy` from `@symbion/core`, and the
 * already-used `extractAgentMentions` helper) — this component does not read
 * the store or `@symbion/core` itself, it only renders the booleans/list it's
 * given.
 */
export interface GraphStatusChipsProps {
  claudeLossy: boolean;
  codexLossy: boolean;
  missingAgentMentions: string[];
}

export function GraphStatusChips({ claudeLossy, codexLossy, missingAgentMentions }: GraphStatusChipsProps) {
  return (
    <div className="mb-3 space-y-1.5">
      <div className="flex flex-wrap items-center gap-3 text-[12px] font-medium">
        <span className={`flex items-center gap-1.5 ${claudeLossy ? "text-warning" : "text-success"}`}>
          <span aria-hidden>{claudeLossy ? "▲" : "●"}</span>
          Claude · {claudeLossy ? "lossy" : "clean"}
        </span>
        <span className={`flex items-center gap-1.5 ${codexLossy ? "text-warning" : "text-success"}`}>
          <span aria-hidden>{codexLossy ? "▲" : "●"}</span>
          Codex · {codexLossy ? "lossy" : "clean"}
        </span>
      </div>
      {missingAgentMentions.length > 0 && (
        <p className="text-[12px] text-danger">
          ⚠ {missingAgentMentions.length === 1
            ? `Agent "${missingAgentMentions[0]}" được nhắc đến nhưng không tồn tại.`
            : `${missingAgentMentions.length} agent được nhắc đến nhưng không tồn tại: ${missingAgentMentions.join(", ")}.`}
        </p>
      )}
    </div>
  );
}
