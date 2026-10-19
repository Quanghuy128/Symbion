"use client";

import { useState } from "react";
import { COMMIT_SHA_RE } from "@symbion/core";
import type { UserTemplateSourceSummary } from "@/lib/rpc/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface TemplateSourceHeaderProps {
  source: UserTemplateSourceSummary;
  /** commit sha of the last successful load (from the fetch outcome). */
  commitSha?: string;
  truncated?: boolean;
  daemonConnected: boolean;
  onRemove: () => Promise<void> | void;
}

/** TemplateSourceHeader — one row of facts about a selected user source + Remove (with confirm). Plain text only. */
export function TemplateSourceHeader({ source, commitSha, truncated, daemonConnected, onRemove }: TemplateSourceHeaderProps) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const shaOk = commitSha !== undefined && COMMIT_SHA_RE.test(commitSha);

  async function confirmRemove() {
    setRemoving(true);
    try {
      await onRemove();
    } finally {
      setRemoving(false);
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-1" data-testid="source-header">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-3">
        <a
          href={`https://github.com/${source.owner}/${source.repo}`}
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-ink"
        >
          {source.owner}/{source.repo} ↗
        </a>
        <span>{source.refLabel}</span>
        {source.rootPath && <span className="font-mono text-code">/{source.rootPath}</span>}
        {shaOk && (
          <span>
            viewing commit{" "}
            <a
              href={`https://github.com/${source.owner}/${source.repo}/commit/${commitSha}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-code underline hover:text-ink"
            >
              {commitSha!.slice(0, 7)}
            </a>
          </span>
        )}
        <Button
          variant="danger-outline"
          size="sm"
          disabled={!daemonConnected}
          title={daemonConnected ? undefined : "Daemon offline"}
          onClick={() => setConfirming(true)}
        >
          Remove
        </Button>
      </div>
      {truncated && (
        <p className="text-caption text-warning">
          ⚠ This repository is very large; GitHub returned a partial file listing, so some templates may be missing.
        </p>
      )}
      {confirming && (
        <Dialog open onClose={() => setConfirming(false)} className="w-[440px]">
          <DialogHeader>
            <DialogTitle>Remove source</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-ui text-ink">
              Remove &quot;{source.displayName}&quot;? Only the tab is removed — templates already applied to your
              projects are not changed.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={!daemonConnected || removing} onClick={confirmRemove}>
              {removing ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );
}
