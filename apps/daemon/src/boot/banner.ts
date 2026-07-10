/**
 * banner.ts — pure, dependency-free boot banner builder + TTY/emoji-support
 * detection (boot-terminal-ux PLAN §P1). No `process`/Node fs/net reads
 * inside `buildBootBanner` itself — all environment reads are injected as
 * parameters so this stays trivially unit-testable and mirrors
 * `packages/core`'s "pure" convention even though this file lives in
 * `apps/daemon` (it's fine for it to import Node types, it just must not
 * *read* global mutable state internally).
 *
 * IMPORTANT (see docs/loops/boot-terminal-ux-STATE.md PLAN §P0.2): the
 * server line's text — "Symbion daemon running: <url>" — MUST stay
 * byte-for-byte identical to today's line. `e2e/daemon-fixture.ts`'s
 * `URL_RE` regex hard-codes this exact literal substring to parse the boot
 * URL out of daemon stdout for every e2e spec that boots a real daemon.
 * Renaming this line (e.g. to "Server: <url>") silently breaks those specs.
 */

const DEFAULT_TERMINAL_COLUMNS_CAP = 100;

export interface BuildBootBannerOptions {
  version: string;
  url: string;
  useEmoji: boolean;
  isTty: boolean;
  /** Known terminal width in columns, if available (e.g. `process.stdout.columns`). */
  terminalColumns?: number;
}

/**
 * isTtyOutput — is the given (or default `process.stdout`) stream an
 * interactive terminal? Used to decide whether to print the bordered banner
 * at all (decision #6: box/color auto-disable when stdout is not a TTY,
 * e.g. piped to a file).
 */
export function isTtyOutput(stream?: NodeJS.WriteStream): boolean {
  return (stream ?? process.stdout).isTTY === true;
}

/**
 * supportsEmoji — best-effort heuristic, not a guarantee (EC-NEW.4). Legacy
 * Windows `cmd.exe` (no `WT_SESSION`/`TERM_PROGRAM`/ConEmu) resolves to
 * `false` — the concrete target named in Scope decision #4. Windows
 * Terminal, macOS, and Linux terminals resolve to `true`. Two env-var
 * escape hatches (`SYMBION_FORCE_ASCII` / `SYMBION_FORCE_EMOJI`) exist for
 * deterministic unit tests and for users whose real terminal disagrees with
 * the heuristic.
 */
export function supportsEmoji(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): boolean {
  const e = env ?? process.env;
  const p = platform ?? process.platform;
  if (e["SYMBION_FORCE_ASCII"]) return false;
  if (e["SYMBION_FORCE_EMOJI"]) return true;
  return p !== "win32" || Boolean(e["WT_SESSION"] || e["TERM_PROGRAM"] || e["ConEmuANSI"] === "ON");
}

/**
 * buildBootBanner — returns the exact lines to `console.log` (one call per
 * line, in order). Pure function: same input always produces same output.
 *
 * Non-TTY (piped output, decision #6): always the plain two-line form,
 * identical to today's pre-feature output — zero visual change off-TTY.
 *
 * TTY, terminal too narrow for the longest content line (EC-B.1): also
 * falls back to the plain two-line form rather than a wrapped/staircase
 * border.
 *
 * TTY, wide enough: a top+bottom `=`-only rule (no side walls — see PLAN
 * §P0.5: the reference image never had side borders either, and dropping
 * them means the server URL line stays a single, fully copy-pasteable
 * plain string with nothing appended after it).
 */
export function buildBootBanner(opts: BuildBootBannerOptions): string[] {
  const versionLine = (opts.useEmoji ? "🚀 " : "") + "Symbion v" + opts.version;
  const serverLine = "Symbion daemon running: " + opts.url;

  if (!opts.isTty) {
    return [versionLine, serverLine];
  }

  const longest = Math.max(versionLine.length, serverLine.length);
  const cap =
    opts.terminalColumns && opts.terminalColumns > 0 ? opts.terminalColumns : DEFAULT_TERMINAL_COLUMNS_CAP;

  if (longest + 1 > cap) {
    return [versionLine, serverLine];
  }

  const rule = "=".repeat(Math.min(longest, cap));
  return [rule, versionLine, serverLine, rule];
}
