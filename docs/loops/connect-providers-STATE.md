# connect-providers — STATE

**Phase: DONE**

## 13. M6 triage (post-QA fix)

QA flagged that the shared `Dialog` primitive (`apps/web/src/components/ui/dialog.tsx`)
had no Escape-key handler, failing testplan M6 (Esc must dismiss
`ConnectProviderPanel`). Fixed directly (full-autopilot, no gate): added a
`window.addEventListener("keydown", ...)` effect scoped to `open`, closing on
`Escape`, cleaned up on unmount/close. This is a fix to shared infra (benefits
every dialog in the app, not just this feature) — minimal, isolated, no new
dependency. Re-ran `npm run build` (pass) and `npm run test` (202/202 pass,
unchanged) after the fix. M6 now passes by code inspection.

## -1. Autopilot decisions (self-decided, full-autopilot run — no manual gate)

Per user instruction ("implement, nếu có câu hỏi thì tự analyze và đề xuất sau
đó tự implement"), the 5 open questions in §7 are resolved as follows, taking
the spec's own recommended/most-conservative option in each case:

1. **Guide-only for v1** (not auto-fix). No daemon-spawned install/pull
   commands. Matches the explicit recommendation in §7.Q1 and avoids a new
   trust boundary requiring `/cso` review.
2. **Both proactive + reactive entry points**: a small status indicator near
   the Generate button (visible before clicking) AND the existing inline
   error gets an actionable CTA. No new standalone Settings page — reuse the
   GenerateBodyDisclosure/inline-banner surface that already exists, per
   "don't scope-creep into building settings infrastructure" (§2 out-of-scope).
3. **On-demand check only** — a "Kiểm tra lại kết nối" (recheck) button the
   user clicks; no background polling. Avoids the "why is Symbion pinging my
   machine" foot-gun (§8) and keeps this read-only/static-content scope.
4. **Ollama only** gets the full guided setup copy (name/explain/OS-specific
   install command) in v1. `remote` keeps its existing `auth` error message
   as-is — no new API-key input field (that's a distinct secret-handling
   surface, deferred).
5. **Provider-reachable only** — no model-pulled-vs-missing distinction in
   v1. Status check is "can the daemon reach the provider," nothing about
   which models exist. Keeps the new RPC minimal (no `/api/tags` proxy).

These resolve all 5 §7 questions and the §6 THINK-done checklist. Proceeding
straight to `/design` → `/plan` → `/build` with no pause, per user's
full-autopilot selection.

## 0. Origin

Triggered by a bug investigation (`auto-generate-body`): a new user hit
`"Không thể kết nối tới Ollama — đảm bảo Ollama đang chạy trên máy."` when
clicking "Tạo nội dung" (Generate Body) in the Agent/Workflow builder.
Root cause was confirmed **not a bug** — Ollama was simply not installed/running.
That closes the bug. This STATE captures the **follow-up UX request** the user
raised: manual out-of-app Ollama setup is too much friction for a first-time
user — is there an in-app "Connect to providers" flow to make setup easy?

This is logged as its own feature/loop, separate from `auto-generate-body`,
because it is a new scope (setup/onboarding UX), not a fix to existing
behavior. Existing error taxonomy (`llm-provider-not-running` etc., see
`apps/daemon/src/llm/types.ts`, `apps/web/src/components/GenerateBodyButton.tsx`)
is the the substrate this feature builds on top of — not something to be reworked
to satisfy this loop.

## 1. Problem (user story)

> As a new Symbion user with no AI provider installed yet, when I try to use
> an AI-assisted feature (Generate Body, Generate Description) and it fails
> because no provider is reachable, I want a clear, low-friction way — inside
> Symbion — to understand *why* it failed and *what to do next*, without
> having to already know what Ollama is, where to get it, or how to run it
> from a terminal.

The current failure mode gives a correct but terminal error message
(`"Không thể kết nối tới Ollama — đảm bảo Ollama đang chạy trên máy."`) with
no actionable next step inside the product. The user is dropped into "go
figure out Ollama yourself" territory.

## 2. Scope

### In scope (this loop, THINK phase only — no solution chosen yet)
- Define what "easy setup" must *accomplish* from the user's point of view —
  not how it's built.
- Cover both providers currently wired (`ollama`, `remote` — see
  `apps/daemon/src/llm/registry.ts`), since "Connect to providers" implies a
  provider-agnostic entry point, not an Ollama-only patch.
- Define the **status visibility** requirement: user must be able to tell,
  before clicking "Generate", whether a provider is currently reachable —
  not only after the call fails.
- Define what happens after a successful "fix" (e.g. user starts Ollama in
  another window) — does Symbion notice without a page reload?

### Out of scope (explicitly — do not let `/design` or `/plan` smuggle these in)
- **Symbion/daemon installing software on the user's machine** (e.g. running
  an OS package manager, downloading Ollama's installer, or shelling out to
  `ollama pull <model>` on the user's behalf). This is a distinct, much larger
  trust-boundary decision (daemon executing arbitrary install/process-spawn
  commands vs. today's fs-read/fs-write-only scope) and **requires its own
  product decision + threat-model review**, not a default "while we're in
  here" addition to a UX-polish feature. If the architect/designer want to
  propose this, it must come back to product as an explicit open question
  (see §4), not be assumed.
- Adding new LLM providers (Copilot/Gemini/etc.) — separate from this loop.
- Building a full settings/preferences app shell, if one doesn't already
  exist — reuse whatever exists; don't scope-creep into "build settings page
  infrastructure."
- Changing the existing error-code taxonomy or `LlmError` codes
  (`apps/daemon/src/llm/types.ts`) — this loop's job is what the *user sees
  and can do*, not the wire contract, unless a new status-check capability
  genuinely requires a new RPC method (architect's call in `/plan`).
- Auto-fetching the live model list from Ollama's `/api/tags` (`listModels()`
  is currently static per `LlmProvider` §"no dynamic fetch in v1" — out of
  scope here unless the connect flow specifically needs it to show "which
  models are actually pulled," which is an open question below).

## 3. Happy path (target experience, technology-agnostic)

1. User opens the Agent/Workflow builder for the first time, no provider
   running.
2. Before they even click "Generate", they can see — somewhere reasonably
   discoverable, not buried — that the currently-selected provider's status
   is "not connected" (not just silence/disabled button with no explanation).
3. From that status indicator, one click/tap takes them to a place that:
   - names the provider currently needed (Ollama, by default in v1),
   - explains in plain language what it is and why it's needed,
   - gives them the exact command(s) to install/run it for their OS, in a
     copy-pasteable form,
   - lets them re-check connection status on demand ("Kiểm tra lại kết nối")
     without restarting Symbion or reloading the page.
4. Once the provider becomes reachable (user ran it in a terminal
   themselves), Symbion reflects "connected" within a reasonable time without
   the user having to guess that a refresh is needed.
5. User returns to Generate Body / Generate Description and it now works,
   with no separate re-discovery of the original feature.

## 4. Edge cases to account for (spec-level, not solution-level)

- **EC-1**: Provider was working, then stops mid-session (user closes Ollama)
  — does status visibility update, or does the user only find out on next
  failed Generate click?
- **EC-2**: User is on the `remote` provider path (API key via env var per
  `RemoteProvider`), not Ollama — the "Connect providers" entry point must
  not be Ollama-only; remote's failure mode (`auth` — missing API key) needs
  its own plain-language guidance distinct from Ollama's (`provider-not-running`).
- **EC-3**: OS-specific install instructions differ (macOS/Linux/Windows/WSL)
  — daemon and web run on the user's machine, so the daemon *can* know its own
  OS; spec requirement is "instructions shown match the user's actual OS,"
  not "instructions are a generic paragraph covering all OSes."
  (Note: the working dir for this very session is WSL2 on Windows — that
  combination specifically must not be mishandled / shown wrong commands.)
  Spec note: WSL vs native-Linux Ollama can each be running their own daemon
  on `127.0.0.1:11434` independently — "loopback reachable" does not
  necessarily mean "the install instructions I should show match what's
  actually there."
- **EC-4**: Right host/port but wrong/incompatible Ollama version, or Ollama
  running but the specific model (`llama3.2:1b` etc.) was never pulled —
  distinguish "provider unreachable" from "provider reachable, model missing"
  as different user-facing states, since the fix is different (start the
  service vs. pull a model).
- **EC-5**: A model pull (if ever offered, in scope or not) for a 70B-class
  model can take many minutes over a slow connection — any flow that invites
  the user toward "pull this model" must not look hung/frozen with no
  progress feedback.
- **EC-6**: User dismisses/ignores the connect-providers screen entirely and
  just wants to use Symbion for non-AI features (the builder works without
  AI-assist; Generate Body/Description are optional accelerators) — the
  setup flow must be skippable/dismissible, never a blocking gate on the rest
  of the app.
- **EC-7**: Daemon not running at all (`daemonConnected` false, per
  `useArtifactStore` in `GenerateBodyButton.tsx`) is a *different* failure
  from "daemon running, but Ollama not running" — the connect-providers UX
  must not conflate "Symbion's own daemon is down" with "your AI provider is
  down"; these need visibly different messaging since the fix is completely
  different (restart Symbion vs. install/run Ollama).

## 5. Constraints (carried over from CLAUDE.md — non-negotiable for any design)

- Any new "check provider status" capability is read-only network I/O
  (HTTP GET/ping to loopback) from the daemon — must go through the existing
  `apps/daemon` boundary (the only process touching network), never directly
  from `apps/web`. Same SSRF/loopback discipline as `isLoopbackUrl()` in
  `ollamaProvider.ts` applies to any status-check call.
  - if the chosen solution involves anything beyond a Read (e.g. daemon
    spawning a child process to install or run `ollama pull`), that is a new
    trust boundary and is explicitly flagged as **out of scope pending a
    separate product decision** (§2).
- No silent background polling that surprises the user with unexpected
  network calls they didn't initiate — any "auto-detect on boot / persistent
  status indicator" approach must be honest in the UI about what's being
  checked and how often (this is the same "never write/act silently" spirit
  from CLAUDE.md's filesystem-safety rules, applied to network checks).
- Must work without assuming the user has any prior knowledge of what Ollama
  is — copy must explain, not just link to external docs as the only path.

## 6. Definition of done (verifiable)

This loop (THINK) is done when:
- [ ] Product has chosen ONE of the candidate UX approaches (see §7 — open
      question, not pre-decided here) — or an explicit combination — as
      locked scope.
- [ ] The "auto-install / auto-pull-model" out-of-scope decision in §2 has
      been explicitly confirmed or overturned by the user (not assumed).
- [ ] `/design` then `/plan` can proceed against a locked scope without
      re-litigating "should Symbion install software for the user."

The eventual *feature* (post `/build`) is done when, for each acceptance
criterion below, it is independently demonstrable:
- [ ] AC-1: A user with no provider running can, from the builder screen,
      reach a connect/setup screen in ≤2 clicks from where they currently
      see the error.
- [ ] AC-2: The setup screen names the specific provider, explains what it
      is, and shows copy-pasteable setup instructions correct for the host
      OS the daemon is actually running on.
- [ ] AC-3: The user can trigger a manual "check connection" action and get
      a result (connected / not connected / model missing) within a bounded,
      visible time (e.g. spinner with timeout, not indefinite silence).
- [ ] AC-4: "Daemon disconnected" and "provider (Ollama) disconnected" are
      never shown with the same message or icon.
- [ ] AC-5: The setup screen is reachable from Settings/equivalent
      independent of having first hit an error (discoverable proactively,
      not only reactively after failure).
- [ ] AC-6: Dismissing/closing the setup screen never blocks any non-AI
      feature of the builder.
- [ ] AC-7: No new daemon capability introduced for this feature performs
      writes outside `.symbion/`/target-repo scope already governed by
      existing filesystem-safety rules; no new capability spawns
      install/package-manager processes unless that was explicitly
      re-confirmed in scope per the open question below.

## 7. Open questions (need user/product decision — not guessed)

1. **Auto-fix vs. guide-only**: Should Symbion ever offer to *run* setup
   commands for the user (e.g. a "Pull llama3.2:1b" button that has the
   daemon shell out to `ollama pull ...`), or should v1 stay strictly
   "show me what to run, I'll run it myself"? This is the single highest-
   leverage decision in this loop — it changes the trust boundary of the
   daemon meaningfully (today: fs read/write + outbound HTTP to loopback;
   proposed: spawning arbitrary child processes). Recommend defaulting to
   **guide-only** for v1 unless the user explicitly wants auto-pull, given
   CLAUDE.md's existing bar for daemon-side caution.
2. **Proactive vs. reactive entry point**: Is a standalone "Connect Providers"
   item needed in some persistent settings/nav location (visible before any
   error), or is an inline banner/CTA inside the Generate Body failure state
   sufficient for v1? (Affects AC-5.)
3. **Status indicator persistence**: Does the user want an always-visible
   connection-status badge (e.g. in a header) for the active provider, or is
   on-demand "check now" sufficient? Always-visible implies some polling
   cadence decision (how often, and is that disclosed to the user per the
   "no silent polling" constraint in §5).
4. **Which providers get a guided setup screen in v1**: Just Ollama (today's
   actual blocker), or also `remote` (API-key entry guidance)? Note
   `RemoteProvider` reads its key from `process.env`, never from the web UI
   — if "remote" gets a setup screen, does that change (e.g. does Symbion
   now need a secure way to persist a key), or does the remote setup screen
   only explain "set this env var and restart the daemon"? This has real
   security-surface implications (a UI text field that *sets* an env var /
   persists a secret is a different risk profile than read-only env var
   today) and should not be assumed without product input.
5. **Model-missing vs. provider-unreachable distinction (EC-4)**: Is
   detecting "Ollama running but model not pulled" in scope for v1, or is
   "provider reachable, period" (no model-level check) good enough for now?
   This determines whether any new status-check RPC needs to also call
   Ollama's `/api/tags`-equivalent, which is itself adjacent to (but distinct
   from) the existing "no dynamic model list in v1" decision recorded in
   `LlmProvider.listModels()`.

## 8. Product risk notes (for architect/dev awareness, not a build instruction)

- **Risk: scope creep into daemon-executes-installer.** The most natural
  "delightful" version of this feature (one-click install/run) is exactly
  the version that most expands the daemon's trust boundary. Any plan that
  includes daemon-spawned `ollama pull`/install commands must be treated as
  security-review-worthy (`/cso`) before build, not bundled in as an
  incidental UX nicety.
- **Risk: OS-detection wrong → user copies a command that doesn't work or,
  worse, is harmful on their actual OS/shell** (e.g. WSL vs native Windows
  vs native Linux ambiguity, as seen in this very dev environment). Wrong
  guidance here erodes trust faster than no guidance.
- **Risk: status check becomes a foot-gun for "why does Symbion keep pinging
  my machine."** Any polling/auto-recheck behavior must be visibly,
  honestly described to the user (timing, what's being contacted) — this is
  the network-equivalent of "never write silently."
- **Risk: conflating daemon-down with provider-down** (§ EC-7) — a confused
  user might try to "fix Ollama" when the actual problem is Symbion's own
  daemon process died, wasting their time and generating a misleading
  support narrative.
- **No filesystem risk identified for the guide-only variant** — it is
  read-only (status check) + static content rendering. Risk is contained to
  out-of-scope variants in open question 1.

## 9. Recommended next step

This is product-shape work appropriately, NOT yet architecture work.
Recommend `/office-hours` or direct user answers to the 5 open questions in
§7 to lock scope, THEN `/design` (designer explores 3 angles for the actual
screen/flow) and `/plan` (architect: RPC surface, daemon status-check module,
whether any new capability is needed beyond existing `listModels`/
`generateBody` RPCs in `apps/daemon/src/rpc/handlers.ts`).

## 10. PLAN (architect)

Source inputs: §-1 locked decisions (guide-only, on-demand check, Ollama-only,
reachable/not-reachable binary, no daemon-spawned installs) +
`docs/loops/connect-providers-design.md` (UI). This section is the technical
design handed to `dev`/`feature-builder`. No production code below.

### 10.0 Scope confirmation (push-back check)

Confirmed: **`packages/core` needs ZERO changes.** This feature is (a) one
new daemon-only reachability check + OS-detection module, (b) one new RPC
method, (c) two new web components + one modified component. There is no
canonical-IR concept of "provider connection status" — it is transient,
unpersisted, daemon-runtime state, not an artifact. Keeping it entirely out
of `packages/core` is correct per CLAUDE.md ("core is PURE").

Scope-creep watch: the design doc's Open Question 1 (popover vs Dialog) is
decided here as **Dialog reuse** (no new `popover.tsx` primitive) — adding a
new shadcn/Radix primitive for one status panel is exactly the kind of
incidental-infrastructure creep §2 warns against. Reuse `Dialog` as the
design doc's own default already recommends.

### 10.1 Files to create / modify

**`apps/daemon` (new logic, the only process doing the network check):**
- NEW `apps/daemon/src/llm/providerStatus.ts`
  - `checkOllamaReachable(baseUrl: string, timeoutMs: number): Promise<boolean>`
  - Reuses `OLLAMA_DEFAULT_BASE_URL` and the same env-var/loopback resolution
    `OllamaProvider` already does — see 10.3 for exact reuse mechanism.
- NEW `apps/daemon/src/llm/installInstructions.ts`
  - Pure data + `process.platform`/`os.release()` detection logic (no fetch,
    no fs-write — easy Vitest target, no server needed).
  - Exports `detectHostEnvironment(): HostEnvironment` and
    `getOllamaInstallInstructions(env: HostEnvironment): InstallInstructions`.
- MODIFY `apps/daemon/src/rpc/handlers.ts` — add `checkProviderStatus` handler.
- MODIFY `apps/daemon/src/rpc/contract.ts` — re-export the 2 new types.

**`packages/rpc-types` (shared contract):**
- MODIFY `packages/rpc-types/src/index.ts` — add `CheckProviderStatusParams`,
  `CheckProviderStatusResult`, `HostEnvironment`, `InstallInstructions`; add
  `"checkProviderStatus"` to the `RpcMethod` union.

**`apps/web` (UI, per design doc):**
- NEW `apps/web/src/components/ProviderStatusPill.tsx`
- NEW `apps/web/src/components/ConnectProviderPanel.tsx`
- MODIFY `apps/web/src/components/GenerateBodyButton.tsx` — render the pill
  next to the `[✨]` button; render the panel inside the existing
  `errorCode === "llm-provider-not-running"` block with a new
  `[ Cách kết nối Ollama ]` trigger.
- MODIFY `apps/web/src/lib/rpc/types.ts` — re-export the new types (mirrors
  the existing re-export pattern for every other RPC; no hand-duplication).

**No changes to:** `packages/core` (confirmed §10.0), `apps/daemon/src/llm/types.ts`
(`LlmError`/`LlmErrorCode` untouched per STATE §2 explicit out-of-scope),
`apps/daemon/src/llm/ollamaProvider.ts` (read, not modified — its exported
`OLLAMA_DEFAULT_BASE_URL` const is imported, the class itself is untouched),
`apps/daemon/src/llm/registry.ts` (status-check does not go through
`getProvider()` — see 10.3 for why), `useArtifactStore.ts` (existing
`daemonConnected` heartbeat is read as-is, not modified — EC-7 leans on it
exactly as the design doc specifies).

### 10.2 New RPC method: `checkProviderStatus`

`packages/rpc-types/src/index.ts` additions:

```ts
export interface HostEnvironment {
  /** what the daemon believes its own host environment is, for install-command selection (EC-3). */
  kind: "wsl" | "linux" | "macos" | "windows" | "unknown";
  /** short human label shown verbatim in the panel's "phát hiện: …" line, e.g. "WSL2 (Ubuntu trên Windows)". */
  label: string;
}

export interface InstallInstructions {
  env: HostEnvironment;
  /** true only when detection is confident enough to show ONE command block (design doc Open Q2). */
  confident: boolean;
  /** one entry per OS variant to show. Length 1 when confident===true; length >1 (all known variants,
   *  labeled) when confident===false, per design doc's "(b) stacked labeled sections" default. */
  variants: Array<{ label: string; command: string }>;
}

export interface CheckProviderStatusParams {
  providerId: "ollama"; // narrow on purpose — "remote" is out of scope (locked decision 4)
}
export interface CheckProviderStatusResult {
  reachable: boolean;
  /** present iff reachable===false; informational only, not for branching logic in the UI. */
  checkedBaseUrl: string;
  install: InstallInstructions;
}
```

`RpcMethod` union gains `"checkProviderStatus"`.

`apps/daemon/src/rpc/handlers.ts` addition (illustrative signature, not final code):

```ts
async checkProviderStatus(params: contract.CheckProviderStatusParams): Promise<contract.CheckProviderStatusResult> {
  if (params.providerId !== "ollama") {
    throw new RpcError("invalid-params", `checkProviderStatus chỉ hỗ trợ "ollama".`);
  }
  const baseUrl = resolveOllamaBaseUrlForStatusCheck(); // see 10.3
  const reachable = await checkOllamaReachable(baseUrl, 3000);
  const install = getOllamaInstallInstructions(detectHostEnvironment());
  return { reachable, checkedBaseUrl: baseUrl, install };
},
```

Validation mirrors the existing `assertValidProviderId` pattern but is
**narrower on purpose**: this RPC's contract type is `providerId: "ollama"`
(not the union), so a non-"ollama" value is already a TS-contract violation
client-side; the runtime check above is the same defense-in-depth the
codebase already applies everywhere else (JSON off the wire has zero
runtime enforcement regardless of the TS type).

### 10.3 Reachability check mechanics

- **Reuse, don't duplicate, base-URL resolution.** `OllamaProvider`'s
  constructor already encapsulates the env-var/loopback-guard/default logic
  (lines 53-81 of `ollamaProvider.ts`). Rather than re-implement that
  resolution in `providerStatus.ts`, export a tiny resolver function from
  `ollamaProvider.ts` itself — e.g. `resolveOllamaBaseUrl(): string` — that
  both the constructor and the new status-check module call. This is a
  **small refactor of `ollamaProvider.ts`** (extract existing logic into a
  named function, call it from the constructor unchanged), not new logic, so
  the loopback-SSRF guard has exactly one implementation, not two
  independently-maintained copies. Flag this refactor explicitly to
  `code-reviewer`/`security-reviewer` as touching the SSRF-guarded code path
  — low risk (extraction only, no behavior change) but worth a second look
  per `/cso` discipline since it's in the loopback-trust-boundary file.
- **The check itself does NOT go through `getProvider("ollama")` /
  `OllamaProvider.generate()`.** A real `generate()` call is expensive (loads
  a model, can take seconds-to-minutes) and is the wrong shape for "is
  anything listening." Instead: a lightweight `GET {baseUrl}/` (Ollama's root
  endpoint returns `200 "Ollama is running"` with no body parsing needed) via
  `fetch` + `AbortController`.
- **Timeout: 3000ms.** Much shorter than `generate()`'s 45000ms — this is a
  liveness ping, not an inference call; AC-3 demands "bounded, visible time,"
  and a status check hanging for 45s would itself be a UX bug independent of
  this feature's scope. 3s is generous for a loopback TCP round-trip while
  still feeling instant if Ollama is actually up.
- **Reachable vs not-reachable, exactly two outcomes (locked decision 5 — no
  model-list distinction):**
  - `fetch` resolves with any HTTP status (200, 404, whatever) → `reachable: true`.
    Ollama responding at all to the root path — even a non-2xx — proves a
    process is listening on that port and speaking HTTP, which is the only
    claim this check makes. Do NOT require status===200 specifically; that
    would risk a false "not reachable" if Ollama's root-path response shape
    changes across versions (EC-4's "wrong version" case is explicitly
    deferred per locked decision 5, not silently smuggled back in here as a
    stricter reachability bar).
  - `fetch` throws (connection refused, DNS fail, abort/timeout) →
    `reachable: false`.
- **Distinguishing from daemon-down (EC-7):** this RPC call itself only
  happens if the daemon is reachable (the RPC transport succeeded) — by
  construction, if the daemon is down, `callRpc("checkProviderStatus", …)`
  rejects at the transport layer (network error / no response), which is a
  **different code path** in the web client than a resolved
  `{ reachable: false }`. `ProviderStatusPill`/`ConnectProviderPanel` must
  treat "RPC call itself failed/rejected" as "cannot determine — daemon
  problem" (defer to existing `daemonConnected` store value, per design doc's
  "suppress pill entirely" rule), and only treat a **resolved** RPC response
  with `reachable: false` as "Ollama specifically is down." This is the
  precise mechanism that satisfies AC-4 — no new daemon-side code is needed
  for this distinction; it falls out of the existing transport-vs-payload
  separation that `callRpc`/`DaemonRpcError` already provide.

### 10.4 OS detection (EC-3)

NEW pure file `apps/daemon/src/llm/installInstructions.ts` — no fs-write, no
network; only `node:process` (`process.platform`) and `node:os`
(`os.release()`, `os.version?.()` where available). Pure-data + pure-function
shape makes this trivially unit-testable without mocking fs/network.

Detection logic:

```ts
import { platform, release } from "node:os";

function detectHostEnvironment(): HostEnvironment {
  const plat = process.platform; // "linux" | "darwin" | "win32" | ...
  if (plat === "darwin") return { kind: "macos", label: "macOS" };
  if (plat === "win32") return { kind: "windows", label: "Windows" };
  if (plat === "linux") {
    // WSL detection: WSL's kernel release string contains "microsoft" or
    // "WSL" (case-insensitive) — e.g. "5.15.90.1-microsoft-standard-WSL2".
    // This is the standard, documented way Node/most tooling detects WSL
    // (no /proc read needed — os.release() already exposes the uname -r
    // string). Confirmed present in THIS session's own env
    // ("6.6.87.2-microsoft-standard-WSL2" per the env block) — i.e. the
    // exact EC-3 "must not mishandle this session's own combination" case
    // is covered by this exact check.
    const rel = release().toLowerCase();
    if (rel.includes("microsoft") || rel.includes("wsl")) {
      return { kind: "wsl", label: "WSL2 (Ubuntu trên Windows)" };
    }
    return { kind: "linux", label: "Linux" };
  }
  return { kind: "unknown", label: "Không xác định" };
}
```

- **Confidence:** `kind !== "unknown"` → `confident: true`, exactly 1 variant
  shown. `kind === "unknown"` (e.g. FreeBSD, or a future Node platform value
  not in the switch) → `confident: false`, **all 4 known variants** (macOS,
  Linux, WSL2, Windows) returned labeled, per design doc's Open Question 2
  default "(b) stacked labeled sections." This never happens for the 4
  platforms Symbion is documented to run on, but a pure function must have a
  total, never-throws return for every `process.platform` value Node can
  report — `unknown` is the explicit escape hatch, not a thrown error.
- **No native-Windows-vs-WSL ambiguity risk**: `process.platform` is set at
  Node-process-launch time by the OS the Node binary itself was compiled
  for/launched on. A daemon process running as a native Windows Node binary
  reports `win32` even under WSL-adjacent setups; a daemon process launched
  *inside* WSL's Linux userspace reports `linux` + the `microsoft`-tagged
  kernel release. There is no scenario where the daemon process itself is
  ambiguous about which of these two it is — the ambiguity STATE §4 EC-3
  warns about is a **command-content** risk (showing the wrong command for
  the host the daemon is actually on), not a detection-confidence risk for
  this specific win32-vs-linux+WSL split. (Genuine low-confidence cases are
  reserved for `kind: "unknown"` — non-mainstream `process.platform` values.)
- **Install command table** (data only, lives in the same file):
  - `wsl`/`linux`: `curl -fsSL https://ollama.com/install.sh | sh && ollama serve`
  - `macos`: `brew install ollama && ollama serve` (fallback note if Homebrew
    absent is out of scope — guide-only, single command per locked decision 1)
  - `windows`: link-style guidance — "Tải và chạy trình cài đặt tại
    https://ollama.com/download/windows" (no single copy-paste shell command
    exists for native Windows the way curl/brew cover Unix-likes; this is a
    content decision the dev should treat as a placeholder string, not an
    architecture concern)

### 10.5 Data flow (end to end)

```
1. GenerateBodyButton mounts (providerId === "ollama", daemonConnected === true)
       │
       ▼
2. ProviderStatusPill useEffect-on-mount fires ONE callRpc("checkProviderStatus", { providerId: "ollama" })
       │  (web → daemon, localhost HTTP POST /rpc, session-token header — existing transport, no change)
       ▼
3. apps/daemon handlers.checkProviderStatus:
   a. resolveOllamaBaseUrlForStatusCheck() — same env/loopback-guarded resolution OllamaProvider uses
   b. fetch(`${baseUrl}/`, { signal: AbortController(3000ms) })  — daemon → Ollama, loopback HTTP GET
   c. detectHostEnvironment() + getOllamaInstallInstructions(env)  — pure, no I/O
   d. returns { reachable, checkedBaseUrl, install }
       │  (daemon → web, JSON RPC response — no filesystem/git touched anywhere in this flow)
       ▼
4. Web: ProviderStatusPill renders dot/label from `reachable`.
   ConnectProviderPanel (if open) renders `install.variants` as code block(s).
       │
       ▼
5. User runs the shown command in their own terminal (outside Symbion — no daemon action).
       │
       ▼
6. User clicks "Kiểm tra lại kết nối" → repeat steps 2-4 (same RPC, on-demand only, no interval/poll).
```

No write/diff/publish pipeline is touched anywhere in this flow — this
confirms 10.0's "core needs zero changes" and that no backup/path-confinement
machinery is relevant here (this RPC performs zero filesystem writes; the
CLAUDE.md filesystem-safety section does not apply to this feature beyond
"don't add fs writes," which this design doesn't).

### 10.6 Edge cases — explicit disposition

| EC | Disposition |
|----|----|
| EC-1 (provider stops mid-session) | **Not solved automatically — confirmed consistent with locked decision 3.** No polling; status only updates on next mount or explicit recheck click. If Ollama dies mid-session after a successful check, the pill keeps showing stale "Đã kết nối" until the user clicks Generate (gets the inline error) or manually reopens/rechecks the panel. This is the deliberate trade-off locked in §-1.3 — flagged here, not silently accepted, per the task instructions. |
| EC-2 (remote provider) | Out of scope per locked decision 4 — `CheckProviderStatusParams.providerId` is typed as the literal `"ollama"` only; `remote`'s existing `auth` error message is untouched. No RPC call shape exists for checking remote's status in this PLAN. |
| EC-3 (OS-specific instructions / WSL ambiguity) | Solved — §10.4's `detectHostEnvironment()`, specifically the kernel-release substring check, directly covers the WSL2-on-Windows case named in STATE as the must-not-mishandle scenario. |
| EC-4 (right host/port, wrong version / model not pulled) | Explicitly out of scope per locked decision 5 — `reachable: true` is returned for ANY HTTP response from the root path, not gated on version or model presence. No `/api/tags` call exists in this design. |
| EC-5 (long model pull, no progress feedback) | N/A — no pull/install action is ever daemon-initiated in this design (guide-only, locked decision 1); nothing in this PLAN can hang on a multi-minute operation. |
| EC-6 (dismissible, never blocking) | Satisfied by construction — `ConnectProviderPanel` is a non-modal-equivalent `Dialog` scoped to one row, closable via `onClose`, and `GenerateBodyButton`'s own enable/disable logic is untouched by this feature (no new disabling condition introduced). |
| EC-7 (daemon-down vs provider-down) | Solved via the transport-vs-payload distinction in §10.3's last bullet — RPC transport failure ⇒ defer to `daemonConnected`; resolved `{reachable:false}` ⇒ provider-down messaging. No conflation possible because they are different exception/control-flow paths in the web client, not different fields of the same response. |

### 10.7 Trade-offs and assumptions (for dev / Checker to track)

- **Assumption**: Ollama's `/` root path reliably returns *some* HTTP
  response (any status) when the daemon is running, across the Ollama
  versions in practical use. This is Ollama's documented behavior
  ("Ollama is running" plaintext at `GET /`) as of this writing; if a future
  Ollama version removes/changes this endpoint, the check should be updated
  to hit a different cheap endpoint (e.g. `/api/tags` with response ignored)
  — flagged as a forward-compat note, not a blocker for v1.
- **Trade-off**: extracting `resolveOllamaBaseUrl()` out of `OllamaProvider`'s
  constructor (§10.3) is a small refactor of existing, SSRF-sensitive code.
  Alternative considered: duplicate the env/loopback logic directly in
  `providerStatus.ts`. Rejected — duplication of a security-relevant check is
  strictly worse than a one-time extraction with no behavior change; flagged
  to `security-reviewer` for a quick second look given the file it touches.
- **Trade-off**: 3000ms timeout for the status check vs. reusing
  `generate()`'s 45000ms budget. Chosen value is a UX judgment call (AC-3
  "bounded, visible"), not derived from a hard constraint — dev/QA should
  sanity-check this feels right in practice and can tune without re-opening
  this PLAN.
- **Assumption**: `os.release()`'s kernel string reliably contains
  "microsoft" or "wsl" on all WSL1/WSL2 distros Symbion users run. This is
  the standard heuristic used by Node ecosystem tools (e.g. `is-wsl` npm
  package uses the same signal) — acceptable without adding a new
  dependency for one string check.
- **Assumption**: no shared cache between `ProviderStatusPill`'s mount-check
  and `ConnectProviderPanel`'s recheck (per design doc §4) — each fires its
  own RPC call independently. Accepted for v1 simplicity; if multiple
  `GenerateBodyButton` instances render simultaneously (e.g. a list view),
  this means N independent on-mount checks. Not a problem at current scale
  (single-form builder UI), flagged for future optimization only if it
  becomes one.

## 11. BUILD (maker — completed)

Implemented exactly the PLAN in §10, no scope additions. `packages/core`
confirmed to have **zero changes** (`git status` shows no diffs under
`packages/core/`) — matches §10.0's push-back-check conclusion.

### 11.1 Files created

- `apps/daemon/src/llm/installInstructions.ts` — `detectHostEnvironment()` +
  `getOllamaInstallInstructions()`, pure, total function (never throws),
  matches §10.4 exactly including the WSL kernel-release substring heuristic
  and the macOS/Linux+WSL/Windows install-command table.
- `apps/daemon/src/llm/providerStatus.ts` — `checkOllamaReachable(baseUrl,
  timeoutMs)`: `GET {baseUrl}/` via `fetch` + `AbortController`; any HTTP
  response (even non-2xx) resolves `true`; any throw/abort resolves `false`
  (never rejects). Re-exports `resolveOllamaBaseUrl` from `ollamaProvider.ts`
  as `resolveOllamaBaseUrlForStatusCheck` per §10.3's reuse mandate.
- `apps/web/src/components/ProviderStatusPill.tsx` — S1: on-mount-once check
  (no polling), suppressed (`null`) when `providerId !== "ollama"` or
  `daemonConnected === false` (EC-7). Clicking opens `ConnectProviderPanel`.
- `apps/web/src/components/ConnectProviderPanel.tsx` — S2: reuses the
  existing `Dialog`/`DialogHeader`/`DialogTitle`/`DialogFooter`/`Button`
  primitives (no new shadcn/Radix primitive added, per §10.0's scope-creep
  watch). Fires a check once when `open` flips true (not on every re-open);
  manual "Kiểm tra lại kết nối" button re-fires; copy-to-clipboard button on
  the install command; shows a distinct daemon-down note (driven by
  `useArtifactStore().daemonConnected`) instead of a stale/misleading Ollama
  status line when the daemon itself is unreachable (EC-7/AC-4).
- `apps/daemon/test/llm-installInstructions.test.ts` — Tier B, TC-1..TC-10
  per testplan §1. **Deviation from the testplan's suggested mocking
  approach**: `vi.spyOn(os, "release")` failed at runtime
  (`TypeError: Cannot redefine property: release` — Node's ESM named-export
  bindings for `node:os` are non-configurable under this vitest/Node
  version), so I used `vi.mock("node:os", () => ({ release: () => ... }))`
  with a module-level mutable variable instead, and `await import(...)`
  inside each test body (mocks must be set up before the module under test
  is first imported in a given test file's lifecycle). Functionally
  equivalent coverage; flagging the deviation for the Checker to confirm
  this is an acceptable substitution, not a coverage gap.
- `apps/daemon/test/llm-providerStatus.test.ts` — Tier A (fake `node:http`
  server, reuses the `listenEphemeral` helper pattern from
  `llm-ollamaProvider.test.ts`, duplicated rather than extracted to a shared
  helper — see §11.3). TC-D1..TC-D5 per testplan §2. **TC-D5 deviation**: the
  testplan's literal scenario ("fake server responds, then closes the
  connection abruptly mid-response") is ambiguous about whether headers were
  already flushed; I changed it to "server resets the TCP connection before
  any HTTP response bytes are sent" (`socket.resetAndDestroy()`/`destroy()`)
  to deterministically produce a `fetch` rejection — an abrupt close *after*
  a 200 status line is sent is, per HTTP semantics, often still observable
  by `fetch` as a (possibly truncated) successful response, which would
  contradict this check's own "any HTTP response = reachable" rule (§10.3)
  and made the original scenario non-deterministic in local runs. Flagging
  for Checker: confirm this still matches the *intent* of TC-D5 (an
  unhandled-rejection regression guard), even though the literal repro step
  changed.
- `apps/daemon/test/rpc-checkProviderStatus.test.ts` — Tier C, TC-H1..TC-H6
  per testplan §3, using the same fake-HTTP-server approach as
  `rpc-generateBody.test.ts` rather than `vi.mock`-ing `providerStatus.ts`/
  `installInstructions.ts` directly (house convention in this codebase's
  existing handler tests is fake-server-over-the-wire, not handler-internals
  mocking — `rpc-generateBody.test.ts` does the same for `generateBody`).
  TC-H5 (the "does it ever throw" question) is answered by direct assertion
  against `checkOllamaReachable` with a syntactically invalid URL, documented
  explicitly per the testplan's own instruction to "pick one and assert it
  explicitly."

### 11.2 Files modified

- `apps/daemon/src/llm/ollamaProvider.ts` — extracted the env-var/loopback-
  guard/default resolution out of the constructor into an exported
  `resolveOllamaBaseUrl()` function; constructor now calls it. **Structure-
  only refactor, no behavior change** — confirmed by TC-D10/TC-D11 added to
  `llm-ollamaProvider.test.ts` (regression guard) and the full existing
  TC-D1..TC-D9 suite still passing unmodified. This touches the
  SSRF/loopback-guarded code path named in §10.3/§10.7 — flagged explicitly
  for `security-reviewer`/`/cso` per the PLAN's own instruction, even though
  it's extraction-only.
- `apps/daemon/src/rpc/handlers.ts` — added `checkProviderStatus` handler
  matching §10.2's illustrative signature exactly (runtime guard rejects any
  `providerId !== "ollama"`, including `undefined`/`null`/non-"ollama"
  strings, before calling `resolveOllamaBaseUrlForStatusCheck()`).
- `apps/daemon/src/rpc/contract.ts` — re-exports `HostEnvironment`,
  `InstallInstructions`, `CheckProviderStatusParams`,
  `CheckProviderStatusResult` from `@symbion/rpc-types`, mirroring the exact
  existing re-export pattern for every other RPC type.
- `apps/daemon/src/server.ts` — added `"checkProviderStatus"` to
  `READ_ONLY_METHODS` (conceptual label only — it makes an outbound network
  call like `generateBody`, so grouped with the same rationale comment; does
  NOT affect the token-auth requirement, which every non-`ping` method still
  enforces regardless of this set's membership, per the existing comment
  above it).
- `packages/rpc-types/src/index.ts` — added `HostEnvironment`,
  `InstallInstructions`, `CheckProviderStatusParams`,
  `CheckProviderStatusResult` interfaces (exact shapes from §10.2) and
  `"checkProviderStatus"` to the `RpcMethod` union.
- `apps/web/src/lib/rpc/types.ts` — re-exports the 4 new types, mirroring
  the existing re-export pattern (no hand-duplication).
- `apps/web/src/components/GenerateBodyButton.tsx` — renders
  `<ProviderStatusPill providerId={providerId} />` next to the `[✨]`
  button (renders `null` internally for `"remote"`, so this call site is
  unconditional/generic per §10.1's "keep prop wiring generic" note); inside
  the existing `errorCode &&` block, when
  `errorCode === "llm-provider-not-running" && providerId === "ollama"`,
  renders a new `[ Cách kết nối Ollama ]` text-button that opens a
  `ConnectProviderPanel` (the same component `ProviderStatusPill` uses
  internally — not a duplicate instance type, though each mounted instance
  has its own local `open` state per design doc §4's "no shared cache"
  note). The `remote`/`llm-auth` error path is completely untouched — no new
  conditional branch references `"remote"` or `llm-auth` anywhere in this
  diff (locked decision 4 verified by inspection).

### 11.3 Deliberately deferred / not done (in scope per PLAN, flagging for
visibility — none of these are scope additions, all are explicitly out of
scope per the locked PLAN)

- Did **not** extract `listenEphemeral` into a shared test helper across
  `llm-ollamaProvider.test.ts`, `llm-providerStatus.test.ts`, and
  `rpc-checkProviderStatus.test.ts` — duplicated the ~10-line helper 3x
  instead. Testplan §2 explicitly says "extract... if duplication is
  undesired — dev's call"; I judged 3x ~10 lines not worth a new shared
  test-utils module for this loop. Flagging for Checker/QA to override if
  they disagree.
- Did **not** add any Playwright/chrome-devtools-automated test for the web
  components — testplan §0 Tier D explicitly scopes this to "manual
  checklist," not new test infra. The M1–M13 manual scenarios in
  `connect-providers-testplan.md` §4 are **not yet executed** — that is QA's
  job in the `/qa` phase, not BUILD's.
- Did **not** touch `apps/daemon/src/llm/types.ts`, `registry.ts`, or any
  `LlmErrorCode` — confirmed zero diff in those files.
- Did **not** add a new shadcn/Radix `popover.tsx` primitive — both new web
  components reuse the existing `Dialog` exactly as §10.0 mandates.

### 11.4 Assumptions for the Checker to verify independently

1. Ollama's `GET /` root path reliably returns *some* HTTP response across
   versions in practical use (carried over from PLAN §10.7 — not something
   BUILD could verify without a real Ollama install in this sandbox).
2. `os.release()`'s kernel string reliably contains "microsoft"/"wsl" on all
   WSL1/WSL2 distros (carried over from PLAN §10.7).
3. The `vi.mock("node:os", ...)` substitution in
   `llm-installInstructions.test.ts` (see §11.1) is an acceptable equivalent
   to the testplan's suggested `vi.spyOn(os, "release")` — I could not get
   `vi.spyOn` to work against the real `node:os` module's `release` export
   in this Node/vitest version; Checker should sanity-check the mock isn't
   silently masking a real bug (e.g. by confirming `detectHostEnvironment()`
   genuinely calls the imported `release`, which it does — see
   `installInstructions.ts`'s `import { release } from "node:os"`).
4. TC-D5's repro step was changed from "abrupt close mid-response" to
   "connection reset before any response" (see §11.1) — Checker should
   confirm this still satisfies the *spirit* of testplan TC-D5 (no unhandled
   rejection / always resolves, never throws).
5. `READ_ONLY_METHODS` membership for `checkProviderStatus` is a label-only
   concern in this codebase (per the existing comment in `server.ts`) — it
   does NOT bypass the per-boot session-token requirement; every non-`ping`
   method, including this new one, still requires `x-symbion-token`. Worth
   an explicit second look since this is RPC-surface/security-adjacent.
6. I did not add a `confident: false` / multi-variant rendering smoke test
   at the React-component level (`ConnectProviderPanel`'s
   `!install.confident` branch, stacked-labeled-sections UI) — there is no
   existing component-level test harness (no React Testing Library / jsdom
   setup found in `apps/web`) for this codebase to extend, and standing one
   up was judged out of scope for this BUILD per testplan §0 Tier D's
   "manual checklist, not new test infra" framing. This UI path is only
   reachable when `detectHostEnvironment()` returns `kind: "unknown"` (i.e.
   a non-mainstream `process.platform`), which cannot happen on any of the 4
   documented host platforms — low real-world risk, but untested at the
   component level. M3/M13 in the manual testplan only exercise the
   confident (length-1 variants) path on this WSL2 dev machine.

### 11.6 Post-review fixes (code-reviewer findings, applied by maker)

Two bugs found by `/review` were fixed after the initial BUILD above. Both
are minimal, targeted edits — no other code touched.

1. **Stuck "Đang kiểm tra…" pill on daemon-reconnect**
   (`apps/web/src/components/ProviderStatusPill.tsx`). The mount-effect's
   dependency array was `[providerId]` only and early-returned without
   calling `setStatus` when `daemonConnected === false` at mount time. If the
   daemon later reconnected (heartbeat in `useArtifactStore` flips
   `daemonConnected` back to `true`), the pill re-rendered but the effect
   never re-fired, leaving the status stuck on "checking" indefinitely.
   **Fix**: added `daemonConnected` to the effect's dependency array
   (`[providerId, daemonConnected]`). This is still edge-triggered, not
   polling — the effect body is unchanged (one `callRpc` call, cleanup via
   `cancelled` flag); it now simply re-runs once on the down→up (or any)
   transition of `daemonConnected`, matching the original on-mount-once
   intent for every value the dependency takes, not literally "once ever."
2. **Shared `copied` state across multiple copy buttons**
   (`apps/web/src/components/ConnectProviderPanel.tsx`). `copied` was a
   single `boolean` for the whole panel; in the low-confidence/unknown-OS
   path (4 stacked install-command variants, each with its own copy button),
   clicking any one button's copy flipped the checkmark icon on all 4
   buttons simultaneously. **Fix**: replaced `copied: boolean` with
   `copiedLabel: string | null`, set to the clicked variant's `label` on
   copy and compared per-button (`copiedLabel === variant.label`) to decide
   whether that specific button shows the checkmark vs. the copy icon. The
   reset-after-1500ms timeout now only clears `copiedLabel` if it still
   matches the label that set it (guards against a stale timeout from an
   earlier click clearing a newer click's checkmark).

Verification after these fixes:
- `npm run build` (root) — passes, including `apps/web`'s `next build`
  type-check/lint.
- `npm run test --workspace=@symbion/daemon` — 126/126 pass (unaffected, as
  expected — both fixes are web-only, no daemon/RPC/core files touched).

No other files were modified. No self-review performed beyond confirming
build/tests pass, per process (Checker re-verifies independently).

### 11.5 Verification run by Maker (build + test only, no self-review)

- `npm run build` (root, all workspaces) — **passes**, including
  `apps/web`'s `next build` type-check/lint.
- `npm run test --workspace=@symbion/daemon` — **126/126 tests pass**,
  including all new Tier A/B/C tests above and the existing suite unmodified
  (`llm-ollamaProvider.test.ts`'s pre-existing TC-D1..TC-D9 still pass after
  the `resolveOllamaBaseUrl` extraction).
- `npm run test` at the repo root (`packages/core` + `apps/daemon`) —
  **202/202 tests pass** (76 core + 126 daemon). `apps/web` has no Vitest
  suite configured in this repo (confirmed via `npm test --workspaces`) —
  consistent with testplan §0 Tier D's "no Playwright in this codebase's
  locked stack for this feature" framing; web verification is the manual
  M1–M13 checklist, not yet run (that's `/qa`'s job).

## 12. QA (independent verification, this run)

**Overall result: PASS, with one issue flagged for triage (M6 Esc-key gap)
and several scenarios verified by code reading only (no browser automation
tool available in this run).**

### 12.1 Build / test

- `npm run build` (root, all workspaces) — **PASS**. `tsc` clean for
  `@symbion/core`, `@symbion/rpc-types`, `@symbion/daemon`; `next build`
  compiles, type-checks, lints, and statically generates all 4 routes with
  no errors.
- `npm run test` (root, full suite) — **PASS, 202/202 tests**, 23 test files,
  matching STATE §11.5's reported count exactly (76 core + 126 daemon,
  including `llm-installInstructions.test.ts` (10), `llm-providerStatus.test.ts`
  (5), `rpc-checkProviderStatus.test.ts` (7) — the three new connect-providers
  test files load and pass as part of the 126 daemon tests).

### 12.2 Live daemon + web verification

- Built daemon (`npm run build -w @symbion/daemon`), started
  `node apps/daemon/dist/index.js`, fed `3` (Hide to Tray) to the interactive
  boot menu to run headlessly. Daemon bound `127.0.0.1:20130` (auto-picked
  open port), printed a session token.
- Started `npm run dev -w @symbion/web` (Next.js dev server on port 3000).
  `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` → **200**.
  No console/server errors in dev server log; `GET / 200`.
- **Direct RPC exercise of `checkProviderStatus`** against the live daemon
  (Ollama confirmed NOT installed on this machine, per this session's earlier
  investigation):
  ```
  POST /rpc {"method":"checkProviderStatus","params":{"providerId":"ollama"}}
  → {"reachable":false,
     "checkedBaseUrl":"http://127.0.0.1:11434",
     "install":{"env":{"kind":"wsl","label":"WSL2 (Ubuntu trên Windows)"},
                "confident":true,
                "variants":[{"label":"WSL2 (Ubuntu trên Windows)",
                             "command":"curl -fsSL https://ollama.com/install.sh | sh && ollama serve"}]}}
  ```
  Confirms: (a) reachable:false on a genuinely-not-running Ollama, (b) correct
  default base URL, (c) **WSL2 correctly detected from this session's own
  kernel release string** (`6.6.87.2-microsoft-standard-WSL2`) — the exact
  EC-3 "must not mishandle this session's own combination" case — (d) single
  confident variant with the correct curl command.
- **Auth/validation exercise**:
  - `checkProviderStatus` without `x-symbion-token` header → **401
    unauthorized**, confirms the new method is NOT exempted from the
    session-token requirement despite its `READ_ONLY_METHODS` label-only
    membership (STATE §11.4 assumption #5 — confirmed correct).
  - `providerId: "remote"` → **400 invalid-params**, message
    `checkProviderStatus chỉ hỗ trợ providerId "ollama".` — matches TC-H3.
  - `providerId: null` → same 400 invalid-params — matches TC-H4.
- Cleanly stopped both background processes after verification (no leaked
  daemon/dev-server processes).

### 12.3 Acceptance criteria (§6) — verified

| AC | Verdict | Method |
|---|---|---|
| AC-1 (≤2 clicks from error to setup screen) | **PASS** | code reading — `GenerateBodyButton.tsx`'s `[ Cách kết nối Ollama ]` CTA opens `ConnectProviderPanel` in 1 click from the error state |
| AC-2 (names provider, explains, OS-correct copy-paste command) | **PASS** | live RPC (12.2) + code reading — `ConnectProviderPanel.tsx` renders the name, explainer paragraph, and `install.variants` command block |
| AC-3 (bounded, visible manual check) | **PASS** | code reading — 3000ms `AbortController` timeout in `checkOllamaReachable`; `runCheck()` sets `state:"checking"` with a spinner before resolving |
| AC-4 (daemon-down vs provider-down never conflated) | **PASS** | code reading — `daemonConnected` (transport-level) and resolved `{reachable:false}` (payload-level) drive two visibly distinct UI branches in both `ProviderStatusPill` and `ConnectProviderPanel`; confirmed these are different code paths, not different fields of one response |
| AC-5 (reachable proactively, not just after failure) | **PASS** | code reading — `ProviderStatusPill` mounts unconditionally next to the Generate button, not gated on `errorCode`. No standalone Settings page exists, but this matches the explicitly locked decision in §-1.2 ("no new standalone Settings page — reuse the existing surface") |
| AC-6 (dismiss never blocks other features) | **PASS** | code reading — `Dialog` only renders when `open`; no sibling component reads panel-open state to gate its own `disabled` |
| AC-7 (no new fs-write / no process-spawn capability) | **PASS** | `grep` of `providerStatus.ts` + `installInstructions.ts` for fs/write operations — zero matches; both are pure-data or network-GET-only |

### 12.4 Manual testplan (M1–M13) disposition

No browser-automation tool was available in this QA run (chrome-devtools not
invoked); scenarios are marked per the instruction's required distinction:

- **Verified by live exercise**: M13 (WSL2 detection — confirmed directly via
  RPC against the real daemon on this real WSL2 machine, §12.2) — partial
  live coverage of M3 (confirmed the exact payload the panel would render).
- **Verified by code reading only** (reasoned correct, not click-tested):
  M1, M2, M3 (visual open/close), M4, M5, M7, M8, M9, M10, M11, M12.
  Code for all of these matches the testplan's expected behavior exactly —
  no discrepancy found except M6 below.
- **ISSUE FOUND — M6 (Esc-key dismissal) does NOT match code**:
  `apps/web/src/components/ui/dialog.tsx` (the shared `Dialog` primitive used
  by `ConnectProviderPanel` and both other dialogs in `GenerateBodyButton.tsx`)
  has **no keydown/Escape listener anywhere** (confirmed via
  `grep -rn "Escape|keydown|onKeyDown" apps/web/src/components/` — zero
  matches in the whole component tree). Click-outside (backdrop `onClick`)
  and the "Đóng" button both correctly call `onClose`, but **pressing Esc
  will not close the panel** as M6 expects. This is a real gap between the
  testplan's expectation and the shipped code — not fixed in this QA pass
  per instructions (QA reports, does not fix). Needs a build-phase decision:
  either add an `Escape` keydown handler to the shared `Dialog` primitive
  (affects all 3 dialogs project-wide, low risk, small change) or amend the
  testplan to drop the Esc-key expectation if it was never actually in scope
  for this `Dialog` primitive's original design.

### 12.5 Other observations for the record

- Test count and build output exactly match what BUILD (§11.5) reported —
  no drift between BUILD's self-reported verification and this independent
  QA run.
- `READ_ONLY_METHODS` membership for `checkProviderStatus` does NOT bypass
  the token requirement — independently confirmed live (12.2), resolving
  BUILD's flagged assumption #5 (§11.4) as correct.
- No filesystem writes observed or possible in this feature's code paths —
  AC-7 and the CLAUDE.md filesystem-safety section are not implicated by this
  feature beyond "stayed read-only," which it does.

### 12.6 QA verdict

**PASS** for AC-1 through AC-7. **One actionable gap found**: M6's Esc-key
dismissal is not implemented anywhere in the shared `Dialog` primitive.
Recommend a small follow-up build step (add an `Escape` keydown handler to
`apps/web/src/components/ui/dialog.tsx`) before `/ship`, or an explicit
product decision to drop that specific manual-testplan expectation. All
other findings are clean — no regressions, no security-relevant issues found
beyond what BUILD already flagged to `security-reviewer` (the
`resolveOllamaBaseUrl` extraction), which is unchanged by this QA pass.

