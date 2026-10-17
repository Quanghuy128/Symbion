import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CancelControl } from "./CancelControl";

/**
 * Regression coverage for QA's Defect 4 (graph-execution-realtime P1 fix pass):
 * clicking "Stop run" (was "■ Cancel" before workflow-agent-run) must swap to
 * the two-step inline confirm ("Stops the whole run, including all subagents…"
 * + Stop run / Keep running), and "Stop run" must invoke onConfirm.
 * QA could not reproduce the failure in a fresh isolated repro (see STATE §11),
 * but this test pins the click -> confirm-render contract cheaply so any future
 * regression in this exact path fails CI immediately.
 */
describe("CancelControl", () => {
  it("TC-CANCEL-1: clicking Cancel renders the two-step confirm", () => {
    render(<CancelControl onConfirm={() => {}} />);
    const cancelBtn = screen.getByRole("button", { name: "Stop run" });
    fireEvent.click(cancelBtn);
    expect(screen.getByText(/Stops the whole run, including all subagents\. Files already written stay written\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep running" })).toBeInTheDocument();
  });

  it("TC-CANCEL-2: clicking Stop run invokes onConfirm and clears the confirm UI", () => {
    const onConfirm = vi.fn();
    render(<CancelControl onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop run" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop run" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Stops the whole run, including all subagents\. Files already written stay written\./)).not.toBeInTheDocument();
  });

  it("TC-CANCEL-3: clicking Keep running reverts to the Cancel button without calling onConfirm", () => {
    const onConfirm = vi.fn();
    render(<CancelControl onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop run" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep running" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Stop run" })).toBeInTheDocument();
  });

  it("TC-CANCEL-4: cancelling=true renders the in-flight state, not the Cancel button", () => {
    render(<CancelControl onConfirm={() => {}} cancelling />);
    expect(screen.queryByRole("button", { name: "Stop run" })).not.toBeInTheDocument();
    expect(screen.getByText(/CANCELLING/)).toBeInTheDocument();
  });
});
