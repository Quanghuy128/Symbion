"use client";

import { useArtifactStore } from "@/lib/store/useArtifactStore";

/**
 * S1 shell footer status: red blocking banner on disconnect (E9), extended
 * (boot-terminal-ux FR-A.2/A.2b) with a distinct amber "session expired"
 * state so a stale/foreign session token is never confused with the daemon
 * process itself being down — these need different user actions (go back to
 * the terminal for a fresh URL vs. restart the daemon).
 */
export function DaemonStatusBadge() {
  const daemonReachable = useArtifactStore((s) => s.daemonReachable);
  const sessionValid = useArtifactStore((s) => s.sessionValid);

  if (daemonReachable && sessionValid) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        daemon ● connected
      </div>
    );
  }

  if (daemonReachable && !sessionValid) {
    return (
      <div className="bg-amber-500 px-3 py-2 text-xs font-medium text-white">
        ⚠ Phiên làm việc đã hết hạn hoặc URL không còn hợp lệ — quay lại terminal
        để lấy URL/token mới. Lưu/Xuất bản đang tạm khoá.
      </div>
    );
  }

  return (
    <div className="bg-destructive px-3 py-2 text-xs font-medium text-white">
      ⚠ daemon mất kết nối — Lưu/Xuất bản đang tạm khoá. Đang thử kết nối lại…
    </div>
  );
}
