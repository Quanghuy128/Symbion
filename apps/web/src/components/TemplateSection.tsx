"use client";

import type { TemplateListItem } from "@/data/templates/manifest";
import { TemplateCard } from "./TemplateCard";

export interface TemplateSectionProps {
  title: string;
  items: TemplateListItem[];
  skipped: Array<{ relPath: string; reason: string }>;
  onSelect: (item: TemplateListItem) => void;
}

/**
 * TemplateSection — one labeled section (Skills/Agents/Commands). Renders a
 * card grid for valid items + an inline skipped-items warning line per
 * malformed file (same idiom as ImportReviewStep's
 * "⚠ ... không parse được → bỏ qua (...)"). Never blanks the whole section:
 * an empty section (zero items, e.g. degenerate bundle state) still renders
 * its heading with a muted "Chưa có mẫu nào trong mục này" line, keeping the
 * "exactly three labeled sections" promise (AC1) true even then.
 */
export function TemplateSection({ title, items, skipped, onSelect }: TemplateSectionProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-title text-ink">{title}</h2>

      {items.length === 0 ? (
        <p className="text-caption text-ink-muted">No templates in this section yet.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {items.map((item) => (
            <TemplateCard key={item.id} item={item} onClick={() => onSelect(item)} />
          ))}
        </div>
      )}

      {skipped.map((s) => (
        <p key={s.relPath} className="text-caption text-warning">
          ⚠ {s.relPath} failed to load → skipped ({s.reason})
        </p>
      ))}
    </section>
  );
}
