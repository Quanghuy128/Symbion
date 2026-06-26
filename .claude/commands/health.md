---
description: Symbion codebase quality dashboard — score each dimension + surface hotspots and tech debt
---

**health** — take a quick snapshot of Symbion codebase health.

Collect data by running real commands (never guess):
1. **Build/typecheck**: does `npm run build` pass?
2. **Lint**: `npm run lint` — count errors/warnings, group by file (call out pre-existing debt like use-messages.ts).
3. **Test coverage**: if tests exist → run `npm test`; if not → record "no tests" as debt.
4. **Structure**: count components/hooks/libs; flag unusually long files (hotspots).
5. **Core purity & safety**: confirm `packages/core` has no fs/net/Node imports; confirm all disk writes go through the daemon with backup-before-write + path confinement; count adapters + RPC methods.
6. **Secret hygiene**: `git ls-files | grep env` — only `.env.example` should be tracked.
7. **Tech debt**: list open items from learnings.md + STATE.

Output: 0–10 score per dimension + top 3 cleanup priorities. Write a snapshot to `docs/loops/health-<date>.md` if the user wants to track trends over time.
