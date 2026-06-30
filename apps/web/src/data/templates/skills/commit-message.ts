export const id = "skill:commit-message";

export const raw = `---
name: commit-message
description: Soạn commit message theo Conventional Commits từ staged diff.
---

Write a concise Conventional Commits message for the currently staged diff.

Format: \`<type>(<scope>): <short summary>\`, followed by a blank line and an
optional body explaining *why* (not *what* — the diff already shows what).

- Pick \`type\` from: feat, fix, docs, style, refactor, test, chore.
- Scope is the most specific affected area (a package name, a module, a
  feature folder) — omit it if the change is genuinely repo-wide.
- Summary is imperative mood, lowercase, no trailing period, under ~72 chars.
- If the diff mixes unrelated concerns, say so and suggest splitting into
  separate commits instead of writing one overloaded message.
`;
