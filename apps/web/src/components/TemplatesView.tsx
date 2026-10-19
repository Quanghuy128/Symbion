"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AUTHOR_REGISTRY } from "@symbion/core";
import { DaemonRpcError, initDaemonSession } from "@/lib/rpc/client";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import type { FetchAuthorTemplatesOutcome, UserTemplateSourceSummary } from "@/lib/rpc/types";
import { Button } from "./ui/button";
import { AddTemplateSourceDialog } from "./AddTemplateSourceDialog";
import { TemplateSourceHeader } from "./TemplateSourceHeader";
import { Sidebar } from "./shell/Sidebar";
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

const BUILTIN_GITHUB_AUTHOR_IDS = AUTHOR_REGISTRY.filter((a) => a.kind === "github").map((a) => a.id);
const BUILTIN_TABS = AUTHOR_REGISTRY.map((a) => ({ id: a.id, label: a.displayName, unverified: false }));
/** raw files that hit GitHub's per-file 429 before the extra "retry later" line is shown. */
const RATE_LIMIT_NOTICE_THRESHOLD = 10;

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
  const daemonConnected = useArtifactStore((s) => s.daemonConnected);
  const listTemplateSources = useArtifactStore((s) => s.listTemplateSources);
  const removeTemplateSource = useArtifactStore((s) => s.removeTemplateSource);
  const showToast = useArtifactStore((s) => s.showToast);
  const [userSources, setUserSources] = useState<UserTemplateSourceSummary[]>([]);
  const [invalidSourceCount, setInvalidSourceCount] = useState(0);
  const [maxSources, setMaxSources] = useState(20);
  const [showAdd, setShowAdd] = useState(false);

  const authorTabs = useMemo(
    () => [...BUILTIN_TABS, ...userSources.map((u) => ({ id: u.id, label: u.displayName, unverified: true }))],
    [userSources]
  );
  const githubAuthorIds = useMemo(
    () => new Set([...BUILTIN_GITHUB_AUTHOR_IDS, ...userSources.map((u) => u.id)]),
    [userSources]
  );
  // Latest known tab ids, readable from async continuations (late fetch results for removed ids are dropped).
  const knownIdsRef = useRef<Set<string>>(new Set(BUILTIN_TABS.map((t) => t.id)));
  knownIdsRef.current = new Set(authorTabs.map((t) => t.id));

  const refreshSources = useCallback(async (): Promise<UserTemplateSourceSummary[] | null> => {
    try {
      const res = await listTemplateSources();
      setUserSources(res.sources);
      setInvalidSourceCount(res.invalidCount);
      setMaxSources(res.maxSources);
      // the list is authoritative: drop cache entries of sources that no longer exist
      setAuthorCache((prev) => {
        const keep = new Set([...BUILTIN_GITHUB_AUTHOR_IDS, ...res.sources.map((u) => u.id)]);
        const next: Record<string, AuthorFetchState> = {};
        for (const [k, v] of Object.entries(prev)) if (keep.has(k)) next[k] = v;
        return next;
      });
      return res.sources;
    } catch {
      return null; // keep what we have; built-in tabs never depend on this
    }
  }, [listTemplateSources]);

  // Load on mount and every time the daemon (re)connects.
  useEffect(() => {
    if (daemonConnected) void refreshSources();
  }, [daemonConnected, refreshSources]);

  // A selected source that vanished (removed here or elsewhere) -> back to Symbion.
  useEffect(() => {
    if (selectedAuthorId !== "symbion" && !authorTabs.some((t) => t.id === selectedAuthorId)) {
      // only once the list has had a chance to load, so a deep-linked selection is not dropped early
      setSelectedAuthorId("symbion");
    }
  }, [authorTabs, selectedAuthorId]);

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
      if (!knownIdsRef.current.has(authorId)) return; // source removed meanwhile: drop the late result
      setAuthorCache((prev) => ({ ...prev, [authorId]: result.outcome }));
    } catch (err) {
      if (!knownIdsRef.current.has(authorId)) return;
      const message = err instanceof DaemonRpcError ? err.message : "Unknown error while loading templates.";
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

  async function handleRetry(authorId: string) {
    // A saved source may have been removed/edited elsewhere: re-list first, then fetch only if it still exists.
    if (!BUILTIN_GITHUB_AUTHOR_IDS.includes(authorId)) {
      const fresh = await refreshSources();
      if (fresh && !fresh.some((u) => u.id === authorId)) return;
      knownIdsRef.current.add(authorId);
    }
    void runFetch(authorId);
  }

  async function handleRemove(source: UserTemplateSourceSummary) {
    try {
      await removeTemplateSource({ id: source.id });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not remove the source.", "error");
      void refreshSources(); // reveal whether the removal actually landed
      return;
    }
    setUserSources((prev) => prev.filter((u) => u.id !== source.id));
    setAuthorCache((prev) => {
      const next = { ...prev };
      delete next[source.id];
      return next;
    });
    setSelectedAuthorId("symbion");
    showToast(`Removed '${source.displayName}'`, "success");
  }

  async function handleAdded(source: UserTemplateSourceSummary) {
    setShowAdd(false);
    knownIdsRef.current.add(source.id);
    setUserSources((prev) => (prev.some((u) => u.id === source.id) ? prev : [...prev, source]));
    setSelectedAuthorId(source.id);
    void refreshSources();
    void runFetch(source.id);
    showToast(`Added '${source.displayName}'`, "success");
  }

  function handleOpenExisting(id: string) {
    if (authorTabs.some((t) => t.id === id)) handleSelectAuthor(id);
  }

  const isGithubAuthor = githubAuthorIds.has(selectedAuthorId);
  const currentState: AuthorFetchState = isGithubAuthor
    ? authorCache[selectedAuthorId] ?? { status: "idle" }
    : { status: "success", items: manifest.items, skipped: manifest.skipped };

  const currentAuthorMeta = AUTHOR_REGISTRY.find((a) => a.id === selectedAuthorId);
  const currentUserSource = userSources.find((u) => u.id === selectedAuthorId);
  const currentAuthorLabel = currentUserSource?.displayName ?? currentAuthorMeta?.displayName ?? selectedAuthorId;
  const currentRepoLabel = currentUserSource
    ? `${currentUserSource.owner}/${currentUserSource.repo}`
    : currentAuthorMeta?.kind === "github"
      ? currentAuthorMeta.repoLabel
      : undefined;
  const currentRepoIdentifier = currentRepoLabel ? `github.com/${currentRepoLabel}` : undefined;
  const successMeta =
    currentState.status === "success" && "commitSha" in currentState
      ? { commitSha: currentState.commitSha, truncated: currentState.truncated }
      : { commitSha: undefined, truncated: undefined };

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
    <div className="flex h-screen bg-app text-ink">
      <Sidebar
        onCreateProject={() => router.push("/?createProject=1")}
        onSelectProject={(id) => router.push(`/?openProject=${encodeURIComponent(id)}`)}
      />
      <main className="flex-1 overflow-auto bg-app px-10 py-10">
        <div className="mx-auto max-w-content-wide space-y-6">
          <div>
            <h1 className="font-display text-page-title text-ink">Templates</h1>
            <p className="mt-1 text-body text-ink-3">
              Library of ready-made agent / command / skill templates — preview then apply to your project.
            </p>
          </div>

          <div className="flex items-end gap-4">
            <div className="min-w-0 flex-1">
              <AuthorTabs authors={authorTabs} selectedId={selectedAuthorId} onSelect={handleSelectAuthor} />
            </div>
            <Button
              variant="outline"
              disabled={!daemonConnected || userSources.length >= maxSources}
              title={
                !daemonConnected
                  ? "Daemon offline"
                  : userSources.length >= maxSources
                    ? `Limit of ${maxSources} sources reached`
                    : undefined
              }
              onClick={() => setShowAdd(true)}
            >
              + Add source
            </Button>
          </div>
          {invalidSourceCount > 0 && (
            <p className="text-caption text-warning">
              {invalidSourceCount} saved source{invalidSourceCount === 1 ? "" : "s"} could not be read.
            </p>
          )}

          {currentUserSource && (
            <TemplateSourceHeader
              source={currentUserSource}
              commitSha={successMeta.commitSha}
              truncated={successMeta.truncated}
              daemonConnected={daemonConnected}
              onRemove={() => handleRemove(currentUserSource)}
            />
          )}

          {currentState.status === "loading" && (
            <AuthorFetchLoadingState authorLabel={currentAuthorLabel} repoIdentifier={currentRepoIdentifier} />
          )}

          {currentState.status === "error" && (
            <AuthorFetchErrorPanel
              kind={currentState.kind}
              message={currentState.message}
              resetAt={currentState.resetAt}
              onRetry={() => void handleRetry(selectedAuthorId)}
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
                  {skipped.filter((s) => /\b429\b/.test(s.reason)).length >= RATE_LIMIT_NOTICE_THRESHOLD && (
                    <p className="text-caption text-warning">GitHub is rate-limiting downloads; retry later.</p>
                  )}
                  {items.length === 0 && (
                    <p className="text-caption text-warning">
                      ⚠ Loaded, but no valid templates were found in repo {currentRepoLabel ?? currentAuthorLabel}.
                    </p>
                  )}
                </>
              )}

              {currentUserSource && items.length === 0 && skipped.length === 0 && (
                <div className="space-y-2 text-caption text-ink-muted">
                  <p>
                    No files matched this source&apos;s folders
                    {successMeta.commitSha ? ` at commit ${successMeta.commitSha.slice(0, 7)}` : ""}.
                  </p>
                  <p>If the repository was reorganised, remove this source and add it again.</p>
                  <Button variant="outline" onClick={() => void handleRetry(selectedAuthorId)}>
                    Retry
                  </Button>
                </div>
              )}
            </>
          )}

          <div className="border-t border-line pt-3 text-caption text-ink-muted">
            Get inspired by community template sets (e.g. ECC){" "}
            <a
              href="https://github.com/affaan-m/ecc"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-ink"
            >
              ↗
            </a>
          </div>
        </div>
      </main>

      {showAdd && (
        <AddTemplateSourceDialog
          daemonConnected={daemonConnected}
          onClose={() => setShowAdd(false)}
          onAdded={handleAdded}
          onOpenExisting={handleOpenExisting}
        />
      )}
      {selectedTemplate && (
        <TemplatePreviewModal template={selectedTemplate} onClose={() => setSelectedTemplate(null)} />
      )}
      <Toaster />
    </div>
  );
}
