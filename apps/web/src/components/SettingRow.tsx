import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SettingRowProps {
  label: ReactNode;
  description?: ReactNode;
  /** The control (select, button, badge...). Rendered on the right. */
  children: ReactNode;
  className?: string;
}

/** Settings row: label + description on the left, control on the right, hairline below. */
export function SettingRow({ label, description, children, className }: SettingRowProps) {
  return (
    <div className={cn("flex items-center justify-between gap-6 border-b border-line py-5", className)}>
      <div className="min-w-0">
        <div className="text-ui text-ink">{label}</div>
        {description ? <div className="mt-0.5 text-caption text-ink-muted">{description}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
