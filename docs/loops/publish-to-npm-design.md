# publish-to-npm — Design (CLI/terminal experience + developer artifacts)

> This feature has no web UI surface. Per the locked THINK decisions (STATE
> §10: Q1 single wrapper package, Q2 unscoped name `symbion`, Q3 CLI-primary,
> Q4 git-tag trigger, Q5 Gate A only — never a real publish in this loop),
> the design surface is: (1) the terminal experience of a globally-installed
> CLI, (2) the npm package manifest's "first impression," (3) `--version`/
> `--help` output, (4) README install/usage copy, (5) CI workflow structure.
> No new screens, dialogs, or React components are introduced. Packaging
> must not change daemon **behavior** — every recommendation below is either
> new terminal-output-only text or a developer-facing (non-runtime) artifact.

## 0. Inputs read before designing

- `docs/loops/publish-to-npm-STATE.md` (full, including §10 THINK lock)
- `apps/daemon/src/boot/menu.ts` — current 3-item boot menu (`showBootMenu`)
- `apps/daemon/src/index.ts` — current boot sequence, `VERSION` constant,
  `findWebStaticRoot()`, no argv/flag handling exists today
- `/home/huynq12/symbion/package.json` (root, private, version `0.1.0`)
- `apps/daemon/package.json` (`@symbion/daemon`, no `bin`, no shebang)
- Confirmed: **no `README.md` exists anywhere in this repo today** (root or
  any workspace) — §4 below is greenfield content, not an edit.
- Confirmed: **no `.github/workflows/` directory exists** — §5 below is a
  from-scratch structural proposal, no existing workflow to reconcile with.

---

## 1. CLI invocation UX — trace `npm i -g symbion` → `symbion`

### Current behavior (today, from a clone only)

```
$ npm run start
> npm run build -w @symbion/daemon && node apps/daemon/dist/index.js
[tsc build output...]
Symbion daemon đang chạy: http://127.0.0.1:12802/?t=a1b2c3...
  1) Web UI   2) Hide to Tray   3) Exit
  Chọn (1-3):
```

### Traced future behavior (after global install, this loop's Gate A target)

```
$ npm i -g symbion
[npm's own install output — see §2]

$ symbion
Symbion daemon đang chạy: http://127.0.0.1:12802/?t=a1b2c3...
  1) Web UI   2) Hide to Tray   3) Exit
  Chọn (1-3):
```

**This is functionally identical output to today** — the locked decision is
"packaging must not change daemon behavior, only how it is distributed and
launched" (STATE §4 FR5). The boot sequence, port-finding, menu text, and
language (Vietnamese-language menu/status strings — already the existing
convention, not something this loop introduces or changes) all stay as-is.

### Recommendation: add ONE new first-run-only line, nothing else

The only thing genuinely different between "I just cloned a repo I already
understand" and "I just typed `symbion` for the first time in my life in a
random directory" is **orientation** — the user has zero context for what
port 12802 is, whether this is safe to leave running, or what "Hide to Tray"
detaches from. Today's clone-context user has README/CLAUDE.md context already
loaded; a fresh global-install user does not.

Recommend a **version banner line**, printed once per process start (not
once-ever — there's no installed-state to track "first run" persistently
without adding a new config-file concern, which is out of scope), immediately
before the existing "daemon đang chạy" line:

**Before (current):**
```
Symbion daemon đang chạy: http://127.0.0.1:12802/?t=a1b2c3...
  1) Web UI   2) Hide to Tray   3) Exit
  Chọn (1-3):
```

**After (recommended):**
```
Symbion v0.1.0
Symbion daemon đang chạy: http://127.0.0.1:12802/?t=a1b2c3...
  1) Web UI   2) Hide to Tray   3) Exit
  Chọn (1-3):
```

Rationale:
- One line, sourced from the same `VERSION` constant already in `index.ts`
  (see R3 — version drift — this banner becomes a free correctness signal:
  if it ever shows a version that doesn't match what was installed, that's
  an immediately-visible drift bug instead of a silent one).
- Does not change any decision logic, menu numbering, or detection behavior
  — purely an added `console.log` line before existing output. Satisfies
  "packaging must not change daemon behavior."
- Costs nothing for the clone-dev workflow either (it's also correct/useful
  there — knowing which build you're running from a clone is also a minor
  win, not just a global-install nicety).
- Declined: a "first run only, hide on later runs" banner. That requires a
  persisted "have I shown this before" flag (new state, new file write,
  new edge case for "what if the user deletes that flag file") for a benefit
  (slightly less repetitive terminal text) that doesn't justify the new
  surface area. A one-line, always-shown version banner is a strict subset
  of that complexity with most of the benefit.
- Declined: any additional "Welcome to Symbion!" / tutorial-style text block.
  Out of scope per the issue (which only asks for an installable CLI, not an
  onboarding rewrite) and risks growing into a UI redesign nobody asked for
  in this loop — flagged under Future ideas below if wanted later.

---

## 2. `npm i -g symbion` post-install terminal output

### What npm already prints automatically (no work needed)

```
$ npm i -g symbion

added 1 package in 1s

1 package is looking for funding
  run `npm fund` for details
```

(Exact wording depends on npm version/funding metadata; this is npm's own
behavior, not something Symbion's package.json controls beyond an optional
`funding` field, which is not requested by this feature and is a Future idea
at most.)

### Recommendation: NO `postinstall` script. Do not add one.

This is not a toss-up — recommend against, with rationale (flagging the
*reasoning* for review, not the open question itself, since the BA/THINK
docs already treat "no new scope beyond Gate A" as locked):

- `postinstall` scripts run **automatically, with no user confirmation, with
  full filesystem/network access**, on every install (including transitive
  installs if `symbion` ever became a dependency of something else, however
  unlikely for a CLI tool). This is a well-known npm supply-chain attack
  surface (it's the exact mechanism several real npm malware incidents have
  abused) and directly conflicts with this project's own filesystem-safety
  ethos in `CLAUDE.md` ("never write silently... user confirm"). A
  `postinstall` script is the npm-ecosystem equivalent of exactly the kind
  of silent, unconfirmed action that principle exists to prevent.
- It adds zero functional value here: there is nothing this package needs to
  do at install time (no native binary to compile, no config file to
  generate, no `.env` to scaffold) — the `bin` entry plus a pre-built
  `apps/web/out` bundle already in the tarball is fully sufficient per FR2.
  A `postinstall` script that *only* prints a friendly "Thanks for
  installing! Run `symbion` to get started." message is the one case where
  some maintainers add it purely for marketing/UX polish — but that's a
  taste call with real downside (it's flagged by `npm audit`-adjacent
  tooling and some corporate environments block packages with install
  scripts entirely, e.g. via `npm config set ignore-scripts true` policies
  or `--ignore-scripts` defaults) for close-to-zero upside given `--help`
  and the version banner (§1, §3) already cover the "what do I do now"
  question the moment the user actually runs the tool.
- This is a one-way reversible-but-annoying decision in the wrong direction:
  adding a `postinstall` later (if a real need appears) is easy; having
  shipped one and then needing to remove it after users' CI/install
  pipelines have started depending on its side effects is the harder
  direction. Default to not adding it.

**Conclusion: not an open question — recommend skip, with rationale above
available for the architect/user to override if they disagree.**

---

## 3. `symbion --version` / `symbion --help`

### Current state confirmed

`apps/daemon/src/index.ts`'s `main()` has **no argv parsing at all** — it
unconditionally calls `loadGlobalConfig()`, finds a port, starts the server,
and boots straight to the interactive menu regardless of how it was invoked.
Today there is no way to ask the daemon its version or get usage help without
starting the full server + menu loop. This is new scope (minimal, per the
issue's "integrate it easily" framing implying basic CLI hygiene), not an
existing behavior change.

### `symbion --version` (also alias `-v`)

```
$ symbion --version
0.1.0
```

Single line, bare semver, no decoration — this is the conventional contract
every CLI tool (`node --version`, `git --version` prints `git version X`,
`npm --version` prints bare semver) and scripts/CI that pipe `symbion
--version` into version checks expect a parseable bare string on stdout, not
prose. Exits 0, does not start the daemon/server/port-finder/menu loop at all.

### `symbion --help` (also alias `-h`, and bare `symbion -h`)

```
$ symbion --help
Symbion v0.1.0 — local-daemon + web UI for authoring AI-coding autoworkflows

Usage:
  symbion                Start the daemon and open the boot menu
  symbion --version, -v  Print the installed version
  symbion --help, -h     Show this help message

Once running, the boot menu lets you open the Web UI in your browser,
hide the daemon to run in the background, or exit.

Docs: https://github.com/<org>/symbion
```

Notes on this mockup:
- Exits 0, does not start the daemon.
- The "Once running..." paragraph and the doc link are the only two lines
  doing more than restating the three flags — kept deliberately short. This
  is the CLI-output equivalent of "don't smuggle a UI redesign into a help
  screen."
- `<org>/symbion` placeholder — actual GitHub org/URL is a real fact the
  architect/user needs to supply (see Open Design Questions §6).
- Language choice: this mockup is in **English**, deliberately inconsistent
  with the existing Vietnamese-language boot menu/status strings
  (`"đang chạy"`, `"Chọn (1-3)"`, etc.) — flagged explicitly as an open
  design question in §6, not assumed, since `--help`/`--version` are the
  first thing many global-install users (especially anyone evaluating it
  off the npm registry page in English) will run, and CLI help-text
  conventions in the broader npm ecosystem are overwhelmingly English-first.
  This is a real inconsistency either way it's decided and should not be
  guessed past.

### Argument-handling flow (for architect, not implementation)

```
symbion <argv>
  │
  ├─ "--version" | "-v" → print VERSION, exit 0   (no server, no menu)
  ├─ "--help" | "-h"    → print help text, exit 0  (no server, no menu)
  └─ (no recognized flag, includes no args at all)
        → existing main() behavior unchanged: load config, find port,
          start server, print version banner (§1) + URL, show boot menu
```

Unrecognized flags (e.g. `symbion --bogus`): recommend falling through to
default boot behavior rather than erroring, consistent with today's
permissive style (the existing menu loop already just reprompts on invalid
input rather than crashing) — but flagging this as a minor open question
too (see §6) since "silently ignore unknown flags" vs. "error on unknown
flags" is a legitimate taste call some CLI authors feel strongly about.

---

## 4. README — Installation + Usage section (for npm registry page)

No README exists anywhere in this repo today. The npm registry renders
whichever README ships in the published package's root as the entire public
package page — this is the single most important piece of public-facing copy
this loop produces. Below is suggested markdown content for the
**Installation** and **Usage** sections specifically (the issue's literal
ask); a full top-to-bottom README (badges, contributing, license, etc.) is
broader scope than this design pass and should be scoped explicitly at PLAN
if wanted beyond these two sections.

```markdown
## Installation

Install Symbion globally to use it as a CLI tool from any directory:

\`\`\`bash
npm install -g symbion
\`\`\`

Or add it as a project dependency and run it via `npx`:

\`\`\`bash
npm install symbion
npx symbion
\`\`\`

Requires Node.js 18 or later.

## Usage

Once installed, run:

\`\`\`bash
symbion
\`\`\`

This starts the local Symbion daemon and opens an interactive menu:

\`\`\`
  1) Web UI   2) Hide to Tray   3) Exit
\`\`\`

- **Web UI** opens the Symbion web app in your default browser, served
  locally by the daemon (nothing is sent to any external server — Symbion
  runs entirely on `127.0.0.1`).
- **Hide to Tray** keeps the daemon running in the background so you can
  keep using your terminal.
- **Exit** shuts the daemon down.

Other commands:

\`\`\`bash
symbion --version   # print the installed version
symbion --help       # show usage help
\`\`\`
```

Notes:
- Deliberately does NOT promise an `npx symbion` "no-install" one-liner
  beyond what naturally works from having a correct `bin` entry, per STATE
  §3 out-of-scope ("no special UX polish pass" for that path) — the README
  copy above documents it as a normal `npm install` + `npx` two-step, not as
  a flashy `npx symbion` zero-install hero command, to avoid over-promising
  relative to what Gate A actually guarantees.
- Does not mention publishing being unverified/Gate-B-pending — that's an
  internal STATE concern, not user-facing README content; the README should
  read as if the package is genuinely live (it will only ship once it is).
- "runs entirely on `127.0.0.1`" is an accurate, valuable trust signal for a
  tool asking users to run an arbitrary global CLI — recommend keeping it.

---

## 5. CI workflow — structure (not YAML; for architect to formalize)

### Suggested filename

`.github/workflows/publish.yml`

(Single file, not split into separate "CI" and "publish" workflows — this
loop only needs one pipeline since there's no pre-existing CI to preserve
compatibility with. If the project later adds a separate "run tests on every
PR" workflow, that should be its own file, e.g. `ci.yml`, kept independent
from this tag-gated publish flow — but that's a Future idea, not this loop's
scope.)

### Suggested step sequence (plain English, in order)

1. **Trigger** — `on: push: tags: ["v*.*.*"]` (per locked Q4). The publish
   job must be gated so it does NOT run on every push to `master` (STATE
   Gate A acceptance criterion) — this is the single most important
   structural property of the file, and the one `/cso` should verify first.
2. **Checkout** — standard `actions/checkout`.
3. **Setup Node** — pin to the same Node major version declared in
   `engines.node` (>=18) — recommend pinning the CI runner to a specific LTS
   (e.g. 20) rather than floating, for reproducible builds, even though the
   package itself declares a `>=18` floor.
4. **Install** — `npm ci` at the root (workspace-aware install).
5. **Build** — root `npm run build` (builds all workspaces, including
   `apps/web`'s static export and `apps/daemon`'s compiled JS) — this step
   must produce the exact on-disk layout `findWebStaticRoot()` expects
   (R2), so this is also implicitly where a layout regression would surface.
6. **Test** — `npm run test` (existing Vitest suites) — must pass unmodified
   per FR/Gate-A acceptance criterion; packaging changes must not regress
   this.
7. **Pack** — `npm pack` against the publishable package directory →
   produces the tarball; this step's artifact (the `.tgz`) is what step 8
   inspects, and should also be uploaded as a CI artifact for the workflow
   run (cheap, useful for a human to download and inspect by hand before
   ever approving a real Gate-B publish).
8. **Dry-run validate** — `npm publish --dry-run` against the packed shape
   — validates manifest/name-format/auth-config correctness without
   touching the real registry. This step should run unconditionally (every
   tag push), independent of whether the next step is gated further.
9. **Publish (Gate B only — gated, NOT exercised by this loop)** — the only
   step that would perform a real `npm publish`. Per the locked decision
   (STATE §10 item 1 / Q5), this step must remain wired-but-inert for this
   loop: no `NPM_TOKEN` secret is configured, this step should not be
   silently auto-run just because the workflow file exists. Recommend
   structuring this as a separate job (not a separate step in the same job)
   that requires a GitHub Environment with manual approval (`environment:`
   key with required reviewers), so that even after a real `NPM_TOKEN` is
   eventually added, a human must click "approve" in the GitHub UI for each
   publish run — this is the CI-native equivalent of "never write silently,
   user confirm" applied to a registry write. This structural recommendation
   is what `/cso` should evaluate most closely (R5).

### Why one workflow, two jobs (build/test/pack/dry-run vs. publish)

Splitting "always-safe-to-run" steps (1-8) from "the one step that needs
real credentials and human approval" (9) into separate jobs means the
dry-run validation can run, succeed, and be inspected by any contributor on
every tagged commit — without that same trigger ever being able to
accidentally reach the credentialed step. This is a structural safety
property the architect can verify by reading the `on:`/`environment:`
blocks alone (as STATE's Gate A acceptance criterion already specifies:
"confirmed by reading the workflow file's `on:` block, not by triggering
it").

---

## 6. Open Design Questions (taste calls — do not guess past these)

1. **Help/version text language: English or Vietnamese?** The existing boot
   menu and status lines (`"đang chạy"`, `"Chọn (1-3)"`, `"Lựa chọn không
   hợp lệ"`) are Vietnamese. The §3 mockups above are drafted in English
   because `--help`/`--version` are likely to be read by an English-reading
   global audience evaluating the tool off the npm/GitHub page, but this
   creates a real inconsistency with the existing interactive menu either
   way it's resolved (English help text + Vietnamese menu, or Vietnamese
   help text matching the menu but possibly less legible to the issue's
   apparent target/wider OSS audience). This needs an explicit decision,
   not a guess — it's a genuine product-voice call, not an engineering one.
2. **Unknown-flag handling**: should `symbion --bogus-flag` silently fall
   through to normal boot behavior (current style: permissive, matches how
   the existing menu loop just reprompts on bad input rather than exiting
   with an error), or print an error + usage hint + exit non-zero (more
   conventional Unix CLI hygiene, catches typos earlier)? Flagged as a minor
   but real divergence point for the architect/PLAN to lock.
3. **Exact `--help` body copy and the doc URL** (`https://github.com/<org>/
   symbion` placeholder) — needs the real GitHub org/repo URL filled in,
   plus a final wording pass; the §3 mockup is a structural draft, not
   final copy.
4. **Version banner line wording** (§1: `"Symbion v0.1.0"`) — confirm this
   exact phrasing (vs., e.g., matching the existing Vietnamese line's style
   more closely, or omitting the literal word "Symbion" since the next line
   already says "Symbion daemon đang chạy") is acceptable, or adjust.
5. **Should the npm package's `package.json` carry a `funding` field** (free
   npm-CLI-surfaced "looking for funding" nudge mentioned in §2)? Not
   requested by the issue; flagged as a zero-cost optional addition, not a
   recommendation either way.

## 7. Autopilot decisions on open design questions (unattended run, no user present)

Same rationale as STATE §10 — no human present to answer in real time, so
each taste call picks the safest/cheapest/most-reversible option and is
documented for review rather than silently baked in.

1. **Help/version text language → English.** Rationale: `--help`/`--version`
   are read off the npm/GitHub registry page by an English-reading global
   audience evaluating whether to install the tool at all — this is a
   different audience moment than the interactive boot menu (already-decided
   local user, mid-session). The existing Vietnamese menu strings are
   unchanged; this is additive new surface, not a retrofit, so it does not
   require translating existing strings to stay consistent. Flagged for human
   override if the maintainer's actual intent is a Vietnamese-first product
   voice throughout.
2. **Unknown-flag handling → silently fall through to normal boot behavior.**
   Matches the existing permissive style (the menu loop already reprompts
   rather than erroring on bad input) and is the lower-risk choice: erroring
   on an unrecognized flag risks breaking some future legitimate flag a user
   or wrapper script passes through that this loop didn't anticipate, whereas
   falling through to the documented default behavior (boot normally) is
   always a safe, working outcome.
3. **`--help` doc URL → `https://github.com/Quanghuy128/Symbion`** (this
   repo's actual GitHub remote, confirmed from `git remote -v`/the PR URLs
   created by prior loops in this session) rather than a placeholder.
4. **Version banner wording → keep `"Symbion v0.1.0"` exactly as drafted.**
   Rationale: it's the conventional CLI version-banner shape (tool name + v +
   semver), reads correctly standalone if ever piped/grepped, and the
   adjacent "Symbion daemon đang chạy" line repeating the word "Symbion" is
   harmless redundancy, not confusing duplication.
5. **`funding` field → omit.** Not requested by the issue; adding optional
   metadata nobody asked for is exactly the kind of unrequested scope this
   loop's own STATE explicitly warns against smuggling in. Easy to add later
   if the maintainer wants it.

## Future ideas (explicitly out of scope for this loop — do not let PLAN/BUILD pull these in)

- A persisted "have you seen this before" first-run-only onboarding message
  (beyond the always-shown version banner recommended in §1).
- Auto-update / self-update version-check on boot (already explicitly out of
  scope per STATE §3).
- A separate `ci.yml` for running tests on every PR/push (independent of the
  tag-gated `publish.yml`) — valuable, but a distinct workflow file/feature
  from "the publish pipeline," and this loop's STATE doesn't ask for general
  CI, only a publish-capable workflow.
- A richer `--help` with subcommands, `man`-page-style formatting, or
  shell-completion scripts (bash/zsh completions for `symbion`) — none of
  this is implied by the issue's literal "integrate it easily" ask.
- A full top-to-bottom README (badges, screenshots, contributing guide,
  license section) beyond the Installation/Usage sections drafted in §4.

---

## Suggested next step

Run `/plan` — the architect should read this design doc alongside
`docs/loops/publish-to-npm-STATE.md` (especially §10's locked Q1-Q5 and the
R1-R5 risk notes) to formalize: the actual package.json shape for the new
wrapper package, the build script that produces the correct on-disk layout
for `findWebStaticRoot()`, the `bin` script's shebang + argv-parsing
implementation for §3's `--version`/`--help` flow, and the real YAML for the
`.github/workflows/publish.yml` structure proposed in §5. The open design
questions in §6 (especially #1, help-text language) should be resolved
before or during PLAN — they materially affect the literal text BUILD will
write.
