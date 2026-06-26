"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callRpc } from "@/lib/rpc/client";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import type { ValidatePathResult } from "@/lib/rpc/types";

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
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/home/me/code/my-service"
          />
          {validation && (
            <p className="mt-1 text-xs text-muted-foreground">
              {validation.exists
                ? `✓ Thư mục tồn tại · ${validation.hasClaudeDir ? ".claude/ đã có (xem xét Import)" : ".claude/ chưa có"}`
                : "✗ Thư mục không tồn tại"}
            </p>
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
    </Dialog>
  );
}
