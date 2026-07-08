"use client";

import { useEffect, useState } from "react";
import { Folder, Lock, ArrowUp } from "lucide-react";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
          setError("Không tìm thấy đường dẫn trước đó, về Trang chủ.");
          setCurrentPath(null);
          return;
        }
        setError(err instanceof Error ? err.message : "Lỗi không xác định khi tải danh sách thư mục.");
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
    <Dialog open={open} onClose={onClose} className="w-[480px]">
      <DialogHeader>
        <DialogTitle>Chọn thư mục</DialogTitle>
      </DialogHeader>

      <div className="space-y-2">
        <p className="truncate font-mono text-xs text-text-faint" title={listing?.path ?? currentPath ?? ""}>
          {listing?.path ?? currentPath ?? "Đang tải…"}
        </p>

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="max-h-72 space-y-1 overflow-y-auto rounded-panel border border-border-input p-1">
          {loading && <p className="px-2 py-1 text-xs text-text-muted">Đang tải…</p>}

          {!loading && listing?.parentPath && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-text-body hover:bg-white/[.06]"
              onClick={() => navigateTo(listing.parentPath as string)}
            >
              <ArrowUp className="h-4 w-4" />
              Lên một cấp
            </button>
          )}

          {!loading && listing?.denied && (
            <p className="px-2 py-1.5 text-xs text-text-muted">Không có quyền đọc thư mục này.</p>
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
            <p className="px-2 py-1.5 text-xs text-text-muted">Không có thư mục con.</p>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Hủy
        </Button>
        <Button disabled={!listing || loading} onClick={handleChoose}>
          Chọn thư mục này
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
