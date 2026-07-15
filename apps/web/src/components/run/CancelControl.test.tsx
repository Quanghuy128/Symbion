import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CancelControl } from "./CancelControl";

/**
 * Regression coverage for QA's Defect 4 (graph-execution-realtime P1 fix pass):
 * clicking "■ Cancel" must swap to the two-step inline confirm ("Stop this
 * run?" + Stop run / Keep running), and "Stop run" must invoke onConfirm.
 * QA could not reproduce the failure in a fresh isolated repro (see STATE §11),
 * but this test pins the click -> confirm-render contract cheaply so any future
 * regression in this exact path fails CI immediately.
 */
describe("CancelControl", () => {
  it("TC-CANCEL-1: clicking Cancel renders the two-step confirm", () => {
    render(<CancelControl onConfirm={() => {}} />);
    const cancelBtn = screen.getByRole("button", { name: "■ Cancel" });
    fireEvent.click(cancelBtn);
    expect(screen.getByText(/Stop this run\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep running" })).toBeInTheDocument();
  });

  it("TC-CANCEL-2: clicking Stop run invokes onConfirm and clears the confirm UI", () => {
    const onConfirm = vi.fn();
    render(<CancelControl onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "■ Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop run" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Stop this run\?/)).not.toBeInTheDocument();
  });

  it("TC-CANCEL-3: clicking Keep running reverts to the Cancel button without calling onConfirm", () => {
    const onConfirm = vi.fn();
    render(<CancelControl onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "■ Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep running" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "■ Cancel" })).toBeInTheDocument();
  });

  it("TC-CANCEL-4: cancelling=true renders the in-flight state, not the Cancel button", () => {
    render(<CancelControl onConfirm={() => {}} cancelling />);
    expect(screen.queryByRole("button", { name: "■ Cancel" })).not.toBeInTheDocument();
    expect(screen.getByText(/CANCELLING/)).toBeInTheDocument();
  });
});
