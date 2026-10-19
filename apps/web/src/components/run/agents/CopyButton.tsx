"use client";

import { useState } from "react";

/** ⧉ copy — copies the STORED preview exactly (never more, never reformatted). */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="text-ink-muted hover:text-ink"
      onClick={(e) => {
        e.stopPropagation();
        try {
          void navigator.clipboard?.writeText(text)?.catch(() => undefined);
        } catch {
          /* clipboard unavailable */
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_200);
      }}
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}
