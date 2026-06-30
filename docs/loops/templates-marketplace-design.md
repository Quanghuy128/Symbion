# templates-marketplace — Design

> Reads against `docs/loops/templates-marketplace-STATE.md` (phase: PLAN, THINK
> decisions locked). Visual/component language matched against
> `apps/web/src/components/{AppNav,AppShell,ProjectSidebar,ImportDialog,
> CreateProjectDialog,FolderBrowserDialog,CopyRunCommandDialog,MarkdownTab,
> EmptyState,SettingsShell,ImportReviewStep}.tsx` and `apps/web/src/components/
> ui/{dialog,button,input}.tsx`.

No production code below — ASCII wireframes only, plus an interface-only
component breakdown for the architect.

---

## 1. User Journey

**Happy path A — browse + copy markdown (no project needed):**

1. User is anywhere in Symbion (Builder or Cài đặt). Top nav now shows a
   third tab, **Templates**. User clicks it.
2. App navigates to `/templates`. The route bootstraps its own daemon
   session/heartbeat (same pattern as `/settings`'s `SettingsShell`), but
   the page itself does **not** require the daemon to render — templates are
   bundled client-side (THINK #2). If the daemon is down, the rest of the
   app's `DaemonStatusBadge` still shows red at the bottom of the persistent
   chrome; the templates list itself loads fine.
3. User sees three labeled sections — **Skills**, **Agents**, **Commands**
   — each a list of cards: name + one-line description, no need to open
   anything to know what's there.
4. User clicks a Skills card, e.g. "commit-message". A modal opens showing
   the raw markdown (frontmatter + body) in a read-only viewer, byte-exact
   to what's bundled.
5. User clicks **"Copy markdown"**. Button shows a brief "Đã copy" confirm
   state inline (matches `CopyRunCommandDialog`'s `copied` pattern). No
   daemon round-trip. For Skills items specifically, the "Áp dụng" button is
   not clickable — disabled with an inline note "Skills chưa hỗ trợ Apply —
   coming soon" instead of being hidden, so the 3-section promise stays
   visibly consistent rather than silently missing a control.
6. User closes the modal (Esc / backdrop / explicit Đóng), back to the list.

**Happy path B — Apply an Agent/Command into a project:**

1. From the same `/templates` list, user clicks an Agents or Commands card
   (e.g. "code-reviewer" agent). Modal opens with the same raw-markdown
   read-only view.
2. User clicks **"Áp dụng"**. The modal advances to a second step (project
   picker) inside the same dialog (matches `CreateProjectDialog`'s in-place
   `step` state-machine pattern, not a second separate dialog instance).
3. Picker step lists every project currently registered in Symbion
   (same set as `ProjectSidebar`/`listProjects`). User selects one (radio /
   highlighted row) and clicks **"Xác nhận áp dụng"**.
4. If daemon is connected: artifact is parsed and staged into that
   project's store as a draft. If the project already has an artifact named
   `code-reviewer`, it is auto-saved as `code-reviewer-2` (THINK #4) with no
   extra confirmation step.
5. On success, modal closes and a confirmation surface tells the user
   exactly what happened — including the actual name used if it was
   suffixed — e.g. inline success panel / toast-equivalent: "Đã áp dụng vào
   'my-api-service' với tên 'code-reviewer-2' (đã trùng tên với mục có sẵn)."
   plus a link/button "Mở dự án" that navigates to `/` with that project
   selected (`loadProject(id)` then route to Builder).
6. User goes to Builder, sees the new artifact in the project's list with
   `meta.status === "draft"`, exactly like a hand-authored one, and can
   review/edit/Publish it through the existing flow — nothing is written to
   the real repo yet.

**Sad paths covered below in §3/§5**: zero registered projects at Apply
time, daemon down at Apply time, malformed bundled template, clipboard
denied.

---

## 2. Screen Inventory

| # | Screen/Modal | Entry trigger | Exit path |
|---|---|---|---|
| T1 | **Templates list view** (`/templates`) | Click "Templates" tab in `AppNav` | Navigate away via nav tabs; stays mounted otherwise |
| T2 | **Template preview modal** (markdown view, step 1) | Click any template card in T1 | Đóng button / Esc / backdrop click → back to T1; or click "Áp dụng" → advances to T3 (same modal, step 2) |
| T3 | **Apply / project-picker step** (step 2 of same modal as T2) | Click "Áp dụng" inside T2 (Agents/Commands only — disabled for Skills) | "Quay lại" → back to T2; "Xác nhận áp dụng" success → T4; Đóng/Esc → closes whole modal, back to T1 |
| T4 | **Apply result / confirmation** (step 3, in-modal, auto-transient or explicit) | Successful apply from T3 | "Mở dự án" → navigates to `/` with project loaded; "Đóng" → back to T1 |
| T5 | **No-projects state** (variant of T3 when `projects.length === 0`) | Click "Áp dụng" in T2 while zero projects registered | "Tạo dự án trước" → closes templates modal, opens `CreateProjectDialog` (requires being on `/` — see Interaction Notes); "Đóng" → back to T2 |

T2/T3/T4/T5 are not separate route/dialog components conceptually — they
are steps of **one** `TemplatePreviewModal`, mirroring how
`CreateProjectDialog` keeps `form → detected → scanning → review` as one
component with a `step` state machine rather than four dialogs.

---

## 3. ASCII Wireframes

### 3.1 — T1: Templates list view (`/templates`)

**Default pick (pending feedback, see Open Design Questions): three
stacked sections on one scrollable page**, consistent with the existing
`ProjectView`/`SettingsShell` single-column content pattern under `AppNav`
— not tabs, not three columns. Rationale below in §6.

```
┌───────────────────────────────────────────────────────────────────────┐
│ Symbion   [ Builder ]  [ Templates ]  [ Cài đặt ]                     │ ← AppNav, 3rd tab active
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Templates                                                             │
│  Thư viện mẫu agent / command / skill có sẵn — xem trước rồi áp dụng   │
│  vào dự án của bạn.                                                    │
│                                                                         │
│  ── Skills ─────────────────────────────────────────────────────────  │
│  ┌─────────────────────────────┐ ┌─────────────────────────────┐      │
│  │ commit-message               │ │ pr-description                │     │
│  │ Soạn commit message theo     │ │ Tạo mô tả PR từ diff theo     │     │
│  │ Conventional Commits.        │ │ chuẩn dự án.                  │     │
│  │                    [Skill]   │ │                      [Skill]  │     │
│  └─────────────────────────────┘ └─────────────────────────────┘      │
│                                                                         │
│  ── Agents ─────────────────────────────────────────────────────────  │
│  ┌─────────────────────────────┐ ┌─────────────────────────────┐      │
│  │ code-reviewer                │ │ test-writer                   │     │
│  │ Rà soát code, gắn nhãn       │ │ Sinh test case cho hàm/module │     │
│  │ rủi ro bảo mật & style.      │ │ vừa thay đổi.                 │     │
│  │                    [Agent]   │ │                      [Agent]  │     │
│  └─────────────────────────────┘ └─────────────────────────────┘      │
│                                                                         │
│  ── Commands ───────────────────────────────────────────────────────  │
│  ┌─────────────────────────────┐ ┌─────────────────────────────┐      │
│  │ /test-writer                 │ │ /release-notes                │     │
│  │ Sinh + chạy test cho file    │ │ Tổng hợp release notes từ     │     │
│  │ đang sửa.                    │ │ commit log.                   │     │
│  │                  [Command]   │ │                    [Command]  │     │
│  └─────────────────────────────┘ └─────────────────────────────┘      │
│                                                                         │
│  ─────────────────────────────────────────────────────────────────    │
│  Lấy cảm hứng từ các bộ template cộng đồng (vd. ECC) ↗                │ ← footer attribution, links out
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

Card is the interactive zone (whole card clickable, `[ ]`-equivalent),
kind badge (`[Skill]`/`[Agent]`/`[Command]`) is a small label not a button.

### 3.2 — T1 variant: daemon-down banner present

Banner is a persistent app-shell concern (`DaemonStatusBadge`), not
specific to T1, but shown here to confirm it composes correctly with the
new route — note Copy markdown still fully usable, only Apply-related UI
is affected (handled inside T2/T3, not here).

```
┌───────────────────────────────────────────────────────────────────────┐
│ Symbion   [ Builder ]  [ Templates ]  [ Cài đặt ]                     │
├───────────────────────────────────────────────────────────────────────┤
│ ⚠ daemon mất kết nối — Lưu/Xuất bản đang tạm khoá. Đang thử kết nối   │ ← reused DaemonStatusBadge banner
│   lại…                                                                  │   (currently rendered inside ProjectSidebar;
├───────────────────────────────────────────────────────────────────────┤   for /templates, hoist into AppNav row or a
│  Templates                                          (same as 3.1)     │   top-of-content banner — see Component
│  ...                                                                    │   Breakdown note)
└───────────────────────────────────────────────────────────────────────┘
```

### 3.3 — T1 variant: section with a malformed/skipped template

```
│  ── Commands ───────────────────────────────────────────────────────  │
│  ┌─────────────────────────────┐ ┌─────────────────────────────┐      │
│  │ /test-writer                 │ │ /release-notes                │     │
│  │ ...                           │ │ ...                            │     │
│  └─────────────────────────────┘ └─────────────────────────────┘      │
│  ⚠ 1 mẫu không tải được: changelog-bot.md — frontmatter không hợp lệ  │ ← inline note, same style as
│     (đã bỏ qua, không ảnh hưởng các mẫu khác)                          │   ImportReviewStep's skipped-files line
```

### 3.4 — T2: Template preview modal (step 1 — markdown view)

```
┌──────────────────────────────────────────────────────────┐
│ code-reviewer                                        [Agent]│ ← DialogHeader + kind badge
│ Rà soát code, gắn nhãn rủi ro bảo mật & style.              │ ← one-line description, under title
├──────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────┐ │
│ │ ---                                                    │ │
│ │ name: code-reviewer                                    │ │
│ │ description: Rà soát code, gắn nhãn rủi ro bảo mật...   │ │ ← read-only viewer, monospace,
│ │ tools: [read, grep]                                    │ │   CodeMirror in read-only mode
│ │ ---                                                     │ │   (reuse MarkdownTab's CodeMirror
│ │                                                          │ │   setup, editable={false})
│ │ You are a meticulous code reviewer...                  │ │
│ │ ...                                                      │ │
│ │ (scrollable, ~360px viewport)                           │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                              │
│ ✓ Đã copy vào clipboard.                                   │ ← transient confirm line (only after click)
├──────────────────────────────────────────────────────────┤
│                          [ Đóng ]  [ Copy markdown ]  [ Áp dụng ]│ ← DialogFooter
└──────────────────────────────────────────────────────────┘
```

### 3.5 — T2 variant: Skills item (Apply disabled)

```
┌──────────────────────────────────────────────────────────┐
│ commit-message                                       [Skill]│
│ Soạn commit message theo Conventional Commits.              │
├──────────────────────────────────────────────────────────┤
│ (same read-only markdown viewer)                            │
│                                                              │
│ ℹ Skills chưa hỗ trợ Áp dụng — coming soon. Bạn vẫn có thể  │ ← inline note, muted/info style
│   copy markdown và dán thủ công vào .claude/skills/.        │
├──────────────────────────────────────────────────────────┤
│                          [ Đóng ]  [ Copy markdown ]  [ Áp dụng ]│ ← Áp dụng rendered disabled (opacity-50,
└──────────────────────────────────────────────────────────┘    pointer-events-none, same Button disabled state)
```

### 3.6 — T2 variant: clipboard copy failure

```
│ ⚠ Không thể truy cập clipboard — đã chọn sẵn văn bản phía   │ ← amber warning line, same tone as
│   trên, dùng Ctrl+C / ⌘C để copy thủ công.                  │   CopyRunCommandDialog's clipboardBlocked
```
(Markdown viewer content auto-select-all triggered on failure, same
fallback idea as `CopyRunCommandDialog`'s `<code className="select-all">`.)

### 3.7 — T3: Apply / project-picker step (step 2, same modal)

```
┌──────────────────────────────────────────────────────────┐
│ Áp dụng "code-reviewer" vào dự án nào?                     │ ← DialogTitle changes per step
├──────────────────────────────────────────────────────────┤
│ ( 🔍 Tìm dự án...                                        ) │ ← search input, shown once project count
│                                                              │   is non-trivial (always rendered, harmless
│ ┌──────────────────────────────────────────────────────┐ │   at low counts)
│ │ (•) my-api-service        …/code/my-api-service        │ │ ← radio-style row, full row clickable
│ │ ( ) geochat                …/code/geochat               │ │
│ │ ( ) internal-tools         …/code/internal-tools         │ │
│ │ (scrollable list once long)                              │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                              │
│ Mẫu sẽ được lưu vào dự án đã chọn ở dạng nháp (draft) — chưa│ ← reassurance copy: explains the
│ ghi gì vào repo. Bạn vẫn cần Xuất bản sau để ghi ra đĩa.    │   store-not-disk distinction (AC5)
├──────────────────────────────────────────────────────────┤
│              [ Quay lại ]              [ Xác nhận áp dụng ]│ ← Quay lại returns to T2 (step 1)
└──────────────────────────────────────────────────────────┘    Xác nhận disabled until a project is selected
```

### 3.8 — T3 variant: daemon down while on Apply step

```
┌──────────────────────────────────────────────────────────┐
│ Áp dụng "code-reviewer" vào dự án nào?                     │
├──────────────────────────────────────────────────────────┤
│ ⚠ daemon mất kết nối — không thể áp dụng lúc này. Đang thử │ ← reuses DaemonStatusBadge copy/tone,
│   kết nối lại…                                              │   inline within the modal body
│                                                              │
│ (•) my-api-service   …                                      │ ← list still rendered from last-known
│ ( ) geochat           …                                      │   `projects` state (no daemon round-trip
│                                                              │   needed to list — listProjects was already
│                                                              │   loaded at app boot) but disabled/dimmed
├──────────────────────────────────────────────────────────┤
│              [ Quay lại ]              [ Xác nhận áp dụng ]│ ← "Xác nhận áp dụng" disabled while
└──────────────────────────────────────────────────────────┘    daemonConnected === false
```

### 3.9 — T5: zero registered projects

```
┌──────────────────────────────────────────────────────────┐
│ Áp dụng "code-reviewer" vào dự án nào?                     │
├──────────────────────────────────────────────────────────┤
│                                                              │
│              Chưa có dự án nào — tạo dự án trước             │
│                                                              │
│                  [ + Tạo dự án mới ]                         │ ← navigates to "/" and opens
│                                                              │   CreateProjectDialog (see Interaction
├──────────────────────────────────────────────────────────┤   Notes — cross-route handoff)
│              [ Quay lại ]                                   │
└──────────────────────────────────────────────────────────┘
```

### 3.10 — T4: Apply success confirmation (step 3, in-modal)

```
┌──────────────────────────────────────────────────────────┐
│ ✓ Đã áp dụng                                                │
├──────────────────────────────────────────────────────────┤
│ "code-reviewer" đã được thêm vào dự án "my-api-service"     │
│ với tên "code-reviewer-2" (đã trùng tên với agent có sẵn,   │ ← shown ONLY if a suffix was applied;
│ tự động đổi tên để không ghi đè).                            │   if no collision, simpler line:
│                                                              │   `"code-reviewer" đã được thêm vào dự án
│ Trạng thái: nháp (draft) — chưa ghi gì ra repo.              │   "my-api-service" ở dạng nháp.`
├──────────────────────────────────────────────────────────┤
│                  [ Đóng ]              [ Mở dự án → ]      │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Component Breakdown

### Reused shadcn/existing components (no change needed)
- `Dialog` / `DialogHeader` / `DialogTitle` / `DialogFooter`
  (`apps/web/src/components/ui/dialog.tsx`) — backs `TemplatePreviewModal`
  exactly like `CopyRunCommandDialog`/`ImportDialog`/`CreateProjectDialog`
  already do. No new modal primitive needed.
- `Button` (`ui/button.tsx`) — `variant="outline"` for secondary actions
  (Đóng, Quay lại), default for primary (Copy markdown, Áp dụng, Xác nhận
  áp dụng, Mở dự án), `size="sm"` where space is tight in list rows.
- `Input` (`ui/input.tsx`) — project-picker search box in T3.
- `AppNav` — extend with a third `<Link href="/templates">`, same
  `linkClass` active-state logic, no structural change (per STATE's
  framing: "small, well-precedented change in shape, not a new nav
  system").
- `DaemonStatusBadge` — reused verbatim for the connectivity story; no
  bespoke daemon-down component per STATE's edge case requirement.
- CodeMirror + `@codemirror/lang-markdown` (already a dependency via
  `MarkdownTab.tsx`) — reused in **read-only mode** for the T2 markdown
  viewer (CodeMirror supports `editable={false}`/`readOnly` props at the
  call site level — implementation detail for dev, not decided here).

### New components needed (interface contracts only — no implementation)

**`TemplatesView`** (route-level, `/templates/page.tsx` → this component,
mirrors `SettingsShell`'s role for `/settings`)
- Owns: daemon session bootstrap (token/port from query string) + heartbeat
  start, same pattern as `SettingsShell`/`AppShell`.
- State: `selectedTemplate: TemplateListItem | null` (drives whether
  `TemplatePreviewModal` is open).
- Loads the bundled template manifest (client-side static import or a
  small loader util in `apps/web/src/lib/templates/` — architect to place;
  no RPC call).
- Renders: `AppNav`, three `TemplateSection`s, footer attribution line.

**`TemplateSection`**
- Props: `title: string` ("Skills" | "Agents" | "Commands"), `items:
  TemplateListItem[]`, `skippedReasons: { name: string; reason: string
  }[]`, `onSelect: (item: TemplateListItem) => void`.
- Renders a labeled section heading + grid/list of `TemplateCard`s +
  inline skipped-items warning line(s) (same visual idiom as
  `ImportReviewStep`'s `⚠ ... không parse được → bỏ qua (...)`).

**`TemplateCard`**
- Props: `name: string`, `description: string`, `kind: "skill" | "agent" |
  "command"`, `onClick: () => void`.
- Whole-card clickable button; kind badge in corner.

**`TemplatePreviewModal`** (the single multi-step dialog: T2 → T3 → T4/T5)
- Props: `template: TemplateListItem`, `onClose: () => void`.
- Internal `step: "preview" | "apply" | "result"` state machine — same
  shape idea as `CreateProjectDialog`'s `Step` type, scoped to this modal
  only (no cross-component step state).
- Sub-state: `copied: boolean`, `clipboardBlocked: boolean` (preview
  step); `selectedProjectId: string | null`, `projectSearch: string`
  (apply step); `applyResult: { projectName: string; finalName: string;
  wasRenamed: boolean } | null` (result step).
- Reads `projects` + `daemonConnected` from `useArtifactStore` (no new
  store slice needed for listing — already loaded at app boot per STATE's
  "no new RPC to enumerate projects" finding).
- Calls into store/RPC only on "Xác nhận áp dụng" — architect to decide
  exact action name (likely a new `applyTemplate` store action that wraps
  `scanClaudeDir`-equivalent parse + a name-collision-aware variant of
  `importArtifacts`; this doc does not prescribe the RPC contract).

**`TemplateMarkdownViewer`** (read-only sub-component used inside T2)
- Props: `content: string` (raw markdown incl. frontmatter), `kind`.
- Wraps CodeMirror read-only, exposes a ref or callback for "select all"
  fallback used by the clipboard-failure path.

**`ProjectPickerStep`** (sub-component of `TemplatePreviewModal`, used in
T3/T5 — could also be written as a standalone reusable component since
STATE explicitly notes "no extractable picker component today")
- Props: `projects: Project[]`, `selectedId: string | null`, `onSelect:
  (id: string) => void`, `search: string`, `onSearchChange: (v: string) =>
  void`, `daemonConnected: boolean`, `onCreateProjectRequested: () =>
  void` (for the zero-projects empty state).
- Renders either the radio-list (3.7), the daemon-down disabled variant
  (3.8), or the zero-projects empty state (3.9) based on props — pure
  presentational, same spirit as `ImportReviewStep`.

**`ApplyResultPanel`** (sub-component of `TemplatePreviewModal`, T4)
- Props: `projectName: string`, `finalName: string`, `wasRenamed:
  boolean`, `onOpenProject: () => void`, `onClose: () => void`.

### Open component question
No `Toast`/global-toast system exists anywhere in `apps/web` today — every
existing "success/error" surface (`CopyRunCommandDialog`, `MarkdownTab`,
`CreateProjectDialog`) uses an **inline `<p>` line with color convention**
(green-600 = success, destructive = error, amber-600 = warning). This
design follows that same convention rather than introducing a new Toast
primitive (`ApplyResultPanel` is an in-modal panel, not a toast). If the
architect/dev prefers a real toast system, that's a net-new piece of
infrastructure beyond this feature's scope — flagged, not assumed.

---

## 5. Interaction Notes

- **List loading**: bundled templates are static client-side data — no
  loading spinner expected for T1 itself (synchronous import). If the
  architect instead chooses a lazy-loaded JSON fetch for bundle size
  reasons, a simple inline "Đang tải mẫu…" line replaces the sections
  until ready — same idiom as `ImportScanningState`.
- **Card hover/focus**: cards get the same `hover:bg-muted` treatment used
  elsewhere (`ProjectSidebar` project rows, `AppNav` links) for visual
  consistency; keyboard-focusable (`<button>` element, not `<div
  onClick>`), Enter opens the modal.
- **Modal open/close**: standard `Dialog` Esc/backdrop-click behavior
  already implemented generically — reused as-is. Closing from any step
  resets all step/sub-state (no stale "copied"/"selected project" residue
  if reopened on a different template).
- **Copy markdown — success**: button itself does not change label (stays
  "Copy markdown", re-clickable for repeat copies); a `copied` flag drives
  a transient green confirm line below the viewer, mirroring
  `CopyRunCommandDialog`'s `{copied && <p className="text-green-600">...}`
  exactly. No auto-dismiss timer needed (line replaces itself once user
  triggers another state) — but if architect wants polish, a 2-3s fade is
  a reasonable add, not required for AC3.
- **Copy markdown — failure**: `clipboardBlocked` flag shows the amber
  fallback line AND triggers select-all on the markdown viewer content, so
  the user's next keystroke (Ctrl+C) "just works" — same pattern as
  `CopyRunCommandDialog`'s `<code className="select-all">`.
- **Áp dụng — Skills items**: button rendered with `disabled` (native
  HTML `disabled`, same visual treatment `Button`'s `disabled:opacity-50
  disabled:pointer-events-none` already gives for free) plus the inline
  "coming soon" note is always visible (not just on hover/click attempt)
  so the limitation is discoverable without trial-and-error.
- **Áp dụng → project picker transition**: in-place step swap within the
  same `Dialog`, not a close+reopen — avoids any flash/remount; `DialogTitle`
  text changes to reflect the step ("Áp dụng "X" vào dự án nào?").
- **Project picker search**: client-side substring filter on
  `project.name` (and maybe `.path`), always rendered (per STATE: "no hard
  cap assumed, note for architect" — rendering the search box
  unconditionally is simpler than computing a threshold and is harmless at
  low counts).
- **Project row selection**: single-select radio semantics; clicking a
  row selects it (does not immediately submit) — "Xác nhận áp dụng" stays
  the single confirm action, disabled until `selectedProjectId !== null`.
  This two-step (select, then confirm) avoids a misclick instantly
  mutating a project's store.
- **Daemon down during Apply step**: "Xác nhận áp dụng" is disabled
  (`daemonConnected === false`), inline warning line shown using the exact
  same red/⚠ tone as `DaemonStatusBadge`'s text so it reads as "the same
  problem you already know about," not a new error class. The project list
  itself still renders (from already-loaded `projects` state) so the user
  isn't staring at a blank list — they just can't submit yet. "Quay lại"
  and "Đóng" remain enabled (never trap the user in the modal).
- **Apply in-flight**: "Xác nhận áp dụng" button shows a brief disabled/
  loading state (label could swap to "Đang áp dụng…" or just disable +
  dim, matching `CreateProjectDialog`'s `creating`/`Đang tạo…` convention)
  while the store action is pending; prevents double-submit on slow
  daemon round-trips.
- **Apply success → auto-suffix collision**: result panel (T4) always
  states which project + which final name was used; the "wasRenamed"
  branch explicitly calls out *why* the name changed (matches the THINK
  #4 requirement: "show the user what name was actually used after
  applying"). This is the only feedback mechanism for collisions — no
  separate overwrite-confirmation dialog per the locked decision.
- **Apply success → "Mở dự án"**: since `/templates` and `/` are separate
  routes (THINK #6 — Templates is global, no active project required),
  clicking "Mở dự án" needs to (a) navigate to `/`, (b) once `AppShell`
  mounts/loads projects, auto-select the just-applied-to project. This is
  a cross-route handoff — simplest mechanism is a query param (e.g.
  `/?openProject=<id>`) that `AppShell` reads once on mount and calls
  `loadProject(id)`, then clears the param. Flagged for architect as a
  small but real piece of routing plumbing, not invented further here.
- **Zero-projects "Tạo dự án trước"**: same cross-route concern — clicking
  it needs to land the user on `/` with `CreateProjectDialog` already open.
  Cleanest version: navigate to `/?createProject=1`, `AppShell` reads that
  param once on mount and calls `setCreateOpen(true)`. After project
  creation succeeds there, the user is NOT automatically returned to
  `/templates` mid-apply (that flow is abandoned) — acceptable for v1 per
  STATE's framing ("offer a way to start the existing Create Project flow,"
  not "preserve full apply context across routes"); they can navigate back
  to Templates and retry Apply once their new project exists. This
  simplification should be confirmed acceptable — see Open Design
  Questions.
- **Malformed template (T1 / 3.3)**: rendered as a single summarizing
  warning line per section (not one line per file if many) once count
  grows, but for the expected v1 scale (a handful of vendored files) one
  line per skipped file mirrors `ImportReviewStep`'s existing per-file
  format closely enough to reuse that exact idiom unchanged. Section still
  fully renders its valid items above/around the warning — never blanks
  the whole section.
- **Empty section** (e.g. if Skills bundle ships with zero items at some
  point): section heading still renders with a muted "Chưa có mẫu nào
  trong mục này" line, same idiom as `ProjectSidebar`'s "∅ chưa có dự án" —
  never an entirely missing/collapsed section (keeps the "exactly three
  labeled sections" promise from AC1 true even in a degenerate bundle
  state).
- **Footer attribution**: plain text + external link (`target="_blank"
  rel="noreferrer"`), small/muted styling consistent with other secondary
  text in the app (e.g. `ProjectSidebar`'s path titles) — not a CTA, not
  emphasized.

---

## 6. Open Design Questions

These need a taste call before `architect` finalizes the plan. Where I
had to pick something to keep momentum, the pick is marked **DEFAULT
(pending feedback)** and is the option most consistent with existing
`AppShell`/`ProjectView` layout conventions — not a final decision.

1. **Section layout: stacked sections (current default) vs. Tabs vs. three
   columns?**
   **DEFAULT (pending feedback): single scrollable page, three stacked
   labeled sections** (§3.1), each with a card grid. Rationale: matches
   how `ProjectView`/`SettingsShell` already render single-column content
   under `AppNav` with no internal tab system; avoids hiding 2 of 3
   sections behind a click (Tabs) which works against AC1's "exactly
   three labeled sections, all visible/discoverable" framing; avoids
   three-column layout's risk of being cramped at the card-with-
   description content size shown in the request. Alternative: shadcn
   `Tabs` per section if the bundle grows large enough that one long
   scroll feels heavy — revisit once real template counts are known
   (currently expected to be small/fixed per STATE).

2. **Card grid density**: 2 cards per row (as drawn) vs. 3 per row vs.
   full-width single-column rows with description inline? Not decided —
   depends on how long real template descriptions end up being once
   `architect`/content-author writes the actual vendored set (THINK #3's
   "original example templates"). 2-column grid drawn here as a
   reasonable desktop-width default, not locked.

3. **Markdown viewer chrome**: should the read-only CodeMirror view in T2
   show line numbers / syntax-highlighted YAML frontmatter distinctly
   from the body, or render as one undifferentiated markdown block (as
   drawn)? `MarkdownTab` (editable case) doesn't currently visually
   separate frontmatter from body either — this design follows that
   precedent (no separation) but flags it as a place a designer/PM could
   want more polish later.

4. **Cross-route handoff for "Mở dự án" / "Tạo dự án trước"** (Interaction
   Notes above): the query-param approach (`/?openProject=<id>`,
   `/?createProject=1`) is a reasonable default but is genuinely an
   architecture decision (where the param is read, whether it's cleared
   from history, whether it conflicts with the existing `?t=<token>`
   daemon-session param already used on both routes) — flagging for
   `architect`, not deciding the mechanism here.

5. **Kind badge wording**: "Skill"/"Agent"/"Command" (English-ish loan
   words, as drawn) vs. full Vietnamese ("Kỹ năng"/"Tác nhân"/"Lệnh")?
   Existing app UI already mixes both registers (e.g. "Cài đặt" but also
   raw `kind` values like `agent`/`command` likely shown verbatim
   elsewhere in Builder) — not resolved here, a literal product-voice
   call.

## Future ideas (explicitly out of scope for this iteration — do not build)

- Search/filter across all template sections (per STATE's explicit
  out-of-scope list).
- Per-template "preview rendered" (WYSIWYG) toggle alongside the raw view.
- Toast/global notification system as standalone infrastructure (this
  design intentionally reuses the inline-`<p>` convention instead).
- Remembering "last applied project" to pre-select it next time Apply is
  used (small UX nicety, not requested).
