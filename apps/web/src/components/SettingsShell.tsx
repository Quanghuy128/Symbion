"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { initDaemonSession } from "@/lib/rpc/client";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { AppRail } from "./AppRail";
import { Toaster } from "./ui/toast";
import { ProvidersPanel } from "./ProvidersPanel";

/**
 * SettingsShell — the /settings route's interactive content. Mirrors AppShell's
 * session-bootstrap pattern (token + port from the query string, daemon heartbeat) since
 * this is a separate top-level route, not a child of AppShell — each route that talks to
 * the daemon must independently establish its session (STATE §3.2's "first real second
 * route in apps/web/src/app/").
 */
export function SettingsShell() {
  const router = useRouter();
  const startHeartbeat = useArtifactStore((s) => s.startHeartbeat);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const port = Number(window.location.port) || 12802;
    initDaemonSession(port);
    // tokenless-daemon: no `?t=` session token anymore (it broke on F5). Clear a
    // leftover `?t=` from an old bookmarked URL for a clean URL bar — it's ignored
    // either way.
    if (params.has("t")) {
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
    <div className="flex h-screen bg-bg-app text-text-body">
      <AppRail
        onCreateProject={() => router.push("/?createProject=1")}
        onSelectProject={(id) => router.push(`/?openProject=${encodeURIComponent(id)}`)}
      />
      <main className="flex-1 overflow-auto p-6">
        <h1 className="mb-4 text-lg font-semibold text-text-strong">Nhà cung cấp AI</h1>
        <ProvidersPanel />
      </main>
      <Toaster />
    </div>
  );
}
