# templates-repo-url — STATE

> Feature: add a template source to the Templates page by pasting a GitHub repo link.
> Phase: **BUILD complete (feature-builder, 2026-10-19)** — see §9 → next: `/review` (code-reviewer + architect), then mandatory `/cso`, then `/qa`.

## 1. Problem

Templates currently come from two fixed sources: the bundled **Symbion** gallery and **ECC**, a GitHub repo that is hard-coded in `AUTHOR_REGISTRY` (`packages/core/src/templates/authorSource.ts`). To use templates from any other repo, someone has to change the code and get it reviewed.

The user wants to paste a GitHub link on the Templates page and get a new tab of that repo's agents / commands / skills. They can then preview those templates and apply them to a project the same way as with ECC.

This deliberately **reverses** decision THINK #2 in `templates-authors-STATE.md` (§ "Author source = a short, manually-reviewed hardcoded list. No self-service paste-any-repo-URL flow"). That decision was made to avoid two problems:
- a new tab that looks broken because the repo's folder layout is different
- many files being skipped because their frontmatter doesn't match Symbion's

Both problems are handled here by auto-detecting folders with a manual fallback (§2) and by showing what was skipped (§5).

## 2. Scope

### IN (v1)
- **Add a source by link.** The Templates page gets an "Add source" action that takes a GitHub URL:
  - `https://github.com/<owner>/<repo>` (the repo's default branch, read from the repo root)
  - `https://github.com/<owner>/<repo>/tree/<ref>/<sub/path>` (a branch or tag, plus an optional subfolder used as the root)
- **Folder detection, with a manual fallback.**
  - Under the chosen root, look for the standard layouts: `agents/*.md`, `commands/*.md`, `skills/*/SKILL.md`. Also look for the same layout under `.claude/`.
  - If at least one standard folder is found, use what was found.
  - If none is found, show the repo's top-level folders and let the user choose which folder holds agents, which holds commands and which holds skills. The patterns stay the same two that exist today (`*.md` and `*/SKILL.md`).
- **Sources are saved** in the user-level Symbion config (the global config the daemon already owns), **not** in any project repo.
  - Each saved source becomes a tab next to Symbion and ECC and survives a daemon restart.
  - A saved source can be **removed** from the UI.
  - Data per source: id, display name (defaults to `owner/repo`), owner, repo, ref, root path, folder mapping, date added.
- **How content is fetched.** Reuse the ECC path (`apps/daemon/src/templates/githubFetch.ts`):
  - one GitHub **tree API** call per load, plus file contents from **raw.githubusercontent.com**, which does not count against the API quota
  - keep the existing limits: 150 candidate files, 2 MB per file, timeouts, and the errors for rate limits / not-found / network
  - keep the existing per-session in-memory cache
- **Version shown.** A source follows the branch or tag the user chose. The tab shows the **commit SHA** it is currently showing, taken from the tree response. Each fetch can return newer content; there is no hard pin.
- **Trust UX for unverified sources.**
  - User-added sources are labelled **"Unverified"** on the tab and on each template card.
  - Before applying a template, the preview prominently shows the `tools` it requests. `Bash`, `Write`, `Edit`, `WebFetch`, MCP tools and an absent `tools` field (which means all tools are allowed) are highlighted as high-risk.
  - Apply still goes through the existing flow: preview → diff → confirm → write.
- **Show what was skipped.** If some files don't parse, the tab says how many were skipped and why, so a repo that only partly parses doesn't look broken.

### OUT (v1)
- Private repos, GitHub tokens, GitLab / Bitbucket / any other host.
- Downloading a tarball or zip of the repo.
- Hard-pinning a commit SHA, or an "update and diff against what I saw before" flow.
- Editing a saved source in place. To change one, remove it and add it again.
- Folder patterns other than `*.md` and `*/SKILL.md`.
- Sharing sources across machines, or importing / exporting a source list.
- Changing the bundled Symbion or ECC sources (they stay in `AUTHOR_REGISTRY`, read-only).

## 3. Data model changes
- **Global config (daemon store).** Add a list of user sources (exact name decided by `/plan`). This needs a `schemaVersion` bump and a migration in `migrateGlobalConfig` (`apps/daemon/src/store/store.ts`), so existing config files without the list still load.
- **Core types.** Reuse the `AuthorSource` `kind: "github"` shape and add:
  - a root path
  - an origin flag (`builtin` vs `user`) that drives the "Unverified" label
  
  `AUTHOR_REGISTRY` stays the reviewed built-in list; user sources are merged in at runtime.
- **RPC (daemon).** New methods to add / list / remove user sources. `fetchAuthorTemplates` must also accept user-source ids, resolved **server-side** from the stored config.
- **No changes to** the Canonical IR, the rendered target file formats (`.claude/…`, `AGENTS.md`) or per-project `.symbion/` data.

## 4. Security constraints (mandatory — trust boundary; full pipeline + `/cso` required)
Today's `fetchAuthorTemplates` is deliberately SSRF-safe: it never reads an owner or repo sent by the client (handlers.ts, "PLAN §P8 SSRF finding #1(a)"). This feature has to accept user-entered owner / repo / ref / path, so all of the following hold:
- **The URL is parsed and validated on the daemon.**
  - Only scheme `https` and host `github.com` (optionally `www.`) are accepted.
  - owner and repo must match GitHub's allowed characters. ref and path segments are restricted: no `..`, no backslash, no control characters, URL-encoded before use, with length limits.
- **The daemon only ever builds requests to fixed hosts**: `api.github.com` and `raw.githubusercontent.com`. It never fetches a URL taken directly from client input. No redirects to other hosts.
- **When fetching, the source is looked up by id from stored config.** Owner / repo / ref sent with a fetch request are ignored.
- **Fetched template content is untrusted.**
  - It is never written to disk until the user applies it through the existing confirm → write flow (with path confinement, backup and marker).
  - It is rendered as plain text / safe markdown, following the rule in `CLAUDE.md`.
- **Limits.** Keep the existing caps (150 files, 2 MB per file, timeouts) and add a cap on the number of saved sources (e.g. 20). The config write is atomic, as it is today.
- **Writes stay confined.** Saving a source writes only the user config file, through the existing atomic JSON writer.

## 5. Edge cases
- **Malformed link**, a non-GitHub host, or an owner/repo-only link with a trailing `.git` or `/`: reject with a clear message, or normalise where it's safe.
- **Repo / ref / path not found (404), private repo, rate limit (403/429 with reset time), network down or timeout**: use the same error kinds ECC already uses. The source can still be saved, or the add can be refused (`/plan` decides). The error is shown on the tab with a retry button.
- **No standard folders and the user maps nothing** → refuse to add the source.
- **Mapped folder exists but every file fails to parse** → the tab shows the skipped count and reasons, not an empty-looking tab.
- **Tree response is truncated** (very large repo) → proceed with the partial tree and say so.
- **Duplicate source** (same owner/repo/ref/root) → refuse, or focus the existing tab.
- **A source is removed while its tab is open** → fall back to the Symbion tab.
- **A template name collides** with an existing artifact in the target project → handled by the existing apply / conflict flow.
- **The branch moves between loads** → the SHA shown changes. Nothing breaks.
- **The daemon is disconnected** while adding or removing → the action is disabled, as other writes already are.
- **Config file written by an older version** (no sources list) → migrated without loss.

## 6. Impact on existing features
- **Templates page (`TemplatesView.tsx`)**: tabs now come from built-in plus user sources, and the page gets the add / remove UI and the Unverified label.
- **`fetchAuthorTemplates` and `githubFetch.ts`**: generalised to take a root path and a resolved source, instead of only `AUTHOR_REGISTRY` entries. ECC behaviour must not change.
- **Global config store**: schema bump + migration.
- **Apply flow (`applyTemplate` / author apply)**: unchanged apart from the tools / risk display in the preview.
- **Unaffected**: publish / upsert, adapters, the run engine and the graph.

## 7. Acceptance criteria
1. Pasting `https://github.com/<owner>/<repo>` for a public repo with standard folders adds a tab. The tab lists that repo's agents / commands / skills and shows the commit SHA being viewed.
2. Pasting `…/tree/<ref>/<subpath>` uses that ref and treats the subpath as the root.
3. For a repo with no standard folders, the user can map top-level folders to agents / commands / skills, and the tab then lists the templates.
4. A saved source survives a daemon restart and can be removed. After removal its tab is gone and nothing else changes.
5. User sources (tab and cards) show "Unverified". The preview before apply lists the requested tools and highlights high-risk ones (including a missing `tools` field).
6. Applying a template from a user source goes through the existing preview → diff → confirm → write flow. Nothing is written before confirm.
7. Non-GitHub hosts, `http:`, `..` in ref/path, and malformed URLs are rejected **by the daemon**, not only the UI. A hand-crafted RPC can't make the daemon request any host other than `api.github.com` / `raw.githubusercontent.com`, and the owner/repo used for a fetch always come from stored config.
8. 404, rate-limit, private-repo and network errors show clear messages with a retry, and never crash the page.
9. Partially parsing repos show the skipped count and reasons.
10. ECC and the Symbion tab behave exactly as before. The existing templates tests pass, and old config files migrate.
11. Unit tests cover URL parsing / validation, folder detection, config migration, and the server-side resolution of a source id. `/cso` signs off with no high or medium findings.

## Pipeline note
This touches daemon RPC, a user-supplied network target (SSRF surface) and a config write. Per `CLAUDE.md` it must go through the **full** pipeline: `/plan` → `/build` → `/review` → **`/cso`** → `/qa` → `/ship`. `/simplify-implementation` does not apply.

---

## 8. PLAN — Architecture (architect, 2026-10-19)

> Input: §1–§7 above (no design doc exists for this feature — UI decisions are made concrete in §8.7).
> Test plan: `docs/loops/templates-repo-url-testplan.md`.
> GitHub behaviour below was **verified live during PLAN** (read-only `curl`, 2026-10-19), not assumed:
> - `GET api.github.com/repos/affaan-m/ecc/commits/HEAD` with `Accept: application/vnd.github.sha` → `200`, body = the 40-hex **commit** SHA, `content-length: 40`, counts 1 against the `core` 60/h quota.
> - `GET …/commits/no-such-branch-xyz` → **422** `"No commit found for SHA: …"` (not 404). Unknown repo / private repo → **404**.
> - `GET …/commits/maint/pr-2646-antigravity-wrapper` (a ref with a slash, literal or `%2F`-encoded) → 200.
> - `GET …/git/matching-refs/heads/ma` → JSON array of `{ref, object:{sha,type}}`. It is a string-prefix match (returned `main` **and** `maint/pr-…`).
> - The ECC repo was renamed: `GET api.github.com/repos/affaan-m/everything-claude-code/commits/HEAD` → **301** `location: https://api.github.com/repositories/1136590548/commits/HEAD` (same host). `raw.githubusercontent.com/<old-name>/HEAD/README.md` → 200 directly. `raw…/<owner>/<repo>/HEAD/<path>` works.

### 8.1 Package / app boundaries and files

**Rule kept:** `packages/core` = pure parsing, validation, URL *string* building, detection, risk. `apps/daemon` = every network call and every config read/write. `apps/web` = presentation only, with every effect going through typed RPC. `packages/core` has `lib: ["ES2022"]` with no DOM lib, so the WHATWG `URL` global is **not** available there. The URL parser in core is a strict hand-written parser. That is deliberate anyway: WHATWG `URL` silently normalises (it strips tab/newline, converts `\` to `/`, and folds `%2e%2e` to `..`). We want inputs like that **rejected**, not normalised.

#### `packages/core` (pure)

| File | Status | Contents |
|---|---|---|
| `src/templates/githubUrl.ts` | NEW | `parseGithubSourceUrl(input: string): ParseGithubSourceUrlResult` (§8.2.4). `GITHUB_OWNER_RE`, `GITHUB_REPO_RE`, `REF_SEGMENT_RE`, `COMMIT_SHA_RE = /^[0-9a-f]{40}$/`. `isSafePathSegment(seg)`, `isSafeRepoRelPath(path)`, `encodePathSegments(path)` (per-segment `encodeURIComponent`, `/` kept literal). URL-string builders, all returning `https://api.github.com/...` or `https://raw.githubusercontent.com/...` only: `githubCommitShaUrl(owner, repo, ref)`, `githubTreeUrl(owner, repo, treeish)`, `githubMatchingRefsUrl(owner, repo, "heads"\|"tags", prefix)`, `githubRawFileUrl(owner, repo, treeish, relPath)`. `resolveRefFromCandidates(segments: string[], refNames: Array<{name: string; kind: "branch"\|"tag"}>): {ref: string; rootSegments: string[]} \| null` (§8.4.2). `GITHUB_FETCH_HOSTS = ["api.github.com", "raw.githubusercontent.com"] as const`. |
| `src/templates/detectFolders.ts` | NEW | `detectTemplateFolders(tree: GithubTreeEntry[], rootPath: string): FolderDetection`, `toRepoRelativeFolders(rootPath, folders): GithubFolderMapping[]`, `ROOT_FOLDER = "."` (§8.5). |
| `src/templates/userSource.ts` | NEW | `interface UserTemplateSource` (§8.3), `USER_SOURCE_ID_RE = /^u-[0-9a-f]{10}$/`, `MAX_USER_TEMPLATE_SOURCES = 20`, `validateUserTemplateSource(x: unknown): {ok:true; source} \| {ok:false; reason}`, `parseStoredTemplateSources(raw: unknown): {valid: UserTemplateSource[]; invalidCount: number}`, `userSourceDedupeKey(s)`, `findDuplicateSource(candidate, users, builtins): {id; displayName} \| null`, `defaultSourceDisplayName(owner, repo, ref, rootPath)`, `validateSourceDisplayName(s)`, `userSourceToAuthorSource(s): GithubAuthorSource`, `folderPatternForBucket(bucket)` (skill → `*/SKILL.md`, else `*.md`; never client-chosen). |
| `src/templates/toolRisk.ts` | NEW | `assessTemplateTools(input: {kind: TemplateKind; tools?: string[]; raw: string}): TemplateToolAssessment` (§8.6). `HIGH_RISK_TOOLS`. |
| `src/templates/authorSource.ts` | MODIFY | `github` variant gains **required** `origin: "builtin" \| "user"` and `rootPath: string` (`""` = repo root). The ECC entry gets `origin: "builtin", rootPath: ""`. Export `type GithubAuthorSource = Extract<AuthorSource, {kind:"github"}>` from here (currently declared in daemon `githubFetch.ts`; keep a re-export there). The header comment about THINK #2 is updated to say user sources now exist but live in config, not in the registry. |
| `src/templates/matchAuthorFolders.ts` | MODIFY (tiny) | Support `folder.path === ""` (the repo root as a bucket folder, needed for the `"."` root mapping at repo root): `const prefix = folder.path === "" ? "" : folder.path + "/"`. ECC is unaffected because its paths are non-empty. |
| `src/templates/templateListItem.ts` | MODIFY | add `authorOrigin?: "builtin" \| "user"`. Absent means builtin (back-compat). It is **set by the daemon only**. |
| `src/ir/types.ts` | MODIFY | `GlobalConfig.templateSources?: unknown[]`. Untrusted on read, always passed through `parseStoredTemplateSources`. **No `schemaVersion` bump** (see §8.3 / flaw F6). |
| `src/index.ts` | MODIFY | export the 4 new modules. |

#### `apps/daemon`

| File | Status | Contents |
|---|---|---|
| `src/templates/githubHttp.ts` | NEW | `githubGet(fetchImpl, url, {timeoutMs, accept, maxBytes}): Promise<GithubGetResult>`. It is the **only** function in the daemon that calls `fetch` for templates. (1) `assertAllowedGithubUrl(url)`: `new URL(url)`; protocol `https:`; hostname ∈ `GITHUB_FETCH_HOSTS`; no username, password or port. It throws, which is a programming bug and never user-reachable. (2) `fetch(url, {redirect: "manual", signal, headers: {Accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "symbion"}})`. (3) For 301/302/307/308, the `Location` is resolved against the current URL and **re-asserted** against the allowlist, then followed. Maximum 3 hops. A redirect to any other host returns `{kind:"network", message:"GitHub redirected to an unexpected host."}` and the off-host URL is **never** fetched. (4) The body is read through `res.body.getReader()` with a **byte** counter. Over `maxBytes` → `reader.cancel()` and a `too-large` result. `content-length` is a pre-check only. (5) `mapGithubError(res, ctx)`: 404 → not-found ("not found or private"); 422 → not-found ("branch or tag … not found"); 403 + `x-ratelimit-remaining: 0` → rate-limit (resetAt from `x-ratelimit-reset`); 429, or 403 with `retry-after` → rate-limit (resetAt = now + retry-after s); any other non-2xx → network. |
| `src/templates/githubFetch.ts` | MODIFY | Uses `githubGet` everywhere: tree, raw files, and the new commit resolution. `author.origin === "user"` → `resolveCommitSha(owner, repo, ref ?? "HEAD")`, then tree **by commit SHA**, then raw **by commit SHA** (§8.4). `origin === "builtin"` (ECC) → unchanged path: tree by ref, raw by ref, 1 API call. Repo-relative folders = `toRepoRelativeFolders(author.rootPath, …)`. Before building any raw URL, tree entries failing `isSafeRepoRelPath` are skipped. Raw URLs are built with `githubRawFileUrl` (per-segment encoding). Per-file cap is 2 MB **bytes**, enforced by streaming. Tree JSON cap is 16 MB. `\r\n` → `\n` normalisation happens before `parseTemplateMarkdown`. A per-file 429 maps to the reason "GitHub is rate-limiting file downloads (HTTP 429)." The outcome gains `commitSha?`, `truncated?` and `refLabel?`. Items get `authorOrigin: author.origin`. `MAX_CANDIDATES` (150), the timeouts and the concurrency (8) are unchanged. |
| `src/templates/inspectSource.ts` | NEW | `inspectGithubSourceUrl(url, deps: {fetchImpl, tokens, existing})`: parse, resolve the ref, resolve the commit, fetch the tree, detect folders, mint a token (§8.4). Returns `InspectTemplateSourceUrlOutcome`. Throws `RpcError("invalid-url")` only for validation failures. |
| `src/templates/inspectTokens.ts` | NEW | `class InspectTokenStore` (same shape as `run/nonces.ts`: injectable `ttlMs` / `now`). `mint(binding) → 32-hex` (`randomBytes(16)`), `peek(token)`, `consume(token)`. TTL **10 min**, at most **32** live entries (the oldest is evicted). Memory only, so a daemon restart invalidates every token. A module singleton `inspectTokens`. |
| `src/templates/userSources.ts` | NEW | The config IO and resolver. `listUserSources(): {sources; invalidCount}`. `addUserSource(record): UserTemplateSource`. `removeUserSource(id): boolean`. **`resolveGithubSourceById(id): GithubAuthorSource`**, the SSRF-critical resolver: if `id` is in `AUTHOR_REGISTRY` with `kind:"github"` → that entry. Else if `USER_SOURCE_ID_RE.test(id)` → `loadGlobalConfig()`, find the raw entry by id, re-run `validateUserTemplateSource` on it (defence against hand-edited config), then `userSourceToAuthorSource`. Anything else → `RpcError("invalid-author")`. Every function here is **synchronous** between `loadGlobalConfig()` and `saveGlobalConfig()`, so there is no interleaving inside the single-threaded daemon. |
| `src/rpc/handlers.ts` | MODIFY | Adds `inspectTemplateSourceUrl`, `addTemplateSource`, `listTemplateSources`, `removeTemplateSource`. `fetchAuthorTemplates` now does `resolveGithubSourceById(params.authorId)` and reads **only** `params.authorId`. `applyTemplate` is **unchanged**: a user id is not in `AUTHOR_REGISTRY`, so `isThirdParty` is already true and acknowledgement is required (pinned by test D-A1). |
| `src/store/store.ts` | NO CHANGE | No bump, so no change. Explicit decision, see §8.3. |
| `packages/rpc-types/src/index.ts` + `apps/daemon/src/rpc/contract.ts` | MODIFY | Types in §8.2, 4 new `RpcMethod` literals, re-exports. Fix the stale doc comment that says `fetchAuthorTemplates` is "added to READ_ONLY_METHODS". That set no longer exists after tokenless-daemon. |

#### `apps/web`

| File | Status | Contents |
|---|---|---|
| `src/lib/store/useArtifactStore.ts` | MODIFY | 4 thin `callRpc` wrappers. No caching. Same style as `fetchAuthorTemplates`. |
| `src/lib/templates/sourceOrigin.ts` | NEW | `isUnverifiedItem(item)` = `item.authorOrigin === "user" \|\| USER_SOURCE_ID_RE.test(item.authorId)` (fail-safe if the origin is missing). |
| `src/components/TemplatesView.tsx` | MODIFY | Tabs = `AUTHOR_REGISTRY` (rendered immediately, no daemon needed, same as today) + user sources from `listTemplateSources`. The list is fetched on mount and whenever `daemonConnected` goes false → true. Adds an "Add source" button (right of the tabs, disabled when `!daemonConnected`). For a selected user source, `TemplateSourceHeader` is shown. `GITHUB_AUTHORS` becomes "built-in github ∪ user". If `selectedAuthorId` disappears from the list → select `"symbion"`. On remove, the cache entry is deleted. Late fetch results for unknown ids are dropped. Adds an empty state for user sources with `items.length === 0 && skipped.length === 0`. |
| `src/components/AuthorTabs.tsx` | MODIFY | Tab item gets `unverified?: boolean`. The label becomes `{label} <Badge variant="warning">Unverified</Badge>`. No buttons inside a tab: a nested interactive element inside `role=tab` is invalid. |
| `src/components/AddTemplateSourceDialog.tsx` | NEW | The multi-step dialog (§8.7). |
| `src/components/TemplateSourceMappingForm.tsx` | NEW | 3 selects (Agents / Commands / Skills): options "— none —", "(this folder)" (`"."`), plus `topLevelDirs`, each shown with a count hint. Pre-filled from `detected`. |
| `src/components/TemplateSourceHeader.tsx` | NEW | Shows the repo link, ref label, "viewing commit `abc1234`" (from the fetch outcome, linking to `github.com/<o>/<r>/commit/<sha>` once it passes `COMMIT_SHA_RE`), the root path, the Unverified badge, and a Remove button with a confirm dialog. |
| `src/components/ToolRiskPanel.tsx` | NEW | Renders a `TemplateToolAssessment` (§8.6). Plain text only. |
| `src/components/TemplateCard.tsx` | MODIFY | Shows an Unverified badge when `isUnverifiedItem(item)`. |
| `src/components/TemplatePreviewModal.tsx` | MODIFY | For unverified items: an Unverified badge in the header plus `<ToolRiskPanel>` above the markdown viewer in the **preview** step, and the licence-step copy variant "This source is unverified — Symbion has not reviewed it." Built-in ECC/Symbion are pixel-identical to today. |
| `src/components/AuthorFetchErrorPanel.tsx` | MODIFY (copy only) | Distinct `not-found` heading ("Repository, branch or folder not found"). This is the accepted debt from templates-authors, and it is now user-facing for typo'd links. |

All new UI uses the design-system tokens and primitives (`ui/badge`, `ui/button`, `ui/dialog`, `ui/input`, `ui/tabs`). `apps/web/src/designSystemGuard.test.ts` must stay green.

### 8.2 Daemon RPC surface

All four new methods are POST `/rpc` with the existing Origin/Host allowlist. They are thrown-error methods (400 `{code,message}`) for **client/validation** errors, and return well-formed `outcome` unions for **GitHub/network** failures. This is the same split `fetchAuthorTemplates` already uses.

#### 8.2.1 Types (`packages/rpc-types`)

```ts
type TemplateBucket = "agent" | "command" | "skill";
interface SourceFolder { bucket: TemplateBucket; path: string }   // root-relative; "." = the root itself

interface UserTemplateSourceSummary {
  id: string;              // "u-" + 10 hex
  displayName: string;
  owner: string; repo: string;
  ref: string | null;      // null = follow the repo's default branch (HEAD)
  refLabel: string;        // ref ?? "default branch"
  rootPath: string;        // "" = repo root
  folders: SourceFolder[];
  addedAt: string;         // ISO
}

// inspectTemplateSourceUrl
interface InspectTemplateSourceUrlParams { url: string }
type InspectTemplateSourceUrlOutcome =
  | { status: "success";
      inspectToken: string;                 // opaque, 10-min TTL, daemon-memory only
      owner: string; repo: string; ref: string | null; refLabel: string; rootPath: string;
      commitSha: string;                    // 40-hex COMMIT sha (not tree sha)
      truncated: boolean;
      detected: Array<SourceFolder & { count: number }>;   // [] = nothing standard found
      rootDirs: Array<{ path: string; mdFiles: number; skillFiles: number }>; // "." first, then top-level dirs, max 200
      suggestedDisplayName: string;
      duplicateOf?: { id: string; displayName: string } }  // already saved, or a built-in (e.g. "ecc")
  | { status: "error"; kind: "network" | "rate-limit" | "not-found"; message: string; resetAt?: number };
interface InspectTemplateSourceUrlResult { outcome: InspectTemplateSourceUrlOutcome }

// addTemplateSource
interface AddTemplateSourceParams { inspectToken: string; displayName?: string; folders: SourceFolder[] }
interface AddTemplateSourceResult { source: UserTemplateSourceSummary }

// listTemplateSources
interface ListTemplateSourcesParams {}
interface ListTemplateSourcesResult { sources: UserTemplateSourceSummary[]; invalidCount: number; maxSources: number }

// removeTemplateSource
interface RemoveTemplateSourceParams { id: string }
interface RemoveTemplateSourceResult { removed: boolean }

// fetchAuthorTemplates: params UNCHANGED ({ authorId }); the success outcome gains optional fields:
//   { status:"success"; items; skipped; commitSha?: string; refLabel?: string; truncated?: boolean }
```

#### 8.2.2 Error codes (thrown `RpcError`, HTTP 400)

| Method | code | When |
|---|---|---|
| inspectTemplateSourceUrl | `invalid-url` | Any §8.2.4 rule fails. The message is specific: "Only https://github.com links are supported", "Use https:// (http is not allowed)", "Paste a repository or folder link (…/tree/<branch>/<folder>) — file (blob) links are not supported", "'..' is not allowed in the branch or folder", "Owner name is not a valid GitHub user/org name", etc. |
| addTemplateSource | `inspect-expired` | The token is unknown, expired, or already consumed. The UI re-runs inspect. |
| | `no-folders` | After dropping "none" entries, `folders` is empty. |
| | `invalid-folders` | A path is not in the token's `rootDirs` paths and not in the token's `detected` paths. Or a bucket is unknown or duplicated (max 1 per bucket). Or a path fails `isSafeRepoRelPath` / isn't `"."`. |
| | `invalid-display-name` | Not 1–60 chars after trim, or contains control chars. |
| | `duplicate-source` | `findDuplicateSource` hits. The message includes the existing display name. The existing id is shown in the message text only; the UI uses inspect's `duplicateOf` instead. |
| | `source-limit` | The raw `templateSources` array length is ≥ 20. |
| | `invalid-config` | `config.templateSources` exists but is not an array. Refuse rather than clobber the user's file. |
| listTemplateSources | — | Never throws for content. Invalid stored entries are only counted. |
| removeTemplateSource | `invalid-source` | `id` doesn't match `USER_SOURCE_ID_RE`. This includes `"symbion"` and `"ecc"`: built-ins cannot be removed. An unknown but well-formed id → `{removed:false}` (idempotent). |
| fetchAuthorTemplates | `invalid-author` | Unchanged code. Now also covers a well-formed `u-…` id that isn't in config ("Source not found — it may have been removed") and a stored entry that fails re-validation ("Saved source is invalid — remove and add it again"). |

#### 8.2.3 SSRF rules (the trust boundary — `/cso` checklist)

1. **Fetch-by-id never reads client owner/repo/ref/path.** `fetchAuthorTemplates` reads only `params.authorId`. The source comes from `AUTHOR_REGISTRY` or the stored config, and is re-validated.
2. **Inspect is the only path where user-entered components reach the network**, and only after `parseGithubSourceUrl` succeeds. That function returns only regex-validated owner/repo and decoded, validated segments. Everything later in the pipeline uses these values, never `params.url`.
3. **The daemon builds URLs only through the core builders**, and those hard-code `https://api.github.com` / `https://raw.githubusercontent.com`. `githubGet` re-asserts the host on every request **and every redirect hop**.
4. **The root path never appears in any URL.** It is only a prefix filter over tree entries. Raw-file paths come from the GitHub tree response, pass `isSafeRepoRelPath`, and are encoded per segment.
5. **Redirects**: Node's `fetch` (undici) defaults to `redirect: "follow"` and **will follow to any host**. We use `redirect: "manual"`. In Node this gives the real 3xx response with a readable `Location` (there is no browser opaque-redirect filtering). We follow only https hops to the two allowed hosts, at most 3. We do **not** use `redirect: "error"`: GitHub legitimately 301s renamed repos to `api.github.com/repositories/<id>/…` (verified), and ECC itself is a renamed repo.
6. **Add uses the token, not the URL**: `addTemplateSource` never takes owner/repo/ref. They come from the daemon-held token binding. Folders must be a subset of what the daemon itself observed for that token.
7. **Caps**: 150 files per load, 2 MB/file (streamed bytes), 16 MB tree JSON, 64 B for the commit-sha body, 1 MB for a matching-refs body, 10 s/8 s timeouts, 20 sources, 32 live tokens, URL input ≤ 2048 chars.
8. Fetched content is never written to disk. `grep -n "writeFile" apps/daemon/src/templates/` must return 0 (the existing AC7 check, extended to the new files). `userSources.ts` writes only through `saveGlobalConfig` → `atomicWriteJson`.

#### 8.2.4 URL grammar and validation (`parseGithubSourceUrl`, pure)

Order of checks on `input`:
1. `trim()`. Length 1–2048. Reject any whitespace or control char `[\x00-\x20\x7f]` remaining inside, and any `\`.
2. Scheme: `http://` (case-insensitive) → reject "use https". `https://` → strip it. A bare `github.com/…` or `www.github.com/…` → accepted as https (**the only scheme normalisation**). Anything else (`git@`, `ssh://`, `ftp:`) → reject.
3. Cut at the first `#` and then the first `?`, and discard both (safe: `?tab=readme-ov-file` is common in copied links).
4. Authority = text up to the first `/`. It must equal `github.com` or `www.github.com` case-insensitively. Any `@`, `:` or other host → reject. This blocks `github.com.evil.com`, `github.com@evil.com`, `evil.com/github.com`, `api.github.com`, `gist.github.com` and `raw.githubusercontent.com`.
5. Split the path on `/`. Drop **trailing** empty segments only. An empty segment elsewhere (`//`) → reject.
6. `owner = seg[0]` must match `GITHUB_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/` (lenient on legacy hyphen rules, strict on charset and length).
   `repo = seg[1]`. If there are exactly 2 segments and `repo` ends with `.git`, strip that once. It must match `GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/` and must not be `.` or `..`.
7. Exactly 2 segments → `{owner, repo, ref: null, refSegments: []}` (default branch).
8. `seg[2] === "tree"` and ≥ 4 segments → `refSegments = seg.slice(3)`, each `decodeURIComponent`'d. A throw → reject. Each decoded segment must pass `isSafePathSegment`: non-empty; not `.` or `..`; no `/` (so an encoded `%2F` is rejected), no `\`, no `[\x00-\x1f\x7f]`; ≤ 255 chars. At most 32 segments and ≤ 1024 total chars. Note: `%2e%2e` decodes to `..` and is rejected here. This matters because WHATWG URL would fold it.
9. Any other `seg[2]` (`blob`, `issues`, `pulls`, `commit`, `releases`, …) or `tree` with no ref → reject with a targeted message.
10. Ref-specific rule, applied to the resolved ref (§8.4.2) and also to a single-segment ref: each segment matches `REF_SEGMENT_RE = /^[A-Za-z0-9_+@=,!-][A-Za-z0-9._+@=,!-]{0,254}$/`; not ending in `.lock`; no `..` substring; total ≤ 255. Refs with other characters (unicode, `#`, spaces) are **rejected with a clear message**. This trade-off is accepted in favour of a tight allowlist. Path (root) segments accept any `isSafePathSegment` text, because they never reach a URL.

### 8.3 Local-store schema (user-level global config)

```ts
// packages/core/src/templates/userSource.ts
interface UserTemplateSource {
  id: string;                 // "u-" + randomBytes(5).hex  (daemon-minted; regex /^u-[0-9a-f]{10}$/)
  displayName: string;        // 1..60, no control chars; default defaultSourceDisplayName(...)
  owner: string; repo: string;          // as typed in the URL (case preserved), validated by the regexes in §8.2.4
  ref: string | null;                   // null => follow default branch (fetched via "HEAD")
  rootPath: string;                     // "" or validated "a/b"
  folders: Array<{ bucket: TemplateBucket; path: string }>;  // root-relative, "." allowed; 1..3, max 1 per bucket
  addedAt: string;                      // ISO
}
```
- Stored as `config.json` → `"templateSources": UserTemplateSource[]`. `filePattern` is **not stored**: it is derived from the bucket by `folderPatternForBucket`, so a hand-edited file can't introduce a third pattern.
- **No `schemaVersion` bump** (this corrects STATE §3; see F6). The field is additive and optional:
  - Old config files without the field load untouched (`templateSources` is absent, treated as `[]`). Nothing is written until the first add.
  - The **forward/backward compatibility** is the point. An older Symbion daemon (npm-published, possibly run side-by-side via `npx`) loading a newer `config.json` sees `schemaVersion: 1` and keeps working. Every existing config writer (`createOrAdoptProject`, `removeProject`, boot-time port update in `index.ts`, …) does load-object → mutate → save the whole object, so the unknown field round-trips. A bump to 2 would make every older version throw `UnsupportedSchemaVersionError` **at boot** (`loadGlobalConfig` in `index.ts`), which locks the user out of the whole app.
  - A naive bump would also be wrong mechanically: `CURRENT_SCHEMA_VERSION` in `store.ts` is **shared** by the project store and the global config, so bumping it would "migrate" every project's `.symbion/store.json` too.
  - *If the orchestrator overrides this and insists on a bump:* split into `CURRENT_PROJECT_SCHEMA_VERSION = 1` and `CURRENT_GLOBAL_SCHEMA_VERSION = 2`. Add `migrateGlobalConfigV1toV2(raw) = {...raw, schemaVersion: 2, templateSources: Array.isArray(raw.templateSources) ? raw.templateSources : []}` after the existing `backupBeforeMigrate`. Change `GlobalConfig.schemaVersion` to `2`, update `DEFAULT_GLOBAL_CONFIG`, and accept the downgrade lock-out explicitly in STATE.
- **The "migration" is read-time normalisation in `parseStoredTemplateSources(raw)`**: non-array → `{valid: [], invalidCount: 0}`, and `addTemplateSource` refuses with `invalid-config` instead of overwriting. For an array, each entry goes through `validateUserTemplateSource`, which yields valid entries plus an `invalidCount`. Invalid entries are **kept byte-for-byte in the file**: add pushes onto the raw array, remove filters the raw array by `entry?.id === id`. A hand-corrupted entry is never silently deleted, and it is never used to build a URL.
- **Cap**: 20, counted on the raw array length, including invalid entries.
- **ID**: `"u-" + randomBytes(5).toString("hex")`. Re-mint on the astronomically unlikely collision. The prefix guarantees no clash with built-in ids (`symbion`, `ecc`). Template item ids stay `${sourceId}:${repoRelPath}` and are opaque to the daemon.
- **Duplicate key**: `${owner.toLowerCase()}/${repo.toLowerCase()}@${ref ?? "HEAD"}#${rootPath}`. GitHub owner/repo are case-insensitive; ref and path are case-sensitive. Built-in check: if owner/repo equal a built-in github source's, `rootPath === ""` and `ref ∈ {null, builtin.ref}`, then it is a duplicate of that built-in (`duplicateOf: {id:"ecc", displayName:"ECC"}`). Accepted, documented limitations: `…/repo` (follows HEAD) vs `…/repo/tree/main` are distinct sources even when main is the default branch, and a renamed repo under its old name is not detected as a duplicate.

### 8.4 Ref resolution, commit SHA and rate-limit cost

#### 8.4.1 Default branch and commit SHA
- **Tree response `sha` is the TREE object's SHA, not a commit SHA.** It can't be found on GitHub's commit page and must not be shown as "commit". STATE §2 ("taken from the tree response") is wrong (F1).
- The commit SHA comes from `GET /repos/{o}/{r}/commits/{ref}` with `Accept: application/vnd.github.sha`. The body is exactly 40 hex chars (verified). Validate with `COMMIT_SHA_RE`; anything else → network "Invalid response from GitHub."
- **Default branch**: a source added from `github.com/o/r` stores `ref: null`. **Every load** resolves `commits/HEAD`, which GitHub resolves to the default branch (verified). This follows a default-branch rename (master → main) instead of freezing a name at add time. No `GET /repos/{o}/{r}` call is needed. The trade-off is that the UI says "default branch" instead of the branch name.
- **Snapshot consistency (user sources)**: after resolving the commit SHA, the tree is fetched as `git/trees/{commitSha}?recursive=1` and every file as `raw.githubusercontent.com/{o}/{r}/{commitSha}/{path}`. This gives (a) a single consistent snapshot when the branch moves mid-load, (b) no raw-CDN branch-cache staleness, and (c) no slashy ref in tree/raw URLs. ECC keeps its by-ref path, so it stays byte-identical in calls and quota (AC10).

#### 8.4.2 `tree/<ref>/<path>` when the ref contains `/`
Let `S = refSegments` (decoded and validated).
1. `|S| === 1` → ref = `S[0]`, root = `""`. No extra call.
2. `S[0]` matches `COMMIT_SHA_RE` → ref = `S[0]`, root = `S[1..]`. (Pasting a SHA URL is allowed. It is just a ref, not a "pin" feature.)
3. Otherwise call `git/matching-refs/heads/{enc(S[0])}`, and only if no segment-prefix match is found, also `git/matching-refs/tags/{enc(S[0])}` (≤ 1 MB, ≤ 2000 entries, else bail). Pass the names (minus `refs/heads/` / `refs/tags/`) to the pure `resolveRefFromCandidates(S, names)`. It keeps the names whose `/`-split segments are an exact **segment** prefix of `S` (string-prefix hits like `maint/…` for `ma` are discarded), picks the **longest**, and breaks ties as branch over tag. git forbids two branches where one is a path-prefix of the other (D/F conflict), so ambiguity only arises between a branch and a tag. No match → not-found "Branch or tag not found in <o>/<r>". Then root = the remaining segments.
4. If the match came from heads with `object.type === "commit"`, use `object.sha` as the commit SHA directly. Otherwise (tags, possibly annotated) call `commits/{ref}`.

#### 8.4.3 Rate-limit cost (unauthenticated `core` quota = 60/h per IP)

| Action | api.github.com calls | raw calls |
|---|---|---|
| inspect `github.com/o/r` | 2 (`commits/HEAD`, `trees/{sha}`) | 0 |
| inspect `…/tree/<one-segment-ref>[/…]` or a SHA | 2 | 0 |
| inspect `…/tree/<a>/<b>/…` (slashy or with path) | 2 (branch hit) – 4 (tag hit: heads + tags + commits + tree) | 0 |
| addTemplateSource / list / remove | **0** (the token carries everything) | 0 |
| fetchAuthorTemplates (user source), per first view or retry | **2** (`commits/{ref}`, `trees/{sha}`) | ≤ 150 |
| fetchAuthorTemplates (ECC) | 1 (unchanged) | ≤ 150 |

So "1 tree call per load" (STATE §2) is **inaccurate** for user sources: it is 2 (F1). The raw host is outside the `core` quota but **does** have its own unauthenticated limits and returns 429 (F2). Per-file 429s get a dedicated skipped reason, and if ≥ 10 files hit 429 the tab shows an extra line: "GitHub is rate-limiting downloads; retry later."

### 8.5 Folder detection (pure, `detectTemplateFolders`)
- `rootPath === ""` → entries are used as-is. Otherwise `rootExists` = a `type:"tree"` entry with `path === rootPath`, and entries under `rootPath + "/"` are re-based. If the root is missing → not-found "Folder '<root>' not found at <refLabel>". If `truncated` is also true, the message instead says "Repository is too large to list completely; the folder may exist but could not be listed".
- For each bucket, using the names `agents` / `commands` / `skills` and `folderPatternForBucket`: count candidates with `matchAuthorFolders` (on re-based entries) at `<name>`. If the count is 0, try `.claude/<name>`. The first with count > 0 is the detected folder for that bucket. **Root-level wins over `.claude/`**, never both, to avoid duplicate cards.
- `rootDirs`: `"."` first (counts of `*.md` directly in the root and `*/SKILL.md` one level down), then every direct child `type:"tree"` of the root except `.git`, sorted, max 200, each with `mdFiles` / `skillFiles` counts. Counts let the user see where the files are.
- Inspect returns success even when `detected` is `[]`. The UI then shows the mapping form empty and requires ≥ 1 mapping (`no-folders` otherwise). This corrects STATE §2 in two ways (F13). The mapping form is **always editable** (pre-filled from detection), not only shown when nothing is found. And `"."` ("this folder") is offered, so the very common paste `…/tree/main/agents` can be mapped `"."` → Agents.
- `toRepoRelativeFolders(root, folders)`: `"."` → `root`; otherwise `root ? root + "/" + path : path`. `matchAuthorFolders` handles `""` (repo root).

### 8.6 Trust UX: origin flow and tools risk

**Origin flow.** The daemon sets `origin` on the resolved source and stamps `authorOrigin` on every `TemplateListItem` it returns. The web never asserts the origin. Then:
- Tab: every entry from `listTemplateSources` is user-origin → `AuthorTabs` `unverified: true` → "Unverified" warning badge.
- Card: `isUnverifiedItem(item)` → badge.
- Preview modal: badge plus `ToolRiskPanel`. The licence step shows the unverified copy variant.
- `applyTemplate` server gate: a `u-…` authorId isn't in `AUTHOR_REGISTRY`, so it is third-party and the existing "conservative default" requires acknowledgement. No change; covered by test D-A1.

**`assessTemplateTools({kind, tools, raw})` (pure) returns:**
```ts
interface TemplateToolAssessment {
  appliedTools: Array<{ name: string; base: string; level: "high" | "normal"; reason?: string }>; // agent only: what Apply will set
  allToolsImplicit: boolean;          // agent with tools undefined/empty
  declaredAllowedTools: string[];     // command/skill frontmatter `allowed-tools` (informational — NOT applied)
  inlineShell: boolean;               // command/skill body contains /!`[^`\n]+`/
  hasHighRisk: boolean;               // any high appliedTool || allToolsImplicit || inlineShell
}
```
- `base` = the name before `(`, so `Bash(git:*)` → `Bash`. Matching is case-insensitive.
- High-risk set: `Bash`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `WebFetch`, `WebSearch`, any `mcp__*`, and `*`. Each has a one-line reason: "runs shell commands", "creates/overwrites files", "network access", "external MCP server tool", "all tools".
- **"No tools field = all tools" applies to agents only** (F4). For a Claude Code subagent, omitting `tools` inherits all tools. Commands and skills use `allowed-tools`, where absent means "no pre-approval; normal permission prompts apply", not "all tools". In addition, Symbion's `applyTemplate` **drops every custom frontmatter key**: only `name`, `description`, `tools` and `body` are sent and stored. So a source command's `allowed-tools`, `model`, `permissionMode`, `hooks` or `mcpServers` is **never applied**. The panel says exactly that. This property is pinned by test D-A2 so a future change can't silently start carrying `permissionMode: bypassPermissions` across.
- `declaredAllowedTools` is read with `parseFrontmatter` (try/catch → `[]`) from `customFields` key `allowed-tools` (CSV or the `String()` of an array).
- Panel copy is always shown for unverified items: "Unverified source — this text becomes instructions an AI agent will follow. Read the full content before applying." The body is the real risk (prompt injection, instructions to run commands); tools are only one signal.
- Everything is rendered as **plain text**, with tool names in `<code>` text nodes. No `dangerouslySetInnerHTML`. The body continues to render only in the read-only CodeMirror `TemplateMarkdownViewer`.

### 8.7 UI specifics (no design doc, so this is binding for the builder)
- **Add source** button (`variant="outline"`, label "+ Add source") sits on the tab row, right-aligned. It is disabled with the tooltip "Daemon offline" when `!daemonConnected`, and disabled with the tooltip "Limit of 20 sources reached" when `sources.length >= maxSources`.
- **AddTemplateSourceDialog** steps:
  1. `url`: an Input (placeholder `https://github.com/owner/repo or …/tree/branch/folder`), a helper line "Public GitHub repositories only", and a **Check** button.
  2. `inspecting`: spinner, "Reading <owner>/<repo>…".
  3. `review`: a summary (`owner/repo`, refLabel, root or "(repository root)", "commit abc1234", and a warning line if truncated). Then the **Display name** Input (pre-filled with `suggestedDisplayName`), the `TemplateSourceMappingForm` (pre-filled), and the note "This source will be marked Unverified." Buttons: Back / **Add source** (disabled when no bucket is mapped).
  4. If `duplicateOf` is set, the review step replaces the form with "Already added as '<name>'" and an **Open tab** button.
  - Errors: `invalid-url` shows inline under the input. Outcome errors show inline in the dialog with the AuthorFetchErrorPanel copy plus Retry. `inspect-expired` re-runs inspect automatically once, then shows an error. `duplicate-source` and `source-limit` show inline.
  - On success: close, re-run `listTemplateSources`, select the new tab, and trigger `fetchAuthorTemplates` (the same `runFetch`).
- **TemplateSourceHeader** (only for a selected user source), one row: `owner/repo ↗` · `refLabel` · `/rootPath` · "viewing commit `abc1234`" · Unverified badge · **Remove** button. Remove opens a confirm dialog: "Remove '<name>'? Only the tab is removed — templates already applied to your projects are not changed." The button is disabled when the daemon is offline.
- After a successful remove: the tab disappears, the selection falls back to `symbion`, the cache entry is deleted, and a toast says "Removed '<name>'".
- Error after add (removed elsewhere or invalid): the error panel's Retry re-lists sources first.

### 8.8 Data flow

```
INSPECT   web AddTemplateSourceDialog --inspectTemplateSourceUrl{url}--> daemon
          core.parseGithubSourceUrl(url)                 (throws invalid-url; NO network on failure)
          [matching-refs heads/tags]? -> commits/{ref|HEAD} (sha) -> trees/{sha}?recursive=1   (githubGet, host-asserted, manual redirects)
          core.detectTemplateFolders(tree, root) ; core.findDuplicateSource(...)
          inspectTokens.mint({owner,repo,ref,rootPath,commitSha,rootDirs,detected})   (memory only)
          <-- outcome{success, token, detected, rootDirs, commitSha, duplicateOf?}     DISK: none
ADD       web --addTemplateSource{inspectToken, displayName?, folders}--> daemon
          tokens.peek -> validate folders ⊆ token paths, displayName, cap, dup (fresh loadGlobalConfig)
          push UserTemplateSource -> saveGlobalConfig (atomicWriteJson temp->rename)    DISK: config.json ONLY
          tokens.consume -> <-- {source}     (sync section: no await between load and save)
LIST      web (mount / reconnect) --listTemplateSources--> loadGlobalConfig -> parseStoredTemplateSources --> {sources, invalidCount}   DISK: read
FETCH     web tab select --fetchAuthorTemplates{authorId}--> resolveGithubSourceById(authorId)  (registry | config by id, re-validated; params.* ignored)
          user: commits/{ref|HEAD} -> trees/{sha} -> matchAuthorFolders(toRepoRelativeFolders) -> raw/{sha}/{enc(path)} x<=150 (8 conc., 2MB streamed)
          -> parseTemplateMarkdown -> items(authorOrigin) + skipped + commitSha/truncated      DISK: none; web caches per session (authorCache)
REMOVE    web confirm --removeTemplateSource{id}--> loadGlobalConfig -> filter raw array -> saveGlobalConfig    DISK: config.json ONLY
APPLY     unchanged: preview(ToolRiskPanel) -> licence ack -> project picker -> applyTemplate (writes .symbion/store.json draft)
          -> later Publish: render -> computeDiff -> confirm -> write (backup, confinement, marker) — the ONLY path to .claude/
```

### 8.9 Edge cases → behaviour

| Case | Behaviour |
|---|---|
| Malformed / non-GitHub / `http:` / `blob` / `gist` / `api.github.com` / userinfo / port | `invalid-url` with a specific message, **from the daemon**. The web may pre-validate with the same core parser for instant feedback, but the daemon is authoritative. |
| Trailing `/`, `.git`, `?query`, `#frag`, missing scheme | Normalised (only these). |
| `..`, `%2e%2e`, `%2F`, backslash, control chars in ref/path | `invalid-url`. |
| Repo 404 / private | Outcome `not-found`: "Repository <o>/<r> not found, or it is private (only public repos are supported)." |
| Ref missing (422) / slashy ref unresolved | Outcome `not-found`: "Branch or tag '<ref>' not found." |
| Root path missing | Outcome `not-found` (truncation-aware text, §8.5). |
| Rate limit (403 remaining 0 / 429 / secondary) | Outcome `rate-limit` + `resetAt`. Add is not possible until inspect succeeds (decision F20). A saved source shows the error panel with Retry. |
| Network down / timeout / bad JSON / unexpected redirect host | Outcome `network`. Never crashes, never throws 500. |
| Save an unreachable source? | **No.** Add requires a successful inspect token, because detection and mapping need the tree. |
| No standard folders and user maps nothing | `no-folders` (the button is also disabled). |
| Mapped folder, every file fails to parse | Existing `AuthorSkippedSummary` plus "Loaded, but no valid templates…" (already exists for GitHub authors). |
| Mapped folder now matches 0 files (branch moved / folder deleted) | New empty state: "No files matched this source's folders at commit abc1234." with Retry and a hint to remove and re-add. |
| Tree truncated | Proceed. A warning line on the tab and in the inspect review step. |
| > 150 candidates | Existing cap: extras listed as skipped "Exceeded the maximum number of files." |
| File > 2 MB (no or lying content-length) | Streamed abort, skipped "File too large". |
| CRLF files | Normalised to LF before parse. |
| Tree path with `..`, `\`, or control chars (malicious tree) | Skipped before URL build, reason "Unsafe path". |
| Duplicate of a saved or built-in source | Inspect returns `duplicateOf` (Open tab). Add → `duplicate-source`. |
| 21st source | `source-limit` (button disabled too). |
| Source removed while its tab is open / fetch in flight | Select `symbion`. A late result for an unknown id is discarded. |
| Removed in another browser tab, then fetched | `invalid-author` "Source not found" → the panel re-lists. |
| Hand-edited config: bad entry | Not listed (`invalidCount` shown as a caption: "1 saved source could not be read"). Kept in the file. Its id → `invalid-author` on fetch. |
| Hand-edited config: `templateSources` not an array | List → empty. Add → `invalid-config` (no clobber). |
| Daemon disconnected while adding/removing | Buttons disabled. If the RPC fails mid-flight, the UI re-lists on reconnect, which reveals whether the add or remove landed. Add is not retried automatically (the token is single-use, so a blind retry → `inspect-expired`). |
| Daemon restarted between inspect and add | `inspect-expired` → auto re-inspect once. |
| Branch moves between loads | New commitSha shown. Nothing else changes. |
| Template name collides in a project | The existing `applyTemplate` auto-suffix. |
| Template name not filename-safe (e.g. `a11y.instructions` from `a11y.instructions.md`) | The existing `validation-failed` error on apply, shown in the modal. Not changed in v1 (noted as a follow-up). |
| Skill from a user source | Preview, copy and risk panel work. Apply stays disabled (existing). |
| Old config without `templateSources` | Loads unchanged, file untouched until the first add. |
| ECC tab | Same calls (1 API), same items. Hardening (manual redirects, per-segment encoding, byte caps, 422/429 mapping, CRLF) is functionally invisible on the success path. |

### 8.10 Flaws found in STATE §1–§7 (corrections; Checker should hold the build to these)

- **F1 — Commit SHA source is wrong, and "1 tree call per load" is inaccurate.** The tree response `sha` is a tree SHA. A real commit SHA needs `commits/{ref}` (sha media type), which is +1 API call: user-source loads cost 2 and inspect costs 2–4 (§8.4.3).
- **F2 — "raw.githubusercontent.com does not count against the API quota"** is true only for the `core` API quota. Raw has its own unauthenticated limits and returns 429, and a load can make 150 raw requests. 429 must be mapped and surfaced.
- **F3 — Mixed snapshots.** Fetching the tree and the raw files by a moving branch name can mix two commits, and raw caches branch paths. Fixed: user sources fetch tree and raw by the resolved commit SHA.
- **F4 — "absent `tools` = all tools" holds for agents only.** Commands and skills use `allowed-tools`, with different semantics. More importantly, `applyTemplate` drops all custom frontmatter, so what gets applied is `tools` (agents) plus the body. The risk display must describe *what Symbion will apply*, and must say the body itself is the main risk.
- **F5 — "Apply goes through preview → diff → confirm → write" and AC6 "nothing is written before confirm" are imprecise.** "Confirm apply" writes the target project's `.symbion/store.json` (a draft artifact) immediately. The diff → confirm → write pipeline is the later **Publish**, which is the only path to `.claude/` or `AGENTS.md`. AC6 should read: "nothing is written to `.claude/` or `AGENTS.md` until Publish confirm; Apply only stages a draft in `.symbion/store.json`."
- **F6 — The schema bump is harmful as specified.** `CURRENT_SCHEMA_VERSION` is shared by the project store and the global config. A global v2 also makes every older Symbion refuse to boot (`UnsupportedSchemaVersionError` from `loadGlobalConfig`). Decision: an additive optional field, no bump (§8.3). AC10's "old config files migrate" is satisfied as "load without loss".
- **F7 — Slashy refs (`feature/x`) were unaddressed.** Resolved via `matching-refs` and a pure longest-segment-prefix match (§8.4.2).
- **F8 — "default branch, read from the repo root"** would freeze the branch name. A `null` ref is stored and `HEAD` is resolved each load.
- **F9 — "No redirects to other hosts" is not the Node default.** `fetch` follows redirects to any host. And `redirect:"error"` would break renamed repos: GitHub 301s them same-host, and ECC is one (verified). The fix is manual following with a per-hop host allowlist.
- **F10 — Existing size cap is not a streaming byte cap.** `githubFetch.ts` reads `text()` fully and then compares `raw.length` (UTF-16 units, not bytes). templates-authors P8 #2 asked for a streamed abort and it was never built. With arbitrary user repos this matters. The tree JSON is also uncapped.
- **F11 — Existing raw URL concatenates `relPath` unencoded.** Files with `#`, `?` or `%` in their names misfetch. Encode per segment.
- **F12 — "Keep the existing per-session in-memory cache"**: that cache is client-side (`TemplatesView.authorCache`). The daemon has none and doesn't get one.
- **F13 — Detection and fallback are too narrow for real repos.** The common paste `…/tree/main/agents` would find nothing, and top-level-only mapping can't express "this folder". Fixed with a `"."` option and an always-editable mapping.
- **F14 — The "all files skipped" edge case was covered, but "0 files matched" (empty tab) was not.** An explicit empty state was added.
- **F15 — Duplicate detection ignored the built-ins** (pasting `affaan-m/ecc` would create a second ECC tab). Now covered. Default-branch vs explicit-branch duplicates are documented as not detected.
- **F16 — AC7 "owner/repo used for a fetch always come from stored config"** cannot hold for the inspect step, which must reach GitHub before anything is stored. Reword: "fetch-by-id never uses client-sent fields; inspect reaches the network only with daemon-parsed, validated components and only to the two fixed hosts; add never accepts owner/repo (token-bound)."
- **F17 — "Daemon disconnected while adding"** needs a reconciliation rule. Add is not idempotent, so the UI re-lists on reconnect instead of retrying.
- **F18 — "private repo" as a distinct error** is impossible unauthenticated: a private repo returns 404, the same as not-found. The message says "not found or private".
- **F19 — A missing ref returns 422, not 404 (verified).** The existing mapper would show "GitHub returned HTTP error 422". It is mapped to not-found.
- **F20 — STATE left "save anyway vs refuse" open.** Decision: refuse to add without a successful inspect.
- **F21 — Stale doc:** `rpc-types` still says `fetchAuthorTemplates` is in `READ_ONLY_METHODS`, which no longer exists. Fix the comment.
- **F22 — AC10 "ECC behaves exactly as before"** should be read as "same calls, same items, same success UI". The shared hardening (F9–F11, F19, CRLF) intentionally changes ECC failure-path details.
- Pre-existing observation for `/cso`, out of scope: `server.ts` dispatch uses `method in handlers`, so inherited names like `constructor` pass the check. It is harmless today (it echoes params), but a `hasOwnProperty` check would be cleaner. There is also still no request body size limit in `readBody`.

### 8.11 Trade-offs and assumptions (for dev / Checker)
1. Token-bound add (A1): this costs a little daemon memory and loses the token on restart. In return, add makes zero network calls and never re-trusts client owner/repo/ref.
2. User sources resolve the commit (+1 call) while ECC doesn't. This is accepted to keep AC10's quota and behaviour. Moving ECC to commit mode is a possible follow-up.
3. The ref charset allowlist rejects exotic but legal git ref names (unicode, `#`, …). These are rare, and the error is clear.
4. Detection prefers root-level folders over `.claude/`, never both.
5. Mapping allows at most one folder per bucket. Multiple folders per bucket is out of scope.
6. The risk panel is shown for **user** sources only. ECC is unchanged per AC10. Extending it to ECC is a suggested follow-up.
7. `HEAD` resolution for default branches relies on GitHub resolving `commits/HEAD`. This was verified 2026-10-19; QA step Q1 re-verifies it.
8. Tests mock network by injecting `fetchImpl` into `githubFetch`/`inspectSource` and by `vi.spyOn(globalThis, "fetch")` for handler-level tests (the existing `fetchAuthorTemplates.test.ts` pattern). **No env-var fetch override is added to production code**: a "fixture host" switch would be an SSRF backdoor.
9. Pipeline: `/build` → `/review` (code-reviewer + architect) → **`/cso` mandatory** → `/qa` → `/ship`.


---

## 9. BUILD — implementation notes (feature-builder, 2026-10-19)

> Maker output only. Nothing here is a self-review; the Checker (`/review`, `/cso`, `/qa`) verifies. Points the Checker should look at hardest are marked **(verify)**.

### 9.1 Files added / changed

**packages/core (pure)**
- NEW `src/templates/githubUrl.ts` — strict hand-written `parseGithubSourceUrl` (no `URL` global), `isSafePathSegment`, `isSafeRepoRelPath`, `isValidRefName`, `encodePathSegments`, regexes, `GITHUB_FETCH_HOSTS`, URL builders (`githubCommitShaUrl`/`githubTreeUrl`/`githubMatchingRefsUrl`/`githubRawFileUrl`; they throw on invalid owner/repo/ref/path and only emit the 2 hosts), `resolveRefFromCandidates`.
- NEW `src/templates/detectFolders.ts` — `detectTemplateFolders` (single pass rootDirs), `toRepoRelativeFolders`, `ROOT_FOLDER`.
- NEW `src/templates/userSource.ts` — `UserTemplateSource`, `SourceFolder`, id regex, caps, `validateUserTemplateSource` (returns a normalised copy, unknown keys dropped), `validateSourceFolders`, `parseStoredTemplateSources`, `findDuplicateSource`, `defaultSourceDisplayName`, `validateSourceDisplayName`, `userSourceToAuthorSource`, `folderPatternForBucket`.
- NEW `src/templates/toolRisk.ts` — `assessTemplateTools`, `HIGH_RISK_TOOLS`.
- MOD `authorSource.ts` (github variant gets required `origin` + `rootPath`; `GithubAuthorSource` exported from core; ECC entry `origin:"builtin", rootPath:""`; header comment updated), `matchAuthorFolders.ts` (`path === ""` = repo root), `templateListItem.ts` (`authorOrigin?`), `ir/types.ts` (`GlobalConfig.templateSources?: unknown[]`), `index.ts` (4 exports).

**packages/rpc-types** — `src/index.ts`: new types (`UserTemplateSourceSummary`, Inspect/Add/List/Remove params+results, `InspectTemplateSourceUrlOutcome`), `FetchAuthorTemplatesOutcome` success gains `commitSha?/refLabel?/truncated?`, 4 new `RpcMethod` literals, stale `READ_ONLY_METHODS` doc comment fixed (F21). `apps/daemon/src/rpc/contract.ts` and `apps/web/src/lib/rpc/types.ts` re-export them.

**apps/daemon**
- NEW `src/templates/githubHttp.ts` — the only `fetch` caller: host/scheme/userinfo/port assertion on every request and every redirect hop, `redirect:"manual"`, max 3 same-allowlist hops, streamed byte cap, status mapping (404, 422, 403+remaining 0, 429/403+retry-after, other).
- MOD `src/templates/githubFetch.ts` — all traffic via `githubGet`; user sources: `resolveCommitSha` -> tree by commit sha -> raw by commit sha; ECC unchanged (1 API call, by ref). Exports `resolveCommitSha`, `fetchGithubTree`, `REPO_NOT_FOUND`. Unsafe tree paths skipped ("Unsafe path"), per-file 429 reason, CRLF normalisation, 16 MB tree cap, `authorOrigin` stamped, outcome `commitSha/refLabel/truncated`.
- NEW `src/templates/inspectSource.ts`, `inspectTokens.ts` (10 min TTL, 32 live max, memory only), `userSources.ts` (`listUserSources`, `addUserSource`, `removeUserSource`, `resolveGithubSourceById`).
- MOD `src/rpc/handlers.ts` — `inspectTemplateSourceUrl`, `addTemplateSource`, `listTemplateSources`, `removeTemplateSource`; `fetchAuthorTemplates` reads ONLY `params.authorId` via `resolveGithubSourceById`. `applyTemplate` untouched.

**apps/web**
- NEW `src/lib/templates/sourceOrigin.ts`; `components/ToolRiskPanel.tsx`, `TemplateSourceMappingForm.tsx`, `TemplateSourceHeader.tsx`, `AddTemplateSourceDialog.tsx`.
- MOD `useArtifactStore.ts` (4 wrappers), `TemplatesView.tsx`, `AuthorTabs.tsx`, `TemplateCard.tsx`, `TemplatePreviewModal.tsx`, `LicenseAcknowledgmentStep.tsx` (optional `unverified` prop; built-ins render unchanged), `AuthorFetchErrorPanel.tsx` (not-found heading copy only).

**Tests added** — core: `githubUrl.test.ts` (RU1-RU19), `detectFolders.test.ts` (RU20-RU28), `userSource.test.ts` (RU29-RU33, RU41), `toolRisk.test.ts` (RU34-RU40). Daemon: `githubHttp.test.ts` (D-H1..H7), `templateSources.inspect.test.ts` (D-I1..I10), `templateSources.store.test.ts` (D-S1..S12, D-M1..M5), `templateSources.fetch.test.ts` (D-F1..F13, D-A1..A3), helper `githubMock.ts`. Web: `TemplateSources.test.tsx` (W1-W6), `TemplatesView.sources.test.tsx` (W7); W8 = existing guard tests, still green.

### 9.2 Results
- Root `npx vitest run`: **110 files / 998 tests passed** (core 325, daemon 457, web 216). No existing test was modified.
- `npm run build -w @symbion/core -w @symbion/rpc-types -w @symbion/daemon`: OK. `npm run build -w @symbion/web`: OK (types + lint pass in Next build). `tsc -p apps/web` shows only jest-dom matcher typing errors in test files (`toBeInTheDocument`, and the same class: `toBeDisabled/toHaveValue/toHaveAttribute` in my two new test files) — same pre-existing category; `tsbuildinfo` restored.
- Not run: real-GitHub QA (Q1-Q19), chrome-devtools journey — left to `/qa`.

### 9.3 Deviations from the plan (and why)
1. **Add/list/remove handlers are `async`** (plan did not say). Reason: synchronous throws bypass `expect(...).rejects`; there is no `await` inside `addTemplateSource`, so the load->save critical section is still one synchronous tick.
2. **Add-button "tooltip" uses the native `title` attribute**, not the `Tooltip` component (disabled buttons do not fire hover).
3. **Inspect for `tree/<a>/<b>/…` always calls `matching-refs`** (also when `<a>` is a real branch and `<b>` is a folder). §8.4.2 and D-I2's text ("2 calls ... no matching-refs call") contradict each other. I followed §8.4.2/§8.4.3 (a path after the branch makes the segment count > 1, so refs must be resolved): `tree/main/plugins/backend` = matching-refs + tree = 2 calls (the heads object carries the commit sha). Only a single-segment ref (or a leading 40-hex sha) skips matching-refs. My D-I2/D-I2b tests assert exactly this.
4. `FetchAuthorTemplatesOutcome.success` also carries `truncated` for ECC (always a boolean now); `commitSha`/`refLabel` only for user sources.
5. Dialog "inspecting" text is "Reading repository…" (not "Reading <owner>/<repo>…") because the owner/repo are daemon-parsed and the web does not pre-parse the URL (daemon authoritative).
6. `parseGithubSourceUrl` also applies the ref charset rule to `refSegments[0]` always (it is necessarily the start of the ref name), and to the whole ref when single-segment; the resolved multi-segment ref is re-checked with `isValidRefName` in the daemon after `matching-refs` (an invalid resolved name throws `invalid-url`).
7. `defaultSourceDisplayName` = `owner/repo` + `/<rootPath>` + ` @<ref>` (cut to 60 chars) — plan only said "defaults to owner/repo".
8. `detectTemplateFolders` derives top-level directory names from blob paths as well as `type:"tree"` entries (so a tree listing without explicit tree entries still offers folders). A root path still REQUIRES an explicit `type:"tree"` entry to exist.

### 9.4 Deferred / not done
- No real-GitHub run, no chrome-devtools QA (for `/qa`).
- No `Tooltip`-component for disabled Add button (see deviation 2).
- Web does not pre-validate the URL with the core parser (allowed by plan, not required).
- Items from the pre-existing `server.ts` observations (`method in handlers`, no body size limit) left untouched, as the plan marked them out of scope for `/cso`.
- The risk panel is shown for user sources only (plan §8.11 #6).

### 9.5 ASSUMPTIONS for the Checker to verify
1. Node's `fetch` with `redirect:"manual"` returns the real 3xx response with a readable `Location` (plan §8.2.3 #5). Tests mock this; **not** verified against live undici here (verify).
2. `githubGet` clears its abort timer only after the body is fully read (the timeout spans headers + body); the 10 s tree / 8 s per-file budget therefore also bounds slow bodies.
3. `Accept: application/vnd.github.sha` + `X-GitHub-Api-Version` + `User-Agent: symbion` headers are sent on every request including raw.githubusercontent.com (harmless there). ECC's calls now also carry these headers and use `redirect:"manual"`; a renamed-repo 301 on ECC is followed same-host (F9).
4. `mapGithubError`: 429 or (403 + `retry-after`) -> rate-limit with `resetAt = now + retry-after`; 403 with `x-ratelimit-remaining: 0` unchanged; other 403 stays "network / GitHub rejected the request (403)." ECC messages for 404/network are unchanged text.
5. `fetchAuthorTemplates` for ECC still makes exactly 1 api.github.com call; user sources 2 (commit + tree) — pinned by D-F1/D-F12.
6. A tree path such as `agents/../../../x.md` is never even a candidate (it has >1 segment under the folder) rather than reaching the "Unsafe path" skip; only paths that textually match the pattern but fail `isSafeRepoRelPath` (e.g. containing a backslash) get the "Unsafe path" reason. The URL builders also throw on unsafe paths as a second layer.
7. `addUserSource` validates the record it is about to save with `validateUserTemplateSource` and refuses (`invalid-config`) if it ever fails; display name given by the client is re-validated server-side (not trusted).
8. Duplicate detection runs inside `addUserSource` against the fresh config read (so a stale `duplicateOf` in the UI cannot bypass it); `source-limit` is checked before duplicates, on the raw array length.
9. `listTemplateSources`/`resolveGithubSourceById` call `loadGlobalConfig()`, which creates a default `config.json` if none exists (pre-existing behaviour); an existing file is never rewritten by list/fetch (D-M1).
10. `removeTemplateSource` filters the RAW array by `entry.id === id`; `"ecc"`/`"symbion"`/non-matching ids throw `invalid-source`; unknown well-formed id -> `{removed:false}`.
11. Inspect tokens: 32 hex from `randomBytes(16)`; `peek` does not consume; `consume` only after a successful save; 32 live max with oldest-first eviction. Folder paths accepted by add = `rootDirs` paths ∪ `detected` paths of THAT token, plus `isSafeRepoRelPath` or `"."`.
12. `duplicateOf` for built-ins reuses the builtin id (`"ecc"`), so the web's "Open tab" simply selects the existing tab id.
13. The web treats an item as Unverified when `authorOrigin === "user"` OR `authorId` matches `/^u-[0-9a-f]{10}$/` (fail-safe, never the reverse).
14. `TemplatesView` falls back to "symbion" whenever the selected id is not in the current tab list. Because the list is built from state, a *deep-linked* user id would also be dropped before the list loads (no deep links exist today; flagged for verification).
15. Retry on a user-source error panel re-lists sources first and only re-fetches if the id still exists (plan §8.7 last bullet).
16. The ">= 10 files hit 429" notice is detected client-side by matching `429` in the skipped reasons (`/\b429\b/`).
17. Web design-system guard still green; used only tokens already present (`warning`, `danger`, `danger-soft`, `danger-text`, `surface-hover`, `line-strong`, etc.) — no hex, no arbitrary `text-[..]`.
18. `GlobalConfig.templateSources` is typed `unknown[]` (untrusted); no `schemaVersion` bump (plan §8.3 / F6). `CURRENT_SCHEMA_VERSION` and `store.ts` untouched.

## 10. REVIEW — independent checkers (2026-10-19)

Three independent Checkers ran in parallel against the BUILD in §9: `code-reviewer`, `architect` (design conformance) and `security-reviewer` (the diff touches daemon RPC handlers, a user-supplied network target and a config write, so the `/cso` trigger applied). All ran `npx vitest run`: 110 files / 998 tests green.

| Checker | Verdict |
|---|---|
| code-reviewer | PASS — all 18 Maker assumptions confirmed; AC1–AC10 met, AC11 pending `/cso` sign-off |
| architect | PASS with follow-ups — no drift; all 8 declared deviations judged acceptable |
| security-reviewer | PASS — no Critical/High; 2 Medium, 4 Low |

No blocker. The items below are recommended before `/ship`; none is a data-safety regression.

### Should fix before ship
1. **Retry inside the add dialog can inspect twice** (code-reviewer, `AddTemplateSourceDialog.tsx:156-163`, `ui/button.tsx:44`). `AuthorFetchErrorPanel`'s Retry is a `<Button>` with no `type`, inside `<form onSubmit>`, so it submits as well as running `onClick`: two inspects, 4–8 GitHub calls, two tokens. Fix: `type="button"` on Retry; add a W5 case asserting one inspect call.
2. **`updateSettings` merges arbitrary keys into the global config** (architect 🟡-1, `handlers.ts` ~500-504, `Object.assign(config, params.globalConfig)`). Any RPC caller can set or wipe `templateSources` and `projects`, bypassing the inspect token, the cap and the duplicate check. Pre-existing hole, but this feature adds a security-relevant field to it. Impact bounded because `resolveGithubSourceById` re-validates every entry. Fix: whitelist mergeable keys (reject `templateSources`, `projects`, `schemaVersion`) + a test.
3. **No aggregate byte budget for fetched files** (security M1, `githubFetch.ts`): 150 files × 2 MB could be ~300 MB buffered and returned in one RPC response. Fix: total budget (e.g. 10–20 MB) with a "skipped: size budget" reason; consider ~256 KB per-file for user sources.
4. **Body-risk warning is too quiet for unverified items** (security M2, `ToolRiskPanel.tsx`, `LicenseAcknowledgmentStep.tsx`): danger styling only appears for risky tools/inline shell, so a body-only prompt injection or a `tools: Read` agent looks neutral. Fix: always show a warning-level body-risk notice for unverified items.
5. **Corrupt `config.json` leaks a raw 500 after quota is spent** (code-reviewer 🟡-2, `inspectSource.ts:175` → `userSources.ts:28`): read existing sources before the network work, or map the failure to `RpcError("invalid-config")`.

### Recommended small fixes
- `method in handlers` → `Object.hasOwn` + string check in `server.ts` (security; `constructor` echoes params, others 500). Optional body-size cap on `readBody`.
- Stale `config` object in `apps/daemon/src/index.ts:44-63` (architect 🟡-3): reload before `saveGlobalConfig` on a port change.
- Daemon-side cache / ETag for `commits/{ref}` and a visible "N of 60 requests left" (architect 🟡-2, F-A): each user-source load costs 2 API calls.
- Reject bidi/format characters in display names and path segments (security L2); cap concurrent inspects (L3).
- `applyTemplate`: validate `template.name` up front (security L1).
- `matching-refs` needs `per_page=100` (code-reviewer 🟢-3); correct the D-I2 wording in the testplan to match deviation 3.
- Nits: unused `HIGH_RISK_TOOLS` export; tool-risk set lacks `Task`/`Skill`/`SlashCommand`; user source can be named "ECC"/"Symbion"; 429 detection by regex on message text; stale effect comment in `TemplatesView.tsx`.

### Design flaws noted (architect)
- **F-B repo-jacking:** a saved source follows a moving ref under the stored owner/repo; if the account is renamed and re-registered, new content appears under the same Unverified tab. Consider storing `addedCommit` and warning when the first loaded SHA differs.
- **F-C:** the risk panel assesses `tools`/`allowed-tools`/inline shell, not the body; confirm the wording in `/cso`/`/qa`.

### Next
Fix pass (items 1–5, plus the cheap ones above) via `/build`, then `/qa` (must confirm live: `commits/HEAD` resolves, real 301 for the renamed ECC repo, Retry fires one inspect). Security sign-off for AC11 is covered by the security-reviewer run above.

## 11. Post-review changes (user-reported, 2026-10-19)

Found while trying a real repo (`MadsLorentzen/ai-job-search`): all 12 files under `.claude/commands/` were skipped with "File is missing frontmatter".

- **Root cause.** `parseTemplateMarkdown` required `---` frontmatter and a `description` for every kind. Claude Code does not: a command file is a plain prompt and `description` is optional. (The `.claude/` import already tolerates this via `pickedFile.ts`.)
- **Fix (`packages/core/src/templates/parseTemplate.ts`).** For **commands only**: a file with no frontmatter, or frontmatter without a (non-blank) `description`, now parses. The whole file is the body and `deriveCommandDescription` builds the description from the first heading (a leading `/name -` or `/name:` is dropped), else the first prose line, plain text, max 160 chars. Still skipped: empty commands, malformed YAML, wrong-typed fields. Agents and skills keep the strict rules.
- **Verified on the real repo:** 12/12 command files parse (e.g. `# /rank - Triage Scraped Jobs into a Ranked Shortlist` → "Triage Scraped Jobs into a Ranked Shortlist").
- **Tests:** core U30–U34; daemon D21. The existing "all four unparseable" daemon test now uses an empty command file (a non-empty one is valid by design).
- **UI (user request).** The "Unverified" badge is removed from the source header row and from each template card. It stays on the tab, in the preview modal and in the license step. This narrows **AC5**: user sources are flagged on the tab, preview and license step, not on cards.
- Full suite: 110 files / 1004 tests green; web and daemon builds pass.

## 12. QA — intentionally skipped (user decision, 2026-10-19)

`/qa` was skipped at the user's request. Residual risk, not verified live:
- Real-GitHub behaviour: `commits/HEAD` resolution, the 301 for a renamed repo (ECC), slash-containing refs, rate-limit UX. All tests mock `fetch`.
- Browser journey (chrome-devtools) for add → map folders → apply → remove.
- One real-repo check was done by hand: the 12 command files of `MadsLorentzen/ai-job-search` parse (section 11).

Review items still open at ship time (section 10): Retry in the add dialog can inspect twice; `updateSettings` merges arbitrary config keys; no aggregate byte budget for fetched files; body-risk warning for Unverified templates is too quiet; a corrupt `config.json` can surface a raw 500. Security review verdict was PASS (no Critical/High), so these were accepted as follow-ups.

## 13. SHIP

Final gate: `npx vitest run` and web/daemon builds green. Shipped through PR from `feat/templates-repo-url`.
