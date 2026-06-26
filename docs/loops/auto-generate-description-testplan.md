# Auto-generate description — Test Plan

> Source: PLAN in `docs/loops/auto-generate-description-STATE.md` §10. Acceptance criteria in STATE §6 (AC-1..AC-8). Edge cases in STATE §4/§10.7 (EC-1..EC-9).

## 1. Unit tests — `packages/core/test/generate-description.test.ts` (Vitest)

Pure function `generateDescription()` — deterministic input/output table:

| Case | Input | Expected output shape |
|---|---|---|
| Agent, body+tools | `{kind:"agent", name:"x", body:"You are a reviewer.\nDo X", tools:["Read","Grep"]}` | `"Agent that uses Read, Grep to a reviewer."` (single line, ends with `.`) |
| Agent, tools only (empty body) | `{kind:"agent", name:"x", body:"", tools:["Bash"]}` | `"Agent that uses Bash."` |
| Agent, body only (no tools) | `{kind:"agent", name:"x", body:"Reviews code", tools:[]}` | `"Agent that reviews code."` |
| Agent, name-only fallback (EC-1) | `{kind:"agent", name:"foo", body:"", tools:[]}` | `"Mô tả cho foo."` |
| Agent, fully empty (degenerate) | `{kind:"agent", name:"", body:"", tools:[]}` | `"Mô tả tự động."` |
| Command, body present | `{kind:"command", name:"x", body:"Run tests"}` | `"Command that run tests."` |
| Command, name-only fallback | `{kind:"command", name:"deploy", body:""}` | `"Mô tả cho /deploy."` |
| Command, fully empty | `{kind:"command", name:"", body:""}` | `"Mô tả tự động."` |
| Multi-line body (EC-4) | body contains `\n` | output contains no `\n`, single line |
| Long body (EC-4) | body clause > 200 chars after assembly | output capped at 200 chars, ends in `.`, no mid-word cut |
| customFields with `model` | `customFields:[{key:"model", value:"claude-opus-4"}]` | output ends with `(model: claude-opus-4).` before final period handling |
| Determinism | same input called twice | byte-identical output both times |
| Never throws | malformed/null-ish runtime input | returns a string, does not throw |

## 2. E2E tests — `e2e/auto-generate-description.spec.ts` (Playwright, daemon-fixture pattern)

| # | Scenario | Maps to |
|---|---|---|
| T1 | Open Agent Builder, fill name+body+tools, empty description, click generate icon → description fills directly (no confirm dialog) | AC-2, EC-1 |
| T2 | Type a custom description, click generate → confirm dialog appears with "Văn bản mô tả hiện tại sẽ được thay thế — tiếp tục?"; clicking "Hủy" leaves original text untouched | AC-3, EC-2 |
| T3 | Same as T2 but click "Thay thế" → description replaced with generated text | AC-3, EC-2 |
| T4 | Click generate icon rapidly twice in succession → only one apply/dialog-open occurs, no duplicate/garbled state | AC-4, EC-5 |
| T5 | Open Workflow Builder, empty description, fill body only, click generate → description fills with `"Command that ..."` phrasing, no tools-related text | AC-1, AC-2 (command form) |
| T6 | Generated description is then editable like any normal text, and survives through Save (`saveArtifact`) and into Publish diff preview | AC-6, AC-8 |
| T7 | Icon is visible and clickable even when daemon is disconnected (`DaemonStatusBadge` red banner state) | EC-9 |
| T8 | No network requests are made when clicking generate (assert via Playwright network listener — zero requests fired by the click) | AC-7, EC-3/EC-7 (vacuous-by-design verification) |

## 3. Build/lint gates

- `npm run build` passes for all three workspaces (no daemon changes, but `packages/core` barrel export must still typecheck against `apps/web`'s import).
- `npx vitest run` — all existing + new unit tests pass.
- `npx playwright test` — all existing + new e2e specs pass.

## 4. Manual smoke (QA phase)

- Visually confirm the sparkle icon sits flush-right of the `description *` input on both forms, matches existing `Button`/`Input` sizing (no layout shift/overflow).
- Confirm Vietnamese copy in the confirm dialog renders correctly (no encoding issues).
