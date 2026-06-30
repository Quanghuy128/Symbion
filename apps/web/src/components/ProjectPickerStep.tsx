"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface ProjectPickerStepProps {
  projects: Array<{ id: string; name: string; path: string }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  daemonConnected: boolean;
  onCreateProjectRequested: () => void;
}

/**
 * ProjectPickerStep — pure presentational radio-list / zero-projects empty
 * state / daemon-down dimmed state, used by TemplatePreviewModal's "apply"
 * step (T3/T5/T8 wireframes). Same spirit as ImportReviewStep: no RPC calls,
 * no submit button — the caller owns "Xác nhận áp dụng".
 */
export function ProjectPickerStep({
  projects,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  daemonConnected,
  onCreateProjectRequested,
}: ProjectPickerStepProps) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
  }, [projects, search]);

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="text-sm text-muted-foreground">Chưa có dự án nào — tạo dự án trước</p>
        <Button onClick={onCreateProjectRequested}>+ Tạo dự án mới</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!daemonConnected && (
        <p className="text-xs font-medium text-destructive">
          ⚠ daemon mất kết nối — không thể áp dụng lúc này. Đang thử kết nối lại…
        </p>
      )}

      <Input placeholder="🔍 Tìm dự án…" value={search} onChange={(e) => onSearchChange(e.target.value)} />

      <div className="max-h-48 space-y-1 overflow-y-auto">
        {filtered.length === 0 && <p className="text-xs text-muted-foreground">Không tìm thấy dự án phù hợp.</p>}
        {filtered.map((p) => (
          <label
            key={p.id}
            className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted ${
              selectedId === p.id ? "bg-muted" : ""
            } ${!daemonConnected ? "opacity-60" : ""}`}
          >
            <input
              type="radio"
              name="template-apply-project"
              checked={selectedId === p.id}
              disabled={!daemonConnected}
              onChange={() => onSelect(p.id)}
            />
            <span className="flex-1 truncate font-medium">{p.name}</span>
            <span className="truncate text-xs text-muted-foreground" title={p.path}>
              {p.path}
            </span>
          </label>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Mẫu sẽ được lưu vào dự án đã chọn ở dạng nháp (draft) — chưa ghi gì vào repo. Bạn vẫn cần Xuất bản sau để ghi
        ra đĩa.
      </p>
    </div>
  );
}
