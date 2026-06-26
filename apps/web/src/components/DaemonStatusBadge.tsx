"use client";

import { useArtifactStore } from "@/lib/store/useArtifactStore";

/** S1 shell footer status: red blocking banner on disconnect (E9). */
export function DaemonStatusBadge() {
  const connected = useArtifactStore((s) => s.daemonConnected);

  if (connected) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        daemon ● connected
      </div>
    );
  }

  return (
    <div className="bg-destructive px-3 py-2 text-xs font-medium text-white">
      ⚠ daemon mất kết nối — Lưu/Xuất bản đang tạm khoá. Đang thử kết nối lại…
    </div>
  );
}
