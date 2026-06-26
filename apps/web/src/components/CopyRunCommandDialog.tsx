"use client";

import { useEffect, useState } from "react";
import type { CanonicalArtifact } from "@symbion/core";
import { renderRunCommand } from "@symbion/core";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface CopyRunCommandDialogProps {
  command: CanonicalArtifact;
  onClose: () => void;
}

/** S13 — Copy run command. String-only, no execution (v1, STATE §8 #7). */
export function CopyRunCommandDialog({ command, onClose }: CopyRunCommandDialogProps) {
  const [requirements, setRequirements] = useState("");
  const [model, setModel] = useState("");
  const [option, setOption] = useState("");
  const [copied, setCopied] = useState(false);
  const [clipboardBlocked, setClipboardBlocked] = useState(false);

  const prompt = renderRunCommand({ command: command.name, requirements, model, option });

  useEffect(() => {
    setCopied(false);
  }, [prompt]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setClipboardBlocked(false);
    } catch {
      setClipboardBlocked(true);
    }
  }

  return (
    <Dialog open onClose={onClose} className="w-[480px]">
      <DialogHeader>
        <DialogTitle>Copy run command — /{command.name}</DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        <Input placeholder="Requirements" value={requirements} onChange={(e) => setRequirements(e.target.value)} />
        <Input placeholder="Model (tùy chọn)" value={model} onChange={(e) => setModel(e.target.value)} />
        <Input placeholder="Option (tùy chọn, ví dụ --gate)" value={option} onChange={(e) => setOption(e.target.value)} />

        <div className="rounded border border-border bg-muted p-2">
          <code className="select-all text-sm">{prompt}</code>
        </div>

        {clipboardBlocked && (
          <p className="text-xs text-amber-600">
            Clipboard bị chặn — đã chọn sẵn văn bản, nhấn ⌘C / Ctrl+C để copy.
          </p>
        )}
        {copied && <p className="text-xs text-green-600">Đã copy vào clipboard.</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button onClick={handleCopy}>Copy</Button>
      </DialogFooter>
    </Dialog>
  );
}
