"use client";

export interface AuthorFetchLoadingStateProps {
  authorLabel: string;
  /** shown only for GitHub-backed authors, e.g. "github.com/affaan-m/ecc". */
  repoIdentifier?: string;
}

/** AuthorFetchLoadingState — design doc §3.2 (A2 wireframe). Centered
 *  spinner block shown while a GitHub-backed author's first-time-this-
 *  session (or explicit retry) fetch is in flight. */
export function AuthorFetchLoadingState({ authorLabel, repoIdentifier }: AuthorFetchLoadingStateProps) {
  return (
    <div className="flex flex-col items-center gap-1 py-12 text-center">
      <p className="text-sm text-muted-foreground">⟳ Loading templates from {authorLabel}…</p>
      {repoIdentifier && (
        <p className="text-xs text-muted-foreground">Fetching content directly from {repoIdentifier}</p>
      )}
    </div>
  );
}
