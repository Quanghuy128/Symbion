import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DaemonStatusBadge } from "./DaemonStatusBadge";
import { useArtifactStore } from "@/lib/store/useArtifactStore";

// tokenless-daemon: the badge now has only two states, driven solely by
// daemonReachable (the session/token axis was removed). sessionValid is kept in
// the store shape (always mirrors daemonReachable) but no longer branches the UI.
function setConnState(daemonReachable: boolean) {
  useArtifactStore.setState({
    daemonReachable,
    sessionValid: daemonReachable,
    daemonConnected: daemonReachable,
  });
}

describe("DaemonStatusBadge", () => {
  it("TC-BADGE-1: reachable -> green connected text, no destructive styling", () => {
    setConnState(true);
    render(<DaemonStatusBadge />);
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
    expect(screen.queryByText(/mất kết nối/)).not.toBeInTheDocument();
  });

  it("TC-BADGE-2: not reachable -> red 'daemon mất kết nối' text", () => {
    setConnState(false);
    render(<DaemonStatusBadge />);
    expect(screen.getByText(/mất kết nối/)).toBeInTheDocument();
  });

  it("TC-BADGE-3: no 'session expired' / token wording exists anymore", () => {
    setConnState(false);
    render(<DaemonStatusBadge />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/quay lại terminal|phiên|token/i);
  });
});
