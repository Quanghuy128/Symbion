# publish-to-npm — TEST PLAN

> Scope: Gate A only (STATE §5, §10, PLAN §11.7). Every test here verifies
> build/pack/dry-run/CI-shape outcomes. **No test in this plan executes a
> real `npm publish`, creates/uses an `NPM_TOKEN`, or triggers the CI
> `publish` job.** Tests that "would" exercise that job verify its
> structure by reading YAML, never by running it.

## A. Unit tests (Vitest)

### A1 — `scripts/build-package.mjs` staging logic
Location: new `scripts/build-package.test.ts` (or colocated
`scripts/__tests__/build-package.test.ts` — dev's choice of convention,
matching existing `apps/daemon` test layout).

1. **A1.1 — copies daemon dist and web out to the expected relative paths.**
   Given a fixture directory tree with `apps/daemon/dist/index.js` and
   `apps/web/out/index.html` present, running the staging step produces
   `apps/cli/apps/daemon/dist/index.js` and `apps/cli/apps/web/out/
   index.html` with matching byte content.
2. **A1.2 — version propagation.** Given a fixture root `package.json` with
   `"version": "1.2.3"`, after running the version-sync step,
   `apps/cli/package.json`'s `"version"` field reads exactly `"1.2.3"`.
3. **A1.3 — idempotent re-run.** Run the staging step twice in a row against
   the same fixture input; assert the second run's output tree is
   byte-identical to the first (no stale leftover files from a differently
   shaped previous build — simulate by first staging a fixture with an extra
   `apps/web/out/old-page.html`, then re-running staging against a fixture
   without that file, and asserting `old-page.html` is absent afterward).
4. **A1.4 — verification step fails loudly on incomplete build.** Given a
   fixture missing `apps/web/out/index.html`, assert the script throws/exits
   non-zero rather than completing "successfully" with a partial layout.
5. **A1.5 — vendored `node_modules` package.json correctness.** Assert the
   generated `apps/cli/node_modules/@symbion/core/package.json` has no
   `"dependencies"` field referencing `"*"` ranges and no leftover
   `@symbion/rpc-types`'s `"@symbion/core": "*"` dependency entry survives
   into its vendored copy (PLAN §11.2 step 7).

### A2 — `apps/cli/bin/symbion.mjs` argv parsing
Location: `apps/cli/bin/__tests__/symbion.test.ts` (or wherever
`apps/daemon` test conventions place CLI-adjacent unit tests — confirm with
existing `apps/daemon/*.test.ts` naming pattern before BUILD).

1. **A2.1 — `--version` prints bare semver and exits before importing the
   daemon module.** Spawn the script as a child process with `--version`;
   assert stdout is exactly `<version>\n` (no extra lines), exit code 0, and
   (via a stub/spy on `apps/daemon/dist/index.js`, or by asserting the real
   daemon's "đang chạy" line never appears in stdout within a short timeout)
   that the server/menu loop never starts.
2. **A2.2 — `-v` alias behaves identically to `--version`.**
3. **A2.3 — `--help` prints help text containing all three documented
   flags (`symbion`, `--version`/`-v`, `--help`/`-h`) and the doc URL
   `https://github.com/Quanghuy128/Symbion`, exits 0, daemon never starts.**
4. **A2.4 — `-h` alias behaves identically to `--help`.**
5. **A2.5 — unknown flag falls through to normal boot.** Spawn with
   `--bogus-flag`; assert the process does NOT exit early with an error —
   it proceeds to import/start the daemon module (can be verified by mocking
   `apps/daemon/dist/index.js` to a stub that just logs+exits, then
   asserting that stub's log line appears).
6. **A2.6 — no args at all also falls through to normal boot** (same
   assertion style as A2.5, with zero argv).
7. **A2.7 — version read from `apps/cli/package.json`, not hardcoded.**
   Stub/fixture a different `apps/cli/package.json` version value
   alongside the bin script and assert `--version`'s output matches the
   fixture's value, not any literal in the script source.

### A3 — `apps/daemon/src/index.ts` version banner (existing daemon test
suite — extend, don't replace)

1. **A3.1 — `SYMBION_VERSION` env var, when set, is used for both the new
   banner line and any place `VERSION` was previously hardcoded.**
2. **A3.2 — when `SYMBION_VERSION` is unset (today's `npm start` dev path),
   falls back to the existing `"0.1.0"` literal — confirms zero behavior
   change for the existing dev workflow** (regression guard specifically
   for PLAN §11.3's "backward compatible" claim).
3. **A3.3 — `findWebStaticRoot()` is unmodified.** A literal diff-based
   check (or a snapshot test of the function's source) is overkill for
   Vitest; instead, assert behaviorally: given a fixture directory with
   `apps/web/out` present at the expected sibling path, the function
   returns that path; given it absent, returns `undefined` — same as
   today's existing test (if one exists; if not, this is a new test that
   should already pass against the unmodified function, serving as a
   regression guard against accidental edits during this loop).

## B. Integration / packaging tests (Vitest or a plain Node script run via
`npm run`, dev's choice — must be runnable in CI without any registry
network call beyond what `npm pack`/`npm publish --dry-run` do locally)

### B1 — `npm pack` content verification
1. Run `npm run build:package` then, from `apps/cli/`, run `npm pack`.
2. Run `tar -tzf apps/cli/symbion-*.tgz` and assert the file list:
   - **Contains**: `package/bin/symbion.mjs`, `package/apps/daemon/dist/
     index.js`, `package/apps/web/out/index.html`, `package/node_modules/
     @symbion/core/dist/index.js`, `package/node_modules/@symbion/rpc-types/
     dist/index.js`, `package/README.md`, `package/LICENSE`,
     `package/package.json`.
   - **Does NOT contain**: any `.ts` file (`grep -v '\.ts$'` over the file
     list, allowing `.d.ts` only if present under `dist/` — confirm whether
     `tsc`'s `declaration: true` setting means `.d.ts` files ship too; if so
     assert *only* `.d.ts`/`.js`/`.json`/`.mjs`/`.md` extensions appear, no
     bare `.ts`), no `*.test.*` files, no `node_modules/@symbion/core/src/`
     (only `dist/`), no `.symbion/` directory, no `apps/cli/apps/` source
     duplication beyond the staged `dist`/`out`, no other workspace's
     `src/` tree (e.g. no `apps/web/app/`, `apps/web/components/` — only
     `apps/web/out/`).
   - Exact check shape: `tar -tzf symbion-*.tgz | grep -E '\.ts$'` must
     produce **zero** lines (excluding `.d.ts` if declarations are
     intentionally shipped — confirm and lock this distinction explicitly
     in the BUILD diff/PR description).

### B2 — Global install + boot smoke test (manual-step-friendly, scriptable
for CI)
1. In CI (or a throwaway local Docker/temp `$HOME`), set
   `npm config set prefix /tmp/symbion-test-global` (or `npm install -g
   --prefix <temp-dir>`) to avoid touching the real global npm prefix.
2. `npm install -g --prefix <temp-dir> ./apps/cli/symbion-<version>.tgz`.
3. Run `<temp-dir>/bin/symbion --version`; assert exit 0, stdout matches
   the version in `apps/cli/package.json`.
4. Run `<temp-dir>/bin/symbion --help`; assert exit 0, contains the three
   documented usage lines.
5. Run `<temp-dir>/bin/symbion` with stdin piped a single `3\n` (the "Exit"
   menu choice) and a short timeout; assert:
   - stdout contains a `Symbion v<version>` banner line before the
     "đang chạy"/menu lines (design.md §1 contract).
   - stdout contains the existing `Symbion daemon đang chạy: http://
     127.0.0.1:<port>/?t=...` line.
   - the process exits 0 after choosing "3) Exit" (matches today's existing
     exit behavior, unchanged).
6. **Critical layout check**: before step 5, independently verify (e.g. via
   a debug env var or by inspecting daemon stdout/logs if it logs
   `webStaticRoot`) that `findWebStaticRoot()` resolved to a real,
   `existsSync`-true path from inside the installed tarball's layout — not
   just "the menu appeared," since a missing/broken web root silently
   returns `undefined` today (R2) and would not otherwise surface as a
   visible failure. Recommend temporarily adding a debug log line during
   this specific test run (or asserting indirectly: hit `GET
   http://127.0.0.1:<port>/` over HTTP during the brief window the server is
   up in step 5, before sending "3", and assert it returns the static
   `index.html` content rather than a 404 — this is the strongest possible
   verification since it exercises the real HTTP serve path end to end).

### B3 — `npm publish --dry-run` exits 0
1. From `apps/cli/` (post `build:package`), run `npm publish --dry-run`.
2. Assert exit code 0.
3. Assert stdout/stderr does not contain any error about missing `files`,
   invalid `name` format, or missing required manifest fields.
4. This test must run in CI without any `NPM_TOKEN`/auth configured —
   confirm it still exits 0 in that exact no-auth condition (this is the
   condition CI will actually run under), not just when a developer happens
   to have `npm login`-cached credentials locally. If `--dry-run` is found
   to require auth to fully validate (some npm versions warn-but-continue on
   missing auth for dry-run; behavior should be empirically confirmed during
   BUILD/QA, not assumed), document the actual observed exit code/behavior
   in QA notes and flag back to architect if it diverges from "exits 0
   without auth."

## C. Regression tests (must still pass, unmodified expectations)

1. **C1** — `npm run test` (full existing Vitest suite across all
   workspaces) passes with zero new failures after all packaging changes.
2. **C2** — `npm run build` (existing root build, NOT `build:package`)
   still succeeds and produces the same `apps/daemon/dist` and
   `apps/web/out` outputs as before this loop — i.e. `build:package` is
   additive and never replaces or breaks the existing build script dev/CI
   already rely on.
3. **C3** — `npm start` (existing dev/clone workflow) still boots correctly
   from a fresh clone, unaffected by `SYMBION_VERSION` being unset (falls
   back per A3.2) and unaffected by the new `apps/cli` workspace member
   existing alongside it.
4. **C4** — existing Playwright e2e suite (`npm run test:e2e`) passes
   unmodified — packaging must not change any web UI behavior (this feature
   has explicitly no web UI surface per design.md's framing).

## D. CI workflow YAML verification (read-only — never trigger)

1. **D1** — `.github/workflows/publish.yml` parses as valid YAML (e.g.
   `yaml.safeLoad`/`js-yaml` or `actionlint` if available; at minimum,
   `node -e "require('yaml').parse(fs.readFileSync('.github/workflows/
   publish.yml','utf8'))"` must not throw).
2. **D2** — `on.push.tags` contains exactly `v*.*.*` and there is no
   `on.push.branches`, no `on.pull_request`, no bare `on: push` without a
   tag filter — i.e. the trigger cannot fire on an ordinary commit to
   `master`.
3. **D3** — there are exactly two top-level jobs; the job that runs `npm
   publish` (non-dry-run) has a top-level `environment:` key with a `name:`
   value, and that job is NOT the same job as the one running `npm pack`/
   `npm publish --dry-run`.
4. **D4** — `grep -n "NPM_TOKEN" .github/workflows/publish.yml` shows the
   string appearing only inside the gated `publish` job's `env:` block (or
   `with:`), never inside the `build-test-pack` job, never inside an `on:`
   or top-level workflow key.
5. **D5** — `grep -rn "NPM_TOKEN\|npm_token\|registry.npmjs.org/-/user" .` 
   across the whole repo diff for this PR finds zero matches outside the
   one expected reference in `publish.yml` itself — confirms no token value,
   `.npmrc` credential line, or auth config was accidentally introduced
   anywhere else (e.g. no new root/`apps/cli/.npmrc` file at all should
   exist post-BUILD; confirm via `find . -iname ".npmrc"` returning nothing
   new).
6. **D6** — confirm (manually, by a human or by `gh api repos/Quanghuy128/
   Symbion/environments`) that no GitHub Environment named `npm-publish`
   exists in the repo today — i.e. the `publish` job is currently
   unrunnable by construction, not merely by policy. This check documents
   the state at PLAN/BUILD time; it is expected to still show "does not
   exist" through Gate A's entire lifecycle for this loop.

## E. Explicit non-goals for this test plan (do not write these tests)

- Do NOT write a test that calls the real `npm publish` (non-dry-run)
  against the real registry, under any flag or mock.
- Do NOT write a test that creates, reads, or asserts against a real
  `NPM_TOKEN` value (env var, secret, or `.npmrc` entry) — env-var-shaped
  tests above (A3.1) use `SYMBION_VERSION`, an unrelated, non-secret value.
- Do NOT write a test that triggers `.github/workflows/publish.yml` via
  `gh workflow run` or a tag push as part of automated QA for this loop —
  D1-D6 are static-analysis/read-only checks of the YAML file only.

## Suggested next step

Hand this test plan, alongside `docs/loops/publish-to-npm-STATE.md` §11
(PLAN), to `feature-builder`/`dev` for `/build`. After BUILD, `/review`
should run both `code-reviewer` and `architect` (architectural-drift check
against PLAN §11), and `/cso` is required per STATE §11.7 before `/ship`.
