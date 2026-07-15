/**
 * runConfig — resolve/hash the per-project ProjectRunConfig + generate the
 * verbatim-stable consent sentence (PLAN §8.2 / design §3.2). Single source of
 * both the configHash (nonce binding + first-run-ack keying) and the consent
 * copy — never paraphrased per-surface.
 */
import { DEFAULT_RUN_CONFIG, sha256Hex, type ProjectRunConfig, type ProjectSettings } from "@symbion/core";

export function resolveRunConfig(settings: ProjectSettings): ProjectRunConfig {
  return settings.run ?? { ...DEFAULT_RUN_CONFIG };
}

/** sha256 over {permissionMode, allowedTools, ceilings} — config drift between
 *  preflight and startRun invalidates the consent nonce; mode/tools change
 *  re-asks first-run ack. (firstRunAck itself is excluded from the hash.) */
export function configHash(config: ProjectRunConfig): string {
  const canonical = JSON.stringify({
    permissionMode: config.permissionMode,
    allowedTools: [...config.allowedTools].sort(),
    ceilings: config.ceilings,
  });
  return sha256Hex(canonical);
}

/** The first-run-ack settings hash is keyed to {permissionMode, allowedTools}
 *  only (ceilings changing does NOT re-ask consent — design §0). */
export function ackSettingsHash(config: ProjectRunConfig): string {
  return sha256Hex(
    JSON.stringify({ permissionMode: config.permissionMode, allowedTools: [...config.allowedTools].sort() })
  );
}

function minutes(ms: number): number {
  return Math.round(ms / 60_000);
}

function tokenLabel(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/**
 * buildConsentSentence — the single, verbatim-stable disclosure. States the
 * target path, permission mode, that Symbion's diff-preview does NOT cover the
 * agent's writes, and the ceilings.
 */
export function buildConsentSentence(cwd: string, config: ProjectRunConfig): string {
  return (
    `Runs in ${cwd} · mode ${config.permissionMode} — the agent may create and modify files there. ` +
    `Symbion's diff-preview does NOT apply to the agent's writes. ` +
    `Ceilings: ${minutes(config.ceilings.wallClockMs)} min · ${tokenLabel(config.ceilings.tokenCap)} tokens.`
  );
}
