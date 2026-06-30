# publish-to-npm — STATE

**Phase: Done**

## 0. Origin

GitHub Issue #9 ("[Issue] publish symbion to npm"):

> Context / Current Behavior: To use Symbion, developers currently need to
> clone the repository locally and run `npm start`.
> Expectation / Desired Behavior: As a developer, I want to be able to
> install Symbion as an npm package using `npm i symbion` (or
> `npm i -g symbion` for global CLI use) to simplify the setup process and
> integrate it easily into existing projects.

## 1. Problem (user story)

> As a developer who wants to try or adopt Symbion, I want to install it with
> a single `npm i -g symbion` (or `npm i symbion` as a project dependency)
> instead of cloning the monorepo, running `npm install`, and running
> `npm run build && npm run start` — so that trying Symbion has the same
> friction as trying any other CLI tool.

Today, `apps/daemon/package.json` and `apps/web/package.json` are both
`"private": true` workspace packages inside the `symbion` root workspace
(`/home/huynq12/symbion/package.json`, also `"private": true`). Nothing in
this repo is currently shaped to be published — there is no public-facing
package name, no `bin` entry, no `files`/`exports` allowlist, and no
`.github/workflows/` CI at all (none found in this repo).

## 2. Codebase findings (what's already in place vs. what's missing)

This matters a lot for scoping the engineering work — Symbion is **closer to
publish-ready than the issue text implies**, because of decisions already
made in past loops:

**Already in place (re-usable, do not rebuild):**
- `apps/web/next.config.mjs` already sets `output: "export"` — "Web is served
  by the daemon (static export) per STATE §8 #6." This means apps/web is
  **not** a server that needs `next start`/SSR/API routes at runtime — it
  builds to static HTML/JS/CSS (`apps/web/out/`) that the daemon serves
  itself over its own HTTP server. This removes the single biggest risk
  (bundling a live Next.js server process inside an npm package).
- `apps/daemon/src/index.ts` already resolves `apps/web/out` as a **relative
  sibling path** from the daemon's own compiled location
  (`dirname(import.meta.url)/../../web/out`) via `findWebStaticRoot()`, and
  treats it as optional (`existsSync` guard, falls back to undefined). This
  is the load-bearing fact for the publish design: the daemon already
  expects to find a pre-built static web bundle next to itself on disk, not
  to spawn a separate `next` process. The packaging question becomes "how do
  we make `apps/web/out` end up at that relative path inside the published
  package" rather than "do we need a new mechanism for this."
- `apps/daemon/src/boot/menu.ts` is already an interactive terminal menu
  (Web UI / Hide to Tray / Exit) driven by stdin/stdout — i.e. `index.ts` is
  already CLI-shaped (prints a URL, offers to open default browser via
  `xdg-open`/`open`/`start`, can detach to background). It does not assume
  it's being run via `npm run start` for any reason other than that's the
  current root-level script wiring `build -w @symbion/daemon && node
  apps/daemon/dist/index.js` (`/home/huynq12/symbion/package.json` line 16).
  There is no hardcoded reference to being inside a git clone or to
  `apps/*`/`packages/*` workspace siblings other than the one relative
  `web/out` lookup above.
- Root `engines: { "node": ">=18" }` already declared.

**Missing (real new engineering work for this loop):**
- No `bin` field anywhere — a global install (`npm i -g symbion`) requires a
  package.json `bin` entry pointing at an executable (shebang `#!/usr/bin/env
  node`) script, and currently `apps/daemon/dist/index.js` has no shebang and
  is not designed to be invoked as `symbion` from an arbitrary cwd outside
  the monorepo.
- No top-level publishable package shape exists. `@symbion/core`,
  `@symbion/daemon`, `@symbion/web` are all `"private": true` internal
  workspace packages with `@symbion/` scoping — none of them is named
  `symbion` (unscoped) today. Publishing requires deciding which artifact
  becomes the thing literally named `symbion` on the registry (see open
  question Q1).
- No build step today produces a single self-contained, installable unit
  that includes both the daemon's compiled JS *and* `apps/web/out`'s static
  bundle in one place with correct relative positioning. `npm run build`
  (root) is `npm run build -ws --if-present`, which builds each workspace
  package into its own `dist`/`out` in place — fine for local dev, untested
  for "pack into one npm tarball."
- No `.github/workflows/` directory exists — there is no existing CI to
  extend with a publish job; this is a from-scratch addition, not a
  modification of an existing pipeline.
- No prior npm registry history for this project — package name
  availability for the unscoped name `symbion` is **unverified** (see risk
  R1, this cannot be checked by the agent and must be confirmed by a human
  with registry access before any real publish attempt).
- No `files`/`.npmignore` allowlist — without one, `npm pack` would currently
  include source, tests, `node_modules` references via workspace symlinks,
  etc. Needs explicit scoping so the published tarball contains only what a
  consumer needs (compiled daemon JS + the static web bundle + a thin CLI
  entry), not the whole monorepo.
- No versioning/release process beyond the static `"version": "0.1.0"`
  literal duplicated across all four package.json files (root, core, daemon,
  web) with no changelog, no tagging convention, and no semver-bump
  automation. This loop needs to either establish a minimal one (e.g.
  version bump + git tag triggers the publish workflow) or explicitly defer
  it as "manually bump version, manually tag" for v1.

## 3. Scope

### In scope (this loop)
- Define what "engineering-ready to publish" means as a measurable, testable
  state (see Acceptance Criteria, §5) — packaging shape, `bin` entry,
  bundling apps/web's static export alongside the daemon, a `files`/ignore
  allowlist, and a CI workflow that *can* run `npm publish` on a trigger
  (e.g. git tag or GitHub Release) but is not itself triggered as part of
  this loop.
- `npm pack` producing a tarball that, when installed in a clean temp
  directory/global prefix, lets a user run `symbion` (or `npx symbion`) and
  reach the same boot-menu experience available today via `npm run start`
  from a clone.
- `npm publish --dry-run` succeeding against the packaged shape (validates
  manifest correctness, file inclusion, registry-name format — does **not**
  touch the real registry).
- Deciding (with the user, see open questions) which workspace artifact
  becomes the published `symbion` package and whether `packages/core` and
  `apps/web` are published as supporting packages too, or fully internal/
  bundled and invisible to the consumer.

### Out of scope (explicitly — do not let `/design` or `/plan` smuggle these in)
- **Executing a real `npm publish` to the public registry.** This is the
  single most consequential scope boundary in this loop — see §6, flagged as
  an open decision the user must make explicitly, not a default.
- Verifying the unscoped name `symbion` is actually available on the public
  npm registry — the agent cannot check this live; it is a precondition a
  human must verify out-of-band before any real publish, listed as risk R1.
- Setting up real registry credentials, `NPM_TOKEN` secrets, npm 2FA/granular
  access tokens in CI, or an npm organization/account for this project.
- A `npx symbion` "run without installing" experience beyond what falls out
  naturally from having a correct `bin` entry (no special UX polish pass).
- Publishing `@symbion/core` as a standalone reusable library for *other*
  projects to import (this issue is about installing the *tool*, not
  consuming `packages/core` as a library — that would be a distinct,
  separate feature request).
- Auto-update / self-update mechanics for the global CLI (e.g. "Symbion
  checks for a newer version on boot") — not requested by the issue, would
  add scope.
- Cross-platform installer polish (Windows path quirks, macOS
  notarization-equivalent concerns) beyond "the `bin` script and the
  `open`/`xdg-open`/`start` shell-out in `index.ts` already account for
  win32/darwin/linux" — already-existing behavior, not new work, but also
  not a target for *additional* hardening in this loop unless QA finds a
  concrete break.

## 4. Functional requirements

1. A published package named `symbion` (pending name-availability
   confirmation, see Q1/R1) must, once installed globally
   (`npm i -g symbion`) and invoked as `symbion` from any directory, launch
   the same daemon + boot menu (`Web UI / Hide to Tray / Exit`) that
   `npm run start` launches today from a cloned repo.
2. The package must include a pre-built static export of `apps/web`
   (`apps/web/out` equivalent) at the relative path the daemon's
   `findWebStaticRoot()` already expects, so "open Web UI" works
   out-of-the-box with no separate build step required from the consumer.
3. The package must NOT require the consumer to have Node-level dev tooling
   (TypeScript, Vitest, Playwright, tsx) installed — only compiled output
   ships; devDependencies must not leak into the published tarball's runtime
   path.
4. `npm i symbion` (non-global, as a project dependency) must install
   without error and expose the same `bin`-resolved CLI when run via
   `npx symbion` or `./node_modules/.bin/symbion`, even though the primary
   intended use per the issue is the `-g` global form.
5. The packaged CLI must preserve all current filesystem-safety guarantees
   (path confinement, backup-before-write, managed-file marker checks per
   `CLAUDE.md` "Filesystem safety") — packaging must not change daemon
   behavior, only how it is distributed and launched.
6. A CI workflow file must exist (e.g. `.github/workflows/publish.yml`) that,
   on a defined trigger (git tag matching a version pattern, or a GitHub
   Release event — exact trigger is an open question, see Q4), runs build +
   test + `npm publish`. This loop adds the workflow; it does not need to be
   exercised for a real publish as part of this loop (see §6).
7. Versioning: every publish-eligible build must have a single, unambiguous
   version number that ends up both in the published `package.json` and
   importable at runtime (e.g. `symbion --version`), sourced from one place
   (not four independently-edited `package.json` version fields silently
   drifting).

## 5. Acceptance criteria — split into two gates (see §6 for why)

### Gate A — "Engineering is ready to publish" (in scope for this loop)
- [ ] A `package.json` exists for the publishable unit with: a `bin` field
      pointing to an executable shebang script, a `files` (or equivalent
      `.npmignore`) allowlist, `"name"` set to the agreed publish name (or a
      clearly marked placeholder pending Q1), and a real semver `"version"`.
- [ ] `npm run build` (or an equivalent dedicated `build:package` script)
      produces, in one pass, both the compiled daemon JS and `apps/web/out`
      positioned at the relative path the daemon's existing
      `findWebStaticRoot()` lookup expects — verified by running the
      resulting `dist`/package layout's entry script directly (not just via
      workspace `npm run start`) and confirming `findWebStaticRoot()`
      resolves to a path that exists.
- [ ] `npm pack` succeeds and produces a tarball whose contents, when
      inspected (`tar -tzf`), contain only the intended runtime files (no
      `.ts` sources, no test files, no `node_modules`, no other workspace
      packages' source trees beyond what's bundled/compiled in).
- [ ] Installing that tarball globally in a clean throwaway environment
      (`npm i -g ./symbion-<version>.tgz`) and running `symbion` reaches the
      same boot menu behavior as today's `npm run start` — confirmed
      manually (this is a packaging/CLI-boot check, not a deep functional
      regression suite; daemon RPC behavior itself is unchanged and already
      covered by existing Vitest suites).
- [ ] `npm publish --dry-run` exits 0 against the final packaged shape (this
      validates manifest + registry-name-format + auth-config correctness
      without touching the real registry).
- [ ] `.github/workflows/<publish>.yml` exists, is syntactically valid, and
      its publish step is gated behind a tag/release trigger (i.e. it must
      NOT run on every push to `master`) — confirmed by reading the workflow
      file's `on:` block, not by triggering it.
- [ ] All existing Vitest suites (`npm run test`) and the build (`npm run
      build`) still pass unmodified after packaging changes — packaging must
      not regress existing functionality.

### Gate B — "Actually published to the public registry" (OUT of scope for this loop — see §6)
- [ ] A real `npm publish` (or CI run of the publish workflow against a real
      tag) has executed against the public npm registry.
- [ ] `npm i -g symbion` succeeds for an end user with no prior relationship
      to this repository, pulling from the public registry.
- [ ] The package name `symbion` is confirmed registered and owned by this
      project's npm account/org.

These two gates are deliberately listed separately so that `/ship` for this
loop can be satisfied by Gate A alone, without anyone mistaking "the
workflow exists" for "we are live on npm."

## 6. Critical open question — flagged explicitly, not defaulted

**Does this loop's scope end at Gate A (engineering-ready: package builds,
`npm pack` produces a working tarball, dry-run publish succeeds, a CI
workflow exists that *could* publish on a tag/release trigger), or does it
include Gate B (actually executing a live `npm publish` to the public
registry)?**

Recommendation: **scope this loop to Gate A only.** Reasoning:
- A real `npm publish` is irreversible in practice — npm's own policy is
  that unpublishing after 72 hours is effectively not available, and even
  within 72 hours unpublishing a name that another package may have already
  started depending on is disruptive.
- A live publish requires registry credentials (an npm account/org, a
  granular access token or 2FA-backed login) that should not be generated,
  stored, or used unilaterally by an autonomous agent — this is a
  credentials/trust decision for the human owner, structurally similar to
  how `CLAUDE.md`'s filesystem-safety rules forbid silent destructive writes
  ("never write silently... user confirm... backup-before-write").
- The unscoped package name `symbion` has not been confirmed available (see
  R1) — publishing before confirming this either fails outright or, worse,
  could squat/conflict with an unrelated existing package.
- Everything genuinely useful to *prepare* for publish (packaging, bin
  script, CI workflow, dry-run validation) is safe, fully reversible,
  ordinary engineering that can proceed now without this decision being
  made yet.

This is surfaced here as an explicit decision for the user to make — not
assumed. See open question Q5 below.

## 7. Open questions (taste/priority decisions only the user can make)

1. **Q1 — What exactly gets published as `symbion`?** Options: (a) a new
   thin wrapper package (e.g. could literally be `apps/daemon` renamed/
   repackaged) that bundles the daemon + pre-built web static export and is
   the only thing published; (b) publish `@symbion/core`,
   `@symbion/daemon`-as-`symbion`, etc. as multiple public packages; (c)
   something else. The codebase today has no package literally named
   `symbion` — only the private root workspace manifest uses that name.
   Recommend (a) (single consumer-facing package, internals stay
   unpublished/bundled) but this is a product/architecture call, not
   something the analyst should decide.
2. **Q2 — Scoped or unscoped name?** `symbion` (unscoped, matches the issue's
   literal `npm i symbion` request) vs. `@<your-org-or-username>/symbion`
   (scoped, avoids the unscoped-name-collision risk in R1 but does not match
   the issue's literal request and changes the install command users see).
3. **Q3 — `npm i symbion` (local dependency) vs. `npm i -g symbion` (global
   CLI) — is one the "real" primary target and the other just "should not
   break," or are both equally first-class?** This affects whether the
   `package.json` needs a `main`/programmatic export at all (a local install
   only makes sense if something is importable, not just the `bin`) or
   whether it can be a CLI-only package with no meaningful `require/import`
   surface.
4. **Q4 — Publish trigger for the CI workflow:** git tag push (e.g.
   `v*.*.*`), GitHub Release creation, or manual `workflow_dispatch` only
   (requiring a human to click "Run workflow" in the GitHub UI even after
   Gate B is eventually approved)? This determines how much "automatic" is
   baked into the eventual real-publish path even though it won't fire
   during this loop.
5. **Q5 — Confirm the Gate A vs. Gate B scope split in §6.** Explicit
   sign-off needed: this loop's `/ship` will be considered complete at Gate
   A (dry-run only). A real `npm publish` would be a deliberate, separate,
   human-triggered action afterward (manual CLI command or manually
   approving/triggering the CI job) — not something `/ship` or any agent in
   this pipeline does autonomously. Please confirm this is acceptable, or
   say if Gate B should somehow be included (in which case: who holds the
   npm credentials, and how/when do they get used?).

## 8. Risk notes (for architect/dev — carry forward into PLAN)

- **R1 — Name availability is unverified and unverifiable by the agent.**
  Whether `symbion` (unscoped) is free on the public npm registry must be
  checked by a human with registry access before Gate B, regardless of how
  Q1/Q2 resolve. If taken, Q2's scoped-name fallback should be pre-agreed so
  this doesn't block later.
- **R2 — Packaging drift vs. monorepo dev experience.** Today `apps/daemon`
  resolves `apps/web/out` via a relative path assuming a specific on-disk
  layout (`dist/index.js` -> `../../web/out`). Any packaging strategy that
  changes this relative layout (e.g. flattening into a single package
  directory) must update or re-verify `findWebStaticRoot()` — getting this
  wrong silently breaks the Web UI launch path with no error surfaced to
  the user beyond "Web UI option does nothing" (the current code treats a
  missing static root as merely `undefined`, not a hard failure — confirm
  with architect whether that silent-fallback behavior is still acceptable
  once this matters for real end users rather than local dev).
- **R3 — Version-field drift.** Four independent `"version": "0.1.0"`
  literals exist today (root, core, daemon, web) with no single source of
  truth. If left as-is, a publish workflow could publish a package whose
  internal `--version` output doesn't match its own `package.json` version,
  or whose dependency on `@symbion/core`/`@symbion/rpc-types` (`"*"` ranges,
  workspace-protocol-style) doesn't resolve correctly outside the workspace
  context — `"*"` as a dependency range is workspace-monorepo-only behavior
  and will not resolve against the public registry at all if those packages
  aren't also published. This must be resolved in PLAN (either: publish the
  scoped packages too with pinned versions, or bundle them so they never
  appear as external dependencies in the published manifest).
- **R4 — devDependency/test leakage into the published tarball.** No
  `files`/`.npmignore` exists today; without explicit scoping, a careless
  `npm publish` could ship source `.ts`, test fixtures, or even `.symbion/`
  user data directories if run from the wrong cwd. This is a filesystem-
  safety-adjacent risk even though it's about *npm's* file inclusion, not
  Symbion's own write-path confinement — still worth a CSO-style check in
  REVIEW given it determines what becomes permanently public.
- **R5 — CI secret handling.** Once a publish workflow exists (Gate A
  requirement), the `NPM_TOKEN` (or equivalent) needed for Gate B's
  eventual real-publish is a new secret class for this repo's CI — even
  though this loop doesn't use it, the workflow file's shape (where it
  expects the secret to come from, what permission scope it requests)
  should get a `/cso` look in REVIEW since it's a credential-handling
  surface, per `CLAUDE.md`'s guidance to run security-reviewer when
  "touching... secrets."

## 9. Suggested next step

Spec is locked enough to proceed to `/office-hours` (THINK) to lock the five
open questions above (Q1-Q5) with the user before `/design`/`/plan` choose a
concrete packaging architecture — Q1 (what gets published) and Q5 (Gate A/B
scope confirmation) in particular will materially change what the architect
designs, so they should not be guessed.

## 10. THINK — autopilot decisions (unattended run, no user present)

This run was triggered by a 15-minute cron loop reading GitHub Issues with no
human present to answer §7's 5 open questions in real time. Per autopilot's
own rule (documented in `docs/learnings.md`: pick the minimal-scope/safest/
most-reversible reading and document it for review, rather than guessing
silently or blocking entirely), each decision below adopts the BA's own
explicit recommendation, since the BA already did the work of identifying the
lowest-risk reading for each question.

1. **Q5 — Gate A only, Gate B explicitly NOT executed by this run.** This is
   the load-bearing decision for the entire loop and is treated as
   **non-negotiable, not just a default**: this autopilot run will produce a
   correctly packaged, dry-run-validated, CI-workflow-ready state and will
   **never run a real `npm publish`, never create or use npm registry
   credentials, and never trigger the CI publish workflow for a live run.**
   Rationale (from the BA's own §6): a real publish is irreversible in
   practice (npm's 72-hour unpublish window, after which removal is
   effectively unavailable), requires credentials/2FA that must be a human
   trust decision, and the unscoped name's availability is unverified and
   unverifiable by this agent. This mirrors CLAUDE.md's "never write
   silently, never take an irreversible action without explicit human
   confirmation" principle applied to a registry write instead of a
   filesystem write. **If a human reviewer wants Gate B to actually happen,
   that is a deliberate separate action taken by a human with registry
   credentials, after reviewing this PR — never something this pipeline run
   does on its own.**
2. **Q1 — Single new wrapper package** (option a): a new publishable package
   (not a rename of `@symbion/daemon` in place, to avoid disturbing the
   existing internal workspace package naming/imports — PLAN will decide the
   exact mechanism) bundles the compiled daemon + the pre-built `apps/web`
   static export, and is the only thing published under the `symbion` name.
   `packages/core`, `@symbion/daemon`, `@symbion/web` internals stay private/
   unpublished, consistent with "this issue is about installing the tool,
   not consuming `packages/core` as a library" (already correctly scoped out
   in §3).
3. **Q2 — Unscoped name `symbion`, with a pre-agreed scoped fallback.**
   Matches the issue's literal request (`npm i symbion`). Per R1, actual
   availability is unverified — PLAN/BUILD should structure the package.json
   so the name is a single, easily-changed field, and this decision explicitly
   does not block on name verification since Gate B (the only point where
   name availability matters) is out of scope for this run anyway.
4. **Q3 — CLI (`-g`) is the primary target; local install must not break.**
   The package ships `bin` as its primary surface. A minimal `main`/export
   is only added if PLAN finds it's needed for `npm i symbion` (non-global)
   to install without error — not for any new programmatic-API use case
   (explicitly out of scope per §3, this is not a library-publish feature).
5. **Q4 — CI publish trigger: git tag push matching `v*.*.*`.** Chosen over
   GitHub Release events (extra manual step, no added safety benefit here)
   and over pure `workflow_dispatch`-only (less standard, harder to audit
   later "what tag = what publish"). Crucially, per Q5, this trigger is
   wired but never fired by this autopilot run — choosing a tag-based
   trigger now does not cause a publish to happen during this loop; it only
   determines what a human would do later to actually invoke Gate B.

**R5 (CI secret handling) is treated as a hard requirement for REVIEW, not a
taste call**: per CLAUDE.md's guidance to run security-reviewer when
"touching... secrets," the new CI workflow file's shape (where it expects
`NPM_TOKEN` to come from, what permission scope it requests) gets a `/cso`
pass even though no real secret is created, stored, or used by this loop —
the workflow's *shape* is the security-relevant artifact, not its execution.

All five decisions are reversible (a package name field, a CI trigger
condition, and a publish target are all easy to change later) and Q5's
restriction is treated as binding for the rest of this pipeline run, not just
documented and then quietly revisited under build/ship pressure.

## 11. PLAN — Architecture (Gate A only — no real `npm publish`, ever, in this loop)

> Hard boundary restated and binding for this section: every artifact below
> produces build/pack/dry-run-only outcomes. No step in this PLAN creates,
> stores, or uses an `NPM_TOKEN`/registry credential, and no step executes a
> real `npm publish`. See §11.7 for the explicit confirmation statement.

**Ground-truth correction vs. design.md**: design.md §0/§4 claims "no
`README.md` exists anywhere in this repo today." This is **false** — a
3.8KB `/home/huynq12/symbion/README.md` already exists with Installation/
Architecture/Running-locally sections written for the clone workflow. PLAN
treats README.md as an **edit target** (add an `npm i -g symbion` path
alongside the existing clone path), not greenfield content — BUILD must not
overwrite the existing License/Architecture/Tests sections. This is flagged
as a design-doc drift for the record; it does not change any locked
decision, only the BUILD diff shape for README.md.

### 11.1 Where the publishable package lives, and exact shape

**Decision: introduce a new `apps/cli/` workspace package** (not `apps/daemon`
renamed in place, per THINK Q1's explicit "not a rename" guidance) that is a
**thin assembled wrapper**, not a thin re-export. Concretely:

- New directory `apps/cli/` joins the `apps/*` workspace glob already in root
  `package.json` (`workspaces: ["packages/*", "apps/*"]`) — no workspace
  config change needed.
- `apps/cli/package.json` is the literal `"name": "symbion"` manifest — this
  is the package that gets packed/published. It has **no source of its own**
  beyond a tiny shebang `bin/symbion.mjs` (hand-written, not compiled — see
  11.3) and a build script that **stages/copies** `apps/daemon/dist/` and
  `apps/web/out/` into its own directory tree at publish-build time.
- **Critical layout constraint (R2)**: `findWebStaticRoot()` in
  `apps/daemon/src/index.ts` is **NOT modified**. It computes
  `dirname(thisFile)/../../web/out` unconditionally. Verified by tracing the
  actual code: with `thisFile` at `.../apps/daemon/dist/index.js`, `../../`
  lands at the package root, then `web/out`. Therefore the staged package
  **must** reproduce the sibling pair `apps/daemon/dist/` and `apps/web/out/`
  at the published package root, unchanged in shape from the monorepo's own
  `apps/daemon` and `apps/web` directories. The compiled daemon entry point
  inside the published tarball must end up on disk at
  `<install-root>/apps/daemon/dist/index.js`, and the static export at
  `<install-root>/apps/web/out/`.
- Concretely, `apps/cli/` is laid out as:
  ```
  apps/cli/
    package.json          # the "symbion" manifest (bin, files, version)
    bin/symbion.mjs        # shebang entry, argv parsing (11.3)
    apps/                  # STAGED, not source-controlled — gitignored,
      daemon/dist/          #   populated by the build:package script (11.2)
      web/out/
    README.md              # copied from root README.md at build time (single
                             #   source of truth stays root README.md; copy
                             #   step, not a second hand-maintained copy)
  ```
  `apps/cli/apps/` is added to root `.gitignore` (new entry, alongside the
  existing `dist/`/`out/` lines) since it is 100% build output, never
  authored by hand and never committed.
- Why a staging copy instead of `npm pack`-ing `apps/daemon` directly with a
  symlink/relative reference to `apps/web/out`: `npm pack`/`npm publish`
  **do not follow symlinks across workspace package boundaries** reliably for
  publish (npm packs the resolved-real-file content of whatever `files`
  matches, but a relative symlink pointing *outside* the package directory
  being packed is excluded entirely by npm's packer, which only includes
  files inside the package root). Copying real files at build time avoids
  this entirely and keeps the design "no new resolution mechanism," matching
  R2's spirit (findWebStaticRoot itself truly never changes).

**`apps/cli/package.json` exact shape:**
```jsonc
{
  "name": "symbion",
  "version": "0.1.0",          // see 11.1.1 — sourced from root, kept in sync by build, not hand-edited here
  "description": "Local-daemon + web UI for authoring AI-coding autoworkflows.",
  "private": false,
  "type": "module",
  "bin": { "symbion": "./bin/symbion.mjs" },
  "files": [
    "bin/",
    "apps/daemon/dist/",
    "apps/web/out/",
    "README.md",
    "LICENSE"
  ],
  "engines": { "node": ">=18" },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Quanghuy128/Symbion.git"
  },
  "homepage": "https://github.com/Quanghuy128/Symbion",
  "publishConfig": { "access": "public" },
  "dependencies": {}
}
```
Notes:
- No `main`/`exports` field — per THINK Q3 (CLI-primary, no programmatic API
  requested), a `bin`-only package is valid for both `npm i -g symbion` and
  `npm i symbion` (local install just places it in
  `node_modules/.bin/symbion`, resolvable via `npx symbion`); Node does not
  require a `main` field for a package with no `require()`/`import` use case.
- `dependencies: {}` is intentional and load-bearing for R3's second half —
  see 11.1.2.
- `"private": false` is the one field that, if ever flipped back to `true`
  by an accidental copy-paste from another workspace package.json, would
  silently make `npm publish`/`--dry-run` refuse to run — call this out
  explicitly to BUILD as a footgun to watch for.

#### 11.1.1 — R3 resolved: single version source of truth

**Decision: root `package.json`'s `"version"` field is the single source of
truth.** Mechanism:
- `apps/cli/package.json`'s own `"version"` field is **written by the build
  script** (11.2 step 1), copying root `package.json`'s version verbatim,
  immediately before `npm pack`/`npm publish --dry-run` run — never hand-
  edited independently. This is a plain `node -e` / small script step, not a
  new dependency (no changesets/lerna introduced — out of scope, root README
  and STATE already note "no versioning automation exists," and this loop
  does not need to add a bump tool, only a single-source propagation).
- `apps/daemon`'s and `apps/web`'s own `package.json` `"version"` fields are
  **left as-is** (they stay `0.1.0` literals, internal/private, never
  published) — they are not consumer-visible and PLAN does not attempt to
  unify all four files' versions, only the one that matters externally
  (`apps/cli/package.json`, the published manifest).
- The **runtime** `--version`/banner value (design.md §1, §3) must match.
  `apps/daemon/src/index.ts`'s `const VERSION = "0.1.0"` literal is replaced
  with a value read from `apps/daemon/package.json`'s own `version` field at
  build/runtime (e.g. `import pkg from "../package.json" with { type:
  "json" }` or a small generated `version.ts` — dev's choice, either works
  since `apps/daemon/package.json` is not published and its version field is
  cosmetic/internal). **However**, to make the *published* CLI's
  `--version` match the *published package.json*'s version (the actual
  externally-visible contract), the bin script (11.3) reads version from
  `apps/cli/package.json` at the package root (the file two directories up
  from `bin/symbion.mjs`), not from the daemon's internal copy — this is the
  value a consumer's `npm ls -g symbion` / `cat package.json` and `symbion
  --version` must agree on. Concretely: `bin/symbion.mjs` does
  `JSON.parse(readFileSync(join(here, "..", "package.json")))` once, passes
  that string into both the `--version` short-circuit and (via an env var or
  a small `--print-version-banner`-style argv flag forwarded into
  `index.js`) the boot banner — avoiding two independent reads.
- Net effect on R3: only **one** file (`apps/cli/package.json`'s `version`)
  is the externally observable truth; everything else either copies from it
  at build time or stays a private internal cosmetic value that no consumer
  ever sees.

#### 11.1.2 — R3 resolved: workspace dependency resolution

**Decision: bundle, do not depend.** `apps/cli/package.json` declares
**zero** runtime dependencies on `@symbion/core` / `@symbion/rpc-types`.
Justification:
- `apps/daemon`'s compiled `dist/` output already contains fully resolved
  relative `import` paths to its own compiled JS (TypeScript `NodeNext`
  module resolution + `tsc` does not inline `@symbion/core`'s code into
  `apps/daemon/dist/` — it leaves `import ... from "@symbion/core"`
  unresolved as a bare specifier, which **would** require `@symbion/core`
  to be a real resolvable `node_modules` entry at runtime).
- Therefore the build step (11.2) must also copy the **compiled** `dist/`
  output of `packages/core` and `packages/rpc-types` into
  `apps/cli/node_modules/@symbion/core` and
  `apps/cli/node_modules/@symbion/rpc-types` respectively (a vendored
  `node_modules`, included in the `files` allowlist) — this is simpler and
  safer than the alternative (publishing `@symbion/core`/`@symbion/rpc-types`
  as their own public packages with pinned versions), because:
  - It requires zero new public package names/registry surface (THINK/STATE
    §3 explicitly scoped publishing `packages/core` as a reusable library
    out of this loop).
  - It avoids a second version-pinning problem (if `@symbion/core` were
    published separately, `apps/cli`'s dependency on it would need its own
    pinned semver range, doubling R3's surface).
  - npm itself supports shipping a `node_modules/` directory inside a
    published tarball (uncommon but valid; `files` allowlist controls
    exactly what's included, and `bundledDependencies`/vendoring this way
    is a documented pattern for exactly this "internal-only sibling
    package" case).
- Updated `files` allowlist (supersedes 11.1's first draft):
  ```jsonc
  "files": [
    "bin/",
    "apps/daemon/dist/",
    "apps/web/out/",
    "node_modules/@symbion/core/",
    "node_modules/@symbion/rpc-types/",
    "README.md",
    "LICENSE"
  ]
  ```
- `package.json`'s `"dependencies"` stays `{}` — these are vendored files,
  not npm-resolved dependencies, so no `"*"`/workspace-protocol range ever
  appears in the published manifest (fully resolves R3's second half: there
  is no unresolvable dependency range in the shipped package.json at all).

### 11.2 Build pipeline — exact sequence

**New root script `build:package`** (does not replace or modify the existing
`npm run build`/`npm start` dev scripts — additive only):

```jsonc
// root package.json scripts (added, others unchanged)
"build:package": "node scripts/build-package.mjs"
```

`scripts/build-package.mjs` (new file, root-level `scripts/` dir, plain
Node, no new devDependency) performs, in order:
1. Run `npm run build -ws --if-present` (reuses the existing root build —
   compiles `packages/core`, `packages/rpc-types`, `apps/daemon` to their own
   `dist/`, and runs `apps/web`'s `next build` to `apps/web/out/`). No
   change to this existing step.
2. Read root `package.json`'s `version`; write it into
   `apps/cli/package.json`'s `version` field (JSON read-modify-write, single
   field).
3. Clean `apps/cli/apps/` and `apps/cli/node_modules/` (rimraf-equivalent via
   `fs.rmSync(..., { recursive: true, force: true })` — no new dependency).
4. Copy `apps/daemon/dist/` → `apps/cli/apps/daemon/dist/` (recursive file
   copy via `fs.cpSync`, Node >=16.7 built-in, no dependency needed).
5. Copy `apps/web/out/` → `apps/cli/apps/web/out/`.
6. Copy `packages/core/dist/` → `apps/cli/node_modules/@symbion/core/dist/`
   + write a minimal `apps/cli/node_modules/@symbion/core/package.json`
   (name/version/main/type/exports copied from the real
   `packages/core/package.json`, "private" field stripped/ignored since this
   copy is never itself published standalone — it's an inert file sitting
   inside another package's tarball).
7. Same for `packages/rpc-types/dist/` →
   `apps/cli/node_modules/@symbion/rpc-types/dist/` (this one also has its
   own `dependencies: { "@symbion/core": "*" }` in the source manifest — the
   copied/written package.json for the vendored copy must have this stripped
   too, since `@symbion/core` is already a vendored sibling under the same
   `node_modules/`, resolved by Node's own `node_modules` lookup, not by npm
   install — no separate dependency declaration needed inside the vendored
   manifest).
8. Copy root `README.md` → `apps/cli/README.md`; copy root `LICENSE` →
   `apps/cli/LICENSE`.
9. **Verification step (fails the script, non-zero exit, if false)**:
   `existsSync(join("apps/cli/apps/daemon/dist/index.js"))` AND
   `existsSync(join("apps/cli/apps/web/out/index.html"))` — i.e. the script
   self-checks the exact layout `findWebStaticRoot()` will need before
   declaring success. This directly operationalizes Gate A's acceptance
   criterion ("confirming `findWebStaticRoot()` resolves to a path that
   exists").

This is a **new** script, not a modification of `npm run build` — `npm run
build` (today's dev-loop command, used by `npm start` and CI's existing
expectations) stays exactly as-is; `build:package` is build-then-stage,
strictly additive, callable independently right before `npm pack`/`npm
publish --dry-run` are run from inside `apps/cli/`.

### 11.3 The bin script

`apps/cli/bin/symbion.mjs` (hand-written, not compiled — it is intentionally
plain ESM with no build step of its own, since it only does argv parsing +
process delegation, and being un-compiled means there's one less moving
part between "what's in the published tarball" and "what's reviewable in a
PR diff"):

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
const VERSION = pkg.version;

const HELP = `Symbion v${VERSION} — local-daemon + web UI for authoring AI-coding autoworkflows

Usage:
  symbion                Start the daemon and open the boot menu
  symbion --version, -v  Print the installed version
  symbion --help, -h     Show this help message

Once running, the boot menu lets you open the Web UI in your browser,
hide the daemon to run in the background, or exit.

Docs: https://github.com/Quanghuy128/Symbion
`;

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

// Unknown/no flags: fall through to normal boot (design.md §3, §6 #2 locked).
process.env.SYMBION_VERSION = VERSION; // single source read once, passed down — daemon's
                                        // own index.ts prints the banner using this instead
                                        // of its own hardcoded literal (11.1.1).
await import("../apps/daemon/dist/index.js");
```

Required companion change in `apps/daemon/src/index.ts` (the **only**
behavioral edit to daemon source in this whole loop, and it is additive —
existing dev flow via `npm start` still works because `process.env.
SYMBION_VERSION` is undefined there and the code falls back to the existing
literal):
```ts
const VERSION = process.env.SYMBION_VERSION ?? "0.1.0";
console.log(`Symbion v${VERSION}`);          // new banner line, design.md §1
console.log(`Symbion daemon đang chạy: ${url}`); // existing line, unchanged
```
This keeps `findWebStaticRoot()` **byte-for-byte unmodified** (R2's explicit
ask) and confines the only daemon-source edit to a two-line addition with a
safe fallback default, fully backward compatible with today's `npm start`.

### 11.4 CI workflow — `.github/workflows/publish.yml`

```yaml
name: Publish

on:
  push:
    tags:
      - "v*.*.*"

jobs:
  build-test-pack:
    name: Build, test, pack, dry-run
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          registry-url: "https://registry.npmjs.org"

      - name: Install dependencies
        run: npm ci

      - name: Build (all workspaces)
        run: npm run build

      - name: Run tests
        run: npm run test

      - name: Build publishable package layout
        run: npm run build:package

      - name: Pack
        working-directory: apps/cli
        run: npm pack

      - name: Upload packed tarball as CI artifact
        uses: actions/upload-artifact@v4
        with:
          name: symbion-tarball
          path: apps/cli/symbion-*.tgz

      - name: Dry-run publish validation
        working-directory: apps/cli
        run: npm publish --dry-run

  publish:
    name: Publish to npm registry (manual approval required)
    needs: build-test-pack
    runs-on: ubuntu-latest
    environment:
      name: npm-publish
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          registry-url: "https://registry.npmjs.org"

      - name: Install dependencies
        run: npm ci

      - name: Build publishable package layout
        run: npm run build && npm run build:package

      - name: Publish
        working-directory: apps/cli
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Security-relevant structural properties (for `/cso` to verify by reading,
not by triggering):**
- `on:` block triggers only on `v*.*.*` tag pushes — never on push to
  `master`/branches, never on PRs. This satisfies Gate A's explicit
  acceptance criterion.
- The `publish` job is a **separate job** (not a step in
  `build-test-pack`), gated with `environment: { name: npm-publish }`. A
  GitHub Environment named `npm-publish` **does not exist in this repo
  today** and is **not created by this PLAN, this loop, or any script in
  it** — creating it (and attaching required-reviewer protection rules) is
  an out-of-band, human, repo-admin action taken in the GitHub UI, deliberately
  not automatable from inside this PR. Until a human creates that
  Environment AND adds required-reviewer protection to it, the `publish` job
  cannot run at all even if a tag is pushed (GitHub blocks any job whose
  `environment:` doesn't exist/isn't configured from proceeding) — i.e. the
  job is **structurally inert by omission**, not just by policy.
- `secrets.NPM_TOKEN` is referenced **only** inside the gated `publish`
  job's `env:` — this loop does **not** add `NPM_TOKEN` to the repo's Actions
  secrets (Settings → Secrets → Actions). Referencing an undefined secret in
  a workflow file is inert (GitHub Actions resolves an unset secret
  reference to an empty string, it does not error or auto-create anything,
  and `npm publish` would simply fail auth if this job ever ran without a
  real token configured) — so even in the hypothetical where a human
  manually triggers/approves this job today, it would fail for lack of a
  token, not silently succeed.
- No `workflow_dispatch` trigger is added — this loop deliberately keeps the
  only trigger as the tag push (THINK Q4), so there is no manual "Run
  workflow" button surfaced in the Actions UI that could be misclicked
  either.
- The `build-test-pack` job's `npm publish --dry-run` step requires npm to
  be "logged in" in some form to fully validate auth — without
  `registry-url`/an `NODE_AUTH_TOKEN`, `--dry-run` still validates manifest
  shape/file-inclusion/name-format (the parts Gate A cares about) but will
  report an auth warning/skip the auth-validation portion; this is
  acceptable and expected for Gate A (no token exists), and should not be
  treated as a CI failure — `npm publish --dry-run` exits 0 without a valid
  auth token as long as the package shape itself is valid; only a *real*
  `npm publish` requires real auth.

### 11.5 Edge cases

- **Hand-edited managed files**: N/A to this feature directly — packaging
  does not touch the daemon's own managed-file-marker/conflict logic at all;
  confirmed no changes to `apps/daemon/src/fs/writeFiles.ts` or `rpc/`.
- **Foreign/unmanaged files**: N/A — `build-package.mjs` only ever
  reads from `packages/*/dist`, `apps/daemon/dist`, `apps/web/out` (all
  build outputs, not user data) and writes only inside `apps/cli/` (a
  package the build itself owns). It never touches a target repo's files.
- **Invalid frontmatter**: N/A — no IR/frontmatter surface in this feature.
- **Daemon disconnect mid-edit**: N/A — this feature does not add new RPC
  surface; the existing daemon RPC/disconnect handling is unchanged.
- **Partial publish failure** (relevant analog here: partial *build*
  failure): `build-package.mjs`'s step 9 verification (11.2) causes a
  non-zero exit if either `apps/daemon/dist/index.js` or
  `apps/web/out/index.html` is missing after staging — this prevents
  `npm pack`/`npm publish --dry-run` from ever running against a half-built
  package, surfacing the failure at build time rather than producing a
  broken tarball that looks succeeded.
- **Re-publish unchanged (idempotent)**: `build-package.mjs` step 3
  (`fs.rmSync(..., { recursive: true, force: true })` on `apps/cli/apps/`
  and `apps/cli/node_modules/` before re-copying) makes the staging step
  fully idempotent — re-running `build:package` any number of times
  produces the same output, never accumulates stale files from a previous
  build (e.g. a deleted `apps/web/out` page from a prior build would
  otherwise linger).
- **Version mismatch between root package.json and a stray manual edit of
  `apps/cli/package.json`'s version**: build step 2 always overwrites
  `apps/cli/package.json`'s `version` field from root on every
  `build:package` run — a manual edit to `apps/cli/package.json`'s version
  field alone (without changing root) is silently clobbered on next build.
  This is intentional (single source of truth, 11.1.1) but should be called
  out as a documented gotcha for dev, since it is the one place a future
  contributor might be surprised by build-time overwrite.

### 11.6 Trade-offs and assumptions for dev/Checker to track

1. **Assumption**: `fs.cpSync` (Node >=16.7) and `fs.rmSync` with
   `recursive`/`force` (Node >=14.14) are both available given the project's
   `engines.node >= 18` floor — no new dependency (e.g. `rimraf`,
   `fs-extra`) needed for `scripts/build-package.mjs`. Dev should confirm
   this holds when implementing; if any edge case surfaces (e.g. Windows
   path quirks in CI's `ubuntu-latest` runner — moot, since CI only runs on
   Linux), flag back to architect.
2. **Trade-off**: vendoring `@symbion/core`/`@symbion/rpc-types` into a
   hand-assembled `node_modules/` inside `apps/cli` (11.1.2) is unusual but
   deliberately chosen over publishing them as separate public packages —
   simpler, smaller security/maintenance surface, fully reversible later
   (nothing prevents publishing them properly in a future loop if a real
   "consume `@symbion/core` as a library" need appears, which is explicitly
   out of scope here per STATE §3).
3. **Trade-off**: the daemon source edit in 11.3 (env-var-driven version
   fallback) is the **only** runtime behavior change in this entire loop,
   and it was sized to be the absolute minimum needed to satisfy design.md
   §1's version banner while keeping `findWebStaticRoot()` untouched. Code
   reviewer should verify no other daemon source lines were touched.
2. **Assumption**: GitHub's behavior that a job referencing a
   non-existent `environment:` name cannot run is the current, documented
   behavior as of this writing; if dev/CSO finds GitHub has changed this
   (e.g. silently treating an unconfigured environment as "no protection"),
   that changes 11.4's safety argument materially and must be flagged back
   to architect/CSO immediately — this is the single fact 11.4's entire
   safety argument leans on most heavily, beyond the absence of the
   `NPM_TOKEN` secret itself.
4. **Assumption**: `apps/cli` as a new workspace member does not break
   `npm run build -ws --if-present` (root) or `vitest.workspace.ts` — since
   `apps/cli` has no `build`/`test` script of its own (only `bin/` + static
   copied assets, no source to compile or test in the conventional sense),
   `--if-present` skips it harmlessly. Dev should confirm this empirically
   after adding the package.json (no script entries needed beyond what's
   shown in 11.1).

### 11.7 Explicit non-negotiable-boundary confirmation

This PLAN produces:
- **Zero real `npm publish`** executions, by design and by omission (no step
  in 11.2-11.4 invokes a non-dry-run `npm publish` outside the gated,
  human-approval-required CI job, and that job itself cannot run without a
  human first creating a GitHub Environment that does not exist today).
- **Zero `NPM_TOKEN` creation, storage, or use.** No script, workflow step,
  or instruction in this PLAN creates an npm access token, writes one to a
  `.npmrc`, or adds one to GitHub Actions secrets. The workflow file
  *references* `secrets.NPM_TOKEN` by name only, inside the gated job —
  referencing an undefined secret name is inert.
- The CI workflow's `publish` job is **structurally inert** until a human
  (a) creates a GitHub Environment named `npm-publish` with required-reviewer
  protection in repo Settings, AND (b) adds a real `NPM_TOKEN` to that
  Environment's secrets — both deliberately absent from this loop's
  deliverables.

**`/cso` is required for this loop's REVIEW**, per CLAUDE.md's "run
security-reviewer when touching... secrets" trigger and per STATE §8 R5 /
§10's explicit instruction that R5 is "a hard requirement for REVIEW, not a
taste call." The CSO should focus specifically on: (a) the `on:` trigger
scope (tag-only, no branch/PR triggers), (b) the two-job split and the
`environment:` gate on the `publish` job, (c) confirming no `NPM_TOKEN` value
or `.npmrc` credential appears anywhere in this PR's diff, and (d) the `files`
allowlist in `apps/cli/package.json` (R4) to confirm no source/test/`.symbion`
data could leak into a real future publish.

## 12. BUILD — implementation notes (feature-builder)

**Phase: BUILD (Gate A) — closing out an undocumented prior work session.**
This run did not start BUILD from scratch: `apps/cli/`, `scripts/
build-package.mjs`, `.github/workflows/publish.yml`, the `apps/daemon/src/
index.ts` VERSION edit, the root `package.json` `build:package` script, the
`.gitignore` additions, and the README.md edits already existed in the
working tree on entry. This session's job was to verify each artifact
against PLAN §11 line-by-line, run the full build→pack→dry-run→test pipeline
for real, fix any genuine bugs found, and document the result — not to
re-author working code.

### 12.1 What was already correct, verified as-is

- `apps/cli/bin/symbion.mjs` — byte-for-byte matches PLAN §11.3 (`--version`/
  `-v`, `--help`/`-h`, fall-through-to-boot for unknown/no args, version read
  once from `apps/cli/package.json` two directories up, `SYMBION_VERSION` env
  var forwarded before `import("../apps/daemon/dist/index.js")`).
- `apps/daemon/src/index.ts` — the only daemon-source edit in the whole loop
  is exactly the two lines PLAN §11.3 specified: `const VERSION =
  process.env.SYMBION_VERSION ?? "0.1.0"` and a new `console.log(\`Symbion
  v${VERSION}\`)` banner line ahead of the existing unchanged "đang chạy"
  line. `findWebStaticRoot()` is untouched (confirmed by re-reading the
  function body — still the unconditional `dirname(thisFile)/../../web/out`
  lookup PLAN §11.1/R2 requires stay byte-for-byte unmodified). Verified `git
  diff apps/daemon/src/index.ts` touches no other lines.
- `scripts/build-package.mjs` — implements PLAN §11.2 steps 1-9 faithfully:
  version sync from root `package.json`, idempotent clean of `apps/cli/apps/`
  + `apps/cli/node_modules/`, daemon-dist + web-out staging, vendoring of
  `@symbion/core` and `@symbion/rpc-types` with dependency-stripping exactly
  per §11.2 step 7 (rpc-types' vendored `package.json` has no `"@symbion/
  core": "*"` left in it — confirmed by reading the script's
  `stripDependencies: true` call), README/LICENSE copy, and a hard-failing
  verification step that checks all five expected staged paths exist.
- `.github/workflows/publish.yml` — confirmed byte-identical to PLAN §11.4:
  `on.push.tags: ["v*.*.*"]` only (no branches, no pull_request), exactly two
  top-level jobs (`build-test-pack`, `publish`), `NPM_TOKEN` referenced only
  inside the gated `publish` job's `env:` block, `publish` job has a top-level
  `environment: { name: npm-publish }` key and is a separate job from the
  dry-run job. Re-parsed with Node's `yaml` package to confirm valid YAML
  (testplan D1) and grepped for `NPM_TOKEN`/`.npmrc` across the whole repo
  (testplan D4/D5) — zero stray references found anywhere outside this one
  workflow file and the STATE/design/testplan docs themselves.
- Root `package.json`'s `workspaces: ["packages/*", "apps/*"]` already covers
  `apps/cli` via the existing glob — no edit needed, confirmed empirically:
  `npm run build` (root) ran `build -ws --if-present` across all four
  packages and silently skipped `apps/cli` (no `build` script defined there),
  exactly as PLAN §11.6 assumption 4 predicted.
- README.md edit is additive only — new "## Installation"/"## Usage"
  sections added before the existing content, which was renamed "## Running
  from a clone (contributing / local development)" rather than deleted, per
  PLAN's "edit target, not greenfield" correction in §11's preamble.

### 12.2 Real bug found and fixed

**`.gitignore` was missing entries for `apps/cli/README.md` and
`apps/cli/LICENSE`.** These two files are pure build output — written fresh
on every `build:package` run by `copyDocs()` (copied from the root
`README.md`/`LICENSE`, never hand-edited in place, per PLAN §11.1's layout
comment "single source of truth stays root README.md; copy step, not a
second hand-maintained copy"). Before this fix, `apps/cli/apps/`,
`apps/cli/node_modules/` (covered by the existing global `node_modules/`
rule), and `apps/cli/*.tgz` were gitignored, but the copied `README.md`/
`LICENSE` were not — so `git add -A` or `git add apps/cli` would have staged
two large duplicate files that look hand-authored but are actually stale the
moment root README.md changes again. Fixed by adding two lines to root
`.gitignore`:
```
apps/cli/README.md
apps/cli/LICENSE
```
Verified post-fix: `git add -An apps/cli` now stages exactly
`apps/cli/bin/symbion.mjs` and `apps/cli/package.json` — the only two
hand-authored files in that directory — and nothing else.

### 12.3 Confirmed NOT a bug — the `yaml` vendoring addition

`scripts/build-package.mjs`'s `vendorYaml()` step and `apps/cli/package.json`'s
`files`/`dependencies`/`bundledDependencies` already correctly include
`node_modules/yaml/` / `"yaml": "2.9.0"` — this was already fixed in the
working tree before this session started (the task brief asked me to verify
this specifically; I confirmed it by reading both files directly). This is a
sensible, in-spirit-with-PLAN addition: `packages/core/dist/index.js`
eagerly re-exports `render/frontmatter.js`, which imports the real npm
`yaml` package at module-load time, so `yaml` is reachable from daemon boot
via `store.ts`'s import of `@symbion/core` — without vendoring it, the
published tarball would crash on first `require`/`import` of `@symbion/core`
in a real consumer's `node_modules`-less environment. Confirmed via `tar
-tzf` on the actual packed tarball that `node_modules/yaml/dist/**` (237
total vendored files across all three vendored packages) really is present
in the package, not just referenced in `files`.

### 12.4 Critical finding — NOT a bug in this codebase, but a hard blocker for Gate B

**The unscoped npm package name `symbion` is already taken on the public
registry by an unrelated project.** Running `npm publish --dry-run` from
`apps/cli/` (with no `NPM_TOKEN`/auth configured, exactly the CI condition
testplan B3.4 asks to confirm) does **not** exit 0 as PLAN §11.4's "Security-
relevant structural properties" section predicted ("`npm publish --dry-run`
exits 0 without a valid auth token as long as the package shape itself is
valid"). Instead:
```
npm warn This command requires you to be logged in to https://registry.npmjs.org/ (dry-run)
npm error Cannot implicitly apply the "latest" tag because previously
published version 0.9.0 is higher than the new version 0.1.0. You must
specify a tag using --tag.
```
Exit code: **1**, not 0. Confirmed independently via `npm view symbion`
(read-only, no auth needed, no write/publish action taken):
```
symbion@0.9.0 | MIT | deps: none | versions: 2
Powerful Integrated Sensing and Communication (ISAC) Algorithm Library for
Research and Development
https://symbion-io.org
published 6 months ago by symbion-io <yujx.res@gmail.com>
```
This is a completely unrelated package (a 5G/6G wireless-sensing research
library) that already owns the unscoped `symbion` name, with two published
versions (`0.0.0`, `0.9.0`). This directly resolves STATE §8 risk **R1**
("name availability is unverified and unverifiable by the agent") — it
turns out R1 *was* verifiable via a plain read-only `npm view`/`npm publish
--dry-run` call, no auth or credentials needed, and the answer is **the name
is taken, not merely unverified.**

**This does not block Gate A as originally scoped** (PLAN §5 Gate A's
acceptance list: package builds, `npm pack` produces a correct tarball,
CI workflow exists and is structurally inert — all still true and verified
independently of the dry-run's exit code), but it does mean:
1. PLAN §11.4's specific claim that `--dry-run` "exits 0... only a *real*
   `npm publish` requires real auth" is **factually wrong for this specific
   package name** — npm's registry-name/version-conflict check runs as part
   of dry-run validation too, before/independent of the auth check, and a
   taken name fails dry-run with exit 1 regardless of auth state. The CI
   workflow's `build-test-pack` job's "Dry-run publish validation" step
   **will fail in CI today** if run as-is, for this reason alone (not for
   any packaging defect) — this is a real, observable problem for anyone who
   pushes a `v*.*.*` tag expecting Gate A's checks to pass.
2. THINK §10 Q2's decision ("unscoped name `symbion`, with a pre-agreed
   scoped fallback") explicitly anticipated this exact scenario and already
   named the mitigation: switch to a scoped name (e.g.
   `@<org-or-username>/symbion`). This loop's scope (per §6/§10 Q5) does not
   include making that product decision unilaterally — I have **not**
   changed `apps/cli/package.json`'s `"name"` field, since that is exactly
   the kind of taste/product call CLAUDE.md and this STATE file repeatedly
   flag as the user's to make, not an autonomous fix.
3. I did **not** attempt any workaround (no `--tag`, no version bump, no
   name change) to force the dry-run to exit 0, since every workaround here
   touches the one open product decision (Q2) this loop's own THINK section
   declined to resolve unilaterally.

**Flagging explicitly for the Checker/human:** Gate A's acceptance criterion
"`npm publish --dry-run` exits 0 against the final packaged shape" (STATE
§5) is **not currently met**, and cannot be met without either (a) a human
confirming registry ownership of `symbion` is achievable some other way
(unlikely — this is an actively-published, unrelated, real package), or (b)
a human picking a scoped name per Q2's pre-agreed fallback and updating
`apps/cli/package.json`'s `"name"` (and, separately, deciding whether
`"publishConfig": { "access": "public" }` needs to move/stay once scoped).
This is a **product decision, not a code defect** — flagging it rather than
guessing a replacement name.

### 12.5 Verification run log (this session)

All commands run from repo root unless noted; none executed a real `npm
publish` and no `NPM_TOKEN`/credential/`.npmrc` was created at any point.

1. `npm run build` — succeeds, builds `@symbion/core`, `@symbion/rpc-types`,
   `@symbion/daemon` (tsc) and `@symbion/web` (`next build` → `apps/web/out`,
   5 static pages). `apps/cli` has no `build` script, silently skipped by
   `--if-present` as expected.
2. `npm run build:package` — succeeds, all 9 steps log success, verification
   step confirms all 5 expected staged paths exist.
3. `cd apps/cli && npm pack` — succeeds. Tarball: 743.0 kB packed / 2.5 MB
   unpacked, 371 own files + 3 bundled deps (yaml, @symbion/core,
   @symbion/rpc-types). `tar -tzf` confirms: zero bare `.ts` files, zero
   `apps/web/app|components/` source leakage, 237 real vendored
   `node_modules/**` files physically present (not just listed).
4. `cd apps/cli && npm publish --dry-run` — **exits 1**, for the name-
   collision reason in §12.4 above, not a packaging defect. Manifest/file-
   shape itself validated successfully (the full tarball-contents listing
   printed correctly before the registry-side error).
5. `node apps/cli/bin/symbion.mjs --version` → prints `0.1.0`, exit 0,
   matches root `package.json`'s version exactly.
6. `node apps/cli/bin/symbion.mjs --help` → prints all three documented
   flags + the GitHub docs URL, exit 0, no crash.
7. End-to-end boot smoke test: `echo "3" | node apps/cli/bin/symbion.mjs`
   (timeout-guarded) → prints `Symbion v0.1.0` banner line, then the
   existing `Symbion daemon đang chạy: http://127.0.0.1:<port>/?t=...` line,
   shows the `1) Web UI  2) Hide to Tray  3) Exit` menu, exits cleanly on
   `3`. Confirms `findWebStaticRoot()` resolution and the whole packaged
   layout work end-to-end from the actual `apps/cli/bin/symbion.mjs` entry
   point, not just via workspace `npm start`.
8. `npm run test:core` — 13 files, 77 tests, all pass.
9. `npm run test:daemon` — 18 files, 230 tests, all pass. Zero regressions
   from the `VERSION`/banner change in `apps/daemon/src/index.ts`.
10. CI YAML checks (testplan D1-D6): parsed with Node's `yaml` package
    (valid), confirmed `on.push.tags` is exactly `["v*.*.*"]` with no
    `branches`/`pull_request` keys, confirmed exactly two top-level jobs with
    `NPM_TOKEN` appearing only in the gated `publish` job's `env:`, confirmed
    via `gh api repos/Quanghuy128/Symbion/environments` that zero GitHub
    Environments currently exist in the repo (so the `publish` job is
    structurally inert today, exactly as PLAN §11.4/§11.7 require).
11. Repo-wide grep for `NPM_TOKEN`/`.npmrc` — only hits are the one expected
    reference in `.github/workflows/publish.yml` and the STATE/design/
    testplan docs that discuss it; zero `.npmrc` files exist anywhere in the
    repo.

### 12.6 Known gap — not closed this session

**Testplan §A1/§A2 unit tests do not exist yet.** The testplan calls for new
Vitest suites at `scripts/build-package.test.ts` (A1.1-A1.5: staging copy
correctness, version propagation, idempotent re-run, fail-loud on incomplete
build, vendored package.json correctness) and `apps/cli/bin/__tests__/
symbion.test.ts` (A2.1-A2.7: `--version`/`-v`/`--help`/`-h`/fall-through/
no-args/version-read-from-file behavior, via child-process spawning). Neither
file exists in the repo today. I verified the equivalent behavior manually
(§12.5 items 2, 5, 6, 7) and it all passes, but there is no automated
regression coverage for `scripts/build-package.mjs` or `apps/cli/bin/
symbion.mjs` — a future change to either could silently break packaging with
no CI signal until someone runs `build:package`/`npm pack` by hand. This
session's explicit task list (verification + bug-fixing + documentation) did
not include authoring new test files, so I'm flagging this as an open item
rather than adding ~12 new test cases unreviewed. Recommend a follow-up
`/build` pass (or this same loop's continuation) specifically to add A1/A2
before `/ship`, since STATE §5 Gate A's acceptance list implicitly assumes
testplan coverage exists.

### 12.7 Assumptions made this session (for Checker to verify)

1. The pre-existing build artifacts (apps/cli/**, scripts/build-package.mjs,
   .github/workflows/publish.yml, the daemon VERSION edit, README.md edit,
   root package.json script, original two .gitignore lines) were authored by
   an earlier, undocumented agent/human session and were not re-derived from
   scratch by me — I verified them against PLAN §11 by reading + running
   them, not by re-implementing. If the Checker finds any of §12.1's "already
   correct" claims wrong, that reflects a verification miss on my part, not
   an intentional re-author.
2. Adding `apps/cli/README.md` and `apps/cli/LICENSE` to `.gitignore` is
   correct and matches the spirit of PLAN §11.1's "copy step, not a second
   hand-maintained copy" framing — I assumed this was an oversight in the
   prior session rather than an intentional choice to track those copies,
   since tracking generated duplicate-content files in git contradicts the
   single-source-of-truth design PLAN explicitly calls out for README.md and
   has no stated rationale anywhere in STATE/design for LICENSE either.
3. I assumed it was correct to leave `apps/cli/package.json`'s `"name":
   "symbion"` field unchanged despite confirming the name is taken (§12.4),
   rather than unilaterally switching to a scoped fallback name — this
   followed THINK §10 Q5's explicit instruction that decisions touching Q1/Q2
   are the user's to make, not something BUILD should resolve by guessing.
   If the Checker or user wants me to proactively switch to a scoped name as
   part of closing out this loop, that needs explicit confirmation first
   (which exact scope/org string to use is itself unspecified anywhere in
   STATE).
4. I did not modify `.github/workflows/publish.yml`'s `build-test-pack` job
   to tolerate the dry-run's exit-1-on-name-collision (e.g. by adding `||
   true` or `continue-on-error`) — per the task's explicit instruction not to
   modify the CI workflow's trigger scope or job structure beyond fixing
   genuine *bugs*, and because silencing this failure would mask a real,
   user-relevant signal (the workflow correctly fails today, for a real
   reason, and should keep failing until Q2 is resolved with a name that
   isn't taken) rather than being itself a bug to fix.
5. I removed the leftover `apps/cli/symbion-0.1.0.tgz` produced by my own
   verification `npm pack` run at the end of this session (it would have
   been gitignored anyway via `apps/cli/*.tgz`, but I deleted it rather than
   leave build cruft sitting in the working tree post-verification).

## Suggested next step

This loop's `/build` phase is now substantively complete and verified, with
one open product decision blocking full Gate A closure (§12.4 — package name
collision) and one testing gap (§12.6 — missing A1/A2 unit tests). Recommend:
1. Surface §12.4 to the user/PM directly — this is not something `/review` or
   `/cso` can resolve, it needs a human decision on Q2's scoped-name fallback
   (exact scope string) before `npm publish --dry-run` can ever exit 0 for
   real, in CI or locally.
2. Either fold a quick A1/A2 test-writing pass into this same BUILD phase
   before `/review`, or explicitly accept the gap and note it in the PR
   description for `/review`/`/qa` to see.
3. Run `/review` (code-reviewer + architect) and `/cso` (mandatory per STATE
   §11.7/§10's R5 framing) on the current diff regardless of §12.4/§12.6 —
   neither blocks a security/architecture review of what's already built,
   they only block `/ship`'s Gate A acceptance-criteria checklist.

### 12.8 — User naming decision applied (post-BUILD)

User confirmed: package name is **`@quanghuy128/symbion`** (scoped, per Q2's
pre-agreed fallback). Changes applied immediately after BUILD sign-off:
- `apps/cli/package.json` `"name"` updated from `"symbion"` to `"@quanghuy128/symbion"`.
- `apps/cli/bin/symbion.mjs` HELP text updated to reference the correct install command
  (`npm i -g @quanghuy128/symbion`).
- `npm run build:package` re-run successfully (staging step idempotent — all 9 steps PASS).
- `npm publish --dry-run` re-run from `apps/cli/` → exits 0 with output
  `+ @quanghuy128/symbion@0.1.0` and only the expected login warning (no registry error).
  Gate A dry-run acceptance criterion NOW MET.
- `node apps/cli/bin/symbion.mjs --version` → `0.1.0` ✓; `--help` → correct usage text ✓.

## 13. REVIEW

### 13.1 CSO findings (security-reviewer)

**Verdict: NEEDS-WORK** → fixed same session.

- **🟠 F1 — CI artifact glob mismatch**: `publish.yml` upload path `apps/cli/symbion-*.tgz` does not match scoped tarball `quanghuy128-symbion-0.1.0.tgz`. Silent no-op upload. **Fixed**: changed to `apps/cli/*.tgz`.
- **🟠 F2 — Publish job rebuilds from scratch**: `publish` job did not download the tested tarball — it re-ran `build && build:package && npm publish`. What was tested ≠ what was shipped. **Fixed**: publish job now uses `actions/download-artifact@v4` + `npm publish *.tgz` instead of rebuilding.
- **🟡 F3 — No `permissions:` block**: GITHUB_TOKEN defaulted to over-broad write access. **Fixed**: added `permissions: { contents: read }` at workflow top level.
- **🟡 F4 — `dependencies` has bundled package entries (contradicts PLAN §11.1.2's `"dependencies: {}"`)**: PLAN said zero declared dependencies. BUILD added `dependencies` + `bundledDependencies`. **Resolution after testing**: `bundledDependencies` requires corresponding `dependencies` entries to work — npm's packer excludes `node_modules/` even when listed in `files` unless the package is in both `dependencies` AND `bundledDependencies`. Removing `dependencies` reduced tarball from 371 to 134 files with zero vendored content. PLAN §11.1.2's `"dependencies: {}"` was architecturally incorrect for the `bundledDependencies` mechanism chosen. The current `dependencies` + `bundledDependencies` pattern is the required implementation and stays; STATE is updated to document this as a necessary PLAN deviation, not an error.
- **🟡 F5 — Vendored yaml staleness not auto-detected**: informational, deferred to follow-up.
- **✅ (a) Trigger scope**, **(b) Two-job split + environment gate**, **(c) No NPM_TOKEN/credential in diff**, **(d) `files` allowlist — no source leakage**, **(e) Write confinement**: all PASS.

### 13.2 Architect findings

**Verdict: NEEDS-WORK** → fixed same session (same findings as CSO F1, F2 + README).

- **🔴 F1 — CI artifact glob mismatch** (same as CSO F1): Fixed (see §13.1).
- **🔴 F3 — README still uses unscoped `symbion` name**: `npm install -g symbion` would install the unrelated 5G library. **Fixed**: updated both `npm install -g @quanghuy128/symbion` and `npm install @quanghuy128/symbion` in README.md Installation section.
- **🟡 F2 — `dependencies` deviation from PLAN**: same as CSO F4 — resolved by testing, kept as-is with STATE documentation.
- **✅ F4 (findWebStaticRoot path math)**, **F5 (bin script reads right package.json)**, **F6 (Node module resolution for vendored packages)**, **F7 (syncVersion)**, **F8 (CI two-job structure)**, **F9 (workspace integration)**, **F10 (daemon edit)**: all PASS.

### 13.3 Checker aggregate verdict

**PASS (after in-session fixes).**

All blocking/ORANGE/RED findings from CSO and architect independently verified and fixed:
- `publish.yml` now has `permissions: contents: read`, correct artifact glob (`*.tgz`), and `publish` job downloads the tested tarball instead of rebuilding.
- `README.md` install commands use `@quanghuy128/symbion`.
- `dependencies: {}` was tested and found to break `bundledDependencies` (tarball dropped from 371 to 134 files, zero vendored packages) — reverted. PLAN §11.1.2 was wrong about `bundledDependencies` not needing `dependencies` entries; the current pattern is required and documented here.
- `npm publish --dry-run` still exits 0 with `+ @quanghuy128/symbion@0.1.0` after all fixes.
- `npm run test:core` (77/77) and `npm run test:daemon` (230/230) unaffected.

**Open items (non-blocking, carry to follow-up):**
- CSO F5: vendored yaml staleness detection — informational, no immediate risk.
- BUILD §12.6: A1/A2 unit tests missing — testplan §A coverage gap, pre-existing.
- The `registry-url` entry in `build-test-pack`'s `setup-node` step is unnecessary for dry-run validation (architect note) — harmless, deferred.

**`/cso` formally satisfied** per CLAUDE.md's trigger bar and STATE §11.7's R5 requirement.

### 13.4 Code-reviewer findings

**Verdict: NEEDS-WORK** → fixed same session.

- **🔴 F1 — CI artifact glob mismatch**: same as CSO/architect F1, already fixed.
- **🟡 F2 — README install commands use unscoped name**: same as architect F3, already fixed.
- **🟡 F3 — `registry-url` in `build-test-pack` job unnecessary**: causes `setup-node@v4` to write an empty `NODE_AUTH_TOKEN` placeholder in `.npmrc`, which may cause spurious auth warnings on `npm publish --dry-run` in CI. **Fixed**: removed `registry-url` from `build-test-pack`'s `setup-node` step (kept only in `publish` job where auth is actually needed).
- **🟡 F4 — `vendorYaml()` copied full yaml `package.json` including devDependencies, scripts, browserslist, prettier config**: shipping dev metadata in published tarball. **Fixed**: `vendorYaml()` now writes a stripped manifest (name/version/type/main/exports/sideEffects/license only), consistent with `vendorPackage()`'s field-stripping for workspace siblings.
- **🟡 F5 — `files[]` entries for `node_modules/` paths are redundant**: npm ignores `node_modules/` in `files` — only `bundledDependencies` controls tarball inclusion. **Fixed**: removed the three `node_modules/@symbion/core/`, `node_modules/@symbion/rpc-types/`, `node_modules/yaml/` entries from `files`, leaving only `bin/`, `apps/daemon/dist/`, `apps/web/out/`, `README.md`, `LICENSE`.
- **🟡 F6 — `dependencies: {}` PLAN deviation**: same as CSO F4 / architect F2. Tested: removing `dependencies` entries drops tarball from 371 to 134 files with zero vendored content (bundledDependencies requires corresponding dependencies entries to function). PLAN §11.1.2's `"dependencies: {}"` was mechanically incorrect for the bundledDependencies mechanism. Current pattern is required; documented in STATE.
- **🟢 Nit — `readJson`/`vendorYaml cpSync` missing existsSync guard**: minor error-reporting inconsistency. `vendorYaml()` now checks `existsSync(util.js)` before copying. `readJson` guard for workspace package.json deferred as low-risk edge case.

**Post-fix re-verification:**
- `npm run build:package` — all 9 steps PASS, yaml stripped manifest written correctly.
- `npm pack` from `apps/cli/` — 237 vendored node_modules files, 371 total. `bundledDependencies` still works after `files[]` cleanup.
- `npm publish --dry-run` — exits 0, `+ @quanghuy128/symbion@0.1.0`.
- `node apps/cli/bin/symbion.mjs --version` → `0.1.0` ✓; `--help` shows correct install command ✓.

### 13.5 Aggregate REVIEW verdict: PASS (after in-session fixes)

All 🔴/🟠/🟡 findings resolved. Open items carried forward (non-blocking):
- A1/A2 unit tests missing (BUILD §12.6) — testplan coverage gap, deferred.
- Vendored yaml staleness detection (CSO F5) — informational, deferred.
- `readJson` missing-file error handling (code-reviewer 🟢 nit) — deferred.

## 14. QA — PASS

### 14.1 Additional fix found during QA: `npm run build` broken by npm 11 `-ws` flag deprecation

`npm run build` failed with "Missing script: build" for `@quanghuy128/symbion` workspace. Root cause: root `package.json`'s `build` script used `-ws` (deprecated single-hyphen shorthand), which npm 11 no longer honors correctly in the script execution context (works as a direct CLI flag but fails when passed through `npm run`). Fixed: updated to `--workspaces --if-present` (long-form flags). `npm run build -ws --if-present` (direct invocation) still worked, but `npm run build` (which shells out to that script) did not — a shell-quoting/flag-parsing edge case introduced by npm 11.

This was a pre-existing issue in the root `package.json` that only became visible when `apps/cli` joined the workspace (previously, all workspace members had `build` scripts, so `--if-present` was never exercised).

### 14.2 QA checklist

- `npm run build` — **PASS** (after flag fix above; 4 workspaces built, `apps/cli` skipped by `--if-present`).
- `npm run test:core -- --run` — **PASS** (77/77, 13 files).
- `npm run test:daemon -- --run` — **PASS** (230/230, 18 files).
- `npm run build:package` — **PASS** (all 9 steps, staged layout verified).
- `npm publish --dry-run` from `apps/cli/` — **PASS** (`+ @quanghuy128/symbion@0.1.0`, exit 0).
- `node apps/cli/bin/symbion.mjs --version` → `0.1.0` — **PASS**.
- `node apps/cli/bin/symbion.mjs --help` → correct usage including `@quanghuy128/symbion` install command — **PASS**.
- CI workflow (`publish.yml`) YAML validity confirmed; `permissions: contents: read` present; `registry-url` removed from `build-test-pack`; artifact glob `*.tgz` correct; `publish` job downloads artifact not rebuilds — **PASS** (static review, no runner available).
- `README.md` install commands use `@quanghuy128/symbion` — **PASS**.
- Zero `.npmrc` / `NPM_TOKEN` credential files — **PASS**.

**Phase: Done**
