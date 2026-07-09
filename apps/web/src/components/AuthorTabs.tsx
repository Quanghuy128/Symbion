"use client";

import { cn } from "@/lib/utils";

export interface AuthorTabsProps {
  authors: Array<{ id: string; label: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
}

/**
 * AuthorTabs — the Authors sub-nav (design doc §3.1, underline-tab style —
 * Open Design Question 2's default, chosen to read as clearly subordinate
 * to AppNav's filled-pill active-state convention). Pure controlled tab
 * selector — does NOT own fetch logic or cache state (same spirit as
 * ProjectPickerStep being presentational-only).
 */
export function AuthorTabs({ authors, selectedId, onSelect }: AuthorTabsProps) {
  return (
    <div className="flex gap-4 border-b border-border" role="tablist" aria-label="Template authors">
      {authors.map((author) => {
        const active = author.id === selectedId;
        return (
          <button
            key={author.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(author.id)}
            className={cn(
              "-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {author.label}
          </button>
        );
      })}
    </div>
  );
}
