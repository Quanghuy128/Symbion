/**
 * installInstructions — pure OS detection + static install-command lookup table for the
 * Ollama "connect provider" guided-setup panel (docs/loops/connect-providers-STATE.md
 * §10.4). No fs-write, no network, no fs-read even — only `process.platform` (set at
 * Node-process-launch time by the OS the daemon binary itself runs on) and
 * `node:os`'s `release()` (kernel `uname -r` string, used for the WSL heuristic).
 *
 * Pure-data + pure-function shape on purpose: trivially unit-testable without mocking
 * fs/network (Tier B in connect-providers-testplan.md §1), and must be a TOTAL function —
 * every `NodeJS.Platform` value Node can report must produce a well-formed
 * `HostEnvironment`, never throw.
 */
import { release } from "node:os";

export interface HostEnvironment {
  /** what the daemon believes its own host environment is, for install-command selection (EC-3). */
  kind: "wsl" | "linux" | "macos" | "windows" | "unknown";
  /** short human label shown verbatim in the panel's "phát hiện: …" line. */
  label: string;
}

export interface InstallInstructions {
  env: HostEnvironment;
  /** true only when detection is confident enough to show ONE command block. */
  confident: boolean;
  /** one entry per OS variant to show. Length 1 when confident===true; length 4 (all
   *  known variants, labeled) when confident===false, per the design doc's default
   *  "(b) stacked labeled sections" fallback. */
  variants: Array<{ label: string; command: string }>;
}

const UNIX_CURL_INSTALL_COMMAND = "curl -fsSL https://ollama.com/install.sh | sh && ollama serve";
const MACOS_BREW_INSTALL_COMMAND = "brew install ollama && ollama serve";
const WINDOWS_INSTALL_GUIDANCE =
  "Tải và chạy trình cài đặt tại https://ollama.com/download/windows, sau đó mở Ollama từ Start Menu.";

/**
 * detectHostEnvironment — total function: every `process.platform` value Node can
 * report resolves to a well-formed `HostEnvironment`, never throws. `kind: "unknown"`
 * is the explicit escape hatch for non-mainstream platforms (e.g. freebsd) — this never
 * happens for the 4 platforms Symbion is documented to run on.
 *
 * WSL detection: WSL's kernel release string contains "microsoft" or "wsl"
 * (case-insensitive) — e.g. "5.15.90.1-microsoft-standard-WSL2" or
 * "6.6.87.2-microsoft-standard-WSL2" (this exact session's own env, per EC-3's
 * must-not-mishandle case). This is the same heuristic the `is-wsl` npm package and
 * most Node tooling already use — no /proc read needed since `os.release()` already
 * exposes the `uname -r` string.
 */
export function detectHostEnvironment(): HostEnvironment {
  const plat = process.platform;
  if (plat === "darwin") return { kind: "macos", label: "macOS" };
  if (plat === "win32") return { kind: "windows", label: "Windows" };
  if (plat === "linux") {
    const rel = release().toLowerCase();
    if (rel.includes("microsoft") || rel.includes("wsl")) {
      return { kind: "wsl", label: "WSL2 (Ubuntu trên Windows)" };
    }
    return { kind: "linux", label: "Linux" };
  }
  return { kind: "unknown", label: "Không xác định" };
}

/** All 4 known variants, labeled — shown together when detection is not confident. */
function allKnownVariants(): Array<{ label: string; command: string }> {
  return [
    { label: "macOS", command: MACOS_BREW_INSTALL_COMMAND },
    { label: "Linux", command: UNIX_CURL_INSTALL_COMMAND },
    { label: "WSL2 (Ubuntu trên Windows)", command: UNIX_CURL_INSTALL_COMMAND },
    { label: "Windows", command: WINDOWS_INSTALL_GUIDANCE },
  ];
}

function commandForKind(kind: HostEnvironment["kind"]): string {
  switch (kind) {
    case "macos":
      return MACOS_BREW_INSTALL_COMMAND;
    case "linux":
    case "wsl":
      return UNIX_CURL_INSTALL_COMMAND;
    case "windows":
      return WINDOWS_INSTALL_GUIDANCE;
    case "unknown":
    default:
      return UNIX_CURL_INSTALL_COMMAND;
  }
}

/**
 * getOllamaInstallInstructions — `confident: true` (`kind !== "unknown"`) returns exactly
 * 1 variant matching the detected OS. `confident: false` (`kind === "unknown"`) returns
 * all 4 known variants, labeled, per the design doc's Open Question 2 default
 * "(b) stacked labeled sections" — never silently guesses wrong.
 */
export function getOllamaInstallInstructions(env: HostEnvironment): InstallInstructions {
  if (env.kind === "unknown") {
    return { env, confident: false, variants: allKnownVariants() };
  }
  return { env, confident: true, variants: [{ label: env.label, command: commandForKind(env.kind) }] };
}
