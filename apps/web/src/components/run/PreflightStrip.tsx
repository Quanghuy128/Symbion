"use client";

import type { PreflightCheck } from "@symbion/rpc-types";
import { Button } from "@/components/ui/button";

type PreflightActionKind = NonNullable<PreflightCheck["action"]>["kind"];

export interface PreflightStripProps {
  result: { checks: PreflightCheck[] } | "loading";
  onAction?: (kind: PreflightActionKind) => void;
}

const GLYPH: Record<PreflightCheck["severity"], string> = { ok: "✓", warn: "⚠", block: "✗" };
const COLOR: Record<PreflightCheck["severity"], string> = {
  ok: "text-success",
  warn: "text-warning",
  block: "text-danger",
};

/** PreflightStrip — renders the preflight check rows (design §3.2/§3.3).
 *  blockers = danger ✗ + action; warnings = amber ⚠ + continue; ok = green. */
export function PreflightStrip({ result, onAction }: PreflightStripProps) {
  if (result === "loading") {
    return <p className="text-xs text-text-muted">Preflight · checking…</p>;
  }
  return (
    <ul className="space-y-1">
      {result.checks.map((c) => (
        <li key={c.id} className="flex items-center gap-2 text-xs">
          <span className={COLOR[c.severity]}>{GLYPH[c.severity]}</span>
          <span className={c.severity === "block" ? "text-danger" : "text-text-body"}>{c.label}</span>
          {c.action && (
            <Button
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={() => onAction?.(c.action!.kind)}
            >
              {c.action.label}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
