# templates-marketplace — Test Plan

> Maps to `templates-marketplace-STATE.md` §7 Acceptance Criteria (AC1-AC8)
> and the PLAN phase's §4 edge-case table. Unit tests = Vitest
> (`packages/core`, `apps/daemon`); e2e = chrome-devtools / Playwright-style
> browser journeys against the running daemon+web app (per CLAUDE.md's test
> stack: "Vitest (core unit + daemon integration) + chrome-devtools for web
> journey").

## Unit — `packages/core` (Vitest)

### `parseTemplateMarkdown` (new, `packages/core/src/templates/parseTemplate.ts`)

- [ ] **U1** Valid agent template (frontmatter `name`, `description`,
      `tools`, body) parses into `{ ok: true, parsed }` with every field
      matching the source bytes exactly (no trimming/mutation beyond what
      frontmatter parsing requires).
- [ ] **U2** Valid command template (no `tools` field) parses with
      `parsed.tools === undefined`.
- [ ] **U3** Valid skill template parses with `kind: "skill"` and is NOT
      rejected just because `ArtifactKind` doesn't include `"skill"` (the
      template-manifest `kind` is a separate three-valued type — confirms
      PLAN §5 assumption #5 holds in code, not just in the doc).
- [ ] **U4** Missing `name` in frontmatter → `{ ok: false, reason }`
      (reason string non-empty), never throws.
- [ ] **U5** Missing `description` in frontmatter → `{ ok: false, reason }`,
      never throws.
- [ ] **U6** Malformed YAML frontmatter (unterminated, bad indentation) →
      `{ ok: false, reason }`, never throws.
- [ ] **U7** `expectedKind` mismatch (e.g. file under `skills/` folder but
      frontmatter implies an agent-only field) is surfaced as a non-throwing
      `{ ok: false }` or accepted per the function's documented contract —
      whichever PLAN's final signature commits to, test locks the chosen
      behavior so future changes are caught.
- [ ] **U8** Round-trip: parsing then "re-serializing" `parsed.body` is not
      required (Apply sends `body` verbatim, not a re-render) — instead
      assert `raw` (the original bytes) is preserved unmodified alongside
      `parsed`, so Copy markdown and Apply can be proven to read from the
      same string (AC2/AC7 root cause test, not just an e2e assertion).

### Auto-suffix algorithm (if extracted as a pure helper; otherwise covered
in daemon integration tests below)

- [ ] **U9** No existing artifact with that name+kind → returns the name
      unchanged, `wasRenamed: false`.
- [ ] **U10** One existing collision → returns `<name>-2`.
- [ ] **U11** Collisions through `-2`, `-3` already taken → returns first
      free suffix (e.g. `-4`), not `-2` again.
- [ ] **U12** Collision scoping is `(kind, name)` — an existing **agent**
      named `code-reviewer` does NOT block applying a **command** named
      `code-reviewer` (matches `validate.ts`'s own dup rule scoping).

## Unit/Integration — `apps/daemon` (Vitest, daemon integration per CLAUDE.md)

### `applyTemplate` RPC handler

- [ ] **D1** Applying a valid agent template to a project with no name
      collision: response has `wasRenamed: false`, `finalName === name`,
      `project.artifacts` contains exactly one new artifact with
      `meta.status === "draft"`, `meta.sourceTemplateId === sourceTemplateId`.
- [ ] **D2** Applying with an existing same-name-same-kind artifact present:
      response has `wasRenamed: true`, `finalName === "<name>-2"`; the
      ORIGINAL artifact is untouched (not overwritten, still present
      unmodified in `project.artifacts`).
- [ ] **D3** `applyTemplate` writes ONLY `.symbion/store.json` — assert no
      file under `<projectPath>/.claude/` or `<projectPath>/AGENTS.md`
      changes (mtime/hash before vs. after) — direct test of AC5(b)/AC8.
- [ ] **D4** `applyTemplate` with `template.kind: "skill"` (simulating a
      client bug bypassing the disabled button) → throws `RpcError`
      (`invalid-kind` or equivalent), no artifact persisted, store file
      unchanged.
- [ ] **D5** `applyTemplate` with empty/whitespace-only `name` or
      `description` → throws `RpcError`, no artifact persisted.
- [ ] **D6** `applyTemplate` with an unknown `projectId` → throws the same
      not-found error class `findProjectPath` already raises for every
      other project-scoped RPC (consistency check, not new behavior).
- [ ] **D7** `applyTemplate` requires the session token like every other
      non-read-only RPC — a request without `x-symbion-token` (or with a
      wrong one) is rejected by the existing server-level auth gate before
      reaching the handler (confirms `applyTemplate` was correctly NOT added
      to `READ_ONLY_METHODS` and gets no special-case auth bypass).
- [ ] **D8** Re-applying the SAME template to the SAME project twice in a
      row produces two independent draft artifacts (`name`, `name-2`) — both
      present, neither overwritten — documents the intentional no-idempotency
      decision from PLAN §4's edge-case table as an enforced behavior, not
      an accident.
- [ ] **D9** `applyTemplate`'s server-side `validateAllArtifacts` re-check
      (defense-in-depth) actually blocks if a future caller sends a `name`
      that fails `FILENAME_SAFE_RE` (e.g. contains a space) even though the
      auto-suffix loop wouldn't have caught it — proves the "belt and
      suspenders" validation path is live, not dead code.

## E2E — web journey (chrome-devtools / Playwright-style)

Maps directly to AC1-AC8.

- [ ] **E1 (AC1)** Navigate to app, click "Templates" tab in nav → URL is
      `/templates`; page renders exactly three section headings (Skills,
      Agents, Commands), each with at least one card; zero console errors
      logged during navigation/render.
- [ ] **E2 (AC2)** Click a template card → modal opens; modal's markdown
      viewer text is asserted byte-identical (via test fixture diff) against
      that template's known source content.
- [ ] **E3 (AC3)** In the modal, click "Copy markdown" → (a) a visible
      success acknowledgment appears (e.g. "Đã copy" line) without requiring
      a second interaction; (b) clipboard contents (read back via test
      harness clipboard permission) match the modal's displayed text
      byte-for-byte.
- [ ] **E4 (AC4)** With N known seeded projects registered, click "Áp dụng"
      on an Agent or Command card → picker step lists exactly those N
      projects (by name), no more, no fewer, no projects from a different
      seed/profile leaking in.
- [ ] **E5 (AC5a)** Select project X, confirm Apply → after success panel
      appears, navigate to project X in Builder → new artifact is present
      with `kind`/`name`/`description`/`body` matching the template, and
      visibly marked draft (whatever UI affordance Builder already uses for
      `status === "draft"`).
- [ ] **E6 (AC5b)** Before/after Apply in E5, snapshot the real filesystem
      under `<projectPath>/.claude/` (file list + hashes) — assert zero
      diffs immediately after Apply; only after a SEPARATE, explicit Publish
      action in Builder does a `.claude/` file appear/change.
- [ ] **E7 (AC6)** With zero registered projects (fresh profile / cleared
      `GlobalConfig.projects`), open a template modal, click "Áp dụng" →
      picker step shows the explicit "Chưa có dự án nào — tạo dự án trước"
      state (not a blank list, not a crash); clicking its CTA lands the user
      on a working Create Project flow.
- [ ] **E8 (AC7)** With a deliberately malformed template injected into the
      manifest (test-only fixture), load `/templates` → the malformed item
      does NOT appear as a clickable card, a visible inline reason is shown
      in its section, and every OTHER template in that section still lists
      and opens normally — page does not crash/blank.
- [ ] **E9 (AC8)** Confirm via network inspection that "Copy markdown" makes
      ZERO requests to the daemon origin; confirm "Áp dụng" makes exactly
      one `POST /rpc` with `method: "applyTemplate"` carrying the
      `x-symbion-token` header, same as every other mutating RPC call
      observed elsewhere in the app (consistency, not a new auth pattern).
- [ ] **E10** Skills card: open modal, confirm "Áp dụng" button is rendered
      disabled with the inline "coming soon" note always visible (not only
      on hover/click attempt); confirm "Copy markdown" still works
      identically to Agent/Command items.
- [ ] **E11** Daemon stopped (kill/simulate disconnect) while `/templates`
      is open: list/preview/copy markdown all continue to work
      uninterrupted; opening Apply step shows the daemon-down inline warning
      and "Xác nhận áp dụng" is disabled; "Quay lại"/"Đóng" remain clickable
      (user never trapped in the modal).
- [ ] **E12** Apply causing a name collision (seed project already has an
      artifact named identically to the template) → success panel explicitly
      states the renamed final name and the reason ("đã trùng tên... tự động
      đổi tên"); the pre-existing artifact in that project is verified
      unchanged (not overwritten) after navigating to Builder.
- [ ] **E13** Click "Mở dự án" from the Apply success panel → user lands on
      `/` with project X already selected/loaded (no extra manual click to
      pick the project again); URL no longer shows `?openProject=` after
      the handoff completes (history cleaned up, refreshing doesn't
      re-trigger the load).
- [ ] **E14** Click "Tạo dự án trước" from the zero-projects state (E7) →
      user lands on `/` with `CreateProjectDialog` already open.
- [ ] **E15** Clipboard permission denied (simulate via browser test
      harness) → "Copy markdown" shows the amber fallback warning and the
      markdown viewer content becomes select-all'd, no silent no-op, no
      thrown unhandled exception in console.

## Out of scope for this test plan (explicitly, per STATE §3)

- Live-fetch network failure modes (templates are vendored, not fetched —
  N/A).
- License/attribution legal review (product/legal task, not a test case).
- Skills "Apply" behavior beyond "button disabled" (no Skills Apply exists
  to test against in v1).
- Search/filter/versioning across templates (out of scope per STATE §3).
