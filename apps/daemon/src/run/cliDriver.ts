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
import { compareVersions, renderRunCommand, validateVersion } from "@symbion/core";

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
  /** "argv" (default, byte-identical to pre-attachment runs): the prompt is the `-p`
   *  positional. "stdin": the prompt (+ images) arrives as one stream-json user
   *  message on stdin, so NO positional prompt is given (run-image-paste D5). */
  inputMode?: "argv" | "stdin";
}

/** Floor for `--input-format stream-json` image delivery: the lowest version the
 *  run-image-paste spike (S1) verified end-to-end. Fails closed on "unknown".
 *  Attachments only; text-only runs unaffected. */
export const MIN_CLI_VERSION_FOR_ATTACHMENTS = "2.1.187";

export function cliSupportsAttachments(version: string | null | undefined): boolean {
  if (!version || version === "unknown") return false;
  const v = `v${version}`;
  return validateVersion(v) && compareVersions(v, `v${MIN_CLI_VERSION_FOR_ATTACHMENTS}`) >= 0;
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

  const argv: string[] =
    input.inputMode === "stdin"
      ? [
          "-p",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--verbose",
          "--permission-mode",
          input.permissionMode,
        ]
      : ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", input.permissionMode];

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
