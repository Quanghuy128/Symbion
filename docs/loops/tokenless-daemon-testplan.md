# tokenless-daemon — Test Plan

## Unit / build gates
- [ ] `npm run build` clean across core + daemon + web (no unused-var / type errors from removed token symbols).
- [ ] Grep confirms no remaining reference to `x-symbion-token`, `initDaemonSession(token, ...)`,
      `cachedToken`, `hasSession`, `generateToken`, `handle.token` (outside archived docs).
- [ ] `server.test`-style suites (if any assert on `handle.token`) updated.

## Behavior (manual, the actual bug)
1. **T1 — Boot URL has no token.** Start daemon → banner URL is `http://127.0.0.1:<port>/` (no `?t=`).
2. **T2 — First load works.** Open URL → project list loads, no 401, daemon badge green.
3. **T3 — F5 survives (the fix).** Press F5 / hard-refresh → app reloads, still connected, RPCs
   succeed, NO "session expired" banner. (Before: this killed Symbion.)
4. **T4 — Deep-link + refresh.** Navigate to /settings and /templates, F5 on each → still connected.
5. **T5 — Old tokened URL still works.** Open `http://127.0.0.1:<port>/?t=anything` → `?t` ignored,
   app connects fine.
6. **T6 — Daemon-down still detected.** Stop daemon → heartbeat flips to red "không kết nối" banner
   (daemon-unreachable path unchanged).

## Security sanity (residual-risk bounds)
7. **T7 — Loopback-only bind.** Daemon still refuses non-127.0.0.1 bind; a request with a
   non-allowlisted `Host`/`Origin` header still gets 403 (allowlist unchanged).
