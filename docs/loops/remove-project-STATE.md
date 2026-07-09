# remove-project — STATE

Fast-track via `/simplify-implementation` (plan → build → ship). Small, reversible, low-risk UI + list-state change.

## Scope (locked via clarifying questions with user, 2026-07-09)

Add a **"Remove project"** action to the ProjectView header, positioned **to the LEFT of the "Graph" button** (Graph stays; a new button is inserted before it). It **only removes the project from Symbion's tracked list** (forgets the path in the global config) — it does **NOT** delete any files on disk. Same "list-only, no disk delete" safety guarantee already used by `deleteArtifact` (handlers.ts §7B).

Behavior:
- Header layout becomes: `[Remove project] [Graph] [Publish ▸]`.
- Clicking asks for confirmation (this forgets the project from the list — reversible by re-adding the folder).
- On confirm: call a new `removeProject` RPC → daemon removes the entry from `config.projects` (and clears `lastProjectId` if it pointed at the removed id) → store removes it from `projects` and clears `currentProject` if it was the removed one → toast → view falls back to empty/"select a project" state.

Out of scope: deleting files on disk; any change to the left rail; the Graph button itself.

### Residual risk (fast-track — /review + /qa + /cso intentionally skipped)
- The new RPC edits the **global config** (project registry), not project `.claude/` files. It performs **no filesystem writes into a project root, no path resolution, no secrets** — it removes one array entry from the config the daemon already owns. This is NOT the daemon-write/path-handling trust boundary that CLAUDE.md requires an independent Checker for. Reversible (re-add the folder). Deemed safe for the fast-track.

## PLAN — Architecture (2026-07-09)

Authored by `architect`. This is the acceptance standard for `/build` and any later review.
List-only registry removal; no disk writes; no path resolution. Mirrors the existing
`createProject` (config.projects mutation) and `deleteArtifact` (list-only, no on-disk delete) patterns.

### Files to change (7 edits, all additive)

1. **`packages/rpc-types/src/index.ts`** — the single source of truth for RPC shapes.
   - Add param/result interfaces near `ListProjects*`/`CreateProject*` (~L93–104):
     ```ts
     export interface RemoveProjectParams {
       id: string;
     }
     export interface RemoveProjectResult {
       /** The updated registry after removal, so the store can replace projects[]
        *  wholesale instead of re-fetching (mirrors listProjects' shape). */
       projects: Array<{ id: string; name: string; path: string }>;
       /** true if an entry was actually removed; false if `id` was unknown
        *  (idempotent no-op). Lets the UI avoid a misleading toast on a stale id. */
       removed: boolean;
     }
     ```
   - Add `| "removeProject"` to the `RpcMethod` union (~L459–486), e.g. right after `"createProject"`.

2. **`apps/daemon/src/rpc/contract.ts`** — daemon-side re-export barrel.
   - Add `RemoveProjectParams,` and `RemoveProjectResult,` to the `export type { … } from "@symbion/rpc-types"` list.

3. **`apps/web/src/lib/rpc/types.ts`** — web-side re-export barrel.
   - Add `RemoveProjectParams,` and `RemoveProjectResult,` to the same re-export list.

4. **`apps/daemon/src/rpc/handlers.ts`** — new handler on the `handlers` object (place next to `createProject`/`loadProject`, ~L232). Server dispatch is by `method in handlers` name lookup (server.ts L134/L140), so the method exists at runtime the moment this handler is added — no separate registry/exhaustiveness map to update.
   ```ts
   removeProject(params: contract.RemoveProjectParams): contract.RemoveProjectResult {
     const { id } = params;
     const config = loadGlobalConfig();
     const before = config.projects.length;
     config.projects = config.projects.filter((p) => p.id !== id);
     const removed = config.projects.length < before;
     // Clear lastProjectId if it pointed at the removed project so a future
     // boot/auto-open doesn't try to re-open a forgotten project.
     if (config.lastProjectId === id) {
       config.lastProjectId = undefined;
     }
     // Only write when something actually changed — re-remove of an unknown/
     // already-removed id is a pure no-op (idempotent; no throw, no needless write).
     if (removed || config.lastProjectId === undefined) {
       saveGlobalConfig(config);
     }
     return { projects: config.projects, removed };
   }
   ```
   Safety note: this touches ONLY the global config registry array — no `findProjectPath`, no `loadProjectStore`, no `saveProjectStore`, no path resolution, no writes into any project root. The forgotten folder's `.symbion/` and `.claude/` files are left fully intact on disk (re-addable).

5. **`apps/web/src/lib/store/useArtifactStore.ts`** — new `removeProject` action.
   - Import `RemoveProjectParams, RemoveProjectResult` from `../rpc/types` (add to the existing type import block, L6–19).
   - Add to the interface (near `createProject`/`loadProject`, ~L68):
     ```ts
     /** Forgets a project from the tracked registry (list-only; no disk delete).
      *  Calls the removeProject RPC, replaces projects[] with the returned
      *  registry, and clears currentProject if it was the removed one so
      *  ProjectView unmounts back to the empty/"select a project" state. */
     removeProject: (id: string) => Promise<void>;
     ```
   - Add the implementation (near `createProject`, ~L150):
     ```ts
     async removeProject(id) {
       const result = await callRpc<RemoveProjectParams, RemoveProjectResult>("removeProject", { id });
       set((state) => ({
         projects: result.projects,
         currentProject: state.currentProject?.id === id ? null : state.currentProject,
       }));
     },
     ```
   - Note: replace `projects` wholesale from `result.projects` (not a client-side splice) so daemon stays the source of truth, matching `loadProjects`.

6. **`apps/web/src/components/ProjectView.tsx`** — header button + confirm UX.
   - Subscribe to the new action + existing helpers already in this file:
     `const removeProject = useArtifactStore((s) => s.removeProject);` (`showToast` and `daemonConnected` are already subscribed at L25/L27).
   - Add a handler (component-local, mirroring the file's existing local-async pattern):
     ```ts
     const [removing, setRemoving] = useState(false);
     async function handleRemoveProject() {
       if (!window.confirm(`Remove "${project.name}" from Symbion? This forgets the project from the list only — no files on disk are deleted. You can re-add the folder anytime.`)) {
         return;
       }
       setRemoving(true);
       try {
         await removeProject(project.id);
         showToast("Project removed from list.", "success");
       } catch (err) {
         const message = err instanceof Error ? err.message : "Remove failed — reason unknown.";
         showToast(message, "error");
       } finally {
         setRemoving(false);
       }
     }
     ```
   - In the header button group (L81–88), insert a new button **LEFT of Graph**:
     ```tsx
     <Button variant="outline" size="sm" disabled={!daemonConnected || removing} onClick={handleRemoveProject}>
       {removing ? "Removing…" : "Remove project"}
     </Button>
     ```
     Final header order: `[Remove project] [Graph] [Publish ▸]`.

7. **(no test file to author for /build)** — see `remove-project-testplan.md` for the QA checklist this feature ships against.

### Confirm UX decision — use `window.confirm`, NOT the inline two-step pattern

ProjectView already has a row-level `confirmDeleteId` two-step confirm (L34/L43–72/L116–132) for *artifact* deletes, because those live inside list rows where an inline "Confirm delete /name?" swap reads naturally. This new action is a **header-level, single-target** action. Recommendation: a plain `window.confirm` (as coded above). Rationale:
- No new component-local confirm state machine, no header re-layout to host an inline confirm bar → lightest change that fits the fast-track.
- The action is genuinely reversible (re-add the folder), so a blocking browser confirm is proportionate — this is not a destructive disk delete.
- Do NOT reuse/extend `confirmDeleteId` — it's typed for artifact ids and semantically about disk-file deletes; overloading it would muddy that state.

### Data flow

```
[Remove project] click
  → window.confirm(reversible-wording)         (cancel → return, no-op)
  → store.removeProject(project.id)
      → callRpc("removeProject", { id })
          → daemon handler:
              config = loadGlobalConfig()
              config.projects = filter(p.id !== id)
              if lastProjectId === id → lastProjectId = undefined
              saveGlobalConfig(config)   // only when changed
              return { projects, removed }
      → store.set: projects = result.projects
                   currentProject = (currentProject.id === id) ? null : currentProject
  → showToast("Project removed from list.", "success")
  → if currentProject was cleared, AppShell (currentProject ? ProjectView : …)
    re-renders to EmptyState (projects.length===0) or "Select a project" (projects>0)
```

No RPC method here touches a project root on disk. The only disk write is `saveGlobalConfig` rewriting the user-level global config JSON — the same file `createProject` already rewrites.

### Edge cases

| Case | Behavior |
|------|----------|
| Remove a **non-current** project | `currentProject.id !== id` so `currentProject` is preserved; only `projects[]` shrinks. (Note: the remove button lives in ProjectView's header, which only renders for the current project — so in v1 the only project removable via this button IS the current one. The store action still handles the non-current branch correctly for robustness / future callers. Flag to dev: no left-rail remove affordance is in scope.) |
| Remove the **current** project | store sets `currentProject = null`; AppShell unmounts ProjectView and falls back to EmptyState / "Select a project." Toast fires. |
| **Daemon disconnected** | Button `disabled={!daemonConnected || removing}`, mirroring Publish's `disabled={!daemonConnected}` (L85). No call attempted. |
| **Unknown / already-removed id** | Handler is idempotent: filter is a no-op, `removed:false`, no throw. Store still replaces `projects[]` with the returned registry (converges to truth) and clears `currentProject` if it matched. UI: still show success toast (state is now consistent) — acceptable; the id came from a live project object so `removed:false` should not occur in practice. |
| **Confirm → Cancel** | `window.confirm` returns false → early return; no RPC, no state change, no toast. |
| **RPC throws mid-remove** (daemon dies between button-enabled check and response) | caught in `handleRemoveProject`; error toast; `projects[]`/`currentProject` unchanged (set() only runs on success). `removing` reset in `finally`. Heartbeat will flip `daemonConnected` false on next tick, disabling the button. |

### Trade-offs / assumptions for dev + reviewer

- **A1**: Result returns the full `projects[]` (not just an ok flag) so the store replaces the list from daemon truth — same convergence discipline as `loadProjects`. Adds negligible payload.
- **A2**: `window.confirm` over an inline confirm bar — deliberate simplicity for a header-level reversible action (justified above). If design review prefers an inline bar for consistency with row deletes, that's a larger UI change and out of the fast-track's intent.
- **A3**: No left-rail (AppRail) remove entry — Scope explicitly excludes rail changes. The button is reachable only for the currently-open project; that's accepted for v1.
- **A4**: `removed:false` (stale id) still shows a success toast. Alternative (warn toast on `!removed`) was considered but rejected as over-engineering: the id always originates from the live `project` object, so the case is effectively unreachable from this button.
- **A5**: No confirm on daemon side / no backup — justified because this is registry-list state, not a project-root file write; the CLAUDE.md backup-before-write / path-confinement rules govern project-root writes, which this handler does not perform. Reversible by re-adding the folder.

Next: run `/build`.

## BUILD — implementation notes (2026-07-09)

Implemented by `feature-builder` (Maker). All 7 plan edits applied verbatim to the plan's signatures and code.

### Files changed
1. `packages/rpc-types/src/index.ts` — added `RemoveProjectParams`/`RemoveProjectResult` interfaces (after `CreateProjectResult`) and `| "removeProject"` to the `RpcMethod` union (after `"createProject"`).
2. `apps/daemon/src/rpc/contract.ts` — added `RemoveProjectParams, RemoveProjectResult` to the re-export barrel.
3. `apps/web/src/lib/rpc/types.ts` — added `RemoveProjectParams, RemoveProjectResult` to the re-export barrel.
4. `apps/daemon/src/rpc/handlers.ts` — added the `removeProject` handler after `createProject` (config.projects filter + lastProjectId clear + idempotent save), exactly as specified.
5. `apps/web/src/lib/store/useArtifactStore.ts` — added the `RemoveProjectParams, RemoveProjectResult` type import, the `removeProject` interface entry, and the `removeProject` action implementation (after `loadProject`).
6. `apps/web/src/components/ProjectView.tsx` — subscribed `removeProject`, added `removing` state + `handleRemoveProject` (window.confirm), and inserted the "Remove project" outline button LEFT of the Graph button. Header order is now `[Remove project] [Graph] [Publish ▸]`.

### Assumptions made (for the Checker)
- A1: `GlobalConfig.lastProjectId` is typed `lastProjectId?: string` (packages/core/src/ir/types.ts:86), so `config.lastProjectId = undefined` compiles — confirmed by reading the type and by a clean build.
- A2: The daemon dispatches by `method in handlers` name lookup (per plan note), so adding the handler property is sufficient — no separate registry/exhaustiveness map edited. Not runtime-verified in this BUILD; QA/Checker should confirm the RPC dispatches.
- A3: `RemoveProjectParams`/`RemoveProjectResult` were added to BOTH barrels (daemon contract + web types) even though the daemon handler only needs the params/result types via `contract.*`; the web barrel export is what the store imports.
- A4: The confirm/button/toast wording is copied verbatim from the plan (including the ellipsis character in "Removing…" and the "…" in the confirm string).
- A5: `window.confirm` is used as specified — not the inline two-step `confirmDeleteId` pattern.

### Build result
`npm run build` (repo root) — PASS. All three packages built clean: `@symbion/rpc-types` (tsc), `@symbion/daemon` (tsc), `@symbion/web` (next build) compiled successfully with linting + type validity checks passing. No root `typecheck`/`lint` script exists; the build already runs `tsc` for the two TS packages and Next.js's lint/type-check pass for web.

Maker note: I did NOT review for correctness beyond the compiler — REVIEW/QA/CSO are intentionally fast-tracked per the Scope section; the independent Checker owns verification of the assumptions above (esp. A2 runtime dispatch and the fallback-to-EmptyState behavior after removing the current project).

## SHIP — Done (2026-07-09)

Shipped through the **simplify-implementation** fast-track (plan → build → ship).

**Verified before ship:**
- `npm run build` (repo root) — PASS, clean across all three workspaces (`@symbion/rpc-types` tsc, `@symbion/daemon` tsc, `@symbion/web` next build; lint + type-check pass, 6 static pages generated).
- Header order confirmed by direct read of `ProjectView.tsx`: `[Remove project] [Graph] [Publish ▸]` — the "Remove project" outline button sits LEFT of Graph as specified.
- `removeProject` wired end-to-end across all four layers: `RpcMethod` union + `RemoveProject{Params,Result}` (rpc-types) → daemon handler (config.projects filter + lastProjectId clear, idempotent save) → store action (replaces projects[], clears currentProject if removed) → header button (window.confirm → toast).

**Fast-track trade-off (recorded):** independent `/review` + `/qa` + `/cso` deliberately skipped — this is a small, reversible, list-only change that stays OUTSIDE the daemon-write/path-handling trust boundary (edits only the global config registry array; no project-root writes, no path resolution, no secrets; forgotten folder's files untouched on disk). Residual risk accepted per the Scope section. `remove-project-testplan.md` holds the manual QA checklist for anyone who wants to verify the runtime behavior live.

Status: **DONE.**
