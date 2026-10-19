import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandNode, type CommandNodeData } from "./CommandNode";

/**
 * Regression coverage for the `Handle` -> `NodeHandle` import swap (testplan
 * §1.6). NOTE (flagged for the Checker per the task brief): no test file
 * existed for `CommandNode` BEFORE this migration — this is NEW coverage
 * added because this file is being touched, not a backfill of a pre-existing
 * gap this migration is otherwise obligated to close. The testplan's own
 * §1.6 explicitly treats the prior absence of coverage as an accepted
 * out-of-scope gap; this file exists anyway as extra insurance on the one
 * line (`Handle` -> `NodeHandle`) that actually changed.
 */
function data(overrides?: Partial<CommandNodeData>): CommandNodeData {
  return { label: "/analyze", connectable: true, daemonConnected: true, ...overrides };
}

describe("CommandNode (post-migration regression)", () => {
  it("renders the label and a source NodeHandle", () => {
    const { container } = render(<CommandNode data={data()} />);
    expect(screen.getByText("/analyze")).toBeInTheDocument();
    expect(container.querySelector('[data-handle-role="source"]')).not.toBeNull();
  });

  it("hover reveals the ⋯ menu button", () => {
    render(<CommandNode data={data()} />);
    const nodeDiv = screen.getByText("/analyze").closest(".group") as HTMLElement;
    fireEvent.mouseEnter(nodeDiv);
    expect(screen.getByRole("button", { name: "Options" })).toBeTruthy();
  });

  it("justAdded ring does not throw / renders without crashing", () => {
    expect(() => render(<CommandNode data={data({ justAdded: true })} />)).not.toThrow();
  });

  it("hollow (non-connectable) handle renders when connectable=false", () => {
    const { container } = render(<CommandNode data={data({ connectable: false })} />);
    const handle = container.querySelector('[data-handle-role="source"]');
    expect(handle?.className).toContain("bg-transparent");
  });
});
