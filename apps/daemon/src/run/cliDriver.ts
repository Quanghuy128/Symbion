/**
 * cliDriver — the provider seam (mirrors llm/registry.ts so an Agent-SDK or
 * Codex driver stays a swap-in). The ONLY place that knows the Claude Code CLI
 * argv shape. Everything here produces an argv ARRAY — NEVER a shell string —
 * so the requirement is always exactly one element (AC-RUN-6, PLAN §8.5.1).
 *
 * Flag spelling VERIFIED against `claude --help` (CLI 2.1.187, /build P1, A4):
 *   -p/--print · --output-format stream-json · --verbose · --permission-mode
 *   <mode> (choices incl. acceptEdits/bypassPermissions/plan) · --model <m> ·
 *   --allowedTools <tools...> (comma/space-separated).
 */
import { renderRunCommand } from "@symbion/core";

/**
 * resolveClaudeBin — honor SYMBION_CLAUDE_BIN (test substitution of the fake
 * CLI + escape hatch for odd installs, A3); else fall back to "claude" on PATH.
 */
export function resolveClaudeBin(): string {
  const override = process.env["SYMBION_CLAUDE_BIN"];
  if (override && override.trim().length > 0) return override;
  return "claude";
}

export interface BuildArgvInput {
  commandName: string;
  requirement: string;
  model?: string;
  permissionMode: string;
  allowedTools: string[];
}

/**
 * buildArgv — produce the argv array for a headless run. The prompt (which
 * embeds the possibly-hostile requirement) is a SINGLE element via
 * core.renderRunCommand; shell interpolation is impossible because spawn is
 * called with `shell:false` (the default) and this array.
 */
export function buildArgv(input: BuildArgvInput): string[] {
  const prompt = renderRunCommand({
    command: input.commandName,
    requirements: input.requirement,
  });

  const argv: string[] = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    input.permissionMode,
  ];

  if (input.model && input.model.trim().length > 0) {
    argv.push("--model", input.model.trim());
  }
  if (input.allowedTools.length > 0) {
    // --allowedTools accepts a comma/space-separated list; pass one joined
    // element (still a single argv element — never a shell string).
    argv.push("--allowedTools", input.allowedTools.join(","));
  }

  return argv;
}
