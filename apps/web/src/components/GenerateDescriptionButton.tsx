"use client";

import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface GenerateDescriptionButtonProps {
  currentDescription: string;
  /** synchronous; caller already bound name/body/tools/customFields. */
  onGenerate: () => string;
  onApply: (value: string) => void;
}

/**
 * Icon button that drafts a `description` value from already-in-memory form
 * context via a pure local heuristic (no daemon/network involved — see
 * docs/loops/auto-generate-description-STATE.md §9/§10). Never overwrites a
 * non-empty description without an explicit confirm step (EC-2/FR-4).
 */
export function GenerateDescriptionButton({ currentDescription, onGenerate, onApply }: GenerateDescriptionButtonProps) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingValue, setPendingValue] = useState<string | null>(null);

  function handleClick() {
    if (busyRef.current) return; // EC-5 re-entrancy guard
    busyRef.current = true;
    setBusy(true);
    try {
      const generated = onGenerate();
      if (currentDescription.trim() === "") {
        onApply(generated);
      } else {
        setPendingValue(generated);
        setConfirmOpen(true);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Tạo mô tả tự động"
        title="Tạo mô tả tự động"
        disabled={busy}
        onClick={handleClick}
      >
        <Sparkles className="h-4 w-4" />
      </Button>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogHeader>
          <DialogTitle>Thay thế mô tả?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-text-muted">
          Văn bản mô tả hiện tại sẽ được thay thế — tiếp tục?
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmOpen(false)}>
            Hủy
          </Button>
          <Button
            onClick={() => {
              if (pendingValue !== null) {
                onApply(pendingValue);
              }
              setConfirmOpen(false);
            }}
          >
            Thay thế
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
