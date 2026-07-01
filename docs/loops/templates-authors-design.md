# templates-authors — Design

> Reads against `docs/loops/templates-authors-STATE.md` (phase: PLAN, THINK
> decisions 1-7 locked). Extends the shipped v1 design
> (`docs/loops/templates-marketplace-design.md`) and its real components:
> `apps/web/src/components/{TemplatesView,TemplateSection,TemplateCard,
> TemplatePreviewModal,ProjectPickerStep,ApplyResultPanel,AppNav}.tsx`,
> `apps/web/src/components/ui/{dialog,button,input}.tsx`.

No production code below — ASCII wireframes only, plus an interface-only
component breakdown for the architect. "ECC" is used throughout purely as
an opaque example author id/repo identifier (`affaan-m/ecc`) for wireframe
labeling — no actual ECC repo content is reproduced or invented anywhere in
this document. Any example item names shown for the ECC tab (e.g.
`ecc-example-item-1`) are clearly-fictional placeholders, not real content.

---

## 1. User Journey

1. User clicks **Templates** in `AppNav` (unchanged entry point) →
   navigates to `/templates`.
2. **NEW**: directly under the page header, an **Authors sub-nav** appears
   with at least two entries: **Symbion** (selected by default) and **ECC**.
   On first load, "Symbion" is active — the three Skills/Agents/Commands
   sections render exactly as in v1 today (same 12 items, zero network),
   because the Symbion bundle is static and already in memory. This is a
   pure regression check (AC1): a user who never touches the Authors
   sub-nav sees an experience byte-identical to the shipped v1 feature.
3. User clicks the **ECC** tab. Because this is the first time ECC has been
   selected this session, the sub-nav's three sections below switch to a
   **loading state** ("Đang tải mẫu từ ECC…") while a new daemon RPC fetches
   ECC's repo content live from GitHub. No request fires until this click
   (AC1's network-inspection requirement).
4. One of two outcomes after a bounded wait (architect to set a concrete
   timeout, e.g. 10s per STATE AC2):
   - **Success**: the three sections re-render scoped to ECC's content —
     possibly with one or two sections showing the existing v1 "Chưa có mẫu
     nào trong mục này" empty state if ECC has no content of that shape
     (FR6), and possibly a "X mẫu bị bỏ qua" skipped-summary line if some
     files didn't parse (extends v1's per-file skipped idiom).
   - **Failure**: a full-section-width error panel replaces the three
     sections, in one of three distinguishable shapes (generic network
     failure / GitHub rate-limit / malformed-structure-partial — see
     wireframes §3.3-3.5), each with a **"Thử lại"** retry button. Either
     way, the Authors sub-nav itself stays interactive — the user is never
     trapped on a broken tab.
5. User clicks back to **Symbion** tab — instant, no loading flash, because
   Symbion's content was never unloaded (it's the always-resident default,
   not even fetched/cached in the same sense as ECC).
6. User clicks **ECC** again — also instant, no spinner, no new network
   request, because THINK #3's in-session in-memory cache already holds
   the result from step 3/4. (If step 4 was a failure, the cached state is
   the *error*, shown immediately — not silently retried — until the user
   explicitly clicks "Thử lại.")
7. User clicks an ECC-sourced card (e.g. an Agent). `TemplatePreviewModal`
   opens — **identical to v1** (FR4): same markdown viewer, same Copy
   markdown button, same Skills-disabled-Apply rule if it's a Skill-shaped
   item.
8. User clicks **"Áp dụng"**. **NEW**: because this item's author is
   non-Symbion, the modal inserts a **license/attribution acknowledgment
   step** before (or merged into) the existing project-picker step — a
   clearly-worded statement naming the author/repo ("Mẫu này thuộc về tác
   giả ECC (affaan-m/ecc)…") plus a required checkbox. For a Symbion-
   authored item, this step is skipped entirely — flow goes straight to the
   existing project picker, unchanged from v1.
9. User reads the disclaimer, ticks the checkbox, picks a project (same
   picker UI as v1) — **"Xác nhận áp dụng"** stays disabled until both the
   checkbox is ticked AND a project is selected.
10. User clicks **"Xác nhận áp dụng"** → same daemon round-trip, draft-into-
    store, auto-suffix-on-collision behavior as v1 → same result panel
    (`ApplyResultPanel`), unchanged copy/shape (FR7, AC6).
11. User clicks **"Mở dự án"** → same cross-route handoff as v1.

---

## 2. Screen Inventory

| # | Screen/Modal | Entry trigger | Exit path |
|---|---|---|---|
| T1 | **Templates list view** (`/templates`) — now with Authors sub-nav | Click "Templates" tab in `AppNav` | Navigate away via nav tabs; stays mounted otherwise |
| **A1** | **Authors sub-nav** (part of T1, not a separate screen) | Always visible on T1 | Click another author tab → switches scoped content below, same screen |
| **A2** | **Author loading state** (variant of T1's section area) | First-time selection of a GitHub-backed author this session, or explicit retry | Resolves to A3 (success) or A4/A5/A6 (failure) automatically once fetch settles |
| **A3** | **Author success state** (= existing T1 sections, scoped) | Fetch resolves with ≥0 items | Switch author tab; click a card → T2 |
| **A4** | **Author error: generic network failure** | Fetch rejects (no specific GitHub signal) | "Thử lại" → back to A2; switch author tab → unaffected |
| **A5** | **Author error: GitHub rate-limited** | Fetch resolves 403 w/ rate-limit signal | "Thử lại" → back to A2 (likely still limited until reset); switch author tab → unaffected |
| **A6** | **Author error: malformed/partial content** | Fetch succeeds but contains unparseable items | Not a full block — see §3.5, this is actually a variant of A3 (success-with-warnings), listed separately only because STATE calls it a distinct first-class state |
| T2 | Template preview modal (markdown view, step 1) | Click any template card in T1, any author | Đóng/Esc/backdrop → T1; "Áp dụng" → **T3a (Symbion) or T3-license (non-Symbion)** |
| **T3-license** | **NEW: License/attribution acknowledgment step** | Click "Áp dụng" in T2 for a non-Symbion-authored item | Checkbox + "Tiếp tục" → T3 (picker, checkbox state carried); "Quay lại" → T2; Đóng/Esc → closes whole modal |
| T3 | Apply / project-picker step (step 2/3 of same modal) | From T2 directly (Symbion item) or from T3-license (non-Symbion item) | "Quay lại" → previous step; "Xác nhận áp dụng" success → T4; Đóng/Esc → closes whole modal |
| T4 | Apply result / confirmation | Successful apply from T3 | "Mở dự án" → navigate; "Đóng" → T1 |
| T5 | No-projects state (variant of T3) | Zero registered projects | unchanged from v1 |

T3-license is a **new step inserted into the existing `TemplatePreviewModal`
state machine**, not a new dialog — same architectural pattern v1 already
established for T2→T3→T4.

---

## 3. ASCII Wireframes

### 3.1 — T1 + A1: Templates list view with Authors sub-nav (Symbion active, default)

```
┌───────────────────────────────────────────────────────────────────────┐
│ Symbion   [ Builder ]  [ Templates ]  [ Cài đặt ]                     │ ← AppNav, unchanged
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Templates                                                             │
│  Thư viện mẫu agent / command / skill có sẵn — xem trước rồi áp dụng   │
│  vào dự án của bạn.                                                    │
│                                                                         │
│  ┌──────────┐┌──────────┐                                             │ ← NEW: Authors sub-nav
│  │ Symbion ●││  ECC      │                                             │   underline-tab style, "●" = active
│  └──────────┘└──────────┘                                             │   indicator under active tab
│  ─────────────────────────────────────────────────────────────────    │ ← thin border-b spanning full width
│                                                                         │   (active tab's underline reads as part
│  ── Skills ─────────────────────────────────────────────────────────  │   of this border, see §6 Q1)
│  ┌─────────────────────────────┐ ┌─────────────────────────────┐      │
│  │ commit-message               │ │ pr-description                │     │
│  │ Soạn commit message theo     │ │ Tạo mô tả PR từ diff theo     │     │
│  │ Conventional Commits.        │ │ chuẩn dự án.                  │     │
│  │                    [Skill]   │ │                      [Skill]  │     │
│  └─────────────────────────────┘ └─────────────────────────────┘      │
│                                                                         │
│  ── Agents ──────────────────────────────  (same as v1, unchanged)     │
│  ── Commands ────────────────────────────  (same as v1, unchanged)     │
│                                                                         │
│  ─────────────────────────────────────────────────────────────────    │
│  Lấy cảm hứng từ các bộ template cộng đồng (vd. ECC) ↗                │ ← footer attribution, unchanged
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

Note: footer attribution line becomes slightly redundant now that ECC is a
first-class tab, not just a footer link — kept as-is per "stay within
locked scope," flagged as a possible follow-up cleanup, not removed here.

### 3.2 — A2: ECC tab selected, first time this session — loading state

```
│  ┌──────────┐┌──────────┐                                             │
│  │ Symbion   ││  ECC ●    │                                             │ ← ECC now active
│  └──────────┘└──────────┘                                             │
│  ─────────────────────────────────────────────────────────────────    │
│                                                                         │
│                                                                         │
│                    ⟳  Đang tải mẫu từ ECC…                             │ ← centered, replaces all 3 sections
│                    Đang lấy nội dung trực tiếp từ                      │   while in flight; spinner = reused
│                    github.com/affaan-m/ecc                             │   spinner glyph idiom (matches
│                                                                         │   "Đang tạo…"/"Đang áp dụng…" verbs
│                                                                         │   used elsewhere in v1)
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

### 3.3 — A4: ECC fetch failure — generic network error

```
│  ┌──────────┐┌──────────┐                                             │
│  │ Symbion   ││  ECC ●    │                                             │
│  └──────────┘└──────────┘                                             │
│  ─────────────────────────────────────────────────────────────────    │
│                                                                         │
│              ⚠ Không thể tải mẫu từ ECC                                │ ← distinct heading per failure type
│              Không kết nối được tới GitHub. Kiểm tra kết nối mạng      │   (generic network framing, NOT
│              rồi thử lại.                                              │   reused for rate-limit/malformed)
│                                                                         │
│                        [ Thử lại ]                                     │ ← retry → back to A2 loading state
│                                                                         │
│  ℹ Tab "Symbion" vẫn hoạt động bình thường, không cần mạng.            │ ← reassurance line so user knows
│                                                                         │   other tabs aren't broken
└───────────────────────────────────────────────────────────────────────┘
```

### 3.4 — A5: ECC fetch failure — GitHub rate-limited

```
│  ┌──────────┐┌──────────┐                                             │
│  │ Symbion   ││  ECC ●    │                                             │
│  └──────────┘└──────────┘                                             │
│  ─────────────────────────────────────────────────────────────────    │
│                                                                         │
│              ⚠ Đã vượt giới hạn GitHub API                            │ ← distinct heading, rate-limit-specific
│              Symbion dùng GitHub API ở chế độ chưa xác thực (giới hạn  │   copy, never the generic line above
│              60 lượt/giờ). Giới hạn sẽ được làm mới lúc 14:32          │ ← reset time, IF GitHub's
│              (còn khoảng 23 phút).                                     │   X-RateLimit-Reset header is present;
│                                                                         │   see Open Design Question 3 for the
│                        [ Thử lại ]                                     │   "if header missing" fallback copy
│                                                                         │
│  ℹ Tab "Symbion" vẫn hoạt động bình thường, không cần mạng.            │
└───────────────────────────────────────────────────────────────────────┘
```

"Thử lại" here is allowed to be clicked even though it will likely fail
again before the reset window — not disabled, just honest (see Interaction
Notes for whether to soft-discourage repeat clicks).

### 3.5 — A6: ECC fetch succeeded, but with malformed/partial content

This is a **success state with warnings**, not a blocking failure screen —
sections render normally, with the existing v1 skipped-item idiom extended
to cover network-origin parse failures too.

```
│  ┌──────────┐┌──────────┐                                             │
│  │ Symbion   ││  ECC ●    │                                             │
│  └──────────┘└──────────┘                                             │
│  ─────────────────────────────────────────────────────────────────    │
│                                                                         │
│  ── Skills ─────────────────────────────────────────────────────────  │
│  Chưa có mẫu nào trong mục này.                                        │ ← v1's existing empty-bucket pattern,
│                                                                         │   reused verbatim per author (FR6)
│                                                                         │
│  ── Agents ─────────────────────────────────────────────────────────  │
│  ┌─────────────────────────────┐                                       │
│  │ ecc-example-item-1           │                                       │ ← fictional placeholder name only
│  │ (mô tả ví dụ, không phải nội │                                       │
│  │ dung thật của ECC)  [Agent]  │                                       │
│  └─────────────────────────────┘                                       │
│  ⚠ 3 mẫu không tải được → đã bỏ qua                         [Xem chi tiết] │ ← summarized count (extends v1's
│                                                                         │   per-file line; ECC's failure rate
│                                                                         │   may be much higher than v1's
│                                                                         │   near-zero rate, so a collapsed
│                                                                         │   summary + expandable detail avoids
│                                                                         │   visually flooding the page)
│                                                                         │
│  ── Commands ───────────────────────────────────────────────────────  │
│  ┌─────────────────────────────┐                                       │
│  │ /ecc-example-item-2          │                                       │
│  │ ...                  [Command]│                                       │
│  └─────────────────────────────┘                                       │
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

"Xem chi tiết" expands an inline list (one line per skipped file + reason,
same format as v1's per-file warning), collapsed by default once count
exceeds ~3 — see Interaction Notes.

### 3.6 — A6 variant: ECC fetch succeeded but ZERO items parsed at all

Distinguished from A4 (network failure) — the request succeeded, nothing
came back usable. Not the same message as "no internet."

```
│  ── Skills ──   Chưa có mẫu nào trong mục này.                         │
│  ── Agents ──   Chưa có mẫu nào trong mục này.                         │
│  ── Commands ─  Chưa có mẫu nào trong mục này.                         │
│                                                                         │
│  ⚠ Đã tải xong nhưng không có mẫu nào hợp lệ trong repo ECC            │ ← distinct from "couldn't reach
│  (12 tệp không tải được — không đúng định dạng).      [Xem chi tiết]   │   GitHub" — informs this is a content-
│                                            [ Thử lại ]                  │   shape problem, not a network one;
│                                                                         │   still offers retry in case it was a
│                                                                         │   transient partial-fetch glitch
```

### 3.7 — T3-license: NEW license/attribution acknowledgment step

Inserted between T2 (preview) and T3 (project picker) inside the same
`TemplatePreviewModal`, only for non-Symbion-authored items.

```
┌──────────────────────────────────────────────────────────┐
│ Áp dụng "ecc-example-item-1"                                │ ← DialogTitle, step-specific
├──────────────────────────────────────────────────────────┤
│                                                              │
│  ⚠ Nội dung của tác giả khác                                 │ ← warning-toned heading, not destructive
│                                                              │   red — informational/legal, not an error
│  Mẫu này thuộc về tác giả ECC (affaan-m/ecc) — bạn tự chịu  │ ← exact required wording per THINK #5,
│  trách nhiệm về việc sử dụng lại nội dung này.               │   shown prominently, not small print
│                                                              │
│  Symbion chỉ hiển thị nội dung này trực tiếp từ GitHub và    │ ← supporting context line, explains
│  không lưu trữ hay sở hữu nội dung của tác giả ECC.          │   the "live-fetch never vendored"
│                                                              │   posture in plain language
│                                                              │
│  ┌──┐                                                       │
│  │✓ │ Tôi đã đọc và đồng ý chịu trách nhiệm khi áp dụng mẫu │ ← REQUIRED checkbox, unchecked by
│  └──┘ này vào dự án của tôi.                                 │   default every time this step is shown
│                                                              │   (not remembered across items/sessions
│                                                              │   — see Interaction Notes)
│                                                              │
│  Xem repo gốc: github.com/affaan-m/ecc ↗                     │ ← outbound link to source repo
│                                                              │
├──────────────────────────────────────────────────────────┤
│              [ Quay lại ]                  [ Tiếp tục ]    │ ← "Tiếp tục" disabled until checkbox
└──────────────────────────────────────────────────────────┘    is ticked; advances to T3 (picker)
```

### 3.8 — T3-license variant: same step, combined-with-picker option (alternate layout, NOT the default — see Open Design Q1)

Shown for completeness since "or combined with it" was explicitly allowed
by the task — drawn as an alternative in case the architect/user prefers
fewer modal steps over a strictly separate gate screen.

```
┌──────────────────────────────────────────────────────────┐
│ Áp dụng "ecc-example-item-1" vào dự án nào?                  │
├──────────────────────────────────────────────────────────┤
│ ⚠ Mẫu này thuộc về tác giả ECC (affaan-m/ecc) — bạn tự chịu │ ← disclaimer banner pinned above
│   trách nhiệm về việc sử dụng lại nội dung này.    [chi tiết]│   the picker, same step as v1's T3
│ ┌──┐ Tôi đồng ý chịu trách nhiệm khi áp dụng mẫu này.        │ ← checkbox inline, above picker list
│ └──┘                                                         │
├──────────────────────────────────────────────────────────┤
│ ( 🔍 Tìm dự án...                                        ) │
│ (•) my-api-service        …/code/my-api-service             │ ← rest identical to v1's T3 (3.7 in
│ ( ) geochat                …/code/geochat                    │   v1 design doc)
├──────────────────────────────────────────────────────────┤
│              [ Quay lại ]              [ Xác nhận áp dụng ]│ ← "Xác nhận áp dụng" disabled until
└──────────────────────────────────────────────────────────┘    BOTH checkbox ticked AND project picked
```

### 3.9 — T2 preview modal, ECC item: attribution badge already visible at preview time

Small addition to the existing T2 preview step (not a new screen) so the
author identity is visible **before** the user even clicks Áp dụng, not
sprung on them only at the gate:

```
┌──────────────────────────────────────────────────────────┐
│ ecc-example-item-1                                    [Agent]│
│ (mô tả ví dụ — placeholder, không phải nội dung thật)        │
│ Nguồn: ECC (affaan-m/ecc) ↗                                  │ ← NEW: small author/source line,
├──────────────────────────────────────────────────────────┤   muted style, under description —
│ (same read-only markdown viewer as v1)                      │   appears ONLY for non-Symbion items;
│                                                              │   Symbion items show nothing extra here
│                                                              │   (unchanged from v1)
├──────────────────────────────────────────────────────────┤
│                          [ Đóng ]  [ Copy markdown ]  [ Áp dụng ]│
└──────────────────────────────────────────────────────────┘
```

---

## 4. Component Breakdown

### Reused, unchanged
- `Dialog`/`DialogHeader`/`DialogTitle`/`DialogFooter`, `Button`, `Input`
  — same as v1, no change.
- `TemplateCard` — no change; same component renders cards regardless of
  author (it has no opinion about source, per FR4's "modal doesn't need to
  know where the string came from" principle, extended to the card too).
- `ApplyResultPanel` — no change (T4 stays identical regardless of author,
  AC6).
- `AppNav` — no change (Authors sub-nav lives one level below this, inside
  T1's content area, not in the global nav).

### Modified existing components

**`TemplatesView`**
- NEW state: `selectedAuthorId: string` (default `"symbion"`).
- NEW state: `authorCache: Record<authorId, AuthorFetchState>` where
  `AuthorFetchState` is a discriminated union: `{ status: "idle" } |
  { status: "loading" } | { status: "error"; kind: "network" |
  "rate-limit" | "not-found"; message: string; resetAt?: number } |
  { status: "success"; items: TemplateListItem[]; skipped: SkippedItem[] }`.
  This cache IS the in-session memory cache from THINK #3 — keyed by
  author id, lives in this component's (or a small author-fetch store
  slice's) state, cleared on page refresh by virtue of being in-memory
  React/store state, never persisted.
- On author tab click: if `authorCache[id].status` is already `"success"`
  or any `"error"` variant, just switch `selectedAuthorId` — no fetch. If
  `status` is `"idle"` (never fetched this session) or the user explicitly
  clicked "Thử lại" (which resets that entry to `"idle"` then immediately
  triggers fetch), call the new RPC/store action.
- For `"symbion"`, no cache entry is needed at all — it's the existing
  synchronous `loadTemplateManifest()` call, always `"success"`,
  effectively immutable. (Simplest mental model: `authorCache` only ever
  holds entries for GitHub-backed authors.)
- Passes `selectedAuthorId`, current author's `AuthorFetchState`, and
  `onSelectAuthor`/`onRetryAuthor` callbacks down to the new `AuthorTabs`
  and conditionally renders either the existing 3×`TemplateSection` block
  (success) or the new loading/error panels.

**`TemplatePreviewModal`**
- `Step` type extended: `"preview" | "license" | "apply" | "result"` (or,
  if §3.8's combined layout is chosen instead, `"apply"` step itself grows
  an internal `acknowledged: boolean` sub-state — architect to pick one of
  the two layouts per Open Design Question 1; this doc defaults to the
  separate-step version, §3.7, as more consistent with v1's existing
  "small focused step per concern" pattern, e.g. preview vs. apply already
  being separate steps).
- NEW state: `licenseAcknowledged: boolean` (reset to `false` whenever a
  new `template` prop is passed in — i.e. every time a different item is
  opened, never remembered across items, see Interaction Notes).
- `handleOpenApplyStep()` branches: if `template.authorId !== "symbion"` →
  `setStep("license")`; else → `setStep("apply")` (unchanged v1 path).
- New transition: `"license"` step's "Tiếp tục" → `setStep("apply")`,
  only enabled once `licenseAcknowledged === true`.
- `handleConfirmApply()` gains a defensive guard: if `template.authorId !==
  "symbion"` and `!licenseAcknowledged`, no-op (defense in depth — the
  button should already be unreachable, but the gate is enforced at the
  data layer too, not just via disabled-button UI).
- `TemplateListItem` type (consumed, not owned by this component) needs a
  new field for this to work: something like `authorId: string` +
  `authorDisplayName: string` + `authorRepo?: string` (e.g.
  `"affaan-m/ecc"`) — architect to confirm exact shape, flagged in Open
  Component Question below.

### New components needed (interface contracts only)

**`AuthorTabs`**
- Props: `authors: { id: string; label: string }[]`, `selectedId: string`,
  `onSelect: (id: string) => void`.
- Pure presentational tab row, renders the underline-tab style from §3.1.
  Does NOT own fetch logic or cache state — purely a controlled tab
  selector, same spirit as `ProjectPickerStep` being presentational-only.

**`AuthorFetchLoadingState`**
- Props: `authorLabel: string`, `repoIdentifier?: string` (e.g.
  `"github.com/affaan-m/ecc"`, shown only for GitHub-backed authors).
- Renders the centered spinner block (§3.2).

**`AuthorFetchErrorPanel`**
- Props: `kind: "network" | "rate-limit" | "not-found"`, `message: string`,
  `resetAt?: number` (epoch ms, for rate-limit countdown), `onRetry: () =>
  void`.
- Renders one of §3.3/§3.4 (and a `"not-found"` variant for the
  repo-renamed/deleted/private edge case from STATE §5, not separately
  wireframed above but same visual shape as 3.3 with different copy:
  "Không tìm thấy repo affaan-m/ecc — có thể đã đổi tên hoặc chuyển sang
  riêng tư."). Computes/formats the human-readable reset time from
  `resetAt` internally (e.g. "14:32 (còn khoảng 23 phút)") — pure
  presentational, no polling/timer needed beyond what's described in
  Interaction Notes.

**`AuthorSkippedSummary`**
- Props: `count: number`, `items: SkippedItem[]` (same shape as v1's
  existing skipped-item type), `expanded: boolean`, `onToggleExpanded: ()
  => void`.
- Renders the collapsed "⚠ N mẫu không tải được → đã bỏ qua [Xem chi
  tiết]" line + expandable per-file detail list (§3.5). For small counts
  (v1's existing scale), this can also just always render expanded —
  threshold for collapsing is a judgment call, default to "collapse above
  3" pending feedback.

**`LicenseAcknowledgmentStep`** (the new T3-license content, §3.7)
- Props: `authorDisplayName: string` (e.g. `"ECC"`), `authorRepo: string`
  (e.g. `"affaan-m/ecc"`), `acknowledged: boolean`, `onAcknowledgedChange:
  (v: boolean) => void`, `onBack: () => void`, `onContinue: () => void`.
- Pure presentational, same spirit as `ProjectPickerStep` — no RPC calls,
  caller (`TemplatePreviewModal`) owns the step transition.

### Daemon/data-layer interface implied (flagged for architect, not designed here)
- A `TemplateListItem` needs `authorId`/`authorDisplayName`/`authorRepo?`
  fields added — this is the one IR-adjacent shape change this design
  doc's wireframes depend on; exact typing left to architect per STATE
  §1's note that `applyTemplate`'s `sourceTemplateId` shape is also an
  open architecture question.
- A new RPC/store action (name TBD by architect, e.g.
  `fetchAuthorTemplates(authorId)`) returning a shape compatible with
  `AuthorFetchState`'s `"success"`/`"error"` variants above, including
  enough error detail (network vs. 403-rate-limit vs. 404-not-found,
  plus GitHub's `X-RateLimit-Reset` header value when present) for
  `AuthorFetchErrorPanel` to render the right copy without the UI layer
  re-deriving error classification itself.

### Open component question
Should `AuthorTabs` + the author-cache state live inside `TemplatesView`
directly (as drawn above, consistent with v1's "no new store slice for
list-level concerns" precedent) or as a new small Zustand store slice
(`useArtifactStore`'s `authorTemplates` cache) so the cache could
theoretically survive a `TemplatePreviewModal` remount or be reused
elsewhere later? Default: keep it in `TemplatesView`'s own state (simplest,
matches v1's existing pattern of not over-centralizing route-local state),
flagged for architect to override if there's a reason the cache needs to
outlive this one component tree.

---

## 5. Interaction Notes

- **Tab switching is always synchronous from the UI's perspective for
  already-resolved authors**: clicking a tab whose `AuthorFetchState` is
  `"success"` or any `"error"` variant updates `selectedAuthorId`
  immediately, zero loading flash, zero RPC call — this is the literal
  mechanism satisfying THINK #3 ("switching away and back...should NOT
  show a loading spinner again").
- **First selection vs. retry are the same code path**: both transition
  the cache entry to `"loading"` and call the fetch action; the only
  difference is *when* they're triggered (automatically on first tab
  click vs. explicitly via the "Thử lại" button). No separate "refresh"
  concept needs inventing.
- **Retry after rate-limit**: "Thử lại" is not disabled even when
  `resetAt` is in the future (honesty over hand-holding — GitHub's actual
  rate-limit window could already be partially consumed by other
  Symbion-using processes on the same network, so client-side countdown
  enforcement could be wrong); but consider a soft microcopy nudge under
  the button ("Có thể vẫn bị giới hạn cho đến giờ làm mới ở trên") rather
  than hard-blocking the action — pending feedback, not locked.
- **Rate-limit reset countdown**: static text computed once when the error
  state is rendered (e.g. "còn khoảng 23 phút"), NOT a live-ticking
  countdown timer — avoids unnecessary re-render churn for a value that
  doesn't need second-level precision; if the user leaves the tab and
  comes back, the relative text recomputes from the cached `resetAt`
  epoch at that render, so it stays roughly accurate without a `setInterval`.
- **Malformed-content summary collapse threshold**: collapse to a single
  summary line above 3 skipped items (architect/dev can tune this number);
  below that, show each skipped file inline like v1 does today — avoids
  both "wall of warnings" on a bad day and unnecessary collapsing for the
  common small-N case.
- **License checkbox is per-item, never remembered**: opening the
  disclaimer step for `ecc-example-item-1`, ticking it, applying, then
  later opening `ecc-example-item-2` shows an unticked checkbox again —
  deliberately not remembered across items or across the session, even
  though it's mildly more friction, because the disclaimer's whole purpose
  is per-item informed acknowledgment (THINK #5's exact wording references
  "this content," singular) — a "don't ask again" shortcut would undercut
  the stated intent. This is a judgment call worth confirming with the
  user if they push back on the friction (see Open Design Questions).
- **"Tiếp tục"/"Xác nhận áp dụng" disabled-until-acknowledged visual
  treatment**: identical disabled-button convention already used
  everywhere else in this modal (`Button`'s native `disabled:opacity-50
  disabled:pointer-events-none`) — no new visual language invented. The
  checkbox itself uses whatever the project's existing checkbox primitive
  is (if `apps/web/src/components/ui/` has no `Checkbox` yet, this is a
  new shadcn primitive to add — flagged for architect, not a custom
  control).
- **Symbion items skip the license step entirely**: `handleOpenApplyStep`
  branches before any new UI is shown — a Symbion-authored item's Apply
  flow is pixel-identical to v1, zero added friction, per THINK #5's exact
  scope ("does NOT apply to Symbion-authored items").
- **Author attribution visible at preview time too (§3.9)**: small addition
  so the disclaimer at Apply-time isn't the user's first encounter with
  "this isn't Symbion's own content" — surfaces it earlier/lower-stakes
  too, consistent with STATE's framing that browse-time attribution
  (v1's footer link) was already considered necessary-but-insufficient on
  its own, now extended per-item.
- **Loading state does not block the Authors tab row itself**: while ECC
  is loading, "Symbion" tab remains clickable (switches away from the
  in-flight ECC fetch instantly, the fetch continues in the background and
  resolves into the cache whenever it completes — switching back to ECC
  later shows the now-resolved result, not a re-triggered loading state,
  unless the user left before it resolved and the fetch was somehow
  aborted, which is not the default behavior here).
- **Empty bucket vs. error are visually distinct**: an author with zero
  Skills-shaped content (FR6, e.g. ECC might genuinely have none) shows
  the same muted one-line "Chưa có mẫu nào trong mục này" as v1 — calm,
  not alarming. A full fetch failure (A4/A5) replaces ALL three sections
  with the error panel, not a per-section empty state — the distinction
  matters: "this bucket is empty" (normal) vs. "we couldn't get anything"
  (abnormal) should never look the same.

---

## 6. Open Design Questions

1. **License step: separate gate screen (§3.7, this doc's default) vs.
   merged-into-picker banner (§3.8)?** DEFAULT (pending feedback):
   **separate step** — most consistent with v1's existing pattern of
   keeping each modal step focused on one concern (preview is just
   preview, apply is just apply) rather than stacking a legal disclaimer
   on top of an already-busy picker screen. The merged variant saves one
   click but risks the disclaimer being skimmed/missed amid the project
   list. Flagged because this is exactly the kind of "taste call" the task
   asked not to silently guess on if it materially changes user friction.

2. **Authors sub-nav visual style: underline tabs (drawn, §3.1) vs. pill/
   segmented-control tabs vs. a simple `Select` dropdown?** DEFAULT
   (pending feedback): **underline tabs**. `AppNav`'s own active-state
   convention is a filled pill (`bg-primary`), but reusing that exact same
   filled-pill look one level down (for the Authors sub-nav) risks visually
   competing with `AppNav` itself for "this is the main navigation" status.
   An underline-tab treatment (active tab gets a border-bottom accent,
   inactive tabs are plain text) reads as clearly subordinate to `AppNav`
   while still being a first-class, always-visible affordance (not hidden
   in a dropdown, which would undercut "Authors" being a prominent,
   discoverable concept per the STATE's framing of multi-source as a
   core, not buried, feature). This is the single most visible new UI
   element this feature adds — worth explicit confirmation rather than
   silent commitment.

3. **Rate-limit reset time when GitHub's `X-RateLimit-Reset` header is
   unavailable/unreliable** (e.g. daemon-side fetch library doesn't expose
   it, or the 403 isn't actually rate-limit-shaped): what's the fallback
   copy? This doc assumes a fallback like "thử lại sau ít phút" (no
   specific time) for that case, but the exact wording is a product-voice
   call, not designed in detail here.

4. **Collapsed-skipped-items threshold** ("above 3" suggested in
   Interaction Notes) — arbitrary placeholder number, not a researched or
   user-confirmed value.

5. **Should the license checkbox state be remembered per-author for the
   rest of the session** (so re-applying a second ECC item later in the
   same session doesn't require re-ticking), rather than strictly
   per-item as drawn? This doc defaults to strictly per-item (safer,
   more literal reading of THINK #5) but flags that "per-author-per-
   session" is a reasonable, less-frictiony alternative if the user
   considers per-item too repetitive in practice.

## Future ideas (explicitly out of scope — do not build)

- Search/filter across authors or within an author's sections (still out
  of scope per original v1 STATE, reaffirmed here).
- A visible GitHub API rate-limit budget indicator ("42/60 requests
  remaining this hour") — STATE's scope doesn't ask for this, flagged
  only because it's a natural extension of the rate-limit error UI if the
  product wants more proactive visibility later.
- Per-author "last fetched at HH:MM" timestamp + manual "refresh" distinct
  from "retry" (retry-on-error already covers the only refresh case this
  feature's scope requires).
- Self-service "add a GitHub repo as an author" UI (explicitly out of
  scope per THINK #2/#4 — hardcoded list only for this version).
