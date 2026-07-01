"use client";

import type { TemplateListItem } from "@/data/templates/manifest";

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
      className="flex flex-col items-start gap-1 rounded-md border border-border p-3 text-left hover:bg-muted"
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">
          {item.kind === "command" ? `/${item.name}` : item.name}
        </span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {KIND_LABEL[item.kind]}
        </span>
      </div>
      <p className="line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
    </button>
  );
}
