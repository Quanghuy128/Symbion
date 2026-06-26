---
description: Security audit (OWASP Top 10 + STRIDE) via an independent security-reviewer
---

**cso** (Chief Security Officer) step of the Symbion pipeline.

Scope: **$ARGUMENTS** (default: current diff / feature being worked on).

**Invoke the `security-reviewer` subagent** (independent security Checker) via the Agent tool.

Pass to it:
- Files/diff to audit (run `git diff` to determine scope).
- Feature context from `docs/loops/<feature>-STATE.md`.
- Symbion focus areas: localhost RPC hardening (127.0.0.1 bind + origin-bound token + anti DNS-rebinding), path confinement (reject `..`/symlink escape, never touch foreign files), destructive-write safety (backup-before-write, conflict blocks overwrite), template/YAML injection, secret handling.

Receive findings 🔴/🟠/🟡/🟢 + PASS/NEEDS-WORK verdict.
- 🔴/🟠 finding → return to `/build` for the Maker to fix (pass findings), then re-run cso.
- PASS → write result to STATE, proceed to `/qa` or `/ship`.

When to run: any change touching the daemon RPC, filesystem writes/path handling, the publish/upsert engine, user input parsing, or secrets.
