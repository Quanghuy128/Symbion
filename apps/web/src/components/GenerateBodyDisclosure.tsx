"use client";

export const GENERATE_BODY_DISCLOSURE_FLAG_KEY = "symbion.llmDisclosureSeen.v1";

export interface GenerateBodyDisclosureProps {
  providerId: "ollama" | "remote";
}

/** Provider-conditional copy per STATE §9 Q11 nuance + §10.5 EC-7: the Ollama (local,
 * default) path does not say "leaves your machine" since it doesn't; the remote path
 * (not reachable from any UI control in v1, but contract-tested) explicitly says
 * content DOES leave the machine to the named third-party provider. */
export function persistentDisclosureCopy(providerId: "ollama" | "remote"): string {
  if (providerId === "ollama") {
    return "Tạo nội dung bằng AI cục bộ (Ollama) — gửi tên/mô tả/nội dung hiện tại tới mô hình chạy trên máy bạn, không gửi ra ngoài.";
  }
  return "Tạo nội dung bằng AI từ bên thứ ba (remote provider) — tên/mô tả/nội dung hiện tại của bạn sẽ được gửi ra ngoài máy đến nhà cung cấp AI bên ngoài.";
}

export function firstUseDisclosureCopy(providerId: "ollama" | "remote"): string {
  if (providerId === "ollama") {
    return "Lần đầu sử dụng: tính năng này gửi tên, mô tả và nội dung hiện tại của artifact tới một mô hình AI chạy cục bộ trên máy bạn (Ollama). Dữ liệu không được gửi ra ngoài máy.";
  }
  return "Lần đầu sử dụng: tính năng này gửi tên, mô tả và nội dung hiện tại của artifact tới một dịch vụ AI bên thứ ba qua mạng. Dữ liệu này sẽ rời khỏi máy của bạn và được xử lý bởi nhà cung cấp bên ngoài.";
}

/**
 * GenerateBodyDisclosure — the PERSISTENT micro-copy line only (always visible next to
 * the generate button, regardless of dialog state). STATE §9 Q11 / §10.5 EC-7.
 *
 * The one-time first-use richer dialog is intentionally NOT rendered here — it is owned
 * by GenerateBodyButton and triggered by the *first click* of the generate button (per
 * STATE §10.3's data-flow: "if first-ever click in this browser ... show one-time
 * disclosure dialog ... proceeds to RPC call only after dismissal/ack"), not by this
 * component mounting. Rendering the dialog on mount would pop it up on every fresh
 * AgentForm/WorkflowForm render and block unrelated clicks elsewhere on the form
 * (e.g. the tools toggle buttons) via the modal's full-screen backdrop.
 */
export function GenerateBodyDisclosure({ providerId }: GenerateBodyDisclosureProps) {
  return <p className="text-xs text-muted-foreground">{persistentDisclosureCopy(providerId)}</p>;
}
