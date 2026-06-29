"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderBrowserDialog } from "@/components/FolderBrowserDialog";
import { callRpc, DaemonRpcError } from "@/lib/rpc/client";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import type { MakeDirParams, MakeDirResult, ValidatePathResult } from "@/lib/rpc/types";

export interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
}

/** S3 — Create Project dialog: name + repo path, live validatePath, [Tạo] gated on validity. */
export function CreateProjectDialog({ open, onClose }: CreateProjectDialogProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [validation, setValidation] = useState<ValidatePathResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [creatingDir, setCreatingDir] = useState(false);
  const createProject = useArtifactStore((s) => s.createProject);

  useEffect(() => {
    if (!path) {
      setValidation(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const result = await callRpc<{ path: string }, ValidatePathResult>("validatePath", { path });
        setValidation(result);
      } catch {
        setValidation(null);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [path]);

  const canCreate = name.trim().length > 0 && !!validation?.exists && validation.isDir && !creating;

  async function handleCreateDir() {
    const trimmed = path.trim();
    if (!trimmed) return;
    setCreatingDir(true);
    setError(null);
    try {
      await callRpc<MakeDirParams, MakeDirResult>("makeDir", { path: trimmed });
      // re-run the authoritative validatePath check rather than trusting the
      // client's "I just made this" claim — same pattern as the debounce effect.
      const result = await callRpc<{ path: string }, ValidatePathResult>("validatePath", { path: trimmed });
      setValidation(result);
    } catch (err) {
      if (err instanceof DaemonRpcError) {
        setError(err.message);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setCreatingDir(false);
    }
  }

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      await createProject(name.trim(), path.trim());
      setName("");
      setPath("");
      setValidation(null);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="w-[480px]">
      <DialogHeader>
        <DialogTitle>Tạo dự án mới</DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Tên dự án</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My API Service" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Đường dẫn repo</label>
          <div className="flex gap-2">
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="…/code/my-service"
            />
            <Button variant="outline" onClick={() => setBrowserOpen(true)}>
              Chọn…
            </Button>
          </div>
          {validation && (
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              {validation.reason === "unc-unsupported" ? (
                <span className="text-destructive">
                  ⚠ UNC paths (\\server\share\...) chưa được hỗ trợ. Hãy dùng đường dẫn ổ đĩa, ví dụ
                  C:\Users\me\code\my-service
                </span>
              ) : validation.exists ? (
                <span>
                  ✓ Thư mục tồn tại · {validation.hasClaudeDir ? ".claude/ đã có (xem xét Import)" : ".claude/ chưa có"}
                </span>
              ) : (
                <>
                  <span>✗ Thư mục không tồn tại</span>
                  {path.trim().length > 0 && (
                    <Button size="sm" variant="outline" disabled={creatingDir} onClick={handleCreateDir}>
                      {creatingDir ? "Đang tạo…" : "Tạo thư mục này"}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Hủy
        </Button>
        <Button disabled={!canCreate} onClick={handleCreate}>
          Tạo dự án
        </Button>
      </DialogFooter>

      <FolderBrowserDialog
        open={browserOpen}
        initialPath={path.trim().length > 0 && validation?.isDir ? path.trim() : undefined}
        onPick={(p) => {
          setPath(p);
          setBrowserOpen(false);
        }}
        onClose={() => setBrowserOpen(false)}
      />
    </Dialog>
  );
}
