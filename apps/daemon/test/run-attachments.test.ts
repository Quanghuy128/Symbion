import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderRunCommand } from "@symbion/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handlers } from "../src/rpc/handlers.js";
import { prune, reconcile } from "../src/run/runStore.js";
import { spawnStdioFor } from "../src/run/runManager.js";
import { buildArgv } from "../src/run/cliDriver.js";
import {
  GIF_1x1,
  PNG_1x1,
  PNG_SENTINEL,
  SENTINEL,
  WEBP_TINY,
  b64,
  pngOfSize,
} from "./attachmentFixtures.js";
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
let scratch: string;

const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const runDir = (id: string): string => join(env.projectRoot, ".symbion", "runs", id);
const readRun = (id: string) => JSON.parse(readFileSync(join(runDir(id), "run.json"), "utf-8"));
const att = (name: string, mediaType: string, bytes: Uint8Array) => ({ name, mediaType, bytes });

beforeEach(async () => {
  scratch = join(tmpdir(), `symbion-att-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(scratch, { recursive: true });
  useFakeCli(undefined, {
    FAKE_CLAUDE_ARGV_OUT: join(scratch, "argv.json"),
    FAKE_CLAUDE_STDIN_OUT: join(scratch, "stdin.json"),
  });
  env = await setupRunEnv();
});

afterEach(() => {
  env.cleanup();
  clearFakeCli();
  rmSync(scratch, { recursive: true, force: true });
});

describe("run-image-paste: happy path + storage (DI1-DI6)", () => {
  it("DI1/DI2 AC-1: one NDJSON user message (image then text) over stdin, no prompt in argv", async () => {
    const { runId } = await startTestRun(env, "fix the header", { attachments: [att("a.png", "image/png", PNG_1x1)] });
    expect(await awaitTerminal(env, runId)).toBe("completed");

    const cap = JSON.parse(readFileSync(join(scratch, "stdin.json"), "utf-8"));
    expect(["socket", "fifo"]).toContain(cap.stdinKind); // a pipe (node uses a socketpair on Linux), not /dev/null
    const lines = (cap.stdin as string).split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const msg = JSON.parse(lines[0]!);
    expect(msg.type).toBe("user");
    expect(msg.message.content).toHaveLength(2);
    expect(msg.message.content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: b64(PNG_1x1) },
    });
    expect(msg.message.content[1]).toEqual({
      type: "text",
      text: renderRunCommand({ command: "analyze", requirements: "fix the header" }),
    });

    const argv = JSON.parse(readFileSync(join(scratch, "argv.json"), "utf-8")) as string[];
    expect(argv.slice(0, 8)).toEqual([
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      expect.any(String),
    ]);
    expect(argv.some((a) => a.includes("fix the header"))).toBe(false);
    expect(argv).not.toContain("--replay-user-messages");
  });

  it("DI3/DI4/DI5 order, generated names, bytes, sha, metadata-only run.json", async () => {
    const { runId } = await startTestRun(env, "go", {
      attachments: [
        att("screenshot.PNG", "image/png", PNG_1x1),
        att("p.webp", "image/webp", WEBP_TINY),
        att("../../evil\n.gif", "image/gif", GIF_1x1),
      ],
    });
    await awaitTerminal(env, runId);

    const msg = JSON.parse((JSON.parse(readFileSync(join(scratch, "stdin.json"), "utf-8")).stdin as string).trim());
    expect(msg.message.content.map((c: { type: string; source?: { media_type: string } }) => c.source?.media_type ?? c.type)).toEqual([
      "image/png",
      "image/webp",
      "image/gif",
      "text",
    ]);

    const dir = join(runDir(runId), "attachments");
    expect(readdirSync(dir).sort()).toEqual(["1.png", "2.webp", "3.gif"]);
    const run = readRun(runId);
    expect(run.attachments).toHaveLength(3);
    const inputs = [PNG_1x1, WEBP_TINY, GIF_1x1];
    run.attachments.forEach((a: Record<string, unknown>, i: number) => {
      expect(Object.keys(a).sort()).toEqual(["file", "index", "mediaType", "name", "sha256", "size"]);
      expect(a["index"]).toBe(i);
      expect(sha(readFileSync(join(dir, a["file"] as string)))).toBe(a["sha256"]);
      expect(a["sha256"]).toBe(sha(inputs[i]!));
      expect(a["size"]).toBe(inputs[i]!.length);
      expect(Buffer.compare(readFileSync(join(dir, a["file"] as string)), Buffer.from(inputs[i]!))).toBe(0);
    });
    expect(run.attachments[0].name).toBe("screenshot.PNG");
    expect(run.attachments[2].name).not.toMatch(/[\n]/);
    expect(readdirSync(dir).some((f) => f.includes("symbion-tmp"))).toBe(false);
  });

  it("DI6 listRuns carries attachmentCount; getRunEvents carries run.attachments", async () => {
    const { runId } = await startTestRun(env, "go", {
      attachments: [att("a.png", "image/png", PNG_1x1), att("b.gif", "image/gif", GIF_1x1)],
    });
    await awaitTerminal(env, runId);
    const row = handlers.listRuns({ projectId: env.projectId }, ctx).runs.find((r) => r.runId === runId)!;
    expect(row.attachmentCount).toBe(2);
    const ev = handlers.getRunEvents({ projectId: env.projectId, runId, afterSeq: 0 }, ctx);
    expect(ev.run.attachments).toHaveLength(2);
  });
});

describe("run-image-paste: text-only regression (DI7-DI9, AC-4)", () => {
  it("DI7 argv is the hard-coded pre-feature array, stdin is ignored (/dev/null)", async () => {
    const { runId } = await startTestRun(env, "add limits");
    await awaitTerminal(env, runId);
    const argv = JSON.parse(readFileSync(join(scratch, "argv.json"), "utf-8")) as string[];
    expect(argv.slice(0, 7)).toEqual([
      "-p",
      "/analyze add limits",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      expect.any(String),
    ]);
    expect(argv).not.toContain("--input-format");
    const cap = JSON.parse(readFileSync(join(scratch, "stdin.json"), "utf-8"));
    expect(cap.stdinKind).toBe("char");
    expect(cap.stdin).toBe("");
  });

  it("DI8 buildArgv default === argv mode; spawnStdioFor", () => {
    const base = { commandName: "analyze", requirement: "x", permissionMode: "acceptEdits", allowedTools: [] };
    expect(buildArgv(base)).toEqual(buildArgv({ ...base, inputMode: "argv" }));
    expect(buildArgv(base)).toEqual([
      "-p",
      renderRunCommand({ command: "analyze", requirements: "x" }),
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
    ]);
    expect(spawnStdioFor(false)).toEqual(["ignore", "pipe", "pipe"]);
    expect(spawnStdioFor(true)).toEqual(["pipe", "pipe", "pipe"]);
  });

  it("DI9 no attachments dir / key / count; attachments:[] behaves like omitted", async () => {
    const { runId } = await startTestRun(env, "plain");
    await awaitTerminal(env, runId);
    expect(existsSync(join(runDir(runId), "attachments"))).toBe(false);
    expect("attachments" in readRun(runId)).toBe(false);
    expect(handlers.listRuns({ projectId: env.projectId }, ctx).runs[0]).not.toHaveProperty("attachmentCount");

    const pre = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    const started = await handlers.startRun(
      {
        projectId: env.projectId,
        artifactId: "cmd-analyze-id",
        requirement: "empty list",
        nonce: pre.consentNonce!,
        ackFirstRun: true,
        attachments: [],
      },
      ctx
    );
    await awaitTerminal(env, started.runId);
    expect("attachments" in readRun(started.runId)).toBe(false);
    expect(existsSync(join(runDir(started.runId), "attachments"))).toBe(false);
  });
});

describe("run-image-paste: no base64 leaks (DI19-DI21, AC-5)", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  }

  it("DI19 the sentinel is only in attachments/1.png's... bytes, never as text anywhere", async () => {
    const logs: string[] = [];
    const spies = (["log", "warn", "error"] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")))
    );
    try {
      const { runId } = await startTestRun(env, "go", { attachments: [att("s.png", "image/png", PNG_SENTINEL)] });
      await awaitTerminal(env, runId);
      for (const f of walk(join(env.projectRoot, ".symbion"))) {
        if (f.includes(`${runId}/attachments/`)) continue; // raw bytes, not base64 text
        expect(readFileSync(f, "utf-8"), f).not.toContain(SENTINEL);
      }
      expect(readFileSync(join(scratch, "argv.json"), "utf-8")).not.toContain(SENTINEL);
      expect(logs.join("\n")).not.toContain(SENTINEL);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  it("DI20 stderr-echo-stdin: failed run, errorMessage redacted + line-capped", async () => {
    useFakeCli("stderr-echo-stdin");
    const { runId } = await startTestRun(env, "go", { attachments: [att("s.png", "image/png", PNG_SENTINEL)] });
    expect(await awaitTerminal(env, runId)).toBe("failed");
    const run = readRun(runId);
    expect(run.errorMessage).toContain("[base64 omitted:");
    expect(run.errorMessage).not.toContain(SENTINEL);
    for (const line of (run.errorMessage as string).split("\n")) expect(line.length).toBeLessThanOrEqual(2_001 + 80);
  });

  it("DI21 an unknown event echoing base64 is redacted in events.jsonl", async () => {
    const fixture = join(scratch, "echo.ndjson");
    writeFileSync(
      fixture,
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: "s", model: "m", permissionMode: "default", claude_code_version: "2.1.187", slash_commands: [] }),
        JSON.stringify({ type: "debug_echo", payload: b64(PNG_SENTINEL).repeat(5) }),
        JSON.stringify({ type: "result", subtype: "success", is_error: false }),
      ].join("\n") + "\n"
    );
    process.env["FAKE_CLAUDE_FIXTURE"] = fixture;
    const { runId } = await startTestRun(env, "go", { attachments: [att("s.png", "image/png", PNG_SENTINEL)] });
    await awaitTerminal(env, runId);
    const events = readFileSync(join(runDir(runId), "events.jsonl"), "utf-8");
    expect(events).toContain("[base64 omitted:");
    expect(events).not.toContain(SENTINEL);
  });
});

describe("run-image-paste: consent binding (DI22-DI24, AC-8)", () => {
  const meta = (b: Uint8Array, size = b.length) => ({ sha256: sha(b), size, mediaType: "image/png" });
  const A = PNG_1x1;
  const B = pngOfSize(200);

  async function start(nonce: string | undefined, atts: Uint8Array[] | null) {
    return handlers.startRun(
      {
        projectId: env.projectId,
        artifactId: "cmd-analyze-id",
        requirement: "x",
        nonce: nonce as string,
        ackFirstRun: true,
        ...(atts ? { attachments: atts.map((b, i) => ({ name: `i${i}`, mediaType: "image/png", data: b64(b) })) } : {}),
      },
      ctx
    );
  }
  const pre = (atts?: ReturnType<typeof meta>[]) =>
    handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id", ...(atts ? { attachments: atts } : {}) }, ctx);

  it("DI22 nonce minted for [A] cannot start [B]; burned; no spawn", async () => {
    const p = await pre([meta(A)]);
    await expect(start(p.consentNonce, [B])).rejects.toMatchObject({ code: "run-consent-required" });
    expect(existsSync(join(scratch, "argv.json"))).toBe(false);
    await expect(start(p.consentNonce, [A])).rejects.toMatchObject({ code: "run-consent-required" });
  });

  it("DI23 empty-digest vs attachments mismatch (both directions)", async () => {
    const p0 = await pre();
    await expect(start(p0.consentNonce, [A])).rejects.toMatchObject({ code: "run-consent-required" });
    const p1 = await pre([meta(A)]);
    await expect(start(p1.consentNonce, null)).rejects.toMatchObject({ code: "run-consent-required" });
  });

  it("DI24 order matters; claimed size off by one rejects", async () => {
    const pAB = await pre([meta(A), meta(B)]);
    await expect(start(pAB.consentNonce, [B, A])).rejects.toMatchObject({ code: "run-consent-required" });
    const pOff = await pre([meta(A, A.length + 1)]);
    await expect(start(pOff.consentNonce, [A])).rejects.toMatchObject({ code: "run-consent-required" });
  });

  it("DI14 preflight validates metadata + returns the attachments sentence", async () => {
    const good = [meta(A), meta(B, 3565158)];
    const r = await pre(good);
    expect(r.consentNonce).toBeTruthy();
    expect(r.permissionSummary.attachmentsSentence).toMatch(/2 images/);
    expect(r.permissionSummary.attachmentsSentence).toMatch(/MB/);
    expect(r.permissionSummary.attachmentsSentence).toMatch(/\.symbion\/runs/);
    expect(r.invocationEcho).toContain("--input-format stream-json");
    const bad: unknown[][] = [
      [{ sha256: "a".repeat(63), size: 10, mediaType: "image/png" }],
      [{ sha256: "A".repeat(64), size: 10, mediaType: "image/png" }],
      [{ sha256: "a".repeat(64), size: 0, mediaType: "image/png" }],
      [{ sha256: "a".repeat(64), size: -5, mediaType: "image/png" }],
      [{ sha256: "a".repeat(64), size: 10.5, mediaType: "image/png" }],
      [{ sha256: "a".repeat(64), size: Number.NaN, mediaType: "image/png" }],
      [{ sha256: "a".repeat(64), size: 5242881, mediaType: "image/png" }],
      Array.from({ length: 6 }, () => ({ sha256: "a".repeat(64), size: 10, mediaType: "image/png" })),
      [{ sha256: "a".repeat(64), size: 10, mediaType: "image/bmp" }],
    ];
    for (const attachments of bad) {
      await expect(pre(attachments as never)).rejects.toMatchObject({ code: "invalid-params" });
    }
  });
});

describe("run-image-paste: version gate (DI26-DI28, AC-10)", () => {
  const meta = { sha256: sha(PNG_1x1), size: PNG_1x1.length, mediaType: "image/png" };
  const pre = (withAtt: boolean) =>
    handlers.runPreflight(
      { projectId: env.projectId, artifactId: "cmd-analyze-id", ...(withAtt ? { attachments: [meta] } : {}) },
      ctx
    );

  it("DI26 old CLI: text-only preflight fine + unsupported; text-only run completes", async () => {
    process.env["FAKE_CLAUDE_VERSION"] = "0.2.9";
    const r = await pre(false);
    expect(r.blocked).toBe(false);
    expect(r.consentNonce).toBeTruthy();
    expect(r.attachmentSupport.supported).toBe(false);
    expect(r.attachmentSupport.reason).toContain("2.1.187");
    const { runId } = await startTestRun(env, "text only");
    expect(await awaitTerminal(env, runId)).toBe("completed");
  });

  it("DI27 old CLI + attachments: preflight blocks (no nonce); crafted startRun rejected, slot released", async () => {
    process.env["FAKE_CLAUDE_VERSION"] = "0.2.9";
    const r = await pre(true);
    expect(r.blocked).toBe(true);
    expect(r.checks.find((c) => c.id === "attachments")?.severity).toBe("block");
    expect(r.consentNonce).toBeUndefined();

    process.env["FAKE_CLAUDE_VERSION"] = "2.1.187";
    const ok = await pre(true);
    process.env["FAKE_CLAUDE_VERSION"] = "0.2.9";
    await expect(
      handlers.startRun(
        {
          projectId: env.projectId,
          artifactId: "cmd-analyze-id",
          requirement: "x",
          nonce: ok.consentNonce!,
          attachments: [{ name: "a", mediaType: "image/png", data: b64(PNG_1x1) }],
        },
        ctx
      )
    ).rejects.toMatchObject({ code: "run-attachments-unsupported" });
    expect(existsSync(join(env.projectRoot, ".symbion", "runs"))).toBe(false);
    const { runId } = await startTestRun(env, "text only again"); // reservation was released
    await awaitTerminal(env, runId);
  });

  it("DI28 unknown version fails closed for attachments; 2.1.187 is the boundary", async () => {
    process.env["FAKE_CLAUDE_VERSION"] = "garbage";
    expect((await pre(false)).attachmentSupport.supported).toBe(false);
    expect((await pre(true)).blocked).toBe(true);
    process.env["FAKE_CLAUDE_VERSION"] = "2.1.187";
    expect((await pre(false)).attachmentSupport.supported).toBe(true);
    process.env["FAKE_CLAUDE_VERSION"] = "2.1.186";
    expect((await pre(false)).attachmentSupport.supported).toBe(false);
  });
});

describe("run-image-paste: EPIPE / failure paths (DI29-DI33, AC-11)", () => {
  it("DI29 CLI exits 0 without reading a 4 MiB payload -> failed, daemon alive, slot released", async () => {
    useFakeCli("exit-no-read");
    const uncaught = vi.fn();
    process.on("uncaughtException", uncaught);
    try {
      const { runId } = await startTestRun(env, "go", { attachments: [att("big.png", "image/png", pngOfSize(4 * 1024 * 1024))] });
      expect(await awaitTerminal(env, runId)).toBe("failed");
      expect(readRun(runId).errorMessage).toContain("exited before it received the attached images");
      expect(uncaught).not.toHaveBeenCalled();
      expect(handlers.listRuns({ projectId: env.projectId }, ctx).runs.length).toBeGreaterThan(0);
      useFakeCli();
      const next = await startTestRun(env, "text only after");
      expect(await awaitTerminal(env, next.runId)).toBe("completed");
    } finally {
      process.off("uncaughtException", uncaught);
    }
  });

  it("DI30 same with exit code 1", async () => {
    useFakeCli("exit-no-read", { FAKE_CLAUDE_EXIT_CODE: "1" });
    const { runId } = await startTestRun(env, "go", { attachments: [att("big.png", "image/png", pngOfSize(4 * 1024 * 1024))] });
    expect(await awaitTerminal(env, runId)).toBe("failed");
    expect(readRun(runId).exitCode).toBe(1);
  });

  it("DI31 cancel while a non-reading CLI blocks the write -> cancelled wins", async () => {
    useFakeCli("hang");
    const { runId } = await startTestRun(env, "go", { attachments: [att("big.png", "image/png", pngOfSize(4 * 1024 * 1024))] });
    handlers.cancelRun({ projectId: env.projectId, runId }, ctx);
    expect(await awaitTerminal(env, runId, 12_000)).toBe("cancelled");
  });

  it.skipIf(process.getuid?.() === 0)("DI32 store failure -> attachment-store-failed, no partial dir, recoverable", async () => {
    const runsDir = join(env.projectRoot, ".symbion", "runs");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, ".gitignore"), "*\n");
    chmodSync(runsDir, 0o555);
    try {
      await expect(
        startTestRun(env, "go", { attachments: [att("a.png", "image/png", PNG_1x1)] })
      ).rejects.toMatchObject({ code: "attachment-store-failed" });
      expect(readdirSync(runsDir).filter((n) => n !== ".gitignore")).toEqual([]);
      expect(existsSync(join(scratch, "argv.json"))).toBe(false);
    } finally {
      chmodSync(runsDir, 0o755);
    }
    const { runId } = await startTestRun(env, "go", { attachments: [att("a.png", "image/png", PNG_1x1)] });
    expect(await awaitTerminal(env, runId)).toBe("completed");
  });

  it("DI33b normal small payload still ends completed (finish/close ordering)", async () => {
    const { runId } = await startTestRun(env, "go", { attachments: [att("a.png", "image/png", PNG_1x1)] });
    expect(await awaitTerminal(env, runId)).toBe("completed");
    expect(readRun(runId).errorMessage ?? null).toBeNull();
  });

  it("DI33c spawn ENOENT with attachments (binary vanishes after the version probe) -> failed, no unhandled error", async () => {
    // Answers --version twice (preflight + startRun probe), then deletes itself so spawn() gets ENOENT.
    const bin = join(scratch, "vanishing-claude");
    const counter = join(scratch, "probe-count");
    writeFileSync(
      bin,
      `#!/bin/sh\nn=$(cat "${counter}" 2>/dev/null || echo 0)\nn=$((n+1))\necho $n > "${counter}"\necho "2.1.187 (Claude Code)"\n[ "$n" -ge 2 ] && rm -f "$0"\nexit 0\n`
    );
    chmodSync(bin, 0o755);
    process.env["SYMBION_CLAUDE_BIN"] = bin;
    const uncaught = vi.fn();
    process.on("uncaughtException", uncaught);
    try {
      const { runId } = await startTestRun(env, "go", { attachments: [att("a.png", "image/png", PNG_1x1)] });
      expect(await awaitTerminal(env, runId)).toBe("failed");
      expect(readRun(runId).errorMessage).toMatch(/ENOENT/);
      expect(uncaught).not.toHaveBeenCalled();
    } finally {
      process.off("uncaughtException", uncaught);
    }
  });

  it("DI33 missing binary with attachments -> failed run, no unhandled stdin error", async () => {
    process.env["SYMBION_CLAUDE_BIN"] = join(scratch, "nonexistent-claude");
    const uncaught = vi.fn();
    process.on("uncaughtException", uncaught);
    try {
      // version probe -> "unknown" -> attachments fail closed BEFORE spawn.
      await expect(
        startTestRun(env, "go", { attachments: [att("a.png", "image/png", PNG_1x1)] })
      ).rejects.toBeTruthy();
      expect(uncaught).not.toHaveBeenCalled();
    } finally {
      process.off("uncaughtException", uncaught);
    }
  });
});

describe("run-image-paste: read RPC + retention (DI34-DI38)", () => {
  const read = (runId: string, index: unknown) =>
    handlers.readRunAttachment({ projectId: env.projectId, runId, index: index as number }, ctx);

  async function oneRun(): Promise<string> {
    const { runId } = await startTestRun(env, "go", { attachments: [att("a.png", "image/png", PNG_1x1)] });
    await awaitTerminal(env, runId);
    return runId;
  }

  it("DI34 returns the exact stored bytes", async () => {
    const runId = await oneRun();
    const r = read(runId, 0);
    expect(r.mediaType).toBe("image/png");
    expect(r.size).toBe(PNG_1x1.length);
    expect(r.data).toBe(b64(PNG_1x1));
  });

  it("DI35 rejections", async () => {
    const runId = await oneRun();
    for (const bad of ["../../etc", "not-a-uuid"]) expect(() => read(bad, 0)).toThrowError(/Invalid runId|invalid/i);
    for (const idx of [5, -1, 1.5, "0", "1.png"]) expect(() => read(runId, idx)).toThrow();
    for (const idx of [5, -1, 1.5, "0", "1.png"]) {
      try {
        read(runId, idx);
      } catch (e) {
        expect((e as { code: string }).code).toBe("invalid-params");
      }
    }
    expect(() => read(runId, 1)).toThrowError(expect.objectContaining({ code: "not-found" }));
    expect(() => read("11111111-1111-4111-8111-111111111111", 0)).toThrowError(expect.objectContaining({ code: "not-found" }));

    const text = await startTestRun(env, "plain");
    await awaitTerminal(env, text.runId);
    expect(() => read(text.runId, 0)).toThrowError(expect.objectContaining({ code: "not-found" }));

    // hand-edited run.json file field
    const runJson = join(runDir(runId), "run.json");
    const orig = readFileSync(runJson, "utf-8");
    for (const evil of ["../run.json", "/etc/passwd"]) {
      const edited = JSON.parse(orig);
      edited.attachments[0].file = evil;
      writeFileSync(runJson, JSON.stringify(edited));
      expect(() => read(runId, 0)).toThrowError(expect.objectContaining({ code: expect.stringMatching(/attachment-corrupt|path-confinement/) }));
    }
    writeFileSync(runJson, orig);

    // symlink swap
    const file = join(runDir(runId), "attachments", "1.png");
    const bytes = readFileSync(file);
    rmSync(file);
    symlinkSync("/etc/hostname", file);
    expect(() => read(runId, 0)).toThrowError(expect.objectContaining({ code: "path-confinement" }));
    rmSync(file);

    // content swap -> sha mismatch
    writeFileSync(file, pngOfSize(50));
    expect(() => read(runId, 0)).toThrowError(expect.objectContaining({ code: "attachment-corrupt" }));
    writeFileSync(file, bytes);
    expect(read(runId, 0).data).toBe(b64(PNG_1x1));
  });

  it("DI36 retention deletes attachments with the run; kept run intact", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await oneRun());
    prune(env.projectRoot, 1);
    const kept = ids.filter((id) => existsSync(runDir(id)));
    expect(kept).toHaveLength(1);
    for (const id of ids.filter((i) => !kept.includes(i))) {
      expect(existsSync(runDir(id))).toBe(false);
      expect(() => read(id, 0)).toThrowError(expect.objectContaining({ code: "not-found" }));
    }
    expect(read(kept[0]!, 0).data).toBe(b64(PNG_1x1));
  });

  it("DI37 daemon restart mid-run keeps attachments readable", async () => {
    useFakeCli("hang");
    const { runId } = await startTestRun(env, "go", { attachments: [att("a.png", "image/png", PNG_1x1)] });
    reconcile(env.projectRoot, new Set());
    const run = readRun(runId);
    expect(run.status).toBe("failed");
    expect(run.errorMessage).toBe("daemon-restarted");
    expect(read(runId, 0).data).toBe(b64(PNG_1x1));
    handlers.cancelRun({ projectId: env.projectId, runId }, ctx);
    await awaitTerminal(env, runId, 12_000);
  });

  it("DI38 'Run again': preflight lastRun carries the text only", async () => {
    await oneRun();
    const pre = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
    expect(pre.lastRun?.requirement).toBe("go");
    expect(Object.keys(pre.lastRun ?? {}).some((k) => /attach/i.test(k))).toBe(false);
  });
});
