import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DaemonStatusBadge } from "./DaemonStatusBadge";
import { useArtifactStore } from "@/lib/store/useArtifactStore";

function setConnState(daemonReachable: boolean, sessionValid: boolean) {
  useArtifactStore.setState({
    daemonReachable,
    sessionValid,
    daemonConnected: daemonReachable && sessionValid,
  });
}

describe("DaemonStatusBadge", () => {
  it("TC-BADGE-1: reachable + valid -> green connected text, no destructive styling", () => {
    setConnState(true, true);
    render(<DaemonStatusBadge />);
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
    expect(screen.queryByText(/mất kết nối/)).not.toBeInTheDocument();
  });

  it("TC-BADGE-2: not reachable -> existing red 'daemon mất kết nối' text (unchanged wording)", () => {
    setConnState(false, false);
    render(<DaemonStatusBadge />);
    expect(screen.getByText(/mất kết nối/)).toBeInTheDocument();
  });

  it("TC-BADGE-3 (new state): reachable but session invalid -> distinct wording, not 'mất kết nối'", () => {
    setConnState(true, false);
    render(<DaemonStatusBadge />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/mất kết nối/);
    expect(text).toMatch(/quay lại terminal|phiên|token/i);
  });
});
