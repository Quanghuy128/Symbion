---
description: Step 1 of the pipeline — force-clarify feature scope with 6 questions before writing any code
---

You are at the **office-hours** step of the Symbion pipeline (see [CLAUDE.md](../../CLAUDE.md)).

Feature to clarify: **$ARGUMENTS**

<!-- process-manager 2026-06-28: added feature-slug + precondition rule (audit-process finding: no slug derivation rule meant /design and /plan could look for a STATE file under a different name than office-hours wrote). -->
**Feature slug**: derive a kebab-case slug from the first few words of `$ARGUMENTS` (e.g. "connect providers to ollama" → `connect-providers`). State the slug you chose back to the user once, in your first response, so every downstream command (`/design`, `/plan`, `/build`...) resolves the same `docs/loops/<feature>-STATE.md` path.

**Precondition**: check whether `docs/loops/<feature>-STATE.md` already exists for this slug.
- If it exists and already has a `Scope` section (real files name this `## Scope`, `## 2. Scope`, or similar — there is no literal "THINK" keyword in practice, see note below) → read it first, tell the user what's already locked, and ask only about what's missing/changed (do not silently overwrite).
- If it doesn't exist → proceed fresh.

Ask up to **6 questions** to lock down scope (use AskUserQuestion). Cover:
1. What is the end-user goal of this feature? What does "done" mean?
2. Scope IN / OUT (what is explicitly NOT in this iteration).
3. Data model changes (Canonical IR, local-store schema, target file formats)?
4. Important edge cases (hand-edited file conflict, daemon disconnect, partial publish, re-publish unchanged).
5. Impact on existing features (project store, providers/adapters, publish/upsert)?
6. Acceptance criteria for the Checker to verify.

After receiving answers, write the scope summary to `docs/loops/<feature>-STATE.md` with clearly-labeled sections (e.g. `## Problem`, `## Scope`, `## Acceptance criteria` — exact numbering/wording is yours to choose, just make a `Scope` section identifiable), then suggest running `/plan`.

<!-- retro 2026-06-28: removed the "THINK" keyword-matching instruction entirely (not just loosened to substring) — unlike PLAN/BUILD/REVIEW/QA/CSO, which DO appear verbatim in real STATE headings (confirmed by grep across 3 real features), no real STATE file has ever contained the literal word "THINK" or "ANALYZE." Those are pipeline-stage names, not heading vocabulary. The real, checkable signal that office-hours ran is a "Scope" section existing, so /plan's precondition check (see plan.md) should look for that instead. -->
