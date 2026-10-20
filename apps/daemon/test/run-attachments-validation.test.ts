import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handlers } from "../src/rpc/handlers.js";
import { SENTINEL, PNG_1x1, PNG_SENTINEL, SVG_BYTES, ZIP_BYTES, GIF_1x1, b64, pngOfSize } from "./attachmentFixtures.js";
import { awaitTerminal, clearFakeCli, ctx, setupRunEnv, startTestRun, useFakeCli, type RunTestEnv } from "./runHelpers.js";

let env: RunTestEnv;

beforeEach(async () => {
  useFakeCli();
  env = await setupRunEnv();
});
afterEach(() => {
  env.cleanup();
  clearFakeCli();
});

/** startRun with a (valid, text-only) nonce and arbitrary raw `attachments`. */
async function startWith(attachments: unknown) {
  const pre = await handlers.runPreflight({ projectId: env.projectId, artifactId: "cmd-analyze-id" }, ctx);
  return handlers.startRun(
    {
      projectId: env.projectId,
      artifactId: "cmd-analyze-id",
      requirement: "x",
      nonce: pre.consentNonce!,
      ackFirstRun: true,
      attachments: attachments as never,
    },
    ctx
  );
}
const item = (bytes: Uint8Array, mediaType = "image/png", name = "a.png") => ({ name, mediaType, data: b64(bytes) });

const runDirCount = (): number => {
  const d = join(env.projectRoot, ".symbion", "runs");
  return existsSync(d) ? readdirSync(d).filter((n) => n !== ".gitignore").length : 0;
};

async function expectInvalid(attachments: unknown, secret?: string) {
  const before = runDirCount();
  let err: { code?: string; message?: string } | undefined;
  try {
    await startWith(attachments);
  } catch (e) {
    err = e as never;
  }
  expect(err?.code).toBe("invalid-params");
  if (secret) expect(err?.message).not.toContain(secret);
  // no run dir created, and the slot is free for the next valid text-only run.
  expect(runDirCount()).toBe(before);
  const { runId } = await startTestRun(env, "still works");
  await awaitTerminal(env, runId);
}

describe("run-image-paste validation (DI11-DI13, AC-2/AC-3 daemon side)", () => {
  it("DI11 limits: 6 items, >5 MiB, total >20 MiB, 0 bytes", async () => {
    await expectInvalid(Array.from({ length: 6 }, () => item(PNG_1x1)));
  });
  it("DI11b one item over 5 MiB", async () => {
    await expectInvalid([item(pngOfSize(5 * 1024 * 1024 + 1))]);
  });
  it("DI11c total over 20 MiB (5 x 4.5 MiB)", async () => {
    await expectInvalid(Array.from({ length: 5 }, () => item(pngOfSize(Math.floor(4.5 * 1024 * 1024)))));
  });
  it("DI11d 0-byte item", async () => {
    await expectInvalid([{ name: "z.png", mediaType: "image/png", data: "" }]);
  });

  it("DI12 content/type mismatch is rejected", async () => {
    await expectInvalid([item(SVG_BYTES, "image/png")]);
    await expectInvalid([item(ZIP_BYTES, "image/png")]);
    await expectInvalid([item(PNG_1x1, "image/gif")]);
    await expectInvalid([item(GIF_1x1, "image/svg+xml")]);
    await expectInvalid([item(PNG_1x1, "application/pdf")]);
  });

  it("DI13 malformed base64 / shapes (never echoing data)", async () => {
    const png = b64(PNG_1x1);
    const cases: unknown[] = [
      [{ name: "a", mediaType: "image/png", data: "%%%" }],
      [{ name: "a", mediaType: "image/png", data: "abc" }],
      [{ name: "a", mediaType: "image/png", data: `data:image/png;base64,${png}` }],
      [{ name: "a", mediaType: "image/png", data: `${png.slice(0, 8)}\n${png.slice(8)}` }],
      [{ name: "a", mediaType: "image/png", data: "iVBORw0KGgp=" }],
      [{ name: "a", mediaType: "image/png", data: 42 }],
      { not: "an array" },
      [null],
    ];
    for (const c of cases) await expectInvalid(c);
  });

  it("DI13b a missing name is defaulted (valid)", async () => {
    const { runId } = await startTestRun(env, "x", { attachments: [{ name: "", mediaType: "image/png", bytes: PNG_1x1 }] });
    await awaitTerminal(env, runId);
    const ev = handlers.getRunEvents({ projectId: env.projectId, runId, afterSeq: 0 }, ctx);
    expect(ev.run.attachments?.[0]?.name).toBe("image-1");
  });

  it("DI19 error messages never contain the sentinel data", async () => {
    await expectInvalid([{ name: "s", mediaType: "image/gif", data: b64(PNG_SENTINEL) }], SENTINEL);
    await expectInvalid([{ name: "s", mediaType: "image/png", data: `!${b64(PNG_SENTINEL)}` }], SENTINEL);
  });
});
