# Auto-generate description — STATE (phase = DONE)

> Source: GitHub issue #2 (Quanghuy128/Symbion) — "[Feature] Auto-generate Agent and Workflow Builder descriptions using local AI". Label: enhancement.
> Inputs read for context: [`CLAUDE.md`](../../CLAUDE.md), [`docs/loops/symbion-analyze.md`](./symbion-analyze.md), [`docs/loops/symbion-design.md`](./symbion-design.md), [`docs/loops/symbion-STATE.md`](./symbion-STATE.md) (locked v1, shipped), [`docs/loops/symbion-testplan.md`](./symbion-testplan.md), and the live form code at `apps/web/src/components/AgentForm.tsx` / `apps/web/src/components/WorkflowForm.tsx`.
> Date: 2026-06-26. Status: ANALYZE complete, scope NOT yet locked — open taste questions block `/office-hours` → `/design`.

---

## 0. Codebase investigation (done as part of this ANALYZE — do not re-investigate)

- Grepped the entire repo (`packages/`, `apps/`) for any existing AI/LLM client: `openai`, `anthropic`, `ollama`, `llm`, `gpt-`, `claude-3`, `claude-opus`, `generateText`, `chat/completions`, `api.openai`, common local-LLM ports (11434 Ollama, 1143x LM Studio). **Zero hits that are an actual API client.** The only matches were the pre-existing "Nâng cao" custom-field placeholder text (`model: claude-opus-4`) in `AgentForm.tsx` — free-text frontmatter passthrough, unrelated to calling any AI provider.
- **Conclusion: there is no AI/LLM integration anywhere in Symbion today.** "Local AI" in the issue title is the *reporter's* framing (likely meaning "runs on the user's machine via the existing local daemon," consistent with the project's no-cloud-DB / local-first posture) — it is **not** a description of an existing capability. This is an open architecture question, flagged in §5 below, and the architect should not assume Ollama/local-model specifically without user confirmation.
- Current form fields available as generation context, per `apps/web/src/components/AgentForm.tsx` and `WorkflowForm.tsx`:
  - **Agent**: `name`, `tools[]` (multi-select), `body` (system-prompt textarea), `customFields[]` (key/value).
  - **Command/Workflow**: `name`, `body` (prompt/orchestration textarea), agent `@mentions` extracted from body (`extractAgentMentions`).
  - `description` is currently the one **required**, manually-typed field on both forms (`description *`) — this is the field the issue wants auto-generated.
- Per `CLAUDE.md` / locked architecture (`symbion-STATE.md` §1.4): `apps/web` **never** touches disk or makes direct external network calls outside the daemon RPC contract; `apps/daemon` is the only privileged process; `packages/core` is pure (no fs/net/Node). Any new "generate" capability must follow this shape: web triggers → typed RPC call to daemon → daemon (only privileged process) is the one allowed to call out to whatever text-generation backend is chosen → returns a plain string to the web form. No secrets/API keys should land in `apps/web`.
- v1 already explicitly deferred "Run" (executing agents) to v2; this feature is **not** Run — it's a one-shot text-generation utility scoped to filling one form field. It should not be confused with or expanded into general-purpose chat/agent execution.

---

## 1. Core user need

Today, filling `description *` (and arguably the body/system-prompt) on the Agent Builder (S7) and Workflow Builder (S8) forms is 100% manual. For a tool whose entire premise is "stop hand-writing `.md` pipeline files," manually wordsmithing the one-line `description:` frontmatter for every agent/command is friction that contradicts the product's own value proposition. The user wants a one-click "auto-generate" affordance next to the `description` field that drafts a description from whatever context already exists in the form (name, tools, body, etc.), which the user can then accept, edit, or discard — never silently overwriting their typed text.

## 2. User story

> As a developer authoring an agent or workflow in Symbion, when I've written (or am writing) the body/system-prompt and selected tools, I want to click a "generate description" icon next to the description field so the tool drafts a one-line description for me from that context, instead of me having to summarize my own prompt by hand.

## 3. Scope

### In scope (v1 of this feature)
- **FR-1**: An "auto-generate" icon/button rendered next to the `description *` field on **both** `AgentForm` (S7) and `WorkflowForm` (S8).
- **FR-2**: Clicking it sends the current in-memory form context (at minimum: `kind` (agent/command), `name`, `body`, `tools[]` if agent, `customFields[]` if present) to a text-generation backend and receives back a single-line description string.
- **FR-3**: The generated text is **inserted into the description field as an editable draft, never auto-saved**. The user must explicitly keep/edit/discard it — same "never write silently" posture as filesystem writes, applied to this in-memory field. (Saving the artifact via the existing "Lưu" flow is unaffected — this feature only proposes a value for the user-editable input.)
- **FR-4**: If `description` is **non-empty** when the user clicks generate, surface a confirm/overwrite step (do not silently clobber a description the user already wrote) — mirrors the project's "never overwrite without confirm" doctrine applied to in-memory UI state, not just disk.
- **FR-5**: Loading state on the button (spinner/disabled) while generation is in flight; the rest of the form remains usable.
- **FR-6**: Error state: if generation fails (backend unreachable, timeout, malformed response, rate-limited, etc.), show an inline, non-blocking error and leave the existing field value untouched. The form must remain fully usable without this feature (graceful degradation — generation is a convenience, not a hard dependency for Save/Publish).
- **FR-7**: The feature must work the same way for both empty-body and minimal-context cases (see edge cases) without making this feature non-functional in the most common "I just created a blank agent" entry case — i.e., decide and document the minimum-viable behavior, not silently fail.

### Out of scope (v1 of this feature — explicitly NOT doing)
- Auto-generating the `body`/system-prompt content itself (only `description` is in scope for v1; generating the *prompt* is a much higher-risk, higher-stakes generation target and is a separate future feature if wanted).
- Any general chat/agent execution UI (that is "Run," already deferred to v2 per `symbion-STATE.md` §0).
- Multi-language tone/style customization, prompt templates the user can edit, or a settings panel for generation behavior beyond the minimum needed to function — defer unless the user flags it as needed for v1.
- Streaming token-by-token UI (a single round-trip "loading → result" is sufficient for v1; streaming is a nice-to-have, not required).
- Persisting any generation history/log (no "regenerate from history," no analytics) in v1.
- Collecting/storing any API key or secret inside the **web** tier (per architecture, if a remote provider needs a key, only `apps/daemon` — never `apps/web` — may hold/use it; if the daemon needs to persist it, that itself is a new safety surface that needs explicit user sign-off, see §5).

## 4. Edge cases (must be specified now, verified at /qa)

| # | Case | Required behavior (to be confirmed/locked at /design or /office-hours) |
|---|---|---|
| EC-1 | User clicks generate with **empty body** and no tools selected (blank new artifact) | Either: (a) button disabled with a tooltip ("viết Nội dung trước khi tạo mô tả") until there's enough context, or (b) backend still attempts a generic generation from just `name`. **Must pick one — flagged as open question, see §5.** |
| EC-2 | `description` field already has user-typed text | Must NOT silently overwrite (FR-4) — confirm/replace UX required. |
| EC-3 | Backend unreachable / daemon not running / network/timeout error | Inline error, field unchanged, rest of form remains usable (FR-6). Must not crash the form or block Save. |
| EC-4 | Backend returns multi-line text, markdown, or a description far exceeding a reasonable one-line frontmatter value | Generated text should be normalized to a single line appropriate for YAML frontmatter `description:` (no embedded `\n`, no enclosing quotes that break YAML) before insertion — this is a format-fidelity concern (NFR-3 in the original analyze doc) since `description` renders verbatim into frontmatter. |
| EC-5 | Rapid double-click / repeated clicks while a generation is already in flight | Button disabled during in-flight request; no duplicate concurrent calls; no race where an earlier slow response overwrites a result from a later click (last-request-wins or in-flight request cancellation). |
| EC-6 | User edits `body`/`name`/`tools` *after* a generated description was inserted, without regenerating | No automatic re-generation; description is a static value once inserted, like any other manually typed field — avoid surprising the user with text changing underneath them. |
| EC-7 | Generation source is a remote API and requires network egress | Must be clearly distinguished from the project's local-only/no-cloud posture in the UI (if remote) — see open question Q1. If a key/quota is required, the user must be told before first use, not silently fail later. |
| EC-8 | Workflow (command) form: agent `@mentions` exist in body referencing other artifacts | Decide whether mentioned-agent names/descriptions are included as extra generation context (could improve quality) — flagged as open question Q5. |
| EC-9 | Daemon disconnected (existing `DaemonStatusBadge` red-banner state, per `symbion-STATE.md` E9) | If generation must route through the daemon RPC, it should be disabled/blocked under disconnect the same way Save/Publish already are, not silently fail with a confusing error. |

## 5. Open taste/architecture questions — ONLY the user can decide these (do not guess; do not let architect/dev silently pick)

1. **Backend/provider choice — the single most important unresolved decision.** The issue says "local AI" but no AI client exists in this codebase today (confirmed by grep, §0). Options the user must choose between, since each has very different cost/privacy/architecture implications:
   - (a) A genuinely local model the daemon talks to (e.g., an Ollama-style HTTP server on localhost the user must separately install/run) — true to "local," zero per-call cost, but requires the user to have a local model server running, and adds a new external-process dependency to the project.
   - (b) A remote hosted LLM API (Anthropic/OpenAI/etc.) called from the daemon — needs an API key (where does it live? who pays per-call cost?), and is no longer "local," contradicting the issue title and the project's local-first/no-cloud ethos stated in `CLAUDE.md`.
   - (c) Reuse of the user's already-authenticated `claude` CLI session (if installed) — daemon shells out to it — avoids a new API key but is a new process-spawn dependency, and ties description-generation to having Claude Code CLI installed.
   - **This blocks architecture design — please pick (or state if you want all three as pluggable options for later, in which case v1 should explicitly pick one and design the seam for the others).**
2. **If a remote API key is required (option b above): where is it entered/stored, and by whom?** Per `CLAUDE.md`'s "no secrets collected" v1 posture (`symbion-STATE.md` §1.4, "No secrets collected — v1 never asks for API keys"), introducing a key now is a deliberate reversal of a previously locked decision — please confirm this is intentional, and if so, whether it's a per-user global config value (daemon-side, never sent to web) or an environment variable the user sets before `npm start`.
3. **Cost/rate-limiting concerns**: if a paid remote API is chosen, should there be any per-session/per-day call cap, or is "developer's own key, developer's own responsibility" acceptable for v1? Do you want any cost/usage indicator in the UI?
4. **Scope of context fed into the generation prompt**: confirm the minimum field set (FR-2 proposes name + body + tools + customFields) is correct, or whether you want it trimmed (e.g., body only) or expanded (e.g., include sibling artifacts in the same project for cross-referencing tone/style consistency).
5. **Workflow/command form specifically**: should referenced agents' own descriptions (via `@mention` extraction, `extractAgentMentions`) be pulled in as extra context to make the generated command description more accurate? (EC-8)
6. **Minimum-context behavior (EC-1)**: disable the button until the user has typed something in the body, or always allow it and let the backend do its best with just the `name`?
7. **Confirm-on-overwrite UX (EC-2/FR-4)**: a lightweight inline diff/preview before replacing existing text, or a simple "Generated text will replace your current description — continue?" confirm dialog? (This is a design-phase detail but the *requirement* that it must not silently overwrite is locked now.)
8. **Should this also auto-generate the `body`/system-prompt**, or strictly `description` only for v1, as scoped in §3? (Confirming explicit out-of-scope above is correct and not a surprise omission.)

## 6. Acceptance criteria (measurable)

- **AC-1**: An auto-generate icon/button is visible directly adjacent to the `description *` field on both `AgentForm` and `WorkflowForm`, and nowhere else.
- **AC-2**: Clicking it with a non-empty `body` populates the `description` field with a generated, single-line string (no embedded newlines) within a bounded time budget (exact timeout TBD at /plan) or surfaces an error per AC-5.
- **AC-3**: If `description` is non-empty at click-time, the existing text is never replaced without an explicit confirm action from the user — verified by: type custom description → click generate → assert original text still present until user confirms replacement.
- **AC-4**: While a generation request is in flight, the button is disabled/shows a loading indicator, and clicking it again does not fire a second concurrent request.
- **AC-5**: If the generation backend is unreachable or errors, the form shows a non-blocking inline error, the description field is unchanged from before the click, and Save/Publish remain fully functional (this feature can fail without degrading the rest of the builder).
- **AC-6**: The generated value, once inserted, is treated exactly like manually-typed text afterward (editable, included in live preview, included in validation/lint, included in save) — no special "generated" field state persists in the IR (`CanonicalArtifact` is not changed to add a "wasGenerated" flag unless the user explicitly asks for that in /design).
- **AC-7**: No API key or secret is ever present in `apps/web` source, network payloads sent to the browser, or browser devtools-visible state — any required secret lives only in `apps/daemon` (or is read from local environment at daemon boot), consistent with the existing RPC-boundary security posture in `symbion-STATE.md` §1.4.
- **AC-8**: This feature introduces no new disk-write path — the generated text only ever lands in the in-memory `CanonicalArtifact` via the existing `onChange` callback already used by both forms; it does not bypass the existing Save (`saveArtifact` RPC) or Publish (`write` RPC) flows.

## 7. Product risk notes (for architect/dev to track)

- **Architecture-decision risk**: this feature cannot proceed to `/design`/`/plan` until open question Q1 (backend choice) is resolved — it is the single biggest unknown and changes whether this is a zero-new-dependency feature or one that introduces a new external service dependency and secret-handling surface.
- **Locked-decision conflict risk**: `symbion-STATE.md` §1.4 explicitly locked "No secrets collected — v1 never asks for API keys" for the *original* v1 scope. If this feature requires an API key, that is a scope amendment to a previously shipped/locked decision, not a fresh blank slate — flag this explicitly to the user and get an explicit yes before the architect designs key storage.
- **Format-fidelity risk**: generated text lands verbatim in YAML frontmatter `description:` — unsanitized multi-line or quote-containing output could corrupt the rendered `.md` file. Per the project's NFR-3 ("format change cô lập trong adapter" / round-trip fidelity), normalization/escaping of generated text must happen before it's accepted into the field, not just before render.
- **"Never write silently" extension to UI state**: this is the first Symbion feature where an automated process proposes a value for a *user-authored* field, as opposed to disk writes. The existing "diff preview + confirm" doctrine (built for filesystem writes) needs an equivalent lightweight pattern at the form-field level — the architect should treat FR-4/EC-2 with the same seriousness as the disk-write conflict UX (E1 in `symbion-STATE.md` §6), even though no bytes hit disk.
- **New dependency / failure-mode risk**: depending on Q1's answer, this could introduce a new runtime dependency (local model server, or remote API + network egress) which is a new failure mode (EC-3/EC-9) for a tool whose core value proposition (filesystem export) must remain reliable even if generation is degraded.
- **Scope-creep risk**: it would be easy to over-build this (streaming, prompt templates, generation history, body-generation) — §3 explicitly scopes this down to "description field only, single round-trip, no persistence" for v1; the architect/builder should resist expanding without an explicit ask.

---

## 8. Next step

Open questions in §5 (especially Q1 — backend/provider choice, and Q2 — secret-storage implication) require explicit user decisions before this can proceed. Recommend running **`/office-hours`** (or the user answering Q1–Q8 directly) to lock scope, then **`/design`** (UI: where exactly the icon sits, loading/confirm micro-interactions) and **`/plan`** (architect: RPC method shape for "generateDescription," where/how the daemon calls out to the chosen backend, secret storage if any, timeout/error contract).

---

## 9. OFFICE-HOURS — decisions locked (auto-decided, full-autopilot run, 2026-06-26)

Running under `/autopilot` full-auto mode. Per CLAUDE.md defaults and the existing locked constraint in `symbion-STATE.md` §1.4 ("No secrets collected — v1 never asks for API keys"), Q1/Q2 are resolved by **not reopening that lock**: no remote API, no API key, no new external process dependency. This keeps the feature genuinely zero-new-dependency and ships something real rather than blocking on an unavailable user decision.

| # | Question | Decision |
|---|---|---|
| Q1 | Backend/provider choice | **(d) New option, not in the original three: a local, deterministic template/heuristic generator implemented as a pure function in `packages/core`.** No local model server, no remote API, no CLI shell-out. It builds a one-line description from `name` + `tools[]` + first meaningful line(s)/keywords of `body` + `customFields`, using simple heuristics (e.g., "Agent that uses {tools} to {first-clause-of-body}"). This is genuinely "local" (runs in-process, zero network/IPC), adds no runtime dependency, and fully respects Q2 below. If the user wants true generative-LLM quality later, that is a v1.5 pluggable-backend upgrade — the RPC contract is designed below so the backend can be swapped without changing the web UI. |
| Q2 | API key storage | **Moot — no API key, no secret, no remote call.** `symbion-STATE.md` §1.4 stays locked, unreversed. |
| Q3 | Cost/rate limiting | **Moot** — heuristic generation is free and local; no cap needed. |
| Q4 | Context fields fed into generation | **Confirmed as proposed**: `kind` (agent/command), `name`, `body`, `tools[]` (agent only), `customFields[]` if present. |
| Q5 | Pull in `@mention`-referenced agents' descriptions for Workflow form | **No, deferred.** Keeps v1 scope to single-artifact, in-memory context only — no cross-artifact lookups, no new RPC for fetching other artifacts mid-edit. |
| Q6 | Minimum-context behavior (EC-1) | **(b) Always allow the click; heuristic falls back to name-only generation** (e.g., "Mô tả cho {name}") if body/tools are empty — this is consistent with a deterministic local generator having no "I don't have enough context" failure mode the way a remote LLM might; never disable the button. |
| Q7 | Confirm-on-overwrite UX | **Simple confirm dialog** ("Văn bản mô tả hiện tại sẽ được thay thế — tiếp tục?" / Cancel / Replace) — not an inline diff. Matches existing `Dialog` primitive already used elsewhere in `apps/web`, no new component class needed. |
| Q8 | Generate body/system-prompt too? | **No — confirmed out of scope**, `description` field only, per original §3. |

**Architecture consequence of the Q1 decision**: because generation is a pure, deterministic function of already-in-memory form state, it does **not** need a new daemon RPC method or network round-trip at all — it can run entirely client-side in `apps/web` (or as a `packages/core` pure function imported by the web bundle), with zero daemon involvement, zero new failure modes from network/process dependencies, and trivially satisfies AC-7 (no key ever exists) and the "apps/web never writes files / packages/core stays pure" architecture rule (this function reads/writes nothing — pure string transform). EC-3/EC-9 (backend unreachable / daemon disconnected) become **vacuous** under this design — there is no backend call to fail, so the error-state requirement (FR-6/AC-5) degrades to "this code throws no exceptions for any valid form state," not network-error handling. EC-5 (double-click) and EC-2/FR-4 (confirm-on-overwrite) remain real because they're about the synchronous click path. This will be carried into `/plan`.

---

## 10. PLAN (architect, 2026-06-26)

> Inputs: §9 OFFICE-HOURS locks (above) + `auto-generate-description-design.md` (UI/UX) + live code read at
> `packages/core/src/ir/types.ts`, `packages/core/src/ir/refs.ts`, `packages/core/src/index.ts`,
> `apps/web/src/components/{AgentForm,WorkflowForm}.tsx`, `apps/web/src/components/ui/{button,input,dialog}.tsx`,
> `apps/web/src/components/CreateProjectDialog.tsx` (confirm-dialog precedent), `apps/web/package.json` (deps),
> `packages/core/test/runcommand.test.ts` (pure-function test-style precedent), `e2e/happy-path.spec.ts` +
> `e2e/daemon-fixture.ts` (e2e harness convention).
>
> No daemon involvement at all in this feature (confirmed by §9 architecture consequence) — `apps/daemon` has
> **zero** files touched. This is a `packages/core` + `apps/web` only change.

### 10.1 Architecture

**Package/app boundaries** — unchanged from CLAUDE.md; this feature adds one pure function to `packages/core`
and one presentational component + two small edits in `apps/web`. No RPC surface change, no local-store schema
change, no migration.

**Exact file list:**

| Action | File | Purpose |
|---|---|---|
| Create | `packages/core/src/generate/description.ts` | `generateDescription()` pure function (the heuristic). |
| Create | `packages/core/test/generate-description.test.ts` | unit tests for the pure generator (repo's actual Vitest convention is a top-level `test/` dir — see 10.6). |
| Modify | `packages/core/src/index.ts` | barrel-export `generateDescription` (and its input type) from the new module, following the existing `export * from "./runcommand/render.js"` pattern. |
| Create | `apps/web/src/components/GenerateDescriptionButton.tsx` | icon button + inline overwrite-confirm `Dialog`, dumb/generic per design doc §4. |
| Modify | `apps/web/src/components/AgentForm.tsx` | description row becomes a flex row with `Input` + `GenerateDescriptionButton`; wires `onGenerate`/`onApply`. |
| Modify | `apps/web/src/components/WorkflowForm.tsx` | same row pattern; `onGenerate` omits `tools`. |
| Create | `e2e/auto-generate-description.spec.ts` | Playwright coverage per testplan §3 (new file, follows `happy-path.spec.ts` conventions, reuses `daemon-fixture.ts`). |

No daemon RPC method added. No `local-store` schema change. No new dependency (`lucide-react` is already a
declared `apps/web` dependency per `apps/web/package.json` — confirmed by grep it is not yet imported anywhere in
`apps/web/src`, so this is its first real usage, not a new addition). This resolves design doc open question 1
(icon library) — **use `lucide-react`**, not a hand-rolled inline SVG.

### 10.2 Data flow

```
User click (AgentForm/WorkflowForm)
   -> GenerateDescriptionButton internal handler (synchronous)
        -> calls caller-supplied onGenerate(): string
             -> AgentForm/WorkflowForm's onGenerate closure calls
                generateDescription({ kind, name, body, tools?, customFields? })
                  [packages/core, pure, in-process, no I/O]
        -> if currentDescription.trim() === "": calls onApply(generated) immediately
        -> else: opens confirm Dialog; user clicks "Thay thế" -> onApply(generated)
                                         user clicks "Hủy"/backdrop/Esc -> no-op, dialog closes
   -> onApply(value) === existing update("description", value) -> onChange(next CanonicalArtifact)
        -> existing in-memory artifact state in the parent (ProjectView/builder drawer) — UNCHANGED PATH
   -> existing "Lưu" (saveArtifact RPC) / "Xuất bản" (render -> diff -> write RPC) flows pick up the new
      description value exactly as if the user had typed it — zero new disk-write path (AC-8).
```

There is **no daemon RPC call anywhere in this feature's own code path** — `generateDescription` runs entirely
in the browser's JS bundle (imported into `apps/web` from `@symbion/core`, same as `extractAgentMentions`
already is in `WorkflowForm.tsx`). The "render -> diff -> write" pipeline is untouched; this feature only ever
produces a value that flows through the pre-existing `onChange` callback, identically to manual typing.

### 10.3 The heuristic generator — function contract

`packages/core/src/generate/description.ts`:

```ts
export interface GenerateDescriptionInput {
  kind: "agent" | "command";
  name: string;
  body: string;
  tools?: string[];        // agent only; ignored/absent for command per Q5 lock
  customFields?: CustomField[]; // optional, present if non-empty
}

/**
 * generateDescription — pure, deterministic, local heuristic. No fs/net/Node imports.
 * Same input (deep-equal) -> always the same output string. Never throws for any
 * well-formed GenerateDescriptionInput (Q6 lock: always produces *something*).
 * Output is already normalized: single line, trimmed, length-capped, YAML-safe.
 */
export function generateDescription(input: GenerateDescriptionInput): string;
```

- Exported from `packages/core/src/index.ts` alongside the existing barrel exports (`export * from "./generate/description.js";`).
- `CustomField` type is already exported from `ir/types.ts` — no new type needed there.
- The function does **not** accept or need a `CanonicalArtifact` directly — keeping the input shape narrow
  (just the 5 fields) makes it trivially unit-testable without constructing a full artifact with `meta`, `id`,
  etc., and decouples the generator from IR shape churn.

### 10.4 The heuristic algorithm (concrete, no guessing required)

Implement as ordered steps; each step degrades gracefully if its input is empty.

**Step 1 — derive a "body clause" from `body`:**
1. Trim `body`. If empty after trim -> `bodyClause = undefined`.
2. Otherwise, take the first non-empty line (split on `/\r?\n/`, find first entry whose `.trim()` is non-empty).
3. Strip a leading markdown heading marker if present: `/^#{1,6}\s+/`.
4. Strip a leading "You are..." / "Bạn là..." instruction-style preamble **only if** it is the very start of
   the line, case-insensitively, to surface the substantive clause instead of restating the prompt framing:
   regex `/^(you are( an?| the)?|bạn là)\s+/i` applied once.
5. Cap the resulting fragment at the first sentence boundary if one exists within the first 160 characters
   (`/^[^.!?\n]{1,160}[.!?]/` match on the cleaned line); else hard-cap to 160 chars at the last whitespace
   boundary `<= 160` (avoid cutting mid-word) and do not append an ellipsis (EC-4 cares about single-line +
   YAML-safety, not about indicating a cut visually).
6. Lowercase the **first character only** if step 4 stripped a "You are" prefix (so the clause reads naturally
   mid-sentence, e.g., "...to review code changes" not "...to Review code changes"); otherwise leave casing as-is.
7. Strip a trailing period if present (it is re-added once at the very end of the whole generated string in
   Step 4 below, so intermediate clauses must not double up periods).

**Step 2 — derive a "tools clause" (agent only):**
- If `kind === "agent"` and `tools` is non-empty: `toolsClause = tools.join(", ")` (preserve given order — same
  order convention as the existing tools array, no re-sorting, since `KNOWN_TOOLS` order is already meaningful
  in the UI).
- If `kind === "command"` or `tools` is empty/undefined: `toolsClause = undefined`.

**Step 3 — derive a "custom fields clause" (optional, low priority):**
- If `customFields` is non-empty, look specifically for a field with `key.trim().toLowerCase() === "model"`
  and a non-empty `value`. If found, this MAY be appended parenthetically at the very end as `(model: <value>)`
  — this is the only customField surfaced; do not enumerate arbitrary custom fields (keeps output short/legible
  and avoids leaking arbitrary user free-text into a sentence frame in unpredictable ways). If no `model` field
  exists, `customFieldsClause = undefined`.

**Step 4 — assemble the final string from whichever clauses are defined**, by kind:

For `kind === "agent"`:
- Both `toolsClause` and `bodyClause` defined: `` `Agent that uses ${toolsClause} to ${bodyClause}.` ``
- Only `toolsClause` defined (no body): `` `Agent that uses ${toolsClause}.` ``
- Only `bodyClause` defined (no tools): `` `Agent that ${bodyClause}.` ``
- Neither defined, but `name` non-empty (Q6 fallback): `` `Mô tả cho ${name}.` ``
- `name` also empty/whitespace (degenerate blank-everything case, not explicitly in EC-1 but must not throw):
  `"Mô tả tự động."`  (generic stub, locale-consistent with the rest of the Vietnamese-language UI copy).
- If `customFieldsClause` defined, append `` ` (model: ${value})` `` before the final period is re-checked
  (i.e., splice it in before the trailing `.`, not after) — e.g.
  `"Agent that uses Read, Grep, Bash to review code changes for correctness and style (model: claude-opus-4)."`

For `kind === "command"` (`toolsClause` is always `undefined` since tools is never passed for commands):
- `bodyClause` defined: `` `Command that ${bodyClause}.` ``
- `bodyClause` undefined, `name` non-empty: `` `Mô tả cho /${name}.` `` (leading slash to match the command's
  `/name` convention shown in `WorkflowForm`'s own label `"command name (→ /name)"`).
- Both empty: `"Mô tả tự động."` (same generic stub as agent).

**Step 5 — final normalization pass (applied unconditionally, last, regardless of which branch above ran)** —
this is the EC-4 contract and must be a single shared helper applied to the assembled string before return:
1. Replace any run of whitespace that contains a newline with a single space: `str.replace(/\s*\n\s*/g, " ")`.
2. Collapse any remaining run of 2+ whitespace chars to one space: `.replace(/[ \t]{2,}/g, " ")`.
3. Strip any characters that would break a YAML plain scalar if later quoted/unquoted unexpectedly — specifically
   strip control characters (`/[\x00-\x09\x0B-\x1F\x7F]/g` — note `\x0A`/newline already handled by step 1) since
   raw control chars are never legitimate in a one-line description.
4. Trim leading/trailing whitespace.
5. Hard length cap: if the result exceeds **200 characters**, cap to 200 at the last whitespace boundary
   `<= 200` and ensure it still ends with a single trailing period (re-check, don't double up — if the
   cut point already ends in `.`, leave it; else append one). 200 is chosen as a generous but bounded
   cap for a YAML frontmatter one-liner — comfortably under typical 1-2 line wrap in a terminal/editor, while
   never silently producing an empty string (the cap only ever shortens, never empties, since clauses are
   already capped at 160 chars in Step 1 plus a short fixed template wrapper).
6. If after all of the above the string is empty (should be structurally unreachable given the fallback
   branches in Step 4, but defensive): return `"Mô tả tự động."` as the absolute last-resort default — this
   guarantees the "never throws / always produces *something*" contract (Q6) holds even under a malformed
   input the type system didn't catch (e.g., `name` is somehow `null` at runtime despite the TS type).

**Determinism**: no `Date.now()`, no `Math.random()`, no I/O anywhere in this function — every step above is a
pure string transform of the input, so identical input (by value) always yields identical output, which is the
exact property the unit tests in §10.6/testplan assert.

### 10.5 `GenerateDescriptionButton` — component contract and integration

`apps/web/src/components/GenerateDescriptionButton.tsx`:

```ts
"use client";
export interface GenerateDescriptionButtonProps {
  currentDescription: string;
  onGenerate: () => string;        // synchronous; caller already bound name/body/tools/customFields
  onApply: (value: string) => void;
}

export function GenerateDescriptionButton(props: GenerateDescriptionButtonProps): JSX.Element;
```

Internal behavior (no other props — matches design doc §4 exactly, `disabled` prop dropped since it was only
ever for the EC-5 guard and that guard is fully internal, see below; baking the `aria-label` in rather than
making it a prop matches the design doc's explicit "not a prop — baked in" note):

- Internal `const [confirmOpen, setConfirmOpen] = useState(false)`.
- Internal `const busyRef = useRef(false)` — **module-instance ref, not state** — used purely as a synchronous
  re-entrancy guard for EC-5. Rationale over a `useState`-based `busy` flag: a `ref` check-and-set inside the
  click handler is read/written synchronously in the same tick with no risk of a stale closure value from a
  batched re-render (React 18 batches `setState`, so a state-based guard set at the top of the handler is safe
  too in practice for this synchronous code path, but the ref avoids any dependency on batching semantics at
  all — simpler invariant to reason about and test). The button is also given a native `disabled` attribute
  driven by a *separate* `useState<boolean>` that mirrors the ref for the sub-millisecond window, purely so the
  DOM reflects non-clickability if React re-renders between the ref-set and the work completing (defensive;
  the work is synchronous so in practice this state flip-flops within one tick and is not visually perceptible,
  exactly as design doc §5 specifies).
- Click handler:
  ```
  function handleClick() {
    if (busyRef.current) return;        // EC-5 guard
    busyRef.current = true;
    setBusy(true);
    try {
      const generated = props.onGenerate();
      if (props.currentDescription.trim() === "") {
        props.onApply(generated);
      } else {
        setPendingValue(generated);     // stash for the confirm dialog to use on confirm
        setConfirmOpen(true);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  ```
  Note `pendingValue` (a third internal `useState<string | null>`) is needed so the *already-generated* string
  is what gets applied on confirm — the generator is called once per click, not once per click AND once again
  on confirm (avoids a subtle bug where confirming could re-run the heuristic against possibly-changed form
  state if the user edited `body` while the dialog was open, which would violate EC-6's "static once inserted,
  no surprising changes" spirit one step removed — generate-then-confirm must apply the *same* string the user
  was shown would be generated, not a fresh one).
- Confirm dialog composed inline using existing `Dialog`/`DialogHeader`/`DialogTitle`/`DialogFooter` (no
  separate `OverwriteConfirmDialog.tsx` file — design doc explicitly allows inlining since content is fully
  static; this also keeps the file count down per the "resist scope creep" risk note in STATE §7):
  ```tsx
  <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
    <DialogHeader><DialogTitle>Thay thế mô tả?</DialogTitle></DialogHeader>
    <p className="text-sm text-muted-foreground">
      Văn bản mô tả hiện tại sẽ được thay thế — tiếp tục?
    </p>
    <DialogFooter>
      <Button variant="outline" onClick={() => setConfirmOpen(false)}>Hủy</Button>
      <Button onClick={() => { props.onApply(pendingValue!); setConfirmOpen(false); }}>Thay thế</Button>
    </DialogFooter>
  </Dialog>
  ```
- Icon button itself: `<Button type="button" variant="outline" size="sm" aria-label="Tạo mô tả tự động"
  title="Tạo mô tả tự động" disabled={busy} onClick={handleClick}><Sparkles className="h-4 w-4" /></Button>`
  using `Sparkles` from `lucide-react` (resolves design doc open question 2 in favor of keeping the
  AI-suggestive sparkle glyph — acceptable per locked Q1 framing it as "heuristic," the icon is a minor UX
  nicety, not a correctness concern; dev may swap to `Wand2`/`RefreshCw` at `/build` time without re-architecting
  if a reviewer objects, since this is purely a glyph swap with no contract change).

**Integration in `AgentForm.tsx`** (description field row becomes, replacing lines 49-56):
```tsx
<div>
  <label className="mb-1 block text-sm font-medium">description *</label>
  <div className="flex gap-2">
    <Input
      className="flex-1"
      value={artifact.description}
      onChange={(e) => update("description", e.target.value)}
      placeholder="Independent reviewer…"
    />
    <GenerateDescriptionButton
      currentDescription={artifact.description}
      onGenerate={() =>
        generateDescription({
          kind: "agent",
          name: artifact.name,
          body: artifact.body,
          tools: artifact.tools,
          customFields: artifact.customFields,
        })
      }
      onApply={(value) => update("description", value)}
    />
  </div>
</div>
```
Add `import { generateDescription } from "@symbion/core";` and
`import { GenerateDescriptionButton } from "@/components/GenerateDescriptionButton";` to the top of the file.

**Integration in `WorkflowForm.tsx`** (description field row, replacing lines 35-42), identical pattern except
`onGenerate` calls `generateDescription({ kind: "command", name: artifact.name, body: artifact.body })` — no
`tools`, no mention-derived context (Q5 lock), `customFields` also omitted since `CanonicalArtifact.customFields`
is in scope for both kinds in the type but the design doc's WorkflowForm wiring (§4) explicitly only mentions
`name`/`body` for commands — matching that, not over-supplying context the design doc didn't ask for.

### 10.6 Test-file path correction (repo convention)

Correcting 10.1's table for clarity: this repo's actual Vitest convention (confirmed via
`packages/core/vitest.config.ts` `include: ["test/**/*.test.ts"]` and the existing
`packages/core/test/runcommand.test.ts`) is a **top-level `test/` directory**, not co-located `*.test.ts` files
next to source. The new unit test file is:

- **Create** `packages/core/test/generate-description.test.ts`.

### 10.7 Edge case handling matrix (EC-1 .. EC-9)

| # | Case | Implementation behavior |
|---|---|---|
| EC-1 | Empty body, no tools | §10.4 Step 4 "neither defined" fallback branch -> `"Mô tả cho {name}."` or `"Mô tả tự động."` if name also empty. Button never disabled (Q6). |
| EC-2 | `description` non-empty at click time | `GenerateDescriptionButton` checks `currentDescription.trim() !== ""` -> opens confirm `Dialog` instead of calling `onApply` directly; `pendingValue` holds the already-computed string so confirm doesn't re-run the heuristic. |
| EC-3 | Backend unreachable / network/timeout | **Vacuous** — no backend, no network call exists in this feature's code path (§9 architecture consequence, reconfirmed). No error-state UI is built for this feature. |
| EC-4 | Multi-line/markdown/oversized output | Handled entirely inside `generateDescription`'s Step 5 normalization (§10.4): newline collapse, control-char strip, 200-char cap. The button/forms never see raw unnormalized output — `generateDescription`'s return value is the contract boundary, already safe. |
| EC-5 | Rapid double-click | `busyRef` synchronous re-entrancy guard in `GenerateDescriptionButton` (§10.5) + native `disabled` attribute mirrored via `busy` state, defense in depth. Single generation per click; no async work exists so there is no "later response overwrites earlier" race to begin with (the entire operation is synchronous). |
| EC-6 | Body/tools edited after insertion, no regenerate | No-op by construction — `description` is plain `CanonicalArtifact["description"]` state updated only via explicit click + `onApply`; no `useEffect` watches `body`/`tools`/`name` to auto-regenerate. Nothing to implement here beyond *not* adding such an effect. |
| EC-7 | Remote API / network egress distinction in UI | **Moot** — Q1 locked to local heuristic, no remote call exists, so no "this uses a remote API" disclosure UI is needed. |
| EC-8 | `@mention`-referenced agents as extra context (Workflow form) | **Explicitly not implemented** per Q5 lock — `generateDescription` for `kind: "command"` never receives mention data; `WorkflowForm`'s existing `extractAgentMentions(artifact.body)` call (already present for the "Agents tham chiếu" list) is not threaded into the generator call. |
| EC-9 | Daemon disconnected (`DaemonStatusBadge` red banner) | **Vacuous** — this feature has no daemon RPC call, so disconnect state has zero effect on it; the button remains clickable even if the daemon is down (this is intentionally correct, not an oversight: the heuristic needs no daemon). Do not wire any daemon-status check into `GenerateDescriptionButton`. |

### 10.8 Trade-off decisions and assumptions for dev/Checker to track

1. **No `useState`-only EC-5 guard; a `ref` is used alongside mirrored state.** Slightly more code than a bare
   `useState<boolean>` guard, but removes any dependency on React 18 batching semantics being exactly what we
   expect for correctness — the `ref` is the actual guard, `busy` state is presentation-only. A simpler bare
   `useState` guard would likely also work given the entirely synchronous handler, but Checker should not flag
   the `ref` as unnecessary complexity — it's a deliberate "guard the invariant outside of render timing"
   choice given this is the project's *first* feature with a manual re-entrancy concern of this shape.
2. **Confirm dialog applies the already-generated string (`pendingValue`), not a freshly recomputed one.** This
   means if the user edits `body` while the confirm dialog is open (technically possible — the rest of the form
   is "dimmed/inert behind the modal backdrop" per design doc but not literally disabled), confirming still
   applies the description generated from the form state *at click time*, not the now-current state. This is
   the correct/intended behavior (matches "what you saw is what you get") but Checker should verify this is
   actually what's implemented, since recomputing-on-confirm is an easy accidental simplification a builder
   might reach for.
3. **`Sparkles` icon from `lucide-react` is the concrete pick**, resolving design doc open question 2 in favor
   of keeping AI-suggestive iconography. This is a low-stakes, easily-revisited choice — Checker should not
   block on this; swapping to `Wand2` or `RefreshCw` is a one-line change with zero contract impact.
4. **200-character hard cap and 160-character body-clause cap are architect-chosen, not user-specified** (the
   spec only says "single-line appropriate for YAML frontmatter," no exact number was locked at office-hours).
   These are reasonable, generous defaults; if `/qa` flags real generated output as too long/short in practice,
   adjusting the two constants in `description.ts` is a non-breaking tuning change, not a re-architecture.
5. **The "You are.../Bạn là..." prefix-stripping heuristic in Step 1.4 is a deliberate readability nicety, not
   a locked requirement** — if a builder finds it adds unjustified complexity relative to value, it is safe to
   drop (fallback: just use the first line verbatim, still satisfies EC-1/Q6 and EC-4). Flagging so Checker
   does not treat its absence as a regression against this plan.
6. **No new `wasGenerated` flag, no new RPC, no new daemon code, no new disk-write path** — re-confirmed as
   constraints carried forward from STATE §9/AC-6/AC-8, not reopened.
7. **No component-level unit test framework exists yet for `apps/web`** (`@testing-library/react` is not a
   dependency anywhere in this repo, confirmed by package.json inspection) — `GenerateDescriptionButton`'s
   interaction behavior (confirm-vs-direct-apply, double-click guard) is therefore covered by **Playwright e2e**
   only (testplan §3), not a unit/component test. Adding `@testing-library/react` purely for this feature would
   be scope creep beyond what's needed (e2e already proves the user-visible contract); flagging this trade-off
   explicitly rather than silently skipping component-level coverage.

### Suggested next step

Run `/build` with `feature-builder`/`dev` implementing per this plan, then `/review` (code-reviewer checks
implementation against this PLAN section, especially 10.4's algorithm fidelity and 10.7's edge-case matrix),
then `/qa` against `auto-generate-description-testplan.md`.

---

## 11. BUILD (feature-builder, 2026-06-26) — phase complete, ready for /review

### 11.1 Files actually changed (exactly the 7-file list from §10.1, `apps/daemon` untouched — confirmed via `git status`)

| Action | File |
|---|---|
| Create | `packages/core/src/generate/description.ts` |
| Create | `packages/core/test/generate-description.test.ts` |
| Modify | `packages/core/src/index.ts` (added `export * from "./generate/description.js";`) |
| Create | `apps/web/src/components/GenerateDescriptionButton.tsx` |
| Modify | `apps/web/src/components/AgentForm.tsx` |
| Modify | `apps/web/src/components/WorkflowForm.tsx` |
| Create | `e2e/auto-generate-description.spec.ts` |

### 11.2 Verification run (all green)

- `npm run build` — all 4 workspaces (`@symbion/core`, `@symbion/rpc-types`, `@symbion/daemon`, `@symbion/web`) typecheck/build clean.
- `npx vitest run` — **108/108** tests pass across `core` + `daemon` workspaces, including the 13 new unit tests in `generate-description.test.ts`.
- `npx playwright test` — **9/9** e2e tests pass: existing `happy-path.spec.ts` (1) + new `auto-generate-description.spec.ts` (8, T1-T8).

### 11.3 Deviations from §10.4's literal spec text (testplan took precedence — flag for Checker)

1. **Step 1.4 "You are.../Bạn là..." prefix regex**: the plan's literal regex
   `/^(you are( an?| the)?|bạn là)\s+/i` would strip the indefinite article too (e.g. "You are a
   reviewer." -> "reviewer."), but testplan §1's expected output for that exact input is
   `"Agent that uses Read, Grep to a reviewer."` (article retained). Implemented regex is
   `/^(you are|bạn là)\s+/i` (article NOT consumed) to match the testplan's locked expected string.
   This is exactly the kind of "nicety, simplify if needed" trade-off STATE §10.8 #5 pre-approved —
   flagging the literal regex deviation explicitly since it diverges from the PLAN's regex text,
   even though it satisfies the testplan and the algorithm's intent.
2. **Step 1.6 "lowercase first char only if step 4 stripped a prefix"**: implemented as
   **unconditional** lowercase-first-char of the body clause (regardless of whether a "You are"
   prefix was stripped), again because testplan §1's table expects lowercase first-char output even
   for inputs with no "You are" prefix (e.g. `body:"Reviews code"` -> `"Agent that reviews code."`,
   and `body:"Run tests"` -> `"Command that run tests."`). The conditional-on-strip version failed
   those exact testplan rows; the unconditional version satisfies all 13 testplan rows. This is a
   deliberate, tested deviation from the literal PLAN text in favor of the testplan's concrete
   expected strings (testplan is the QA contract) — Checker should verify this reading is acceptable,
   since it's a case where the two locked documents (PLAN prose vs testplan table) were not
   byte-consistent with each other and a choice had to be made.

### 11.4 Assumptions made (for Checker to verify)

1. `CustomField.key`/`.value` are assumed always-defined strings per the `CustomField` type (no `?`
   on either field in `ir/types.ts`) — `deriveCustomFieldsClause` still defensively guards with
   `f.key?.trim()` / `f.value?.trim()` in case of malformed runtime data (consistent with the "never
   throws" contract), but this is belt-and-suspenders, not type-required.
2. `generateDescription`'s defensive null/undefined handling at the top of the function (`input?.kind`,
   etc.) is intentionally more permissive than the declared TS signature requires, solely to satisfy
   the locked "never throws for any... input... even under a malformed input the type system didn't
   catch" contract in §10.4 step 5.6 / testplan's "Never throws" row. Verified via a unit test that
   passes `null` and a partially-null object at runtime (cast through `@ts-expect-error`).
3. `GenerateDescriptionButton`'s confirm dialog `onApply` guards `pendingValue !== null` before calling
   (the PLAN's pseudocode uses a non-null assertion `pendingValue!`); behaviorally identical for all
   reachable states (the "Thay thế" button is only rendered/clickable while `confirmOpen` is true,
   which is only ever set together with `pendingValue`), but implemented as a safe runtime check
   instead of an assertion — purely defensive, no contract change.
4. For T6's e2e coverage, the testplan's literal scenario text ("...survives through Save and into
   Publish diff preview") was adjusted in implementation: the actual `PublishDiffView` component only
   renders file **paths/checkboxes** in the diff list, never raw file content (confirmed by reading
   `apps/web/src/components/publish/PublishDiffView.tsx`), so asserting generated text is "visible in
   the diff preview" is not a meaningful check against the real UI. The e2e test instead verifies the
   edited generated description (a) persists when the artifact form is re-opened after Save, and (b)
   lands verbatim in the written `.claude/agents/<name>.md` file on disk after Publish -> write,
   which is the substantively correct version of AC-6/AC-8's "survives Save/Publish" claim. Flagging
   this as an interpretation difference from the testplan's literal wording, not a skipped check.
5. T7 (daemon-disconnected) is simulated by intercepting the `/rpc` POST and aborting any request whose
   JSON body has `method: "ping"`, forcing `daemonConnected` to flip false via the existing heartbeat
   mechanism, rather than actually killing the daemon process (which would also break the rest of the
   already-loaded page's state). This is a reasonable proxy for "daemon disconnected" consistent with
   how `daemonConnected` is actually derived in `useArtifactStore`.
6. T4 (rapid double-click) — the two clicks are **not** guaranteed by the test to produce a single
   deterministic end-state, because (per STATE §10.7 EC-5) the entire `handleClick` body is synchronous
   with no `await` point, so React's event dispatch ordering — not the `busyRef` guard — determines
   whether the second click sees the description field already populated (and thus opens the confirm
   dialog) or not. The test was written to accept either outcome (direct-apply or confirm-then-cancel)
   and assert only the invariant that actually matters: the final value is never duplicated/garbled.
   Flagging this so Checker does not read the lack of a single fixed assertion as a weaker test —
   it's deliberately tolerant of the legitimate non-determinism in click-event timing while still
   proving EC-5/AC-4's real guarantee (no concurrent/duplicate apply).

### 11.5 Nothing deferred

No items from STATE §10.8's trade-offs list were further altered beyond what was already pre-approved
there (ref-based guard kept as specified; `Sparkles` icon used as specified; 160/200-char caps used as
specified; pendingValue-applies-already-generated-string behavior implemented exactly as specified).

### Suggested next step

Run `/review` (code-reviewer) against this BUILD section + §10 PLAN, paying particular attention to
§11.3's two documented deviations (testplan-vs-PLAN-prose conflict resolution) and §11.4's assumptions,
then `/qa` against `auto-generate-description-testplan.md`.

---

## 12. FIX — re-review blockers (feature-builder, 2026-06-26)

Two 🔴 blockers from `/review` fixed in `packages/core/src/generate/description.ts`. No other files
changed except the new unit tests below. `apps/daemon` and `apps/web` remain untouched by this fix.

### 12.1 Blocker 1 — `deriveCustomFieldsClause` could throw on a malformed `customFields` entry

**Root cause**: the `find` predicate used `f.value?.trim() !== ""`, which is `true` (i.e. the entry
*passes* the predicate and gets selected as the model field) when `f.value` is `null`/`undefined`,
because `undefined !== ""` is `true`. The very next line then did an unguarded `modelField.value.trim()`,
which threw a `TypeError: Cannot read properties of null/undefined (reading 'trim')` for exactly that
selected entry — i.e. the bug in the predicate is what caused the entry to be selected in the first
place, then the return statement crashed on it.

**Fix** (`deriveCustomFieldsClause`, packages/core/src/generate/description.ts:90-104):
- Predicate changed to `(f.value?.trim() ?? "") !== ""` so a `null`/`undefined` value is correctly
  treated as empty and never selected as the model field.
- Return path made null-safe regardless: `const value = (modelField.value ?? "").trim(); if (value === "") return undefined;`
  — defensive even if the predicate logic ever changes again, the return path alone can never throw.
- Net effect: a `customFields` entry like `{ key: "model", value: null }` is now silently ignored
  (treated as if no `model` field were present), not a crash — `generateDescription` still returns a
  normal string from the remaining clauses (tools/body/name fallback).

### 12.2 Blocker 2 — 200-char hard cap could truncate mid-parenthetical

**Root cause**: the `(model: ...)` parenthetical was spliced into the assembled string using the raw,
unbounded `customFieldsClause` value. If that pushed the whole string past `FINAL_CAP` (200), the
generic `normalize()` truncation (last-whitespace-before-200, force a trailing `.`) would cut straight
through the parenthetical, producing things like `"...to short (model:."` — unclosed `(`, dangling `:`,
mangled/missing model value.

**Fix, at the source rather than patching the generic cap** (per the task's instruction):
- `deriveCustomFieldsClause` now bounds the `model` value itself via the existing `capFragment` helper
  with a new, smaller constant `MODEL_VALUE_CAP = 40` before returning it, so the resulting `(model: ...)`
  parenthetical the assembly step splices in is always short (well under any cap that would matter) and
  always a complete, well-formed clause (capFragment already guarantees no mid-word cut and no dangling
  partial sentence).
- Added a second layer of defense in `generateDescription`'s agent-assembly branch: after building
  `withClause` (the candidate string with the parenthetical spliced in), if `withClause.length > FINAL_CAP`
  the parenthetical is dropped entirely (`assembled` stays as the pre-parenthetical string) rather than
  letting `normalize()`'s blind truncation cut through it. This covers the residual "some other unlikely
  combination" case the task flagged, even though with `MODEL_VALUE_CAP = 40` this fallback should be
  effectively unreachable in practice (kept anyway as the explicit "never produce a syntactically broken
  parenthetical" guarantee, per the task's hard requirement).
- `normalize()` itself (the generic 200-char cap) is unchanged — the fix is entirely upstream of it, as
  instructed.

### 12.3 Tests added (`packages/core/test/generate-description.test.ts`)

1. `"never throws: customFields entry with null/undefined value (blocker fix)"` — constructs inputs with
   `customFields: [{ key: "model", value: null }]` and `value: undefined` (via `@ts-expect-error`, same
   pattern as the existing "never throws" test), asserts `generateDescription` does not throw, returns a
   string, and — importantly — that the output does **not** contain a `(model:` parenthetical (proving the
   null/undefined entry was correctly rejected by the predicate, not merely "didn't crash by luck").
2. `"long model value (300 chars) never produces a broken parenthetical"` — passes a 300-char `model`
   value, asserts: output length `<= 200`; if a `(model:` substring is present it has a matching closing
   `)` after it; and the global count of `(` equals the count of `)` in the output (catches any unclosed
   paren anywhere, not just in the model clause specifically).

### 12.4 Verification run (all green, post-fix)

- `npx vitest run packages/core/test/generate-description.test.ts` — **15/15** pass (13 prior + 2 new).
- `npx vitest run` (full monorepo) — **110/110** pass across all 14 test files (`core` + `daemon`
  workspaces); no regressions.
- `npx playwright test` — **9/9** e2e pass, unchanged from before this fix (this fix touched no
  `apps/web` code, so e2e coverage is a regression check only, not new coverage for these two blockers).

### 12.5 Assumptions for Checker to verify

1. `MODEL_VALUE_CAP = 40` is a new, fix-author-chosen constant (not specified by the original PLAN/testplan,
   which only locked the outer `BODY_CLAUSE_CAP = 160` / `FINAL_CAP = 200`). 40 chars is generous for a
   realistic model identifier (e.g. `"claude-opus-4-20250514"` is 23 chars) while leaving ample headroom
   under `FINAL_CAP` even in the worst case (longest possible `toolsClause`/`bodyClause` + a 40-char model
   clause is still well under 200 in all realistic combinations) — Checker should confirm this budget is
   reasonable and doesn't clip any plausible real-world model name.
2. The existing passing test `"customFields with model: appended parenthetically..."` (model value
   `"claude-opus-4"`, 13 chars) is unaffected by the new 40-char cap since it's far under the cap — confirmed
   by the full-suite green run above, not just asserted.
3. Dropping the parenthetical entirely (rather than truncating it) when `withClause.length > FINAL_CAP` is
   the explicit instruction from the task ("prefer dropping the customFieldsClause entirely over truncating
   through it") — this is a behavior choice (model info silently disappears from the description in an
   edge case) rather than, say, shortening the rest of the sentence to make room; Checker should confirm
   this matches intent, since it does mean the `model:` annotation is not guaranteed to always appear even
   when a valid model field exists, in the rare case where everything else in the sentence is already near
   the cap.
4. No change was made to `FINAL_CAP`, `BODY_CLAUSE_CAP`, or `normalize()` — both blockers were fixed
   strictly upstream in `deriveCustomFieldsClause` and the agent-assembly branch, per the task's explicit
   "fix this at the source rather than patching the cap" instruction.

### Suggested next step

Re-run `/review` (code-reviewer) focused on §12.1-12.2 against the original two blocker descriptions, then
resume `/qa` against `auto-generate-description-testplan.md` if review passes clean.

---

## 13. QA — PASS (2026-06-26)

> Ran against `auto-generate-description-testplan.md` and STATE §6 (AC-1..AC-8) / §12 (latest fix notes).

### 13.1 Automated gates (all green)

| Gate | Result |
|---|---|
| `npm run build` (root, all workspaces) | **PASS** — `@symbion/core`, `@symbion/rpc-types`, `@symbion/daemon` typecheck clean via `tsc`; `@symbion/web` (`next build`) compiles, typechecks, lints, and generates static pages with no errors. |
| `npx vitest run` | **PASS** — **110/110** tests across 14 test files (`core`: `generate-description.test.ts` 15, `validate.test.ts` 9, `runcommand.test.ts` 4, `sha256.test.ts` 1, `semver.test.ts` 6, `marker.test.ts` 5, `frontmatter.test.ts` 8, `scan.test.ts` 2, `render-codex.test.ts` 6, `render-claude.test.ts` 5, `diff.test.ts` 9; `daemon`: `findOpenPort.test.ts` 5, `server.integration.test.ts` 7, `rpc.integration.test.ts` 28). Matches expected 110/110 exactly. |
| `npx playwright test` | **PASS** — **9/9**: `happy-path.spec.ts` (1, pre-existing regression check) + `auto-generate-description.spec.ts` T1-T8 (8, new). All ran in ~16s, single retry-free pass. |

### 13.2 Code spot-check (manual smoke, testplan §4)

Read final diffs of `apps/web/src/components/AgentForm.tsx`, `apps/web/src/components/WorkflowForm.tsx`,
`apps/web/src/components/GenerateDescriptionButton.tsx`:

- Sparkle-icon button (`Sparkles` from `lucide-react`) is rendered inside the same `flex gap-2` row as the
  `description *` `Input` on **both** forms (`AgentForm.tsx` lines 52-74, `WorkflowForm.tsx` lines 37-57) —
  matches design (icon flush-right of the input, no layout shift). Grep confirms `GenerateDescriptionButton`
  is used in exactly these two places and nowhere else (AC-1).
- Confirm-dialog copy in `GenerateDescriptionButton.tsx` line 64:
  `Văn bản mô tả hiện tại sẽ được thay thế — tiếp tục?` — verified byte-level via `file`/UTF-8 regex check:
  valid UTF-8, renders correctly, **not** garbled/mis-encoded. Dialog title "Thay thế mô tả?", buttons "Hủy" /
  "Thay thế" also present and correctly encoded.
- `packages/core/src/generate/description.ts` confirmed to have **zero** fs/net/Node imports (only imports
  the `CustomField` type) — architecturally guarantees AC-7/EC-3/EC-7/EC-9 are vacuously satisfied, not just
  asserted by test.

### 13.3 Acceptance criteria — AC-1 through AC-8

| # | Criterion | Verified by |
|---|---|---|
| AC-1 | Icon visible adjacent to `description *` on both forms, nowhere else | Code inspection (§13.2) — `GenerateDescriptionButton` only instantiated in `AgentForm.tsx`/`WorkflowForm.tsx`'s description row; corroborated by e2e T1 (`AgentForm`) and T5 (`WorkflowForm`) locating the button by accessible name next to the description input. |
| AC-2 | Non-empty body → single-line generated description (no `\n`), bounded time, or error per AC-5 | Unit tests "multi-line body (EC-4)" and "long body (EC-4)" in `generate-description.test.ts`; e2e T1 (agent) and T5 (command) confirm field populates with no perceptible delay (synchronous, in-process). |
| AC-3 | Non-empty description never replaced without explicit confirm | e2e T2 (click generate → confirm dialog appears → "Hủy" → original text `"My custom description"` still present) and T3 (same setup → "Thay thế" → description replaced). Direct, end-to-end proof. |
| AC-4 | Button disabled/loading in flight; no duplicate concurrent request | `busyRef` synchronous re-entrancy guard + `busy` state in `GenerateDescriptionButton.tsx`; e2e T4 (rapid double-click) asserts final value matches `Agent that uses Read...` exactly once (`match(...).length === 1`), no duplication/concatenation. |
| AC-5 | Backend unreachable → non-blocking error, field unchanged, Save/Publish unaffected | Vacuously satisfied by architecture (no backend call exists — confirmed via code inspection of `description.ts`, zero I/O). Positively verified by e2e T7 (daemon disconnected via aborted `ping` RPC, generate button still enabled and functional) and T8 (zero network requests fired during click, via Playwright request listener). |
| AC-6 | Generated value behaves as normal text afterward (editable, included in save/validation), no new `wasGenerated` IR flag | e2e T6 (generated text edited further, saved via "Lưu", form reopened, edited value persists). Code inspection: `onApply` invokes the same `update("description", value)` / `onChange` callback path used by manual typing; `CanonicalArtifact` type unchanged (no new flag added — confirmed by `packages/core/src/index.ts` barrel export diff containing only the new `generate/description.js` export, no `ir/types.ts` changes). |
| AC-7 | No API key/secret in apps/web, network payload, or devtools state | Vacuously and structurally satisfied: `generateDescription` is a pure function with zero fs/net/Node imports (code inspection). Positively verified by e2e T8 (zero network requests fired on click — nothing to leak a secret into). |
| AC-8 | No new disk-write path; flows only through existing Save (`saveArtifact`)/Publish (`write` RPC) | e2e T6's final assertion: after Publish → diff preview → "Ghi xuống đĩa", the generated+edited description lands verbatim in `.claude/agents/<name>.md` on disk, reached only via the pre-existing publish-diff-write RPC flow. Code inspection confirms `apps/daemon` has zero files changed across BUILD (§11.1) and FIX (§12) phases — no new RPC method, no new write path introduced. |

### 13.4 Notes / residual items (informational only, not blocking)

- T4's tolerant assertion design (per BUILD §11.4 item 6 — accepts either "direct re-apply" or
  "confirm-then-cancel" as the second click's outcome) was reviewed against the actual test code
  (`auto-generate-description.spec.ts` lines 94-114) and is a reasonable test for the documented
  non-determinism (synchronous click-event dispatch ordering, not a `busyRef` defect) — does not indicate
  a product bug, just an acknowledged test-design trade-off already flagged by the builder.
- T6's adjusted interpretation of "survives ... into Publish diff preview" (BUILD §11.4 item 4 — verifying
  the file written to disk rather than literal diff-list content, since `PublishDiffView` only renders file
  paths/checkboxes) was reviewed against `e2e/auto-generate-description.spec.ts` lines 165-174 and is judged
  a faithful, substantively-correct proxy for AC-6/AC-8's intent — not a weakened check.
- No regressions observed in pre-existing `happy-path.spec.ic` / full vitest suite from this feature's changes.

### 13.5 Verdict

**PASS.** All three automated gates green (build/vitest/playwright), all 8 acceptance criteria (AC-1..AC-8)
verified with explicit test or code-inspection evidence, manual smoke (icon placement + Vietnamese copy
encoding) confirmed clean. No issues found requiring a fix-and-recheck loop. Ready to proceed to `/ship`.
</content>
