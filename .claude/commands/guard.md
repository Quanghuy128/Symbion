---
description: Maximum safety — enable both careful (block destructive commands) and freeze (restrict edit area)
---

Enable **guard** = `/careful` + `/freeze` for sensitive operations (production, shared DB).

Steps:
1. Confirm the `careful` hook is active (already wired in settings.json — blocks rm -rf/DROP/force-push). If not yet loaded (created this session) → remind the user to restart/run `/hooks`.
2. Enable freeze: write the allowed paths to `.claude/.freeze` from `$ARGUMENTS` (same as /freeze).
3. Report: "Guard ON — careful (destructive commands blocked) + freeze (edits restricted to <list>). Disable freeze: /unfreeze."

Use when: the daemon will write into real target repos, publishing/exporting, or any situation where a single wrong command means data loss or an overwritten file.
