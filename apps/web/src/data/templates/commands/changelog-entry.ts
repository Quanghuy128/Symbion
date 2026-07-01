export const id = "command:changelog-entry";

export const raw = `---
description: Soạn một mục CHANGELOG.md cho thay đổi hiện tại theo Keep a Changelog.
---

Draft a single CHANGELOG.md entry for the current change ($ARGUMENTS may
describe the change if the diff alone is ambiguous), following the "Keep a
Changelog" categories: Added / Changed / Deprecated / Removed / Fixed /
Security.

Rules:
- Pick exactly the categories that actually apply — do not pad with empty
  ones.
- One line per change, written for the end user, not the implementer (avoid
  internal function/variable names unless the change IS that API).
- If the change is purely internal (refactor, test-only, CI config) and has
  no user-visible effect, say so explicitly instead of forcing an entry.

Context: $ARGUMENTS
`;
