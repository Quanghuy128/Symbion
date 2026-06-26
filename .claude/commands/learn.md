---
description: Manage learnings — add new patterns (quarantine) and promote when confidence is earned
---

**learn** — manage the accumulated knowledge base at `docs/learnings.md`. Pattern: **quarantine → promote** (borrowed from gstack domain skills).

Actions (based on `$ARGUMENTS`):

**Add a new learning** (default): write to the correct section in `docs/learnings.md` (Core/IR/Adapters/Daemon-RPC/Web-UI/Process…), format:
`- [confidence: low/medium/high] <pattern>. **Context**: <when this was learned>.`
- Freshly extracted, not yet repeated → **confidence: low** (quarantine — noted but not confirmed).
- Seen to be correct ≥2 times across features → promote to **medium/high**.

**Promote**: review low/medium-confidence learnings — any confirmed by a recent feature → upgrade and record the reason. Any that turned out wrong → fix or delete.

**Apply**: at the start of a new feature, read relevant learnings (especially high-confidence ones) to avoid repeating past mistakes.

Principle: high-confidence learnings = default rules to apply; low = suggestions to re-verify. Keep learnings.md lean — merge or delete stale entries.
