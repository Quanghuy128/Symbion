# load-existing-workflows — STATE

**Phase: Done**

## 0. Origin

GitHub Issue #8 ("[Feature] Load workflows in current project"): for projects
that already have a pre-existing `.claude/` (or other provider) workflow
setup, pointing Symbion at that path today causes "conflicts" because Symbion
"only supports creating new workflows." Corrected expectation from the issue:
when a project path is set, Symbion should detect an existing workflow and
ask "Existing workflow detected in [.claude, .github, ...]. Do you want to
import it?" — confirming imports the existing structure into Symbion.

## 1. Code-reading findings (answers the "how big is this really" question)

Read `packages/core/src/parse/scan.ts`, `apps/daemon/src/rpc/handlers.ts`
(`validatePath`, `createProject`, `scanClaudeDir`, `importArtifacts`),
`apps/web/src/components/CreateProjectDialog.tsx`,
`apps/web/src/components/ImportDialog.tsx`, `apps/web/src/components/AppShell.tsx`.

**The parser and import machinery already exist and already work end-to-end:**

- `packages/core/src/parse/scan.ts` — `parseClaudeFile()` / `parseClaudeDir()`
  already parse arbitrary `.claude/agents/*.md` + `.claude/commands/*.md`
  content into `CanonicalArtifact[]`, including files with **no Symbion
  managed-by marker** (`marker?.id ?? opts.id ?? cryptoRandomId()` — a fresh
  id is minted; `meta.status` is set to `"draft"` when no marker is found,
  `"published"` when a marker IS found and matches). Unparseable files land
  in `skipped[]` with a reason, never thrown (E3, already handled).
- `apps/daemon`'s `scanClaudeDir` RPC reads the filemap off disk and calls
  `parseClaudeDir` (pure). `importArtifacts` RPC takes the scan result + a
  selected-id list and writes the selected `CanonicalArtifact[]` into
  `.symbion/store.json` — **read-only against the target repo**: it does
  **not** write/modify the original `.claude/*.md` files at all, does **not**
  add a managed-by marker to them, and does not touch them in any way. Import
  only mutates Symbion's own `.symbion/store.json`.
- `validatePath` RPC already returns `hasClaudeDir: boolean` and
  `hasAgentsMd: boolean` for any path — detection capability already exists,
  computed on every keystroke (debounced) in `CreateProjectDialog`.
- **The actual gap (confirms the "UX/detection gap" hypothesis, not a missing
  parser):** `CreateProjectDialog` and `ImportDialog` are two **separate,
  parallel UI components** the user must consciously pick between *before*
  even typing a path (`AppShell.tsx` renders both, gated on two independent
  `open` booleans set by two different buttons). `CreateProjectDialog`, when
  it detects `hasClaudeDir === true`, only renders a **passive, easy-to-miss
  hint string** — `.claude/ đã có (xem xét Import)` — next to the path field.
  It never prompts, never blocks, never offers a one-click switch to the
  import flow. If a user (reasonably, since "Tạo dự án mới" reads as the
  primary/default action) clicks "Tạo dự án mới" on a path that already has
  `.claude/agents/*.md`, `createProject` runs to completion, writes a fresh
  empty `.symbion/store.json`, and the user's existing agents/commands are
  never scanned, never shown, and never imported — silently. This is exactly
  the bug the issue describes ("Currently, Symbion only supports creating new
  workflows... leads to conflicts").

**Conclusion: this is a UX/detection-and-prompt feature, not a new-parser
feature.** No new parsing logic is needed in `packages/core`. The fix is:
(a) make the existing `hasClaudeDir`/`hasAgentsMd` detection signal trigger
an actual interrupt/prompt at the moment a path is entered (in whichever
flow the user started from), and (b) route "yes, import" into the already-
working `scanClaudeDir` → review-list → `importArtifacts` pipeline instead of
silently completing `createProject` on an empty store.

## 2. Core user need

> As a developer who already has a hand-written or previously-exported
> `.claude/` (or `AGENTS.md`) workflow setup in a repo, when I point Symbion
> at that repo's path — whether via "Tạo dự án mới" or any other entry point
> — I want Symbion to notice and offer to bring my existing agents/commands
> into the Studio, instead of silently starting me from an empty project and
> putting me at risk of overwriting my own files later.

## 3. Scope

### In scope
- Detecting an existing workflow **at the moment the project path is set**,
  regardless of which dialog/flow the user is in (today: only
  `CreateProjectDialog`'s passive hint covers this; `Issue #8` wants this to
  be a real, unmissable prompt).
- A confirm/decline prompt with the exact shape the issue requests: naming
  *which* provider structure(s) were found (e.g. ".claude", and "AGENTS.md"
  if that's the detected Codex case — see open question 2 below on whether
  ".github" is real or a documentation slip in the issue).
- On confirm: route into the existing `scanClaudeDir` → preview-with-
  checkboxes → `importArtifacts` pipeline (already built, already daemon-
  read-only against the target repo) rather than building a new parser.
- On decline: proceed with `createProject` as today (empty store), but the
  decision and the fact that an existing workflow was seen must not be lost
  silently — re-prompting behavior on next path-open is an open question
  (§6 Q4).
- Folding "two separate buttons/dialogs for create vs import" into **one**
  coherent path-entry flow that branches based on detection result — exact
  mechanism (modal merge vs. inline prompt vs. dialog-to-dialog handoff) is
  explicitly a design-phase decision, not specified here.

### Out of scope (do not let `/design`/`/plan` smuggle in)
- Any new parsing capability — `parseClaudeFile`/`parseClaudeDir` already
  handle missing markers, malformed frontmatter (→ `skipped[]`), and
  multi-file scans. This loop does not touch `packages/core`'s parse layer
  unless a genuinely new gap is found in `/plan` (not expected per §1).
- Writing a managed-by marker onto the user's existing on-disk files during
  import. Import already imports into `.symbion/store.json` only, with
  `meta.status: "draft"` for unmarked files; this loop does not change that
  read-only-against-target-repo guarantee (see open question 1 — there is a
  real ambiguity about what "draft" vs "published" status SHOULD mean for an
  imported-but-unmarked file, but mutating the user's files is out regardless
  of how that's resolved).
- Supporting providers beyond what's already in v1 scope (Claude `.claude/`
  + Codex `AGENTS.md`, per `CLAUDE.md`). The issue's example mentions
  ".github" — that is **not** a current Symbion provider target and adding
  support for arbitrary `.github/` workflow files is a different, larger
  feature (new provider adapter) unless the user confirms it was just an
  example/placeholder in the issue text (see open question 2).
- Building any new merge/reconciliation UI for "existing store.json AND
  existing .claude/ both already present with diverging content" — that
  case is conflict-detection territory already covered by
  `computeDiff`/`classify` (§3.4 of `symbion-STATE.md`) at *publish* time,
  not at *import* time. This loop is about the **first** import moment only.

## 4. Happy path (target experience, technology-agnostic)

1. User opens "add a project" from anywhere in Symbion (today: either
   "Tạo dự án mới" or "Import .claude/ từ repo" — this loop should make that
   distinction moot for the existing-workflow case) and enters/picks a path.
2. The instant the path resolves to a directory that already contains a
   recognized workflow structure (`.claude/agents/*.md` or
   `.claude/commands/*.md`, and/or `AGENTS.md`), Symbion shows an
   unmissable, blocking-but-dismissible prompt: "Existing workflow detected
   in [.claude...]. Do you want to import it?" (exact copy/localization is a
   design decision — existing UI strings in this codebase are Vietnamese,
   e.g. "đã có", so final copy should match house style).
3. **Confirm ("Có"/OK)** → Symbion runs the existing scan (`scanClaudeDir`),
   shows the existing review-with-checkboxes list (already built in
   `ImportDialog`, can be reused/embedded), user picks what to bring in,
   confirms → `importArtifacts` populates the new project's store. No file
   in the target repo is modified.
4. **Decline** → Symbion proceeds to create a normal empty/new project at
   that path, exactly as `createProject` does today. The existing files
   remain completely untouched and un-imported (consistent with "foreign
   files are never touched" until the user explicitly imports or publishes
   over them).
5. Either way, the user ends up with exactly one project pointed at that
   path — no duplicate/parallel project-creation flows, no orphaned partial
   state.

## 5. Edge cases

- **EC-1 — No marker on existing files (the central ambiguity).** Most
  realistic "existing workflow" repos will have hand-written `.claude/*.md`
  with no `<!-- managed-by: symbion ... -->` marker at all (that marker is
  Symbion's own invention; a repo that never used Symbion before cannot have
  it). `parseClaudeFile` already handles this today by minting a fresh `id`
  and setting `meta.status: "draft"`. Open question: should an imported,
  unmarked file be treated identically to a hand-typed draft artifact the
  user is about to publish for the first time (current behavior), or does
  "import" imply something stronger/different now that this is a named,
  promoted feature rather than an existing under-the-radar capability? See
  §6 Q1 — **this determines whether any code changes beyond UX wiring are
  needed at all.**
- **EC-2 — Malformed/unparseable existing files.** Already handled:
  `skipped[]` with a reason, unchecked by default in the review list. This
  loop must not regress that; the new detection prompt must still surface
  "N files could not be read" rather than silently dropping them from the
  user's awareness (today's `ImportDialog` does show `skipped` reasons
  inline — preserve that when this flow is unified/reused).
- **EC-3 — Detected structure is `AGENTS.md` only (Codex), not `.claude/`.**
  `validatePath` already detects `hasAgentsMd` separately from
  `hasClaudeDir`. The prompt and import pipeline must handle the
  Codex-only case too (issue's phrasing "[.claude, .github, ...]" implies
  the prompt names *which* structure(s) were found) — but Codex's
  `AGENTS.md` is a single **merged** file (per `symbion-STATE.md` §2.2's
  Codex adapter notes); there is currently no `scanClaudeDir`-equivalent
  reverse-parser for `AGENTS.md` → IR. **This is the one place where a real
  gap might exist beyond pure UX** — flag for `/plan` to confirm whether
  `AGENTS.md` import is in this loop's scope or deferred (see §6 Q2/Q5).
- **EC-4 — Path already has a `.symbion/store.json` (i.e., it's already a
  Symbion project).** `createProject` already throws `already-a-project` in
  this case. The new detection-prompt flow must not race with or bypass that
  existing guard — a path that is already a Symbion project should never
  show "existing workflow detected, import?" (it's not a foreign workflow,
  it's already managed) — this should resolve to the existing "open this
  project" / "already exists" UX, not a new import prompt.
- **EC-5 — User declines, then later wants to import anyway.** Today's
  standalone `ImportDialog` is always available as a separate entry point
  regardless of this loop's outcome — declining the new prompt must not
  remove the user's ability to later run an explicit import into the
  project they just created empty. (Whether that's "run ImportDialog again
  pointed at the same already-existing project" — which isn't fully wired
  today, since `ImportDialog.handleImport` always calls `createProject`
  fresh — is itself worth flagging to `/plan`: importing into an *existing*
  project, not just creating-with-import, may need a small RPC-flow change.)
- **EC-6 — Detected workflow has artifacts that would collide (duplicate
  name+kind) with nothing, since the project is brand-new** — not a real
  collision case at first-import time (the store is empty); duplicate-name
  collision logic (E5 in `symbion-STATE.md`) only matters for re-imports
  into a non-empty store, which is EC-5's territory, not this loop's core
  happy path.
- **EC-7 — Symlinked or path-confinement-violating `.claude/` contents.**
  Existing `rpc/guard.ts` path-confinement rules apply to any new read code
  exactly as they do today to `scanClaudeDir`'s existing filemap reader — no
  new exemption should be introduced for "import" reads.

## 6. Open questions (need user/product decision — do not guess)

1. **What does "import" actually mean for unmarked (no Symbion marker)
   files — does this feature change that semantic at all, or just make the
   already-correct behavior (parse into IR as a draft artifact, never touch
   the original file) more discoverable?** If the answer is "just make it
   discoverable," this is a small, low-risk UX-only loop. If the user wants
   imported files to be immediately treated as "published"/managed (e.g.
   stamping a marker onto the user's existing files at import time, so a
   future re-publish is recognized as an update rather than a fresh
   conflict-free write), that is a **materially bigger, riskier feature** —
   it means Symbion writes to the user's existing hand-authored files during
   import, which directly conflicts with CLAUDE.md's "foreign/unmanaged
   files are never touched" rule unless explicitly carved out as an
   exception for this one flow, with its own diff-preview-and-confirm step
   (the same rigor as publish). **Recommend: keep current behavior (no
   marker written on import; status stays "draft" until the user explicitly
   publishes through the normal diffed flow)** — but this must be confirmed,
   not assumed, since it's the single highest-leverage decision in this
   loop.
2. **Is `.github` (from the issue's literal example text) real scope, or
   was it just the issue author's example/placeholder?** Symbion's locked
   v1 provider scope (`CLAUDE.md`) is Claude (`.claude/`) + Codex
   (`AGENTS.md`) only. If `.github/` workflow files (e.g. GitHub Actions
   YAML, or some other `.github`-housed convention) are genuinely meant to
   be detected/imported, that is a **new provider adapter** — out of scope
   for a UX-detection loop and needs its own ANALYZE/DESIGN/PLAN cycle. If
   it was just illustrative text in the issue, this loop should explicitly
   scope detection to `.claude/` + `AGENTS.md` only (i.e., exactly what
   `validatePath` already detects today) and say so in the prompt copy.
3. **Where does the new detection-and-prompt trigger live, given there are
   currently two separate entry-point dialogs?** Should `CreateProjectDialog`
   itself absorb the prompt-and-branch behavior (so "Tạo dự án mới" becomes
   the single universal entry point, and `ImportDialog` either disappears or
   becomes the post-confirm sub-screen it already effectively renders), or
   should both dialogs keep existing and only `CreateProjectDialog` gains
   the interrupt? This is a UX/IA decision for `/design`, flagged here only
   so it isn't silently assumed as "obviously merge them" without product
   sign-off, since `ImportDialog` may have other callers/use-cases this BA
   pass didn't find.
4. **Should "decline" be remembered, or re-prompt every time the same path
   is reopened?** E.g., if a user declines once (wants an empty project
   alongside pre-existing files they intend to overwrite later via publish),
   should Symbion stop asking on subsequent visits to that same project, or
   is re-prompting acceptable/desired since it's a one-time gate at creation
   only (path is fixed per-project after `createProject` succeeds, so this
   may be moot — confirm whether "re-adjusting a project's path" after
   creation is even a real flow that exists, since the issue's title says
   "When adjusting a project's path" which may imply edit-path-of-an-
   existing-project, not just create-time path entry).
5. **Is `AGENTS.md` (Codex) reverse-parsing into IR genuinely in scope for
   this loop, or deferred?** Per EC-3, no `AGENTS.md` → IR parser currently
   exists (only the forward Claude-dir scanner does). If the prompt is
   supposed to honestly offer "import" for an `AGENTS.md`-only repo, that is
   new parsing work in `packages/core`, not just a UX wire-up — this changes
   the size estimate for `/plan` materially. Recommend confirming whether
   v1 of this loop can ship Claude-only detection+import (matching what's
   already built) with Codex import explicitly called out as "detected but
   not yet importable — shown as informational only" for now.

## 7. Product risk notes (for architect/designer awareness)

- **Risk: writing a managed-by marker onto a user's existing files during
  import** (if Q1 resolves toward "stronger" import semantics) is a direct
  tension with CLAUDE.md's foreign-file-never-touched rule and the
  never-write-silently rule. Any design that proposes this must go through
  the same render→diff→confirm→write pipeline already used for publish —
  never a special-cased silent stamp during import.
- **Risk: false negative detection.** If `hasClaudeDir`/`hasAgentsMd` boolean
  checks (file/dir existence only) are reused as-is, an empty `.claude/`
  directory with zero `.md` files inside would still trigger "existing
  workflow detected" — a misleading prompt for a project that has nothing
  to import. `/plan` should confirm detection means "found ≥1 parseable or
  skipped agent/command file," not merely "the directory exists."
- **Risk: prompt fatigue / treated as a dismissible nag.** The issue
  explicitly asks for a real interrupt ("prompt... upon clicking OK"), not a
  passive hint (today's actual bug). Over-correcting into a hard-blocking
  modal that can't be escaped without a decision could itself become a
  UX problem if a user just wants to quickly create an empty test project
  next to unrelated `.claude/` content placed there by another tool —
  decline must always be a clean, complete, non-blocking path forward (this
  is already true of today's plain `createProject`).
- **Risk: this loop's fix could mask EC-4** (already-a-Symbion-project) if
  detection logic is bolted on without checking for `.symbion/store.json`
  first — would produce a confusing "import?" prompt for a path that's
  already fully managed. Must be explicitly tested.
- **No destructive-write risk identified for the "keep current draft-only
  import semantics" resolution of Q1** — under that resolution, this is a
  read-only-against-target-repo, UX-and-flow-wiring feature, consistent with
  the low actual size found in §1.

## 8. Recommended next step

Run `/office-hours` (or get direct user answers to the 5 open questions in
§6) to lock scope — especially Q1 (import semantics: marker-writing or not)
and Q2 (`.github` real scope or not), since those two single-handedly decide
whether this ships as a small UX loop or balloons into a new-provider-adapter
project. Once locked, proceed to `/design` (the prompt screen + how the two
existing dialogs merge/branch) then `/plan` (architect: confirm whether any
new RPC method is needed — e.g. "import into an already-existing, non-empty
project" per EC-5 — or whether this is 100% reuse of `scanClaudeDir` +
`importArtifacts` + a new piece of UI state machine in `apps/web`).

## 9. THINK — autopilot decisions (unattended run, no user present)

This run was triggered by a 15-minute cron loop reading GitHub Issues with no
human present to answer §6's 5 open questions in real time. Per autopilot's
own rule (a hard-learned process lesson in `docs/learnings.md`: autopilot must
NOT silently resolve a question it has itself flagged as "the single most
important blocker" — but it MAY pick the minimal-scope/safest/most-reversible
reading and document it for review, which is what's done below), each
decision picks the option the BA's own analysis already flagged as lowest-risk
and most consistent with CLAUDE.md's locked architecture rules.

1. **Q1 — Import semantics: keep current draft-only behavior, no marker
   writing.** Adopt the BA's own explicit recommendation verbatim: imported
   files are parsed into the IR as draft artifacts in `.symbion/store.json`
   exactly as `importArtifacts` already does today; **no marker is ever
   written onto the user's existing on-disk files during import.** This is
   the only reading consistent with CLAUDE.md's "foreign/unmanaged files are
   NEVER touched" rule without requesting a carved-out exception — and the BA
   flagged the alternative (stamping a marker at import time) as needing the
   same diff-preview-and-confirm rigor as publish, which is explicitly a
   bigger feature, not assumed here. **This decision is the load-bearing one
   for the whole loop and is flagged for human override** if "import" was
   actually meant to mean something stronger.
2. **Q2 — `.github` is illustrative text, not real scope.** Detection and
   import are scoped to exactly what `validatePath` already detects today:
   `.claude/` (Claude provider) and `AGENTS.md` (Codex provider) — matching
   CLAUDE.md's locked v1 provider scope. The prompt copy will not claim
   `.github/` support. Rationale: CLAUDE.md explicitly locks v1 providers to
   Claude + Codex; treating the issue's `[.claude, .github, ...]` as a literal
   scope request would mean building a new GitHub Actions provider adapter,
   a materially larger, unrequested-by-architecture feature.
3. **Q3 — Detection-and-prompt trigger lives in `CreateProjectDialog`,
   becoming the single universal entry point.** `ImportDialog`'s existing
   scan-and-checkbox-review screen is reused/embedded as the post-confirm
   sub-step (not deleted, not duplicated) — this is the smaller of the two
   options the BA flagged (vs. a deeper IA merge) and directly fixes the bug
   as described (the more prominent "Tạo dự án mới" button is the one that
   currently silently skips detection). `ImportDialog` remains available as
   its own standalone entry point for EC-5 (re-import into an existing
   project later).
4. **Q4 — Re-prompt every time; no "remembered decline" state.** The issue's
   "when adjusting a project's path" is read as referring to the **path-entry
   moment during project creation** (today's only real path-entry flow — no
   edit-path-of-an-existing-project flow exists in the codebase per the BA's
   findings), not a recurring background watch. Since `createProject` fixes
   the path permanently on success, the prompt only ever fires once per
   path-entry attempt — there is no "reopening the same path" scenario to
   remember a decline against in the current architecture, so no new
   persisted-preference state is introduced. If a future "edit project path"
   feature is added, that loop can decide its own re-prompt behavior.
5. **Q5 — `AGENTS.md` (Codex) import is informational-only in this loop, not
   functional.** Ship Claude-only detection+import (matching what's already
   built and proven in `scanClaudeDir`/`importArtifacts`). If `hasAgentsMd`
   is true, the prompt names `AGENTS.md` as detected but the import action
   only operates on `.claude/` content; an `AGENTS.md`-only repo sees the
   structure acknowledged in the prompt copy but is informed import isn't yet
   available for that format (exact copy is a design-phase decision). This
   matches the BA's own recommendation and avoids building new
   `packages/core` parsing work (`AGENTS.md` → IR reverse-parser) under a
   feature whose entire premise is "this is UX wiring, not new parsing."

**EC-4 (already-a-Symbion-project) is treated as a hard precondition, not a
taste call**: any path that already has `.symbion/store.json` must resolve to
the existing "already a project" guard, never the new import prompt — this is
existing, correct behavior (`createProject` already throws `already-a-project`)
that the new detection logic must check for first, not a decision needing
human input.

All five decisions are reversible/additive and do not touch already-shipped
behavior. Per CLAUDE.md's pipeline conventions, this section stands in for a
condensed `/office-hours` pass conducted under autopilot with no user present.

## 10. PLAN — Architecture (architect)

Read in full: this STATE file (§0-9), `load-existing-workflows-design.md` (§1-7),
and ground truth: `packages/core/src/parse/scan.ts`,
`apps/daemon/src/rpc/handlers.ts` (`validatePath`, `createProject`,
`scanClaudeDir`, `importArtifacts`), `apps/daemon/src/fs/readTargetFiles.ts`
(`readClaudeDirFilemap`), `packages/rpc-types/src/index.ts`,
`apps/web/src/components/CreateProjectDialog.tsx`,
`apps/web/src/components/ImportDialog.tsx`,
`apps/web/src/lib/store/useArtifactStore.ts`, `apps/web/src/components/AppShell.tsx`.

### 10.1 Resolution: the empty-`.claude/`-directory false-positive

**Decision: call `scanClaudeDir` eagerly (no new RPC, no `validatePath` shape
change) and gate the detection panel on the scan result, not on the raw
`hasClaudeDir`/`hasAgentsMd` booleans.**

Concretely: the `step` state machine's path-validity effect already fires a
debounced `validatePath` on every keystroke. When that result resolves to
`exists && isDir && !alreadyAProject && (hasClaudeDir || hasAgentsMd)`,
**immediately** (same debounce tick, no extra user click) fire a second,
chained `scanClaudeDir` call against that path — not gated behind a "Có, nhập
vào" click. The detection panel (S2) is only shown once *that* result is back,
and only if it actually contains something:

```
showDetectionPanel =
  hasClaudeDir-derived-importable (agents.length + commands.length + skipped.length > 0)
  || hasAgentsMd (informational, unconditioned — AGENTS.md presence alone is
     enough to show the informational line per Q5, since there is no
     file-count signal available for a single merged file and it carries no
     "import" action that could mislead)
```

Rationale for "just call `scanClaudeDir` eagerly" over the two alternatives
the design doc flagged:

1. **Reject "make `validatePath` report a stronger signal" (e.g. a file
   count)** — this would require `validatePath` (today: cheap `existsSync`
   checks only) to recursively read `.claude/agents` and `.claude/commands`
   on every debounced keystroke just to count files, duplicating work
   `scanClaudeDir` already does, and it would still need `parseClaudeDir`'s
   logic to distinguish "real files vs. e.g. a stray `.DS_Store`" — i.e. it
   would have to become a thin wrapper around `parseClaudeDir` anyway. Worse,
   it complicates `ValidatePathResult`'s contract (a type every existing
   caller depends on) for a need only this one new caller has.
2. **Reject "add a new lightweight RPC"** — `readClaudeDirFilemap` (verified
   in `apps/daemon/src/fs/readTargetFiles.ts`) is already cheap: it does
   exactly 3 `readdirSync` calls (`agents/`, `commands/`, `hooks/`) plus one
   `existsSync` for `settings.json`, no recursion, no network, no large-file
   reads beyond what's about to be displayed anyway. A new "just check if
   there are files" RPC would be near-duplicate code solving a problem
   `scanClaudeDir` already solves more usefully (it returns the *actual*
   parsed/skipped breakdown the review screen needs next regardless).
3. **Accept "call `scanClaudeDir` eagerly"** — it is the only option that
   reuses 100% existing daemon code unchanged, costs one extra RPC round-trip
   per debounce-settled path entry (not per keystroke — still gated by the
   existing 200ms debounce plus the `hasClaudeDir||hasAgentsMd` precondition,
   so it never fires for ordinary non-workflow paths), and gives the UI the
   *exact* data it needs for S4 immediately, so confirming in S2 requires zero
   further RPC calls (the scan is already cached in component state from the
   detection step) — collapsing today's design's S3 "scanning" loading state
   into something that, in the common case, never needs to render because the
   data is already there by the time S2 shows. S3 is kept in the design only
   as a fallback for the rare case where the eager scan is still in flight
   when `validatePath` resolves (race), or as the re-scan path after "Quay
   lại" if `scanned` was discarded — not as a guaranteed-to-render step.

This changes the design doc's step semantics slightly (worth flagging to
`/build`): the panel's job changes from "decide whether to scan" to "decide
whether to *import* a scan that already happened." This is strictly simpler
to implement and removes one async gap from the user-visible flow. No
`packages/rpc-types` change, no daemon handler change — **zero daemon code
touched** for this resolution.

Edge sub-case: if `hasClaudeDir` is true but the eager scan returns
`agents: [], commands: [], skipped: []` (a genuinely empty or
irrelevant-contents `.claude/` dir, e.g. only a `settings.json` with nothing
else), the detection panel for `.claude/` does NOT render — this directly
fixes STATE §7's flagged risk. If `hasAgentsMd` is also false in that case,
the dialog shows today's plain S1 form, exactly as if no workflow had been
detected at all.

### 10.2 Resolution: EC-5 / "does this loop need a new RPC for import-into-existing-project"

**Confirmed: no new RPC method is needed for this loop's actual scope.**

Ground truth from `apps/daemon/src/rpc/handlers.ts`'s `importArtifacts`
(lines 301-334): it already takes a `projectId` (via `findProjectPath`,
`loadProjectStore`) and **merges** `selected` into `store.artifacts` —
it has no dependency on the project having just been created, no
"freshly-created" flag, no assumption the store is empty. It is already
fully general-purpose "import into project X" regardless of X's age. The
*only* place "always fresh" is hard-coded is in the **web layer**:
`ImportDialog.handleImport` (line 41-57) always calls
`createProject(...)` immediately before `importArtifacts`, never offering an
"existing project" target.

This loop's new embedded flow inside `CreateProjectDialog` calls
`createProject` then `importArtifacts` in the same sequence — i.e. it is
literally the same two-RPC sequence `ImportDialog` already performs today,
just orchestrated from a different component. **No RPC, type, or daemon
change is required for this loop.** The standalone "import into an
already-existing Symbion project" entry point (e.g. a button on an open
project's settings screen calling `scanClaudeDir` + `importArtifacts` against
`store.currentProject.id` without a `createProject` call) is real, useful,
and trivially buildable on the *existing* `importArtifacts` RPC with zero
backend change — but it has no UI entry point anywhere in the codebase today,
and per STATE's own scope cut and the design doc's "Future Ideas" list, building
that entry point is explicitly deferred, not part of this loop. Confirmed,
not corrected.

### 10.3 Files to create / modify

**New files (apps/web only):**

- `apps/web/src/components/WorkflowDetectionPanel.tsx` — new. Pure
  presentational. Props:
  ```ts
  interface WorkflowDetectionPanelProps {
    hasClaudeDir: boolean;
    hasAgentsMd: boolean;
    /** true once the eager scanClaudeDir result is known to contain
     *  something importable (agents+commands+skipped > 0). Drives whether
     *  the "Có, nhập vào" action renders at all. */
    importAvailable: boolean;
    onConfirm: () => void;
    onDecline: () => void;
  }
  ```
  Renders wireframe (b)/(e) variants by `hasClaudeDir`/`hasAgentsMd`/
  `importAvailable` combination. No RPC calls, no internal state.

- `apps/web/src/components/ImportScanningState.tsx` — new, tiny. No props
  beyond an optional `{ onCancel?: () => void }` (unused this iteration per
  design doc's autopilot decision #4 — included in the type for forward
  compat, not wired to a button). Renders the S3 spinner row. Per §10.1, this
  now renders only in the rare race/retry path, not the common case.

- `apps/web/src/components/ImportReviewStep.tsx` — new, extracted verbatim
  from `ImportDialog.tsx`'s `{scanned && (...)}` JSX block (lines 76-94).
  Props:
  ```ts
  interface ImportReviewStepProps {
    scanned: ScanClaudeDirResult["parsed"];
    selected: Set<string>;
    onToggle: (id: string) => void;
  }
  ```
  Purely presentational, no RPC, no name-field, no import-trigger button
  (those stay owned by each caller per design §4).

**Modified files:**

- `apps/web/src/components/CreateProjectDialog.tsx` — rewritten to add the
  `step: "form" | "detected" | "scanning" | "review"` state machine (design
  §4), plus a `declined: boolean` flag, plus the eager-scan wiring from
  §10.1. New local state: `scanned: ScanClaudeDirResult["parsed"] | null`,
  `selected: Set<string>`, `scanError: string | null`. `handleCreate` is
  split into two paths: plain create (unchanged, S1/decline) and
  create-then-import (`createProject` then `importArtifacts` with
  `selected`, mirroring `ImportDialog.handleImport`'s existing sequence).
  Path field + "Chọn…" button disabled when `step` is `"scanning"` or
  `"review"` (design §5).

- `apps/web/src/components/ImportDialog.tsx` — refactored (no behavior
  change) to import and render `ImportReviewStep` instead of its inlined
  JSX block; its own `scanned`/`selected` state and `handleScan`/`toggle`/
  `handleImport` logic is unchanged, it just delegates rendering. External
  props/behavior/entry point untouched per Q3.

**No changes anywhere else.** Specifically NOT touched:
`apps/daemon/src/rpc/handlers.ts`, `apps/daemon/src/fs/readTargetFiles.ts`,
`packages/core/src/parse/scan.ts`, `packages/rpc-types/src/index.ts`,
`apps/web/src/lib/rpc/types.ts`, `apps/web/src/lib/store/useArtifactStore.ts`,
`apps/web/src/components/AppShell.tsx`, `apps/web/src/components/EmptyState.tsx`.

### 10.4 Data flow

```
apps/web (CreateProjectDialog)
  │
  │ 1. user types path → debounce 200ms
  ▼
validatePath RPC ──────────────► daemon: existsSync/statSync only (unchanged)
  │ result: { exists, isDir, hasClaudeDir, hasAgentsMd, ... }
  ▼
2. web computes alreadyAProject = projects.some(p => p.path === normalizedPath)
   using the already-loaded `useArtifactStore.projects` list (§10.5 EC-4) —
   zero new RPC, zero daemon change.
  │
  │ if (hasClaudeDir || hasAgentsMd) && !alreadyAProject:
  ▼
3. eager scanClaudeDir RPC ────► daemon: readClaudeDirFilemap (3x readdirSync,
  │                                read-only against target repo) → parseClaudeDir
  │                                (pure, packages/core) → { parsed }
  │ result: { agents, commands, hooks, settings?, skipped }
  ▼
4. step → "detected" (S2) if parsed has anything importable or hasAgentsMd;
   else step stays "form" (no false positive)
  │
  ├─ user clicks "Không, tạo trống" → step="form", declined=true (zero RPC)
  │
  └─ user clicks "Có, nhập vào" → step="review" (S4, scan already cached,
     no further RPC) → user toggles checkboxes (local state only) → clicks
     "Nhập N mục đã chọn"
       │
       ▼
     createProject RPC ───────► daemon: writes NEW .symbion/store.json
       │                          (filesystem write, existing guarded path,
       │                          confined to declared project root)
       ▼
     importArtifacts RPC ─────► daemon: loadProjectStore → merge selected
       │                          artifacts → saveProjectStore (writes
       │                          .symbion/store.json again; target repo's
       │                          .claude/*.md files are never opened for
       │                          write — read-only against target repo,
       │                          confirmed unchanged from today)
       ▼
     dialog closes, new project loads in main view (existing loadProjects/
     currentProject flow, unchanged)
```

All disk writes in this flow are exactly the two RPCs (`createProject`,
`importArtifacts`) that already exist and already only write inside
`.symbion/` under the project root — nothing new touches the target repo's
own `.claude/*.md` or `AGENTS.md` files. `scanClaudeDir` and `validatePath`
remain read-only.

### 10.5 Edge cases — confirmation pass

- **EC-1 (no marker / draft status)** — confirmed addressed, zero code
  change: `parseClaudeFile` already sets `meta.status: "draft"` for
  unmarked files (verified `packages/core/src/parse/scan.ts` line 46); this
  loop's UI wiring does not touch that logic.
- **EC-2 (malformed/unparseable files)** — confirmed addressed: `skipped[]`
  surfaces in `ImportReviewStep` exactly as it does in today's `ImportDialog`
  (extracted verbatim, same JSX). No regression risk since the extraction is
  copy-not-rewrite.
- **EC-3 (AGENTS.md-only / Codex)** — confirmed addressed per Q5: the
  informational-only line in `WorkflowDetectionPanel` when
  `hasAgentsMd && !importAvailable-from-claude`. No `AGENTS.md` → IR
  parser is built (confirmed out of scope, matches STATE §9 Q5).
- **EC-4 (already-a-Symbion-project)** — confirmed addressed with **zero new
  RPC and zero daemon change**, using a client-side check against data the
  web app already loads. `useArtifactStore`'s `projects` list (populated by
  the existing `listProjects` RPC, which every page load already calls for
  the project sidebar — verified `apps/web/src/lib/store/useArtifactStore.ts`
  lines 44-47) contains `{ id, name, path }` for every known Symbion project.
  `CreateProjectDialog` computes
  `alreadyAProject = projects.some(p => p.path === normalizedPath)` and treats
  a match exactly like EC-4's existing guard: skip the eager `scanClaudeDir`
  call entirely, skip the detection panel entirely, and show the same
  "already exists" affordance the design's S5 describes (today: the user
  would hit `createProject`'s `already-a-project` throw at submit time;
  this loop additionally surfaces it earlier, at path-entry time, by
  comparing against the in-memory `projects` list — strictly an improvement,
  not a new failure mode). This is a name/path string-equality check on data
  already in the client, not a new disk read, not a new RPC, not a
  `ValidatePathResult` shape change. The daemon's own `createProject` guard
  (`projectStoreExists`) remains the authoritative server-side enforcement
  and is unchanged — the client-side `projects` check is purely a UX
  short-circuit to avoid showing a misleading "import?" prompt for a path
  that's actually already fully managed; if the in-memory `projects` list is
  ever stale (e.g. another Symbion instance created a project at that exact
  path moments ago, before this client's next `listProjects` refresh), the
  existing server-side throw at `createProject` time is still the real safety
  net, so there is no correctness gap, only a vanishingly rare cosmetic one
  that today's code already has regardless of this loop.
- **EC-5** — see §10.2, confirmed no new RPC needed.
- **EC-6 (duplicate-name collision)** — confirmed not applicable to this
  loop's happy path (fresh empty project, store is empty at import time);
  `importArtifacts`'s existing `validateAllArtifacts` server-side check
  (handlers.ts lines 306-322) still applies unchanged as defense-in-depth.
- **EC-7 (symlink/path-confinement)** — confirmed addressed, zero change:
  `readClaudeDirFilemap` already calls `resolveConfinedPath` (verified in
  `apps/daemon/src/fs/readTargetFiles.ts` lines 41, 45, 58) for every path it
  touches; this loop adds no new disk-reading code path, only a new call
  site (earlier, eager) for the existing RPC.

### 10.6 Trade-offs and assumptions for dev/Checker to track

1. **Eager `scanClaudeDir` cost** — one extra RPC round-trip per
   debounce-settled path that has `hasClaudeDir||hasAgentsMd` true. Accepted
   per §10.1's rationale (cheap, bounded, no recursion). If a pathological
   `.claude/` dir with thousands of files becomes a real complaint, that's a
   future perf loop, not this one.
2. **EC-4 relies on in-memory `projects` freshness** — the client-side
   `alreadyAProject` check (§10.5) trusts `useArtifactStore.projects`, which
   is only as fresh as the last `listProjects` call. The daemon's own
   `createProject` throw remains the real safety net if that list is ever
   stale (e.g. a project created in another browser tab/window moments
   earlier); this is a pre-existing characteristic of `projects`, not a new
   gap introduced by this loop.
3. **`declined` flag scope** — lives in component state only (design §4,
   Q4 confirmed no persistence); resets to nothing on dialog close/reopen.
4. **"Quay lại" from S4 returns to S2, preserving `scanned`** — per design
   doc's autopilot decision #2; `dev` should NOT re-fetch `scanClaudeDir` on
   back-navigation within the same dialog session.
5. **Dialog stays `w-[480px]` across all steps** — per design doc's autopilot
   decision #3; `dev` should not introduce a resize/width-by-step variant.

### 10.7 /cso requirement

**Not required.** This loop touches zero daemon RPC handlers, zero RPC
request/response shapes (`packages/rpc-types`), and zero filesystem-write
code paths. The only daemon RPC methods involved (`validatePath`,
`scanClaudeDir`, `createProject`, `importArtifacts`) are called in the same
shapes, same call sequence, and same security posture (path-confined,
read-only-against-target-repo for the scan, write-confined-to-`.symbion/`
for the writes) that already exists and has already presumably passed CSO
review for those RPCs when they originally shipped. This is purely an
`apps/web` UI-wiring change (new components + a new client-side state
machine orchestrating existing RPC calls in existing sequences). Per
CLAUDE.md's stated `/cso` trigger bar ("changes to RPC handlers" /
"touching RPC / fs-write / secrets"), none of those triggers fire here.
`/cso` is not required for this loop; proceed `/review` (code-reviewer +
architect) → `/qa` → `/ship`.

**Suggested next step:** `/build` (feature-builder/dev) to implement per
§10.3's file list, then `/review`.

## 11. BUILD — implementation notes (feature-builder)

Implemented exactly per §10.3's file list. Zero daemon/`packages/core`/
`packages/rpc-types` changes — confirmed pure `apps/web` change as planned.

### Files changed

- **New** `apps/web/src/components/ImportReviewStep.tsx` — extracted verbatim
  from `ImportDialog.tsx`'s former inline `{scanned && (...)}` JSX block.
  Props exactly per plan: `{ scanned: ScanClaudeDirResult["parsed"]; selected:
  Set<string>; onToggle: (id: string) => void }`. No RPC, no internal state.
- **New** `apps/web/src/components/WorkflowDetectionPanel.tsx` — props exactly
  per plan: `{ hasClaudeDir, hasAgentsMd, importAvailable, onConfirm,
  onDecline }`. Renders the Codex-only informational variant (single
  "Đã hiểu, tạo trống" button, no import affordance) when `importAvailable`
  is false; renders the two-button confirm/decline variant otherwise, with a
  combined "(chỉ hiển thị, chưa hỗ trợ nhập)" suffix when both `.claude/` and
  `AGENTS.md` are detected together. Copy taken verbatim from design.md
  wireframes (b)/(c)/(e), including the inline "File gốc trong repo sẽ KHÔNG
  bị chỉnh sửa" safety line (kept visible, not behind a tooltip).
- **New** `apps/web/src/components/ImportScanningState.tsx` — tiny spinner +
  "Đang quét .claude/…" row. Accepts an unused, forward-compat `onCancel?`
  prop per plan (not wired to any button this iteration).
- **Modified** `apps/web/src/components/ImportDialog.tsx` — replaced the
  inline checkbox-review JSX with `<ImportReviewStep scanned={scanned}
  selected={selected} onToggle={toggle} />`. No other change: `path`/
  `scanned`/`selected`/`projectName`/`handleScan`/`toggle`/`handleImport`
  logic, props, and entry point are byte-for-byte unchanged otherwise.
- **Rewritten** `apps/web/src/components/CreateProjectDialog.tsx` — added the
  `step: "form" | "detected" | "scanning" | "review"` state machine, a
  `declined: boolean` flag, and local `scanned`/`selected`/`scanError` state.
  Key wiring:
  - A `useEffect` keyed on `[validation, alreadyAProject]` performs the eager
    `scanClaudeDir` call (§10.1) the instant `validation.hasClaudeDir` is
    true and `alreadyAProject` is false; resolves to `step: "detected"` only
    if `hasImportableContent(parsed)` (agents+commands+skipped > 0) or
    `hasAgentsMd` is true, otherwise stays on `step: "form"` (empty-dir false
    positive fix, testplan A3.4/B3).
  - `hasAgentsMd`-only (no `.claude/`) skips the `scanClaudeDir` call
    entirely and goes straight to `step: "detected"` with the informational
    panel (testplan A3.5).
  - `alreadyAProject = projects.some(p => p.path === path.trim())` against
    `useArtifactStore.projects`, computed before the effect runs — EC-4
    short-circuit, zero new RPC (testplan A3.6).
  - Decline (`handleDecline`) is a pure local state transition (`step:
    "form"`, `declined: true`) — zero RPC beyond the eager scan already
    made (testplan A3.7).
  - Confirm (`handleConfirm`) just flips `step` to `"review"` — reuses the
    already-cached `scanned`/`selected` from the eager call, zero additional
    RPC (testplan A3.8).
  - `handleImport` calls `createProject` then `importArtifacts` with
    `selectedIds: Array.from(selected)`, mirroring `ImportDialog.handleImport`'s
    existing two-call sequence (testplan A3.9).
  - Path `Input` and "Chọn…" `Button` are passed `disabled={pathFieldDisabled}`
    where `pathFieldDisabled = step === "scanning" || step === "review"`
    (testplan A3.11). Note: in practice `step` rarely if ever reaches
    `"scanning"` in the eager-scan model — see Assumption 3 below.
  - Scan RPC failure sets `scanError` and stays on `step: "detected"`,
    rendering an inline error block with "Thử lại" (`handleRetryScan`, which
    resets to `step: "form"` and re-runs `validatePath` to re-trigger the
    eager-scan effect) and "Tạo dự án trống" (reuses `handleDecline`)
    (testplan A3.12).
  - "Quay lại" from `step: "review"` returns to `step: "detected"`,
    preserving `scanned`/`selected` (no re-scan) — per design's autopilot
    decision #2.
  - Dialog width stays `w-[480px]` across all steps — per design's autopilot
    decision #3. Dialog title changes to "Tạo dự án mới — Xem lại trước khi
    nhập" only during `step: "review"` (wireframe (c)).
  - The passive hint line under the path field is only rendered when
    `step === "form"` (so it doesn't visually compete with the detection
    panel in `step === "detected"`); its existing `.claude/ đã có (xem xét
    Import)` text is replaced by `.claude/ đã có (đã chọn tạo dự án trống)`
    when `declined` is true (wireframe (d)).

### Assumptions made (for Checker to verify)

1. **`step: "scanning"` is effectively unreachable in normal operation** —
   per PLAN §10.1's own framing ("S3 kept... only as a fallback... not as a
   guaranteed-to-render step"), the eager-scan `useEffect` never explicitly
   sets `step` to `"scanning"` while the `scanClaudeDir` promise is pending;
   it stays on whatever `step` it was already in (`"form"` or `"detected"`)
   until the promise resolves, then jumps straight to `"detected"` or stays
   `"form"`. This means `<ImportScanningState />`'s render branch
   (`step === "scanning"`) is currently **dead code in the happy path** —
   it's wired and exported correctly (so a Checker/future dev *could* drive
   `step` into `"scanning"` from `handleRetryScan` or elsewhere) but nothing
   in my implementation currently transitions into it. **Flagging this as a
   gap versus testplan A3 row 11's literal assertion** ("once step is
   scanning... path Input disabled") — I left the `disabled` wiring correct
   for if/when `step` does become `"scanning"`, but I did not add a path to
   actually reach that state, since PLAN §10.1 explicitly described it as
   rare-to-never in the eager model and design's own S3 description matches.
   If the Checker's test plan literally instantiates `step="scanning"` via
   a controlled-prop test harness this is fine; if it expects the *running
   dialog* to visibly pass through a scanning state during the eager
   first-detection flow, it will not observe one (by design, per §10.1).
2. **`handleRetryScan` resets to `step: "form"` then calls `validatePath`
   directly** rather than calling `scanClaudeDir` directly itself — I did
   this so the existing eager-scan `useEffect` (keyed on `validation`) is the
   single place that owns the scan-triggering logic, avoiding a second
   parallel call site. This means "Thử lại" round-trips through
   `validatePath` again before re-attempting `scanClaudeDir` — one extra
   cheap RPC versus a hypothetical direct retry, not flagged as a problem by
   the plan but worth Checker awareness since it's an implementation choice,
   not explicitly specified.
3. **`importAvailable` prop passed to `WorkflowDetectionPanel` is
   `!!validation?.hasClaudeDir && !!scanned`** (i.e., true once the eager
   scan has actually returned and we're showing the panel because it had
   content) — re-derived from `scanned` truthiness rather than a separate
   stored boolean, since by the time `step === "detected"` with
   `hasClaudeDir` true, `scanned` is guaranteed non-null (set synchronously
   before `setStep("detected")` in the same `.then()`).
4. **`projectName` field reuse**: per design §4, `CreateProjectDialog`
   reuses its own existing `name` field (from S1) for S4's review step
   rather than introducing a second name input — `handleImport` falls back
   to the path's last segment if `name` is empty, mirroring
   `ImportDialog.handleImport`'s exact fallback logic.
5. **No new Vitest test files were added** — the testplan (§A) calls for
   `apps/web/src/components/__tests__/*.test.tsx` files, but `apps/web` has
   no existing Vitest/RTL harness wired up today (no `vitest.config`, no
   `__tests__` directory, no testing-library devDependency found). Per the
   task instructions ("do NOT touch apps/daemon or packages/core or
   packages/rpc-types unless... flag it loudly" and "implement EXACTLY what
   the plan specifies"), setting up a new test runner/harness for `apps/web`
   is infrastructure work beyond PLAN §10.3's file list (which lists only
   the 5 component files), so I did not add it. **Flagging this loudly**:
   the testplan's §A unit tests cannot run until `apps/web` has a Vitest+RTL
   setup; this is a real gap the Checker/QA phase should account for
   (verification for now most likely has to be manual/E2E per testplan §B,
   or a follow-up infra task to wire up `apps/web` Vitest before the §A
   tests can be authored).
6. **Verification performed**: `npx tsc --noEmit -p apps/web/tsconfig.json`
   (clean) and `npm run --workspace apps/web build` (Next.js production
   build succeeds, including its own internal type/lint-light pass) — no
   unit tests were run/added (see Assumption 5).

### Deferred / explicitly out of scope (unchanged from PLAN)

- `AGENTS.md` → IR reverse-parsing (Q5, deferred).
- `.github/` detection (Q2, out of v1 provider scope).
- Marker-stamping on import (Q1, locked to never).
- Import-into-an-existing-non-empty-project standalone entry point (EC-5,
  deferred — `ImportDialog` unchanged, still always calls `createProject`
  fresh).
- Cancel-mid-scan affordance (design autopilot decision #4 — `onCancel` prop
  exists on `ImportScanningState` but is unused).

**Suggested next step:** `/review` (code-reviewer + architect). `/cso` not
required per PLAN §10.7 (no daemon/RPC/fs-write changes). Recommend the
Checker specifically re-verify Assumption 1 (scanning-state reachability)
and Assumption 5 (missing Vitest harness) against the testplan's literal
wording before `/qa`.

### 11.1 BUILD — post-review fix (🔴 blocker + 🟡 should-fix from §12.2)

Fixed both findings from the Checker's §12.2 review without touching
architecture, RPC sequencing, or any daemon/`packages/core`/`packages/rpc-types`
file. Still a pure `apps/web` change.

**🔴 Blocker fix — stale `currentProject` after import.**
Added a new `importArtifacts` action to `apps/web/src/lib/store/useArtifactStore.ts`,
following the exact pattern already used by `saveArtifact`/`deleteArtifact`:
calls the `importArtifacts` RPC, then `set({ currentProject: result.project })`
with the daemon's returned (merged) store, and returns the project to the
caller. Both call sites now use this store action instead of a bare
`callRpc("importArtifacts", ...)` whose result was previously discarded:
- `apps/web/src/components/CreateProjectDialog.tsx`'s `handleImport` —
  replaced `await callRpc("importArtifacts", {...})` with
  `await importArtifacts({...})` (the new store action, destructured via
  `useArtifactStore((s) => s.importArtifacts)`).
- `apps/web/src/components/ImportDialog.tsx`'s `handleImport` — same
  substitution. This was the pre-existing latent bug the reviewer noted was
  "duplicated, not introduced" by this PR; now fixed at the source for both
  callers simultaneously via the shared store action, so no future caller
  can reintroduce this class of bug by hand-rolling the RPC call again.

After this fix, `ProjectView`'s render (which reads `currentProject.artifacts`
directly, unchanged) reflects the imported artifacts immediately on dialog
close — no manual reselect-the-project workaround needed. This satisfies
testplan §B1's literal acceptance criterion ("opening it shows exactly the
selected artifacts") on the very first render after import.

**🟡 Should-fix — partial-failure UX after `createProject` succeeds but
`importArtifacts` fails.**
In both `handleImport` functions, the project returned by `createProject` is
now captured into a local `createdProjectName` variable before calling
`importArtifacts`. If `importArtifacts` throws, the catch block now checks
whether `createdProjectName` is set and, if so, surfaces a different,
clearer error message naming the project and explicitly telling the user a
project WAS already created and that they should open it / re-import via
the standalone Import dialog, rather than retry the same action (which would
now hit `already-a-project`). Exact copy:
- `CreateProjectDialog`: `Dự án "<name>" đã được tạo nhưng nhập thất bại:
  <message>. Mở dự án "<name>" trong danh sách bên trái để nhập lại bằng
  "Import .claude/ từ repo".`
- `ImportDialog`: same shape, minus the "Import .claude/ từ repo" suffix
  (since the user is already inside that dialog).
`ImportDialog.tsx` previously had no error-rendering UI at all for
`handleImport` failures (errors were silently swallowed by the `finally`
block resetting `importing` with no `setError` call) — added a `[error,
setError]` state and a `{error && <p className="text-xs
text-destructive">{error}</p>}` block, matching `CreateProjectDialog`'s
existing error-rendering convention exactly.

**Verification re-run after the fix:**
- `npx tsc --noEmit -p apps/web/tsconfig.json` — clean, no errors.
- `npm run --workspace apps/web build` — clean, Next.js production build
  succeeds (5/5 static pages generated).
- No `packages/core`/`apps/daemon`/`packages/rpc-types` files touched —
  confirmed via the same `git diff --stat` boundary check the architect/
  Checker used in §12.1/§12.2; this fix only touches
  `apps/web/src/lib/store/useArtifactStore.ts`,
  `apps/web/src/components/CreateProjectDialog.tsx`, and
  `apps/web/src/components/ImportDialog.tsx`.

**Assumptions for the Checker to re-verify:**
1. `result.project` returned by the daemon's `importArtifacts` handler
   (`apps/daemon/src/rpc/handlers.ts` line 333) is the full merged
   `ProjectStore` (same shape `loadProject`/`createProject`/`saveArtifact`
   already set `currentProject` to) — confirmed by reading the handler
   signature (`ImportArtifactsResult { project: ProjectStore }`), not
   re-verified at runtime in this pass (no daemon was started).
2. The new `importArtifacts` store action does not change `projects` (the
   sidebar list) — only `currentProject`. `ImportDialog.handleImport` still
   separately calls `loadProjects()` after `importArtifacts` succeeds
   (unchanged from before), which is what keeps the sidebar list correct;
   `CreateProjectDialog.handleImport` doesn't need this because `createProject`
   already appends to `projects` synchronously (pre-existing behavior,
   unchanged by this fix).
3. The partial-failure error copy is a string change only — no new state
   machine, no new step, no retry button added (out of scope per the
   reviewer's own framing: "minimal mitigation that fits this loop's scope").
   A full fix (offering an in-dialog "retry import only" action) would need
   the EC-5 RPC-flow work that PLAN §10.2 explicitly deferred; not attempted
   here per the task's explicit instruction not to expand scope.

**Suggested next step:** re-review (fast re-check per §12.3's "Re-review
trigger" — verify the new `currentProject` value after import in
`ProjectView`'s render and re-run `tsc`/`build`, not a full re-review), then
`/qa`.

## 12. REVIEW

### 12.1 Architect findings (architectural-conformance + design-quality review)

**Verdict: PASS.**

Read in full for this pass: this STATE file (§0-11), `load-existing-workflows-design.md`,
`load-existing-workflows-testplan.md`, and the actual `git diff` against
`apps/web/src/components/CreateProjectDialog.tsx`, `ImportDialog.tsx`,
`ImportReviewStep.tsx`, `WorkflowDetectionPanel.tsx`, `ImportScanningState.tsx`.

**1. Implementation vs. PLAN §10 — drift check.**
No material drift found. The `step` state machine (`"form"|"detected"|"scanning"|"review"`),
the eager-`scanClaudeDir`-on-detection wiring, the `hasImportableContent` gate
(`agents.length + commands.length + skipped.length > 0`), the EC-4 client-side
`alreadyAProject` short-circuit, and the `createProject` → `importArtifacts`
two-call sequence in `handleImport` all match §10.1/§10.2/§10.4 verbatim. The
one place implementation is *more conservative* than the design doc's literal
wireframes — `step: "scanning"` is never actually entered in the live eager-scan
path (confirmed by reading the `useEffect`: it calls `scanClaudeDir` without an
intervening `setStep("scanning")`) — is explicitly flagged by the Maker in
§11 Assumption 1 and is consistent with PLAN §10.1's own framing ("kept in the
design only as a fallback... not as a guaranteed-to-render step"). This is
correctly understood by both PLAN and BUILD as intentional, not drift.

**2. Pure `apps/web` change — confirmed.**
`git diff --stat -- apps/daemon packages/core packages/rpc-types` returns
empty; `git status --porcelain` on those same paths is empty. Verified
directly, not just trusted from STATE's own claim. The only daemon/RPC methods
invoked (`validatePath`, `scanClaudeDir`, `createProject`, `importArtifacts`)
are called with identical request shapes and in sequences already exercised
by the existing `ImportDialog` flow — no new call shape, no new handler code
path. Per CLAUDE.md's `/cso` trigger bar ("RPC / fs-write / secrets"), nothing
here qualifies: no RPC handler changed, no new write path, no secret handling.
**Confirmed: `/cso` is genuinely not required for this loop.**

**3. `ImportReviewStep` extraction — architecturally sound, no divergence risk.**
Verified the extraction is byte-for-byte faithful: `git diff` on `ImportDialog.tsx`
shows the old inline `{scanned && (...)}` block replaced 1:1 by
`<ImportReviewStep scanned={scanned} selected={selected} onToggle={toggle} />`,
and `ImportReviewStep.tsx`'s body is character-identical to the removed JSX
(same `✓ N agents`/`✓ M commands` lines, same skipped-reason loop, same
checkbox list, same `kind === "agent" ? a.name : "/"+a.name"` label logic). The
component takes no RPC dependency, no name field, no import-trigger button —
exactly per the design's prop-surface intent ("purely presentational... avoids
it knowing about createProject/importArtifacts at all"). Both callers
(`CreateProjectDialog`, `ImportDialog`) own their own `scanned`/`selected`
state and pass it down identically; there is a single source of truth for the
checkbox-review rendering logic now, so the prior risk of the two dialogs'
JSX silently drifting apart over time is closed by this extraction, not
introduced by it. No duplicated logic found.

**4. Eager-`scanClaudeDir`-on-detection — sound, and correctly NOT a
per-keystroke cost.**
Read the actual `useEffect` dependency array: `[validation, alreadyAProject]`
— `validation` itself only changes once per *debounce-settled* `validatePath`
resolution (the existing 200ms-debounced effect), not once per keystroke. The
new eager-scan effect is keyed off that already-debounced state, not off raw
keystrokes, so it fires once per settled path, not once per character typed.
Additionally the effect explicitly early-returns when
`step !== "form" && step !== "detected"` (line guarding re-entry while
scanning/reviewing) and the cleanup function sets `cancelled = true` on
re-fire, so an in-flight scan from a previous path is correctly abandoned (not
raced) if the user keeps typing. This matches PLAN §10.1's claimed cost model
exactly: "one extra RPC round-trip per debounce-settled path entry... not per
keystroke." No redundant-RPC risk found beyond what PLAN already accepted as a
trade-off (§10.6 item 1).

**5. EC-4 client-side guard — correct layer, correctly implemented as
UX-nicety-not-security-boundary.**
Verified in code: `alreadyAProject = projects.some((p) => p.path === path.trim())`
is a pure in-memory array scan against `useArtifactStore.projects` (populated
by `listProjects` RPC at load and appended to locally on successful
`createProject`) — zero new RPC, zero daemon involvement, exactly as PLAN
§10.5 describes. Confirmed this is the right layer: the daemon's own
`createProject` "already-a-project" throw (unmodified by this diff) remains
the sole authoritative enforcement; this client check only prevents showing a
*misleading* import prompt earlier, it does not gate or replace any write.
If `projects` is stale (e.g. a second Symbion window created a project at the
same path moments earlier), the architecture's existing server-side throw is
still hit when the user clicks through — there is no new correctness gap,
only the same pre-existing freshness window that already existed before this
loop. This is genuinely a UX-layer check, not a relied-upon safety boundary,
and the implementation matches that framing precisely (no enforcement logic,
no blocking write, just an early `return` that skips a scan/panel).

**6. Unnecessary complexity / missing edge cases vs. STATE §5 EC-1..EC-7.**
No unnecessary complexity found — the diff is close to the minimum surface
needed (3 new small presentational components + a state machine added to one
existing dialog + a 1-line delegation change in the other). Edge-case coverage
re-checked directly against the diff:
- EC-1 (no marker / draft status) — untouched, correctly out of scope.
- EC-2 (malformed files / `skipped[]`) — preserved verbatim via the
  extraction; confirmed in `ImportReviewStep.tsx`.
- EC-3 (`AGENTS.md`-only) — `WorkflowDetectionPanel`'s `!importAvailable`
  branch correctly renders decline-only, no import affordance; verified no
  checkbox/button exists for the AGENTS.md case in the component's JSX.
- EC-4 — see point 5 above; confirmed correctly implemented.
- EC-5 (import into existing project later) — correctly deferred;
  `ImportDialog` untouched, still always calls `createProject` fresh.
- EC-6 (duplicate-name collision) — correctly N/A (fresh empty store at
  first-import time); daemon-side `validateAllArtifacts` remains unchanged
  defense-in-depth, not exercised by this diff.
- EC-7 (symlink/path-confinement) — correctly N/A; no new disk-reading code
  path was added, only a new (earlier) call site for the existing
  `scanClaudeDir`, which already goes through `resolveConfinedPath`.

One genuine, if minor, gap worth flagging for the Checker/QA pass rather than
blocking on: the `handleImport` function (`CreateProjectDialog.tsx` lines
196-215) calls `createProject` then `importArtifacts` with no rollback path
if `importArtifacts` throws after `createProject` already succeeded — the
user is left with a freshly created, empty project and a surfaced error, but
no automatic retry-import-into-that-project affordance (since, per EC-5, that
standalone "import into existing project" entry point doesn't exist yet). This
is the same partial-failure shape `ImportDialog.handleImport` already has
today (pre-existing, not introduced by this diff — confirmed by reading
`ImportDialog.tsx`'s unchanged `handleImport`), so it is not new architectural
debt from this loop, but it is now reachable from two entry points instead of
one. Worth a one-line note in QA's manual pass (does the error message at
least tell the user the project WAS created, so they aren't confused into
retrying `createProject` and hitting `already-a-project`?) — not a blocker for
this review, since fixing it would require exactly the EC-5 RPC-flow work
PLAN §10.2 explicitly and reasonably deferred.

**7. "No Vitest/RTL harness in apps/web" — platform debt, correctly flagged,
worth a process note.**
Independently verified: `vitest.workspace.ts` lists projects for
`packages/core` and `apps/daemon` only (`packages/core/vitest.config.ts`,
`apps/daemon/vitest.config.ts` exist; no `apps/web/vitest.config.ts`, no
`__tests__` directory, no `@testing-library/react` devDependency found
anywhere in the tree). The Maker's §11 Assumption 5 claim is accurate, not
overstated. From an architecture standpoint this is **pre-existing platform
debt, not something this loop introduced or should have fixed** — PLAN §10.3's
file list never asked for test-harness setup, and bootstrapping a new test
runner config mid-feature would itself be scope creep relative to "implement
exactly what the plan specifies." However, this is the **second** feature in
recent history (per `docs/learnings.md`'s pattern-tracking convention) where
`apps/web` component logic was added/changed with a testplan that assumes
Vitest+RTL coverage that cannot actually be authored — this is a recurring
gap, not a one-off, and it materially weakens the "TEST PLAN" phase's value
for every `apps/web`-touching feature until fixed. **Recommendation: open a
small, dedicated infra loop ("wire up Vitest + @testing-library/react +
jsdom for apps/web, mirroring packages/core/daemon's existing project-based
vitest.workspace.ts pattern") before the next `apps/web`-heavy feature, rather
than re-deferring it loop after loop.** Until that lands, `apps/web` testplan
§A items in this and future loops should be treated as "spec for a future
harness," with §B (Playwright/chrome-devtools E2E) as the only currently
executable verification — which is in fact what `/qa` will have to do here.
This is a process/tooling observation, not a defect in this feature's design
or implementation, and does not block this review.

**Self-review note:** this PLAN (§10) was authored by this same architect
role. Re-reading it adversarially for this review: the eager-scan resolution
(§10.1) and the EC-4 client-side-check resolution (§10.5) both hold up — they
are minimal, reuse existing primitives, and introduce no new attack surface
or write path. The one place the original PLAN could be faulted in hindsight
is not stress-testing the "scanning state is unreachable" consequence as
explicitly as it could have (it was mentioned but not flagged as a testplan
risk) — the Maker had to discover and self-flag that gap during BUILD instead
of it being anticipated in PLAN. This is a minor planning-thoroughness miss,
not a correctness defect, and does not change the PASS verdict, but is noted
per this role's self-review-discipline obligation rather than treating the
original design as automatically correct.

**Overall verdict: PASS.** Implementation matches PLAN §10 with no
architectural drift, `/cso` is correctly not required, the `ImportReviewStep`
extraction is clean and risk-reducing, the eager-scan design is sound and
correctly bounded (debounce-gated, not per-keystroke), the EC-4 guard is
correctly layered as UX-only, and all STATE §5 edge cases are addressed with
no unnecessary complexity introduced. The one open item (partial-failure UX
after `createProject` succeeds but `importArtifacts` fails) is pre-existing
behavior inherited from `ImportDialog`, not new debt, and is appropriately a
`/qa` manual-check item rather than a review blocker. The apps/web
Vitest/RTL harness gap is real platform debt worth its own future loop, but
is correctly out of this feature's scope.

### 12.2 Code-reviewer findings (independent Checker pass)

Read in full: this STATE file (§0-12.1), `load-existing-workflows-design.md`,
`load-existing-workflows-testplan.md`, the live diff (`git diff` /
`git status`), all five touched/created component files in full, the daemon
handlers for `createProject`/`importArtifacts`/`validatePath`, and
`useArtifactStore.ts`. Also ran `npx tsc --noEmit -p apps/web/tsconfig.json`
(clean), `npm run --workspace apps/web build` (clean), `npm run --workspace
packages/core test -- --run` (77/77 pass), `npm run --workspace apps/daemon
test -- --run` (230/230 pass) — all independently re-run, not trusted from the
Maker's report.

Confirmed independently: `git diff --stat -- apps/daemon packages/core
packages/rpc-types apps/web/src/lib/rpc apps/web/src/lib/store
apps/web/src/components/AppShell.tsx apps/web/src/components/EmptyState.tsx`
is empty — this is genuinely a pure `apps/web` change touching only the 5
files the Maker reported. `/cso` correctly not required.

**🔴 Blocker — `currentProject` is never refreshed with `importArtifacts`'s
result; imported artifacts do not appear until the user manually reselects
the project.**
`CreateProjectDialog.handleImport` (lines 196-215) and the pre-existing
`ImportDialog.handleImport` both run `createProject` (which sets
`useArtifactStore.currentProject` to the freshly created, *empty* store) then
`importArtifacts` (which merges the selected artifacts into the on-disk
store and returns `{ project: store }` with the *merged* artifacts —
verified `apps/daemon/src/rpc/handlers.ts` line 333: `return { project: store
}`) — but neither caller captures that return value and applies it to
`useArtifactStore.currentProject`. `AppShell.tsx` renders `ProjectView`
directly from `currentProject.artifacts` (verified `ProjectView.tsx` lines
36-38), so immediately after a successful import the dialog closes onto a
`ProjectView` showing **zero artifacts** — `project.artifacts.length === 0`
is true even though the disk and the daemon's response a moment earlier both
had N artifacts. The user must manually click away in the sidebar and
reselect the project (which calls `loadProject` → re-fetches from disk) to
see the imported content. This directly contradicts testplan §B1's literal
acceptance step: "opening it shows exactly the selected artifacts (and not
the unchecked one)" — as written, the *initial* render after import fails
this assertion; it only passes after an extra manual navigation the testplan
does not call out as required. Reproducible via code inspection alone (no
runtime needed): trace `handleImport` → `await callRpc("importArtifacts",
...)` → its resolved value is discarded (not even assigned to a variable) →
`resetAll(); onClose();`.
  - **Fix**: capture `importArtifacts`'s result and feed it into the store,
    e.g. `const importResult = await callRpc<...>("importArtifacts", {...});
    useArtifactStore.setState({ currentProject: importResult.project })`, or
    add a thin `applyImportResult`/extend `useArtifactStore` with an
    `importArtifacts` action analogous to `saveArtifact`/`deleteArtifact`
    (which already follow the correct pattern: RPC call → `set({
    currentProject: result.project })`) so both `CreateProjectDialog` and
    `ImportDialog` get the fix for free and the pattern is consistent with
    the rest of the store.
  - Note: this exact shape of bug already existed in `ImportDialog` before
    this PR (pre-existing latent bug, not introduced fresh) — but this PR
    (a) makes the bug reachable from a second, now-primary entry point
    (`CreateProjectDialog`, which PLAN §9 Q3 deliberately made "the single
    universal entry point"), and (b) this is the first loop with a testplan
    that explicitly specifies the exact acceptance criterion (§B1) this bug
    violates, so it should be fixed now rather than re-deferred. Flagging as
    a blocker for *this* loop's PASS rather than "pre-existing, not my
    problem," since `/plan`'s own framing in §10.2 explicitly says this
    loop's new flow "is literally the same two-RPC sequence `ImportDialog`
    already performs today" — meaning this loop knowingly duplicated a
    latent bug into a second surface without anyone (BA/design/plan/build/
    architect-review) catching that the resulting render is stale. The
    architect's §12.1 review pass did not catch this (it focused on
    RPC-sequence/architectural conformance, not the resulting store-state
    correctness after the sequence completes).

**🟡 Should fix — partial-failure UX after `createProject` succeeds but
`importArtifacts` fails leaves the dialog in a confusing, hard-to-recover
state.**
`CreateProjectDialog.handleImport` (same as `ImportDialog.handleImport`):
if `importArtifacts` throws after `createProject` already succeeded (e.g.
`validation-failed` from `validateAllArtifacts`, or a daemon disconnect
mid-sequence), the catch block only calls `setError(...)` — `step` remains
`"review"`, `resetAll()`/`onClose()` are never called, and the project that
was *already created* (now real, on disk, and already appended to
`useArtifactStore.projects`/visible in the sidebar) is not reflected in any
way in the dialog's own state. If the user clicks "Nhập N mục đã chọn" again
without first cancelling, `createProject` is called a second time for the
same path and now throws `already-a-project` (verified
`apps/daemon/src/rpc/handlers.ts` line 218) — surfaced as "Thư mục này đã là
một dự án Symbion," a misleading message that does not explain what actually
happened (a project was created, but the import step failed) or offer a path
to retry just the import. This is the partial-publish-failure edge case the
review checklist explicitly calls out. Confirmed (per architect §12.1 and
independently here) this exact shape pre-exists in `ImportDialog`, so it is
inherited debt, not new, and fixing it properly requires the EC-5
"import-into-an-existing-project" RPC-flow PLAN §10.2 explicitly deferred —
not asking for that here. Minimal mitigation that fits this loop's scope: on
catch, detect that `createProject` succeeded (e.g. track the returned
`project` in a local var/state) and change the error copy to something like
"Dự án đã được tạo nhưng nhập thất bại: <message>. Mở dự án trong danh sách
bên trái để nhập lại." so the user isn't misled into retrying the exact
action that will now fail differently.

**🟢 Nit — `handleRetryScan`'s comment slightly overstates the mechanism.**
`CreateProjectDialog.tsx` lines 217-225: the comment says "re-trigger the
eager-scan effect by nudging validation reference" — confirmed correct in
practice (a fresh `validatePath` call always returns a new object reference,
so the `[validation, alreadyAProject]`-keyed effect reliably re-fires), but
worth a one-line note that this relies on object-identity (not deep-equal)
dependency comparison; if `ValidatePathResult` is ever memoized/cached
upstream this retry path would silently stop working. Not a current bug —
verified `validatePath` handler always constructs and returns a fresh object
literal — just a fragile-by-convention coupling worth a comment for future
maintainers.

**🟢 Nit — `WorkflowDetectionPanel`'s `importAvailable` prop name slightly
undersells what it gates.** The prop also implicitly gates whether the
"both `.claude/` and `AGENTS.md` detected" combined-copy branch (line 57:
`hasAgentsMd && hasClaudeDir ? " (chỉ hiển thị, chưa hỗ trợ nhập)" : ""`)
reads correctly — this is fine functionally (verified the combined-copy
condition only depends on `hasAgentsMd && hasClaudeDir`, not on
`importAvailable` directly, so there's no actual bug), just flagging that a
reader skimming the prop name alone might not immediately realize it also
indirectly drives which of the two top-level JSX branches (informational-only
vs. confirm/decline) renders. No fix required.

**Verified independently, matching the Maker's and architect's claims:**
- The `step` state machine's transitions (confirm = zero new RPC reusing
  cached `scanned`; decline = zero RPC, local state only; path-edited-away
  mid-detection resets to `"form"`; path field + "Chọn…" disabled during
  `"scanning"`/`"review"`) all match PLAN §10/design §5 exactly as described,
  verified by direct code reading, not just trusting the BUILD notes.
- The eager-scan resolution (§10.1) is implemented exactly as specified: the
  `useEffect` fires `scanClaudeDir` the instant `hasClaudeDir` is true (not
  gated behind a click), and the detection panel only shows once
  `hasImportableContent(parsed)` (`agents.length + commands.length +
  skipped.length > 0`) or `hasAgentsMd` is true — confirmed this is a
  post-scan-result gate, not a raw-boolean gate, directly closing the STATE
  §7 empty-`.claude/`-dir false-positive risk.
- EC-4's client-side `alreadyAProject` check is correctly framed and
  implemented as a UX short-circuit only, not a security boundary — the
  daemon's `createProject` "already-a-project" throw is unmodified and
  remains the authoritative backstop. No security claim is made by the
  client-side check alone, and the code does not rely on it for anything
  beyond suppressing a misleading prompt.
- `ImportReviewStep`'s extraction from `ImportDialog.tsx` is byte-for-byte
  behavior-equivalent (diffed directly): the old inline `{scanned && (...)}`
  block and the new component's JSX are textually identical line-for-line
  aside from the `toggle`/`onToggle` rename. `ImportDialog`'s own external
  props (`ImportDialogProps { onClose }`), entry point, and RPC call sequence
  are untouched.
- The "no Vitest/RTL harness in `apps/web`" gap is genuine, pre-existing
  infrastructure debt: `apps/web` has no `vitest.config.ts`, no `__tests__`
  directory, no `@testing-library/react` dependency anywhere in the repo,
  while `packages/core`/`apps/daemon` both have working, passing Vitest
  suites (verified by running them: 77/77 and 230/230 pass, unmodified by
  this PR). This is correctly out of scope for this PR's file list and is
  not something this PR should have silently built per CLAUDE.md's
  "implement exactly what the plan specifies." Given the testplan's own §A
  preamble acknowledges this and falls back to §B (E2E/manual) as the
  executable verification path, the lack of automated component tests for
  this specific UI logic is an **acceptable, explicitly-documented risk**,
  not a blocker on its own — but it does mean the 🔴 finding above
  (stale `currentProject` after import) is exactly the class of bug a
  basic RTL test (`render` → mock RPCs → assert post-import DOM) would have
  caught immediately, reinforcing the architect's §12.1 recommendation to
  prioritize standing up the harness before the next `apps/web`-heavy loop.
- General bug sweep: no null/undefined crashes found (`scanned`/`validation`
  are defensively checked at every read site); no unhandled promise
  rejections (`scanClaudeDir`'s `.catch()` in the eager-scan effect and
  `handleCreate`/`handleImport`'s try/catch both correctly surface errors via
  `setError`); no SSR/CSR mismatch risk (`"use client"` directive present,
  all new components are presentational with no `window`/`document` access
  at module scope); no marker/hash logic touched (out of scope, confirmed);
  no path-confinement regression (`scanClaudeDir`'s underlying
  `readClaudeDirFilemap` still routes through `resolveConfinedPath`,
  unchanged, confirmed by reading `apps/daemon/src/fs/readTargetFiles.ts`).
  The stale-closure risk class CLAUDE.md/learnings.md flags for builder-UI
  helper buttons was specifically checked in the eager-scan `useEffect`
  (dependency array `[validation, alreadyAProject]`, `step` read via closure
  but not listed as a dep) — traced through the actual transition sequences
  and found no observable staleness bug in practice, because every path that
  could matter either re-derives `validation` (a fresh object, re-triggering
  the effect) or is blocked by `step`'s own values disabling the relevant UI
  controls (`pathFieldDisabled`) before a stale read could matter.

### 12.3 Checker verdict

**NEEDS-WORK.**

One 🔴 blocker (stale `currentProject` after import — the imported artifacts
do not visibly appear until the user manually reselects the project,
violating testplan §B1's literal acceptance criterion) must be fixed before
this ships. This is a small, well-scoped fix (apply `importArtifacts`'s
returned `project` to `useArtifactStore.currentProject`, ideally via a new
store action mirroring the existing `saveArtifact`/`deleteArtifact` pattern,
used by both `CreateProjectDialog` and `ImportDialog`) and does not require
revisiting any of the already-correct architecture, RPC sequencing, or
edge-case handling verified above.

The 🟡 (partial-failure error copy after `createProject` succeeds but
`importArtifacts` fails) is a should-fix, not a blocker — recommend
addressing in the same patch since the fix is adjacent, but it does not by
itself gate PASS.

Everything else independently verified as correct: pure `apps/web` change
(`/cso` correctly not required), `step` state machine transitions match
PLAN/design exactly, eager-scan empty-dir false-positive fix works as
specified, EC-4 guard correctly framed as UX-only (not a security boundary),
`ImportReviewStep` extraction is behavior-identical, `tsc --noEmit` and
`next build` both clean, `packages/core` (77/77) and `apps/daemon` (230/230)
tests pass unmodified, and the missing apps/web Vitest/RTL harness is
genuine pre-existing infra debt rather than scope this PR should have
silently absorbed.

**Re-review trigger**: once the 🔴 is patched, this should be a fast
re-check (verify the new `currentProject` value after import in
`AppShell`/`ProjectView` render, re-run `tsc`/`build`/existing test suites) —
not a full re-review.

### 12.4 Re-review of blocker fix (independent Checker, scoped re-check)

Scoped to verifying the fix described in §11.1 only — not a full re-review of
the feature. Read the live `git diff` for the three touched files
(`apps/web/src/lib/store/useArtifactStore.ts`, `CreateProjectDialog.tsx`,
`ImportDialog.tsx`), `apps/daemon/src/rpc/handlers.ts`'s `importArtifacts`
handler (lines ~296-330), `packages/rpc-types/src/index.ts`'s
`ImportArtifactsResult` type, and `AppShell.tsx` → `ProjectView.tsx`'s render
path. Independently re-ran `npx tsc --noEmit -p apps/web/tsconfig.json`,
`npm run --workspace apps/web build`, `npm run --workspace apps/daemon test -- --run`,
`npm run --workspace packages/core test -- --run`.

**1. `importArtifacts` store action genuinely fixes the blocker — confirmed
by direct code reading, not by trusting the Maker's description.**
Daemon handler (`apps/daemon/src/rpc/handlers.ts`):
```ts
importArtifacts(params: contract.ImportArtifactsParams): contract.ImportArtifactsResult {
  ...
  saveProjectStore(path, store);
  return { project: store };  // store.artifacts already has the merge applied
}
```
`ImportArtifactsResult` (`packages/rpc-types/src/index.ts` line 155-157) is
`{ project: ProjectStore }` — the same `ProjectStore` shape
`createProject`/`loadProject`/`saveArtifact` already use to set
`currentProject`. The new store action:
```ts
async importArtifacts(params) {
  const result = await callRpc<ImportArtifactsParams, ImportArtifactsResult>("importArtifacts", params);
  set({ currentProject: result.project });
  return result.project;
}
```
sets `currentProject` to the **merged, post-write** store returned by the
daemon — i.e. `store.artifacts` at that point already contains
`existingOthers` (empty, at first-import time) plus every selected artifact
pushed/replaced in the loop just above the `return`. This is exactly the
value that was missing before the fix. Confirmed correct, not just
plausible-looking.

**2. `ProjectView` data flow re-traced end to end — renders correctly.**
`useArtifactStore.importArtifacts` → `set({ currentProject: result.project })`
→ `AppShell.tsx` line 16 (`const currentProject = useArtifactStore((s) => s.currentProject)`)
→ line 52 (`<ProjectView project={currentProject} />`) → `ProjectView.tsx`
line 34 (`const agents = project.artifacts.filter(...)`)/line 36
(`isEmpty = project.artifacts.length === 0`). Since `currentProject` is now
the daemon's just-returned merged store (not the empty store `createProject`
set a moment earlier), `project.artifacts.length` is N (the import count),
not 0, on the very first render after the dialog closes. This satisfies
testplan §B1's literal acceptance criterion without requiring a manual
project reselect. Confirmed by reading the actual component code, not
assumed from the Maker's narrative.

**3. Both call sites consistently use the new store action — no leftover
bypass.** `grep -rn 'callRpc.*"importArtifacts"' apps/web/src/` returns
exactly one hit: inside `useArtifactStore.importArtifacts` itself (the
canonical, single call site). Both `CreateProjectDialog.handleImport` and
`ImportDialog.handleImport` now call `await importArtifacts({...})` via
`useArtifactStore((s) => s.importArtifacts)` — confirmed no caller hand-rolls
a bare `callRpc("importArtifacts", ...)` that would discard the result and
reintroduce the stale-`currentProject` bug. `ImportDialog`'s remaining
`callRpc` usage is only for `scanClaudeDir` (unrelated, unaffected,
read-only), so the import is not a dangling/unused leftover.

One adjacent, pre-existing detail re-verified rather than assumed: in
`ImportDialog.handleImport`, `await loadProjects()` still runs after
`importArtifacts` succeeds (unchanged from before this fix) — this refreshes
the **sidebar project list** (`projects`), which is a separate piece of state
from `currentProject`; the new store action does not touch `projects`, so
`loadProjects()` is still needed and correctly retained for that purpose.
`CreateProjectDialog.handleImport` has no equivalent call because
`createProject` already appends synchronously to `projects` (pre-existing,
unchanged behavior) — confirmed this isn't a missed call, by reading
`useArtifactStore.createProject`'s implementation.

**4. Partial-failure error copy — reasonable minimal mitigation, scoped
correctly.** Both `handleImport` functions now capture
`createdProjectName = project.name` right after `createProject` resolves,
and on catch, branch the error message based on whether that capture
happened. This correctly distinguishes "nothing was created" (plain message)
from "a project now exists on disk but import failed" (named, actionable
message pointing at the sidebar). This does not rebuild a retry-flow or add
the EC-5 "import into existing project" RPC affordance — consistent with the
explicit scope note in §11.1 Assumption 3 ("minimal mitigation... not
attempted here per the task's explicit instruction not to expand scope").
`ImportDialog.tsx` previously had **zero** error-rendering UI for
`handleImport` failures at all (errors were silently swallowed in the
`finally` block) — confirmed by diff: the new `[error, setError]` state and
`{error && <p className="text-xs text-destructive">{error}</p>}` block are a
genuine net improvement, not just copy-paste noise, and match
`CreateProjectDialog`'s pre-existing error-rendering convention exactly (same
className, same structure). No new regression: `callRpc` import in
`ImportDialog.tsx` remains used (for `scanClaudeDir`), no unused-import lint
risk.

**5. Verification re-run independently (not trusted from Maker's report):**
- `npx tsc --noEmit -p apps/web/tsconfig.json` — clean, exit 0.
- `npm run --workspace apps/web build` — clean, Next.js production build
  succeeds, 5/5 static pages generated, no new warnings.
- `npm run --workspace apps/daemon test -- --run` — 230/230 pass (18 test
  files), unaffected as expected since no daemon file changed.
- `npm run --workspace packages/core test -- --run` — 77/77 pass (13 test
  files), unaffected as expected since no core file changed.
- `git diff --stat -- apps/daemon packages/core packages/rpc-types` — empty,
  confirming this fix touched exactly the three files claimed
  (`useArtifactStore.ts`, `CreateProjectDialog.tsx`, `ImportDialog.tsx`) plus
  the auto-generated `apps/web/tsconfig.tsbuildinfo`. No daemon/core/RPC-type
  surface was touched; `/cso` remains correctly not required for this fix.

**No new issues found.** The fix is minimal, correctly typed, follows the
existing `saveArtifact`/`deleteArtifact` store-action pattern exactly as the
Maker described, and closes the data-flow gap identified in §12.2's blocker
at the correct layer (the shared store, so both callers get the fix for
free and no future caller can hand-roll the bug again). The 🟡 partial-failure
UX improvement is a reasonable, appropriately-scoped mitigation, not a full
fix, and was not expected to be one.

**Verdict: PASS** for this specific fix. The 🔴 blocker from §12.2 is
resolved; the 🟡 should-fix from §12.2 has a reasonable minimal mitigation
applied. No regressions in `tsc`, `next build`, or the daemon/core test
suites. This re-review does not re-litigate the rest of the feature (state
machine, eager-scan, EC-4 guard, `ImportReviewStep` extraction, etc.), which
were already independently verified as correct in §12.1/§12.2 and were not
touched by this fix.

## 13. QA

**Verdict: PASS.**

Ran live against the actual built daemon (`apps/daemon/dist/server.js`'s
`startServer`, invoked directly to bypass the interactive boot menu — daemon
is otherwise unmodified) and the Next.js dev server, per the testplan's own
acknowledgment (§testplan preamble) that `apps/web` has no Vitest/RTL harness
and this environment has no Playwright/chrome-devtools browser available.

### 13.1 Build — PASS

`npm run build` from repo root: all four workspaces (`@symbion/core`,
`@symbion/rpc-types`, `@symbion/daemon`, `@symbion/web`) build cleanly.
`@symbion/web`'s `next build` compiles successfully, generates 5/5 static
pages, no new warnings.

### 13.2 Test suites — PASS, unaffected (re-confirmed fresh, not assumed)

- `npm run test:core -- --run` → **77/77 pass** (13 test files).
- `npm run test:daemon -- --run` → **230/230 pass** (18 test files).

Matches the counts already reported in §12.2/§12.4; re-run fresh in this QA
pass rather than trusted from the Checker's report. Confirms this feature
(pure `apps/web`) did not regress either suite.

### 13.3 Daemon + web dev servers — PASS

Started the daemon by calling `startServer({ port, version })` directly from
a throwaway script (avoids the interactive boot menu, which doesn't fit a
scripted QA pass; the server itself — `apps/daemon/src/server.ts` — was not
modified to do this). `ping` RPC returned `{"ok":true,...}` immediately.

Started `apps/web` via `npm run dev:web` (`next dev`). `curl -s -o /dev/null
-w "%{http_code}" http://127.0.0.1:3000/` → **200**. Confirmed via the dev
server's own access log: `GET / 200 in 2599ms`.

(The daemon's own root route returns 404 in this harness because no
`webStaticRoot`/static export was wired into the throwaway script — this is
expected and unrelated to the feature; the web root-route check above is the
one that matters for "does the app serve," and it returned 200.)

### 13.4 Live RPC verification (direct calls, real auth headers)

All calls made with `Content-Type: application/json`, `Origin:
http://127.0.0.1:<port>`, and `x-symbion-token: <the per-boot token>` headers
— matching `apps/daemon/src/server.ts`'s actual contract (`isAllowedHost`
Origin/Host check + `x-symbion-token` required for every method except
`ping`).

**(a)/(b)/(c) — fixture with real `.claude/agents/test-agent.md` +
`.claude/commands/test-cmd.md` (valid YAML frontmatter: `description` field
present, matching `parseFrontmatter`'s only hard-required key; no
`managed-by` marker, matching the "hand-written repo" scenario this feature
targets):**
- `validatePath` → `{"exists":true,"isDir":true,"hasClaudeDir":true,"hasAgentsMd":false,"writable":true}` — **confirmed `hasClaudeDir: true`.**
- `scanClaudeDir` → returned exactly 1 agent (`test-agent`, `tools:
  ["Read","Write"]`, `meta.status:"draft"`) + 1 command (`test-cmd`,
  `usesArguments:true` since body contains `$ARGUMENTS`) + 0 skipped —
  **confirmed the parsed artifacts match the fixture exactly**, `status:
  "draft"` per EC-1's locked semantics (no marker → draft, never published).

**(d) — `createProject` then `importArtifacts` (same two-call sequence
`CreateProjectDialog`/`ImportDialog` now both perform):**
- `createProject` → returned a fresh `ProjectStore` with `artifacts: []`,
  wrote `.symbion/store.json`.
- `importArtifacts` (called with `projectId` from the prior response +
  `scanned` = the two parsed items + `selectedIds` = both ids) → returned
  `{"project": {..., "artifacts": [test-agent, test-cmd], ...}}`.
  **Confirmed `result.project.artifacts` contains both imported items** —
  exactly the shape `useArtifactStore.importArtifacts`'s `set({
  currentProject: result.project })` (the §11.1/§12.2/§12.4 blocker fix)
  expects and consumes. Independently re-verified the store action's source
  (`apps/web/src/lib/store/useArtifactStore.ts` lines 95-98) matches this
  response shape exactly.
- **Original files on disk verified byte-for-byte unchanged** after import
  (`cat`'d both `.md` files post-import — identical to their pre-import
  content, no marker appended, no rewrite). Only `.symbion/store.json` was
  written. Confirms the "read-only against target repo" guarantee holds in
  practice, not just by code reading.

**(e) — EC-4 guard, same path re-used (now has `.symbion/store.json` from
the prior `createProject` call):**
- `createProject` on that same path → **`400` `{"error":{"code":
  "already-a-project","message":"Thư mục này đã là một dự án Symbion."}}`** —
  confirmed the guard the UI's client-side `alreadyAProject` check defers to
  is intact and unmodified.

**(f) — empty-`.claude/`-dir false-positive fix:** created a separate
fixture with `.claude/agents/` and `.claude/commands/` both present but
containing zero `.md` files.
- `validatePath` → `hasClaudeDir: true` (directory exists, as expected — this
  is exactly the boolean-only signal the design correctly chose NOT to rely
  on alone).
- `scanClaudeDir` → `{"parsed":{"agents":[],"commands":[],"hooks":[],
  "skipped":[]}}` — **confirmed zero agents + zero commands + zero skipped**,
  which is precisely the `hasImportableContent(parsed) === false` signal
  `CreateProjectDialog`'s eager-scan effect (line 107) uses to keep `step`
  at `"form"` instead of advancing to `"detected"`, suppressing the
  false-positive detection panel.

### 13.5 Code-trace verification of `CreateProjectDialog.tsx` (NOT equivalent to live browser testing — flagged explicitly)

Read `apps/web/src/components/CreateProjectDialog.tsx` end-to-end and hand-traced
both branches of the eager-scan `useEffect` (lines 77-126):

- **Non-empty scan path**: `validatePath` resolves with `hasClaudeDir: true` →
  effect's early-return guards (lines 81, 90, 96) are all skipped → 
  `scanClaudeDir` is called → `.then()` finds `hasImportableContent(result.parsed)
  === true` → `setScanned(...)`, `setSelected(...)`, `setStep("detected")` →
  render: `step === "detected" && !scanError` is true (line 295) →
  `<WorkflowDetectionPanel>` renders with `importAvailable={!!validation?.hasClaudeDir
  && !!scanned}` = `true`. **Confirmed: reaches `step:"detected"` and renders
  the panel**, as designed.
- **Empty scan path**: same up through the `scanClaudeDir` call; `.then()`
  finds `hasImportableContent(result.parsed) === false` (and, in the
  fixture's case, `hasAgentsMd` also false) → `setScanned(null)`,
  `setStep("form")` → render: `step === "detected"` is false → no panel
  renders, `step` stays `"form"`. **Confirmed: no false positive.**

This is a **code-trace verification only** — it confirms the state-machine
logic is internally consistent by manual reading, not that the actual
rendered DOM/React component behaves this way when mounted in a real
browser. It is explicitly **not equivalent** to browser-level testing
(RTL/Playwright/chrome-devtools), none of which is available in this
environment. This gap is pre-existing platform debt (§12.1/§12.2's
"apps/web has no Vitest/RTL harness" finding), not something this QA pass
can close.

### 13.6 Acceptance criteria vs. testplan — systematic check

- **§A (Vitest unit tests, apps/web)**: cannot be executed — no harness
  exists (confirmed again: no `apps/web/vitest.config.ts`, no
  `__testing-library/react` dependency). Per testplan's own preamble this is
  an acknowledged, pre-existing gap, not a new failure introduced by this
  QA pass. Not a blocker for this feature's QA, consistent with §12's
  framing.
- **§A — regression-only checks for daemon/core**: `scanClaudeDir`/
  `importArtifacts`/`parseClaudeDir`/`parseClaudeFile` unit/integration
  tests unchanged and passing (77/77 core, 230/230 daemon) — **PASS**.
- **§B (E2E/Playwright/chrome-devtools)**: no browser tooling available in
  this environment (consistent with prior features' QA notes per the task's
  own framing) — substituted with direct RPC verification (§13.4) covering
  the data-layer equivalents of B1 (happy path import + on-disk-unchanged
  check), B3 (empty-dir false positive), B5 (EC-4 guard), plus a code-trace
  (§13.5) for the UI state-machine logic B1/B2 depend on. B2 (decline path),
  B4 (AGENTS.md-only informational case), B6 (re-prompt/no-memory), and B7
  (cancel-at-every-step) were **not independently exercised** in this QA
  pass — they depend on UI interaction (button clicks) that requires a real
  browser; the code-trace in §13.5 and the architect/Checker's §12.1/§12.2
  code-reading already cover the relevant logic (`handleDecline`,
  `WorkflowDetectionPanel`'s AGENTS.md-only branch, `declined` being
  component-state-only/non-persisted, `Hủy` button calling `onClose`
  directly with no side effects) but this QA pass does not add new evidence
  beyond what §12 already verified for those specific scenarios. Flagging
  honestly rather than claiming full §B coverage.
- **EC-1 (draft status, no marker)**: confirmed live — both imported
  artifacts show `meta.status: "draft"`, no marker on the original files.
  **PASS**.
- **EC-2 (malformed files → skipped[])**: not re-exercised with a malformed
  fixture in this pass (already covered by `packages/core`'s
  `scan.test.ts`, 2/2 passing, unchanged) — not re-tested live since this
  loop doesn't touch the parser. **PASS by existing-test coverage,
  unmodified.**
- **EC-3 (AGENTS.md-only/Codex informational)**: not independently
  re-exercised live (would require a fixture + the same UI-click dependency
  as §B4 above); covered by code-reading in §12.1/§12.2 and this QA's own
  read of `WorkflowDetectionPanel.tsx`'s `!importAvailable` branch (decline-only,
  no import affordance) — **PASS by code-reading, not live exercise.**
- **EC-4 (already-a-project guard)**: confirmed live via direct RPC call
  (§13.4e). **PASS.**
- **EC-5/EC-6/EC-7**: out of this loop's scope / not applicable per STATE
  §10.2/§10.5 — confirmed unchanged, no new code path. **PASS (N/A,
  consistent with PLAN/REVIEW).**

### 13.7 Cleanup

All temp fixture directories (`fixture-claude/`, `fixture-empty/`, scan/
create/import result JSON files, the throwaway daemon-start script) were
created under and removed from the session scratchpad
(`/tmp/claude-1000/.../scratchpad/qa8/`) — none were written inside the
repository. The background daemon process exited on its own during cleanup
(killed via `pkill`); the `next dev` process and its `next-server` child
were killed explicitly (PIDs 60811/60812/60824). Confirmed no leftover
daemon/web processes remain (`pgrep` returns none other than the cleanup
command's own subshell). `git status --porcelain` after cleanup shows only
the pre-existing feature diff from BUILD/REVIEW (unmodified `CreateProjectDialog.tsx`,
`ImportDialog.tsx`, `useArtifactStore.ts`, the three new components, and the
three `docs/loops/load-existing-workflows-*.md` docs) — no QA-run artifacts
leaked into the working tree.

### 13.8 Overall verdict

**PASS.** Build is clean across all workspaces. `packages/core` (77/77) and
`apps/daemon` (230/230) tests pass fresh and unaffected, confirming this
remains a pure `apps/web` change. The daemon + web dev servers run and serve
correctly (root route 200). Every RPC-level behavior this feature depends on
— `validatePath`'s `hasClaudeDir` detection, `scanClaudeDir`'s parsed-vs-empty
distinction (the empty-dir false-positive fix), the `createProject` →
`importArtifacts` sequence and its response shape (the §11.1 blocker fix),
the EC-4 `already-a-project` guard, and the read-only-against-target-repo
guarantee (original `.claude/*.md` files byte-for-byte unchanged after
import) — was independently exercised live against the real daemon and
confirmed correct. The `CreateProjectDialog` state-machine logic for both the
non-empty and empty detection-panel paths was hand-traced and is internally
consistent with the live RPC results. The one honest gap: §B's interactive
UI scenarios (decline button, AGENTS.md-only panel rendering, re-prompt
behavior, cancel-at-every-step) could not be exercised in a real browser in
this environment (no Playwright/chrome-devtools/RTL harness available,
consistent with prior loops' QA notes) — this is pre-existing platform debt
already flagged by the architect (§12.1) and Checker (§12.2), not a defect
introduced by or hidden in this feature, and does not block PASS given the
live RPC + code-trace evidence gathered above covers the underlying logic
those scenarios depend on.

**Suggested next step:** `/ship`.
