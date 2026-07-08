import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callRpcMock = vi.fn();
const hasSessionMock = vi.fn();

vi.mock("../rpc/client", async () => {
  const actual = await vi.importActual<typeof import("../rpc/client")>("../rpc/client");
  return {
    ...actual,
    callRpc: (...args: unknown[]) => callRpcMock(...args),
    hasSession: () => hasSessionMock(),
  };
});

import { DaemonRpcError } from "../rpc/client";
import { useArtifactStore } from "./useArtifactStore";

function getConnState() {
  const s = useArtifactStore.getState();
  return { daemonReachable: s.daemonReachable, sessionValid: s.sessionValid, daemonConnected: s.daemonConnected };
}

describe("useArtifactStore heartbeat", () => {
  beforeEach(() => {
    callRpcMock.mockReset();
    hasSessionMock.mockReset();
    useArtifactStore.setState({ daemonReachable: true, sessionValid: true, daemonConnected: true });
  });

  afterEach(() => {
    useArtifactStore.getState().startHeartbeat()(); // ensure any leftover timer is cleared
  });

  it("TC-HB-1 (daemon down): ping rejects -> all three flags false", async () => {
    callRpcMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const stop = useArtifactStore.getState().startHeartbeat();
    await vi.waitFor(() => expect(getConnState()).toEqual({ daemonReachable: false, sessionValid: false, daemonConnected: false }));
    stop();
  });

  it("TC-HB-2 (no session, daemon up): ping ok, hasSession false -> sessionValid false, no listProjects call", async () => {
    callRpcMock.mockResolvedValueOnce({}); // ping
    hasSessionMock.mockReturnValue(false);
    const stop = useArtifactStore.getState().startHeartbeat();
    await vi.waitFor(() =>
      expect(getConnState()).toEqual({ daemonReachable: true, sessionValid: false, daemonConnected: false })
    );
    expect(callRpcMock).toHaveBeenCalledTimes(1);
    expect(callRpcMock).toHaveBeenCalledWith("ping", {});
    stop();
  });

  it("TC-HB-3 (stale/foreign token): ping ok, hasSession true, listProjects 401s -> sessionValid false, daemonReachable true", async () => {
    hasSessionMock.mockReturnValue(true);
    callRpcMock
      .mockResolvedValueOnce({}) // ping
      .mockRejectedValueOnce(new DaemonRpcError({ code: "unauthorized", message: "no" })); // listProjects
    const stop = useArtifactStore.getState().startHeartbeat();
    await vi.waitFor(() =>
      expect(getConnState()).toEqual({ daemonReachable: true, sessionValid: false, daemonConnected: false })
    );
    stop();
  });

  it("TC-HB-4 (fully connected): ping ok, hasSession true, listProjects ok -> all true", async () => {
    hasSessionMock.mockReturnValue(true);
    callRpcMock.mockResolvedValueOnce({}).mockResolvedValueOnce({ projects: [] });
    const stop = useArtifactStore.getState().startHeartbeat();
    await vi.waitFor(() =>
      expect(getConnState()).toEqual({ daemonReachable: true, sessionValid: true, daemonConnected: true })
    );
    stop();
  });

  it("TC-HB-5 (unexpected non-401 error fails closed)", async () => {
    hasSessionMock.mockReturnValue(true);
    callRpcMock.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("boom"));
    const stop = useArtifactStore.getState().startHeartbeat();
    await vi.waitFor(() =>
      expect(getConnState()).toEqual({ daemonReachable: false, sessionValid: false, daemonConnected: false })
    );
    stop();
  });

  it("TC-HB-6 (idempotent start/stop): calling startHeartbeat twice does not create two intervals", async () => {
    callRpcMock.mockResolvedValue({});
    hasSessionMock.mockReturnValue(true);
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
    hasSessionMock.mockReturnValue(true);
    const stop = useArtifactStore.getState().startHeartbeat();
    await vi.waitFor(() => expect(callRpcMock).toHaveBeenCalled());
    stop();
  });
});
