"use client";

import { useState } from "react";
import type { AgentRef } from "@symbion/core";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";

export interface EdgeRelationModalProps {
  commandName: string;
  agentName: string;
  /** existing ref (from parseAgentBlock) to prefill count/goal; undefined = plain link. */
  initial?: AgentRef;
  /** persist: builds the canonical AgentRef and calls upsertAgentRef → saveArtifact. Rejects on error. */
  onSave: (ref: AgentRef) => Promise<void>;
  onClose: () => void;
}

/**
 * EdgeRelationModal (design §3.2 L) — per-relationship metadata editor.
 * count `[−] N [+]` stepper (min 1) + optional goal textarea + live preview.
 * count===1 & empty goal → preview shows a plain link + "no label" note (A5).
 * Save maps to AgentRef {name, count: count>1?count:undefined, goal: goal.trim()||undefined}.
 */
export function EdgeRelationModal({
  commandName,
  agentName,
  initial,
  onSave,
  onClose,
}: EdgeRelationModalProps) {
  const [count, setCount] = useState<number>(initial?.count ?? 1);
  const [goal, setGoal] = useState<string>(initial?.goal ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedGoal = goal.trim();
  const countValid = Number.isInteger(count) && count >= 1;
  const decorated = countValid && (count > 1 || trimmedGoal.length > 0);

  async function handleSave() {
    if (!countValid) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: agentName,
        count: count > 1 ? count : undefined,
        goal: trimmedGoal || undefined,
      });
      onClose();
    } catch (err) {
      // Keep the modal open + preserve input on reject (design §3.2 L).
      setError(err instanceof Error ? err.message : "Save failed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} className="w-[420px]">
      <DialogHeader>
        <DialogTitle>Relationship</DialogTitle>
      </DialogHeader>

      <p className="mb-4 text-label">
        <span className="text-workflow">/{commandName}</span>
        <span className="mx-2 text-ink-muted">──►</span>
        <span className="text-agent">{agentName}</span>
      </p>

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-label text-ink-2">Count</label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Decrease"
              disabled={count <= 1}
              onClick={() => setCount((c) => Math.max(1, c - 1))}
            >
              −
            </Button>
            <Input
              type="number"
              min={1}
              step={1}
              value={Number.isNaN(count) ? "" : count}
              onChange={(e) => {
                const v = e.target.value === "" ? NaN : Number.parseInt(e.target.value, 10);
                setCount(v);
              }}
              aria-invalid={!countValid}
              className="w-16 text-center"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Increase"
              onClick={() => setCount((c) => (Number.isInteger(c) ? c + 1 : 1))}
            >
              +
            </Button>
          </div>
          <p className={`mt-1 text-caption ${countValid ? "text-ink-muted" : "text-danger-text"}`}>
            {countValid
              ? "how many times this agent runs in parallel."
              : "Count must be an integer ≥ 1"}
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-label font-medium text-ink">
            Goal (optional)
          </label>
          <Textarea
            rows={3}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="What should this agent accomplish?"
            className="min-h-0 py-2"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-overline uppercase text-ink-muted">
            Edge preview
          </label>
          <div className="rounded-lg border border-line-strong bg-sidebar p-3 text-label">
            {decorated ? (
              <span className="inline-flex items-center gap-2">
                <span className="text-agent">{agentName}</span>
                {count > 1 && (
                  <span className="inline-flex items-center rounded-pill bg-surface px-1.5 py-0.5 text-caption text-mint-text">
                    ×{count}
                  </span>
                )}
                {trimmedGoal && <span className="text-ink-muted">— {trimmedGoal}</span>}
              </span>
            ) : (
              <span className="text-ink-muted">
                <span className="text-agent">{agentName}</span> · This edge will have no label
              </span>
            )}
          </div>
        </div>

        {error && <p className="text-caption text-danger-text">✗ {error}</p>}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!countValid || saving} onClick={handleSave}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
