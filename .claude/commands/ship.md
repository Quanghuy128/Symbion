---
description: Step 6 of the pipeline — close out the feature: final test + update STATE/learnings + commit
---

You are at the **ship** step of the Symbion pipeline.

Feature: **$ARGUMENTS**

Only ship after both `/review` PASS and `/qa` PASS.

1. Run `npm run build` one final time to confirm clean.
2. Update `docs/loops/<feature>-STATE.md`: mark Done, record what was verified.
3. Add patterns learned to `docs/learnings.md` (with confidence level).
4. `git add -A` → confirm `.env.local`/secrets are NOT staged → commit with a message describing the feature + "shipped through Maker→Checker pipeline."
5. Report: feature shipped, findings resolved, remaining tech debt.
