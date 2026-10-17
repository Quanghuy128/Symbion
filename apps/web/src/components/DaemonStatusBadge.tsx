"use client";

import { AlertTriangle } from "lucide-react";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { cn } from "@/lib/utils";

/**
 * Sidebar footer status row. There is exactly one disconnect indicator: on
 * disconnect it turns into a full-width danger-soft strip (louder than the
 * connected state) rather than adding a second banner elsewhere.
 *
 * Only two states: connected vs. the daemon process being unreachable
 * (restart the daemon). `compact` is the icon-rail form: a dot / alert icon
 * with the same words available to assistive tech.
 */
export function DaemonStatusBadge({ compact = false }: { compact?: boolean }) {
  const daemonReachable = useArtifactStore((s) => s.daemonReachable);

  if (daemonReachable) {
    return compact ? (
      <div className="flex justify-center py-3" title="daemon · connected">
        <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
        <span className="sr-only">daemon · connected</span>
      </div>
    ) : (
      <div className="flex items-center gap-2 px-3 py-3 font-mono text-code-sm text-ink-muted">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-success" />
        <span>daemon · connected</span>
      </div>
    );
  }

  const message = "daemon disconnected — Save/Publish temporarily locked. Reconnecting…";
  return (
    <div
      role="alert"
      title={message}
      className={cn(
        "flex w-full items-start gap-2 bg-danger-soft py-2.5 text-caption font-medium text-danger-text",
        compact ? "justify-center px-0" : "px-3",
      )}
    >
      <AlertTriangle size={14} strokeWidth={1.6} aria-hidden className="mt-0.5 shrink-0" />
      <span className={compact ? "sr-only" : undefined}>{message}</span>
    </div>
  );
}
