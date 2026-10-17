"use client";

export interface JumpToLatestPillProps {
  count: number;
  onJump: () => void;
}

/** S4b — only rendered while follow is paused AND new rows arrived. */
export function JumpToLatestPill({ count, onJump }: JumpToLatestPillProps) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onJump}
      className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-pill border border-line-soft bg-surface px-3 py-1 text-caption text-ink shadow-menu motion-safe:animate-popIn hover:bg-surface-hover"
    >
      ↓ {count} new · Jump to latest
    </button>
  );
}
