# Manual File Picker for Import — TEST PLAN

> Executed by /qa (mechanical) + /cso (SECURITY section). Acceptance standard
> for /review. Derived from `manual-file-picker-STATE.md` PLAN §1–§9.
> Framework: Vitest (core unit + daemon integration), chrome-devtools web journey.
>
> Feature is READ-ONLY: no test may assert a write to the target repo's
> `.claude/`. The only persisted effect is artifacts landing in `.symbion/store.json`
> via the existing `importArtifacts` RPC.

---

## A. Unit tests — `packages/core` (pure, no fs) — `pickedFile.ts`

| # | Test | Setup | Expected |
|---|------|-------|----------|
| U1 | deriveArtifactName strips `.md.tmpl` | `deriveArtifactName("ba.md.tmpl")` | `"ba"` |
| U2 | strips `.md.tmpl` with hyphen | `"code-reviewer.md.tmpl"` | `"code-reviewer"` |
| U3 | strips single `.md` | `"architect.md"` | `"architect"` |
| U4 | strips single unknown ext | `"notes.txt"` | `"notes"` |
| U5 | no ext left as-is | `"Makefile"` | `"Makefile"` |
| U6 | classifyPickedFile — valid frontmatter agent | content with `---\ndescription: x\n---\nbody` , kind agent | `{ artifact }` no `warning`; `artifact.description==="x"`, `kind==="agent"` |
| U7 | classifyPickedFile — bad YAML (vpo case) | content whose frontmatter throws (`Nested mappings...`) | `{ artifact, warning }`; `warning` non-empty; `artifact.description===""`; `artifact.body===` raw content (trimmed); `meta.status==="draft"` |
| U8 | classifyPickedFile — no frontmatter | plain markdown, no `---` | fallback: `{ artifact, warning }`, body = raw, empty description |
| U9 | classifyPickedFile honors user kind verbatim (F4) | command-shaped body, kind agent | `artifact.kind==="agent"` (no sniffing / no override) |
| U10 | classifyPickedFile — kind command sets usesArguments | body contains `$ARGUMENTS`, kind command | `artifact.usesArguments===true` |
| U11 | isProbablyBinary — NUL byte | string containing `\x00` | `true` |
| U12 | isProbablyBinary — plain text | normal markdown | `false` |
| U13 | isProbablyBinary — high control-char ratio | mostly non-printable bytes | `true` |
| U14 | fresh id when no marker | fallback artifact | valid uuid-shaped `id`, `meta.status` draft |
| U15 | marker id reused when present | content with `<!-- managed-by: symbion ... id ... -->` | `artifact.id` == marker id (E18 idempotency basis) |

## B. Unit / integration tests — `apps/daemon` — `importTree.ts`

Use a temp fixture repo under the scratchpad; assert against real fs.

| # | Test | Setup | Expected |
|---|------|-------|----------|
| D1 | walkImportTree flat parent-before-child | small fixture `a/`, `a/b.md`, `c.md` | nodes include `a` before `a/b.md`; relPaths POSIX-style |
| D2 | dirs + files both returned | mixed tree | dir nodes `isDir:true`, file nodes `isDir:false` with `size` |
| D3 | ignore-list prunes node_modules | fixture with `node_modules/x/y.md` | `node_modules` node present with `ignored:true`; NO descendant nodes for it |
| D4 | all ignore names pruned | fixture with each of `.git .next dist build coverage out .turbo .cache .symbion .venv vendor target` | each present as `ignored:true`, none descended |
| D5 | empty repo (E1) | empty dir | `nodes:[]`, `truncated:false` |
| D6 | depth cap (E3) | dir nested 12 deep | dirs beyond `MAX_DEPTH=8` absent; `truncated:true`, reason includes `"depth"` |
| D7 | per-dir cap (E4) | one dir with 600 files | ≤500 file nodes for it; `truncated:true`, reason `"per-dir"` |
| D8 | total-node cap (E2) | fixture with >5000 nodes | `nodes.length<=5000`; `truncated:true`, reason `"total-node"`; returns promptly |
| D9 | permission-denied dir tolerated (E8) | chmod 000 subdir | walk does not throw; other nodes still returned |
| D10 | readImportFile happy path | `prompts/ba.md` (valid text) | `{ ok:true, content }` == file content |
| D11 | readImportFile too-large (E14) | 600 KiB text file | `{ ok:false, reason:"too-large" }`; file NOT fully read into memory |
| D12 | readImportFile binary (E7) | a `.png` | `{ ok:false, reason:"binary" }` |
| D13 | readImportFile missing | non-existent relPath | `{ ok:false, reason:"not-found" }` |
| D14 | listTree root must be dir | root = a file path | RpcError |
| D15 | caps are daemon constants | crafted params trying to raise a cap | ignored — walk uses constants, not params |
| D16 | READ-ONLY guarantee | run listTree + readImportFile over fixture | fixture bytes/mtimes unchanged; no files created/renamed/deleted |
| D17 | symlinked dir treated as leaf (E5) | `a → b`, `b → a` cycle | terminates; symlinked dir node `isSymlink:true`, not descended |

## C. Integration tests — RPC + import round-trip

| # | Test | Expected |
|---|------|----------|
| I1 | listTree RPC dispatch | `method:"listTree"` reaches handler; returns `ListTreeResult` |
| I2 | readImportFile RPC dispatch | returns discriminated `ReadImportFileResult` |
| I3 | picked file → importArtifacts → store | classify → import; artifact appears in `.symbion/store.json`; NO write to repo `.claude/` |
| I4 | duplicate name across roles allowed (E12) | agent `ba` + command `ba` both import (different kind) |
| I5 | duplicate agent name blocks (E12) | two agents `ba` → `importArtifacts` throws `validation-failed`; store unchanged |
| I6 | re-import idempotent (E18) | marker-carrying file re-picked twice → single row (upsert by id) |
| I7 | reclassify skipped file uses readImportFile (PLAN §4 B) | reclassifying a `skipped[]` row triggers `readImportFile`, not a scan re-slurp; imports successfully |

## D. Web journey (chrome-devtools) — manual/e2e

| # | Journey | Expected |
|---|---------|----------|
| W1 | Import vpo-like repo, auto scan | agents/commands counts + skipped rows for `*.md.tmpl` and bad-YAML `architect.md` |
| W2 | Reclassify a skipped `.md.tmpl` as Agent | ⚠ warning badge shown (F2); becomes importable; import succeeds |
| W3 | "Browse files manually →" opens tree | tree renders; `node_modules`/`.git` shown greyed `(ignored)`, non-expandable |
| W4 | Pick a file in `prompts/`, role=Command | row shows role; on import it lands as a command |
| W5 | Oversized/binary file rows | disabled with tooltip reason; cannot be picked |
| W6 | Truncated banner | large repo shows "results truncated" banner |
| W7 | Both dialogs | same picker + reclassify available in ImportDialog AND CreateProjectDialog |
| W8 | Cancel/close | picker state discarded; no persisted side effect (transient, PLAN §6) |
| W9 | Role dropdown has NO "Hook" option (F3) | only Ignore / Agent / Command |

---

## E. SECURITY test cases — for /cso (security-reviewer) — MANDATORY

These map 1:1 to PLAN §5. /cso must confirm each has a passing test AND that the
guard is enforced in the daemon walker/reader (not just the UI).

| # | Attack / boundary | Vector | Expected |
|---|-------------------|--------|----------|
| S1 | Path escape via `..` | `readImportFile({ root, relPath: "../../etc/passwd" })` | **throws** RpcError (PathConfinementError); no read outside root |
| S2 | `..` mid-path | `relPath: "prompts/../../secret"` | throws RpcError |
| S3 | Windows-style `..` | `relPath: "prompts\\..\\..\\secret"` | throws RpcError (rejectTraversalSegments covers `\`) |
| S4 | Absolute relPath (POSIX) | `relPath: "/etc/passwd"` | throws RpcError (absolute not allowed) |
| S5 | Absolute relPath (Windows) | `relPath: "C:\\Windows\\win.ini"` | throws RpcError |
| S6 | Symlink escape read | fixture symlink `link → /etc`, `readImportFile({root, relPath:"link/passwd"})` | throws RpcError (symlink-escape) — realpath outside root |
| S7 | Symlink escape in walk | symlinked dir → outside root | excluded from walk; never emitted as a descendable node |
| S8 | Symlink cycle | `a→b→a` | walk terminates (leaf treatment); no hang/OOM (S-DoS) |
| S9 | Oversized file read | 5 MB text file | `{ok:false,reason:"too-large"}`; process memory bounded (never buffers full file) |
| S10 | Binary import attempt | `.wasm`/`.png` forced via readImportFile | `{ok:false,reason:"binary"}` |
| S11 | Deep-tree DoS | 50-level nesting | depth cap trips; `truncated`+`"depth"`; bounded time |
| S12 | Node-count DoS | >5000 nodes | total-node cap trips at ≤5000; `truncated`+`"total-node"`; returns promptly |
| S13 | Per-dir fan-out DoS | dir with 100k entries | per-dir cap trips at ≤500; bounded response |
| S14 | Cap tampering | client params attempting larger depth/node caps | ignored — caps are daemon constants |
| S15 | Read-only enforcement | run listTree/readImportFile over a fixture, snapshot fs before/after | zero mutations: no create/rename/delete/chmod; foreign files untouched |
| S16 | root outside anything sane / not a dir | `root` = `/etc/passwd` (a file) | RpcError (root must be dir) |
| S17 | Confinement violation is LOUD not silent | any S1–S6 | surfaces as a hard RpcError to the client, not a soft `{ok:false}` skip (PLAN §3 / T6) |

### /cso pass criteria
- Every S-row has an automated test (Vitest daemon integration) that passes.
- Grep confirms `resolveConfinedPath` / `rejectTraversalSegments` on every fs
  access in `importTree.ts` and `readImportFile`.
- No `writeFileSync`/`mkdirSync`/`rmSync`/`renameSync`/`unlinkSync` anywhere in
  the new daemon code (read-only proof).
- Cap constants exist and are not overridable via RPC params.
- Directory symlinks are never followed during the walk (cycle-proof by construction).

## Status: TEST PLAN READY → consumed by /build (write these), /review, /cso, /qa
