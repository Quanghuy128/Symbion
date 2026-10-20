import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalArtifact } from "@symbion/core";
import type { RunPreflightResult } from "@symbion/rpc-types";
import { installObjectUrlStubs, pngFile } from "./attachmentTestUtil";

const preflight = vi.fn();
const startRun = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/run/useRunStore", () => ({
  useRunStore: (sel: (s: unknown) => unknown) => sel({ preflight, startRun }),
}));

import { RunDialog } from "./RunDialog";

const command = {
  id: "cmd-1",
  kind: "command",
  name: "analyze",
  description: "d",
  body: "body",
  meta: { version: "0.1.0", status: "published", createdAt: "", updatedAt: "" },
} as unknown as CanonicalArtifact;

function pre(over: Partial<RunPreflightResult> = {}, nonce = "n1"): RunPreflightResult {
  return {
    checks: [{ id: "cli", severity: "ok", label: "claude CLI ok" }],
    blocked: false,
    needsFirstRunAck: false,
    invocationEcho: "claude -p x",
    permissionSummary: { mode: "acceptEdits", cwd: "/p", ceilings: { wallClockMs: 1, tokenCap: 1 }, sentence: "S." },
    attachmentSupport: { supported: true, minCliVersion: "2.1.187" },
    consentNonce: nonce,
    ...over,
  };
}

beforeEach(() => {
  installObjectUrlStubs();
  preflight.mockReset();
  startRun.mockReset();
});

const renderDialog = (lastRequirement?: string) =>
  render(<RunDialog command={command} projectId="p1" projectName="proj" lastRequirement={lastRequirement} onClose={() => {}} onStarted={() => {}} />);

const execBtn = () => screen.getByRole("button", { name: /Execute|Preparing images|Starting/ });

async function pick(file: File) {
  const input = screen.getByTestId("attachment-file-input") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

describe("RunDialog attachments (WU3-WU6)", () => {
  it("WU3 Execute is gated on encoding + consent refresh, then sends attachments with the REFRESHED nonce", async () => {
    preflight.mockResolvedValueOnce(pre({}, "nonce-empty"));
    startRun.mockResolvedValue({ runId: "r1" });
    renderDialog();
    await waitFor(() => expect(preflight).toHaveBeenCalledTimes(1));
    expect(preflight.mock.calls[0]![2]).toEqual([]);

    // empty requirement + ready chip -> still disabled (AC-9)
    preflight.mockResolvedValueOnce(pre({}, "nonce-with-image"));
    await pick(pngFile("shot.png", 64));
    await waitFor(() => expect(screen.getAllByTestId("attachment-chip")).toHaveLength(1));
    expect(execBtn()).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/rate limiting/i), { target: { value: "fix header" } });
    // refresh pending (debounced) -> label + disabled
    expect(execBtn()).toBeDisabled();
    await waitFor(() => expect(preflight).toHaveBeenCalledTimes(2), { timeout: 2000 });
    const metaArg = preflight.mock.calls[1]![2] as { sha256: string; size: number; mediaType: string }[];
    expect(metaArg).toHaveLength(1);
    expect(metaArg[0]).toMatchObject({ size: 64, mediaType: "image/png" });
    expect(metaArg[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);

    await waitFor(() => expect(execBtn()).toBeEnabled());
    fireEvent.click(execBtn());
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));
    const params = startRun.mock.calls[0]![0];
    expect(params.nonce).toBe("nonce-with-image");
    expect(params.attachments).toHaveLength(1);
    expect(params.attachments[0]).toMatchObject({ name: "shot.png", mediaType: "image/png" });
    expect(typeof params.attachments[0].data).toBe("string");
  });

  it("WU4 removing the last chip re-preflights WITHOUT attachments", async () => {
    preflight.mockResolvedValue(pre());
    renderDialog("go");
    await waitFor(() => expect(preflight).toHaveBeenCalledTimes(1));
    await pick(pngFile());
    await waitFor(() => expect(preflight).toHaveBeenCalledTimes(2), { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: /Remove shot\.png/ }));
    await waitFor(() => expect(preflight).toHaveBeenCalledTimes(3), { timeout: 2000 });
    expect(preflight.mock.calls[2]![2]).toEqual([]);
  });

  it("WU5 unsupported CLI disables the attach button and shows the reason", async () => {
    preflight.mockResolvedValue(
      pre({ attachmentSupport: { supported: false, minCliVersion: "2.1.187", reason: "Images need claude CLI 2.1.187 or newer (installed: 0.2.9)." } })
    );
    renderDialog("go");
    await waitFor(() => expect(screen.getByText(/2\.1\.187 or newer/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Attach images/ })).toBeDisabled();
    expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0);
  });

  it("WU5b an outdated daemon (no attachmentSupport) names the daemon, not the CLI", async () => {
    const { attachmentSupport: _omit, ...legacy } = pre();
    void _omit;
    preflight.mockResolvedValue(legacy as RunPreflightResult);
    renderDialog("go");
    await waitFor(() => expect(screen.getByText(/daemon is out of date/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Attach images/ })).toBeDisabled();
    expect(screen.queryByText(/CLI can't receive images/)).not.toBeInTheDocument();
  });

  it("WU5c a failed preflight explains that image support could not be checked", async () => {
    preflight.mockRejectedValue(new Error("boom"));
    renderDialog("go");
    await waitFor(() => expect(screen.getByText(/Couldn't check image support/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Attach images/ })).toBeDisabled();
  });

  it("WU6 'Run again' pre-fills the text with zero chips", async () => {
    preflight.mockResolvedValue(pre());
    renderDialog("fix header");
    await waitFor(() => expect(preflight).toHaveBeenCalled());
    expect((screen.getByPlaceholderText(/rate limiting/i) as HTMLInputElement).value).toBe("fix header");
    expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0);
  });

  it("drop overlay appears for a Files drag and accepts a dropped image", async () => {
    preflight.mockResolvedValue(pre());
    renderDialog("go");
    await waitFor(() => expect(preflight).toHaveBeenCalledTimes(1));
    const dt = { types: ["Files"], files: [pngFile("d.png")] };
    act(() => {
      const ev = new Event("dragenter", { bubbles: true, cancelable: true }) as Event & { dataTransfer?: unknown };
      ev.dataTransfer = dt;
      window.dispatchEvent(ev);
    });
    const overlay = await screen.findByTestId("attachment-drop-overlay");
    expect(overlay).toHaveTextContent("Drop images to attach");
    await act(async () => {
      fireEvent.drop(overlay, { dataTransfer: dt });
    });
    await waitFor(() => expect(screen.getAllByTestId("attachment-chip")).toHaveLength(1));
  });
});
