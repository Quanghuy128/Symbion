"use client";

import { useArtifactStore } from "@/lib/store/useArtifactStore";

/**
 * AppRail footer status pill. Q6 resolution (docs/loops/symbion-dark-redesign
 * -STATE.md §6.2): promote this single indicator to be visually louder on
 * disconnect (full-width warning-token background) rather than adding a
 * second top-of-main banner — there is exactly one disconnect indicator.
 * Extended (boot-terminal-ux FR-A.2/A.2b) with a distinct amber "session
 * expired" state so a stale/foreign session token is never confused with the
 * daemon process itself being down — these need different user actions (go
 * back to the terminal for a fresh URL vs. restart the daemon).
 */
export function DaemonStatusBadge() {
  const daemonReachable = useArtifactStore((s) => s.daemonReachable);
  const sessionValid = useArtifactStore((s) => s.sessionValid);

  if (daemonReachable && sessionValid) {
    return (
      <div className="px-3 py-2.5 font-mono text-[11.5px] text-text-dim">
        <span className="text-success">●</span> daemon · connected
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
    <div className="w-full bg-danger/90 px-3 py-2.5 text-[11.5px] font-medium text-white">
      ⚠ daemon mất kết nối — Lưu/Xuất bản đang tạm khoá. Đang thử kết nối lại…
    </div>
  );
}
