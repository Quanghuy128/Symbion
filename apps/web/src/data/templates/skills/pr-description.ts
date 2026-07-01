export const id = "skill:pr-description";

export const raw = `---
name: pr-description
description: Tạo mô tả PR từ diff theo chuẩn dự án (Summary + Test plan).
---

Generate a pull request description from the current branch's diff against
its base branch.

Structure:
## Summary
1-3 bullet points describing *why* this change exists, not a restatement of
the diff line-by-line.

## Test plan
A short checklist of how this was verified (commands run, scenarios
exercised manually, or "covered by new/existing automated tests" with which
ones). Never write "tested" with no detail behind it.

Keep the whole description scannable in under 30 seconds — link out to a
design doc/issue instead of pasting its content inline.
`;
