# tokenless-daemon — STATE

Fast-track (simplify-implementation: plan → build → ship). Trivial, reversible change.

## Scope

**Problem (traced):** The daemon mints a per-boot random session token and hands it to the
web app via the `?t=<token>` URL query param. On first load the web app reads the token into
an in-memory module variable (`cachedToken`) and then *strips* `?t=` from the URL bar via
`history.replaceState`. On **F5 refresh** the JS module reloads → `cachedToken` resets to `null`
→ and the URL no longer carries `?t=` (it was stripped) → there is no way to recover the token
→ every RPC returns **401 unauthorized** → the UI enters the "session expired" dead state.
Net effect: **refreshing the page kills Symbion.**

**Decision (user, 2026-07-09):** Remove the session token entirely. Symbion is a single-user,
purely-local tool. The real security boundary is retained:
- HTTP server binds `127.0.0.1` **only** (never `0.0.0.0`) — no LAN exposure.
- Origin/Host **allowlist** (`isAllowedHost`) as anti-DNS-rebinding defense.

The per-boot token was redundant defense-in-depth on top of those two, and it is the single
thing that breaks on refresh. Removing it yields "one port, no token" → F5 survives.

**Explicitly out of scope:** LLM provider API keys (`x-...`/bearer tokens in `apps/daemon/src/llm/*`)
— those are unrelated secrets, untouched.

## ⚠️ Process note — Checkers intentionally skipped

This change touches the **daemon RPC auth boundary** (a trust boundary). Per
`/simplify-implementation`'s own guardrail and CLAUDE.md, that normally warrants the full
pipeline with independent `/review` + `/qa` + `/cso`. The user explicitly chose **fast-track anyway**.

**Residual risk (accepted):** After this change, ANY process on the local machine that can reach
`127.0.0.1:<port>` and send an allowlisted `Origin`/`Host` header can drive every RPC — including
filesystem-writing methods — without a secret. Mitigations that remain: loopback-only bind (no
remote access), Origin/Host allowlist, per-write diff-preview + backup + path-confinement (the
filesystem-safety mandate is unchanged). For a single-user local dev tool this is the same trust
model as any localhost dev server. If Symbion ever gains multi-user / remote / shared-host
deployment, the token (or a real auth scheme) MUST be reintroduced — this is a deliberate
single-user simplification, not a general security posture.

## 6. PLAN — Architecture

**Daemon (`apps/daemon`):**
1. `server.ts`
   - Remove `generateToken()` + the `token` field from `DaemonServerHandle`.
   - Remove the `x-symbion-token` auth gate (the `authHeader !== token` 401 block) in the request handler.
   - Keep `isAllowedHost` Origin/Host allowlist checks and the `127.0.0.1`-only bind — **unchanged**.
   - `READ_ONLY_METHODS` set / `ping` special-casing become moot for auth; simplest is to keep the
     set as documentation but drop the auth branch entirely. (Decision: remove the auth branch; the
     set no longer gates anything, so drop it too to avoid dead code — verify no other reader.)
2. `index.ts` — build the URL as `http://127.0.0.1:${handle.port}/` (no `?t=`). Drop the `handle.token` read.

**Web (`apps/web`):**
3. `lib/rpc/client.ts`
   - Remove `cachedToken`, `initDaemonSession`, `hasSession`, and the `x-symbion-token` header.
   - Keep `cachedPort` / `getDaemonOrigin` port handling (port still needed).
   - Decision: keep a no-arg `initDaemonSession(port)` OR remove it and set port another way.
     Simplest: keep `initDaemonSession(port: number)` that only records the port (callers already
     pass port), drop the token param + `hasSession`.
4. `AppShell.tsx`, `SettingsShell.tsx`, `TemplatesView.tsx`
   - Drop reading `?t=` and the `searchParams.delete("t")` strip. Keep the port derivation +
     the `openProject`/`createProject` handoff params (AppShell only) — those are unrelated.
5. `lib/store/useArtifactStore.ts`
   - `sessionValid` collapses to "always valid once reachable." Simplify: heartbeat becomes
     ping-only; on ping success → `reportConnectionOk`, on failure → `reportConnectionError`.
   - Remove the `hasSession()` short-circuit (step 2 of `tick`) and the `unauthorized`-specific
     branch in `reportConnectionError` (no 401 path exists anymore). `sessionValid` can stay in
     the shape (kept `true`) to avoid touching ~11 consumers, or be removed — decide during build
     to minimize churn. Prefer: keep the field, always `true` when reachable, delete dead 401 logic.
6. `DaemonStatusBadge.tsx` — the "session expired / lấy URL/token mới" copy referencing a stale
   token no longer applies; simplify to the plain daemon-unreachable message.

**Data flow after change:** browser loads `http://127.0.0.1:<port>/` → RPC POST `/rpc` with only
`Content-Type` + allowlisted Origin/Host → daemon checks Origin/Host → runs handler. No token in
the loop at any point. F5 = identical clean load.

**Edge cases:**
- Old bookmarked URL with `?t=<token>` still works — the query param is simply ignored now.
- Daemon genuinely down → ping throws → `daemonReachable=false` → red banner (unchanged behavior).
- No 401 path remains, so "session expired" state is unreachable (that's the whole point).

## Test plan
See `docs/loops/tokenless-daemon-testplan.md`.

## 11. BUILD — implementation notes

**Daemon:**
- `apps/daemon/src/server.ts` — removed `generateToken()`/`randomBytes` import, the `token`
  field on `DaemonServerHandle`, the whole `READ_ONLY_METHODS` set, and the `x-symbion-token`
  401 auth branch. Kept `isAllowedHost` Origin/Host allowlist + `127.0.0.1`-only bind (unchanged).
  Updated `startServer` doc comment to describe the new trust model.
- `apps/daemon/src/index.ts` — boot URL is now `http://127.0.0.1:${handle.port}/` (no `?t=`).

**Web:**
- `apps/web/src/lib/rpc/client.ts` — dropped `cachedToken`, `hasSession`, and the
  `x-symbion-token` header. `initDaemonSession(port)` now only records the port (re-derived
  from `window.location` on every mount, so it survives F5).
- `AppShell.tsx` / `SettingsShell.tsx` / `TemplatesView.tsx` — stopped reading `?t=`; each now
  calls `initDaemonSession(port)`. Leftover `?t=` from an old bookmark is stripped for a clean
  URL bar but is otherwise ignored.
- `useArtifactStore.ts` — heartbeat collapsed to a single `ping` probe (ping ok → all flags
  true; fail → all false). Removed the `hasSession()` short-circuit and the `unauthorized`
  branch in `reportConnectionError`. `sessionValid` kept in the shape (mirrors `daemonReachable`)
  to avoid churning ~11 consumers.
- `DaemonStatusBadge.tsx` — removed the amber "session expired / lấy token mới" state (now
  unreachable); two states left: connected vs. daemon-unreachable.

**Tests updated:** `server.integration.test.ts`, `rpc-providerSettings-roundtrip.test.ts`,
`fetchAuthorTemplates.test.ts` (dropped token-gate/READ_ONLY_METHODS assertions),
`DaemonStatusBadge.test.tsx`, `useArtifactStore.heartbeat.test.ts` (rewritten for 2-state model).

**Assumptions:** single-user local tool; loopback-bind + Origin/Host allowlist is the accepted
trust boundary (see residual-risk note above).

## Verification (self-verified during build — /review, /qa, /cso intentionally skipped, see above)
- `npm run build` — clean (rpc-types + daemon + web).
- `npm test` — **412 passed / 39 files / 0 errors** (installed the pre-missing `jsdom` devDep so
  the two web DOM test files run again).
- **Live daemon drive (the actual bug):** booted `apps/daemon/dist/index.js`, then via curl:
  - `listProjects` with **NO token header → HTTP 200** (this is exactly the F5-refresh path that
    previously 401'd and killed Symbion — now works).
  - foreign `Origin` → **403** (allowlist intact).
  - `ping` → 200; boot URL string confirmed `http://127.0.0.1:<port>/` with no `?t=`.

STATE: **Done** (pending commit via ship).
