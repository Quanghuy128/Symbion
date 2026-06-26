---
description: Sync docs to match what was just shipped (README, CLAUDE.md, STATE)
---

**document-release** — sync documentation after shipping feature: **$ARGUMENTS**

Steps:
1. Read `git diff` / the most recent commits to understand what changed.
2. Update docs to match reality:
   - **README.md**: new features, how to run, new required env vars (if any).
   - **CLAUDE.md**: stack/convention changes (e.g. switched library, new table).
   - **docs/loops/<feature>-STATE.md**: mark ship done.
   - **.env.example**: add/remove env vars as needed.
3. Ensure NO document still describes something wrong (e.g. mentions a provider/adapter or RPC method that was renamed or removed).
4. Do not invent features that haven't shipped; only document what is actually in the code.

Goal: a new contributor can clone, read the docs, and run the app without any drift from reality.
