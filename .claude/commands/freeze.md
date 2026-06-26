---
description: Restrict all Edit/Write operations to specified directories — prevent accidental changes outside the target area
---

Enable **freeze**: only allow file edits inside the `$ARGUMENTS` paths (default: the current feature directory).

Steps:
1. Write each path (relative to repo root) into `.claude/.freeze`, one path per line. If `$ARGUMENTS` is empty, ask the user which area to lock or infer it from the current feature in STATE.
2. Confirm with the user: "Freeze ON — edits restricted to: <list>. Disable with /unfreeze."

The `.claude/hooks/freeze.sh` hook (PreToolUse Write|Edit) will block any edit outside the allowed paths. The hook is wired in settings.json — if it was just created this session, a restart/`/hooks` reload is needed for it to take effect.

Use when: debugging/investigating a specific module, or working with shared DB, and you want a guarantee that nothing else gets touched.
