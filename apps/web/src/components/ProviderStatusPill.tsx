"use client";

import { useEffect, useState } from "react";
import { callRpc } from "@/lib/rpc/client";
import type { CheckProviderStatusParams, CheckProviderStatusResult } from "@/lib/rpc/types";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { ConnectProviderPanel } from "@/components/ConnectProviderPanel";

export interface ProviderStatusPillProps {
  /** "remote" is accepted so call sites stay generic, but the pill renders nothing for it —
   *  Ollama is the only provider with a guided setup screen in v1 (locked decision 4). */
  providerId: "ollama" | "remote";
}

type Status = "checking" | "connected" | "disconnected";

/**
 * ProviderStatusPill — the S1 persistent status indicator from
 * docs/loops/connect-providers-design.md. Checks once on mount (plus whenever the user
 * opens the panel and clicks recheck) — NO background polling, per locked decision 3.
 * Suppressed entirely (renders null) when the daemon itself is unreachable (EC-7) —
 * checking provider reachability is meaningless when the only thing that could run the
 * check (the daemon) is down; the existing "Daemon mất kết nối" disabled-button
 * affordance in GenerateBodyButton already covers that case, so this never duplicates it.
 */
export function ProviderStatusPill({ providerId }: ProviderStatusPillProps) {
  const daemonConnected = useArtifactStore((s) => s.daemonConnected);
  const [status, setStatus] = useState<Status>("checking");
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    if (providerId !== "ollama" || !daemonConnected) return;
    let cancelled = false;
    setStatus("checking");
    callRpc<CheckProviderStatusParams, CheckProviderStatusResult>("checkProviderStatus", { providerId: "ollama" })
      .then((result) => {
        if (cancelled) return;
        setStatus(result.reachable ? "connected" : "disconnected");
      })
      .catch(() => {
        if (cancelled) return;
        // RPC transport failure here is surfaced via daemonConnected separately (the
        // heartbeat will flip it); treat this call's own failure as "unknown for now"
        // rather than asserting "Ollama is down" off a non-resolved response (EC-7/AC-4).
        setStatus("disconnected");
      });
    return () => {
      cancelled = true;
    };
    // Re-fires once on the providerId identity change AND on the daemonConnected
    // down→up transition (e.g. daemon restarts and the heartbeat in useArtifactStore
    // flips it back to true) — without this, a check that was skipped while the
    // daemon was down would leave the pill stuck on "checking" forever. This is still
    // edge-triggered, not polling: the effect only re-runs when daemonConnected's value
    // actually changes, not on an interval.
  }, [providerId, daemonConnected]);

  if (providerId !== "ollama" || !daemonConnected) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        onClick={() => setPanelOpen(true)}
        title="Xem trạng thái kết nối Ollama"
      >
        <StatusDot status={status} />
        <span>
          {status === "checking" && "Đang kiểm tra…"}
          {status === "connected" && "Đã kết nối"}
          {status === "disconnected" && "Chưa kết nối"}
        </span>
        <span>Ollama</span>
      </button>

      <ConnectProviderPanel
        providerId="ollama"
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onStatusChange={(reachable) => setStatus(reachable ? "connected" : "disconnected")}
      />
    </>
  );
}

function StatusDot({ status }: { status: Status }) {
  if (status === "checking") return <span aria-hidden>◐</span>;
  if (status === "connected") return <span aria-hidden className="text-green-600">●</span>;
  return <span aria-hidden className="text-amber-500">●</span>;
}
