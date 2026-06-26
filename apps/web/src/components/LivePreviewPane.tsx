"use client";

import { useEffect, useState } from "react";
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
    <div className="flex h-full flex-col border-l border-border">
      <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
        {artifact.kind === "agent" ? `.claude/agents/${artifact.name || "<name>"}.md` : `.claude/commands/${artifact.name || "<name>"}.md`}
      </div>
      <pre className="flex-1 overflow-auto whitespace-pre-wrap p-3 text-xs">{preview}</pre>
      <div className="border-t border-border p-2 text-xs">
        {errors.length === 0 && warnings.length === 0 && (
          <p className="text-green-600">✓ frontmatter hợp lệ · filename khớp name</p>
        )}
        {errors.map((e, i) => (
          <p key={i} className="text-destructive">
            ✗ {e.message}
          </p>
        ))}
        {warnings.map((w, i) => (
          <p key={i} className="text-amber-600">
            ⚠ {w.message}
          </p>
        ))}
      </div>
    </div>
  );
}
