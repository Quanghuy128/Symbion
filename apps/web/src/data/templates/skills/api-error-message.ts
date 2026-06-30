export const id = "skill:api-error-message";

export const raw = `---
name: api-error-message
description: Soạn message lỗi API rõ ràng, nhất quán, không lộ thông tin nội bộ.
---

Write a user-facing API error message for a given failure case.

Rules:
- State what went wrong in plain language (no stack traces, no internal
  class/variable names, no raw exception text).
- If the cause is user-fixable (bad input, missing field, expired token),
  say exactly what to fix.
- If the cause is server-side (DB down, dependency timeout), apologize
  briefly and say what to do next (retry later / contact support) — never
  expose infrastructure details.
- Keep the message under ~140 characters where the API's error schema
  allows; put any longer detail in a separate "details" field, not the
  headline message.
`;
