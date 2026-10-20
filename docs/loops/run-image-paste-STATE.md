# run-image-paste — STATE

> Feature: let the user paste / drag-drop / pick images in the Run dialog so they are sent to the local `claude` CLI together with the rendered command prompt.
> Phase: **DONE — shipped (committed locally on feat/run-image-paste, 2026-10-20)**. Verified: REVIEW PASS (build + fix-up), full vitest 121 files / 1098 tests, `npm run build` clean, real-CLI spike S1 (CLI 2.1.187). /cso and /qa SKIPPED by user choice (see residual risk below).
> Date: 2026-10-20

## Reference — how the Claude Code VS Code extension does it (v2.1.304, read from the minified bundle)

- **Webview paste**: iterates `clipboardData.items`, takes `kind==="file"` or `type` starting with `image/`, `getAsFile()`, then `FileReader.readAsDataURL` → `composerAttachments[{file,dataUrl}]` (removable chips). Drag-drop and the file picker go through the same function. Allowed types: png/jpeg/gif/webp → image, application/pdf → pdf, text/* and code extensions → text. Anything else is rejected with a visible message. 0-byte files are skipped. On WSL2, a paste that advertises an image type but yields no file is suppressed with a warning instead of inserting binary text.
- **On Enter**: content = `[ide_selection text?, {type:"image",source:{type:"base64",media_type,data}}…, document blocks…, {type:"text",text:prompt}]`. It is wrapped as `{type:"user",message:{role:"user",content}}` and written as one NDJSON line to stdin of `claude --input-format stream-json --output-format stream-json --verbose`.
- **The CLI normalizes every image block itself** (`FPi`→`pP`→`oCe`, using sharp):
  - limits ≤2000×2000 px and ≤5 MB base64;
  - over the byte limit: PNG palette compression, then JPEG quality 80→20;
  - over the dimension limit: aspect-preserving downscale;
  - then a ~500 KB JPEG byte budget;
  - when downscaled, adds the text `[Image: original WxH, displayed at wxh. Multiply coordinates by …]`;
  - when an image fails, replaces it with `[Image could not be processed: …]`.
- **Consequence for Symbion**: the caller does **not** need to resize. It only needs to deliver base64 image blocks over stdin.

## Verified current state (code facts)

- `RunDialog.tsx:172`: the requirement field is a **single-line `<Input>`**. There is **no follow-up / multi-turn prompt input**: runs are one-shot `-p`.
- `cliDriver.ts` `buildArgv`: the prompt is a single argv string (`-p <renderRunCommand(...)>`). `runManager.ts:178` spawns with `stdio:["ignore","pipe","pipe"]`, so stdin is closed today.
- `server.ts` `readBody`: **no byte cap**. It concatenates the whole body in memory. The only input limit is requirement ≤ 10,000 chars (`handlers.ts` `startRun`).
- `parseStreamJson.ts:123` already maps image blocks to the placeholder `[image]`.
- `.symbion/` is gitignored. History lives at `.symbion/runs/<id>/{run.json,events.jsonl}`, and `preflight.ts` pre-fills the last requirement from `run.json`.
- `fake-claude.mjs` ignores stdin and records only argv (`FAKE_CLAUDE_ARGV_OUT`).
- The daemon is tokenless (see `tokenless-daemon-STATE.md`). The trust boundary is the loopback bind, the Origin/Host allowlist and nonce-bound run consent.

## Requirements

**Why**: developers explain visually (UI-bug screenshots, mocks, error dialogs). Today they have to describe the screenshot in words or save it into the repo and reference its path. The goal is parity with Claude Code's own composer, so screenshot-driven runs (`/investigate`, bug-fix commands) work without friction.

**Functional**
- FR-1: In the Run dialog, attach images by **paste** (Ctrl/Cmd+V), **drag-drop** (with a visible drop overlay) and a **file-picker** button (keyboard/a11y path).
- FR-2: Types: png, jpeg, gif, webp. Anything else (including SVG) is rejected with a visible inline message, never dropped silently.
- FR-3: Each attachment shows as a thumbnail chip (name and size tooltip, remove button). Count and size limits are shown.
- FR-4: On Start, the CLI receives one user message: the image blocks plus the rendered `/command` text. The slash command resolves exactly as it does for text-only runs.
- FR-5: Text-only runs behave exactly as today (regression).
- FR-6: The transcript and history show that images were attached (a chip or thumbnail from the local stored copy).
- FR-7: If the clipboard claims an image but no file can be extracted (WSL2/WSLg), show a hint pointing to drag-drop or the picker. Never insert garbage text.

**Non-functional**
- Limits are enforced in the web UI **and** in the daemon (suggested: ≤5 images, ≤5 MB raw each, ≤20 MB total). `readBody` gets an explicit byte cap and returns 413 or `invalid-params` without crashing.
- The daemon checks the type by **magic bytes**, not the client's MIME, and rejects malformed base64.
- Image bytes never go into argv, a shell string, logs or stderr capture. `run.json` holds metadata only (name, type, size, hash).
- Untrusted rendering: thumbnails come only from the user's local blob/data URL or the daemon's stored copy, never from a URL in CLI output. `agents/Markdown.tsx` still fetches no images. Base64 found in events is never rendered.
- Filesystem: if stored, attachments live only under the confined `.symbion/runs/<id>/attachments/` with generated filenames. Retention pruning deletes them with the run. Nothing is written into the target repo.
- Consent: the nonce fingerprint includes the attachment hashes, so a nonce cannot be replayed with different images. The consent summary says "N images (X MB) will be sent to Claude".
- Hermetic QA: fake-claude must record stdin (`FAKE_CLAUDE_STDIN_OUT`) so tests assert the exact NDJSON with no tokens.
- The UI stays responsive while encoding (async). Start is disabled until encoding finishes.

**Acceptance criteria**
- AC-1: Paste a PNG → chip appears → Start → the fake-CLI stdin capture has exactly one image block (base64, correct media type) and the rendered command text.
- AC-2: Drop a `.webp` → attached. Drop a `.zip` or `.svg` → "not supported" message, nothing attached.
- AC-3: Over-cap images or totals are blocked in the UI. A crafted oversize RPC gets 413/`invalid-params`, and the daemon serves the next request.
- AC-4: A text-only run is unchanged (argv/stdin regression test).
- AC-5: No base64 appears in daemon logs, argv or stderr capture.
- AC-6: A finished run in history shows an attachment indicator. `.symbion/runs/` contents match the chosen persistence policy.
- AC-7: The CLI's `[Image could not be processed …]` text is shown as plain text.
- AC-8: The remove button works, and Start is disabled while encoding.

## Solution Options

| Rank | Option | Summary | Pros | Cons | Size |
|---|---|---|---|---|---|
| **1** | **A — stdin stream-json** | Web sends `attachments:[{mediaType,data,name}]` in `startRun`. The daemon validates, spawns with `--input-format stream-json` and piped stdin, writes one NDJSON user message, then ends stdin. It optionally stores the bytes under the run dir. | Same path as the official extension, and the CLI does the normalization. No Read permission or extra tool turn. Works in `plan` mode and with restrictive `allowedTools`. Prepares stdin as the channel for future follow-up turns. | Changes the spawn path. Must verify that `-p` + `--input-format stream-json` exits after the result when stdin closes. Needs a CLI version gate in preflight (`cliVersion.ts`), EPIPE handling and a `readBody` cap. | **M** |
| 2 | C — hybrid | Persist to disk, deliver via stdin when the CLI supports it, and otherwise fall back to a path reference. | Most robust. | Two delivery paths to test and explain. | M–L |
| 3 | B — path in prompt | Save the images under `.symbion/runs/<id>/attachments/` and append "see image: <path>" to the prompt. | Smallest daemon change, and argv-only tests. | The model must *choose* to Read the file: an extra turn, and it fails silently when Read is blocked. No normalization. Changes the prompt preview. | S |

**Open design sub-choice for A**: move **all** runs to stdin (one code path, but a full regression check needed) or use stdin **only when there are attachments** (lower risk, two paths). Leaning toward stdin only when attachments are present for v1.

**Likely impacted files**:
- `apps/daemon/src/run/cliDriver.ts` (flag and stdin payload)
- a new pure NDJSON builder in `packages/core/src/run/`
- `apps/daemon/src/run/runManager.ts` (piped stdin, end, EPIPE)
- `apps/daemon/src/run/runStore.ts` (confined attachments dir, pruning)
- `apps/daemon/src/rpc/handlers.ts` and the RPC contract types (`StartRunParams`, `RunRecord` attachment metadata)
- `apps/daemon/src/server.ts` (`readBody` cap)
- `apps/daemon/src/run/preflight.ts` (version gate, pre-fill policy)
- `packages/core/src/run/parseStreamJson.ts`, `agentTree`, `transcriptBlocks` (image block chip)
- `apps/web/src/components/run/RunDialog.tsx` (paste/drop/picker, chips, errors)
- `MissionStatusStrip.tsx` and `RunHistoryPopover.tsx` (indicator)
- `apps/daemon/test/fixtures/fake-claude.mjs` (`FAKE_CLAUDE_STDIN_OUT`)

**Risks**: unbounded `readBody` (memory DoS, made real by this feature); type spoofing and SVG; screenshots containing secrets that persist to disk; slash-command regression from the spawn-path change; an old CLI without `--input-format` (block in preflight); the child dying before reading stdin.

## Ideas (beyond v1)

- **Attachments as a declared command input**: frontmatter such as `accepts: images` (count/types). The dialog shows or requires the drop zone only for those commands, and it is visible in the authoring forms and the graph.
- Image thumbnail in the transcript's opening prompt block and in past-run replay (served from the daemon's stored copy).
- "Re-run with same attachments" (extends today's requirement pre-fill).
- PDFs and text files (logs, stack traces). A large text paste could become a chip.
- A multi-line requirement textarea composer, which pairs naturally with attachments.
- Follow-up / multi-turn input over the same stdin channel (separate feature).

**Proposed v1 cut**: png/jpeg/gif/webp only; paste, drop and picker; chips; size and count limits enforced on both sides; attachment indicator in transcript/history; Option A.
**Defer**: PDF/text, command-declared attachments, multi-turn, re-run with attachments, attachment gallery.

## Open Questions (for /office-hours)

1. **Persistence policy** (decide first; it drives /cso): keep metadata only, keep bytes under the run dir with the retention rules, or let the user choose? Screenshots may contain secrets.
2. Can a run start with **images and no requirement text**? (Execute currently requires non-empty text.)
3. Does **"Run again"** re-attach the previous images or only the text? (Suggested: text only in v1.)
4. **Limits**: max image count and per-file/total size.
5. **PDF/text** in v1, or images only?
6. **Follow-up input** is confirmed out of scope? (It doesn't exist today.)
7. For Option A: stdin for **all** runs, or only when there are attachments?

## Recommended Next Step

Scope is mostly clear, but the open questions (#1 persistence, #2 and #4) change the security surface and the test plan. Run **`/office-hours`** to lock scope, then `/plan` (architect). **`/cso` is required**: the feature touches the RPC payload size, run persistence and the spawn path.

---

## Scope (locked — office-hours 2026-10-20)

### Problem / goal
A developer starting a run can attach screenshots or images to the requirement. Claude receives them as real multimodal input, the same way Claude Code's own composer sends them. "Done" means: paste a screenshot into the Run dialog, Start, and the run's first prompt block shows the thumbnail while Claude sees the image.

### Decisions
| # | Question | Decision |
|---|---|---|
| D1 | Persistence | **Store the bytes** in `.symbion/runs/<id>/attachments/`, using generated filenames (`<n>.<ext>`), confined, written atomically, and deleted with the run by the existing retention. `run.json` holds **metadata only** (`name`, `mediaType`, `size`, `sha256`, `file`). The base64 never goes into `run.json`, `events.jsonl`, logs or argv. |
| D2 | Types and inputs | **Images only**: png / jpeg / gif / webp, checked by magic bytes in the daemon. SVG and everything else are rejected with an inline message. **Three ways in**: paste, drag-drop (with a drop overlay) and a file-picker button. |
| D3 | Limits | **≤5 images, ≤5 MB raw each, ≤20 MB total.** Enforced in the web UI and again in the daemon. `readBody` gets a hard byte cap (~30 MB) and returns **413** above it. Over-limit attachment params get `invalid-params`. |
| D4 | Run rules | Requirement text stays **required** (no image-only runs). **"Run again" pre-fills text only**; attachments are not re-attached. |
| D5 | Spawn path | **stdin stream-json only when there are attachments.** Text-only runs keep today's argv `-p` path unchanged. Runs with attachments spawn with `--input-format stream-json`, piped stdin, one NDJSON user message (image blocks, then the rendered command text), then end stdin. Preflight blocks attachments when the CLI version predates `--input-format`. |
| D6 | Display | A **thumbnail in the transcript's opening prompt block**, served from the daemon's stored copy through a confined read RPC (click to enlarge). History and status show an image count. Thumbnails are never built from event data or remote URLs, and `agents/Markdown.tsx` is unchanged (it still fetches no images). |

### In scope (v1)
- RunDialog: paste, drop and picker handlers; chips (thumbnail, name/size tooltip, remove); inline errors for type, size and count; a WSL2 hint when a paste carries an image type but no file; Start disabled while encoding.
- RPC: `startRun` accepts `attachments: {name, mediaType, data(base64)}[]`; a new confined read method for a stored attachment.
- Daemon: validation (magic bytes, base64, limits); storing attachments; stdin delivery; EPIPE turned into a normal run error; `readBody` cap; preflight version gate; the consent nonce fingerprint includes the attachment hashes; consent text says "N images (X MB) will be sent to Claude".
- Core (pure): an NDJSON user-message builder; `parseStreamJson`, `agentTree` and `transcriptBlocks` tolerate image blocks without ever rendering their base64.
- Fake CLI: `FAKE_CLAUDE_STDIN_OUT` records stdin for hermetic tests.

### Out of scope (deferred)
PDF/text attachments · image-only runs · re-run with the previous attachments · multi-turn/follow-up input · attachments declared in command frontmatter · moving all runs to stdin · a multi-line textarea composer · an attachment gallery · Codex driver support.

### Data model changes
- RPC `StartRunParams.attachments?` (transport only).
- `RunRecord.attachments?: {name, mediaType, size, sha256, file}[]` in `run.json`. Optional, so old runs stay readable.
- New on-disk folder `.symbion/runs/<id>/attachments/` (gitignored via `.symbion/`).
- No changes to the Canonical IR, adapters, publish/upsert, or target-repo files.

### Impact on existing features
- Run engine: a second spawn mode, used only when there are attachments. The text-only path must be byte-identical (regression test).
- Run history, retention and preflight pre-fill: they get the attachment metadata, and retention deletes the attachment folder.
- Agents panel: the opening prompt block can carry thumbnails.
- Every RPC method gets the `readBody` cap (a global hardening change).
- Publish/IR/graph: no impact.

### Edge cases
- The clipboard has an image type but no file (WSL2) → hint, nothing inserted.
- A non-image paste falls through to normal text input.
- A file's MIME is spoofed (e.g. a .png that is really an SVG or ZIP) → the daemon rejects it by magic bytes.
- Malformed base64, or a 0-byte file → rejected.
- The CLI exits before reading stdin (EPIPE) → the run errors normally and the daemon stays up.
- The CLI is too old for `--input-format` → preflight blocks attachments with a clear message; text-only runs still work.
- The CLI emits `[Image could not be processed …]` → shown as plain text.
- The daemon restarts mid-run → existing run-recovery behaviour applies; attachments already on disk stay with the run.
- Retention prunes a run → its attachments folder goes with it.
- Reading an attachment for a missing or pruned run, or a path outside the run dir → `not-found`/rejected by confinement.

## Acceptance criteria (Checker)
- **AC-1** Pasting a PNG shows a chip; Start → the `FAKE_CLAUDE_STDIN_OUT` capture holds exactly one NDJSON user message with one base64 image block (`image/png`) followed by the rendered command text, and the argv contains `--input-format stream-json`.
- **AC-2** Drag-dropping a `.webp` and using the picker both attach. A `.zip` or `.svg` → inline "not supported" and nothing attached. A 6th image, a file over 5 MB, or more than 20 MB total → blocked in the UI with a message.
- **AC-3** A crafted `startRun` over the limits gets `invalid-params`. A body over the `readBody` cap gets 413. The daemon then serves the next request.
- **AC-4** A text-only run's argv and spawn options are byte-identical to before (regression test); stdin is still ignored.
- **AC-5** Image base64 appears nowhere in `run.json`, `events.jsonl`, daemon logs, argv, or the stderr capture.
- **AC-6** `.symbion/runs/<id>/attachments/` holds the decoded bytes under generated names, the sha256 values match `run.json`, and retention pruning deletes them.
- **AC-7** The transcript's opening prompt block shows the thumbnail(s) from the daemon read RPC; history shows the image count. The attachment read RPC rejects ids outside the run dir.
- **AC-8** The consent nonce is bound to the attachment hashes: replaying the nonce with different attachments is rejected.
- **AC-9** "Run again" pre-fills only the text, with no attachments. Execute stays disabled when the requirement is empty, even with images attached.
- **AC-10** Preflight with a fake old CLI version blocks attachments with a clear message, and text-only runs still start.
- **AC-11** A fake CLI that exits immediately (EPIPE) produces a failed run record; the daemon does not crash.

---

## PLAN — Architecture (architect, 2026-10-20)

> Input: the locked `## Scope` (D1–D6) and AC-1..AC-11 above. No design doc exists, so §P.8 (UI specifics) is binding for the builder.
> Test plan: `docs/loops/run-image-paste-testplan.md`.
> Every claim about current code below was re-checked against the tree at `d57b0f6`.

### P.0 Code facts re-verified (and two new ones that change the design)

| Fact | Where | Consequence |
|---|---|---|
| `buildArgv` puts the prompt right after `-p` (`["-p", prompt, "--output-format","stream-json","--verbose","--permission-mode",m, …]`). `-p` is a boolean flag; the prompt is a positional arg. | `apps/daemon/src/run/cliDriver.ts` | In stdin mode the prompt is **omitted from argv** (§P.4). |
| `spawn(bin, argv, {cwd, detached:true, stdio:["ignore","pipe","pipe"], env})`. No `stdin` error listener exists (no stdin). | `runManager.ts` `start()` | Piping stdin **without** a `child.stdin.on("error")` listener crashes the daemon on EPIPE (an unhandled `'error'` event). The listener is mandatory (§P.4, AC-11). |
| `runId` is minted **inside** `runManager.start()`, which also writes `run.json` and opens `events.jsonl` before spawn. | `runManager.ts` | Attachment bytes must be stored **inside** `start()` (they need the runId). See §P.4 for the order. |
| Nonce = `{projectId, artifactId, configHash}`, minted by `runPreflight` **when the dialog opens**, consumed by `startRun`. | `nonces.ts`, `preflight.ts`, `RunDialog.tsx` | Images are added **after** the nonce was minted. Binding hashes needs a re-preflight with attachment metadata (§P.5). |
| `cliVersion` probe: `getRunCliVersion` (startRun) and `checkCli` (preflight). Both parse `/(\d+\.\d+\.\d+)/`, giving `"unknown"`/`null` on failure. fake-claude hard-codes `2.1.187`. | `cliVersion.ts`, `preflight.ts`, `fake-claude.mjs` | The version gate uses core `compareVersions`. fake-claude needs `FAKE_CLAUDE_VERSION` for AC-10. |
| The main agent's opening prompt block = `ctx.requirement` (`agentTree.ts` `out.prompt = ctx.requirement` for root). The CLI's own echo of the user message is **not** used. | `agentTree.ts`, `DependencyGraph.tsx` agentCtx, `transcriptBlocks.ts` | Thumbnails come from `RunInfo.attachments` metadata plus the read RPC. **No** `--replay-user-messages` (§P.10 F3). No change to `parseStreamJson`/`agentTree` is required for the display. |
| `readBody` does `data += chunk` on **Buffer** chunks: each chunk is decoded separately, so a multi-byte UTF-8 char split across a 64 KB chunk boundary is corrupted (U+FFFD). | `server.ts` | **Pre-existing latent bug** that a multi-MB body makes real: a non-ASCII requirement or filename lands at a chunk boundary. The fix is in the same change (§P.3). |
| Persisted events are the **parsed** `RunEvent`, not raw lines. However, `unknown`/`parse-error` keep `rawTruncated` (≤ 8 KB raw), and `stderrTail` lines go verbatim into `run.json.errorMessage`. | `parseStreamJson.ts`, `runManager.ts` | These are the only two channels through which CLI-emitted base64 could reach disk. Both get a pure redactor (§P.6) for AC-5. |
| Retention `prune()` does `rmSync(runDir, {recursive:true})`. | `runStore.ts` | `attachments/` inside the run dir is deleted with no code change. A test pins it (AC-6). |
| `CLI 2.1.187 --help`: `--input-format <text\|stream-json>` ("only works with --print"); `--replay-user-messages` ("only works with --input-format=stream-json and --output-format=stream-json"). | local `claude --help` | The flag exists on the dev's CLI. The exact minimum version is unknown (§P.10 F5). |

### P.1 Package / app boundaries and files

**`packages/core` (pure, no Node imports, so `Uint8Array` only, never `Buffer`)**: new `src/run/attachments.ts`, exported from `src/index.ts`:
- `RUN_ATTACHMENT_LIMITS = { maxCount: 5, maxBytesEach: 5 * 1024 * 1024, maxBytesTotal: 20 * 1024 * 1024, mediaTypes: ["image/png","image/jpeg","image/gif","image/webp"] } as const`. This is the **single source** for the web and the daemon. MB means MiB everywhere, including the UI copy.
- `type RunAttachmentMediaType = (typeof RUN_ATTACHMENT_LIMITS.mediaTypes)[number]`.
- `sniffImageType(bytes: Uint8Array): RunAttachmentMediaType | null` uses magic bytes only:
  - PNG `89 50 4E 47 0D 0A 1A 0A`;
  - JPEG `FF D8 FF`;
  - GIF `47 49 46 38 (37|39) 61`;
  - WebP `52 49 46 46 ?? ?? ?? ?? 57 45 42 50`.
  - Anything else (SVG/XML text, ZIP `50 4B`, PDF, BMP, HEIC, empty) → `null`.
- `extForMediaType(t)` → `png|jpg|gif|webp`.
- `validateAttachmentSet(items: {size:number; mediaType:string}[]): {ok:true} | {ok:false; reason: "count"|"empty"|"too-large"|"total"|"type"; index?:number}` is pure and shared by the web pre-check, the preflight param check and startRun.
- `attachmentsDigest(items: {sha256:string; size:number; mediaType:string}[]): string`:
  - `sha256Hex(JSON.stringify(items.map(a => [a.sha256, a.size, a.mediaType])))`, order-sensitive.
  - `EMPTY_ATTACHMENTS_DIGEST = attachmentsDigest([])` is the binding value for text-only runs.
- `sanitizeAttachmentName(name: unknown, index: number): string` does the following:
  - strips C0/C1 control chars and bidi overrides (U+202A–U+202E, U+2066–U+2069);
  - collapses whitespace;
  - caps at 120 chars;
  - defaults to `image-<n>`.
  - The name is **display-only and never used as a path**.
- `buildStreamJsonUserMessage(input: { images: {mediaType: RunAttachmentMediaType; base64: string}[]; text: string }): string` returns **exactly one line terminated by `\n`**: `JSON.stringify({type:"user", message:{role:"user", content:[...images.map(i => ({type:"image", source:{type:"base64", media_type:i.mediaType, data:i.base64}})), {type:"text", text}]}}) + "\n"`.
  - Invariant: the text block is **last** (the CLI treats the last text block as the slash-command input; §P.10 F2).
  - It throws when `images` is empty (stdin mode is only for runs with attachments).
- `formatAttachmentBytes(n)` → `"3.4 MB"`, used by the consent sentence and the chips.
- `redactBase64Runs(s: string): string` replaces any run of `[A-Za-z0-9+/]{512,}={0,2}` with `[base64 omitted: <n> chars]` (§P.6).

**`packages/core/src/util/sha256.ts`**: add `sha256HexBytes(bytes: Uint8Array): string`, and refactor `sha256Hex(str)` to call it on the UTF-8 bytes (behaviour-preserving). The web uses it (no dependency on `crypto.subtle` / a secure context). The daemon uses `node:crypto`, and a cross-check test pins equality.

**`packages/core/src/run/events.ts`**: add `RunAttachmentMeta { index: number; name: string; mediaType: RunAttachmentMediaType; size: number; sha256: string; file: string }` and `RunInfo.attachments?: RunAttachmentMeta[]` (optional, **absent** for text-only runs, so text-only `run.json` is byte-identical). Add `RunListItem.attachmentCount?: number` (present iff > 0).

**`packages/core/src/run/parseStreamJson.ts`**: apply `redactBase64Runs` to `rawTruncated` (`unknown` and `parse-error`), **before** the `RAW_CAP` truncation. No other parser change: image blocks in tool results already map to `[image]`, and user lines keep only `tool_result` parts.

**`packages/rpc-types/src/index.ts`**:
- `RunPreflightParams.attachments?: { sha256: string; size: number; mediaType: string }[]` (metadata only, no bytes).
- `RunPreflightResult.attachmentSupport: { supported: boolean; minCliVersion: string; reason?: string }` (always present).
- `RunPreflightResult.permissionSummary.attachmentsSentence?: string`.
- `StartRunParams.attachments?: { name: string; mediaType: string; data: string /* base64 */ }[]`.
- New `ReadRunAttachmentParams { projectId: string; runId: string; index: number }` and `ReadRunAttachmentResult { mediaType: RunAttachmentMediaType; size: number; data: string /* base64 */ }`.
- `"readRunAttachment"` is added to `RpcMethod`, and the new types are re-exported in `apps/daemon/src/rpc/contract.ts`.

**`apps/daemon`**
- `src/server.ts`: a capped `readBody` that returns 413 (§P.3).
- `src/run/attachments.ts` (new) does decode/validate (`decodeAndValidateAttachments`), `storeAttachments` and `readAttachment`. It is the only module that touches attachment bytes on disk.
- `src/run/cliDriver.ts`: `buildArgv` gains `inputMode?: "argv" | "stdin"`, and `MIN_CLI_VERSION_FOR_ATTACHMENTS` + `cliSupportsAttachments(version)` are added (§P.7).
- `src/run/runManager.ts`: `StartRunInput.attachments?: ValidatedAttachment[]`; stores them, uses the conditional stdio, writes stdin and handles stdin errors; adds the exported pure helper `spawnStdioFor(hasAttachments)`; stderr lines go through `redactBase64Runs` plus a 2,000-char per-line cap.
- `src/run/runStore.ts`:
  - `attachmentsDirAbs(projectRoot, runId)` (confined);
  - `writeAttachmentFile(projectRoot, runId, file, bytes)` (atomic temp → rename, `wx` temp);
  - `readAttachmentFile(projectRoot, runId, file)` (lstat refuses symlinks, size-checked);
  - `toListItem` adds `attachmentCount`.
- `src/run/preflight.ts`: attachment param handling, the `attachmentSupport` field, an `attachments` check row, the digest in the nonce, `attachmentsSentence`, and a stdin-mode `invocationEcho`.
- `src/run/nonces.ts`: `NonceBinding.attachmentsDigest: string`, compared in `consume`.
- `src/run/runConfig.ts`: `buildAttachmentsSentence(count, totalBytes)`.
- `src/rpc/handlers.ts`: `runPreflight` passes `attachments`; `startRun` validates, computes the digest and gates; new `readRunAttachment`.
- `test/fixtures/fake-claude.mjs`: adds `FAKE_CLAUDE_STDIN_OUT`, `FAKE_CLAUDE_VERSION`, `FAKE_CLAUDE_MODE=exit-no-read` (+ `FAKE_CLAUDE_EXIT_CODE`) and `FAKE_CLAUDE_MODE=stderr-echo-stdin` (§P.9).
- `test/runHelpers.ts`: `startTestRun` gains an optional `attachments` param and re-preflights with their metadata.

**`apps/web`**
- `src/lib/run/attachments.ts` (new, client): `encodeImageFile(file) → Promise<EncodedAttachment>`. It reads `file.arrayBuffer()`, then runs `sniffImageType`, then `sha256HexBytes`, then base64 via chunked `FileReader.readAsDataURL` with the prefix stripped. It also builds the `URL.createObjectURL(file)` preview **only after** the sniff passes.
- `src/lib/run/attachmentCache.ts` (new): a module-level LRU of 20 entries, keyed `${runId}:${index}`, holding object URLs built from `readRunAttachment` bytes. It revokes URLs on eviction.
- `src/components/run/AttachmentChips.tsx` (new): composer chips.
- `src/components/run/useAttachmentComposer.ts` (new hook): paste/drop/pick handlers, limits, error list and encoding state.
- `src/components/run/RunDialog.tsx`: wires the hook and re-preflights on attachment changes (§P.5).
- `src/components/run/agents/PromptAttachments.tsx` (new): transcript thumbnails and the lightbox.
- `TranscriptBlocks.tsx`: `PromptBubble` gets `attachments?`, rendered only for the root agent.
- `AgentDetailView.tsx` / `AgentsPanel.tsx`: thread `promptAttachments?: { projectId; runId; items: RunAttachmentMeta[] }` down from `DependencyGraph.tsx` (`shownRun.attachments`).
- `RunHistoryPopover.tsx`, `MissionStatusStrip.tsx`, `PastRunBanner.tsx`: image-count indicator.
- `useRunStore.ts`: `preflight(projectId, artifactId, attachments?)`, plus a `readRunAttachment` passthrough.

**Explicitly unchanged**: `agentTree.ts` (root prompt still = `ctx.requirement`), `transcriptBlocks.ts` block kinds, `agents/Markdown.tsx` (still no `<img>`), IR/adapters/publish, and target-repo files.

### P.2 Daemon RPC surface

| Method | Params | Result | Touches disk | Errors |
|---|---|---|---|---|
| `runPreflight` (extended) | `{projectId, artifactId, attachments?: {sha256,size,mediaType}[]}` | existing + `attachmentSupport`, `permissionSummary.attachmentsSentence?` (iff attachments non-empty), `consentNonce` bound to `attachmentsDigest(attachments ?? [])` | reads only (unchanged) | `invalid-params` when attachments are not an array, >5, a bad sha (`/^[0-9a-f]{64}$/`), size not an int in 1..5 MiB, a mediaType outside the allowlist, or total > 20 MiB |
| `startRun` (extended) | existing + `attachments?: {name, mediaType, data}[]` | unchanged; `run.attachments` present iff attachments | **writes** `.symbion/runs/<id>/attachments/<n>.<ext>` + `run.json` | `invalid-params` (§P.4 step 1 list), `run-consent-required` (digest mismatch), `run-attachments-unsupported` (CLI too old/unknown), `attachment-store-failed` (fs error; run dir removed, reservation released) |
| `readRunAttachment` (new) | `{projectId, runId, index}` | `{mediaType, size, data}` | reads one file | `invalid-params` (runId not uuid-v4, index not an int 0..4), `not-found` (run missing/pruned, no `attachments[index]`, or file missing), `path-confinement` (symlink/escape), `attachment-corrupt` (sha/size/magic mismatch with run.json) |
| HTTP | body > `MAX_RPC_BODY_BYTES` | **413** `{error:{code:"payload-too-large"}}` | none | the connection is closed after the response; the server keeps serving |

**Decision: the read path is a POST `/rpc` method returning base64 JSON, not a dedicated GET route.** Reasons:
1. A `GET /run-attachment?...` loaded by `<img src>` carries **no `Origin` header** (no-cors image fetch), and the Host check passes for any page the user visits that embeds `http://127.0.0.1:<port>/…`. That gives a cross-site existence/timing oracle on stored screenshots. POST `/rpc` with `Content-Type: application/json` forces a CORS preflight, which the server 404s, and a `text/plain` POST carries an `Origin`, which the allowlist rejects. That is the same protection every other RPC already has.
2. There is no new route class, CSP, MIME or caching surface; `serveStaticFile` stays the only GET file server.
3. The payload is ≤ 5 MiB per call (≈ 6.7 MB JSON) on loopback, which is acceptable. The web turns it into a `Blob` and an object URL (never a giant `data:` string in the DOM).

The params take an **index**, not a filename or path, so the client never supplies a path component. The daemon maps index → `run.json.attachments[index].file`, re-validates `file` against `^[1-5]\.(png|jpg|gif|webp)$`, and then calls `resolveConfinedPath`.

### P.3 `readBody` hard cap (global hardening)

- `MAX_RPC_BODY_BYTES = 30 * 1024 * 1024` (31,457,280), exported from `server.ts`.
  - Arithmetic: 20 MiB raw → base64 `4·⌈20,971,520/3⌉ = 27,962,028` bytes.
  - Requirement ≤ 10,000 chars × ≤ 3 UTF-8 bytes (JSON.stringify doesn't `\u`-escape non-ASCII) = ≤ 30 KB.
  - 5 names × 120 chars, keys and ids: < 2 KB.
  - Worst legitimate body ≈ 28.0 MB, so the 30 MiB cap leaves ≈ 3.4 MiB headroom. **The STATE's "~30 MB" is correct only as 30 MiB.** A decimal 30,000,000 still fits (≈ 2 MB headroom), but MiB is pinned to avoid ambiguity.
- Algorithm:
  1. If the `Content-Length` header is a number above the cap → 413 immediately, without reading.
  2. Otherwise collect **`Buffer` chunks** in an array with a running byte count. When the count exceeds the cap: stop retaining chunks, send 413 with `Connection: close`, call `req.resume()` (discard), and `req.destroy()` once `res` finishes (bounded: no unbounded drain).
  3. On `end`: `Buffer.concat(chunks).toString("utf-8")`, decoded **once**. This also fixes the chunk-boundary UTF-8 corruption from P.0.
- `readBody` rejects with a typed `PayloadTooLargeError`, and the handler maps it to 413 (not 400 `bad-json`).
- Web `callRpc`: if `res.status === 413` → `DaemonRpcError({code:"payload-too-large", message:"The images are too large to send (limit 20 MB total)."})`. If `res.json()` throws (connection reset mid-upload) → `DaemonRpcError({code:"network", …})`. Today an unguarded `res.json()` throws a raw `SyntaxError`.
- Residual risk (accepted, for `/cso`): N concurrent 30 MiB bodies from a local process can still use N × 30 MiB. A loopback-only local attacker can DoS the machine anyway. No global in-flight budget in v1.

### P.4 `startRun` with attachments: exact order

1. **Param validation (pure CPU, before `reserve`)**, in `decodeAndValidateAttachments` (`apps/daemon/src/run/attachments.ts`):
   - `attachments` is absent, or an array of 1..5 items. An empty array `[]` is treated as absent.
   - Each item is an object with `name` (string; then `sanitizeAttachmentName`), `mediaType` (string) and `data` (string).
   - `data` passes the strict base64 check: `/^[A-Za-z0-9+/]*={0,2}$/`, `length % 4 === 0`, `length ≤ 4·⌈5 MiB/3⌉`. Then `Buffer.from(data,"base64")` and a canonical round-trip (`buf.toString("base64") === data`, which rejects garbage and non-canonical padding).
   - `buf.length ≥ 1` and ≤ 5 MiB.
   - `sniffImageType(buf)` is non-null **and** equals the client `mediaType`. A mismatch is `invalid-params` "file content is not a <type>". SVG/ZIP sniff as `null`, giving "unsupported image type".
   - Σ size ≤ 20 MiB (`validateAttachmentSet`).
   - `sha256 = createHash("sha256").update(buf).digest("hex")`.
   - The output is `ValidatedAttachment {index, name, mediaType (sniffed), size, sha256, bytes: Buffer}`.
   - Error messages name the item index and never echo `data`.
2. `reserve(projectId)` (unchanged lock point).
3. Nonce: `nonceStore.consume(nonce, {projectId, artifactId, configHash, attachmentsDigest: attachmentsDigest(validated ?? [])})`. A mismatch gives `run-consent-required` and burns the nonce (web re-preflights).
4. `cliVersion = await getRunCliVersion(bin)` (existing). If attachments are present and `!cliSupportsAttachments(cliVersion)` → `run-attachments-unsupported` "claude CLI <v> cannot receive images (needs ≥ <min>). Remove the images or update the CLI."
5. `argv = buildArgv({..., inputMode: attachments ? "stdin" : "argv"})`:
   - Text-only (`argv` mode): **byte-identical** to today.
   - Stdin mode: `["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-mode", m, ...(model), ...(allowedTools)]`, with **no positional prompt**. Giving a positional prompt and stream-json stdin together is undefined, so the prompt is not given twice.
   - `--replay-user-messages` is **not** passed.
6. `runManager.start({..., attachments: validated})` runs synchronously up to spawn:
   1. Mint `runId`; `ensureRunsDir`.
   2. **If attachments:** `storeAttachments(projectRoot, runId, validated)`:
      - `mkdirSync(.../<runId>/attachments, {recursive:true})`, confined via `resolveConfinedPath`;
      - for each item: `writeAttachmentFile(..., "<index+1>.<ext>", bytes)`. This opens a temp `<file>.symbion-tmp-<pid>-<rand>` with flag `wx` (no clobber, no follow), writes, `fsync`s, and renames.
      - On any throw: `rmSync(runDir, {recursive:true, force:true})` (only this run's own fresh dir, lstat-checked), then throw `RpcError("attachment-store-failed")`, so the handler releases the reservation.
   3. Build `run.attachments = validated.map(({bytes, ...meta}) => ({...meta, file}))`, then `writeRunJson` (status `starting`). Bytes and base64 are never placed on `RunInfo`.
   4. `openEventsFd`.
   5. `spawn(bin, argv, {cwd, detached:true, stdio: spawnStdioFor(hasAttachments), env})`, where `spawnStdioFor(false)` = `["ignore","pipe","pipe"]` (unchanged) and `spawnStdioFor(true)` = `["pipe","pipe","pipe"]`.
   6. **If attachments:**
      - Attach `child.stdin.on("error", (err) => { ar.stdinError = err.code ?? err.message })` **before** writing.
      - Then `child.stdin.end(buildStreamJsonUserMessage({images: validated.map(v => ({mediaType: v.mediaType, base64: v.bytes.toString("base64")})), text: renderRunCommand({command, requirements: requirement})}))`.
      - The base64 is re-encoded from the **validated bytes** (what is hashed/stored is exactly what is sent), not taken from the client string.
      - After `end()`, the `validated` array/Buffers are not referenced by `ActiveRun` (GC).
   7. The rest is unchanged (running state, `wireStreams`, wall clock).
7. **`close` handler**: if `ar.stdinError` is set and no `pendingTerminal` (cancel/ceiling) is set, finalize `status:"failed"` **regardless of exit code**, with `errorMessage = "The claude CLI exited before it received the attached images (" + code + ")."` followed by the redacted stderr tail. Rationale: a CLI that never read the message did not run the user's request, so even exit 0 is not "completed".
8. Text-only runs never create `attachments/`, never set `run.attachments`, and never touch `child.stdin` (it is `null` with `"ignore"`).

### P.5 Consent binding: web ↔ daemon flow

- On dialog open, the web calls `runPreflight({projectId, artifactId})` (unchanged), getting a nonce bound to `EMPTY_ATTACHMENTS_DIGEST`. Text-only behaviour is identical.
- When the attachment set changes and **all chips have finished encoding**, the web calls `runPreflight({projectId, artifactId, attachments: chips.map(c => ({sha256, size, mediaType}))})`, debounced 250 ms, through a new `refreshConsent()`.
  - `refreshConsent()` does **not** reset `result` to `"loading"` (no strip flicker). It keeps the previous checks visible, clears the held nonce, and shows the Execute label "Preparing images…" until the response lands.
  - The response replaces `result` (new checks, nonce, `attachmentsSentence`).
  - A stale response (the attachment set changed again) is discarded by a request counter.
  - Removing all images re-preflights with `attachments` omitted.
- At Execute: send `attachments: chips.map(c => ({name, mediaType, data}))` plus the latest nonce. The daemon recomputes the digest from the **decoded bytes**, so a nonce minted for image set A cannot start a run with set B (AC-8).
- Consent copy, single source in the daemon: `buildAttachmentsSentence(n, total)` = `"<n> image(s) (<X MB>) will be sent to Claude with this run and kept in .symbion/runs/<run>/attachments/ until the run is pruned."`. It is shown under the permission sentence. The storage disclosure is added deliberately, because screenshots can contain secrets (D1).
- The existing catch-path re-preflight in `handleExecute` must pass the **current** attachment metadata. Otherwise it would mint an empty-digest nonce and the retry would fail again.
- Honest limit (same as nonces.ts header): this binds consent to the exact bytes the UI showed. It does not stop a local process that can read HTTP responses, which no mechanism in the tokenless model can.

### P.6 Base64 never reaches disk except the attachment files (AC-5)

| Channel | Guarantee |
|---|---|
| argv / `run.argv` / `invocationEcho` | Stdin mode carries no prompt in argv, and images are never in argv. |
| `run.json` | Metadata only (`RunAttachmentMeta`). A test greps for a sentinel. |
| `events.jsonl` | Without `--replay-user-messages` the CLI doesn't echo the stdin message. Parsed `user` lines keep only `tool_result` parts. Image tool results become `[image]`. `rawTruncated` goes through `redactBase64Runs` (covers an unexpected CLI echo inside an unknown/parse-error line). |
| stderr tail → `errorMessage` | Each stderr line goes through `redactBase64Runs`, then is capped at 2,000 chars. |
| daemon logs | `server.ts`/`handlers.ts` never log params (verified: no `console.*` on the RPC path). Rule for the builder: no logging of `params` and no `err.message` that interpolates `data`. |
| RPC error bodies | Validation messages are index-based and never echo `data`. |
| Web | Base64 lives only in component state until Execute, then is dropped (`chips` cleared on dialog close). It is never placed in `localStorage`/sessionStorage, the run store, or the URL. |

### P.7 CLI version gate (AC-10)

- `MIN_CLI_VERSION_FOR_ATTACHMENTS = "1.0.0"` lives in `cliDriver.ts` (the provider seam owns CLI facts). `cliSupportsAttachments(v) = v !== "unknown" && validateVersion(v) && compareVersions(v, MIN) >= 0`.
  - It **fails closed** on `"unknown"` for attachments only. Text-only runs are unaffected.
- Preflight always returns `attachmentSupport: {supported, minCliVersion, reason?}`. The web disables the attach button, paste and drop when `!supported`, with the reason as an inline hint, so the user learns this **before** attaching.
- When `attachments` is non-empty **and** unsupported, preflight adds a check `{id:"attachments", severity:"block", label:"claude CLI <v> can't receive images (needs ≥ 1.0.0) — remove the images or update the CLI.", action:{kind:"recheck"}}`. The result is `blocked` and no nonce is issued. With no attachments, no row is added, so text-only preflight is unchanged (AC-10 "text-only still starts").
- startRun re-checks (step 4) because preflight is UX, not the boundary.
- Assumption to verify (F5): the floor 1.0.0 is a placeholder. The build-phase spike records the real minimum if it can be found in the CLI changelog. Otherwise 1.0.0 stays: stream-json input has existed since the 1.0 SDK era, and fail-closed applies only to "unknown".

### P.8 UI specifics (binding; no design doc)

**RunDialog composer** (`useAttachmentComposer` + `AttachmentChips`):
- **Placement**: directly under the requirement `<Input>`, a row containing the chips, then a ghost `Button` with `icon={ImagePlus}` labelled "Attach image" (`aria-label="Attach images (PNG, JPEG, GIF, WebP)"`), then a muted counter `"2/5 · 3.4 of 20 MB"`.
  - A hidden `<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple>` is triggered by the button. Its `value` is reset after each pick so the same file can be picked again.
- **Paste** (`onPaste` on the dialog content container, so it covers the requirement input):
  1. Collect `clipboardData.files` plus `items` with `kind==="file"`.
  2. If any files: `preventDefault()` and process them.
  3. Else if any `items[i].type` starts with `image/` (an image type with no file — the WSL2/WSLg case): `preventDefault()` and show the hint "Your clipboard has an image the browser can't read (common on WSL). Drag the file in or use Attach image." (FR-7).
  4. Else do nothing (a text paste falls through untouched).
- **Drag-drop**:
  - When `dataTransfer.types` includes `"Files"`, `onDragEnter`/`onDragOver` on the dialog show a full-dialog overlay "Drop images to attach" (`role="presentation"`, dashed `border-accent`). Leave is tracked with a counter so child elements don't flicker it.
  - `onDrop` processes `dataTransfer.files`.
  - **While the dialog is open**, a `window` `dragover`/`drop` `preventDefault` guard stops a drop outside the overlay from navigating the tab to the file (which would lose all state).
- **Processing pipeline per file** (sequential, async; never blocks typing):
  1. 0 bytes → error "<name>: empty file".
  2. Over the count limit (current + pending ≥ 5) → error "Only 5 images per run".
  3. `size > 5 MiB` → error "<name>: 6.2 MB — the limit is 5 MB per image".
  4. Running total + size > 20 MiB → error "Adding <name> would exceed 20 MB total".
  5. Add a chip with `status:"encoding"` (spinner).
  6. `encodeImageFile` → `sniffImageType` null → remove the chip, error "<name>: not a supported image (PNG, JPEG, GIF, WebP)". This covers `.svg`/`.zip`/spoofed files (AC-2).
  7. Otherwise mark the chip `ready` with `{name, mediaType: sniffed, size, sha256, data, previewUrl}`.
- **Errors** render as a list under the chips, `text-caption text-danger-text`, inside an `aria-live="polite"` region. They are cleared on the next successful add or on a remove. Nothing is ever attached silently or dropped silently.
- **Chip**: a 40×40 `object-cover` thumbnail (`previewUrl`), a `title` tooltip `"<name> · 1.2 MB"`, and an × button (`aria-label="Remove <name>"`). While encoding, a spinner replaces the thumbnail. Removing a chip revokes its object URL. Closing the dialog revokes all.
- **Execute** is enabled iff all of the following hold:
  - `requirement.trim().length > 0` (unchanged: images never make an empty requirement valid; AC-9);
  - no chip is `encoding`;
  - no consent refresh is in flight;
  - nonce present, not blocked, ack satisfied.
  - The label while preparing is "Preparing images…".
- **Invocation echo** in stdin mode: preflight returns `claude -p --input-format stream-json … <<< [2 images + "/cmd <requirement>"]` (a readable echo, not literal shell).
- **"Run again"** (PastRunBanner/RunSummarySection `onRerun` → RunDialog `lastRequirement`): the text only. Chips start empty (D4; nothing in preflight `lastRun` carries attachments).

**Transcript** (`PromptAttachments`):
- Rendered inside `PromptBubble` **only for the root agent** and only when `promptAttachments.items.length > 0`: a row of 64×64 tiles under the text.
- Each tile lazily calls `readRunAttachment`, then builds `new Blob([bytes], {type: meta.mediaType})` and an object URL (cached LRU).
- The `<img alt={name}>` is decorative-safe: the `mediaType` comes from the daemon-verified metadata and is one of the 4 raster types (never SVG), so no script surface.
- Click → `Dialog` lightbox (`max-h-[80vh] object-contain`, name and size caption, Esc closes).
- Errors: `not-found` → a muted tile "Image no longer available" (the run was pruned or the file removed); any other error → "Couldn't load image".
- Thumbnails are **never** built from event data or URLs in CLI output. `Markdown.tsx` is unchanged.

**History/status**: `RunHistoryPopover` rows show `<Image size=12/> 2` when `attachmentCount`. `MissionStatusStrip`/`PastRunBanner` show "· 2 images" when `run.attachments?.length`.

### P.9 fake-claude additions (hermetic QA)

- `FAKE_CLAUDE_VERSION=<v>`: the `--version` output becomes `"<v> (Claude Code)"`. The default stays `2.1.187`. The value `garbage` prints `"garbage"`, so the parse gives `unknown`.
- `FAKE_CLAUDE_STDIN_OUT=<path>`: before streaming, it records `fstatSync(0)`'s kind (`fifo`/`char`/`file`/`other`) and reads stdin **to EOF**. It then writes `{"stdinKind": "...", "stdin": "<all bytes utf-8>"}` to the path. For `"ignore"` stdin (/dev/null, a char device), the read returns `""` immediately. AC-4 asserts `stdinKind==="char"` and `stdin===""`.
- `FAKE_CLAUDE_MODE=exit-no-read`: exits immediately with `FAKE_CLAUDE_EXIT_CODE` (default `0`) without reading stdin. With a payload larger than the pipe buffer (≥ 1 MiB image), the daemon's write gets EPIPE deterministically (AC-11).
- `FAKE_CLAUDE_MODE=stderr-echo-stdin`: reads stdin, writes it to **stderr** in 4 KB lines, then exits 1. This simulates a CLI that dumps its input on error, and is used to prove stderr redaction (AC-5).

### P.10 Flaws and gaps found in the locked scope (corrections; Checker holds the build to these)

- **F1 — AC-3/D3 size units and cap**: as computed in P.3, 20 MB of raw images is ≈ 27.96 MB of base64. "~30 MB" works only if it means **30 MiB**, and all limits are pinned to MiB.
  - The pre-existing `readBody` UTF-8 chunk-split bug becomes real with multi-MB bodies and must be fixed in the same change (P.3).
  - **Recommendation**: accepted as specified, with MiB pinned.
- **F2 — Slash-command expansion with an image-bearing content array is unverified (highest risk).** The scope assumes the CLI resolves `/cmd args` when it is the **last text block** of a stream-json user message with preceding image blocks, and keeps the images in the expanded turn. This matches the VS Code extension's ordering, and (to my understanding) the CLI treats the last text block as the input string and the preceding blocks as attachments, but no code here proves it.
  - **Recommendation**: a mandatory **BUILD P0 spike** (real CLI, ~1 cent) before the UI work:
    1. In a scratch git repo, publish a trivial command `/describe-image` with body "Describe the attached image in one sentence. $ARGUMENTS".
    2. Pipe one NDJSON line (a 1×1 red PNG + text `/describe-image test`) into `claude -p --input-format stream-json --output-format stream-json --verbose --permission-mode plan`.
    3. Assert: (a) the process exits 0 after the `result` once stdin is closed; (b) `init.slash_commands` contains it, and the assistant text refers to the command body (it describes an image/red), not "unknown command"; (c) the session transcript `~/.claude/projects/<cwd-slug>/<session>.jsonl` has the first user turn containing an `image` block.
    4. Record the result in BUILD notes.
  - **If (b) or (c) fails**, stop and return to `/plan`. Do not improvise a fallback, because the fallback (path-in-prompt, Option B) changes the consent/persistence story.
- **F3 — AC-7 is mis-specified.** `[Image could not be processed …]` and `[Image: original WxH…]` are injected by the CLI into the **user** turn it sends to the model. Without `--replay-user-messages` (which we deliberately don't pass, because it would stream the full base64 back through stdout, the line buffer, the parser and SSE), they **never appear on stdout**. They can only reach the UI if the model quotes them in assistant text, which goes through `Markdown.tsx`; there, `[text]` without `(url)` is literal text.
  - **Recommendation**: reword AC-7 to: an assistant text or tool_result containing `[Image could not be processed: …]` renders as literal text, with no link or image element. Note that the user gets no direct "image failed" signal in v1 (accepted; a future option is to replay user messages and parse only the text blocks).
- **F4 — The nonce timing gap in D-scope**: the scope says "nonce fingerprint includes attachment hashes" but the nonce is minted at dialog open, before any image exists. This plan adds a consent refresh (P.5). Without it, every attachment run would fail with `run-consent-required`.
- **F5 — The minimum CLI version is unknown.** `--input-format stream-json` is present on 2.1.187, and the exact introduction version wasn't verifiable offline. The plan uses a 1.0.0 floor and fails closed on `unknown` (P.7). **Recommendation**: accept; the builder records the real floor if the spike or changelog finds it.
- **F6 — AC-11 "EPIPE" is not deterministic for small payloads.** A 1 KB message fits in the pipe buffer, so a CLI that exits without reading produces **no** EPIPE, and with exit 0 the run would show as "completed".
  - The test uses a ≥ 1 MiB image so the write must block and get EPIPE.
  - The residual case (tiny payload, CLI exits 0 without reading) is indistinguishable from a CLI that read it and did nothing. It is accepted as a "completed run with no output", the same as a text-only run where the CLI does nothing.
- **F7 — Retention is count-based (50 runs), not byte-based.** With stored attachments the worst case is 50 × 20 MiB = 1 GiB under `.symbion/runs/`.
  - **Recommendation**: accept for v1. Show the storage disclosure in the consent sentence (P.5), and log a follow-up idea for a byte budget or an "attachments TTL".
- **F8 — Persisting screenshots that may contain secrets (D1)** in a gitignored dir is consistent with `events.jsonl` (transcripts can hold secrets too). The plan adds an explicit disclosure. `/cso` should confirm that `.symbion/runs/.gitignore` (`*`) covers `attachments/` (it does: `*` matches everything below).
- **F9 — Tokenless trust model**: the new read method exposes stored screenshots to anything that can pass the Origin/Host allowlist. That is the same exposure as `getRunEvents` transcripts, so there is no new class of risk **provided it stays on POST `/rpc`** (P.2). A GET image route would weaken it (no Origin on `<img>` requests). This is why the GET route was rejected.
- **F10 — The client MIME is not trusted, but the client mediaType is still required** so a mismatch is reported clearly ("this .png is actually a GIF"). We reject rather than silently relabel, so the user sees why. **Alternative considered**: trusting the sniff and ignoring the client type. Rejected because a silent relabel hides spoofing.
- **F11 — Drag-out-of-overlay navigation** (not in the STATE): a file dropped anywhere else in the page makes Chrome navigate to `file://…`, which loses the run UI. Covered by the window guard (P.8).

### P.11 Data flow

```
[RunDialog]
  paste / drop / pick ──► per-file: size/count pre-check (core limits)
                          └► encodeImageFile: arrayBuffer → sniffImageType (core) → sha256HexBytes (core) → base64 → objectURL preview
  chips ready ──debounce──► RPC runPreflight{projectId, artifactId, attachments:[{sha256,size,mediaType}]}   (reads only)
                             daemon: validate meta → checkCli version → attachmentSupport/check row
                                     → nonce = mint({…, attachmentsDigest}) → attachmentsSentence
  Execute ──► RPC startRun{…, nonce, attachments:[{name,mediaType,data}]}     (body ≤ 30 MiB else 413)
                daemon: decodeAndValidate (base64 strict, magic, limits, sha256) → reserve → consume(nonce, digest)
                        → cliVersion gate → buildArgv(stdin mode)
                        → runManager.start:
                             DISK WRITE  .symbion/runs/<id>/attachments/<n>.<ext>   (confined, wx-temp → fsync → rename)
                             DISK WRITE  .symbion/runs/<id>/run.json                (metadata only)
                             spawn(stdio pipe) → stdin.end(core.buildStreamJsonUserMessage(...)) ; stdin 'error' → stdinError
                stdout NDJSON → parseLine (+redact raw) → DISK APPEND events.jsonl → SSE → web store (unchanged)
                close → finalize (stdinError ⇒ failed) → DISK WRITE run.json → prune (deletes old run dirs incl. attachments/)
[Transcript]
  shownRun.attachments (RunInfo via StartRunResult / SSE state / getRunEvents)
    → PromptBubble(root) tiles → RPC readRunAttachment{projectId, runId, index}   (DISK READ, confined, re-verified)
    → Blob(type = verified mediaType) → objectURL (LRU) → <img>
[History] listRuns → RunListItem.attachmentCount → popover badge
```

Text-only runs keep the path they have today: preflight → startRun → `-p <prompt>` argv, stdin ignored, no `attachments/`.

### P.12 Edge cases → behaviour

| Case | Behaviour |
|---|---|
| Clipboard advertises `image/*` with no file (WSL2) | WSL hint and `preventDefault`; nothing inserted (FR-7) |
| Text-only paste | Default input behaviour; no hint |
| Paste of a file that isn't an image (e.g. a copied `.zip` in a file manager) | Goes through the pipeline → sniff null → "not a supported image" |
| `.svg`, `.zip`, or a `.png` that is really SVG/ZIP | Web sniff rejects. If the web is bypassed, the daemon sniff gives `invalid-params` |
| Client says `image/png`, bytes are GIF | Web: the chip uses the sniffed type (web passes the sniffed type as mediaType). Crafted RPC: `invalid-params` (F10) |
| Malformed or non-canonical base64, `data:` prefix included, whitespace | `invalid-params` (strict regex + round-trip) |
| 0-byte file | Web error "empty file"; daemon `invalid-params` |
| 6th image, file > 5 MiB, total > 20 MiB | Web blocks with a message. Crafted: `invalid-params`. Body > 30 MiB: 413, and the daemon serves the next request |
| Duplicate image added twice | Allowed (2 chips, the same sha), counted twice toward limits; the order is preserved in the digest |
| Image added after preflight / nonce minted | Consent refresh (P.5); Execute disabled until the new nonce |
| Nonce replay with different images | `run-consent-required` (AC-8); the web re-preflights with the current set |
| Remove all images | Re-preflight without attachments → empty digest; the text-only path |
| CLI too old / version unknown | Attach controls disabled with the reason. A crafted call: preflight block or startRun `run-attachments-unsupported`; text-only fine (AC-10) |
| Disk full / EACCES while storing | `attachment-store-failed`; the run dir is removed, the reservation released, nothing spawned |
| CLI exits before reading stdin (EPIPE) | `stdinError` → failed run with a clear message; no unhandled `'error'`; the daemon keeps serving (AC-11) |
| Spawn ENOENT with attachments | Existing `child.on("error")` → failed. The stdin error listener swallows the secondary stream error |
| Cancel / wall-clock / token cap during a stdin write | `pendingTerminal` wins over `stdinError` (the cancel reason is preserved) |
| The CLI echoes the input on stderr or in an unknown event | Redacted (`[base64 omitted: n chars]`) before persistence (AC-5) |
| Daemon disconnect mid-compose | Chips stay in component state. Execute fails with a network `DaemonRpcError`, shown inline. Nothing was written. A retry re-preflights |
| Daemon restarts mid-run | `reconcile` → failed(daemon-restarted); `attachments/` stays with the run, and thumbnails still load |
| Retention prunes a run | The dir including `attachments/` is removed; a later `readRunAttachment` → `not-found`, giving the "no longer available" tile |
| `readRunAttachment` with a bad runId (`../x`, non-uuid), index 7 or -1 or "1.png", a symlinked `attachments/1.png`, or a file swapped on disk (sha mismatch) | `invalid-params` / `not-found` / `path-confinement` / `attachment-corrupt`; never reads outside the run dir |
| Old run.json without `attachments` | Renders exactly as today (optional field); `attachmentCount` absent |
| Run again | Requirement pre-filled, zero chips (AC-9) |
| Requirement empty, images attached | Execute disabled; the daemon still rejects an empty requirement (`invalid-params`) |
| Non-ASCII filename or requirement in a multi-MB body | Decoded once after `Buffer.concat` → intact (P.3 fix) |
| Re-publish / IR / graph | Untouched |

### P.13 Trade-offs and assumptions (for dev / Checker)

- **T1 — Two spawn paths (D5)**: lower regression risk than moving every run to stdin, at the cost of a second path. Mitigated by a deep-equal argv/stdio regression test and a pure `spawnStdioFor`.
- **T2 — Base64 JSON read RPC over a GET route**: ≈ 33% transfer overhead on loopback, in exchange for keeping the single hardened POST `/rpc` boundary (P.2 / F9).
- **T3 — Consent refresh reuses `runPreflight`** (one extra `claude --version` + git status per settled change) instead of a new `bindAttachments` RPC: there is less surface, and the version gate is re-evaluated for free. If the latency is annoying (> 1 s), a follow-up can cache `checkCli` for 30 s.
- **T4 — Re-encoding base64 from the validated bytes** for stdin costs a little CPU, but guarantees that sent = hashed = stored.
- **T5 — Index-addressed reads**: no client-supplied path component exists at all.
- **A1** — The CLI exits after the final `result` once stdin is closed in `-p --input-format stream-json` mode (verified by the F2 spike).
- **A2** — The CLI resolves the slash command from the last text block and keeps the preceding image blocks (F2 spike; a hard stop if false).
- **A3** — `MIN_CLI_VERSION_FOR_ATTACHMENTS = 1.0.0` is a placeholder floor (F5).
- **A4** — The CLI normalizes images itself (resize/recompress, per the reference section). If `sharp` is unavailable in the user's CLI install, oversized images degrade to the CLI's "could not be processed" text (F3), which is acceptable.
- **A5** — `http://127.0.0.1:<port>` is a secure context, but the plan doesn't rely on it (pure `sha256HexBytes`).
- **A6** — The QA journey drives paste and drop with synthetic `ClipboardEvent`/`DragEvent` carrying a constructed `DataTransfer` (Chrome supports both), and drives the picker with chrome-devtools `upload_file`.
- **`/cso` is mandatory**: the RPC body cap, a new disk read RPC, new disk writes, the spawn/stdin path and secrets-at-rest.

---

## BUILD — implementation notes (feature-builder / Maker, 2026-10-20)

> Maker only: nothing below is a review verdict. Not committed, not pushed. The chrome-devtools journey (testplan §4) was NOT run (that is /qa).

### B.1 Spike result (testplan §0) — real CLI 2.1.187, haiku alias, 2 calls total
Scratch repo with `.claude/commands/describe-image.md` (body: "Describe the attached image in one sentence, naming its dominant color. $ARGUMENTS"); input = one NDJSON line, an 8x8 red PNG block then the text block `/describe-image test` (text LAST), piped into `claude -p --input-format stream-json --output-format stream-json --verbose --permission-mode plan --model haiku`.
- **S1 PASS.** (a) exit 0 after a `result` event once stdin closed. (b) `init.slash_commands` contains `describe-image`, and the answer was "The image is a small, solid red rectangle." (the command body was applied, the image was seen). (c) the session JSONL under `~/.claude/projects/` holds a first user turn `<command-name>/describe-image</command-name>…` and a second user turn = `[{type:"image", source:{base64,image/png}}, {type:"text", text:"Describe the attached image… test\n"}]`, i.e. the slash command was EXPANDED and the image was KEPT. (d) stdout contained no base64 (grep of the first 40 base64 chars → 0 hits).
- **S2** (positional prompt `/describe-image positional` + stdin message): no error, exit 0, one answer; the stdin message was used (the answer described the image). The plan's choice to omit the positional prompt stands. Which one "wins" for the text part was not isolated (not worth a 3rd paid call).
- **S3** minimum CLI version for `--input-format stream-json`: NOT determinable offline (no changelog access) → `MIN_CLI_VERSION_FOR_ATTACHMENTS` stays the placeholder `1.0.0` (fails closed on `unknown`).
- **Observation (not in the plan):** with stdin redirected from a REGULAR FILE (`< in.ndjson`, `> out`), the CLI produced no output and exited 0. With a pipe (`cat in | claude …`, which is what Node `stdio:"pipe"` gives) it works. The daemon always uses a pipe, so no impact, but the Checker/QA should not replay the spike with `< file`.

### B.2 Files created
- core: `packages/core/src/run/attachments.ts` (limits, sniff, validateAttachmentSet, digest, sanitize name, stream-json builder, formatBytes, redactBase64Runs), `packages/core/test/run/attachments.test.ts`.
- daemon: `apps/daemon/src/run/attachments.ts` (decode/validate, store, read, preflight-metadata validation), tests `run-attachments.test.ts`, `run-attachments-validation.test.ts`, `server-bodycap.test.ts`, fixtures `attachmentFixtures.ts`.
- web: `lib/run/attachments.ts` (encodeImageFile), `lib/run/attachmentCache.ts`, `components/run/useAttachmentComposer.ts`, `components/run/AttachmentChips.tsx`, `components/run/agents/PromptAttachments.tsx`, `components/run/attachmentTestUtil.ts`, tests `useAttachmentComposer.test.tsx`, `RunDialog.attachments.test.tsx`, `agents/PromptAttachments.test.tsx`, `RunHistoryPopover.test.tsx`, `lib/rpc/client.test.ts`.

### B.3 Files modified
core `index.ts`, `util/sha256.ts` (+`sha256HexBytes`, `sha256Hex` now delegates), `run/events.ts` (+`RunAttachmentMeta`, `RunInfo.attachments?`, `RunListItem.attachmentCount?`), `run/parseStreamJson.ts` (`capRaw` = redact then cap, all 4 RAW sites); `packages/rpc-types/src/index.ts`; daemon `rpc/contract.ts`, `rpc/handlers.ts`, `run/cliDriver.ts`, `run/nonces.ts`, `run/preflight.ts`, `run/runConfig.ts`, `run/runManager.ts`, `run/runStore.ts`, `server.ts`, `test/fixtures/fake-claude.mjs`, `test/runHelpers.ts` (optional `attachments` param + env cleanup only); web `lib/rpc/client.ts`, `lib/run/useRunStore.ts`, `RunDialog.tsx`, `TranscriptBlocks.tsx`, `AgentDetailView.tsx`, `AgentsPanel.tsx`, `RunHistoryPopover.tsx`, `MissionStatusStrip.tsx`, `PastRunBanner.tsx`. No existing test file was edited.

### B.4 Deviations from the plan (with reasons)
1. **`NonceBinding.attachmentsDigest` is OPTIONAL** (defaults to `EMPTY_ATTACHMENTS_DIGEST` in both `mint` and `consume`) instead of required. Reason: the existing unmodified `run-nonce.test.ts` calls `mint({projectId,artifactId,configHash})`; semantics are identical to "required, always passed" (preflight and startRun always pass it explicitly).
2. **Semver:** core `compareVersions/validateVersion` need a `v` prefix, so `cliSupportsAttachments` prepends `v`.
3. **fake-claude `stdinKind` is `socket`, not `fifo`**, for the piped case: Node's `stdio:"pipe"` is a socketpair on Linux. The fixture reports `socket`; DI1 asserts `socket|fifo`. The text-only case is still `char` (/dev/null), asserted exactly (DI7).
4. **DI33 (missing binary + attachments → failed run)** cannot happen as planned: the version probe on a nonexistent binary yields `unknown`, which fails closed → `run-attachments-unsupported` BEFORE spawn. The test asserts a rejection + no uncaught exception instead. The spawn-ENOENT-with-stdin path is therefore covered only by the stdin `error` listener's existence, not by a test.
5. **EPIPE detection is slightly broader than `stdinError`:** the close handler also fails the run when `stdinDone` ('finish' on stdin) never fired, to cover the race where `close` arrives before the `error` event. Exit-0 with a fully-flushed small payload is still "completed" (accepted F6).
6. **Drop overlay events:** dragenter/over/leave/drop are registered on `window` (one hook effect) instead of `onDragEnter` on the dialog; the overlay carries its own React `onDrop`. Reason: the Dialog primitive exposes no event props and the window guard is required anyway (F11). A Files drop outside the overlay is `preventDefault`-ed and ignored (no navigation), as planned.
7. **Overlay token:** `border-mint` (no `accent` colour exists in the design system); `bg-surface` without an opacity modifier because `designSystemGuard` U-G2 forbids it.
8. **Chip errors** are replaced per `addFiles` batch (and cleared on remove) rather than "cleared on next successful add"; every rejection is still visible.
9. **WU7 "no `<img>` inside Markdown"** is covered by the existing Markdown tests (unchanged) plus WU8; no new Markdown test beyond WU8.
10. **Lint:** `apps/web` has no ESLint config (`next lint` prompts for interactive setup), so there is no lint step to run. I did not add one.

### B.5 Deferred / not done
- Testplan §4 journey J1–J12 (for /qa). DI10 is the CI-wide "existing run tests unchanged" check (all pass, none edited).
- The spawn-ENOENT-with-stdin test (see B.4-4). A `readBody`-RSS assertion from DI16 (best-effort in the plan) was not added; DI16 asserts 413 + next ping OK.
- No Codex/other changes; `agentTree`, `transcriptBlocks`, `Markdown.tsx` untouched as planned.

### B.6 Command results (exact)
- `npx vitest run` (root, core+daemon+web): **Test Files 120 passed (120); Tests 1094 passed (1094)**. New tests: core 15, daemon 40 (26 + 8 + 6), web 21.
- Typecheck: `npx tsc --noEmit -p` for `packages/core`, `packages/rpc-types`, `apps/daemon`: clean (0 errors). `apps/web`: 0 errors in non-test sources; the web `tsc` has 62 PRE-EXISTING errors in `*.test.tsx` (jest-dom matcher types `toBeInTheDocument` etc., present before this work). My new web tests add no new ones.
- Lint: not available (see B.4-10).
- `packages/core` and `packages/rpc-types` were rebuilt (`npm run build -w …`, outputs gitignored) so the daemon/web resolve the new exports. `apps/web/tsconfig.tsbuildinfo` (tracked) was touched by `tsc` and reverted with `git checkout`.
- Incident: I ran a `git stash` / `stash pop` once to compare tsc baselines; the pop was blocked by `tsbuildinfo`, I reverted that file and re-popped; the working tree was fully restored (verified `git status`), and the stash I created is gone. Older unrelated stashes (@{0..} now `21ea766`, `e605b83`, …) were not touched.

### B.7 ASSUMPTIONS for the Checker to verify
1. The CLI expands `/cmd` from the LAST text block with preceding image blocks and keeps the images (spike S1, CLI 2.1.187 only; older/newer versions unverified).
2. `MIN_CLI_VERSION_FOR_ATTACHMENTS = 1.0.0` is a placeholder; "unknown" fails closed for attachments only.
3. Piped stdin works (verified); a regular-file stdin does not (B.1) — the daemon never uses it.
4. `child.stdin` 'finish' fires before the CLI exits whenever the CLI actually read the message; a CLI that exits 0 without reading a small (<pipe buffer) payload is reported "completed" (F6 accepted).
5. Node `spawn(stdio:"pipe")` → `stdinKind` is `socket` on Linux; the macOS/Windows value may differ (the fake only affects tests).
6. `readBody` decodes once after `Buffer.concat`; `Content-Length` > cap → 413 without reading; a streamed overrun → 413, `Connection: close`, then `req.destroy()` on response finish. Headroom math: worst body ≈ 28 MB vs 30 MiB.
7. `redactBase64Runs` threshold of 512 chars of `[A-Za-z0-9+/]` is applied to `rawTruncated` (before the cap) and to each stderr line (before the 2,000-char cap). Base64 split by JSON `\/` escapes or whitespace would evade it (the CLI is not expected to emit those).
8. The pure-JS `sha256HexBytes` (used as fallback) and `crypto.subtle` (preferred in the browser) produce the same digest as node `createHash` (tested for the pure path against node in CU13/DI; the subtle path is untested in jsdom, which has no `crypto.subtle`).
9. Reads are POST `/rpc` only; there is NO GET image route (F9). Thumbnails use `blob:` URLs built from the daemon-verified `mediaType` (raster only).
10. The consent nonce digest is computed by the daemon from DECODED bytes in `startRun` (not from client metadata); preflight metadata is only validated for shape/limits.
11. The `attachments` check row is `block` only when images are present AND the CLI is unsupported; text-only preflight output is unchanged except the new always-present `attachmentSupport` field (older web clients ignore it).
12. Text-only runs: argv, `stdio` `["ignore","pipe","pipe"]`, no `attachments` key in run.json, no `attachments/` dir, no `attachmentCount` (tested DI7-DI9). The one intentional behavior change for text-only runs is that stderr lines are now base64-redacted and capped at 2,000 chars.
13. `storeAttachments` failure removes only the fresh run dir (`removeRunDir`, lstat-checked) and the handler's existing catch releases the reservation; the plan's "reservation released" relies on `startRun`'s existing try/catch (DI32 asserts a subsequent run starts).
14. The consent refresh (RunDialog) discards stale responses by a counter and gates Execute on `signature === consentSig`; the catch-path re-preflight in `handleExecute` reuses `loadPreflight`, which passes the current ready-chip metadata.
15. `PromptAttachments` is rendered only for the root agent (`agent.kind === "root"`), fed from `runInfo.attachments` (shownRun), including history mode.
16. jsdom tests dispatch a synthetic `dragenter` with a plain `dataTransfer` object on `window`; real-browser DataTransfer behavior (e.g. `types` as DOMStringList) is for /qa (J2).
17. Not verified: behavior of oversized-but-valid images in the real CLI (resize happens inside the CLI per the reference notes).


---

## REVIEW — independent Checkers (2026-10-20)

**Aggregate verdict: PASS** (code-reviewer PASS, architect PASS). No 🔴 blockers. Full suite re-run by the Checker: 120 files / 1094 tests pass. `tsc --noEmit` clean for core, rpc-types, daemon. Web: only pre-existing `*.test.tsx` jest-dom matcher type errors. The /cso trigger applies (RPC handlers, fs-write, spawn path), so `/cso` is mandatory before ship.

### Maker assumptions (§B.7)
14 of 17 CONFIRMED with code evidence. 3 UNVERIFIABLE by the Checker: #1 (the spike on CLI 2.1.187 only; the paid CLI was not re-run), #16 (real-browser DataTransfer/paste → /qa J2), #17 (CLI-internal image resize). Both reviewers confirmed: no base64 in run.json / events.jsonl / argv / stderr tail; text-only runs byte-identical; generated filenames + wx temp + fsync + rename + lstat symlink refusal on read; magic bytes sniffed in the daemon; nonce digest computed from decoded bytes; `Markdown.tsx` untouched; POST `/rpc`-only reads; stale-preflight race handled; core has no Node imports.

### Carry-over 🟡 (should fix before ship — none blocks /cso or /qa)
1. **CLI version floor** (`cliDriver.ts` `MIN_CLI_VERSION_FOR_ATTACHMENTS = "1.0.0"`): placeholder. A CLI between 1.0.0 and the real introduction of `--input-format` passes the gate and fails at runtime. Raise it to the verified version (2.1.187) or the lowest confirmable one. Both reviewers flagged this; it is the most user-visible item.
2. **stdin `finish` vs `close` ordering** (`runManager.ts` ~L297): a run is failed unless stdin `finish` fired; `close` can in theory precede it. Also accept `child.stdin.writableFinished` (or `writableEnded && !stdinError`) at close time. Add a test where a normal small payload still ends "completed".
3. **Missing test**: spawn-ENOENT with a stdin attachment (deviation DI33; unreachable while unknown version fails closed). Acceptable to defer.
4. **`attachmentCache.ts`** evicts/revokes at 20 entries: a mounted `<img>`/lightbox could lose its blob URL (unlikely: 50 runs × 5 images). Revoke on unmount or refcount.
5. **`redactBase64Runs`** misses `\/`-escaped or whitespace-split base64 and over-redacts any legit 512+ alphanumeric run. Defence in depth; accepted.
6. **`validatePreflightAttachments`** doesn't check `size` is an integer (digest is recomputed from bytes at startRun, so low risk).

### Nits / design notes
- Paste carrying both text and an image (Excel/Word) is `preventDefault`-ed, so the text is lost. Consider letting text through.
- Redacting stderr for text-only runs is a behaviour change (documented in A12). Optionally gate on `run.attachments`.
- Retention is by run count: worst case ≈ 50 × 20 MiB ≈ 1 GiB. Acceptable for v1 with the consent disclosure; follow-up: a byte budget.
- The spike is thin evidence (one CLI version, one tiny PNG, one call; multi-image/large-image untested). Record in `docs/learnings.md`.
- Make `NonceBinding.attachmentsDigest` required once the old nonce test is updated.
- A client-claimed sha mismatch surfaces as a generic `run-consent-required` (correct, terse).

### Still open for /qa
AC-2 drag-drop + picker in a real browser, the WSL2 paste hint, `crypto.subtle` hashing in a real browser, and the J1–J12 journey from the testplan were not run by either reviewer.


## BUILD (fix-up) — REVIEW carry-over (Maker, 2026-10-20)

Items 1-4, 6 and the paste nit from the REVIEW carry-over list. NOT self-reviewed. `/cso` and `/qa` skipped by explicit user choice.

1. **CLI floor** -> `MIN_CLI_VERSION_FOR_ATTACHMENTS = "2.1.187"` (`apps/daemon/src/run/cliDriver.ts`). Messages now state the minimum: `handlers.ts` (run-attachments-unsupported: "Attached images need claude CLI 2.1.187 or newer; installed version is X..."), `preflight.ts` (reason + block-check label: "Images need claude CLI 2.1.187 or newer (installed: X)"). Tests updated: `run-attachments.test.ts` DI26/DI28 (boundary 2.1.187 ok / 2.1.186 unsupported), `RunDialog.attachments.test.tsx`. fake-claude default version was already 2.1.187.
2. **stdin ordering** -> `runManager.ts` close handler: stdin counts as done if `stdinDone || child.stdin?.writableFinished`; stdinError still fails the run. Test DI33b (small payload -> completed, no errorMessage). The actual close-before-finish race cannot be forced deterministically; DI33b + DI1 cover the normal path, DI29/30 (EPIPE) stay green.
3. **Spawn ENOENT test** -> reachable: DI33c uses a shell wrapper that answers `--version` twice (preflight + startRun probe) then deletes itself, so `spawn()` gets ENOENT. Asserts failed, errorMessage /ENOENT/, no uncaughtException. No production code contortion.
4. **attachmentCache** -> refcounted (`acquireAttachmentUrl`/`releaseAttachmentUrl`); eviction skips held entries and re-runs on release; `putCachedAttachmentUrl` replacing a held URL does not revoke it. `PromptAttachments.tsx` Tile acquires while `ready` is mounted (lightbox is a child of the same component, so covered). New `apps/web/src/lib/run/attachmentCache.test.ts`.
5. **Paste** -> `useAttachmentComposer.ts` onPaste: if clipboard has a `text/plain` item (or `getData("text/plain")` non-empty), return early (default text paste, no attach, no preventDefault). Image-only still attaches + preventDefault; WSL no-file hint unchanged. Test added in `useAttachmentComposer.test.tsx`.
6. **validatePreflightAttachments** -> `size` must be a non-negative safe integer (`attachments.ts`). Bad cases -5, 10.5, NaN added to the existing invalid-params test.

Results: `npx vitest run` -> 121 files / 1098 tests pass. `tsc --noEmit` core, rpc-types, daemon: 0 errors. web: only pre-existing `*.test.tsx` jest-dom matcher errors (none in non-test files); `apps/web/tsconfig.tsbuildinfo` reverted via git checkout.

Deferred (accepted, per instruction): base64 redaction regex hardening, byte-budget retention, stderr redaction gating.

### ASSUMPTIONS (for the Checker)
1. 2.1.187 is the lowest CLI version confirmed to accept stream-json image input (spike S1); not re-run with the paid CLI.
2. `stdin.writableFinished` is true by `close` whenever `end()` fully flushed; EPIPE sets stdinError, which still wins.
3. In the mixed-clipboard case, `text/plain` presence is the signal (item kind "string" or getData); a clipboard with only `text/html` + image still attaches the image.
4. Tile unmount releases the hold; the 20-entry cap may be exceeded temporarily while tiles are mounted (bounded by visible tiles).
5. Message wording changes in preflight/handlers have no other consumers (grep'd `needs ≥` / `can't receive`; the composer's generic fallback hint is unchanged).
6. DI33c depends on `/bin/sh` and on startTestRun probing the version exactly twice before spawn (preflight, startRun); a third probe would make it flaky.

---

## REVIEW (fix-up) — quick independent Checkers (2026-10-20)

**Verdict: PASS** (code-reviewer PASS, architect PASS). No 🔴/blockers. Re-run by the Checker: `npx vitest run` 121 files / 1098 tests pass; `tsc` clean for daemon, web only pre-existing `*.test.tsx` jest-dom errors. Scope: only the six fix-ups from `BUILD (fix-up)`.

**User decision:** `/cso` and `/qa` were SKIPPED by the user's explicit choice. The diff still touches RPC handlers / fs-write / spawn path (the CLAUDE.md /cso trigger) and the J1–J12 browser journey has never run (real-browser DataTransfer paste, WSL2 hint, `crypto.subtle` hashing are unverified). `/ship` gates on REVIEW+QA[+CSO], so shipping needs an explicit override.

### Six fix-ups — all OK
1. CLI floor `2.1.187`: single constant (`cliDriver.ts:39`), fail-closed, messages interpolate it, no other hard-coded floor.
2. stdin: run fails if `stdinError` or neither `stdinDone` nor `writableFinished`; EPIPE still wins; an unflushed write is never "completed".
3. DI33c (spawn ENOENT): deterministic, cleans up its scratch dir.
4. Blob-URL refcount cache: StrictMode acquire/release balances, double release is clamped, lightbox is covered by the tile's hold.
5. Mixed text+image paste: early return only when `text/plain` is present; image-only paste, WSL2 hint and drop unchanged.
6. `size` must be a non-negative safe integer.

Maker assumptions 2–6 CONFIRMED; assumption 1 (2.1.187 is the lowest version accepting stream-json image input) UNVERIFIABLE without the paid CLI.

### Remaining items (none blocking)
- 🟡 **Silent drop on mixed paste** (`useAttachmentComposer.ts:~151`): copying an image *file* in Finder/Explorer carries `text/plain` (the filename) plus the file, so it now pastes the filename and attaches nothing, with no hint. Suggest a one-line hint ("Pasted as text; drop the image to attach it") or attach when a `kind==="file"` image item is present and the text is short.
- 🟢 `putCachedAttachmentUrl`: replacing a held entry with a different URL never revokes the old one (needs a refetch while a tile is mounted; unlikely).
- 🟢 Tiny window between a tile's first render and its acquire effect where another `put` could evict its entry (shows a dead blob; no action).
- 🟢 DI33c depends on `/bin/sh` and exactly two version probes before spawn (Unix only; brittle if a third probe is added). Document in the test.

---

## SHIP — close-out (2026-10-20)

**Status: Done.** Committed locally on `feat/run-image-paste` (not pushed).

**Verified:** REVIEW PASS twice (original build; fix-up) by independent `code-reviewer` + `architect`; `npx vitest run` 121 files / 1098 tests pass; `npm run build` clean; real-CLI spike S1 (CLI 2.1.187, image block then `/describe-image test` text block over `--input-format stream-json` stdin, slash command expanded, image kept, no base64 on stdout).

**Explicitly accepted skipped checks (user decision, "skip cso qa"):**
- `/cso` NOT run, although the diff touches daemon RPC handlers (`startRun`, `runPreflight`, new `readRunAttachment`, 30 MiB body cap), filesystem writes (`.symbion/runs/<id>/attachments/`) and the CLI spawn/stdin path. Residual risk: an unreviewed new trust-boundary change. Both general Checkers confirmed path confinement, magic-byte validation, POST-only reads, no base64 persisted, but neither is a security specialist.
- `/qa` NOT run: journey J1–J12 never executed. Unverified in a real browser: Ctrl+V of a real screenshot (DataTransfer), drag-drop overlay + stray-drop navigation guard, file picker, the WSL2 paste hint, `crypto.subtle` hashing, thumbnail/lightbox rendering in the transcript, consent refresh flicker.

**Remaining tech debt:**
- 🟡 Copying an image *file* in Finder/Explorer pastes the filename as text and attaches nothing, with no hint.
- Base64 redaction misses `\/`-escaped or whitespace-split base64 and over-redacts any legit 512+ alphanumeric run.
- Retention is by run count (worst case ≈ 1 GiB); no byte budget.
- CLI version floor 2.1.187 is the only verified version (true minimum unknown).
- DI33c is Unix-only and depends on exactly two version probes; blob-URL cache does not revoke a superseded URL when a held entry is replaced.
- `NonceBinding.attachmentsDigest` is optional (should become required); `apps/web` has no ESLint config.
- Spike covered one tiny image on one CLI version (no multi-image/large-image evidence).
