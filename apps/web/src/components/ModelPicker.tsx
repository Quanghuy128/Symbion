"use client";

import { useEffect, useState } from "react";
import { callRpc, DaemonRpcError } from "@/lib/rpc/client";
import type { ListModelsOutcome, ListModelsParams, ListModelsResult, LlmModelOption, ProviderId } from "@/lib/rpc/types";
import { Tooltip } from "@/components/ui/tooltip";

export interface ModelPickerProps {
  providerId: ProviderId | null;
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

const TIER_LABEL: Record<NonNullable<LlmModelOption["tier"]>, string> = {
  fast: "Nhanh",
  balanced: "Balanced",
  best: "Best",
};

/** Example-only suggested tag shown in the empty-state's `ollama pull` command — small,
 *  fast-to-pull, broadly available. Never offered as a selectable `<option>` (STATE
 *  §6.6) — purely copy text, not a re-introduction of the old "3 hardcoded choices"
 *  pattern. A content decision, not an architecture one (same framing as the old
 *  OLLAMA_MODELS constant's own doc-comment, per docs/loops/ollama-dynamic-models-STATE.md §9.5). */
const SUGGESTED_PULL_TAG = "llama3.2:1b";
const SUGGESTED_PULL_COMMAND = `ollama pull ${SUGGESTED_PULL_TAG}`;

/**
 * ModelPicker — fetches a provider's model list via the `listModels` RPC on mount
 * (single source of truth — no hand-duplicated constant in apps/web, per the locked
 * amendment to STATE §10.7 Risk R1). Selection is per-click, not persisted (STATE §9
 * Q2/Q3/Q9 of multi-provider-settings-STATE.md).
 *
 * Renders one of 4 distinct states, per docs/loops/ollama-dynamic-models-STATE.md §6.6:
 * 1. `loadError` set (unreachable / thrown RpcError, e.g. Ollama not running) — existing
 *    destructive-text render, unchanged.
 * 2. `outcome === "fetch-failed"` — Ollama reachable but `/api/tags` itself failed
 *    (malformed JSON / non-2xx) — a distinct destructive-text render, no disabled
 *    `<select>` underneath.
 * 3. `outcome === "empty"` — Ollama reachable, zero models pulled. Previously an
 *    always-visible inline banner (empty-state block + `ollama pull <tag>` snippet +
 *    Copy button); per symbion-dark-redesign fix 3 this is now a disabled `<select>`
 *    with a `border-danger` outline and a hover/focus `Tooltip` carrying the exact
 *    same message + pull command (no information lost, just moved on-demand).
 * 4. `outcome === "ok"` — populated `<select>`, unchanged structurally except an
 *    optional-tier render guard (no "(undefined)" / crash for tierless entries).
 */
export function ModelPicker({ providerId, value, onChange, disabled }: ModelPickerProps) {
  const [models, setModels] = useState<LlmModelOption[]>([]);
  const [outcome, setOutcome] = useState<ListModelsOutcome | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!providerId) {
      setModels([]);
      setOutcome(null);
      setErrorDetail(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    callRpc<ListModelsParams, ListModelsResult>("listModels", { providerId })
      .then((result) => {
        if (cancelled) return;
        setModels(result.models);
        setOutcome(result.outcome);
        setErrorDetail(result.errorMessage ?? null);
        setLoadError(null);
        // Default to the first model if nothing selected yet.
        if (!value && result.models.length > 0) {
          onChange(result.models[0]!.id);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // unchanged: covers provider-not-running (thrown RpcError) and any other
        // transport-level failure — same generic message as today, AC4 unregressed.
        setLoadError(
          err instanceof DaemonRpcError ? err.message || "Could not load the model list." : "Could not load the model list."
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  if (!providerId) {
    return <span className="text-xs text-text-muted">No AI provider selected</span>;
  }

  // Branch 1: unreachable / thrown RpcError — unchanged.
  if (loadError) {
    return <span className="text-xs text-danger">{loadError}</span>;
  }

  // Branch 2: reachable, but /api/tags itself failed.
  if (outcome === "fetch-failed") {
    return (
      <span className="text-xs text-danger">
        {errorDetail || "Could not fetch the model list from Ollama."}
      </span>
    );
  }

  // Branch 3: reachable, zero models pulled. Previously an always-visible inline
  // banner; now a red-outlined disabled <select> with the same message + pull
  // command surfaced on-demand via a hover/focus Tooltip (no info lost).
  if (outcome === "empty") {
    return (
      <Tooltip
        content={
          <span className="flex flex-col gap-1">
            <span>No models are loaded in Ollama yet. Run the command below, then come back here:</span>
            <code className="select-all rounded-sm border border-border-input bg-bg-code px-2 py-1 text-text-body">
              {SUGGESTED_PULL_COMMAND}
            </code>
          </span>
        }
      >
        {/* tabIndex on this span (rather than the disabled <select>, which cannot
            receive focus) keeps the tooltip reachable via keyboard (Tab). */}
        <span tabIndex={0} className="inline-flex">
          <select
            aria-label="Select AI model"
            title={`No models are loaded in Ollama yet. Run the command below, then come back here: ${SUGGESTED_PULL_COMMAND}`}
            className="h-8 rounded-sm border border-danger bg-bg-input px-2 text-xs text-text-body focus:outline-none focus:ring-1 focus:ring-danger"
            disabled
            value=""
            onChange={() => {}}
          >
            <option value="">No models loaded</option>
          </select>
        </span>
      </Tooltip>
    );
  }

  // Branch 4: populated dropdown (outcome === "ok").
  return (
    <select
      aria-label="Select AI model"
      className="h-8 rounded-sm border border-border-input bg-bg-input px-2 text-xs text-text-body"
      value={value}
      disabled={disabled || models.length === 0}
      onChange={(e) => onChange(e.target.value)}
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
          {m.tier ? ` (${TIER_LABEL[m.tier]})` : ""}
        </option>
      ))}
    </select>
  );
}
