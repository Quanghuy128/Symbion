"use client";

import { useEffect } from "react";
import { AlertTriangle, Check, Info, X, type LucideIcon } from "lucide-react";
import { useArtifactStore } from "@/lib/store/useArtifactStore";

/** Auto-dismiss hold (kept for every variant; the store has no close affordance). */
const AUTO_DISMISS_MS = 2200;

const VARIANT: Record<string, { icon: LucideIcon; tone: string }> = {
  success: { icon: Check, tone: "bg-success-soft text-success" },
  warning: { icon: AlertTriangle, tone: "bg-warning-soft text-warning" },
  error: { icon: X, tone: "bg-danger-soft text-danger-text" },
  neutral: { icon: Info, tone: "bg-surface-hover text-ink-3" },
};

/**
 * Toaster — root-mounted single-toast renderer. Reads `toast` directly from
 * the store; no props. Mounted once per route shell. popIn entrance.
 */
export function Toaster() {
  const toast = useArtifactStore((s) => s.toast);
  const dismissToast = useArtifactStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => dismissToast(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast, dismissToast]);

  if (!toast) return null;

  const variant = toast.variant ?? "neutral";
  const { icon: Icon, tone } = (VARIANT[variant] ?? VARIANT.neutral)!;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-toast flex justify-center">
      <div
        role={variant === "error" ? "alert" : "status"}
        className="pointer-events-auto flex animate-popIn items-center gap-3 rounded-lg border border-line-soft bg-surface px-4 py-2.5 text-ui text-ink shadow-toast"
      >
        <span aria-hidden className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${tone}`}>
          <Icon size={12} strokeWidth={2} />
        </span>
        {toast.message}
      </div>
    </div>
  );
}
