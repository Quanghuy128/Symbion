"use client";

import { Tabs } from "@/components/ui/tabs";

export interface AuthorTabsProps {
  authors: Array<{ id: string; label: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
}

/**
 * AuthorTabs — the Authors sub-nav. Composes the shared underline `Tabs`
 * primitive. Pure controlled tab selector — does NOT own fetch logic or cache
 * state (same spirit as ProjectPickerStep being presentational-only).
 */
export function AuthorTabs({ authors, selectedId, onSelect }: AuthorTabsProps) {
  return (
    <Tabs
      aria-label="Template authors"
      idPrefix="author"
      items={authors.map((a) => ({ id: a.id, label: a.label }))}
      value={selectedId}
      onValueChange={onSelect}
    />
  );
}
