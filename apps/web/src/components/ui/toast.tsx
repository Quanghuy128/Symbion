"use client";

import { useEffect } from "react";
import { useArtifactStore } from "@/lib/store/useArtifactStore";

/** Auto-dismiss hold, per DESIGN.md's Toast token (`auto-dismiss-ms: 2200`). */
const AUTO_DISMISS_MS = 2200;

/**
 * Toaster — root-mounted single-toast renderer (Q4). Reads `toast` directly
 * from the store; no props. Mounted once per route shell (AppShell,
 * TemplatesView, SettingsShell) per PLAN §6.9 step 1. popIn entrance, plain
 * fade-out on auto-dismiss (design doc §5 Interaction Notes).
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

  // interactive-graph (design §5/§7): 4 variants. glyph + text color per variant;
  // placement/motion/timing unchanged.
  const variant = toast.variant ?? "neutral";
  const glyph =
    variant === "success" ? "✓" : variant === "warning" ? "⚠" : variant === "error" ? "✕" : null;
  const textColor =
    variant === "success"
      ? "text-success"
      : variant === "warning"
        ? "text-warning"
        : variant === "error"
          ? "text-danger"
          : "text-text-body";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
      <div
        role="status"
        className={`pointer-events-auto flex animate-popIn items-center gap-2 rounded-panel border border-border-menu bg-bg-menu px-4 py-2.5 text-sm shadow-toast ${textColor}`}
      >
        {glyph && <span aria-hidden>{glyph}</span>}
        {toast.message}
      </div>
    </div>
  );
}
