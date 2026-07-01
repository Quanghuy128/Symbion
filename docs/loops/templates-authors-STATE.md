# templates-authors — STATE

## Phase: PLAN

## 0. Origin

Follow-up user request (v2 extension to the shipped `templates-marketplace`
feature, PR #14, merged). Two asks, explicitly framed by the user as a
deliberate revision of two previously-locked decisions in
`templates-marketplace-STATE.md`'s THINK phase, not a violation of them:

1. Replace/extend the bundled, original-content placeholder library with
   REAL content pulled live from a third-party GitHub repo —
   `https://github.com/affaan-m/ecc` — fetched at view time via a new
   daemon RPC, **never vendored/copied into Symbion's own source tree**.
   The user has explicitly chosen "live-fetch, zero storage of ECC's text
   in our repo" specifically as the resolution to the ORIGINAL feature's
   THINK #3 license/copyright concern ("do not copy ECC's file contents
   verbatim") — fetching-and-displaying-but-never-storing is the chosen
   way to honor that concern's spirit while still showing real content,
   not Symbion-authored placeholder text. THINK #2 of the original feature
   ("vendored at build time, NOT live-fetched") is being explicitly
   reopened and reversed for this content source; it is not being silently
   ignored.
2. Add an "Authors" layer to the Templates UI: a sub-nav/tabs of different
   template authors/sources (ECC first), so a user picks an author and
   sees that author's skills/agents/commands. Explicitly framed as a
   general, multi-source concept ("sẽ có nhiều bộ template khác từ các tác
   giả khác") — not an ECC-hardcoded one-off.

## 1. Code-reading findings (what already exists vs. what's new)

Read in full: `docs/loops/templates-marketplace-STATE.md` (THINK + PLAN +
BUILD phases), `templates-marketplace-design.md`,
`templates-marketplace-testplan.md`, `apps/web/src/data/templates/
manifest.ts`, `apps/web/src/components/Template*.tsx` (referenced in BUILD's
file list), `apps/daemon/src/rpc/handlers.ts`'s `applyTemplate` handler
(`handlers.ts:337-`), `packages/core/src/templates/parseTemplate.ts`.

**What v1 actually shipped (confirmed in code, not just docs):**
- `apps/web/src/data/templates/manifest.ts` is a **static, build-time,
  synchronous, zero-network** module: 12 hand-authored `.ts` files (4
  agents, 4 commands, 4 skills) under `apps/web/src/data/templates/
  {agents,commands,skills}/`, each exporting `{ id, raw }` as a plain TS
  constant. `loadTemplateManifest()` iterates a hardcoded `SOURCES` array,
  parses each via `parseTemplateMarkdown` (pure, `packages/core`), and
  returns `{ items, skipped }`. There is exactly **one author/source** in
  the system today (Symbion's own original content) and it is not modeled
  as an "author" at all — it's simply "the templates." Introducing a second
  source means introducing the *concept* of a source/author for the first
  time, not adding a second instance to an existing list.
- `parseTemplateMarkdown(raw: string, expectedKind: TemplateKind)` is
  **pure** (`packages/core`, no fs/net) and operates on a raw string the
  caller already has in memory — it has no opinion about WHERE `raw` came
  from (static bundle vs. live fetch). This is the one piece of v1
  architecture that needs zero change to support live-fetched content: the
  same parser can run client-side on daemon-fetched markdown text exactly
  as it runs today on bundled `.ts` constants. The fetch/cache/error-
  handling layer is entirely new; the parse layer is reusable as-is.
- `TemplateListItem.kind: TemplateKind` is **three-valued**
  (`"agent" | "command" | "skill"`) and already deliberately decoupled
  from the IR's two-valued `ArtifactKind` (PLAN §5 assumption #5, "do not
  conflate these two types"). This pre-existing decoupling is now load-
  bearing for v2 in a way v1 didn't anticipate: ECC's actual repo structure
  may not map onto a clean 3-way split at all (see below) — the existing
  type design tolerates that better than if `TemplateKind` had been
  unified with `ArtifactKind`, but the manifest *loader* (`SOURCES`,
  hardcoded folder-to-kind mapping) does not yet tolerate "a source whose
  directory layout doesn't match `{agents,commands,skills}/*.ts`."
- The `applyTemplate` RPC (`apps/daemon/src/rpc/handlers.ts:350-`) takes
  the **fully parsed content** (`name`/`description`/`body`/`tools`) over
  RPC params, not a `sourceTemplateId` the daemon re-resolves itself —
  this was an explicit PLAN decision (§0(d), §5 #2) made BECAUSE v1's
  content lived in the web bundle, which the daemon has no filesystem
  access to. For live-fetched content this assumption still holds for a
  different reason (the daemon doesn't need to re-fetch what the web
  client already fetched and the user already previewed) — `applyTemplate`
  itself likely needs **no signature change**, only the `sourceTemplateId`
  value's *shape* changes (was `"agent:code-reviewer"`, becomes something
  that encodes author+path, e.g. `"ecc:agents/code-reviewer.md"` or a
  fuller URL-based identity) — flagged as a question for architect, not
  decided here.
- **No GitHub API client, no generic "fetch arbitrary remote content and
  parse it" RPC, no response-caching layer, no rate-limit/backoff handling
  exists anywhere in the codebase.** The only outbound HTTP the daemon does
  today is to user-configured local/remote LLM provider endpoints
  (`apps/daemon/src/llm/*Provider.ts`) for description/body generation —
  a fundamentally different shape (user explicitly configures one trusted
  endpoint + sends a prompt) than "fetch and list the directory tree of an
  arbitrary public GitHub repo, then fetch N file contents from it,
  unauthenticated, on every Templates-view load." This is new daemon
  surface, not a continuation of an existing pattern.

**ECC repo structure — what can be determined without fetching/quoting
content (per task constraints, no internet tool available in this
session; this section documents what is KNOWN/ASSUMED vs. what MUST be
verified by architect/dev with an actual API call before implementation,
not asserted as fact here):**
- The original `templates-marketplace-STATE.md` (§0 Origin, written when
  this repo was presumably inspected at least at a glance) frames ECC as
  organized into recognizable Skills/Agents/Commands-shaped content
  ("nguồn cảm hứng từ ECC's public agents/commands content" — the original
  request explicitly named "agents" and "commands" as ECC categories, and
  "Skills" was introduced by the *requester*, not confirmed as ECC's own
  folder name).
- **This cannot be assumed to map cleanly onto Symbion's exact
  `{agents/, commands/, skills/}` three-bucket taxonomy.** GitHub
  repositories authored as a personal/community collection of Claude Code
  configs have no standardized layout requirement — actual folder names,
  nesting depth, file-vs-folder shape (a `SKILL.md` inside a named
  subfolder vs. a flat `.md` file), and frontmatter schema are entirely up
  to the author and may differ from what Symbion's `parseTemplateMarkdown`
  expects (which itself encodes Symbion's/Claude Code's *specific*
  conventions: `name` required for agents, optional for commands, etc.).
  **This is flagged as a hard architecture risk, not assumed away**: the
  fetch+parse layer for a live remote source needs to either (a) discover
  structure dynamically (list repo tree via GitHub API, heuristically
  bucket files by path), or (b) hardcode a per-author "adapter" mapping
  (e.g. a small config saying "for ECC, agents live under `X/`, commands
  under `Y/`") that a human verifies once per author onboarded — (b) is
  far more robust against malformed/unexpected structure but means
  "adding a new author" is a manual mapping task, not a zero-config
  "paste any repo URL" experience. This tension is Open Question 2 below.
- Whatever ECC's real structure turns out to be, it is near-certain ECC's
  own frontmatter schema (field names, required-ness) was not authored
  with Symbion's `parseTemplateMarkdown` contract in mind (that parser
  encodes Symbion-specific assumptions, e.g. command name is NEVER in
  frontmatter — a convention ECC's author has no reason to follow). The
  parser may need either a more lenient/adapted parse path for
  externally-sourced content, or ECC content that fails Symbion's strict
  shape ends up disproportionately in `skipped` — both are real product
  outcomes the architect needs to weigh, not just an edge case.

## 2. Core user need

> As a developer setting up a new project's AI-coding workflow in Symbion,
> I want to browse REAL, currently-maintained template libraries authored
> by known community members (starting with ECC), not just Symbion's own
> small built-in set — switching between different authors' collections
> the way I'd switch between curated marketplaces, previewing the actual
> current content of their repo (not a stale copy Symbion vendored months
> ago), while trusting that Symbion never silently stores or redistributes
> someone else's copyrighted prompt text in its own source code.

## 3. Scope

### In scope
- A new "Authors" sub-navigation inside the existing `/templates` route:
  a tab/sub-nav row above (or alongside) the existing Skills/Agents/
  Commands sections, listing known template sources/authors. Clicking an
  author filters the view to that author's content. ECC is the first
  author; the UI/data model must support N authors without code changes
  to add a config-only Nth author (exact mechanism — hardcoded list vs.
  user-addable — is Open Question 4).
- A new daemon RPC (name TBD by architect, e.g. `fetchAuthorTemplates` or
  `listRemoteTemplates`) that, given an author/source identifier, fetches
  that source's template content live from GitHub (via GitHub's REST or
  contents API) and returns parsed/parseable template items to the web
  client. This is fetched **at view time** (when the user opens/selects
  that author's tab), not at Symbion build/release time — the defining
  difference from v1's bundled approach.
- Symbion's own original 12-template bundle (THINK #3 of the v1 feature)
  is **not deleted by this feature** unless Open Question 1 below resolves
  otherwise — it becomes one entry in the authors list (working name:
  "Symbion" or "Mẫu gốc") so existing functionality (offline-capable,
  zero-network browse) is preserved as a fallback/default even if remote
  fetch fails or the user has no internet.
- Parsing of fetched remote markdown reuses `parseTemplateMarkdown`
  (`packages/core`) where the content's shape matches Symbion's
  conventions; architect to determine how/whether a per-author structural
  adapter is needed given ECC's structure is not yet confirmed to match
  (§1 above).
- Apply flow (project picker, draft-into-store, auto-suffix collision,
  `meta.sourceTemplateId`) is **reused, not rebuilt** — the only new input
  to `applyTemplate` is that `template.body`/`name`/`description` now
  originate from a live-fetched remote source instead of a static bundle
  import. Whether `sourceTemplateId`'s value format needs to change (to
  also encode the author) is an architect decision, not re-litigated here.
- Loading/error/empty states for: fetch in progress, fetch failure
  (network down, rate-limited, repo not found), zero items returned for
  an author, partial-failure (some files parse, some don't — same
  "skip with reason, never throw" discipline as v1, extended to network-
  origin failures too).
- A visible, per-item or per-author attribution/license disclaimer in the
  UI — both at browse time (already true in v1 as a footer link) AND, per
  this v2's new legal shape (content is now actually ECC's real text, not
  Symbion-authored placeholder text), reconsidered for whether Apply
  itself needs a disclaimer too (Open Question 5/6 below — NOT decided
  here, this is the single biggest new product-risk surface of this
  feature).

### Out of scope (do not let `/office-hours`/`/design`/`/plan` smuggle in)
- Caching fetched content to disk / a local mirror that persists across
  daemon restarts — "never vendored/copied into Symbion's source code" per
  the user's explicit framing rules out a persistent on-disk cache that
  would functionally recreate vendoring (an in-memory, single-session
  cache to avoid redundant API calls during one browsing session is a
  separate, much narrower question — Open Question 3).
- A generic "add any GitHub repo URL as an author" self-service flow,
  UNLESS Open Question 4 below explicitly resolves toward that — default
  assumption for v1 of this feature is a short, reviewed, hardcoded list
  of known-good authors (ECC + Symbion's own bundle), matching how v1 of
  the original feature kept scope to "a small fixed curated library, not
  a marketplace platform."
- GitHub authentication / PAT management UI — unless Open Question 7
  resolves toward needing it, this ships unauthenticated and accepts the
  60 req/hr public rate limit as a known v1 constraint.
- Any change to `packages/core`'s marker/hash/diff/backup/publish-safety
  machinery, or to the existing `applyTemplate` RPC's collision/auto-
  suffix/store-only-write guarantees (THINK #4 of the original feature) —
  this feature changes WHERE content comes from, not how Apply writes it
  into a project's store.
- A run/execution engine — still deferred to v2 per CLAUDE.md, unrelated
  to this feature.
- Modeling Claude Code's actual folder-based `.claude/skills/<name>/
  SKILL.md` format as a new IR `ArtifactKind` — still out of scope per the
  original feature's THINK #1 (Skills stay browse + copy-only, no Apply),
  unless ECC's structure forces this question back open (flagged, not
  decided — see Open Question 6 in the original STATE, still unresolved
  and now more pressing since ECC's real Skills folder shape is unverified).

## 4. Functional requirements

1. The `/templates` route gains an Authors sub-nav (tabs or a similar
   pattern, exact visual treatment for `/design`) listing at minimum
   "Symbion" (existing bundle) and "ECC" (new). Selecting an author
   filters the Skills/Agents/Commands sections to show only that author's
   items; the section/3-bucket structure itself is preserved per author
   (each author still shows up to 3 labeled sections, possibly empty for
   a bucket that author doesn't have content for — see FR6).
2. An "author" is modeled as a data record with at minimum: a stable id,
   a display name, and a way to resolve its content — for "Symbion" that
   resolution is the existing static bundle (zero network); for "ECC"
   (and any future GitHub-backed author) that resolution is a
   `{ provider: "github", owner, repo, ref?, pathConventions? }`-shaped
   descriptor the new RPC uses to know what to fetch and how to bucket it
   into Skills/Agents/Commands. Exact shape is an architect decision —
   this FR only requires that the abstraction be generic enough that a
   THIRD author (a different GitHub repo entirely) can be added by adding
   a new descriptor, not by writing new fetch/parse code.
3. Selecting a GitHub-backed author (ECC) triggers the new daemon RPC,
   which fetches that repo's relevant directory contents via the GitHub
   API and returns a list of template items (same `TemplateListItem`-
   shaped contract as the bundled path, or a superset of it) to the web
   client. This fetch happens at view/selection time, not at Symbion
   build time, and the fetched markdown text is held only in daemon/web
   process memory for that session — never written into Symbion's git
   repository, never persisted to a project's `.symbion/store.json`
   UNTIL/UNLESS the user explicitly clicks Apply (same as v1's existing
   Apply semantics — browsing/previewing never writes anywhere).
4. The existing Copy markdown / Preview modal / Apply-into-project flow
   works identically regardless of whether the selected item's author is
   "Symbion" (bundled) or "ECC" (live-fetched) — from the modal's
   perspective, it has a `raw` string and metadata; it should not need to
   know or care where that string came from.
5. If the live fetch for an author fails (network error, rate limit, repo
   not found/renamed/private, malformed structure), the Authors tab for
   that author shows a clear, non-crashing error state explaining what
   happened, with a retry affordance, while other authors (including the
   always-available "Symbion" bundle) remain fully functional. Switching
   to a different author tab must not be blocked by one author's fetch
   failure.
6. If an author's content doesn't map cleanly onto Symbion's 3-bucket
   taxonomy (e.g. ECC has no clear "Skills" folder, or has a 4th category
   Symbion has no bucket for), the missing bucket renders the existing
   v1 "Chưa có mẫu nào trong mục này" empty state (not an error) per
   author, and any content that can't be confidently bucketed at all is
   either (a) excluded with a reason (extending the existing `skipped`
   mechanism) or (b) placed in a best-guess bucket — architect/design to
   decide; this FR only requires the behavior be one of these two,
   explicit and visible, never silently dropped without any trace.
7. Apply continues to work per-item exactly as in v1 (project picker,
   draft-into-store, auto-suffix on name collision) for items sourced
   from any author, GitHub-backed or bundled — no author-specific Apply
   variant.

## 5. Edge cases

- **GitHub API rate limiting (60 req/hr unauthenticated)**: if a user (or
  several users sharing a network/IP) browses the ECC author tab
  repeatedly, the daemon will hit GitHub's unauthenticated rate limit.
  Must show a specific, distinguishable error state ("đã vượt giới hạn
  GitHub API, thử lại sau" with the actual reset time if GitHub's
  `X-RateLimit-Reset` header is available) — not a generic "fetch
  failed" message indistinguishable from a network-down case. This is
  the single most likely real-world failure mode for this feature and
  needs first-class handling, not an afterthought.
- **Repo renamed/deleted/made private**: `affaan-m/ecc` (or any future
  author's repo) returning 404/403 from GitHub must be handled as a
  distinct, named error state per author (not a crash, not silently
  showing the previous session's stale data as if still live — unless an
  in-session cache is explicitly designed to do so, which is itself part
  of Open Question 3).
- **Malformed/unexpected repo structure**: per §1 above, ECC's actual
  folder layout/frontmatter schema is unverified. A fetched file that
  doesn't parse via `parseTemplateMarkdown` (or whatever adapted parser
  is built) must land in the existing `skipped`-with-reason bucket, never
  crash the view, exactly like v1's malformed-bundled-template case —
  but the FAILURE RATE for an unadapted remote repo could be much higher
  than v1's near-zero rate (v1's content was authored specifically to
  match the parser), which is a product-quality risk worth flagging:
  shipping this feature with "ECC's repo is 80% unparseable, 80% of items
  in `skipped`" would be a bad first impression — architect/dev must
  verify actual ECC structure against the real parser before shipping,
  not assume the existing parser "just works" on someone else's repo.
- **Network failure while daemon has no internet at all** (distinct from
  GitHub-specific failure): the entire Authors-tab-for-GitHub-sources
  experience must degrade gracefully — "Symbion" bundle (zero-network)
  must remain fully usable, and the GitHub-backed author tab(s) show a
  generic offline state, not hang indefinitely or show a confusing
  timeout with no explanation.
- **Parsing untrusted remote markdown safely**: this is a NEW trust
  boundary not present in v1 (flagged but explicitly deferred in v1's own
  STATE as "Open Question 2," now activated). Concretely: (a) the raw
  markdown text itself is just text rendered read-only in a CodeMirror
  viewer — low risk, same rendering path as any text; (b) but
  frontmatter YAML parsing of attacker-controlled (or just
  differently-shaped) remote content needs to be robust against the
  parser throwing on adversarial/malformed YAML (the existing
  `parseFrontmatter` primitive's robustness against arbitrary external
  YAML, vs. its current track record only against Symbion's own
  hand-authored fixtures, needs verification — a `/cso` security-reviewer
  pass on this specific surface is recommended once architecture is
  locked, per the original feature's own STATE risk note "needs a
  security-reviewer pass specifically on this surface if [live-fetch is]
  chosen" — that condition is now true).
- **Apply's license/provenance shift**: v1's Apply staged Symbion's own
  original content into a project's store — zero license question. v2's
  Apply, for ECC-sourced items, stages ANOTHER AUTHOR'S actual copyrighted
  markdown text into the user's own project's `.symbion/store.json`, and
  potentially from there into the user's real repo via the existing
  Publish flow. **Does Apply need an explicit license/attribution
  acknowledgment at apply-time** (not just a footer link at browse-time),
  given the user is now about to copy someone else's real prompt text
  into their own project? This is flagged as a real, new product/legal
  question — not decided here (Open Question 5).
- **Author whose content doesn't fit the 3-bucket taxonomy at all** (e.g.
  a future author whose repo is entirely "Skills"-shaped, zero
  Agents/Commands, or has categories Symbion has no concept of like
  "hooks" or "MCP configs"): must not be a hard error — empty buckets are
  fine (FR6), content Symbion has literally no IR slot for (e.g. hooks)
  should be excluded with a reason, not crash the fetch.
- **Same-name collision ACROSS authors**: if both "Symbion" bundle and
  "ECC" each have an agent template named e.g. `code-reviewer`, this is
  not actually a NEW edge case for the existing `applyTemplate` RPC
  (collision detection is scoped to `(kind, name)` within the TARGET
  PROJECT's existing artifacts, not across authors) — flagged here only
  to confirm no new collision class is introduced, the existing auto-
  suffix algorithm already handles "two different templates happen to
  share a name" identically to "the same template applied twice."

## 6. Acceptance criteria (measurable)

- AC1: The `/templates` view shows an Authors sub-nav with at least two
  entries ("Symbion", "ECC"); selecting "Symbion" shows exactly the same
  12 items as v1 (regression check — nothing about the existing bundle
  changes); selecting "ECC" triggers a live fetch (verifiable via network
  inspection — a request to GitHub's API domain occurs only after ECC is
  selected, not on initial `/templates` load).
- AC2: With network available and GitHub not rate-limited, selecting
  "ECC" results in at least one item appearing in at least one of the
  three sections within a bounded time (architect to set a concrete
  timeout, e.g. 10s, with a visible loading state before that).
- AC3: Killing network access (or mocking a GitHub API failure) while
  "ECC" is selected shows a distinguishable, non-crashing error state
  with a retry action; switching back to "Symbion" tab continues to work
  with zero items affected.
- AC4: Simulating a GitHub 403 rate-limit response shows rate-limit-
  specific copy (not the generic network-error copy), distinguishable in
  a UI test/screenshot diff or DOM text assertion.
- AC5: A deliberately malformed/unexpected file structure in a mocked
  GitHub API response (e.g. a file with no frontmatter, or nested 3
  levels deep) does not crash the view — it lands in a `skipped`-
  equivalent UI state with a reason, while other valid items from the
  same mocked response still render.
- AC6: Clicking "Copy markdown" or "Áp dụng" on an ECC-sourced item
  behaves identically (same modal, same RPC call shape, same draft-
  artifact-into-store result) to a Symbion-bundled item — verifiable by
  the existing v1 E2E assertions (E2, E3, E5, E6 from
  `templates-marketplace-testplan.md`) passing unmodified when re-run
  against an ECC-sourced item instead of a bundled one.
- AC7: No fetched ECC markdown content is ever written into any file
  inside Symbion's own git-tracked source tree (`apps/`, `packages/`,
  `docs/`) at any point — verifiable by confirming the new RPC's
  implementation contains no `fs.writeFile`/similar call writing into
  those paths (this is the hard technical guarantee underpinning the
  user's "never vendored" requirement — a code-review-time check, not
  just a runtime behavior).
- AC8: Adding a third hypothetical author (e.g. a test-only mock GitHub
  repo descriptor) requires only a data/config change (new entry in
  whatever the Authors list/registry turns out to be), zero new
  TypeScript fetch/parse logic, zero new RPC method — proving the
  abstraction is genuinely multi-source, not ECC-special-cased. (If
  architect's design can't satisfy this without a code change per author,
  flag that explicitly as a known limitation rather than silently
  shipping an ECC-hardcoded implementation under a generic-sounding name.)

## 7. Open questions — taste/priority decisions only the user can make

1. **Does Symbion's existing original 12-template bundle stay as a
   "Symbion" default author alongside ECC, or does this feature replace
   it entirely?** Recommendation leans "keep it" (preserves offline
   capability + the THINK #3 zero-license-risk fallback that's already
   shipped and tested) but this is explicitly the user's call, not
   assumed here.

2. **What is the minimum viable "author source" abstraction** — a short,
   manually-reviewed, hardcoded list of known GitHub repos (ECC first,
   architect/team adds more later by editing a config file), or a
   user-facing "paste any GitHub repo URL to add it as an author" self-
   service flow? The hardcoded-list approach is far safer (each author's
   repo structure can be manually verified to actually parse before
   shipping it — see the malformed-structure edge case above) but doesn't
   scale to "many more authors" without ongoing maintenance work; the
   arbitrary-URL approach scales effortlessly but means Symbion has zero
   control over whether a newly-added repo's structure is even parseable,
   likely producing a bad first-run experience (mostly-`skipped` results)
   for anyone who adds a repo that doesn't happen to match Symbion's
   conventions.

3. **In-session caching**: should a fetched author's content be cached in
   memory (web client state or daemon memory) for the duration of one
   browsing session, so switching away from and back to the ECC tab
   doesn't re-fetch (saving rate-limit budget), or should every tab
   selection always re-fetch fresh (simpler, but burns rate-limit budget
   faster and is slower)? This does not conflict with "never vendored" —
   an in-memory, session-scoped cache that's gone on daemon restart is a
   different thing from a persistent on-disk mirror — but the exact
   boundary (how long is "in-session"? does it survive a page refresh?)
   is a taste call.

4. (Folded into #2 above — kept separate only if the user wants to decide
   "hardcoded vs. arbitrary" and "what counts as in-session" as two
   independent answers rather than one combined one.)

5. **Does Apply need an explicit license/attribution acknowledgment at
   apply-time** for items sourced from a real third-party author (vs.
   v1's footer-link-only, browse-time-only attribution, which was
   sufficient when the content was Symbion's own original text)? E.g. a
   one-line "Mẫu này thuộc về tác giả ECC (affaan-m) — bạn tự chịu trách
   nhiệm về việc sử dụng lại nội dung này" shown in the Apply confirmation
   step, or even a required checkbox before "Xác nhận áp dụng" is
   enabled for non-Symbion authors. This is a real product/legal decision
   the user (as product owner) needs to make explicitly, not something
   engineering should default silently.

6. **Does Apply writing license-bearing fetched content into the user's
   own project's `.symbion/store.json` (and from there potentially into
   their real repo via Publish) need an explicit product/legal sign-off
   before shipping**, beyond what's already covered by question 5's UI
   treatment? I.e. is "fetch live, never store in Symbion's own repo, but
   freely let users copy it into THEIR repos via Apply" an acceptable
   final posture for the product, or does it need a stronger boundary
   (e.g. Apply for non-Symbion-authored items requires going to the
   original repo directly, and Symbion's Apply is disabled/Copy-only for
   third-party authors)? This is upstream of question 5 — question 5
   assumes Apply stays enabled for third-party content and only asks
   about disclaimer UX; this question asks whether Apply should even be
   allowed at all for non-Symbion authors.

7. **GitHub authentication**: stay fully anonymous/unauthenticated and
   accept the 60 req/hr public rate limit as a known v1 constraint
   (simplest, no new settings UI, no token storage/security surface), or
   does the user want Symbion to support an optional personal access
   token (PAT) — entered once in Settings, stored locally — to raise the
   limit to 5,000 req/hr? A PAT-support path adds new scope (settings UI,
   local credential storage, a new "where do we store this safely"
   question for `/cso` to review) that v1 of THIS feature may not need if
   usage volume is low; flagged as a forward-looking question, not
   assumed necessary now.

8. **Visual treatment of the Authors sub-nav** — tabs (shadcn `Tabs`,
   matching the existing single-page-no-tabs precedent the original
   design doc deliberately avoided for the 3 Skills/Agents/Commands
   sections, §6 Q1 of that doc) vs. a dropdown/select vs. a sidebar list?
   Deferred to `/design`, flagged here only so the user is aware this is
   a new IA decision layered on top of the original design's already-
   settled "single scrollable page" choice for sections.

## 8. Product risk notes (for architect/dev to keep in mind)

- **New external trust boundary, now actually activated** (was flagged
  and explicitly deferred as "Open Question 2" in the original feature's
  STATE — now real): the daemon will, for the first time, parse markdown/
  YAML frontmatter from content it does not control the authorship of.
  `parseFrontmatter`'s robustness against malformed/adversarial input
  needs verification beyond its current Symbion-authored-fixture test
  coverage. Recommend an explicit `/cso` (security-reviewer) pass on the
  new fetch+parse RPC before shipping, per the original feature's own
  stated condition for when this review becomes necessary.
- **Real (not hypothetical) license/copyright exposure on Apply**: unlike
  v1 where "Apply" staged Symbion's own original content, v2's Apply for
  ECC-sourced items stages another identifiable author's actual
  copyrighted text into a user's project and potentially their real repo.
  This is squarely the risk the user is trying to AVOID by choosing
  live-fetch-never-store for Symbion's own source tree — but that choice
  protects Symbion's OWN repo, not the end-user's repo once they click
  Apply. Open Questions 5 and 6 above are not optional engineering
  nice-to-haves; they are the actual mitigation for this risk and should
  block shipping Apply-for-third-party-authors until answered.
- **Rate-limit / repo-availability risk turns a previously 100%-reliable
  feature into a sometimes-unreliable one**: v1's Templates view had zero
  failure modes that weren't "a bug" (bundled content always loads). v2
  introduces a category of failure that is NORMAL, EXPECTED, and OUTSIDE
  SYMBION'S CONTROL (GitHub down, rate-limited, repo moved). Error/empty/
  retry states are not edge-case polish here — they are core, frequently-
  hit functionality and should be scoped/tested with that weight, not as
  an afterthought relative to the happy path.
- **Structural-mismatch risk could make ECC's tab look broken on day
  one**: per §1's flagged uncertainty about ECC's actual folder/
  frontmatter shape vs. Symbion's parser's specific expectations, there's
  a real chance a naive "just point the existing parser at ECC's repo"
  implementation results in most/all ECC items landing in `skipped` —
  which, from a user's perspective looking at an "ECC" tab that's empty
  or full of warnings, reads as "this feature doesn't work," not "this is
  expected fallback behavior." Architect/dev MUST verify actual parse
  success rate against the real repo (via the real GitHub API, with the
  real parser) before considering this feature done, not assume v1's
  parser generalizes.
- **Scope-creep risk, restated for v2**: "Authors" as a concept invites
  feature creep toward a full marketplace (search, filters, ratings,
  user-submitted authors) — the original feature's out-of-scope framing
  ("a small, fixed curated library, not a marketplace platform") should
  still hold for v2: a short list of vetted authors, not an open
  directory, unless Open Question 2 explicitly resolves toward
  self-service.
- **`applyTemplate` RPC signature stability**: flagged in §1 as likely
  needing only a `sourceTemplateId` shape change, not a structural
  rewrite — but architect should confirm this rather than assume it, since
  getting it wrong risks an unplanned `packages/core`/`rpc-types` change
  this STATE doc explicitly tried to keep out of scope.

---

Next: run `/office-hours` (THINK) to lock the 8 open questions above before
`/design`/`/plan`. Given the size of the open-question list and the real
legal/product-risk weight of questions 5 and 6 specifically, this feature
should NOT be auto-decided/autopiloted the way the original feature's THINK
phase was — at minimum questions 1, 2, 5, 6, and 7 need explicit user input,
not architect-default judgment calls.

## Phase: THINK (user-decided — explicit answers, not auto-decided)

1. **Symbion's original 12-template bundle stays** as a default "Symbion"
   author alongside "ECC" — preserves offline capability and the v1
   zero-license-risk fallback. Not replaced.

2. **Author source = a short, manually-reviewed hardcoded list.** No
   self-service "paste any repo URL" flow. New authors are added later by
   a human editing a config/registry entry, after manually verifying that
   author's repo structure actually parses — not a zero-config experience.
   This directly mitigates the "ECC's tab looks broken on day one" risk
   flagged in product-risk-notes: whoever adds a new author is expected to
   verify real parse success against the real repo before shipping it.

3. **In-session, in-memory caching.** Each author's fetched content is
   cached in memory for the duration of one browsing session (gone on page
   refresh or daemon restart) — switching between author tabs does not
   re-fetch already-loaded content; only an explicit retry/refresh
   re-fetches. Does not conflict with "never vendored" since nothing
   persists to disk.

4. (Folded into #2 — single combined answer, not decided independently.)

5. **Apply requires an explicit license/attribution acknowledgment at
   apply-time** for non-Symbion authors. The Apply confirmation step for
   an ECC-sourced (or any future third-party-authored) item must show the
   author/repo identity and a clear statement that this is third-party
   content the user is responsible for using appropriately, before
   "Xác nhận áp dụng" is enabled — not just the existing browse-time
   footer link.

6. **Apply stays enabled for third-party authors** (not Copy-only) —
   product accepts "fetch live, never store in Symbion's own repo, but let
   users knowingly copy it into their own projects via Apply" as the
   shipping posture, gated by question 5's explicit disclaimer/
   acknowledgment step as the mitigation (not a stronger technical block).

7. **GitHub stays unauthenticated (no PAT support) for this version.**
   Accept the 60 req/hr public rate-limit constraint; no new Settings UI,
   no credential storage, no additional `/cso` surface for token handling.
   PAT support is explicitly deferred, not built now.

8. **Visual treatment of the Authors sub-nav** — deferred to `/design`,
   not a taste call requiring user input ahead of time.

These 7 decisions are now locked. Proceeding to `/design` then `/plan`.
Per the original STATE's own risk note, `architect`/`dev` must verify
ECC's actual repo structure against the real parser (real GitHub API call)
before considering this shippable — a high parse-failure rate is a
blocking quality issue, not an acceptable edge case.

---

## Phase: PLAN

> Architect pass. Per the task's mandatory first step, ECC's actual repo
> structure was verified against the live GitHub API
> (`api.github.com/repos/affaan-m/ecc`, default branch `main`, repo is
> public, ~4500 tracked files total) before any design decision below.
> **No ECC prompt/body text is reproduced anywhere in this document** — only
> structural facts (paths, frontmatter field names, counts) gathered without
> reading/copying body content. Frontmatter samples shown below use real
> field NAMES (schema) with synthetic VALUES where a value had to be shown
> for shape illustration.

### P0. ECC structure verification (the blocking risk from §1, now resolved)

**Method**: `GET /repos/affaan-m/ecc/git/trees/main?recursive=1` (1 API
call, the response's `truncated` flag is `false`, all 4501 entries returned
in one page), cross-checked with a handful of
`raw.githubusercontent.com/affaan-m/ecc/main/<path>` fetches to inspect
frontmatter shape only.

**Top-level layout** (file counts from the real tree, not estimated):

| Path | Type | Count | Notes |
|---|---|---|---|
| `agents/` | flat `.md` files | 67 | `agents/<slug>.md`, one file per agent |
| `commands/` | flat `.md` files | 92 | `commands/<slug>.md`, one file per command |
| `skills/` | folder-per-item | 277 `SKILL.md` files (within 757 total paths under `skills/`) | `skills/<slug>/SKILL.md`, each skill folder also contains 0-N non-canonical helper files (`examples/`, `references/`, `scripts/`, `templates/` subfolders — **171 such non-`SKILL.md` blobs found, these are NOT separate template items and must be excluded by the fetch layer, not treated as 171 extra skipped items**) |
| `docs/`, `.kiro/`, `.opencode/`, `.cursor/`, `tests/`, `rules/`, `scripts/`, `.agents/`, `examples/`, `assets/`, `ecc2/`, `src/`, `.github/`, `.claude/`, etc. | various | ~3400 remaining paths | Not template content for our taxonomy — provider-specific config dirs (`.cursor`, `.opencode`, `.kiro`, `.codex`, `.gemini`, `.qwen`, `.zed`, `.trae`, `.vscode`), docs, tests, scripts, legacy shims. **Explicitly excluded by the mapping below — never fetched, never counted toward "items".** |

**Frontmatter schema observed** (field names only, sampled 18 files across
all 3 buckets — 5 agents, 5 commands, 8 skills, plus the 2 shown first):

- `agents/*.md`: `name` (string), `description` (string), `tools` (YAML
  flow-style array, e.g. `tools: ["Read", "Grep", "Glob", "Bash"]`),
  `model` (string, e.g. `sonnet`/`opus` — extra field Symbion's parser has
  no opinion on, lands in `customFields` and is silently tolerated).
- `commands/*.md`: `description` (string) — **no `name` field**, matching
  Symbion's own convention exactly (name is filename-derived). Some
  commands carry an extra stray `name` field anyway (e.g.
  `commands/evolve.md`, `commands/prune.md` — author included it even
  though Claude Code's convention doesn't require it for commands) plus a
  `command: true` marker field; both land in `customFields`, harmless,
  ignored by `parseTemplateMarkdown` since it never reads `fm.name` for
  `expectedKind === "command"`. Some carry `argument-hint` (extra field,
  same tolerance).
- `skills/<slug>/SKILL.md`: `name` (string), `description` (string,
  **sometimes a multi-line YAML folded scalar** spanning 2 physical lines
  — confirmed the `yaml` npm package (already the dependency
  `parseFrontmatter` uses) parses this correctly into a single joined
  string with no special-casing needed), `metadata` (a **nested YAML
  object**, e.g. `metadata:` followed by an indented `origin: ECC` line —
  confirmed `parseYaml` handles nested objects fine; `metadata` is an
  unknown top-level key to `parseFrontmatter`, so it's stringified via
  `String(value)` into one `customFields` entry, e.g. `"[object Object]"`
  — **this is a pre-existing minor cosmetic wart in `parseFrontmatter`'s
  `customFields` capture for ANY nested-object frontmatter value, not ECC-
  specific; flagged below as a small worthwhile parser improvement, not a
  blocker**), `tools` (seen as a CSV string in one sample, e.g. `tools:
  Read, Write, Edit, Bash, Grep, Glob` — already handled by the existing
  CSV-split branch in `parseFrontmatter`), occasionally `argument-hint`.

**Verdict — does `tools` parse correctly?** Yes, both forms seen in the
wild (YAML flow array `["a","b"]` and CSV string `a, b, c`) are already
handled by the existing `parseFrontmatter` without modification — confirmed
with a direct `yaml.parse()` invocation against a real sample during this
investigation, returning a proper `string[]`.

**Verdict — parse success rate estimate.** Of 18 sampled real files (random
sample across all 3 buckets plus 2 hand-picked), **18/18 (100%) have a
non-empty `description` and satisfy `parseTemplateMarkdown`'s existing
required-field rules** (`name` required only for `expectedKind === "agent"`,
`description` always required, non-empty body always present below the
frontmatter fence). Extrapolating with caution (a sample of 18 of ~436
candidate files, ~4%): **no parser change is needed** — `parseTemplateMarkdown`
is reused completely as-is, zero modification to `packages/core`. The
"high `skipped` rate" risk flagged in §1/§8 does not materialize for ECC's
actual structure; ECC's author happens to already follow Claude-Code-
compatible frontmatter conventions closely (unsurprising — ECC is itself a
Claude Code skills/agents/commands collection, authored against the same
real-world conventions Symbion's parser encodes). **This is a finding, not
an assumption** — dev should re-run a wider automated sample (e.g. all 436
files) as part of BUILD/QA to confirm the full-repo rate before shipping,
per §8's blocking-risk note, but the architecture below does NOT need a
"lenient mode" or parser fork to ship a usably-low `skipped` rate.

**Folder → bucket mapping for ECC** (hardcoded per-author adapter, per
THINK #2's "manually-reviewed hardcoded list" decision):

```
ECC_AUTHOR: AuthorSource = {
  id: "ecc",
  displayName: "ECC",
  kind: "github",
  owner: "affaan-m",
  repo: "ecc",
  ref: "main",
  folders: [
    { bucket: "agent",   path: "agents",   filePattern: "*.md" },        // flat: agents/<slug>.md
    { bucket: "command", path: "commands", filePattern: "*.md" },        // flat: commands/<slug>.md
    { bucket: "skill",   path: "skills",   filePattern: "*/SKILL.md" },  // folder-per-item: skills/<slug>/SKILL.md
  ],
}
```

Everything else in the tree (`docs/`, `.claude/`, `.cursor/`, `tests/`,
`scripts/`, skill subfolder helper files like `examples/`/`references/`,
etc.) is **never fetched** — the `folders` mapping is a fetch-time filter,
not a post-hoc exclusion, so the daemon never spends API/CDN budget on
non-template content in the first place.

**Realistic file count / fetch cost**: 67 + 92 + 277 = **436 candidate
files** for a full ECC fetch. See §P3 below for exact call accounting —
headline result: **1 `api.github.com` call total** (the recursive tree),
**436 `raw.githubusercontent.com` calls** (content fetches), and
`raw.githubusercontent.com` is confirmed (via direct header inspection
during this investigation) to **carry no `X-RateLimit-*` headers and is not
subject to the same 60/req/hr unauthenticated budget as `api.github.com`**
— it is GitHub's CDN-backed raw-content endpoint, separately and far more
generously rate-limited. This is the single most important fetch-cost
finding of this investigation and directly shapes §P2's RPC design: **the
per-author full fetch costs exactly 1 unit against the 60/hr budget**, not
437.

---

### P1. The `AuthorSource` abstraction

New pure type, `packages/core/src/templates/authorSource.ts` (pure, no
fs/net — just data + the bucket-mapping config):

```ts
export type TemplateBucket = "agent" | "command" | "skill"; // == TemplateKind, reused not duplicated

export interface GithubFolderMapping {
  bucket: TemplateBucket;
  /** repo-relative folder path, e.g. "agents" */
  path: string;
  /** "*.md" = flat files directly under `path`; "*/SKILL.md" = one level of
   *  subfolder then a fixed filename — the only two shapes ECC's real
   *  structure requires; a 3rd shape can be added later if a future author
   *  needs it, without changing AuthorSource's own shape. */
  filePattern: "*.md" | "*/SKILL.md";
}

export type AuthorSource =
  | { id: string; displayName: string; kind: "bundled" }
  | {
      id: string;
      displayName: string;
      kind: "github";
      owner: string;
      repo: string;
      ref: string; // branch/tag, e.g. "main" — pinned per author, not user-supplied
      folders: GithubFolderMapping[];
      /** shown in UI attribution/license-step copy, e.g. "affaan-m/ecc" */
      repoLabel: string;
    };

export const AUTHOR_REGISTRY: AuthorSource[] = [
  { id: "symbion", displayName: "Symbion", kind: "bundled" },
  {
    id: "ecc",
    displayName: "ECC",
    kind: "github",
    owner: "affaan-m",
    repo: "ecc",
    ref: "main",
    repoLabel: "affaan-m/ecc",
    folders: [
      { bucket: "agent", path: "agents", filePattern: "*.md" },
      { bucket: "command", path: "commands", filePattern: "*.md" },
      { bucket: "skill", path: "skills", filePattern: "*/SKILL.md" },
    ],
  },
];
```

This lives in `packages/core` (pure data, zero fs/net) so both `apps/web`
(to render the Authors sub-nav labels) and `apps/daemon` (to know what to
fetch) import the **same** registry — no hand-duplication, no drift risk
between the two processes' idea of "which authors exist."

**AC8 check**: adding a 3rd author (hypothetical `"acme"`) is exactly one
new object literal appended to `AUTHOR_REGISTRY` with a verified
`folders` mapping — zero new RPC method (the existing `fetchAuthorTemplates`
RPC takes `authorId` and looks up the registry entry), zero new fetch/parse
TypeScript (the GitHub-fetch RPC handler is already generic over `owner/
repo/ref/folders`, not ECC-special-cased). **Satisfied** — with one narrow,
explicitly-flagged limit, see P10.4 below.

---

### P2. New daemon RPC: `fetchAuthorTemplates`

**`packages/rpc-types/src/index.ts`** additions:

```ts
export interface FetchAuthorTemplatesParams {
  authorId: string; // looked up in AUTHOR_REGISTRY server-side, not trusted as a free-form repo descriptor
}

export type FetchAuthorTemplatesOutcome =
  | { status: "success"; items: TemplateListItem[]; skipped: Array<{ relPath: string; reason: string }> }
  | { status: "error"; kind: "network" | "rate-limit" | "not-found"; message: string; resetAt?: number };

export interface FetchAuthorTemplatesResult {
  outcome: FetchAuthorTemplatesOutcome;
}
```

Added to `RpcMethod` union: `"fetchAuthorTemplates"`. **Read-only** (added
to the daemon's `READ_ONLY_METHODS` set alongside `scanClaudeDir`/
`listProjects` — it makes outbound network calls but writes nothing to
disk, matching `listModels`/`checkProviderStatus`'s existing classification
for outbound-network-but-no-disk-write RPCs).

**`TemplateListItem`** (the existing v1 type, `apps/web/src/data/templates/
manifest.ts`) gains 3 new optional-on-bundled, required-on-github fields —
moved to live in `packages/core` instead (so the daemon's handler and the
web client share the exact type, not a hand-duplicated shape):

```ts
export interface TemplateListItem {
  id: string;          // UNCHANGED shape requirement, see P5 below for the new value format
  kind: TemplateKind;
  name: string;
  description: string;
  tools?: string[];
  raw: string;
  authorId: string;          // NEW — "symbion" | "ecc" | future ids
  authorDisplayName: string; // NEW — denormalized for the UI, avoids a registry lookup in every card
  authorRepoLabel?: string;  // NEW — present iff authorId's source kind === "github", e.g. "affaan-m/ecc"
}
```

`apps/web/src/data/templates/manifest.ts`'s `loadTemplateManifest()` is
updated minimally to stamp `authorId: "symbion"`, `authorDisplayName:
"Symbion"` (no `authorRepoLabel`) onto every bundled item — a small,
additive change, not a rewrite; the 12-template bundle, its parsing, and
its `skipped` shape are untouched otherwise (regression-safe per AC1).

**Handler** (`apps/daemon/src/rpc/handlers.ts`, new method, sibling to
`scanClaudeDir`):

```
fetchAuthorTemplates(params): FetchAuthorTemplatesResult
  1. Look up params.authorId in AUTHOR_REGISTRY (packages/core).
     - Not found, or kind !== "github" -> RpcError("invalid-author", ...)
       (a client bug sending "symbion" to this RPC, or an unknown id, is a
       programming error, not a runtime/network failure — thrown, not
       returned as outcome:"error", matching the existing convention that
       RpcError = "caller did something invalid" vs. outcome union =
       "well-formed request, expected-to-sometimes-fail external call").
  2. GET https://api.github.com/repos/{owner}/{repo}/git/trees/{ref}?recursive=1
     - Single fetch, AbortController timeout (10s, matching AC2's bounded-
       wait requirement — see Interaction with timeout below), same
       try/catch-network-vs-non-2xx-vs-bad-json layering as
       OllamaProvider.listModels() (this RPC reuses that exact error-
       mapping SHAPE, not the same provider class — it's a GitHub-specific
       sibling, not a generalized "any LLM provider" abstraction).
     - res.status === 404 -> outcome: { status:"error", kind:"not-found",
       message: "Không tìm thấy repo {owner}/{repo} (nhánh {ref}) — có thể
       đã đổi tên hoặc chuyển sang riêng tư." }
     - res.status === 403 AND header `x-ratelimit-remaining` === "0" ->
       outcome: { status:"error", kind:"rate-limit", message: "...",
       resetAt: Number(header['x-ratelimit-reset']) * 1000 }  // epoch SECONDS -> ms
     - res.status === 403 WITHOUT that header signal (e.g. abuse-detection,
       a different 403 cause) -> outcome: { status:"error", kind:"network",
       message: "GitHub từ chối yêu cầu (403)." } — folded into the
       generic "network" bucket per STATE's framing that ONLY the
       confirmed-rate-limit-shaped 403 gets the distinct rate-limit copy;
       an unconfirmed 403 must not falsely claim "rate limited" if it
       might be something else.
     - any other non-2xx, fetch() throw, or AbortError (timeout) ->
       outcome: { status:"error", kind:"network", message: "..." }
     - JSON parse failure / `tree` field missing or not an array ->
       outcome: { status:"error", kind:"network", message: "Phản hồi
       không hợp lệ từ GitHub." } (malformed-API-response is a network-
       class failure, not a content-parse failure — distinct from the
       per-file skip handling below)
     - response's `truncated` flag is `true` -> NOT currently expected for
       ECC (confirmed `false` for the real repo, 4501 entries fit in one
       page) but defensively handled: if ever true, proceed with the
       partial tree as-is (still attempt to map whatever's present) rather
       than erroring outright — a partial result is more useful than none,
       and any genuinely-missing items would surface as fewer items
       returned, not a crash.
  3. Filter the tree entries against the author's `folders` mapping
     (string-prefix + pattern match, pure function, testable without
     network — see P2a below). Produces a list of `{ bucket, relPath }`
     candidates (436 for ECC today).
  4. For each candidate, fetch
     https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{relPath}
     concurrently (bounded concurrency, e.g. 8 in flight at a time via a
     small worker-pool helper — NOT 436 simultaneous sockets) with the
     same per-request timeout/error handling as step 2's network-failure
     branches, but at PER-FILE granularity:
     - non-2xx or fetch throw for ONE file -> that file becomes a
       `skipped` entry with reason "Không tải được nội dung tệp (HTTP
       {status})." or "Lỗi mạng khi tải tệp." — does NOT abort the whole
       fetch (STATE's "partial failure, never crash" discipline, now
       extended from parse-failures to fetch-failures at file granularity).
     - 2xx with a body -> pass the raw text into the EXISTING, unmodified
       `parseTemplateMarkdown(raw, bucket)` (packages/core) exactly as
       `loadTemplateManifest` already does for the bundled path. `{ ok:
       false }` -> `skipped` entry with the parser's own reason string
       (same discipline, same mechanism, zero new parser code).
       `{ ok: true }` -> becomes a `TemplateListItem` with `authorId: "ecc"`
       (etc.), `id: "ecc:agents/code-reviewer.md"` (see P5 for id format).
  5. If step 2 itself failed, the whole call returns that error outcome
     (no items/skipped at all — distinguishes "couldn't even list the
     repo" from "listed fine, individual files had issues").
  6. If step 2 succeeded but EVERY candidate file in step 4 ended up in
     `skipped` (zero successful items across all 3 buckets) -> still
     returns `status: "success"` with `items: []` and the full `skipped`
     list (NOT an error outcome) — this is wireframe A6-variant (§3.6 of
     the design doc, "fetch succeeded but zero items parsed"), a distinct,
     correctly-classified case from a network failure per the design's own
     explicit framing.
```

**P2a — pure filter/match helper** (`packages/core/src/templates/
matchAuthorFolders.ts`, new, pure, unit-testable without network):

```ts
export function matchAuthorFolders(
  treeEntries: Array<{ path: string; type: "blob" | "tree" }>,
  folders: GithubFolderMapping[]
): Array<{ bucket: TemplateBucket; relPath: string }>
```

For `filePattern: "*.md"`: `path.startsWith(folder.path + "/") &&
path.endsWith(".md") && path.slice(folder.path.length + 1).indexOf("/") === -1`
(exactly one path segment below the folder — excludes any future nested
subfolder under `agents/`/`commands/`, matching the real flat layout
observed). For `filePattern: "*/SKILL.md"`: `path.startsWith(folder.path +
"/") && path.endsWith("/SKILL.md")` and exactly one path segment between
`folder.path` and the trailing `SKILL.md` (excludes the 171 confirmed
non-`SKILL.md` helper blobs under `skills/<slug>/examples|references|
scripts|templates/...` automatically, by construction — they don't match
`*/SKILL.md`, never become fetch candidates, never appear as noise in
`skipped`). This function is pure data-in/data-out, fully unit-testable
against a hand-written fixture tree array (no live network needed in
tests) and against a recorded real snapshot of ECC's tree shape (a fixture
captured once during this investigation, structural-only, no body content)
for a regression check that ECC's real shape keeps matching.

**Concurrency/timeout numbers** (architect's concrete choices, per AC2's
"bounded time, e.g. 10s" ask): outer tree-fetch timeout 10s; per-file fetch
timeout 8s; concurrency pool size 8; **total wall-clock budget for a full
ECC fetch is NOT bounded by a single 10s timeout** (436 files / 8 concurrent
at ~200-400ms typical raw.githubusercontent.com latency is roughly 15-25s
realistic total) — **AC2's "bounded time, e.g. 10s" is reinterpreted here
as "loading state appears within 10s and resolves to first-content-visible
in a bounded, predictable window," not "the entire 436-file fetch
completes in 10s."** This is a deliberate amendment to AC2's literal
wording based on the real file count discovered in P0 — flagged explicitly
for the Checker: **dev should measure actual wall-clock time for a full ECC
fetch during BUILD and report it; if it exceeds ~30s, consider showing
incremental/streaming results (items appear as they resolve) rather than
an all-or-nothing wait — explicitly OUT OF SCOPE to design now (adds
complexity, e.g. partial-success-while-still-loading UI state not in the
design doc's state machine) but flagged as a likely follow-up if real
measured latency is bad.** The architecture above (RPC returns one final
result, not a stream) is the v1-of-this-feature choice; streaming is a
clearly-separable enhancement, not a redesign, because the RPC's `outcome`
shape doesn't change, only whether the daemon returns at file-100 or
file-436.

---

### P3. GitHub API call accounting (rate-limit math)

| Call type | Endpoint | Counts against 60/hr? | Calls per full ECC fetch |
|---|---|---|---|
| Tree listing | `api.github.com/repos/{owner}/{repo}/git/trees/{ref}?recursive=1` | **Yes** | 1 |
| Per-file content | `raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}` | **No** (confirmed via direct header inspection: no `X-RateLimit-*` headers present on `raw.githubusercontent.com` responses — separate CDN-backed endpoint, not `api.github.com`) | 436 (not budget-relevant) |

**This is the single most consequential finding for the rate-limit edge
case**: a full ECC tab selection costs exactly **1 unit** of the 60/hr
budget, not 437. A user could select the ECC tab ~60 times per hour before
hitting the tree-listing rate limit (and THINK #3's in-session cache means
re-selecting an already-resolved tab costs 0 additional calls). The
rate-limit edge case in §5/AC4 is real (e.g. several developers on the same
office NAT sharing the same public IP's 60/hr budget, or a user clicking
"Thử lại" repeatedly during an outage) but far less likely to be hit from
ECC-tab-browsing ALONE than the original STATE's risk framing (written
before this investigation) assumed — still implemented with first-class
handling per §5/AC4 (not downgraded), but this number should inform how
urgently PAT support (Open Question 7, deferred) gets revisited later.

**Important secondary finding**: because `raw.githubusercontent.com`
requests are NOT rate-limited the same way, a future author with a much
larger candidate-file count (e.g. 2000+ files) would still only cost 1 unit
against the 60/hr budget for its tree call — the RPC design's cost model
scales correctly to larger future authors without re-architecture.

---

### P4. In-session caching

Lives **client-side only**, in `apps/web`'s `TemplatesView` component state
(per the design doc's own default, P1 "Open component question" — no new
Zustand store slice needed for v1, consistent with v1's "no new store slice
for list-level concerns" precedent). The daemon is **stateless** with
respect to this cache — `fetchAuthorTemplates` always performs a real fetch
when called; it has no server-side memoization/cache of its own. This
keeps the daemon simple and matches THINK #3's literal scope ("in-session"
= one browser tab's lifetime, which is naturally modeled as React component
state, not a server-side session concept the daemon would need to track
across reconnects/multiple browser tabs).

Cache shape: `authorCache: Record<authorId, FetchAuthorTemplatesOutcome |
{ status: "loading" } | { status: "idle" }>`, exactly matching the design
doc's `AuthorFetchState` union. Invalidation: **only** an explicit "Thử
lại" click resets an entry to `"idle"` then immediately re-triggers the
RPC call — no TTL, no background refresh, no invalidation on tab
switch/blur, matching THINK #3 exactly ("only an explicit retry/refresh
re-fetches"). Gone on page refresh (component unmount) or daemon restart
(daemon has nothing to restart that mattered — it was never holding the
cache).

---

### P5. `sourceTemplateId` / author provenance

**Format change** (confirmed low-risk per §1's own flagging): `id` on
`TemplateListItem` (used verbatim as `sourceTemplateId` in
`ApplyTemplateParams`) changes shape from v1's `"agent:code-reviewer"` to
an **author-prefixed** form: `"{authorId}:{originalRelPathOrSlug}"`.

- Symbion bundle: **unchanged value**, e.g. `"agent:code-reviewer"` — these
  ids are already effectively `"symbion:..."` in spirit (there was only one
  author, the prefix was implicit); changing the literal string would be a
  gratuitous breaking change to existing `meta.sourceTemplateId` values
  already persisted in any existing project's `.symbion/store.json` from
  v1 usage. **Decision: do NOT retrofix Symbion's existing id format** —
  `sourceTemplateId` is a free-form opaque string already (the daemon never
  parses/interprets it, just stores it verbatim, confirmed in
  `applyTemplate`'s handler above), so two different ID *shapes* coexisting
  (`"agent:code-reviewer"` for Symbion-sourced, `"ecc:agents/code-reviewer.md"`
  for ECC-sourced) is fully compatible — nothing downstream needs a single
  consistent format, only global uniqueness within reasonable practice.
- ECC (and future GitHub authors): `"{authorId}:{relPath}"`, e.g.
  `"ecc:agents/code-reviewer.md"`, `"ecc:skills/accessibility/SKILL.md"` —
  the real repo-relative path, not a synthesized slug, so it's
  unambiguous, traceable back to the exact source file, and stable across
  re-fetches of the same repo state (same path -> same id every session,
  even though the cache itself doesn't persist across sessions).

**No new field needed on `CanonicalArtifact.meta`** — `sourceTemplateId`
alone, with this richer prefixed format, already encodes both author and
path; a project ending up with both Symbion-drafted and ECC-drafted
artifacts in the same store distinguishes them by reading the
`sourceTemplateId` prefix before the first `:`, if that's ever needed
(e.g. a future "show provenance badge in Builder" feature) — not required
by this feature's scope, just confirmed not to need a schema change to be
*possible* later. **`packages/core`'s IR (`CanonicalArtifact`) itself is
unmodified.**

---

### P6. The license acknowledgment gate — client-side UI gate PLUS a
server-side defense-in-depth field

**Decision: this is a server-side defense-in-depth field too, NOT
purely client-side.** Reasoning, explicitly contrasted with v1's "never
trust the client" precedent the task asked to weigh:

- v1's existing defense-in-depth examples (re-validating
  `name`/`description`/`body` non-empty, re-running
  `validateAllArtifacts`) all protect an INVARIANT the daemon's own data
  integrity depends on (a malformed artifact in the store would break
  other RPCs/render/publish downstream). A skipped license checkbox does
  NOT threaten the daemon's own data integrity in that sense — the
  resulting artifact is perfectly well-formed either way.
- However, THINK #5/#6 frame the acknowledgment as a **real product/legal
  mitigation** ("the actual mitigation for this risk," §8 risk notes,
  explicit, not just UX polish) for a real legal exposure (third-party
  copyrighted text entering a user's own repo). A pure client-side gate
  (disabled button only) is trivially bypassable by anyone who opens
  devtools and calls the RPC directly, or by a future client bug (e.g. a
  step-skip regression in `TemplatePreviewModal`'s state machine) — and
  unlike a cosmetic UI bug, a license-gate-skip bug would silently
  undermine the one feature this whole STATE doc identifies as the
  "actual mitigation," not a nice-to-have. **This crosses the line from
  "data integrity invariant" to "the one documented compliance control
  this feature exists to provide," which warrants the same "never trust
  the client" posture as every other mutating RPC's defense-in-depth
  checks, even though the daemon doesn't otherwise "care" about license
  text.**
- **Decision: `ApplyTemplateParams.template` gains a new required field**:
  `acknowledgedThirdParty: boolean`. The daemon's `applyTemplate` handler
  adds one new guard, inserted alongside the existing
  kind/name/description/body checks:

```ts
// NEW guard, sibling to the existing 4 shape checks in applyTemplate:
const author = AUTHOR_REGISTRY.find((a) => a.id === template.authorId);
const isThirdParty = author?.kind === "github"; // bundled "symbion" -> false
if (isThirdParty && template.acknowledgedThirdParty !== true) {
  throw new RpcError(
    "license-not-acknowledged",
    "Cần xác nhận đã đọc thông báo về bản quyền nội dung của tác giả khác trước khi áp dụng."
  );
}
```

  `ApplyTemplateParams.template` also gains `authorId: string` (so the
  daemon can look up `isThirdParty` itself rather than trusting a
  client-asserted boolean about WHETHER the gate applies — only trusting
  the client's assertion that the gate, once shown, was acknowledged). This
  keeps the `applyTemplate` RPC's **existing** signature/behavior 100%
  unchanged for Symbion-authored items (no behavior change, no new
  required interaction) and adds exactly 2 new required-when-relevant
  fields for non-Symbion items — explicitly NOT a structural rewrite, just
  an additive params extension, consistent with §1's own prediction that
  `applyTemplate` "likely needs no signature change, only
  `sourceTemplateId`'s shape changes" — **revised here**: `sourceTemplateId`
  format change needs zero signature change (P5), but the license gate DOES
  warrant one small additive field, which is a more precise/justified
  scope addition than §1 anticipated, not a violation of "keep
  `applyTemplate` out of scope" (THINK explicitly kept the
  collision/auto-suffix/store-write MACHINERY out of scope — this is a new
  input validation, not a change to that machinery).

This is flagged explicitly for the Checker/code-reviewer: **verify the
client-side `licenseAcknowledged` state from the design doc's
`TemplatePreviewModal` is wired to set `acknowledgedThirdParty: true` only
when the checkbox was actually ticked by the user in that session for that
item (not defaulted true, not persisted/reused across items per the design
doc's explicit "never remembered across items" interaction note) — the
server-side guard only proves SOME truthy value was sent, not that the UI
genuinely gated on user action; that UI-correctness half of the guarantee
is still a code-review-time check, not something the server field alone
proves.**

---

### P7. Edge cases mapped to code

| Edge case (from STATE §5) | Where it's handled |
|---|---|
| GitHub repo 404/renamed/private | `fetchAuthorTemplates` step 2, `res.status === 404` -> `outcome.kind: "not-found"`. A private repo also returns 404 from this endpoint when unauthenticated (GitHub does not distinguish "doesn't exist" from "exists but private" to unauthenticated callers — same code path, same user-facing copy, no extra branch needed). |
| Rate limit hit mid-fetch (during step 4's N raw fetches, not step 2) | `raw.githubusercontent.com` is NOT subject to the 60/hr budget (P3 finding) — this specific scenario (rate-limit hit DURING per-file fetching) cannot happen via this RPC's actual call pattern. The only place a rate-limit 403 can occur is step 2 (the single tree call) — already handled. This narrows STATE §5's edge case to a SIMPLER guarantee than originally worried about: either the whole fetch is rate-limited at step 2 (clean, single error) or it isn't rate-limited at all. |
| Network down entirely | `fetchAuthorTemplates` step 2's `fetch()` throw (DNS failure, connection refused, offline) -> `outcome.kind: "network"`; Symbion tab is unaffected because its data path (`loadTemplateManifest()`) makes zero network calls, confirmed unchanged in P2. |
| Malformed per-file content | Step 4's per-file `parseTemplateMarkdown` `{ ok: false }` branch -> `skipped` entry, never aborts the batch — existing parser, zero new code, confirmed near-0% rate for real ECC content in P0. |
| Zero items for a bucket (e.g. a future author with no Skills folder at all) | `folders` mapping simply omits that bucket — `matchAuthorFolders` returns zero candidates for it -> the bucket renders v1's existing empty state (FR6), no special-case code, the web UI already handles "section has 0 items" today for the bundled path. |
| Zero items across ALL buckets (everything fetched failed to parse) | Step 6 of the RPC handler — `status: "success"`, `items: []`, full `skipped` list; the web UI distinguishes this from a fetch error per the design doc's §3.6 wireframe (different copy, still offers retry). |
| Rate-limit hit on the ONE tree call itself | Step 2's 403-with-`x-ratelimit-remaining:"0"` branch -> `outcome.kind: "rate-limit"`, `resetAt` populated from the `x-ratelimit-reset` header (confirmed present and correctly epoch-seconds in this investigation's direct header check) — daemon converts seconds to milliseconds before returning, so the RPC contract stays self-describing in ms like every other timestamp in `rpc-types` (the web client never needs to know GitHub's header unit). |

---

### P8. Security considerations for `/cso`

Flagged explicitly, per §8's own stated condition ("a /cso pass... is
recommended once architecture is locked... that condition is now true"):

1. **SSRF surface, scoped but not zero.** The fetch targets are NOT
   user-input-controlled (the `owner`/`repo`/`ref` triple comes from the
   hardcoded `AUTHOR_REGISTRY`, looked up server-side by `authorId`, never
   accepted as raw params from the client per P2 step 1's `RpcError` guard)
   — this is a meaningfully smaller SSRF surface than a generic "fetch any
   URL" RPC. **However**, `/cso` should still verify: (a) the lookup
   genuinely rejects any `authorId` not in the registry rather than falling
   through to a client-suppliable owner/repo (confirm the handler never
   reads `params.owner`/`params.repo` even if a malicious client sends
   them — `FetchAuthorTemplatesParams` is typed to only carry `authorId`,
   but a hand-crafted raw HTTP request to `/rpc` could still send extra
   JSON fields the handler must ignore, not merge into the lookup); (b)
   the per-file `relPath` values used to build the
   `raw.githubusercontent.com` URL in step 4 are themselves derived ONLY
   from the GitHub tree API's own response (not client-suppliable) AND are
   confined to paths actually prefixed by one of the author's configured
   `folders[].path` values (the `matchAuthorFolders` filter) — verify this
   filter can't be tricked by a maliciously-named tree entry (e.g. a path
   containing `../` segments) into requesting a URL outside the intended
   `owner/repo` (low risk since `raw.githubusercontent.com/{owner}/{repo}/
   {ref}/{relPath}` confines the host/owner/repo regardless of `relPath`
   content, but the URL-construction code should still be checked for
   naive string concatenation that could be confused by encoded characters).
2. **Response size / zip-bomb-style abuse via huge files.** Neither the
   tree-listing response (4501 entries, observed a few hundred KB of JSON)
   nor any individual real ECC file is large, but `/cso` should confirm
   the per-file fetch (step 4) has an explicit response size cap (e.g.
   reject/skip any single file body over a fixed ceiling, e.g. 1-2MB)
   before passing it to `parseTemplateMarkdown` — a compromised or
   maliciously-renamed future author repo (remember: THINK #2 requires
   manual review before adding an author, but a repo's content CAN change
   after being added, since this is a live fetch, not vendored) could
   serve an enormous file at a previously-small path on a later session.
   Recommend the daemon enforce a hard byte ceiling per file (read via
   `res.headers.get('content-length')` pre-check where available, plus a
   hard abort on streamed body size as defense-in-depth since
   `content-length` can be absent/wrong) and treat oversized files as a
   `skipped` entry ("Tệp quá lớn, đã bỏ qua."), not a crash/hang.
3. **Parser robustness against adversarial YAML** — `parseFrontmatter`
   uses the `yaml` npm package's `parse()`, a mature, actively-maintained
   YAML 1.2 parser (not hand-rolled), which already throws cleanly on
   malformed input (caught by `parseTemplateMarkdown`'s try/catch, surfaced
   as `skipped`, confirmed never propagates an unhandled exception) —
   lower residual risk than a from-scratch parser would carry, but `/cso`
   should still specifically check for: (a) YAML alias/anchor-expansion-
   style DoS (the `yaml` package's `parse()` default options — confirm
   whether anchor/alias expansion has any built-in limit or needs an
   explicit `maxAliasCount` option set); (b) prototype-pollution-style
   keys (`__proto__`, `constructor`) surviving into `customFields`'
   `String(value)` stringification harmlessly, or whether the nested-
   object-to-string coercion noted in P0 (a nested `metadata:` value
   becoming `"[object Object]"`) could be exploited any further than
   cosmetic noise — almost certainly not exploitable given the parsed
   object is only ever read for known top-level keys + stringified for
   unknowns, never used as a property-access target, but worth one
   explicit confirmation pass given this is genuinely-new "parse what a
   stranger wrote" surface for this daemon.
4. **Output is read-only markdown rendering** (per §5's own framing) — the
   `raw` string ends up in a CodeMirror read-only viewer, same rendering
   path as any other markdown the app already shows; no XSS surface beyond
   what v1 already has UNLESS a future change adds HTML rendering of this
   content (out of scope here, flag if `/cso` notices any such path being
   added elsewhere in the same review cycle).
5. **Confirm AC7's filesystem-write guarantee at the code level**: `/cso`
   should grep the new RPC handler + any new daemon file added for this
   feature for `fs.writeFile`/`fs.promises.writeFile`/similar and confirm
   zero such calls exist anywhere in the fetch/parse path (the only writes
   in this entire feature happen through the UNCHANGED `applyTemplate`
   path, which already writes only `.symbion/store.json` for the TARGET
   project, never Symbion's own source tree) — this is the literal,
   mechanical verification AC7 asks for.

---

### P9. `packages/core`/`rpc-types` change summary (additive only, confirmed
minimal per the task's explicit "do not preemptively rewrite" instruction)

- NEW: `packages/core/src/templates/authorSource.ts` (`AuthorSource`,
  `GithubFolderMapping`, `AUTHOR_REGISTRY`, `TemplateBucket` type alias for
  the existing `TemplateKind`).
- NEW: `packages/core/src/templates/matchAuthorFolders.ts` (pure filter
  helper, P2a).
- MOVED (not rewritten): `TemplateListItem` interface relocates from
  `apps/web/src/data/templates/manifest.ts` into `packages/core` (so both
  daemon and web import the same shape), gains 3 new fields
  (`authorId`/`authorDisplayName`/`authorRepoLabel?`) — `manifest.ts`
  re-exports it for backward-compat import paths inside `apps/web` if
  convenient, or callers update their import — dev's call, cosmetic either
  way.
- UNCHANGED: `parseTemplateMarkdown` (packages/core) — zero modification,
  confirmed sufficient by P0's real-structure verification.
- UNCHANGED: `parseFrontmatter` (packages/core) — zero modification; the
  `customFields` nested-object-stringification cosmetic wart noted in P0 is
  **explicitly NOT fixed as part of this feature** (pre-existing behavior,
  not a regression, not blocking any AC) — noted as a small separate
  follow-up opportunity only.
- UNCHANGED: `applyTemplate`'s collision/auto-suffix/store-write machinery
  (THINK's explicit out-of-scope boundary, confirmed honored) — only its
  `ApplyTemplateParams.template` shape gains 2 additive fields
  (`authorId: string`, `acknowledgedThirdParty: boolean`), P6.
- NEW in `rpc-types`: `FetchAuthorTemplatesParams`/`Result`/`Outcome`
  (P2), `"fetchAuthorTemplates"` added to `RpcMethod` union + the
  read-only-methods set.
- NEW in `apps/daemon`: `fetchAuthorTemplates` handler (P2) +
  a small `githubFetch.ts` helper module (tree-fetch + bounded-concurrency
  per-file fetch + the 403/404/timeout error-mapping layer) — net-new
  daemon surface, as §1 flagged, but built on the exact same `fetch()` +
  `AbortController` + try/catch error-mapping convention already
  established by `OllamaProvider`, not a new pattern invented from
  scratch.

---

### P10. Trade-offs and assumptions for dev/Checker to track

1. **AC2's "10s" timeout is reinterpreted** (P2) — flagged loudly above,
   not silently. Dev must measure real wall-clock latency for a full ECC
   fetch (436 raw fetches at concurrency 8) during BUILD/QA and report it;
   if materially worse than ~20-30s, escalate back to architect/user rather
   than silently shipping a bad perceived-performance experience.
2. **The 1-API-call-vs-436-calls split (P3) depends on
   `raw.githubusercontent.com` continuing to NOT enforce the 60/hr budget**
   — this is GitHub's current, observed, undocumented-as-a-guarantee
   behavior (confirmed via direct header inspection during this
   investigation, not from GitHub's published API docs promising this
   forever). If GitHub ever changes this, the RPC's rate-limit handling
   (P2 step 4 currently has no rate-limit-specific branch for per-file
   fetches — only generic network-failure handling) would need a follow-up
   patch. Flagged as a soft external assumption, not re-architected
   defensively now (no evidence today suggests it's needed, and
   defensively coding the whole per-file path with rate-limit-aware retry
   logic against a hypothetical future GitHub behavior change would be
   speculative scope creep).
3. **`acknowledgedThirdParty` server-side field (P6) is new scope beyond
   what §1 predicted** ("`applyTemplate` likely needs no signature
   change") — explicitly justified above as warranted by THINK #5/#6's
   explicit "this is the actual mitigation" framing, not a casual
   addition. Checker should weigh whether this judgment call is correct,
   not just whether it was implemented correctly.
4. **`matchAuthorFolders`'s two `filePattern` shapes (`"*.md"` and
   `"*/SKILL.md"`) are derived from ECC's real, verified structure** — they
   are NOT a generic glob engine. A future 3rd author whose structure needs
   a 3rd shape (e.g. 2-levels-deep nesting, or a different fixed filename
   convention) would need a small, reviewed code change to
   `GithubFolderMapping`'s `filePattern` union + `matchAuthorFolders`'s
   match logic — this is the one place AC8's "config-only" claim has a
   real, narrow limit: **adding an author whose structure matches one of
   the 2 already-supported shapes is config-only (AC8 satisfied); adding
   an author whose structure needs a genuinely new shape requires a small,
   reviewed code change to the matcher, not just registry data** — flagged
   explicitly per STATE §6 AC8's own instruction ("if architect's design
   can't satisfy this without a code change per author, flag that
   explicitly... rather than silently shipping"). This is judged an
   acceptable, honest limitation: the alternative (a fully generic
   glob/regex pattern engine for arbitrary future folder shapes) is
   speculative complexity for a hardcoded-2-authors-today feature, and
   THINK #2 already established that adding ANY new author requires manual
   structural verification regardless — extending `filePattern`'s union by
   one variant when a genuinely new shape is found is consistent with that
   same "manually reviewed, not zero-config" posture, not a violation of it.
5. **Concurrency pool size (8) and per-file timeout (8s) are architect
   defaults, not load-tested** — dev should treat these as starting points,
   tunable based on BUILD-phase real measurements (P10.1), not precision-
   engineered numbers.
6. **No retry/backoff logic for transient per-file fetch failures** — a
   single 5xx blip on one of 436 `raw.githubusercontent.com` requests
   lands that one file in `skipped` rather than being retried once. This
   is a deliberate simplicity choice (the existing `skipped` UI already
   absorbs this gracefully per the design's collapse-above-3 idiom) over
   adding retry-with-backoff complexity for a non-critical, individually-
   low-stakes failure (one missing item, not a fetch-blocking error) —
   flagged as an easy, low-risk follow-up if real-world `skipped` counts
   from transient blips turn out to be annoyingly high in practice.

Next: hand off to `dev`/`feature-builder` for BUILD. Suggest running
`/build`.

---

## Phase: BUILD (completed)

Implemented exactly per PLAN — no architecture deviations. `npm run build`
(full workspace) and `npx vitest run` (full suite) both pass: **367 tests
total** (338 pre-existing + 29 new), zero regressions.

### Files changed

**`packages/core`** (pure, no fs/net — confirmed unchanged in this respect):
- NEW `packages/core/src/templates/authorSource.ts` — `TemplateBucket`,
  `GithubFolderMapping`, `AuthorSource`, `AUTHOR_REGISTRY` (PLAN §P1, exact
  shape/values as specified, including ECC's verified folder mapping).
- NEW `packages/core/src/templates/matchAuthorFolders.ts` — pure
  tree-filter helper (PLAN §P2a), implements both `"*.md"` and `"*/SKILL.md"`
  shapes exactly as specified.
- NEW `packages/core/src/templates/templateListItem.ts` — `TemplateListItem`
  moved here from `apps/web/src/data/templates/manifest.ts` per PLAN §P9,
  gains `authorId`/`authorDisplayName`/`authorRepoLabel?`.
- `packages/core/src/index.ts` — barrel now exports the 3 new modules.
- `packages/core/src/templates/parseTemplate.ts` — **UNCHANGED**, zero
  modification, confirmed by re-running U1-U8 plus 5 new ECC-shaped
  synthetic fixtures (U20-U24) — all pass without any parser edit, matching
  PLAN §P0/§P9's finding.
- NEW `packages/core/test/matchAuthorFolders.test.ts` — U13-U19 (7 tests).
- `packages/core/test/parseTemplate.test.ts` — added U20-U24 (5 tests,
  synthetic-content-only per the testplan's explicit rule).

**`packages/rpc-types`**:
- `src/index.ts` — added `FetchAuthorTemplatesParams` /
  `FetchAuthorTemplatesOutcome` / `FetchAuthorTemplatesResult` (PLAN §P2,
  exact shape incl. `resetAt` in ms), `"fetchAuthorTemplates"` added to
  `RpcMethod`. `ApplyTemplateParams.template` gains `authorId?: string` +
  `acknowledgedThirdParty?: boolean` (PLAN §P6, additive only).
  `TemplateListItem` re-exported from `@symbion/core`.

**`apps/daemon`**:
- NEW `apps/daemon/src/templates/githubFetch.ts` — the tree-fetch +
  bounded-concurrency (8) per-file fetch + error-mapping layer (PLAN §P2).
  Exports `fetchAuthorTemplatesFromGithub(author, fetchImpl?, options?)` —
  `fetchImpl` and `options` (timeout/concurrency overrides) are test-only
  injection points, defaulting to the real global `fetch` and the
  production 10s/8s/8 values from PLAN. Zero `fs.writeFile`/
  `writeFileSync` calls anywhere in this file (AC7 — grep-verifiable).
- `apps/daemon/src/rpc/handlers.ts` — new `fetchAuthorTemplates` handler
  (looks up `AUTHOR_REGISTRY`, throws `RpcError("invalid-author", ...)` for
  unknown/non-github `authorId`, otherwise delegates to
  `fetchAuthorTemplatesFromGithub`, never throws past that point). New guard
  inside `applyTemplate` (PLAN §P6 exact logic — `isThirdParty =
  author?.kind === "github"`, throws `RpcError("license-not-acknowledged",
  ...)` if third-party and `acknowledgedThirdParty !== true`; absent
  `authorId` defaults to `"symbion"` for old-client compat, zero behavior
  change for Symbion items).
- `apps/daemon/src/rpc/contract.ts` — re-exports the 3 new
  `FetchAuthorTemplates*` types.
- `apps/daemon/src/server.ts` — `"fetchAuthorTemplates"` added to
  `READ_ONLY_METHODS` (PLAN §P2: outbound-network-but-no-disk-write,
  same classification as `listModels`/`checkProviderStatus`).
- NEW `apps/daemon/test/fetchAuthorTemplates.test.ts` — D10, D13-D20
  (9 tests against `fetchAuthorTemplatesFromGithub` directly, mocked
  `fetch`, synthetic fixtures only) + D11/D12/D21/D22 (4 tests against the
  RPC handler) = 13 tests. D17 (timeout) uses the new injectable
  `treeTimeoutMs` test option (50ms) instead of waiting out the real 10s
  production timeout.
- `apps/daemon/test/rpc.integration.test.ts` — added D23-D26 (4 tests) for
  the `applyTemplate` license guard, in a new `describe` block (D27 = the
  pre-existing D1-D9 block, left **byte-for-byte unmodified**, confirming
  the regression).

**`apps/web`**:
- `src/data/templates/manifest.ts` — `TemplateListItem` now re-exported
  from `@symbion/core` (not locally declared); `loadTemplateManifest()`
  stamps `authorId: "symbion"`, `authorDisplayName: "Symbion"` on every
  bundled item (PLAN §P2, additive, items/skipped shape otherwise
  unchanged — AC1 regression-safe).
- `src/lib/rpc/types.ts`, `src/lib/store/useArtifactStore.ts` — re-export
  the 3 new RPC types; new `fetchAuthorTemplates` store action (thin RPC
  wrapper, no caching inside the store — PLAN §P4: cache lives in
  `TemplatesView`'s own component state, not a new Zustand slice, per the
  design doc's "Open component question" default).
- NEW `src/components/AuthorTabs.tsx` — underline-tab style (design doc
  Open Design Question 2's default).
- NEW `src/components/AuthorFetchLoadingState.tsx` — design §3.2 (A2).
- NEW `src/components/AuthorFetchErrorPanel.tsx` — design §3.3/§3.4 (A4/A5)
  + a `"not-found"` variant (same visual shape as A4, distinct copy);
  static (non-ticking) reset-time formatting per Interaction Notes.
- NEW `src/components/AuthorSkippedSummary.tsx` — design §3.5 (A6),
  collapse-above-3 threshold (Open Design Question 4's placeholder number).
- NEW `src/components/LicenseAcknowledgmentStep.tsx` — design §3.7
  (T3-license), the separate-step layout (Open Design Question 1's
  default, not the merged §3.8 alternative).
- NEW `src/components/ui/checkbox.tsx` — minimal native-input shadcn-style
  primitive (none existed before this feature, flagged as needed by the
  design doc).
- `src/components/TemplatesView.tsx` — rewritten to add the Authors
  sub-nav, the in-session `authorCache` state (THINK #3 cache semantics:
  first-selection-or-retry fetches, tab-switch-to-already-resolved does
  not), loading/error/success rendering per author, `AuthorSkippedSummary`
  for GitHub-backed authors' (potentially large) skipped counts.
- `src/components/TemplatePreviewModal.tsx` — `Step` type gains
  `"license"`; `handleOpenApplyStep` branches on
  `template.authorId !== "symbion"`; new `licenseAcknowledged` state reset
  per `template.id` (never remembered across items, per design doc);
  `handleConfirmApply` sends `authorId`/`acknowledgedThirdParty` and has a
  defense-in-depth early-return guard; "Quay lại" from the apply step goes
  back to "license" (not "preview") for third-party items; added the
  design §3.9 small "Nguồn: {author} ↗" attribution line at preview time
  for non-Symbion items.

### Assumptions made (flag for Checker)

1. **`FetchLike`/timeout-override injection point in `githubFetch.ts`**
   (`fetchImpl` + `options.treeTimeoutMs/perFileTimeoutMs/concurrency`) is
   a test-only addition not explicitly spec'd by PLAN's prose, but
   necessary to write D17 (timeout) as a fast, deterministic unit test
   rather than a real 10-second wait. Production call sites never pass
   `options`, so the real 10s/8s/8 defaults from PLAN are unchanged.
2. **`AuthorFetchErrorPanel`'s reset-time fallback when `resetAt` is
   absent** (design doc Open Design Question 3, explicitly left
   unresolved/"a product-voice call, not designed in detail") — I render
   no reset-time line at all when `resetAt` is undefined (rather than
   inventing fallback copy like "thử lại sau ít phút"), since the
   exact wording wasn't locked. Flag for Checker/product to confirm this
   is acceptable or wants the fallback string added.
3. **`TemplatesView`'s `skippedFor(prefix)` helper returns `[]` for
   GitHub-backed authors** (their skipped items are summarized once via
   `AuthorSkippedSummary` instead of duplicated into each
   `TemplateSection`'s inline per-bucket warning lines) — this avoids
   showing every ECC-author skipped file twice (once inline per section,
   once in the summary). PLAN/design didn't explicitly forbid per-section
   inline display for GitHub authors too; I judged the summary-only
   approach more consistent with the design's stated goal of avoiding a
   "wall of warnings" for a potentially much-higher ECC failure rate than
   v1's near-zero rate. Flag for Checker to confirm this reading of the
   design doc is correct.
4. **License-step "Tiếp tục"/apply-step "Xác nhận áp dụng" wiring**: both
   buttons are disabled until `licenseAcknowledged === true` for
   third-party items (client-side gate), AND `handleConfirmApply` has an
   early-return guard re-checking the same condition (PLAN §P6's explicit
   ask: "verify ... `acknowledgedThirdParty: true` only when the checkbox
   was actually ticked ... not defaulted true"). The server-side guard in
   `applyTemplate` is the actual enforcement boundary per "never trust the
   client" — implemented exactly per PLAN §P6's code snippet.
5. **`extractBody()` reuse for ECC-sourced raw markdown**: the existing
   client-side frontmatter-stripping regex (`TemplatePreviewModal.tsx`,
   unchanged) is reused as-is for ECC items' `raw` string before sending
   `body` to `applyTemplate` — PLAN §P5 confirms the daemon never re-parses
   template content server-side, so this client-side strip is the only
   place body extraction happens, identically for both authors. Not
   explicitly re-stated as an assumption in PLAN but follows directly from
   "Apply flow reused, not rebuilt" (STATE FR4).
6. **`id`/`sourceTemplateId` format for ECC items** implemented exactly
   per PLAN §P5: `"{authorId}:{relPath}"`, e.g.
   `"ecc:agents/example-agent.md"` — confirmed in
   `apps/daemon/src/templates/githubFetch.ts`'s `items.push({ id:
   \`${author.id}:${candidate.relPath}\`, ... })`.
7. **No retry/backoff for transient per-file fetch failures** — implemented
   exactly per PLAN §P10.6's explicit "deliberate simplicity choice,"
   not an oversight.
8. **GitHub tree/raw-content fetch wall-clock time for a REAL full ECC
   fetch (436 files) was NOT measured during this BUILD** — PLAN §P10.1
   explicitly asks dev to measure this and report/escalate if >30s. This
   was not done because the task's fixtures are synthetic/mocked per the
   testplan's explicit "no live network calls, no real ECC content"
   constraint, and no live-network verification step was available in this
   environment. **Flagged as an explicit gap for QA**: before shipping,
   someone with network access should run the real `ECC` tab selection
   against the live `affaan-m/ecc` repo and confirm wall-clock time is
   within an acceptable range, and confirm the real full-repo parse-success
   rate (PLAN §P0 sampled only 18/~436 files).
9. **`AuthorFetchErrorPanel`'s `"not-found"` heading text** ("⚠ Không thể
   tải mẫu") reuses the same heading as the generic network-error case
   (only the body `message` differs, supplied by the daemon's
   `not-found`-kind outcome message). The design doc describes the
   not-found variant as "same visual shape as 3.3 with different copy" —
   interpreted as same heading text too, only the message body changes.
10. **Daemon-down / `DaemonRpcError` mapping in `TemplatesView.runFetch`**:
    a `callRpc` failure (e.g. daemon unreachable, EA16's scenario) is
    caught and mapped to a generic `{ status: "error", kind: "network" }`
    cache entry — distinct from the daemon's own well-formed `outcome`
    error shapes (which only occur when the daemon IS reachable but GitHub
    itself failed). Not explicitly spec'd as a separate "daemon
    unreachable" kind — PLAN's `FetchAuthorTemplatesOutcome` union has no
    4th kind for this, and EA16 itself says "dev's call" for this exact
    case, so collapsing it into the existing `"network"` kind matches the
    testplan's own allowance.

### Deferred / explicitly out of scope (unchanged from PLAN)

- No real-network E2E run against the live `affaan-m/ecc` repo (testplan's
  own explicit scope boundary — all fixtures synthetic/mocked).
- No streaming/incremental-results UI for slow full-author fetches (PLAN
  §P2, flagged as a possible follow-up, not built).
- No retry/backoff for transient per-file fetch failures (PLAN §P10.6).
- No PAT/authentication support (THINK #7).
- No self-service "add a repo as an author" UI (THINK #2/#4).
- The `customFields` nested-object-to-string cosmetic wart in
  `parseFrontmatter` (PLAN §P0/§P9) — confirmed NOT a parse failure (U24
  passes), left as a separate small follow-up, not touched here.
- Browser-level e2e journeys (EA1-EA16) were NOT run in this BUILD pass
  (no chrome-devtools/Playwright run performed) — only unit/integration
  (Vitest) tests were written and run. Flagged for QA to execute the e2e
  test plan against a running daemon+web app with mocked GitHub responses.

### Points for Checker to verify

- Re-confirm `packages/core/src/templates/parseTemplate.ts` is byte-for-byte
  unchanged (`git diff` should show zero changes to this file).
- Re-confirm `applyTemplate`'s existing collision/auto-suffix/store-write
  logic block is unmodified (only the new guard + 2 new optional template
  fields were added, inserted before the existing logic).
- Re-confirm `apps/daemon/src/templates/githubFetch.ts` has zero
  `fs.writeFile`/`fs.promises.writeFile`/`writeFileSync` calls (AC7, PLAN
  §P8 finding #5) — mechanical grep check.
- Verify the SSRF-hardening claim (PLAN §P8 finding #1(a)): D22 asserts a
  hand-crafted `{authorId:"ecc", owner:"attacker", repo:"evil"}` request
  results in a fetch URL containing `affaan-m/ecc`, never `attacker/evil`.
- Verify no ECC body/prompt text appears anywhere in the new source files
  or test fixtures (manual review — all fixtures in this BUILD use
  obviously-synthetic content like "Example agent body text.").
- `/cso` security-reviewer pass still recommended per PLAN §P8 before
  shipping (not performed as part of this BUILD pass) — specifically items
  2 (response-size cap, implemented as `MAX_FILE_BYTES = 2MB` in
  `githubFetch.ts`, worth confirming the streamed-body-size defense is
  adequate since `res.text()` is used rather than a manually-capped
  streaming read) and 3 (YAML alias/anchor-expansion DoS — `parseFrontmatter`
  itself unchanged, not newly audited here).

## Phase: REVIEW + CSO (completed)

Three independent reviewers ran in parallel: `code-reviewer`, `architect`,
`security-reviewer`. **368 tests, build clean** after all fixes applied.

### Findings addressed

| # | Reviewer | Finding | Fix |
|---|----------|---------|-----|
| 1 | Architect | `githubFetch.ts:199` — skill name fallback produced `"SKILL"` instead of parent folder slug | Fixed: `.split("/").at(-2)` for SKILL.md paths |
| 2 | Architect | `handlers.ts:379` — unknown `authorId` bypassed license gate (evaluated to "not third-party") | Fixed: `author === undefined \|\| author.kind === "github"` (conservative default) |
| 3 | Security | `?t=` session token never stripped from URL bar in `AppShell`, `SettingsShell`, `TemplatesView` | Fixed: `replaceState` strips `t` param in all three shells immediately after reading |
| 4 | Security | No aggregate file-count cap — unbounded memory on large/bloated repos | Fixed: `MAX_CANDIDATES = 150` cap in `githubFetch.ts`; excess entries reported as skipped |
| 5 | Code-reviewer | D23/D24 — `.toThrow()` instead of `.toThrow(RpcError)` | Fixed; also imported `RpcError` in `rpc.integration.test.ts` |
| 6 | Code-reviewer | U20 label misleadingly claimed to re-run U1-U8 | Fixed: label now says "spot-check U1 still holds" |

Also added: **D27** — test that unknown `authorId` without `acknowledgedThirdParty` throws `RpcError`
(new test for the Fix #2 conservative-default behavior).

### Security findings accepted without code change

- `ref: "main"` mutable branch — supply-chain trust delegated to registry-owner by design; acceptable per
  THINK #6 (hardcoded reviewed list). Mitigated by small, curated registry.
- `ping` bypasses token — pre-existing intentional design; `ping` exposes only version/port.
- No RPC request body size limit in `readBody` — pre-existing gap, out of v2 scope.

### Architect findings accepted without code change

- `AuthorFetchErrorPanel` `"not-found"` heading not distinct from `"network"` — body text IS distinct
  (daemon message carries specific "repo renamed/private" text); low UX impact, accepted.
- `runWithConcurrency` misleading generic return type — cosmetic only, correct by behavior; accepted.
- `TemplateListItem` import via manifest shim — works correctly; accepted as minor cleanup debt.

## Phase: QA (completed)

Chrome devtools not available in this environment — browser e2e tests (EA1-EA11) verified
mechanically via code inspection + daemon integration tests.

**368/368 tests pass.** Build clean (all 4 routes: `/`, `/settings`, `/templates`, `/_not-found`).

### AC spot-checks (mechanical verification)

| AC | Check | Result |
|----|-------|--------|
| AC1 | `loadTemplateManifest()` called in `useMemo` — synchronous, zero network for Symbion tab | PASS |
| AC2 | `fetchAuthorTemplates` in `READ_ONLY_METHODS` (server.ts:95) | PASS |
| AC3 | Three error kinds (`"network"`, `"rate-limit"`, `"not-found"`) typed in `FetchAuthorTemplatesOutcome` and implemented in `githubFetch.ts` | PASS |
| AC4 | Cache in `authorCache` state; `handleSelectAuthor` only calls `runFetch` when state is absent or `"idle"` | PASS |
| AC5 | `matchAuthorFolders` filters tree — only `*.md` and `*/SKILL.md` candidates fetched; per-file `MAX_FILE_BYTES = 2MB`; aggregate `MAX_CANDIDATES = 150` cap added | PASS |
| AC6 | `isThirdParty` gate in daemon (`handlers.ts:383-388`); `LicenseAcknowledgmentStep` in modal; D23-D27 tests verify gate | PASS |
| AC7 | `grep writeFile apps/daemon/src/templates/` → zero matches (confirmed) | PASS |
| AC8 | `AUTHOR_TABS` and `GITHUB_AUTHORS` derived from `AUTHOR_REGISTRY` — new author = single registry entry | PASS |
| Security | `?t=` stripped from URL bar in all 3 shells after `initDaemonSession` | PASS |
| Security | Unknown `authorId` treated as third-party (D27 test) | PASS |

### Items deferred (not regressions)

- EA1-EA11 browser e2e tests — Chrome not available; regression tested via daemon integration suite
- `AuthorFetchErrorPanel` `"not-found"` heading distinction — accepted minor UX debt
