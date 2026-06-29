# load-existing-workflows — Design

**Reads:** `docs/loops/load-existing-workflows-STATE.md` (locked THINK decisions §9), `apps/web/src/components/CreateProjectDialog.tsx`, `apps/web/src/components/ImportDialog.tsx`, `apps/web/src/components/EmptyState.tsx`, `apps/web/src/components/AppShell.tsx`, `apps/web/src/components/ui/dialog.tsx`, `packages/rpc-types/src/index.ts`.

Locked-in from STATE §9 (not re-litigated here): Q1 no marker-writing on import
(draft-only, unchanged); Q2 detection = `.claude/` + `AGENTS.md` only, no
`.github`; Q3 `CreateProjectDialog` is the single universal entry point and
absorbs `ImportDialog`'s scan-and-checkbox-review screen as a post-confirm
sub-step (`ImportDialog` itself stays alive as its own standalone entry point
for EC-5 re-import-later, unchanged by this loop); Q4 no remembered-decline
state, re-prompt every path-entry attempt; Q5 `AGENTS.md` is named but not
importable in this loop.

---

## 1. User Journey

**Happy path — confirm/import:**

1. User clicks "+ Tạo dự án" (from `EmptyState` or `ProjectSidebar`) → `CreateProjectDialog` opens. This is unchanged — still the single trigger, still the same modal shell.
2. User types or picks (`Chọn…` → `FolderBrowserDialog`) a path. Today's debounced `validatePath` call still fires on every keystroke (200ms), unchanged.
3. The moment `validatePath` resolves with `exists && isDir && (hasClaudeDir || hasAgentsMd)` AND the path is **not** already a Symbion project (EC-4 guard — see §9 below), the passive one-line hint that exists today is replaced by a **detection panel** inline in the dialog body (not a second stacked modal — see Interaction Notes for why inline-in-place, not modal-on-modal). It names what was found: ".claude/" and/or "AGENTS.md".
4. User clicks **"Có, nhập vào"** (primary action inside the detection panel). The dialog's main body swaps to a **loading state** while `scanClaudeDir` runs against that path.
5. On scan completion, the dialog body swaps again to the **review screen** — the same checkbox list, agents/commands counts, and skipped-files-with-reasons that `ImportDialog` already renders today, now embedded as a sub-step inside `CreateProjectDialog` rather than a separate dialog the user had to have pre-selected.
6. User reviews the checkboxes (all parseable items checked by default, skipped items never selectable, same as today), optionally names the project (or it defaults from the path's last segment, matching `ImportDialog`'s existing fallback), and clicks **"Nhập N mục đã chọn"**.
7. `createProject` runs (creates the new project + store), immediately followed by `importArtifacts` with the selected ids. Dialog closes on success; the new project opens in the main view exactly as a normal create does today.
8. If `AGENTS.md` was also detected, step 3's panel and step 5's review screen both show an informational-only line naming it as detected but not yet importable — no checkbox, no action tied to it.

**Decline path:**

1. Steps 1-3 identical.
2. User clicks **"Không, tạo trống"** (secondary action in the detection panel, sitting right next to the confirm action — not hidden, not requiring a second click-through).
3. Dialog body reverts to the ordinary create-project layout (name + path fields, no detection panel, no review step) with the **same "Tạo dự án" button that exists today**, now enabled exactly as it always was. User clicks it, `createProject` runs as it does today, dialog closes. The existing `.claude/`/`AGENTS.md` files are never read past the initial `validatePath` boolean check — completely untouched.
4. (Per Q4) If the user backs out and re-enters the same path again later in a fresh dialog open, the detection panel reappears — nothing is remembered.

**AGENTS.md-only path (Q5):**

1. Steps 1-2 identical, but `hasClaudeDir === false`, `hasAgentsMd === true`.
2. Detection panel still appears (Codex content was found), but its only action is **"Tạo dự án trống"** — there is no "import" action available for this case since there's no `AGENTS.md` → IR parser yet. Copy explains import isn't available for this format yet.
3. User proceeds with an ordinary empty-project create; `AGENTS.md` is left untouched, same guarantee as the decline path.

---

## 2. Screen Inventory

| # | Screen / state | Lives in | Entry trigger | Exit path |
|---|---|---|---|---|
| S1 | **CreateProjectDialog — base form** (unchanged skeleton: name + path fields, validation hint, Hủy/Tạo footer) | `CreateProjectDialog` | "+ Tạo dự án" click (`EmptyState` or `ProjectSidebar`) | Tạo dự án → create; Hủy → close; OR path resolves to detection → swaps to S2 |
| S2 | **Detection panel** (new) — inline sub-state inside `CreateProjectDialog`'s body, replacing the passive hint line | `CreateProjectDialog` (new sub-component) | `validatePath` returns `hasClaudeDir \|\| hasAgentsMd` for a non-Symbion-project path | Confirm → S3 (loading) then S4 (review); Decline → back to S1's plain footer/button; path edited away from a detected dir → reverts to S1 automatically |
| S3 | **Scanning / loading state** (new, transient) — body area shows a scan-in-progress indicator | `CreateProjectDialog` (new sub-component) | User clicks "Có, nhập vào" in S2 | Auto-advances to S4 on `scanClaudeDir` success; on RPC error, falls back to an inline error + offers retry or decline |
| S4 | **Review-with-checkboxes screen** (reused layout from `ImportDialog`, relocated) — agents/commands counts, skipped list, checkbox list, project-name field | `CreateProjectDialog` (embeds extracted `ImportReviewStep`) | Auto-shown after S3 completes | "Nhập N mục đã chọn" → runs createProject+importArtifacts → closes dialog; "Hủy"/back → returns to S2 (re-offer confirm/decline) without re-scanning if scan result is cached, or fully closes dialog per Interaction Notes |
| S5 | **Already-a-project guard** (existing, unchanged) — today's `already-a-project` error path | `CreateProjectDialog` | path resolves to a dir containing `.symbion/store.json` | Existing behavior, not modified by this loop — explicitly never shows S2 |
| (ref) | `ImportDialog` (existing, unchanged entry point) | `ImportDialog` | "↧ Import .claude/ có sẵn" (`EmptyState`) | Unchanged by this loop; continues to exist standalone for EC-5 |

---

## 3. ASCII Wireframes

### (a) Path entered, `.claude/` detected, before any choice — i.e. the instant *before* S2 renders (for reference: today's passive hint, shown so the diff to (b) is clear)

```
┌────────────────────────────────────────────┐
│ Tạo dự án mới                          [×] │
├────────────────────────────────────────────┤
│ Tên dự án                                  │
│ ( My API Service                         )  │
│                                              │
│ Đường dẫn repo                              │
│ ( /home/me/code/geochat        ) [ Chọn… ]  │
│ ✓ Thư mục tồn tại · .claude/ đã có          │   ← today: just text, easy to miss
│   (xem xét Import)                          │
│                                              │
├────────────────────────────────────────────┤
│                          [ Hủy ] [ Tạo dự án]│
└────────────────────────────────────────────┘
```

### (b) NEW — "existing workflow detected" prompt (S2), replacing the passive hint

```
┌────────────────────────────────────────────┐
│ Tạo dự án mới                          [×] │
├────────────────────────────────────────────┤
│ Tên dự án                                  │
│ ( My API Service                         )  │
│                                              │
│ Đường dẫn repo                              │
│ ( /home/me/code/geochat        ) [ Chọn… ]  │
│                                              │
│ ┌──────────────────────────────────────────┐│
│ │ ⚠ Đã phát hiện workflow có sẵn           ││
│ │                                          ││
│ │   Tìm thấy: .claude/                    ││
│ │                                          ││
│ │   Bạn có muốn nhập (import) các agent/  ││
│ │   command đã có vào dự án này không?    ││
│ │   File gốc trong repo sẽ KHÔNG bị        ││
│ │   chỉnh sửa.                            ││
│ │                                          ││
│ │        [ Không, tạo trống ] [ Có, nhập vào ]│
│ └──────────────────────────────────────────┘│
├────────────────────────────────────────────┤
│                          [ Hủy ]            │   ← "Tạo dự án" footer button is
└────────────────────────────────────────────┘     hidden while panel decision is open
                                                    (see Interaction Notes)
```

### (c) Confirmed → review-with-checkboxes (S4), reusing ImportDialog's existing layout, now embedded

```
┌────────────────────────────────────────────┐
│ Tạo dự án mới — Xem lại trước khi nhập [×] │
├────────────────────────────────────────────┤
│ Tên dự án                                  │
│ ( geochat                               )  │   ← prefilled from path's last segment
│                                              │
│ ✓ 4 agents                                  │
│ ✓ 6 commands                                │
│ ⚠ .claude/agents/old-draft.md không parse  │
│   được → bỏ qua (invalid frontmatter)       │
│ ⚠ .claude/commands/wip.md không parse      │
│   được → bỏ qua (missing name field)        │
│                                              │
│ ┌──────────────────────────────────────────┐│
│ │ [x] ba                                  ││
│ │ [x] code-reviewer                       ││
│ │ [x] security-reviewer                   ││
│ │ [x] architect                           ││
│ │ [x] /analyze                            ││
│ │ [x] /design                             ││
│ │ [x] /plan                               ││
│ │ [x] /build                              ││
│ │ [x] /review                             ││
│ │ [x] /qa                                 ││
│ │  (skipped items not listed/selectable)  ││
│ └──────────────────────────────────────────┘│
├────────────────────────────────────────────┤
│            [ Quay lại ] [ Nhập 10 mục đã chọn]│
└────────────────────────────────────────────┘
```

### (d) Declined → falls through to ordinary CreateProjectDialog create button (S1, unchanged)

```
┌────────────────────────────────────────────┐
│ Tạo dự án mới                          [×] │
├────────────────────────────────────────────┤
│ Tên dự án                                  │
│ ( My API Service                         )  │
│                                              │
│ Đường dẫn repo                              │
│ ( /home/me/code/geochat        ) [ Chọn… ]  │
│ ✓ Thư mục tồn tại · .claude/ đã có          │   ← detection hint stays visible as
│   (đã chọn tạo dự án trống)                 │     plain text — confirms decline,
│                                              │     not a silent revert
├────────────────────────────────────────────┤
│                          [ Hủy ] [ Tạo dự án]│   ← back to fully today's button,
└────────────────────────────────────────────┘     enabled, single click → done
```

### (e) AGENTS.md-only informational case (Q5)

```
┌────────────────────────────────────────────┐
│ Tạo dự án mới                          [×] │
├────────────────────────────────────────────┤
│ Tên dự án                                  │
│ ( My Codex Project                       )  │
│                                              │
│ Đường dẫn repo                              │
│ ( /home/me/code/codex-svc      ) [ Chọn… ]  │
│                                              │
│ ┌──────────────────────────────────────────┐│
│ │ ⚠ Đã phát hiện workflow có sẵn           ││
│ │                                          ││
│ │   Tìm thấy: AGENTS.md (Codex)            ││
│ │                                          ││
│ │   Symbion chưa hỗ trợ nhập (import) từ  ││
│ │   AGENTS.md ở phiên bản này. File này    ││
│ │   sẽ không bị ảnh hưởng.                ││
│ │                                          ││
│ │                    [ Đã hiểu, tạo trống ]││
│ └──────────────────────────────────────────┘│
├────────────────────────────────────────────┤
│                          [ Hủy ]            │
└────────────────────────────────────────────┘
```

If both `.claude/` AND `AGENTS.md` are detected together, wireframe (b)'s
panel gets a second line: `Tìm thấy: .claude/, AGENTS.md (Codex — chỉ hiển
thị, chưa hỗ trợ nhập)` — same two action buttons as (b); the AGENTS.md
mention is purely informational text, it does not gain its own checkbox or
button.

---

## 4. Component Breakdown

**New components:**

- `WorkflowDetectionPanel` (new, lives in `apps/web/src/components/`) — renders S2/(e)'s panel. Props: `{ hasClaudeDir: boolean; hasAgentsMd: boolean; onConfirm: () => void; onDecline: () => void; importAvailable: boolean }` (`importAvailable = hasClaudeDir`; when `false` — i.e. AGENTS.md-only — only one button renders, copy switches to the Q5 informational variant). No internal state; pure presentational + two callbacks.
- `ImportScanningState` (new, tiny) — just a loading row/spinner + "Đang quét .claude/…" text, shown during S3. Props: none, or `{ onCancel?: () => void }` if a cancel-mid-scan affordance is wanted (see Interaction Notes — recommend yes).

**Reused-but-relocated (extracted into a shared sub-component both dialogs call):**

- `ImportReviewStep` (new file, e.g. `apps/web/src/components/ImportReviewStep.tsx`) — the checkbox-review JSX currently inlined in `ImportDialog` (the `{scanned && (...)}` block: counts, skipped list, checkbox list) is extracted verbatim into its own component. Props contract: `{ scanned: ScanClaudeDirResult["parsed"]; selected: Set<string>; onToggle: (id: string) => void }`. Purely presentational, no RPC calls inside it — both `CreateProjectDialog` (new caller) and `ImportDialog` (existing caller, refactored to call it instead of inlining) own the `scanned`/`selected` state and RPC orchestration themselves. This is the cleanest "no duplicated JSX, no behavior drift between the two surfaces" option, and matches Q3's framing of "absorb/embed... as a post-confirm sub-step" rather than rebuilding it.
- The project-name `Input` and the "Nhập N mục đã chọn" footer button stay where they conceptually belong to each caller (`CreateProjectDialog` already has its own name field from S1 it can reuse/prefill in S4; it does not need `ImportReviewStep` to own a name field) — `ImportReviewStep` itself owns only the scan-result display + checkboxes, not the name input or the import-trigger button. This keeps the extracted component's prop surface small and avoids it knowing about `createProject`/`importArtifacts` at all.

**Reused as-is (no change):**

- `Dialog`, `DialogHeader`, `DialogTitle`, `DialogFooter` (`apps/web/src/components/ui/dialog.tsx`) — `CreateProjectDialog` keeps the same modal shell across all of S1/S2/S3/S4; only the body content swaps. No new modal-on-modal stacking.
- `Button`, `Input` (shadcn primitives) — used identically in all new sub-components.
- `FolderBrowserDialog` — unchanged, still triggered from S1's "Chọn…" button, available in every sub-state where the path field is visible (S1, S2; arguably hidden during S3/S4 since the path is now committed to a scan — recommend disabling/hiding "Chọn…" once scan has started, to avoid mid-scan path changes).
- `ImportDialog` itself — unchanged by this loop (still references the soon-to-be-extracted JSX, refactored to call `ImportReviewStep` instead, but its own external behavior/props/entry point are untouched, per Q3's explicit instruction that it "remains available as its own standalone entry point").

**State machine added to `CreateProjectDialog`:**

A single discriminated `step` state replaces the implicit binary today: `"form" | "detected" | "scanning" | "review"`. (`"detected"` = S2, `"scanning"` = S3, `"review"` = S4, `"form"` = S1/today, used for both the pristine state and the post-decline state — same value, the detection hint text differs based on a separate `declined: boolean` flag so the confirmed-decline UI (wireframe d) can show "đã chọn tạo dự án trống" instead of the bare default hint.) Driven by `validation` (existing `ValidatePathResult`, unchanged) plus user clicks on the new panel's two buttons.

---

## 5. Interaction Notes

- **Loading state while `scanClaudeDir` runs (S3):** body area shows a centered spinner row + "Đang quét .claude/…" — same visual weight as the existing `creatingDir` "Đang tạo…" button-label pattern already in this file, but here it replaces the whole panel body since there's nothing useful to show yet (no partial results to stream). Recommend a short minimum-display time is NOT needed — show/hide strictly tied to the RPC promise.
- **What happens to "Tạo dự án" while the prompt (S2) is showing:** the footer's existing "Tạo dự án" button is **hidden, not just disabled**, while S2/S3/S4 are active — replaced by the panel's own "Không, tạo trống" / "Có, nhập vào" actions (S2) or "Quay lại" / "Nhập N mục đã chọn" (S4). This avoids two visually competing "create" affordances fighting for the user's eye in the same modal. The footer's "Hủy" button remains visible and functional at every step — clicking it always fully closes the dialog with no side effects, satisfying STATE §7's "decline must always be a clean, complete, non-blocking path" risk note (Hủy is the universal escape hatch; "Không, tạo trống" is the in-flow equivalent that completes a create instead of aborting).
- **Decline is non-blocking, confirmed against the risk note:** clicking "Không, tạo trống" never triggers any RPC beyond the `validatePath` calls already made — it is purely a local state transition back to `step: "form"` with `declined: true`. The user is never forced through scan/review to get an empty project. Hitting Escape (the `Dialog` primitive already wires this) at any step also fully closes with zero side effects, same as today.
- **Path edited away mid-detection:** if the user is on S2/S3/S4 and edits the path field back to something without a detected workflow (or empties it), the dialog should reset to S1's plain form — this is a natural consequence of `validation` being recomputed on every path keystroke; the `step` state machine should listen to `validation` changes and force a reset to `"form"` whenever `hasClaudeDir/hasAgentsMd` both go false, regardless of which step was active. Exception: while `step === "scanning"` or `"review"`, the path field is disabled (see below) precisely to prevent this from happening mid-scan/mid-review, where it would be confusing to yank the rug.
- **Path field + "Chọn…" button disabled during S3/S4:** once the user has committed to scanning a specific path, editing it mid-review would desync the already-fetched `scanned` result from the field shown. Disable both controls from `step: "scanning"` onward; re-enable only if the user clicks "Quay lại" (which also discards `scanned`/`selected` and returns to S2, not S1 — re-running the scan from S2's confirm if they click forward again, since the underlying RPC is cheap and idempotent).
- **Scan RPC error (e.g. permission error mid-scan, or path disappears between validatePath and scanClaudeDir):** S3 shows an inline error message in place of the spinner with two recovery actions: "Thử lại" (re-run `scanClaudeDir`) and "Tạo dự án trống" (falls through to decline path, same as clicking decline in S2) — never a silent dead-end.
- **Empty-`.claude/`-directory false positive (STATE §7 risk note):** flagged as a `/plan` concern, not solved at the UI layer — if `/plan` confirms detection should mean "≥1 parseable-or-skipped file found" rather than "directory exists," that check happens before S2 ever renders (i.e. `CreateProjectDialog` should gate showing S2 on more than the raw `hasClaudeDir` boolean — likely needs `scanClaudeDir`'s result, or a cheaper daemon-side existence-of-files check, to be available earlier than today's `validatePath` call provides). This design assumes that gate is resolved upstream and S2 simply trusts whatever boolean/signal `/plan` decides is the real "something importable exists" condition.
- **`AGENTS.md`-only and "both detected" variants share one component (`WorkflowDetectionPanel`)** — no separate screen/component fork, just conditional copy and conditional second button, per the Component Breakdown's `importAvailable` prop.
- **Transition feel:** no slide/fade choreography specified here (out of this doc's ASCII-only scope) — recommend the architect/dev treat all `step` transitions as instant content swaps within the same fixed-size dialog box (matching the existing `Dialog` primitive's plain mount/unmount behavior, no animation library currently in the stack) rather than introduce new motion primitives for this one feature.
- **Empty state unaffected:** `EmptyState`'s two buttons (`+ Tạo dự án`, `↧ Import .claude/ có sẵn`) are unchanged — the "+ Tạo dự án" button still opens the same `CreateProjectDialog`, which now happens to contain the detection branch. The "↧ Import .claude/ có sẵn" button still opens the standalone `ImportDialog`, unchanged, per Q3.

---

## 6. Open Design Questions

These need a taste call from the user/architect; not guessed here.

1. **Exact prompt copy/wording.** Wireframes (b)/(c)/(e) use illustrative Vietnamese copy matching house style ("đã có", "xem xét Import" conventions already in the codebase) but the final strings (e.g. "Đã phát hiện workflow có sẵn" vs. a shorter variant, whether to mention "file gốc sẽ KHÔNG bị chỉnh sửa" inline or only on hover/tooltip) should be confirmed by whoever owns Symbion's UI voice before `/plan` locks the component contract text as a prop default.
2. **Should "Quay lại" from S4 return to S2 (re-confirm) or go straight back to a fresh S1 form?** This doc assumes S4 → "Quay lại" → S2 (re-offer the same confirm/decline choice without re-typing the path), preserving the already-fetched `scanned` result so re-confirming doesn't force a second RPC round-trip. An alternative is "Quay lại" discards everything and returns to S1, treating going back as itself a soft decline. Pick one before `/plan`.
3. **Minimum/maximum dialog width across steps.** `CreateProjectDialog` today is `w-[480px]`; `ImportDialog` (whose review screen is being embedded) is `w-[560px]`. Should `CreateProjectDialog` widen itself only while showing S4 (review), or commit to one width across all steps for visual stability? This doc's wireframes show the same box width throughout for simplicity, but that is not a confirmed decision.
4. **Cancel-mid-scan affordance.** Interaction Notes recommends an optional cancel button during S3's loading state — confirm whether `scanClaudeDir` is fast enough in practice that this is unnecessary polish, or whether large `.claude/` dirs make this worth building.

---

## 7. Autopilot decisions on open design questions (unattended run, no user present)

Same rationale as STATE §9 — no human present to answer in real time, so each
taste call picks the safest/cheapest/most-reversible option and is documented
for review rather than silently baked in.

1. **Prompt copy** → use the wireframes' illustrative Vietnamese copy as final,
   including the inline "File gốc trong repo sẽ KHÔNG bị chỉnh sửa" line
   (kept inline, not hidden behind a hover/tooltip) — this is a safety-relevant
   guarantee per CLAUDE.md's never-write-silently rule, so it should be
   visible by default, not require discovery.
2. **"Quay lại" from S4** → returns to S2 (re-confirm), preserving the
   already-fetched `scanned` result, per the design doc's own stated
   assumption. Rationale: avoids a redundant RPC round-trip and matches the
   principle of least surprise (going back one step should not silently
   discard work already fetched).
3. **Dialog width** → keep one fixed width across all steps (`CreateProjectDialog`'s
   existing `w-[480px]`) rather than widening for S4. Rationale: visual
   stability across step transitions is cheaper to build and avoids a
   resize-jump; the existing `ImportReviewStep` content (checkbox list +
   skipped-reasons text) reads fine in a narrower column, just taller.
4. **Cancel-mid-scan affordance** → skip it for this iteration.
   `scanClaudeDir` reads a bounded local filemap (a single project's
   `.claude/` directory) — not a network call — so it is expected to complete
   quickly enough that a cancel button is unnecessary polish. Can be added
   later if real-world usage proves otherwise.

## Future ideas (explicitly out of this iteration's scope, per STATE §3 "Out of scope")

- Stamping a managed-by marker on import (Q1 said no — flagged here only so it isn't silently reconsidered mid-build).
- `AGENTS.md` → IR reverse-parsing to make the Codex case actually importable (Q5 deferred this).
- `.github/` workflow detection (Q2 ruled this out as the issue's likely placeholder text).
- Importing into an **already-existing** non-empty Symbion project (EC-5's "re-import later" case) — `ImportDialog` today always calls `createProject` fresh; making it target an existing project is a small RPC-flow change flagged for `/plan` but not designed here since it's outside this loop's "first import moment" framing.
- Any merge/reconciliation UI for store.json-vs-disk drift — publish-time territory (`computeDiff`/`classify`), not this loop.

---

**Suggested next step:** run `/plan` — the architect should read this design doc alongside `load-existing-workflows-STATE.md` to confirm the `WorkflowDetectionPanel` / `ImportScanningState` / `ImportReviewStep` component contracts above, resolve the empty-`.claude/`-directory detection-gate question (§5's flagged risk), and decide the EC-5 (import-into-existing-project) RPC question before `/build`.
