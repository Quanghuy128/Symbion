/**
 * buildBodyGenerationPrompt — pure string assembly, no fs/net/Node imports.
 * Builds the system+user prompt sent to a real LLM provider (apps/daemon's
 * `generateBody` RPC handler) to draft "Nội dung" (the body/system-prompt
 * field) for an agent or command artifact. See docs/loops/auto-generate-body-STATE.md
 * §10.1 for the architecture rationale.
 *
 * This module must stay pure: it only assembles strings from its input and
 * never touches the network or filesystem. The daemon is the only place the
 * actual model-inference call is made.
 */

export interface BodyPromptInput {
  kind: "agent" | "command";
  name: string;
  description: string;
  existingBody: string;
}

const NONE_PLACEHOLDER = "(chưa có)";

/** Render a labeled context line, falling back to an explicit "(chưa có)" placeholder
 * when the value is empty/whitespace-only — never leaves a dangling "Label: " with
 * nothing after it (EC-1 requirement: degrade gracefully on empty fields). */
function contextLine(label: string, value: string): string {
  const trimmed = (value ?? "").trim();
  return `${label}: ${trimmed === "" ? NONE_PLACEHOLDER : trimmed}`;
}

/**
 * buildBodyGenerationPrompt — deterministic, pure. Same input (deep-equal) always
 * produces the same `{ system, user }` output. Never throws for any well-formed
 * BodyPromptInput, including the all-empty-except-kind degenerate case (EC-1).
 */
export function buildBodyGenerationPrompt(input: BodyPromptInput): { system: string; user: string } {
  const kind = input?.kind === "command" ? "command" : "agent";
  const name = typeof input?.name === "string" ? input.name : "";
  const description = typeof input?.description === "string" ? input.description : "";
  const existingBody = typeof input?.existingBody === "string" ? input.existingBody : "";

  const system =
    kind === "agent"
      ? "Bạn là một trợ lý chuyên viết system prompt cho các AI sub-agent trong một hệ thống " +
        "autoworkflow (Symbion). Nhiệm vụ của bạn là soạn nội dung (system prompt) hoàn chỉnh, " +
        "rõ ràng, có thể dùng ngay cho một sub-agent, dựa trên tên và mô tả ngắn được cung cấp. " +
        "Chỉ trả về nội dung system prompt dưới dạng markdown thuần — không thêm lời dẫn, không " +
        "thêm giải thích, không bọc trong code block."
      : "Bạn là một trợ lý chuyên viết nội dung cho các slash command (lệnh) trong một hệ thống " +
        "autoworkflow (Symbion). Nhiệm vụ của bạn là soạn nội dung điều phối (orchestration body) " +
        "hoàn chỉnh, rõ ràng, có thể dùng ngay cho một slash command, dựa trên tên lệnh và mô tả " +
        "ngắn được cung cấp. Chỉ trả về nội dung lệnh dưới dạng markdown thuần — không thêm lời " +
        "dẫn, không thêm giải thích, không bọc trong code block.";

  const kindLabel = kind === "agent" ? "Loại: agent (sub-agent)" : "Loại: command (slash command)";

  const userLines = [
    kindLabel,
    contextLine("Tên", name),
    contextLine("Mô tả ngắn", description),
    contextLine("Nội dung hiện tại (nếu có, hãy cải thiện/mở rộng thay vì viết lại hoàn toàn khác)", existingBody),
    "",
    kind === "agent"
      ? "Hãy soạn một system prompt đầy đủ cho sub-agent này."
      : "Hãy soạn nội dung điều phối đầy đủ cho slash command này.",
  ];

  const user = userLines.join("\n");

  return { system, user };
}
