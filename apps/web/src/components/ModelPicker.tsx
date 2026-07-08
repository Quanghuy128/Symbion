"use client";

import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";
import { callRpc, DaemonRpcError } from "@/lib/rpc/client";
import type { ListModelsOutcome, ListModelsParams, ListModelsResult, LlmModelOption, ProviderId } from "@/lib/rpc/types";

export interface ModelPickerProps {
  providerId: ProviderId | null;
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

const TIER_LABEL: Record<NonNullable<LlmModelOption["tier"]>, string> = {
  fast: "Nhanh",
  balanced: "Cân bằng",
  best: "Tốt nhất",
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
 * 3. `outcome === "empty"` — Ollama reachable, zero models pulled — actionable
 *    empty-state with an `ollama pull <tag>` suggestion + Copy button.
 * 4. `outcome === "ok"` — populated `<select>`, unchanged structurally except an
 *    optional-tier render guard (no "(undefined)" / crash for tierless entries).
 */
export function ModelPicker({ providerId, value, onChange, disabled }: ModelPickerProps) {
  const [models, setModels] = useState<LlmModelOption[]>([]);
  const [outcome, setOutcome] = useState<ListModelsOutcome | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!providerId) {
      setModels([]);
      setOutcome(null);
      setErrorDetail(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setCopied(false);
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
          err instanceof DaemonRpcError ? err.message || "Không thể tải danh sách mô hình." : "Không thể tải danh sách mô hình."
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  async function handleCopyPullCommand() {
    try {
      await navigator.clipboard.writeText(SUGGESTED_PULL_COMMAND);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!providerId) {
    return <span className="text-xs text-text-muted">Chưa chọn nhà cung cấp AI</span>;
  }

  // Branch 1: unreachable / thrown RpcError — unchanged.
  if (loadError) {
    return <span className="text-xs text-danger">{loadError}</span>;
  }

  // Branch 2: reachable, but /api/tags itself failed.
  if (outcome === "fetch-failed") {
    return (
      <span className="text-xs text-danger">
        {errorDetail || "Không thể lấy danh sách mô hình từ Ollama."}
      </span>
    );
  }

  // Branch 3: reachable, zero models pulled — actionable empty-state.
  if (outcome === "empty") {
    return (
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-text-muted">
          Chưa có model nào được tải trên Ollama. Chạy lệnh sau rồi quay lại đây:
        </span>
        <div className="flex items-center gap-2">
          <code className="select-all rounded-sm border border-border-input bg-bg-code px-2 py-1 text-text-body">
            {SUGGESTED_PULL_COMMAND}
          </code>
          <button
            type="button"
            aria-label="Copy lệnh ollama pull"
            className="inline-flex items-center gap-1 rounded-sm border border-border-input px-2 py-1 text-text-dim hover:bg-white/[.06]"
            onClick={handleCopyPullCommand}
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Đã copy" : "Copy"}
          </button>
        </div>
      </div>
    );
  }

  // Branch 4: populated dropdown (outcome === "ok").
  return (
    <select
      aria-label="Chọn mô hình AI"
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
