"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callRpc, DaemonRpcError } from "@/lib/rpc/client";
import type {
  CheckProviderStatusParams,
  CheckProviderStatusResult,
  ClearProviderKeyParams,
  ClearProviderKeyResult,
  ListProvidersParams,
  ListProvidersResult,
  ProviderDescriptor,
  ProviderId,
  SaveProviderKeyParams,
  SaveProviderKeyResult,
  SetActiveProviderParams,
  SetActiveProviderResult,
} from "@/lib/rpc/types";
import { useArtifactStore } from "@/lib/store/useArtifactStore";

type CheckState = "idle" | "checking" | "connected" | "disconnected";

const ERROR_CODE_LABELS: Record<string, string> = {
  "not-configured": "Chưa cấu hình API key.",
  auth: "Sai hoặc thiếu API key.",
  "rate-limit": "Bị giới hạn tần suất gọi.",
  timeout: "Quá thời gian chờ.",
  network: "Lỗi mạng.",
  "invalid-response": "Phản hồi không hợp lệ từ nhà cung cấp.",
};

/**
 * ProvidersPanel — the card-grid (4 cards: Ollama, OpenAI, Anthropic, Gemini) that
 * replaces ConnectProviderPanel's Ollama-only Dialog as the canonical home for provider
 * setup, per docs/loops/multi-provider-settings-STATE.md §3.2. On mount: ONE
 * callRpc("listProviders", {}) renders all 4 cards. No "Test All" button (explicit
 * out-of-scope decision) — per-provider only.
 */
export function ProvidersPanel() {
  const daemonConnected = useArtifactStore((s) => s.daemonConnected);
  const [providers, setProviders] = useState<ProviderDescriptor[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  function refresh() {
    callRpc<ListProvidersParams, ListProvidersResult>("listProviders", {})
      .then((result) => {
        setProviders(result.providers);
        setLoadError(null);
      })
      .catch(() => {
        setLoadError("Không thể tải danh sách nhà cung cấp AI.");
      });
  }

  useEffect(() => {
    if (!daemonConnected) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daemonConnected]);

  if (!daemonConnected) {
    return (
      <p className="flex items-center gap-2 text-sm text-destructive">
        <span aria-hidden>⚠</span>
        Mất kết nối tới Symbion daemon — không thể quản lý nhà cung cấp AI lúc này.
      </p>
    );
  }

  if (loadError) {
    return <p className="text-sm text-destructive">{loadError}</p>;
  }

  if (!providers) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Đang tải…
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {providers.map((provider) =>
        provider.kind === "local" ? (
          <OllamaCard key={provider.id} provider={provider} onChanged={refresh} />
        ) : (
          <ApiKeyProviderCard key={provider.id} provider={provider} onChanged={refresh} />
        )
      )}
    </div>
  );
}

function CardShell({ children, active }: { children: React.ReactNode; active: boolean }) {
  return (
    <div
      className={`space-y-3 rounded-lg border p-4 text-sm ${
        active ? "border-primary" : "border-border"
      }`}
    >
      {children}
    </div>
  );
}

function StatusBadge({ state, errorCode }: { state: CheckState; errorCode?: string }) {
  if (state === "idle") return null;
  const label =
    state === "checking"
      ? "Đang kiểm tra…"
      : state === "connected"
        ? "Đã kết nối"
        : (errorCode && ERROR_CODE_LABELS[errorCode]) || "Chưa kết nối";
  const dotClass =
    state === "checking" ? "" : state === "connected" ? "text-green-600" : "text-amber-500";
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      {state === "checking" ? <span aria-hidden>◐</span> : <span aria-hidden className={dotClass}>●</span>}
      {label}
    </span>
  );
}

/** Ollama's guide-only setup copy + install-command block, moved (not duplicated) from
 * the retired ConnectProviderPanel.tsx into this Ollama card. No API key input — local,
 * no-credential provider. */
function OllamaCard({ provider, onChanged }: { provider: ProviderDescriptor; onChanged: () => void }) {
  const [state, setState] = useState<CheckState>("idle");
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [install, setInstall] = useState<CheckProviderStatusResult["install"] | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runCheck() {
    setState("checking");
    try {
      const result = await callRpc<CheckProviderStatusParams, CheckProviderStatusResult>("checkProviderStatus", {
        providerId: "ollama",
      });
      setInstall(result.install ?? null);
      setErrorCode(result.errorCode);
      setState(result.reachable ? "connected" : "disconnected");
    } catch {
      setState("disconnected");
    }
  }

  async function activate() {
    setBusy(true);
    try {
      await callRpc<SetActiveProviderParams, SetActiveProviderResult>("setActiveProvider", { providerId: "ollama" });
      onChanged();
    } catch {
      // surfaced implicitly via onChanged()'s refresh not reflecting the change; no
      // dedicated error UI for this rare case (setActiveProvider("ollama") never needs a key).
    } finally {
      setBusy(false);
    }
  }

  async function copyCommand(command: string, label: string) {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedLabel(label);
      setTimeout(() => setCopiedLabel((current) => (current === label ? null : current)), 1500);
    } catch {
      // clipboard unavailable — non-fatal, command text is still visible for manual copy.
    }
  }

  return (
    <CardShell active={provider.active}>
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Ollama (cục bộ)</h3>
        <StatusBadge state={state} errorCode={errorCode} />
      </div>

      <p className="text-muted-foreground">
        Ollama là phần mềm chạy mô hình AI ngay trên máy của bạn — Symbion dùng nó để tạo nội dung gợi ý (Tạo nội
        dung). Không cần API key.
      </p>

      {install && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            Cài &amp; chạy trên máy của bạn
            {install.confident
              ? ` (phát hiện: ${install.env.label})`
              : " — không chắc về hệ điều hành, vui lòng chọn đúng bên dưới:"}
          </p>
          <div className="space-y-2">
            {install.variants.map((variant) => (
              <div key={variant.label} className="space-y-1">
                {!install.confident && <p className="text-xs font-medium">{variant.label}</p>}
                <div className="flex items-start gap-2">
                  <pre className="flex-1 overflow-x-auto rounded-md border border-border bg-muted p-2 text-xs">
                    <code>{variant.command}</code>
                  </pre>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Sao chép lệnh"
                    onClick={() => copyCommand(variant.command, variant.label)}
                  >
                    {copiedLabel === variant.label ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void runCheck()} disabled={state === "checking"}>
          {state === "checking" ? (
            <span className="flex items-center gap-1">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang kiểm tra…
            </span>
          ) : (
            "Kiểm tra kết nối"
          )}
        </Button>
        <Button type="button" size="sm" onClick={() => void activate()} disabled={busy || provider.active}>
          {provider.active ? "Đang hoạt động" : "Đặt làm mặc định"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Symbion chỉ kiểm tra Ollama khi bạn bấm &quot;Kiểm tra kết nối&quot; — không kiểm tra định kỳ.
      </p>
    </CardShell>
  );
}

/** A card for one of the 3 api-key-kind providers (OpenAI, Anthropic, Gemini): masked key
 * input, Save / Test connection / Clear key, and an activate control. */
function ApiKeyProviderCard({ provider, onChanged }: { provider: ProviderDescriptor; onChanged: () => void }) {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [state, setState] = useState<CheckState>("idle");
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [activating, setActivating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function save() {
    if (apiKeyInput.trim() === "") return;
    setSaving(true);
    setActionError(null);
    try {
      await callRpc<SaveProviderKeyParams, SaveProviderKeyResult>("saveProviderKey", {
        providerId: provider.id,
        apiKey: apiKeyInput,
      });
      setApiKeyInput(""); // raw key never lingers in React state after save resolves
      onChanged();
    } catch (err) {
      setActionError(err instanceof DaemonRpcError ? err.message : "Không thể lưu API key.");
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    setClearing(true);
    setActionError(null);
    try {
      await callRpc<ClearProviderKeyParams, ClearProviderKeyResult>("clearProviderKey", { providerId: provider.id });
      onChanged();
    } catch (err) {
      setActionError(err instanceof DaemonRpcError ? err.message : "Không thể xoá API key.");
    } finally {
      setClearing(false);
    }
  }

  async function activate() {
    setActivating(true);
    setActionError(null);
    try {
      await callRpc<SetActiveProviderParams, SetActiveProviderResult>("setActiveProvider", {
        providerId: provider.id,
      });
      onChanged();
    } catch (err) {
      setActionError(err instanceof DaemonRpcError ? err.message : "Không thể đặt làm mặc định.");
    } finally {
      setActivating(false);
    }
  }

  async function runCheck() {
    setState("checking");
    setErrorCode(undefined);
    try {
      const result = await callRpc<CheckProviderStatusParams, CheckProviderStatusResult>("checkProviderStatus", {
        providerId: provider.id,
      });
      setErrorCode(result.errorCode);
      setState(result.reachable ? "connected" : "disconnected");
    } catch {
      setState("disconnected");
    }
  }

  return (
    <CardShell active={provider.active}>
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{provider.label}</h3>
        <StatusBadge state={state} errorCode={errorCode} />
      </div>

      {provider.configured ? (
        <p className="text-xs text-muted-foreground">
          API key: <code>{provider.maskedKey}</code>
          {provider.model ? ` · mô hình: ${provider.model}` : ""}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Chưa cấu hình API key.</p>
      )}

      <div className="flex gap-2">
        <Input
          type="password"
          placeholder={provider.configured ? "Nhập key mới để thay thế…" : "Nhập API key…"}
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          disabled={saving}
        />
        <Button type="button" size="sm" onClick={() => void save()} disabled={saving || apiKeyInput.trim() === ""}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lưu"}
        </Button>
      </div>

      {actionError && <p className="text-xs text-destructive">{actionError}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void runCheck()}
          disabled={state === "checking" || !provider.configured}
        >
          {state === "checking" ? (
            <span className="flex items-center gap-1">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang kiểm tra…
            </span>
          ) : (
            "Kiểm tra kết nối"
          )}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void activate()}
          disabled={activating || !provider.configured || provider.active}
        >
          {provider.active ? "Đang hoạt động" : "Đặt làm mặc định"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void clearKey()}
          disabled={clearing || !provider.configured}
        >
          Xoá key
        </Button>
      </div>
    </CardShell>
  );
}
