import * as React from "react";
import { AlertTriangle, CheckCircle2, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BannerProps {
  tone: "danger" | "warning" | "success";
  title?: React.ReactNode;
  /** Pass `null` to hide the icon. */
  icon?: LucideIcon | null;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

const TONE = {
  danger: { box: "bg-danger-soft text-danger-text", icon: XCircle },
  warning: { box: "bg-warning-soft text-warning", icon: AlertTriangle },
  success: { box: "bg-success-soft text-success", icon: CheckCircle2 },
} as const;

/** Inline notice. role="alert" for danger, "status" otherwise. */
export function Banner({ tone, title, icon, action, className, children }: BannerProps) {
  const t = TONE[tone];
  const Icon = icon === undefined ? t.icon : icon;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-md px-3 py-2.5 text-label", t.box, className)}
    >
      {Icon ? <Icon size={16} strokeWidth={1.6} aria-hidden className="mt-0.5 shrink-0" /> : null}
      <div className="min-w-0 flex-1">
        {title != null && <strong className="block font-medium text-ink">{title}</strong>}
        {children != null && <div className={cn(title != null && "mt-0.5")}>{children}</div>}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
