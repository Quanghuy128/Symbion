"use client";

import { useEffect, useState } from "react";
import { callRpc } from "@/lib/rpc/client";
import type { LlmModelOption } from "@/lib/rpc/types";

export interface ModelPickerProps {
  providerId: "ollama" | "remote";
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

const TIER_LABEL: Record<LlmModelOption["tier"], string> = {
  fast: "Nhanh",
  balanced: "Cân bằng",
  best: "Tốt nhất",
};

/**
 * ModelPicker — fetches the daemon's hardcoded 3-model list via the `listModels`
 * RPC on mount (single source of truth — no hand-duplicated constant in apps/web,
 * per the locked amendment to STATE §10.7 Risk R1). Selection is per-click, not
 * persisted (STATE §9 Q2/Q3/Q9).
 */
export function ModelPicker({ providerId, value, onChange, disabled }: ModelPickerProps) {
  const [models, setModels] = useState<LlmModelOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    callRpc<{ providerId: "ollama" | "remote" }, { models: LlmModelOption[] }>("listModels", { providerId })
      .then((result) => {
        if (cancelled) return;
        setModels(result.models);
        setLoadError(null);
        // Default to the first model if nothing selected yet.
        if (!value && result.models.length > 0) {
          onChange(result.models[0]!.id);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError("Không thể tải danh sách mô hình.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  if (loadError) {
    return <span className="text-xs text-destructive">{loadError}</span>;
  }

  return (
    <select
      aria-label="Chọn mô hình AI"
      className="h-8 rounded-md border border-border bg-background px-2 text-xs"
      value={value}
      disabled={disabled || models.length === 0}
      onChange={(e) => onChange(e.target.value)}
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label} ({TIER_LABEL[m.tier]})
        </option>
      ))}
    </select>
  );
}
