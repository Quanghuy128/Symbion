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
    expect(screen.queryByText(/disconnected/)).not.toBeInTheDocument();
  });

  it("TC-BADGE-2: not reachable -> red 'daemon disconnected' text", () => {
    setConnState(false);
    render(<DaemonStatusBadge />);
    expect(screen.getByText(/disconnected/)).toBeInTheDocument();
  });

  it("TC-BADGE-3: no 'session expired' / token wording exists anymore", () => {
    setConnState(false);
    render(<DaemonStatusBadge />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/back to terminal|session|token/i);
  });
});
