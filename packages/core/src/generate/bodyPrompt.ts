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

const NONE_PLACEHOLDER = "(none)";

/** Render a labeled context line, falling back to an explicit "(none)" placeholder
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
      ? "You are an assistant specialized in writing system prompts for AI sub-agents in an " +
        "autoworkflow system (Symbion). Your task is to compose a complete, " +
        "clear, ready-to-use system prompt for a sub-agent, based on the provided name and short description. " +
        "Return only the system prompt as plain markdown — no preamble, no " +
        "explanations, and do not wrap it in a code block."
      : "You are an assistant specialized in writing content for slash commands in an " +
        "autoworkflow system (Symbion). Your task is to compose a complete, clear orchestration body " +
        "that is ready to use for a slash command, based on the provided command name and short " +
        "description. Return only the command content as plain markdown — no " +
        "preamble, no explanations, and do not wrap it in a code block.";

  const kindLabel = kind === "agent" ? "Kind: agent (sub-agent)" : "Kind: command (slash command)";

  const userLines = [
    kindLabel,
    contextLine("Name", name),
    contextLine("Short description", description),
    contextLine("Current content (if any, improve/expand it rather than rewriting it entirely)", existingBody),
    "",
    kind === "agent"
      ? "Compose a complete system prompt for this sub-agent."
      : "Compose a complete orchestration body for this slash command.",
  ];

  const user = userLines.join("\n");

  return { system, user };
}
