"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { callRpc, DaemonRpcError } from "@/lib/rpc/client";
import type { GenerateBodyParams, GenerateBodyResult, ProviderId } from "@/lib/rpc/types";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { GENERATE_BODY_DISCLOSURE_FLAG_KEY, firstUseDisclosureCopy } from "@/components/GenerateBodyDisclosure";
import { ProviderStatusPill } from "@/components/ProviderStatusPill";

/** Cooldown window (ms) after a generate call resolves (success or error), independent of
 * the in-flight busyRef guard — blunts accidental rapid-fire clicking (STATE §9 Q12). */
const COOLDOWN_MS = 4000;

/** EC-4's exact error-code -> human-readable Vietnamese message taxonomy (STATE §10.5),
 * generalized per docs/loops/multi-provider-settings-STATE.md §4d/§5 with the new
 * "llm-not-configured" code. Used as a fallback only — the daemon's own RpcError message
 * (surfaced via DaemonRpcError.message) is preferred when present, since for some codes
 * (e.g. "llm-invalid-response") the daemon's message carries extra, useful detail this
 * generic map would otherwise discard (see docs/learnings.md "Generate Body 404 loop"). */
const ERROR_MESSAGES: Record<string, string> = {
  "llm-provider-not-running": "Cannot connect to Ollama — make sure Ollama is running on your machine.",
  "llm-timeout": "Request timed out (45s) — try again.",
  "llm-auth": "Missing or invalid API key for the AI provider.",
  "llm-rate-limit": "Rate-limited — try again later.",
  "llm-invalid-response": "Invalid response from the model.",
  "llm-not-configured": "No AI provider configured — go to Settings to add one.",
};
const DEFAULT_ERROR_MESSAGE = "Unknown error, please try again.";

/** Error codes for which the CTA links to /settings — generalized from the old
 * Ollama-specific "Cách kết nối Ollama" link (STATE §3.2/§4d). */
const SETTINGS_CTA_CODES = new Set(["llm-provider-not-running", "llm-not-configured", "llm-auth"]);

export interface GenerateBodyButtonProps {
  kind: "agent" | "command";
  name: string;
  description: string;
  currentBody: string;
  modelId: string;
  /** null means no provider is configured/active yet (STATE §5's distinct "no provider
   *  selected" state) — the button is disabled with a dedicated message in that case. */
  providerId: ProviderId | null;
  onApply: (value: string) => void;
}

/**
 * GenerateBodyButton — replaces GenerateDescriptionButton as the body-field
 * affordance (different props/async contract/confirm-copy/disclosure — NOT a
 * rename/reuse of the same component). Fires a real generateBody RPC call;
 * confirm-before-replace happens BEFORE the call per EC-2's sequencing
 * requirement (never generate-then-ask).
 */
export function GenerateBodyButton({
  kind,
  name,
  description,
  currentBody,
  modelId,
  providerId,
  onApply,
}: GenerateBodyButtonProps) {
  const daemonConnected = useArtifactStore((s) => s.daemonConnected);

  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // The daemon's own RpcError message, preferred over the generic ERROR_MESSAGES
  // fallback when present and non-empty (see ERROR_MESSAGES doc comment above).
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Captures the exact params of the last attempt, so Retry re-submits identically
  // (EC-3) without requiring the user to re-open the model picker.
  const lastParamsRef = useRef<GenerateBodyParams | null>(null);

  function startCooldown() {
    setCooldown(true);
    setTimeout(() => setCooldown(false), COOLDOWN_MS);
  }

  async function fireRequest() {
    if (busyRef.current) return; // EC-5 in-flight re-entrancy guard
    if (!providerId) return; // no provider configured/active — nothing to call
    busyRef.current = true;
    setBusy(true);
    setErrorCode(null);
    setErrorMessage(null);

    const params: GenerateBodyParams = { kind, name, description, existingBody: currentBody, modelId, providerId };
    lastParamsRef.current = params;

    try {
      const result = await callRpc<GenerateBodyParams, GenerateBodyResult>("generateBody", params);
      onApply(result.body);
      setErrorCode(null);
      setErrorMessage(null);
    } catch (err) {
      if (err instanceof DaemonRpcError) {
        setErrorCode(err.code);
        setErrorMessage(err.message || null);
      } else {
        setErrorCode("llm-unknown");
        setErrorMessage(null);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      startCooldown(); // EC-5 post-resolve cooldown guard, independent of busyRef
    }
  }

  /** Has the one-time first-use disclosure already been acknowledged in this browser? */
  function hasSeenDisclosure(): boolean {
    try {
      return window.localStorage.getItem(GENERATE_BODY_DISCLOSURE_FLAG_KEY) !== null;
    } catch {
      // localStorage unavailable (e.g. privacy mode) — fail closed, treat as "not seen"
      // so the dialog is shown rather than silently skipped.
      return false;
    }
  }

  function dismissDisclosure() {
    try {
      window.localStorage.setItem(GENERATE_BODY_DISCLOSURE_FLAG_KEY, "1");
    } catch {
      // non-fatal if the write fails
    }
    setDisclosureOpen(false);
  }

  /** The actual "proceed toward generation" step, run after the first-use disclosure
   * (if any) has been acknowledged: either confirm-before-replace (EC-2) or straight
   * to the RPC call when Nội dung is empty. */
  function proceedToGenerate() {
    if (currentBody.trim() === "") {
      void fireRequest();
    } else {
      setConfirmOpen(true); // EC-2: confirm fires BEFORE the RPC call
    }
  }

  function handleClick() {
    if (busyRef.current || cooldown || !providerId) return;
    if (!hasSeenDisclosure()) {
      setDisclosureOpen(true); // first-ever click in this browser -> one-time disclosure first
      return;
    }
    proceedToGenerate();
  }

  function handleDisclosureAck() {
    dismissDisclosure();
    proceedToGenerate();
  }

  function handleConfirmReplace() {
    setConfirmOpen(false);
    void fireRequest();
  }

  function handleRetry() {
    setErrorCode(null);
    setErrorMessage(null);
    void fireRequest();
  }

  // EC-8 daemon-connectivity gate, generalized with the new "no provider configured" gate
  // (STATE §5 — distinct from the daemon-down state, never silently treated the same way).
  const disabled = busy || cooldown || !daemonConnected || !providerId;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Generate content with AI"
        title={
          !daemonConnected
            ? "Daemon disconnected"
            : !providerId
              ? "No AI provider selected — go to Settings to choose one"
              : "Generate content with AI"
        }
        disabled={disabled}
        onClick={handleClick}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      </Button>

      <ProviderStatusPill providerId={providerId} />

      {!providerId && daemonConnected && (
        <p className="mt-1 text-xs text-text-muted">
          No AI provider selected —{" "}
          <Link href="/settings" className="underline">
            go to Settings to choose one
          </Link>
          .
        </p>
      )}

      {errorCode && (
        <div className="mt-1 flex items-center gap-2 text-xs text-danger">
          <span>{errorMessage || ERROR_MESSAGES[errorCode] || DEFAULT_ERROR_MESSAGE}</span>
          {errorCode === "llm-timeout" && (
            <button type="button" className="underline" onClick={handleRetry} disabled={busy || cooldown}>
              Retry
            </button>
          )}
          {/* Generalized from the old Ollama-specific "Cách kết nối Ollama" CTA: any
           *  provider-connectivity/auth/not-configured failure now links to the
           *  provider-agnostic Settings page (STATE §3.2/§4d). */}
          {SETTINGS_CTA_CODES.has(errorCode) && (
            <Link href="/settings" className="underline">
              Open provider settings
            </Link>
          )}
        </div>
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogHeader>
          <DialogTitle>Replace content?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-text-muted">
          The current content will be replaced with AI-generated content — continue?
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirmReplace}>Replace</Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={disclosureOpen} onClose={dismissDisclosure}>
        <DialogHeader>
          <DialogTitle>Use AI to generate content</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-text-muted">{firstUseDisclosureCopy(providerId)}</p>
        <DialogFooter>
          <Button onClick={handleDisclosureAck}>Got it</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
