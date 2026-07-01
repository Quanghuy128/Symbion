"use client";

import { Button } from "@/components/ui/button";

export interface ApplyResultPanelProps {
  projectName: string;
  finalName: string;
  wasRenamed: boolean;
  onOpenProject: () => void;
  onClose: () => void;
}

/** ApplyResultPanel — T4 success confirmation, the only feedback mechanism
 * for the auto-suffix collision policy (no separate overwrite-confirmation
 * dialog, per templates-marketplace THINK #4). */
export function ApplyResultPanel({ projectName, finalName, wasRenamed, onOpenProject, onClose }: ApplyResultPanelProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-green-600">✓ Đã áp dụng</p>
      {wasRenamed ? (
        <p className="text-sm">
          Đã được thêm vào dự án &quot;{projectName}&quot; với tên &quot;{finalName}&quot; (đã trùng tên với mục có
          sẵn, tự động đổi tên để không ghi đè).
        </p>
      ) : (
        <p className="text-sm">
          &quot;{finalName}&quot; đã được thêm vào dự án &quot;{projectName}&quot; ở dạng nháp.
        </p>
      )}
      <p className="text-xs text-muted-foreground">Trạng thái: nháp (draft) — chưa ghi gì ra repo.</p>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button onClick={onOpenProject}>Mở dự án →</Button>
      </div>
    </div>
  );
}
