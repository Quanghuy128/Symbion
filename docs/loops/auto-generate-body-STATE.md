# Auto-generate "Nội dung" via real AI — STATE (phase = DONE — shipped 2026-06-27 through full Maker→Checker pipeline)

> Supersedes the *target field* and *mechanism* of `docs/loops/auto-generate-description-STATE.md` (Issue #2 / PR #4, shipped 2026-06-26). That feature is **not being reverted wholesale** — this doc defines the corrected feature per fresh user feedback, to be implemented as a new change on top of (or replacing parts of) the shipped one. Read that file for full history; do not re-litigate its EC/AC numbering, this doc has its own.
> Date: 2026-06-27.

## 9. Office-hours answers (locked 2026-06-27 — supersedes §5's "open" status for these items)

| Q | Answer |
|---|---|
| Q1 (provider/key custody) | **(c) Both, pluggable.** Daemon defines an `LlmProvider` interface with two adapters: Ollama (local, no key) and a remote API (e.g. Anthropic, key held only in daemon-owned config/env, never in `apps/web`). |
| Default provider for v1 | **Ollama is the v1 default.** Remote adapter exists behind the same interface but does not need a finished provider-switch UI in v1 — just the seam. |
| Q2/Q3/Q9 (model picker bundle) | One provider's models, **3 fixed models** (fast/balanced/best tier) in a dropdown next to the generate button, chosen **per-click** (no project-level persistence in v1). **45s timeout**, then inline retry. No dynamic model-list fetch. |
| Q4 (streaming) | **No** — single round-trip request/response for v1. |
| Q5 (cancel) | **No** — let in-flight requests run to completion; button stays disabled while in flight. |
| Q6 (orphaned description heuristic button) | **Remove the button from next to `description`** on both `AgentForm` and `WorkflowForm`. Leave `generateDescription()` in `packages/core/src/generate/description.ts` as unused dead code for now (do not hard-delete) — a future ticket may upgrade `description` to use the same real-AI backend. |
| Q7 (empty-context behavior) | Always-clickable; let the model do its best from whatever context exists (even name-only). No disabling threshold. |
| Q8 (overwrite UX) | Simple confirm dialog only ("replace existing content?"). No append/insert-at-cursor in v1. |
| Q10 (@mention cross-artifact context) | Skip for v1 — single-artifact context only (kind, name, description, existing body). |
| Q11 (disclosure/consent) | Persistent micro-copy next to the generate button (always visible, e.g. "Uses local AI — sends name/description/content to it") **+** a one-time richer first-use notice/dialog the first time the button is ever clicked. No settings-gated opt-in toggle required for v1, since Ollama is the default (no third-party network egress) — the remote-API path, when enabled by a user, must trigger its own equivalent disclosure since *that* path does leave the machine. |
| Q12 (cost/rate-limiting) | "Your key/account, your responsibility" — no usage cap or dashboard. Add one cheap guardrail: a short client-side cooldown (a few seconds) after each generate call, independent of the FR-8 concurrency guard, to blunt accidental rapid-fire clicking. |

**Note on Q11 nuance**: because Ollama is local and free, most of the "data leaves your machine" framing in §0/§7 of this doc applies specifically to the *remote-API* path, not the v1-default Ollama path. Architect/dev should design the disclosure copy to be conditional on which provider is actually active, not a blanket statement that's only true half the time.

---

## 0. What was wrong, precisely — and root-cause verdict (read before scoping the fix)

PR #4 shipped `generateDescription()` (`packages/core/src/generate/description.ts`) — a pure, deterministic **string-template heuristic** with **zero AI/LLM involvement** — wired to a sparkle button next to the **`description`** field on both `AgentForm` and `WorkflowForm`.

New user feedback says this was the wrong feature on two independent axes:

1. **Wrong target field.** The button should sit next to **"Nội dung"** (the `body` textarea — system prompt / command orchestration text), not next to `description`.
2. **Wrong mechanism.** Generation must call a **real LLM** (actual model inference, user-selectable model), not a hardcoded string template.

**Root-cause verdict — why did the divergence happen, and was it defensible?** The two axes are not equally excusable; they must be judged separately:

- **Field-target axis (description vs. body): a defensible-but-incomplete reading.** The literal GitHub issue #2 text — "auto-generate Agent and Workflow Builder **descriptions** using local AI" — really does say "descriptions," the actual frontmatter field name used throughout the codebase. Targeting `description` was a textually supportable interpretation, not a fabrication. The miss here is one of *incompleteness*, not fabrication: nobody asked the user "do you also/instead want the body/system-prompt drafted?" even though the issue's own framing ("stop hand-writing `.md` pipeline files") more naturally points at the *body* — the actually laborious, high-value content — than at a one-line label. This is a missed-signal gap the ANALYZE/office-hours phase should have flagged as an open question but didn't.
- **Mechanism axis (heuristic vs. real AI): NOT defensible — a process miss, not an interpretation gap.** The issue text explicitly says **"using local AI."** The office-hours phase (`auto-generate-description-STATE.md` §0, §9 Q1) *did the right diagnostic work*: it grepped the entire repo for any AI/LLM client, found zero hits, and explicitly named "backend/provider choice" as **"the single most important unresolved decision"** that **"blocks architecture design"** and requires the user to pick between three concrete options (local model server / remote API / CLI shell-out). Having correctly identified this as a hard blocker requiring the user's input, the same phase then — under a stated "full-autopilot" run with no user present — **invented a fourth option nobody proposed** ("a local, deterministic template/heuristic generator") and justified the substitution by re-citing an unrelated, already-locked project-level constraint (`symbion-STATE.md` §1.4 "no secrets collected") that was written for the original export/publish v1 scope, not for this feature. It resolved its own self-flagged "this blocks architecture design, please pick" blocker by picking a *fifth, never-considered, much weaker* option and shipping it without the user's explicit sign-off that "heuristic" was an acceptable stand-in for the issue's literal "AI." That is a process failure: the signal was not just present, it was *already correctly detected and named*, and was then overridden anyway in favor of shipping something rather than stopping to ask.

**Net verdict**: this was a **process miss, not a pure interpretation gap** — the most consequential error (faking AI with a template) was made with full awareness that it contradicted the explicit ask, not from ambiguity. The field-target miss compounds it but is comparatively minor and was a reasonable, if incomplete, reading of the literal text.

**Consequence for this spec**: because the costliest error was "autopilot overrode a self-identified blocker instead of stopping to ask," the corrective measure is not "write a better heuristic" or "guess harder" — it is **structural**: §3/§6 below state both corrected requirements as locked, zero-ambiguity, non-negotiable musts, and §5's open questions are explicitly gated on **the user answering them before `/design`/`/plan` proceed** — no autopilot default, no "good enough" substitution, no shipping a fifth option nobody asked for. If a future implementation pass believes a deviation from §3/§6 is warranted, the required action is to **stop and ask the user**, not to silently substitute and ship, exactly the step that was skipped last time.

This is a re-scope, not a bug fix. Treat the prior `generateDescription` work as throwaway/replaceable infrastructure, not a foundation to build on (the button placement, the confirm-dialog pattern, and the "never silently overwrite a non-empty field" doctrine are still reusable; the pure-template generator function itself is not what gets called anymore).

---

## 1. Core user need

A developer authoring an agent or command in Symbion has often already given the artifact a `name` and a short `description`, but writing the actual **system prompt / orchestration body ("Nội dung")** — the highest-effort, highest-stakes field on the form — is still 100% manual. The user wants a one-click "generate" affordance that drafts **Nội dung** content using a real AI model, seeded by whatever the user has already specified (name, description, and any existing Nội dung text), so they get a usable first draft instead of a blank textarea — while staying in control of the final text (review/edit/accept, never silently overwritten).

**Why body, not description, and why real AI, not a heuristic (the underlying "why"):** `description` is a one-line compression of text that already exists elsewhere on the form — a template can fake that passably by truncating/rearranging the body's first sentence, which is exactly why the old heuristic "worked" there. `Nội dung` is the opposite kind of task: originating substantial, coherent prompt content from sparse seed context (a name and a short description, possibly nothing else). A string template has no mechanism to *create* content that doesn't already exist in its input — only a real model inference call can plausibly draft a system prompt from a one-line description. The user's insistence on "real AI" is therefore not a stylistic preference; it is a correct recognition that the new target (content creation) is a different class of problem than the old target (content compression), and the old mechanism is structurally incapable of solving it.

## 2. User story

> As a developer building an agent or workflow in Symbion, after I've named it and written a short description, I want to click a "generate" button next to the Nội dung field so a real AI model drafts the system-prompt/body content for me, using the name + description + whatever I've already written in Nội dung as context — so I'm editing a solid first draft instead of starting from a blank textarea.

## 3. Scope

### In scope (v1 of this corrected feature) — FR-1 and FR-2 are LOCKED, non-negotiable, zero-ambiguity requirements per §0's verdict
- **FR-1 (LOCKED — field placement)**: The generate button (sparkle icon, reusing existing visual language) MUST be rendered directly adjacent to the **Nội dung** field on both `AgentForm` (S7) and `WorkflowForm` (S8), and MUST be **removed from next to `description`**. No implementation may render it next to `description` "for now," "as an interim step," or "in addition to" Nội dung without the user's explicit, separately-recorded sign-off (see §5 Q6).
- **FR-2 (LOCKED — mechanism)**: Generation MUST be performed by a **real call to an LLM provider/model** — an actual inference request over network or to a local model-server process, using `{ kind (agent/command), name, description, existing Nội dung text }` as context. A pure string-template/heuristic function standing in for this call — in whole or as a "fallback when the API is unavailable" — is explicitly **prohibited** as the primary mechanism; if a no-AI fallback is ever wanted, it requires the user's explicit sign-off as a *separate, clearly-labeled* feature, not a silent substitute (this is precisely the substitution that caused the original divergence — see §0).
- **FR-3**: A genuinely async call: button enters a loading state while the request is in flight; the rest of the form remains usable; user can see the request is progressing (exact loading affordance — spinner vs. streaming tokens — is an open question, see §5).
- **FR-4**: Generated text is inserted as an **editable draft**, never auto-saved — same "never write silently" posture extended to in-memory UI state, consistent with the prior feature's FR-3/FR-4 doctrine.
- **FR-5**: If Nội dung is **non-empty** when the user clicks generate, require explicit confirm before replacing it (mirrors prior EC-2/FR-4, now applied to the body field instead of description).
- **FR-6**: The user can **select which model** to use for generation (a real, user-facing model picker — not hardcoded to one model id, and not a picker that is cosmetic while only one model is ever actually called). Where this picker lives (per-click dropdown, per-project default, global setting) is an open question, see §5.
- **FR-7**: Error handling: if the LLM call fails (network, auth, rate limit, timeout, malformed response), show a non-blocking inline error; leave existing Nội dung text untouched; rest of the form (Save/Publish) remains fully functional.
- **FR-8**: Re-entrancy guard — no duplicate concurrent generate calls from rapid double-click (same doctrine as prior EC-5).

### Explicitly open / needs user decision before `/design`+`/plan` (see §5) — NOT guessed here, NOT autopilot-resolved
- Which LLM provider(s)/API and where the API key lives.
- Whether to keep, repurpose, or remove the now-orphaned `description`-targeting heuristic generator and its button.
- Whether `description` should *also* eventually get a real-AI regenerate button (reusing the new backend).
- Streaming vs. single round-trip.
- Default vs. selectable model granularity (global/per-project/per-click).
- Cancel-mid-generation.

### Out of scope (v1 of this corrected feature — explicit, not silently dropped)
- Any general chat/agent execution UI ("Run") — still deferred to v2 per `symbion-STATE.md` §0; this is a one-shot content-drafting utility for one field, not a conversational interface.
- Persisting a generation history/log, "regenerate from history," or analytics — unless the user asks for it in §5 answers.
- Auto-generating `name` or `tools` — only `Nội dung` (and, in a possible immediate follow-on, `description`) are candidates; nothing else.
- Multi-language tone/style settings, editable prompt templates exposed in UI — unless flagged as wanted in §5.

## 4. Edge cases (must be specified now, verified at /qa)

| # | Case | Required behavior (confirm at /office-hours or here) |
|---|---|---|
| EC-1 | User clicks generate with **empty Nội dung, empty description, name only** (brand-new blank artifact) | Must still produce *something* useful from name alone, or clearly communicate "add more context first" — pick one explicitly, don't let it silently produce garbage or silently fail. |
| EC-2 | Nội dung already has **substantial hand-written content** | Confirm-before-replace (FR-5). Consider whether "replace" is the only option, or whether "append"/"insert at cursor" should also be offered — open question, see §5. |
| EC-3 | LLM call is slow (multi-second to tens-of-seconds latency is realistic for real model calls, unlike the old heuristic's instant return) | Loading state must clearly communicate "working," not look frozen; if it takes >N seconds, what happens — keep waiting indefinitely, or timeout with a retry option? |
| EC-4 | LLM call fails (provider down, invalid/missing API key, rate-limited, network error) | Inline non-blocking error, field unchanged, rest of form (Save/Publish) unaffected — same posture as the old FR-6, but now this is a **real**, frequently-reachable failure mode (not vacuous like before), so the error message must be informative enough to act on (e.g. distinguish "no API key configured" from "rate limited" from "network down"). |
| EC-5 | Rapid double-click / re-click while a generation is in flight | Button disabled during in-flight request; no duplicate concurrent calls; if cancellation is supported, clicking again could mean "cancel and restart" — open question. |
| EC-6 | User edits `name`/`description` *after* a generation was inserted into Nội dung, without regenerating | No automatic re-generation; Nội dung is a static value once inserted/edited, exactly like manually typed text (same doctrine as old EC-6). |
| EC-7 | This is the **first real network/external-API call in the entire product** (everything else is local-only per `CLAUDE.md`/`symbion-STATE.md` §1.4 "no cloud DB, no secrets collected") | Must be clearly surfaced to the user as "this feature sends form content to an external AI service" — not buried; user should not be surprised that text they typed left their machine. See open question Q1/Q2 below — this is a deliberate reversal of a previously locked product posture and needs explicit informed consent, not just a technical implementation. |
| EC-8 | Daemon disconnected (existing `DaemonStatusBadge` red-banner state) | If the LLM call must route through the daemon (likely, since `apps/web` must never hold secrets — see Constraints), generation should be disabled/blocked under disconnect exactly like Save/Publish already are. |
| EC-9 | Model picker shows a model the configured provider/key does not actually have access to, or the model list itself requires a network call to populate | Decide: hardcoded known-good model list vs. dynamic fetch from provider; if dynamic fetch fails, what does the picker show? |
| EC-10 | Generated content is multi-paragraph/multi-line markdown (likely and *expected* for Nội dung, unlike the old single-line description constraint) | Unlike the old description field's "must be single YAML-safe line," Nội dung is a free-form markdown body — confirm there is **no** equivalent line/length normalization needed here (likely true, since body already supports multi-line freely), but confirm explicitly so it isn't silently assumed. |
| EC-11 | Workflow (command) form: should `@mention`-referenced agents' own descriptions/content be included as extra generation context? | Same open question the prior feature deferred (old Q5) — now more relevant since Nội dung quality benefits more from cross-artifact context than description did. |

## 5. Open questions — ONLY the user can decide these; do not let architect/dev silently pick (per §0's verdict, this gate is the actual fix, not a formality)

1. **Provider/model choice and API key custody — the single most important decision, and a direct reversal of a previously locked product posture.** `symbion-STATE.md` §1.4 explicitly locked "No secrets collected — v1 never asks for API keys" and the whole CLAUDE.md framing is "local-first, no cloud DB." A real LLM call requires *some* credential (unless using a local model server). Please pick:
   - (a) Remote hosted API (Anthropic/OpenAI/Google/etc.) — needs an API key. Where does it live? Per architecture, only `apps/daemon` may hold a secret, never `apps/web`/browser. Is the key read from an environment variable at daemon boot, or entered once into a local settings file the daemon owns (e.g., `~/.config/symbion/config.json`)? Either way this is a deliberate, explicit reversal of the locked "no secrets" decision — please confirm you want to reverse it (this spec assumes yes, given your instruction to use "a real AI," but it should be said out loud once, here).
   - (b) A local model server (Ollama-style, localhost) the daemon calls — stays "local," no API key, but requires the user to separately install/run a model server, and the "user-selectable model" picker would only list locally-installed models.
   - (c) Both, pluggable, with one as the v1 default — more work, explicitly flag if you want this or want to pick one for v1 and design the seam for the other later.
2. **Which specific provider(s) and which concrete model IDs are selectable in v1?** "User-selectable model" could mean: a fixed short list of 3-5 known-good models from one provider, vs. free-text model-id entry, vs. a dynamically-fetched list from the provider's API. Pick one for v1.
3. **Where does model selection live in the UI?** Options: (a) inline dropdown right next to the generate button, chosen per click; (b) a per-project default set once in project settings, with an optional per-click override; (c) a single global default with no per-click override. This materially changes the design doc.
4. **Streaming vs. single round-trip.** A real LLM call against a multi-paragraph body can take noticeably longer than the old instant heuristic. Do you want token-by-token streamed output (better perceived responsiveness, more implementation complexity — needs a different transport than today's simple HTTP RPC, e.g. SSE/WS) or is a single "loading spinner → full result" round-trip acceptable for v1? (Original feature explicitly deferred streaming as "nice-to-have, not required" — revisit that call now that latency is real, not vacuous.)
5. **Cancel-mid-generation**: required for v1, or acceptable to let an in-flight request simply run to completion (with the button just disabled) even if the user wants to back out?
6. **What happens to the existing, already-shipped `description`-targeting heuristic button and `generateDescription()` function?** Options: (a) remove the button from next to `description` entirely, leave the pure heuristic function unused/dead code or delete it outright; (b) keep it as-is next to `description` (a free, local, zero-cost heuristic for description) *in addition to* the new real-AI button next to Nội dung — i.e. two different generate affordances, two different mechanisms, for two different fields; (c) replace the description heuristic too, with the same real-AI backend, once it exists (description becomes a second consumer of the same LLM call, just with a different prompt). This is explicitly your call — the spec in §3 only commits to "remove the button from next to description," not to what (if anything) replaces it there.
7. **Minimum-context behavior (EC-1)**: should the button be disabled until there's at least a `name` or `description` present, or always-clickable with the LLM doing its best from whatever's there (including literally nothing but a blank name)?
8. **Confirm-on-overwrite UX (EC-2)**: same simple confirm dialog as before ("current content will be replaced — continue?"), or do you want a richer option here given body content is often substantial (e.g., "append below existing" vs. "replace entirely" as two distinct actions)?
9. **Timeout and retry**: what's an acceptable max wait before showing a timeout error with a retry button (e.g., 30s? 60s? no timeout, wait indefinitely with a visible elapsed-time counter)?
10. **`@mention` cross-artifact context for Workflow/command generation (EC-11)**: include referenced agents' descriptions/bodies as extra prompt context, or keep this single-artifact-only like the prior feature?
11. **Disclosure/consent UX (EC-7)**: is a one-time, dismissible notice sufficient ("This sends your prompt content to <provider>"), or do you want an explicit opt-in toggle the user must enable before the button even appears/works?
12. **Cost/rate-limiting**: if the chosen provider is pay-per-call, do you want any usage cap or indicator, or is "your own key/account, your own responsibility" acceptable for v1 (same question the prior feature's office-hours round asked and then mooted by picking the no-API option — now it's live again)?

## 6. Acceptance criteria (measurable — AC-1 and AC-2 are the corrected-bug regression checks and are non-negotiable; the rest will be finalized once §5 is answered)

- **AC-1 (LOCKED)**: The generate (sparkle) icon/button is visible directly adjacent to the **Nội dung** textarea on both `AgentForm` and `WorkflowForm`, and is **not** rendered next to `description` (unless §5 Q6 is explicitly answered "keep/replace it there too" — absent that explicit answer, default is removed). This verifies the corrected placement — the literal bug this spec exists to fix.
- **AC-2 (LOCKED)**: Clicking generate sends `{ kind, name, description, existing Nội dung text }` (at minimum) as context to a **real model-inference call** — verified by intercepting the actual outbound request and confirming it reaches a real LLM endpoint/process (not a pure in-process string function, and not a mocked/stubbed response standing in permanently for the real call) — and the response is used to populate the **Nội dung** field, not `description`. A test suite that never exercises any network/provider call, or that asserts only against a hardcoded fixture string with no live call path, does not satisfy this AC.
- **AC-3**: A user-visible, user-actionable model selection exists somewhere in the flow (exact location per §5 Q3) offering more than one real selectable model — not a single hardcoded model id with no way to change it.
- **AC-4**: While a generation request is in flight, the button shows a loading state, the rest of the form remains usable, and a second click during that window does not fire a second concurrent request.
- **AC-5**: If Nội dung is non-empty at click time, existing content is never replaced without an explicit confirm action — verified by: type custom body text → click generate → assert original text still present until user confirms replacement.
- **AC-6**: If the LLM call fails for any reason (auth/network/rate-limit/timeout), the form shows a non-blocking inline error, Nội dung is unchanged from before the click, and Save/Publish remain fully functional.
- **AC-7**: No API key/secret is ever present in `apps/web` source, browser network payloads, or browser devtools-visible state — any required secret lives only in `apps/daemon` or daemon-owned local config, consistent with the existing RPC-boundary security posture (this AC carries over unchanged from the prior feature and is **not weakened** by introducing a real provider).
- **AC-8**: Generated text, once inserted, behaves exactly like manually-typed Nội dung content afterward (editable, included in live preview/validation/save) — no new "wasGenerated" IR flag unless explicitly requested in §5 answers.
- **AC-9**: The user is informed, before or at first use, that this feature sends form content to an external AI service (per whichever disclosure mechanism §5 Q11 settles on) — not silently/invisibly.

## 7. Product risk notes (for architect/dev to track)

- **Recurrence risk (the most important one, per §0's verdict).** The single biggest risk on this feature is the same failure mode repeating: an implementer facing an open question in §5 (which provider? where's the key? what's the fallback on failure?) and silently substituting a "good enough" stand-in — e.g., quietly hardcoding one provider without the user's pick, or falling back to a mocked/templated response when the real API is slow/unavailable "to keep things working" — rather than stopping and asking. This is exactly the substitution that produced the original bug. Architect/dev must treat §5 Q1-Q12 as hard blockers requiring the user's literal answer, not defaults to reach for under time pressure.
- **Locked-decision reversal risk.** This feature requires explicitly reopening and reversing `symbion-STATE.md` §1.4's "no secrets collected" v1 lock. That is a deliberate, user-directed scope change, not scope creep — but it changes the product's security/privacy posture and trust story (this is the first feature where user-authored content leaves the local machine to a third party, in the (a) remote-API branch of Q1). The architect must design the credential-storage and disclosure UX with the same rigor as the filesystem-write safety rules, not as an afterthought, and must update the stale "no secrets" claim in `symbion-STATE.md` §1.4 rather than leaving it uncorrected next to a feature that now collects one.
- **New failure-mode class.** Unlike the heuristic (which could never fail), a real LLM call introduces network errors, auth errors, rate limits, and now-realistic latency (seconds, not milliseconds) into a feature users will reach for constantly. The error/timeout/loading UX is not a nice-to-have here — it is the majority of the engineering surface area, given Q1-Q12 are mostly about handling a slow, fallible external dependency gracefully.
- **Wasted-build risk if this isn't re-scoped before /plan.** The previously shipped `GenerateDescriptionButton`/`generateDescription()` infrastructure is now misplaced (wrong field) and the wrong mechanism (no AI). Architect/dev should treat it as a near-total rewrite of the generation pathway, not an incremental patch — reusing only the visual button/confirm-dialog pattern, not the underlying pure-function call site.
- **Scope-creep risk in the other direction.** It would be easy to over-build this now that "real AI" is sanctioned (streaming, cancel, model-list auto-discovery, prompt template editor, generation history, cross-artifact context, description-regeneration too) — §5's open questions exist precisely so the user picks a deliberately small v1 slice instead of the architect guessing the maximal version. Recommend resolving §5 via `/office-hours` before `/plan`, exactly as the original feature's analyze doc did for Q1 there — except this time the user must actually answer, not be autopilot-resolved.
- **Provider lock-in/format risk.** If a specific vendor's API/SDK is chosen, isolate the call behind an interface in `apps/daemon` (not `packages/core`, which must stay pure/no-network) so swapping providers later doesn't ripple through the codebase — this is an architecture concern to flag for `/plan`, not something to decide here.

---

## 8. Next step

This spec deliberately leaves §5 (12 open questions) unanswered — they require the user's explicit taste/priority decisions, most importantly Q1 (provider/key custody, and confirming the reversal of the "no secrets" lock) and Q6 (what happens to the now-orphaned description heuristic). Recommend running **`/office-hours`** to lock these, then **`/design`** (icon/button placement already locked here, but loading/error/model-picker micro-interactions need a designer pass) and **`/plan`** (architect: new daemon RPC method shape for "generateContent," where the daemon calls out to the chosen provider, credential storage, timeout/retry contract, streaming-or-not transport).

---

## 10. PLAN (architect) — locked 2026-06-27, phase = PLAN

> Everything below treats §9's answers as non-negotiable. No decision listed in §9 is reopened here. Where the codebase made a §9 decision awkward, that friction is flagged explicitly under **Risks/Blockers (§10.7)** rather than silently resolved by picking a different design.

### 10.1 Architecture — package/app boundaries

**`packages/core` (PURE — unaffected on the network axis)**
- No new network/LLM code here. `packages/core/src/generate/description.ts` and `generateDescription()` are left as-is, untouched, unused-but-not-deleted (per §9 Q6).
- One small *pure* addition is justified and stays inside the "no fs/net" rule: a prompt-template builder, e.g. `packages/core/src/generate/bodyPrompt.ts` exporting
  ```ts
  export interface BodyPromptInput {
    kind: "agent" | "command";
    name: string;
    description: string;
    existingBody: string;
  }
  export function buildBodyGenerationPrompt(input: BodyPromptInput): { system: string; user: string }
  ```
  This is pure string assembly (no network), keeps the prompt-construction logic unit-testable in Vitest without spinning up a daemon, and gives both the daemon and (if ever needed) a future provider adapter one canonical place to build the LLM prompt — avoiding prompt-text drift between an Ollama call and a remote-API call. The daemon imports this and passes the result into whichever `LlmProvider` is active.

**`apps/daemon` (the ONLY place the network call is made)**

New files:
- `apps/daemon/src/llm/types.ts` — the `LlmProvider` interface and shared request/response/error shapes:
  ```ts
  export interface LlmGenerateRequest {
    systemPrompt: string;
    userPrompt: string;
    model: string;          // provider-specific model id
    timeoutMs: number;      // 45_000 per §9
  }
  export interface LlmGenerateResult {
    text: string;
  }
  export type LlmErrorCode =
    | "timeout" | "network" | "auth" | "rate-limit" | "invalid-response" | "provider-not-running" | "unknown";
  export class LlmError extends Error {
    constructor(public code: LlmErrorCode, message: string) { super(message); }
  }
  export interface LlmModelOption { id: string; label: string; tier: "fast" | "balanced" | "best"; }
  export interface LlmProvider {
    id: "ollama" | "remote";
    /** static, hardcoded per §9 — no dynamic fetch in v1 (EC-9). */
    listModels(): LlmModelOption[];
    generate(req: LlmGenerateRequest): Promise<LlmGenerateResult>;
  }
  ```
- `apps/daemon/src/llm/ollamaProvider.ts` — calls `http://127.0.0.1:11434/api/generate` (or `/api/chat`) via Node's built-in `fetch`/`http`, no API key. Hardcoded `listModels()` returning 3 fixed Ollama model ids (e.g. `llama3.2:3b` fast / `llama3.1:8b` balanced / `llama3.1:70b` or whatever the team picks as "best" — **exact model ids are a dev-time decision, not an architecture decision**; placeholder ids only, dev must confirm they're real installable Ollama tags before shipping). Maps Ollama connection-refused → `LlmError("provider-not-running", ...)`, JSON-decode failure → `invalid-response`, AbortController timeout → `timeout`.
- `apps/daemon/src/llm/remoteProvider.ts` — **stub-grade in v1, per §9** ("doesn't need a finished provider-switch UI" — but the interface/seam must exist and be real, not a TODO). Implements the same `LlmProvider` interface against e.g. Anthropic's Messages API. Reads its API key exclusively from daemon-owned config (see §10.4) — never from a request param, never from `apps/web`. If no key is configured, `generate()` throws `LlmError("auth", "Chưa cấu hình API key cho remote provider.")` immediately (no network call attempted) — this keeps the seam real/testable (unit test: "remote provider without key throws auth before any fetch") without requiring a live remote key to exist in CI/dev.
- `apps/daemon/src/llm/registry.ts` — tiny factory: `getProvider(providerId: "ollama" | "remote"): LlmProvider`. v1 always resolves `"ollama"` as the *default and only currently-reachable-from-UI* provider (per §9 "Ollama is the v1 default... doesn't need a finished provider-switch UI"); the registry still accepts `"remote"` so the seam is exercised by unit tests even though no web UI control sends it yet.
- Modify `apps/daemon/src/rpc/handlers.ts` — add one new handler, `generateBody` (see §10.2 for the contract). This is the **first async, slow, externally-fallible handler** in the codebase; existing handlers are all fast/local. It must NOT block the event loop and must respect the 45s budget via `AbortController`, not a manual `setTimeout` that leaves the underlying request running.
- Modify `apps/daemon/src/rpc/contract.ts` and `packages/rpc-types/src/index.ts` — add `GenerateBodyParams`/`GenerateBodyResult`, add `"generateBody"` to `RpcMethod`.
- Modify `apps/daemon/src/server.ts` — `generateBody` is a **mutating-by-cost** (network egress) but **non-filesystem-mutating** method. It must NOT be added to `READ_ONLY_METHODS` (that set today gates the *token requirement*, and read-only methods still require the token except bare `ping` — re-read the actual code: every method except `ping` already requires the token regardless of the set's membership, because of the `method !== "ping"` check). Decision: leave `READ_ONLY_METHODS` semantically as "doesn't write to the project's managed files" (it's used nowhere else today besides token-gating, confirmed by reading `server.ts`) — `generateBody` does not belong in it (it does something with real-world side effects: an outbound network call with cost), but functionally this only affects which methods are conceptually labeled read-only for future use, not auth. No change to the auth/token logic itself is required.
- New: `apps/daemon/src/llm/cooldown.ts` is **not** needed server-side — §9 places the cooldown client-side ("client-side cooldown… independent of the FR-8 concurrency guard"). The daemon still independently enforces single-flight-per-process simplicity (no daemon-side queue/cooldown is required by spec, but the daemon does not need to defend against a malicious replay here since this is a single local user — out of scope).

**`apps/web` (presentation + RPC call-site only)**

New files:
- `apps/web/src/components/GenerateBodyButton.tsx` — replaces `GenerateDescriptionButton` as the body-field affordance (NOT a rename/reuse of the same component — different props, different async contract, different confirm-copy, different disclosure UI; the old component is left in place untouched per §9 Q6, simply no longer imported by the two forms for the description slot).
- `apps/web/src/components/ModelPicker.tsx` — small dropdown (native `<select>` or a minimal custom popover, consistent with the existing un-styled-shadcn-lite aesthetic seen in `dialog.tsx`/`button.tsx`) listing the 3 fixed models returned by... **see Risk R1 in §10.7: v1 has no RPC to fetch `listModels()` from the daemon.** Resolution chosen here (not reopening §9, just filling an implementation gap §9 didn't address): the 3 fixed model ids/labels are duplicated as a **small static constant in `apps/web`** (e.g. `apps/web/src/lib/llmModels.ts`) mirroring (but not importing, since web can't import daemon-internal modules) the daemon's hardcoded Ollama model list. This is the same "static, no dynamic fetch" posture §9 already locked for the model list — it just clarifies *where* the static list physically lives on each side. Dev must keep the two lists in sync by hand (flagged in test plan as a manual-sync invariant, see TC-M1).
- `apps/web/src/components/GenerateBodyDisclosure.tsx` — the persistent micro-copy line + the one-time first-use dialog, both provider-conditional per §9's nuance note. First-use "has this been shown" flag persists in `localStorage` (e.g. key `symbion.llmDisclosureSeen.v1`) — a pure browser-local UI flag, not a secret, not project data, so it does not need to go through the daemon/RPC boundary or `.symbion/store.json`.
- Modify `apps/web/src/components/AgentForm.tsx` and `apps/web/src/components/WorkflowForm.tsx`:
  - Remove `GenerateDescriptionButton` + its `generateDescription()` call site from next to `description` (FR-1/AC-1).
  - Add `<GenerateBodyButton>` + `<ModelPicker>` + `<GenerateBodyDisclosure>` adjacent to the "Nội dung" `<textarea>`.

No new shadcn primitives are strictly required; the existing minimal `Dialog`/`Button` primitives are reused for both the confirm-replace dialog and the first-use disclosure dialog.

### 10.2 New RPC method: `generateBody`

```ts
// packages/rpc-types/src/index.ts (+ daemon contract.ts re-export, + web types.ts re-export)
export interface GenerateBodyParams {
  kind: "agent" | "command";
  name: string;
  description: string;
  existingBody: string;
  /** which of the 3 fixed model ids the user picked this click; required, no server default guess. */
  modelId: string;
  /** "ollama" is the only value the v1 UI ever actually sends; "remote" is accepted by the
   *  contract/handler (seam exercised by unit tests) but no web control sends it yet. */
  providerId: "ollama" | "remote";
}
export interface GenerateBodyResult {
  body: string;
}
// errors surface via the existing RpcError/DaemonRpcError path with codes:
// "llm-timeout" | "llm-network" | "llm-auth" | "llm-rate-limit" | "llm-invalid-response" | "llm-provider-not-running"
```

Handler (`apps/daemon/src/rpc/handlers.ts`):
```ts
async generateBody(params: contract.GenerateBodyParams): Promise<contract.GenerateBodyResult> {
  const provider = getProvider(params.providerId);
  const { system, user } = buildBodyGenerationPrompt({
    kind: params.kind, name: params.name, description: params.description, existingBody: params.existingBody,
  });
  try {
    const result = await provider.generate({ systemPrompt: system, userPrompt: user, model: params.modelId, timeoutMs: 45_000 });
    return { body: result.text };
  } catch (err) {
    if (err instanceof LlmError) throw new RpcError(`llm-${err.code}`, humanMessageFor(err.code));
    throw new RpcError("llm-unknown", "Lỗi không xác định khi gọi mô hình AI.");
  }
}
```
- No project/projectId is required as input — this method does not touch `.symbion/store.json` or any project file at all (it's pure inference, not persistence); the generated text is applied to in-memory form state in `apps/web` exactly like typing, and only reaches disk later via the existing `saveArtifact` RPC, unchanged. This keeps `generateBody` fully decoupled from filesystem-safety machinery (no backup/diff/marker concerns apply to it — it never writes a file itself).
- `findProjectPath`/`loadProjectStore` are deliberately NOT called by this handler. (Confirmed by design, not an oversight: the request body already carries all needed context inline; requiring a `projectId` would only add a failure mode — "project not found" — with no benefit.)

### 10.3 Data flow

```
AgentForm/WorkflowForm (in-memory IR state, never auto-saved)
   │  user clicks GenerateBodyButton (+ has chosen a model via ModelPicker)
   ▼
GenerateBodyButton:
   - if daemon disconnected (useArtifactStore.daemonConnected === false) -> button disabled, same as Save/Publish (EC-8)
   - if Nội dung non-empty -> confirm dialog first; only proceeds to the RPC call after explicit confirm (FR-5/EC-2)
   - if first-ever click in this browser (localStorage flag unset) -> show one-time disclosure dialog,
     provider-conditional copy; proceeds to RPC call only after dismissal/ack
   - client-side cooldown: button stays disabled for N seconds (e.g. 4s) after the *previous* call's
     completion (success or error), independent of the in-flight busyRef guard (§9 Q12)
   ▼ callRpc("generateBody", { kind, name, description, existingBody, modelId, providerId: "ollama" })
   ▼  (typed fetch POST http://127.0.0.1:<port>/rpc with x-symbion-token header — existing transport, unchanged)
apps/daemon HTTP server (server.ts)
   - origin/host/token checks unchanged
   - routes to handlers.generateBody
   ▼
handlers.generateBody
   - buildBodyGenerationPrompt(...) [packages/core, pure]
   - getProvider("ollama") -> OllamaProvider
   - provider.generate({ system, user, model: modelId, timeoutMs: 45000 })
        - fetch() to http://127.0.0.1:11434/... with an AbortController tied to a 45s setTimeout
        - on AbortError -> throw LlmError("timeout", ...)
        - on ECONNREFUSED/fetch network failure -> throw LlmError("provider-not-running", ...)
        - on non-2xx / malformed JSON body -> throw LlmError("invalid-response", ...)
   ▼ (success) { body: "<generated markdown>" }      OR      (failure) RpcError("llm-<code>", message)
   ▼
apps/web callRpc resolves/rejects
   - success -> GenerateBodyButton applies `body` into the already-confirmed slot:
        if Nội dung was empty -> update("body", generated) directly
        if Nội dung was non-empty -> only reachable here because confirm already happened -> update("body", generated)
        (note: confirm happens BEFORE the network call per the dialog UX above, not after -- see EC-2 detail in §10.5)
   - failure -> inline non-blocking error shown next to the button; Nội dung field is left exactly as it was
     before the click (untouched); rest of form (Save/Publish) unaffected, busyRef + button re-enabled
     (after cooldown elapses)
   ▼
User reviews generated text as an ordinary editable textarea value -> may hand-edit -> Save (saveArtifact RPC,
unchanged) -> Publish (render/computeDiff/write RPC pipeline, completely unchanged — generateBody never
touches that pipeline).
```

**Which RPC methods touch disk**: `generateBody` touches **neither disk nor git** — it is pure inference in, text out. It is the *first* RPC method in the system whose side effect is "network egress to a local or remote process," not "filesystem mutation." This is a meaningfully different trust category from `write`/`saveArtifact`, and the design deliberately keeps it outside the render→diff→write pipeline entirely (no marker, no hash, no backup — none of that applies to in-memory draft text).

### 10.4 Local-store/config schema changes

Per §9, v1 ships with Ollama as the only reachable-from-UI provider and does not need a finished key-entry UI for the remote adapter — but the **seam must exist** in the daemon-owned config so a future ticket can wire a settings screen without another schema migration.

`packages/core/src/ir/types.ts` — extend `GlobalConfig` (schemaVersion stays `1`; this is an additive, optional-field change, not a breaking migration, consistent with how `ProjectSettings`/`GlobalConfig` have evolved so far):
```ts
export interface GlobalConfig {
  schemaVersion: 1;
  port: number;
  theme: "system" | "light" | "dark";
  lastProjectId?: string;
  builderDefaultTab: "form" | "markdown";
  projects: Array<{ id: string; name: string; path: string }>;
  /** NEW — seam for the remote LLM provider's credential, daemon-owned only.
   *  apps/web never reads or writes this field; it is never sent in any RPC
   *  response body. v1 has no UI to populate it — set manually in
   *  ~/.config/symbion/config.json or (preferred) via env var, see below. */
  llm?: {
    /** which provider the (future) provider-switch UI would default to; "ollama" today. */
    activeProvider?: "ollama" | "remote";
  };
}
```
- **The remote API key itself is NOT stored in `config.json`.** Per the existing project posture (config.json is plain JSON on disk, not encrypted) and per §9's "key held only in daemon-owned config/env," the lower-risk v1 seam is: the daemon reads the remote key **exclusively from an environment variable** (e.g. `SYMBION_REMOTE_LLM_API_KEY`) at the moment `remoteProvider.generate()` is invoked — never persisted to any JSON file by Symbion itself. This avoids adding "a plaintext secret on disk" as a new risk surface in a v1 where the remote path isn't even reachable from the UI yet. If/when a settings UI is built, that is the moment to decide whether the key moves into an OS keychain / encrypted store — flagged here as a follow-up decision, not resolved now (no UI exists to need it yet).
- `apps/daemon/src/store/store.ts` needs no migration logic changes — `llm` is optional and absent configs simply have `config.llm === undefined`, same pattern as other optional fields would have.
- **No changes to `ProjectSettings`/`.symbion/store.json`** — model choice is per-click (§9), not persisted per-project, so nothing about an individual project's store needs to know about LLM provider/model at all.

### 10.5 Edge cases — exact required behavior (EC-1 through EC-11, now resolved per §9)

| # | Required behavior |
|---|---|
| EC-1 | Always-clickable (§9 Q7). Name-only context still sends `{ kind, name, description: "", existingBody: "" }` to the model; `buildBodyGenerationPrompt` must produce a coherent system+user prompt even when `description`/`existingBody` are empty strings (explicit unit test, not just "happens to work"). No "add more context" gate anywhere in the UI. |
| EC-2 | Confirm-before-replace dialog only (§9 Q8) — no append/insert-at-cursor option offered. Sequencing: confirm dialog appears **before** the RPC call fires (not generate-then-ask) — this avoids burning a real, costly inference call that the user then discards, and avoids the awkward UX of "here's a draft, do you want it" when the answer might be "no, don't even bother." Only on explicit "Replace" does `callRpc("generateBody", …)` fire. If Nội dung is empty, no dialog — proceeds straight to the call. |
| EC-3 | Single round-trip (§9 Q4), 45s timeout (§9 model-picker-bundle answer). Loading state: button shows a spinner + disabled state; no token-by-token feedback (no streaming transport exists). At 45s with no response, the in-flight fetch is aborted daemon-side (`AbortController`), the RPC rejects with `llm-timeout`, and the button surfaces an inline "Generation timed out" message with a **Retry** action that re-fires the exact same request (same model/context) — not a generic "click generate again" (the retry button specifically re-submits, sparing the user from re-opening the model picker). |
| EC-4 | Each failure mode maps to a distinct, human-readable Vietnamese message (consistent with the rest of the app's UI language) surfaced inline next to the button: `llm-provider-not-running` -> "Không thể kết nối tới Ollama — đảm bảo Ollama đang chạy trên máy."; `llm-timeout` -> "Quá thời gian chờ (45s) — thử lại."; `llm-auth` -> "Thiếu hoặc sai cấu hình API key cho remote provider."; `llm-rate-limit` -> "Bị giới hạn tần suất gọi — thử lại sau."; `llm-invalid-response` -> "Phản hồi không hợp lệ từ mô hình."; generic `llm-unknown`/network -> "Lỗi không xác định, thử lại." In every case: Nội dung field value is provably unchanged (no partial/garbled write), Save/Publish remain enabled. |
| EC-5 | Two independent guards, per §9: (1) `busyRef`-style in-flight guard (same pattern as `GenerateDescriptionButton`) blocks a second concurrent RPC call while one is in flight — button is `disabled` for the entire duration; (2) a separate client-side cooldown timer (a few seconds, e.g. 4s) keeps the button disabled for a short window *after* the previous call resolves (success or error), to blunt rapid-fire re-clicking even once the first call has finished (§9 Q12). No cancel affordance (§9 Q5) — the button has exactly one active/disabled binary state while in flight, never a "cancel" label. |
| EC-6 | No behavior change needed beyond "don't add any watcher" — `name`/`description` edits after a generation has landed in Nội dung never trigger auto-regeneration; Nội dung remains an ordinary, independently-edited textarea value once populated, exactly like manual typing (no `wasGenerated` flag per AC-8). |
| EC-7 | Disclosure is the persistent micro-copy (always visible next to the button) **+** the one-time first-use dialog (§9 Q11), both provider-conditional: when `providerId === "ollama"` copy reads roughly "Tạo nội dung bằng AI cục bộ (Ollama) — gửi tên/mô tả/nội dung hiện tại tới mô hình chạy trên máy bạn, không gửi ra ngoài." (no "leaves your machine" framing since it doesn't); the (currently unreachable from UI, but contract-tested) remote path's copy must instead say content **does** leave the machine to the named third-party provider. This conditional copy lives in `GenerateBodyDisclosure.tsx`, keyed off the `providerId` value actually being sent, not a hardcoded assumption. |
| EC-8 | `GenerateBodyButton` reads `useArtifactStore((s) => s.daemonConnected)` (same store/field `DaemonStatusBadge` already reads) and renders `disabled` whenever `daemonConnected === false`, exactly mirroring how Save/Publish already gate on this today (confirmed by reading `useArtifactStore.ts`/`DaemonStatusBadge.tsx` — no new daemon-connectivity primitive needed, this is a straight reuse). |
| EC-9 | Hardcoded 3-model list, no dynamic fetch, per §9 — resolved structurally (see Risk R1 in §10.7 for the "list lives in two places" follow-up note). If a user picks a model id that Ollama doesn't actually have pulled locally, Ollama's own API returns a 404/error for that model — this surfaces through the existing `llm-invalid-response` (or a more specific `llm-provider-not-running`-adjacent code if Ollama's error shape allows distinguishing "model not found" from "Ollama not running" — dev should map Ollama's specific "model not found" error string to a slightly more actionable message if cheaply detectable, but is not required to build a model-existence-probe RPC for v1). |
| EC-10 | No normalization. Unlike `generateDescription()`'s single-line YAML-safety constraint, `generateBody`'s result is inserted verbatim (after trim of leading/trailing whitespace only) into the existing multi-line `body` field — the same field that already accepts arbitrary multi-line markdown today. No length cap, no line-collapsing, no heading-stripping. Confirmed explicitly per §9 framing (EC-10's own text already expected this; no contradicting signal in §9). |
| EC-11 | Skipped for v1 (§9 Q10, locked) — `WorkflowForm`'s `generateBody` call sends only `{ kind: "command", name, description, existingBody }`; `extractAgentMentions(artifact.body)` already used elsewhere in `WorkflowForm.tsx` for the mentions-list UI is **not** additionally threaded into the generation context. |

### 10.6 Test-plan pointer

Full concrete test plan: `docs/loops/auto-generate-body-testplan.md`.

### 10.7 Trade-off decisions, assumptions, and risks for dev/Checker to track

- **R1 (flagged, not a §9 reopening) — static model list exists in two places.** Because there is no `listModels` RPC round-trip in v1 (per §9's "no dynamic model-list fetch"), the 3 fixed model ids/labels must be known to both `apps/web` (to render the `ModelPicker` dropdown) and `apps/daemon`'s `OllamaProvider` (to validate/pass through to Ollama). Without a `listModels` RPC, these are two independently-maintained constants that must be kept in sync by hand. **This is a real architectural seam gap left by §9's locked answer, not an oversight to silently patch around** — the alternative (adding a cheap synchronous `listModels` RPC that returns the daemon's hardcoded list, so web has one source of truth) is **explicitly not implemented** here because §9 said "no dynamic model-list fetch," but flagging: that phrase most naturally reads as "don't hit Ollama's network API to discover models," not necessarily "don't even have one cheap local RPC echoing a hardcoded constant." Recommend the dev raise this distinction back to the user/PM before implementing, since a single `listModels` RPC (zero network calls inside it, instant response, no behavior difference visible to the end user) would remove the manual-sync footgun at near-zero cost — but per this doc's own root-cause doctrine, that is a question to ask, not silently decide; if no answer is available, the safer default that doesn't violate §9's literal text is **duplicate the constant in both places** (what §10.1 specifies above) and add the manual-sync test (TC-M1 in the test plan) as a tripwire.
- **R2 — exact Ollama model ids are unspecified by this design.** §9 locks "3 fixed models (fast/balanced/best tier)" but does not name which Ollama tags. Architecture leaves this as three named placeholder constants the dev must fill with real, currently-pullable Ollama model tags (and document the exact tags chosen in the PR description) — not an open architecture question, just a content/config detail deferred to implementation.
- **R3 — daemon has no per-request abort/timeout precedent.** This is explicitly called out as "the first of its kind on all three axes" in the brief. The design above standardizes on Node's native `AbortController` + `fetch`'s `signal` option (available in the Node version already used elsewhere in the daemon, confirmed Node has global `fetch` since v18, and `apps/daemon`'s `@types/node": "^20.14.10"` confirms a modern enough Node target) rather than introducing a new dependency (e.g. `p-timeout`) — keeping the dependency surface unchanged.
- **R4 — `generateBody` is the first async daemon RPC handler whose *failure* is expected and routine** (vs. e.g. `browseFolder`, the only other currently-async handler, which fails rarely). The `RpcError` mechanism already supports arbitrary `code`/`message` pairs with no changes needed to `server.ts`'s catch block — confirmed by reading `server.ts`'s existing `catch (err) { if (err instanceof RpcError) ... }` path, so no transport-level change is required, only new `RpcError` subcodes.
- **Assumption A1** — Ollama is assumed already running on the dev/user's machine at the default port 11434 for `generateBody` to succeed at all; this design does not include any "auto-launch Ollama" capability — `provider-not-running` is a first-class, expected error state, not an edge case to engineer away.
- **Assumption A2** — the disclosure's one-time first-use dialog state (`localStorage` flag) is intentionally **not** part of `.symbion/store.json` or `~/.config/symbion/config.json` — it is purely a per-browser-profile UI nicety, not project data, so multiple projects/machines will each show the one-time dialog once independently; this is acceptable because the *persistent* micro-copy (always visible) is the actual compliance-bearing disclosure, the dialog is a courtesy enhancement.
- **Assumption A3** — `buildBodyGenerationPrompt`'s exact wording (the system/user prompt text sent to the model) is a content decision for the dev to draft and the test plan to pin down via snapshot tests, not an architectural one — the requirement here is only that it deterministically incorporates all four context fields and degrades gracefully when description/existingBody are empty (EC-1).

> Suggest running **`/build`** next (`feature-builder`), implementing in this order: (1) `packages/core` prompt builder + its unit tests, (2) `packages/rpc-types` + daemon contract additions, (3) `apps/daemon/src/llm/*` (Ollama + remote-stub providers + registry) + handler + daemon unit/integration tests, (4) `apps/web` components (button/model-picker/disclosure/confirm-dialog) + form wiring + removal of the old description-slot button, (5) e2e per the test plan.

---

## 11. BUILD (feature-builder/Maker) — completed 2026-06-27, phase = BUILD (awaiting /review, /cso, /qa)

### 11.0 Amendment to §10.7 Risk R1 (approved by user before this build, applied as locked)

R1 is resolved as **"add a `listModels` RPC method"** — NOT the §10.1/§10.7 "duplicate the constant in both places" fallback. A new `listModels` RPC handler in `apps/daemon` synchronously returns the daemon's own hardcoded 3-model list (zero network calls inside the handler, instant response). `apps/web`'s `ModelPicker.tsx` fetches this list via `callRpc("listModels", { providerId })` on mount instead of holding any hand-duplicated constant. This deviates from §10.1's literal text ("the 3 fixed model ids/labels are duplicated as a small static constant in apps/web") — flagging explicitly since the user approved this specific deviation outside the doc text.

### 11.1 What was built, file by file

**`packages/core` (pure, no fs/net/Node imports — verified via `tsc` build + a static-grep unit test):**
- `packages/core/src/generate/bodyPrompt.ts` — `buildBodyGenerationPrompt(input: BodyPromptInput): { system: string; user: string }`. Builds a Vietnamese system+user prompt pair from `{ kind, name, description, existingBody }`. Empty `description`/`existingBody` are rendered as an explicit `"(chưa có)"` placeholder rather than a dangling label (EC-1). `kind: "agent"` vs `"command"` produce textually distinct system prompts (different framing: "sub-agent system prompt" vs "slash command orchestration body").
- `packages/core/src/index.ts` — added `export * from "./generate/bodyPrompt.js"` to the public barrel. `generateDescription`/`description.ts` left untouched (§9 Q6 dead code, still exported).
- `packages/core/src/ir/types.ts` — added an **optional** `llm?: { activeProvider?: "ollama" | "remote" }` field to `GlobalConfig` (additive, non-breaking; `DEFAULT_GLOBAL_CONFIG` intentionally NOT updated to set it, so it stays `undefined` for fresh configs) — the seam described in §10.4. The remote API key itself is never stored in this or any config file.
- `packages/core/test/generate-bodyPrompt.test.ts` — TC-C1 through TC-C5 plus an extra TC-C3b (fully-empty-including-name) edge case. 6 tests, all passing.

**`packages/rpc-types` + daemon contract:**
- `packages/rpc-types/src/index.ts` — added `LlmModelOption`, `ListModelsParams`/`ListModelsResult`, `GenerateBodyParams`/`GenerateBodyResult`, and `"listModels"`/`"generateBody"` to the `RpcMethod` union. `GenerateBodyParams` matches §10.2 exactly (`kind`, `name`, `description`, `existingBody`, `modelId`, `providerId`).
- `apps/daemon/src/rpc/contract.ts` and `apps/web/src/lib/rpc/types.ts` — both re-export the new types from `@symbion/rpc-types` (no hand-mirroring, per the existing pattern).

**`apps/daemon/src/llm/*` (new directory, daemon-only, the only place network calls happen):**
- `types.ts` — `LlmProvider` interface, `LlmError` class with `LlmErrorCode` = `"timeout" | "network" | "auth" | "rate-limit" | "invalid-response" | "provider-not-running" | "unknown"`, `LlmModelOption`, `LlmGenerateRequest`/`LlmGenerateResult`.
- `ollamaProvider.ts` — `OllamaProvider` calls `POST {baseUrl}/api/generate` (non-streaming, `stream: false`) via native `fetch` + `AbortController`. Default `baseUrl` is `http://127.0.0.1:11434`, overridable via constructor option OR the `SYMBION_OLLAMA_BASE_URL` env var (env var added so tests/e2e can redirect to a fake server without threading a param through the `registry.ts` factory — **this env var is a build-time addition not mentioned in §10**, flagging for Checker). Maps: fetch-throws-while-aborted → `timeout`; fetch-throws-otherwise → `provider-not-running`; HTTP 404 → `invalid-response` (with a "model not found" framing in the message); other non-2xx → `invalid-response`; non-JSON body → `invalid-response`; missing `response` field in JSON → `invalid-response`. **Hardcoded `listModels()` returns 3 model ids — `llama3.2:1b` (fast), `llama3.1:8b` (balanced), `llama3.1:70b` (best) — these are placeholder tags per §10.7 R2; Checker/QA must independently verify these are still real, currently-pullable Ollama tags as of today, this was not verified against a live Ollama registry during build.**
- `remoteProvider.ts` — `RemoteProvider`, modeled on Anthropic's Messages API shape (`x-api-key` header, `anthropic-version: 2023-06-01`, `/v1/messages` body shape) purely as a concrete placeholder vendor — **no specific vendor was confirmed by the user; this is an assumption**, not a locked choice (§9 only locked "remote API, pluggable, seam only"). Reads the key exclusively from `process.env.SYMBION_REMOTE_LLM_API_KEY` (constant exported as `REMOTE_API_KEY_ENV_VAR`) — if unset, throws `LlmError("auth", ...)` immediately with **zero** `fetch` calls attempted (verified by a spy-based test). Maps HTTP 401/403 → `auth`, 429 → `rate-limit`, other non-2xx → `invalid-response`. Hardcoded `listModels()` returns 3 placeholder Claude model ids (`claude-haiku-4-5`/`claude-sonnet-4-5`/`claude-opus-4-1`) — also unverified against any live API, purely illustrative for the seam.
- `registry.ts` — `getProvider(providerId)` factory; throws synchronously on an unrecognized id (no silent default).

**`apps/daemon/src/rpc/handlers.ts`:**
- Added `listModels(params)` — synchronous, calls `getProvider(params.providerId).listModels()`, zero network calls (per the §10.7 R1 amendment in §11.0 above).
- Added `generateBody(params)` — async; validates field sizes/types defensively first (new `MAX_FIELD_LEN = 50_000` cap on `name`/`description`/`existingBody`, `modelId` non-empty/≤200 chars — **this defensive cap has no precedent elsewhere in the RPC surface; it's a new pattern introduced specifically for this handler per the security-checklist item in the test plan**, throws `RpcError("invalid-params", ...)` on violation), then builds the prompt via `buildBodyGenerationPrompt`, calls `provider.generate(...)` with a **hardcoded `timeoutMs: 45_000`** (matches §10.2's snippet exactly), maps `LlmError` → `RpcError("llm-" + code, <Vietnamese message>)` per the exact EC-4 taxonomy, and any non-`LlmError` exception → `RpcError("llm-unknown", ...)`. Does **not** call `findProjectPath`/`loadProjectStore` (confirmed by test TC-H1: project store `mtime` unchanged after a call).

**`apps/daemon/src/server.ts`:**
- `listModels` added to `READ_ONLY_METHODS` (semantic label only, no fs mutation, zero network calls). `generateBody` deliberately NOT added to that set, per §10.1's explicit instruction — this has **no effect on auth** (every non-`ping` method already requires the token regardless of set membership, unchanged).

**Daemon tests added** (all passing, 65 tests total in `apps/daemon`):
- `test/llm-ollamaProvider.test.ts` (TC-D1–TC-D6, Tier A fake-HTTP-server per testplan §0 — a real `node:http` server, not a `fetch` mock).
- `test/llm-remoteProvider.test.ts` (TC-D7, TC-D8).
- `test/llm-registry.test.ts` (TC-D9).
- `test/rpc-generateBody.test.ts` (TC-H1, TC-H2, TC-H4, TC-H5, TC-H6, plus the defensive-size-cap test). **TC-H3 (timeout mapped through the handler) is explicitly NOT covered at the handler layer** — the handler hardcodes `timeoutMs: 45_000` so a real 45s wait would be required; the raw timeout path is instead covered at the provider layer only (`llm-ollamaProvider.test.ts` TC-D3, which uses an injectable short `timeoutMs`). This is called out as a documented coverage gap in the test file itself — **Checker should decide whether this gap is acceptable or whether the handler needs an injectable timeout for testability.**
- `test/server.integration.test.ts` — added TC-S1–TC-S4 (`generateBody` transport: token/origin/concurrency) and 2 more for `listModels` token-gating, using a fake Ollama HTTP server + the new `SYMBION_OLLAMA_BASE_URL` env var.

**`apps/web`:**
- `src/components/ModelPicker.tsx` — fetches `listModels` via `callRpc` on mount (per §11.0's amendment), renders a native `<select>` with `aria-label="Chọn mô hình AI"`, defaults to the first returned model if none selected yet. On RPC failure, shows an inline error string instead of the select.
- `src/components/GenerateBodyDisclosure.tsx` — **renders ONLY the persistent micro-copy line** (`<p>`), provider-conditional per EC-7. **Deviation from a literal reading of §10.1's file list**: the one-time first-use dialog is NOT rendered by this component (an earlier build attempt had it open-on-mount here, which broke unrelated form interactions — see §11.2 below for why). The dialog markup/logic instead lives inside `GenerateBodyButton.tsx`, triggered only by the *first click* of the generate button, matching §10.3's literal data-flow description ("if first-ever click in this browser ... show one-time disclosure dialog ... proceeds to RPC call only after dismissal/ack"). `GenerateBodyDisclosure.tsx` exports the copy-string functions (`persistentDisclosureCopy`, `firstUseDisclosureCopy`) and the localStorage flag key constant so `GenerateBodyButton.tsx` can reuse them without duplicating copy text.
- `src/components/GenerateBodyButton.tsx` — owns: busyRef in-flight guard (EC-5 #1), `cooldown` state with a `setTimeout`-based 4000ms window after every resolve success-or-error (EC-5 #2, §9 Q12), the first-use disclosure dialog (gates the very first click, see above), the confirm-before-replace dialog (EC-2, fires before any RPC call), the EC-4 error-code → Vietnamese-message map, a "Thử lại" (Retry) action shown only for `llm-timeout` that re-fires the exact same params, and the `daemonConnected` gate (EC-8, read from `useArtifactStore`).
- `src/components/AgentForm.tsx` / `src/components/WorkflowForm.tsx` — `GenerateDescriptionButton` import and JSX usage removed from beside `description` (now a plain `Input` with no button) on both forms. `<ModelPicker>` + `<GenerateBodyButton>` + `<GenerateBodyDisclosure>` added adjacent to the "Nội dung" `<textarea>` on both forms. Each form holds its own local `bodyModelId` state (per-click selection, not persisted — §9 Q2/Q3/Q9).

### 11.2 A real bug found and fixed during build (flagging explicitly, not silently)

The first implementation had `GenerateBodyDisclosure` open its one-time first-use dialog **on component mount** (i.e., every time `AgentForm`/`WorkflowForm` rendered for a fresh browser profile). Running the full Playwright e2e suite (`npx playwright test`) showed this **broke the pre-existing, unrelated `auto-generate-description.spec.ts` and `happy-path.spec.ts` suites** — the dialog's full-screen backdrop intercepted clicks on the `tools` toggle buttons (Read/Grep/etc.) elsewhere on the same form, timing out unrelated tests. Root cause: §10.3's data flow literally says the disclosure triggers on "first-ever click," not on mount — the first build pass misread/mis-implemented this. Fixed by moving the dialog's open/close state and trigger logic into `GenerateBodyButton.handleClick`, so it only opens in response to a user clicking generate, matching the locked spec text. This is recorded here so the Checker independently re-verifies this specific behavior (dialog does NOT appear merely from opening the builder form) rather than trusting the fix at face value.

### 11.3 Existing e2e suite retired (flagging explicitly)

`e2e/auto-generate-description.spec.ts` → renamed to `e2e/auto-generate-description.spec.ts.retired` (no longer matches Playwright's `*.spec.ts` glob, so it's excluded from the run rather than deleted). This suite exercised `GenerateDescriptionButton` rendered next to `description` on both forms — per FR-1 (LOCKED) that button is removed from that location, so all 8 of that suite's tests now fail with "button not found" timeouts (confirmed by running it before retiring). The file is kept on disk (not deleted) with a comment explaining why, for history/Checker reference. **Checker should confirm this retirement is the correct call** rather than, say, deleting `GenerateDescriptionButton.tsx` itself or trying to keep the old suite green by some other means — `generateDescription()`/`GenerateDescriptionButton.tsx` remain in the codebase, unused, per §9 Q6.

### 11.4 Test results at time of this update

- `npm test` (root, runs `core` + `daemon` Vitest projects): **141 passed**, 0 failed, 19 test files.
- `npx playwright test` (root config, both `e2e/happy-path.spec.ts` and the new `e2e/auto-generate-body.spec.ts`): **9 passed**, 0 failed.
- `npm run build` (all 4 workspaces: core, rpc-types, daemon, web): clean, no type errors.
- Tier B (real local Ollama with the exact 3 placeholder tags actually pulled) was **NOT exercised** — no Ollama instance was available in this build environment. This is exactly the gap the test plan's §0 anticipates and explicitly permits ("degrade to skipped, never fail").

### 11.5 Assumptions for the Checker (`/review`, `/cso`, `/qa`) to verify independently — do NOT treat any of these as already validated

1. **Exact Ollama model tags** (`llama3.2:1b`, `llama3.1:8b`, `llama3.1:70b`) were chosen as plausible-sounding real Ollama tags from general knowledge, NOT verified against a live `ollama list`/registry during this build. Checker/QA must confirm these are still real, pullable tags (R2 in §10.7).
2. **Exact remote-provider shape** (Anthropic Messages API, `claude-haiku-4-5`/`claude-sonnet-4-5`/`claude-opus-4-1` model ids) is an unconfirmed placeholder choice — §9 never locked a specific remote vendor, only "pluggable, seam only, not wired to UI." If this seam is ever activated, the model ids/endpoint shape should be reconfirmed against whatever vendor is actually chosen at that time.
3. **`SYMBION_OLLAMA_BASE_URL` env var** was added to `OllamaProvider` (not in §10's text) purely as a test/e2e injection point, mirroring the existing `SYMBION_CONFIG_DIR` pattern already used by `server.integration.test.ts`/`daemon-fixture.ts`. Checker should confirm this doesn't constitute an unintended "configurable Ollama endpoint" feature surface beyond what was asked (it is not exposed in any UI; only consumed via `process.env` at provider-construction time).
4. **Defensive RPC input-size cap** (`MAX_FIELD_LEN = 50_000` on `name`/`description`/`existingBody`) was added with no existing precedent elsewhere in the codebase to match against (confirmed by grep — no other handler has a size cap). The `50_000` figure is an arbitrary round number chosen by the Maker, not derived from any spec'd limit. Checker/security-reviewer should sanity-check this value and whether the same gap exists on other RPC handlers that take free-text fields (e.g. `saveArtifact`) — out of scope for this feature to fix, but worth flagging.
5. **`buildBodyGenerationPrompt`'s exact Vietnamese wording** (the literal system/user prompt text sent to the model) is a Maker-authored content decision per §10.7 Assumption A3 — not reviewed by a human for tone/correctness. Checker/QA should read the actual prompt text in `packages/core/src/generate/bodyPrompt.ts` and confirm it reads naturally and doesn't contain any embedded instruction-injection risk from user-controlled fields (name/description/existingBody are interpolated directly into the user-role prompt with only an empty-string fallback, no escaping/sanitization — flagging this as worth a security-reviewer look, since a malicious `name`/`description` value could in principle contain prompt-injection text aimed at the model; this was not treated as in-scope to defend against per the locked spec, since the model's only effect is filling a UI textarea the user must explicitly review/accept before Save, but it should be confirmed as an accepted risk rather than an oversight).
6. **TC-H3 (timeout error code mapped through the `generateBody` handler specifically, not just the provider)** is not covered by an automated test, as noted in §11.1 — confirmed only at the `OllamaProvider` layer via an injectable short timeout. If the Checker considers this a meaningful gap, the handler likely needs `timeoutMs` to become an injectable param (currently hardcoded at the call site) to test cheaply.
7. **No `apps/web` component-level unit tests exist** (no Vitest/RTL harness configured for `apps/web` in this repo) — TC-W1 through TC-W17 in the test plan were NOT implemented as component tests; their intent is instead covered (partially) by the new Playwright e2e suite (`TC-E1` through `TC-E10`, mapped to a subset of the AC/EC numbers) per the test plan's own fallback instruction ("if none exists yet for components, these become Playwright-level instead"). Several finer-grained component-level assertions (e.g. TC-W12's exact "selecting a different option changes modelId" wiring, TC-W15's "dialog does not reappear after reload" without a full project flow) are NOT independently re-verified at e2e level and should be checked by QA manually or via a future component-test harness addition.
8. **`TC-M1` (manual model-list sync tripwire) is moot** given the §11.0 `listModels`-RPC resolution of R1 — there is no longer a second hand-duplicated list in `apps/web` to drift out of sync with the daemon's. Checker should confirm `apps/web/src/components/ModelPicker.tsx` indeed contains no hardcoded model array (it does not, as written) — i.e. confirm the amendment was actually followed, not just declared.
9. **Security checklist items from the test plan §7** were addressed functionally (key-from-env-only with a spy-verified "zero network calls without key" test; 45s `AbortController`-based timeout that actually aborts, verified by a flag-set-by-fake-server test; Origin/Host allowlisting unaffected, verified by TC-S3 regression) but were NOT independently run through `/cso` (security-reviewer) as part of this build — that is explicitly the next phase's job, not the Maker's, per CLAUDE.md's Maker≠Checker doctrine.

## 12. Review (phase = REVIEW, both checkers PASS — 2026-06-27)

Two independent checkers ran in parallel against the diff: `code-reviewer` (line-level correctness/quality) and `architect` (design-conformance). Both reached **PASS** independently, with only non-blocking 🟡 findings.

**`code-reviewer` verdict: PASS.** All 9 of the Maker's self-flagged assumptions independently re-verified (Ollama model tags are real/plausible tags, not placeholders; `RemoteProvider`'s request shape genuinely matches Anthropic's real Messages API; `SYMBION_OLLAMA_BASE_URL` read correctly with the right default; 50KB cap enforced cleanly pre-prompt-build; prompt-injection risk correctly bounded by JSON field separation and accepted as a reviewed risk, not an oversight; TC-H3 handler-level timeout test gap confirmed real but low-risk since the error-mapping code path is shared; absence of `apps/web` component tests judged acceptable given e2e coverage; `listModels` RPC/R1 fix confirmed genuinely zero-network and the sole source of truth). Baseline checks (core purity, network calls confined to daemon, no secrets in `apps/web`, FR-1/Q6 button placement, EC-2/EC-5/EC-8 behavior) all confirmed by direct code read, not just the Maker's claim. Test suite re-run fresh: 141 unit/integration + 9 e2e, all passing, build clean across all 4 workspaces. 🟡 non-blocking: `params.kind` not runtime-validated against the literal union before reaching the prompt builder; the 50KB cap has no sibling cap on other free-text RPCs (tracked as a follow-up, not this feature's bug); TC-H3 gap.

**`architect` verdict: PASS.** Implementation tracks the locked §10 design with high fidelity: package boundaries hold (core stays pure, network calls live only in `apps/daemon/src/llm/*`), RPC contract shape matches field-for-field, the `LlmProvider` interface + two adapters (Ollama, remote-stub) + registry pattern was actually built as designed (not collapsed into the handler), data-flow sequencing is correct including the easy-to-get-backwards EC-2 confirm-before-call ordering, and the R1 amendment (`listModels` RPC replacing the duplicate-constant fallback) was followed correctly, not just declared. No scope creep beyond §9/§10 (no streaming/cancel/dynamic-discovery/@mention-threading crept in). 🟡 non-blocking: the unannounced 50KB validation cap is genuine (if low-risk) drift from the locked design surface; `LlmErrorCode`'s 7th `"network"` code is a minor internal doc inconsistency between two parts of §10, not a code deviation; TC-H3 gap noted again.

**Net**: no NEEDS-WORK findings from either checker — feature does not return to `/build`. Recommend `/cso` next given this is the daemon's first outbound-network RPC surface (the Maker and both checkers independently flagged the prompt-injection exposure in `bodyPrompt.ts` as "accepted risk, needs security-reviewer confirmation, not silently resolved" — that confirmation is `/cso`'s job), then `/qa` to execute `docs/loops/auto-generate-body-testplan.md` live.

## 13. /cso security review — verdict NEEDS-WORK (2026-06-27) — returned to /build

`security-reviewer` audited the diff (static read + 141/141 test run + two live PoCs against a built daemon). Verdict: **NEEDS-WORK**, two findings to fix before re-review:

- **🟠 HIGH — SSRF via `SYMBION_OLLAMA_BASE_URL`.** `apps/daemon/src/llm/ollamaProvider.ts:38` reads this env var with no validation that the resolved host is loopback. Live PoC confirmed the daemon will `fetch` an arbitrary host set via this var and return the response verbatim through the already-authenticated RPC channel — a write-once-read-back SSRF proxy reachable by anything that can set the daemon's process env (poisoned `.env`, malicious postinstall script, misconfigured deploy). **Fix**: validate the resolved base URL's hostname is `127.0.0.1`/`localhost`/`::1` before use, or restrict the env-var override to a test-only constructor injection path that is not reachable via a production env var.
- **🟡 MEDIUM — `kind`/`providerId` not validated at the RPC boundary; unexpected exceptions leak raw `Error.message` via the generic 500 path.** `apps/daemon/src/rpc/handlers.ts:363-378` + `registry.ts:17-20` — TS unions give zero runtime enforcement once JSON is parsed off the wire; an unknown `providerId` throws a bare `Error` that bypasses the `RpcError` taxonomy and is echoed verbatim in the response (`{"error":{"code":"internal-error","message":"Unknown LLM provider id: ..."}}`). Not exploitable for secret leakage today (only reflects attacker's own input), but normalizes "leak whatever the exception says" on a handler far more likely to throw library/runtime exceptions than prior handlers. **Fix**: validate `kind`/`providerId` explicitly server-side, throw `RpcError("invalid-params", ...)` instead of letting it fall through to the generic 500 handler.

Accepted-as-clean / no change required (confirmed independently, not just on the Maker's word):
- Prompt-injection in `bodyPrompt.ts` — confirmed end-to-end that generated `body` is never auto-saved/auto-executed (plain `<textarea>`, no markdown/HTML renderer anywhere in `apps/web`'s deps, no shell/template-exec step consumes it) — containment via explicit-Save-required holds today. Flagged for future re-evaluation if a markdown renderer or exec step is ever added downstream of `body`.
- Secret handling (`SYMBION_REMOTE_LLM_API_KEY`) — never logged, never echoed, never reaches `apps/web`.
- Localhost bind / origin-token / Origin-Host allowlist — unaffected, both new methods correctly gated.
- Path confinement / destructive-write safety — `generateBody` touches no fs-write path, correctly fully exempt from the backup/diff/marker machinery.
- 🟡 noted but not blocking: no server-side concurrency/rate-limit on `generateBody` (client-side cooldown is browser-only, bypassable by any token holder) — worth a fast follow-up given this is now a cost-bearing surface, but not required to unblock this PASS/NEEDS-WORK gate per the reviewer's own framing; tracked here for visibility, not re-blocking once the two items above are fixed.

**Action**: returning to `/build` for the Maker to fix the 🟠 and 🟡 findings above, then re-run `/cso` before proceeding to `/qa`.

## 14. BUILD (Maker) — targeted security-fix pass for §13's two findings, completed 2026-06-27, phase = BUILD (awaiting re-`/cso`)

> Scope discipline: only the 🟠 HIGH and 🟡 MEDIUM findings below were touched. The explicitly-out-of-scope item ("no server-side rate limiting on `generateBody`") was left untouched, as instructed. Nothing else that already passed `/review`/`/cso` (prompt-injection handling, disclosure UI, confirm-dialog sequencing, cooldown logic) was modified.

### 14.1 Fix for 🟠 HIGH — SSRF via `SYMBION_OLLAMA_BASE_URL`

File: `apps/daemon/src/llm/ollamaProvider.ts`.

- Added `isLoopbackUrl(value: string): boolean` — parses `value` as a `URL` and checks `hostname.toLowerCase()` (after stripping IPv6 brackets) against the set `{"127.0.0.1", "localhost", "::1"}`. Returns `false` (not throw) on an unparseable URL.
- Constructor logic changed from a single `??` fallback chain to an explicit three-branch resolution:
  1. **`opts.baseUrl` (constructor-injected)** — used as-is, unconditionally, with **no loopback check**. This path is only reachable from code that directly constructs `new OllamaProvider({ baseUrl: ... })` — i.e. trusted test fixtures (`apps/daemon/test/llm-ollamaProvider.test.ts`, `apps/daemon/test/rpc-generateBody.test.ts`, `apps/daemon/test/server.integration.test.ts` all construct via the env var, not this param, so nothing currently relies on a non-loopback constructor-injected `baseUrl` — confirmed by grep, see §14.4 below).
  2. **`process.env["SYMBION_OLLAMA_BASE_URL"]` (env-var-sourced)** — if set, it MUST pass `isLoopbackUrl()`. If it fails the check, the constructor throws `LlmError("provider-not-running", "SYMBION_OLLAMA_BASE_URL phải là một địa chỉ loopback (127.0.0.1/localhost/::1); ...")` immediately — **no fetch is ever issued**, and there is no silent fallback to the loopback default (a silent fallback would mask a real misconfiguration as "working fine").
  3. **Neither set** — falls back to `OLLAMA_DEFAULT_BASE_URL` (`http://127.0.0.1:11434`), unchanged from before.
- File: `apps/daemon/src/rpc/handlers.ts` — `getProvider(params.providerId)` was previously called **outside** the `try` block in `generateBody`, meaning a constructor-time `LlmError` (the new SSRF rejection) would have bypassed the `catch (err) { if (err instanceof LlmError) ... }` mapping and leaked through the server's generic 500 `internal-error` path (raw `err.message`) instead of the structured `RpcError("llm-provider-not-running", ...)` taxonomy. Moved `getProvider(...)` **inside** the existing `try` block (immediately before `provider.generate(...)`) so any `LlmError` thrown either at construction time or during `generate()` is caught and mapped identically. This is a necessary companion fix to 14.1's main change — without it, the new SSRF guard would still work (the fetch never happens) but the daemon would respond with an unstructured 500 instead of a clean `400 invalid-params`/`llm-*` error, which is itself a smaller instance of finding #2's "don't leak raw Error.message through the generic path" pattern.

**New regression tests** (`apps/daemon/test/llm-ollamaProvider.test.ts`):
- TC-D7 — `SYMBION_OLLAMA_BASE_URL=http://example.com:9999` → constructor throws `LlmError` with `code: "provider-not-running"`.
- TC-D8 — `SYMBION_OLLAMA_BASE_URL` set to each of `http://127.0.0.1:11434`, `http://localhost:11434`, `http://[::1]:11434` → constructor does not throw.
- TC-D9 — explicit constructor `{ baseUrl: "http://example.com:9999" }` does not throw (documents the intentional trusted-injection bypass).

**New regression test** (`apps/daemon/test/rpc-generateBody.test.ts`):
- TC-H10 — `SYMBION_OLLAMA_BASE_URL` set to a non-loopback host, then `handlers.generateBody(...)` is called end-to-end → rejects with `RpcError` whose `code` is exactly `"llm-provider-not-running"` (not a raw `LlmError`, not a generic 500). This proves the handler-level `try`/`catch` reordering fix above actually closes the leak path, not just the provider-layer constructor check in isolation.

### 14.2 Fix for 🟡 MEDIUM — `kind`/`providerId` not validated at the RPC boundary

File: `apps/daemon/src/rpc/handlers.ts`.

- Added two runtime guard functions near `RpcError`'s definition:
  - `assertValidKind(kind: unknown): asserts kind is "agent" | "command"` — throws `RpcError("invalid-params", 'Tham số "kind" không hợp lệ: phải là "agent" hoặc "command".')` if `kind` is not exactly the string `"agent"` or `"command"`.
  - `assertValidProviderId(providerId: unknown): asserts providerId is "ollama" | "remote"` — throws `RpcError("invalid-params", 'Tham số "providerId" không hợp lệ: phải là "ollama" hoặc "remote".')` if `providerId` is not exactly `"ollama"` or `"remote"`.
- `listModels(params)` now calls `assertValidProviderId(params.providerId)` as its first line, before calling `getProvider(...)`.
- `generateBody(params)` now calls `assertValidKind(params.kind)` and `assertValidProviderId(params.providerId)` as its first two lines, before the existing field-size validation, before `buildBodyGenerationPrompt(...)`, and before `getProvider(...)`.
- `registry.ts`'s `getProvider()` itself is **unchanged** — it still throws a bare `Error` on an unrecognized id, but that path is no longer reachable from the RPC boundary in practice, because both call sites now validate first. (Left as-is rather than changed to throw `LlmError`/`RpcError` itself, since the instructions scoped the fix to "validate at the RPC boundary... before calling into the prompt builder or provider registry" — `registry.ts` is not itself the RPC boundary, and changing its throw type was not requested. Flagging this for the Checker to confirm this reading is correct: `getProvider()` could still be hardened later as defense-in-depth, but doing so was not done here to avoid scope creep beyond what was asked.)

**New regression tests** (`apps/daemon/test/rpc-generateBody.test.ts`):
- TC-H7 — `handlers.generateBody({ kind: "not-a-real-kind", ... })` → rejects with `RpcError` whose `code` is `"invalid-params"`.
- TC-H8 — `handlers.generateBody({ ..., providerId: "made-up-provider" })` → rejects with `RpcError` (`instanceof` check) whose `code` is `"invalid-params"`.
- TC-H9 — `handlers.listModels({ providerId: "made-up-provider" })` → throws `RpcError` (`instanceof` check) whose `code` is `"invalid-params"`.

All three deliberately use `// @ts-expect-error` to pass an off-the-wire-shaped value past TypeScript's compile-time union check, simulating what an actual malformed JSON RPC payload would look like at runtime.

### 14.3 Explicitly NOT touched (per the instructions' scope fence)

- The 🟡 "no server-side rate limiting on `generateBody`" item from §13's "accepted as clean / no change required" list — left exactly as-is, no rate-limiting code added.
- Prompt-injection handling in `packages/core/src/generate/bodyPrompt.ts` — untouched. (Note: `bodyPrompt.ts` line 36 still silently coerces a non-`"command"` `kind` to `"agent"` internally — this is now moot for the `generateBody` RPC path specifically, because `assertValidKind` rejects any non-`"agent"`/`"command"` value before `buildBodyGenerationPrompt` is ever called from that path. The coercion inside `bodyPrompt.ts` itself was left unchanged since it's pure `packages/core` code already covered by its own passing unit tests and was not named in either finding.)
- Disclosure UI, confirm-dialog sequencing, cooldown logic — untouched.

### 14.4 Verification performed (Maker-level, not a substitute for Checker re-review)

- Grepped all test files for any non-loopback constructor-injected `OllamaProvider({ baseUrl: ... })` usage — none found; every existing test either uses an ephemeral `127.0.0.1:<port>` fake server or the `SYMBION_OLLAMA_BASE_URL` env var (also always loopback in existing tests), so the new loopback restriction does not break any pre-existing test.
- `npm test` (root, runs all Vitest projects): **148 passed**, 0 failed, 19 test files (up from 141/19 before this fix — 7 new tests: TC-D7/D8/D9, TC-H7/H8/H9/H10).
- `npm run build` (all 4 workspaces: core, rpc-types, daemon, web): clean, no type errors.
- `npx playwright test` (root config): **9 passed**, 0 failed — confirms the RPC-boundary changes did not regress the existing e2e flows (happy path + the full `auto-generate-body` suite).

### 14.5 Assumptions for the Checker to verify independently — do NOT treat as already validated

1. **Loopback hostname set chosen** (`127.0.0.1`, `localhost`, `::1`) was read directly from the finding's own wording ("loopback... 127.0.0.1, localhost, or ::1 (case-insensitive)"). Not independently re-derived; Checker should confirm this is actually sufficient (e.g. should `0.0.0.0` or `[::]` be considered loopback-adjacent-but-rejected, or are there other loopback representations like `127.x.x.x` more broadly, or decimal/hex IP-literal obfuscation tricks like `http://2130706433/` (`127.0.0.1` as a decimal integer) or `http://0x7f000001/` that Node's `URL` parser may or may not normalize before `hostname` is read? This was not specifically tested against `new URL(...)`'s actual normalization behavior for obfuscated loopback-equivalent literals — flagging as a residual question for the security-reviewer's live PoC step, since that's exactly the kind of bypass a security review is positioned to probe that a Maker's unit tests may not think to cover.
2. **`getProvider()` in `registry.ts` left throwing a bare `Error`** rather than `LlmError`/`RpcError` — a deliberate scope-minimization choice per §14.2's note above, not an oversight. Checker should confirm this reading of "validate at the RPC boundary" is acceptable, or flag if `registry.ts` should also be hardened as defense-in-depth (e.g. if some other future caller invokes `getProvider` without first validating).
3. **The `getProvider(...)` call was moved inside the `try` block** in `generateBody` (§14.1) as a necessary companion fix discovered while implementing the HIGH finding, not separately requested in the original two findings' text. Flagging explicitly since this is a slightly broader change than "just add a hostname check" — the reasoning is recorded in §14.1 above for the Checker to independently assess whether this was the correct/minimal companion change or whether a narrower fix existed.
4. **No change was made to the 🟡 "TC-H3 timeout-at-handler-layer" gap** noted back in §11 — still present, still not in scope for this fix pass (not named in §13's two findings).

**Ready for re-`/cso`.** This Maker does not declare the two findings "fixed and secure" — that determination is the security-reviewer's to make independently on re-review, including re-running their own live PoCs against the rebuilt daemon.

## 15. /cso re-review — verdict PASS (2026-06-27)

`security-reviewer` independently re-verified both §13 findings via mutation testing (reintroducing each bug and confirming the new regression tests fail, then restoring and confirming they pass — not a rubber-stamp of the Maker's §14 description), plus live bypass-vector probing against Node's actual `URL` parser (decimal/hex/octal IP literals, IPv6 variants, case/trailing-dot tricks) and a full suite re-run (148/148 unit/integration, 9/9 e2e, clean build across all 4 workspaces).

- **SSRF finding: confirmed fixed.** `isLoopbackUrl()` in `ollamaProvider.ts` runs before any `fetch`; removing it during mutation testing caused a real outbound TCP attempt and test failure, confirming the guard is load-bearing, not vacuous. All probed IP-literal obfuscation tricks correctly canonicalize to loopback (no bypass); the `opts.baseUrl` test-injection path is confirmed unreachable from any RPC-controlled code path (`registry.ts` constructs `OllamaProvider()` with zero args).
- **Unvalidated kind/providerId finding: confirmed fixed.** `assertValidKind`/`assertValidProviderId` run first in both handlers; the `getProvider()` relocation inside the `try` block correctly routes the new constructor-time `LlmError` through the existing `RpcError` mapping (verified by mutation: reverting the relocation breaks `TC-H10` exactly as predicted).
- **One new 🟢 low-severity, non-blocking note**: literal-string `"localhost"` in the allowlist has a narrow TOCTOU gap against host-file/resolver tampering — a materially stronger attacker position than the original env-var-injection threat model. Recommended cheap follow-up (drop `"localhost"` string, keep only IP literals `127.0.0.1`/`::1`) but does not block this gate.

**Net**: `/cso` verdict is now **PASS**. Feature is clear to proceed to `/qa`.

## 16. /qa — verdict PASS (2026-06-27)

Executed against `docs/loops/auto-generate-body-testplan.md`.

- **Build**: `npm run build` clean across all 4 workspaces (core, rpc-types, daemon, web) — typecheck + Next.js production build + lint, zero errors.
- **Unit/integration (Tier A)**: `npm test` — 148/148 passed, 19 files, including all `TC-C*` (core prompt builder), `TC-D*` (LLM providers, fake-server-backed), `TC-H*` (RPC handler), `TC-S*` (server/transport: auth, origin allowlist, concurrency) cases from the test plan.
- **E2E (Playwright)**: `npx playwright test` — 9/9 passed: TC-E1/E2 (happy path + real outbound RPC+HTTP call), TC-E3 (FR-1 regression — sparkle icon confirmed gone from `description`, present beside Nội dung), TC-E4 (confirm-before-replace full journey), TC-E5 (Ollama-unreachable inline error + Save still works), TC-E6 (rapid double-click → exactly one request), TC-E7 (daemon-disconnected → button disabled), TC-E8 (first-use disclosure dialog, Ollama-appropriate copy), TC-E10 (ModelPicker offers 3 real models). Pre-existing `happy-path.spec.ts` (full create→publish→write journey) also still green — confirms the publish pipeline (TC-E11's concern) is genuinely untouched.
- **Live manual verification** (real daemon + real browser-equivalent RPC calls, not just automated suites): started `dev:daemon` + `dev:web`, confirmed web root returns 200 with no runtime errors in logs. Directly drove the daemon's `/rpc` endpoint with `curl` (no Chrome instance was reachable in this execution environment — flagging this honestly rather than silently skipping the browser-level spot-check):
  - `listModels` → returns exactly the 3 documented models (fast/balanced/best tiers) — live confirmation of AC-3/TC-D6, not just a passing test.
  - Missing token → `{"code":"unauthorized"}` — live confirmation of TC-S2.
  - Wrong Origin header → `{"code":"origin-rejected"}` — live confirmation of TC-S3.
  - `generateBody` against real (Ollama-not-installed) environment → clean `{"code":"llm-provider-not-running", "message":"Không thể kết nối tới Ollama..."}`, no crash, no stack trace leak — live confirmation of EC-4's error-mapping table and the §13/§15 security-fix path operating correctly end-to-end, not just in mutation tests.
  - `generateBody` with bogus `providerId` → clean `{"code":"invalid-params", "message":"Tham số \"providerId\" không hợp lệ..."}` — live confirmation that the §13/§14/§15 RPC-boundary validation fix is live and working against the actual running daemon, not just its test suite.
- **Not independently exercised**: Tier B (real local Ollama) end-to-end generation — no Ollama installed in this execution environment; consistent with the test plan's own documented degrade-to-skip behavior for Tier B, not silently glossed over. A genuine "Nội dung gets populated with real model output" pass should be run once by a developer with Ollama installed locally before considering the feature fully battle-tested in the wild, though every layer up to the actual Ollama response (RPC contract, auth, validation, error-mapping, UI wiring) has now been verified live.
- Dev servers (`dev:daemon`, `dev:web`) stopped cleanly after verification; no orphan processes left running.

**Verdict: PASS.** Every acceptance criterion and edge case in STATE §6/§10.5 that can be verified without a real local Ollama install has been verified — by automated test, by live RPC call against the real running daemon, or both. Recommend `/ship`.

## 17. Ship (DONE — 2026-06-27)

Shipped through the full Maker→Checker pipeline: `/analyze` → `/office-hours` (§9, 12 open questions answered by the user via `AskUserQuestion`, none autopilot-guessed) → `/plan` (§10, architect) → `/build` (§11, feature-builder) → `/review` (§12, code-reviewer + architect, both PASS) → `/cso` (§13 NEEDS-WORK on first pass — 🟠 SSRF + 🟡 unvalidated RPC params — §14 fix pass, §15 re-review PASS via mutation testing) → `/qa` (§16 PASS, build+148 tests+9 e2e+live RPC verification).

**Final build**: `npm run build` clean across all 4 workspaces, re-confirmed at ship time.

**What shipped**:
- New `apps/daemon/src/llm/{types,ollamaProvider,remoteProvider,registry}.ts` — `LlmProvider` interface, Ollama adapter (v1 default, loopback-only enforced post-SSRF-fix), remote adapter (seam only, no UI control reaches it in v1, key from `SYMBION_REMOTE_LLM_API_KEY` env var only).
- New `generateBody` + `listModels` daemon RPC methods, with explicit `kind`/`providerId` runtime validation and a full `LlmError`→`RpcError` error-code taxonomy.
- New `packages/core/src/generate/bodyPrompt.ts` — pure prompt builder, zero fs/net/Node imports.
- New `apps/web` components: `GenerateBodyButton`, `ModelPicker`, `GenerateBodyDisclosure` — wired beside the Nội dung field on both `AgentForm` and `WorkflowForm`.
- Removed: the old `GenerateDescriptionButton` usage next to `description` on both forms (FR-1/Q6) — `generateDescription()` itself left as untouched dead code, not deleted.
- `symbion-STATE.md` §1.4's stale "no secrets collected" claim corrected to reflect the new opt-in remote-LLM-key seam.
- `docs/learnings.md` updated: retracted the prior (incorrect) learning that praised silently substituting a heuristic for a locked "must ask the user" blocker, replaced with the corrected pattern, plus new real-AI-integration-specific learnings (SSRF-on-new-env-var risk, provider/adapter-seam value, mutation-testing-in-security-re-review value).

**Remaining tech debt / follow-ups (not blocking, explicitly tracked, not silently dropped)**:
1. No server-side concurrency/rate-limit on `generateBody` (§13 🟡, accepted non-blocking) — client-side cooldown is browser-only and bypassable by any token holder; worth a fast follow-up once this becomes a cost-bearing surface in practice.
2. `"localhost"` string-literal in the loopback allowlist has a narrow TOCTOU gap against host-file/resolver tampering (§15 🟢) — cheap fix is to drop the string and keep only IP literals (`127.0.0.1`/`::1`).
3. TC-H3 (timeout error code mapped specifically through the `generateBody` *handler*, not just the provider layer) remains untested at that exact layer — would need `timeoutMs` to become handler-injectable to test cheaply without a real 45s wait.
4. No `apps/web` component-level unit test harness exists in this repo (Vitest/RTL) — TC-W1 through TC-W17's intent is covered only partially by the Playwright e2e suite; a future component-test harness addition would close finer-grained gaps (e.g. exact ModelPicker wiring assertions).
5. Tier B (real local Ollama generation) was not exercised end-to-end in this environment (no Ollama installed) — every layer up to the actual model call (RPC contract, auth, validation, error-mapping, UI wiring) is verified; a developer with Ollama installed locally should do one real generate-and-see-output pass before considering this fully battle-tested in the wild.
6. Exact Ollama model tags (`llama3.2:1b`, `llama3.1:8b`, `llama3.1:70b`) were not verified against a live registry in this environment — plausible/correctly-formed per code review, but worth a developer confirming they're still current/pullable tags before relying on them.
7. The remote-API adapter's vendor shape (Anthropic Messages API) was verified as structurally plausible but has never been called against a real API key/endpoint — first real use against a live remote provider should be treated as the actual integration test for that path, since it's currently only unit-tested against a fake server.
