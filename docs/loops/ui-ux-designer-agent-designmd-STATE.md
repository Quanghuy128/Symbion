# ui-ux-designer-agent-designmd — STATE

## Phase: SHIP

## 0. Origin

User request: "add ui ux designer agent with https://github.com/google-labs-code/design.md"

`google-labs-code/design.md` defines the **DESIGN.md format spec**: a file
with YAML frontmatter (design tokens — colors, typography, spacing, radii,
components) plus a markdown body with fixed canonical sections in order:
Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components,
Do's and Don'ts. Its purpose is to give coding agents a **persistent,
project-wide** reference to a visual design system — so agents can lint
token usage, check contrast, diff token versions across changes, and export
to Tailwind/W3C token formats.

## 1. Requirements/Analysis

### Core user need

Symbion already has a `designer` subagent (`.claude/agents/designer.md`)
but it is explicitly **per-feature and ephemeral**: it reads one locked
spec (`docs/loops/<feature>-STATE.md`) and produces one throwaway artifact
(`docs/loops/<feature>-design.md` — wireframes, screen flows, component
breakdowns) for a single feature iteration. It has no concept of a
project-wide, persistent visual design system that spans features and
that later features must conform to.

What's actually missing is **not** a new kind of design *activity*
(wireframing is already covered) — it's a **persistent design-system
artifact** (a `DESIGN.md` file, in the google-labs-code spec's format) that:
- exists once per target repo (not once per feature),
- captures the durable tokens (colors, typography, spacing, radii,
  component conventions) that Symbion's own UI (or any repo Symbion is
  exporting workflows into) should conform to,
- is read by the `designer` agent (and, later, `feature-builder`) as
  **input/constraint** when producing new per-feature wireframes, so new
  screens stay visually consistent with the established system instead of
  reinventing tokens every feature,
- is created/updated by the `designer` agent as **output** when a feature
  introduces or changes a token (e.g., a new component style, a new accent
  color) — but only for genuinely reusable, cross-feature tokens, not
  feature-specific layout choices.

This is exactly the kind of "autoworkflow-authoring artifact" Symbion's
whole raison d'être is about (turning a hand-maintained convention into a
canonical `.md` file) — it's just applied to Symbion's own design agent's
inputs/outputs rather than to Symbion's exported slash-commands/subagents.

### Functional requirements (kept minimal)

Three options considered:

**(a) Brand-new subagent** (e.g. `design-system-keeper`) dedicated solely
to authoring/maintaining `DESIGN.md`.
**(b) Enhance existing `designer` agent** to also read `DESIGN.md` (if
present) before wireframing, and propose additions/updates to it when a
feature introduces new durable tokens — still writing only to
`docs/loops/<feature>-design.md` plus a token-update note, never
silently overwriting `DESIGN.md` itself.
**(c) Both** — new dedicated agent AND designer-agent enhancement.

**Recommendation: (b), enhance the existing `designer` agent.** Rationale:
- The `designer` agent already owns "produce UI/UX artifacts, do not touch
  code/architecture" — reading and proposing updates to a persistent
  design-token file is a natural extension of that same job, not a new
  responsibility class.
- A second dedicated agent (a or c) adds process overhead (another
  handoff, another STATE section, another thing for `/plan` to check for)
  for a system that — per CLAUDE.md — has **no shipped visual brand yet**
  and no dedicated new UI surface planned. Splitting this into two agents
  is premature process for a project this small.
- This keeps the change to **one modified `.md` file** (`designer.md`)
  instead of a new file plus cross-references to maintain.

Concretely, `designer.md` should gain:
1. A principle: "Before wireframing, check for `docs/design/DESIGN.md`
   (or `<repo-root>/DESIGN.md`) in the target repo. If present, treat its
   tokens (colors, typography, spacing, radii, component conventions) as
   binding constraints on new wireframes/component breakdowns."
2. A new optional output section: "Design System Updates" — proposed
   additions/changes to `DESIGN.md`'s tokens, written as a **diff-style
   proposal** appended to the same `docs/loops/<feature>-design.md` output
   (not applied directly to `DESIGN.md`), following the google-labs-code
   DESIGN.md section order (Overview, Colors, Typography, Layout,
   Elevation & Depth, Shapes, Components, Do's and Don'ts) so the proposal
   is drop-in compatible with that spec's structure.
3. An explicit "Do NOT" line: designer never writes/overwrites `DESIGN.md`
   directly — it only *proposes* changes in its per-feature design doc;
   a human (or a later, explicit "apply design system update" step)
   applies them. This preserves the existing "never write silently"
   ethos from CLAUDE.md's filesystem-safety rules, extended by analogy
   to this new persistent artifact even though `DESIGN.md` itself lives
   outside `.claude/` and isn't subject to the marker/hash mechanism.
4. `tools:` frontmatter stays `Read, Grep, Glob, Write` — unchanged (Read
   already covers reading `DESIGN.md` if present; Write already covers
   writing the `-design.md` output file that now also contains proposals).

No new subagent file, no daemon/RPC change, no `packages/core` change, no
new `apps/web` UI surface. `DESIGN.md` creation for a *brand-new* project
(no design system yet) is simply the degenerate case: designer notes
"no DESIGN.md found — proposing initial tokens" using the same section
format, seeded from whatever visual choices the current feature's
wireframes imply.

### Key edge cases

1. **No `DESIGN.md` exists yet in the target repo.** Designer proceeds
   with wireframing as today, and — instead of silently doing nothing —
   explicitly proposes an initial `DESIGN.md` (minimal, seeded only from
   tokens actually used in this feature's wireframes) as an optional
   "Design System — initial proposal" section. Never fabricates tokens
   for parts of the system not touched by the current feature.
2. **`DESIGN.md` exists but conflicts with what the current feature
   seems to need** (e.g. feature's wireframe implies a new accent color
   not in the existing palette). Designer must flag this under "Open
   Design Questions" (existing section) rather than silently picking a
   new token or silently ignoring the conflict — this is exactly the kind
   of taste call CLAUDE.md says agents must not guess on.
3. **Non-visual / CLI-only projects** (a target repo Symbion exports
   workflows into that has no UI at all — e.g. a backend service). The
   `designer` agent's enhanced principle is conditional ("if present" /
   "if the feature has a UI surface") — for non-visual features or
   projects, the agent should note "not applicable — no visual surface"
   rather than fabricate a design system where none is relevant.
4. **`DESIGN.md` present but hand-edited/stale relative to what shipped**
   (drift between documented tokens and actual `apps/web` component
   styles). Out of scope for this change to detect/reconcile — flag as a
   known limitation, not a requirement, since automated token-vs-code
   drift detection would require parsing actual CSS/Tailwind output
   (a `packages/core`-level feature, not a per-feature agent instruction).
5. **Multiple features in flight proposing different `DESIGN.md` updates
   concurrently.** Out of scope — each proposal lives in its own
   `docs/loops/<feature>-design.md`; reconciling concurrent proposals is a
   human/process-manager concern, not something this change needs to solve.

### Acceptance criteria

1. `.claude/agents/designer.md` frontmatter (`name`, `description`,
   `tools`) still validates as a well-formed Claude subagent definition
   (YAML frontmatter parses; `tools` list unchanged: `Read, Grep, Glob,
   Write`).
2. `designer.md`'s body contains an explicit instruction to check for
   `DESIGN.md` at Symbion's own repo root (resolved taste call: repo root
   only, no `docs/design/` fallback) before producing wireframes, and to
   treat its tokens as binding constraints when present.
3. `designer.md`'s body contains a new "Design System Updates" (or
   equivalently named) output section producing token proposals in the
   google-labs-code DESIGN.md canonical section order (Overview, Colors,
   Typography, Layout, Elevation & Depth, Shapes, Components, Do's and
   Don'ts) when a feature introduces/changes a durable token.
4. `designer.md`'s body contains an explicit "do NOT write/overwrite
   `DESIGN.md` directly" instruction — proposals only, in the per-feature
   design doc.
5. `designer.md`'s body contains explicit handling for the "no `DESIGN.md`
   exists yet" case (propose an initial one) and the "non-visual feature"
   case (state not-applicable, don't fabricate).
6. No files outside `.claude/agents/designer.md` are required to change
   to satisfy 1-5 (confirms triviality — see below). If a reviewer finds
   this insufficient (e.g. wants a real, committed `DESIGN.md` seeded for
   Symbion's own `apps/web`), that is an explicitly separate, larger
   follow-up feature, not part of this change's acceptance criteria.

## 2. Open questions (need user/taste decision — do not guess)

1. **Canonical file location.** Repo root `DESIGN.md` (matching
   google-labs-code's own convention) vs. `docs/design/DESIGN.md`
   (matching Symbion's own `docs/`-centric convention for durable
   artifacts). Recommend repo root for provider-format fidelity with the
   spec this is based on, but this is a taste call.
2. **Should Symbion seed its own `apps/web` with a real `DESIGN.md`** as
   part of this change (dog-fooding), or is this change strictly about
   the `designer` agent's *instructions* with no committed `DESIGN.md`
   content yet? Recommend NO for this change (keeps it trivial) — treat
   "author Symbion's own DESIGN.md" as a natural first real usage in a
   future feature, not a requirement of this one.
3. **Scope of "conform to tokens" enforcement.** Is checking/flagging
   conflicts purely the `designer` agent's job (as scoped here), or should
   `code-reviewer` also eventually check implemented components against
   `DESIGN.md` tokens? Recommend explicitly deferring this — out of scope,
   flagged as a future idea, not decided now.
4. **Export/adapter ambition.** google-labs-code's DESIGN.md format
   supports exporting tokens to Tailwind/W3C token JSON. Is there any
   near-term want for Symbion to *parse* `DESIGN.md` programmatically
   (a `packages/core` adapter, analogous to the Claude/Codex provider
   adapters) — or is it purely a human/agent-readable markdown reference
   for now? Recommend: purely markdown reference for now; parsing/adapter
   would be a materially larger, separate feature requiring `/plan`.

## 3. Product risk notes (for architect/dev)

- **Silent `DESIGN.md` overwrite risk**: even though this is "just an
  agent .md file" change, the *behavior* being specified (an agent that
  proposes edits to a persistent, potentially hand-maintained file) must
  preserve Symbion's "never write silently" ethos. The acceptance
  criteria above deliberately restrict the agent to *proposing* in its
  own per-feature doc, never applying to `DESIGN.md` directly, precisely
  to avoid a code-reviewer/security-reviewer finding this pattern
  inconsistent with CLAUDE.md's filesystem-safety mandate.
- **Provider-format fidelity**: if a future feature does add
  programmatic parsing of `DESIGN.md` (see Open Question 4), the
  canonical section order and frontmatter token schema must match
  google-labs-code's spec exactly, the same way Claude/Codex adapters
  must match their respective provider formats exactly — lossy
  reinterpretation would break the stated purpose (agents linting/
  diffing/exporting tokens reliably).
- **Scope creep risk**: it would be easy for `/plan` or `/build` to over-
  engineer this into "add a DESIGN.md viewer/editor in apps/web" — that
  is explicitly NOT requested or required here; flagging this so architect
  doesn't propose new UI surface for what is a markdown-instruction-only
  change.

## 5. BUILD — implementation notes

Implemented option (b) as recommended: enhanced the existing `.claude/agents/designer.md`, no new agent file, no daemon/core/web changes.

Changes to `.claude/agents/designer.md`:
1. New Principle (after the desktop-layout line): check for `DESIGN.md` at the **target repo root** (taste call confirmed by user: root, matching google-labs-code's own convention over `docs/design/`) before wireframing; treat its tokens as binding constraints if present; explicit non-visual-feature escape hatch ("not applicable — no visual surface").
2. New output section **7. Design System Updates** (optional): diff-style token proposals in the canonical google-labs-code section order (Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts); handles the "no DESIGN.md yet" case (labeled "initial proposal", seeded only from tokens the feature actually uses) and the "conflicts with existing token" case (routed to existing section 6, Open Design Questions — never silently overridden).
3. New "IMPORTANT" line: designer must never write/overwrite `DESIGN.md` directly — proposals only, in its own per-feature `-design.md` doc. Preserves CLAUDE.md's "never write silently" ethos by analogy, even though `DESIGN.md` lives outside `.claude/` and isn't subject to the marker/hash mechanism.
4. `tools:` frontmatter unchanged (`Read, Grep, Glob, Write`) — Read already covers reading `DESIGN.md`, Write already covers the `-design.md` output.

Assumptions for the Checker to verify:
- File location is repo root `DESIGN.md`, not `docs/design/DESIGN.md` — this was an explicit user taste-call answer, not a guess.
- No actual `DESIGN.md` was created for Symbion's own `apps/web` (open question 2 in STATE — explicitly deferred, per user-confirmed recommendation to keep this trivial).
- No changes to `code-reviewer.md`/`architect.md` to also check tokens (open question 3 — explicitly deferred as future scope).
- No `packages/core` parser/adapter for `DESIGN.md` (open question 4 — explicitly deferred; this stays a human/agent-readable markdown reference only).

Files changed: `.claude/agents/designer.md` only.

## 6. REVIEW

**code-reviewer verdict: PASS.** All 6 acceptance criteria confirmed against the diff. Two 🟡 non-blocking findings: (1) "target repo root" wording collided with CLAUDE.md's "target repo" term-of-art (downstream export destination) — fixed to "Symbion's own repo root". (2) AC2's text still mentioned a `docs/design/DESIGN.md` fallback that the taste call had already dropped — fixed to reflect repo-root-only. One 🟢 nit (stale `Phase: THINK` header) — fixed to `SHIP`.

**architect verdict: PASS.** No architecture drift, no core/daemon/web boundary violation, no unnecessary complexity. Confirmed option (b) (enhance existing `designer` agent) over a dedicated new subagent was the right call at current project scale. "Never write DESIGN.md directly" correctly extends the filesystem-safety ethos by analogy without misapplying the marker/hash mechanism to a file outside `.claude/`'s managed-file system.

No `/cso` required — diff never touched daemon RPC, fs-write code, or secrets (confirmed via `git diff --stat`: single file, `.claude/agents/designer.md`, +7/-0 originally, plus 2 small wording fixes post-review).

## 4. Triviality assessment

**This is a single small, trivial change**: a modification to one existing
file, `.claude/agents/designer.md` (add ~2 principles + 1 output section +
1 "do NOT" line to existing markdown instructions). It requires:
- NO `packages/core` changes (no new IR, no new adapter/parser),
- NO `apps/daemon` changes (no new RPC method, no new fs-write path),
- NO `apps/web` changes (no new UI surface, no new page/component),
- NO new subagent file (per the (b)-over-(a)/(c) recommendation above).

It does not need a full `/design` (visual mockups — there's no new screen)
or a heavyweight `/plan` (no architecture, no data flow, no new
integration surface). The appropriate next step is a lightweight
`/plan` pass only to confirm the exact wording/placement of the new
instructions in `designer.md` (or `/build` directly with `dev`/
`feature-builder` given how narrow the change is), not the full
architecture-and-test-plan treatment `/plan` is designed for
multi-component features. Recommend skipping straight to implementation
of the `designer.md` edit, with `/review` (code-reviewer) checking the
new instructions are unambiguous and consistent with the rest of the
file's conventions — no `/cso` needed (no RPC/fs-write/secrets touched).
