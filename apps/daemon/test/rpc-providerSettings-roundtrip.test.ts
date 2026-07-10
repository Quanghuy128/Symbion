import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type DaemonServerHandle } from "../src/server.js";

let handle: DaemonServerHandle;
let configDir: string;
const originalConfigDir = process.env["SYMBION_CONFIG_DIR"];

beforeEach(async () => {
  configDir = mkdtempSync(join(tmpdir(), "symbion-config-"));
  process.env["SYMBION_CONFIG_DIR"] = configDir;
  const port = 22000 + Math.floor(Math.random() * 4000);
  handle = await startServer({ port, version: "0.1.0" });
});

afterEach(async () => {
  await handle.close();
  rmSync(configDir, { recursive: true, force: true });
  if (originalConfigDir === undefined) {
    delete process.env["SYMBION_CONFIG_DIR"];
  } else {
    process.env["SYMBION_CONFIG_DIR"] = originalConfigDir;
  }
});

async function rpc(method: string, params: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const res = await fetch(`http://127.0.0.1:${handle.port}/rpc`, {
    method: "POST",
    headers,
    body: JSON.stringify({ method, params }),
  });
  return { status: res.status, body: await res.json() };
}

// tokenless-daemon: the per-request session token was removed, so the former
// TC-P10/TC-P11 "WITHOUT a token -> 401" gate tests no longer apply. These RPCs
// now reach their handlers over the loopback-only transport with no token.
describe("provider-settings RPCs reach their handlers (no token gate)", () => {
  it("listProviders -> 200", async () => {
    const res = await rpc("listProviders", {});
    expect(res.status).toBe(200);
    expect(res.body.providers).toHaveLength(4);
  });
});

describe("TC-I1/TC-I2/TC-I3: full round-trip", () => {
  let fakeAnthropic: Server | undefined;

  afterEach(async () => {
    if (fakeAnthropic) {
      await new Promise<void>((resolve) => fakeAnthropic!.close(() => resolve()));
      fakeAnthropic = undefined;
    }
  });

  it("TC-I3: saveProviderKey -> simulated daemon restart (fresh handlers/reload from same SYMBION_CONFIG_DIR) -> listProviders still shows configured:true", async () => {
    const save = await rpc("saveProviderKey", { providerId: "openai", apiKey: "sk-roundtrip-test", model: "gpt-4o-mini" });
    expect(save.status).toBe(200);

    // "restart": close this server, start a fresh one against the same config dir, with
    // no in-memory state carried over (loadProvidersConfig() re-reads the file each call).
    await handle.close();
    const port = 22000 + Math.floor(Math.random() * 4000);
    handle = await startServer({ port, version: "0.1.0" });

    const after = await rpc("listProviders", {});
    expect(after.status).toBe(200);
    const openai = after.body.providers.find((p: { id: string }) => p.id === "openai");
    expect(openai.configured).toBe(true);
  });

  it("TC-P2-style: setActiveProvider rejects activating a provider with no key, even via the real RPC transport", async () => {
    const res = await rpc("setActiveProvider", { providerId: "anthropic" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid-params");
  });
});
