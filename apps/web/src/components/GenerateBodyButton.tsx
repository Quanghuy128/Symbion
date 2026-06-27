"use client";

import { useRef, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { callRpc, DaemonRpcError } from "@/lib/rpc/client";
import type { GenerateBodyParams, GenerateBodyResult } from "@/lib/rpc/types";
import { useArtifactStore } from "@/lib/store/useArtifactStore";
import { GENERATE_BODY_DISCLOSURE_FLAG_KEY, firstUseDisclosureCopy } from "@/components/GenerateBodyDisclosure";
import { ProviderStatusPill } from "@/components/ProviderStatusPill";
import { ConnectProviderPanel } from "@/components/ConnectProviderPanel";

/** Cooldown window (ms) after a generate call resolves (success or error), independent of
 * the in-flight busyRef guard — blunts accidental rapid-fire clicking (STATE §9 Q12). */
const COOLDOWN_MS = 4000;

/** EC-4's exact error-code -> human-readable Vietnamese message taxonomy (STATE §10.5). */
const ERROR_MESSAGES: Record<string, string> = {
  "llm-provider-not-running": "Không thể kết nối tới Ollama — đảm bảo Ollama đang chạy trên máy.",
  "llm-timeout": "Quá thời gian chờ (45s) — thử lại.",
  "llm-auth": "Thiếu hoặc sai cấu hình API key cho remote provider.",
  "llm-rate-limit": "Bị giới hạn tần suất gọi — thử lại sau.",
  "llm-invalid-response": "Phản hồi không hợp lệ từ mô hình.",
};
const DEFAULT_ERROR_MESSAGE = "Lỗi không xác định, thử lại.";

export interface GenerateBodyButtonProps {
  kind: "agent" | "command";
  name: string;
  description: string;
  currentBody: string;
  modelId: string;
  providerId: "ollama" | "remote";
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
  const [connectPanelOpen, setConnectPanelOpen] = useState(false);

  // Captures the exact params of the last attempt, so Retry re-submits identically
  // (EC-3) without requiring the user to re-open the model picker.
  const lastParamsRef = useRef<GenerateBodyParams | null>(null);

  function startCooldown() {
    setCooldown(true);
    setTimeout(() => setCooldown(false), COOLDOWN_MS);
  }

  async function fireRequest() {
    if (busyRef.current) return; // EC-5 in-flight re-entrancy guard
    busyRef.current = true;
    setBusy(true);
    setErrorCode(null);

    const params: GenerateBodyParams = { kind, name, description, existingBody: currentBody, modelId, providerId };
    lastParamsRef.current = params;

    try {
      const result = await callRpc<GenerateBodyParams, GenerateBodyResult>("generateBody", params);
      onApply(result.body);
      setErrorCode(null);
    } catch (err) {
      if (err instanceof DaemonRpcError) {
        setErrorCode(err.code);
      } else {
        setErrorCode("llm-unknown");
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
    if (busyRef.current || cooldown) return;
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
    void fireRequest();
  }

  const disabled = busy || cooldown || !daemonConnected; // EC-8 daemon-connectivity gate

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Tạo nội dung bằng AI"
        title={!daemonConnected ? "Daemon mất kết nối" : "Tạo nội dung bằng AI"}
        disabled={disabled}
        onClick={handleClick}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      </Button>

      <ProviderStatusPill providerId={providerId} />

      {errorCode && (
        <div className="mt-1 flex items-center gap-2 text-xs text-destructive">
          <span>{ERROR_MESSAGES[errorCode] ?? DEFAULT_ERROR_MESSAGE}</span>
          {errorCode === "llm-timeout" && (
            <button type="button" className="underline" onClick={handleRetry} disabled={busy || cooldown}>
              Thử lại
            </button>
          )}
          {/* EC-7/AC-4: this CTA only opens when an Ollama-specific failure was resolved
           *  by the RPC (errorCode === llm-provider-not-running) — never for the daemon-down
           *  case, which is a different code path (disabled-button state above), and never
           *  for "remote"'s llm-auth, which keeps its existing message unchanged per locked
           *  decision 4 (no new UI for remote in v1). */}
          {errorCode === "llm-provider-not-running" && providerId === "ollama" && (
            <button type="button" className="underline" onClick={() => setConnectPanelOpen(true)}>
              Cách kết nối Ollama
            </button>
          )}
        </div>
      )}

      {providerId === "ollama" && (
        <ConnectProviderPanel
          providerId="ollama"
          open={connectPanelOpen}
          onClose={() => setConnectPanelOpen(false)}
        />
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogHeader>
          <DialogTitle>Thay thế nội dung?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Nội dung hiện tại sẽ được thay thế bằng nội dung do AI tạo ra — tiếp tục?
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmOpen(false)}>
            Hủy
          </Button>
          <Button onClick={handleConfirmReplace}>Thay thế</Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={disclosureOpen} onClose={dismissDisclosure}>
        <DialogHeader>
          <DialogTitle>Sử dụng AI để tạo nội dung</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{firstUseDisclosureCopy(providerId)}</p>
        <DialogFooter>
          <Button onClick={handleDisclosureAck}>Đã hiểu</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
