"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { renderArtifacts, validateArtifact, type CanonicalArtifact, type LintIssue } from "@symbion/core";

export interface LivePreviewPaneProps {
  artifact: CanonicalArtifact;
  allArtifacts: CanonicalArtifact[];
}

/**
 * LivePreviewPane — debounced (~150ms) client-side `core.render` + `core.validateArtifact`.
 * Pure, no RPC call: render/validate run directly against @symbion/core in the browser.
 */
export function LivePreviewPane({ artifact, allArtifacts }: LivePreviewPaneProps) {
  const [preview, setPreview] = useState("");
  const [issues, setIssues] = useState<LintIssue[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const [file] = renderArtifacts([artifact], "claude", { version: "draft" });
      setPreview(file?.content ?? "");
      setIssues(validateArtifact(artifact, { allArtifacts }));
    }, 150);
    return () => clearTimeout(timer);
  }, [artifact, allArtifacts]);

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-sidebar px-3 font-mono text-code-sm text-ink-3">
        <FileText size={14} strokeWidth={1.6} aria-hidden className="shrink-0 text-ink-muted" />
        <span className="truncate">
          {artifact.kind === "agent" ? `.claude/agents/${artifact.name || "<name>"}.md` : `.claude/commands/${artifact.name || "<name>"}.md`}
        </span>
      </div>
      <pre className="flex-1 overflow-auto whitespace-pre-wrap bg-sidebar p-3 font-mono text-code text-ink">
        {preview}
      </pre>
      <div className="border-t border-line p-2 text-caption">
        {errors.length === 0 && warnings.length === 0 && (
          <p className="text-success">✓ frontmatter valid · filename matches name</p>
        )}
        {errors.map((e, i) => (
          <p key={i} className="text-danger-text">
            ✗ {e.message}
          </p>
        ))}
        {warnings.map((w, i) => (
          <p key={i} className="text-warning">
            ⚠ {w.message}
          </p>
        ))}
      </div>
    </div>
  );
}
