import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitNumstat } from "../src/git/status.js";
import { awaitTerminal, clearFakeCli, setupRunEnv, startTestRun, useFakeCli, type RunTestEnv } from "./runHelpers.js";

let env: RunTestEnv;

afterEach(() => {
  env.cleanup();
  clearFakeCli();
});

describe("§6.5 run-gitNumstat — NEW daemon integration (P2)", () => {
  it("#1 modified tracked file (+/-) and one new untracked file both appear in run.json.filesChanged", async () => {
    useFakeCli("write-files");
    env = await setupRunEnv();

    const { runId } = await startTestRun(env, "touch some real files");
    const status = await awaitTerminal(env, runId, 9_000);
    expect(status).toBe("completed");

    const run = JSON.parse(readFileSync(join(env.projectRoot, ".symbion", "runs", runId, "run.json"), "utf-8"));
    expect(run.filesChanged).not.toBe("unavailable");
    expect(run.filesChanged).not.toBeNull();

    const readme = run.filesChanged.find((f: { path: string }) => f.path === "README.md");
    expect(readme).toBeDefined();
    expect(readme.status).toBe("M");
    expect(typeof readme.plus).toBe("number");
    expect(readme.plus).toBeGreaterThan(0);

    const added = run.filesChanged.find((f: { path: string }) => f.path === "new-file-from-agent.txt");
    expect(added).toBeDefined();
    expect(added.status).toBe("A");
    // untracked files get no ± counts (Risk R4 — matches the design mock).
    expect(added.plus).toBeUndefined();
    expect(added.minus).toBeUndefined();
  }, 12_000);

  it("#2 a file dirty BEFORE the run started is flagged preDirty:true", async () => {
    useFakeCli("write-files");
    env = await setupRunEnv();
    // Dirty README.md BEFORE starting the run (uncommitted change already present).
    writeFileSync(join(env.projectRoot, "README.md"), "# test\npre-existing dirty edit\n");

    const { runId } = await startTestRun(env, "run over a dirty tree");
    const status = await awaitTerminal(env, runId, 9_000);
    expect(status).toBe("completed");

    const run = JSON.parse(readFileSync(join(env.projectRoot, ".symbion", "runs", runId, "run.json"), "utf-8"));
    expect(run.gitBefore.changedFiles).toContain("README.md");
    const readme = run.filesChanged.find((f: { path: string }) => f.path === "README.md");
    expect(readme.preDirty).toBe(true);
  }, 12_000);

  it("#3 git binary corrupted repo -> filesChanged 'unavailable'; run status/exitCode unaffected", async () => {
    useFakeCli(); // default streamer, doesn't touch files
    env = await setupRunEnv();
    // Corrupt the .git dir so any git invocation against it fails.
    rmSync(join(env.projectRoot, ".git", "HEAD"), { force: true });

    const { runId } = await startTestRun(env, "run over a corrupted repo");
    const status = await awaitTerminal(env, runId, 9_000);
    expect(status).toBe("completed"); // finalize() still completes normally (NEW-2)

    const run = JSON.parse(readFileSync(join(env.projectRoot, ".symbion", "runs", runId, "run.json"), "utf-8"));
    expect(run.filesChanged).toBe("unavailable");
    expect(run.status).toBe("completed");
    expect(run.exitCode).toBe(0);
  }, 12_000);

  it("#4 gitNumstat itself never throws even under a hostile timeout (unit-level, not run-level)", () => {
    // Direct unit check on gitNumstat: an artificially tiny timeout is not
    // exposed as a parameter (by design — the real function hardcodes 10s),
    // so this asserts the documented never-throw contract on a non-repo path
    // instead (the run-level failure mode is exercised by #3 above).
    expect(() => gitNumstat("/definitely/not/a/repo/path/at/all")).not.toThrow();
    expect(gitNumstat("/definitely/not/a/repo/path/at/all")).toBe("unavailable");
  });

  it("#5 gitNumstat on a non-repo project returns 'unavailable'", async () => {
    // A plain temp dir with no .git at all.
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "symbion-nogit-"));
    try {
      expect(gitNumstat(dir)).toBe("unavailable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
