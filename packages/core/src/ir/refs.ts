/**
 * extractAgentMentions — derive dependency-graph edges from a command body.
 * A mention is `@agentname` or a bare reference to a known agent name token.
 * Pure function: no field is persisted on the IR for this — it's recomputed (STATE §8 #8).
 */

const MENTION_RE = /@([a-zA-Z0-9_-]+)/g;

/**
 * Extract `@name`-style agent mentions from a command/agent body.
 * Returns deduped names in first-seen order.
 */
export function extractAgentMentions(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of body.matchAll(MENTION_RE)) {
    const name = match[1];
    if (!name) continue;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
