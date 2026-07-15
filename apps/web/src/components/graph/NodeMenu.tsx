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
  /** command only — run engine v1 (P1). Present + enabled ⇒ Execute is clickable;
   *  absent + executeDisabledReason set ⇒ disabled, reason appended to the label
   *  (RowMenu has no per-item tooltip slot; design R1 wants "disabled + tooltip",
   *  approximated here since RowMenu items are tooltip-less everywhere else too). */
  onExecute?: () => void;
  executeDisabledReason?: string;
}

/**
 * NodeMenu — the per-node ⋯ menu (design §6). A thin, kind-conditional wrapper
 * over the existing `RowMenu` primitive (do NOT invent a new menu). Command gets
 * ▶ Execute… (NEW, top slot — design §3.1 R1, the SOLE P1 entry point per Flaw
 * F8) · Chỉnh sửa · Sao chép lệnh chạy · divider · Xoá(danger); agent gets
 * Chỉnh sửa · divider · Xoá(danger) (agents are never directly executable —
 * commands are the only entry points, §6 locked).
 */
export function NodeMenu({
  kind,
  open,
  onOpenChange,
  onEdit,
  onDelete,
  onCopyRun,
  deleteDisabled,
  onExecute,
  executeDisabledReason,
}: NodeMenuProps) {
  const items =
    kind === "command"
      ? [
          {
            label: executeDisabledReason ? `▶ Execute… (${executeDisabledReason})` : "▶ Execute…",
            onSelect: () => onExecute?.(),
            disabled: !onExecute,
          },
          { label: "Edit", onSelect: onEdit },
          { label: "Copy run command", onSelect: () => onCopyRun?.() },
          ROW_MENU_DIVIDER,
          { label: "Delete", danger: true, disabled: deleteDisabled, onSelect: onDelete },
        ]
      : [
          { label: "Edit", onSelect: onEdit },
          ROW_MENU_DIVIDER,
          { label: "Delete", danger: true, disabled: deleteDisabled, onSelect: onDelete },
        ];

  return <RowMenu open={open} onOpenChange={onOpenChange} items={items} />;
}
