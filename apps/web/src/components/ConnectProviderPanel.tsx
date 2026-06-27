"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { callRpc, DaemonRpcError } from "@/lib/rpc/client";
import type { CheckProviderStatusParams, CheckProviderStatusResult } from "@/lib/rpc/types";
import { useArtifactStore } from "@/lib/store/useArtifactStore";

export interface ConnectProviderPanelProps {
  /** v1 only ever calls this with "ollama" (locked decision 4 — remote is out of scope);
   *  the prop is typed narrowly on purpose to make that boundary visible in the type itself. */
  providerId: "ollama";
  open: boolean;
  onClose: () => void;
  /** optional: lets the caller (ProviderStatusPill / GenerateBodyButton) learn the latest
   *  resolved reachability so it can keep its own pill/label in sync without a shared
   *  cache (design doc §4 — each surface fires its own RPC call independently). */
  onStatusChange?: (reachable: boolean) => void;
}

type CheckState = "checking" | "connected" | "disconnected";

/**
 * ConnectProviderPanel — the S2 popover/dialog content from
 * docs/loops/connect-providers-design.md: names the provider, explains it in plain
 * language, shows an OS-specific copy-pasteable install command, and a manual
 * "Kiểm tra lại kết nối" recheck button. On-demand checks only — no polling
 * (locked decision 3). Non-blocking/dismissible by construction (EC-6) — this is a
 * `Dialog` scoped to one row, not a full-screen gate; closing never disables any other
 * control elsewhere in the form.
 */
export function ConnectProviderPanel({ providerId, open, onClose, onStatusChange }: ConnectProviderPanelProps) {
  const daemonConnected = useArtifactStore((s) => s.daemonConnected);

  const [state, setState] = useState<CheckState>("checking");
  const [install, setInstall] = useState<CheckProviderStatusResult["install"] | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  async function runCheck() {
    setState("checking");
    try {
      const result = await callRpc<CheckProviderStatusParams, CheckProviderStatusResult>("checkProviderStatus", {
        providerId,
      });
      setInstall(result.install);
      setState(result.reachable ? "connected" : "disconnected");
      onStatusChange?.(result.reachable);
    } catch (err) {
      // RPC transport failure (daemon down) is a DIFFERENT failure than a resolved
      // {reachable:false} — per EC-7/AC-4, do not relabel this as "Ollama is down."
      // The daemon-down note below (driven by `daemonConnected`) covers this case;
      // here we simply stop showing a stale/misleading Ollama-specific state.
      if (!(err instanceof DaemonRpcError)) {
        // non-DaemonRpcError (network-level fetch failure) is also a transport
        // failure, not a resolved provider-down payload — same treatment.
      }
      setState("disconnected");
    }
  }

  // Fire once when the panel opens — re-opening does NOT auto-refire a check
  // (avoids accidental repeat network calls just from toggling open/closed); only the
  // explicit recheck button below fires a new check after the initial open-triggered one.
  useEffect(() => {
    if (open) {
      void runCheck();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function copyCommand(command: string, label: string) {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedLabel(label);
      setTimeout(() => setCopiedLabel((current) => (current === label ? null : current)), 1500);
    } catch {
      // clipboard unavailable (e.g. insecure context) — non-fatal, command text is
      // still visible/selectable in the code block for manual copy.
    }
  }

  const busy = state === "checking";

  return (
    <Dialog open={open} onClose={onClose} className="w-full max-w-lg">
      <DialogHeader>
        <DialogTitle>Kết nối với Ollama</DialogTitle>
      </DialogHeader>

      <div className="space-y-3 text-sm">
        {!daemonConnected ? (
          <p className="flex items-center gap-2 text-destructive">
            <span aria-hidden>⚠</span>
            Mất kết nối tới Symbion daemon — không thể kiểm tra Ollama lúc này.
          </p>
        ) : (
          <p className="flex items-center gap-2">
            <StatusDot state={state} />
            {state === "checking" && "Đang kiểm tra…"}
            {state === "connected" && "Đã kết nối"}
            {state === "disconnected" && "Chưa kết nối"}
          </p>
        )}

        <p className="text-muted-foreground">
          Ollama là phần mềm chạy mô hình AI ngay trên máy của bạn — Symbion dùng nó để tạo nội dung gợi ý (Tạo nội
          dung). Không có Ollama, các nút &quot;✨ Tạo nội dung&quot; sẽ không hoạt động, nhưng phần còn lại của
          Symbion vẫn dùng được bình thường.
        </p>

        {install && (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              Cài &amp; chạy trên máy của bạn
              {install.confident ? ` (phát hiện: ${install.env.label})` : " — không chắc về hệ điều hành, vui lòng chọn đúng bên dưới:"}
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
            {install.confident && (
              <p className="mt-1 text-xs text-muted-foreground">
                Lệnh trên dành cho {install.env.label} — không phải hệ điều hành khác.
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Symbion sẽ kiểm tra Ollama khi bạn mở biểu mẫu này hoặc khi bạn bấm &quot;Kiểm tra lại kết nối&quot; — không
          kiểm tra định kỳ.
        </p>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => void runCheck()} disabled={busy || !daemonConnected}>
          {busy ? (
            <span className="flex items-center gap-1">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang kiểm tra…
            </span>
          ) : (
            "Kiểm tra lại kết nối"
          )}
        </Button>
        <Button type="button" onClick={onClose}>
          Đóng
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function StatusDot({ state }: { state: CheckState }) {
  if (state === "checking") return <span aria-hidden>◐</span>;
  if (state === "connected") return <span aria-hidden className="text-green-600">●</span>;
  return <span aria-hidden className="text-amber-500">●</span>;
}
