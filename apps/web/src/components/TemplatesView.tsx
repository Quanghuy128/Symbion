"use client";

import { useEffect, useMemo, useState } from "react";
import { initDaemonSession } from "@/lib/rpc/client";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { AppNav } from "./AppNav";
import { TemplateSection } from "./TemplateSection";
import { TemplatePreviewModal } from "./TemplatePreviewModal";
import { loadTemplateManifest, type TemplateListItem } from "@/data/templates/manifest";

/**
 * TemplatesView — the /templates route's interactive content. Mirrors
 * SettingsShell's session-bootstrap pattern (token + port from the query
 * string, daemon heartbeat) since this is a separate top-level route — but
 * the templates list itself loads with ZERO daemon involvement (bundled
 * client-side, templates-marketplace THINK #2): a daemon-down state never
 * blocks browse/preview/copy, only the Apply step inside the modal.
 */
export function TemplatesView() {
  const startHeartbeat = useArtifactStore((s) => s.startHeartbeat);
  const loadProjects = useArtifactStore((s) => s.loadProjects);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateListItem | null>(null);

  const manifest = useMemo(() => loadTemplateManifest(), []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("t");
    const port = Number(window.location.port) || 12802;
    if (token) {
      initDaemonSession(token, port);
    }
    // Pre-load the project list so the Apply step's picker is never empty
    // due to a missed load if the user lands here directly (not via "/").
    loadProjects().catch(() => {
      useArtifactStore.getState().setDaemonConnected(false);
    });
  }, [loadProjects]);

  useEffect(() => {
    const stop = startHeartbeat();
    return stop;
  }, [startHeartbeat]);

  const byKind = (kind: TemplateListItem["kind"]) => manifest.items.filter((i) => i.kind === kind);
  const skippedFor = (prefix: string) => manifest.skipped.filter((s) => s.relPath.startsWith(prefix));

  return (
    <div className="flex h-screen flex-col">
      <AppNav />
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <div>
            <h1 className="text-lg font-semibold">Templates</h1>
            <p className="text-sm text-muted-foreground">
              Thư viện mẫu agent / command / skill có sẵn — xem trước rồi áp dụng vào dự án của bạn.
            </p>
          </div>

          <TemplateSection
            title="Skills"
            items={byKind("skill")}
            skipped={skippedFor("skills/")}
            onSelect={setSelectedTemplate}
          />
          <TemplateSection
            title="Agents"
            items={byKind("agent")}
            skipped={skippedFor("agents/")}
            onSelect={setSelectedTemplate}
          />
          <TemplateSection
            title="Commands"
            items={byKind("command")}
            skipped={skippedFor("commands/")}
            onSelect={setSelectedTemplate}
          />

          <div className="border-t border-border pt-3 text-xs text-muted-foreground">
            Lấy cảm hứng từ các bộ template cộng đồng (vd. ECC){" "}
            <a
              href="https://github.com/affaan-m/ecc"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              ↗
            </a>
          </div>
        </div>
      </main>

      {selectedTemplate && (
        <TemplatePreviewModal template={selectedTemplate} onClose={() => setSelectedTemplate(null)} />
      )}
    </div>
  );
}
