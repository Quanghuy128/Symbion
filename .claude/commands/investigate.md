---
description: Disciplined root-cause debugging — investigate first, fix later (Iron Law)
---

Investigate bug: **$ARGUMENTS**

**Iron Law: do NOT fix until you understand the cause.** (borrowed from gstack /investigate)

Process:
1. **Isolate**: identify the affected module → enable `/freeze` on that area (write `.claude/.freeze`) to prevent accidental edits while investigating.
2. **Reproduce**: build a reliable reproduction (test/log/curl/dev server). A bug you can't reproduce = a bug you don't understand.
3. **Hypothesize**: list 1–3 candidate causes with evidence (logs, code path, data). Rank by likelihood.
4. **Verify**: test each hypothesis with real observations (read code, add logs, query DB) — do NOT guess.
5. **Root cause**: only propose a fix once the cause is confirmed.

**3-strike rule**: if 3 fix attempts fail → STOP. Challenge the architecture/assumptions instead of continuing to iterate.

After identifying root cause: lift the freeze (`/unfreeze`), then route through `/build` (Maker fixes) → `/review` → `/qa`. Write the cause and how it was found to `docs/learnings.md`.
