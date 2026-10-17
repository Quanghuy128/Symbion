"use client";

import { Component, memo, type ReactNode } from "react";
import type { TranscriptRow } from "@symbion/core";
import { StatusGlyph } from "@/components/ui/status-glyph";
import { StepPreview } from "./StepPreview";
import { fmtClock } from "./format";

/** Collapsed row height (px) — the virtual list's uniform row unit. */
export const ROW_H = 20;

/** Per-row render error boundary: "couldn't render this step" (plan §10.5). */
export class RowErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(): void {
    /* swallowed — the panel must never throw */
  }
  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="flex h-5 items-center px-2 text-caption text-ink-muted" role="note">
          couldn&apos;t render this step
        </div>
      );
    }
    return this.props.children;
  }
}

export interface TranscriptRowViewProps {
  row: TranscriptRow;
  expanded: boolean;
  focused: boolean;
  isNew: boolean;
  /** live = pending rows read "waiting…", not interrupted. */
  live: boolean;
  onToggle: (id: string) => void;
  onOpenAgent: (agentId: string) => void;
}

function expandable(row: TranscriptRow): boolean {
  if (row.kind === "spawn") return false;
  if (row.kind === "tool") return true;
  return row.preview !== undefined && ((row.preview.output?.length ?? 0) > 0 || (row.preview.input?.length ?? 0) > 0);
}

/**
 * TranscriptRowView — one transcript step (design §3 S4). All CLI-derived text
 * renders as PLAIN React text (no markdown / innerHTML). Only the glyph
 * carries the danger colour on an error row; the label keeps body colour.
 */
export const TranscriptRowView = memo(function TranscriptRowView({
  row,
  expanded,
  focused,
  isNew,
  live,
  onToggle,
  onOpenAgent,
}: TranscriptRowViewProps) {
  const isSpawn = row.kind === "spawn" && row.childAgentId !== undefined;
  const canExpand = expandable(row);
  const glyphStatus =
    row.kind === "thinking"
      ? "thinking"
      : row.kind === "text"
        ? null
        : row.kind === "system" && row.status === "neutral"
          ? "thinking"
          : row.status === "pending" && isSpawn
            ? "running"
            : row.status;
  const labelClass =
    row.kind === "thinking"
      ? "text-ink-faint"
      : row.kind === "text"
        ? "text-ink-3"
        : row.kind === "system" || row.kind === "unknown"
          ? "text-ink-muted"
          : "text-ink";
  const title = row.resultLabel ? `${row.label} · ${row.resultLabel}` : row.label;

  const activate = () => {
    if (isSpawn) onOpenAgent(row.childAgentId!);
    else if (canExpand) onToggle(row.id);
  };

  return (
    <div className={isNew ? "motion-safe:animate-fadeIn" : undefined} data-row-id={row.id} data-row-kind={row.kind}>
      <button
        type="button"
        aria-expanded={canExpand ? expanded : undefined}
        aria-label={isSpawn ? `Open ${row.label}` : undefined}
        className={`flex h-5 w-full items-center gap-1.5 rounded-sm px-2 text-left text-caption hover:bg-surface-hover ${
 focused ? "bg-surface-hover outline outline-1 outline-focus-ring" : ""
 } ${!canExpand && !isSpawn ? "cursor-default" : ""}`}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === "Enter" && isSpawn) {
            e.preventDefault();
            e.stopPropagation();
            onOpenAgent(row.childAgentId!);
          }
        }}
      >
        <span className="w-8 shrink-0 font-mono text-code-sm tabular-nums text-ink-muted">{fmtClock(row.atMs)}</span>
        {canExpand ? (
          <span className="w-2 shrink-0 text-overline text-ink-muted">{expanded ? "▾" : "▸"}</span>
        ) : (
          <span className="w-2 shrink-0" />
        )}
        {glyphStatus ? <StatusGlyph status={glyphStatus} live={live && glyphStatus === "running"} /> : <span className="w-3 shrink-0" />}
        <span className={`min-w-0 flex-1 truncate ${labelClass}`} title={title}>
          {row.label}
          {row.resultLabel && <span className="text-ink-muted"> · {row.resultLabel}</span>}
        </span>
        {row.legacyTruncated && <span className="shrink-0 text-overline text-ink-muted">pre-upgrade</span>}
        {isSpawn && <span className="shrink-0 text-ink-muted">›</span>}
      </button>
      {expanded && canExpand && (
        <StepPreview
          kind={row.kind}
          preview={row.preview}
          pending={row.status === "pending"}
          interrupted={row.status === "interrupted" && row.preview?.output === undefined}
          legacyTruncated={row.legacyTruncated}
        />
      )}
    </div>
  );
});
