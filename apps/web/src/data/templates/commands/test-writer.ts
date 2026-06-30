export const id = "command:test-writer";

export const raw = `---
description: Sinh test case cho hàm/module vừa thay đổi trong working tree.
---

Look at the currently staged/unstaged diff (or $ARGUMENTS if a specific
file/function is named). For each new or changed function:

1. Identify the inputs, outputs, and edge cases (empty input, boundary
   values, error paths) actually reachable by that function's signature.
2. Write test cases using the project's existing test framework and
   conventions (match file naming, assertion style, and fixture patterns
   already present elsewhere in the repo — do not introduce a new framework).
3. Skip generating a test for trivial pass-through code (e.g. a one-line
   getter) — note that you skipped it and why, instead of padding coverage.
4. Run the new tests if a test runner is available; report pass/fail, not
   just "tests written."

Request: $ARGUMENTS
`;
