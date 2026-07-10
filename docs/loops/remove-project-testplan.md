# remove-project — Test Plan (manual QA)

Fast-track feature (unit/e2e automation not required per Scope). This is the manual
QA checklist `/qa` runs against, and the acceptance standard for reviewers.

Prereqs: daemon + web running locally (`npm run dev` or the project's usual start),
at least 2 tracked projects registered (create/import a second if needed).

## T0 — Build & typecheck clean
- [ ] `npm run build` (or the repo's typecheck/build) passes with no TS errors.
      Confirms the new `RemoveProjectParams`/`RemoveProjectResult` types, both
      rpc/types re-export barrels, the `RpcMethod` union addition, the store
      action, and the ProjectView button all typecheck end to end.

## T1 — Header layout
- [ ] Open any project. Header button order is left-to-right: **[Remove project] [Graph] [Publish ▸]**.
- [ ] "Remove project" is an outline button (secondary weight), not primary.

## T2 — Remove the CURRENT project
- [ ] With a project open, click **Remove project**.
- [ ] A confirm dialog appears with reversible wording ("forgets … no files on disk are deleted … re-add anytime").
- [ ] Click OK/Confirm.
- [ ] The project disappears from the left rail (PROJECTS list).
- [ ] The main area clears: ProjectView unmounts → shows EmptyState (if 0 projects remain) or "Select a project in the sidebar." (if others remain).
- [ ] A success toast appears ("Project removed from list.").

## T3 — Confirm-then-Cancel is a no-op
- [ ] Open a project, click **Remove project**, then **Cancel** the confirm dialog.
- [ ] Nothing changes: project still in the rail, still open, no toast.

## T4 — Removing a non-current project (via re-open)
Note: the button is only reachable for the currently-open project (Scope excludes rail changes).
- [ ] With ≥2 projects, open project A, remove it (T2). Project B remains in the rail.
- [ ] Open project B → it loads normally, unaffected by A's removal.

## T5 — Files on disk are untouched (the safety guarantee)
- [ ] Before removing, note the removed project's folder path (shown under its name in the header).
- [ ] After removal, inspect that folder on disk: its `.symbion/` and `.claude/` (and any files) are all still present and unchanged. Nothing was deleted.

## T6 — Re-add the same folder works
- [ ] After removing a project, re-add the SAME folder (create/import via the normal flow).
- [ ] It reappears in the rail and opens with its previously-saved artifacts intact (proving removal was list-only).

## T7 — Daemon disconnected
- [ ] Stop the daemon (or simulate disconnect) and wait for the disconnect banner / heartbeat to flip.
- [ ] The **Remove project** button is disabled (same as Publish).
- [ ] Restart the daemon; once reconnected, the button re-enables and works.

## T8 — lastProjectId cleared on removal of current
- [ ] Remove the currently-open project (which is typically `lastProjectId`).
- [ ] Refresh the web app. It does NOT auto-open the just-removed project (no error, no attempt to load a forgotten id) — lands on EmptyState / "Select a project."

## T9 — Idempotency / no crash on double action
- [ ] Rapidly double-click **Remove project** (or confirm, then the button before it disables).
- [ ] No unhandled error/crash. Second call is a no-op on the daemon (`removed:false`), state stays consistent. `removing` state guards against a hung "Removing…" label.
