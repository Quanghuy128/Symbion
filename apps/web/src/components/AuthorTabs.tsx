"use client";

import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

export interface AuthorTabsProps {
  authors: Array<{ id: string; label: string; /** user-added source: show the "Unverified" badge. */ unverified?: boolean }>;
  selectedId: string;
  onSelect: (id: string) => void;
}

/**
 * AuthorTabs — the Authors sub-nav. Composes the shared underline `Tabs`
 * primitive. Pure controlled tab selector — does NOT own fetch logic or cache
 * state (same spirit as ProjectPickerStep being presentational-only). The
 * Unverified badge is plain text inside the tab label (no nested button — an
 * interactive element inside role=tab is invalid).
 */
export function AuthorTabs({ authors, selectedId, onSelect }: AuthorTabsProps) {
  return (
    <Tabs
      aria-label="Template authors"
      idPrefix="author"
      items={authors.map((a) => ({
        id: a.id,
        label: a.unverified ? (
          <>
            <span>{a.label}</span>
            <Badge variant="warning">Unverified</Badge>
          </>
        ) : (
          a.label
        ),
      }))}
      value={selectedId}
      onValueChange={onSelect}
    />
  );
}
