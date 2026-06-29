"use client";

import { Button } from "@/components/ui/button";

export interface WorkflowDetectionPanelProps {
  hasClaudeDir: boolean;
  hasAgentsMd: boolean;
  /**
   * True once the eager scanClaudeDir result is known to contain something
   * importable (agents+commands+skipped > 0). Drives whether the
   * "Có, nhập vào" action renders at all. importAvailable = hasClaudeDir
   * (only set true by the caller once the eager scan has confirmed content).
   */
  importAvailable: boolean;
  onConfirm: () => void;
  onDecline: () => void;
}

/**
 * Pure presentational "existing workflow detected" panel (design §3
 * wireframes (b)/(c)/(e)). No RPC calls, no internal state.
 */
export function WorkflowDetectionPanel({
  hasClaudeDir,
  hasAgentsMd,
  importAvailable,
  onConfirm,
  onDecline,
}: WorkflowDetectionPanelProps) {
  const foundParts: string[] = [];
  if (hasClaudeDir) foundParts.push(".claude/");
  if (hasAgentsMd) foundParts.push("AGENTS.md (Codex)");

  // Codex-only, informational case (Q5): no import action available.
  if (!importAvailable) {
    return (
      <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
        <p className="font-medium">⚠ Đã phát hiện workflow có sẵn</p>
        <p className="text-xs text-muted-foreground">Tìm thấy: {foundParts.join(", ")}</p>
        <p className="text-xs text-muted-foreground">
          Symbion chưa hỗ trợ nhập (import) từ AGENTS.md ở phiên bản này. File này sẽ không bị ảnh hưởng.
        </p>
        <div className="flex justify-end">
          <Button size="sm" onClick={onDecline}>
            Đã hiểu, tạo trống
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
      <p className="font-medium">⚠ Đã phát hiện workflow có sẵn</p>
      <p className="text-xs text-muted-foreground">
        Tìm thấy: {foundParts.join(", ")}
        {hasAgentsMd && hasClaudeDir ? " (chỉ hiển thị, chưa hỗ trợ nhập)" : ""}
      </p>
      <p className="text-xs text-muted-foreground">
        Bạn có muốn nhập (import) các agent/command đã có vào dự án này không? File gốc trong repo sẽ KHÔNG bị chỉnh sửa.
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onDecline}>
          Không, tạo trống
        </Button>
        <Button size="sm" onClick={onConfirm}>
          Có, nhập vào
        </Button>
      </div>
    </div>
  );
}
