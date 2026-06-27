# connect-providers — Design

Source of truth: `docs/loops/connect-providers-STATE.md` (§-1 autopilot decisions are
locked, not re-litigated here). This doc designs the UI/UX only — no production code.

Reused surfaces (read before/with this doc):
- `apps/web/src/components/GenerateBodyButton.tsx`
- `apps/web/src/components/GenerateBodyDisclosure.tsx`
- `apps/web/src/components/ModelPicker.tsx`
- `apps/web/src/components/AgentForm.tsx`
- `apps/web/src/lib/store/useArtifactStore.ts` (existing `daemonConnected` heartbeat —
  this is the existing EC-7 "daemon down" signal; connect-providers must visually
  differ from it, not duplicate it)

---

## 1. User Journey (happy path, matches STATE §3)

1. User opens the Agent/Workflow builder (`AgentForm`). No provider (Ollama) running
   yet, but the Symbion daemon itself IS running (`daemonConnected: true`).
2. Next to the model picker / Generate button row, a **small status pill** is visible
   at all times: `● Chưa kết nối` (gray/amber dot + label) — this is the proactive
   indicator, visible before any click, satisfying AC-5/AC-1 without a new page.
   - The user did not ask for this check — it ran once on form mount (a single,
     disclosed check, not silent polling — see Interaction Notes).
3. User clicks the status pill. A popover-style panel opens anchored to the pill
   (reuses the `Dialog` primitive already in the codebase — see Open Questions for
   the popover-vs-dialog call):
   - Names the provider: "Ollama"
   - Plain-language explainer: what it is, why Symbion needs it
   - The exact OS-specific install/run command, in a copyable code block
   - A `[ Kiểm tra lại kết nối ]` button (on-demand only, no polling)
   - A `[ Đóng ]` / dismiss control — always available, never a blocking modal
     over the rest of the app (EC-6)
4. User opens a terminal (outside Symbion), runs the shown command, starts Ollama.
5. User returns to the still-open panel, clicks `[ Kiểm tra lại kết nối ]`. Button
   shows a brief checking state, then the pill and panel update to
   `● Đã kết nối` (green dot).
6. User closes the panel (or it's still open — closing is optional, not forced).
   The persistent pill near Generate now reads connected.
7. User clicks Generate Body — it now succeeds, no separate re-discovery of the
   original feature (no need to re-find Generate after fixing the provider).

Failure-reactive path (the other locked entry point):
1. User skips the proactive pill entirely, clicks Generate Body directly while
   Ollama is down.
2. Existing inline error appears (`ERROR_MESSAGES["llm-provider-not-running"]`)
   exactly as today, PLUS a new inline CTA link/button under it:
   `[ Cách kết nối Ollama ]` which opens the **same** panel from step 3 above.
3. From there, journey rejoins step 4 onward.

---

## 2. Screen Inventory

No new route/page. All additions live inside the existing builder surface.

| # | Screen/element | Entry trigger | Exit path |
|---|---|---|---|
| S1 | **Provider status pill** (new, small, inline) | Always rendered next to ModelPicker/GenerateBodyButton row in `AgentForm` (and any other form using GenerateBodyButton) | N/A — persistent, not dismissible (it's a status readout, not a flow) |
| S2 | **Connect-provider panel** (new, popover/dialog) | Click on S1 pill, OR click new inline CTA in S3 | `[ Đóng ]` button, `Esc`, or click-outside (if popover) |
| S3 | **Inline failure CTA** (extends existing error block in `GenerateBodyButton`) | Generate Body/Description RPC fails with `llm-provider-not-running` (Ollama only, per locked decision 4) | Resolved by next successful generate, or user ignores it (EC-6) |

No standalone Settings page, per locked decision 2.

---

## 3. ASCII Wireframes

### (a) Status indicator — both states, inline next to Generate row

Disconnected state (default before first check resolves — see Interaction Notes
for the "checking" micro-state shown briefly on mount):

```
  Nội dung                                                          ▾ Nâng cao
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ Mô hình: ( llama3.2:1b ▾ )   [✨]   ● Chưa kết nối  Ollama  ⓘ            │
 └──────────────────────────────────────────────────────────────────────────┘
                                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                         S1 status pill — clickable, opens S2
                                         (amber/gray dot, underline-on-hover)
```

Connected state:

```
  Nội dung                                                          ▾ Nâng cao
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ Mô hình: ( llama3.2:1b ▾ )   [✨]   ● Đã kết nối  Ollama                │
 └──────────────────────────────────────────────────────────────────────────┘
                                         ^^^^^^^^^^^^^^^^^^^^^^^^
                                         green dot, still clickable
                                         (re-opens S2 for re-check/info)
```

Daemon-down state (EC-7 — distinct icon/message, reuses existing `daemonConnected`
signal, takes visual priority over the provider pill since nothing AI-related can
work at all):

```
  Nội dung                                                          ▾ Nâng cao
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ Mô hình: ( llama3.2:1b ▾ )   [✨ disabled]   ⚠ Daemon mất kết nối        │
 └──────────────────────────────────────────────────────────────────────────┘
   ^ existing GenerateBodyButton disabled state (EC-8) — the S1 provider pill is
     SUPPRESSED entirely in this state (not "checked", not shown at all) because
     checking provider reachability is meaningless/misleading when the daemon
     itself — the only thing that could run the check — is unreachable.
     Different icon (⚠ triangle, not ● dot) + different copy ("Daemon mất kết
     nối" vs "Chưa kết nối Ollama") satisfies AC-4/EC-7.
```

"Checking" transient micro-state (on mount, and during recheck):

```
 │ Mô hình: ( llama3.2:1b ▾ )   [✨]   ◐ Đang kiểm tra…  Ollama             │
```

### (b) Connect-provider panel (S2) — popover anchored to the pill

```
                                          ▼ (anchored under the S1 pill)
                         ┌─────────────────────────────────────────────┐
                         │  Kết nối với Ollama                     [×] │
                         ├─────────────────────────────────────────────┤
                         │  ● Chưa kết nối                              │
                         │                                               │
                         │  Ollama là phần mềm chạy mô hình AI ngay     │
                         │  trên máy của bạn — Symbion dùng nó để tạo   │
                         │  nội dung gợi ý (Generate Body/Description). │
                         │  Không có Ollama, các nút "✨ Tạo nội dung"  │
                         │  sẽ không hoạt động, nhưng phần còn lại của  │
                         │  Symbion vẫn dùng được bình thường.          │
                         │                                               │
                         │  Cài & chạy trên máy của bạn (phát hiện:     │
                         │  WSL2 / Ubuntu trên Windows):                 │
                         │  ┌─────────────────────────────────────┐ [⧉] │
                         │  │ curl -fsSL https://ollama.com/install│     │
                         │  │   .sh | sh && ollama serve           │     │
                         │  └─────────────────────────────────────┘     │
                         │                                               │
                         │  ⓘ Lệnh trên dành cho WSL2 (Ubuntu trên       │
                         │  Windows) — không phải Windows hay Linux gốc.│
                         │                                               │
                         │  [ Kiểm tra lại kết nối ]        [ Đóng ]    │
                         └─────────────────────────────────────────────┘
```

Same panel, after recheck succeeds (state transition in place, no remount):

```
                         ┌─────────────────────────────────────────────┐
                         │  Kết nối với Ollama                     [×] │
                         ├─────────────────────────────────────────────┤
                         │  ● Đã kết nối                                 │
                         │                                               │
                         │  Ollama đang chạy và Symbion đã kết nối      │
                         │  được. Bạn có thể đóng cửa sổ này và dùng    │
                         │  "✨ Tạo nội dung" như bình thường.          │
                         │                                               │
                         │  Cài & chạy trên máy của bạn (phát hiện:     │
                         │  WSL2 / Ubuntu trên Windows):                 │
                         │  ┌─────────────────────────────────────┐ [⧉] │
                         │  │ curl -fsSL https://ollama.com/install│     │
                         │  │   .sh | sh && ollama serve           │     │
                         │  └─────────────────────────────────────┘     │
                         │  (command stays visible — restart guidance  │
                         │   if it stops again mid-session, EC-1)       │
                         │                                               │
                         │  [ Kiểm tra lại kết nối ]        [ Đóng ]    │
                         └─────────────────────────────────────────────┘
```

Same panel, mid-recheck (button shows spinner, rest of panel static — no layout
jump):

```
                         │  [ ◐ Đang kiểm tra… ]            [ Đóng ]    │
```

### (c) Inline failure-state CTA (S3) — extends the existing error block

Today (`GenerateBodyButton.tsx` lines 167-176), unchanged structure, new line added
only for the `llm-provider-not-running` code:

```
 [✨]
  ⚠ Không thể kết nối tới Ollama — đảm bảo Ollama đang chạy trên máy.
    [ Cách kết nối Ollama ]
    ^^^^^^^^^^^^^^^^^^^^^^^
    NEW — only rendered when errorCode === "llm-provider-not-running".
    Click opens the SAME S2 panel (shared component/state, not a duplicate).
```

For comparison, the `remote`/`auth` error path is explicitly UNCHANGED (locked
decision 4 — no new UI for remote):

```
 [✨]
  ⚠ Thiếu hoặc sai cấu hình API key cho remote provider.
    (no new CTA line here — remote keeps today's message exactly as-is)
```

---

## 4. Component Breakdown

### New component 1 — `ProviderStatusPill`
Small inline status readout (S1) + click target to open S2.

- Props: `providerId: "ollama" | "remote"` (renders nothing / is suppressed for
  `remote` per locked decision 4 — only Ollama gets this pill in v1),
  `daemonConnected: boolean` (read from `useArtifactStore`, passed down or read
  directly via the hook inside the component — architect's call).
- Internal state: `status: "checking" | "connected" | "disconnected"`, fetched once
  on mount via a new (architect-defined) status-check RPC — call it
  `checkProviderStatus({ providerId })` for this doc's purposes, naming is the
  architect's call in `/plan`.
- Visual: colored dot (`●` gray/amber = disconnected, `●` green = connected,
  `◐` animated = checking) + short label + provider name. Suppressed entirely
  (renders `null`) when `daemonConnected === false` — defers to the existing
  disabled-Generate-button + "Daemon mất kết nối" title affordance instead of
  stacking a second, confusing message (EC-7).
- shadcn building blocks: none directly — this is a plain inline `<button>` (it's
  a disclosure trigger, not a real shadcn primitive) styled with existing Tailwind
  utility classes already used elsewhere in `AgentForm`/`GenerateBodyButton`
  (`text-xs`, `text-muted-foreground`, `text-destructive` patterns).

### New component 2 — `ConnectProviderPanel`
The popover content (S2), shared by both entry points (S1 click and S3 CTA click).

- Props: `providerId: "ollama"` (v1 only ever called with `"ollama"` per locked
  decision 4 — prop typed narrowly, not `"ollama" | "remote"`, to make the
  remote-is-out-of-scope boundary visible in the type itself),
  `open: boolean`, `onClose: () => void`.
- Internal state: `status: "checking" | "connected" | "disconnected"` (own
  recheck lifecycle, independent of `ProviderStatusPill`'s initial check — both
  call the same RPC, no shared cache required for v1's simplicity),
  `os: "wsl" | "linux" | "macos" | "windows"` — NOT detected in the browser;
  must come from the daemon (the daemon is the process that actually knows its
  own OS per STATE EC-3) via the same or an adjacent RPC response field.
- Composition: reuses `Dialog`, `DialogHeader`, `DialogTitle`, `DialogFooter`
  from `apps/web/src/components/ui/dialog.tsx` (same primitives `GenerateBodyButton`
  already uses for its confirm/disclosure dialogs) — see Open Question 1 below on
  popover-vs-dialog visual treatment; functionally this doc specifies Dialog reuse
  to avoid introducing a new Popover primitive for one feature.
- New small internal bit: a copy-command code block. Reuse a `<pre>`/`<code>`
  styled block + a small "copy" icon button (`lucide-react`'s `Copy`/`Check`
  icons, consistent with `Loader2`/`Sparkles` already imported elsewhere) —
  this is presentation only, not a new shadcn component.
- Action buttons: plain `Button` (existing `apps/web/src/components/ui/button.tsx`)
  with `variant="outline"` for "Kiểm tra lại kết nối" (matches existing secondary
  action styling in `GenerateBodyButton`'s confirm dialog) and default/ghost for
  "Đóng".

### Modified component — `GenerateBodyButton.tsx`
- Add: render `<ProviderStatusPill providerId={providerId} />` in the row beside
  the existing `[✨]` button (only meaningfully renders for `"ollama"`; renders
  `null` for `"remote"` per locked decision 4 — keep the prop wiring generic so
  future providers don't need a new call site).
- Add: inside the existing `errorCode &&` block, when
  `errorCode === "llm-provider-not-running"`, render a new
  `[ Cách kết nối Ollama ]` text-button that sets a new local
  `connectPanelOpen` state to `true`, rendering `<ConnectProviderPanel
  providerId="ollama" open={connectPanelOpen} onClose={...} />` alongside the
  existing `Dialog`s already in this file.
- No change to `ERROR_MESSAGES`, no change to the RPC call shape for
  `generateBody` itself, no change to error-code taxonomy (per STATE §2 explicit
  out-of-scope).

### Modified component — `AgentForm.tsx` / any sibling form
- No direct change required — `ProviderStatusPill` lives inside
  `GenerateBodyButton`, so every call site (`AgentForm` today, future
  `WorkflowForm`/`CommandForm` etc.) gets it for free without per-form edits.

No new shadcn component additions to `components/ui/` are required for v1 (Dialog,
Button, Input already cover this). If the architect prefers a true anchored
popover (not a centered modal) for S2, that would be the one new shadcn primitive
to introduce (`popover.tsx`, e.g. via Radix) — flagged as Open Question 1.

---

## 5. Interaction Notes

- **Initial check (S1 pill, on mount):** Fires once when `GenerateBodyButton`
  mounts with `providerId === "ollama"`, IF `daemonConnected` is true. Shows
  `◐ Đang kiểm tra…` for the duration of the call, then settles to connected/
  disconnected. This is the only "automatic" network call in this feature — it
  is disclosed in the panel's body copy ("Symbion sẽ kiểm tra Ollama khi bạn mở
  trang/biểu mẫu này — không kiểm tra định kỳ") so it isn't silent background
  polling (constraint in STATE §5). No re-check on focus/visibility-change, no
  interval — strictly on-mount-once, matching locked decision 3.
- **Recheck (S2 panel button):** `[ Kiểm tra lại kết nối ]` → button itself
  shows `◐ Đang kiểm tra…` (button text swap, like `GenerateBodyButton`'s own
  busy-spinner pattern) and is disabled while in flight. Bounded by the same
  kind of timeout the daemon already uses for LLM calls (AC-3 "bounded, visible
  time") — exact timeout value is the architect's call in `/plan`, but the UI
  contract is: this button NEVER spins indefinitely; on timeout it falls back
  to "disconnected" rather than hanging.
- **Success transition:** Dot flips amber/gray → green, label text swaps
  `Chưa kết nối` → `Đã kết nối`, panel body copy swaps to the "đang chạy" copy
  shown in wireframe (b). No toast/confetti — quiet state change, consistent
  with the rest of the builder's low-ceremony feedback style (e.g. no toast on
  save). Pill in the Generate row updates immediately too (shared state/store,
  not a separate poll) so the user doesn't need to close+reopen the panel to
  see the parent row reflect "connected" (STATE §3 step 4 requirement).
- **Failure transition (recheck still disconnected):** Dot/label stay
  amber/gray, no error toast — the panel itself IS the error state already (the
  command block is still right there, no extra modal-on-modal).
- **Empty/first-render state:** Before the very first check resolves, pill shows
  `◐ Đang kiểm tra…` rather than defaulting to "disconnected" — avoids a
  misleading flash of red/amber on every page load before the check has had a
  chance to run.
- **Dismiss behavior (EC-6):** `[ Đóng ]`, `Esc`, and click-outside (if true
  popover) all close S2 without side effects — closing does NOT reset/forget
  the last-known status (pill keeps showing whatever the last check said).
  Re-opening S2 does not auto-refire the check (avoids accidental repeat
  network calls just from toggling open/closed) — only the explicit recheck
  button fires a new check. Closing never disables/blocks any other control in
  `AgentForm` — verified by construction since this is a non-modal popover/local
  dialog scoped to this one row, not a full-screen gate.
- **Daemon-down precedence (EC-7):** If `daemonConnected` flips to `false`
  while S2 is open (existing heartbeat in `useArtifactStore` detects it), the
  panel should NOT silently keep showing stale Ollama status as if it's still
  meaningful — show a one-line note inside the still-open panel:
  "⚠ Mất kết nối tới Symbion daemon — không thể kiểm tra Ollama lúc này." This
  is visually distinct (different icon, different sentence, mentions "Symbion
  daemon" by name vs "Ollama" by name) satisfying AC-4 even in this nested case.
- **Copy-command button:** Click copies the exact shown command to clipboard,
  icon swaps `Copy` → `Check` for ~1.5s (standard pattern), no toast needed —
  the icon swap IS the feedback.
- **OS-mismatch safety (EC-3):** If the daemon cannot confidently determine a
  single OS-specific command (e.g. ambiguous WSL-vs-native detection), the panel
  must show a clearly-labeled "phát hiện: …" line naming exactly what was
  detected (as in wireframe b) rather than silently guessing — if detection
  genuinely fails, fall back to showing all OS variants in labeled tabs/sections
  rather than guessing wrong (exact fallback UI is an open question below, since
  it depends on how confidently the daemon can detect WSL vs native Linux).

---

## 6. Open Design Questions (need a taste call before architect locks design)

1. **Popover vs. centered Dialog for S2.** This doc defaulted to reusing the
   existing `Dialog` primitive (centered, modal-style, matches
   `GenerateBodyButton`'s existing confirm/disclosure dialogs) for consistency
   and zero new dependencies. A true anchored popover (opens right under the
   pill, doesn't dim/cover the rest of the form) would feel lighter and is more
   in the Linear/Raycast register CLAUDE.md asks for, but requires introducing a
   new `popover.tsx` shadcn/Radix primitive that doesn't exist in this codebase
   yet. **Default: centered Dialog (reuse, no new primitive).** Flag for
   architect/reviewer to override if a Popover primitive is wanted instead.
2. **OS-detection-failed fallback UI.** Wireframe (b) assumes confident
   single-OS detection. If the daemon can only say "Linux, possibly WSL,
   uncertain," should the panel show (a) a manual OS selector dropdown the user
   picks themselves, or (b) all known variants stacked with labels? **Default:
   (b) — stacked labeled sections**, since it never requires the user to
   already know their own OS subtlety (matches STATE's "must explain, not
   assume prior knowledge" spirit) — but this is a judgment call the architect
   should confirm once they know how reliable WSL-detection actually is.
3. **Pill placement when `ModelPicker` shows its own `loadError`** (see
   `ModelPicker.tsx` lines 52-54) — two error/status strings could appear in the
   same row (model-list-load-failure + provider-status-pill). This doc assumes
   they simply coexist side by side (low-traffic row, both short strings), but
   if that reads as cluttered, a stacking/priority order may be needed.
   **Default: side by side, no priority logic** — flag if it looks cramped once
   built.

---

## Future ideas (explicitly out of scope for this loop — do not build now)

- Model-pulled-vs-missing distinction (EC-4) — deferred per locked decision 5.
- Daemon-spawned install/pull commands — deferred per locked decision 1.
- Remote provider guided setup / API-key input UI — deferred per locked decision 4.
- Always-visible header-level connection badge across the whole app (not just
  per-form) — deferred per locked decision 3 (on-demand only, no global polling
  surface).

---

Suggested next step: run `/plan` with this design doc + `connect-providers-STATE.md`
so the architect can define the new RPC (`checkProviderStatus` or equivalent),
the OS-detection mechanism in `apps/daemon`, and the exact component prop/state
contracts for `ProviderStatusPill` and `ConnectProviderPanel`.
