export const id = "command:release-notes";

export const raw = `---
description: Tổng hợp release notes từ commit log kể từ tag gần nhất.
---

Generate release notes for everything committed since the most recent git
tag (or since $ARGUMENTS if a specific ref/range is given).

1. List commits in that range, grouped by type if conventional-commit
   prefixes are used (feat/fix/docs/chore/etc.); otherwise group by the
   directory most affected.
2. Write one short, user-facing bullet per meaningful change — skip
   "chore:"/formatting-only commits unless they fix a user-visible bug.
3. Call out any breaking change explicitly under its own "Breaking changes"
   heading, even if there's only one.
4. End with the commit range and tag name used, so the output is
   reproducible/auditable.

Range/ref: $ARGUMENTS
`;
