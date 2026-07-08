# Feature: designer.md — DESIGN.md as baked-in knowledge, not a "go read that repo" instruction

## Context

On branch `feat/designer-agent-design-md` (not yet merged), `.claude/agents/designer.md` was
modified to add this instruction (paraphrased from the branch, since `docs/loops/` tooling here
has no `git show` access — text taken from the task brief verbatim):

> "Before wireframing, check for `DESIGN.md` at Symbion's own repo root (the
> [google-labs-code/design.md](https://github.com/google-labs-code/design.md) format: YAML
> frontmatter of design tokens — colors, typography, spacing, radii, components — plus a markdown
> body in canonical section order: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes,
> Components, Do's and Don'ts). If present, treat its tokens as binding constraints..."

Current (master) `.claude/agents/designer.md` frontmatter: `tools: Read, Grep, Glob, Write` — no
WebFetch, no network access, by design (this is a static subagent instruction file, not a runtime
agent with fetch capability).

**User complaint (in original Vietnamese):** "tôi cần add knowledge của
https://github.com/google-labs-code/design.md chứ không phải bắt đọc repo này trước wireframe" —
translation: "I need to add the *knowledge from* that DESIGN.md spec, not force [the designer
subagent] to read that repo before wireframing." The instruction as currently phrased reads like a
fetch/browse directive the agent has no tool to satisfy — it should instead read like a fact the
agent already knows.

## Requirements (informal, derived from user statement — no separate BA pass was run for this
micro-fix; treating this section as the spec since it's a single unambiguous wording fix)

- The DESIGN.md token schema (YAML frontmatter fields: colors, typography, spacing, radii,
  components) and canonical section order (Overview, Colors, Typography, Layout, Elevation &
  Depth, Shapes, Components, Do's and Don'ts) must be usable by the designer agent **without any
  fetch/read of an external URL or repo**.
- The GitHub link should not be removed — keep it as attribution/source-of-truth pointer, but not
  phrased as an actionable "go check/read this repo" step.
- No new tool capability (WebFetch, network) should be added to `designer.md`'s frontmatter.
- Scope: wording/content fix only, confined to `.claude/agents/designer.md`.

---

## Solution Options

### Option A — Inline the DESIGN.md schema as a compact reference block/table in designer.md (RECOMMENDED)

Replace the "go check DESIGN.md at repo root, it's in the google-labs-code/design.md format"
phrasing with a self-contained reference block placed under Principles (or as a new numbered
subsection, e.g. "### DESIGN.md token format (reference)") that spells out:
- The YAML frontmatter shape (a short fenced-code example with the actual field names: colors,
  typography, spacing, radii, components — as a token schema, not prose).
- The canonical markdown body section order as a literal ordered list: Overview → Colors →
  Typography → Layout → Elevation & Depth → Shapes → Components → Do's and Don'ts.
- The existing behavior clause unchanged: "If a `DESIGN.md` file exists at Symbion's repo root,
  treat its tokens as binding constraints on your wireframes/component breakdown."
- A trailing footnote: "(Format: [google-labs-code/design.md](https://github.com/google-labs-code/design.md) — source of truth if this schema needs to be re-verified.)"

**Trade-offs**
- Pro: Fully satisfies the "knowledge baked in, not fetch-required" requirement — agent has
  everything it needs from its own instruction file, zero ambiguity about what "the format" means.
- Pro: Cheapest possible fix — no new tool, no new file, no runtime dependency.
- Con: Schema is now duplicated between `designer.md` and the upstream spec; if
  google-labs-code/design.md's schema changes upstream, `designer.md` silently goes stale (no
  mechanism forces a re-sync). Mitigated by keeping the link as an explicit "source of truth if
  this needs re-verification" footnote (per the task's own risk callout) so a human maintainer
  knows where to look when doing a periodic audit.
- Con: Slightly longer file (a few more lines), but designer.md is already a well-organized
  numbered-sections file, so this fits its existing style (see "### 3. ASCII Wireframes" which
  already inlines a worked example rather than linking out).

### Option B — Keep the GitHub link purely as a citation footnote, describe the schema only in prose (no structured block)

Instead of a schema table/YAML example, just rewrite the existing sentence to be declarative
prose that states the fields and section order inline as a run-on description (similar to how the
task brief itself phrases it), and demote the link to a trailing "(spec:
https://github.com/google-labs-code/design.md)" citation with no instruction verb attached.

**Trade-offs**
- Pro: Minimal diff — arguably a 1-2 sentence edit, even smaller than Option A.
- Pro: Also removes the "go read this repo" phrasing, satisfying the literal complaint.
- Con: Prose-only description of a YAML schema is harder for the agent (and future human editors)
  to parse correctly than a structured block — subagent instructions that describe structured data
  in prose have historically been a source of subtle misreadings (e.g., agent forgets one of the 8
  section names or reorders them). A structured list/table is much more reliable to follow exactly,
  and the task explicitly calls for the section order to be treated as canonical/ordered — that's
  inherently a list, not a sentence.
- Con: Doesn't fully "bake in" the knowledge as richly as Option A; still relies more on the agent's
  general knowledge of the linked format than on the instruction file itself.

### Option C — Two-tier: inline schema block (like Option A) PLUS a short "why this matters" rationale note distinguishing "reference knowledge" from "actionable instruction"

Same as Option A, but additionally adds one explicit sentence clarifying operator intent, e.g.:
"This is background knowledge for interpreting an existing `DESIGN.md` file if the project has
one — you do not need to fetch or browse the GitHub link; it is cited only for provenance." This
makes explicit, for any future editor of designer.md, why the link is present without being an
instruction to act on it — pre-empting a repeat of this exact confusion later.

**Trade-offs**
- Pro: Most robust against regression — directly encodes the "knowledge not instruction"
  distinction the user is flagging, so a future contributor editing designer.md won't
  re-introduce the same "go read the repo" phrasing by accident.
- Con: Marginally more verbose than Option A; the extra meta-sentence is arguably redundant once
  the schema block itself makes it obvious there's nothing left to fetch.
- Con: Slight risk of being over-engineered for what the task explicitly estimates as an S-sized
  wording fix — a meta-comment about "why we phrased it this way" is somewhat unusual for an
  agent instruction file style (other sections in designer.md, e.g. #4 Component Breakdown, don't
  editorialize about their own reasoning).

---

## Ranked Recommendation

1. **Option A** — inline compact reference block (YAML field names + ordered section list) under
   Principles, keep link as a passive "source of truth" footnote. Best fit: satisfies the
   requirement completely, matches designer.md's existing style of inlining concrete examples
   (see wireframe example block), stays exactly S-sized.
2. **Option C** — same as A plus one clarifying meta-sentence. Slightly more defensive against
   future regressions of the same mistake, at marginal extra verbosity cost. Worth it if the team
   wants to institutionalize the "reference vs. instruction" distinction; skippable if not.
3. **Option B** — prose-only rewrite. Smallest diff but weaker fidelity for structured schema data
   (field list + strict section order) that the agent must reproduce exactly; not recommended as
   primary approach, though could be a fallback if the team wants an even smaller patch.

## Files/modules impacted

- `.claude/agents/designer.md` only (on branch `feat/designer-agent-design-md`). No other file in
  `packages/`, `apps/`, or `docs/` needs to change — this is purely a subagent instruction-file
  wording/content fix, not a code or capability change.

## Edge cases / risks (for architect/dev to keep in mind)

- **Schema drift risk**: inlining the DESIGN.md token schema (Option A/C) means `designer.md` can
  go stale if the upstream google-labs-code/design.md format changes its frontmatter fields or
  section order. There is no automated sync — mitigate by keeping the GitHub link visible as an
  explicit "source of truth, re-verify here" pointer (not deleting it), so a human doing a future
  audit has a place to check.
- **Do not add WebFetch/network tooling** to `designer.md`'s frontmatter to "solve" this by letting
  the agent literally fetch the spec at runtime — that would be scope creep into a new capability
  and defeats the point of a static, portable subagent instruction file (and this file's tools are
  deliberately Read/Grob/Write only per project convention).
- **Ambiguous file at repo root**: the existing behavior clause ("If present, treat its tokens as
  binding constraints...") refers to checking for a *literal* `DESIGN.md` file in the target
  project's own repo root via `Read`/`Glob` (which the agent already has tools for) — that part of
  the instruction is fine and should be preserved verbatim; only the *"format" explanation* needs
  to change from "go read this URL" to "here's what that format is, verbatim, below."
- **Scope boundary**: confirm this fix stays confined to the one bullet/section describing the
  DESIGN.md format — do not let the edit sprawl into rewriting other unrelated parts of
  designer.md's Principles section.

## Open questions for user (taste/priority — do not guess)

1. Do you want Option A (lean inline block) or Option C (inline block + explicit "knowledge not
   instruction" meta-sentence)? Both are S-sized; C is marginally more defensive against a repeat
   mistake but slightly more verbose.
2. Should the compact reference block use a fenced YAML example (e.g. showing 1-2 example token
   values per field) or just a bare field-name list? A worked example is more concrete but adds a
   few more lines.
3. Confirm: keep the exact canonical section order as specified in the task (Overview, Colors,
   Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts) — no reordering or
   renaming, since that list is presumably copied faithfully from the upstream spec already.

---

Suggested next step: run `/plan` (architect) once the option choice above is confirmed — though
given this is an S-sized wording fix to a single file with no architecture implications, `/plan`
may be a formality; a direct `/build` (feature-builder or `dev`) could reasonably skip straight
there if the team prefers, since there is no data flow, RPC, or filesystem-safety surface touched
by this change.

---

## Requirements/Analysis (BA pass)

*This section is the Business Analyst's spec pass per the pipeline's THINK phase. It does not
propose architecture or wording options (see "Solution Options" above, which is architect-flavored
content already in this file) — it defines the problem, scope, and verifiable acceptance criteria
that any chosen solution option must satisfy.*

### A.1 Core user need (the "why")

The `designer` subagent's `tools:` frontmatter is `Read, Grep, Glob, Write` — no `WebFetch`, no
`Bash`, no network capability of any kind, on both `master` and the unmerged
`feat/designer-agent-design-md` branch. The agent physically cannot fetch or read
`https://github.com/google-labs-code/design.md` at runtime. It never could, and the instruction
added on that branch never should have implied it could.

The added instruction's phrasing — "the [google-labs-code/design.md] format" with a live-repo
link, appearing right next to "before wireframing" — reads as an instruction to go fetch that URL
each time. That is not merely clunky wording; it is a **broken instruction**: an agent executing it
literally has no tool call available to satisfy it. At best it's silently ignored (quietly
defeating the very feature the branch was written to add, with no error surfaced to anyone); at
worst the agent hallucinates a plausible-looking schema from training-data memory of that repo,
with no guarantee it matches the real spec and no way to verify.

The correct fix is a **knowledge substitution, not a tool-access fix**: the DESIGN.md format spec
(frontmatter token schema + canonical section order) that `google-labs-code/design.md` defines
should be transcribed as static reference material *inside* `designer.md` itself, one time, by a
human editor with real internet access — not fetched by the agent at runtime. The agent then needs
zero network access to be DESIGN.md-aware; it already "knows" the schema the same way it already
knows Tailwind/shadcn conventions elsewhere in the file.

This also removes an unreviewable external dependency: if `google-labs-code/design.md` changes its
schema or disappears upstream, today's phrasing would rot silently (broken forever, or drifting
without anyone noticing), whereas an inlined schema is a fixed point Symbion controls and version-
controls in its own repo, same as the rest of `designer.md`'s conventions.

### A.2 What's broken about the current instruction, precisely

- It names a URL as "the format" the agent should check, in the same breath as an instruction to
  check a *local* file (Symbion's own repo-root `DESIGN.md`). This conflates two different things:
  (a) an external, informal format definition the agent should already *know*, and (b) a local
  file the agent should *read* (legitimately possible today via the `Read` tool).
- Nothing in the current wording distinguishes "format definition" (static knowledge, must be
  inlined) from "the actual local DESIGN.md content for this project" (a runtime file read, for
  which `Read`/`Glob` are already sufficient). A reader can't tell whether the agent is meant to
  fetch the GitHub URL or simply already knows the schema and reads the local file — that
  ambiguity is the bug the user is flagging.
- The instruction has no stated fallback for "what if the agent (correctly) cannot fetch the URL"
  — because the author didn't realize a fetch was implied at all.

### A.3 Functional requirements — what should replace the current wording

1. **Inline the DESIGN.md format schema as static reference material** directly in `designer.md`
   — not a link to fetch, but the actual schema written out:
   - The YAML frontmatter token categories (colors, typography, spacing, radii, components, or
     whatever the real upstream spec defines — transcribed accurately by whoever edits the file,
     as a one-time human authoring task, not guessed by the agent at runtime).
   - The canonical markdown body section order: Overview, Colors, Typography, Layout, Elevation &
     Depth, Shapes, Components, Do's and Don'ts.
   - This should read as a "DESIGN.md format reference" block, citing
     `google-labs-code/design.md` as provenance/attribution only — never as an instruction to
     visit it.
2. **Keep, but reword, the local-file-read instruction.** "Before wireframing, check for
   `DESIGN.md` at Symbion's own repo root (see format reference below). If present, treat its
   tokens as binding constraints..." — this half is legitimate today because `Read`/`Glob` already
   give the agent the ability to check for and read a local file at the project root. No tool
   change needed for this half; it must be preserved, not dropped.
3. The rewritten instruction must make unambiguous that:
   - the *schema knowledge* is baked in (no fetch, ever), and
   - the *file existence check + read* is local-filesystem-only, using tools already granted.

### A.4 Non-functional requirements

- `tools:` frontmatter for `designer` remains **exactly** `Read, Grep, Glob, Write` — unchanged,
  byte-for-byte. This is explicitly a knowledge/wording fix, not a capability upgrade; any solution
  that adds `WebFetch` or similar is out of scope by definition, regardless of which Solution
  Option above is chosen.
- Wording must match `designer.md`'s existing voice/structure: terse, imperative, consistent with
  the current `## Principles` bullets (see `/home/huynq12/symbion/.claude/agents/designer.md`
  lines 9-14) and the file's general style of inlining concrete worked examples rather than
  linking out (see the ASCII wireframe example under "### 3. ASCII Wireframes").
- The fix should stay compact — a short schema block + one ordered list, not a verbatim copy of
  upstream's full README/prose.

### A.5 Explicit constraints and implicit assumptions

- **Constraint**: the agent has no way to verify at runtime that an inlined schema still matches
  the live upstream repo. Accepted tradeoff — static knowledge can drift, same as any hardcoded
  convention elsewhere in the codebase.
- **Constraint** (contrast with precedent): the `templates-authors` feature explicitly chose to
  live-fetch ECC template *content* specifically to avoid staleness/copyright-copying concerns for
  that use case. That precedent does **not** transfer here: ECC content changes meaningfully over
  time and carries copyright sensitivity around copying; a small, stable format-schema convention
  carries neither concern to the same degree, and — decisively — the `designer` agent has no fetch
  tool available at all, so live-fetch isn't a real option regardless of preference.
- **Implicit assumption**: whoever edits `designer.md` to inline the schema will read the actual
  current `google-labs-code/design.md` content once, as a human (or tool-assisted editor) with
  real internet access, outside the agent's own runtime — this BA pass does not itself certify the
  exact schema field list (see Open Question A.6.1).
- **Assumption**: "Symbion's own repo-root `DESIGN.md`" (the local file the agent checks for) is a
  distinct artifact from the *format spec* published at `google-labs-code/design.md` (the external
  reference the format follows). The fix must keep this distinction legible in the wording —
  conflating them is exactly today's bug.

### A.6 Acceptance criteria (verifiable — how to know this is fixed)

1. The rewritten instruction contains **no phrasing that could be read as "fetch/visit/read the
   github.com URL at runtime."** Concretely: no imperative verb ("check", "read", "consult",
   "look at", "browse") is applied directly to the GitHub link; the link appears only as
   parenthetical attribution/provenance for the format convention.
2. The DESIGN.md frontmatter token schema and the canonical section order (Overview, Colors,
   Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts) appear **written out
   inline** in `designer.md` — not merely referenced by name or link.
3. The instruction to check Symbion's own repo-root `DESIGN.md` and treat its tokens as binding
   constraints is preserved — this half was already correct (a local-file read via `Read`/`Glob`,
   tools already granted) and must not be dropped while fixing the other half.
4. `tools:` frontmatter line in `designer.md` is byte-for-byte unchanged (`Read, Grep, Glob,
   Write`) — confirms this stayed a knowledge/wording fix, not a capability change.
5. A reader unfamiliar with the backstory, reading only the new wording, cannot conclude the agent
   is expected to make a network call — the ambiguity that motivated this fix is gone.
6. Wording style/voice is consistent with the surrounding `## Principles` bullets in the same file
   (imperative, terse; no meta-commentary about "this fixes an earlier bug" — the file itself
   should read as if it were always correct).

### A.7 Open questions (need user/architect input — not guessed here)

1. **Exact schema fields**: should the inlined frontmatter schema list the precise field
   names/types from the real live `google-labs-code/design.md` spec (requires one accurate read of
   that upstream repo by whoever implements the fix), or is the approximation already named in the
   branch's original wording ("colors, typography, spacing, radii, components") acceptable as the
   transcribed schema without further verification? This BA pass does not verify upstream content
   itself and defers that fact-check to implementation.
2. **Placement**: should the inlined schema live inside the existing `## Principles` section (near
   the current DESIGN.md-check bullet) or as its own new `##`/`###` subsection later in the file?
   Both satisfy the acceptance criteria above — this is a file-organization taste call (tracked
   also as Open Question 2 under "Solution Options" above, re: Option A vs. C placement/format).
3. **Fallback behavior**: if Symbion's own repo-root `DESIGN.md` is absent, should the agent fall
   back to some default token set, or proceed without binding constraints (current implied,
   unstated behavior)? Not flagged as broken by the user, but worth confirming while this section
   is being touched anyway so it isn't left silently ambiguous.
4. **Branch handling**: this fix applies to an unmerged branch (`feat/designer-agent-design-md`).
   Should the correction land as a new commit on that same branch before merge, or should the
   branch merge as-is with a follow-up fix commit after? No process signal was given by the user;
   flagging so `/plan`/`/build` doesn't assume one silently.

### A.8 Product risk notes (for architect/dev)

- **Silent capability-mismatch risk (general pattern)**: any future instruction added to an agent's
  `.md` file that references an external URL, tool, or resource must be checked against that
  agent's actual `tools:` frontmatter before being worded as an imperative action. This bug class
  (instruction implies a capability the `tools:` list doesn't grant) is easy to reintroduce
  elsewhere in `.claude/agents/*.md` — worth a general review habit, not just a one-off fix here.
- **Schema drift risk**: inlining the DESIGN.md format schema as static text means Symbion's copy
  can go stale relative to future upstream changes in `google-labs-code/design.md`. Low risk given
  the schema's apparent stability and small surface area, but worth an explicit attribution/
  citation line so a future maintainer knows where to re-check if the convention ever needs
  updating (already reflected in "Edge cases / risks" above under "Schema drift risk").
- **No filesystem-write risk introduced**: this fix does not touch publish/export/write paths — it
  is confined to agent-instruction prompt text in `.claude/agents/designer.md`. No interaction with
  the mandatory filesystem-safety rules (no new write paths, no marker/hash/backup implications,
  no RPC surface touched) — `/cso` is not required for this change.

### A.9 Suggested next step

This BA pass locks the problem statement, scope, and acceptance criteria. Combined with the
"Solution Options" analysis already in this file, the remaining decisions are the three taste/
priority questions in A.7 (which overlap with the two Open Questions already listed under
"Solution Options" above). Recommend running `/plan` (architect) next to finalize wording
placement and confirm the schema transcription — even though, as already noted above, this is an
S-sized fix that may not need heavy `/plan` ceremony before `/build`.

---

## Ideas & Open Questions (Analyst / `ba` pass — creative/product review)

*Added by the `ba` agent as a separate creative/product ideation pass, distinct from the
"Requirements/Analysis (BA pass)" section above (that section defines the spec/acceptance criteria;
this section is deliberately exploratory — extra ideas, UX considerations, and things to defer).
Where this section converges with content already in the file (Solution Options, A.7 open
questions), that convergence is called out rather than silently re-derived, and only genuinely new
material is added.*

**Sourcing note**: this pass, like the ones above, had no `git`/bash tool available (only
`Read`/`Grep`/`Glob`/`Write`) and no worktree for `feat/designer-agent-design-md` on disk, so it
relied on the task brief's verbatim description of the change plus the commit message
(`feat(designer agent): make designer DESIGN.md-aware for persistent design tokens`,
`43f579275870bab00b03632e3806de1076003c5a`) rather than a direct diff read. Whoever implements this
should `git show 43f57927:.claude/agents/designer.md` to confirm exact current wording before
editing.

### Ideas beyond the literal fix

1. **A minimal worked YAML+heading example is the single highest-leverage addition** — this
   converges with, and recommends resolving, Open Question 2 (Solution Options) / A.7.2 toward
   "yes, include a worked example, not just a bare field list." A future maintainer skimming
   `designer.md` months from now parses a concrete 6-8 line example far faster than either a prose
   paragraph or a bare field-name list. Illustrative shape (exact field names/values pending A.7.1's
   fact-check against the real upstream spec):

   ```yaml
   ---
   colors:
     primary: "#4F46E5"
     surface: "#0F1115"
   typography:
     heading: "Inter, 24px, 600"
   spacing: [4, 8, 12, 16, 24, 32]
   radii: { sm: 4, md: 8, lg: 16 }
   components: [Button, Card, Input, Dialog]
   ---
   # Overview
   ...
   ```
   This is a "show the shape," not "describe the shape," addition — strictly more useful as static
   reference material and directly responsive to the user's correction (knowledge, not an
   instruction to fetch).

2. **State the "absent DESIGN.md → no fetch, ever" branch explicitly**, not just the "present →
   read it" branch that's already correct in the current wording. The existing analysis (A.2/A.3)
   focuses on distinguishing schema-knowledge from local-file-read; worth adding one more explicit
   sentence covering the case where the local file doesn't exist at all, specifically because a
   fetch-shaped mistake is what triggered this correction in the first place — an agent with no
   local file and vague "know the format" wording could plausibly reach for a fetch attempt if the
   instruction doesn't foreclose it in words. Do NOT extend this into "propose creating a
   DESIGN.md" — that's a distinct, larger idea, flagged as deferred below.

3. **Wording-level test for the URL's placement**: scan the final rewritten text for any sentence
   where the GitHub URL sits next to an instruction verb ("check," "read," "see," "consult,"
   "verify," "browse") — if found, that's exactly the ambiguity that caused this bug and the
   sentence should be rewritten so the link only ever appears in a trailing parenthetical/footnote
   position. This is a concrete, mechanical self-check anyone editing the file can run before
   calling the fix done — complements acceptance criterion A.6.1 above with a simple heuristic for
   applying it.

### Related improvements — explicitly deferred, not proposed for this pass

4. **`code-reviewer`/`architect` schema awareness**: out of scope, for the same reason programmatic
   `DESIGN.md` parsing/validation was already deferred for this feature area (see A.5's
   `templates-authors` precedent discussion and the general principle of not letting adjacent
   agents' awareness ride in on a wording-fix commit). Flagging only as a **Future idea**: if
   `code-reviewer` ever needs to flag hardcoded colors that contradict `DESIGN.md` tokens, that's a
   distinct, larger feature requiring real parsing capability — it should not be added here.
5. **`feature-builder` arguably has more practical reason than `code-reviewer` to know the schema
   exists** (it's the one translating tokens into actual Tailwind/shadcn usage in code) — same
   deferral logic as #4 applies. Worth a one-line note in `docs/learnings.md` after this ships, so
   the next person touching `feature-builder.md` sees this was considered and explicitly deferred,
   not overlooked.
6. **"Propose creating a missing DESIGN.md" is a distinct, larger feature — not this fix.** The
   `designer` agent's `tools:` already includes `Write`, so it's technically reachable, but
   authoring a brand-new project-wide design-token file is a materially bigger behavior change than
   "know an existing format when you see it." Keep this fix scoped to reading/knowing, not
   authoring; note it here only as a **Future idea** so it isn't silently forgotten or silently
   smuggled into this diff.

### UX considerations (human maintainer, months from now)

7. **Staleness is real but low-severity — proportionate mitigation is a one-line dated comment, not
   a version pin or automated check.** If `google-labs-code/design.md` renames a section or adds a
   token category upstream, the failure mode here is "a slightly-off wireframe schema example," not
   a security or data-loss issue (contrast with, e.g., a stale path-confinement rule elsewhere in
   this codebase). Concrete suggestion, additive to the "source of truth footnote" mitigation
   already named in both Solution Options and A.8 above:
   `<!-- schema knowledge as of 2026-07: google-labs-code/design.md's frontmatter+section-order
   spec. Re-verify if a project's real DESIGN.md stops matching this shape. -->` — cheap,
   greppable, and gives a future editor a concrete trigger ("a real DESIGN.md looks mismatched")
   instead of an arbitrary expiry date to chase.
8. **Do not add a version pin, checksum, or automated staleness check.** That's over-engineering for
   a ~10-line static example inside a `.md` prompt file with no build step, no CI, and no runtime
   dependency on the external spec staying current. This repo's `packages/core` purity/testability
   rigor is calibrated for *code* with real failure costs (filesystem safety, provider fidelity); it
   doesn't need to extend to a human-readable illustrative snippet in a subagent prompt file.

### Simplification / deferral

9. **Keep this the smallest possible diff**: a wording edit to the existing DESIGN.md-awareness
   bullet, plus the minimal worked example (idea #1 above). Should NOT grow into: parsing logic, a
   new output section, new tools (`Fetch`/`WebFetch`), changes to other agents, or a "propose
   creating DESIGN.md" feature (idea #6). If implementation touches anything under `apps/` or
   `packages/`, or grants a new tool, that's scope creep relative to what was asked — matches the
   "Files/modules impacted" and A.8's "no filesystem-write risk" conclusions already in this file.
10. **Reconfirming, not re-opening, the deferral of programmatic `DESIGN.md` parsing/validation** for
    other agents (idea #4/#5). Noted here only so a future reader sees this was considered and
    stayed deferred across this pass too, not quietly reconsidered.

### New open questions (additive — do not re-litigate A.7 / Solution-Options questions above)

- **Q-new-1 — Explicit "no fetch, ever" fallback sentence (idea #2)**: worth adding as its own short
  clause, or is it redundant once the schema is fully inlined (i.e., is "there's simply nothing left
  to fetch" self-evident enough that spelling out the negative case is unnecessary)? Leaning toward
  "add it" given this exact ambiguity is what caused the bug, but flagging as a taste call.
- **Q-new-2 — Dated "last verified" comment (idea #7)**: wanted, or unnecessary ceremony for a
  single subagent instruction file? Low stakes either way; a one-line addition, cheap to fold in now
  or skip.
- **Q-new-3 — Process follow-up scope**: should the general "URL next to an instruction verb, check
  against `tools:`" pattern (idea #3 / A.8's silent-capability-mismatch risk) be turned into an
  actual `/audit-process` checklist item across all of `.claude/agents/*.md` as a follow-up, or is
  flagging it here in STATE enough for now? This is a process-improvement scope question, separate
  from the designer.md fix itself — doesn't need to block this fix either way.

### Product risk notes (Analyst pass — additive to A.8 above)

- **No filesystem-safety risk** — reaffirming A.8: this is a wording-only change to a subagent
  system prompt, no new tool grants, no new write paths, no RPC surface touched. Confirming *no*
  new tool (`Fetch`/`WebFetch`) is added is itself a good acceptance criterion for whoever reviews
  the eventual diff (already covered by A.6.4; repeated here because it's the single most important
  guardrail for this fix).
- **General process callout, beyond this one file** (elaborating on A.8's "silent capability-
  mismatch risk" into a concrete mechanical check): grep every `.claude/agents/*.md` for `https://`
  URLs, cross-reference each hit against that file's own `tools:` line for `Fetch`/`WebFetch`, and
  flag any URL sitting next to an instruction verb when the agent has no fetch capability. This
  would catch this exact bug class across all agents, not just `designer`, the next time such an
  audit runs — see Q-new-3 above for whether to act on this now or defer it.

Suggested next step (unchanged, reaffirmed): once the Solution-Options choice, A.7's three open
questions, and this section's Q-new-1/2/3 are resolved by the user, this is small enough to go
straight to `/build` — `/plan` remains optional formality for a single-file wording fix with no
data flow, RPC, or filesystem-safety surface touched.

---

## Verified upstream spec (fetched directly, 2026-07-01 — resolves A.7.1)

None of the 3 BA passes above had fetch/internet access, so all guessed the schema field names
from the task brief's paraphrase ("colors, typography, spacing, radii, components"). Fetched the
real spec directly (`google-labs-code/design.md` → `docs/spec.md` + `examples/atmospheric-glass/DESIGN.md`)
to close Open Question A.7.1. **The guessed schema was wrong on one field name**: it's `rounded`,
not `radii`. Corrected schema:

```yaml
version: <string>
name: <string>
description: <string>
colors:
  <token-name>: <Color>
typography:
  <token-name>: <Typography>
rounded:
  <scale-level>: <Dimension>
spacing:
  <scale-level>: <Dimension | number>
components:
  <component-name>:
    <token-name>: <string|token reference>
```

Canonical section order (confirmed correct in all 3 passes and the original branch wording):
Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts.

## Recommended Next Step

All 3 passes converge on **Option A** (inline compact reference block + worked YAML example,
corrected schema above) as the fix, confined to `.claude/agents/designer.md`, S-sized, no `/cso`
needed. Given the schema is now verified (not guessed) and the fix is a single-file wording change
with no architecture/data-flow implications, recommend skipping `/plan` and going straight to
`/build`, using the corrected schema above rather than the original branch's "radii" guess.

---

## BUILD — implementation notes

### Branch / environment
- Worked on branch `feat/designer-agent-design-md` (checked out from `origin/feat/designer-agent-design-md`,
  which is unmerged into `master`), as required. Confirmed with `git branch --show-current` and
  `git log --oneline -3` before editing — the tip commit was `43f5792 feat(designer agent): make
  designer DESIGN.md-aware for persistent design tokens`, matching the STATE file's description.

### Files changed
- `.claude/agents/designer.md` — the only file touched (`git diff --stat` confirms: 1 file changed,
  42 insertions, 1 deletion). No other file in the repo was modified.

### Exact change landed

Replaced the old Principles bullet (which named the GitHub URL as "the format" right next to
"check for `DESIGN.md`") with a short pointer to a new reference block, plus the new
`### DESIGN.md format reference` subsection inserted between the Principles list and
`## Output per run`. Exact text landed:

Principles bullet (was one long sentence with inline URL + prose schema description; now):
> "- **Before wireframing, check for `DESIGN.md` at Symbion's own repo root** (format reference
> below). If present, treat its tokens as **binding constraints** — don't invent colors/type/spacing
> that conflict with it. If the feature has no visual surface (e.g. a backend-only change), note
> "not applicable — no visual surface" instead of fabricating a design system."

New subsection (verbatim):
> "### DESIGN.md format reference
>
> `DESIGN.md` (if it exists at the repo root) has YAML frontmatter of design tokens followed by a
> markdown body. You already know this shape — no fetch needed. Frontmatter shape:
>
> ```yaml
> ---
> version: "1.0.0"
> name: "symbion-design-system"
> description: "Design tokens for Symbion's desktop UI"
> colors:
>   primary: "#4F46E5"
>   surface: "#0F1115"
> typography:
>   heading: "Inter, 24px, 600"
> rounded:
>   sm: 4
>   md: 8
>   lg: 16
> spacing:
>   xs: 4
>   sm: 8
>   md: 16
> components:
>   Button:
>     radius: "rounded.md"
>     color: "colors.primary"
> ---
> ```
>
> Canonical section order for the markdown body:
> 1. Overview
> 2. Colors
> 3. Typography
> 4. Layout
> 5. Elevation & Depth
> 6. Shapes
> 7. Components
> 8. Do's and Don'ts
>
> There is nothing to fetch here — if no local `DESIGN.md` file exists, proceed without binding
> constraints (per the no-visual-surface / "doesn't exist yet" escape hatches above and in section 7
> below). Any conflict between an existing `DESIGN.md` token and what a wireframe seems to need goes
> under "Open Design Questions" (section 6), never silently resolved. (Format:
> [google-labs-code/design.md](https://github.com/google-labs-code/design.md) — source of truth if
> this schema ever needs re-verification.)"

Everything else in the file (Output-per-run sections 1-7, IMPORTANT section, including the
"google-labs-code canonical section order" mention in section 7's Design System Updates paragraph)
was left untouched — that mention has no URL attached and predates this bug, so it was out of scope
per the STATE file's "Scope boundary" risk note.

### Verification performed (mechanical, not a self-review of correctness/taste — Checker still owns that)
- `grep -n "tools:" .claude/agents/designer.md` → `tools: Read, Grep, Glob, Write` — byte-for-byte
  unchanged, confirmed no new tool was added.
- `grep -n "github.com" .claude/agents/designer.md` → exactly one hit, at the new trailing
  parenthetical footnote in the reference block; zero hits inside the Principles bullet itself.
- Mechanical verb-adjacency scan: `grep -inE "(check|read|consult|see|browse|visit)[^.]*github\.com|github\.com[^.]*(check|read|consult|see|browse|visit)" .claude/agents/designer.md` →
  **zero matches** (this is the Ideas pass's idea #3 self-check, run literally). Confirms no
  instruction verb sits in the same sentence/clause as the GitHub URL anywhere in the file.
- `git diff --stat` → only `.claude/agents/designer.md` changed; no other file touched.
- Used the corrected schema (`rounded`, not `radii`) from the STATE file's "Verified upstream spec"
  section, not the original branch's guessed field name.

### Assumptions made (for Checker to verify)

1. **Placement**: put the new `### DESIGN.md format reference` subsection right after the
   Principles bullet list (after "Write all output in..." bullet) and before `## Output per run`,
   per the task's explicit suggestion ("as its own `###` subsection before '## Output per run'").
   Did not place it inside the Principles bullet list itself as a nested block.
2. **Worked example, not bare list**: included a full fenced YAML example with realistic placeholder
   values (hex colors, font specs, numeric scale values, a `Button` component entry referencing
   `rounded.md`/`colors.primary`) rather than a bare field-name list — per the Ideas pass's top
   recommendation (idea #1) and the task's explicit instruction ("not just bare field names — a
   worked example").
3. **Schema fields used**: `version`, `name`, `description`, `colors`, `typography`, `rounded`,
   `spacing`, `components` — matching the STATE file's "Verified upstream spec" section exactly,
   including nested shapes (`colors.<token>: <Color>`, `rounded.<scale-level>: <Dimension>`,
   `components.<name>.<token>: <string|token reference>`). Represented `<Color>` as a hex string,
   `<Dimension>` as a bare number (px-implied), and one component-token value as a token reference
   string (`"rounded.md"`, `"colors.primary"`) to show the "token reference" variant from the spec,
   not just literal strings.
4. **Footnote phrasing**: used the exact phrasing suggested in Solution Option A / the task brief:
   "(Format: [google-labs-code/design.md](https://github.com/google-labs-code/design.md) — source
   of truth if this schema ever needs re-verification.)" — placed as the final sentence of the new
   subsection, not attached to the Principles bullet at all.
5. **"No fetch, ever" fallback sentence (Ideas pass idea #2 / Q-new-1)**: included it explicitly —
   "There is nothing to fetch here — if no local `DESIGN.md` file exists, proceed without binding
   constraints..." — leaning toward the Ideas pass's stated preference ("leaning toward add it")
   rather than omitting it. Checker should confirm this reads as intended and isn't redundant.
6. **Dated "last verified" HTML comment (Ideas pass idea #7 / Q-new-2)**: did **not** include this.
   The task's explicit instructions (numbered list 1-3) did not ask for it, and it was flagged in
   STATE as optional/low-stakes ("wanted, or unnecessary ceremony... low stakes either way"). Treated
   as out of scope for this pass since the task instructions didn't request it — flagging for
   Checker in case this should be added as a follow-up nice-to-have.
7. **Section 7's existing "google-labs-code canonical section order" mention** (in "Design System
   Updates") was left unchanged — it has no URL/link attached, so it isn't the bug being fixed, and
   the task said to touch only the one bullet plus add the new reference block, not sprawl into
   other Output-per-run sections.
8. **"No visual surface" and "propose conflicts under Open Design Questions" behaviors**: preserved
   verbatim in the Principles bullet (no-visual-surface clause unchanged) and restated the
   conflict-escalation behavior once more inside the new reference block's closing sentence
   ("Any conflict... flag it under 'Open Design Questions' (section 6), never silently resolved") —
   this duplicates in spirit, not verbatim, the existing sentence already in section 7's Design
   System Updates paragraph ("do NOT silently pick a new value — flag it under 'Open Design
   Questions'"). Checker should confirm this duplication reads as reinforcing rather than
   redundant/confusing.

### What was NOT done (explicitly out of scope, confirmed against the task)
- No new tool added to `tools:` frontmatter.
- No file other than `.claude/agents/designer.md` touched.
- No "radii" typo reintroduced anywhere — `rounded` used throughout.
- No commit created (Maker does not commit; that's `/ship`'s job after Checker sign-off).
- No merge/rebase against `master` performed — branch left as-is, only the working tree was edited.

### Next step
Hand off to `/review` (code-reviewer + architect, independent checkers) per pipeline convention —
Maker does not self-review. Checker should re-run the mechanical verb-adjacency grep independently
and re-read the new subsection for voice/style consistency with the rest of `designer.md` (terse,
imperative, no meta-commentary about "this fixes an earlier bug").

## REVIEW

**Security-review trigger check**: `git diff --stat HEAD` shows exactly 1 file changed
(`.claude/agents/designer.md`, 42 insertions, 1 deletion) — no `apps/daemon/` RPC, filesystem-write,
or secret-storage code touched. `/cso` not required.

**code-reviewer verdict: PASS.** Independently re-ran the verb-adjacency grep (zero matches,
confirming AC1). Verified all 6 acceptance criteria (A.6) individually against the literal diff:
schema + section order inlined (AC2), local DESIGN.md check/binding-constraints preserved (AC3),
`tools:` frontmatter byte-for-byte unchanged (AC4), no network-call misreading possible (AC5), voice
matches existing file (AC6). Confirmed schema fields exactly match the verified upstream spec
(`rounded`, not the originally-guessed `radii`). On the Maker's flagged redundancy question (new
block's conflict-escalation sentence vs. section 7's existing sentence): ruled **reasonable
reinforcement, not harmful duplication** — the two sentences fire at different points in the
agent's workflow (wireframing-time vs. section-7-output-time) and don't contradict each other. No
blockers; nits only (a slightly long single-paragraph sentence, and the optional "last verified"
dated comment intentionally omitted).

**architect verdict: PASS.** Confirmed implementation matches Option A design precisely, with the
corrected schema field as a genuine improvement over the original branch text. Also scrutinized the
underlying design decision itself (not just conformance): agrees inlining static knowledge — rather
than adding a fetch tool or deferring the fix — is the right call, since the agent's `tools:`
frontmatter deliberately excludes network capability and a broken/ambiguous instruction is an active
bug, not a deferrable nice-to-have. Schema-drift risk is accepted as low-severity and
self-correcting (a human will notice if a real `DESIGN.md` stops matching the inlined shape), with
the footnote giving an explicit re-verification pointer — agrees a more "engineered" sync mechanism
would be disproportionate for a ~10-line illustrative YAML block. No scope creep (only
`.claude/agents/designer.md` touched, no new tools). One optional non-blocking suggestion: add the
dated "last verified" comment as a trivial follow-up (not required now).

**Aggregate: both PASS, no NEEDS-WORK findings.** Proceeding to `/qa` is optional for this feature
per `/simplify-implementation`-style triviality (no QA section required for a wording-only
subagent-instruction fix with no runtime surface to exercise) — but since this ran through the full
`/analyze` → `/build` → `/review` pipeline rather than the condensed flow, recommend a light `/qa`
pass (or skip straight to `/ship` given both Checkers explicitly found nothing to verify live) is a
judgment call for the user.
