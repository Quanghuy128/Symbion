"use client";

import { useEffect } from "react";
import { initDaemonSession } from "@/lib/rpc/client";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { AppNav } from "./AppNav";
import { ProvidersPanel } from "./ProvidersPanel";

/**
 * SettingsShell — the /settings route's interactive content. Mirrors AppShell's
 * session-bootstrap pattern (token + port from the query string, daemon heartbeat) since
 * this is a separate top-level route, not a child of AppShell — each route that talks to
 * the daemon must independently establish its session (STATE §3.2's "first real second
 * route in apps/web/src/app/").
 */
export function SettingsShell() {
  const startHeartbeat = useArtifactStore((s) => s.startHeartbeat);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("t");
    const port = Number(window.location.port) || 12802;
    if (token) {
      initDaemonSession(token, port);
      // Strip the token from the URL bar immediately so it doesn't persist in
      // browser history or leak via Referer headers on outbound navigation.
      const url = new URL(window.location.href);
      url.searchParams.delete("t");
      window.history.replaceState(null, "", url.pathname + (url.search !== "?" ? url.search : "") + url.hash);
    }
  }, []);

  useEffect(() => {
    const stop = startHeartbeat();
    return stop;
  }, [startHeartbeat]);

  return (
    <div className="flex h-screen flex-col">
      <AppNav />
      <main className="flex-1 overflow-auto p-6">
        <h1 className="mb-4 text-lg font-semibold">Nhà cung cấp AI</h1>
        <ProvidersPanel />
      </main>
    </div>
  );
}
