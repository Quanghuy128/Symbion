"use client";

import type { TemplateToolAssessment } from "@symbion/core";
import { Badge } from "@/components/ui/badge";

export interface ToolRiskPanelProps {
  kind: "agent" | "command" | "skill";
  assessment: TemplateToolAssessment;
}

/**
 * ToolRiskPanel — shows what Apply will actually give an UNVERIFIED template
 * (docs/loops/templates-repo-url-STATE.md §8.6). Everything is rendered as
 * plain text nodes (tool names inside <code> text) — NEVER as HTML: the
 * values come from untrusted remote frontmatter.
 */
export function ToolRiskPanel({ kind, assessment }: ToolRiskPanelProps) {
  const { appliedTools, allToolsImplicit, declaredAllowedTools, inlineShell, hasHighRisk } = assessment;
  return (
    <div
      className={`space-y-2 rounded-md border p-3 text-caption ${hasHighRisk ? "border-danger bg-danger-soft" : "border-line-strong bg-surface-hover"}`}
      data-testid="tool-risk-panel"
    >
      <p className="text-ui font-medium text-ink">Review before applying</p>
      <p className="text-ink-3">
        Unverified source — this text becomes instructions an AI agent will follow. Read the full content before
        applying.
      </p>

      {kind === "agent" && allToolsImplicit && (
        <p className="text-danger-text">
          <Badge variant="danger">High risk</Badge> No tools field — this agent inherits ALL tools (including shell
          and file writes).
        </p>
      )}

      {kind === "agent" && appliedTools.length > 0 && (
        <div>
          <p className="text-ink-3">Tools this agent will request:</p>
          <ul className="mt-1 space-y-1">
            {appliedTools.map((t, i) => (
              <li key={`${t.name}-${i}`} className="flex flex-wrap items-center gap-2">
                <code className={t.level === "high" ? "font-mono text-code text-danger-text" : "font-mono text-code text-ink"}>
                  {t.name}
                </code>
                {t.level === "high" && <Badge variant="danger">High risk</Badge>}
                {t.level === "high" && t.reason && <span className="text-danger-text">{t.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {kind !== "agent" && declaredAllowedTools.length > 0 && (
        <div>
          <p className="text-ink-3">
            Declares <code className="font-mono text-code">allowed-tools</code> (declared in the file, not applied by
            Symbion):
          </p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {declaredAllowedTools.map((t, i) => (
              <li key={`${t}-${i}`}>
                <code className="font-mono text-code text-ink">{t}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {inlineShell && (
        <p className="text-danger-text">
          <Badge variant="danger">High risk</Badge> The body contains inline shell commands that run when the
          command is used.
        </p>
      )}

      <p className="text-ink-muted">
        Only the name, description, tools and body are applied — other frontmatter (such as allowed-tools, model,
        permissionMode or hooks) is dropped.
      </p>
    </div>
  );
}
