import { afterEach, describe, expect, it, vi } from "vitest";
import { DaemonRpcError, callRpc } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("callRpc hardening (WU9)", () => {
  it("413 -> payload-too-large with a friendly message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 413, ok: false, json: async () => ({}) }));
    await expect(callRpc("startRun", {})).rejects.toMatchObject({ code: "payload-too-large" });
    await expect(callRpc("startRun", {})).rejects.toThrow(/too large/);
  });

  it("a body that fails to parse -> network DaemonRpcError, not a raw SyntaxError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      })
    );
    const err = (await callRpc("ping", {}).catch((e: unknown) => e)) as DaemonRpcError;
    expect(err).toBeInstanceOf(DaemonRpcError);
    expect(err.code).toBe("network");
  });

  it("normal error bodies still surface their code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 400, ok: false, json: async () => ({ error: { code: "invalid-params", message: "x" } }) })
    );
    await expect(callRpc("ping", {})).rejects.toMatchObject({ code: "invalid-params" });
  });
});
