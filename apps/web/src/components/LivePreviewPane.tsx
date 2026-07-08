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
    <div className="flex h-full flex-col border-l border-border-hairline">
      <div className="border-b border-border-hairline px-3 py-2 font-mono text-[12.5px] text-text-faint">
        {artifact.kind === "agent" ? `.claude/agents/${artifact.name || "<name>"}.md` : `.claude/commands/${artifact.name || "<name>"}.md`}
      </div>
      <pre className="flex-1 overflow-auto whitespace-pre-wrap bg-bg-code p-3 font-mono text-[12.5px] text-text-body">
        {preview}
      </pre>
      <div className="border-t border-border-hairline p-2 text-xs">
        {errors.length === 0 && warnings.length === 0 && (
          <p className="text-success">✓ frontmatter hợp lệ · filename khớp name</p>
        )}
        {errors.map((e, i) => (
          <p key={i} className="text-danger">
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
