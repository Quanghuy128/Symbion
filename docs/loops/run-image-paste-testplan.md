# run-image-paste — Test Plan

> Maps to `run-image-paste-STATE.md` `## Acceptance criteria` (AC-1..AC-11) and the `## PLAN — Architecture` section (§P.1–§P.13, flaws F1–F11).
> This plan extends the existing suites and replaces none of them. Every existing `run-*.test.ts`, core `run/*` test and web `components/run/**` test must keep passing **unmodified**. Changing an existing run test is a regression flag. The one allowed exception is adding the optional `attachments` param to `runHelpers.startTestRun`.
> Hermetic only: daemon tests use `SYMBION_CLAUDE_BIN=apps/daemon/test/fixtures/fake-claude.mjs` (`useFakeCli`) and never the real CLI. The one real-CLI step (§0) is a BUILD spike, not part of CI/QA.
> Fixture images are generated in-test as byte arrays (no binary files committed):
> - `PNG_1x1`: a minimal valid PNG of 67 bytes.
> - `GIF_1x1`, `JPEG_TINY` (SOI `FF D8 FF E0` + JFIF + EOI), `WEBP_TINY` (`RIFF....WEBPVP8L` minimal).
> - `PNG_BIG`: the 8-byte PNG signature followed by random bytes up to the target size. It is magic-valid, which is enough for the daemon; the CLI isn't real.
> - `SVG_BYTES` = `<svg xmlns="http://www.w3.org/2000/svg"/>`, `ZIP_BYTES` = `50 4B 03 04 …`.
> - **Sentinel**: every AC-5 test uses `PNG_SENTINEL` = the PNG signature + 600 bytes chosen so its base64 contains the literal run `SYMBIONSENTINEL` repeated (pick bytes by base64-decoding `"iVBORw0KGgo" + "SYMBIONSENTINEL".repeat(40)`, padded to a multiple of 4). Grepping for `SYMBIONSENTINEL` then finds any leak.

## 0. BUILD P0 spike (real CLI, manual, run once by the builder; results go in BUILD notes)

- [ ] **S1** (F2/A1/A2) In a scratch git repo, publish `/describe-image` (body: "Describe the attached image in one sentence. $ARGUMENTS"). Pipe one NDJSON line (1×1 red PNG block + text block `/describe-image test`, text **last**) into `claude -p --input-format stream-json --output-format stream-json --verbose --permission-mode plan`, then close stdin. Assert all of the following:
  - (a) the process exits 0 after a `result` event;
  - (b) `init.slash_commands` includes `describe-image`, and the assistant text describes an image (red/pixel) rather than "unknown command";
  - (c) the session JSONL under `~/.claude/projects/` has the first user turn containing an `image` block;
  - (d) stdout contains **no** base64 (no replay).
- [ ] **S2** Same as S1, but with the positional prompt **also** present. Record the behaviour (error, or which one wins). This confirms the plan's choice to omit the prompt.
- [ ] **S3** Record the oldest CLI version known to support `--input-format stream-json` (changelog). If found, update `MIN_CLI_VERSION_FOR_ATTACHMENTS`; otherwise keep 1.0.0 (F5).
- **Gate**: if S1(b) or S1(c) fails → stop and return to `/plan`.

## 1. Unit — `packages/core` (Vitest)

### 1.1 `sniffImageType` (`src/run/attachments.ts`)
- [ ] **CU1** PNG/JPEG/GIF87a/GIF89a/WebP fixtures → `image/png`, `image/jpeg`, `image/gif`, `image/gif`, `image/webp`.
- [ ] **CU2** `null` for each of:
  - SVG text and SVG with a BOM;
  - ZIP, PDF (`%PDF`), BMP (`BM`), HEIC (`ftypheic`);
  - `RIFF....WAVE` (RIFF but not WEBP);
  - a truncated PNG signature (7 bytes), empty `Uint8Array`, 3 random bytes.
- [ ] **CU3** A PNG signature at offset 1 (leading junk byte) → `null` (anchored at 0).

### 1.2 Limits and set validation
- [ ] **CU4** `RUN_ATTACHMENT_LIMITS` equals `{maxCount:5, maxBytesEach:5242880, maxBytesTotal:20971520, mediaTypes:[png,jpeg,gif,webp]}`. The literal values are pinned, so a change is a deliberate test edit.
- [ ] **CU5** `validateAttachmentSet` returns the following:

  | Input | Result |
  |---|---|
  | 5 items of 1 KB | ok |
  | 6 items | `count` |
  | an item of size 0 | `empty` (index) |
  | 5242881 | `too-large` (index) |
  | 4 × 5242880 + 1 | `total` |
  | `image/svg+xml` | `type` |
  | exactly 4 × 5242880 = 20971520 | ok (boundary inclusive) |

### 1.3 Digest, name, formatting, redaction
- [ ] **CU6** `attachmentsDigest`:
  - deterministic;
  - order-sensitive (`[A,B] ≠ [B,A]`);
  - changes when any of sha256 / size / mediaType changes;
  - `EMPTY_ATTACHMENTS_DIGEST === attachmentsDigest([])`, and it is a 64-hex string.
- [ ] **CU7** `sanitizeAttachmentName`:
  - strips `\u0000`, `\n`, `‮` (RTL override) and `⁦`;
  - collapses whitespace;
  - caps at 120 chars;
  - `""`/non-string → `image-<n>`;
  - `"../../etc/passwd"` is kept as display text: **no path semantics**, and the test documents that it is never used as a path.
- [ ] **CU8** `formatAttachmentBytes`: `0` → `"0 B"`, `1536` → `"1.5 KB"`, `3565158` → `"3.4 MB"`, `20971520` → `"20 MB"`.
- [ ] **CU9** `redactBase64Runs`:
  - a 600-char base64 run → `[base64 omitted: 600 chars]`;
  - a 511-char run is unchanged (threshold);
  - two runs in one string are both redacted;
  - ordinary prose, a 64-hex sha and a uuid are unchanged;
  - idempotent.

### 1.4 `buildStreamJsonUserMessage`
- [ ] **CU10** With 2 images + text, the output:
  - ends with exactly one `\n` and contains no other `\n` (it is a single NDJSON line, even when the text contains newlines, which JSON escapes);
  - `JSON.parse` → `{type:"user", message:{role:"user", content:[img, img, {type:"text", text}]}}`;
  - each image is `{type:"image", source:{type:"base64", media_type, data}}`;
  - the **text block is last**.
- [ ] **CU11** A hostile requirement (`"; rm -rf ~ #`, `"}\n{"type":"user"`, ` `) round-trips verbatim inside the text block, and the line still parses as exactly one object (an injection test, the analog of AC-RUN-6).
- [ ] **CU12** `images: []` → throws.

### 1.5 `sha256HexBytes` and the parser
- [ ] **CU13** `sha256HexBytes(new Uint8Array())` = `e3b0c442…b855`. `sha256HexBytes(utf8("abc"))` = `ba7816bf…15ad`. `sha256Hex(str) === sha256HexBytes(utf8(str))` for 50 seeded random strings, including emoji (refactor is behaviour-preserving).
- [ ] **CU14** `parseLine` of an unknown-type line whose JSON contains a 10 KB base64 string → `rawTruncated` contains `[base64 omitted:` and not the sentinel, and is still ≤ RAW_CAP + marker. Same for a `parse-error` line.
- [ ] **CU15** Regression: all existing `parseStreamJson` tests unchanged. A `user` line with a content array of `[image block, text block]` (a hypothetical replay) → `tool-results` with `parts: []`, and the sentinel is absent from `JSON.stringify(ev)`.

## 2. Daemon integration (Vitest, fake-claude)

Helpers:
- `startTestRun(env, requirement, {attachments})` calls `runPreflight` with metadata from `node:crypto`, then `startRun` with the base64.
- `useFakeCli(mode, {FAKE_CLAUDE_STDIN_OUT, FAKE_CLAUDE_ARGV_OUT, FAKE_CLAUDE_VERSION, …})`.

### 2.1 Happy path and stdin payload (AC-1, AC-6) — `run-attachments.test.ts`
- [ ] **DI1** **AC-1**: start a run with `[PNG_1x1]` and the requirement `fix the header`, then await terminal `completed`. `FAKE_CLAUDE_STDIN_OUT` JSON:
  - `stdinKind === "fifo"`;
  - `stdin` splits into exactly **1** non-empty line;
  - that line parses to `type:"user"` with `content.length === 2`;
  - `content[0]` = `{type:"image", source:{type:"base64", media_type:"image/png", data: base64(PNG_1x1)}}`;
  - `content[1]` = `{type:"text", text: renderRunCommand({command:<name>, requirements:"fix the header"})}`.
- [ ] **DI2** **AC-1 argv** (`FAKE_CLAUDE_ARGV_OUT`) deep-equals `["-p","--input-format","stream-json","--output-format","stream-json","--verbose","--permission-mode",<mode>]` (+ `--allowedTools` when configured). The rendered prompt appears in **no** argv element.
- [ ] **DI3** Order: 3 images (png, webp, gif) → the stdin content order is png, webp, gif, text. `run.json.attachments[i].index === i`.
- [ ] **DI4** **AC-6 storage**: `.symbion/runs/<id>/attachments/` lists exactly `1.png`, `2.webp`, `3.gif` (generated names, ext from the sniffed type even when the client `name` was `screenshot.PNG`). The bytes equal the inputs, and `sha256(file) === run.json.attachments[i].sha256`. `size`, `mediaType` and `file` are correct, and `name` is the sanitized client name. No temp files (`*.symbion-tmp-*`) remain.
- [ ] **DI5** The `run.json` key set for an attachment run = the text-only key set ∪ `{attachments}`. Each attachment has exactly the keys `{index,name,mediaType,size,sha256,file}` (no `data`).
- [ ] **DI6** The StartRunResult `run.attachments`, the SSE state frame and `getRunEvents().run.attachments` all carry the metadata. `listRuns` row `attachmentCount === 3`.

### 2.2 Text-only regression (AC-4) — extend `run-injection.test.ts` / new `run-textonly-regression.test.ts`
- [ ] **DI7** A text-only run with `FAKE_CLAUDE_STDIN_OUT` set: `stdinKind === "char"` (/dev/null) and `stdin === ""`. The argv deep-equals the **hard-coded pre-feature array** `["-p", renderRunCommand(...), "--output-format","stream-json","--verbose","--permission-mode",<mode>]`, copied as a literal into the test, not computed by `buildArgv`.
- [ ] **DI8** Unit `buildArgv({...})` without `inputMode` and with `inputMode:"argv"` → identical to DI7's literal. `spawnStdioFor(false)` deep-equals `["ignore","pipe","pipe"]`, and `spawnStdioFor(true)` deep-equals `["pipe","pipe","pipe"]`.
- [ ] **DI9** A text-only run: no `attachments/` dir, `run.json` has **no** `attachments` key (`"attachments" in run === false`), and `listRuns` has no `attachmentCount`. `startRun` with `attachments: []` behaves identically to omitted.
- [ ] **DI10** All existing `run-*.test.ts` pass unchanged (CI check).

### 2.3 Validation and limits (AC-3, AC-2 daemon side) — `run-attachments-validation.test.ts`
Each case: `startRun` rejects `RpcError("invalid-params")`; **no** run dir is created; `reserve` is not held afterwards (a following valid text-only run starts); the message contains the item index and does not contain the `data` string.
- [ ] **DI11** 6 attachments; one of 5 MiB + 1 byte; 5 × 4.5 MiB (total > 20 MiB); a 0-byte item (`data:""`).
- [ ] **DI12** SVG bytes labelled `image/png`; ZIP bytes labelled `image/png`; PNG bytes labelled `image/gif` (mismatch); `mediaType:"image/svg+xml"`; `mediaType:"application/pdf"`.
- [ ] **DI13** Bad base64: `"%%%"`, `"abc"` (length % 4 ≠ 0), `"data:image/png;base64,iVBOR…"`, a base64 string with embedded `\n`, non-canonical padding (`"iVBORw0KGgp="`), `data` a number, `attachments` an object, an item missing `name` (→ ok, defaulted) vs an item `null` (→ invalid).
- [ ] **DI14** `runPreflight` param validation: `attachments` with a bad sha (63 chars or uppercase), size 0, size 5242881, 6 items, mediaType `image/bmp` → `invalid-params`. Valid metadata → returns a nonce plus an `attachmentsSentence` mentioning "2 images" and "MB" and ".symbion/runs".

### 2.4 Body cap (AC-3 transport) — extend `server.integration.test.ts`
- [ ] **DI15** A raw `http.request` POST `/rpc` with allowed Host/Origin and `Content-Length: 31457281` → **413** `{error:{code:"payload-too-large"}}` without sending the body. Then a `ping` on a new connection → 200.
- [ ] **DI16** A chunked body (no Content-Length) streaming 31 MiB + 1 → 413. The socket closes, daemon RSS doesn't grow beyond about the cap (assert `process.memoryUsage().rss` delta < 100 MB, best-effort), and the next `ping` → 200.
- [ ] **DI17** A legitimate body of ≈ 28 MB (4 × 5 MiB images, a 10,000-char Vietnamese/emoji requirement, a non-ASCII filename `ảnh chụp màn hình.png`) → accepted. The persisted `run.json.requirement` equals the input exactly and the `name` is intact. This guards the UTF-8 chunk-split fix: before the fix, the test must fail at least once with a forced boundary. Add a unit test of `readBody` feeding `Buffer.from("ả")` split into 2 chunks → `"ả"`.
- [ ] **DI18** Body exactly at `MAX_RPC_BODY_BYTES` → not 413 (boundary inclusive). The JSON may be invalid, which gives a 400 `bad-json`, and that is fine.

### 2.5 No base64 leaks (AC-5) — `run-attachments-noleak.test.ts`
- [ ] **DI19** Run with `PNG_SENTINEL` (default fixture). Assert `SYMBIONSENTINEL` is **absent** from:
  - `run.json`, `events.jsonl`, the argv capture;
  - every file under `.symbion/` except `attachments/1.png` (recursive walk);
  - all `console.log/warn/error` calls captured with `vi.spyOn` during the test;
  - the RPC error messages from DI11–DI13 when the sentinel is in `data`.
- [ ] **DI20** `FAKE_CLAUDE_MODE=stderr-echo-stdin` with `PNG_SENTINEL` → the run is failed, `run.json.errorMessage` contains `[base64 omitted:` and not the sentinel, and each stderr-derived line is ≤ 2,000 chars.
- [ ] **DI21** A fixture with an unknown event `{"type":"debug_echo","payload":"<base64 of PNG_SENTINEL ×20>"}` → the `events.jsonl` line's `rawTruncated` is redacted, with no sentinel.

### 2.6 Consent binding (AC-8) — extend `run-nonce.test.ts`
- [ ] **DI22** A nonce from preflight with metadata of `[A]` + startRun with `[B]` → `run-consent-required`, and no spawn (the argv file is not created). Re-using the same nonce with `[A]` → still rejected (burned).
- [ ] **DI23** A nonce from preflight with **no** attachments + startRun with `[A]` → `run-consent-required`. A nonce from preflight with `[A]` + text-only startRun → `run-consent-required`.
- [ ] **DI24** Order matters: preflight `[A,B]`, start `[B,A]` → rejected. Same bytes with claimed metadata size off by one at preflight → rejected.
- [ ] **DI25** Regression: the existing text-only nonce tests pass unchanged (empty digest on both sides).

### 2.7 Version gate (AC-10) — `run-attachments-version.test.ts`
- [ ] **DI26** `FAKE_CLAUDE_VERSION=0.2.9`:
  - `runPreflight` without attachments → not blocked, nonce present, `attachmentSupport.supported === false`, and `reason` mentions 1.0.0. A text-only `startRun` → completes.
- [ ] **DI27** `FAKE_CLAUDE_VERSION=0.2.9`, with attachments:
  - `runPreflight` with attachment metadata → `blocked`, a check `{id:"attachments", severity:"block"}`, and no nonce.
  - A crafted `startRun` with a valid nonce (minted from a text-only preflight is impossible because the digest differs, so mint it under `FAKE_CLAUDE_VERSION=2.1.187`, then flip the env before startRun) → `run-attachments-unsupported`. The reservation is released and no run dir exists.
- [ ] **DI28** `FAKE_CLAUDE_VERSION=garbage` (parse gives unknown) → attachments unsupported (fail closed), and text-only runs are fine. `FAKE_CLAUDE_VERSION=1.0.0` → supported (boundary).

### 2.8 EPIPE / failure paths (AC-11) — `run-attachments-epipe.test.ts`
- [ ] **DI29** `FAKE_CLAUDE_MODE=exit-no-read`, `FAKE_CLAUDE_EXIT_CODE=0`, attachment `PNG_BIG` of 4 MiB → the terminal status is `failed`, and `errorMessage` mentions "exited before it received the attached images". There is no `uncaughtException`: register a `process.on("uncaughtException")` spy and assert it was not called. The next `ping`/`listRuns` succeeds, and a following text-only run in the same project starts (the lock was released).
- [ ] **DI30** Same with `FAKE_CLAUDE_EXIT_CODE=1` → failed. `exitCode === 1`.
- [ ] **DI31** Cancel during a stdin write (`FAKE_CLAUDE_MODE=hang` that never reads, 4 MiB image) → `cancelRun` → terminal `cancelled` (the pending reason wins over stdinError).
- [ ] **DI32** Store failure: make `.symbion/runs/` read-only (chmod 0555; skip on root) → `startRun` with an attachment → `attachment-store-failed`. No partial run dir and no spawn. After restoring permissions, the next run starts.
- [ ] **DI33** `SYMBION_CLAUDE_BIN=/nonexistent` with an attachment → failed run (ENOENT) and no unhandled stdin error.

### 2.9 Read RPC and retention (AC-6, AC-7 daemon side) — `run-attachments-read.test.ts`
- [ ] **DI34** `readRunAttachment({projectId, runId, index:0})` → `{mediaType:"image/png", size, data}`, where `data` decodes to the exact bytes.
- [ ] **DI35** Rejections:

  | Input | Result |
  |---|---|
  | `runId:"../../etc"`, `runId:"not-a-uuid"` | `invalid-params` |
  | `index: 5`, `-1`, `1.5`, `"0"`, `"1.png"` | `invalid-params` |
  | `index` beyond `attachments.length`, or a run without attachments | `not-found` |
  | an unknown uuid run | `not-found` |
  | `run.json.attachments[0].file` hand-edited to `"../run.json"` or `"/etc/passwd"` | rejected by the file regex (`attachment-corrupt` or `path-confinement`), with no read outside |
  | `attachments/1.png` replaced by a symlink to `/etc/hostname` | `path-confinement` |
  | `attachments/1.png` overwritten with other PNG bytes | `attachment-corrupt` (sha mismatch) |
- [ ] **DI36** **AC-6 retention**: create 3 attachment runs, then call `prune(root, 1)` (or 51 runs with the default keep). The pruned runs' dirs, including `attachments/`, are gone, and `readRunAttachment` on them → `not-found`. The kept run's attachments are intact. A **live** run's attachments are never pruned (reuse the liveRunIds pattern).
- [ ] **DI37** Restart mid-run: start an attachment run with `FAKE_CLAUDE_MODE=hang`, simulate a restart (new RunManager / `reconcile` with an empty live set) → the run is `failed(daemon-restarted)`, `attachments/` still exists, and `readRunAttachment` works.
- [ ] **DI38** Run again (AC-9 daemon side): after an attachment run, `runPreflight().lastRun.requirement` equals the text, and `lastRun` has no attachment fields.

## 3. Web unit (Vitest + Testing Library, jsdom)

- [ ] **WU1** `useAttachmentComposer`:
  - adding a PNG `File` → chip `encoding` → `ready` with the correct sha256 (vs core) and base64;
  - an SVG `File` named `x.png` with type `image/png` → no chip, error "not a supported image";
  - a 0-byte file → "empty file";
  - a 6th file → "Only 5 images per run";
  - a file of 5 MiB + 1 → per-image limit message;
  - a total over 20 MiB → total message.
  - Errors are rendered in an `aria-live` region.
- [ ] **WU2** Paste handler:
  - files present → `preventDefault` called and chips added;
  - `items` with `type:"image/png"` but `getAsFile()` → null and no files → WSL hint shown, `preventDefault` called, no chip;
  - text-only clipboard → `preventDefault` **not** called.
- [ ] **WU3** RunDialog Execute gating:
  - disabled while any chip is encoding;
  - disabled while the consent refresh is pending;
  - disabled with an empty requirement even with ready chips (AC-9);
  - enabled once the refreshed nonce lands.
  - `startRun` is called with `attachments:[{name, mediaType, data}]` and the **refreshed** nonce.
  - The preflight mock is called a second time with `attachments:[{sha256,size,mediaType}]`.
- [ ] **WU4** Removing a chip revokes its object URL (`URL.revokeObjectURL` spy) and triggers a re-preflight. Removing all → re-preflight **without** `attachments`.
- [ ] **WU5** `attachmentSupport.supported=false` → the attach button is disabled, the reason hint is shown, and paste/drop are ignored with the hint.
- [ ] **WU6** RunDialog with `lastRequirement="x"` → the input is pre-filled and there are zero chips (AC-9).
- [ ] **WU7** `PromptAttachments`:
  - root `PromptBubble` with 2 metas → 2 tiles. `readRunAttachment` is mocked and called with `{projectId, runId, index}`. `<img src>` starts with `blob:`.
  - `not-found` → "Image no longer available".
  - A non-root agent's prompt bubble renders no tiles.
  - No `<img>` appears anywhere inside `Markdown` output (existing Markdown tests unchanged).
- [ ] **WU8** AC-7 (reworded, F3): an assistant text block `[Image could not be processed: unsupported]` rendered through `Markdown` → the literal text is present, with no `<a>` or `<img>` element.
- [ ] **WU9** `callRpc` with a 413 response → `DaemonRpcError` code `payload-too-large` and a friendly message. A fetch body whose `res.json()` throws → code `network`, not a raw SyntaxError.
- [ ] **WU10** RunHistoryPopover: a row with `attachmentCount: 2` shows the image icon and `2`. A row without it shows no badge.

## 4. Web journey (chrome-devtools; the orchestrating thread runs it in `/qa`)

**Setup**:
1. Build the web static export, then start the compiled daemon with `SYMBION_CLAUDE_BIN=apps/daemon/test/fixtures/fake-claude.mjs FAKE_CLAUDE_FIXTURE=apps/daemon/test/fixtures/fixture-simple.ndjson FAKE_CLAUDE_DELAY_MS=40 FAKE_CLAUDE_STDIN_OUT=<scratch>/stdin.json FAKE_CLAUDE_ARGV_OUT=<scratch>/argv.json`.
2. Open the daemon URL and use a scratch project with a published command.
3. Prepare test files in a scratch dir: `shot.png` (real screenshot ~200 KB), `pic.webp`, `anim.gif`, `big.png` (6 MB), `logo.svg`, `bundle.zip`, `fake.png` (SVG content renamed).

- [ ] **J1 (AC-1 paste)**
  - Open the Run dialog → type the requirement `fix header`.
  - Run `evaluate_script`: fetch `shot.png` bytes (or build them from a canvas `toBlob('image/png')`), build `dt = new DataTransfer(); dt.items.add(new File([blob],'shot.png',{type:'image/png'}))`, then dispatch `new ClipboardEvent('paste',{clipboardData: dt, bubbles:true})` on the requirement input.
  - Expect one chip with a thumbnail, a tooltip `shot.png · …`, and the counter `1/5`.
  - The requirement input text is unchanged (no filename inserted).
  - Execute shows "Preparing images…" briefly, then becomes enabled.
  - Click Execute and await completion. Then read `stdin.json` (via shell): exactly one NDJSON line, one `image/png` block whose base64 equals `shot.png`, and the text `/<cmd> fix header` last. `argv.json` contains `--input-format`, `stream-json` and no prompt.
- [ ] **J2 (AC-2 drop + picker)**
  - Dispatch `dragenter`/`dragover` with a `DataTransfer` of type Files → the "Drop images to attach" overlay is visible (screenshot).
  - Dispatch `drop` with `pic.webp` → a chip.
  - Use `upload_file` on the hidden file input with `anim.gif` → a chip.
  - Drop `logo.svg`, `bundle.zip` and `fake.png` → three "not a supported image" messages and no new chips.
  - Drop a file onto the dialog backdrop **outside** the overlay → the page does not navigate (URL unchanged).
- [ ] **J3 (AC-2 limits)**
  - With 3 chips, pick `big.png` → per-image limit message.
  - Add images until 5 → a 6th → "Only 5 images per run".
  - Drive the total over 20 MB with 5 × 4.5 MB files → total message.
  - The Execute state stays consistent.
- [ ] **J4 (AC-8 remove / encoding)**
  - Remove a chip with the × → the chip is gone and the counter decrements.
  - Use `evaluate_script` to add a 4.9 MB image and immediately read the Execute button `disabled` → true while encoding.
  - Remove all chips → Execute is enabled for text-only, and the invocation echo returns to the `-p "<prompt>"` form.
- [ ] **J5 (AC-7 / D6 transcript thumbnail)**
  - After J1's run, open the Agents panel → root transcript.
  - The opening prompt bubble shows the `shot.png` thumbnail. `list_network_requests` shows a POST `/rpc` `readRunAttachment` and **no** GET for image URLs.
  - Click → the lightbox shows the full image; Esc closes it.
  - Open a subagent's transcript (fixture-agents-synthetic) → no thumbnails there.
- [ ] **J6 (AC-7 history)**
  - Open the run history popover → the J1 run shows the image badge `1`, and a text-only run shows none.
  - Open the past run → PastRunBanner shows "· 1 image", and the thumbnail loads from the stored copy.
- [ ] **J7 (AC-9 run again)**
  - Click "Run again" on the J1 run → the requirement is pre-filled `fix header`, with zero chips.
  - Clear the requirement with a chip attached → Execute disabled.
- [ ] **J8 (AC-10 old CLI)**
  - Restart the daemon with `FAKE_CLAUDE_VERSION=0.2.9` and open the Run dialog.
  - The attach button is disabled with the "needs ≥ 1.0.0" hint, and a paste shows the hint with no chip.
  - A text-only Execute starts and completes.
- [ ] **J9 (AC-11 EPIPE)**
  - Restart with `FAKE_CLAUDE_MODE=exit-no-read` and attach a 4 MB image → Execute.
  - The run ends `failed` with the "exited before it received the attached images" message.
  - The UI stays usable, and a second run (mode reset) starts without a daemon restart.
- [ ] **J10 (AC-5 spot check)**
  - After J1–J9, `grep -r` the sentinel or the first 64 chars of `shot.png`'s base64 across `.symbion/runs/*/run.json`, `events.jsonl`, the argv capture and the daemon terminal log → no hits.
  - `ls .symbion/runs/<id>/attachments` → `1.png` only.
- [ ] **J11 (WSL2 hint, FR-7)** `evaluate_script` dispatches a paste whose `DataTransfer` has `setData('image/png','')`-style types but no files (or stub `clipboardData.items` with `getAsFile: () => null`) → the hint text is visible and the requirement input is unchanged.
- [ ] **J12 (a11y)**
  - Tab to "Attach image" → Enter opens the picker (verify via `take_snapshot` focus).
  - Each chip remove button has an accessible name `Remove <name>`.
  - The error region is `aria-live`.

## 5. AC → test map

| AC | Core unit | Daemon integration | Web unit | Journey |
|---|---|---|---|---|
| AC-1 | CU10, CU11 | DI1, DI2, DI3 | WU3 | J1 |
| AC-2 | CU1–CU3, CU5 | DI11, DI12 | WU1 | J2, J3 |
| AC-3 | CU5 | DI11–DI18 | WU9 | J3 |
| AC-4 | — | DI7–DI10 | — | J4 (echo back to argv form) |
| AC-5 | CU9, CU14, CU15 | DI19–DI21 | — | J10 |
| AC-6 | — | DI4, DI5, DI36 | — | J10 |
| AC-7 (thumb + history + read confinement; F3 reworded) | — | DI34, DI35 | WU7, WU8, WU10 | J5, J6 |
| AC-8 (nonce ↔ hashes) | CU6 | DI22–DI25 | WU3, WU4 | J4 (remove → re-preflight) |
| AC-9 | — | DI38 | WU3, WU6 | J7 |
| AC-10 | — | DI26–DI28 | WU5 | J8 |
| AC-11 | — | DI29–DI33 | — | J9 |

## 6. Exit criteria for `/qa`
- §1–§3 are green in CI (`npm test` at the root), and the existing suites are unchanged.
- J1–J12 are executed with screenshots for J1, J2 (overlay), J5 (thumbnail + lightbox), J8 and J9.
- The §0 spike results are recorded in BUILD notes. Gate: S1(b) and S1(c) passed.
- `/cso` PASS recorded in STATE before `/ship`.
