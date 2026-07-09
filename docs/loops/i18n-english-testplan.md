# i18n-english — Test plan

## Automated
- `npm run build` — passes clean across core / daemon / web (no type errors introduced by string edits).
- Existing unit/integration tests still pass (`npm test` in daemon + core) — especially any that assert on error messages; update assertions that referenced Vietnamese literals.

## Load-bearing string
- `e2e/daemon-fixture.ts` `URL_RE` updated to match the new English banner `"Symbion daemon running: <url>"`. Verify the regex still captures url + port + token groups.

## Verification sweep
- Grep for residual user-visible Vietnamese in scoped surfaces:
  - `apps/web/src/components`, `apps/web/src/lib`
  - `apps/daemon/src` (non-comment lines)
  - `packages/core/src/generate`
- Zero matches on real Vietnamese words in non-comment/string lines = pass.

## Manual smoke (deferred — v1, no run engine)
- Not required for this text-only change; build + grep sweep is sufficient signal.
