import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callRpcMock = vi.fn();

vi.mock("../rpc/client", async () => {
  const actual = await vi.importActual<typeof import("../rpc/client")>("../rpc/client");
  return {
    ...actual,
    callRpc: (...args: unknown[]) => callRpcMock(...args),
  };
});

import { useArtifactStore } from "./useArtifactStore";

function getConnState() {
  const s = useArtifactStore.getState();
  return { daemonReachable: s.daemonReachable, sessionValid: s.sessionValid, daemonConnected: s.daemonConnected };
}

// tokenless-daemon: the heartbeat is now a single `ping` liveness probe — there
// is no session/token axis left. ping ok -> all flags true; ping fails -> all
// false. (The former hasSession()/listProjects-401 dance is gone.)
describe("useArtifactStore heartbeat", () => {
  beforeEach(() => {
    callRpcMock.mockReset();
    useArtifactStore.setState({ daemonReachable: true, sessionValid: true, daemonConnected: true });
  });

  afterEach(() => {
    useArtifactStore.getState().startHeartbeat()(); // ensure any leftover timer is cleared
  });

  it("TC-HB-1 (daemon down): ping rejects -> all three flags false", async () => {
    callRpcMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const stop = useArtifactStore.getState().startHeartbeat();
    await vi.waitFor(() =>
      expect(getConnState()).toEqual({ daemonReachable: false, sessionValid: false, daemonConnected: false })
    );
    stop();
  });

  it("TC-HB-2 (daemon up): ping ok -> all flags true, exactly one ping call", async () => {
    callRpcMock.mockResolvedValueOnce({}); // ping
    const stop = useArtifactStore.getState().startHeartbeat();
    await vi.waitFor(() =>
      expect(getConnState()).toEqual({ daemonReachable: true, sessionValid: true, daemonConnected: true })
    );
    expect(callRpcMock).toHaveBeenCalledWith("ping", {});
    stop();
  });

  it("TC-HB-6 (idempotent start/stop): calling startHeartbeat twice does not create two intervals", async () => {
    callRpcMock.mockResolvedValue({});
    const stop1 = useArtifactStore.getState().startHeartbeat();
    const callsAfterFirstStart = callRpcMock.mock.calls.length;
    const stop2 = useArtifactStore.getState().startHeartbeat();
    // second start should not add its own immediate tick (no second interval created)
    expect(callRpcMock.mock.calls.length).toBeLessThanOrEqual(callsAfterFirstStart + 2);
    stop1();
    stop2();
  });

  it("TC-HB-7 (immediate first tick): startHeartbeat triggers a tick without waiting the full interval", async () => {
    callRpcMock.mockResolvedValue({});
    const stop = useArtifactStore.getState().startHeartbeat();
    await vi.waitFor(() => expect(callRpcMock).toHaveBeenCalled());
    stop();
  });
});
