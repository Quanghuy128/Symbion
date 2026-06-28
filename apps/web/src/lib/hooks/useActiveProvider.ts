"use client";

import { useEffect, useState } from "react";
import { callRpc } from "@/lib/rpc/client";
import type { ListProvidersParams, ListProvidersResult, ProviderId } from "@/lib/rpc/types";

export interface ActiveProviderState {
  /** the currently-active provider id, or null if none is configured/active yet
   *  (fresh install / all keys cleared — STATE §5's "no provider selected" state). */
  activeProviderId: ProviderId | null;
  /** true while the one listProviders call this hook fires on mount is in flight. */
  loading: boolean;
}

/**
 * useActiveProvider — fires ONE callRpc("listProviders", {}) on mount (same RPC
 * ProvidersPanel uses — no new RPC method, just a second consumer of the existing
 * result) and derives `activeProviderId` from it. Per
 * docs/loops/multi-provider-settings-STATE.md §4d: a deliberate, visible network call
 * on form mount — NOT silent background polling. Fires once per mount, never on an
 * interval; a settings change made in another tab/component is NOT reflected until
 * this component remounts (documented staleness window, STATE §5).
 */
export function useActiveProvider(): ActiveProviderState {
  const [activeProviderId, setActiveProviderId] = useState<ProviderId | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    callRpc<ListProvidersParams, ListProvidersResult>("listProviders", {})
      .then((result) => {
        if (cancelled) return;
        const active = result.providers.find((p) => p.active);
        setActiveProviderId(active?.id ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setActiveProviderId(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { activeProviderId, loading };
}
