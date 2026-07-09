/**
 * agentBlock — the managed `## Agents` block that lives inside a command's `body`.
 *
 * PURE module (no fs/net/Node imports). This is the machine-parseable channel that
 * carries per-relationship metadata (count + goal) for command→agent edges, per
 * PLAN §6.0 (Option A). It sits inside `body` as an HTML-comment-delimited block so
 * it is invisible in rendered markdown, distinct from the `<!-- managed-by: symbion -->`
 * publish marker, and survives the existing verbatim render/parse round-trip.
 *
 * Byte-stability is the whole point: `setAgentBlock(body, parseAgentBlock(body)) === body`
 * for every input (test U1). See the rules block below.
 *
 * Block format (EXACT):
 *
 *   <!-- symbion:agents -->
 *   ## Agents
 *
 *   - @feature-builder ×2 — Implement the feature per the plan
 *   - @code-reviewer — Independent review of the diff
 *   - @qa
 *   <!-- /symbion:agents -->
 *
 * Line grammar: `- @<name>[ ×<count>][ — <goal>]`
 *   - name:  [A-Za-z0-9_-]+
 *   - ×:     U+00D7 (NOT ASCII 'x')
 *   - —:     U+2014 (NOT ASCII '-')
 *   - count: integer ≥ 1 (never write ×1)
 */

/** A parsed agent reference recovered from the managed block. In-memory only — never its own IR field. */
export interface AgentRef {
  name: string;
  count?: number;
  goal?: string;
}

const OPEN_DELIM = "<!-- symbion:agents -->";
const CLOSE_DELIM = "<!-- /symbion:agents -->";
const HEADING = "## Agents";

/** Multiplication sign U+00D7 and em-dash U+2014 — fixed literals (A7). */
const TIMES = "×";
const EM_DASH = "—";

/**
 * Matches the whole managed block including surrounding blank line(s) so the block can be
 * cleanly excised. We deliberately match at most ONE leading blank line (the placement rule
 * writes exactly one) so that removal restores the pre-block bytes.
 *
 * Group 1 = the block body (everything between the delimiters, exclusive).
 */
const BLOCK_RE = new RegExp(
  `(?:\\n\\n)?${escapeRe(OPEN_DELIM)}\\n([\\s\\S]*?)\\n${escapeRe(CLOSE_DELIM)}`
);

/** Matches a single agent-line inside the block: `- @name[ ×count][ — goal]`. */
const LINE_RE = new RegExp(
  `^- @([A-Za-z0-9_-]+)(?: ${TIMES}(\\d+))?(?: ${EM_DASH} ([\\s\\S]*))?$`
);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True only when BOTH delimiters are present (in order). A half-deleted delimiter ⇒ false (U20/E11). */
export function hasAgentBlock(body: string): boolean {
  const open = body.indexOf(OPEN_DELIM);
  if (open === -1) return false;
  const close = body.indexOf(CLOSE_DELIM, open + OPEN_DELIM.length);
  return close !== -1;
}

/**
 * parseAgentBlock — recover AgentRef[] from the block. Returns [] when no block.
 *
 * TOLERANT: only well-formed `- @…` lines become refs; other lines (heading, blanks, stray
 * text, malformed `- @` lines) are ignored WITHOUT being dropped from the body — plain parse
 * never mutates. Order = first appearance (U7). Only the FIRST em-dash splits goal (U8).
 */
export function parseAgentBlock(body: string): AgentRef[] {
  if (!hasAgentBlock(body)) return [];
  const match = BLOCK_RE.exec(body);
  if (!match) return [];
  const inner = match[1] ?? "";
  const refs: AgentRef[] = [];
  const seen = new Set<string>();
  for (const rawLine of inner.split("\n")) {
    const lineMatch = LINE_RE.exec(rawLine);
    if (!lineMatch) continue;
    const name = lineMatch[1]!;
    if (seen.has(name)) continue;
    seen.add(name);
    const ref: AgentRef = { name };
    if (lineMatch[2] !== undefined) {
      ref.count = Number.parseInt(lineMatch[2], 10);
    }
    if (lineMatch[3] !== undefined) {
      ref.goal = lineMatch[3];
    }
    refs.push(ref);
  }
  return refs;
}

/** Render one canonical agent line. Omits ×count when undefined/≤1/non-integer; omits — goal when empty. */
function renderLine(ref: AgentRef): string {
  let line = `- @${ref.name}`;
  if (ref.count !== undefined && Number.isInteger(ref.count) && ref.count > 1) {
    line += ` ${TIMES}${ref.count}`;
  }
  const goal = ref.goal?.trim();
  if (goal) {
    line += ` ${EM_DASH} ${goal}`;
  }
  return line;
}

/**
 * renderAgentBlock — canonical block text (delimiters + heading + one line per ref).
 * Order preserved as given (do NOT resort). No trailing spaces.
 */
export function renderAgentBlock(refs: AgentRef[]): string {
  const lines = refs.map(renderLine);
  return `${OPEN_DELIM}\n${HEADING}\n\n${lines.join("\n")}\n${CLOSE_DELIM}`;
}

/**
 * setAgentBlock — replace/insert/strip the block in `body`.
 *
 * - refs empty ⇒ strip block entirely (incl. one surrounding blank line) → restores pre-block bytes (U18).
 * - block already present ⇒ replace it IN PLACE with the canonical render, preserving the leading
 *   blank line the original block carried and every byte of prose before AND after it (mid-body /
 *   trailing-prose safe). Does NOT relocate the block to end-of-body.
 * - block absent ⇒ append at end with exactly one blank line before the opening delimiter
 *   when body is non-empty (U14); when body is empty, no leading blank line.
 *
 * Byte-stability: setAgentBlock(body, parseAgentBlock(body)) === body for all inputs (U1), including
 * blocks that are not the last element, because the block is spliced back into its exact span.
 */
export function setAgentBlock(body: string, refs: AgentRef[]): string {
  const match = BLOCK_RE.exec(body);
  if (match) {
    // In-place replace/strip: match[0] spans the (optional) leading "\n\n" + the block.
    const whole = match[0];
    const start = match.index;
    const before = body.slice(0, start);
    const after = body.slice(start + whole.length);
    if (refs.length === 0) {
      // Strip block AND the one leading blank line it captured (restores pre-block bytes).
      return before + after;
    }
    // Preserve the exact leading whitespace the original block had.
    const lead = whole.startsWith("\n\n") ? "\n\n" : "";
    return before + lead + renderAgentBlock(refs) + after;
  }
  // No block present.
  if (refs.length === 0) {
    return body;
  }
  const block = renderAgentBlock(refs);
  if (body.length === 0) {
    return block;
  }
  return `${body}\n\n${block}`;
}

/**
 * upsertAgentRef — add or replace a ref by name. Replacement preserves the ref's position
 * (order preserved, U15); a new name appends at the end of the list (U16). Idempotent by name (U19).
 * Re-renders the block canonically (so any prior malformed lines are dropped — mutation, not plain parse).
 */
export function upsertAgentRef(body: string, ref: AgentRef): string {
  const refs = parseAgentBlock(body);
  const idx = refs.findIndex((r) => r.name === ref.name);
  const normalized = normalizeRef(ref);
  if (idx === -1) {
    refs.push(normalized);
  } else {
    refs[idx] = normalized;
  }
  return setAgentBlock(body, refs);
}

/**
 * removeAgentRef — drop one ref line by name. Removing the last ref removes the whole block
 * and its surrounding blank line, restoring pre-block bytes (U17). No-op if name absent.
 */
export function removeAgentRef(body: string, name: string): string {
  const refs = parseAgentBlock(body).filter((r) => r.name !== name);
  return setAgentBlock(body, refs);
}

/** Normalize a ref so count≤1 / non-integer and empty goal collapse to undefined (keeps render canonical + byte-stable). */
function normalizeRef(ref: AgentRef): AgentRef {
  const out: AgentRef = { name: ref.name };
  if (ref.count !== undefined && Number.isInteger(ref.count) && ref.count > 1) {
    out.count = ref.count;
  }
  const goal = ref.goal?.trim();
  if (goal) {
    out.goal = goal;
  }
  return out;
}
