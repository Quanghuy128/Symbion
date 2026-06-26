---
description: Safe commit + push — write a full English commit message (summary + detailed body), check for secrets before committing
---

You are running the **git** skill for Symbion: stage → safety check → commit (message **in English**, fully detailed) → push.

Optional description from user: **$ARGUMENTS**

## Principles

- **Commit messages are ALWAYS in English**, even if the user describes changes in Vietnamese — translate to clear technical English.
- **Never** commit `.env.local` or secrets (see DB safety + careful hook in CLAUDE.md).
- **Never push directly to `master`** — create a branch first.
- `git push --force` / `-f` / `reset --hard` are blocked by the `careful` hook — do not use them; if a rewrite is genuinely needed, use `--force-with-lease` and explain why.

## Steps

0. **Auto-checkout the right branch**:
   - Run `git branch --show-current` to see where you are.
   - If on `master`: **automatically create a branch** named `<type>/<short-desc>` based on the diff content (read diff first to infer type + scope). Run `git checkout -b <branch>` before anything else.
   - If on a feature branch but the changes are clearly unrelated to that branch's scope: warn the user, ask whether to create a new branch before proceeding.
   - If on the right feature branch: leave it, no checkout needed.
   - **Branch names**: `<type>/<kebab-scope>` — e.g. `feat/claude-adapter`, `fix/diff-conflict`, `chore/cleanup`. No spaces, no non-ASCII characters.

1. **Survey**: run `git status`, `git diff` (and `git diff --staged` if already staged) to fully understand the changes. Never commit blind.
2. **Safety check**:
   - `git status` confirms `.env.local` and any key/secret files are NOT in the stage list.
   - If a secret is about to be tracked → STOP, warn the user, do not commit.
3. **Stage**: `git add` relevant files selectively; use `git add -A` only when confident every change belongs in this commit.
4. **Write commit message in English** using the 3-layer structure (see template below):
   - **Summary** (first line): ≤72 chars, imperative mood, Conventional Commit prefix.
   - **Body**: full *what & why*; bullet list of main changes; rationale/context; call out impact (breaking, migration, new env var).
   - **Footer** (if needed): issue/PR references, `BREAKING CHANGE:`, co-author.
5. **Commit**: use a heredoc to preserve multi-line formatting.
6. **Push**: on a feature branch → `git push -u origin <branch>`. On `master` → create a branch first, then push. Suggest `gh pr create` if a PR is needed.
7. **Report**: print the commit message used + push result (branch, PR needed?).

## Commit message template (English, complete)

```
<type>(<scope>): <imperative summary, ≤72 chars>

<Overview: 1–2 sentences — what this change DOES and WHY.>

- <Detailed change 1: file/area + specific content>
- <Detailed change 2>
- <Detailed change 3>

<Impact / notes: breaking change, migration, new env var, follow-up needed.>

Refs: #<pr-or-issue>
```

`type` ∈ `feat` | `fix` | `chore` | `refactor` | `docs` | `test` | `ci` | `perf` | `build`.
`scope` examples: `core`, `daemon`, `web`, `adapter`, `publish`, `ci`.

### Real example

```
ci(discord): enrich deploy notification embed

Add commit metadata, clickable links, and build duration to the
Discord embed so notifications are actionable without opening Actions.

- ci.yml: add "Mark start time" step to compute build duration
- ci.yml: build payload with jq (safe-escapes commit messages with quotes)
- Distinguish pull_request vs push; use head_ref for the real source branch
- Add fields: commit message + author, PR/Run/Commit links, footer timestamp

No behavior change to the build/lint/typecheck gate.

Refs: #4
```

> Goal: someone reading `git log` 6 months from now can understand *what changed* and *why* without opening the diff.
