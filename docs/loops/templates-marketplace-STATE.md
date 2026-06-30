# templates-marketplace — STATE

## Phase: QA (re-run) complete — PASS, ready for SHIP

## 0. Origin

User feature request (vi): add a "Templates" tab to the navbar. Clicking it
shows a library of pre-built skill/agent/command templates, grouped into
sections (Skills, Agents, Commands), sourced from/inspired by the public repo
https://github.com/affaan-m/ecc. Clicking a template item opens a modal
showing its raw markdown, with two actions: "Copy markdown" (clipboard) and
"Áp dụng" (Apply) — Apply shows the list of projects already registered in
Symbion, user picks one + confirms, and the template gets applied into that
project.

## 1. Code-reading findings (what already exists vs. what's new)

Read: `apps/web/src/components/AppNav.tsx`, `AppShell.tsx`,
`ProjectSidebar.tsx`, `ImportDialog.tsx`, `CreateProjectDialog.tsx`,
`FolderBrowserDialog.tsx`; `packages/core/src/ir/types.ts`,
`render/marker.ts`, `parse/scan.ts`, `adapters/{claude,codex}.ts`;
`apps/daemon/src/rpc/handlers.ts` (`listProjects`, `scanClaudeDir`,
`importArtifacts`, `computeDiff`/`publish`/`writeFiles`); `docs/loops/
load-existing-workflows-STATE.md`, `connect-providers-STATE.md`,
`create-project-folder-browser-STATE.md`, `symbion-STATE.md`.

**Reusable building blocks (confirmed in code):**
- `AppNav.tsx` is currently a deliberately tiny 2-link nav (Builder, Cài đặt)
  per `multi-provider-settings-STATE.md`'s explicit "don't build a generic
  shell" framing — a third tab is a small, well-precedented change in shape,
  not a new nav system.
- A project picker already exists in spirit: `daemon.listProjects` RPC
  (`apps/daemon/src/rpc/handlers.ts:207`) returns `GlobalConfig.projects`
  (`{id, name, path}[]`), already consumed by `useArtifactStore`/
  `ProjectSidebar`. Apply's "pick a project" step does not need a new RPC to
  enumerate projects — it needs a picker UI (dropdown/list), which has no
  existing standalone component (`ProjectSidebar`'s list is embedded in the
  persistent sidebar, not an extractable picker component today).
- The "scan markdown into a `CanonicalArtifact` and merge into a project"
  pipeline already exists end-to-end and is **read/write-store-only, not a
  direct disk write to `.claude/`**: `scanClaudeDir` (parses files into
  `CanonicalArtifact[]` via the pure `packages/core` parser) →
  `importArtifacts` (writes into that project's `.symbion/store.json`, sets
  `meta.status: "draft"`, marks `sourceTemplateId` available on
  `ArtifactMeta`). **This is the closest existing precedent for "Apply"** —
  Apply is conceptually "import this one template artifact into project X's
  store," after which the *existing* publish pipeline (render → diff preview
  → confirm → `writeFiles`, with the managed-marker/backup/conflict
  machinery already built) is what actually writes to that project's real
  `.claude/` folder on disk, same as any other artifact in the Studio. Apply
  is **not** expected to bypass that pipeline and `fs.writeFile` straight
  into the target repo.
- `ArtifactMeta.sourceTemplateId?: string` already exists in the IR
  (`packages/core/src/ir/types.ts:26`) — likely the field a template-derived
  artifact should populate, though its current usage elsewhere in the
  codebase is unconfirmed/probably unused (worth `architect` checking call
  sites before assuming it's load-bearing vs. vestigial).

**Critical gap — "Skills" is not a concept in Symbion today:**
- `ArtifactKind` (`packages/core/src/ir/types.ts:6`) is `"agent" | "command"`
  only. There is no `"skill"` kind anywhere in the IR, the Claude adapter
  (`packages/core/src/adapters/claude.ts`), the Codex adapter, the parser
  (`parse/scan.ts`), or the render/marker pipeline.
- CLAUDE.md itself scopes v1 providers explicitly as: Claude →
  `.claude/agents/<name>.md` + `.claude/commands/<name>.md`; Codex →
  `AGENTS.md`. No `.claude/skills/` path is mentioned anywhere in CLAUDE.md
  or any `docs/loops/*-STATE.md`/`*-design.md` file (grepped, zero hits
  outside `CLAUDE.md`'s own unrelated mentions and two `.claude/commands/
  *.md` files that are this repo's own tooling, not Symbion's IR).
- Claude Code's actual "Skills" feature (`.claude/skills/<name>/SKILL.md`,
  a 2025 Anthropic feature distinct from subagents/slash-commands) is a
  **third, structurally different artifact type** Symbion's core has never
  modeled: different directory shape (a folder per skill, not a flat `.md`
  file), different frontmatter shape, and conceptually it's a "capability
  the model can invoke," not a "subagent" or a "command." Treating the
  request's "Skills section" as just a third bucket of the existing agent/
  command IR would be **incorrect** — it needs either (a) a new `ArtifactKind`
  + new Claude adapter path + new render/parse support (a real `packages/
  core` feature, not just a UI gallery), or (b) the "Skills" section is
  scoped down to **read-only browse + copy-markdown only** (no "Apply" into
  a project's managed store) until skill-as-a-first-class-IR-kind is built
  separately. This is the single biggest scope question for this feature —
  flagged as Open Question 1 below, not decided here.

**No network/fetch capability exists anywhere in the codebase today** — the
daemon makes outbound HTTP calls only to configured local/remote LLM
providers (`apps/daemon/src/llm/*Provider.ts`, user-configured endpoints for
description/body generation), never to fetch arbitrary GitHub content. Per
CLAUDE.md, Symbion is explicitly local-files-only / no cloud dependency by
design philosophy (not a hard technical ban on any network call ever, since
LLM providers already do call out — but a live "fetch templates from
github.com/affaan-m/ecc at runtime" is a new category of behavior, not a
continuation of an existing pattern, and has real implications: requires
internet access for a tool otherwise fully offline-capable, depends on a
third-party repo's continued existence/license/format stability, and
introduces an external trust boundary the daemon has never had before).
This is Open Question 2.

## 2. Core user need

> As a developer setting up a new project's AI-coding workflow in Symbion, I
> don't want to hand-write every agent/command from scratch — I want to
> browse a library of known-good, pre-built templates (skills/agents/
> commands), preview the exact markdown before committing to anything, and
> one-click-apply a template into one of my already-registered Symbion
> projects, going through the same safe publish path as anything else I
> build in the Studio.

## 3. Scope

### In scope
- A third nav tab "Templates" in `AppNav.tsx`, alongside Builder/Cài đặt.
- A templates browse view with three sections: Skills, Agents, Commands.
  (Scope of "Skills" specifically is gated on Open Question 1 — see below;
  Agents and Commands sections are unambiguously in scope since both kinds
  already exist in the IR.)
- Each section lists template items (name + short description) sourced from
  a curated set of markdown templates inspired by/adapted from
  github.com/affaan-m/ecc's public agents/commands content (exact sourcing
  mechanism — vendored bundle vs. live fetch — is Open Question 2).
- Clicking an item opens a modal that renders the template's raw markdown
  (frontmatter + body) read-only.
- Modal action 1: "Copy markdown" — copies the exact raw markdown text (the
  same bytes that would be written to disk on Apply, including frontmatter)
  to the OS clipboard. No project/daemon involvement required for this
  action — pure client-side clipboard write.
- Modal action 2: "Áp dụng" (Apply) — opens a project picker (list of
  Symbion's already-registered projects, i.e. the same set `listProjects`
  already returns); user selects one project + confirms; the template is
  added as a new draft artifact in that project's store (mirroring the
  existing `scanClaudeDir`→`importArtifacts` pattern in spirit: parse the
  template markdown into a `CanonicalArtifact`, persist into that project's
  `.symbion/store.json`), **not** written directly to the target repo's
  `.claude/` folder — the user still goes through the Studio's normal
  review → publish → diff-preview → confirm flow afterward, exactly like
  any other artifact, before anything touches the real repo on disk.
- Empty/loading/error states for the templates list itself (e.g. bundled
  templates fail to load, or — if live-fetch is chosen per Open Question 2
  — the daemon has no internet access).

### Out of scope (do not let `/office-hours`/`/design`/`/plan` smuggle in)
- A live, generic "skill/agent/command marketplace" with search, ratings,
  versioning, or user-submitted templates. v1 of this feature is a small,
  fixed curated library, not a marketplace platform.
- An execution/run engine for templates — CLAUDE.md already defers all
  "run" capability to v2 ("Copy run command" only). Applying a template
  never executes it; it only stages it as a draft artifact for the user to
  review/edit/publish like any hand-authored one.
- Auto-sync / auto-update of templates from the upstream ECC repo on a
  schedule — if templates are vendored (Open Question 2 leans this way),
  updating the bundle is a manual, separate maintenance action (e.g. a
  future `/sync-templates` dev task), not a live feature.
- Writing directly to a target repo's `.claude/` folder from the Templates
  modal's "Apply" button, bypassing the existing diff-preview/confirm/
  backup/managed-marker publish pipeline. Apply only stages a draft artifact
  in the project's local store; the existing publish flow (already built,
  already safe) is the only path that touches the real repo's files.
- Modifying `ArtifactKind`/the Claude adapter to support `.claude/skills/
  <name>/SKILL.md`'s actual directory-based format, UNLESS Open Question 1
  is resolved in favor of full Skills support — if so, that IR/adapter work
  is itself a prerequisite sub-feature for `architect` to scope separately
  before this feature's UI can be built against it.
- Any change to `packages/core`'s existing marker/hash/diff/backup logic —
  this feature is purely additive (new browse UI + reuse of existing
  import-into-store mechanics), not a change to publish safety guarantees.

## 4. Functional requirements

1. Navbar shows a "Templates" tab; clicking it navigates to a templates view
   (new route, e.g. `/templates`, consistent with the existing `/`/`/settings`
   App Router pattern).
2. The view renders three labeled sections: Skills, Agents, Commands. Each
   section lists its template items (name + one-line description visible
   without opening the modal).
3. Each item is clickable; clicking opens a modal showing:
   - the item's raw markdown content, rendered in a read-only viewer
     (verbatim text, not WYSIWYG-rendered prose — the user needs to see
     exactly what frontmatter/body would be written).
   - a "Copy markdown" button that copies the exact raw text to clipboard
     and gives visible confirmation (e.g. toast/label change) that the copy
     succeeded.
   - an "Áp dụng" button that opens a second step/picker showing every
     project currently registered in Symbion (same set as the sidebar
     project list / `listProjects` RPC), each selectable.
4. After picking a project and confirming Apply: the template is parsed and
   added to that project's artifact store as a new draft artifact (status
   `"draft"`, matching the existing import convention) — it must then be
   visible in that project's normal artifact list/Builder view, indistinct
   from a hand-authored artifact except for whatever provenance field is
   decided (e.g. `sourceTemplateId`).
5. Apply does not touch the target repo's filesystem at all — only this
   project's `.symbion/store.json`. The user must separately use the
   existing Publish flow to actually write `.claude/agents/<name>.md` etc.
   to disk, going through the existing diff-preview/confirm/backup/marker
   machinery unchanged.
6. If Apply is attempted with zero registered projects, the picker must
   communicate that clearly (e.g. "Chưa có dự án nào — tạo dự án trước") and
   offer a way to start the existing Create Project flow, not fail silently
   or show an empty unexplained list.
7. Template content must round-trip: "Copy markdown" output and what
   "Apply" parses into a `CanonicalArtifact` must be the same source text
   (no drift between the two actions reading from different copies of the
   template).

## 5. Edge cases

- **Duplicate name on Apply**: target project already has an artifact with
  the same `name` as the template being applied (e.g. user already has a
  command named `code-review`). Must not silently overwrite the existing
  store entry — needs an explicit collision rule (rename-suffix? block with
  inline error? prompt to overwrite?). Not decided here — flagged for
  `/office-hours`/`architect`.
- **Project picker with many projects**: list should be searchable/scrollable
  once project count is non-trivial (no hard cap assumed yet; depends on how
  many projects real users register — note for architect, not a hard
  requirement here).
- **Malformed/unparseable bundled template** (e.g. a future bad edit to the
  vendored library): must not crash the whole Templates view — same
  "skipped with reason, never throws" discipline `parseClaudeDir` already
  uses for arbitrary `.claude/*.md` files (`docs/loops/
  load-existing-workflows-STATE.md` §1) should extend to template parsing.
- **Clipboard API unavailable/denied** (e.g. non-secure context, browser
  permission denial): "Copy markdown" must degrade to a visible error or a
  manual-select-all fallback, not fail silently with no feedback.
- **Daemon disconnected while Templates view is open**: Apply (which needs
  the daemon for `listProjects` + the store-write) must show the same
  daemon-down state the rest of the app already uses
  (`DaemonStatusBadge`/existing disabled-state conventions) rather than a
  new bespoke error path. "Copy markdown" alone should still work since it's
  pure client-side (no daemon round-trip needed if templates are bundled
  client-side; daemon-dependent if templates are server-fetched — depends on
  Open Question 2's answer).
- **License/attribution for ECC-sourced content**: if templates are literal
  copies/adaptations of github.com/affaan-m/ecc content, license
  compatibility and in-product attribution need to be confirmed before
  shipping — this is a real legal/product-risk item, not just a UI detail
  (see risk notes below).
- **"Skills" section when no Skills support exists yet** (if Open Question 1
  resolves toward "ship Agents+Commands now, defer Skills"): the section
  must show a clear "Coming soon" / empty state rather than a broken or
  missing section, so the 3-section UI promise in the request isn't half-
  silently dropped.

## 6. Open questions — taste/priority decisions only the user can make

1. **Is "Skills" Claude Code's actual Skills feature (`.claude/skills/
   <name>/SKILL.md`, folder-based, currently NOT modeled anywhere in
   Symbion's IR), or just a third loose label/category for markdown
   snippets shown read-only?**
   - If real Skills support is wanted: this is a `packages/core` IR change
     (new `ArtifactKind`, new adapter path, new parse/render support) that
     should probably be scoped as its own prerequisite feature before the
     Templates gallery can offer a real "Apply" for skills — not something
     to improvise inside this feature's build.
   - If it's fine to ship Skills as **browse + copy-markdown only** (no
     Apply-into-project, since there's no IR slot for it yet) while Agents/
     Commands get full Apply support, that's a much smaller v1 — but it
     means the three sections behave inconsistently (2 of 3 have Apply, 1
     doesn't), which needs to be an intentional, communicated UI decision
     not an accident.

2. **Should templates be vendored/bundled into Symbion at build/release
   time, or fetched live from GitHub (or another remote source) at
   runtime?**
   - Vendored: no network dependency, works fully offline (consistent with
     Symbion's local-first design ethos), but requires a manual process to
     curate/update the bundle from ECC (or wherever) and copy/adapt content
     into the repo — and that adaptation/copying is exactly where license
     question below matters most.
   - Live-fetch: always up to date with upstream, but introduces the first-
     ever outbound fetch-arbitrary-content network dependency in a tool
     that's otherwise fully local/offline-capable, plus new failure modes
     (rate limits, repo renamed/deleted, GitHub API auth/quota), plus a new
     external trust boundary (fetching and rendering markdown from a
     third-party repo).
   - This decision changes the engineering shape significantly (architect
     needs this answered before designing).

3. **License and attribution for content sourced from `affaan-m/ecc`** —
   what license is that repo under, is adapting/bundling its content into
   Symbion compatible with it, and what attribution (if any) needs to show
   in the UI (e.g. "Based on ECC by affaan-m")? This is not an engineering
   decision — needs to be confirmed by the user/product owner before any
   ECC-derived content ships in Symbion, vendored or fetched.

4. **What exactly counts as a template's identity for collision handling?**
   On Apply, if the target project already has an artifact with the same
   `name`, should Symbion: (a) block with an inline error and let the user
   rename first, (b) auto-suffix the name (e.g. `code-review-2`), or (c)
   prompt an explicit "overwrite the draft?" choice? This is a UX taste call
   that affects the "definition of done" for Apply's acceptance criteria.

5. **Codex/`AGENTS.md` format for templates** — should Apply also offer
   writing into the Codex target (`AGENTS.md`) for template-derived
   artifacts, or is this feature Claude-provider-only for v1 (matching that
   "Skills" doesn't exist for Codex at all, and Codex's `AGENTS.md` is a
   single merged file with different semantics than per-file agents/
   commands)? CLAUDE.md says core IR is vendor-agnostic, but the request
   text doesn't mention Codex at all — needs explicit confirmation rather
   than assuming yes or no.

6. **Where does "Templates" sit relative to project context?** Is it a
   fully global view (no project needs to be selected/active to browse it,
   matching the request's "click the navbar tab" framing — Apply is the
   only point a project gets chosen), or should it instead live *inside* an
   already-open project's view (browse + apply directly into the
   currently-active project, no separate picker step)? The request's
   wording ("nút áp dụng sẽ hiện list các project") implies the former
   (global tab + in-modal picker) — flagging to confirm since it changes
   the route/IA, not just a detail.

## 7. Acceptance criteria (measurable)

- AC1: Navbar has a third tab labeled "Templates"; clicking it renders a
  view with exactly three labeled sections (Skills, Agents, Commands), each
  listing at least one item, with no console errors and no broken/blank
  section.
- AC2: Clicking any listed item opens a modal whose body text is byte-
  identical to that template's source markdown file (frontmatter + body,
  unmodified) — verifiable by diffing the modal's rendered text against the
  bundled/fetched source.
- AC3: Clicking "Copy markdown" in the modal results in the OS clipboard
  containing exactly that same byte-identical markdown text (verifiable via
  a clipboard-read test or manual paste-and-diff), and the UI shows a
  success acknowledgment (e.g. "Copied" state) within 1 interaction (no
  silent no-op).
- AC4: Clicking "Áp dụng" shows every project currently in
  `useArtifactStore`'s project list (same set the sidebar shows) — zero
  projects shown for a project that exists, or projects shown for a project
  that doesn't, is a failing case.
- AC5: Confirming Apply with project X selected results in: (a) a new
  artifact appearing in project X's artifact list, with `kind`/`name`/
  `description`/`body` matching the template's parsed content, `meta.status
  === "draft"`; (b) zero bytes written to project X's real repo path on
  disk at this step (verifiable: no file under `<projectPath>/.claude/`
  changes until a subsequent, separate Publish action is taken).
- AC6: Attempting Apply when zero projects are registered shows an explicit
  "no projects" state with a path to Create Project, never an empty
  unexplained list or a crash.
- AC7: A template whose markdown fails to parse (malformed frontmatter) is
  excluded from the applyable flow with a visible reason, and does not
  prevent the rest of that section's templates from listing/working
  (matches existing `parseClaudeDir`'s "skip, don't throw" discipline).
- AC8: No new direct filesystem write path is introduced outside the
  existing daemon RPC + publish pipeline — i.e. `packages/core` stays pure,
  and any new daemon RPC added for this feature follows the same
  auth/origin/path-confinement rules as every existing write RPC (per
  CLAUDE.md "Filesystem safety" + "Localhost RPC hardening").

## 8. Product risk notes (for architect/dev to keep in mind)

- **License/attribution risk**: shipping content derived from a third-party
  GitHub repo without confirming its license is a real legal exposure for
  the product, not just a nice-to-have — block on Open Question 3 before
  any ECC content is vendored or rendered in-app.
- **Silent overwrite risk on Apply**: if the duplicate-name collision case
  (Open Question 4) isn't explicitly decided and enforced, Apply could
  silently clobber a user's existing hand-edited draft artifact in the
  store — this is exactly the class of "silent write" CLAUDE.md's
  filesystem-safety section warns against, even though Apply targets the
  store (not the repo directly); the existing publish pipeline's conflict
  detection only protects the *repo* file, not the *store* entry, so this
  gap is real and new.
- **Provider-format fidelity risk**: if "Skills" templates get treated as
  generic markdown shoved into the existing Agent/Command `body` field
  without modeling Claude Code's actual Skills file/folder structure, any
  future Apply-to-disk for Skills would produce a file that doesn't match
  what Claude Code actually expects — better to explicitly scope Skills as
  read-only/copy-only (per Open Question 1) than to ship a broken "Apply"
  that silently mis-renders the provider format.
- **Network/trust-boundary risk** (only if Open Question 2 resolves toward
  live-fetch): rendering remote markdown inside a modal and parsing it
  through the same `CanonicalArtifact` pipeline as trusted local content
  introduces a new external input surface to a tool whose daemon currently
  only talks to localhost + explicitly user-configured LLM endpoints —
  needs a security-reviewer (`/cso`) pass specifically on this surface if
  chosen.
- **Scope-creep risk**: "browse a fixed curated template library" is a
  small, well-bounded feature; the request's framing ("templates có sẵn...
  đã được built sẵn trước đó") supports a small fixed v1 — resist expanding
  into search/filter/versioning/community-submission without an explicit
  follow-up ask.

## Phase: THINK (auto-decided — full autopilot run, no pauses selected)

Per CLAUDE.md defaults + smallest-safe-scope principle, the 6 open questions
are locked as follows for v1:

1. **Skills scope → browse + copy-markdown ONLY, no Apply.** `ArtifactKind`
   stays `"agent" | "command"` — no `packages/core` IR change in this
   feature. The Skills section lists items and opens the read-only markdown
   modal with "Copy markdown" working exactly like Agents/Commands, but the
   "Áp dụng" button is disabled/hidden for Skills items with an inline note
   ("Skills chưa hỗ trợ Apply — coming soon"). This avoids inventing a new
   IR kind/adapter as a side effect of a UI feature.

2. **Sourcing → vendored at build time, NOT live-fetched.** A small fixed
   set of template `.md` files ships inside the Symbion repo (e.g.
   `apps/web/src/data/templates/{agents,commands,skills}/*.md` or similar,
   architect to place). No new daemon RPC for fetching remote content, no
   new network/trust boundary, works fully offline — consistent with
   CLAUDE.md's local-first philosophy. Templates load same as any static
   bundled asset.

3. **License/attribution → do not copy ECC's file contents verbatim.**
   Write a small set of ORIGINAL example templates whose categories/intent
   are inspired by what a repo like affaan-m/ecc demonstrates (e.g. a
   code-review agent, a test-writer command, a commit-message skill) but
   authored fresh for Symbion, zero copy-pasted text. Add a one-line,
   non-legally-binding credit in the Templates view footer: "Lấy cảm hứng từ
   các bộ template cộng đồng (vd. ECC)" with a link to
   https://github.com/affaan-m/ecc. This sidesteps the license-compatibility
   risk entirely since no third-party content is redistributed.

4. **Collision on Apply → auto-suffix.** If project X already has an
   artifact named `name`, the applied copy is stored as `name-2` (then `-3`,
   etc., first free suffix) — never silently overwrites an existing store
   entry, never blocks the user with an extra confirmation dialog. Matches
   CLAUDE.md's "never write silently" principle extended to the store layer.

5. **Codex/AGENTS.md → out of scope for v1.** Apply only stages into the
   project's `CanonicalArtifact` store (provider-agnostic IR) — which one or
   more publish targets it eventually renders to (Claude and/or Codex) is
   governed by that project's EXISTING provider settings, unchanged by this
   feature. No new Codex-specific UI/copy.

6. **IA placement → global nav tab; project picker lives inside the Apply
   modal.** Matches the request's literal wording ("nút áp dụng sẽ hiện list
   các project"). New route `/templates`, no active/selected project
   required to browse.

These are now locked. Proceeding to `/design` then `/plan`.

## Phase: PLAN (architect)

> Reads against THINK (locked, §ABOVE) and `templates-marketplace-design.md`.
> Code read to ground every decision below: `apps/daemon/src/rpc/{handlers,contract,guard,server}.ts`,
> `packages/rpc-types/src/index.ts`, `packages/core/src/ir/{types,validate}.ts`,
> `apps/web/src/lib/{rpc/client.ts,store/useArtifactStore.ts}`,
> `apps/web/src/components/{AppNav,AppShell,SettingsShell,CreateProjectDialog,
> CopyRunCommandDialog,MarkdownTab,ImportReviewStep,EmptyState}.tsx`.

### 0. Resolutions to the architect's open items (decided here, with evidence)

**(a) Where do bundled templates live → `apps/web` static data, zero daemon involvement.**
Confirmed: `apps/web/src/lib/rpc/client.ts` is the *only* path to the daemon and
every call requires a session token except `ping`. Bundling templates as
plain TS/markdown modules under `apps/web/src/data/templates/` means "Copy
markdown" (T2) and the whole T1 list render with **zero RPC calls**, which is
the only way to satisfy "Copy markdown must work with zero daemon
involvement" (THINK #2, edge case in §5). A daemon-served-static-file design
was considered and rejected: it would make the list/preview/copy path depend
on `getDaemonOrigin()`/token bootstrap for a feature that has no fs/git
reason to touch the daemon at all — pure unnecessary coupling.

**(b) Apply mechanism → reuse `importArtifacts`'s *shape* but add a thin new
RPC `applyTemplate`, NOT a literal call to `importArtifacts` as-is.**
Read `apps/daemon/src/rpc/handlers.ts:301-334` and
`packages/core/src/ir/validate.ts:65-82`: `importArtifacts` validates the
merged artifact set via `validateAllArtifacts`, which flags `name-duplicate`
(same `kind` + same `name`) as a **blocking error** — it does not
auto-suffix, it *rejects* the whole import. THINK #4 locks "auto-suffix,
never block" for Apply, which `importArtifacts` cannot do unmodified. Two
options: (1) compute the free name client-side before calling
`importArtifacts`, or (2) a dedicated RPC that resolves the suffix
server-side. **Decision: (2), new RPC `applyTemplate`.** Reasons:
  - **TOCTOU**: client-side suffix computation reads `currentProject.artifacts`
    from a `zustand` store snapshot that can be stale (another browser tab,
    or a stale `currentProject` since `/templates` doesn't load the target
    project at all — it only has `listProjects`' `{id,name,path}[]`, not that
    project's `artifacts[]`). The daemon is the only place with a fresh read
    of `store.json` immediately before write, so it must own the collision
    check, mirroring why `saveArtifact`/`importArtifacts` already
    re-validate server-side "defense in depth — never trust the client"
    (handlers.ts:247-251 comment).
  - `importArtifacts` is intentionally generic ("apply N pre-scanned
    artifacts, client decides selection/ids"); overloading it with
    auto-suffix-on-conflict semantics would change behavior for its existing
    caller (`ImportDialog`'s "load existing workflows" flow), which is NOT
    supposed to silently rename on conflict (that flow's collisions are
    surfaced via the existing `validation-failed` block, by design — changing
    that would be unrelated scope creep / regression risk for an unrelated
    feature).
  - A new RPC keeps `packages/core` and `importArtifacts` completely
    untouched (CLAUDE.md "purely additive... not a change to publish safety
    guarantees" — extended here to "not a change to existing RPC semantics
    either").

**(c) Auto-suffix collision logic → resolved server-side, inside the new
`applyTemplate` handler, against a fresh `loadProjectStore(path)` read.**
Algorithm in §3 below. Never client-side-only (TOCTOU, see (b)).

**(d) `ArtifactMeta.sourceTemplateId` → populate it now; it was vestigial,
this feature is its first real producer.** Confirmed via
`grep -rn "sourceTemplateId"` across the repo: the only occurrence is the
field declaration itself (`packages/core/src/ir/types.ts:26`) — zero read
sites, zero other write sites. It is exactly the right field for
provenance (matches its doc comment) and was clearly added in anticipation
of a feature like this one. `applyTemplate` sets
`meta.sourceTemplateId = template.id` (the bundled template's stable slug,
e.g. `"agent:code-reviewer"`) on the new artifact. No `packages/core` change
needed — the field already exists and is optional, so older artifacts
without it remain valid. This is a one-line addition to "what `applyTemplate`
sets when constructing the new `CanonicalArtifact`," not an IR change.

---

### 1. Package / app boundaries

**`packages/core` — no changes.** `ArtifactKind` stays `"agent" | "command"`
(THINK #1). No new types needed; `CanonicalArtifact`/`ArtifactMeta` already
have every field `applyTemplate` needs (`sourceTemplateId` already present).
Templates are NOT parsed through `packages/core`'s `parseClaudeDir`/marker
machinery (that pipeline parses a directory of *managed, marker-bearing*
files from a real repo — templates are unmanaged, marker-free seed content).
Templates use a much smaller, purpose-built frontmatter parser (new, tiny,
pure function — see below) since their shape is simpler (one file = one
artifact, no managed-marker/hash to extract).

New pure helper — **`packages/core/src/templates/parseTemplate.ts`** (new
file, pure, no Node imports — stays inside `packages/core` because "parse
markdown-with-frontmatter into a partial `CanonicalArtifact`" is exactly the
kind of logic CLAUDE.md says belongs in core, and both the web bundle loader
*and* the daemon's `applyTemplate` handler need the identical parse — single
source of truth, not copy-pasted twice):

```ts
// packages/core/src/templates/parseTemplate.ts
export interface ParsedTemplateContent {
  kind: "agent" | "command" | "skill";
  name: string;
  description: string;
  tools?: string[];
  body: string;
}

export interface ParseTemplateResult {
  ok: true;
  parsed: ParsedTemplateContent;
} | {
  ok: false;
  reason: string; // e.g. "frontmatter thiếu 'name'", "YAML không hợp lệ"
}

/** Parses ONE bundled template file's raw text (frontmatter + body).
 *  Pure, throws never — same "skip with reason" discipline as parseClaudeDir.
 *  `expectedKind` comes from the template's manifest folder (skills/agents/commands),
 *  not re-derived from content, so a misplaced file fails loudly via mismatch reason
 *  rather than silently filing under the wrong section. */
export function parseTemplateMarkdown(
  raw: string,
  expectedKind: "agent" | "command" | "skill"
): ParseTemplateResult;
```

This reuses the *existing* frontmatter-splitting primitive already inside
`packages/core`'s parser (`parse/scan.ts` — check for an extractable
`splitFrontmatter`/YAML-parse helper before writing a new one; if scan.ts's
frontmatter split is already a separate internal function, `parseTemplate.ts`
imports and reuses it rather than duplicating a YAML-ish parser). No new
external YAML dependency — match whatever lightweight frontmatter parsing
`parse/scan.ts` already does.

**`apps/web` — new files:**
- `apps/web/src/app/templates/page.tsx` — route entry, mirrors
  `apps/web/src/app/settings/page.tsx`'s one-line shell pattern.
- `apps/web/src/components/TemplatesView.tsx` — route content (mirrors
  `SettingsShell.tsx`: session bootstrap from `?t=`/port, `startHeartbeat()`,
  renders `AppNav` + content). Also reads `?openProject=`/`?createProject=`
  handoff params on mount (see §2 cross-route handoff) — but `/templates`
  itself doesn't need to *consume* those (it's the *source* of "Mở dự án",
  not the target); only `AppShell.tsx` needs to read them, since `/` is the
  target route. `TemplatesView` only needs to *write* the param when
  navigating away.
- `apps/web/src/components/TemplateSection.tsx`
- `apps/web/src/components/TemplateCard.tsx`
- `apps/web/src/components/TemplatePreviewModal.tsx` (the `preview → apply →
  result` step machine, `Step` type literally modeled like
  `CreateProjectDialog.tsx`'s `type Step = "form" | "detected" | "scanning" |
  "review"` precedent → `type Step = "preview" | "apply" | "result"`)
- `apps/web/src/components/TemplateMarkdownViewer.tsx` (read-only CodeMirror;
  confirm `MarkdownTab.tsx`'s CodeMirror setup exposes an `editable`/`readOnly`
  prop path the dev can flip — if `MarkdownTab` hardcodes editable, this is a
  thin new wrapper around the same `@codemirror/lang-markdown` extension
  list with `EditorView.editable.of(false)` + `EditorState.readOnly.of(true)`,
  not a new editor dependency)
- `apps/web/src/components/ProjectPickerStep.tsx` (presentational, reused by
  apply-step + zero-projects state, props exactly as the design doc specifies)
- `apps/web/src/components/ApplyResultPanel.tsx`
- `apps/web/src/data/templates/manifest.ts` — the static bundle entry point:
  ```ts
  export interface TemplateListItem {
    id: string;           // stable slug, e.g. "agent:code-reviewer" — used as sourceTemplateId
    kind: "agent" | "command" | "skill";
    name: string;          // becomes CanonicalArtifact.name on Apply
    description: string;   // one-line, shown on card + becomes CanonicalArtifact.description
    raw: string;            // exact bytes of the .md file, frontmatter+body — what Copy markdown copies verbatim
  }
  export interface TemplateManifest {
    items: TemplateListItem[];
    skipped: Array<{ relPath: string; reason: string }>; // populated at build/import time, not at runtime
  }
  export function loadTemplateManifest(): TemplateManifest;
  ```
  Loader behavior: synchronous, build-time `import.meta.glob`-equivalent or
  explicit static imports of every `.md` file under
  `apps/web/src/data/templates/{agents,commands,skills}/*.md` (Next.js
  webpack can `?raw`-import markdown as a string, or content is pasted as
  template-literal `.ts` files directly to avoid any custom webpack loader
  config — **decision: plain `.ts` files exporting a `raw` string constant
  per template**, not literal `.md` files + a raw-loader, to avoid adding a
  new build-tool dependency for an 8-12-file v1 bundle). Each `.ts` template
  module is parsed once via `parseTemplateMarkdown` at manifest-build time
  (still client-side, still synchronous, still zero network/daemon); a
  malformed one goes into `skipped`, not `items` — satisfies AC7 without
  ever throwing.
- `apps/web/src/data/templates/agents/code-reviewer.ts`,
  `apps/web/src/data/templates/commands/test-writer.ts`,
  `apps/web/src/data/templates/skills/commit-message.ts`, etc. — the actual
  ~8-12 ORIGINAL example template files (THINK #3: zero ECC text copied).
  Content authoring is a `dev`/content task, not architecture — flagged here
  only so the file count/location is unambiguous for the builder.

**`apps/web` — modified files:**
- `apps/web/src/components/AppNav.tsx` — add third `<Link href="/templates">`
  using the existing `linkClass` helper, no structural change.
- `apps/web/src/lib/store/useArtifactStore.ts` — add one new action
  `applyTemplate(params: ApplyTemplateParams): Promise<ApplyTemplateResult>`
  that calls the new RPC and does NOT mutate `currentProject` (Apply targets
  an arbitrary project, not necessarily the currently-loaded one — unlike
  `importArtifacts`'s existing stale-`currentProject` fix, `applyTemplate`
  has no "current project" assumption to begin with, since `/templates` has
  no project context per THINK #6).
- `apps/web/src/lib/rpc/types.ts` (or wherever `ImportArtifactsParams` etc.
  are re-exported web-side from `@symbion/rpc-types`) — add
  `ApplyTemplateParams`/`ApplyTemplateResult` re-exports.
- `apps/web/src/components/AppShell.tsx` — read `?openProject=<id>` /
  `?createProject=1` once on mount (see §2), call `loadProject(id)` /
  `setCreateOpen(true)` respectively, then strip the param from the URL via
  `window.history.replaceState` (so a refresh doesn't re-trigger it).

**`apps/daemon` — new RPC handler + modified files:**
- `apps/daemon/src/rpc/handlers.ts` — add `applyTemplate(params)` handler
  (full signature in §2).
- `apps/daemon/src/rpc/contract.ts` — re-export `ApplyTemplateParams`/
  `ApplyTemplateResult` from `@symbion/rpc-types` (same pattern as every
  other method).
- `packages/rpc-types/src/index.ts` — add `ApplyTemplateParams`,
  `ApplyTemplateResult`, and `"applyTemplate"` to the `RpcMethod` union.
- `apps/daemon/src/server.ts` — `applyTemplate` is **deliberately NOT** added
  to `READ_ONLY_METHODS` (it mutates `store.json`, same category as
  `saveArtifact`/`importArtifacts`) — still requires the session token like
  every non-ping/non-read-only method (no change to the auth gate itself).

No changes to `apps/daemon/src/rpc/guard.ts` (path confinement) —
`applyTemplate` writes through the existing `saveProjectStore(path, store)`
helper, which already goes through whatever confinement
`store/store.ts` enforces for `path` (same as `saveArtifact`/
`importArtifacts` — no new disk-path surface, since `path` always comes from
`findProjectPath(projectId)`, never from raw client input).

---

### 2. The daemon RPC surface

**New RPC: `applyTemplate`.**

```ts
// packages/rpc-types/src/index.ts

export interface ApplyTemplateParams {
  projectId: string;
  /** the parsed template content — sent from web, NOT re-fetched server-side,
   *  since templates live in the web bundle, not on the daemon's filesystem.
   *  Server-side re-validates shape (kind/name/description non-empty) as
   *  defense-in-depth but trusts the content bytes (no remote/foreign-input
   *  trust boundary here — it's the same web app's own bundled, build-time,
   *  reviewed content, not arbitrary user input). */
  template: {
    sourceTemplateId: string;   // e.g. "agent:code-reviewer" -> ArtifactMeta.sourceTemplateId
    kind: "agent" | "command";  // Skills never reach this RPC (Apply disabled client-side per THINK #1) — also re-checked server-side, see edge cases
    name: string;
    description: string;
    tools?: string[];
    body: string;
  };
}

export interface ApplyTemplateResult {
  project: ProjectStore;        // the full merged store, same convention as importArtifacts/saveArtifact
  appliedArtifactId: string;    // new artifact's id, so the UI can highlight/locate it
  finalName: string;            // name actually used after auto-suffix (== template.name if no collision)
  wasRenamed: boolean;          // finalName !== template.name
}
```

```ts
// apps/daemon/src/rpc/handlers.ts

applyTemplate(params: contract.ApplyTemplateParams): contract.ApplyTemplateResult {
  const { projectId, template } = params;

  // Defense-in-depth shape re-validation (server never trusts client-sent content,
  // same posture as saveArtifact/importArtifacts).
  if (template.kind !== "agent" && template.kind !== "command") {
    throw new RpcError("invalid-kind", "Chỉ Agent/Command hỗ trợ Áp dụng.");
  }
  if (!template.name?.trim() || !template.description?.trim()) {
    throw new RpcError("invalid-template", "Template thiếu name hoặc description.");
  }

  const path = findProjectPath(projectId);
  const store = loadProjectStore(path); // fresh read — closes the TOCTOU gap client-side calc would have

  // Auto-suffix algorithm (THINK #4): first free "<name>", "<name>-2", "<name>-3", ...
  // scoped to (kind, name) pairs, matching validate.ts's own duplicate rule (line 65-82:
  // dup = same kind + same name) so the suffix algorithm and the lint rule it's
  // dodging stay in lockstep by construction.
  const existingNames = new Set(
    store.artifacts.filter((a) => a.kind === template.kind).map((a) => a.name)
  );
  let finalName = template.name;
  let n = 2;
  while (existingNames.has(finalName)) {
    finalName = `${template.name}-${n}`;
    n++;
  }
  const wasRenamed = finalName !== template.name;

  const now = new Date().toISOString();
  const artifact: CanonicalArtifact = {
    id: randomId(),
    kind: template.kind,
    name: finalName,
    description: template.description,
    tools: template.tools,
    body: template.body,
    meta: {
      version: "draft",
      status: "draft",
      createdAt: now,
      updatedAt: now,
      sourceTemplateId: template.sourceTemplateId,
    },
  };

  // Defense-in-depth: re-validate the FULL resulting set, same posture as
  // importArtifacts/saveArtifact. Should never actually fail given the
  // auto-suffix loop above already guarantees no name collision, but keeps
  // the same "never trust, always re-check before persist" invariant as
  // every other write path (a real safety net if e.g. FILENAME_SAFE_RE
  // rejects a name the bundle author typo'd with a space/slash).
  const merged = [...store.artifacts, artifact];
  const issues = validateAllArtifacts(merged);
  const blocking = issues.filter((i) => i.level === "error" && i.artifactId === artifact.id);
  if (blocking.length > 0) {
    throw new RpcError("validation-failed", `Không thể áp dụng — vi phạm lint: ${blocking.map(i => i.message).join("; ")}`);
  }

  store.artifacts.push(artifact);
  saveProjectStore(path, store);

  return { project: store, appliedArtifactId: artifact.id, finalName, wasRenamed };
}
```

Note: the auto-suffix loop's bound is implicitly `store.artifacts.length + 1`
iterations worst case — fine at realistic store sizes (tens of artifacts),
no pathological-loop risk worth guarding further.

**Reused RPCs (no changes):** `listProjects` (T3 picker), `createProject`
(T5 "Tạo dự án trước" handoff lands on `/` and reuses the existing
`CreateProjectDialog` → `createProject` RPC, unchanged).

---

### 3. Data flow

**Browse + Copy markdown (T1, T2 happy-path-A) — no daemon at all:**

```
apps/web/src/data/templates/manifest.ts (static import, build-time bundled)
  → loadTemplateManifest() runs client-side on TemplatesView mount
    (parseTemplateMarkdown from packages/core, pure, sync)
  → TemplateManifest { items, skipped } held in component state
  → TemplateSection × 3 renders items, malformed ones surfaced via `skipped`
  → user clicks card → TemplatePreviewModal opens with that TemplateListItem
  → TemplateMarkdownViewer renders `item.raw` verbatim (CodeMirror read-only)
  → "Copy markdown" → navigator.clipboard.writeText(item.raw) (the SAME
     `raw` string the viewer rendered — single source, satisfies AC2+AC7
     "no drift between Copy and Apply" requirement)
```

No RPC call anywhere in this path. Daemon-down has zero effect on it
(confirmed: `getDaemonOrigin()`/`callRpc` is never invoked).

**Apply (T3 → T4, happy-path-B) — the only path that touches the daemon:**

```
TemplatePreviewModal step="apply"
  → ProjectPickerStep reads `useArtifactStore.projects` (already loaded at
     app boot by AppShell's loadProjects() — NOT re-fetched by /templates;
     if user navigates directly to /templates without visiting `/` first,
     TemplatesView itself calls loadProjects() on mount, same as AppShell
     does, so the picker is never empty due to a missed load)
  → user selects projectId, clicks "Xác nhận áp dụng"
  → useArtifactStore.applyTemplate({ projectId, template: { sourceTemplateId,
     kind, name, description, tools, body } })  [kind narrowed to "agent"|
     "command" — Skills items never reach this call, button is disabled
     client-side AND kind is server-validated as defense-in-depth]
  → callRpc("applyTemplate", params) → POST /rpc (token-authed, daemon-only)
  → apps/daemon/src/rpc/handlers.ts: applyTemplate()
      → findProjectPath(projectId)        [existing helper, same path-resolution
                                             every other project RPC uses]
      → loadProjectStore(path)             [fresh disk read — store/store.ts]
      → auto-suffix loop against store.artifacts (kind+name scoped)
      → validateAllArtifacts(merged)        [defense-in-depth, packages/core, pure]
      → store.artifacts.push(artifact); saveProjectStore(path, store)
                                            [WRITES ONLY .symbion/store.json —
                                             never apps' .claude/* files; no
                                             renderArtifacts/writeFiles call
                                             anywhere in this handler]
  → ApplyTemplateResult { project, appliedArtifactId, finalName, wasRenamed }
  → TemplatePreviewModal step="result", ApplyResultPanel shows finalName/wasRenamed
  → user clicks "Mở dự án" → router.push(`/?openProject=${projectId}`)
  → AppShell mount effect (NEW): reads `?openProject=`, calls loadProject(id),
     then `window.history.replaceState(null, "", "/")` to strip the param
  → user is now in the Builder, sees the new draft artifact in that
     project's artifact list — render→diff→write (the EXISTING publish
     pipeline: render() → computeDiff() → user confirms → writeFiles()) is
     the ONLY subsequent path that ever touches the real `.claude/` files,
     completely unmodified by this feature.
```

**Cross-route handoff mechanism (design's Open Question 4 — resolved):**
Query param, but disambiguated from the existing `?t=<token>` session param
by using distinct param names (`openProject`, `createProject`) that coexist
on the same URL (`/?t=abc123&openProject=proj-1`) — Next.js
`URLSearchParams` reads both independently, no collision. `AppShell.tsx`'s
existing bootstrap effect (which already reads `?t=`) is extended to also
read `?openProject=`/`?createProject=` in the same effect, then
`history.replaceState` strips ONLY those two keys (keeps `?t=` if the page
was loaded with it — though in practice by the time the user clicks "Mở dự
án" they're already inside the running SPA, so this is a same-tab
`router.push`, not a fresh page load; `?t=` token is already cached in
`apps/web/src/lib/rpc/client.ts`'s in-memory `cachedToken`, so it does not
strictly need to survive in the URL at all for this in-SPA navigation —
included in the replaceState reasoning only for the cold-load edge case of
a user bookmarking/sharing the URL, which is out of scope to fully support
but shouldn't actively break).

---

### 4. Edge cases — concretely mapped to code

| Edge case (STATE §5) | Concrete handling |
|---|---|
| Malformed bundled template | `parseTemplateMarkdown` returns `{ok:false,reason}`; `loadTemplateManifest()` puts it in `skipped[]`, never throws; `TemplateSection` renders the warning line (§3.3 wireframe), other items in that section render normally. Covered by AC7. |
| Clipboard API unavailable/denied | `TemplateMarkdownViewer`/`TemplatePreviewModal`: `navigator.clipboard.writeText` wrapped in try/catch; on reject, `clipboardBlocked=true`, viewer auto-selects its content (`window.getSelection()` on the CodeMirror DOM node or a hidden `<code className="select-all">` fallback mirroring `CopyRunCommandDialog`'s exact pattern), no daemon involvement either way. |
| Daemon disconnected while Templates view open | `useArtifactStore.daemonConnected` (existing heartbeat flag, started by `TemplatesView`'s `startHeartbeat()` same as `SettingsShell`) gates ONLY the apply step's "Xác nhận áp dụng" button (`disabled={!daemonConnected}`) — list/preview/copy unaffected (no RPC calls in that path at all, so there is nothing to disable). |
| Zero registered projects at Apply | `ProjectPickerStep` renders the T5 empty state when `projects.length === 0` — "Tạo dự án trước" → `router.push("/?createProject=1")`; `AppShell` opens `CreateProjectDialog` on mount per the param. Covered by AC6. |
| Duplicate name on Apply | Server-side auto-suffix loop in `applyTemplate` handler (§2), scoped to `(kind, name)` pairs — matches `validate.ts`'s own dup rule exactly so they can never disagree. `wasRenamed`/`finalName` surfaced in `ApplyResultPanel`. Never blocks, never silently overwrites. |
| Re-apply the same template twice (idempotency-shaped case, not in STATE but a natural extension of duplicate-name) | Second Apply of the same template to the same project hits the same auto-suffix path — `name-2`, then `name-3` on a third, etc. There is no "this template was already applied" detection (`sourceTemplateId` is provenance metadata only, not a uniqueness constraint) — intentional: a user may legitimately want two independent drafts derived from the same template (e.g. to edit one two different ways). Document this as a conscious choice, not an oversight, for the Checker. |
| Skills item — Apply attempted anyway (e.g. a future regression re-enables the button, or a malformed manifest mislabels kind) | Client-side: button `disabled` for `kind === "skill"`. Server-side: `applyTemplate` handler rejects any `template.kind` that isn't `"agent"`/`"command"` with `RpcError("invalid-kind", ...)` — defense-in-depth, satisfies AC8's "every write RPC follows the same hardening rules," since a client bug must not be the only thing preventing a skill from being mis-staged as a fake agent/command. |
| Apply RPC succeeds but `loadProject`-equivalent refresh fails on "Mở dự án" navigation | Not a new failure class — `loadProject(id)` already has existing error handling in `useArtifactStore` (same as every other `loadProject` call site, e.g. `ProjectSidebar`'s click handler); no bespoke handling needed here. |
| Partial-publish-failure / re-publish-unchanged | N/A to this feature — `applyTemplate` never calls `render`/`computeDiff`/`writeFiles`; those existing edge cases are entirely owned by the unmodified publish pipeline once the user reaches Builder. |
| Hand-edited managed file conflict / foreign file | N/A — `applyTemplate` never touches `.claude/*` or any repo file; the managed-marker/conflict machinery is untouched and irrelevant to this RPC. |

---

### 5. Trade-offs and assumptions for dev / Checker to track

1. **New RPC vs. reusing `importArtifacts`**: deliberately chose a new
   `applyTemplate` RPC over extending `importArtifacts` with an
   `autoSuffix?: boolean` flag. Reasoning: `importArtifacts`'s contract
   (`scanned: CanonicalArtifact[]`, full client-constructed artifacts
   including `id`) is shaped for "user already reviewed N parsed files and
   picked which to import" (`ImportDialog`'s flow) — overloading it with a
   single-artifact-plus-suffix-logic path adds a second, divergent code path
   inside one handler. A small dedicated handler is more legible and
   strictly additive (zero risk of regressing the existing Import-from-disk
   feature). If the Checker disagrees and prefers handler consolidation,
   that is a legitimate alternative — flagging the decision explicitly
   rather than presenting it as the only option.
2. **`template.body`/`tools` are sent over RPC, not re-derived from a
   `sourceTemplateId` lookup on the daemon side.** The daemon has no access
   to `apps/web`'s bundled template data (it lives in the web bundle, not on
   the daemon's filesystem) — so the full parsed content necessarily
   travels in the RPC params. This is safe because the content is the web
   app's own build-time-bundled, code-reviewed content, not arbitrary
   external/user input (no new trust boundary, unlike if templates were
   live-fetched per THINK #2's rejected alternative) — still, server-side
   shape validation (kind/name/description non-empty) is kept as
   defense-in-depth per CLAUDE.md "never trust the client" convention used
   everywhere else in `handlers.ts`.
3. **`parseTemplateMarkdown` lives in `packages/core`, not `apps/web`**,
   even though only `apps/web` calls it at runtime today (the daemon never
   parses template files — it receives already-parsed fields over RPC).
   Justification: keeping the parser pure and centrally testable (Vitest,
   no DOM/Node needed) outweighs the minor indirection of "a function only
   one app currently calls" — and it is the natural place if a future
   `/sync-templates` maintenance script (mentioned as future work in STATE
   §3 out-of-scope) ever needs the same parser daemon/Node-side.
4. **No new `ArtifactKind`, confirmed unchanged.** `template.kind` in the
   RPC params is typed `"agent" | "command"` (not `ArtifactKind` reused
   loosely) specifically so a `"skill"` value is a TypeScript compile error
   at the call site in `TemplatePreviewModal`, not just a runtime guard —
   an extra static safety net on top of the server-side runtime check.
5. **Skill items still get a `kind: "skill"` discriminant in
   `TemplateListItem`/manifest data** (three-valued), separate from the
   IR's two-valued `ArtifactKind` — these are deliberately different types
   (`packages/core`'s `ArtifactKind` is unchanged; the template manifest's
   `kind` is a `apps/web`/bundle-local concept). Do not conflate them or
   "helpfully" merge into one type — they represent different things (one
   is the persisted IR's artifact kind, the other is the template gallery's
   display/eligibility category).
6. **Manifest content authoring (THINK #3 — 8-12 original templates) is a
   content task, not an engineering task** — assumed `dev`/`feature-builder`
   either writes these directly or a separate `ba`/content pass produces
   them; this PLAN only fixes the file shape/location, not the prose.
7. **Footer attribution text + the `target="_blank"` ECC link are presentation
   details already specified in the design doc** — no further architecture
   decision needed, included for completeness in the file list only.

## Phase: BUILD (feature-builder — maker)

Implemented exactly per PLAN, no architecture deviation. `npm run build`
(core + rpc-types + daemon + web) and the full `npx vitest run` workspace
suite (331 tests) pass. Maker did NOT self-review — Checker (`code-reviewer`
+ `architect`) reviews next.

### Files changed/added

**`packages/core` (pure, no Node imports):**
- NEW `packages/core/src/templates/parseTemplate.ts` — `parseTemplateMarkdown`
  pure function + `TemplateKind`/`ParsedTemplateContent`/`ParseTemplateResult`
  types, exactly per PLAN §1's signature. Reuses the existing
  `parseFrontmatter` primitive from `render/frontmatter.ts` (no second
  YAML-ish parser). Never throws — returns `{ok:false, reason}` for missing
  frontmatter fences, missing `name`/`description`, malformed YAML, or empty
  body.
- NEW `packages/core/test/parseTemplate.test.ts` — 10 unit tests covering
  testplan U1-U8 (+2 extra: missing-fences, empty-body) — all passing.
- MODIFIED `packages/core/src/index.ts` — barrel export
  `export * from "./templates/parseTemplate.js"`.

**`packages/rpc-types` (type-only contract):**
- MODIFIED `packages/rpc-types/src/index.ts` — added `ApplyTemplateParams`
  (`projectId` + `template: {sourceTemplateId, kind:"agent"|"command", name,
  description, tools?, body}`) and `ApplyTemplateResult`
  (`{project, appliedArtifactId, finalName, wasRenamed}`), exactly per PLAN
  §2. Added `"applyTemplate"` to the `RpcMethod` union.

**`apps/daemon` (the only process that touches disk):**
- MODIFIED `apps/daemon/src/rpc/contract.ts` — re-exports
  `ApplyTemplateParams`/`ApplyTemplateResult`.
- MODIFIED `apps/daemon/src/rpc/handlers.ts` — new `applyTemplate` handler,
  implemented verbatim per PLAN §2's algorithm: defense-in-depth shape
  re-validation (kind must be "agent"/"command", name/description/body/
  sourceTemplateId non-empty) -> `findProjectPath` + fresh `loadProjectStore`
  read (closes TOCTOU) -> auto-suffix loop scoped to `(kind, name)` pairs ->
  construct `CanonicalArtifact` with `meta.status:"draft"`,
  `meta.sourceTemplateId` populated -> `validateAllArtifacts` re-check
  (defense in depth) -> `store.artifacts.push` + `saveProjectStore`. Writes
  ONLY `.symbion/store.json` — never calls `renderArtifacts`/`writeFiles`.
  **Not** added to `server.ts`'s `READ_ONLY_METHODS` (mutates store, requires
  session token like every other mutating RPC — no `server.ts` change needed
  since exclusion from that set is the default).
- MODIFIED `apps/daemon/test/rpc.integration.test.ts` — new
  `describe("applyTemplate RPC (templates-marketplace)")` block, 13 tests
  covering testplan D1, D2 (+D2b suffix-chain, +D2c kind-scoping), D3, D4,
  D5 (+D5b description variant), D6, D8, D9. All passing.
- MODIFIED `apps/daemon/test/server.integration.test.ts` — 3 new tests in
  the `T15 security` block covering D7 (missing token -> 401, wrong token ->
  401, correct token -> reaches handler not 401) via the real HTTP auth gate,
  not just the handler-level unit tests.

**`apps/web` (presentation + IR editing, all effects via daemon RPC):**
- NEW `apps/web/src/data/templates/manifest.ts` — `loadTemplateManifest()`,
  `TemplateListItem`/`TemplateManifest` types, static imports of all 12
  template `.ts` modules, parses each via `parseTemplateMarkdown` at
  call-time (synchronous, client-side, zero network/daemon). Malformed
  entries land in `skipped[]`, never throw.
- NEW `apps/web/src/data/templates/agents/{code-reviewer,
  test-coverage-auditor, dependency-upgrade-scout, onboarding-doc-writer}.ts`
  (4 agents).
- NEW `apps/web/src/data/templates/commands/{test-writer, release-notes,
  changelog-entry, bug-repro}.ts` (4 commands).
- NEW `apps/web/src/data/templates/skills/{commit-message, pr-description,
  api-error-message, migration-checklist}.ts` (4 skills).
  **All 12 are original content, zero text copied from
  github.com/affaan-m/ecc** — fresh prose, categories only loosely inspired
  by common agent/command/skill patterns (code review, test writing,
  release notes, commit messages, etc.) per THINK #3.
- NEW `apps/web/src/components/TemplatesView.tsx` — route content, mirrors
  `SettingsShell`'s session-bootstrap pattern; loads manifest via `useMemo`;
  renders 3 `TemplateSection`s + footer ECC attribution link.
- NEW `apps/web/src/components/TemplateSection.tsx` — labeled section +
  card grid + per-file skipped warning lines; renders "Chưa có mẫu nào
  trong mục này" for an empty section (never blanks/hides a section).
- NEW `apps/web/src/components/TemplateCard.tsx` — whole-card clickable
  `<button>`, kind badge corner label.
- NEW `apps/web/src/components/TemplatePreviewModal.tsx` — the
  `preview -> apply -> result` step machine (mirrors `CreateProjectDialog`'s
  `Step` pattern). Preview step: CodeMirror read-only viewer + Copy
  markdown (try/catch clipboard, `clipboardBlocked` -> select-all fallback,
  `copied` -> green confirm line, exact `CopyRunCommandDialog` idiom) +
  Áp dụng (disabled for `kind:"skill"` with inline "coming soon" note,
  always visible). Apply step: `ProjectPickerStep` + daemon-down disable +
  "Xác nhận áp dụng" calls `useArtifactStore.applyTemplate`. Result step:
  `ApplyResultPanel` with "Mở dự án" -> `router.push("/?openProject=<id>")`.
- NEW `apps/web/src/components/TemplateMarkdownViewer.tsx` — read-only
  CodeMirror wrapper (`EditorView.editable.of(false)` +
  `EditorState.readOnly.of(true)`, no new editor dependency beyond adding
  `@codemirror/state`/`@codemirror/view` as explicit `apps/web` deps — both
  were already transitively present via `@codemirror/lang-markdown`).
  Exposes an imperative `selectAllRef` for the clipboard-failure fallback.
- NEW `apps/web/src/components/ProjectPickerStep.tsx` — pure presentational
  radio-list / zero-projects empty state ("Chưa có dự án nào — tạo dự án
  trước" + "+ Tạo dự án mới" CTA) / daemon-down dimmed-and-disabled variant.
  Client-side substring filter on name+path, always rendered.
- NEW `apps/web/src/components/ApplyResultPanel.tsx` — T4 success panel,
  branches on `wasRenamed` for the exact two copy variants from the design
  doc's wireframe (3.10).
- MODIFIED `apps/web/src/components/AppNav.tsx` — added the third
  `<Link href="/templates">Templates</Link>`, same `linkClass` pattern, no
  structural change.
- MODIFIED `apps/web/src/components/AppShell.tsx` — bootstrap effect now
  also reads `?openProject=<id>` (calls `loadProject(id)`, best-effort,
  falls back silently if the project no longer exists) and
  `?createProject=1` (calls `setCreateOpen(true)`), then strips BOTH params
  via `history.replaceState` (keeps `?t=` and any other query params
  untouched — only deletes the two new keys).
- MODIFIED `apps/web/src/lib/rpc/types.ts` — re-exports
  `ApplyTemplateParams`/`ApplyTemplateResult` from `@symbion/rpc-types`.
- MODIFIED `apps/web/src/lib/store/useArtifactStore.ts` — new
  `applyTemplate(params)` action. Per PLAN, deliberately does NOT
  unconditionally mutate `currentProject` (Apply targets an arbitrary
  project, `/templates` has no current-project concept) — but as a small
  UX nicety beyond PLAN's literal text, it DOES sync `currentProject` if
  the applied-to project happens to already be the loaded one (so an open
  Builder tab reflects the new draft immediately without a manual reload).
  Flagging this as a minor, additive judgment call for the Checker since
  PLAN didn't explicitly call for the "happens to be current" branch.
- NEW `apps/web/src/app/templates/page.tsx` — one-line route entry,
  mirrors `apps/web/src/app/settings/page.tsx`.
- MODIFIED `apps/web/package.json` — added explicit `@codemirror/state` and
  `@codemirror/view` deps (previously only transitive via
  `@codemirror/lang-markdown`); ran `npm install` at repo root to register.

### Assumptions made (for Checker to verify)

1. **`extractBody` (frontmatter-stripping) lives in `TemplatePreviewModal.tsx`,
   client-side, NOT a new `packages/core` export.** The RPC sends
   `template.body` already stripped of its `---...---` frontmatter block
   (matching what `CanonicalArtifact.body` expects elsewhere in the IR).
   `parseTemplateMarkdown` already does this stripping internally and
   returns `parsed.body`, but `manifest.ts`'s `TemplateListItem.raw` stores
   the **full** raw text (frontmatter + body) per PLAN's exact interface
   (`raw: the exact bytes of the .md file... what Copy markdown copies
   verbatim`) — so at Apply time the body has to be re-derived from `raw`
   one more time. I considered also storing `parsed.body` directly on
   `TemplateListItem` (avoiding the second extraction) but PLAN's
   `TemplateListItem` interface (§1) only lists `id/kind/name/description/
   raw` — no `body` field — so I kept the manifest type exactly as PLAN
   specified and added a small local `extractBody()` helper in the modal
   instead of extending the manifest's interface. This is a literal
   reading of PLAN's exact type; flagging in case the Checker prefers
   `TemplateListItem` to carry `body` directly to avoid double-parsing.
2. **Kind badge wording**: used the English-ish loan words "Agent"/
   "Command"/"Skill" (design's drawn default in wireframe 3.1), not full
   Vietnamese — design doc explicitly left this as an open/unresolved taste
   call (§6 Q5); picked the wireframe's literal drawn text since it was the
   only concrete signal.
3. **Card grid density**: 2-column grid (`sm:grid-cols-2`) per the
   wireframe's drawn default — design doc explicitly left this undecided
   too (§6 Q2).
4. **Markdown viewer chrome**: no separate visual treatment for frontmatter
   vs. body inside the CodeMirror viewer — matches `MarkdownTab`'s existing
   precedent of no separation, per design §6 Q3's explicit note to follow
   that precedent.
5. **`@codemirror/state`/`@codemirror/view` added as explicit `apps/web`
   dependencies** rather than relying on the implicit transitive resolution
   via `@codemirror/lang-markdown` (which already worked, but undeclared
   transitive deps are fragile against future version bumps) — a small,
   judgment-call addition beyond PLAN's literal text, flagged for Checker.
6. **No `Toast` system introduced** — followed the existing inline colored
   `<p>` convention throughout (`copied`/`clipboardBlocked` green/amber
   lines, `applyError` destructive line), per design §4's "Open component
   question" resolution.
7. **`ProjectPickerStep`'s "Xác nhận áp dụng" button visibility when
   `projects.length === 0`**: per the T5 wireframe (3.9), only "Quay lại" is
   shown in the footer (no confirm button) when there are zero projects —
   implemented in `TemplatePreviewModal.tsx` by conditionally rendering the
   confirm button only when `projects.length > 0`, since `ProjectPickerStep`
   itself is presentational only and the footer buttons live in the parent
   modal.
8. **Daemon-down banner inside the Apply step** uses the same red/⚠ tone as
   `DaemonStatusBadge` but is a separate inline `<p>` (not a literal reuse
   of the `DaemonStatusBadge` component instance), since `DaemonStatusBadge`
   is already rendered once in the persistent `ProjectSidebar` (which
   doesn't exist on `/templates`) — design §4 component breakdown flagged
   this as needing "hoist into AppNav row or a top-of-content banner"
   without fully resolving it; I scoped the daemon-down messaging to live
   only inside the Apply step (where it's actually actionable/relevant),
   not as a persistent top-of-page banner on `/templates` generally, since
   browse/preview/copy never need the daemon at all (matches THINK #2 + the
   edge-case table's "Copy markdown alone should still work" framing).
9. **`apps/web/src/data/templates/manifest.ts` does not have a `relPath`
   per template item** beyond what's used for `skipped[]` keying —
   `TemplateListItem` (the successful-parse shape) only carries
   `id/kind/name/description/tools/raw` per PLAN's exact interface; the
   `SOURCES` array's `relPath` field is manifest-internal bookkeeping only,
   not exposed on `TemplateListItem`.
10. **12 templates shipped** (4 agents + 4 commands + 4 skills), within
    PLAN's stated "~8-12-file v1 bundle" range — all original prose per
    THINK #3, no ECC text copied.

### Deferred / out of scope (per PLAN's own explicit boundaries — not gaps)

- Codex/`AGENTS.md`-specific Apply UI (THINK #5 — out of scope for v1,
  unchanged).
- Live-fetch / remote template sourcing (THINK #2 — vendored only).
- Real Claude Code Skills IR support (`ArtifactKind` stays 2-valued; Skills
  remain browse+copy-only, no Apply — THINK #1, unchanged).
- A standalone `/sync-templates` maintenance script (mentioned only as a
  future possibility in PLAN §5 assumption #3 — not built).
- E2E (chrome-devtools) test execution against the testplan's E1-E15 — this
  BUILD phase delivered the Vitest unit/integration coverage (U1-U12,
  D1-D9 + D7's dedicated server-level auth tests); the E2E browser-journey
  pass is QA/Checker's responsibility per the pipeline (`/qa` phase), not
  something the Maker self-executes.

### Verification performed by Maker (build/test only, not a self-review)

- `npx vitest run` at repo root: **331 tests passed** (32 test files;
  includes the new `parseTemplate.test.ts` (10), the new `applyTemplate`
  block in `rpc.integration.test.ts` (13), and the new D7 auth tests in
  `server.integration.test.ts` (3)).
- `npm run build` at repo root: core, rpc-types, daemon all `tsc` clean;
  `apps/web` `next build` succeeds, including its own built-in
  lint+typecheck pass ("Linting and checking validity of types ... ✓"),
  and statically generates `/templates` as a new prerendered route.
- `npx tsc --noEmit` in `apps/web` independently: zero errors.

## Phase: BUILD — fix for code-reviewer 🔴 blocker (name required for commands)

**Bug** (reviewer-reported): `parseTemplateMarkdown` (`packages/core/src/
templates/parseTemplate.ts`) required a non-empty frontmatter `name` for
**every** `expectedKind`, including `"command"`. But commands never carry
`name` in frontmatter anywhere else in the IR — `render/frontmatter.ts`'s
`artifactToFrontmatterFields` deliberately omits `name` for `kind ===
"command"`, and `parse/scan.ts`'s `parseClaudeFile` derives a command's
`name` from its filename (`COMMAND_PATH_RE` capture group), never from
frontmatter. The 4 bundled command templates (`apps/web/src/data/templates/
commands/{test-writer,release-notes,changelog-entry,bug-repro}.ts`) correctly
followed that convention and omit `name` — so all 4 were rejected with
`"Frontmatter thiếu 'name'."` and landed in `skipped`, leaving the Commands
section of `/templates` empty. Violated AC1 + testplan E1.

**Fix — `packages/core/src/templates/parseTemplate.ts`:**
- `ParsedTemplateContent.name` changed from required `string` to optional
  `name?: string` (commands legitimately have no name at the parse layer).
- The `name`-required check is now scoped to `expectedKind === "agent"` only
  (commands AND skills no longer require it — skills' bundled templates
  happen to already include `name`, so this is a no-observed-behavior-change
  for skills today, but the validation itself only truly needs to be strict
  for agents per the IR convention; skill is a gallery-only concept with no
  IR precedent dictating a `name` rule either way, so leaving it permissive
  matches "don't invent a rule the IR doesn't have").
- `description` is still always required for all three kinds — unchanged.
- When `fm.name` IS present and non-empty (e.g. a future command template
  that happens to also set `name`), it is still carried through onto
  `parsed.name` rather than being dropped — no information loss, just no
  longer mandatory.

**Fix — `apps/web/src/data/templates/manifest.ts`:** `loadTemplateManifest()`
now derives the display `name` for items where `parseTemplateMarkdown`
returned no `name` (i.e. commands) from the slug portion of the template's
manifest `id` (e.g. `"command:test-writer"` -> `"test-writer"`) — the exact
same "name comes from the file's own identity, not frontmatter" precedent
`parse/scan.ts`'s `COMMAND_PATH_RE` capture group already establishes for
real `.claude/commands/<name>.md` files (manifest `id` slug is this bundle's
filename-equivalent). `TemplateListItem.name` itself is unchanged (still
required `string`) — only the loader's derivation logic changed.

**Test fix/additions — `packages/core/test/parseTemplate.test.ts`:**
- `VALID_COMMAND` fixture (used by `U2`) no longer includes a `name` field —
  it now matches the real shape of the bundled command templates (this is
  exactly the gap that hid the bug: the old fixture had `name: test-writer`,
  which is not representative of any real command template in the bundle).
- Added `U2b`: a command-shaped fixture WITHOUT `name` in frontmatter parses
  `ok: true`, with `parsed.name === undefined` and `parsed.description`
  correct — the direct regression test for this exact bug class.
- Added `U2c`: a command-shaped fixture that DOES happen to include a stray
  `name` field still parses fine and carries the name through (`name` is
  optional-but-honored-if-present, not "always stripped for commands").
- All other agent tests (`U1`, `U4`, `U5`, etc.) untouched — agents still
  require `name`, confirmed still enforced.

**Verification performed:**
1. `npm run build` (root) — core/rpc-types/daemon `tsc` clean; `apps/web`
   `next build` succeeds (lint+typecheck pass, `/templates` route still
   statically generated). PASS.
2. `npx vitest run` (root workspace) — **333 tests passed** (32 files;
   `parseTemplate.test.ts` now has 12 tests, up from 10, all passing). No
   regressions in any other suite (daemon `applyTemplate`/auth tests
   untouched and still green, since the RPC layer doesn't call
   `parseTemplateMarkdown` at all — it receives already-parsed fields from
   the web client).
3. **Real-bundle re-derivation check (the exact gap the reviewer flagged —
   no test previously exercised the actual bundled `.ts` files, only
   synthetic fixtures):** ran a one-off script via `npx tsx` that imports the
   real `loadTemplateManifest()` from `apps/web/src/data/templates/
   manifest.ts` (no mocking) and logged `items`/`skipped`. Confirmed:
   - All 12 bundled templates (4 agents + 4 commands + 4 skills) now land in
     `items`, **zero** in `skipped`.
   - All 4 command items have correctly derived names:
     `test-writer`, `release-notes`, `changelog-entry`, `bug-repro` — each
     matching the slug portion of its manifest `id`.
   - All 4 agent items still carry their frontmatter `name` unchanged
     (`code-reviewer`, `test-coverage-auditor`, `dependency-upgrade-scout`,
     `onboarding-doc-writer`) — confirms the agent path is unaffected.

   **Coverage gap note for Checker/future regression protection:** this
   real-bundle check was run manually (one-off `tsx` script, not committed)
   because `apps/web` has no `vitest` project wired into the root
   `vitest.workspace.ts` today (no `vitest` devDependency in `apps/web/
   package.json`, no `apps/web/vitest.config.ts`) — adding a new test
   project (deps, config, workspace entry) was judged out of scope for a
   targeted bug fix. **This means there is still no automated test that
   exercises the real bundled command/agent/skill `.ts` files directly** —
   only `packages/core`'s synthetic fixtures (now including the corrected
   no-`name` command fixture) protect `parseTemplateMarkdown` itself, and
   only manual verification confirmed the full manifest's real output. If a
   future bundled template file regresses (e.g. someone accidentally adds a
   `name` back, or a typo breaks frontmatter), nothing will fail CI
   automatically — recommend a follow-up task: wire a minimal `apps/web`
   vitest project (or a `packages/core`-side test that imports the bundle's
   raw `.ts` exports, if layering allows) so `loadTemplateManifest()`'s real
   output is asserted in CI, not just spot-checked manually.

**Files changed in this fix:**
- `packages/core/src/templates/parseTemplate.ts`
- `packages/core/test/parseTemplate.test.ts`
- `apps/web/src/data/templates/manifest.ts`
- `docs/loops/templates-marketplace-STATE.md` (this section)

**Phase: BUILD fix complete — back to code-reviewer for re-verification.**

## Phase: QA

> Run 2026-06-30. Reads testplan `docs/loops/templates-marketplace-testplan.md`
> as the acceptance standard. Verified at build/test/HTTP/code level; full
> interactive browser automation (chrome-devtools MCP) was unavailable in
> this environment ("Could not connect to Chrome" — no reachable browser
> instance), so E2E criteria requiring real clicks/clipboard/DOM interaction
> are marked accordingly below, not silently skipped.

### Build & test gate

- **`npm run build` (repo root): PASS.** `core`/`rpc-types`/`daemon` `tsc`
  clean; `apps/web` `next build` succeeds (lint+typecheck pass), statically
  generates `/`, `/settings`, `/templates` as prerendered routes
  (`apps/web/out/{index,settings,templates}.html` all present).
- **`npx vitest run` (repo root): PASS.** 333 tests, 32 files, 0 failures —
  matches the exact expected count from the BUILD-fix verification log.
  Includes `parseTemplate.test.ts` (12 tests, U1-U8 + U2b/U2c regression
  tests for the command-`name` blocker fix), `applyTemplate` RPC block in
  `rpc.integration.test.ts`, and D7 auth tests in
  `server.integration.test.ts`.

### Dev servers + HTTP-level checks

- Started `npm run dev:daemon` (daemon on `127.0.0.1:20130`, fresh session
  token printed) and `npm run dev:web` (Next dev server) in the background.
- `GET http://localhost:3000/` → **200**.
- `GET http://localhost:3000/templates` → **200**, response HTML contains
  exactly one occurrence each of "Skills", "Agents", "Commands" section
  headings, and all 12 bundled template names appear in the payload:
  4 agents (`code-reviewer`, `test-coverage-auditor`,
  `dependency-upgrade-scout`, `onboarding-doc-writer`), 4 commands
  (`test-writer`, `release-notes`, `changelog-entry`, `bug-repro`), 4 skills
  (`commit-message`, `pr-description`, `api-error-message`,
  `migration-checklist`). **Zero items in `skipped` — confirms the
  command-template blocker fix holds in this fresh run** (this was the
  exact bug: all 4 command templates were previously rejected for missing
  frontmatter `name` and the Commands section rendered empty/zero cards).
- No console/server errors in `next dev`'s log for either request (clean
  compile, `GET /templates 200`).
- Footer ECC attribution text ("Lấy cảm hứng từ ... ECC", link to
  `affaan-m/ecc`) present in the rendered HTML.
- Nav renders all three links (Builder, Templates, Cài đặt) per `AppNav.tsx`.
- Daemon RPC sanity: `POST /rpc {"method":"listProjects"}` with the correct
  `x-symbion-token` header → 200 with 3 registered projects (real local dev
  projects already registered in this machine's Symbion config). Same call
  **without** the token header → **401**, confirming `applyTemplate`'s
  sibling read RPC (and by extension the auth gate `applyTemplate` rides on,
  per D7/AC8) is enforced at the HTTP layer, not just in handler unit tests.

### 🔴 New finding — daemon static-file route bug (pre-existing, NOT introduced by this feature, but blocks AC1's literal acceptance path in production)

**Symptom:** When the **daemon** serves the built `apps/web/out` static
export (the documented production path — `npm start` boots the daemon,
which serves the web build itself on its own port; see README "Pick Web UI
to open the app... at the printed localhost URL"), a **direct/hard
navigation or refresh** of `http://127.0.0.1:<port>/templates` does NOT
serve `apps/web/out/templates.html`. It silently falls back to serving the
**Builder (`/`) page's HTML and JS bundle** instead (confirmed: the response
references `app/page-855482dd102e6ca0.js`, the `/` route's chunk, not
`app/templates/page-*.js`). Requesting `/templates.html` (with the explicit
extension) DOES correctly return the real Templates page with all three
sections.

**Root cause** (`apps/daemon/src/server.ts:25-46`, `serveStaticFile`):

```ts
const relPath = cleanPath === "/" ? "index.html" : cleanPath.replace(/^\//, "");
...
if (!existsSync(absPath) || statSync(absPath).isDirectory()) {
  absPath = join(root, "index.html");
}
```

For `urlPath = "/templates"`, `relPath` becomes `"templates"` (no `.html`
suffix) — but Next.js's static export writes the file as `templates.html`,
not a `templates` file or `templates/index.html` directory. `existsSync`
finds nothing at the extensionless path, so the function falls back to
`index.html` (the SPA-fallback branch, intended for genuine client-side
routes with no static counterpart) — except `/templates` (and `/settings`)
DO have real static counterparts that are just never looked up correctly.

**Confirmed pre-existing, not new:** `/settings` exhibits the byte-identical
symptom (`GET /settings` also returns the `/` page's bundle, not
`settings.html`) — this bug predates the Templates feature; it was latent
since `/settings` was first added and just never previously surfaced/was
tested via direct daemon-served navigation. Not a regression introduced by
this feature's BUILD phase.

**Mitigating factor (reasoned, not empirically confirmed — no browser
available):** Next.js App Router client-side navigation (clicking the
in-app `<Link href="/templates">` from an already-loaded `/` page, which is
the actual boot flow — the daemon's printed URL is always `/?t=<token>`,
landing on `/` first) uses RSC "flight" fetches
(`/templates.txt`/`__flight__`-style payloads, confirmed present and
correctly content-addressed in `apps/web/out/templates.txt`), not a full
HTML document request — so it most likely bypasses `serveStaticFile`'s
buggy extensionless-path fallback entirely and works correctly for the
"click the nav tab" journey (testplan E1/AC1's literal wording). **This
could not be empirically verified** in this QA pass because
chrome-devtools MCP could not connect to a Chrome instance in this sandbox
("Could not connect to Chrome ... fetch failed" against the devtools
websocket endpoint) — every other browser-interaction-dependent criterion
below has the same limitation.

**What IS confirmed broken, concretely:** a user who bookmarks/refreshes/
shares a direct link to `/templates` (or `/settings`) while the app is
served by the daemon (not the `next dev` dev server, which has no such bug
since it has real per-route handling) lands on the Builder page silently —
no error, no 404, just the wrong page. This is a real, reproducible defect,
independently verifiable by anyone with `curl`:
```
curl http://127.0.0.1:<daemon-port>/templates       # wrong: returns "/" bundle
curl http://127.0.0.1:<daemon-port>/templates.html  # correct: real Templates page
```

**Recommendation:** fix `serveStaticFile` to try `relPath + ".html"` before
falling back to `index.html` (standard static-export routing convention),
e.g.:
```ts
if (!existsSync(absPath) || statSync(absPath).isDirectory()) {
  const withHtml = absPath + ".html";
  absPath = existsSync(withHtml) ? withHtml : join(root, "index.html");
}
```
This is a small, low-risk daemon-only fix, orthogonal to this feature's own
code (no `packages/core`/RPC/IR changes needed) — but it should be fixed
before/alongside shipping Templates, since it's the literal route this
feature introduces and AC1 explicitly tests "Navigate to app... URL is
`/templates`."

### Testplan criteria — verification status

**Verified PASS (build/test/HTTP/code-level):**
- U1-U12 (parseTemplateMarkdown unit tests, incl. U2b/U2c regression for the
  command-name fix) — PASS, all green in `npx vitest run`.
- D1-D9 (applyTemplate RPC daemon integration tests) — PASS, all green.
- D7 (token required) — PASS, confirmed BOTH in the vitest integration
  suite AND independently via a live `curl` against the running daemon
  (401 without token, 200-shape with correct token on the sibling
  `listProjects` RPC which shares the same auth gate).
- AC1 (three sections, ≥1 item each, zero skipped) — **PASS** at the HTTP/
  content level via `next dev` (the route that matters for active
  development and for any deployment that proxies `apps/web` directly
  rather than the daemon's static bundle) — confirmed zero items skipped,
  fixing the exact blocker bug from the prior BUILD-fix cycle. Console
  errors could not be checked live (no browser), but the dev server log
  shows clean compiles with no server-side errors for either `/` or
  `/templates`.
- AC7 (malformed template skipped with reason, others still list) — PASS by
  code inspection: `loadTemplateManifest()` (`apps/web/src/data/templates/
  manifest.ts`) wraps each template's parse in `parseTemplateMarkdown`
  (never throws per its contract, confirmed by U4-U6) and routes failures to
  `skipped[]`; `TemplateSection.tsx` renders skipped items as an inline
  warning line, not a crash. Not re-verified with a live malformed fixture
  in this QA pass (would require injecting a test-only bad template into the
  manifest) — code-level reasoning only, consistent with the prior
  code-reviewer pass.
- AC8 (no new direct fs-write path; new RPC follows existing auth/path
  rules) — PASS by code inspection + the live 401/200 token check above:
  `applyTemplate` writes only via the existing `saveProjectStore`helper
  (same path-confinement as `saveArtifact`/`importArtifacts`), is not in
  `READ_ONLY_METHODS`, and `packages/core` received no fs/Node imports.

**Not independently re-verified beyond the prior code-reviewer/architect
passes (code-level reasoning only, per this task's instructions — no
browser available to empirically confirm):**
- AC2 (byte-identical modal content), AC3 (clipboard copy + ack), AC4
  (project picker shows exact registered set), AC5a/AC5b (Apply →
  store-only write, zero `.claude/` bytes touched), AC6 (zero-projects
  empty state), E2-E15 (all modal/clipboard/picker/daemon-down/collision/
  handoff interaction journeys) — these require actual DOM interaction,
  clipboard read-back, or filesystem snapshot-diffing around live clicks,
  none of which chrome-devtools MCP could perform in this sandbox. These
  were already covered at the unit/integration level by D1-D9 (the
  server-side half of AC5/AC8) and at the code-reading level by the prior
  code-reviewer + architect passes referenced earlier in this STATE doc.

### Overall QA verdict: **FAIL — do not ship as-is**

Reason: a genuine, reproducible bug was found — `apps/daemon/src/
server.ts`'s `serveStaticFile` does not correctly route extensionless
static-export paths (`/templates`, and pre-existingly `/settings`) when the
daemon serves the built web app, the documented production access path.
This is not merely an "unverifiable without browser" gap — it is a
concrete, curl-reproducible defect that directly affects this feature's own
acceptance criterion AC1 ("clicking it renders... URL is `/templates`")
for any direct/refresh navigation, and plausibly (though not empirically
confirmed here, browser unavailable) does not affect the in-app
client-side-nav-click path.

**Required before re-running QA:** fix `serveStaticFile` (recommended patch
above, `apps/daemon/src/server.ts`) to look up `<path>.html` before falling
back to `index.html`. Add a regression test (daemon integration test
hitting `serveStaticFile`/the HTTP server directly for `/templates` and
`/settings`, asserting the response body matches the route's own bundle,
not `/`'s) so this class of bug cannot silently reappear for a future new
route. After the fix lands, re-run this QA pass — ideally in an
environment with a reachable Chrome instance so AC2-AC6/E2-E15 can be
empirically verified rather than reasoned about from code.

### Phase: BUILD — fix for daemon static-routing bug found above (dev, 2026-06-30)

> Fixed by `dev` (general Maker), not `feature-builder` — this is a
> standalone, scoped daemon-routing bugfix orthogonal to the Templates
> feature's own IR/RPC/UI code (no `## ... PLAN` section in this STATE doc
> covers `server.ts` routing; it's pre-existing tech debt this feature's QA
> happened to surface and that blocked AC1's literal acceptance path), per
> the `dev` agent's documented boundary with `feature-builder`.

- **Fix**: `apps/daemon/src/server.ts`'s `serveStaticFile` — when the
  extensionless request path doesn't exist on disk (or is a directory), now
  tries `<relPath>.html` first and only falls back to `index.html` if that
  also doesn't exist. Generic (works for any current/future route, e.g.
  `/templates`, `/settings`, or any new top-level page), not
  route-special-cased.
- **Regression test added**: `apps/daemon/test/server.integration.test.ts`,
  new `describe("static file serving — extensionless route resolution ...")`
  block — spins up a real `startServer({ webStaticRoot })` against a
  temp-dir fixture mimicking a Next static export (`index.html`,
  `templates.html`, `settings.html`, each with a distinct fake bundle
  reference), then asserts over real HTTP that `GET /templates` and
  `GET /settings` each return their OWN bundle reference (not the
  `index.html`/Builder one), `GET /` is unaffected, `GET /templates.html`
  (explicit extension) still works, and a genuinely nonexistent path still
  falls back to `index.html`. 5 new test cases.
- **Verification**: `npm run build` (root) — PASS, all workspaces clean,
  `next build` regenerates `apps/web/out/{index,templates,settings}.html`.
  `npx vitest run` (root) — PASS, 338 tests / 32 files (333 prior + 5 new),
  0 failures. Manual end-to-end check: built `apps/web/out`, started a real
  daemon `startServer` instance pointed at it on a scratch port, and
  `curl`'d `/templates`, `/settings`, `/`, and `/templates.html` directly —
  each now returns its own route's `app/<route>/page-*.js` bundle reference
  (previously `/templates` and `/settings` both incorrectly returned
  `app/page-*.js`, the Builder bundle); background process cleaned up
  afterward.
- **Scope discipline**: change confined to the one `if` block inside
  `serveStaticFile` (~3 lines) + the new test block; no other part of
  `server.ts` touched, no route-specific special-casing introduced.
- **Assumptions for Checker to verify**: (1) Next.js `output: "export"`
  always emits a flat `<route>.html` per top-level route (true for this
  repo's current `apps/web/src/app/{,, templates,settings}` — no nested
  dynamic segments yet that would need `<route>/index.html`-style lookup;
  if nested routes are added later this single-level `.html` lookup may
  need revisiting, out of scope here). (2) The existing path-confinement
  check (`absPath.startsWith(root)`) still runs before this new lookup
  branch is reached, so the `.html` fallback path is built from the same
  already-validated `root`/`relPath` — no new traversal surface introduced.
  (3) This fix is daemon-only; `apps/web`'s own `next dev` server (used in
  the rest of this QA pass) was never affected by this bug since Next's dev
  server has its own real per-route resolution — only the daemon's
  hand-rolled static server had the gap.

**Build/test gate itself is solid** (`npm run build` clean, 333/333 tests
green, command-template blocker fix confirmed holding) — the FAIL is scoped
specifically to the daemon static-routing defect above, not to
`packages/core`'s parser or the `applyTemplate` RPC logic, both of which
verified cleanly.

## Phase: QA (re-run)

> Run 2026-06-30, independently re-verifying the daemon static-routing fix
> (previous section, "BUILD — fix for daemon static-routing bug") and
> re-confirming everything else still holds. Did not trust the fix report at
> face value — re-derived every check from scratch against a fresh build.

### 1. `npm run build` (repo root) — PASS

`core`/`rpc-types`/`daemon` `tsc` clean; `apps/web` `next build` succeeds
(lint + typecheck pass). Output route table:

```
Route (app)                              Size     First Load JS
┌ ○ /                                    62.4 kB         406 kB
├ ○ /_not-found                          873 B          88.3 kB
├ ○ /settings                            4.81 kB         109 kB
└ ○ /templates                           11.4 kB         355 kB
```

`apps/web/out/{index,settings,templates,404}.html` all regenerated fresh.

### 2. `npx vitest run` (repo root) — PASS

**338 tests passed, 32 files, 0 failures** — exactly the expected count (up
from 333; +5 from the new `server.integration.test.ts` "static file serving
— extensionless route resolution" block). No regressions anywhere else
(`parseTemplate.test.ts` still 12 tests, `rpc.integration.test.ts` 50 tests
incl. the `applyTemplate` block, `server.integration.test.ts` 29 tests incl.
D7 auth + the 5 new static-routing regression tests).

### 3. Independent live verification of the static-routing fix — PASS

Did not just read the fix's own report — rebuilt fresh and re-tested
end-to-end myself:

- Confirmed `apps/web/out/{index,settings,templates}.html` were freshly
  regenerated by step 1's `npm run build` (timestamps match the build run).
- Started the **real built daemon** (`node apps/daemon/dist/index.js`, the
  actual production entrypoint — not a test harness), which auto-resolves
  `webStaticRoot` to `apps/web/out` via `findWebStaticRoot()`
  (`apps/daemon/src/index.ts:11-16`, relative-path resolution from
  `apps/daemon/dist` — the exact same code path a real `npm start`/packaged
  build uses). Daemon came up on `127.0.0.1:20130`.
- `curl`'d each route directly and grepped the response body for its JS
  bundle reference:

  | Route | Bundle returned | Verdict |
  |---|---|---|
  | `GET /` | `app/page-855482dd102e6ca0.js` | own bundle |
  | `GET /templates` | `app/templates/page-6aff9664016a0255.js` | **own bundle, not `/`'s** |
  | `GET /settings` | `app/settings/page-1f1e8793e70d8078.js` | **own bundle, not `/`'s** |
  | `GET /templates.html` (explicit) | `app/templates/page-6aff9664016a0255.js` | matches extensionless `/templates` |
  | `GET /nonexistent-route` | `app/page-855482dd102e6ca0.js` (index fallback) | correct SPA-fallback behavior preserved |

  All five return HTTP 200. This is the exact bug class from the prior QA
  FAIL (`/templates` and `/settings` silently serving the Builder's
  `app/page-*.js` instead of their own bundle) — **confirmed fixed**, not
  just trusted from the fix's own write-up.
- Content check on `/templates`'s response body: "Skills", "Agents",
  "Commands" section headings each appear exactly once, and all 12 bundled
  template names appear exactly once each (4 agents: `code-reviewer`,
  `test-coverage-auditor`, `dependency-upgrade-scout`,
  `onboarding-doc-writer`; 4 commands: `test-writer`, `release-notes`,
  `changelog-entry`, `bug-repro`; 4 skills: `commit-message`,
  `pr-description`, `api-error-message`, `migration-checklist`). **Zero
  skipped** — re-confirms the command-template-name parsing fix (BUILD-fix
  cycle, command frontmatter `name` no longer required) is still intact in
  this fresh build, independent of the earlier QA pass's own check.
- RPC auth sanity: `POST /rpc {"method":"listProjects"}` with no token
  header → `401`, confirming the auth gate the new routing-fix code sits
  beside is unaffected.
- Daemon process killed and confirmed gone (`ps aux` shows no stray
  `node apps/daemon/dist/index.js`, no stray `next dev`/`dev:web`/
  `dev:daemon` processes) before finishing this QA pass.

### 4. Testplan criteria — delta from prior QA pass

Everything marked PASS in the prior `## Phase: QA` section above still
holds (build/test gate, U1-U12, D1-D9, D7, AC7, AC8) — re-confirmed by
steps 1-2 above (same test counts plus the 5 new ones, same green result).

**Newly re-verified in this pass (previously FAIL, now PASS):**
- AC1's literal "URL is `/templates`" acceptance path **for direct/refresh
  navigation against the daemon-served production build** — the exact
  scenario that failed last time. Independently curl-verified above, not
  re-derived from the fix author's own log.
- The pre-existing `/settings` instance of the same bug — also confirmed
  fixed, same method.

**Still not independently re-verified in this pass (same limitation as
before, unchanged — not a new gap):** AC2 (byte-identical modal content),
AC3 (clipboard copy + ack), AC4 (project picker), AC5a/AC5b (Apply →
store-only write), AC6 (zero-projects empty state), and the full E2-E15
interactive click-through journeys (e.g. the Apply modal's
preview→apply→result step machine) — these require real DOM/clipboard
interaction via chrome-devtools MCP, which was not exercised in this pass
either. This remains a **code-level-verified limitation** consistent with
how this pipeline already operated in the prior QA pass (the relevant logic
was already covered server-side by the `applyTemplate` RPC's D1-D9
integration tests, and client-side by the prior code-reviewer + architect
passes) — not a new gap introduced by this re-run.

### Overall QA verdict (re-run): **PASS**

The one genuine, reproducible FAIL from the prior QA pass — the daemon
`serveStaticFile` extensionless-route bug blocking AC1's direct-navigation
path for `/templates` and `/settings` — is confirmed fixed by independent
re-verification (fresh build, real daemon process, direct `curl`, not just
trusting the fix's own report). Build gate (`npm run build`) and full test
suite (`npx vitest run`, 338/338) both pass cleanly. The command-template
parsing fix from the earlier BUILD-fix cycle is re-confirmed intact (all 3
sections — Skills/Agents/Commands — render with zero skipped items in a
fresh build). No new genuine failures found in this pass.

As before: full interactive browser verification of click-through flows
(the Apply modal's project-picker → confirm → result steps, clipboard
copy-and-paste, etc.) was not performed — no reachable Chrome instance was
used in this QA re-run either, consistent with the prior pass's documented
limitation. This is a known, code-level-verified limitation of this
pipeline's QA phase as currently run, not a newly discovered gap, and does
not change the PASS verdict for the criteria that QA could and did verify
independently (build, full test suite, and live HTTP-level routing
behavior against the real daemon + real build output).

**Background processes**: the one daemon process started for this
verification (`node apps/daemon/dist/index.js`, port 20130) was killed
before finishing this QA pass; no `next dev`/`dev:web`/`dev:daemon`
processes were left running.
