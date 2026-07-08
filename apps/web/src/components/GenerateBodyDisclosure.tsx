"use client";

import type { ProviderId } from "@/lib/rpc/types";

export const GENERATE_BODY_DISCLOSURE_FLAG_KEY = "symbion.llmDisclosureSeen.v1";

export interface GenerateBodyDisclosureProps {
  providerId: ProviderId | null;
}

/** Provider-conditional copy, generalized per
 * docs/loops/multi-provider-settings-STATE.md §3.2/§4d: the Ollama (local) path does not
 * say "leaves your machine" since it doesn't; any of the 3 cloud providers (openai,
 * anthropic, gemini) explicitly say content DOES leave the machine to the named
 * third-party provider. `providerId === null` means no provider is configured/active yet
 * (STATE §5's "no provider selected" state) — distinct copy, no generate is possible. */
export function persistentDisclosureCopy(providerId: ProviderId | null): string {
  if (providerId === null) {
    return "Chưa chọn nhà cung cấp AI — vào Cài đặt để chọn trước khi dùng tính năng tạo nội dung bằng AI.";
  }
  if (providerId === "ollama") {
    return "Tạo nội dung bằng AI cục bộ (Ollama) — gửi tên/mô tả/nội dung hiện tại tới mô hình chạy trên máy bạn, không gửi ra ngoài.";
  }
  return "Tạo nội dung bằng AI từ bên thứ ba — tên/mô tả/nội dung hiện tại của bạn sẽ được gửi ra ngoài máy đến nhà cung cấp AI bên ngoài.";
}

export function firstUseDisclosureCopy(providerId: ProviderId | null): string {
  if (providerId === null) {
    return "Chưa chọn nhà cung cấp AI nào — vào Cài đặt để cấu hình trước khi dùng tính năng tạo nội dung bằng AI.";
  }
  if (providerId === "ollama") {
    return "Lần đầu sử dụng: tính năng này gửi tên, mô tả và nội dung hiện tại của artifact tới một mô hình AI chạy cục bộ trên máy bạn (Ollama). Dữ liệu không được gửi ra ngoài máy.";
  }
  return "Lần đầu sử dụng: tính năng này gửi tên, mô tả và nội dung hiện tại của artifact tới một dịch vụ AI bên thứ ba qua mạng. Dữ liệu này sẽ rời khỏi máy của bạn và được xử lý bởi nhà cung cấp bên ngoài.";
}

/**
 * GenerateBodyDisclosure — the PERSISTENT micro-copy line only (always visible next to
 * the generate button, regardless of dialog state). STATE §9 Q11 / §10.5 EC-7, generalized
 * for the multi-provider settings feature.
 *
 * The one-time first-use richer dialog is intentionally NOT rendered here — it is owned
 * by GenerateBodyButton and triggered by the *first click* of the generate button.
 */
export function GenerateBodyDisclosure({ providerId }: GenerateBodyDisclosureProps) {
  return <p className="text-xs text-text-muted">{persistentDisclosureCopy(providerId)}</p>;
}
