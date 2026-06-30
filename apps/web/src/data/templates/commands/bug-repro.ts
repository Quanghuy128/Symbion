export const id = "command:bug-repro";

export const raw = `---
description: Viết một test tái hiện lỗi (failing test) trước khi sửa.
---

Given a bug description ($ARGUMENTS), write the smallest possible failing
test that reproduces it — before touching any production code.

1. State your understanding of the expected vs. actual behavior in one
   sentence each, so a human can confirm you understood the bug correctly.
2. Write one test, using the project's existing test framework/conventions,
   that currently FAILS for the stated reason (run it to confirm the
   failure, don't just assert it would fail).
3. Do not fix the bug in this step — output only the failing test and the
   confirmation that it fails for the right reason (not a different,
   unrelated error).

Bug description: $ARGUMENTS
`;
