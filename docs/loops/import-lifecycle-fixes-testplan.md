# Import Lifecycle Fixes — TEST PLAN

> Companion to `import-lifecycle-fixes-STATE.md` PLAN (architect, 2026-07-13).
> Acceptance standard for /qa. Layers: **Unit (Vitest, core)** ·
> **Integration (Vitest, daemon)** · **SECURITY (daemon — /cso gate for B3b + B2)** ·
> **E2E / manual (web journey)**. Each case is concrete + verifiable.
>
> Run: `vitest run --project core --project daemon`. Integration tests set
> `SYMBION_CONFIG_DIR` to a temp dir (see store.ts:116) and operate on temp repo
> roots — NEVER the real `~/.config/symbion` or a real repo.

## 1. UNIT — `packages/core` (dedupeImportNames, pure)

File: `packages/core/test/dedupeImportNames.test.ts`. No fs/net.

| ID | Case | Assert |
|----|------|--------|
| U1 | Empty incoming | `deduped:[]`, `renames:[]`. |
| U2 | Single incoming, no existing | name unchanged, `renames:[]`. |
| U3 | Two incoming same (kind,name) `ba`,`ba` | 1st `ba`, 2nd `ba-2`; `renames=[{from:"ba",to:"ba-2"}]` on the 2nd's id. |
| U4 | Three same `ba`,`ba`,`ba` | `ba`,`ba-2`,`ba-3`. |
| U5 | `.md`+`.md.tmpl` twins (both name `ba`, kind agent) | order-determined: array-first keeps `ba`, second → `ba-2`. |
| U6 | Collision across kinds: `ba` agent + `ba` command | BOTH keep `ba` (per-kind scoping). |
| U7 | Incoming `ba` collides with EXISTING store `ba` (same kind) | incoming → `ba-2`; existing name untouched (input not mutated). |
| U8 | Existing has `ba` AND `ba-2`; incoming `ba` | incoming → `ba-3` (skips taken suffixes). |
| U9 | Input immutability | original `incoming[i].name` unchanged after call (fn clones). |
| U10 | id preservation | every `deduped[i].id === incoming[i].id` (only `name` may change). |
| U11 | Re-import self (existing EXCLUDES the incoming id) | when `existing` is seeded WITHOUT the incoming artifact's own id, its name is NOT bumped (E19). |
| U12 | Renames audit shape | each rename `{id, from, to}`; only renamed artifacts appear. |
| U13 | Suffix format matches applyTemplate | `${base}-${n}` starting at `n=2` (parity with handlers.ts:456-459). |
| U14 | Name with existing hyphen (`code-reviewer`) collides | → `code-reviewer-2` (suffix appended, not parsed). |

Also re-verify (regression, existing suites): `deriveArtifactName` (`ba.md.tmpl→ba`,
`ba.md→ba`) still green (pickedFile.test.ts) — unchanged by this loop but the
collision it CAUSES is now resolved downstream.

## 2. INTEGRATION — `apps/daemon` (handlers + store)

Files: extend `apps/daemon/test/` (new `importLifecycle.test.ts` or per-handler).
Use a temp repo root + temp `SYMBION_CONFIG_DIR`.

### 2a. B1 — importArtifacts dedup + block-one

| ID | Case | Assert |
|----|------|--------|
| D1 | Import twin `ba` agents (both new) | store ends with `ba` + `ba-2`; result `renames` has 1 entry; NO throw (was: wholesale reject). |
| D2 | Import batch where 1 artifact has empty description | good ones persisted; `blocked` lists the empty-desc one with "description is required"; store does NOT contain the blocked one; NO throw. |
| D3 | ALL selected blocked | store artifacts unchanged; `blocked` = all; result returns normally. |
| D4 | Re-import an already-stored artifact (same id, same name) | name NOT bumped (E19); upsert-in-place; `renames:[]`. |
| D5 | Incoming collides with a DIFFERENT existing artifact's name | incoming bumped; existing untouched. |
| D6 | Dedup is server-authoritative | even if client sends two `ba` with no suffix, daemon suffixes (crafted-client test). |
| D7 | `renames`/`blocked` absent when nothing renamed/blocked | fields undefined or empty; back-compat. |

### 2b. B2 — createProject adopt-orphan

| ID | Case | Assert |
|----|------|--------|
| D8 | Orphan store on disk (artifacts:[a1,a2]), folder NOT in config | createProject ADOPTS: returned project.id === orphan id; artifacts preserved; config now has the entry with `name` = param; store.json byte-unchanged (mtime same / not rewritten). |
| D9 | Adopt refreshes config name | pass a different `name`; config entry name = new; on-disk `store.name` = old (unchanged). |
| D10 | Folder in config AND on disk | throws `already-a-project`. |
| D11 | Folder in config, store gone (ghost) | throws `already-a-project` (NOT recreated). |
| D12 | Fresh folder (neither) | normal CREATE; new id; store.json written. |
| D13 | Two folders same basename, different abs paths | two independent creates, no false already-a-project. |

### 2c. B3a — createProjectAndImport atomicity

| ID | Case | Assert |
|----|------|--------|
| D14 | Happy path (create + import) | project created, artifacts imported, `renames`/`blocked` propagated. |
| D15 | Import throws AFTER create (simulate saveProjectStore/disk failure) | rollback: config entry removed AND `.symbion/store.json` deleted (via safeDelete); backup of the just-created store exists under `.symbion/backups/removed-*`; NO orphan left. |
| D16 | Adopt-then-import fails | NO delete, NO config removal (the store pre-existed, E12); orphan-adopted project stays registered. |
| D17 | Combined RPC on fresh folder with a colliding batch | create + dedupe + persist in one call; result has `renames`. |
| D18 | Legacy standalone createProject + importArtifacts still work | unchanged behavior for other callers. |

## 3. SECURITY — B3b `safeDeleteProjectStore` + B2 adopt (/cso GATE)

File: `apps/daemon/test/importLifecycle.security.test.ts`. These are the /cso
acceptance criteria — every guard G1–G7 has a test. Temp roots only.

| ID | Guard | Case | Assert |
|----|-------|------|--------|
| S1 | G3 | Backup-before-delete | after `safeDeleteProjectStore`, a copy of the ORIGINAL `store.json` exists under `.symbion/backups/removed-<ISO>/store.json` with identical bytes; only THEN is the original gone. |
| S2 | G3 | Backup written BEFORE unlink (ordering) | inject a copyFile failure → assert `store.json` STILL EXISTS (nothing unlinked); RpcError thrown (fail-closed, E16). |
| S1b | G3 | publish-log.json also backed up when present | present → backed up + deleted; absent → skipped, no throw. |
| S3 | G1 | Path confinement | the resolved delete path is confined under root; a `projectRoot` whose `.symbion` resolves outside root → PathConfinementError, nothing deleted. |
| S4 | G2 | `.symbion` is a symlink | lstat detects symlink → RpcError("unsafe-store"); nothing deleted, nothing followed. |
| S5 | G2 | `.symbion/store.json` is a symlink to a foreign file | refused / not followed; the foreign target is NOT unlinked (never-touch-foreign). |
| S6 | G4 | Never-touch-foreign | seed `.symbion/other.txt` + a sibling `README.md` in root → after delete, BOTH still exist; only store.json + publish-log removed. |
| S7 | G5 | Backups survive | seed `.symbion/backups/v1/manifest.json` → after delete it STILL EXISTS (the delete list excludes `backups/`). |
| S8 | G6 | Idempotent | store.json already absent → `deleted:[]`, no throw; re-call is a no-op. |
| S9 | G7 | Backup dir confined | the `removed-<ISO>/` dir resolves under `.symbion/backups/` (confined); a crafted root can't redirect it. |
| S10 | G4 | No glob/readdir-delete | code review + test: only literal `store.json`/`publish-log.json` targeted; a rogue file named `store.json.bak` in `.symbion/` is NOT deleted. |
| S11 | §4 ordering | Delete fails → config entry retained | `removeProject({deleteStore:true})` where safeDelete throws → the project's config entry is NOT dropped (still listed); user can retry (T8). |
| S12 | B2 adopt threat | Planted `store.json` with attacker artifacts | adopt succeeds (documented) BUT no disk write to `.claude/` occurs on adopt; a subsequent publish still goes through diff→confirm (assert adopt itself performs ZERO write outside config). /cso to decide if a validate-on-adopt pass is added — if added, S12b asserts a store with blocking lint is flagged/refused. |
| S13 | read-only-on-adopt | Adopt does not rewrite store.json | store.json mtime/bytes unchanged after adopt (store-read-only). |
| S14 | traversal | `removeProject` path from config with `..` (defense) | safeDelete's `resolveConfinedPath` rejects; loud RpcError. |

/cso checklist mapping: S1–S2→backup-before-delete; S3/S14→path-confinement;
S4/S5→symlink `.symbion` rejected; S6/S7/S10→foreign/backups never deleted;
S8→idempotent; S11→fail-closed; S12/S13→adopt content-trust.

## 4. E2E / MANUAL (web journey — /qa live-verifies; no automated test)

Reproduces the original `vpo` bug + confirms each fix in the real UI.

| ID | Journey | Expected |
|----|---------|----------|
| M1 | Import `vpo` (13 `.md` + 13 `.md.tmpl` twins) via ImportDialog: scan → reclassify the `.md.tmpl` files as Agent → Import | Import SUCCEEDS; twins land as `x` + `x-2`; a toast reports the renames; NO "already exists" wall of errors (the original screenshot symptom is gone). |
| M2 | `architect.md` (bad YAML) in the same batch | Row flagged (⚠ F2 + blocked "description required"); the REST import fine; import is not blocked wholesale. |
| M3 | Adopt orphan: point Create Project at a folder that has a stale `.symbion/store.json` not in the rail | No "already a Symbion project" dead-end; the project is re-registered and appears in the rail with its existing artifacts. |
| M4 | Atomic import failure | (Hard to trigger in UI post-B1; if import errors) NO half-created project remains in the rail; error shown; retry from clean state. |
| M5 | Delete project from rail (with confirm) | Project gone from rail AND `.symbion/store.json` deleted from disk; a backup exists under `.symbion/backups/removed-*`; re-scanning/re-creating the same folder no longer hits the ghost/orphan path. |
| M6 | Delete then re-create same folder | Clean CREATE (no orphan, no adopt) — proves B3b closed the loop that caused B2. |
| M7 | `.symbion/backups/` preserved after delete | Manually inspect: backups dir intact after a rail delete. |

## 5. REGRESSION

- Full `vitest run --project core --project daemon` green (existing + new).
- `apps/web` `next build` (type-check + lint) clean.
- manual-file-picker suites (pickedFile, importTree, S1–S17) still green — this
  cluster folds into that feature; its READ-ONLY guarantee + safety caps must NOT
  regress. Re-confirm the /cso round-1 leaf-symlink fix (guard.ts:66-74) is still
  present and covered (it was landed but not re-audited per STATE).
- applyTemplate auto-suffix behavior unchanged (or, if refactored to call
  `dedupeImportNames`, its existing tests still pass — flag to /review).
