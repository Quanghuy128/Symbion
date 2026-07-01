# templates-authors — Test Plan

> Maps to `templates-authors-STATE.md` §6 Acceptance Criteria (AC1-AC8) and
> the PLAN phase's edge-case table (§P7). Extends, does not replace,
> `templates-marketplace-testplan.md` — v1's existing test cases (U1-U12,
> D1-D9, E1-E15) must keep passing unmodified (regression). Unit tests =
> Vitest (`packages/core`, `apps/daemon`); e2e = chrome-devtools/Playwright-
> style browser journeys against the running daemon+web app, per CLAUDE.md.
>
> No ECC body/prompt content appears in any fixture below — fixtures use
> synthetic frontmatter/body text only, even when modeling ECC's real
> structural shape (folder layout, frontmatter field names).

## Unit — `packages/core` (Vitest)

### `matchAuthorFolders` (new, `packages/core/src/templates/matchAuthorFolders.ts`)

- [ ] **U13** Flat `"*.md"` pattern (e.g. `agents/`): a tree entry
      `agents/foo.md` matches; `agents/sub/foo.md` (nested one level
      deeper) does NOT match; `agents/foo.txt` (wrong extension) does NOT
      match; `agents-extra/foo.md` (path that merely starts with the
      folder name as a substring, not a real path segment) does NOT match.
- [ ] **U14** Folder-per-item `"*/SKILL.md"` pattern (e.g. `skills/`): a
      tree entry `skills/foo/SKILL.md` matches; `skills/foo/examples/
      bar.md` (a helper file inside the same item folder) does NOT match;
      `skills/SKILL.md` (missing the required one-level subfolder) does
      NOT match; `skills/foo/bar/SKILL.md` (nested two levels) does NOT
      match.
- [ ] **U15** A tree snapshot shaped like the real verified ECC layout
      (fixture: synthetic paths only, e.g. `agents/a.md`, `agents/b.md`,
      `commands/c.md`, `skills/d/SKILL.md`, `skills/d/examples/e.md`,
      `docs/f.md`, `.claude/g.md`) run through `matchAuthorFolders` with
      the real `ECC_AUTHOR.folders` mapping returns exactly the 4
      candidate files (`agents/a.md`, `agents/b.md`, `commands/c.md`,
      `skills/d/SKILL.md`) and excludes the other 3 (`skills/d/examples/
      e.md`, `docs/f.md`, `.claude/g.md`) — direct regression test for
      P0/P2a's exclusion claims.
- [ ] **U16** Empty `folders` array (a hypothetical author with no mapped
      buckets) returns an empty candidate list, never throws.
- [ ] **U17** Tree entries of `type: "tree"` (directories themselves, not
      blobs) are never returned as candidates, even if their path matches
      a pattern textually (e.g. a directory literally named
      `agents/foo.md/`).

### `AUTHOR_REGISTRY` / `AuthorSource` (new, `packages/core/src/templates/authorSource.ts`)

- [ ] **U18** `AUTHOR_REGISTRY` contains exactly one `kind: "bundled"`
      entry with `id: "symbion"` and at least one `kind: "github"` entry
      with `id: "ecc"`, `owner: "affaan-m"`, `repo: "ecc"`.
- [ ] **U19** Every `kind: "github"` entry's `folders` array is non-empty
      and every `folders[].path` is a non-empty string with no leading/
      trailing slash (format-consistency check, catches a future typo'd
      registry entry at test time rather than at first real fetch).

### `parseTemplateMarkdown` (existing, packages/core — REGRESSION ONLY, no
new behavior expected per P0/P9's "zero modification" finding)

- [ ] **U20** Re-run U1-U8 (from `templates-marketplace-testplan.md`)
      unmodified — confirms zero regression from this feature's `core`
      changes (new sibling files added, no edits to `parseTemplate.ts`
      itself).
- [ ] **U21** NEW fixture modeling ECC's real-observed frontmatter shapes
      (synthetic content, real shape): an agent-shaped fixture with
      `name`, `description`, `tools` as a YAML flow array (`["Read",
      "Grep"]`), plus an extra unknown field (`model: sonnet`) — parses
      `{ ok: true }`, `tools` is `["Read","Grep"]`, the extra field does
      NOT cause a parse failure.
- [ ] **U22** A command-shaped fixture with `description` only (no `name`)
      plus extra unknown fields (`argument-hint: ...`) — parses
      `{ ok: true }`, `parsed.name` is `undefined` (caller derives it from
      the path/slug, same as v1).
- [ ] **U23** A skill-shaped fixture with a multi-line YAML folded-scalar
      `description` spanning 2 physical lines — parses `{ ok: true }` with
      `parsed.description` as a single joined string (no embedded literal
      newline artifact from the line-fold).
- [ ] **U24** A skill-shaped fixture with a nested-object frontmatter field
      (e.g. `metadata:` with an indented child key) — parses
      `{ ok: true }` without throwing (confirms the P0-flagged
      `customFields` stringification wart is cosmetic, not a parse
      failure).

## Unit/Integration — `apps/daemon` (Vitest, daemon integration)

### `fetchAuthorTemplates` RPC handler (new)

All tests use an injectable/mockable `fetch` (same pattern as
`OllamaProvider`'s test fixtures) — no real network calls in CI.

- [ ] **D10** Valid `authorId: "ecc"`, mocked tree response (small
      synthetic tree: 2 agents, 1 command, 1 skill, plus 2 non-matching
      paths) + mocked per-file 200 responses with valid synthetic
      frontmatter -> `outcome.status === "success"`, `items.length === 4`,
      `skipped.length === 0`, every item has `authorId: "ecc"`,
      `authorDisplayName: "ECC"`, `authorRepoLabel: "affaan-m/ecc"`.
- [ ] **D11** `authorId` not present in `AUTHOR_REGISTRY` (e.g.
      `"nonexistent"`) -> throws `RpcError("invalid-author", ...)`, no
      fetch attempted (assert the mock `fetch` was never called).
- [ ] **D12** `authorId: "symbion"` (a `kind: "bundled"` entry, not
      `"github"`) sent to this RPC -> throws `RpcError("invalid-author",
      ...)` — confirms the bundled author can't be accidentally routed
      through the network-fetch path.
- [ ] **D13** Mocked tree-fetch response with HTTP 404 ->
      `outcome.status === "error"`, `outcome.kind === "not-found"`, no
      `RpcError` thrown (well-formed expected-failure outcome, not a
      programming error).
- [ ] **D14** Mocked tree-fetch response with HTTP 403 +
      `x-ratelimit-remaining: "0"` + `x-ratelimit-reset: "<epoch-seconds>"`
      -> `outcome.kind === "rate-limit"`, `outcome.resetAt` equals the
      header value converted to milliseconds (exact arithmetic check, not
      just "is a number").
- [ ] **D15** Mocked tree-fetch response with HTTP 403 and NO
      `x-ratelimit-remaining` header (a non-rate-limit-shaped 403) ->
      `outcome.kind === "network"` (NOT `"rate-limit"`) — direct regression
      test for the "don't falsely claim rate-limited" decision in P2.
- [ ] **D16** Mocked `fetch` throws (simulated network/DNS failure) for the
      tree call -> `outcome.kind === "network"`, no unhandled rejection/
      crash.
- [ ] **D17** Mocked tree-fetch times out (exceeds the configured
      AbortController timeout) -> `outcome.kind === "network"`, handler
      resolves (doesn't hang indefinitely) within a bounded test timeout.
- [ ] **D18** Mocked tree-fetch succeeds, but ONE of N per-file fetches
      returns HTTP 500 -> that file appears in `skipped` with a non-empty
      reason; the OTHER (N-1) successfully-fetched, validly-parsed files
      still appear in `items` — direct test of "partial per-file failure
      never aborts the batch."
- [ ] **D19** Mocked tree-fetch succeeds, all per-file fetches succeed
      (200), but EVERY fetched file fails `parseTemplateMarkdown` (e.g.
      missing `description`) -> `outcome.status === "success"` (NOT
      `"error"`), `items.length === 0`, `skipped.length === N` — direct
      test of P2 step 6's "zero items is a success-with-warnings outcome,
      not an error outcome."
- [ ] **D20** Mocked tree response has `truncated: true` -> handler does
      NOT throw/error; processes whatever entries are present in the
      (partial) tree array per P2's defensive handling.
- [ ] **D21** `fetchAuthorTemplates` is present in the daemon's read-only
      methods set (assert via whatever mechanism `scanClaudeDir`/
      `listModels` are already tested as read-only — e.g. callable without
      mutating any project store, or present in the same allowlist array)
      — confirms it doesn't accidentally require write-auth semantics
      beyond the existing session-token gate.
- [ ] **D22** A hand-crafted request with extra unexpected fields (e.g.
      `{ authorId: "ecc", owner: "attacker", repo: "evil" }`) results in
      the handler using ONLY the registry-resolved `owner`/`repo` for
      `"ecc"` — assert the mocked `fetch` was called with a URL containing
      `affaan-m/ecc`, never `attacker/evil` (direct test of P8 SSRF
      finding #1(a)).

### `applyTemplate` RPC handler — NEW guard (P6)

- [ ] **D23** `template.authorId: "ecc"` (third-party), no
      `acknowledgedThirdParty` field sent -> throws `RpcError`
      (`"license-not-acknowledged"` or equivalent), no artifact persisted,
      store file unchanged.
- [ ] **D24** `template.authorId: "ecc"`, `acknowledgedThirdParty: false`
      explicitly -> throws the same `RpcError`, no artifact persisted.
- [ ] **D25** `template.authorId: "ecc"`, `acknowledgedThirdParty: true`
      -> succeeds exactly like a normal apply (existing D1/D2 assertions
      hold), confirms the new guard doesn't block the legitimate path.
- [ ] **D26** `template.authorId: "symbion"` (or omitted/undefined,
      simulating an old client), no `acknowledgedThirdParty` field sent ->
      succeeds — confirms ZERO behavior change for Symbion-authored items
      (the core regression this whole feature must not break).
- [ ] **D27** Re-run existing D1-D9 from `templates-marketplace-testplan.md`
      unmodified against Symbion-authored items — full regression check
      that `applyTemplate`'s collision/auto-suffix/store-write machinery
      is untouched.

## E2E — web journey (chrome-devtools / Playwright-style)

Maps directly to AC1-AC8. Network calls to `api.github.com`/
`raw.githubusercontent.com` are intercepted/mocked at the daemon-fetch
layer (or the daemon is pointed at a local fixture server) — no test
depends on the real `affaan-m/ecc` repo's live, possibly-changing state.

- [ ] **EA1 (AC1)** Navigate to `/templates` fresh — Authors sub-nav is
      visible with "Symbion" active by default; the 3 sections show
      exactly the same 12 items as v1's E1 assertion; confirm via network
      inspection that ZERO requests to `api.github.com`/
      `raw.githubusercontent.com` occur on initial load.
- [ ] **EA2 (AC1)** Click "ECC" tab — confirm exactly one request to
      `api.github.com/repos/affaan-m/ecc/git/trees/main` fires (network
      inspection), occurring only after the click, not before.
- [ ] **EA3 (AC2)** With a mocked successful tree+content response (small
      synthetic fixture set), click "ECC" — loading state appears
      immediately, then within the test's bounded wait, at least one item
      appears in at least one section; loading state is gone once items
      render.
- [ ] **EA4 (AC3)** Mock the tree-fetch to reject (simulated network
      failure) — clicking "ECC" shows the generic network-error panel
      (A4 wireframe) with non-generic-from-rate-limit copy and a "Thử lại"
      button; clicking "Symbion" tab immediately afterward shows the full,
      unaffected 12-item bundle (zero items missing/changed).
- [ ] **EA5 (AC4)** Mock the tree-fetch to return HTTP 403 with
      `x-ratelimit-remaining: 0` and a `x-ratelimit-reset` header —
      clicking "ECC" shows the rate-limit-specific panel (A5 wireframe)
      with distinct copy (DOM text assertion confirms it differs from
      EA4's generic-network copy) and a reset-time string derived from the
      header.
- [ ] **EA6 (AC5)** Mock the tree-fetch to succeed with a fixture
      containing both valid and deliberately malformed synthetic entries
      (e.g. one file with no frontmatter delimiter, one file nested 3
      levels deep under `agents/`, which `matchAuthorFolders` should
      already exclude pre-fetch) — confirm the malformed-but-fetched file
      lands in the skipped-summary UI (not a card), the view doesn't
      crash, and the valid entries still render as clickable cards.
- [ ] **EA7 (AC6)** With a mocked ECC fixture returning ≥1 valid agent
      item, open its preview modal, click "Copy markdown" — same success
      behavior as v1's E3; click "Áp dụng" — confirm the NEW license
      acknowledgment step (T3-license) appears BEFORE the project picker,
      showing "ECC" and "affaan-m/ecc" in its copy; "Tiếp tục" stays
      disabled until the checkbox is ticked; after ticking + continuing,
      the existing project-picker step (T3, unchanged from v1) appears and
      the rest of the flow (E4-E6 from v1's testplan) completes identically
      to a Symbion-sourced item.
- [ ] **EA8 (AC6)** Re-run v1's E2/E3/E5/E6 assertions verbatim against a
      mocked ECC-sourced item (after passing through EA7's license step)
      — confirms AC6's "identical behavior" claim end-to-end, including
      the resulting artifact's `meta.sourceTemplateId` matching the
      `"ecc:{relPath}"` format (P5).
- [ ] **EA9 (AC6 — Symbion regression)** Open a Symbion-authored item's
      preview modal, click "Áp dụng" — confirm the license step is SKIPPED
      entirely (goes straight to the existing T3 picker, zero new UI
      shown), matching v1's E4-E6 byte-for-byte.
- [ ] **EA10 (AC7)** Static/code-level check (not a browser test): grep
      the new `fetchAuthorTemplates` handler + any new daemon files added
      for this feature for `fs.writeFile`/`fs.promises.writeFile`/
      `writeFileSync` — assert zero matches. (Same mechanical check style
      as v1's AC7/E8, extended to the new RPC.)
- [ ] **EA11 (AC8)** Add a 3rd, test-only `AuthorSource` entry (a mock
      `kind: "github"` descriptor pointing at a local fixture server) to
      a test-scoped copy of `AUTHOR_REGISTRY` — confirm the Authors sub-nav
      renders a 3rd tab automatically, selecting it triggers
      `fetchAuthorTemplates` with the new `authorId` and returns items
      through the SAME code path (no new RPC call observed, no new
      component rendered) — direct test of AC8's "config-only" claim,
      scoped to the 2 already-supported `filePattern` shapes per P10.4's
      flagged limitation (this test does NOT attempt a 3rd, unsupported
      folder shape — that is explicitly out of scope per P10.4).
- [ ] **EA12** Switch to "ECC" tab (mocked success), switch back to
      "Symbion", switch to "ECC" again — confirm via network inspection
      that the SECOND "ECC" selection makes ZERO new requests (in-session
      cache hit, THINK #3) and renders the previously-resolved items
      instantly (no loading flash).
- [ ] **EA13** Trigger EA4's network-error state, click "Thử lại" with the
      mock now returning success — confirm the loading state reappears,
      then resolves to the success view (retry re-fetches, doesn't reuse
      the cached error).
- [ ] **EA14** With "ECC" in its error state (EA4), confirm "Symbion" tab
      remains clickable throughout (not disabled while ECC is broken) and
      its content is rendered with zero loading flash (it was never
      network-dependent).
- [ ] **EA15** Mock a fetch that returns a successful tree + per-file
      fetches that ALL fail `parseTemplateMarkdown` — confirm the "zero
      items, fetch succeeded" state (A6-variant, §3.6 of the design doc)
      renders with distinct copy from EA4's network-failure state (DOM
      text assertion confirms the two are not the same message).
- [ ] **EA16** Daemon stopped/unreachable while `/templates` is open with
      "Symbion" active — confirm Symbion content remains fully usable
      (browse/preview/copy); switching to "ECC" tab shows a daemon-
      unreachable variant of the error state (or the existing generic
      network error, dev's call) rather than hanging.

## Out of scope for this test plan (explicitly, per STATE §3)

- Tests against the REAL `affaan-m/ecc` repo's live, currently-changing
  content — all e2e fixtures are mocked/synthetic per the structural shape
  verified during PLAN, not the actual repo at test-run time (the actual
  repo can change at any time; a test suite depending on its live content
  would be flaky by construction).
- GitHub PAT/authentication flows (THINK #7, explicitly deferred).
- Self-service "add a GitHub repo as an author" UI (THINK #2/#4, explicitly
  out of scope).
- Streaming/incremental-results UI for slow full-author fetches (flagged
  in PLAN §P2 as a possible follow-up, not built in this version).
- Search/filter across authors (out of scope per original v1 STATE,
  reaffirmed in this STATE's §3).
