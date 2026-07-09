"use client";

export interface GraphHintBarProps {
  onDismiss: () => void;
}

/**
 * GraphHintBar (design §5 N, surface N) — first-run hint. A STACKED row (never
 * an overlay over nodes) between the status chips and the canvas. Teaches the
 * drag-to-link + ⋯ menu gestures. `[Đã hiểu]` and `[×]` both dismiss (and the
 * parent auto-dismisses on the first successful link). z-10.
 */
export function GraphHintBar({ onDismiss }: GraphHintBarProps) {
  return (
    <div className="relative z-10 mb-2 flex animate-slideIn items-start gap-3 rounded-panel border border-border-menu bg-bg-menu px-4 py-3 text-[12.5px] text-text-body">
      <p className="flex-1 leading-snug">
        ✦ Sơ đồ giờ có thể chỉnh sửa. Kéo từ chấm ● bên phải một /command sang agent để liên kết. Nhấn
        ⋯ trên node để Sửa · Xoá · Copy run.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-sm bg-brand-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent-text hover:bg-brand-accent-soft/80"
        >
          Đã hiểu
        </button>
        <button
          type="button"
          aria-label="Đóng"
          onClick={onDismiss}
          className="flex h-6 w-6 items-center justify-center rounded-sm text-text-faint hover:text-text-body"
        >
          ×
        </button>
      </div>
    </div>
  );
}
