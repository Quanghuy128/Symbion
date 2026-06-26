import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";

/** Create an isolated temp project dir + redirect the user-level config dir into it via env override. */
export function makeTempRepo(): string {
  return mkdtempSync(join(tmpdir(), "symbion-test-"));
}

export function cleanup(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
