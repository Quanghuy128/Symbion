import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DAEMON_ENTRY = fileURLToPath(new URL("../apps/daemon/dist/index.js", import.meta.url));

export interface DaemonHandle {
  url: string;
  port: number;
  token: string;
  projectRoot: string;
  configDir: string;
  stop: () => Promise<void>;
}

const URL_RE = /Symbion daemon đang chạy: (http:\/\/127\.0\.0\.1:(\d+)\/\?t=([0-9a-f]+))/;

/**
 * bootDaemon — spawns the real built daemon (apps/daemon/dist/index.js) against
 * a fresh temp project repo + a fresh temp SYMBION_CONFIG_DIR (so the real repo
 * and the real user-level ~/.config/symbion are never touched by e2e). Parses
 * the boot URL/token off stdout, then leaves the daemon's interactive boot-menu
 * stdin prompt unanswered (harmless — the HTTP server is already listening by
 * the time the URL line is printed; the menu loop runs independently and the
 * process is killed at teardown regardless of menu state).
 */
export async function bootDaemon(opts: { extraEnv?: Record<string, string> } = {}): Promise<DaemonHandle> {
  const projectRoot = mkdtempSync(join(tmpdir(), "symbion-e2e-project-"));
  const configDir = mkdtempSync(join(tmpdir(), "symbion-e2e-config-"));

  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [DAEMON_ENTRY], {
    env: {
      ...process.env,
      SYMBION_CONFIG_DIR: configDir,
      ...opts.extraEnv,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const { url, port, token } = await new Promise<{ url: string; port: number; token: string }>(
    (resolvePromise, rejectPromise) => {
      let buffer = "";
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        const match = URL_RE.exec(buffer);
        if (match) {
          child.stdout.off("data", onData);
          resolvePromise({ url: match[1]!, port: Number(match[2]), token: match[3]! });
        }
      };
      child.stdout.on("data", onData);
      child.on("error", rejectPromise);
      child.on("exit", (code) => {
        if (code !== null && code !== 0) {
          rejectPromise(new Error(`daemon exited early with code ${code}. stdout so far: ${buffer}`));
        }
      });
      setTimeout(() => rejectPromise(new Error(`daemon did not print boot URL within timeout. stdout: ${buffer}`)), 15_000);
    }
  );

  async function stop(): Promise<void> {
    child.kill("SIGTERM");
    await new Promise<void>((resolveStop) => {
      child.once("exit", () => resolveStop());
      setTimeout(resolveStop, 3_000); // don't hang the test suite if the process is stubborn
    });
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
  }

  return { url, port, token, projectRoot, configDir, stop };
}
