/**
 * cliVersion — a small `claude --version` probe used by startRun to stamp
 * run.json's `cliVersion` (the init event cross-checks it). Argv-array execFile
 * (precedent git/status.ts); returns "unknown" on any failure (spawn-time
 * detection catches a genuinely-missing CLI as a failed run — ER-2).
 */
import { execFile } from "node:child_process";

export function getRunCliVersion(bin: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { timeout: 5_000 }, (err, stdout) => {
      if (err) {
        resolve("unknown");
        return;
      }
      const match = /(\d+\.\d+\.\d+)/.exec(stdout);
      resolve(match ? match[1]! : "unknown");
    });
  });
}
