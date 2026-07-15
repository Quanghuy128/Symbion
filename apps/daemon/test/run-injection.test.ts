import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handlers, RpcError } from "../src/rpc/handlers.js";
import {
  awaitTerminal,
  clearFakeCli,
  ctx,
  setupRunEnv,
  startTestRun,
  useFakeCli,
  type RunTestEnv,
} from "./runHelpers.js";

let env: RunTestEnv;
let argvOutDir: string;

// The hostile requirement — a single string literal, written via the file tool
// (never a shell heredoc; the `careful` hook blocks the literal in Bash).
const INJECTION = '"; rm -rf ~ #';

beforeEach(async () => {
  argvOutDir = mkdtempSync(join(tmpdir(), "symbion-argv-"));
  useFakeCli(undefined, { FAKE_CLAUDE_ARGV_OUT: join(argvOutDir, "argv.json") });
  env = await setupRunEnv();
});

afterEach(() => {
  env.cleanup();
  clearFakeCli();
});

describe("§3.2 run-injection — AC-RUN-6 (P1)", () => {
  it("#1 hostile requirement arrives as ONE literal argv element", async () => {
    const { runId } = await startTestRun(env, INJECTION);
    await awaitTerminal(env, runId);
    const argv: string[] = JSON.parse(readFileSync(join(argvOutDir, "argv.json"), "utf-8"));

    // Exactly one argv element contains the hostile string verbatim...
    const containing = argv.filter((a) => a.includes(INJECTION));
    expect(containing).toHaveLength(1);
    // ...and it's the prompt element, prefixed by the slash command.
    expect(containing[0]).toContain("/analyze");
    expect(containing[0]).toContain(INJECTION);
    // No OTHER element carries a fragment of it.
    const fragments = argv.filter((a) => !a.includes(INJECTION) && (a.includes("rm -rf") || a.includes("#")));
    expect(fragments).toHaveLength(0);
  });

  it("#2 $(...) and backtick command-substitution never execute (no canary file)", async () => {
    const canary1 = join(argvOutDir, "pwned");
    const canary2 = join(argvOutDir, "pwned2");
    const req = `$(touch ${canary1}) \`touch ${canary2}\``;
    const { runId } = await startTestRun(env, req);
    await awaitTerminal(env, runId);
    expect(existsSync(canary1)).toBe(false);
    expect(existsSync(canary2)).toBe(false);
  });

  it("#3 requirement of 10001 chars -> invalid-params, no run dir", async () => {
    const big = "a".repeat(10_001);
    const pre = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    await expect(
      handlers.startRun(
        { projectId: env.projectId, artifactId: "cmd-analyze-id", requirement: big, nonce: pre.consentNonce! },
        ctx
      )
    ).rejects.toMatchObject({ code: "invalid-params" });
    const runsDir = join(env.projectRoot, ".symbion", "runs");
    const dirs = existsSync(runsDir) ? readdirSync(runsDir).filter((d) => d !== ".gitignore") : [];
    expect(dirs).toHaveLength(0);
  });

  it("#4 model = 'foo; rm -rf /' rejected by shape check before spawn", async () => {
    const pre = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    await expect(
      handlers.startRun(
        {
          projectId: env.projectId,
          artifactId: "cmd-analyze-id",
          requirement: "ok",
          model: "foo; rm -rf /",
          nonce: pre.consentNonce!,
        },
        ctx
      )
    ).rejects.toMatchObject({ code: "invalid-params" });
  });
});
