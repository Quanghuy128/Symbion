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
    <section className="space-y-2">
      <h2 className="border-b border-border pb-1 text-sm font-semibold text-muted-foreground">{title}</h2>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No templates in this section yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <TemplateCard key={item.id} item={item} onClick={() => onSelect(item)} />
          ))}
        </div>
      )}

      {skipped.map((s) => (
        <p key={s.relPath} className="text-xs text-amber-600">
          ⚠ {s.relPath} failed to load → skipped ({s.reason})
        </p>
      ))}
    </section>
  );
}
