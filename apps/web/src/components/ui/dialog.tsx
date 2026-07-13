"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

/** Minimal modal primitive (shadcn-style). No external Radix dependency to keep the
 * v1 surface small; swap for the real shadcn Dialog component when wiring the CLI. */
export function Dialog({ open, onClose, children, className }: DialogProps) {
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-fadeIn bg-black/50"
      onClick={onClose}
    >
      <div
        className={cn(
          // Fixed-height flex column capped at 85vh. The panel itself does NOT
          // scroll — instead DialogHeader/DialogFooter are shrink-0 fixed slots
          // and DialogBody is the single scroll region between them, so the
          // header + footer stay pinned no matter how tall the content is.
          // (A previous version put overflow-y-auto on the whole panel, which
          // made the footer scroll away — see docs/loops/modal-scroll-STATE.md.)
          "animate-popIn flex max-h-[85vh] flex-col rounded-dialog border border-border-hairline bg-bg-panel p-6 text-text-body shadow-dialog",
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({ children }: { children: React.ReactNode }) {
  // shrink-0: fixed slot — never scrolls, never compresses.
  return <div className="mb-4 flex shrink-0 items-center justify-between">{children}</div>;
}

export function DialogTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[15px] font-bold text-text-strong">{children}</h2>;
}

/**
 * DialogBody — the single scroll region of a dialog. Sits between the fixed
 * DialogHeader and DialogFooter; `min-h-0 flex-1 overflow-y-auto` lets it fill
 * the available height and scroll internally while header + footer stay pinned.
 * Optional: dialogs with naturally-short content can skip it (the panel's
 * max-h-[85vh] still bounds them), but any dialog with a long/variable body
 * should wrap that body in DialogBody so its footer pins.
 */
export function DialogBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>{children}</div>;
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  // shrink-0: fixed slot pinned at the bottom of the panel.
  return <div className="mt-6 flex shrink-0 justify-end gap-2">{children}</div>;
}
