import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { RunSummary } from "@symbion/core";
import { RunSummarySection } from "./RunSummarySection";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const summary: RunSummary = {
  status: "completed",
  exitCode: 0,
  durationMs: 12_000,
  startedAt: new Date(0).toISOString(),
  totals: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, fresh: 2 },
  perNode: [
    { nodeId: null, label: "/analyze", ownFresh: 1, totalFresh: 2 },
    { nodeId: null, label: "ba", ownFresh: 1, totalFresh: 1 },
    { nodeId: null, label: "unrecognized subagent", ownFresh: 1, totalFresh: 1, unrecognized: true },
  ],
  filesChanged: [],
  degraded: false,
};

describe("RunSummarySection (W-18)", () => {
  it("← Agents calls onBack; cost rows call onOpenAgent(label); [Feed] is gone", () => {
    const onBack = vi.fn();
    const onOpenAgent = vi.fn();
    render(<RunSummarySection summary={summary} onRerun={() => {}} onBack={onBack} onClose={() => {}} onOpenAgent={onOpenAgent} />);
    expect(screen.queryByText("[Feed]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "← Agents" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /^ba›/ }));
    expect(onOpenAgent).toHaveBeenCalledWith("ba");
    fireEvent.click(screen.getByRole("button", { name: /unrecognized subagent/ }));
    expect(onOpenAgent).toHaveBeenCalledTimes(1); // the unrecognized bucket is not a link
  });
});
