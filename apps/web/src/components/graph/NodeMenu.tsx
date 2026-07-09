"use client";

import { RowMenu, ROW_MENU_DIVIDER } from "@/components/ui/row-menu";

export interface NodeMenuProps {
  kind: "agent" | "command";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  /** command only. */
  onCopyRun?: () => void;
  deleteDisabled?: boolean;
}

/**
 * NodeMenu — the per-node ⋯ menu (design §6). A thin, kind-conditional wrapper
 * over the existing `RowMenu` primitive (do NOT invent a new menu). Command gets
 * Chỉnh sửa · Sao chép lệnh chạy · divider · Xoá(danger); agent gets
 * Chỉnh sửa · divider · Xoá(danger).
 */
export function NodeMenu({
  kind,
  open,
  onOpenChange,
  onEdit,
  onDelete,
  onCopyRun,
  deleteDisabled,
}: NodeMenuProps) {
  const items =
    kind === "command"
      ? [
          { label: "Chỉnh sửa", onSelect: onEdit },
          { label: "Sao chép lệnh chạy", onSelect: () => onCopyRun?.() },
          ROW_MENU_DIVIDER,
          { label: "Xoá", danger: true, disabled: deleteDisabled, onSelect: onDelete },
        ]
      : [
          { label: "Chỉnh sửa", onSelect: onEdit },
          ROW_MENU_DIVIDER,
          { label: "Xoá", danger: true, disabled: deleteDisabled, onSelect: onDelete },
        ];

  return <RowMenu open={open} onOpenChange={onOpenChange} items={items} />;
}
