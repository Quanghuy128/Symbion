---
description: Monitor after ship/deploy — catch runtime errors and regressions before users hit them
---

**canary** after shipping/deploying feature: **$ARGUMENTS**

Verify the app is still healthy after the change:
1. `npm run build` — must still pass.
2. `npm run dev` (background) → wait until ready → curl `/` returns 200, new routes return 200/correct redirect.
3. Scan the dev log: NO new errors or unhandled rejections.
4. Smoke test core functionality if the change touched the daemon/core: scan an existing `.claude/` → render → diff (no spurious changes), a publish into a temp repo writes byte-valid files + backups, and a conflict/foreign file is never silently overwritten.
5. If Chrome/devtools are available: take a screenshot, scan console for errors.
6. TaskStop the dev server.

Regression found → `/investigate` → fix through the pipeline.
Clean → write "canary PASS" to STATE. This is the REFLECT step — it closes the loop after ship.
