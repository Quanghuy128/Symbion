import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handlers } from "../src/rpc/handlers.js";
import { NonceStore } from "../src/run/nonces.js";
import { loadProjectStore, saveProjectStore } from "../src/store/store.js";
import {
  awaitTerminal,
  clearFakeCli,
  ctx,
  setupRunEnv,
  useFakeCli,
  type RunTestEnv,
} from "./runHelpers.js";
import type { CanonicalArtifact } from "@symbion/core";

let env: RunTestEnv;

beforeEach(async () => {
  useFakeCli();
  env = await setupRunEnv();
});

afterEach(() => {
  env.cleanup();
  clearFakeCli();
});

function noRunDirs(): number {
  const runsDir = join(env.projectRoot, ".symbion", "runs");
  if (!existsSync(runsDir)) return 0;
  return readdirSync(runsDir).filter((d) => d !== ".gitignore").length;
}

describe("§3.3 run-nonce — AC-RUN-10 (P1)", () => {
  it("#1 no nonce / empty string -> run-consent-required, nothing spawned", async () => {
    await expect(
      handlers.startRun({ projectId: env.projectId, artifactId: "cmd-analyze-id", requirement: "x", nonce: "" }, ctx)
    ).rejects.toMatchObject({ code: "run-consent-required" });
    expect(noRunDirs()).toBe(0);
  });

  it("#2 random 64-hex nonce never minted -> rejected", async () => {
    const fake = "a".repeat(64);
    await expect(
      handlers.startRun({ projectId: env.projectId, artifactId: "cmd-analyze-id", requirement: "x", nonce: fake }, ctx)
    ).rejects.toMatchObject({ code: "run-consent-required" });
    expect(noRunDirs()).toBe(0);
  });

  it("#3 valid nonce used twice -> 1st ok, 2nd rejected (single-use)", async () => {
    const pre = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    const nonce = pre.consentNonce!;
    const first = await handlers.startRun(
      { projectId: env.projectId, artifactId: "cmd-analyze-id", requirement: "x", nonce },
      ctx
    );
    await awaitTerminal(env, first.runId);
    await expect(
      handlers.startRun({ projectId: env.projectId, artifactId: "cmd-analyze-id", requirement: "x", nonce }, ctx)
    ).rejects.toMatchObject({ code: "run-consent-required" });
  });

  it("#4 nonce minted for artifact A, spent on artifact B -> rejected (binding)", async () => {
    // add a second published command B.
    const store = loadProjectStore(env.projectRoot);
    const now = new Date().toISOString();
    const cmdB: CanonicalArtifact = {
      id: "cmd-b-id",
      kind: "command",
      name: "build",
      description: "Build",
      body: "Build it.",
      meta: { version: "0.1.0", status: "published", createdAt: now, updatedAt: now, publishedHashes: { claude: "x" } },
    };
    store.artifacts.push(cmdB);
    saveProjectStore(env.projectRoot, store);

    const preA = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    await expect(
      handlers.startRun(
        { projectId: env.projectId, artifactId: "cmd-b-id", requirement: "x", nonce: preA.consentNonce! },
        ctx
      )
    ).rejects.toMatchObject({ code: "run-consent-required" });
  });

  it("#5 expired nonce -> rejected (TTL-injectable NonceStore)", () => {
    let clock = 1_000;
    const store = new NonceStore({ ttlMs: 50, now: () => clock });
    const nonce = store.mint({ projectId: "p", artifactId: "a", configHash: "h" });
    clock = 1_200; // > 50ms later
    expect(store.consume(nonce, { projectId: "p", artifactId: "a", configHash: "h" })).toBe(false);
  });

  it("#6 config change between preflight and start -> rejected (configHash mismatch)", async () => {
    const pre = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    // Change permissionMode via updateSettings.
    const store = loadProjectStore(env.projectRoot);
    store.settings.run = {
      permissionMode: "plan",
      allowedTools: [],
      ceilings: { wallClockMs: 1_800_000, tokenCap: 200_000 },
    };
    await handlers.updateSettings({ projectId: env.projectId, settings: store.settings }, ctx);

    await expect(
      handlers.startRun(
        { projectId: env.projectId, artifactId: "cmd-analyze-id", requirement: "x", nonce: pre.consentNonce! },
        ctx
      )
    ).rejects.toMatchObject({ code: "run-consent-required" });
  });

  it("#7 preflight on a DRAFT artifact -> blocked, no consentNonce", async () => {
    const store = loadProjectStore(env.projectRoot);
    const now = new Date().toISOString();
    const draft: CanonicalArtifact = {
      id: "cmd-draft-id",
      kind: "command",
      name: "draftcmd",
      description: "Draft",
      body: "x",
      meta: { version: "draft", status: "draft", createdAt: now, updatedAt: now },
    };
    store.artifacts.push(draft);
    saveProjectStore(env.projectRoot, store);

    const pre = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-draft-id" }, ctx);
    expect(pre.blocked).toBe(true);
    expect(pre.consentNonce).toBeUndefined();

    // A forged startRun with a stale nonce from artifact A also fails (draft block).
    const preA = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    await expect(
      handlers.startRun(
        { projectId: env.projectId, artifactId: "cmd-draft-id", requirement: "x", nonce: preA.consentNonce! },
        ctx
      )
    ).rejects.toMatchObject({ code: "run-draft-blocked" });
  });
});
