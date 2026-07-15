import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanonicalArtifact } from "@symbion/core";
import { handlers } from "../src/rpc/handlers.js";
import { loadProjectStore, saveProjectStore } from "../src/store/store.js";

const here = fileURLToPath(new URL(".", import.meta.url));

export const FAKE_CLAUDE = join(here, "fixtures", "fake-claude.mjs");
export const FIXTURE_SIMPLE = join(here, "fixtures", "fixture-simple.ndjson");

export const ctx = { port: 20128, version: "0.1.0" };

export interface RunTestEnv {
  configDir: string;
  projectRoot: string;
  projectId: string;
  cleanup: () => void;
}

/** Set up an isolated config dir + a git-init'd project with one published command. */
export async function setupRunEnv(opts?: {
  publishedCommand?: boolean;
  agentName?: string;
  /** reuse an existing config dir (register a 2nd project in the SAME registry). */
  configDir?: string;
}): Promise<RunTestEnv> {
  const configDir = opts?.configDir ?? mkdtempSync(join(tmpdir(), "symbion-run-config-"));
  process.env["SYMBION_CONFIG_DIR"] = configDir;
  const projectRoot = mkdtempSync(join(tmpdir(), "symbion-run-project-"));
  try {
    execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "t"], { cwd: projectRoot, stdio: "ignore" });
    // commit an initial file so the tree is clean by default.
    writeFileSync(join(projectRoot, "README.md"), "# test\n");
    execFileSync("git", ["add", "-A"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: projectRoot, stdio: "ignore" });
  } catch {
    // git may be unavailable; tests that need dirty/clean git handle isRepo false.
  }

  const created = await handlers.createProject({ name: "run-proj", path: projectRoot }, ctx);
  const projectId = created.project.id;

  if (opts?.publishedCommand !== false) {
    const store = loadProjectStore(projectRoot);
    const now = new Date().toISOString();
    const agentRef = opts?.agentName ? `@${opts.agentName}` : "";
    const command: CanonicalArtifact = {
      id: "cmd-analyze-id",
      kind: "command",
      name: "analyze",
      description: "Analyze",
      usesArguments: true,
      body: `Run the analysis. ${agentRef}`,
      meta: {
        version: "0.3.0",
        status: "published",
        createdAt: now,
        updatedAt: now,
        publishedHashes: { claude: "deadbeef" },
      },
    };
    store.artifacts.push(command);
    saveProjectStore(projectRoot, store);
  }

  return {
    configDir,
    projectRoot,
    projectId,
    cleanup: () => {
      rmSync(configDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
      delete process.env["SYMBION_CONFIG_DIR"];
    },
  };
}

/** The legitimate two-phase flow: preflight → take nonce → startRun. */
export async function startTestRun(
  env: RunTestEnv,
  requirement: string,
  overrides?: { model?: string; ackFirstRun?: boolean; artifactId?: string }
): Promise<{ runId: string }> {
  const artifactId = overrides?.artifactId ?? "cmd-analyze-id";
  const pre = await handlers.runPreflight({ projectId: env.projectId, artifactId }, ctx);
  if (!pre.consentNonce) throw new Error("preflight blocked — no nonce");
  const started = await handlers.startRun(
    {
      projectId: env.projectId,
      artifactId,
      requirement,
      model: overrides?.model,
      nonce: pre.consentNonce,
      ackFirstRun: overrides?.ackFirstRun ?? true,
    },
    ctx
  );
  return { runId: started.runId };
}

/** Poll listRuns until the given run reaches a terminal status (or timeout). */
export async function awaitTerminal(env: RunTestEnv, runId: string, timeoutMs = 8_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const terminal = new Set(["completed", "failed", "cancelled", "timedOut"]);
  for (;;) {
    const { runs } = handlers.listRuns({ projectId: env.projectId }, ctx);
    const row = runs.find((r) => r.runId === runId);
    if (row && terminal.has(row.status)) return row.status;
    if (Date.now() > deadline) throw new Error(`run ${runId} did not reach terminal in ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function useFakeCli(mode?: string, extraEnv?: Record<string, string>): void {
  // The fake CLI is an executable .mjs (shebang + chmod +x) — spawnable directly.
  process.env["SYMBION_CLAUDE_BIN"] = FAKE_CLAUDE;
  process.env["FAKE_CLAUDE_FIXTURE"] = FIXTURE_SIMPLE;
  if (mode) process.env["FAKE_CLAUDE_MODE"] = mode;
  else delete process.env["FAKE_CLAUDE_MODE"];
  for (const [k, v] of Object.entries(extraEnv ?? {})) process.env[k] = v;
}

export function clearFakeCli(): void {
  delete process.env["SYMBION_CLAUDE_BIN"];
  delete process.env["FAKE_CLAUDE_FIXTURE"];
  delete process.env["FAKE_CLAUDE_MODE"];
  delete process.env["FAKE_CLAUDE_DELAY_MS"];
  delete process.env["FAKE_CLAUDE_ARGV_OUT"];
  delete process.env["FAKE_CLAUDE_CHILD_PID_OUT"];
}
