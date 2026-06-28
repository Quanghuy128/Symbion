# Symbion — Visual Builder for AI-Coding Autoworkflows

A **local-daemon + web UI** tool that lets a developer author "autoworkflows" — slash-commands + subagents stored as `.md` files — through forms + a read-only dependency graph, then **export/upsert** them into any target repo's `.claude/` folder (and `AGENTS.md` for Codex). Goal: stop hand-writing `.md` pipeline files for every new project, and make one canonical definition compile to multiple providers.

> Same automation-machine ethos as the pipeline that built it (analyze → design → plan → build → review → qa → ship). Symbion is, in fact, a tool to *create and manage* that machine for other repos.

## Stack

| Layer | Tech |
|-------|------|
| Language | TypeScript (strict) |
| Monorepo | `packages/core` (pure) · `apps/daemon` (Node) · `apps/web` (Next.js) |
| Web UI | Next.js App Router + Tailwind + shadcn/ui |
| Editors | **CodeMirror 6** (NOT Monaco) — YAML frontmatter + markdown + `@`-mention |
| Graph | **React Flow** (read-only dependency map — NOT a free drag-drop executor) |
| Daemon | Node HTTP/WS on `127.0.0.1` — filesystem, git, folder-pick, the terminal boot menu |
| Persistence | Local files only: per-repo `.symbion/` + a user-level config dir. **No cloud DB, no Supabase.** |
| Test | Vitest (core unit + daemon integration) + chrome-devtools for web journey |
| Package manager | npm |

- **There is NO Supabase, Realtime, Presence, map, mobile UI.** Data flow = **web UI ↔ local daemon (typed localhost RPC) ↔ filesystem + git**.
- **Run engine deferred to v2.** v1 = "Copy run command" (render a structured prompt to clipboard, no execution).
- Providers v1: **Claude** (`.claude/agents/<name>.md` + `.claude/commands/<name>.md`) + **Codex** (`AGENTS.md`). IR is vendor-agnostic so Copilot/Gemini are added later as adapters with no IR change.

## Architecture rules

- **`packages/core` is PURE** — no fs/net/Node imports. It owns the Canonical IR, render, parse, diff, marker/hash, adapters, semver, run-command rendering. ~80% of correctness lives here as cheap unit tests.
- **`apps/daemon` is the ONLY process that touches disk** (and git). The web UI never writes files directly — every effect goes through a typed RPC method (`scan`/`render`/`computeDiff`/`write`/…).
- **`apps/web`** is presentation + IR editing; it funnels all side-effects through the daemon RPC.
- Conventions: TypeScript strict; Server Components by default in web, `"use client"` only when needed; shadcn UI in `apps/web/components/ui/`.

## Filesystem safety (MANDATORY — the analog of "no DROP without WHERE")

- **Never write silently.** Publish always renders → temp → **diff preview** → user confirm → write.
- **Path confinement**: every write path is resolved and confined to the declared project root; reject `..`, absolute escapes, and symlink-escape.
- **Backup-before-write** + atomic temp→rename; every overwrite is reversible (`.symbion/backups/<version>/`).
- **Foreign / unmanaged files are NEVER touched.** A file is "managed" only if it carries the `<!-- managed-by: symbion ... -->` marker. Hand-edited managed file (hash mismatch) = **conflict** → blocks overwrite until resolved.
- **Localhost RPC hardening**: bind `127.0.0.1` only; per-boot origin-bound session token; Origin/Host allowlist (anti DNS-rebinding).
- Hook `careful` (`.claude/settings.json`) blocks destructive shell commands.

## Loop Engineering — foundations

- **Maker ≠ Checker**: `feature-builder` (maker) ≠ `code-reviewer`/`security-reviewer` (independent checkers).
- **STATE.md = living axis**: each feature has a phase file in `docs/loops/`. Read STATE → do next phase → write STATE back.
- **learnings.md**: accumulate patterns + confidence after each feature.

## Pipeline (one feature)

```
ANALYZE /analyze      → 3 BA agents (requirements + solutions + ideas)        → STATE (Requirements/Solution Options sections)
THINK   /office-hours → lock scope (6 questions)   [or /autoplan]             → STATE (a "Scope" section)
DESIGN  /design       → 3 designer angles → design doc                       → <feature>-design.md
PLAN    /plan         → architecture + data flow + edge cases + TEST PLAN     → STATE (heading containing "PLAN") + <feature>-testplan.md
BUILD   /build        → feature-builder (maker)                              → STATE (heading containing "BUILD")
REVIEW  /review       → code-reviewer + architect (independent checkers)     → STATE (heading containing "REVIEW")
        /cso          → security-reviewer — when touching RPC / fs-write / secrets → STATE (heading containing "CSO")
QA      /qa           → test live, reads testplan                            → STATE (heading containing "QA")
SHIP    /ship         → test + commit/PR (gates on REVIEW+QA[+CSO] in STATE)
        /canary       → post-ship regression watch; finds a bug → /investigate → fix through the pipeline
```

Two different conventions apply here — don't conflate them:
- **PLAN / BUILD / REVIEW / CSO / QA** genuinely appear as a substring somewhere in their stage's STATE heading in every real feature shipped so far (e.g. `## 6. PLAN — Architecture`, `## 11. BUILD — implementation notes`) — downstream commands check for these keywords as a substring match, never requiring the bare `## PLAN` literal alone.
- **ANALYZE / THINK** do **not** — no real STATE file has ever used either word in a heading; they're pipeline-stage names, not heading vocabulary. The real, checkable signal that `/analyze` or `/office-hours` ran is a recognizable `Requirements`/`Scope`-style section existing, which is what `/plan`'s precondition actually checks for.

<!-- retro 2026-06-28: this note went through two corrections in one day — first process-manager's same-day audit added an "exact literal heading" rule, then retro found real STATE files use decorated headings (loosened to substring match), then retro found THINK/ANALYZE specifically never appear as a keyword at all even loosely (so substring-matching those two would also silently fail — corrected to check for a named section instead). See docs/learnings.md's "Process audit" entry for the full trace. -->

> ⚠️ This pattern is the single most important convention to spot-check next time you write or read a `docs/loops/<feature>-STATE.md` phase marker — see `docs/learnings.md`'s "Process audit" entry for why this matters.

**Guardrails**: `/careful` · `/freeze`+`/unfreeze`+`/guard` · `/investigate` (root-cause before fix).
**Agents**: Maker = `feature-builder` (or `dev` for small tasks); Checkers = `code-reviewer`, `security-reviewer`; Designer = `designer`; Analyst = `ba`, `architect`; Process = `process-manager`. QA has no dedicated subagent — it's mechanical verification run by the orchestrating thread itself (see `/qa`'s own doc for why that's safe).

> Locked spec + design + plan for v1 live in `docs/loops/`: `symbion-analyze.md`, `symbion-design.md`, `symbion-STATE.md` (phase PLAN), `symbion-testplan.md`.
> ⚠️ New skill/agent/hook needs a restart or `/hooks` to load (not loaded mid-session).
