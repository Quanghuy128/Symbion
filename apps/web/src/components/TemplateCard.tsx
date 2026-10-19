"use client";

import type { TemplateListItem } from "@/data/templates/manifest";
import { Badge } from "@/components/ui/badge";
import { Kind } from "@/components/ui/kind";

export interface TemplateCardProps {
  item: TemplateListItem;
  onClick: () => void;
}

const KIND_LABEL: Record<TemplateListItem["kind"], string> = {
  agent: "Agent",
  command: "Command",
  skill: "Skill",
};

/** Whole-card clickable button; kind badge in corner. Keyboard-focusable
 * (native <button>, not a <div onClick>) so Enter opens the modal. */
export function TemplateCard({ item, onClick }: TemplateCardProps) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-lg border border-line-soft bg-surface p-4 text-left transition-colors hover:bg-surface-hover"
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <Kind kind={item.kind === "command" ? "workflow" : item.kind} />
          <span className={item.kind === "command" ? "truncate font-mono text-code text-ink" : "truncate text-ui font-medium text-ink"}>
            {item.kind === "command" ? `/${item.name}` : item.name}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <Badge variant="plain">{KIND_LABEL[item.kind]}</Badge>
        </span>
      </div>
      <p className="line-clamp-2 text-caption text-ink-muted">{item.description}</p>
    </button>
  );
}
