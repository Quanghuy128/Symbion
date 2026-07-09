/**
 * graphHintSeen — tiny per-user localStorage flag for the interactive-graph
 * first-run hint bar (design §5 N). NOT a store-shape change (A2): this is a
 * client-only preference that persists across sessions/projects, so localStorage
 * is the right home (mirrors the app's other per-user prefs). Guarded for SSR /
 * disabled-storage so it never throws.
 */
const KEY = "symbion.graphHintSeen.v1";

export function hasSeenGraphHint(): boolean {
  if (typeof window === "undefined") return true; // SSR: don't flash the hint pre-hydration
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return true; // storage disabled → behave as "seen" (never nag)
  }
}

export function markGraphHintSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    // ignore — a failed write just means the hint may show again; harmless.
  }
}
