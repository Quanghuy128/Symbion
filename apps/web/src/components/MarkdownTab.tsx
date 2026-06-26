"use client";

import { useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import {
  parseClaudeFile,
  renderArtifacts,
  type CanonicalArtifact,
} from "@symbion/core";

export interface MarkdownTabProps {
  artifact: CanonicalArtifact;
  onChange: (next: CanonicalArtifact) => void;
}

/**
 * MarkdownTab — "Theo markdown" tab. Two-way sync against the single in-memory
 * IR (CLAUDE.md design principle #1: "the artifact is the truth"). Editing the
 * raw text re-parses on change; invalid YAML pauses sync-back (E3) — the form
 * keeps its last-good state, never silently clobbered.
 */
export function MarkdownTab({ artifact, onChange }: MarkdownTabProps) {
  const [raw, setRaw] = useState(() => {
    const [file] = renderArtifacts([artifact], "claude", { version: artifact.meta.version });
    return file?.content.replace(/\n*<!-- managed-by:[\s\S]*?-->\s*$/, "") ?? "";
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const [file] = renderArtifacts([artifact], "claude", { version: artifact.meta.version });
    setRaw(file?.content.replace(/\n*<!-- managed-by:[\s\S]*?-->\s*$/, "") ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.id]);

  function handleChange(value: string) {
    setRaw(value);
    try {
      const parsed = parseClaudeFile(value, {
        name: artifact.name || "untitled",
        kind: artifact.kind,
        id: artifact.id,
      });
      setError(null);
      onChange({ ...artifact, ...parsed, id: artifact.id, meta: artifact.meta });
    } catch (err) {
      // Invalid YAML/frontmatter: pause sync-back, keep last-good IR, surface red validity line.
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-2">
      <CodeMirror value={raw} height="360px" extensions={[markdown()]} onChange={handleChange} />
      {error ? (
        <p className="text-xs text-destructive">✗ {error} (Save tạm khoá, dùng bản hợp lệ gần nhất)</p>
      ) : (
        <p className="text-xs text-green-600">✓ markdown hợp lệ, đã đồng bộ vào IR</p>
      )}
    </div>
  );
}
