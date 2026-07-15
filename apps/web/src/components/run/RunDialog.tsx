"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CanonicalArtifact } from "@symbion/core";
import type { PreflightCheck, RunPreflightResult } from "@symbion/rpc-types";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DaemonRpcError } from "@/lib/rpc/client";
import { useRunStore } from "@/lib/run/useRunStore";
import { PreflightStrip } from "./PreflightStrip";

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
  const preflight = useRunStore((s) => s.preflight);
  const startRun = useRunStore((s) => s.startRun);

  const [requirement, setRequirement] = useState(lastRequirement ?? "");
  const [model, setModel] = useState("");
  const [showModel, setShowModel] = useState(false);
  const [ackChecked, setAckChecked] = useState(false);
  const [result, setResult] = useState<RunPreflightResult | "loading">("loading");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreflight = useCallback(async () => {
    setResult("loading");
    try {
      const r = await preflight(projectId, command.id);
      setResult(r);
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

  const blocked = result !== "loading" && result.blocked;
  const needsAck = result !== "loading" && result.needsFirstRunAck;
  const hasWarn = result !== "loading" && result.checks.some((c: PreflightCheck) => c.severity === "warn");
  const nonce = result !== "loading" ? result.consentNonce : undefined;
  const permissionCwd = result !== "loading" ? result.permissionSummary.cwd : "";
  const permissionMode = result !== "loading" ? result.permissionSummary.mode : "";

  const canExecute =
    requirement.trim().length > 0 && !blocked && !!nonce && (!needsAck || ackChecked) && !starting;

  async function handleExecute() {
    if (!canExecute || !nonce) return;
    setStarting(true);
    setError(null);
    try {
      const res = await startRun({
        projectId,
        artifactId: command.id,
        requirement: requirement.trim(),
        model: showModel && model.trim().length > 0 ? model.trim() : undefined,
        nonce,
        ackFirstRun: needsAck ? true : undefined,
      });
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
    <Dialog open onClose={onClose} className="w-[560px]">
      <DialogHeader>
        <DialogTitle>
          Execute /{command.name} — {projectName}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-3" onKeyDown={onKeyDown}>
        <div>
          <label className="mb-1 block text-xs text-text-muted">Requirement ($ARGUMENTS)</label>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <Input
            autoFocus
            placeholder="e.g. Add rate limiting to the public API"
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>

        <button
          type="button"
          className="text-xs text-text-muted hover:text-text-body"
          onClick={() => setShowModel((v) => !v)}
        >
          {showModel ? "▾" : "▸"} Model override (optional)
        </button>
        {showModel && (
          <Input placeholder="model id (optional)" value={model} onChange={(e) => setModel(e.target.value)} />
        )}

        {result !== "loading" && result.invocationEcho && (
          <div>
            <p className="mb-1 text-xs text-text-muted">Will run</p>
            <div className="rounded-panel border border-border-input bg-bg-code p-2">
              <code className="select-all break-all text-[11px] text-text-body">{result.invocationEcho}</code>
            </div>
          </div>
        )}

        {result !== "loading" && result.lastRun && result.lastRun.endedAt && (
          <p className="text-xs text-text-muted">
            Last run: {result.lastRun.status}
            {result.lastRun.durationMs != null ? ` · ${Math.round(result.lastRun.durationMs / 1000)}s` : ""}
            {result.lastRun.costUsd != null ? ` · ~$${result.lastRun.costUsd.toFixed(2)}` : ""}
          </p>
        )}

        <div>
          <p className="mb-1 text-xs text-text-muted">Preflight</p>
          <PreflightStrip result={result} onAction={handleAction} />
        </div>

        {result !== "loading" && result.permissionSummary.sentence && (
          <p className="rounded-panel border border-border-hairline bg-bg-panel p-2 text-xs text-text-body">
            ⓘ {result.permissionSummary.sentence}
          </p>
        )}

        {needsAck && (
          <div className="rounded-panel border border-warning/40 bg-warning/10 p-3">
            <p className="text-xs font-semibold text-warning">⚠ FIRST RUN IN THIS PROJECT</p>
            <p className="mt-1 text-xs text-text-body">
              Symbion will launch an AI agent in {permissionCwd}. With mode {permissionMode} it can create and
              modify files there without asking. Symbion&apos;s diff-preview does NOT apply to what the agent
              writes. You can cancel the run at any time.
            </p>
            <label className="mt-2 flex items-center gap-2 text-xs text-text-body">
              <Checkbox checked={ackChecked} onChange={(e) => setAckChecked(e.target.checked)} />
              I understand the agent may modify files in {permissionCwd || "this project"}
            </label>
          </div>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleExecute} disabled={!canExecute}>
          {starting ? "⟳ Starting…" : hasWarn && !blocked ? "▶ Execute anyway" : "▶ Execute"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
