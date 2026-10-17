/**
 * Node status rings. Inline `box-shadow` strings built ONLY from CSS variables
 * (design-system tokens) — no hex. The ring is the single status signal on a
 * graph node body; the Kind tile carries the node kind.
 */
export const RING = {
  running: "0 0 0 2px var(--running), 0 0 18px var(--running-soft)",
  done: "0 0 0 2px var(--success)",
  error: "0 0 0 2px var(--danger)",
  cancelled: "0 0 0 2px var(--line-strong)",
  justAdded: "0 0 0 2px var(--mint)",
  highlighted: "0 0 0 2px var(--ink-3)",
} as const;

export interface CommandRingState {
  active: boolean;
  done: boolean;
  error: boolean;
  cancelled: boolean;
  justAdded?: boolean;
  highlighted?: boolean;
}

/** Priority: run status first, then authoring justAdded, then hover-neighbour highlight. */
export function commandRing(s: CommandRingState): string | undefined {
  if (s.active) return RING.running;
  if (s.done) return RING.done;
  if (s.error) return RING.error;
  if (s.cancelled) return RING.cancelled;
  if (s.justAdded) return RING.justAdded;
  if (s.highlighted) return RING.highlighted;
  return undefined;
}

export interface AgentRingState {
  working: boolean;
  settled: boolean;
  error: boolean;
  justAdded?: boolean;
  highlighted?: boolean;
}

export function agentRing(s: AgentRingState): string | undefined {
  if (s.working) return RING.running;
  if (s.settled) return RING.done;
  if (s.error) return RING.error;
  if (s.justAdded) return RING.justAdded;
  if (s.highlighted) return RING.highlighted;
  return undefined;
}
