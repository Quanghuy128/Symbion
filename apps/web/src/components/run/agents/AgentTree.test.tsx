import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AgentNode } from "@symbion/core";
import { AgentTree, AgentTreeRow } from "./AgentTree";
import { BackgroundGroup, UnattributedGroup } from "./AgentGroups";
import { A, B, C, O, T0, syntheticView } from "./agentsTestUtil";

function rowIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-agent-id]")].map((el) => el.getAttribute("data-agent-id")!);
}

describe("AgentTree (W-3)", () => {
  it("order root, A, B, C (indented), orphan-promoted O; background group; unattributed hidden", () => {
    const { view } = syntheticView("running");
    const { container } = render(
      <>
        <AgentTree root={view.root} selectedAgentId={null} focusedAgentId={null} live nowMs={T0 + 5_000} onOpen={() => {}} onHover={() => {}} />
        <BackgroundGroup tasks={view.background} live terminal={false} nowMs={T0 + 5_000} onOpen={() => {}} />
        <UnattributedGroup node={view.unattributed} eventCount={0} onOpen={() => {}} />
      </>
    );
    expect(rowIds(container)).toEqual(["root", A, B, C, O]);
    const cRow = container.querySelector(`[data-agent-id="${C}"]`) as HTMLElement;
    const aRow = container.querySelector(`[data-agent-id="${A}"]`) as HTMLElement;
    expect(parseInt(cRow.style.paddingLeft)).toBeGreaterThan(parseInt(aRow.style.paddingLeft));
    const bg = screen.getByTestId("background-group");
    expect(within(bg).getByText(/Background · 1/)).toBeTruthy();
    expect(within(bg).getByText("$ npm run dev")).toBeTruthy();
    expect(screen.queryByTestId("unattributed-group")).toBeNull();
  });

  it("unattributed group appears (with event count) when the view has orphans", () => {
    const { view } = syntheticView("running", 23); // through both orphan messages, before O's dispatch
    expect(view.unattributed).not.toBeNull();
    const onOpen = vi.fn();
    render(<UnattributedGroup node={view.unattributed} eventCount={view.rowsByAgent.get("unattributed")!.length} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId("unattributed-group"));
    expect(onOpen).toHaveBeenCalled();
    expect(screen.getByText(/Unattributed · 2 events/)).toBeTruthy();
  });

  it("root-only view -> 'No subagents spawned.'", () => {
    const { view } = syntheticView("running", 3);
    render(<AgentTree root={view.root} selectedAgentId={null} focusedAgentId={null} live nowMs={T0} onOpen={() => {}} onHover={() => {}} />);
    expect(screen.getByText("No subagents spawned.")).toBeTruthy();
  });

  it("starting root -> waiting copy", () => {
    const { view } = syntheticView("starting", 0);
    render(<AgentTree root={view.root} selectedAgentId={null} focusedAgentId={null} live nowMs={T0} onOpen={() => {}} onHover={() => {}} />);
    expect(screen.getByText("Waiting for the CLI to start streaming…")).toBeTruthy();
    expect(screen.getByRole("img", { name: "starting" })).toBeTruthy();
  });
});

function fakeAgent(id: string, depth: number, extra?: Partial<AgentNode>): AgentNode {
  return {
    id,
    parentId: null,
    kind: "subagent",
    agentType: "ba",
    graphKey: "ba",
    status: "running",
    startedAtMs: T0,
    freshTokens: 1200,
    usage: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0 },
    toolCount: 2,
    errorCount: 0,
    children: [],
    mode: "foreground",
    spawnedBy: "root",
    depth,
    ...extra,
  };
}

describe("AgentTreeRow depth cap (W-4)", () => {
  it("indent capped at 3 levels, then '↳ +n'", () => {
    const { container: c3 } = render(
      <AgentTreeRow agent={fakeAgent("x3", 3)} depth={3} selected={false} focused={false} live isNew={false} nowMs={T0} onOpen={() => {}} onHover={() => {}} />
    );
    const row3 = c3.querySelector("[data-agent-id='x3']") as HTMLElement;
    expect(row3.textContent).not.toContain("↳");
    const { container: c5 } = render(
      <AgentTreeRow agent={fakeAgent("x5", 5)} depth={5} selected={false} focused={false} live isNew={false} nowMs={T0} onOpen={() => {}} onHover={() => {}} />
    );
    const row5 = c5.querySelector("[data-agent-id='x5']") as HTMLElement;
    expect(row5.style.paddingLeft).toBe(row3.style.paddingLeft);
    expect(row5.textContent).toContain("↳ +2");
  });
});

describe("AgentTreeRow not on graph (W-13)", () => {
  it("shows the tag and never calls onHoverAgent for a node mapping", () => {
    const onHover = vi.fn();
    const agent = fakeAgent("ex", 1, { agentType: "Explore", graphKey: null });
    const { container } = render(
      <AgentTreeRow agent={agent} depth={1} selected={false} focused={false} live isNew={false} nowMs={T0} onOpen={() => {}} onHover={onHover} />
    );
    expect(screen.getByText("not on graph")).toBeTruthy();
    const row = container.querySelector("[data-agent-id='ex']")!;
    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);
    expect(onHover).not.toHaveBeenCalled();
  });

  it("on-graph rows report hover (and clear it)", () => {
    const onHover = vi.fn();
    const { container } = render(
      <AgentTreeRow agent={fakeAgent("ba1", 1)} depth={1} selected={false} focused={false} live isNew={false} nowMs={T0} onOpen={() => {}} onHover={onHover} />
    );
    const row = container.querySelector("[data-agent-id='ba1']")!;
    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);
    expect(onHover.mock.calls).toEqual([["ba1"], [null]]);
  });

  it("terminal agent shows counts with errors in danger", () => {
    render(
      <AgentTreeRow
        agent={fakeAgent("e", 1, { status: "done", endedAtMs: T0 + 40_000, toolCount: 9, errorCount: 2 })}
        depth={1}
        selected={false}
        focused={false}
        live={false}
        isNew={false}
        nowMs={T0}
        onOpen={() => {}}
        onHover={() => {}}
      />
    );
    expect(screen.getByText(/9 tools/)).toBeTruthy();
    expect(screen.getByText(/2 errors/).className).toContain("text-danger");
    expect(screen.getByText("0:40")).toBeTruthy();
  });
});
