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

/** Enum-checked permission modes (STATE §20 review fix — 🟡 medium). Mirrors
 *  the three modes offered by `RunSettingsSection.tsx` / verified against the
 *  installed CLI binary (PLAN §8.0). */
const VALID_PERMISSION_MODES = new Set(["plan", "acceptEdits", "bypassPermissions"]);

/** Same bounds as `RunSettingsSection.tsx`'s client-side `clamp()` calls
 *  (MIN_WALL_CLOCK_MIN/MAX_WALL_CLOCK_MIN/MIN_TOKEN_CAP/MAX_TOKEN_CAP) — kept
 *  in minutes/ms and raw token counts to match that file's units exactly. */
const MIN_WALL_CLOCK_MS = 1 * 60_000;
const MAX_WALL_CLOCK_MS = 1440 * 60_000;
const MIN_TOKEN_CAP = 1_000;
const MAX_TOKEN_CAP = 5_000_000;
const MAX_ALLOWED_TOOL_LEN = 200;
const MAX_ALLOWED_TOOLS = 200;

/**
 * validateRunConfig — server-side runtime validation of a `ProjectRunConfig`
 * before it is persisted via `updateSettings` (STATE §20 review fix — the
 * client-side clamps in `RunSettingsSection.tsx` are UX-only and do not
 * protect the daemon; a bare RPC call could otherwise persist an out-of-
 * contract `permissionMode`/`allowedTools`/ceilings). Returns null when
 * `run` is undefined (the field is optional — absence is valid, resolves to
 * DEFAULT_RUN_CONFIG). Throws (never silently clamps/coerces) on the
 * *shape* being wrong — permissionMode not in the known enum, allowedTools
 * not a string[] or items too long/too many; ceilings are clamped into
 * range rather than rejected (matching the UI's own clamp-not-reject
 * posture for wall-clock/token-cap, and because `tokenCap<=0` is a valid
 * explicit "no cap" sentinel documented in RunSettingsSection.tsx).
 */
export function validateRunConfig(run: unknown): ProjectRunConfig | null {
  if (run === undefined || run === null) return null;
  if (typeof run !== "object") {
    throw new Error(`Invalid "run" settings: expected an object.`);
  }
  const candidate = run as Partial<ProjectRunConfig>;

  if (typeof candidate.permissionMode !== "string" || !VALID_PERMISSION_MODES.has(candidate.permissionMode)) {
    throw new Error(
      `Invalid "run.permissionMode": must be one of ${[...VALID_PERMISSION_MODES].join(", ")}.`
    );
  }

  if (!Array.isArray(candidate.allowedTools) || !candidate.allowedTools.every((t) => typeof t === "string")) {
    throw new Error(`Invalid "run.allowedTools": must be a string[].`);
  }
  if (candidate.allowedTools.length > MAX_ALLOWED_TOOLS) {
    throw new Error(`Invalid "run.allowedTools": too many entries (max ${MAX_ALLOWED_TOOLS}).`);
  }
  for (const tool of candidate.allowedTools) {
    if (tool.length === 0 || tool.length > MAX_ALLOWED_TOOL_LEN) {
      throw new Error(`Invalid "run.allowedTools" entry: length must be 1-${MAX_ALLOWED_TOOL_LEN} chars.`);
    }
  }

  const ceilings = candidate.ceilings;
  if (
    typeof ceilings !== "object" ||
    ceilings === null ||
    typeof ceilings.wallClockMs !== "number" ||
    !Number.isFinite(ceilings.wallClockMs) ||
    typeof ceilings.tokenCap !== "number" ||
    !Number.isFinite(ceilings.tokenCap)
  ) {
    throw new Error(`Invalid "run.ceilings": must be {wallClockMs: number, tokenCap: number}.`);
  }

  const wallClockMs = Math.min(MAX_WALL_CLOCK_MS, Math.max(MIN_WALL_CLOCK_MS, Math.round(ceilings.wallClockMs)));
  // tokenCap<=0 is the documented "no cap" sentinel (RunSettingsSection.tsx) —
  // clamp only the positive range, never reject/clamp a non-positive value up.
  const tokenCap =
    ceilings.tokenCap <= 0 ? ceilings.tokenCap : Math.min(MAX_TOKEN_CAP, Math.max(MIN_TOKEN_CAP, Math.round(ceilings.tokenCap)));

  const result: ProjectRunConfig = {
    permissionMode: candidate.permissionMode,
    allowedTools: candidate.allowedTools,
    ceilings: { wallClockMs, tokenCap },
  };
  if (candidate.firstRunAck !== undefined) {
    result.firstRunAck = candidate.firstRunAck;
  }
  return result;
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
