# Import Lifecycle Fixes — STATE

> Cluster of related defects found via two `/investigate` passes on the `vpo`
> import flow. All live in the import / project-lifecycle surface (daemon RPC +
> filesystem writes/deletes) — a TRUST BOUNDARY → full pipeline with /cso, NOT
> fast-track.

## Bugs (root causes CONFIRMED by observation)

### B1 — `.md`/`.md.tmpl` duplicate-name collision blocks import (the trigger)
`vpo/.claude/agents` has 13 `.md` + 13 matching `.md.tmpl` twins.
`deriveArtifactName` strips BOTH `.md` and `.md.tmpl` to the same base
(`ba.md`→`ba`, `ba.md.tmpl`→`ba`). Auto-detected `.md` agents + user-reclassified
`.md.tmpl` agents then collide on name → `validateAllArtifacts` flags each pair
(`other.id !== id && same kind && same name`, validate.ts:77-93) → `importArtifacts`
hard-rejects the WHOLE import (handlers.ts:373-378). `architect` additionally hits
"description is required" (its content fails YAML frontmatter → empty-description
fallback). Reproduced: `scratchpad/repro.mjs` — auto+tmpl pairs produce exactly the
paired "already exists" errors seen in the user's screenshot.
**Unlike `applyTemplate`, the import path has NO auto-suffix collision resolution**
(the auto-suffix loop already exists at handlers.ts:448-460).

### B2 — split-brain "already a project" guard (the confusing symptom)
`createProject`'s guard checks DISK (`projectStoreExists(path)` → does
`<path>/.symbion/store.json` exist, handlers.ts:220) while the sidebar list
(`listProjects`, handlers.ts:210) checks GLOBAL CONFIG
(`loadGlobalConfig().projects`). An orphaned store (on disk, absent from config)
makes them disagree: dialog says "This folder is already a Symbion project" while
the rail shows only `geochat`. CONFIRMED on disk: `vpo/.symbion/store.json` exists
(id `54ec47ad…`, `artifacts: []`, created 2026-07-12T18:39) but
`~/.config/symbion/config.json.projects` contains ONLY `geochat`.

### B3 — non-atomic import creates orphans (how B2's orphan arose)
`handleImport` (ImportDialog.tsx:112-136) calls `createProject` FIRST (writes
`.symbion/store.json` + pushes to global config), THEN `importArtifacts`. When B1
made `importArtifacts` throw, `createProject` had already succeeded → partial
state. The user then deleted the half-created `vpo` from the rail; `removeProject`
(handlers.ts:235-252) edits ONLY global config and NEVER deletes the on-disk
`.symbion/store.json` → orphan left behind → B2.

## Scope (LOCKED — user decisions 2026-07-12)

- **B2 fix — adopt-orphan-on-create.** If `.symbion/store.json` exists on disk but
  the folder is NOT in global config, `createProject` RE-REGISTERS it (re-add to
  config, reuse the existing store) instead of throwing `already-a-project`. Turns
  the dead-end into a recovery path. (Consider: reuse existing store id/name, or
  refresh name from param — architect to decide.)
- **B3a fix — make import atomic.** If `importArtifacts` fails after
  `createProject` succeeded, roll back the just-created project (remove config
  entry + `.symbion/store.json`) so a failed import leaves NO partial state.
  (Decide: rollback in the daemon via a new combined RPC, or client-orchestrated
  compensating call. Prefer daemon-side atomicity — client crash mid-flow would
  otherwise still orphan. Architect to resolve.)
- **B3b fix — `removeProject` cleans the on-disk store.** Removal also deletes (or
  offers to delete) `.symbion/store.json`. ⚠️ This DELETES USER DATA ON DISK →
  MUST follow Symbion fs-safety: path-confined, backup-before-delete
  (`.symbion/backups/…`), never touch foreign files, explicit confirm. This is a
  NEW destructive write path → /cso scrutiny required.
- **B1 fix — resolve import name collisions (fix FIRST — it's the trigger).**
  Reuse the existing auto-suffix pattern (`ba` → `ba-2` → `ba-3`) OR surface a
  collision warning in the picker so the user deselects one twin. User picked
  "auto-suffix like applyTemplate" as the collision policy in the prior
  investigate's first question set. Architect to confirm auto-suffix vs
  warn-and-deselect and where it runs (import must dedup within its OWN payload
  too, not just vs existing store — the `.md`/`.md.tmpl` twins are BOTH new).

## ⚠️ Pipeline gate — full pipeline, /cso MANDATORY

Touches daemon RPC handlers (`createProject`/`removeProject`/`importArtifacts`) +
a NEW destructive filesystem delete (B3b). Per CLAUDE.md: /plan → /build →
/review → **/cso** → /qa → /ship. NOT eligible for /simplify-implementation.

## Relationship to in-flight work

- `manual-file-picker` is mid-pipeline (BUILD + REVIEW PASS; /cso round-1
  NEEDS-WORK; the F1 leaf-symlink fix landed in the working tree but /cso has NOT
  re-passed). B1 is a defect IN that feature (the picker's reclassify path is what
  surfaces the collision). Recommend folding B1–B3 into that feature's remaining
  /build → then ONE /cso re-audit + /qa covers everything, and it all ships in one
  commit. Avoids re-auditing the security boundary twice.

## Immediate cleanup (independent of the code fix)

The orphaned `vpo/.symbion/store.json` is stale test data from the failed import.
It can be deleted to unblock manual re-testing NOW (user data, but it's an empty
`artifacts: []` store the user already tried to discard via the rail). Confirm
with user before deleting.

## Status: ROOT CAUSES CONFIRMED, SCOPE LOCKED → next /plan (fold into
manual-file-picker or standalone — user to route), full pipeline + /cso.

---

## PLAN — Architecture, Data Flow, Edge Cases & Safety (architect, 2026-07-13)

> Source of truth for /build; acceptance standard for /review + /cso + /qa.
> Resolves B1 → B2 → B3a → B3b per the LOCKED scope above. Fix ORDER matters:
> B1 (the trigger) is designed first because once collisions no longer hard-reject
> the whole import, B3a's rollback path is rarely exercised in practice — but it
> still MUST exist for the OTHER failure modes (config write failure, disk full,
> a genuinely-blocking lint error). Testplan → `import-lifecycle-fixes-testplan.md`.

### PLAN §0 — Decisions (TL;DR)

| # | Question | Decision |
|---|----------|----------|
| B1-where | auto-suffix in daemon vs core | **Pure core fn `dedupeImportNames(existing, incoming)` in `packages/core`, called by the daemon `importArtifacts` handler.** Unit-testable in core; server-authoritative (closes TOCTOU) because the daemon re-reads the store and runs it against the fresh set. |
| B1-within-payload | dedup vs store only | **Both.** The fn seeds its "claimed names" set from the EXISTING store AND accumulates names claimed earlier in the SAME incoming batch. The `.md`/`.md.tmpl` twins are both new → the 2nd twin gets suffixed. |
| B1-order | which twin keeps bare name | **Payload array order — first occurrence keeps the bare name, later ones get `-2`, `-3`.** Deterministic given a deterministic payload (the web builds `[...agents, ...commands, ...picks]`; auto-detected `.md` agents precede reclassified `.md.tmpl` picks, so `ba.md`→`ba`, `ba.md.tmpl`→`ba-2`). |
| B1-empty-desc | architect.md empty description | **Auto-suffix does NOT fix it; keep `description-required` BLOCKING per-artifact, but block ONLY that artifact, not the whole import.** See §1.4 — this is a change from today's wholesale-reject. Aligns with manual-file-picker F2 (fallback is importable but flagged); an empty-description artifact is surfaced with its lint error and the user fixes it in Studio or deselects it. |
| B2-store-id | reuse vs mint | **Reuse the existing store's id + artifacts (never lose data). Refresh the config-registered `name` from the param** (the disk store's own `name` field is left as-is). |
| B2-in-config-and-disk | folder IS in config AND on disk | **Throw `already-a-project` (unchanged).** Adopt applies ONLY to the config-absent-but-disk-present orphan case. |
| B3a-where | atomicity location | **Daemon-side, new combined RPC `createProjectAndImport`** (option a). Client crash between two calls can't orphan. The old two separate RPCs remain for other callers but the two dialogs switch to the combined one. |
| B3a-rollback | what rollback does | Remove the just-added config entry + delete the just-created `.symbion/store.json` via B3b's `safeDeleteProjectStore`. ONLY rolls back a project this call itself created (never a pre-existing/adopted one). |
| B3b-scope | delete store.json vs whole .symbion | **Delete `.symbion/store.json` + `.symbion/publish-log.json` only; NEVER the whole `.symbion/` dir** (backups live in `.symbion/backups/` and must survive so the deletion is reversible). |
| B3b-confirm | confirm flag | **`removeProject` grows an explicit `deleteStore?: boolean` param, default `false` (safe).** Only when `true` does it touch disk. The rail's Delete button passes `true` after its existing confirm UI; any other caller defaults to the old config-only behavior. |

### PLAN §1 — B1: import name-collision resolution (FIX FIRST)

**Root cause recap.** `deriveArtifactName` strips both `.md` and `.md.tmpl` to the
same base. Auto-detected `.md` agents + user-reclassified `.md.tmpl` agents collide
on `(kind,name)`. `validateAllArtifacts`' `name-duplicate` rule (validate.ts:77-93)
flags each, and `importArtifacts` (handlers.ts:373-378) rejects the WHOLE import.

#### §1.1 New pure core fn — `packages/core/src/parse/dedupeImportNames.ts`

```ts
export interface DedupeResult {
  /** incoming artifacts, with colliding names rewritten to name-2/-3/... */
  deduped: CanonicalArtifact[];
  /** audit trail for the UI/log: which artifact ids were renamed and to what. */
  renames: Array<{ id: string; from: string; to: string }>;
}

/**
 * dedupeImportNames — resolve (kind,name) collisions in an import BATCH against
 * the existing store AND within the batch itself, using the same auto-suffix
 * policy as applyTemplate (first free `name`, `name-2`, `name-3`, …). Scoped
 * per (kind, name) exactly like validate.ts's name-duplicate rule, so the
 * suffixing and the lint rule it dodges stay in lockstep by construction.
 *
 * Order-determinism: `incoming` is processed in array order. The FIRST artifact
 * to claim a given (kind,name) keeps the bare name; each later collision (from
 * the existing store OR an earlier batch member) is bumped to the next free
 * suffix. Names already present in `existing` are pre-seeded as claimed, so a
 * batch name never collides with a stored one either.
 *
 * PURE — no id mutation except `name`; ids are preserved (idempotency E18/B2).
 */
export function dedupeImportNames(
  existing: CanonicalArtifact[],
  incoming: CanonicalArtifact[]
): DedupeResult;
```

Algorithm (precise):
1. Build `claimed: Map<kind, Set<name>>` from `existing` (every stored artifact's `(kind,name)`).
2. For each `art` in `incoming` (array order):
   - `base = art.name`; `final = base`; `n = 2`.
   - while `claimed.get(art.kind)?.has(final)`: `final = `${base}-${n}``; `n++`.
   - if `final !== base`: push `{id, from: base, to: final}` to `renames`; set `art.name = final` (on a shallow clone — do NOT mutate the input).
   - `claimed.get(art.kind).add(final)`.
3. Return `{ deduped, renames }`.

Exported from `packages/core/src/index.ts`.

#### §1.2 Daemon wiring — `importArtifacts` handler (handlers.ts ~357)

Insert dedup BEFORE validation, over the SELECTED incoming set against the
existing store's OTHER artifacts:

```
const selected = params.scanned.filter(a => selectedIds.includes(a.id));
const existingOthers = store.artifacts.filter(a => !selected.some(s => s.id === a.id));
const { deduped, renames } = dedupeImportNames(existingOthers, selected);   // NEW (B1)
const merged = [...existingOthers, ...deduped];
const issues = validateAllArtifacts(merged);
// ... blocking filter now over `deduped` (see §1.4) ...
```

`renames` is returned in `ImportArtifactsResult` (new optional field) so the UI
can toast "Renamed 1 duplicate: ba → ba-2". Because dedup runs in the daemon over
a fresh `loadProjectStore`, it is server-authoritative and TOCTOU-free (mirrors
`applyTemplate`'s fresh-read comment at handlers.ts:446).

> NOTE: this replaces `applyTemplate`'s single-artifact loop pattern with a
> batch-aware version. applyTemplate itself is NOT changed by this loop (its
> loop already works for its single-artifact case); `dedupeImportNames` is the
> generalized, batch-aware sibling. /build MAY optionally refactor applyTemplate
> to call `dedupeImportNames(store.artifacts, [artifact])` for one code path,
> but that is a nice-to-have, not required — flag for /review if done.

#### §1.3 `ImportArtifactsResult` shape change (packages/rpc-types)

Add `renames?: Array<{ id: string; from: string; to: string }>`. Optional →
old callers unaffected; migration N/A (transient RPC result, not persisted).

#### §1.4 Empty-description handling — BLOCK-ONE-NOT-ALL (behavior change)

Today `importArtifacts` rejects the WHOLE import if ANY selected artifact has a
blocking lint issue (the current `blocking.length > 0` throw). That is exactly
what made B1 catastrophic. **Change: filter out blocking artifacts and import the
rest, reporting the blocked ones — do NOT throw wholesale.**

Precise policy:
- Run `validateAllArtifacts(merged)`; collect `blocking` = error-level issues whose `artifactId` is in the deduped-selected set.
- Partition selected into `importable` (no blocking issue) and `blocked` (has ≥1).
- Persist ONLY `importable`. Return `{ project, renames, blocked: Array<{id, name, reasons: string[]}> }`.
- The UI shows blocked rows with their reason (e.g. "architect: description is required") and keeps them selectable so the user can fix in Studio or deselect. This matches manual-file-picker F2 (importable-but-flagged) philosophy.

> ⚠️ SCOPE-FLAW FLAG for /cso + user: the LOCKED scope says "auto-suffix like
> applyTemplate" but is SILENT on the empty-description artifact (`architect.md`),
> which auto-suffix cannot fix. Doing block-one-not-all is the minimal change that
> unblocks the import WITHOUT silently persisting an invalid artifact. The
> ALTERNATIVE — keep wholesale-reject — would mean one bad-YAML file still blocks
> the entire import even after B1, re-creating the user's original symptom for any
> repo with one unparseable file. I am choosing block-one-not-all; user/CSO may
> veto. This is the one place I am extending LOCKED scope; called out explicitly.

Empty-description artifacts already carry manual-file-picker's F2 `_importWarning`
(UI-side) when they came through the fallback path; the daemon-side `blocked` list
is the authoritative gate. No IR shape change (warning stays UI-only per F2/T3).

### PLAN §2 — B2: adopt-orphan-on-create (`createProject`, handlers.ts ~215)

New control flow (replaces the current lines 217-232):

```
1. validate path exists + isDir            → else RpcError("invalid-path")     [unchanged]
2. inConfig  = loadGlobalConfig().projects.some(p => p.path === path)
   onDisk    = projectStoreExists(path)
3. if (inConfig && onDisk)  → throw RpcError("already-a-project")   [unchanged intent]
4. if (inConfig && !onDisk) → throw RpcError("already-a-project")
        (a ghost the user should resolve via loadProject's existing project-missing path)
5. if (!inConfig && onDisk) → ADOPT:                                          [NEW — B2]
       existing = loadProjectStore(path)      // reuse id + artifacts (never lose data)
       config.projects.push({ id: existing.id, name: params.name, path })  // refresh NAME from param
       config.lastProjectId = existing.id
       saveGlobalConfig(config)
       return { project: existing }           // NO createProjectStore → store.json untouched
6. if (!inConfig && !onDisk) → CREATE:         [the existing happy path]
       id = randomId(); createProjectStore(...); push config; save; return
```

Rationale:
- **Reuse id + artifacts** (not mint new): a re-registered orphan preserves any
  artifacts the store already held — mint-new would strand them under a dead id.
  This is the whole point of "turns the dead-end into a recovery path".
- **Refresh config `name` from param, keep disk `name`**: the config entry is the
  sidebar label the user just typed; the on-disk `store.name` is left untouched to
  avoid a needless store write during a pure re-register (adopt does NOT write
  store.json — important so adopt is a read-only-on-the-store operation).
- The `inConfig && !onDisk` case (#4) stays a throw: adopting a config entry whose
  store vanished is the "ghost project" case already handled by `loadProject`'s
  `project-missing` guard (handlers.ts:261) — createProject should not silently
  recreate it.

> ⚠️ SECURITY-FLAW FLAG for /cso — **adopt-orphan is a content-trust decision.**
> A malicious/planted `.symbion/store.json` in a folder the user opens will be
> ADOPTED with attacker-chosen id + artifacts + settings, no re-validation. Attack
> surface: an attacker who can write a file into a repo the user later "creates as
> a project" can seed arbitrary artifacts (which then render into `.claude/` on a
> later publish — but publish still goes through diff→confirm→backup, so it is not
> a silent write). Mitigations to consider (CSO to rule): (a) run
> `validateAllArtifacts` on the adopted store and refuse/flag if it has blocking
> issues; (b) treat adopt as "load existing project" not "create" so the user sees
> the artifacts before any publish. RECOMMENDATION: adopt is acceptable because
> the store never causes an unconfirmed disk write (publish is always gated), and
> the user chose this folder — but /cso should confirm the threat model and decide
> whether to add a validate-on-adopt pass. Not blocking the design; flagged.

`createProject` gains no new param. `ProjectStore`/`GlobalConfig` schema unchanged
→ NO migration (state explicitly for /review).

### PLAN §3 — B3a: atomic import (`createProjectAndImport`, NEW combined RPC)

New daemon handler + RPC method. The two dialogs replace their
`createProject`-then-`importArtifacts` sequence with ONE call.

```ts
// packages/rpc-types
export interface CreateProjectAndImportParams {
  name: string;
  path: string;
  selectedIds: string[];
  scanned: CanonicalArtifact[];
}
export interface CreateProjectAndImportResult {
  project: ProjectStore;
  renames?: Array<{ id: string; from: string; to: string }>;
  blocked?: Array<{ id: string; name: string; reasons: string[] }>;
}
```

Handler flow (daemon, transactional):
```
1. createStep = createProject-logic(name, path)   // §2 flow; may CREATE or ADOPT
   remember justCreated = (branch #6 ran)  vs  adopted = (branch #5 ran)
2. try:
      run importArtifacts-logic(project.id, selectedIds, scanned)   // §1 dedup + block-one
   catch (err):
      if (justCreated) rollback():                                  // ONLY if WE created it
          config = loadGlobalConfig(); config.projects = filter(id); saveGlobalConfig
          safeDeleteProjectStore(path)                              // §4 (B3b)
      // if adopted: do NOT delete — the store pre-existed; leave config entry too.
      throw err
3. return { project: <post-import store>, renames, blocked }
```

Why a combined RPC (option a) over client-orchestrated compensation (option c):
a client crash/network drop BETWEEN the two legacy calls would still orphan; a
single server-side handler makes create+import atomic from the client's view and
the rollback runs even if the client disconnects. Option (b) — importArtifacts
self-rolls-back a "just-created" project — is rejected because importArtifacts has
other callers (an already-open project's re-import) that must NEVER delete the
project on a lint failure.

**Rollback correctness:** rollback deletes ONLY when THIS call created the project
(branch #6). If the call ADOPTED a pre-existing orphan (branch #5) and import then
fails, rollback does NOT delete the store (it pre-existed — deleting it would be
data loss) and does NOT remove the config entry (leaving the adopted project
registered but empty-of-new-imports is the safe outcome; user can retry import).

With B1's block-one-not-all (§1.4), `importArtifacts-logic` now throws ONLY on
truly exceptional failures (disk error, all-selected-blocked-and-we-treat-that-as-error?
— NO: block-one-not-all never throws for lint; it returns `blocked`). So the
rollback path is reached only on genuine I/O failure (e.g. `saveGlobalConfig`
after `createProjectStore`, or a disk-full store write). This is correct and
still necessary — B1 reduces but does not eliminate partial-failure risk.

The legacy standalone `createProject` + `importArtifacts` RPCs REMAIN (other
callers, tests). Web: `useArtifactStore` gains `createProjectAndImport`; both
dialogs' `handleImport` call it. The client-side partial-failure toast copy in
the dialogs (ImportDialog.tsx:128-136, CreateProjectDialog.tsx:283-291) is
SIMPLIFIED — with server-side atomicity a failure means NO project exists, so the
"project was created but import failed, open it to retry" message is removed;
failure now shows the raw error and leaves nothing behind.

### PLAN §4 — B3b: `removeProject` cleans the on-disk store (DESTRUCTIVE)

New pure-ish daemon helper in `apps/daemon/src/store/store.ts` (co-located with
`projectStorePath`, reusing `atomicWriteJson`/backup conventions):

```ts
/**
 * safeDeleteProjectStore — reversibly delete a project's Symbion store files.
 * Deletes ONLY `.symbion/store.json` (+ `.symbion/publish-log.json` if present).
 * NEVER deletes `.symbion/backups/` (the reversibility guarantee lives there) and
 * NEVER touches any file outside `.symbion/`. Backup-before-delete: copies each
 * target into `.symbion/backups/removed-<ISO>/` BEFORE unlinking, so removal is
 * reversible exactly like a publish overwrite.
 */
export function safeDeleteProjectStore(projectRoot: string): { backupDir: string; deleted: string[] };
```

MANDATORY guards (each NAMED so /build implements and /cso checks one-to-one):

| Guard | Implementation |
|-------|----------------|
| **G1 path-confine target** | `resolveConfinedPath(projectRoot, ".symbion/store.json")` — throws PathConfinementError if `.symbion` is a symlink escaping root, or the resolved path leaves root. Same for `publish-log.json`. |
| **G2 symlink `.symbion` reject** | If `.symbion` itself is a symlink (`lstatSync(...).isSymbolicLink()`), REFUSE (throw RpcError("unsafe-store", …)) — never delete through a symlinked dir. `resolveConfinedPath`'s realpath-ancestor check backstops this; add an explicit `lstat` for a loud, specific error. |
| **G3 backup-before-delete** | For each existing target: `mkdirSync(.symbion/backups/removed-<ISO>/, {recursive})` (confined) → `copyFileSync(target, backup/store.json)` → THEN `unlinkSync(target)`. Never delete before the backup copy is written. If backup write fails → THROW, do NOT delete (fail-closed). |
| **G4 never-touch-foreign** | ONLY `store.json` + `publish-log.json` are targeted by literal name. No glob, no readdir-and-delete. Any other file in `.symbion/` (incl. `backups/`) is left untouched. Assert in code + test. |
| **G5 backups survive** | The delete list explicitly EXCLUDES `.symbion/backups/`. Deleting the whole dir would nuke the very backup that makes this reversible. |
| **G6 idempotent** | If `store.json` already gone (`!existsSync`), skip it silently (no throw) — re-remove is a no-op. `deleted: []` when nothing existed. |
| **G7 confined backup dir** | The `removed-<ISO>/` backup dir path is itself `resolveConfinedPath`'d under `.symbion/backups/`. |

`removeProject` handler change (handlers.ts ~235): add `deleteStore?: boolean`
param (default `false`).
```
config edit (existing, unchanged) ...
if (params.deleteStore) {
   const path = <the removed project's path from config BEFORE filtering>;   // capture first!
   if (path) safeDeleteProjectStore(path);   // wrapped in try — see below
}
saveGlobalConfig ...
```

Ordering subtlety for /build: capture the removed project's `path` from the config
entry BEFORE filtering it out, else you lose the path. Wrap `safeDeleteProjectStore`
so a delete failure (e.g. G3 backup write failure) surfaces as a typed RpcError but
does NOT leave the config half-edited — recommended: do the disk delete FIRST
(fail-closed: if we can't safely delete, don't drop the config entry either, so the
project stays visible and retryable), THEN save config. /build to confirm this
ordering in code; testplan S-section asserts "delete fails → config entry retained".

`RemoveProjectParams` gains `deleteStore?: boolean`. The rail's Delete button
(already has a confirm per recent commits) passes `deleteStore: true`.

### PLAN §5 — Data-flow diagrams

```
B1 (import collision) — no new disk path, dedup is in-memory pre-persist:
  web: createProjectAndImport({name,path,selectedIds,scanned:[...agents,...cmds,...picks]})
    → daemon: loadProjectStore (read) → dedupeImportNames(existing, selected)  [core, pure]
            → validateAllArtifacts → partition importable/blocked
            → saveProjectStore (ONE atomic write)     ── TOUCHES DISK (store write)
    → { project, renames, blocked } → UI toasts renames + flags blocked rows

B2 (adopt orphan):
  web: createProject({name,path})  [or createProjectAndImport]
    → daemon: loadGlobalConfig (read) + projectStoreExists (read)
            → branch #5: loadProjectStore (read) → saveGlobalConfig (write config only)
                         ── store.json NOT written (adopt is store-read-only)
    → { project } → rail shows the recovered project

B3a (atomic import): see §3 flow — create/adopt → try import → catch → rollback.
  Rollback path TOUCHES DISK: saveGlobalConfig (config) + safeDeleteProjectStore (delete+backup).

B3b (remove + clean store):
  web (rail Delete, confirmed): removeProject({ id, deleteStore:true })
    → daemon: capture path → safeDeleteProjectStore(path):
                 resolveConfinedPath (G1) → lstat .symbion (G2)
                 → copyFileSync store.json → backups/removed-<ISO>/ (G3)   ── DISK write (backup)
                 → unlinkSync store.json (+ publish-log)                   ── DISK delete
            → saveGlobalConfig (drop entry)                               ── DISK write (config)
    → { projects, removed } → rail updates
```

### PLAN §6 — Local-store / global-config schema & migration

**No schema change, NO migration for any of B1–B3b.**
- `ProjectStore` / `GlobalConfig` shapes unchanged (`schemaVersion` stays `1`).
- New fields (`renames`, `blocked` on results; `deleteStore` on `RemoveProjectParams`;
  the whole `CreateProjectAndImport*` pair) are all TRANSIENT RPC wire types, never
  persisted → no `migrateProjectStore`/`migrateGlobalConfig` change.
- Backup files under `.symbion/backups/removed-<ISO>/` are new on-disk artifacts but
  carry no schema (raw copies of the deleted JSON) — nothing to migrate.
Stated explicitly so /review does not expect a migration.

### PLAN §7 — Edge cases (build + test MUST cover)

| # | Case | Expected |
|---|------|----------|
| E1 | `.md`+`.md.tmpl` twins both picked, same kind | 1st keeps bare name, 2nd → `-2`; `renames` reports it; both imported. |
| E2 | Three-way collision (`ba`, `ba`, `ba` same kind) | `ba`, `ba-2`, `ba-3`. |
| E3 | Collision across kinds (`ba` agent + `ba` command) | Both keep bare name (dedup is per-kind). |
| E4 | Incoming name collides with EXISTING store name | Incoming bumped to `-2`; existing untouched. |
| E5 | `architect.md` empty description among a good batch | `architect` goes to `blocked[]` with "description is required"; the rest import; NO wholesale reject (§1.4). |
| E6 | ALL selected are blocked | `importable=[]` → store unchanged, `blocked` lists all; RPC returns normally (no throw). UI: "nothing imported, N blocked". |
| E7 | Adopt orphan with NON-empty artifacts | id + all artifacts preserved; config name = param; store.json NOT rewritten. |
| E8 | Two folders same basename (`/a/vpo`, `/b/vpo`) | Distinct absolute paths → distinct config entries; no false "already a project". |
| E9 | `createProject` on folder in config AND on disk | `already-a-project` (unchanged). |
| E10 | `createProject` on folder in config but store gone (ghost) | `already-a-project` (do NOT recreate); loadProject surfaces `project-missing`. |
| E11 | Import rollback: createProject OK, config write fails mid-import | rollback removes config entry + deletes store (via safeDelete) → no partial state. |
| E12 | Import fails but project was ADOPTED (pre-existing) | NO delete, NO config removal — the orphan pre-existed; user can retry. |
| E13 | `removeProject` when store.json already gone | Idempotent (G6): `deleted:[]`, no throw, config entry still dropped. |
| E14 | `removeProject deleteStore:false` (default) | Config-only removal, store.json UNTOUCHED (old behavior preserved). |
| E15 | `.symbion` is a SYMLINK | G2 refuses (RpcError "unsafe-store"); nothing deleted. |
| E16 | Backup dir write fails during delete (G3) | Fail-closed: nothing unlinked, RpcError thrown, config entry retained (§4 ordering). |
| E17 | `.symbion/backups/` present at remove time | Backups NEVER deleted (G5); only store.json + publish-log.json removed. |
| E18 | Concurrent imports into the SAME new project | Daemon serializes RPCs; each `importArtifacts-logic` does fresh load→dedupe→save. Second import dedupes against the first's now-persisted names. No lost update within a single-threaded daemon; documented assumption T-concurrency. |
| E19 | Re-import unchanged (idempotent) | Same ids upsert in place; dedupe leaves names alone when the incoming id already owns that stored name (an artifact does not collide with ITSELF — dedupe seeds `existing` = store MINUS the selected ids, so a re-imported artifact's own stored name is not in the claimed set). |
| E20 | `renames` audit surfaced to user | UI toast: "Renamed N duplicate(s)". Non-blocking. |

> E19 correctness note for /build: `dedupeImportNames(existing, incoming)` MUST be
> seeded with `existingOthers` = `store.artifacts` EXCLUDING the selected ids
> (already how handlers.ts:366-368 computes `existingOthers`). Otherwise a plain
> re-import of `ba` would see its own stored `ba` as a collision and wrongly bump
> it to `ba-2`. This is the single most important wiring detail of §1.2.

### PLAN §8 — Trade-offs & assumptions (dev + Checker to track)

- **T1 dedup in core (pure), invoked by daemon** — unit-testable + server-authoritative. Accepted over daemon-only (untestable in core) and client-only (TOCTOU/untrusted).
- **T2 block-one-not-all (§1.4)** — EXTENDS locked scope (scope was silent on empty-description). The alternative (keep wholesale-reject) re-creates the user's original symptom for any one-bad-file repo. Flagged for user/CSO veto.
- **T3 combined RPC for atomicity (§3)** — over client compensation; a client crash can't orphan. Cost: one new RPC + wire types.
- **T4 adopt reuses id + artifacts (§2)** — never lose data; the security caveat (planted store.json) is FLAGGED for /cso, mitigated by publish always being diff→confirm→backup gated.
- **T5 delete store.json + publish-log only, backups survive (§4 G5)** — reversibility guarantee. Whole-`.symbion`-delete rejected precisely because it would nuke the backups.
- **T6 `deleteStore` defaults false** — the new destructive path is opt-in; old callers get old behavior with zero risk.
- **T7 single-threaded daemon serializes RPCs (E18)** — assumption: no true concurrency; if the daemon ever goes multi-threaded, dedupe's load→save is not transactional and would need a lock. Documented, not solved here.
- **T8 fail-closed delete ordering (§4)** — disk delete BEFORE config drop, so an unsafe/failed delete keeps the project visible + retryable rather than dropping the config entry and orphaning the store (which is exactly B3's original bug).

### PLAN §9 — Files to create / modify (handoff manifest)

Create:
- `packages/core/src/parse/dedupeImportNames.ts` — `dedupeImportNames` (+ export from core index).
- `packages/core/test/dedupeImportNames.test.ts` — unit cases (see testplan U-section).

Modify:
- `packages/rpc-types/src/index.ts` — `ImportArtifactsResult.renames`/`.blocked`; `RemoveProjectParams.deleteStore`; `CreateProjectAndImportParams`/`Result`; add `"createProjectAndImport"` to `RpcMethod`.
- `apps/daemon/src/rpc/contract.ts` — re-export the new types.
- `apps/daemon/src/store/store.ts` — `safeDeleteProjectStore` (G1–G7).
- `apps/daemon/src/rpc/handlers.ts` — `importArtifacts` (dedup + block-one, §1.2/§1.4); `createProject` (adopt, §2); `removeProject` (deleteStore, §4); NEW `createProjectAndImport` (§3). Extract shared create/import logic into internal helpers so both the standalone RPCs and the combined one reuse ONE implementation.
- `apps/daemon/test/…` — new integration tests for adopt, atomic rollback, safeDelete security (see testplan).
- `apps/web/src/lib/store/useArtifactStore.ts` — `createProjectAndImport` action; `removeProject` passes `deleteStore:true`.
- `apps/web/src/lib/rpc/types.ts` — re-export new types.
- `apps/web/src/components/ImportDialog.tsx` + `CreateProjectDialog.tsx` — `handleImport` → single `createProjectAndImport`; simplify partial-failure copy; surface `renames`/`blocked`.

**No production code written in this loop — /build implements the above.**

### Status: PLAN COMPLETE → next step /build (fold into manual-file-picker's
remaining build per STATE "Relationship to in-flight work", then ONE /review →
/cso → /qa covers both). Full pipeline + /cso MANDATORY (B3b destructive delete +
B2 adopt content-trust).

---

## Scope ratification (user, 2026-07-13)

- **B1 empty-description (§1.4 / T2) — CONFIRMED: block-one-import-the-rest.** The
  architect's extension beyond the original LOCKED scope is APPROVED by the user.
  importArtifacts filters out only blocking artifacts, imports the valid remainder,
  and returns a `blocked[]` list for the UI to surface. This replaces today's
  wholesale-reject. /build implements per §1.4.
- All other PLAN decisions (B1 auto-suffix via pure `dedupeImportNames`, B2
  adopt-orphan reusing store id, B3a `createProjectAndImport` combined RPC, B3b
  `safeDeleteProjectStore` with guards G1–G7) stand as designed.

---

## BUILD — implementation notes (feature-builder / maker, 2026-07-13)

> Folded into the in-flight `manual-file-picker` working tree per STATE
> "Relationship to in-flight work". The /cso F1 leaf-symlink fix
> (guard.ts:66-74) was NOT touched. `npm run build` (rpc-types + daemon + web
> next build) GREEN; `vitest run --project core --project daemon --project web`
> GREEN (507 core+daemon, incl. 14 dedupe unit + 19 importLifecycle integration
> + 17 security; 7 web). Handoff to /review → /cso → /qa.

### Files created
- `packages/core/src/parse/dedupeImportNames.ts` — pure `dedupeImportNames(existing, incoming)` (B1). Exported from `packages/core/src/index.ts`.
- `packages/core/test/dedupeImportNames.test.ts` — U1–U14 (testplan §1).
- `apps/daemon/test/importLifecycle.test.ts` — D1–D18 (B1/B2/B3a integration; §2). D15/D16 rollback use a `vi.mock` of the store module with a `failNextSave` toggle (see assumption A6).
- `apps/daemon/test/importLifecycle.security.test.ts` — S1–S14 + E13/E14 (B3b guards + §4 ordering + B2 adopt content-trust; testplan §3).
- `apps/web/src/components/importPickerShared.ts` — GAINED `surfaceImportOutcome()` (shared renames/blocked toast policy; the file itself pre-existed from manual-file-picker).

### Files modified
- `packages/core/src/index.ts` — export dedupeImportNames.
- `packages/rpc-types/src/index.ts` — `ImportRename`/`ImportBlocked`; `ImportArtifactsResult.renames?`/`.blocked?`; `RemoveProjectParams.deleteStore?`; new `CreateProjectAndImportParams`/`Result`; `"createProjectAndImport"` added to `RpcMethod`.
- `apps/daemon/src/rpc/contract.ts` + `apps/web/src/lib/rpc/types.ts` — re-export the new wire types.
- `apps/daemon/src/store/store.ts` — new `safeDeleteProjectStore` (G1–G7); imports `resolveConfinedPath`/`PathConfinementError` (guard.ts) + `RpcError` (rpcError.ts) — both are leaf modules, no circular import with handlers.ts.
- `apps/daemon/src/rpc/handlers.ts` — extracted shared `createOrAdoptProject` (B2) + `importIntoStore` (B1 dedup + block-one) internal helpers; `createProject` delegates to create-or-adopt; `importArtifacts` delegates to importIntoStore; `removeProject` grows `deleteStore` + fail-closed disk-delete-BEFORE-config-drop ordering; NEW `createProjectAndImport` (B3a atomic + rollback-only-if-created).
- `apps/daemon/test/rpc.integration.test.ts` — one legacy test updated: `importArtifacts` no longer THROWS on a blocking lint error (block-one-not-all §1.4) — it now returns `blocked` and does not persist the bad artifact. (Regression note for /qa: this is the intended behavior change, user-confirmed.)
- `apps/web/src/lib/store/useArtifactStore.ts` — new `createProjectAndImport` action (registers/updates rail entry + sets currentProject); `removeProject` now passes `deleteStore: true`.
- `apps/web/src/components/ImportDialog.tsx` + `CreateProjectDialog.tsx` — `handleImport` → single `createProjectAndImport`; removed the "created but import failed, open it to retry" partial-failure copy (atomicity makes it impossible now); surface renames/blocked via `surfaceImportOutcome`.

### Assumptions made — EXPLICIT for /review, /cso, /qa to verify
- **A1 (E19 seed).** `importIntoStore` seeds `dedupeImportNames`'s `existing` with `store.artifacts` MINUS the selected ids, so a re-import of an already-stored artifact does NOT bump its own name. Verified by D4/U11. ASSUMPTION: `selectedIds` uniquely identifies the same artifact across scans (ids are stable) — if a scan minted a NEW id for an existing on-disk artifact, it would be treated as a new twin and suffixed. This matches today's importArtifacts upsert-by-id semantics.
- **A2 (block-one scope).** `blocked` is computed from ERROR-level `validateAllArtifacts` issues whose `artifactId` is in the deduped-selected set only. Warnings never block. An empty-description artifact hits `description-required` (error) → blocked. Verified D2/D3.
- **A3 (all-blocked = no write).** When `importable.length === 0`, `importIntoStore` SKIPS `saveProjectStore` entirely, so the store is byte-unchanged (D3). This also means the returned `project` is the freshly-loaded store (unchanged) — correct, but note the RPC still returns `{project}` not an error (E6).
- **A4 (adopt = store-read-only).** B2 adopt does NOT rewrite store.json; it only pushes a config entry with the param `name`. The on-disk `store.name` is left as-is (D9/S13). CSO: adopt trusts the planted store's id + artifacts (T4 threat, S12) — NO validate-on-adopt pass was added (PLAN left this to /cso to rule); adopt performs ZERO disk write outside global config, asserted by S12.
- **A5 (rollback only-if-created).** `createProjectAndImport` rolls back (config drop + safeDelete) ONLY when `createOrAdoptProject` returned `justCreated:true`. An ADOPTED orphan is never deleted and its config entry is retained on failure (D16/E12). Rollback cleanup is best-effort (wrapped in try) so the ORIGINAL import error is always surfaced, not a masking cleanup error.
- **A6 (D15/D16 failure injection).** Under ESM, spying a re-exported binding won't rebind handlers.ts's imported copy, so these tests `vi.mock` the store module with a passthrough + `failNextSave` flag. `createProjectStore` uses the module-INTERNAL `saveProjectStore` (real) so create's write still succeeds; only `importIntoStore`'s exported `saveProjectStore` call is failed. VERIFY this reflects a realistic prod failure mode (disk-full / EIO on the import write after a successful create write).
- **A7 (safeDelete targets).** ONLY the two literal names `store.json` + `publish-log.json` are ever targeted — no readdir/glob (S10). Non-file / symlink at those literal paths is refused (G4 lstat), not followed. `.symbion/backups/` is never in the target list (G5/S7).
- **A8 (fail-closed ordering).** `removeProject({deleteStore:true})` does `safeDeleteProjectStore` BEFORE the config filter+save. A delete failure (symlink .symbion, backup-dir/copy failure) throws and the config entry is NOT dropped → project stays visible + retryable (S11/T8). The rail's client `removeProject` always sends `deleteStore:true`; the daemon default is `false` (S11b/E14).
- **A9 (backup-dir create is fail-closed too).** Extended G3 beyond the PLAN's literal wording: BOTH `mkdirSync(backupDir)` AND `copyFileSync` are wrapped → a `backup-failed` RpcError with nothing unlinked (S2 exercises the mkdir path via a chmod 0o500 backups dir). PLAN §4/G3 named only the copy; I judged the mkdir must be equally fail-closed. FLAG for /cso.
- **A10 (web toast policy).** `surfaceImportOutcome` shows a single toast: a `blocked` warning takes precedence over a plain `renames` success when both are present (single-slot toast). Blocked artifacts are NOT auto-added to `selected` for retry — the user re-imports or deselects (matches §1.4). The dialogs still show `error` text only for a thrown RPC error (now only genuine I/O / invalid-path / already-a-project).
- **A11 (no migration).** Confirmed per PLAN §6: `schemaVersion` stays 1; all new fields are transient RPC wire types; backup files under `removed-<ISO>/` carry no schema. No `migrate*` change.
- **A12 (concurrency, T7).** Single-threaded daemon assumption unchanged — `importIntoStore` does a fresh load→dedupe→save with no lock; concurrent imports into the same project rely on the daemon serializing RPCs (E18). Not solved here; documented.

### Deferred / NOT done (intentional)
- applyTemplate was NOT refactored to call `dedupeImportNames` (PLAN §1.2 marked it a nice-to-have, not required). applyTemplate's own auto-suffix loop is unchanged; its tests still pass.
- NO validate-on-adopt pass (A4) — left for /cso to rule per PLAN §2 security flag.
- E11 (config write fails mid-import) is covered structurally by D15's rollback assertion via the generic import-save failure; a targeted saveGlobalConfig-failure test was not added (same rollback branch).

### Status: BUILD COMPLETE → next /review → /cso (MANDATORY: B3b destructive
delete + B2 adopt content-trust) → /qa. Maker did NOT self-review.

---

## REVIEW — independent Checkers (code-reviewer + architect, 2026-07-13)

Combined diff (import-lifecycle-fixes folded onto manual-file-picker, incl. the
/cso F1 leaf-symlink fix that landed after manual-file-picker's own /review).

**code-reviewer → PASS.** Ran core+daemon suite = 507/507 green. Verified all 12
Maker assumptions A1–A12; B1 dedupe purity + order-determinism + E19 seed (no
re-import bump); B1 partial-import blocked[]; B2 adopt (in-config still throws,
reuses id/artifacts); B3a rollback only-when-created (D16 proves adopted store NOT
deleted); B3b guards G1–G7 + A8 fail-closed ordering + A9 mkdir fail-closed; F1
leaf-symlink fix rejects escaping leaf while keeping soft not-found. Only 2
cosmetic nits (double-cast in listTree/readImportFile params; dedupe JSDoc
overstates "clones" for pass-through elements). Neither behavioral.

**architect → PASS.** Design conforms to PLAN §0. Boundary integrity clean (core
pure, daemon sole disk toucher, no circular import). Load-bearing invariant
confirmed: `justCreated` captured synchronously, read in catch, rollback skipped
on adopt → an adopted orphan's store can NEVER be deleted on import failure (D16).
blocked[] contract coherent end-to-end. E19-seed "gap" I raised = false alarm
(existingOthers correctly excludes only selected ids). applyTemplate correctly NOT
refactored (deferred per §1.2).

**NON-BLOCKING design tension flagged (architect):** `removeProject({deleteStore})`
on an ESTABLISHED (previously-published) project deletes `publish-log.json` while
`.symbion/backups/<version>/` survives → backups become orphaned-but-preserved
(the log is itself copied into `removed-<ISO>/` first, so raw recovery works, but a
hand-restore finds backups with no index). Recommend the PLAN explicitly state
backups are intentionally orphaned-but-preserved post-remove, OR reconsider whether
`publish-log.json` should be deleted on a *remove* (vs a *rollback*, where a freshly
-created failed-first-import project has no publish history so it's moot). → routed
to /cso to rule (adjacent to its destructive-delete gate).

### Verdict: BOTH PASS → next **/cso** (MANDATORY): must cover (a) the deferred F1
leaf-symlink re-audit, (b) B3b destructive-delete guards G1–G7 + the publish-log
orphaned-backups tension above, (c) B2 adopt content-trust (planted store.json).
Testplan SECURITY sections (manual-file-picker S1–S17 + import-lifecycle
security.test) are written for it.

---

## CSO — security audit (security-reviewer, independent, 2026-07-13)

MANDATORY /cso over the combined diff. Verified by LIVE exploitation against the
rebuilt daemon dist (scratch exploit tests run then deleted).

**(A) F1 leaf-symlink re-audit → CLOSED.** guard.ts:66-74 (leaf realpath check) +
importTree.ts:337-352 (readImportFile final-target re-check). 8/8 exploit cases
correct: escaping leaf/dir/chain/relative-target symlinks all THROW
path-confinement; in-root symlink succeeds (no false positive); broken symlink →
soft not-found. TOCTOU realpath→open gap ruled immaterial (single-user loopback;
attacker would already need local write) — 🟢 optional O_NOFOLLOW.

**(B) B3b safeDeleteProjectStore → guards G1–G7 all enforce fail-closed.**
backup-before-delete always precedes unlink; A9 mkdir fail-closed confirmed
(chmod 0500 backups/ → aborts, nothing unlinked); G2 lstat refuses symlinked
.symbion; symlinked store.json refused (never follows to foreign target); only the
two literal names unlinked (no glob/readdir); backups/ + foreign files survive;
idempotent; A8 ordering (delete before config-drop) intact. Orphaned-backups
tension RULED acceptable (log copied into removed-<ISO>/ before unlink →
recoverable; only the convenience index is gone) — 🟢 document intent in PLAN §4.

**(C) B2 adopt content-trust → safe, validate-on-adopt NOT required.** Adopt does
zero disk write outside global config (S12 confirmed). No prototype pollution
(plain JSON.parse, __proto__ lands as own prop). Forged managed-marker CANNOT
cause silent foreign overwrite: render always recomputes the hash + diff recomputes
on-disk hash → a planted artifact targeting a foreign file classifies as CONFLICT,
never same/clean/update; diff→confirm→backup gate never bypassed. Traversal via
crafted artifact name blocked at the write layer (writeFiles.ts rejectTraversal +
resolveConfinedPath, per-file action:"error"). 🟢 optional validate-on-adopt for
UX transparency only.

**STRIDE (new/changed RPCs):** createProjectAndImport rollback only-when-created
(adopted never deleted); removeProject deleteStore opt-in default-false, fail-closed;
importArtifacts dedupe+partial server-authoritative/TOCTOU-free; listTree/readImportFile
read-only with daemon-constant caps. Pre-existing (out-of-scope, unchanged by this
diff): tokenless daemon + origin-absent skips origin check — noted, not introduced here.

### Verdict: PASS — no 🔴/🟠/🟡, only 🟢 informational. Security gate CLEARED →
next /qa → /ship. The 🟢 items (O_NOFOLLOW, document orphaned-backups, optional
validate-on-adopt) are non-blocking follow-ups, not ship gates.

---

## QA — SKIPPED (user decision, 2026-07-13)

Live /qa was **explicitly skipped by the user** at the ship gate. Recorded here per
the ship precondition (skip must be documented with residual risk named).

**Automated verification done in lieu of live QA:**
- `npm run build` (full workspace) — clean.
- `vitest run --project core --project daemon` — 507/507 pass (incl. all
  import-lifecycle + manual-file-picker unit/integration/security tests).

**Residual risk NOT covered by the skip (named explicitly):**
1. **UI not browser-verified.** Three rounds of modal fixes shipped without a live
   render check (no Chrome in the build env): (a) modal-scroll, (b) FolderBrowserDialog
   sizing, (c) the Dialog-primitive pinned-footer restructure that touches the shared
   component used by ALL 12 dialogs. A visual regression in any modal would ship
   unnoticed. → run /canary + a manual modal sweep post-ship.
2. **"Role dropdown won't click" bug is UNRESOLVED.** The earlier /investigate
   diagnosed a controlled-select-lags-RPC defect on the skipped-file reclassify path
   but never confirmed the symptom or fixed it. The reclassify UX may still be broken.
3. **End-to-end vpo import flow unverified live.** Adopt-orphan + auto-suffix +
   partial-import were unit/integration tested but not exercised through the real UI
   against the actual vpo repo since the daemon restart.

### Status: DONE (shipped with QA explicitly skipped — residual risk above accepted by user).
