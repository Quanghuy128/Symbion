"use client";

import { X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";

export interface GraphHintBarProps {
  onDismiss: () => void;
}

/**
 * GraphHintBar (design §5 N, surface N) — first-run hint. A STACKED row (never
 * an overlay over nodes) between the status chips and the canvas. Teaches the
 * drag-to-link + ⋯ menu gestures. `[Đã hiểu]` and `[×]` both dismiss (and the
 * parent auto-dismisses on the first successful link). z-10.
 */
export function GraphHintBar({ onDismiss }: GraphHintBarProps) {
  return (
    <div className="relative z-10 mb-2 flex animate-slideIn items-start gap-3 rounded-lg border border-line-soft bg-surface px-4 py-3 text-label text-ink">
      <p className="flex-1 leading-snug">
        ✦ The graph is now editable. Drag from the dot ● on the right of a /command to an agent to link them. Press
        ⋯ on a node for Edit · Delete · Copy run.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-sm bg-mint-soft px-2.5 py-1 text-caption font-medium text-mint-text hover:bg-surface-hover"
        >
          Got it
        </button>
        <IconButton aria-label="Close" icon={X} size="sm" onClick={onDismiss} />
      </div>
    </div>
  );
}
