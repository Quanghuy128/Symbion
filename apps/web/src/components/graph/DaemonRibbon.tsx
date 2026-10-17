"use client";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";

export interface DaemonRibbonProps {
  onRetry: () => void;
}

/**
 * DaemonRibbon (design §5 R, surface R) — top ribbon shown when the daemon
 * connection is lost. The graph stays viewable (pan/zoom/hover); only mutation
 * is gated (handled by the parent disabling affordances). `warning` tint. z-10.
 */
export function DaemonRibbon({ onRetry }: DaemonRibbonProps) {
  return (
    <Banner
      tone="danger"
      className="relative z-10 mb-2"
      action={
        <Button type="button" variant="danger-outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      Daemon disconnected — the graph is read-only.
    </Banner>
  );
}
