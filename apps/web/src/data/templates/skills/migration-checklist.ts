export const id = "skill:migration-checklist";

export const raw = `---
name: migration-checklist
description: Tạo checklist an toàn trước khi chạy một database migration.
---

Produce a pre-flight checklist for a given database migration before it
runs against a real environment.

Cover, in order:
1. Is the migration reversible? If not, say so explicitly and require a
   manual backup step before proceeding.
2. Does it lock a table that's hot in production? If yes, suggest running
   during a low-traffic window or rewriting as an online/non-blocking
   migration if the database supports it.
3. Has it been tested against a representative copy of production data
   volume, not just an empty/seed dataset?
4. Is there a rollback plan, and is it actually exercised (not just
   theoretical)?

Output as a literal checklist (- [ ] item) so it can be pasted directly into
a PR description or runbook.
`;
