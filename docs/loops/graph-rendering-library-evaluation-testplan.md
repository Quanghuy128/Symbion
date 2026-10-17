# graph-rendering-library-evaluation — TEST PLAN

> Companion to `graph-rendering-library-evaluation-STATE.md` §10 (PLAN). There is no code produced by this feature — the "test plan" is a **verification checklist for the research deliverable itself** (the comparison/recommendation doc, wherever it lands: a new STATE heading or a cross-linked `-recommendation.md`). Run this checklist as the "review"/"QA" for this feature; there is no Vitest/Playwright suite here because there is no code change.
>
> How to use: the reviewer (human, `code-reviewer`, or `architect` in self-review mode per its own mandate) reads the deliverable once, then walks every row below and marks PASS/FAIL/PARTIAL with a one-line reason. A single FAIL on any row marked **(blocking)** means the deliverable is not done, regardless of how polished the rest reads.

## T-0. Scope/process gate (blocking)

| # | Check | Pass condition |
|---|---|---|
| T-0.1 | Deliverable is a written doc, not a code diff | No files under `apps/web`, `apps/daemon`, `packages/core` etc. changed. Only `docs/loops/*.md` (and possibly a new recommendation doc) touched. |
| T-0.2 | No prototype was built | No new `apps/web` branch/spike folder, no throwaway component committed anywhere, no reference to "I built a quick demo" in the writeup. STATE §6.3 forbids this explicitly. |
| T-0.3 | Sequencing precondition (STATE §6.1) is not silently overturned | If the recommendation is "migrate," the doc explicitly restates "after P2/P3 ship and stabilize" as a precondition, and does not propose starting migration work now. |

## T-1. Coverage of AC-1..AC-11 per candidate (blocking)

| # | Check | Pass condition |
|---|---|---|
| T-1.1 | All 3 candidate buckets scored | React Flow baseline, self-coded SVG/Canvas (+dagre/elkjs layout-only), AND the 1-2 chosen lighter libraries (per STATE §10.1: Cytoscape.js + `@xyflow/react` v12 primitives, unless the deliverable documents a different, justified pick) each have a row/section. |
| T-1.2 | AC-1..AC-10 itemized per candidate | For every candidate, each of AC-1 (node types) through AC-10 (E10 derive-don't-mirror architecture) is scored as "full parity" / "partial parity (gap named)" / "no reasonable path" — not skipped, not lumped into a vague paragraph. |
| T-1.3 | AC-8 (mission-mode overlay) specifically addressed | Given AC-8 shipped same-day as this spike opened (STATE §7 "moving-target risk"), verify the deliverable didn't undercount it — look for an explicit mention of glow/dim, `runFlow`, and "authoring suspended during a run" being ported, not just the older AC-1..AC-7 feature set. |
| T-1.4 | AC-11 sub-items all present | For each candidate: (a) itemized AC-1..AC-10 table, (b) port-effort size class (small/medium/large — NOT a time estimate in days, per STATE §5's explicit instruction), (c) bundle-size delta with an explicit uncertainty caveat (see T-2), (d) customizability outlook, (e) migration-risk callout given P2/P3 active development. |

## T-2. Bundle-size claims are honestly caveated (blocking)

| # | Check | Pass condition |
|---|---|---|
| T-2.1 | Every bundle-size number cites a source | No bare number without attribution (e.g. "bundlephobia, checked 2026-07-15" or "package.json `files` + npm registry size"). |
| T-2.2 | Uncertainty is stated | Numbers are framed as estimates (e.g. "~40KB gzipped, ±30%, tree-shaking not verified") — a table with unqualified precise-looking KB figures and no caveat sentence anywhere is a FAIL (per STATE §10.0 flaw #2). |
| T-2.3 | Compared entry point matches actual usage | If a candidate is tree-shakeable, the estimate reflects the subset actually needed (e.g. core rendering + layout, not the whole package), not a worst-case full-bundle number presented as if it were the real cost — or, if this distinction wasn't checked, the doc says so rather than implying precision it doesn't have. |

## T-3. Pain-point axes are evidence-grounded, not vibes (blocking)

| # | Check | Pass condition |
|---|---|---|
| T-3.1 | Style/visual customization freedom — cites a concrete touchpoint | e.g. references a specific API surface (`NodeProps`, `EdgeLabelRenderer`, `Handle` positioning) and a specific file:line in the current codebase it's compared against — not just "React Flow feels constraining." |
| T-3.2 | Re-render/perf cost under live updates — cites the actual mechanism | References the `useMemo`-based node/edge derivation in `DependencyGraph.tsx` (STATE cites lines ~444-504) and explains concretely why/whether a candidate would re-render less/more under mission-mode-style per-tick updates — not a bare assertion of "faster." |
| T-3.3 | Ergonomics of extending the node/edge contract — engages with STATE §6.4's specific hypothesis | The doc explicitly addresses whether mission-mode's friction (if any was found) was a hard React Flow ceiling vs. an artifact of how the current wrapper composes its `data` bag — per STATE §10.2 Step 2, this requires having actually read the mission-mode diff/final code, not asserting from memory. A FAIL here is: axis addressed only in the abstract, no reference to the actual `f65b34b` overlay code. |
| T-3.4 | No axis conflates "hard" with "undocumented/untried" | Per Edge Case E-3 — if a claim of difficulty is made, the doc shows evidence the documented extension point was actually checked (a doc-page reference, an example reference) before concluding it's insufficient. |

## T-4. Maintenance-health gate was actually run (blocking for any "lighter library" recommendation)

| # | Check | Pass condition |
|---|---|---|
| T-4.1 | Every named lighter candidate has a maintenance-health note | npm last-publish date, GitHub last-commit/release date, and archived-repo check for Cytoscape.js, `@xyflow/react` v12, and (if evaluated at all) `reaflow`. |
| T-4.2 | Any candidate failing the gate is flagged or dropped, not silently deep-scored | If `reaflow` (or any other) shows no commits/releases in >12 months or an archived repo, the doc says so and either drops it from the deep comparison or explicitly flags "use with caution" rather than scoring it as if healthy. |

## T-5. Self-coded SVG/Canvas estimate is decomposed, not hand-waved

| # | Check | Pass condition |
|---|---|---|
| T-5.1 | Splits "ported logic" vs. "rebuilt from scratch" | The estimate distinguishes interaction/decoration logic that conceptually carries over (hover math, validation rules, edge decoration) from primitives React Flow provides for free that would need reimplementing (pan/zoom, hit-testing, connect-drag physics, accessibility) — a single monolithic "medium" or "large" estimate with no such breakdown is a FAIL. |
| T-5.2 | dagre/elkjs scoped as layout-only, decoupled from the interaction question | The doc doesn't conflate "add dagre for layout" with "replace the whole rendering surface" — these are called out as separable per STATE §8 idea #2. |
| T-5.3 | Estimate is bracketed, not false-precision | e.g. "1-3 sprints" rather than "14 days" — STATE §5 AC-11b explicitly asks for a size class, not a time estimate. |

## T-6. Precedent engagement (blocking — this is the single most-named requirement in STATE)

| # | Check | Pass condition |
|---|---|---|
| T-6.1 | The doc explicitly names `graph-execution-realtime-STATE.md` §2 (or §2/§3) and its 2026-07-13 "keep React Flow" finding | A direct citation/quote or clear paraphrase referencing the prior spike, not an unattributed "React Flow was already considered." |
| T-6.2 | The doc states explicitly whether it REINFORCES or REBUTS that finding | Look for an unambiguous sentence to this effect — a doc that reaches a conclusion (keep or migrate) without this explicit reinforce/rebut framing is a FAIL even if the conclusion itself happens to be reasonable. |
| T-6.3 | If rebutting, new evidence is given (not just re-asserting the opposite) | The rebuttal cites something the prior spike's cost/license framing didn't examine (e.g. a specific DX friction with a code citation) — a bare "actually I think we should migrate" without new grounding is a FAIL. |
| T-6.4 | If reinforcing, the doc explains why the SAME conclusion holds under a DIFFERENT question (DX/flexibility vs. cost/license) | Simply repeating "React Flow is MIT and free" (the old axis) as if it answers the DX question is a FAIL — the reinforcement must engage with the new axes on their own terms even while landing on the same "keep" verdict. |

## T-7. Recommendation is reasoned prose, not just a table

| # | Check | Pass condition |
|---|---|---|
| T-7.1 | A prose recommendation section exists | Not solely a comparison table — STATE §5's "definition of done" and §10.2 Step 6 both require a decision statement in prose: one of "keep React Flow" / "migrate to X" / "revisit after P2/P3 ship." |
| T-7.2 | If "migrate," names the target candidate and states the timing precondition | Explicitly says which candidate and explicitly restates "after P2/P3" (STATE §6.1) rather than leaving timing ambiguous or silently proposing "now." |
| T-7.3 | Any escape-hatch usage (Edge Case E-4) is named, not silently exercised | If some claim genuinely couldn't be desk-estimated, the doc says so plainly ("could not be resolved without a timeboxed spike") rather than inventing a number or quietly prototyping despite §6.3. |

## T-8. Where the decision was recorded

| # | Check | Pass condition |
|---|---|---|
| T-8.1 | Decision is written back into `graph-rendering-library-evaluation-STATE.md` | Either directly as a new heading (e.g. "## 11. RESEARCH RESULT") or via a clearly cross-linked companion doc referenced from STATE — not left only in a chat transcript or PR description. |
| T-8.2 | If "migrate" is the outcome, a NEW feature/STATE file is opened for the migration itself | Per STATE §7's explicit instruction that migration architecture is a separate `/plan` pass with its own pipeline — this spike's STATE file should not itself grow a full migration architecture section as if `/plan` for the migration happened here. |
| T-8.3 | Cross-link from `graph-execution-realtime-STATE.md` §2 | Per STATE §9's stated goal, so the two research passes on the same underlying question don't read as unlinked/potentially contradictory to a future reader — a short added note or link there is sufficient. |
