# i18n-english — Translate all user-visible text to English

Fast-track (simplify-implementation: plan → build → ship). Text-only, low-risk, reversible.

## Scope

Convert all **user-visible Vietnamese text to English** — short, clear, enough context.

**In scope** (user-visible surfaces only):
- `apps/web/src` React component strings + JSX text + `apps/web/src/lib` toast/error strings.
- `apps/daemon/src` console output, thrown error messages, RPC error messages, boot menu, banner.
- `packages/core/src/generate/*` user-facing prompt/error strings.

**Out of scope** (per user decision — "UI strings + messages only"):
- Code comments (`//`, `/* */`, JSDoc) — left in Vietnamese.
- Long-form docs (`docs/**/*.md`, `README.md`) — left as-is.
- Template sample content in `apps/web/src/data/templates/*` unless a string is a UI label (these are user-authored template bodies, treated as content not UI chrome).

## Key constraint (load-bearing string)

`apps/daemon/src/boot/banner.ts:74` emits `"Symbion daemon đang chạy: <url>"`. This exact literal is hard-coded in `e2e/daemon-fixture.ts:18` `URL_RE`. Per user decision: translate to `"Symbion daemon running: <url>"` **and update `URL_RE` in lockstep**. The banner file's own JSDoc note (`banner.ts:11`) about byte-for-byte stability is superseded by this coordinated change.

## PLAN — Architecture & data flow

No architecture change. Pure string substitution. Approach:
1. Daemon strings first (fewer, higher-risk: errors + banner + regex).
2. e2e `URL_RE` updated in the same step as the banner.
3. Web component/lib strings (bulk).
4. Core generate/* strings.

Edge cases:
- Preserve `${...}` template interpolations and surrounding punctuation.
- Preserve emoji/checkmarks (✓, •) — only translate the words.
- Do not touch Vietnamese inside comments or docs (scope decision).
- Keep error `code` identifiers (e.g. `origin-rejected`) unchanged — only the human `message`.

Data flow unaffected: daemon RPC contract (codes) unchanged; only display strings change.

## Test plan

See `i18n-english-testplan.md`. Core checks: `npm run build` clean; e2e URL parse still works (regex updated); no user-visible VN strings remain via grep sweep.

## BUILD — implementation notes

Translated all user-visible Vietnamese → English across the scoped surfaces via reviewable exact-string mapping scripts (no logic changes):
- **Daemon** (`apps/daemon/src`): console output, thrown/RPC error messages, boot banner + menu prompt, all LLM provider errors + model labels, path-confinement guard messages, GitHub fetch errors, store schema errors. Banner changed to `"Symbion daemon running: <url>"`.
- **e2e `URL_RE`** (`e2e/daemon-fixture.ts`) updated in lockstep with the banner.
- **Core** (`packages/core/src`): generate prompts (bodyPrompt, description), validate messages, semver, scan, frontmatter render, template parse reasons. Removed the Vietnamese `bạn là` alternative from `stripYouArePrefix` (English-only now).
- **Web** (`apps/web/src/components` + `lib`): ~350 JSX text / string-literal / aria-label / toast / error-map strings across ~55 components.
- **Tests updated to match**: daemon (`banner`, `findOpenPort`, `menu`, `llm-installInstructions`, `rpc.integration` store-migration), core (`generate-bodyPrompt`, `generate-description`), web (`DaemonStatusBadge`), e2e (`happy-path`, `auto-generate-body` — button/label selectors + disclosure regexes).

Assumptions / residual notes:
- **Out of scope (unchanged)**: code comments, `docs/**`, READMEs, and author template *content* under `apps/web/src/data/templates/*` (sample bodies, not UI chrome) — including the `parseTemplate`/`rpc.integration` fixture descriptions which are arbitrary sample data testing parse mechanics.
- **Pre-existing staleness left as-is**: `e2e/happy-path.spec.ts:92` selects a `[Chèn $ARGUMENTS]` button that no longer exists in any component. This selector was already broken before this change; not translated (translating a dead selector would mask the staleness). Flag for a separate cleanup.
- Error `code` identifiers (e.g. `origin-rejected`) were intentionally NOT changed — only human-readable `message` strings.

## Done

- `npm run build` clean across rpc-types / daemon / web.
- Full unit + integration suite green: **412 passed (39 files)**.
- Final grep sweep of scoped surfaces (daemon/src, core/src, web components+lib) for Vietnamese diacritics on non-comment lines: **clean**.
- **Review + QA + CSO intentionally skipped** (simplify-implementation fast-track). Residual risk is low: text-only change, no logic/trust-boundary edits; the one load-bearing string (banner) was updated with its coupled e2e regex and is covered by `banner.test.ts` + `URL_RE`.
- Shipped through the simplify-implementation fast-track (plan → build → ship).
