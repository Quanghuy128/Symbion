"use client";

import type { AgentStatus, BackgroundStatus, RowStatus } from "@symbion/core";
import { cn } from "@/lib/utils";

export type GlyphStatus = AgentStatus | RowStatus | BackgroundStatus | "thinking";

interface GlyphSpec {
  glyph: string;
  className: string;
  label: string;
  /** pulses while live */
  pulses?: boolean;
}

/** Single source of glyph + colour for every run status (design §3 legend). */
export const GLYPHS: Record<GlyphStatus, GlyphSpec> = {
  starting: { glyph: "◌", className: "text-running", label: "starting", pulses: true },
  running: { glyph: "◉", className: "text-running", label: "running", pulses: true },
  done: { glyph: "✓", className: "text-success", label: "done" },
  ok: { glyph: "✓", className: "text-success", label: "ok" },
  error: { glyph: "✗", className: "text-danger", label: "error" },
  interrupted: { glyph: "◼", className: "text-ink-faint", label: "interrupted" },
  pending: { glyph: "○", className: "text-ink-muted", label: "pending" },
  thinking: { glyph: "·", className: "text-ink-faint", label: "thinking" },
  neutral: { glyph: "?", className: "text-ink-faint", label: "unrecognized" },
  unknown: { glyph: "?", className: "text-ink-faint", label: "unknown" },
};

export interface StatusGlyphProps {
  status: GlyphStatus;
  /** pulse only while live (never on replay/history). */
  live?: boolean;
  size?: "sm" | "md";
  /** override the glyph character (e.g. "·" for a neutral system row). */
  glyphOverride?: string;
  className?: string;
}

export function StatusGlyph({ status, live = false, size = "sm", glyphOverride, className }: StatusGlyphProps) {
  const spec = GLYPHS[status] ?? GLYPHS.unknown;
  const pulse = live && spec.pulses === true;
  return (
    <span
      role="img"
      aria-label={spec.label}
      data-status={status}
      data-pulse={pulse ? "true" : undefined}
      className={cn(
        "inline-flex w-3.5 shrink-0 justify-center leading-none",
        size === "md" ? "text-code" : "text-code-sm",
        spec.className,
        pulse && "motion-safe:animate-livePulse",
        className,
      )}
    >
      {glyphOverride ?? spec.glyph}
    </span>
  );
}
