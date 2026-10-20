"use client";

import { Loader2, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { extractAgentMentions, type CanonicalArtifact } from "@symbion/core";
import type { PreflightCheck, RunPreflightResult } from "@symbion/rpc-types";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DaemonRpcError } from "@/lib/rpc/client";
import { useRunStore } from "@/lib/run/useRunStore";
import { PreflightStrip } from "./PreflightStrip";
import { AttachmentChips } from "./AttachmentChips";
import { useAttachmentComposer } from "./useAttachmentComposer";

export interface RunDialogProps {
  command: CanonicalArtifact;
  projectId: string;
  projectName: string;
  /** last requirement (pre-filled + selected, design §3.2/L3). */
  lastRequirement?: string;
  onClose: () => void;
  onStarted: (runId: string) => void;
  /** open the publish flow for the "Publish first →" action (AC-RUN-13). */
  onPublish?: () => void;
  /** bumps whenever the (sibling-owned) Publish dialog closes — triggers a
   *  fresh runPreflight so a successful inline publish auto-unblocks the
   *  dialog without a manual close/reopen (Defect 3 fix, QA J7). */
  publishDialogClosedSignal?: number;
}

/**
 * RunDialog — compose + preflight + consent + confirm (one dialog, never a
 * wizard). Handles all R2/R2a/R2b variants (happy, first-run ack, draft-blocked,
 * warn-and-allow). Calls runPreflight on open, then startRun with the daemon-
 * minted nonce (Flaw F1 — the UI never mints the nonce).
 */
export function RunDialog({
  command,
  projectId,
  projectName,
  lastRequirement,
  onClose,
  onStarted,
  onPublish,
  publishDialogClosedSignal,
}: RunDialogProps) {
  const router = useRouter();
  const preflight = useRunStore((s) => s.preflight);
  const startRun = useRunStore((s) => s.startRun);

  const [requirement, setRequirement] = useState(lastRequirement ?? "");
  const [model, setModel] = useState("");
  const [showModel, setShowModel] = useState(false);
  const [ackChecked, setAckChecked] = useState(false);
  const [result, setResult] = useState<RunPreflightResult | "loading">("loading");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** signature of the image set the held `result`/nonce was minted for (run-image-paste consent binding). */
  const [consentSig, setConsentSig] = useState("");
  const refreshReq = useRef(0);

  const attachmentSupport = result !== "loading" ? result.attachmentSupport : undefined;
  const attachmentsSupported = attachmentSupport?.supported === true;
  const composer = useAttachmentComposer({
    supported: attachmentsSupported,
    unsupportedReason: attachmentSupport?.reason,
  });
  // Stable accessors (the hook returns fresh closures only when it re-renders; refs keep loadPreflight stable).
  const composerRef = useRef(composer);
  composerRef.current = composer;

  const loadPreflight = useCallback(async () => {
    setResult("loading");
    try {
      const atts = composerRef.current.getPreflightAttachments();
      const sigAtCall = atts.map((a) => `${a.sha256}:${a.size}:${a.mediaType}`).join("|");
      const r = await preflight(projectId, command.id, atts);
      setResult(r);
      setConsentSig(sigAtCall);
      // Pre-fill + select the requirement from the last run (design §3.2 L3),
      // once, iff the user hasn't already typed something (never clobber
      // in-progress input on a later re-fetch, e.g. after the inline Publish
      // flow's re-preflight — Defect 3's fix). Functional update so this
      // callback's identity doesn't depend on `requirement` (would otherwise
      // re-trigger the mount-effect's fetch on every keystroke).
      const lastRequirementValue = r.lastRun?.requirement;
      if (lastRequirementValue) {
        setRequirement((prev) => (prev.length === 0 ? lastRequirementValue : prev));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preflight failed.");
      setResult({
        checks: [{ id: "err", severity: "block", label: "Preflight failed — retry." }],
        blocked: true,
        needsFirstRunAck: false,
        invocationEcho: "",
        permissionSummary: { mode: "", cwd: "", ceilings: { wallClockMs: 0, tokenCap: 0 }, sentence: "" },
        attachmentSupport: { supported: false, minCliVersion: "" },
      });
    }
  }, [preflight, projectId, command.id]);

  useEffect(() => {
    void loadPreflight();
  }, [loadPreflight]);

  // Defect 3 fix: re-run preflight when the sibling-owned Publish dialog
  // closes (the "Publish first →" action, AC-RUN-13). Skip the initial mount
  // (undefined -> first value is not a "close" event) so this never double-
  // fetches alongside the effect above.
  const publishSignalMounted = useRef(false);
  useEffect(() => {
    if (publishDialogClosedSignal === undefined) return;
    if (!publishSignalMounted.current) {
      publishSignalMounted.current = true;
      return;
    }
    void loadPreflight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishDialogClosedSignal]);

  // Consent refresh: when the settled image set changes, re-run preflight WITH the
  // image metadata so the nonce is bound to the exact bytes (debounced; the strip keeps
  // its previous checks — no "loading" flicker — and Execute waits for the new nonce).
  const sig = composer.signature;
  useEffect(() => {
    if (sig === null || result === "loading" || sig === consentSig) return;
    const t = setTimeout(async () => {
      const mine = ++refreshReq.current;
      try {
        const r = await preflight(projectId, command.id, composerRef.current.getPreflightAttachments());
        if (mine !== refreshReq.current) return; // a newer change superseded this response
        setResult(r);
        setConsentSig(sig);
      } catch (err) {
        if (mine !== refreshReq.current) return;
        setError(err instanceof Error ? err.message : "Preflight failed.");
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, consentSig, result === "loading"]);

  const preparing = composer.signature === null || composer.signature !== consentSig;
  const blocked = result !== "loading" && result.blocked;
  const needsAck = result !== "loading" && result.needsFirstRunAck;
  const hasWarn = result !== "loading" && result.checks.some((c: PreflightCheck) => c.severity === "warn");
  const nonce = result !== "loading" ? result.consentNonce : undefined;
  const permissionCwd = result !== "loading" ? result.permissionSummary.cwd : "";
  const permissionMode = result !== "loading" ? result.permissionSummary.mode : "";

  const canExecute =
    requirement.trim().length > 0 && !blocked && !!nonce && !preparing && (!needsAck || ackChecked) && !starting;

  async function handleExecute() {
    if (!canExecute || !nonce) return;
    setStarting(true);
    setError(null);
    try {
      // P2: the agent names reachable from THIS command (by @mention) — the
      // same set the daemon resolves independently at startRun time (STATE
      // §13.1) — passed to the store so its fold-rollup can attribute agent
      // buckets without a second graph traversal at attach() time.
      const agentSubagentNames = new Set(extractAgentMentions(command.body));
      const res = await startRun(
        {
          projectId,
          artifactId: command.id,
          requirement: requirement.trim(),
          model: showModel && model.trim().length > 0 ? model.trim() : undefined,
          nonce,
          ackFirstRun: needsAck ? true : undefined,
          ...(composer.chips.length > 0 ? { attachments: composer.getSendAttachments() } : {}),
        },
        agentSubagentNames
      );
      onStarted(res.runId);
      onClose();
    } catch (err) {
      const message = err instanceof DaemonRpcError ? err.message : "Failed to start the run.";
      setError(message);
      setStarting(false);
      // A consumed/expired nonce → re-run preflight to mint a fresh one.
      void loadPreflight();
    }
  }

  function handleAction(kind: NonNullable<PreflightCheck["action"]>["kind"]) {
    if (kind === "publish") onPublish?.();
    else if (kind === "recheck" || kind === "install" || kind === "settings") void loadPreflight();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleExecute();
    }
  }

  return (
    <Dialog open onClose={onClose} className="relative w-[560px]">
      <DialogHeader>
        <DialogTitle>
          Execute /{command.name} — {projectName}
        </DialogTitle>
      </DialogHeader>

      {composer.dragging && (
        <div
          role="presentation"
          data-testid="attachment-drop-overlay"
          onDragOver={(e) => e.preventDefault()}
          onDrop={composer.onDrop}
          className="absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-mint bg-surface text-ui text-ink"
        >
          Drop images to attach
        </div>
      )}

      <div className="space-y-3" onKeyDown={onKeyDown} onPaste={composer.onPaste}>
        <div>
          <label className="mb-1 block text-caption text-ink-muted">Requirement ($ARGUMENTS)</label>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <Input
            autoFocus
            placeholder="e.g. Add rate limiting to the public API"
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>

        <AttachmentChips
          chips={composer.chips}
          errors={composer.errors}
          hint={composer.hint}
          totalBytes={composer.totalBytes}
          supported={attachmentsSupported}
          unsupportedReason={attachmentSupport?.reason}
          onPickFiles={(files) => void composer.addFiles(files)}
          onRemove={composer.remove}
        />

        <button
          type="button"
          className="text-caption text-ink-muted hover:text-ink"
          onClick={() => setShowModel((v) => !v)}
        >
          {showModel ? "▾" : "▸"} Model override (optional)
        </button>
        {showModel && (
          <Input placeholder="model id (optional)" value={model} onChange={(e) => setModel(e.target.value)} />
        )}

        {result !== "loading" && result.invocationEcho && (
          <div>
            <p className="mb-1 text-caption text-ink-muted">Will run</p>
            <div className="rounded-lg border border-line bg-sidebar p-3">
              <code className="select-all break-all font-mono text-code-sm text-ink">{result.invocationEcho}</code>
            </div>
          </div>
        )}

        {result !== "loading" && result.lastRun && result.lastRun.endedAt && (
          <p className="text-caption text-ink-muted">
            Last run: {result.lastRun.status}
            {result.lastRun.durationMs != null ? ` · ${Math.round(result.lastRun.durationMs / 1000)}s` : ""}
            {result.lastRun.costUsd != null ? ` · ~$${result.lastRun.costUsd.toFixed(2)}` : ""}
          </p>
        )}

        <div>
          <p className="mb-1 text-caption text-ink-muted">Preflight</p>
          <PreflightStrip result={result} onAction={handleAction} />
        </div>

        {result !== "loading" && result.permissionSummary.sentence && (
          <p className="rounded-lg border border-line bg-app p-2 text-caption text-ink">
            ⓘ {result.permissionSummary.sentence}
            {result.permissionSummary.attachmentsSentence ? ` ${result.permissionSummary.attachmentsSentence}` : ""}{" "}
            {/* F-P3-1 (P3): the consent line's [change] link — the design doc's
             *  R2 wireframe (§3.2) always specified this, but P1/P2 never
             *  built the placeholder (unlike RunSummarySection's inert
             *  [Adjust ceilings], which WAS built on schedule). Navigates to
             *  the same Settings→Execution destination R7's editor lives at. */}
            <button
              type="button"
              className="underline decoration-dotted hover:text-ink"
              onClick={() => router.push(`/settings?project=${encodeURIComponent(projectId)}#execution`)}
            >
              [change]
            </button>
          </p>
        )}

        {needsAck && (
          <div className="rounded-lg border border-warning bg-warning-soft p-3">
            <p className="text-caption font-semibold text-warning">⚠ FIRST RUN IN THIS PROJECT</p>
            <p className="mt-1 text-caption text-ink">
              Symbion will launch an AI agent in {permissionCwd}. With mode {permissionMode} it can create and
              modify files there without asking. Symbion&apos;s diff-preview does NOT apply to what the agent
              writes. You can cancel the run at any time.
            </p>
            <label className="mt-2 flex items-center gap-2 text-caption text-ink">
              <Checkbox checked={ackChecked} onChange={(e) => setAckChecked(e.target.checked)} />
              I understand the agent may modify files in {permissionCwd || "this project"}
            </label>
          </div>
        )}

        {error && <p className="text-caption text-danger-text">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="lg" icon={starting ? Loader2 : Play} onClick={handleExecute} disabled={!canExecute}>
          {starting ? "Starting…" : preparing && composer.chips.length > 0 ? "Preparing images…" : hasWarn && !blocked ? "Execute anyway" : "Execute"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
