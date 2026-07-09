"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AUTHOR_REGISTRY } from "@symbion/core";
import { DaemonRpcError, initDaemonSession } from "@/lib/rpc/client";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import type { FetchAuthorTemplatesOutcome } from "@/lib/rpc/types";
import { AppRail } from "./AppRail";
import { Toaster } from "./ui/toast";
import { AuthorTabs } from "./AuthorTabs";
import { AuthorFetchLoadingState } from "./AuthorFetchLoadingState";
import { AuthorFetchErrorPanel } from "./AuthorFetchErrorPanel";
import { AuthorSkippedSummary } from "./AuthorSkippedSummary";
import { TemplateSection } from "./TemplateSection";
import { TemplatePreviewModal } from "./TemplatePreviewModal";
import { loadTemplateManifest, type TemplateListItem } from "@/data/templates/manifest";

/** Discriminated union backing the in-session author fetch cache (templates-authors
 *  STATE THINK #3 / PLAN §P4). Keyed by authorId; only ever holds entries for
 *  GitHub-backed authors — "symbion" never gets a cache entry (always synchronous,
 *  always "resolved", per design doc's "Open component question" default). */
type AuthorFetchState =
  | { status: "idle" }
  | { status: "loading" }
  | (FetchAuthorTemplatesOutcome & { status: "success" | "error" });

const GITHUB_AUTHORS = AUTHOR_REGISTRY.filter((a) => a.kind === "github");
const AUTHOR_TABS = AUTHOR_REGISTRY.map((a) => ({ id: a.id, label: a.displayName }));

/**
 * TemplatesView — the /templates route's interactive content. Symbion's
 * bundled gallery loads with ZERO daemon/network involvement (unchanged
 * v1 regression, AC1). GitHub-backed authors (ECC) are fetched live via the
 * `fetchAuthorTemplates` RPC, only once the user selects that author's tab,
 * and cached in-memory for the rest of this component's lifetime (THINK #3) —
 * gone on page refresh, never written to disk.
 */
export function TemplatesView() {
  const router = useRouter();
  const startHeartbeat = useArtifactStore((s) => s.startHeartbeat);
  const loadProjects = useArtifactStore((s) => s.loadProjects);
  const fetchAuthorTemplates = useArtifactStore((s) => s.fetchAuthorTemplates);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateListItem | null>(null);
  const [selectedAuthorId, setSelectedAuthorId] = useState<string>("symbion");
  const [authorCache, setAuthorCache] = useState<Record<string, AuthorFetchState>>({});

  const manifest = useMemo(() => loadTemplateManifest(), []);

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

  async function runFetch(authorId: string) {
    setAuthorCache((prev) => ({ ...prev, [authorId]: { status: "loading" } }));
    try {
      const result = await fetchAuthorTemplates({ authorId });
      setAuthorCache((prev) => ({ ...prev, [authorId]: result.outcome }));
    } catch (err) {
      const message = err instanceof DaemonRpcError ? err.message : "Lỗi không xác định khi tải mẫu.";
      setAuthorCache((prev) => ({
        ...prev,
        [authorId]: { status: "error", kind: "network", message },
      }));
    }
  }

  function handleSelectAuthor(authorId: string) {
    setSelectedAuthorId(authorId);
    if (authorId === "symbion") return; // always-resident, no fetch concept
    const existing = authorCache[authorId];
    // THINK #3: switching away and back to an already-resolved (success OR
    // error) author must NOT re-fetch — only first selection or explicit retry.
    if (!existing || existing.status === "idle") {
      void runFetch(authorId);
    }
  }

  function handleRetry(authorId: string) {
    void runFetch(authorId);
  }

  const isGithubAuthor = GITHUB_AUTHORS.some((a) => a.id === selectedAuthorId);
  const currentState: AuthorFetchState = isGithubAuthor
    ? authorCache[selectedAuthorId] ?? { status: "idle" }
    : { status: "success", items: manifest.items, skipped: manifest.skipped };

  const currentAuthorMeta = AUTHOR_REGISTRY.find((a) => a.id === selectedAuthorId);
  const currentAuthorLabel = currentAuthorMeta?.displayName ?? selectedAuthorId;
  const currentRepoIdentifier =
    currentAuthorMeta?.kind === "github" ? `github.com/${currentAuthorMeta.repoLabel}` : undefined;

  const items = currentState.status === "success" ? currentState.items : [];
  const skipped = currentState.status === "success" ? currentState.skipped : [];

  const byKind = (kind: TemplateListItem["kind"]) => items.filter((i) => i.kind === kind);
  // Symbion's bundled `skipped` entries are relPath-prefixed (e.g. "agents/x.ts")
  // so TemplateSection's existing per-bucket filter still works unmodified for
  // that author; GitHub-backed authors' skipped entries are summarized
  // separately below via AuthorSkippedSummary instead (PLAN §P2 step 4/6 —
  // potentially much higher counts than v1's near-zero rate).
  const skippedFor = (prefix: string) => (isGithubAuthor ? [] : skipped.filter((s) => s.relPath.startsWith(prefix)));

  return (
    <div className="flex h-screen bg-bg-app text-text-body">
      <AppRail
        onCreateProject={() => router.push("/?createProject=1")}
        onSelectProject={(id) => router.push(`/?openProject=${encodeURIComponent(id)}`)}
      />
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <div>
            <h1 className="text-lg font-semibold">Templates</h1>
            <p className="text-sm text-muted-foreground">
              Thư viện mẫu agent / command / skill có sẵn — xem trước rồi áp dụng vào dự án của bạn.
            </p>
          </div>

          <AuthorTabs authors={AUTHOR_TABS} selectedId={selectedAuthorId} onSelect={handleSelectAuthor} />

          {currentState.status === "loading" && (
            <AuthorFetchLoadingState authorLabel={currentAuthorLabel} repoIdentifier={currentRepoIdentifier} />
          )}

          {currentState.status === "error" && (
            <AuthorFetchErrorPanel
              kind={currentState.kind}
              message={currentState.message}
              resetAt={currentState.resetAt}
              onRetry={() => handleRetry(selectedAuthorId)}
            />
          )}

          {currentState.status === "success" && (
            <>
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

              {isGithubAuthor && skipped.length > 0 && (
                <>
                  <AuthorSkippedSummary items={skipped} />
                  {items.length === 0 && (
                    <p className="text-xs text-amber-600">
                      ⚠ Đã tải xong nhưng không có mẫu nào hợp lệ trong repo {currentAuthorMeta?.kind === "github" ? currentAuthorMeta.repoLabel : currentAuthorLabel}.
                    </p>
                  )}
                </>
              )}
            </>
          )}

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
      <Toaster />
    </div>
  );
}
