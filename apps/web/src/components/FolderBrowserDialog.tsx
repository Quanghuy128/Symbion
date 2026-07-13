"use client";

import { useEffect, useState } from "react";
import { Folder, Lock, ArrowUp } from "lucide-react";
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { callRpc, DaemonRpcError } from "@/lib/rpc/client";
import type { ListDirParams, ListDirResult } from "@/lib/rpc/types";

export interface FolderBrowserDialogProps {
  open: boolean;
  /** seed path — current `path` input value if non-empty & validated isDir, else undefined (daemon home default). */
  initialPath?: string;
  /** user clicked "Chọn thư mục này" on the currently-listed path. */
  onPick: (path: string) => void;
  onClose: () => void;
}

/**
 * FolderBrowserDialog — daemon-backed in-app directory picker (replaces the
 * dead native-dialog `browseFolder` stub). Read-only navigation: every click
 * re-fetches `listDir` from the live filesystem, never caches across navigation.
 * See docs/loops/create-project-folder-browser-STATE.md §1.3.
 */
export function FolderBrowserDialog({ open, initialPath, onPick, onClose }: FolderBrowserDialogProps) {
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [listing, setListing] = useState<ListDirResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to the seed path every time the dialog is (re-)opened.
  useEffect(() => {
    if (!open) return;
    setCurrentPath(initialPath ?? null);
    setListing(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    callRpc<ListDirParams, ListDirResult>("listDir", { path: currentPath ?? undefined })
      .then((result) => {
        if (cancelled) return;
        setListing(result);
        setCurrentPath(result.path);
      })
      .catch((err) => {
        if (cancelled) return;
        // Stale initialPath (e.g. deleted between dialog-open and the RPC firing) —
        // fall back to the daemon home default instead of leaving the modal stuck.
        if (err instanceof DaemonRpcError && err.code === "invalid-path" && currentPath !== null) {
          setError("Previous path not found, returning Home.");
          setCurrentPath(null);
          return;
        }
        setError(err instanceof Error ? err.message : "Unknown error while loading the folder list.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentPath]);

  if (!open) return null;

  function navigateTo(path: string) {
    setCurrentPath(path);
  }

  function handleChoose() {
    if (listing) onPick(listing.path);
  }

  return (
    // w-[640px] roomier than the old 480px. Header + footer pin via the shared
    // Dialog primitive's fixed slots; the folder list scrolls inside DialogBody.
    <Dialog open={open} onClose={onClose} className="w-[640px]">
      <DialogHeader>
        <DialogTitle>Select a folder</DialogTitle>
      </DialogHeader>

      <DialogBody className="space-y-2">
        <p className="truncate font-mono text-xs text-text-faint" title={listing?.path ?? currentPath ?? ""}>
          {listing?.path ?? currentPath ?? "Loading…"}
        </p>

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="space-y-1 rounded-panel border border-border-input p-1">
          {loading && <p className="px-2 py-1 text-xs text-text-muted">Loading…</p>}

          {!loading && listing?.parentPath && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-text-body hover:bg-white/[.06]"
              onClick={() => navigateTo(listing.parentPath as string)}
            >
              <ArrowUp className="h-4 w-4" />
              Up one level
            </button>
          )}

          {!loading && listing?.denied && (
            <p className="px-2 py-1.5 text-xs text-text-muted">No permission to read this folder.</p>
          )}

          {!loading &&
            !listing?.denied &&
            listing?.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                disabled={entry.unreadable}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-text-body hover:bg-white/[.06] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => !entry.unreadable && navigateTo(entry.path)}
              >
                {entry.unreadable ? <Lock className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                {entry.name}
              </button>
            ))}

          {!loading && !listing?.denied && listing?.entries.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-text-muted">No subfolders.</p>
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!listing || loading} onClick={handleChoose}>
          Select this folder
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
