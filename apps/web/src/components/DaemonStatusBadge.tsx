"use client";

import { useArtifactStore } from "@/lib/store/useArtifactStore";

/**
 * AppRail footer status pill. Q6 resolution (docs/loops/symbion-dark-redesign
 * -STATE.md §6.2): promote this single indicator to be visually louder on
 * disconnect (full-width warning-token background) rather than adding a
 * second top-of-main banner — there is exactly one disconnect indicator.
 *
 * tokenless-daemon: the former amber "session expired" state was removed along
 * with the session token — there are now only two states, connected vs. the
 * daemon process being unreachable (restart the daemon).
 */
export function DaemonStatusBadge() {
  const daemonReachable = useArtifactStore((s) => s.daemonReachable);

  if (daemonReachable) {
    return (
      <div className="px-3 py-2.5 font-mono text-[11.5px] text-text-dim">
        <span className="text-success">●</span> daemon · connected
      </div>
    );
  }

  return (
    <div className="w-full bg-danger/90 px-3 py-2.5 text-[11.5px] font-medium text-white">
      ⚠ daemon mất kết nối — Lưu/Xuất bản đang tạm khoá. Đang thử kết nối lại…
    </div>
  );
}
