"use client";

import { useEffect, useState } from "react";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface CancelControlProps {
  onConfirm: () => void;
  /** disabled + label swap while the kill is in flight. */
  cancelling?: boolean;
}

/**
 * CancelControl — the inline two-step cancel (design §3.8; workflow-agent-run
 * relabels it "Stop run" — the ONLY stop, AC-8). Click → confirm
 * prompt (5s auto-revert or click-away reverts) → Stop run. Never a modal;
 * destructive is click-only (Esc never cancels a run — design §5).
 */
export function CancelControl({ onConfirm, cancelling }: CancelControlProps) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 5_000);
    return () => clearTimeout(t);
  }, [confirming]);

  if (cancelling) {
    return <span className="text-caption text-warning">◐ CANCELLING… sending SIGTERM…</span>;
  }

  if (!confirming) {
    return (
      <Button type="button" variant="outline" size="sm" icon={Square} onClick={() => setConfirming(true)}>
        Stop run
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-2 text-caption">
      <span className="text-ink">Stops the whole run, including all subagents. Files already written stay written.</span>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => {
          setConfirming(false);
          onConfirm();
        }}
      >
        Stop run
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>
        Keep running
      </Button>
    </span>
  );
}
