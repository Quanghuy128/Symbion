"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { callRpc } from "@/lib/rpc/client";
import type { CheckProviderStatusParams, CheckProviderStatusResult, ProviderId } from "@/lib/rpc/types";
import { useArtifactStore } from "@/lib/store/useArtifactStore";

export interface ProviderStatusPillProps {
  /** generalized over the full 4-id union per
   *  docs/loops/multi-provider-settings-STATE.md §3.2 — the
   *  `providerId !== "ollama"` early-return guard is removed; null means "no provider
   *  configured/active yet" (STATE §5's distinct "no provider selected" state). */
  providerId: ProviderId | null;
}

type Status = "checking" | "connected" | "disconnected";

const PROVIDER_LABELS: Record<ProviderId, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

/**
 * ProviderStatusPill — the S1 persistent status indicator from
 * docs/loops/connect-providers-design.md, generalized to all 4 providers. Checks once on
 * mount (plus whenever daemonConnected flips back up) — NO background polling, per locked
 * decision 3. Suppressed entirely (renders null) when the daemon itself is unreachable
 * (EC-7) or when no provider is configured/active yet (providerId === null) — there is
 * nothing meaningful to check in that case; the click-target is "Mở Cài đặt" (Settings),
 * not a per-provider guided-setup dialog (that content now lives in ProvidersPanel under
 * /settings, not a popover triggered from the builder).
 */
export function ProviderStatusPill({ providerId }: ProviderStatusPillProps) {
  const daemonConnected = useArtifactStore((s) => s.daemonConnected);
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    if (!providerId || !daemonConnected) return;
    let cancelled = false;
    setStatus("checking");
    callRpc<CheckProviderStatusParams, CheckProviderStatusResult>("checkProviderStatus", { providerId })
      .then((result) => {
        if (cancelled) return;
        setStatus(result.reachable ? "connected" : "disconnected");
      })
      .catch(() => {
        if (cancelled) return;
        // RPC transport failure here is surfaced via daemonConnected separately (the
        // heartbeat will flip it); treat this call's own failure as "unknown for now"
        // rather than asserting "the provider is down" off a non-resolved response.
        setStatus("disconnected");
      });
    return () => {
      cancelled = true;
    };
    // Re-fires once on the providerId identity change AND on the daemonConnected
    // down->up transition — still edge-triggered, not polling.
  }, [providerId, daemonConnected]);

  if (!providerId || !daemonConnected) {
    return null;
  }

  return (
    <Link
      href="/settings"
      className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
      title="Xem trạng thái kết nối nhà cung cấp AI trong Cài đặt"
    >
      <StatusDot status={status} />
      <span>
        {status === "checking" && "Đang kiểm tra…"}
        {status === "connected" && "Đã kết nối"}
        {status === "disconnected" && "Chưa kết nối"}
      </span>
      <span>{PROVIDER_LABELS[providerId]}</span>
    </Link>
  );
}

function StatusDot({ status }: { status: Status }) {
  if (status === "checking") return <span aria-hidden>◐</span>;
  if (status === "connected") return <span aria-hidden className="text-green-600">●</span>;
  return <span aria-hidden className="text-amber-500">●</span>;
}
