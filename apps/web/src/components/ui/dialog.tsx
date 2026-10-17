"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

const TitleIdContext = React.createContext<string | undefined>(undefined);

/** Minimal modal primitive (shadcn-style). No external Radix dependency to keep the
 * v1 surface small. The scrim keeps `fixed` (e2e selectors rely on it). */
export function Dialog({ open, onClose, children, className }: DialogProps) {
  const titleId = React.useId();

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
      className="fixed inset-0 z-dialog flex animate-fadeIn items-center justify-center bg-overlay"
      onClick={onClose}
    >
      <TitleIdContext.Provider value={titleId}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={cn(
            // Fixed-height flex column capped at 85vh. The panel itself does NOT
            // scroll — DialogHeader/DialogFooter are shrink-0 fixed slots and
            // DialogBody is the single scroll region between them, so header +
            // footer stay pinned however tall the content is.
            "flex max-h-[85vh] animate-popIn flex-col rounded-xl bg-surface p-6 text-ink shadow-dialog",
            className,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </TitleIdContext.Provider>
    </div>
  );
}

export function DialogHeader({ children }: { children: React.ReactNode }) {
  // shrink-0: fixed slot — never scrolls, never compresses.
  return <div className="mb-4 flex shrink-0 items-center justify-between gap-3">{children}</div>;
}

export function DialogTitle({ children }: { children: React.ReactNode }) {
  const id = React.useContext(TitleIdContext);
  return (
    <h2 id={id} className="font-display text-dialog-title text-ink">
      {children}
    </h2>
  );
}

export function DialogClose({ onClose, label = "Close" }: { onClose: () => void; label?: string }) {
  return <IconButton aria-label={label} icon={X} size="sm" onClick={onClose} />;
}

/**
 * DialogBody — the single scroll region of a dialog. Sits between the fixed
 * DialogHeader and DialogFooter; `min-h-0 flex-1 overflow-y-auto` lets it fill
 * the available height and scroll internally while header + footer stay pinned.
 */
export function DialogBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>{children}</div>;
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  // shrink-0: fixed slot pinned at the bottom of the panel.
  return (
    <div className="-mx-6 -mb-6 mt-5 flex shrink-0 justify-end gap-2 border-t border-line px-6 py-4">{children}</div>
  );
}
