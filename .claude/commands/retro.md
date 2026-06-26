---
description: Retrospective — review shipped features, extract patterns, and improve commands + agents + learnings
---

**retro** — look back at recent Symbion work (closes the REFLECT loop, compounds knowledge).

Scope: **$ARGUMENTS** (default: since last retro / last few features).

Collect:
1. **What shipped**: `git log --oneline` from the prior marker → list features + commits.
2. **How the pipeline ran**: which features went through the full Maker→Checker flow? What did review catch (important blockers)?
3. **Lessons**: what worked well (keep), what went wrong (fix process). Extract reusable patterns.
4. **Accumulated debt**: tasks that have dragged across multiple features → worth prioritizing?

Output:
- Summary: shipped items, notable blockers, proposed process changes.
- **Update `docs/learnings.md`**: add new patterns (with confidence level). Promote learnings with enough evidence (see /learn).
- **Improve commands + agents** (key addition): for any process change identified — apply it now:
  - If a command's instructions caused confusion or inefficiency → edit `.claude/commands/<name>.md` directly.
  - If an agent's behavior needs adjustment → edit `.claude/agents/<name>.md` directly.
  - Document each change inline as a comment: `<!-- retro YYYY-MM-DD: <reason> -->` so future retros can trace it.
- Suggest 1–3 priorities for the next cycle.
