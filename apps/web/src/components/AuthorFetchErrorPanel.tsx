"use client";

import { Button } from "@/components/ui/button";

export interface AuthorFetchErrorPanelProps {
  kind: "network" | "rate-limit" | "not-found";
  message: string;
  /** epoch ms — present iff kind === "rate-limit" and GitHub's X-RateLimit-Reset header was available. */
  resetAt?: number;
  onRetry: () => void;
}

const HEADING_BY_KIND: Record<AuthorFetchErrorPanelProps["kind"], string> = {
  network: "⚠ Could not load templates",
  "rate-limit": "⚠ GitHub API rate limit exceeded",
  "not-found": "⚠ Could not load templates",
};

/** Formats a future epoch-ms timestamp as "HH:MM (còn khoảng N phút)" —
 *  static text computed once at render time (design doc Interaction Notes:
 *  NOT a live-ticking countdown). */
function formatResetTime(resetAt: number): string {
  const date = new Date(resetAt);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const minutesLeft = Math.max(0, Math.round((resetAt - Date.now()) / 60000));
  return `${hh}:${mm} (about ${minutesLeft} min left)`;
}

/**
 * AuthorFetchErrorPanel — design doc §3.3 (A4 generic network), §3.4 (A5
 * rate-limit), plus a "not-found" variant (repo renamed/deleted/private,
 * same visual shape as A4 with distinct copy). Replaces ALL three
 * Skills/Agents/Commands sections (not a per-section state) — distinct
 * from the empty-bucket state (FR6), per the design's own framing.
 */
export function AuthorFetchErrorPanel({ kind, message, resetAt, onRetry }: AuthorFetchErrorPanelProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <p className="text-sm font-medium">{HEADING_BY_KIND[kind]}</p>
      <p className="max-w-md text-xs text-muted-foreground">{message}</p>
      {kind === "rate-limit" && resetAt !== undefined && (
        <p className="text-xs text-muted-foreground">The limit resets at {formatResetTime(resetAt)}.</p>
      )}
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
      {kind === "rate-limit" && (
        <p className="text-[11px] text-muted-foreground">You may still be rate-limited until the reset time above.</p>
      )}
      <p className="text-xs text-muted-foreground">
        ℹ The &quot;Symbion&quot; tab still works normally, no network needed.
      </p>
    </div>
  );
}
