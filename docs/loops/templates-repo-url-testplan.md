# templates-repo-url — Test Plan

> Maps to `templates-repo-url-STATE.md` §7 (AC1–AC11) and PLAN §8 (edge cases §8.9, flaws F1–F22).
> This plan extends the existing suites and does not replace them. Every existing case in `templates-marketplace-testplan.md` and `templates-authors-testplan.md` (U1–U20, D1–D27, E/EA) must keep passing unmodified. Any modification to an existing ECC test is a regression flag, with one exception: adding the new required `origin`/`rootPath` fields to fixtures.
> Fixtures use **synthetic** frontmatter and body text only (no real third-party content).
> Network in unit and integration tests is always mocked: inject `fetchImpl`, or use `vi.spyOn(globalThis, "fetch")`. The daemon config is isolated with `SYMBION_CONFIG_DIR=<tmpdir>`.

## 1. Unit — `packages/core` (Vitest)

### 1.1 `parseGithubSourceUrl` (`src/templates/githubUrl.ts`)

Accept (with exact parsed output asserted):
- [ ] **RU1** `https://github.com/acme/tools` → `{owner:"acme", repo:"tools", ref:null, refSegments:[]}`.
- [ ] **RU2** Normalisations: trailing `/` and `//`-free trailing slashes; `.git` suffix (`https://github.com/acme/tools.git`); `?tab=readme-ov-file`; `#readme`; `www.github.com`; `GitHub.COM` host case; a bare `github.com/acme/tools` (no scheme). All produce the same result as RU1.
- [ ] **RU3** `https://github.com/acme/tools/tree/main` → `refSegments:["main"]`. `…/tree/main/packages/agents` → `["main","packages","agents"]`.
- [ ] **RU4** Percent-decoding: `…/tree/main/my%20folder` → segment `"my folder"`. `…/tree/feature%2Fx` is **rejected** (decoded `/` inside a segment).
- [ ] **RU5** A 40-hex SHA ref is accepted as a segment.

Reject (each must return `{ok:false}` with a non-empty, specific message; never throw):
- [ ] **RU6** `http://github.com/acme/tools` (message mentions https).
- [ ] **RU7** Hosts: `https://gitlab.com/a/b`, `https://github.com.evil.com/a/b`, `https://evil.com/github.com/a/b`, `https://github.com@evil.com/a/b`, `https://user:pw@github.com/a/b`, `https://github.com:8443/a/b`, `https://api.github.com/repos/a/b`, `https://raw.githubusercontent.com/a/b/main/x`, `https://gist.github.com/a/b`.
- [ ] **RU8** Schemes: `git@github.com:a/b.git`, `ssh://github.com/a/b`, `ftp://github.com/a/b`, `javascript:alert(1)`, `file:///etc/passwd`.
- [ ] **RU9** Shape: `https://github.com/acme` (no repo), `https://github.com/acme/tools/blob/main/x.md` (message mentions tree/folder), `…/issues/1`, `…/tree` (no ref), `https://github.com/acme//tools`.
- [ ] **RU10** Traversal: `…/tree/main/../secrets`, `…/tree/main/%2e%2e/x`, `…/tree/%2E%2E/x`, `…/tree/main/./x`, a backslash anywhere, `%5C` decoding to a backslash.
- [ ] **RU11** Control and whitespace: an embedded `\n`, `\t`, `%00`, `%0A` (decoded), or a space inside an unencoded URL.
- [ ] **RU12** Owner and repo charset and length: owner `-acme`, owner of 40 chars, owner `ac_me`, repo `..`, repo `.`, repo of 101 chars, repo `a b`.
- [ ] **RU13** Limits: an input of 2049 chars, 33 ref/path segments, a 256-char segment, a malformed `%E0%A4%A` (decodeURIComponent throws, so it must be rejected, not thrown).
- [ ] **RU14** Fuzz-ish property: for 500 random strings (seeded), the parser never throws, and any `{ok:true}` result has owner/repo matching the regexes and segments passing `isSafePathSegment`.

### 1.2 URL builders, path helpers and ref resolution
- [ ] **RU15** `githubCommitShaUrl("acme","tools","feature/x")` === `https://api.github.com/repos/acme/tools/commits/feature/x` (per-segment encoded, `/` literal). `githubRawFileUrl("acme","tools", sha, "agents/a#b?.md")` encodes `#` and `?`. Every builder output starts with `https://api.github.com/` or `https://raw.githubusercontent.com/`.
- [ ] **RU16** `isSafeRepoRelPath`: accepts `agents/a.md`; rejects `../a.md`, `agents/../../x`, `agents\\a.md`, `a/\u0000.md`, `""`, `/abs.md`.
- [ ] **RU17** `REF_SEGMENT_RE` and the ref rules: accepts `main`, `release-1.2`, `v1.0.0`, `feature/x` (as segments), `user@fix`. Rejects `foo.lock`, `a..b`, `.hidden`, `ü`, `a#b`, a 256-char ref.
- [ ] **RU18** `resolveRefFromCandidates(["feature","x","docs"], [{name:"feature/x",kind:"branch"},{name:"feature",kind:"tag"},{name:"feature-y",kind:"branch"}])` → `{ref:"feature/x", rootSegments:["docs"]}` (longest segment-prefix; `feature-y` is ignored as a string-only prefix).
- [ ] **RU19** A tie between branch `v1` and tag `v1` → the branch wins. No candidates → `null`. A candidate longer than the segments → not matched.

### 1.3 `detectTemplateFolders` / `toRepoRelativeFolders` / `matchAuthorFolders` (`src/templates/detectFolders.ts`)
- [ ] **RU20** Standard root layout (`agents/a.md`, `commands/c.md`, `skills/s/SKILL.md`) → detected 3 folders with counts 1/1/1.
- [ ] **RU21** Only `.claude/agents/a.md` and `.claude/commands/c.md` → detected `.claude/agents` and `.claude/commands`.
- [ ] **RU22** Both `agents/a.md` and `.claude/agents/b.md` → only `agents` is detected for that bucket.
- [ ] **RU23** A folder that exists but has zero matching files (`agents/README.txt`, `skills/x/notes.md`) is **not** detected.
- [ ] **RU24** Root path `plugins/backend`: entries are re-based. `plugins/backend/agents/a.md` is detected as `agents`, and `plugins/other/agents/z.md` is ignored.
- [ ] **RU25** A root path that doesn't exist → `rootExists:false`. A root path that matches a **blob** rather than a tree → `rootExists:false`.
- [ ] **RU26** `rootDirs`: `"."` first with correct `mdFiles`/`skillFiles`, then sorted direct child dirs, `.git` excluded, capped at 200 for a synthetic 300-dir tree.
- [ ] **RU27** `toRepoRelativeFolders("x/y", [{bucket:"agent", path:"."}])` → `x/y`. With root `""` and `"."` → `""`. `matchAuthorFolders` with `path:""` matches `a.md` but not `sub/a.md`.
- [ ] **RU28** Regression: `matchAuthorFolders` U13–U17 unchanged, and ECC's mapping still yields exactly the 4 candidates of U15.

### 1.4 `userSource.ts`
- [ ] **RU29** `validateUserTemplateSource` accepts a well-formed record and rejects each of: a bad id (`ecc`, `u-XYZ`, `u-123`), an owner failing the regex, repo `..`, a ref with `..`, rootPath `../x`, an empty `folders`, two folders with the same bucket, an unknown bucket, a folder path `../x`, `displayName` of 61 chars or containing control chars, a non-ISO `addedAt`, and an extra `filePattern: "**"` (ignored; the pattern always derives from the bucket).
- [ ] **RU30** `parseStoredTemplateSources(undefined)` → `{valid:[], invalidCount:0}`. A non-array object → same. A mixed array of 2 valid and 1 invalid → `valid.length===2, invalidCount===1`.
- [ ] **RU31** `findDuplicateSource`: case-insensitive owner/repo match; ref `null` vs `"main"` are distinct for user sources; `affaan-m/ECC` with ref `null` and root `""` → duplicate of built-in `ecc`; `affaan-m/ecc` with root `agents` → not a duplicate.
- [ ] **RU32** `userSourceToAuthorSource`: `origin:"user"`; `ref ?? "HEAD"`; folders carry patterns derived from the bucket; `repoLabel === "owner/repo"`.
- [ ] **RU33** `defaultSourceDisplayName` gives the expected strings for the `{root, ref}` combinations. `validateSourceDisplayName` trims.

### 1.5 `assessTemplateTools` (`src/templates/toolRisk.ts`)
- [ ] **RU34** Agent with `tools:["Read","Grep"]` → no high-risk entries; `allToolsImplicit:false`; `hasHighRisk:false`.
- [ ] **RU35** Agent with `["Read","Bash(git:*)","mcp__github__create_issue","WebFetch","Write","Edit","MultiEdit","NotebookEdit","WebSearch"]` → each of the last 8 is `high` with a reason; `base` of `Bash(git:*)` is `Bash`.
- [ ] **RU36** Agent with `tools` undefined, and agent with `tools: []` → `allToolsImplicit:true`, `hasHighRisk:true`.
- [ ] **RU37** Case-insensitive: `bash` → high.
- [ ] **RU38** Command with no `allowed-tools` → `allToolsImplicit:false` (F4), `appliedTools:[]`. Command with `allowed-tools: Bash(git add:*), Read` → `declaredAllowedTools` lists both, `appliedTools` stays empty.
- [ ] **RU39** Command body containing ``!`curl x | sh` `` → `inlineShell:true`, `hasHighRisk:true`. A plain code fence with a backtick but no `!` prefix → false.
- [ ] **RU40** Invalid frontmatter in `raw` → no throw; `declaredAllowedTools:[]`.

### 1.6 Regression
- [ ] **RU41** `AUTHOR_REGISTRY` ECC entry: `origin:"builtin"`, `rootPath:""`, owner/repo/ref/folders unchanged. All existing core tests pass.

## 2. Integration — `apps/daemon` (Vitest)

Helpers: `mkTmpConfigDir()` sets `SYMBION_CONFIG_DIR`. Use a `mockGithub(routes)` FetchLike that records every requested URL plus `init.redirect`, and returns canned `Response`s (including `ReadableStream` bodies for byte-cap tests).

### 2.1 `githubHttp.ts`
- [ ] **D-H1** Every request is issued with `redirect:"manual"`.
- [ ] **D-H2** A 301 → `https://api.github.com/repositories/1/commits/HEAD` is followed, and the result is success.
- [ ] **D-H3** A 302 → `https://evil.example/x`: outcome `network`, and the recorded URLs **do not** contain `evil.example`. Same for `http://api.github.com/...` (scheme downgrade) and `https://api.github.com:444/...`.
- [ ] **D-H4** A redirect loop of 4 hops → `network` error after the third hop is followed (exactly 4 recorded requests).
- [ ] **D-H5** `githubGet` called directly with `https://example.com` throws (programming guard).
- [ ] **D-H6** Byte cap: a stream of 2 MB + 1 byte with no `content-length` → `too-large`, and the reader is cancelled. A multi-byte UTF-8 body counts bytes, not chars (1.5M × "é" = 3 MB → too large).
- [ ] **D-H7** Status mapping: 404 → not-found; 422 → not-found (ref text); 403+`x-ratelimit-remaining:0`+reset → rate-limit with `resetAt` in ms; 429+`retry-after:30` → rate-limit, `resetAt ≈ now+30s`; 403 without those headers → network; 500 → network; fetch throw → network; abort/timeout → network.

### 2.2 `inspectTemplateSourceUrl` handler
- [ ] **D-I1** Happy path, root URL: the mock records exactly 2 calls, `…/commits/HEAD` (Accept `application/vnd.github.sha`) and `…/git/trees/<sha>?recursive=1`. The outcome has `commitSha` (the commit, not the tree `sha` field of the tree JSON, which the fixture sets to a different value), `detected`, `rootDirs`, `suggestedDisplayName`, and a 32-hex `inspectToken`.
- [ ] **D-I2** `…/tree/main/plugins/backend` → `ref:"main"`, `rootPath:"plugins/backend"`, detection re-based. Assert the 2 calls (single-segment ref: no matching-refs call), and that `plugins/backend` appears in **no** requested URL (root never reaches the network).
- [ ] **D-I3** `…/tree/feature/x/docs` → calls `matching-refs/heads/feature` then commits/tree. A heads object of `type:"commit"` → no separate commits call. Result `ref:"feature/x"`, `rootPath:"docs"`.
- [ ] **D-I4** Tag fallback: heads returns `[]`, tags returns `v1/rc` → commits call made → success.
- [ ] **D-I5** Every `invalid-url` case from RU6–RU13, sent through the handler → `RpcError("invalid-url")` and **zero** fetch calls.
- [ ] **D-I6** Repo 404 → `not-found` (message contains "private"). Ref 422 → `not-found`. Root missing → `not-found`. Truncated + root missing → the truncation message. Rate limit → `rate-limit` with `resetAt`.
- [ ] **D-I7** No standard folders → success with `detected:[]` and non-empty `rootDirs`.
- [ ] **D-I8** Already saved: `duplicateOf` set. `affaan-m/ecc` → `duplicateOf.id === "ecc"`.
- [ ] **D-I9** Disk: the `SYMBION_CONFIG_DIR` contents are byte-identical before and after inspect (inspect writes nothing).
- [ ] **D-I10** Extra params `{url, owner:"evil", host:"evil.example"}` are ignored. Only github hosts appear in the recorded URLs.

### 2.3 `addTemplateSource` / `listTemplateSources` / `removeTemplateSource`
- [ ] **D-S1** inspect → add with the detected folders → `config.json` contains 1 `templateSources` entry with `id` matching `/^u-[0-9a-f]{10}$/`, the owner/repo/ref/root **from the token** (not from params), and `addedAt`. `listTemplateSources` returns it. Zero network calls during add.
- [ ] **D-S2** Add with extra params `{owner:"evil", repo:"x", ref:"y"}` → the stored record still has the token's values.
- [ ] **D-S3** Token reuse after success → `inspect-expired`. A random token → `inspect-expired`. An expired token (inject `now`) → `inspect-expired`. A failed add (e.g. `no-folders`) does **not** consume the token, so a corrected retry succeeds.
- [ ] **D-S4** `folders` errors: `[]` → `no-folders`; a path not in rootDirs/detected (`"src"` when absent) → `invalid-folders`; `"../x"` → `invalid-folders`; two `agent` entries → `invalid-folders`; bucket `"hook"` → `invalid-folders`. `"."` → accepted.
- [ ] **D-S5** `displayName` of 61 chars, or containing `\u0007` → `invalid-display-name`. Omitted → the default is used.
- [ ] **D-S6** Duplicate (same owner/repo case-insensitively, same ref and root) → `duplicate-source`. Duplicate of ECC → `duplicate-source`.
- [ ] **D-S7** With 20 entries pre-seeded (including 1 invalid entry) → `source-limit`.
- [ ] **D-S8** `templateSources: {"oops":1}` pre-seeded → list returns `[]`; add → `invalid-config`; the file is byte-identical afterwards.
- [ ] **D-S9** Pre-seeded invalid entry (`owner:"evil.com"`) + a valid one → list returns 1 entry with `invalidCount:1`. After adding another source **and** after removing the valid one, the invalid entry is still in the file, unchanged.
- [ ] **D-S10** Remove: an existing id → `{removed:true}`, entry gone, other config fields (`projects`, `port`, `theme`, `lastProjectId`) unchanged. Again → `{removed:false}`. `"ecc"`, `"symbion"`, `"__proto__"`, `"u-../x"` → `invalid-source`.
- [ ] **D-S11** Persistence across restart: add, close the server, start a new server on the same `SYMBION_CONFIG_DIR`, list → the source is present. A token minted before the restart → `inspect-expired`.
- [ ] **D-S12** Atomic write: no `*.symbion-tmp-*` files remain in the config dir after add/remove.

### 2.4 Config compatibility ("migration")
- [ ] **D-M1** A v1 `config.json` without `templateSources` (fixture copied from a real pre-feature file shape) → `loadGlobalConfig` succeeds; list → `[]`; the file is **not rewritten** (mtime and bytes unchanged) by list or fetch.
- [ ] **D-M2** After adding a source, `schemaVersion` is still `1`.
- [ ] **D-M3** Round-trip through other writers: with a source saved, run `createProject` and `removeProject`, and simulate the boot-time port update (`saveGlobalConfig` of a loaded config) → `templateSources` is preserved byte-for-byte.
- [ ] **D-M4** Downgrade simulation: run the **pre-feature** `migrateGlobalConfig` logic (a copy of the current function) on the post-feature file → no throw.
- [ ] **D-M5** Regression: project `store.json` files still get `schemaVersion: 1` on create (guards against an accidental shared-constant bump).

### 2.5 `fetchAuthorTemplates` (user sources + SSRF)
- [ ] **D-F1** User source happy path: the calls are `commits/<ref|HEAD>` → `trees/<commitSha>?recursive=1` → raw URLs of the form `https://raw.githubusercontent.com/<owner>/<repo>/<commitSha>/<enc path>`. Items have `authorOrigin:"user"` and `id` = `"<sourceId>:<repoRelPath>"`. The outcome has `commitSha`, `refLabel`, and `truncated:false`.
- [ ] **D-F2** **SSRF core:** `fetchAuthorTemplates({authorId:"<savedId>", owner:"evil", repo:"x", ref:"y", url:"https://evil.example"})` → every recorded URL host ∈ {api.github.com, raw.githubusercontent.com} and every URL contains the **stored** owner/repo.
- [ ] **D-F3** `authorId` values `"u-0000000000"` (well-formed, absent) → `invalid-author` "not found". Also `"constructor"`, `"__proto__"`, `"toString"`, `"../ecc"`, `""`, `123`, and missing → `invalid-author`, with zero fetch calls.
- [ ] **D-F4** Hand-edited stored entry made invalid after add (owner changed to `evil.com/x`, or ref to `../..`) → `invalid-author` "invalid", zero fetch calls.
- [ ] **D-F5** A malicious tree entry `agents/../../../x.md` or `agents/a\\b.md` in the mocked tree → skipped "Unsafe path", and no raw request is made for it. `agents/a#b.md` → requested as `agents/a%23b.md`.
- [ ] **D-F6** Root path + mapping `"."`: source root `plugins/backend`, folders `[{agent,"."}]` → only `plugins/backend/*.md` files are fetched.
- [ ] **D-F7** A per-file 429 → skipped with the 429 reason. A per-file 404 → skipped (existing). An oversized streamed file → skipped "File too large".
- [ ] **D-F8** CRLF file → parsed successfully.
- [ ] **D-F9** `truncated:true` tree → success with `truncated:true`.
- [ ] **D-F10** Zero matches → `items:[]`, `skipped:[]`, success (the web shows the empty state).
- [ ] **D-F11** Branch moved between two calls: two sequential fetches with different mocked SHAs → each outcome's `commitSha` matches the SHA used in **all** of that load's raw URLs (no mixing).
- [ ] **D-F12** **ECC regression:** `fetchAuthorTemplates({authorId:"ecc"})` makes exactly 1 api.github.com call (`trees/main?recursive=1`, unchanged URL), raw URLs use `/main/`, items are unchanged, and `authorOrigin:"builtin"`. All existing D-tests from templates-authors pass unmodified.
- [ ] **D-F13** Static check: `grep -rn "writeFile" apps/daemon/src/templates/` → 0 matches. `grep -rn "fetch(" apps/daemon/src/templates/` → only inside `githubHttp.ts`.

### 2.6 `applyTemplate` with user sources
- [ ] **D-A1** `applyTemplate` with `authorId:"u-abcdef0123"` and no `acknowledgedThirdParty` → `license-not-acknowledged`. With the ack → success; `sourceTemplateId` stored verbatim.
- [ ] **D-A2** A hand-crafted `applyTemplate` whose template object carries extra keys (`permissionMode:"bypassPermissions"`, `allowedTools`, `customFields:[…]`, `hooks`) → the stored artifact has **none** of them (only name/description/tools/body/meta). This pins the F4 property.
- [ ] **D-A3** No file under the project root other than `.symbion/store.json` changes on apply (no `.claude/` writes).

## 3. Web component tests (Vitest + Testing Library, `apps/web`)
- [ ] **W1** `AuthorTabs`: a tab with `unverified:true` renders the "Unverified" badge inside the tab label; no `button` element is nested inside `role=tab`.
- [ ] **W2** `TemplateCard`: an item with `authorOrigin:"user"` shows "Unverified". An item with `authorId:"u-0123456789"` and no origin also shows it (fail-safe). ECC and Symbion items do not.
- [ ] **W3** `ToolRiskPanel`: renders high-risk tools with danger styling and reason text; the implicit-all-tools row for agents without tools; the "declared but not applied" line for commands; the inline-shell warning. A tool name like `<img src=x onerror=alert(1)>` renders as literal text (query by text; no `img` element in the DOM).
- [ ] **W4** `TemplatePreviewModal`: a user item shows the badge and `ToolRiskPanel` in the preview step. ECC/Symbion items render **without** them (snapshot equal to pre-feature).
- [ ] **W5** `AddTemplateSourceDialog` (mocked store): Check disabled for empty input; `invalid-url` RpcError message shown inline; success → review step pre-fills display name and mapping; "Add source" disabled when every bucket is "none"; `duplicateOf` → "Already added" + Open tab; `inspect-expired` on add → re-inspect called once.
- [ ] **W6** `TemplateSourceMappingForm`: options include "(this folder)" and each `rootDirs` entry with counts; emits `{bucket, path}` only for non-none rows.
- [ ] **W7** `TemplatesView`: with `listTemplateSources` returning 1 source → 3 tabs. Removing the selected source → selection falls back to Symbion, and the cache entry is cleared. `daemonConnected:false` → Add/Remove disabled and the built-in tabs still render. A late fetch result for a removed id doesn't re-create the tab.
- [ ] **W8** `designSystemGuard.test.ts` and `designTokens.test.ts` stay green.

## 4. Manual / QA journey (`/qa`, chrome-devtools against a running daemon + web)

**Setup.** `npm run build`, then start the daemon (`npm run dev` or the packaged `symbion` binary) with `SYMBION_CONFIG_DIR=$(mktemp -d)` to keep the real config clean. Open the printed `http://127.0.0.1:<port>/templates`. Create or have at least one test project (a scratch git repo) for apply.

**Network budget.** Steps marked **[NET]** hit real GitHub. Unauthenticated `core` quota is 60/h per IP. Check `curl -sI https://api.github.com/rate_limit | grep -i remaining` first (this call is free). The whole journey needs ≈ 25 API calls. Steps marked **[OFFLINE]** need no network.

| # | Step | Expected | AC |
|---|---|---|---|
| Q1 | **[NET]** `curl -s -H "Accept: application/vnd.github.sha" https://api.github.com/repos/affaan-m/ecc/commits/HEAD` | 40-hex output (re-verifies the `HEAD` assumption, PLAN §8.11 #7) | — |
| Q2 | **[NET]** Open the ECC tab | Same as before the feature: lists items, no Unverified badge, no tools panel | AC10 |
| Q3 | **[OFFLINE]** Add source → `http://github.com/a/b`, `https://gitlab.com/a/b`, `https://github.com/a/b/tree/main/../x`, `https://github.com/a/b/blob/main/x.md`, `not a url` | Each shows a specific inline error. DevTools Network shows only the `/rpc` call with `invalid-url`. | AC7 |
| Q4 | **[OFFLINE]** Hand-crafted RPC from the terminal: `curl -s -X POST http://127.0.0.1:<port>/rpc -H "Host: 127.0.0.1:<port>" -H "Content-Type: application/json" -d '{"method":"inspectTemplateSourceUrl","params":{"url":"https://github.com.evil.com/a/b"}}'` (also try `https://github.com@evil.com/a/b` and `https://github.com/a/b/tree/main/%2e%2e/x`) | 400 `invalid-url` | AC7 |
| Q5 | **[NET]** Add `https://github.com/wshobson/agents/tree/main/plugins/backend-development` | Review shows ref `main`, root `plugins/backend-development`, commit SHA, detected agents/commands/skills. Add → a new tab with the Unverified badge, a header showing the commit, and lists the templates. | AC1, AC2, AC5 |
| Q6 | **[NET]** Add `https://github.com/affaan-m/ecc` | "Already added as 'ECC'" + Open tab | §8.9 dup |
| Q7 | **[NET]** Add `https://github.com/github/awesome-copilot/tree/main/instructions` | Nothing detected → the mapping form shows "(this folder)" with an md count. Map "(this folder)" → Commands → Add → the tab lists `*.instructions.md` as commands. | AC3 |
| Q8 | **[NET]** Add `https://github.com/wshobson/agents` (root) | Nothing standard detected. rootDirs shows `docs`, `plugins`, `tools`, … Map `docs` → Agents → Add → the tab shows the skipped count and reasons (the "Loaded, but no valid templates" line), not a blank page. | AC9 |
| Q9 | Preview an agent from Q5 that has no `tools` field (or one with Bash) | Tools panel: "No tools field — inherits ALL tools" or Bash highlighted, plus the unverified notice. Preview a command: the "allowed-tools not applied" line where relevant. | AC5 |
| Q10 | Apply that agent to the test project | The licence/unverified step is required. After Confirm apply: `git status` in the test project shows only `.symbion/store.json` changed and **no** `.claude/` file. Publish then shows the diff, and only confirm writes `.claude/agents/<name>.md`. | AC6 |
| Q11 | Stop the daemon, restart it with the same `SYMBION_CONFIG_DIR`, reload | The user tabs are still there. The config file still has `schemaVersion: 1` and the 3 sources. | AC4 |
| Q12 | **[OFFLINE]** Stop the daemon (browser stays open) | Add and Remove are disabled. The Symbion tab still works. | §8.9 |
| Q13 | Remove the Q8 source while its tab is open | Confirm dialog. The tab is gone, Symbion is selected, the other tabs are intact, and the project from Q10 is unchanged. | AC4 |
| Q14 | **[NET]** Add a source with a bad branch: `https://github.com/wshobson/agents/tree/no-such-branch-zz` | "Branch or tag … not found" + Retry. Nothing is saved. | AC8 |
| Q15 | **[NET]** `https://github.com/symbion-nonexistent-owner-zz/x` | "not found, or it is private". Nothing is saved. | AC8 |
| Q16 | **[OFFLINE]** Disconnect the network (or block `api.github.com` in devtools request blocking), select a saved user tab, then Retry | Network error panel with Retry. The page does not crash. Restoring the network and pressing Retry loads the tab. | AC8 |
| Q17 | Rate limit (optional; only if the quota is nearly exhausted, do not burn it deliberately) | Rate-limit panel with the reset time | AC8 |
| Q18 | Edit `config.json` by hand: set one source's owner to `evil.com`, then reload | That tab is gone, and a caption says "1 saved source could not be read". The file entry is not deleted. | §8.9 |
| Q19 | Run `npm test` at the repo root | All suites green: core + daemon + web, including every pre-existing templates test | AC10, AC11 |

## 5. Out of scope for this plan
Private repos and tokens, other hosts, tarball download, hard pinning / update-diff, editing sources in place, extra folder patterns, sharing sources, the Codex/Copilot adapters, the run engine and the graph (STATE §2 OUT).
