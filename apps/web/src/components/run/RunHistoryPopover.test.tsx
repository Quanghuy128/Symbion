import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RunListItem } from "@symbion/rpc-types";

const row = (over: Partial<RunListItem>): RunListItem => ({
  runId: "r",
  commandName: "analyze",
  status: "completed",
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  durationMs: 1000,
  freshTokens: 10,
  costUsd: 0.1,
  ...over,
});

vi.mock("@/lib/run/useRunStore", () => ({
  useRunStore: {
    getState: () => ({
      listRunsForHistory: async () => ({ runs: [row({ runId: "a", attachmentCount: 2 }), row({ runId: "b", commandName: "plain" })] }),
    }),
  },
}));

import { RunHistoryPopover } from "./RunHistoryPopover";

describe("RunHistoryPopover attachment badge (WU10)", () => {
  it("shows the image count only on rows that have attachments", async () => {
    render(<RunHistoryPopover projectId="p" onSelect={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("/analyze")).toBeInTheDocument());
    const withBadge = screen.getByTitle("2 images attached");
    expect(withBadge).toHaveTextContent("2");
    expect(screen.getAllByTitle(/images? attached/)).toHaveLength(1);
  });
});
